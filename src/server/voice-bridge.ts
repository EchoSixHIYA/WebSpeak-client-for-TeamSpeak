import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { identityFromString } from "@echosixhiya/teamspeak-client";
import { DirectorySynchronizer } from "./directory-sync.js";
import { TSClient, type TSDirectorySnapshot, type TSVoiceData, type TSRawNotification } from "./ts-client.js";
import type { Logger as LoggerType } from "../logger.js";
import { clientConnectionFailureCode, describeTeamSpeakError, normalizeTeamSpeakError, teamSpeakServerErrorCode, type WebSpeakError } from "../errors.js";
import { formatTeamSpeakTarget, teamSpeakTargetKey, type TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { JoinTicketStore, type JoinTicketPayload } from "./join-ticket.js";
import { IdentityLeaseStore } from "./identity-lease.js";
import { SessionManager, type ManagedSession, type SessionTeardownReason } from "./session-manager.js";
import { parseClientCommand, type ClientCommand } from "./voice-protocol.js";
import { isRecoverable, reconnectDelayMs, reconnectWindowOpen } from "./reconnect-policy.js";
import { WebRtcAudioSession, type WebRtcAudioOptions, type WebRtcAudioStats, type WebRtcSessionDescription } from "./webrtc-audio.js";
import { pingTeamSpeakSession } from "./network-probe.js";
import type { AccelerationRelayOptions, ConfiguredAccelerationRelay } from "./acceleration-relay.js";
import { normalizeScreenShareIceServers, parseScreenShareMessage, type ScreenShareClientMessage, type ScreenShareIceServer, type ScreenSharePeerSignal, type ScreenShareStreamDescription, type ScreenShareViewerDescription } from "./screen-share.js";

const require = createRequire(import.meta.url);
const { OpusEncoder } = require("@discordjs/opus") as {
  OpusEncoder: new (sampleRate: number, channels: number) => { encode(pcm: Buffer): Buffer };
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const AUDIO_FRAME_BYTES = 1_920;
// A browser audio frame is 20 ms of mono 48 kHz PCM. Keep the server-side
// WebSocket egress queue small enough that a slow browser cannot turn old
// voice into seconds of latency. Opus frames are variable-sized, so this is
// deliberately a conservative byte backpressure guard for roughly 10–20
// small Opus frames; the browser also enforces a time-based playback limit
// before scheduling decoded audio.
const MAX_SERVER_AUDIO_BUFFERED_BYTES = 4_096;

function publicFailureDetail(error: ReturnType<typeof normalizeTeamSpeakError>): string | undefined {
  const serverMessage = error.diagnostics.serverMessage?.trim();
  const serverId = error.diagnostics.id?.trim();
  const detail = [serverMessage, serverId ? `server error id=${serverId}` : ""].filter(Boolean).join("; ");
  const safe = detail.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return safe || undefined;
}

export interface VoiceBridgeOptions {
  joinTickets: JoinTicketStore;
  webRtc?: WebRtcAudioOptions | (() => WebRtcAudioOptions);
  screenShareIceServers?: ScreenShareIceServer[] | (() => ScreenShareIceServer[]);
  acceleration?: ConfiguredAccelerationRelay[] | (() => ConfiguredAccelerationRelay[]);
  accelerationName?: string | (() => string | undefined);
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

export interface AudioFlowStats {
  ingressFrames: number;
  ingressDroppedFrames: number;
  ingressFirstAt: number | null;
  ingressLastAt: number | null;
  ingressMaxGapMs: number;
  tsSendFrames: number;
  tsSendErrors: number;
  tsSendFirstAt: number | null;
  tsSendLastAt: number | null;
  tsSendMaxGapMs: number;
  tsEncodeMaxMs: number;
  tsReceiveFrames: number;
  tsReceiveFirstAt: number | null;
  tsReceiveLastAt: number | null;
  tsReceiveMaxGapMs: number;
  egressFrames: number;
  egressDroppedFrames: number;
  egressFirstAt: number | null;
  egressLastAt: number | null;
  egressMaxGapMs: number;
  egressSentFirstAt: number | null;
  egressSentLastAt: number | null;
  egressSentMaxGapMs: number;
  egressPeakBufferedBytes: number;
  egressFramesByClient: Record<string, number>;
  webrtcIngressRtpFrames: number;
  webrtcIngressRtpFirstAt: number | null;
  webrtcIngressRtpLastAt: number | null;
  webrtcIngressRtpMaxGapMs: number;
  webrtcEgressRtpFrames: number;
  webrtcEgressRtpFirstAt: number | null;
  webrtcEgressRtpLastAt: number | null;
  webrtcEgressRtpMaxGapMs: number;
  webrtcQueuePeakFrames: number;
  webrtcQueueDroppedFrames: number;
  webrtcQueueUnderrunTicks: number;
  webrtcPacerLateTicks: number;
  webrtcQueueCurrentFrames: number;
  webrtcIngressQuietFrames: number;
  webrtcIngressDecodeErrors: number;
  webrtcDownlinkDecodedFrames: number;
  webrtcDownlinkDecodeErrors: number;
  webrtcDownlinkShortFrames: number;
}

interface ChannelMember {
  id: number;
  nickname: string;
  uid: string;
  avatar?: string;
  away?: boolean;
  awayMessage?: string;
  inputMuted?: boolean;
  outputMuted?: boolean;
  channelCommander?: boolean;
}

interface ServerEvent {
  id: string;
  kind: "joined" | "left" | "moved" | "poke" | "connection";
  message: string;
  timestamp: number;
}

interface WebClientEntry {
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
  channelTree: unknown[];
  members: Map<number, ChannelMember>;
  avatarCache: Map<string, string | null>;
  eventLog: ServerEvent[];
  opusEncoder: { encode(pcm: Buffer): Buffer } | null;
  opusEncoderWarnedAt: number; // Opus 编码器不可用告警的时间戳，用于限流避免反复刷屏
  whisperTargetIds: Set<number>;
  whisperActive: boolean;
  isAlive: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  audio: AudioFlowStats;
  webrtc: WebRtcAudioSession | null;
  lastLatencyProbeAt: number;
  connectionFailureCode?: string;
  screenPeerId: string;
}

interface ScreenStreamRecord extends ScreenShareStreamDescription {
  targetKey: string;
  channelId: bigint;
  ownerEntryId: string;
  viewerEntryIds: Set<string>;
  sourceClientId?: number;
  /** The gateway TS client that publishes a browser-owned stream to TS6. */
  teamSpeakPublisherEntryId?: string;
  /** The TS6 stream id paired with a browser-owned WebSpeak stream. */
  teamSpeakStreamId?: string;
  /** Native TS6 viewer client ids paired with a browser-owned stream. */
  nativeViewerClids: Set<number>;
}

// Stream ids are scoped to a TeamSpeak server. Keep the target in the key so
// two unrelated servers cannot overwrite each other's native stream record.
function screenStreamKey(targetKey: string, streamId: string): string {
  return `${targetKey}\u0000${streamId}`;
}

export class VoiceBridge {
  private readonly sessionManager = new SessionManager();
  private readonly entries = new Map<string, WebClientEntry>();
  private readonly screenStreams = new Map<string, ScreenStreamRecord>();
  private readonly screenStreamDiscoveryTargets = new Set<string>();
  private readonly identityLeases = new IdentityLeaseStore();
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private logger: LoggerType;

  constructor(
    private options: VoiceBridgeOptions,
    logger: LoggerType,
  ) {
    this.logger = logger.child({ component: "voice-bridge" });
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
      const clientIp = resolveClientIp(req);
      const webrtcPublicHost = resolveWebRtcPublicHost(req);
      let identity;
      try {
        identity = connection.identity ? identityFromString(connection.identity) : undefined;
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
        tsClient = new TSClient({ target, nickname, serverPassword, defaultChannel: channelName, identity, ...(acceleration ? { acceleration } : {}) }, this.logger);
      } catch (error: unknown) {
        if (identityLeaseKey) this.identityLeases.release(identityLeaseKey, entryId);
        this.logger.error({ err: error, entryId }, "Could not create TeamSpeak client");
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
        eventLog: [],
        opusEncoder: null,
        opusEncoderWarnedAt: 0,
        whisperTargetIds: new Set(),
        whisperActive: false,
        isAlive: true,
        reconnectTimer: null,
        audio: createAudioFlowStats(),
        webrtc: null,
        lastLatencyProbeAt: 0,
        screenPeerId: entryId,
      };
      this.entries.set(entryId, entry!);
      try {
        entry!.opusEncoder = new OpusEncoder(48000, 1);
      } catch (error: unknown) {
        this.logger.error({ err: error, entryId }, "Could not create Opus encoder");
        void this.teardown(entryId, "teamSpeak-connect-failed");
        return;
      }

      let tsReady = false;
      let selfId = 0;
      let selfChannelId = 0n;
      let initialStateSent = false;
      let audioReady = true;
      let realtimeReady = false;
      let hasConnectedOnce = false;
      // Set when the server kicks or bans this client. The kick and the transport
      // drop can arrive in either order, so the reason is parked here and consumed
      // by whichever handler runs second.
      let pendingKickReason: WebSpeakError | null = null;
      let reconnectStartedAt = 0;
      let reconnectAttempt = 0;
      const directory = new DirectorySynchronizer();
      const avatarRequests = new Set<string>();
      let avatarRefreshTimer: ReturnType<typeof setTimeout> | null = null;
      let avatarRefreshRunning = false;

      const sendJson = (message: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      };
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
      const refreshDirectory = () => {
        const snapshot = directory.getSnapshot();
        if (!snapshot) return;
        const previousWhisperTargets = [...entry!.whisperTargetIds].sort((a, b) => a - b);
        const effectiveSelfId = selfId || tsClient.getClientId();
        const sdkChannelId = tsClient.getChannelId();
        if (selfChannelId === 0n && sdkChannelId !== 0n) selfChannelId = sdkChannelId;
        const normalizedSnapshot = normalizeDirectorySnapshot(snapshot, effectiveSelfId, selfChannelId, nickname, channelName);
        entry!.channelTree = mapChannelTree(normalizedSnapshot, entry!.avatarCache);
        entry!.members.clear();
        for (const client of normalizedSnapshot.clients) {
          const avatar = client.uid ? entry!.avatarCache.get(client.uid) : undefined;
          entry!.members.set(client.id, {
            id: client.id,
            nickname: client.nickname,
            uid: client.uid,
            ...(avatar ? { avatar } : {}),
            away: client.away,
            awayMessage: client.awayMessage,
            inputMuted: client.inputMuted,
            outputMuted: client.outputMuted,
            channelCommander: client.channelCommander,
          });
        }
        for (const clientId of entry!.whisperTargetIds) {
          if (!entry!.members.has(clientId) || clientId === effectiveSelfId) entry!.whisperTargetIds.delete(clientId);
        }
        if (!entry!.whisperTargetIds.size) entry!.whisperActive = false;
        const nextWhisperTargets = [...entry!.whisperTargetIds].sort((a, b) => a - b);
        if (initialStateSent && (previousWhisperTargets.length !== nextWhisperTargets.length || previousWhisperTargets.some((clientId, index) => clientId !== nextWhisperTargets[index]))) {
          sendJson({ type: "whisperTargets", targetIds: nextWhisperTargets, active: entry!.whisperActive });
        }
      };
      const scheduleMemberAvatarRefresh = (delayMs = 0): void => {
        if (!entry || !entry.isAlive || avatarRefreshTimer) return;
        avatarRefreshTimer = setTimeout(() => {
          avatarRefreshTimer = null;
          void refreshMemberAvatars();
        }, delayMs);
        avatarRefreshTimer.unref?.();
      };
      const refreshMemberAvatars = async (): Promise<void> => {
        if (!entry || !entry.isAlive || !tsReady || session.state !== "connected" || avatarRefreshRunning) return;
        avatarRefreshRunning = true;
        try {
          const candidates = [...entry.members.values()]
            .filter((member) => member.uid && !entry!.avatarCache.has(member.uid) && !avatarRequests.has(member.uid))
            .slice(0, 50);
          for (const member of candidates) {
            if (!entry || !entry.isAlive || !member.uid) return;
            avatarRequests.add(member.uid);
            try {
              const loaded = await tsClient.getClientAvatar(member.id, member.uid);
              const avatar = loaded ? avatarDataUrl(loaded.data) : null;
              entry.avatarCache.set(member.uid, avatar);
              const current = entry.members.get(member.id);
              if (current && current.uid === member.uid && avatar) {
                current.avatar = avatar;
                sendJson({ type: "memberAvatar", id: member.id, uid: member.uid, avatar });
              }
            } catch (error: unknown) {
              // Avatar access is optional. A permission or file-transfer failure
              // must never affect joining, directory updates, or voice traffic.
              entry.avatarCache.set(member.uid, null);
              this.logger.debug({
                entryId,
                clientId: member.id,
                uid: member.uid,
                err: error instanceof Error ? error.message : String(error),
              }, "TeamSpeak client avatar unavailable");
            } finally {
              avatarRequests.delete(member.uid);
            }
          }
        } finally {
          avatarRefreshRunning = false;
          if (entry?.isAlive && tsReady && session.state === "connected" && [...entry.members.values()].some((member) => member.uid && !entry!.avatarCache.has(member.uid))) {
            scheduleMemberAvatarRefresh(250);
          }
        }
      };
      const trackChannelEvents = (previous: unknown[], next: unknown[]) => {
        if (!initialStateSent) return;
        const before = new Map(previous.filter(isChannelRecord).map((channel) => [channel.id, channel]));
        const after = new Map(next.filter(isChannelRecord).map((channel) => [channel.id, channel]));
        for (const channel of after.values()) {
          if (!before.has(channel.id)) addServerEvent("joined", `频道「${channel.name}」已创建`);
          else if (before.get(channel.id)?.name !== channel.name) addServerEvent("moved", `频道已重命名为「${channel.name}」`);
        }
        for (const channel of before.values()) if (!after.has(channel.id)) addServerEvent("left", `频道「${channel.name}」已删除`);
      };
      const sendInitialState = () => {
        if (initialStateSent || !tsReady || !directory.ready || !realtimeReady || !audioReady || session.state !== "syncing") return;
        initialStateSent = true;
        const wasReconnecting = hasConnectedOnce;
        hasConnectedOnce = true;
        // A previous kick reason never applies to a fresh, successful session.
        pendingKickReason = null;
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
          tsClientId: selfId,
          members: Array.from(entry!.members.values()),
          serverEventLog: entry!.eventLog,
          whisperTargetIds: [...entry!.whisperTargetIds],
          whisperActive: entry!.whisperActive,
          webrtcAvailable: this.getWebRtcOptions()?.enabled === true,
          screenShareIceServers: this.getScreenShareIceServers(),
          accelerated: Boolean(entry!.acceleration),
          ...(entry!.rememberIdentity ? { identity: tsClient.getIdentityString() } : {}),
        });
        sendJson({ type: "channelList", channels: entry!.channelTree });
        if (wasReconnecting) sendJson({ type: "reconnected" });
        scheduleMemberAvatarRefresh();
      };

      const resetDirectoryForReconnect = () => {
        tsReady = false;
        initialStateSent = false;
        selfId = 0;
        selfChannelId = 0n;
        directory.clear();
        entry!.channelTree = [];
        entry!.members.clear();
        entry!.whisperTargetIds.clear();
        entry!.whisperActive = false;
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
          selfId = tsClient.getClientId();
          const sdkChannelId = tsClient.getChannelId();
          if (sdkChannelId !== 0n) selfChannelId = sdkChannelId;
          refreshDirectory();
          if (selfId > 0 && !entry!.members.has(selfId)) {
            directory.applyClientEnter({ id: selfId, nickname, channelID: selfChannelId, uid: "", type: 1, serverGroups: [] });
            refreshDirectory();
          }
          sendInitialState();
          void this.discoverExistingTeamSpeakStreams(entry!);
        } catch (error: unknown) {
          const normalized = normalizeTeamSpeakError(error);
          const failureCode = clientConnectionFailureCode(normalized, serverPassword);
          const failureDetail = publicFailureDetail(normalized);
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
            try {
              if (session.state !== "disconnecting" && session.state !== "idle") session.transition("failed");
            } catch { /* teardown below remains authoritative */ }
            // Send the structured failure before closing. Some browsers and
            // reverse proxies do not preserve a WebSocket close reason, which
            // would otherwise collapse every failure into a generic message.
            sendJson({ type: "connectionFailed", code: failureCode, ...(failureDetail ? { detail: failureDetail } : {}) });
            if (ws.readyState === WebSocket.OPEN) ws.close(4003, failureCode);
            void this.teardown(entryId, "teamSpeak-connect-failed");
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

      // Register every directory listener before connect(). Events emitted by
      // the welcome flow are queued by DirectorySynchronizer until its
      // snapshot establishes the baseline.
      realtimeReady = true;
      tsClient.on("directorySnapshot", (snapshot: TSDirectorySnapshot) => {
        const previousChannels = entry!.channelTree;
        directory.applySnapshot(snapshot);
        refreshDirectory();
        trackChannelEvents(previousChannels, entry!.channelTree);
        sendInitialState();
        if (tsReady && initialStateSent) sendJson({ type: "channelList", channels: entry!.channelTree });
        scheduleMemberAvatarRefresh();
      });

      tsClient.on("clientEnter", (info) => {
        const candidateSelfId = tsClient.getClientId();
        if (candidateSelfId > 0 && info.id === candidateSelfId) {
          selfId = candidateSelfId;
          if (info.channelID !== undefined && info.channelID !== 0n) selfChannelId = info.channelID;
        }
        const wasKnown = entry!.members.has(info.id);
        directory.applyClientEnter(info);
        refreshDirectory();
        if (tsReady && initialStateSent) {
          sendJson({ type: "channelList", channels: entry!.channelTree });
          if (!wasKnown) sendJson({ type: "memberEnter", id: info.id, nickname: info.nickname, uid: info.uid, isSelf: info.id === selfId });
          if (!wasKnown && info.id !== selfId) addServerEvent("joined", `${info.nickname || "未知用户"} 加入了服务器`);
          scheduleMemberAvatarRefresh();
        }
      });

      tsClient.on("clientLeave", (info) => {
        this.reconcileNativeScreenShareAfterClientLeave(entry!, info.id);
        const wasKnown = entry!.members.has(info.id);
        const leavingMember = entry!.members.get(info.id);
        entry!.webrtc?.setMemberVolume(info.id, 1);
        directory.applyClientLeave(info.id);
        refreshDirectory();
        if (tsReady && initialStateSent && wasKnown) {
          sendJson({ type: "memberLeave", id: info.id });
          sendJson({ type: "channelList", channels: entry!.channelTree });
          if (info.id !== selfId) addServerEvent("left", `${leavingMember?.nickname || "用户"} 离开了服务器`);
        }
      });

      tsClient.on("clientMoved", (info) => {
        if (info.targetChannelID === undefined || info.targetChannelID === 0n) return;
        this.reconcileScreenShareAfterClientMove(entry!, info.id, info.targetChannelID);
        const movedMember = entry!.members.get(info.id);
        if (info.id === selfId) selfChannelId = info.targetChannelID;
        directory.applyClientMoved(info.id, info.targetChannelID);
        refreshDirectory();
        if (tsReady && initialStateSent) {
          sendJson({ type: "channelList", channels: entry!.channelTree });
          if (info.id !== selfId) addServerEvent("moved", `${movedMember?.nickname || "用户"} 移动到了其他频道`);
        }
      });

      tsClient.on("clientUpdated", (info) => {
        directory.applyClientUpdated(info);
        refreshDirectory();
        if (tsReady && initialStateSent) sendJson({ type: "channelList", channels: entry!.channelTree });
      });

      tsClient.on("rawNotification", (notification: TSRawNotification) => {
        this.handleRawScreenNotification(entry!, notification);
      });

      tsClient.on("voiceData", (data: TSVoiceData) => {
        const receivedAt = Date.now();
        if (entry!.audio.tsReceiveLastAt !== null) entry!.audio.tsReceiveMaxGapMs = Math.max(entry!.audio.tsReceiveMaxGapMs, receivedAt - entry!.audio.tsReceiveLastAt);
        entry!.audio.tsReceiveFirstAt ??= receivedAt;
        entry!.audio.tsReceiveLastAt = receivedAt;
        entry!.audio.tsReceiveFrames++;
        if (ws.readyState !== WebSocket.OPEN || data.clientId === selfId) return;
        const webRtc = entry!.webrtc;
        webRtc?.pushTeamSpeakVoice(data);
        const now = receivedAt;
        if (entry!.audio.egressLastAt !== null) entry!.audio.egressMaxGapMs = Math.max(entry!.audio.egressMaxGapMs, now - entry!.audio.egressLastAt);
        entry!.audio.egressFirstAt ??= now;
        entry!.audio.egressLastAt = now;
        const sourceKey = String(data.clientId);
        entry!.audio.egressFramesByClient[sourceKey] = (entry!.audio.egressFramesByClient[sourceKey] ?? 0) + 1;
        // A negotiated WebRTC session owns the browser's realtime audio
        // egress. Do not also send the same TeamSpeak packet over the
        // reliable WebSocket, otherwise the browser plays two copies and
        // the TCP path can still accumulate stale audio behind the peer.
        if (webRtc) {
          entry!.audio.egressFrames++;
          return;
        }
        const packet = Buffer.allocUnsafe(3 + data.data.length);
        packet[0] = data.codec;
        packet.writeUInt16BE(data.clientId, 1);
        data.data.copy(packet, 3);
        const bufferedBytes = ws.bufferedAmount;
        entry!.audio.egressPeakBufferedBytes = Math.max(entry!.audio.egressPeakBufferedBytes, bufferedBytes);
        if (bufferedBytes > MAX_SERVER_AUDIO_BUFFERED_BYTES) {
          entry!.audio.egressDroppedFrames++;
          return;
        }
        try {
          ws.send(packet);
          entry!.audio.egressFrames++;
          const sentAt = Date.now();
          if (entry!.audio.egressSentLastAt !== null) entry!.audio.egressSentMaxGapMs = Math.max(entry!.audio.egressSentMaxGapMs, sentAt - entry!.audio.egressSentLastAt);
          entry!.audio.egressSentFirstAt ??= sentAt;
          entry!.audio.egressSentLastAt = sentAt;
        } catch {
          entry!.audio.egressDroppedFrames++;
        }
      });

      tsClient.on("textMessage", (message) => {
        const scope = message.targetMode === 1 ? "private" : message.targetMode === 3 ? "server" : message.targetMode === 2 ? "channel" : "server";
        const targetId = message.targetId ?? 0n;
        // TeamSpeak channel notifications omit `target`; the SDK represents
        // that as 0. Bind the broadcast to this session's current channel so
        // it remains visible now but cannot leak into another channel after a
        // later channel switch.
        const effectiveTargetId = scope === "channel" && targetId === 0n ? tsClient.getChannelId() : targetId;
        sendJson({
          type: "chatMessage",
          scope,
          ...(effectiveTargetId !== 0n ? { targetId: String(effectiveTargetId) } : {}),
          senderUid: message.invokerUid,
          timestamp: Date.now(),
          invokerName: message.invokerName,
          invokerId: message.invokerId,
          message: message.message,
        });
      });

      tsClient.on("poked", (event) => {
        sendJson({ type: "pokeReceived", invokerId: event.invokerID, invokerUid: event.invokerUID, invokerName: event.invokerName, message: event.message, timestamp: Date.now() });
        addServerEvent("poke", `${event.invokerName || "用户"} 戳了你一下`);
      });

      // 被踢/封禁对本会话是终态：把服务器给出的原因回放给浏览器并拆除会话，
      // 而不是像以前那样因原因被丢弃而反复重连、再次撞上同一踢出。
      // A kick or ban is terminal for this session: replay the reason the server
      // sent instead of reconnecting, which is what used to happen once the reason
      // message was dropped (the browser kept retrying straight into the kick).
      tsClient.on("kicked", (kick: WebSpeakError) => {
        if (!hasConnectedOnce || session.state !== "connected") return;
        pendingKickReason = kick;
        resetDirectoryForReconnect();
        const failureCode = clientConnectionFailureCode(kick, serverPassword);
        const failureDetail = publicFailureDetail(kick);
        entry!.connectionFailureCode = failureCode;
        this.logger.warn({ entryId, code: failureCode, normalizedCode: kick.code, failureDetail: describeTeamSpeakError(kick) }, "TeamSpeak session ended by kick/ban");
        sendJson({ type: "connectionFailed", code: failureCode, ...(failureDetail ? { detail: failureDetail } : {}) });
        void this.teardown(entryId, "teamSpeak-kicked");
      });

      tsClient.on("disconnected", (error?: Error) => {
        if (!hasConnectedOnce || session.state !== "connected") return;
        resetDirectoryForReconnect();
        // Prefer a kick reason over the generic transport error that follows it,
        // regardless of which of the two events arrives first.
        const normalized = pendingKickReason ?? (error ? normalizeTeamSpeakError(error) : null);
        pendingKickReason = null;
        sendJson({ type: "disconnected", recoverable: isRecoverable(normalized) });
        scheduleReconnect(normalized);
      });

      ws.on("pong", () => { if (entry) entry.isAlive = true; });
      ws.on("message", (data: Buffer | string, isBinary: boolean) => {
        if (isBinary) {
          const frame = typeof data === "string" ? Buffer.from(data) : data;
          if (!tsReady || frame.length !== AUDIO_FRAME_BYTES) {
            entry!.audio.ingressDroppedFrames++;
            sendProtocolError(sendJson, "INVALID_AUDIO_FRAME", "音频帧格式无效");
            return;
          }
          const now = Date.now();
          if (entry!.audio.ingressLastAt !== null) entry!.audio.ingressMaxGapMs = Math.max(entry!.audio.ingressMaxGapMs, now - entry!.audio.ingressLastAt);
          entry!.audio.ingressFirstAt ??= now;
          entry!.audio.ingressLastAt = now;
          entry!.audio.ingressFrames++;
          const encodeStartedAt = Date.now();
          try {
            if (entry!.opusEncoder) {
              const encoded = entry!.opusEncoder.encode(frame);
              const encodedAt = Date.now();
              entry!.audio.tsEncodeMaxMs = Math.max(entry!.audio.tsEncodeMaxMs, encodedAt - encodeStartedAt);
              if (entry!.whisperActive && entry!.whisperTargetIds.size) tsClient.sendWhisper(encoded, [...entry!.whisperTargetIds], 4);
              else tsClient.sendVoice(encoded, 4);
              const sentAt = Date.now();
              if (entry!.audio.tsSendLastAt !== null) entry!.audio.tsSendMaxGapMs = Math.max(entry!.audio.tsSendMaxGapMs, sentAt - entry!.audio.tsSendLastAt);
              entry!.audio.tsSendFirstAt ??= sentAt;
              entry!.audio.tsSendLastAt = sentAt;
              entry!.audio.tsSendFrames++;
            } else {
              // Opus 编码器不可用（初始化失败或销毁后仍有帧在途）：显式告知浏览器
              // 而不是静默丢帧，5 秒限流避免高频告警刷屏。
              // The Opus encoder is unavailable (init failed or torn down while
              // frames are still in flight): say it instead of dropping silently.
              const warnedAt = entry!.opusEncoderWarnedAt;
              if (Date.now() - warnedAt > 5_000) {
                entry!.opusEncoderWarnedAt = Date.now();
                sendJson({ type: "audioError", code: "AUDIO_ENCODER_UNAVAILABLE", detail: "Opus encoder unavailable" });
              }
            }
          } catch {
            // A frame arriving during shutdown is safe to discard.
            entry!.audio.tsSendErrors++;
          }
          return;
        }

        const rawMessage = typeof data === "string" ? data : data.toString("utf-8");
        const webRtcOffer = parseWebRtcOffer(rawMessage);
        if (webRtcOffer) {
          if (this.getWebRtcOptions()?.enabled !== true) {
            sendProtocolError(sendJson, "WEBRTC_DISABLED", "WebRTC 音频传输未启用");
            return;
          }
          if (!tsReady || session.state !== "connected") {
            sendProtocolError(sendJson, "SESSION_NOT_READY", "TeamSpeak 会话尚未就绪");
            return;
          }
          void this.handleWebRtcOffer(entry!, webRtcOffer, sendJson);
          return;
        }
        if (isWebRtcStopMessage(rawMessage)) {
          const webRtc = entry!.webrtc;
          entry!.webrtc = null;
          if (webRtc) {
            void webRtc.close()
              .then(() => Object.assign(entry!.audio, webRtc.getStats()))
              .catch(() => undefined);
          }
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
          this.handleScreenShareMessage(entry!, screenShareMessage, sendJson);
          return;
        }
        const command = parseClientCommand(rawMessage);
        if ("error" in command) {
          sendProtocolError(sendJson, command.error.code, command.error.message);
          return;
        }
        if (!tsReady || session.state !== "connected") {
          sendProtocolError(sendJson, "SESSION_NOT_READY", "TeamSpeak 会话尚未就绪");
          return;
        }
        void handleCommand(entry!, command, sendJson);
      });

      ws.on("close", () => {
        this.logger.info({ entryId }, "WebSocket closed");
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
    this.removeScreenSharePeer(entry.id);
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    entry.opusEncoder = null;
    const webRtc = entry.webrtc;
    entry.webrtc = null;
    if (webRtc) {
      try { await webRtc.close(); } catch { /* peer teardown is idempotent */ }
      Object.assign(entry.audio, webRtc.getStats());
    }
    entry.whisperTargetIds.clear();
    entry.whisperActive = false;
    entry.channelTree = [];
    entry.members.clear();
    entry.tsClient.removeAllListeners();
    try { await entry.tsClient.disconnect(); } catch { /* disconnect is intentionally idempotent */ }
    entry.ws.removeAllListeners();
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
      ...(entry.connectionFailureCode ? { failureCode: entry.connectionFailureCode } : {}),
      durationSeconds: Math.max(0, Math.floor((Date.now() - entry.session.createdAt) / 1000)),
      audio: { ...entry.audio },
    }, "Client session torn down");
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      for (const entry of this.entries.values()) {
        if (entry.ws.readyState !== WebSocket.OPEN) continue;
        if (!entry.isAlive) {
          entry.ws.terminate();
          void this.teardown(entry.id, "heartbeat-timeout");
          continue;
        }
        entry.isAlive = false;
        entry.ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
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

  private handleScreenShareMessage(
    entry: WebClientEntry,
    message: ScreenShareClientMessage,
    sendJson: (message: Record<string, unknown>) => void,
  ): void {
    if (message.type === "screenShareList") {
      sendJson({ type: "screenShareList", streams: this.listScreenStreamsFor(entry) });
      return;
    }

    if (message.type === "screenShareStart") {
      if ([...this.screenStreams.values()].some((stream) => stream.source === "browser" && stream.ownerEntryId === entry.id)) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_ALREADY_ACTIVE", message: "你已经在共享屏幕" });
        return;
      }
      const stream: ScreenStreamRecord = {
        streamId: `screen-${randomUUID()}`,
        source: "browser",
        ownerPeerId: entry.screenPeerId,
        ownerNickname: entry.nickname,
        name: message.name?.trim() || `${entry.nickname} 的屏幕`,
        audio: message.audio === true,
        createdAt: Date.now(),
        viewerCount: 0,
        viewers: [],
        targetKey: teamSpeakTargetKey(entry.target),
        channelId: entry.tsClient.getChannelId(),
        ownerEntryId: entry.id,
        viewerEntryIds: new Set(),
        teamSpeakPublisherEntryId: entry.id,
        nativeViewerClids: new Set(),
      };
      this.screenStreams.set(screenStreamKey(stream.targetKey, stream.streamId), stream);
      sendJson({ type: "screenShareStarted", requestId: message.requestId, stream: this.describeScreenStream(stream), owner: true });
      this.broadcastScreenMessage(stream, {
        type: "screenShareStarted",
        stream: this.describeScreenStream(stream),
        owner: false,
      }, entry.id);
      void this.publishBrowserScreenStream(entry, stream);
      return;
    }

    const stream = this.screenStreams.get(screenStreamKey(teamSpeakTargetKey(entry.target), message.streamId));
    if (!stream) {
      sendJson({ type: "screenShareError", requestId: "requestId" in message ? message.requestId : undefined, code: "SCREEN_SHARE_NOT_FOUND", message: "屏幕共享已结束或不存在" });
      return;
    }
    if (stream.targetKey !== teamSpeakTargetKey(entry.target) || stream.channelId !== entry.tsClient.getChannelId()) {
      sendJson({ type: "screenShareError", requestId: "requestId" in message ? message.requestId : undefined, code: "SCREEN_SHARE_TARGET_MISMATCH", message: "屏幕共享不属于当前服务器或频道" });
      return;
    }

    if (message.type === "screenShareStop") {
      if (stream.ownerEntryId !== entry.id) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_NOT_OWNER", message: "只有共享者可以结束共享" });
        return;
      }
      this.stopScreenStream(stream, "owner-stopped");
      if (message.requestId) sendJson({ type: "screenShareCompleted", requestId: message.requestId });
      return;
    }

    if (message.type === "screenShareJoin") {
      if (stream.ownerEntryId === entry.id) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_OWNER_CANNOT_JOIN", message: "共享者不能作为观看者加入自己的共享" });
        return;
      }
      const alreadyJoined = stream.viewerEntryIds.has(entry.id);
      if (!alreadyJoined) stream.viewerEntryIds.add(entry.id);
      stream.viewerCount = this.screenShareViewerCount(stream);
      sendJson({
        type: "screenShareJoined",
        requestId: message.requestId,
        stream: this.describeScreenStream(stream),
        ownerPeerId: stream.ownerPeerId,
        mode: stream.source,
      });
      if (stream.source === "browser" && !alreadyJoined) {
        this.sendToEntry(stream.ownerEntryId, {
          type: "screenShareViewerJoined",
          streamId: stream.streamId,
          viewerPeerId: entry.screenPeerId,
          viewerNickname: entry.nickname,
        });
      } else if (stream.source === "teamspeak" && !alreadyJoined) {
        void this.joinNativeScreenStream(entry, stream, sendJson, message.requestId);
      }
      if (!alreadyJoined) {
        this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      }
      return;
    }

    if (message.type === "screenShareLeave") {
      this.leaveScreenStream(entry, stream);
      if (message.requestId) sendJson({ type: "screenShareCompleted", requestId: message.requestId });
      return;
    }

    if (message.type === "screenShareSignal") {
      this.relayScreenShareSignal(entry, stream, message.targetPeerId, message.signal, sendJson);
    }
  }

  private listScreenStreamsFor(entry: WebClientEntry): ScreenShareStreamDescription[] {
    const targetKey = teamSpeakTargetKey(entry.target);
    return [...this.screenStreams.values()]
      .filter((stream) => stream.targetKey === targetKey && stream.channelId === entry.tsClient.getChannelId())
      .map((stream) => this.describeScreenStream(stream));
  }

  /**
   * A gateway session can connect after a native TeamSpeak stream has already
   * started. TS6 does not replay that stream in the normal welcome snapshot;
   * requeststreaminfo is the official client-protocol query for this case.
   * Query each visible client once per TeamSpeak target, then let the normal
   * raw notification path announce the discovered stream to web viewers.
   */
  private async discoverExistingTeamSpeakStreams(entry: WebClientEntry): Promise<void> {
    const targetKey = teamSpeakTargetKey(entry.target);
    if (this.screenStreamDiscoveryTargets.has(targetKey)) return;
    this.screenStreamDiscoveryTargets.add(targetKey);
    const clientIds = [...entry.members.keys()].filter((clientId) => Number.isInteger(clientId) && clientId > 0);
    for (const clientId of clientIds) {
      if (!entry.tsClient.isConnected()) return;
      try {
        await entry.tsClient.sendProtocolCommand(`requeststreaminfo clid=${clientId}`);
      } catch (error: unknown) {
        this.logger.debug({
          target: formatTeamSpeakTarget(entry.target),
          clientId,
          err: error instanceof Error ? error.message : String(error),
        }, "Could not query existing TeamSpeak screen stream");
      }
    }
  }

  private describeScreenStream(stream: ScreenStreamRecord): ScreenShareStreamDescription {
    return {
      streamId: stream.streamId,
      source: stream.source,
      ownerPeerId: stream.ownerPeerId,
      ownerNickname: stream.ownerNickname,
      name: stream.name,
      audio: stream.audio,
      createdAt: stream.createdAt,
      viewerCount: stream.viewerCount,
      viewers: this.describeScreenViewers(stream),
    };
  }

  private describeScreenViewers(stream: ScreenStreamRecord): ScreenShareViewerDescription[] {
    return [...stream.viewerEntryIds]
      .map((entryId) => this.entries.get(entryId))
      .filter((entry): entry is WebClientEntry => Boolean(entry))
      .slice(0, 64)
      .map((entry) => {
        const avatar = entry.members.get(entry.tsClient.getClientId())?.avatar;
        return {
          peerId: entry.screenPeerId,
          nickname: entry.nickname,
          ...(avatar && avatar.length <= 128 * 1024 ? { avatar } : {}),
        };
      });
  }

  private screenShareViewerCountMessage(stream: ScreenStreamRecord): Record<string, unknown> {
    return {
      type: "screenShareViewerCount",
      streamId: stream.streamId,
      viewerCount: stream.viewerCount,
      viewers: this.describeScreenViewers(stream),
    };
  }

  private screenShareViewerCount(stream: ScreenStreamRecord): number {
    return stream.viewerEntryIds.size + stream.nativeViewerClids.size;
  }

  private broadcastScreenMessage(stream: ScreenStreamRecord, message: Record<string, unknown>, excludeEntryId?: string): void {
    for (const candidate of this.entries.values()) {
      if (candidate.id === excludeEntryId || candidate.target && teamSpeakTargetKey(candidate.target) !== stream.targetKey) continue;
      // A stream is scoped to the source channel. Do not leak its card or
      // viewer roster to users who are connected to another channel on the
      // same TeamSpeak target.
      if (candidate.id !== stream.ownerEntryId) {
        try {
          if (candidate.tsClient.getChannelId() !== stream.channelId) continue;
        } catch {
          continue;
        }
      }
      this.sendToEntry(candidate.id, message);
    }
  }

  private sendToEntry(entryId: string, message: Record<string, unknown>): void {
    const candidate = this.entries.get(entryId);
    if (candidate?.ws.readyState === WebSocket.OPEN) candidate.ws.send(JSON.stringify(message));
  }

  private stopScreenStream(stream: ScreenStreamRecord, reason: string): void {
    if (stream.source === "browser" && stream.teamSpeakStreamId && stream.teamSpeakPublisherEntryId) {
      const publisher = this.entries.get(stream.teamSpeakPublisherEntryId);
      if (publisher) {
        void publisher.tsClient.sendProtocolCommand(buildTeamSpeakCommand("stopstream", {
          id: stream.teamSpeakStreamId,
          reason: "1",
        })).catch(() => undefined);
      }
    }
    if (!this.screenStreams.delete(screenStreamKey(stream.targetKey, stream.streamId))) return;
    const message = { type: "screenShareStopped", streamId: stream.streamId, reason };
    this.broadcastScreenMessage(stream, message);
    stream.viewerEntryIds.clear();
    stream.nativeViewerClids.clear();
    stream.viewerCount = 0;
  }

  private leaveScreenStream(entry: WebClientEntry, stream: ScreenStreamRecord): void {
    if (!stream.viewerEntryIds.delete(entry.id)) return;
    stream.viewerCount = this.screenShareViewerCount(stream);
    if (stream.source === "browser") this.sendToEntry(stream.ownerEntryId, { type: "screenShareViewerLeft", streamId: stream.streamId, viewerPeerId: entry.screenPeerId });
    else {
      void entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("removeclientfromstream", {
        id: stream.streamId,
        clid: String(entry.tsClient.getClientId()),
      })).catch(() => undefined);
    }
    this.sendToEntry(entry.id, { type: "screenShareLeft", streamId: stream.streamId });
    this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
  }

  private relayScreenShareSignal(
    entry: WebClientEntry,
    stream: ScreenStreamRecord,
    targetPeerId: string,
    signal: ScreenSharePeerSignal,
    sendJson: (message: Record<string, unknown>) => void,
  ): void {
    if (stream.source === "teamspeak") {
      if (!stream.viewerEntryIds.has(entry.id) || targetPeerId !== stream.ownerPeerId) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FORBIDDEN", message: "无权发送该屏幕共享信令" });
        return;
      }
      const sourceClientId = stream.sourceClientId;
      if (!sourceClientId) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SOURCE_UNAVAILABLE", message: "共享来源暂不可用" });
        return;
      }
      if (signal.kind === "close") {
        this.leaveScreenStream(entry, stream);
        return;
      }
      if (signal.kind === "offer") {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_INVALID_SIGNAL", message: "观看端不能向 TeamSpeak 来源发送 offer" });
        return;
      }
      const payload = signal.kind === "iceCandidate"
        ? { cmd: "iceCandidate", args: { sdp: signal.candidate, ...(signal.sdpMid !== undefined ? { mid: signal.sdpMid } : {}), ...(signal.sdpMLineIndex !== undefined ? { mLine: signal.sdpMLineIndex } : {}) } }
        : { cmd: "answer", args: { answer: signal.sdp } };
      void entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("streamsignaling", {
        id: stream.streamId,
        clid: String(sourceClientId),
        json: JSON.stringify(payload),
      })).catch((error: unknown) => {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FAILED", message: error instanceof Error ? error.message : "屏幕共享信令发送失败" });
      });
      return;
    }

    if (stream.source === "browser" && entry.id === stream.ownerEntryId && targetPeerId.startsWith("ts-viewer-")) {
      const viewerClid = parseNativeViewerPeerId(targetPeerId);
      const publisher = stream.teamSpeakPublisherEntryId ? this.entries.get(stream.teamSpeakPublisherEntryId) : undefined;
      if (!viewerClid || !publisher || !stream.teamSpeakStreamId || !stream.nativeViewerClids.has(viewerClid)) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_PEER_NOT_FOUND", message: "TeamSpeak 观看者已离开" });
        return;
      }
      if (signal.kind === "close") {
        void publisher.tsClient.sendProtocolCommand(buildTeamSpeakCommand("removeclientfromstream", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
        })).catch(() => undefined);
        stream.nativeViewerClids.delete(viewerClid);
        stream.viewerCount = this.screenShareViewerCount(stream);
        this.sendToEntry(entry.id, { type: "screenShareViewerLeft", streamId: stream.streamId, viewerPeerId: targetPeerId });
        this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
        return;
      }
      if (signal.kind === "answer") {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_INVALID_SIGNAL", message: "TeamSpeak 观看端不能先发送 answer" });
        return;
      }
      let command: string;
      if (signal.kind === "offer") {
        command = buildTeamSpeakCommand("respondjoinstreamrequest", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
          msg: "",
          offer: signal.sdp,
          decision: "1",
        });
      } else if (signal.kind === "iceCandidate") {
        command = buildTeamSpeakCommand("streamsignaling", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
          json: JSON.stringify({ cmd: "iceCandidate", args: { sdp: signal.candidate, ...(signal.sdpMid !== undefined ? { mid: signal.sdpMid } : {}), ...(signal.sdpMLineIndex !== undefined ? { mLine: signal.sdpMLineIndex } : {}) } }),
        });
      } else {
        return;
      }
      void publisher.tsClient.sendProtocolCommand(command).catch((error: unknown) => {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FAILED", message: error instanceof Error ? error.message : "屏幕共享信令发送失败" });
      });
      return;
    }

    const owner = this.entries.get(stream.ownerEntryId);
    const isOwner = entry.id === stream.ownerEntryId;
    const isViewer = stream.viewerEntryIds.has(entry.id);
    if (!owner || (!isOwner && !isViewer)) {
      sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FORBIDDEN", message: "无权发送该屏幕共享信令" });
      return;
    }
    // Keep the browser P2P graph bipartite: the owner may signal only an
    // active viewer, and a viewer may signal only the owner. Without this
    // check one viewer could inject SDP/ICE into another viewer's peer.
    const targetEntry = isOwner
      ? [...stream.viewerEntryIds]
        .map((id) => this.entries.get(id))
        .find((candidate) => candidate?.screenPeerId === targetPeerId)
      : targetPeerId === owner.screenPeerId ? owner : undefined;
    if (!targetEntry || targetEntry.id === entry.id) {
      sendJson({ type: "screenShareError", code: "SCREEN_SHARE_PEER_NOT_FOUND", message: "观看者已离开" });
      return;
    }
    this.sendToEntry(targetEntry.id, { type: "screenShareSignal", streamId: stream.streamId, fromPeerId: entry.screenPeerId, signal });
  }

  private async publishBrowserScreenStream(entry: WebClientEntry, stream: ScreenStreamRecord): Promise<void> {
    try {
      await entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("setupstream", {
        name: stream.name,
        type: "3",
        bitrate: "4608",
        accessibility: "1",
        mode: "1",
        viewer_limit: "0",
        audio: stream.audio ? "1" : "0",
      }));
    } catch (error: unknown) {
      this.logger.warn({
        target: formatTeamSpeakTarget(entry.target),
        streamId: stream.streamId,
        err: error instanceof Error ? error.message : String(error),
      }, "Could not publish browser screen share to TeamSpeak");
    }
  }

  private async joinNativeScreenStream(
    entry: WebClientEntry,
    stream: ScreenStreamRecord,
    sendJson: (message: Record<string, unknown>) => void,
    requestId?: string,
  ): Promise<void> {
    const sourceClientId = stream.sourceClientId;
    if (!entry.tsClient.getClientId() || !sourceClientId) {
      sendJson({ type: "screenShareError", requestId, code: "SCREEN_SHARE_SOURCE_UNAVAILABLE", message: "共享来源暂不可用" });
      return;
    }
    try {
      await entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("joinstreamrequest", {
        id: stream.streamId,
        // TS6 uses the source client id on joinstreamrequest. The requesting
        // gateway session is identified later by the response/signaling
        // notification delivered to this TS connection.
        clid: String(sourceClientId),
        msg: "",
        is_remove: "0",
        muted: "0",
        volume: "0",
        hidden: "0",
      }));
    } catch (error: unknown) {
      this.leaveScreenStream(entry, stream);
      sendJson({ type: "screenShareError", requestId, code: "SCREEN_SHARE_JOIN_FAILED", message: error instanceof Error ? error.message : "无法加入屏幕共享" });
    }
  }

  private removeScreenSharePeer(entryId: string): void {
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.ownerEntryId === entryId) {
        this.stopScreenStream(stream, "owner-disconnected");
        continue;
      }
      const entry = this.entries.get(entryId);
      if (entry && stream.viewerEntryIds.has(entryId)) this.leaveScreenStream(entry, stream);
    }
  }

  private reconcileScreenShareAfterClientMove(entry: WebClientEntry, movedClientId: number, targetChannelId: bigint): void {
    const targetKey = teamSpeakTargetKey(entry.target);
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.targetKey !== targetKey) continue;
      // A browser share belongs to the gateway user's current channel. Stop
      // it when that user moves so existing viewers cannot keep a cross-
      // channel peer alive.
      if (stream.source === "browser" && stream.ownerEntryId === entry.id && stream.channelId !== targetChannelId) {
        this.stopScreenStream(stream, "owner-moved-channel");
        continue;
      }
      // Native TS6 shares are channel-scoped as well. The notification is
      // observed by every gateway session, so stop the shared record once the
      // native source changes channels.
      if (stream.source === "teamspeak" && stream.sourceClientId === movedClientId) {
        this.stopScreenStream(stream, "source-moved-channel");
        continue;
      }
      if (stream.viewerEntryIds.has(entry.id) && stream.channelId !== targetChannelId) {
        this.leaveScreenStream(entry, stream);
      }
    }
  }

  private reconcileNativeScreenShareAfterClientLeave(entry: WebClientEntry, clientId: number): void {
    const targetKey = teamSpeakTargetKey(entry.target);
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.targetKey === targetKey && stream.source === "teamspeak" && stream.sourceClientId === clientId) {
        this.stopScreenStream(stream, "source-left");
      }
    }
  }

  private handleRawScreenNotification(entry: WebClientEntry, notification: TSRawNotification): void {
    const params = notification.params;
    if (notification.name === "notifyjoinstreamrequest") {
      const streamId = params.id || params.stream_id;
      const viewerClientId = parseNumber(params.clid);
      if (!streamId || !viewerClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakPublisherEntryId === entry.id
        && candidate.teamSpeakStreamId === streamId);
      if (!stream) return;
      stream.nativeViewerClids.add(viewerClientId);
      stream.viewerCount = this.screenShareViewerCount(stream);
      this.sendToEntry(stream.ownerEntryId, {
        type: "screenShareNativeViewerJoined",
        streamId: stream.streamId,
        viewerPeerId: nativeViewerPeerId(viewerClientId),
        viewerClientId,
      });
      this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      return;
    }
    if (notification.name === "notifystreamstarted" || notification.name === "notifystreaminfo") {
      const streamId = params.id || params.stream_id;
      const sourceClientId = parseNumber(params.clid);
      if (!streamId || !sourceClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const publisherEntry = [...this.entries.values()].find((candidate) => candidate.target
        && teamSpeakTargetKey(candidate.target) === targetKey
        && candidate.tsClient.getClientId() === sourceClientId);
      const browserStream = publisherEntry
        ? [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
          && candidate.source === "browser"
          && candidate.teamSpeakPublisherEntryId === publisherEntry.id
          && !candidate.teamSpeakStreamId)
        : undefined;
      if (browserStream) {
        browserStream.teamSpeakStreamId = streamId;
        return;
      }
      const sourceEntry = [...this.entries.values()].find((candidate) => candidate.tsClient.getClientId() === sourceClientId);
      const key = screenStreamKey(targetKey, streamId);
      const current = this.screenStreams.get(key);
      const stream: ScreenStreamRecord = current ?? {
        streamId,
        source: "teamspeak",
        ownerPeerId: `ts-${sourceClientId}`,
        ownerNickname: params.name || `TeamSpeak 用户 ${sourceClientId}`,
        name: params.name || "TeamSpeak 屏幕共享",
        audio: params.audio === "1",
        createdAt: Date.now(),
        viewerCount: 0,
        viewers: [],
        targetKey,
        channelId: sourceEntry?.tsClient.getChannelId() ?? entry.tsClient.getChannelId(),
        ownerEntryId: "",
        viewerEntryIds: new Set(),
        nativeViewerClids: new Set(),
        sourceClientId,
      };
      stream.sourceClientId = sourceClientId;
      stream.ownerNickname = params.name || stream.ownerNickname;
      stream.name = params.name || stream.name;
      stream.audio = params.audio === "1";
      this.screenStreams.set(key, stream);
      // Every gateway session attached to the same TS target sees the same
      // raw notification. Only the first one should announce a new stream to
      // browsers; otherwise each connected user receives duplicate cards.
      if (!current) {
        this.broadcastScreenMessage(stream, { type: "screenShareStarted", stream: this.describeScreenStream(stream), owner: false });
      }
      return;
    }
    if (notification.name === "notifystreamstopped") {
      const streamId = params.id || params.stream_id;
      if (!streamId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = this.screenStreams.get(screenStreamKey(targetKey, streamId));
      if (stream) {
        this.stopScreenStream(stream, "source-stopped");
        return;
      }
      const browserStream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakStreamId === streamId);
      if (browserStream) {
        browserStream.teamSpeakStreamId = undefined;
        browserStream.nativeViewerClids.clear();
        browserStream.viewerCount = this.screenShareViewerCount(browserStream);
        this.sendToEntry(browserStream.ownerEntryId, {
          type: "screenShareError",
          code: "SCREEN_SHARE_NATIVE_PUBLISHER_STOPPED",
          message: "TeamSpeak 客户端屏幕共享通道已停止，网页共享仍可继续",
        });
        this.broadcastScreenMessage(browserStream, this.screenShareViewerCountMessage(browserStream));
      }
      return;
    }
    if (notification.name === "notifystreamclientleft") {
      const streamId = params.id || params.stream_id;
      const viewerClientId = parseNumber(params.clid);
      if (!streamId || !viewerClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakStreamId === streamId
        && candidate.nativeViewerClids.has(viewerClientId));
      if (!stream) return;
      stream.nativeViewerClids.delete(viewerClientId);
      stream.viewerCount = this.screenShareViewerCount(stream);
      this.sendToEntry(stream.ownerEntryId, {
        type: "screenShareViewerLeft",
        streamId: stream.streamId,
        viewerPeerId: nativeViewerPeerId(viewerClientId),
      });
      this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      return;
    }
    if (notification.name === "notifyrespondjoinstreamrequest" || notification.name === "notifystreamsignaling") {
      const streamId = params.id || params.stream_id;
      if (!streamId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const browserStream = notification.name === "notifystreamsignaling"
        ? [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
          && candidate.source === "browser"
          && candidate.teamSpeakPublisherEntryId === entry.id
          && candidate.teamSpeakStreamId === streamId)
        : undefined;
      if (browserStream) {
        const viewerClientId = parseNumber(params.clid);
        if (!viewerClientId || !browserStream.nativeViewerClids.has(viewerClientId)) return;
        const payload = parseStreamSignalPayload(params.json || params.data || "");
        if (!payload) return;
        const signal = toBrowserScreenSignal(payload);
        if (!signal) return;
        this.sendToEntry(browserStream.ownerEntryId, {
          type: "screenShareSignal",
          streamId: browserStream.streamId,
          fromPeerId: nativeViewerPeerId(viewerClientId),
          signal,
        });
        return;
      }
      const stream = this.screenStreams.get(screenStreamKey(targetKey, streamId));
      if (!stream || stream.source !== "teamspeak" || !stream.viewerEntryIds.has(entry.id)) return;
      const payload = notification.name === "notifyrespondjoinstreamrequest"
        ? { cmd: "offer", args: { offer: params.offer || "" } }
        : parseStreamSignalPayload(params.json || params.data || "");
      if (!payload) return;
      const signal = toBrowserScreenSignal(payload);
      if (!signal) return;
      this.sendToEntry(entry.id, { type: "screenShareSignal", streamId, fromPeerId: stream.ownerPeerId, signal });
    }
  }

  private async handleWebRtcOffer(
    entry: WebClientEntry,
    offer: WebRtcSessionDescription,
    sendJson: (message: Record<string, unknown>) => void,
  ): Promise<void> {
    if (entry.webrtc) {
      const previousWebRtc = entry.webrtc;
      try { await previousWebRtc.close(); } catch { /* replace a retried offer */ }
      Object.assign(entry.audio, previousWebRtc.getStats());
      entry.webrtc = null;
    }
    const config = this.getWebRtcOptions();
    if (!config?.enabled) return;
    const muted = offer.muted === true;
    try {
      // The offer carries the browser's initial mute state. WebRTC can silence
      // the browser track locally, but TeamSpeak clients only see the state
      // after the gateway updates its own TS client as well.
      await entry.tsClient.setInputMuted(muted);
    } catch (error: unknown) {
      this.logger.warn({ entryId: entry.id, muted, err: error instanceof Error ? error.message : String(error) }, "Could not synchronize initial microphone mute state");
    }
    const peer = new WebRtcAudioSession({
      connectionId: entry.id,
      ...(entry.webrtcPublicHost ? { publicHost: entry.webrtcPublicHost } : {}),
      udpPortRange: config.udpPortRange,
      logger: this.logger,
      microphoneMuted: muted,
      accompanimentActive: offer.accompanimentActive === true,
      onVoiceFrame: (data, codec) => {
        const now = Date.now();
        if (entry.audio.ingressLastAt !== null) entry.audio.ingressMaxGapMs = Math.max(entry.audio.ingressMaxGapMs, now - entry.audio.ingressLastAt);
        entry.audio.ingressFirstAt ??= now;
        entry.audio.ingressLastAt = now;
        entry.audio.ingressFrames++;
        try {
          if (entry.whisperActive && entry.whisperTargetIds.size) entry.tsClient.sendWhisper(data, [...entry.whisperTargetIds], codec);
          else entry.tsClient.sendVoice(data, codec);
          const sentAt = Date.now();
          if (entry.audio.tsSendLastAt !== null) entry.audio.tsSendMaxGapMs = Math.max(entry.audio.tsSendMaxGapMs, sentAt - entry.audio.tsSendLastAt);
          entry.audio.tsSendFirstAt ??= sentAt;
          entry.audio.tsSendLastAt = sentAt;
          entry.audio.tsSendFrames++;
        } catch {
          entry.audio.tsSendErrors++;
          // A packet arriving while the TeamSpeak session is being replaced
          // is discarded; the WebRTC peer remains independently closable.
        }
      },
      onVoiceActivity: (clientIds) => {
        if (entry.ws.readyState === WebSocket.OPEN) sendJson({ type: "voiceActivity", clientIds });
      },
    });
    entry.webrtc = peer;
    try {
      const answer = await peer.createAnswer({ type: offer.type, sdp: offer.sdp });
      if (entry.webrtc !== peer || entry.ws.readyState !== WebSocket.OPEN) return;
      sendJson({ type: "webrtcAnswer", payload: { sdp: answer } });
      this.logger.info({ entryId: entry.id }, "WebRTC audio negotiation completed");
    } catch (error: unknown) {
      if (entry.webrtc === peer) entry.webrtc = null;
      try { await peer.close(); } catch { /* best effort */ }
      this.logger.warn({ entryId: entry.id, err: error instanceof Error ? error.message : String(error) }, "WebRTC audio negotiation failed");
      if (entry.ws.readyState === WebSocket.OPEN) sendJson({ type: "webrtcError", code: "WEBRTC_NEGOTIATION_FAILED" });
    }
  }
}

function resolveWebRtcPublicHost(request: IncomingMessage): string | undefined {
  const origin = firstHeader(request.headers.origin);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const directHost = firstHeader(request.headers.host);
  for (const candidate of [origin, forwardedHost, directHost]) {
    const host = normalizeWebRtcHost(candidate);
    if (host) return host;
  }
  return undefined;
}

function resolveClientIp(request: IncomingMessage): string {
  const candidates = [
    firstHeader(request.headers["x-forwarded-for"])?.split(",", 1)[0],
    firstHeader(request.headers["x-real-ip"]),
    request.socket.remoteAddress,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeClientIp(candidate);
    if (normalized) return normalized;
  }
  return "unknown";
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

async function handleCommand(
  entry: WebClientEntry,
  command: ClientCommand,
  sendJson: (message: Record<string, unknown>) => void,
): Promise<void> {
  if (command.type === "latencyProbe") {
    const sequence = command.payload.sequence as string;
    const now = Date.now();
    if (now - entry.lastLatencyProbeAt < 150) return;
    entry.lastLatencyProbeAt = now;
    const result = await pingTeamSpeakSession(
      (request, timeoutMs) => entry.tsClient.execCommandWithResponse(request, timeoutMs),
    );
    sendJson({
      type: "latencyPong",
      sequence,
      teamSpeakLatencyMs: result.latencyMs,
      teamSpeakReachable: result.ok,
      teamSpeakErrorCode: result.errorCode ?? null,
    });
    return;
  }

  if (command.type === "switchChannel") {
    const rawId = command.payload.channelId as string;
    const channelPassword = typeof command.payload.password === "string" ? command.payload.password : "";
    try {
      await entry.tsClient.switchChannel(BigInt(rawId), channelPassword || undefined);
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      if (/already member/i.test(rawMessage)) {
        sendJson({ type: "channelSwitched", requestId: command.requestId, channelId: rawId });
        return;
      }
      const operation = classifyOperationError(error, "CHANNEL_SWITCH_FAILED", "频道切换失败");
      sendJson({ type: "error", requestId: command.requestId, error: { code: operation.code, message: operation.message, recoverable: false } });
      return;
    }
    sendJson({ type: "channelSwitched", requestId: command.requestId, channelId: rawId });
    sendJson({ type: "channelList", channels: entry.channelTree });
    return;
  }

  try {
    if (command.type === "moveClient") {
      const clientId = command.payload.clientId as number;
      const channelId = command.payload.channelId as string;
      if (clientId === entry.tsClient.getClientId()) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CANNOT_MOVE_SELF", message: "不能移动自己的客户端", recoverable: false } });
        return;
      }
      if (!entry.members.has(clientId)) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "成员已离线或当前不可见", recoverable: false } });
        return;
      }
      const targetExists = entry.channelTree.some((channel) => isRecord(channel) && channel.id === channelId);
      if (!targetExists) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CHANNEL_NOT_FOUND", message: "目标频道不可用", recoverable: false } });
        return;
      }
      // TeamSpeak evaluates i_client_move_power against the target's
      // i_client_needed_move_power inside clientmove. Do not duplicate that
      // policy in the gateway; forwarding the authoritative command keeps TS3
      // and TS6 permission behavior aligned.
      // Moving another visible client is an administrator operation. It must
      // not prompt for or depend on the target channel's join password.
      await entry.tsClient.moveClient(clientId, BigInt(channelId));
    } else if (command.type === "sendTextMessage") {
      const message = (command.payload.message as string).trim();
      if (message) await entry.tsClient.sendTextMessage("channel", message, entry.tsClient.getChannelId());
    } else if (command.type === "sendServerMessage") {
      const message = (command.payload.message as string).trim();
      if (message) await entry.tsClient.sendTextMessage("server", message);
    } else if (command.type === "sendPrivateMessage") {
      const clientId = command.payload.clientId as number;
      if (!entry.members.has(clientId)) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "成员已离线", recoverable: false } });
        return;
      }
      const message = (command.payload.message as string).trim();
      if (message) await entry.tsClient.sendTextMessage("private", message, BigInt(clientId));
    } else if (command.type === "poke") {
      const clientId = command.payload.clientId as number;
      if (!entry.members.has(clientId)) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "成员已离线", recoverable: false } });
        return;
      }
      await entry.tsClient.poke(clientId, (command.payload.message as string).trim());
    } else if (command.type === "setAway") {
      await entry.tsClient.setAway(command.payload.away as boolean, typeof command.payload.message === "string" ? command.payload.message.trim() : "");
    } else if (command.type === "setWhisperTargets") {
      const targetIds = command.payload.targetIds as number[];
      const selfId = entry.tsClient.getClientId();
      if (targetIds.some((clientId) => clientId === selfId || !entry.members.has(clientId))) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "私语目标已离线", recoverable: false } });
        return;
      }
      entry.whisperTargetIds = new Set(targetIds);
      if (!entry.whisperTargetIds.size) entry.whisperActive = false;
      sendJson({ type: "whisperTargets", targetIds: [...entry.whisperTargetIds], active: entry.whisperActive });
    } else if (command.type === "setWhisperActive") {
      const active = command.payload.active as boolean;
      if (active && !entry.whisperTargetIds.size) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "NO_WHISPER_TARGETS", message: "请先选择私语目标", recoverable: false } });
        return;
      }
      entry.whisperActive = active;
      sendJson({ type: "whisperTargets", targetIds: [...entry.whisperTargetIds], active: entry.whisperActive });
    } else if (command.type === "setMicrophoneMuted") {
      const muted = command.payload.muted as boolean;
      await entry.tsClient.setInputMuted(muted);
      entry.webrtc?.setMicrophoneMuted(muted);
    } else if (command.type === "setAccompanimentActive") {
      entry.webrtc?.setAccompanimentActive(command.payload.active as boolean);
    } else if (command.type === "setMemberVolume") {
      const clientId = command.payload.clientId as number;
      entry.webrtc?.setMemberVolume(clientId, command.payload.volume as number);
    }
    if (command.requestId) sendJson({ type: "commandCompleted", requestId: command.requestId });
  } catch (error: unknown) {
    const operation = classifyOperationError(error, "OPERATION_FAILED", "操作失败");
    sendJson({ type: "error", requestId: command.requestId, error: { code: operation.code, message: operation.message, recoverable: false } });
  }
}

