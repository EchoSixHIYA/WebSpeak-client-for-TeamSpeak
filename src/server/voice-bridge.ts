import { SessionAudioTransport } from "./session-audio.js";
import { SessionEventCoordinator, type SessionDirectoryState } from "./session-events.js";
import { ScreenShareCoordinator } from "./screen-share-coordinator.js";
import { handleCommand } from "./voice-commands.js";
import { createAudioFlowStats, snapshotAudioStats, type AudioFlowStats } from "./audio-stats.js";
export type { AudioFlowStats } from "./audio-stats.js";
import type { ServerMessage } from "../shared/server-messages.js";
import { parseWebRtcClientMessage } from "../shared/webrtc.js";
import { resolveVoiceMediaAddresses } from "./webrtc-config.js";
import type { ServerEvent as SharedServerEvent } from "../shared/voice-models.js";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { parseIdentity } from "@honeybbq/teamspeak/client";
import { TSClient, type TSClientOptions } from "./ts-client.js";
import type { Logger as LoggerType } from "../logger.js";
import { clientConnectionFailureCode, describeTeamSpeakError, normalizeTeamSpeakError } from "../errors.js";
import { formatTeamSpeakTarget, teamSpeakTargetKey, type TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { JoinTicketStore, type JoinTicketPayload } from "./join-ticket.js";
import { IdentityLeaseStore } from "./identity-lease.js";
import { SessionManager, type ManagedSession, type SessionTeardownReason } from "./session-manager.js";
import { parseClientCommand } from "./voice-protocol.js";
import { isRecoverable, reconnectDelayMs, reconnectWindowOpen } from "./reconnect-policy.js";
import { WebRtcAudioSession, type WebRtcAudioOptions, type WebRtcAudioSessionOptions, type WebRtcSessionDescription } from "./webrtc-audio.js";
import type { AccelerationRelayOptions, ConfiguredAccelerationRelay } from "./acceleration-relay.js";
import { normalizeScreenShareIceServers, parseScreenShareMessage, type ScreenShareIceServer } from "./screen-share.js";
import { OpusEncoder } from "./opus-codec.js";
import { avatarDataUrl } from "./directory-view.js";
import { PluginCoordinator } from "../plugins/coordinator.js";
import type { PluginRegistry } from "../plugins/registry.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_HEARTBEATS = 2;
const MAX_LOGGED_WEBSOCKET_CLOSE_REASON_LENGTH = 160;

function sanitizeWebSocketCloseReason(reason: Buffer): string {
  return reason.toString("utf8")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LOGGED_WEBSOCKET_CLOSE_REASON_LENGTH);
}

function publicFailureDetail(error: ReturnType<typeof normalizeTeamSpeakError>): string | undefined {
  const serverMessage = error.diagnostics.serverMessage?.trim();
  const serverId = error.diagnostics.id?.trim();
  const detail = [serverMessage, serverId ? `server error id=${serverId}` : ""].filter(Boolean).join("; ");
  const safe = detail.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return safe || undefined;
}

export interface VoiceBridgeOptions {
  pluginRegistry?: PluginRegistry;
  joinTickets: JoinTicketStore;
  webRtc?: WebRtcAudioOptions | (() => WebRtcAudioOptions);
  screenShareIceServers?: ScreenShareIceServer[] | (() => ScreenShareIceServer[]);
  acceleration?: ConfiguredAccelerationRelay[] | (() => ConfiguredAccelerationRelay[]);
  accelerationName?: string | (() => string | undefined);
  // Addresses whose forwarding headers may be believed. Unset means loopback
  // only, which covers a reverse proxy on the same host (including the
  // published host-network container).
  trustedProxies?: readonly string[];
}

interface VoiceBridgeDependencies {
  createTeamSpeakClient?(options: TSClientOptions, logger: LoggerType): TSClient;
  createEncoder?(): Pick<OpusEncoder, "encode" | "dispose">;
}

export interface AdminSessionSummary {
  id: string;
  nickname: string;
  target: string;
  state: string;
  createdAt: string;
  ageSeconds: number;
  tsClientId: number | null;
  channelId: string | null;
  memberCount: number;
  audio: AudioFlowStats;
}

type ServerEvent = SharedServerEvent & { kind: "joined" | "left" | "moved" | "poke" | "connection" };

interface WebClientEntry extends SessionDirectoryState {
  id: string;
  session: ManagedSession;
  tsClient: TSClient;
  ws: WebSocket;
  nickname: string;
  rememberIdentity: boolean;
  clientIp: string;
  target: TeamSpeakTarget;
  accelerationRelay?: { name: string; target: string };
  acceleration?: AccelerationRelayOptions;
  identityLeaseKey?: string;
  webrtcPublicHost?: string;
  events: SessionEventCoordinator | null;
  eventLog: ServerEvent[];
  audioTransport: SessionAudioTransport | null;
  isAlive: boolean;
  lastPongAt: number;
  missedHeartbeats: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  audio: AudioFlowStats;
  webrtc: WebRtcAudioSession | null;
  webrtcGeneration: number;
  lastLatencyProbeAt: number;
  lastAudioStatsProbeAt: number;
  connectionFailureCode?: string;
  screenPeerId: string;
}

export class VoiceBridge {
  private readonly sessionManager = new SessionManager();
  private readonly entries = new Map<string, WebClientEntry>();
  private readonly screenShares: ScreenShareCoordinator;
  private readonly plugins: PluginCoordinator;
  private readonly identityLeases = new IdentityLeaseStore();
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logger: LoggerType;
  private readonly trustedProxies: BlockList;

