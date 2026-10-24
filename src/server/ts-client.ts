import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import {
  generateIdentitySync,
} from "@honeybbq/teamspeak/client";
import type {
  ClientInfo,
  DirectoryChannelInfo,
  DirectoryClientInfo,
  DirectorySnapshot,
  Identity,
  RawNotification,
  TextMessage,
  VoiceData,
} from "./teamspeak-sdk.js";
import {
  listChannelsCompat as tsListChannels,
  listClientsCompat as tsListClients,
  moveClientCompat as tsClientMove,
  pokeCompat as tsPoke,
  sendTextMessageCompat as tsSendTextMessage,
  TeamSpeakSdkClient,
} from "./teamspeak-sdk.js";
import type { Logger } from "../logger.js";
import { describeTeamSpeakError, normalizeTeamSpeakError, normalizeTeamSpeakKickedReason } from "../errors.js";
import { TeamSpeakAdapter, type TeamSpeakProtocol } from "./teamspeak-adapter.js";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { createAccelerationRelayClient, type AccelerationRelayClient, type AccelerationRelayOptions } from "./acceleration-relay.js";
import {
  applyChannelCapacityNotification,
  applyChannelPasswordProtectionNotification,
  type ChannelCapacity,
  type ChannelPasswordProtection,
} from "./channel-capacity.js";

export interface TSClientOptions {
  target: TeamSpeakTarget;
  nickname: string;
  serverPassword?: string;
  defaultChannel?: string;
  channelPassword?: string;
  identity?: Identity;
  acceleration?: AccelerationRelayOptions;
}

export interface TSVoiceData {
  clientId: number;
  codec: number; // 4 = voice, 5 = music
  data: Buffer;
}

export interface TSClientAvatar {
  /** TeamSpeak's avatar content marker, used to invalidate a cached avatar. */
  cacheKey: string;
  data: Buffer;
}

export interface TSClientServerInfo {
  name: string;
  iconId: number | null;
}

export interface TSClientServerPresentation {
  bannerUrl: string | null;
  welcomeMessage: string;
}

// Keep enough room for avatars produced by the native client. The previous
// 120 KiB limit rejected the 134 KiB PNG used by the Shanghai test account,
// so every avatar silently fell back to its initial letter.
const MAX_CLIENT_AVATAR_BYTES = 256 * 1024;
const MAX_SERVER_ICON_BYTES = 128 * 1024;
const MAX_SERVER_BANNER_URL_LENGTH = 2_048;
const MAX_SERVER_WELCOME_MESSAGE_LENGTH = 4_096;

export type TSDirectoryChannel = DirectoryChannelInfo & Partial<ChannelCapacity> & Partial<ChannelPasswordProtection>;
export type TSDirectorySnapshot = Omit<DirectorySnapshot, "channels"> & { channels: TSDirectoryChannel[] };
export type TSDirectoryClient = DirectoryClientInfo;
export type TSRawNotification = RawNotification;

export type TSChatScope = "channel" | "server" | "private";

export interface TSChatMessage {
  invokerName: string;
  invokerId: number;
  invokerUid: string;
  message: string;
  targetMode: number;
  targetId: bigint;
}

/**
 * Keep the TeamSpeak target id when adapting SDK events for the gateway.
 * Private-message events include a bigint targetID; dropping it makes the
 * bridge dereference undefined while echoing the message to the browser.
 */
export function toTSChatMessage(msg: TextMessage): TSChatMessage {
  return {
    invokerName: msg.invokerName,
    invokerId: msg.invokerID,
    invokerUid: msg.invokerUID,
    message: msg.message,
    targetMode: msg.targetMode,
    targetId: msg.targetID,
  };
}