function classifyOperationError(error: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.toLocaleLowerCase();
  // A TeamSpeak server error id is authoritative when the SDK preserved it, so it
  // is consulted before the keyword rules: 781 (channel password), 2568
  // (permissions), 515/2817 (server or slot limit) and friends keep their exact
  // meaning instead of being guessed from prose.
  const serverCode =
    teamSpeakServerErrorCode(isRecord(error) ? (error.id ?? error.code) : undefined) ??
    teamSpeakServerErrorCode(/\bid[\s=:]*(\d{3,5})\b/.exec(normalized)?.[1]);
  if (serverCode) {
    if (serverCode === "identity_security_level_too_low") return { code: "PERMISSION_DENIED", message: "你没有执行此操作的权限" };
    if (serverCode === "channel_password_required") return { code: "CHANNEL_PASSWORD_REQUIRED", message: "该频道需要密码" };
    if (serverCode === "server_full") return { code: "CHANNEL_FULL", message: "该频道已满" };
    if (serverCode === "client_version_outdated") return { code: "CLIENT_VERSION_OUTDATED", message: "客户端版本过旧，服务器拒绝了该操作" };
    if (serverCode === "flooding") return { code: "FLOOD_PROTECTION", message: "操作过于频繁，请稍后重试" };
    if (serverCode === "banned") return { code: "BANNED", message: "你已被该服务器封禁" };
    if (serverCode === "connection_initialisation_failed") return { code: "CONNECTION_INITIALISATION_FAILED", message: "TeamSpeak 服务器未能完成连接初始化，请稍后重试" };
  }
  if (/permission|not permitted|insufficient|i_permission|2568/.test(normalized)) return { code: "PERMISSION_DENIED", message: "你没有执行此操作的权限" };
  if (/channel.*(password|password.*required)|invalid.*(channel|password)|i_channel_password|781/.test(normalized)) return { code: "CHANNEL_PASSWORD_REQUIRED", message: "该频道需要密码" };
  if (/already member/.test(normalized)) return { code: "ALREADY_IN_CHANNEL", message: "你已经在该频道中" };
  if (/full|maximum.*clients/.test(normalized)) return { code: "CHANNEL_FULL", message: "该频道已满" };
  if (/not found|unknown client|invalid client/.test(normalized)) return { code: "CLIENT_NOT_FOUND", message: "成员已离线" };
  return { code: fallbackCode, message: fallbackMessage };
}

