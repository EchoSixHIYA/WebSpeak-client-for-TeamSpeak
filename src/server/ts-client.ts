import { EventEmitter } from "node:events";
import {
  Client as TS3FullClient,
  generateIdentity,
  clientMove as tsClientMove,
  type Identity,
  type VoiceData,
  type ChannelInfo,
  type ClientInfo,
} from "@honeybbq/teamspeak-client";
import type { Logger } from "../logger.js";

export interface TSClientOptions {
  host: string;
  port: number;
  nickname: string;
  serverPassword?: string;
  serverProtocol?: "ts3" | "ts6";
  defaultChannel?: string;
  channelPassword?: string;
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
  private identity: Identity;
  private logger: Logger;
  private clientId = 0;
  private connected = false;

  constructor(
    private options: TSClientOptions,
    logger: Logger,
  ) {
    super();
    this.logger = logger.child({ nickname: options.nickname });
    this.identity = generateIdentity(8);
  }

  async connect(): Promise<void> {
    const addr = `${this.options.host}:${this.options.port}`;

    this.logger.info({ addr }, "Connecting to TeamSpeak");

    this.client = new TS3FullClient(this.identity, addr, this.options.nickname, {
      serverPassword: this.options.serverPassword,
      defaultChannel: this.options.defaultChannel,
      defaultChannelPassword: this.options.channelPassword,
      logger: {
        debug: (msg: string) => this.logger.debug(msg),
        info: (msg: string) => this.logger.info(msg),
        warn: (msg: string) => this.logger.warn(msg),
        error: (msg: string) => this.logger.error(msg),
      },
    });

    this.client.on("voiceData", (data: VoiceData) => {
      this.emit("voiceData", {
        clientId: data.clientId,
        codec: data.codec,
        data: Buffer.from(data.data),
      } as TSVoiceData);
    });

    // The SDK patch exposes the directory that TeamSpeak sends during the
    // normal client welcome sequence. This is the same data a native client
    // receives and does not require channellist/clientlist permissions.
    (this.client as unknown as {
      on(event: "directorySnapshot", handler: (snapshot: TSDirectorySnapshot) => void): unknown;
    }).on("directorySnapshot", (snapshot) => {
      this.emit("directorySnapshot", snapshot);
    });

    this.client.on("textMessage", (msg) => {
      this.emit("textMessage", {
        invokerName: msg.invokerName,
        invokerId: msg.invokerID,
        invokerUid: msg.invokerUID,
        message: msg.message,
        targetMode: msg.targetMode,
      });
    });

    this.client.on("disconnected", (err) => {
      this.logger.warn({ err: err?.message }, "Disconnected from TS");
      this.connected = false;
      this.clientId = 0;
      this.emit("disconnected");
    });

    this.client.on("clientEnter", (info) => {
      this.emit("clientEnter", info);
    });

    this.client.on("clientLeave", (info) => {
      this.emit("clientLeave", info);
    });

    this.client.on("clientMoved", (info) => {
      this.emit("clientMoved", info);
    });

    await this.client.connect();
    await this.client.waitConnected();

    this.clientId = this.client.clientID();
    try {
      // A native TeamSpeak client subscribes to the complete channel tree
      // after the welcome sequence. Without this command the server only
      // exposes members in the current channel, so users disappear as soon as
      // they move elsewhere even though both clients are on the same server.
      await this.client.execCommand("channelsubscribeall", 5000);
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
    this.connected = true;

    this.logger.info({ clientId: this.clientId }, "Connected to TeamSpeak");
    this.emit("connected", this.clientId);
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
    if (!this.client) return;
    await tsClientMove(this.client, this.clientId, channelId, password);
  }

  getClientId(): number {
    // The SDK learns the real client id during the welcome sequence, before
    // TSClient.connect() resumes. Reading it from the SDK prevents the first
    // directory snapshot from being built without the web client itself.
    return this.client?.clientID() ?? this.clientId;
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
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.clientId = 0;
  }
}