export class TSClient extends EventEmitter {
  private client: TeamSpeakSdkClient | null = null;
  private adapter: TeamSpeakAdapter | null = null;
  private logger: Logger;
  private readonly identity: Identity;
  private clientId = 0;
  private connected = false;
  private connectionGeneration = 0;
  private inputState = { muted: false, accompaniment: false };
  private syncedInputMuted: boolean | null = null;
  private inputStateQueue: Promise<void> = Promise.resolve();
  private channelSwitchQueue: Promise<void> = Promise.resolve();
  private preferredChannelId = 0n;
  private accelerationClient: AccelerationRelayClient | null = null;
  private readonly channelCapacities = new Map<bigint, ChannelCapacity>();
  private readonly channelPasswordProtection = new Map<bigint, boolean>();
  // Reason id of the most recent self leave, kept so the SDK `kicked` event can
  // tell a plain kick (4) from a kick with ban (5). The SDK only forwards the
  // reason message to its `kicked` handler, not the reason id.
  private selfLeaveReasonId: number | null = null;

  constructor(private options: TSClientOptions, logger: Logger) {
    super();
    this.logger = logger.child({ nickname: options.nickname });
    this.identity = options.identity ?? generateIdentitySync(8);
  }

  /**
   * Discards an acceleration tunnel that closed itself (socket error, relay
   * OPEN_ERR/CLOSE, or open timeout) together with the adapter and SDK client
   * bound to its now-dead local port, so the next connect() builds all three
   * from scratch. A closed tunnel silently drops every frame, so reusing the
   * adapter would make reconnection fail forever without an error.
   */
  private dropStaleAccelerationTransport(): void {
    if (!this.accelerationClient?.isClosed()) return;
    const staleAdapter = this.adapter;
    // Detach before teardown: every SDK listener bails when it no longer owns
    // this.client, so a late "disconnected" from the stale transport cannot
    // re-enter connect() through the reconnect path.
    this.accelerationClient = null;
    this.adapter = null;
    this.client = null;
    try { void staleAdapter?.disconnect().catch(() => undefined); } catch { /* already gone */ }
  }

  async connect(): Promise<void> {
    this.connectionGeneration++;
    this.inputState = { muted: false, accompaniment: false };
    this.syncedInputMuted = null;
    this.inputStateQueue = Promise.resolve();
    this.selfLeaveReasonId = null;
    this.channelCapacities.clear();
    this.channelPasswordProtection.clear();
    // A relay tunnel that tore itself down (socket error, OPEN_ERR/CLOSE frame,
    // open timeout) reports nothing and no-ops every send, while adapter and
    // client still look reusable. Reconnecting through the dead local port would
    // silently fail forever, so drop the whole stack and let the block below
    // build a fresh tunnel plus adapter.
    this.dropStaleAccelerationTransport();
    if (!this.adapter || !this.client) {
      let transportTarget = this.options.target;
      if (this.options.acceleration && !this.accelerationClient) {
        this.accelerationClient = await createAccelerationRelayClient({
          ...this.options.acceleration,
          host: this.options.target.host,
          port: this.options.target.port,
        });
        transportTarget = { host: this.accelerationClient.localHost, port: this.accelerationClient.localPort };
      }
      this.adapter = new TeamSpeakAdapter({
        target: transportTarget,
        nickname: this.options.nickname,
        identity: this.identity,
        serverPassword: this.options.serverPassword,
        defaultChannel: this.options.defaultChannel,
        channelPassword: this.options.channelPassword,
      }, this.logger);
      this.client = this.adapter.client;
      this.attachClientListeners(this.client);
    }
    const adapter = this.adapter;
    const client = this.client;

    await adapter.connect();

    this.clientId = client.clientID();
    try {
      // A native TeamSpeak client subscribes to the complete channel tree
      // after the welcome sequence. Without this command the server only
      // exposes members in the current channel, so users disappear as soon as
      // they move elsewhere even though both clients are on the same server.
      await client.execCommand("channelsubscribeall", 5000);
    } catch (error: unknown) {
      this.logger.warn({
        err: error instanceof Error ? error.message : String(error),
      }, "Could not subscribe to all TeamSpeak channels");
    }
    // The upstream live view contains the welcome and subscription data,
    // including channel limits and member status. Reading it needs no list
    // permissions; a failure must fail initialization instead of parking the
    // browser in `syncing` forever.
    const [channels, clients] = await Promise.all([tsListChannels(client), tsListClients(client)]);
    this.emit("directorySnapshot", {
      channels: this.applyChannelMetadata(channels),
      clients,
      complete: true,
    } satisfies TSDirectorySnapshot);

    const connectedChannelId = client.channelID();
    if (this.preferredChannelId === 0n) {
      this.preferredChannelId = connectedChannelId;
    } else if (connectedChannelId !== this.preferredChannelId) {
      try {
        await tsClientMove(client, this.clientId, this.preferredChannelId);
      } catch (error: unknown) {
        // The old channel may have been deleted or become inaccessible. The
        // SDK has already left us in the server/default channel, which is the
        // safe fallback required by the reconnect contract.
        this.logger.info({
          channelId: this.preferredChannelId.toString(),
          err: error instanceof Error ? error.message : String(error),
        }, "Previous TeamSpeak channel could not be restored");
        this.preferredChannelId = client.channelID();
      }
    }
    this.connected = true;

    this.logger.info({ clientId: this.clientId }, "Connected to TeamSpeak");
    this.emit("connected", this.clientId);
  }