function sendProtocolError(sendJson: (message: Record<string, unknown>) => void, code: string, message: string): void {
  sendJson({ type: "error", error: { code, message, recoverable: false } });
}

function parseWebRtcOffer(raw: string): WebRtcSessionDescription | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!isRecord(value) || value.type !== "webrtcOffer" || !isRecord(value.payload) || !isRecord(value.payload.sdp)) return null;
  const description = value.payload.sdp;
  if (description.type !== "offer" || typeof description.sdp !== "string" || description.sdp.length > 256 * 1024) return null;
  if (value.payload.muted !== undefined && typeof value.payload.muted !== "boolean") return null;
  if (value.payload.accompanimentActive !== undefined && typeof value.payload.accompanimentActive !== "boolean") return null;
  return {
    type: "offer",
    sdp: description.sdp,
    muted: value.payload.muted === true,
    accompanimentActive: value.payload.accompanimentActive === true,
  };
}

function isWebRtcStopMessage(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && value.type === "webrtcStop";
  } catch {
    return false;
  }
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nativeViewerPeerId(clientId: number): string {
  return `ts-viewer-${clientId}`;
}

function parseNativeViewerPeerId(peerId: string): number | undefined {
  const match = /^ts-viewer-(\d+)$/.exec(peerId);
  if (!match) return undefined;
  return parseNumber(match[1]);
}

