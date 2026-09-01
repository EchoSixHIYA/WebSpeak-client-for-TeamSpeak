import { EventEmitter } from "node:events";
import {
  Client as TS3FullClient,
  clientMove as tsClientMove,
  generateIdentity,
  type Identity,
  type VoiceData,
  type ChannelInfo,
  type ClientInfo,
} from "@honeybbq/teamspeak-client";
import type { Logger } from "../logger.js";
import { TeamSpeakAdapter, type TeamSpeakProtocol } from "./teamspeak-adapter.js";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";

export interface TSClientOptions {
  target: TeamSpeakTarget;
  nickname: string;
  serverPassword?: string;
  defaultChannel?: string;
  channelPassword?: string;
  identity?: Identity;
}

export interface TSVoiceData {
  clientId: number;
  codec: number; // 4 = voice, 5 = music
  data: Buffer;
}

export interface TSDirectorySnapshot {
  channels: ChannelInfo[];
  clients: ClientInfo[];
}

export class TSClient extends EventEmitter {
  private client: TS3FullClient | null = null;
  private adapter: TeamSpeakAdapter | null = null;
  private logger: Logger;
  private readonly identity: Identity;
  private clientId = 0;
  private connected = false;
  private preferredChannelId = 0n;

  constructor(private options: TSClientOptions, logger: Logger) {
    super();
    this.logger = logger.child({ nickname: options.nickname });
    this.identity = options.identity ?? generateIdentity(8);
  }

  async connect(): Promise<void> {
    if (!this.adapter || !this.client) {
      this.adapter = new TeamSpeakAdapter({
        target: this.options.target,
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
    // Directory snapshots are dispatched through two setImmediate layers in
    // the SDK. Let both flush so the gateway's first connected state already
    // contains members from every subscribed channel.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

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

  private attachClientListeners(client: TS3FullClient): void {
    client.on("voiceData", (data: VoiceData) => {
      this.emit("voiceData", {
        clientId: data.clientId,
        codec: data.codec,
        data: Buffer.from(data.data),
      } as TSVoiceData);
    });

    // The SDK patch exposes the directory that TeamSpeak sends during the
    // normal client welcome sequence. This is the same data a native client
    // receives and does not require channellist/clientlist permissions.
    (client as unknown as {
      on(event: "directorySnapshot", handler: (snapshot: TSDirectorySnapshot) => void): unknown;
    }).on("directorySnapshot", (snapshot) => {
      this.emit("directorySnapshot", snapshot);
    });

    client.on("textMessage", (msg) => {
      this.emit("textMessage", {
        invokerName: msg.invokerName,
        invokerId: msg.invokerID,
        invokerUid: msg.invokerUID,
        message: msg.message,
        targetMode: msg.targetMode,
      });
    });

    client.on("disconnected", (err) => {
      this.logger.warn({ err: err?.message }, "Disconnected from TS");
      this.connected = false;
      this.clientId = 0;
      this.emit("disconnected", err);
    });

    client.on("clientEnter", (info) => {
      this.emit("clientEnter", info);
    });

    client.on("clientLeave", (info) => {
      this.emit("clientLeave", info);
    });

    client.on("clientMoved", (info) => {
      if (info.id === this.clientId && info.targetChannelID !== 0n) this.preferredChannelId = info.targetChannelID;
      this.emit("clientMoved", info);
    });
  }

  sendVoice(data: Buffer, codec: number = 4): void {
    if (!this.client || !this.connected) return;
    this.client.sendVoice(data, codec);
  }

  sendTextMessage(message: string): void {
    // We use execCommand for simplicity — the client API has higher-level wrappers
    if (!this.client || !this.connected) return;
    const escaped = message
      .replace(/\\/g, "\\\\")
      .replace(/ /g, "\\s")
      .replace(/\//g, "\\/");
    this.client.execCommand(`sendtextmessage targetmode=2 target=0 msg=${escaped}`)
      .catch((err: Error) => this.logger.error({ err }, "sendTextMessage failed"));
  }

  async switchChannel(channelId: bigint, password?: string): Promise<void> {
    if (!this.client || !this.connected) return;
    await tsClientMove(this.client, this.clientId, channelId, password);
    this.preferredChannelId = channelId;
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

  getIdentityString(): string {
    return this.identity.toString();
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
    this.connected = false;
    if (this.adapter) await this.adapter.disconnect();
    this.adapter = null;
    this.client = null;
    this.clientId = 0;
  }
}