  /** Refresh optional member status fields omitted by some client-enter events. */
  async refreshDirectoryClients(): Promise<void> {
    const client = this.client;
    const generation = this.connectionGeneration;
    if (!client || !this.connected) return;
    try {
      const clients = await tsListClients(client);
      if (this.client === client && this.connected && this.connectionGeneration === generation) {
        this.emit("directoryClientsSnapshot", clients);
      }
    } catch (error: unknown) {
      if (this.client === client && this.connected && this.connectionGeneration === generation) {
        this.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Could not refresh TeamSpeak member statuses");
      }
    }
  }

  /**
   * Load a visible client's TeamSpeak avatar through the client protocol.
   *
   * The SDK's live view supplies the avatar marker and identity. Its public
   * avatar filename helper handles TS3/TS6 identities; the image is read
   * through the normal TeamSpeak file-transfer port.
   * A missing permission, missing avatar, blocked file-transfer port, or an
   * oversized image is intentionally reported as `null` so the web client can
   * keep its generated initial avatar.
   */
  async getClientAvatar(clientId: number, expectedUid = ""): Promise<TSClientAvatar | null> {
    const client = this.client;
    if (!client || !this.connected) throw new Error("TeamSpeak session is not ready");
    if (!Number.isInteger(clientId) || clientId <= 0 || clientId > 65535) throw new Error("Invalid TeamSpeak client id");
    const generation = this.connectionGeneration;
    const isCurrent = () => this.client === client && this.connected && this.connectionGeneration === generation;
    const info = await client.getClientAvatarMetadata(clientId);
    if (!isCurrent()) return null;
    if (!info || expectedUid && info.uid !== expectedUid) return null;
    const cacheKey = info.cacheKey;
    const transfer = await client.fileTransferInitDownload(0n, info.path, "");
    if (!isCurrent()) return null;
    const size = Number(transfer.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_CLIENT_AVATAR_BYTES) return null;

    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    await client.downloadFileData(this.options.target.host, transfer, destination);
    if (!isCurrent()) return null;
    const data = Buffer.concat(chunks);
    if (data.length === 0 || data.length > MAX_CLIENT_AVATAR_BYTES) return null;
    return { cacheKey, data };
  }

  /** Read the public virtual-server name and icon marker from the active session. */
  async getServerInfo(): Promise<TSClientServerInfo> {
    const client = this.client;
    if (!client || !this.connected) throw new Error("TeamSpeak session is not ready");
    const generation = this.connectionGeneration;
    if (this.client !== client || !this.connected || this.connectionGeneration !== generation) {
      throw new Error("TeamSpeak session changed while reading server information");
    }
    const info = client.serverInfo;
    return info ? { name: info.name, iconId: info.iconId } : { name: "", iconId: null };
  }

  /** Read only the public banner and welcome message from the active virtual server. */
  async getServerPresentation(): Promise<TSClientServerPresentation> {
    const client = this.client;
    if (!client || !this.connected) throw new Error("TeamSpeak session is not ready");
    const generation = this.connectionGeneration;
    const isCurrent = () => this.client === client && this.connected && this.connectionGeneration === generation;
    const empty: TSClientServerPresentation = { bannerUrl: null, welcomeMessage: "" };
    const info = client.serverInfo;
    if (!isCurrent() || !info) return empty;
    return {
      bannerUrl: normalizeTeamSpeakBannerUrl(info.hostBannerGfxUrl),
      welcomeMessage: normalizeTeamSpeakWelcomeMessage(info.welcomeMessage),
    };
  }