function buildTeamSpeakCommand(command: string, params: Record<string, string>): string {
  return [command, ...Object.entries(params).map(([key, value]) => `${key}=${escapeTeamSpeakValue(value)}`)].join(" ");
}

function parseStreamSignalPayload(raw: string): { cmd: string; args: Record<string, unknown> } | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.cmd !== "string" || !isRecord(value.args)) return null;
    return { cmd: value.cmd, args: value.args };
  } catch {
    return null;
  }
}

function toBrowserScreenSignal(payload: { cmd: string; args: Record<string, unknown> }): ScreenSharePeerSignal | null {
  const args = payload.args;
  // TeamSpeak's native screen-share source wraps the initial SDP in a
  // `joinResponse` message after it accepts a viewer's join request. The
  // browser-side protocol uses the regular offer shape, so normalize it here
  // before forwarding it. Without this mapping the native source can accept a
  // viewer while the browser waits forever for its first SDP.
  if (payload.cmd === "joinResponse") {
    const decision = args.decision;
    if (decision === false || decision === 0 || decision === "0") return { kind: "close" };
    const sdp = typeof args.offer === "string" ? args.offer : typeof args.sdp === "string" ? args.sdp : "";
    return sdp ? { kind: "offer", sdp } : null;
  }
  if (payload.cmd === "offer" || payload.cmd === "reconnectOffer") {
    const sdp = typeof args.offer === "string" ? args.offer : typeof args.sdp === "string" ? args.sdp : "";
    return sdp ? { kind: "offer", sdp } : null;
  }
  if (payload.cmd === "answer") {
    const sdp = typeof args.answer === "string" ? args.answer : typeof args.sdp === "string" ? args.sdp : "";
    return sdp ? { kind: "answer", sdp } : null;
  }
  if (payload.cmd === "iceCandidate") {
    const candidate = typeof args.sdp === "string" ? args.sdp : typeof args.candidate === "string" ? args.candidate : "";
    if (!candidate) return null;
    return {
      kind: "iceCandidate",
      candidate,
      ...(typeof args.mid === "string" ? { sdpMid: args.mid } : {}),
      ...(typeof args.mLine === "number" ? { sdpMLineIndex: args.mLine } : {}),
    };
  }
  return null;
}

function escapeTeamSpeakValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "\\s")
    .replace(/\//g, "\\/")
    .replace(/\|/g, "\\p")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isChannelRecord(value: unknown): value is { id: string; name: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" && typeof (value as { name?: unknown }).name === "string";
}

function createAudioFlowStats(): AudioFlowStats {
  return {
    ingressFrames: 0,
    ingressDroppedFrames: 0,
    ingressFirstAt: null,
    ingressLastAt: null,
    ingressMaxGapMs: 0,
    tsSendFrames: 0,
    tsSendErrors: 0,
    tsSendFirstAt: null,
    tsSendLastAt: null,
    tsSendMaxGapMs: 0,
    tsEncodeMaxMs: 0,
    tsReceiveFrames: 0,
    tsReceiveFirstAt: null,
    tsReceiveLastAt: null,
    tsReceiveMaxGapMs: 0,
    egressFrames: 0,
    egressDroppedFrames: 0,
    egressFirstAt: null,
    egressLastAt: null,
    egressMaxGapMs: 0,
    egressSentFirstAt: null,
    egressSentLastAt: null,
    egressSentMaxGapMs: 0,
    egressPeakBufferedBytes: 0,
    egressFramesByClient: {},
    webrtcIngressRtpFrames: 0,
    webrtcIngressRtpFirstAt: null,
    webrtcIngressRtpLastAt: null,
    webrtcIngressRtpMaxGapMs: 0,
    webrtcEgressRtpFrames: 0,
    webrtcEgressRtpFirstAt: null,
    webrtcEgressRtpLastAt: null,
    webrtcEgressRtpMaxGapMs: 0,
    webrtcQueuePeakFrames: 0,
    webrtcQueueDroppedFrames: 0,
    webrtcQueueUnderrunTicks: 0,
    webrtcPacerLateTicks: 0,
    webrtcQueueCurrentFrames: 0,
    webrtcIngressQuietFrames: 0,
    webrtcIngressDecodeErrors: 0,
    webrtcDownlinkDecodedFrames: 0,
    webrtcDownlinkDecodeErrors: 0,
    webrtcDownlinkShortFrames: 0,
  };
}

function snapshotAudioStats(entry: WebClientEntry): AudioFlowStats {
  const stats = { ...entry.audio };
  const webRtcStats: WebRtcAudioStats | undefined = entry.webrtc?.getStats();
  if (webRtcStats) Object.assign(stats, webRtcStats);
  return stats;
}

function mapChannelTree(snapshot: TSDirectorySnapshot, avatarCache = new Map<string, string | null>()): unknown[] {
  return snapshot.channels.map((channel) => ({
    id: String(channel.id),
    parentID: String(channel.parentID),
    order: String(channel.order),
    name: channel.name || "未命名频道",
    description: channel.description || "",
    members: snapshot.clients
      .filter((client) => client.channelID === channel.id)
      .map((client) => {
        const avatar = client.uid ? avatarCache.get(client.uid) : undefined;
        return {
          id: client.id,
          nickname: client.nickname || "未知用户",
          uid: client.uid,
          ...(avatar ? { avatar } : {}),
          away: client.away,
          awayMessage: client.awayMessage,
          inputMuted: client.inputMuted,
          outputMuted: client.outputMuted,
          channelCommander: client.channelCommander,
        };
      }),
  }));
}

function avatarDataUrl(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return `data:image/png;base64,${data.toString("base64")}`;
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return `data:image/jpeg;base64,${data.toString("base64")}`;
  if (data.length >= 6 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a")) return `data:image/gif;base64,${data.toString("base64")}`;
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return `data:image/webp;base64,${data.toString("base64")}`;
  return null;
}

function normalizeDirectorySnapshot(
  snapshot: TSDirectorySnapshot,
  selfId: number,
  selfChannelId: bigint,
  nickname: string,
  requestedChannelName?: string,
): TSDirectorySnapshot {
  if (selfId <= 0) return snapshot;

  const clients = snapshot.clients.slice();
  const selfIndex = clients.findIndex((client) => client.id === selfId);
  const snapshotChannelId = selfIndex >= 0 ? clients[selfIndex]!.channelID : 0n;
  const requestedName = requestedChannelName?.trim().toLocaleLowerCase();
  const requestedChannel = requestedName
    ? snapshot.channels.find((channel) => channel.name.trim().toLocaleLowerCase() === requestedName)
    : undefined;
  const resolvedChannelId = selfChannelId !== 0n
    ? selfChannelId
    : snapshotChannelId !== 0n
      ? snapshotChannelId
      : requestedChannel?.id ?? snapshot.channels[0]?.id ?? 0n;
  if (selfIndex >= 0) {
    const current = clients[selfIndex]!;
    if (resolvedChannelId !== 0n) clients[selfIndex] = { ...current, channelID: resolvedChannelId };
  } else if (resolvedChannelId !== 0n) {
    clients.push({ id: selfId, nickname, uid: "", channelID: resolvedChannelId, type: 1, serverGroups: [] });
  }

  return { ...snapshot, clients };
}