  constructor(
    private options: VoiceBridgeOptions,
    logger: LoggerType,
    private readonly createWebRtcSession: (options: WebRtcAudioSessionOptions) => WebRtcAudioSession = options => new WebRtcAudioSession(options),
    private readonly dependencies: VoiceBridgeDependencies = {},
  ) {
    this.logger = logger.child({ component: "voice-bridge" });
    this.trustedProxies = createTrustedProxies(options.trustedProxies);
    this.plugins = new PluginCoordinator(options.pluginRegistry, this.entries, (id, message) => {
      const ws = this.entries.get(id)?.ws;
      // Optional plugin traffic must not build an unbounded queue on the voice socket.
      // A slow participant can request a fresh snapshot or reopen after draining.
      if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount <= 512 * 1024) {
        try { ws.send(JSON.stringify(message)); } catch { /* retired socket */ }
      }
    });
    this.screenShares = new ScreenShareCoordinator(this.entries, (entryId, message) => {
      const entry = this.entries.get(entryId);
      if (entry?.ws.readyState === WebSocket.OPEN) {
        try {
          entry.ws.send(JSON.stringify(message));
          return true;
        } catch (error: unknown) {
          this.logger.warn({
            entryId,
            messageType: message.type,
            errorName: error instanceof Error ? error.name : "unknown",
          }, "Could not send screen-share message to browser");
          return false;
        }
      }
      if (message.type === "screenShareNativeViewerJoined" || (message.type === "screenShareSignal" && message.signal.kind !== "iceCandidate")) {
        this.logger.info({ entryId, messageType: message.type, readyState: entry?.ws.readyState ?? null }, "Dropped screen-share message because browser WebSocket is unavailable");
      }
      return false;
    }, this.logger);
  }

  attach(server: Server): void {
    // Avatar data is delivered as a data URL in a memberAvatar message. Keep
    // the frame limit above the encoded avatar ceiling with room for JSON.
    this.wss = new WebSocketServer({ server, path: "/ws/voice", maxPayload: 512 * 1024 });
    this.startHeartbeat();

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
      const connection = this.resolveConnection(url);
      if (!connection) {
        ws.close(4001, "Join ticket required");
        return;
      }

      const { target, serverPassword, nickname } = connection;
      const channelName = connection.channel;
      const acceleration = connection.accelerated ? this.getAccelerationOptions(connection.accelerationRelayId) : undefined;
      if (connection.accelerated && !acceleration) {
        ws.close(4006, "ACCELERATION_UNAVAILABLE");
        return;
      }
      const clientIp = resolveClientIp(req, this.trustedProxies);
      const webrtcPublicHost = resolveWebRtcPublicHost(req);
      let identity;
      try {
        identity = connection.identity ? parseIdentity(connection.identity) : undefined;
      } catch {
        // Send a structured failure before the close so the browser can tell
        // an invalid remembered identity apart from a real connection failure.
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "connectionFailed", code: "IDENTITY_INVALID", detail: "Invalid identity" }));
        ws.close(4003, "IDENTITY_INVALID");
        return;
      }
      const entryId = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      let entry: WebClientEntry | null = null;
      const session = this.sessionManager.admit(entryId, async (reason) => {
        if (entry) await this.cleanupEntry(entry, reason);
      });
      if (!session) {
        this.logger.warn({ max: this.sessionManager.maxSessions }, "Max clients reached");
        ws.close(4004, "GATEWAY_FULL");
        return;
      }

      const identityLeaseKey = identity
        ? `${teamSpeakTargetKey(target)}:${identity.toString()}`
        : "";
      if (identityLeaseKey && !this.identityLeases.acquire(identityLeaseKey, entryId)) {
        this.logger.warn({ entryId, nickname, target: formatTeamSpeakTarget(target) }, "TeamSpeak identity already in use");
        void this.sessionManager.teardown(entryId, "teamSpeak-connect-failed");
        ws.close(4005, "IDENTITY_IN_USE");
        return;
      }

      this.logger.info({
        entryId,
        nickname,
        clientIp,
        channel: channelName,
        target: formatTeamSpeakTarget(target),
        ...(acceleration ? { relayName: acceleration.name, relayTarget: formatTeamSpeakTarget({ host: acceleration.relayHost, port: acceleration.relayPort }) } : {}),
      }, "WebClient connecting");
      let tsClient: TSClient;
      try {
        const createClient = this.dependencies.createTeamSpeakClient ?? ((options, logger) => new TSClient(options, logger));
        tsClient = createClient({ target, nickname, serverPassword, defaultChannel: channelName, identity, ...(acceleration ? { acceleration } : {}) }, this.logger);
      } catch (error: unknown) {
        if (identityLeaseKey) this.identityLeases.release(identityLeaseKey, entryId);
        this.logger.error({ err: error, entryId }, "Could not create TeamSpeak client");
        void this.sessionManager.teardown(entryId, "teamSpeak-connect-failed");
        // A 4003 with a bare close used to be reported as "identity rejected".
        // Send a structured failure so the browser says the TeamSpeak client
        // could not be created (server down / unreachable) instead.
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "connectionFailed", code: "TEAM_SPEAK_CLIENT_UNAVAILABLE", detail: "TeamSpeak client unavailable" }));
        ws.close(4003, "TEAM_SPEAK_CLIENT_UNAVAILABLE");
        return;
      }
      entry = {
        id: entryId,
        session,
        tsClient,
        ws,
        nickname,
        rememberIdentity: connection.rememberIdentity === true,
        clientIp,
        target,
        ...(acceleration ? { accelerationRelay: { name: acceleration.name, target: formatTeamSpeakTarget({ host: acceleration.relayHost, port: acceleration.relayPort }) } } : {}),
        ...(acceleration ? { acceleration } : {}),
        ...(identityLeaseKey ? { identityLeaseKey } : {}),
        ...(webrtcPublicHost ? { webrtcPublicHost } : {}),
        channelTree: [],
        members: new Map(),
        avatarCache: new Map(),
        events: null,
        eventLog: [],
        audioTransport: null,
        whisperTargetIds: new Set(),
        whisperActive: false,
        isAlive: true,
        lastPongAt: Date.now(),
        missedHeartbeats: 0,
        reconnectTimer: null,
        audio: createAudioFlowStats(),
        webrtc: null,
        webrtcGeneration: 0,
        lastLatencyProbeAt: 0,
        lastAudioStatsProbeAt: 0,
        screenPeerId: entryId,
      };
      this.entries.set(entryId, entry!);
      let tsReady = false;
      const sendJson = (message: ServerMessage) => {
        if (this.entries.get(entryId) === entry && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      };
      try {
        entry.audioTransport = new SessionAudioTransport({
          audio: entry.audio, socket: ws, client: tsClient,
          logger: this.logger.child({ component: "session-audio", entryId }),
          isCurrent: () => this.entries.get(entryId) === entry,
          isReady: () => tsReady && session.state === "connected",
          selfId: () => entry!.events?.selfId ?? 0,
          peer: () => entry!.webrtc,
          whisperTargets: () => entry!.whisperActive ? [...entry!.whisperTargetIds] : null,
          sendJson: message => sendJson(message),
        }, this.dependencies.createEncoder?.() ?? new OpusEncoder(48000, 1));
      } catch (error: unknown) {
        this.logger.error({ err: error, entryId }, "Could not create Opus encoder");
        void this.teardown(entryId, "teamSpeak-connect-failed");
        return;
      }

      let initialStateSent = false;
      let serverInfoGeneration = 0;
      let hasConnectedOnce = false;
      // `connected` is only published once the directory sync has landed (see
      // `sendInitialState`), so the session can already be past authentication
      // while `hasConnectedOnce` is still false. A transport drop inside that
      // gap must be handled rather than swallowed.
      const isSettling = () => session.state === "authenticating" || session.state === "syncing";
      let reconnectStartedAt = 0;
      let reconnectAttempt = 0;
      const addServerEvent = (kind: ServerEvent["kind"], message: string) => {
        const event: ServerEvent = {
          id: `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          kind,
          message,
          timestamp: Date.now(),
        };
        entry!.eventLog.push(event);
        if (entry!.eventLog.length > 200) entry!.eventLog.splice(0, entry!.eventLog.length - 200);
        if (initialStateSent) sendJson({ type: "serverEvent", event });
      };
      const sendInitialState = () => {
        if (initialStateSent || !tsReady || !events.ready || session.state !== "syncing") return;
        initialStateSent = true;
        const wasReconnecting = hasConnectedOnce;
        hasConnectedOnce = true;
        reconnectAttempt = 0;
        reconnectStartedAt = 0;
        if (!wasReconnecting) {
          entry!.eventLog.push({ id: `event-${Date.now().toString(36)}-connected`, kind: "connection", message: "已连接到服务器", timestamp: Date.now() });
          this.logger.info({
            entryId: entry!.id,
            nickname: entry!.nickname,
            clientIp: entry!.clientIp,
            target: formatTeamSpeakTarget(entry!.target),
            ...(entry!.accelerationRelay ? { relayName: entry!.accelerationRelay.name, relayTarget: entry!.accelerationRelay.target } : {}),
          }, "Web client connected to TeamSpeak");
        }
        session.transition("connected");
        sendJson({
          type: "connected",
          tsClientId: events.selfId,
          members: Array.from(entry!.members.values()),
          serverEventLog: entry!.eventLog,
          whisperTargetIds: [...entry!.whisperTargetIds],
          whisperActive: entry!.whisperActive,
          webrtcAvailable: this.getWebRtcOptions()?.enabled === true,
          webRtcStunServer: this.getWebRtcOptions()?.stunServer ?? "",
          screenShareIceServers: this.getScreenShareIceServers(),
          accelerated: Boolean(entry!.acceleration),
          ...(entry!.rememberIdentity ? { identity: tsClient.getIdentityString() } : {}),
        });
        sendJson({ type: "channelList", channels: entry!.channelTree });
        if (wasReconnecting) sendJson({ type: "reconnected" });
        events.scheduleAvatars();
        void publishServerInfo();
      };

      const resetDirectoryForReconnect = () => {
        tsReady = false;
        events.reset();
        void this.stopWebRtc(entry!);
        initialStateSent = false;
      };

      const publishServerInfo = async (): Promise<void> => {
        const generation = ++serverInfoGeneration;
        const isCurrent = () => generation === serverInfoGeneration
          && this.entries.get(entryId) === entry && session.state === "connected";
        try {
          const info = await tsClient.getServerInfo();
          if (!isCurrent()) return;
          const name = info.name.trim().slice(0, 256);
          const publicInfo = { name, icon: null as string | null, bannerUrl: null as string | null, welcomeMessage: "" };
          sendJson({ type: "serverInfo", ...publicInfo });
          const [presentation, icon] = await Promise.all([
            tsClient.getServerPresentation().catch((error: unknown) => {
              if (isCurrent()) this.logger.debug({ entryId, err: error instanceof Error ? error.message : String(error) }, "TeamSpeak server presentation unavailable");
              return { bannerUrl: null, welcomeMessage: "" };
            }),
            info.iconId ? tsClient.getServerIcon(info.iconId).catch(() => null) : Promise.resolve(null),
          ]);
          if (!isCurrent()) return;
          publicInfo.bannerUrl = presentation.bannerUrl;
          publicInfo.welcomeMessage = presentation.welcomeMessage;
          publicInfo.icon = icon ? avatarDataUrl(icon) : null;
          sendJson({ type: "serverInfo", ...publicInfo });
        } catch (error: unknown) {
          if (isCurrent()) this.logger.debug({ entryId, err: error instanceof Error ? error.message : String(error) }, "TeamSpeak server icon unavailable");
        }
      };

      const failReconnect = (normalized: ReturnType<typeof normalizeTeamSpeakError>) => {
        if (entry!.reconnectTimer) {
          clearTimeout(entry!.reconnectTimer);
          entry!.reconnectTimer = null;
        }
        try {
          if (session.state !== "disconnecting" && session.state !== "idle") session.transition("failed");
        } catch { /* teardown below remains authoritative */ }
        const failureCode = clientConnectionFailureCode(normalized, serverPassword);
        const failureDetail = publicFailureDetail(normalized);
        entry!.connectionFailureCode = failureCode;
        sendJson({ type: "reconnectFailed", code: failureCode, ...(failureDetail ? { detail: failureDetail } : {}) });
        void this.teardown(entryId, "teamSpeak-connect-failed");
      };

      const failConnect = (normalized: ReturnType<typeof normalizeTeamSpeakError>) => {
        // A dead transport can report itself twice -- once as a `disconnected`
        // event and once as a rejected `connect()`. Report and tear down once.
        if (session.state === "failed" || session.state === "disconnecting" || session.state === "idle") return;
        if (entry!.reconnectTimer) {
          clearTimeout(entry!.reconnectTimer);
          entry!.reconnectTimer = null;
        }
        try {
          session.transition("failed");
        } catch { /* teardown below remains authoritative */ }
        const failureCode = clientConnectionFailureCode(normalized, serverPassword);
        const failureDetail = publicFailureDetail(normalized);
        entry!.connectionFailureCode = failureCode;
        // Send the structured failure before closing. Some browsers and reverse
        // proxies do not preserve a WebSocket close reason, which would
        // otherwise collapse every failure into a generic message.
        sendJson({ type: "connectionFailed", code: failureCode, ...(failureDetail ? { detail: failureDetail } : {}) });
        if (ws.readyState === WebSocket.OPEN) ws.close(4003, failureCode);
        void this.teardown(entryId, "teamSpeak-connect-failed");
      };

      const scheduleReconnect = (normalized: ReturnType<typeof normalizeTeamSpeakError> | null) => {
        if (session.state === "disconnecting" || session.state === "idle" || session.state === "failed") return;
        if (!isRecoverable(normalized)) {
          failReconnect(normalized ?? normalizeTeamSpeakError(new Error("TeamSpeak connection failed")));
          return;
        }
        const now = Date.now();
        if (!reconnectStartedAt) reconnectStartedAt = now;
        reconnectAttempt += 1;
        if (!reconnectWindowOpen(reconnectStartedAt, now)) {
          failReconnect(normalized ?? normalizeTeamSpeakError(new Error("Reconnect window expired")));
          return;
        }
        if (session.state === "connected") session.transition("interrupted");
        if (session.state === "interrupted") session.transition("reconnecting");
        if (entry!.reconnectTimer) return;
        const delayMs = reconnectDelayMs(reconnectAttempt);
        sendJson({ type: "reconnecting", attempt: reconnectAttempt, delayMs });
        entry!.reconnectTimer = setTimeout(() => {
          entry!.reconnectTimer = null;
          if (session.state !== "reconnecting") return;
          try {
            session.transition("connecting");
            session.transition("authenticating");
          } catch {
            failReconnect(normalizeTeamSpeakError(new Error("Reconnect state initialization failed")));
            return;
          }
          void connectTeamSpeak(true);
        }, delayMs);
        entry!.reconnectTimer.unref?.();
      };

      const connectTeamSpeak = async (isReconnect: boolean): Promise<void> => {
        try {
          await tsClient.connect();
          if (session.state !== "authenticating") return;
          session.transition("syncing");
          tsReady = true;
          events.syncSelf();
          sendInitialState();
          void this.screenShares.discoverExistingStreams(entry!).catch((error: unknown) => {
            this.logger.debug({ entryId, err: error instanceof Error ? error.message : String(error) }, "Could not discover existing TeamSpeak screen streams");
          });
        } catch (error: unknown) {
          const normalized = normalizeTeamSpeakError(error);
          const failureCode = clientConnectionFailureCode(normalized, serverPassword);
          entry!.connectionFailureCode = failureCode;
          this.logger.warn({
            code: failureCode,
            normalizedCode: normalized.code,
            failureDetail: describeTeamSpeakError(normalized),
            ...(Object.keys(normalized.diagnostics).length ? { failureDiagnostics: normalized.diagnostics } : {}),
            entryId,
            reconnect: isReconnect,
            attempt: reconnectAttempt,
          }, "TS connect failed");
          if (!isReconnect) {
            failConnect(normalized);
            return;
          }
          if (isReconnect && isRecoverable(normalized)) {
            try {
              if (session.state !== "disconnecting" && session.state !== "idle") session.transition("reconnecting");
            } catch { /* teardown below remains authoritative */ }
            scheduleReconnect(normalized);
            return;
          }
          failReconnect(normalized);
        }
      };

      const events = new SessionEventCoordinator({
        state: entry, client: tsClient, nickname, requestedChannel: channelName,
        isCurrent: () => this.entries.get(entryId) === entry && session.state !== "disconnecting" && session.state !== "idle" && session.state !== "failed",
        acceptsDirectory: () => session.state === "authenticating" || session.state === "syncing" || session.state === "connected",
        isPublished: () => tsReady && initialStateSent,
        isConnected: () => tsReady && session.state === "connected",
        sendJson, addEvent: addServerEvent, onDirectoryReady: sendInitialState,
        onClientLeave: id => {
          this.screenShares.onClientLeave(entry!, id);
          entry!.webrtc?.removeClient(id);
        },
        onClientMove: (id, channelId) => {
          this.screenShares.onClientMove(entry!, id, channelId);
          if (id === entry!.tsClient.getClientId()) queueMicrotask(() => this.plugins.reconcile(entry!));
        },
        onNotification: notification => this.screenShares.handleNotification(entry!, notification),
        onVoice: data => entry!.audioTransport?.receiveTeamSpeak(data),
        onAvatarError: (clientId, uid, error) => this.logger.debug({
          entryId, clientId, uid, err: error instanceof Error ? error.message : String(error),
        }, "TeamSpeak client avatar unavailable"),
        onKick: kick => {
          // A transport drop may arrive first and already start recovery. A
          // subsequent kick is still terminal and must cancel that recovery.
          // A kick that lands before the session ever settled in (during the
          // first connect or a reconnect handshake) is terminal too: without
          // this the client would sit on the connecting screen while the
          // gateway kept the dead session alive.
          if (!hasConnectedOnce && !isSettling()) return;
          resetDirectoryForReconnect();
          const failureCode = clientConnectionFailureCode(kick, serverPassword);
          const failureDetail = publicFailureDetail(kick);
          entry!.connectionFailureCode = failureCode;
          this.logger.warn({ entryId, code: failureCode, normalizedCode: kick.code, failureDetail: describeTeamSpeakError(kick) }, "TeamSpeak session ended by kick/ban");
          sendJson({ type: "connectionFailed", code: failureCode, ...(failureDetail ? { detail: failureDetail } : {}) });
          void this.teardown(entryId, "teamSpeak-kicked");
        },
        onDisconnect: error => {
          const normalized = error ? normalizeTeamSpeakError(error) : null;
          if (isSettling()) {
            // `connected` was never published, so there is no live session to
            // interrupt -- but staying in `syncing` would leave the client on
            // the connecting screen with no recovery scheduled.
            if (!hasConnectedOnce) {
              this.logger.warn({
                entryId,
                normalizedCode: normalized?.code,
                ...(normalized ? { failureDetail: describeTeamSpeakError(normalized) } : {}),
              }, "TeamSpeak connection lost before the session became usable");
              failConnect(normalized ?? normalizeTeamSpeakError(new Error("TeamSpeak connection lost during startup")));
              return;
            }
            // A reconnect attempt dropped mid-handshake. Detach the dead
            // transport and fall back into the recovery loop rather than
            // stalling in `syncing`.
            resetDirectoryForReconnect();
            try {
              session.transition("reconnecting");
            } catch {
              failReconnect(normalized ?? normalizeTeamSpeakError(new Error("TeamSpeak connection lost during reconnect")));
              return;
            }
            scheduleReconnect(normalized);
            return;
          }
          if (session.state !== "connected") return;
          this.screenShares.removePeer(entryId);
          this.plugins.remove(entryId);
          resetDirectoryForReconnect();
          sendJson({ type: "disconnected", recoverable: isRecoverable(normalized) });
          scheduleReconnect(normalized);
        },
      });
      entry.events = events;

      ws.on("pong", () => {
        if (!entry) return;
        entry.isAlive = true;
        entry.lastPongAt = Date.now();
        entry.missedHeartbeats = 0;
      });
      ws.on("message", (data: Buffer | string, isBinary: boolean) => {
        if (this.entries.get(entryId) !== entry) return;
        if (isBinary) {
          entry!.audioTransport?.receivePcm(typeof data === "string" ? Buffer.from(data) : data);
          return;
        }

        const rawMessage = typeof data === "string" ? data : data.toString("utf-8");
        try {
          const value: unknown = JSON.parse(rawMessage);
          if (value && typeof value === "object" && "type" in value && value.type === "pluginRequest") {
            this.plugins.reconcile(entry!); this.plugins.handle(entry!, value); return;
          }
        } catch { /* Existing command parser owns malformed messages. */ }
        const webRtcMessage = parseWebRtcClientMessage(rawMessage);
        if (webRtcMessage?.type === "webrtcOffer") {
          if (this.getWebRtcOptions()?.enabled !== true) {
            sendProtocolError(sendJson, "WEBRTC_DISABLED", "WebRTC 音频传输未启用");
            return;
          }
          if (!tsReady || session.state !== "connected") {
            sendProtocolError(sendJson, "SESSION_NOT_READY", "TeamSpeak 会话尚未就绪");
            return;
          }
          const { sdp, muted, accompanimentActive } = webRtcMessage.payload;
          void this.handleWebRtcOffer(entry!, { ...sdp, muted, accompanimentActive }, sendJson);
          return;
        }
        if (webRtcMessage?.type === "webrtcStop") {
          void this.stopWebRtc(entry!);
          return;
        }
        const screenShareMessage = parseScreenShareMessage(rawMessage);
        if (screenShareMessage) {
          if ("error" in screenShareMessage) {
            sendProtocolError(sendJson, screenShareMessage.error.code, screenShareMessage.error.message);
            return;
          }
          if (!tsReady || session.state !== "connected") {
            sendProtocolError(sendJson, "SESSION_NOT_READY", "TeamSpeak 会话尚未就绪");
            return;
          }
          this.screenShares.handleMessage(entry!, screenShareMessage, sendJson);
          return;
        }
        const command = parseClientCommand(rawMessage);
        if ("error" in command) {
          sendProtocolError(sendJson, command.error.code, command.error.message);
          return;
        }
        if (!tsReady || session.state !== "connected") {
          sendProtocolError(sendJson, "SESSION_NOT_READY", "TeamSpeak 会话尚未就绪", command.requestId);
          return;
        }
        void handleCommand(entry!, command, sendJson);
      });

      ws.on("close", (code, reason) => {
        const closedAt = Date.now();
        this.logger.info({
          entryId,
          closeCode: code,
          closeReason: sanitizeWebSocketCloseReason(reason),
          abnormalClose: code === 1006,
          ...(entry ? {
            lastPongAt: new Date(entry.lastPongAt).toISOString(),
            lastPongAgeMs: Math.max(0, closedAt - entry.lastPongAt),
            missedHeartbeats: entry.missedHeartbeats,
          } : {}),
        }, "WebSocket closed");
        void this.teardown(entryId, "websocket-close");
      });

      ws.on("error", (error) => {
        this.logger.error({ err: error, entryId }, "WebSocket error");
        void this.teardown(entryId, "websocket-error");
      });

      try {
        session.transition("connecting");
        session.transition("authenticating");
      } catch (error: unknown) {
        this.logger.error({ err: error instanceof Error ? error.message : String(error), entryId }, "Session state initialization failed");
        void this.teardown(entryId, "protocol-error");
        return;
      }

      void connectTeamSpeak(false);
    });

    this.wss.on("error", (error) => {
      this.logger.error({ err: error }, "Voice WebSocket server error");
    });
    this.logger.info("Voice WebSocket endpoint ready at /ws/voice");
  }

  async shutdown(): Promise<void> {
    this.plugins.dispose();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.sessionManager.shutdown("gateway-shutdown");
    const wss = this.wss;
    this.wss = null;
    if (!wss) return;
    await new Promise<void>((resolve) => {
      try { wss.close(() => resolve()); } catch { resolve(); }
    });
  }

  getActiveCount(): number {
    return this.sessionManager.activeCount;
  }

  getPeakCount(): number {
    return this.sessionManager.peakCount;
  }

  getCreatedCount(): number {
    return this.sessionManager.createdCount;
  }

  getSessionSummaries(): AdminSessionSummary[] {
    const now = Date.now();
    return [...this.entries.values()]
      .sort((left, right) => left.session.createdAt - right.session.createdAt)
      .map((entry) => {
        let tsClientId: number | null = null;
        let channelId: string | null = null;
        try { tsClientId = entry.tsClient.getClientId() || null; } catch { /* still connecting */ }
        try {
          const id = entry.tsClient.getChannelId();
          channelId = id === 0n ? null : id.toString();
        } catch { /* still connecting */ }
        return {
          id: entry.id,
          nickname: entry.nickname,
          target: formatTeamSpeakTarget(entry.target),
          state: entry.session.state,
          createdAt: new Date(entry.session.createdAt).toISOString(),
          ageSeconds: Math.max(0, Math.floor((now - entry.session.createdAt) / 1000)),
          tsClientId,
          channelId,
          memberCount: entry.members.size,
          audio: snapshotAudioStats(entry),
        };
      });
  }

  async terminateSession(entryId: string): Promise<boolean> {
    if (!this.entries.has(entryId)) return false;
    await this.sessionManager.teardown(entryId, "admin-terminated");
    return true;
  }

  private async teardown(entryId: string, reason: SessionTeardownReason): Promise<void> {
    await this.sessionManager.teardown(entryId, reason);
  }

  private async cleanupEntry(entry: WebClientEntry, reason: SessionTeardownReason): Promise<void> {
    this.screenShares.removePeer(entry.id);
    this.plugins.remove(entry.id);
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    entry.events?.close();
    entry.events = null;
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    entry.audioTransport?.close();
    entry.audioTransport = null;
    await this.stopWebRtc(entry);
    entry.whisperTargetIds.clear();
    entry.whisperActive = false;
    entry.channelTree = [];
    entry.members.clear();
    try { await entry.tsClient.disconnect(); } catch { /* disconnect is intentionally idempotent */ }
    // Preserve WebSocketServer's close listener, which removes this socket
    // from its clients set and allows server shutdown to finish.
    entry.ws.removeAllListeners("message");
    entry.ws.removeAllListeners("pong");
    if (entry.ws.readyState === WebSocket.OPEN || entry.ws.readyState === WebSocket.CONNECTING) {
      if (reason === "heartbeat-timeout" || reason === "gateway-shutdown") entry.ws.terminate();
      else entry.ws.close(reason === "protocol-error" ? 1008 : 1000, reason);
    }
    if (entry.identityLeaseKey) this.identityLeases.release(entry.identityLeaseKey, entry.id);
    this.logger.info({
      entryId: entry.id,
      nickname: entry.nickname,
      clientIp: entry.clientIp,
      target: formatTeamSpeakTarget(entry.target),
      ...(entry.accelerationRelay ? { relayName: entry.accelerationRelay.name, relayTarget: entry.accelerationRelay.target } : {}),
      reason,
      lastPongAt: new Date(entry.lastPongAt).toISOString(),
      lastPongAgeMs: Math.max(0, Date.now() - entry.lastPongAt),
      missedHeartbeats: entry.missedHeartbeats,
      ...(entry.connectionFailureCode ? { failureCode: entry.connectionFailureCode } : {}),
      durationSeconds: Math.max(0, Math.floor((Date.now() - entry.session.createdAt) / 1000)),
      audio: { ...entry.audio },
    }, "Client session torn down");
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private checkHeartbeats(): void {
    for (const entry of this.entries.values()) {
      if (entry.ws.readyState !== WebSocket.OPEN) continue;
      if (!entry.isAlive) {
        entry.missedHeartbeats += 1;
        const lastPongAgeMs = Math.max(0, Date.now() - entry.lastPongAt);
        const timedOut = entry.missedHeartbeats >= MAX_MISSED_HEARTBEATS;
        this.logger.warn({
          entryId: entry.id,
          missedHeartbeats: entry.missedHeartbeats,
          maxMissedHeartbeats: MAX_MISSED_HEARTBEATS,
          lastPongAt: new Date(entry.lastPongAt).toISOString(),
          lastPongAgeMs,
        }, timedOut ? "WebSocket heartbeat timed out" : "WebSocket heartbeat missed; retrying");
        if (timedOut) {
          entry.ws.terminate();
          void this.teardown(entry.id, "heartbeat-timeout");
          continue;
        }
      }
      entry.isAlive = false;
      entry.ws.ping();
    }
  }

  private resolveConnection(url: URL): JoinTicketPayload | null {
    const token = url.searchParams.get("ticket");
    return token ? this.options.joinTickets.consume(token) : null;
  }

  private getWebRtcOptions(): WebRtcAudioOptions | undefined {
    const configured = this.options.webRtc;
    return typeof configured === "function" ? configured() : configured;
  }

  private getScreenShareIceServers(): ScreenShareIceServer[] {
    const configured = this.options.screenShareIceServers;
    const servers = typeof configured === "function" ? configured() : configured;
    return normalizeScreenShareIceServers(servers);
  }

  private getAccelerationOptions(relayId = ""): ConfiguredAccelerationRelay | undefined {
    const configured = this.options.acceleration;
    const relays = typeof configured === "function" ? configured() : configured;
    if (!relays?.length) return undefined;
    const selected = relayId ? relays.find((relay) => relay.id === relayId) : relays[0];
    if (!selected) return undefined;
    return selected;
  }

  private async stopWebRtc(entry: WebClientEntry): Promise<void> {
    const generation = ++entry.webrtcGeneration;
    const peer = entry.webrtc;
    entry.webrtc = null;
    // Enqueue the reset even while an offer is still preparing its first peer.
    // A later offer's input changes are then ordered after this restoration.
    const restoreInput = this.entries.get(entry.id) === entry && entry.tsClient.isConnected()
      ? entry.tsClient.setAccompanimentActive(false).catch(() => undefined)
      : Promise.resolve();
    if (!peer) { await restoreInput; return; }
    try { await peer.close(); } catch { /* peer teardown is idempotent */ }
    await restoreInput;
    if (entry.webrtcGeneration === generation) {
      try { Object.assign(entry.audio, peer.getStats()); } catch { /* diagnostics must not abort cleanup */ }
    }
  }

  private async handleWebRtcOffer(
    entry: WebClientEntry,
    offer: WebRtcSessionDescription,
    sendJson: (message: ServerMessage) => void,
  ): Promise<void> {
    const closing = this.stopWebRtc(entry);
    const generation = entry.webrtcGeneration;
    const isCurrent = (): boolean => entry.webrtcGeneration === generation
      && this.entries.get(entry.id) === entry && entry.session.state === "connected"
      && entry.ws.readyState === WebSocket.OPEN;
    await closing;
    if (!isCurrent()) return;
    const config = this.getWebRtcOptions();
    if (!config?.enabled) return;
    const muted = offer.muted === true;
    try {
      // The offer carries the browser's initial mute state. WebRTC can silence
      // the browser track locally, but TeamSpeak clients only see the state
      // after the gateway updates its own TS client as well.
      await entry.tsClient.setInputMuted(muted);
      if (isCurrent()) await entry.tsClient.setAccompanimentActive(offer.accompanimentActive === true);
    } catch (error: unknown) {
      if (isCurrent()) this.logger.warn({ entryId: entry.id, muted, err: error instanceof Error ? error.message : String(error) }, "Could not synchronize initial microphone mute state");
    }
    if (!isCurrent()) return;
    let peer: WebRtcAudioSession | null = null;
    const isCurrentPeer = (): boolean => isCurrent() && peer !== null && entry.webrtc === peer;
    try {
      const publicAddresses = await resolveVoiceMediaAddresses(config.publicHost || entry.webrtcPublicHost, config.ipv6Enabled === true);
      if (!isCurrent()) return;
      peer = this.createWebRtcSession({
        connectionId: entry.id,
        publicAddresses,
        ...(config.publicHost || entry.webrtcPublicHost ? { publicHost: config.publicHost || entry.webrtcPublicHost } : {}),
        ipv6Enabled: config.ipv6Enabled,
        stunServer: config.stunServer,
        udpPortRange: config.udpPortRange,
        logger: this.logger,
        microphoneMuted: muted,
        accompanimentActive: offer.accompanimentActive === true,
        onVoiceFrame: (data, codec) => {
          if (isCurrentPeer()) entry.audioTransport?.receiveWebRtc(data, codec);
        },
        onVoiceActivity: (clientIds) => {
          if (isCurrentPeer()) sendJson({ type: "voiceActivity", clientIds });
        },
      });
      entry.webrtc = peer;
      const answer = await peer.createAnswer({ type: offer.type, sdp: offer.sdp });
      if (!isCurrentPeer()) {
        try { await peer.close(); } catch { /* a replaced peer may already be closed */ }
        return;
      }
      sendJson({ type: "webrtcAnswer", payload: { sdp: answer } });
      this.logger.info({ entryId: entry.id }, "WebRTC audio negotiation completed");
    } catch (error: unknown) {
      if (entry.webrtc === peer) entry.webrtc = null;
      try { await peer?.close(); } catch { /* best effort */ }
      if (isCurrent()) {
        try { await entry.tsClient.setAccompanimentActive(false); } catch { /* best effort */ }
        if (!isCurrent()) return;
        this.logger.warn({ entryId: entry.id, err: error instanceof Error ? error.message : String(error) }, "WebRTC audio negotiation failed");
        sendJson({ type: "webrtcError", code: "WEBRTC_NEGOTIATION_FAILED" });
      }
    }
  }
}

export function resolveWebRtcPublicHost(request: IncomingMessage): string | undefined {
  const origin = firstHeader(request.headers.origin);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const directHost = firstHeader(request.headers.host);
  // The page can be hosted on the ingress gateway while its voice socket is
  // connected to a different relay node. ICE candidates must name the socket's
  // gateway, not the page's Origin.
  for (const candidate of [forwardedHost, directHost, origin]) {
    const host = normalizeWebRtcHost(candidate);
    if (host) return host;
  }
  return undefined;
}

// A reverse proxy on the same host reaches us over loopback, which is also what
// the published host-network container sees. Anything else has to be declared,
// because whoever we believe can choose the address we record.
const DEFAULT_TRUSTED_PROXIES = ["127.0.0.1", "::1"];

/** Build the matcher that decides whether forwarding headers may be believed. */
export function createTrustedProxies(entries: readonly string[] | undefined): BlockList {
  const list = new BlockList();
  const effective = entries?.length ? entries : DEFAULT_TRUSTED_PROXIES;
  for (const entry of effective) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("/");
    const address = normalizeClientIp(separator === -1 ? trimmed : trimmed.slice(0, separator));
    const family = address ? isIP(address) : 0;
    if (!address || (family !== 4 && family !== 6)) {
      throw new Error(`Invalid WEBSPEAK_TRUSTED_PROXIES entry: ${entry}`);
    }
    if (separator === -1) {
      list.addAddress(address, family === 4 ? "ipv4" : "ipv6");
      continue;
    }
    const prefixText = trimmed.slice(separator + 1);
    const prefix = Number(prefixText);
    if (!/^\d+$/.test(prefixText) || prefix > (family === 4 ? 32 : 128)) {
      throw new Error(`Invalid WEBSPEAK_TRUSTED_PROXIES prefix: ${entry}`);
    }
    list.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  return list;
}

function isTrustedProxy(address: string, trustedProxies: BlockList): boolean {
  const family = isIP(address);
  if (family !== 4 && family !== 6) return false;
  return trustedProxies.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Address to record for a connection. Each proxy appends the peer it accepted,
 * so the chain is read from the hop nearest to us towards the client, and the
 * first address we do not trust is the client. Forwarding headers received
 * directly from an untrusted peer are ignored entirely: that peer can write
 * anything, and whatever we return is shown as the source in the admin
 * connection log.
 */
export function resolveClientIp(request: IncomingMessage, trustedProxies: BlockList): string {
  const direct = normalizeClientIp(request.socket.remoteAddress);
  if (!direct || !isTrustedProxy(direct, trustedProxies)) return direct ?? "unknown";

  const forwarded = firstHeader(request.headers["x-forwarded-for"]);
  const hops: string[] = [];
  if (forwarded) {
    for (const candidate of forwarded.split(",")) {
      const hop = normalizeClientIp(candidate);
      if (hop) hops.push(hop);
    }
    hops.reverse();
  }
  for (const hop of hops) {
    if (!isTrustedProxy(hop, trustedProxies)) return hop;
  }
  if (!hops.length) {
    // A single-hop proxy may be configured to send only X-Real-IP.
    const realIp = normalizeClientIp(firstHeader(request.headers["x-real-ip"]));
    if (realIp && !isTrustedProxy(realIp, trustedProxies)) return realIp;
  }
  // Every address we can see belongs to a proxy we trust. Report the furthest
  // one instead of inventing a client address that was never forwarded.
  return hops.length ? hops[hops.length - 1]! : direct;
}

function normalizeClientIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) trimmed = trimmed.slice(1, -1);
  if (trimmed.toLowerCase().startsWith("::ffff:")) {
    const mapped = trimmed.slice("::ffff:".length);
    if (isIP(mapped) === 4) trimmed = mapped;
  }
  return isIP(trimmed) ? trimmed : undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeWebRtcHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.split(",", 1)[0]?.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return undefined;
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

function sendProtocolError(sendJson: (message: ServerMessage) => void, code: string, message: string, requestId?: string): void {
  sendJson({ type: "error", ...(requestId ? { requestId } : {}), error: { code, message, recoverable: false } });
}