  /** Download the public virtual-server icon using TeamSpeak's normal file-transfer port. */
  async getServerIcon(iconId: number): Promise<Buffer | null> {
    const client = this.client;
    if (!client || !this.connected) throw new Error("TeamSpeak session is not ready");
    if (!Number.isSafeInteger(iconId) || iconId === 0) return null;
    const generation = this.connectionGeneration;
    const isCurrent = () => this.client === client && this.connected && this.connectionGeneration === generation;
    const transfer = await client.fileTransferInitDownload(0n, `/icon_${iconId}`, "");
    if (!isCurrent()) return null;
    const size = Number(transfer.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SERVER_ICON_BYTES) return null;

    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    await client.downloadFileData(this.options.target.host, transfer, destination);
    if (!isCurrent()) return null;
    const data = Buffer.concat(chunks);
    if (data.length === 0 || data.length > MAX_SERVER_ICON_BYTES) return null;
    return data;
  }

  private attachClientListeners(client: TeamSpeakSdkClient): void {
    client.on("voiceData", (data: VoiceData) => {
      if (this.client !== client) return;
      this.emit("voiceData", {
        clientId: data.clientId,
        codec: data.codec,
        data: Buffer.from(data.data),
      } as TSVoiceData);
    });

    // The SDK publishes its native live view after the welcome and whenever
    // the visible channels or members change.
    client.on("directorySnapshot", (snapshot) => {
      if (this.client !== client) return;
      this.emit("directorySnapshot", {
        complete: snapshot.complete,
        channels: this.applyChannelMetadata(snapshot.channels),
        clients: snapshot.clients.slice(),
      });
    });

    client.on("rawNotification", (notification: RawNotification) => {
      if (this.client !== client) return;
      applyChannelCapacityNotification(notification.name, notification.params, this.channelCapacities);
      const protectionChange = applyChannelPasswordProtectionNotification(
        notification.name,
        notification.params,
        this.channelPasswordProtection,
      );
      if (protectionChange) this.emit("channelPasswordProtectionChanged", protectionChange);
      this.emit("rawNotification", {
        name: notification.name,
        params: { ...notification.params },
      } satisfies TSRawNotification);
    });

    client.on("textMessage", (msg) => {
      if (this.client !== client) return;
      this.emit("textMessage", toTSChatMessage(msg));
    });

    client.on("poked", (event) => {
      if (this.client !== client) return;
      this.emit("poked", event);
    });

    client.on("disconnected", (err) => {
      if (this.client !== client) return;
      this.connectionGeneration++;
      if (err) {
        const normalized = normalizeTeamSpeakError(err);
        this.logger.warn({
          failureCode: normalized.code.toUpperCase(),
          failureDetail: describeTeamSpeakError(normalized),
        }, "TeamSpeak transport disconnected unexpectedly");
      } else {
        this.logger.info("TeamSpeak transport disconnected");
      }
      this.connected = false;
      this.clientId = 0;
      this.channelCapacities.clear();
      this.channelPasswordProtection.clear();
      this.emit("disconnected", err);
    });

    client.on("clientEnter", (info) => {
      if (this.client !== client) return;
      this.emit("clientEnter", info);
    });

    client.on("clientLeave", (info) => {
      if (this.client !== client) return;
      // 仅记录本客户端的踢出(4)/踢出并封禁(5)退出原因，供 kicked 事件区分普通踢出与封禁
      if (info.id === this.clientId && (info.reasonID === 4 || info.reasonID === 5)) this.selfLeaveReasonId = info.reasonID;
      this.emit("clientLeave", info);
    });

    // 转发 SDK 的 kicked 事件：不转发的话管理员填写的踢出原因会被丢弃，浏览器
    // 只能看到笼统的「连接失败」。这里把原因连同 reason id 一起归一化后向上抛。
    // The SDK emits `kicked` only for a self leave with reason 4 (kick) or 5
    // (kick with ban) and hands over the admin written reason message. Without
    // this listener the reason was dropped, so the browser degraded to a generic
    // "connection failed" right after the transport went away.
    client.on("kicked", (reasonMsg) => {
      if (this.client !== client) return;
      const reasonId = this.selfLeaveReasonId;
      this.selfLeaveReasonId = null;
      this.emit("kicked", normalizeTeamSpeakKickedReason(reasonMsg, reasonId));
    });

    client.on("clientMoved", (info) => {
      if (this.client !== client) return;
      if (info.id === this.clientId && info.targetChannelID !== 0n) this.preferredChannelId = info.targetChannelID;
      this.emit("clientMoved", info);
    });

    client.on("clientUpdated", (event) => {
      if (this.client !== client) return;
      this.emit("clientUpdated", event.info);
    });
  }

  sendVoice(data: Buffer, codec: number = 4): void {
    if (!this.client || !this.connected) return;
    this.client.sendVoice(data, codec);
  }

  sendWhisper(data: Buffer, clientIds: number[], codec: number = 4): void {
    if (!this.client || !this.connected) return;
    const targets = [...new Set(clientIds)].filter((clientId) => Number.isInteger(clientId) && clientId > 0 && clientId <= 65535 && clientId !== this.getClientId());
    if (!targets.length) throw new Error("Whisper requires at least one valid target");
    this.client.sendWhisper(data, targets, codec);
  }

  async sendTextMessage(scope: TSChatScope, message: string, targetId = 0n): Promise<void> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    const targetMode = scope === "private" ? 1 : scope === "server" ? 3 : 2;
    await tsSendTextMessage(this.client, targetMode, targetId, message);
  }

  async poke(clientId: number, message: string): Promise<void> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    await tsPoke(this.client, clientId, message);
  }

  async setAway(away: boolean, message = ""): Promise<void> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    const escaped = escapeTeamSpeakValue(message);
    await this.client.execCommand(`clientupdate client_away=${away ? 1 : 0} client_away_message=${escaped}`);
  }

  async setInputMuted(muted: boolean): Promise<void> {
    await this.updateInputState({ muted });
  }

  async setAccompanimentActive(accompaniment: boolean): Promise<void> {
    await this.updateInputState({ accompaniment });
  }

  private updateInputState(change: Partial<typeof this.inputState>): Promise<void> {
    const client = this.client;
    const generation = this.connectionGeneration;
    const isCurrent = () => client !== null && this.client === client && this.connected && this.connectionGeneration === generation;
    const update = this.inputStateQueue.then(async () => {
      if (!isCurrent()) throw new Error("TeamSpeak session is not ready");
      const next = { ...this.inputState, ...change };
      const muted = next.muted && !next.accompaniment;
      // TeamSpeak discards all audio from an input-muted client, including
      // music. The browser removes the microphone from its accompaniment mix.
      if (this.syncedInputMuted !== muted) {
        for (let attempt = 0; ; attempt++) {
          if (!isCurrent()) throw new Error("TeamSpeak session is not ready");
          try {
            await client!.execCommand(`clientupdate client_input_muted=${muted ? 1 : 0}`);
            break;
          } catch (error: unknown) {
            // A failed acknowledgement cannot justify skipping a later update.
            if (isCurrent()) this.syncedInputMuted = null;
            if (!isCurrent() || attempt >= 2 || normalizeTeamSpeakError(error).code !== "flooding") throw error;
            // In particular, stopping accompaniment must get a chance to
            // restore mute after the server's short flood-control window.
            await new Promise<void>(resolve => setTimeout(resolve, (attempt + 1) * 1000));
          }
        }
      }
      if (!isCurrent()) throw new Error("TeamSpeak session changed while updating input state");
      this.syncedInputMuted = muted;
      this.inputState = next;
    });
    this.inputStateQueue = update.catch(() => undefined);
    return update;
  }

  async switchChannel(channelId: bigint, password?: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error("TeamSpeak session is not ready");
    const clientId = this.clientId;
    const generation = this.connectionGeneration;
    const isCurrent = () => client !== null && this.client === client && this.connected && this.connectionGeneration === generation;
    const move = async () => {
      if (!isCurrent()) throw new Error("TeamSpeak session is not ready");
      await tsClientMove(client, clientId, channelId, password);
      if (!isCurrent()) throw new Error("TeamSpeak session changed while switching channels");
      this.preferredChannelId = channelId;
    };

    // Rapid clicks used to issue overlapping clientmove commands. The SDK and
    // TeamSpeak server both treat these as stateful session operations, so wait
    // for each acknowledgement before sending the next move.
    const operation = this.channelSwitchQueue.then(move, move);
    this.channelSwitchQueue = operation.catch(() => undefined);
    return operation;
  }

  /** Move another visible TeamSpeak client; the server enforces both move powers. */
  async moveClient(clientId: number, channelId: bigint, password?: string): Promise<void> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    if (!Number.isInteger(clientId) || clientId <= 0 || clientId > 65535) throw new Error("Invalid TeamSpeak client id");
    await tsClientMove(this.client, clientId, channelId, password);
  }

  getClientId(): number {
    // The SDK learns the real client id during the welcome sequence, before
    // TSClient.connect() resumes. Reading it from the SDK prevents the first
    // directory snapshot from being built without the web client itself.
    return this.client?.clientID() ?? this.clientId;
  }

  getProtocol(): TeamSpeakProtocol | null {
    return this.adapter?.protocol ?? null;
  }

  async execCommandWithResponse(command: string, timeoutMs = 3000): Promise<Record<string, string>[]> {
    if (!this.client || !this.connected) throw new Error("TeamSpeak session is not ready");
    return this.client.execCommandWithResponse(command, timeoutMs);
  }

  /**
   * Send a TeamSpeak protocol command whose response is delivered later as a
   * notification (for example setupstream/streamsignaling). The command is
   * assembled by the trusted server-side stream adapter, never by the browser.
   */
  async sendProtocolCommand(command: string): Promise<void> {
    const client = this.client;
    const generation = this.connectionGeneration;
    const isCurrent = () => client !== null && this.client === client && this.connected && this.connectionGeneration === generation;
    const cleanup = /^(?:stopstream|removeclientfromstream)(?:\s|$)/.test(command);
    for (let attempt = 0; ; attempt++) {
      if (!isCurrent()) throw new Error("TeamSpeak session is not ready");
      try {
        // Stream lifecycle callers need the server's acknowledgement, not
        // merely confirmation that the command was handed to the transport.
        await client!.execCommand(command);
        if (!isCurrent()) throw new Error("TeamSpeak session changed while sending stream command");
        return;
      } catch (error: unknown) {
        if (!cleanup || !isCurrent() || attempt >= 2 || normalizeTeamSpeakError(error).code !== "flooding") throw error;
        // Only retry an explicit refusal of cleanup. Never replay offers or
        // ICE candidates, and never carry an old cleanup into a new connection.
        await new Promise<void>(resolve => setTimeout(resolve, (attempt + 1) * 4000));
      }
    }
  }

  getIdentityString(): string {
    return this.identity.export();
  }

  getChannelId(): bigint {
    if (!this.client) return 0n;
    const sdkClient = this.client as unknown as { channelID?: () => bigint };
    return sdkClient.channelID?.() ?? 0n;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connectionGeneration++;
    this.connected = false;
    this.selfLeaveReasonId = null;
    try {
      if (this.adapter) await this.adapter.disconnect();
    } finally {
      this.accelerationClient?.close();
      this.accelerationClient = null;
      this.adapter = null;
      this.client = null;
      this.clientId = 0;
    }
  }

  private applyChannelMetadata(channels: readonly TSDirectoryChannel[]): TSDirectoryChannel[] {
    return channels.map((channel) => ({
      ...channel,
      ...this.channelCapacities.get(channel.id),
      ...(this.channelPasswordProtection.has(channel.id)
        ? { passwordProtected: this.channelPasswordProtection.get(channel.id)! }
        : {}),
    }));
  }
}

function normalizeTeamSpeakBannerUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_SERVER_BANNER_URL_LENGTH) return null;
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTeamSpeakWelcomeMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\0/g, "").replace(/\r\n?/g, "\n").slice(0, MAX_SERVER_WELCOME_MESSAGE_LENGTH).trim();
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
