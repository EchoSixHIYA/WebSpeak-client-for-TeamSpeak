import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
import {
  asChannelID,
  asClientID,
  avatarFileName,
  initFileDownload,
  moveClient,
  pokeClient,
  sendChannelMessage,
  sendPrivateMessage,
  sendServerMessage,
  type Channel,
  type ClientEntry,
  type Codec,
  type CommandExecutor,
  type FileDownloadInfo,
  type ServerFamily,
} from "@honeybbq/teamspeak";
import { Client, type ClientOptions, type Identity } from "@honeybbq/teamspeak/client";
import { resolveLocalTeamSpeakAlias } from "./teamspeak-resolver.js";
import { formatTeamSpeakTarget, parseTeamSpeakTarget } from "../domain/teamspeak-target.js";

export type { Identity };
export type TeamSpeakClientOptions = Pick<ClientOptions, "serverPassword" | "defaultChannel" | "defaultChannelPassword" | "logger">;

export interface ClientInfo {
  id: number;
  nickname: string;
  uid: string;
  serverGroups: string[];
  channelID: bigint;
  type: number;
}

export interface DirectoryClientInfo extends ClientInfo {
  away?: boolean;
  awayMessage?: string;
  inputMuted?: boolean;
  outputMuted?: boolean;
  channelCommander?: boolean;
}

export interface DirectoryChannelInfo {
  id: bigint;
  parentID: bigint;
  order: bigint;
  name: string;
  description: string;
  passwordProtected?: boolean;
  maxClients?: number;
  maxClientsLimited?: boolean;
}

export interface DirectorySnapshot {
  channels: DirectoryChannelInfo[];
  clients: DirectoryClientInfo[];
  /** The SDK's live view replaces the visible roster, including unsubscribed clients. */
  complete?: boolean;
}

export interface RawNotification {
  name: string;
  params: Record<string, string>;
}

export interface VoiceData {
  clientId: number;
  codec: number;
  data: Uint8Array;
}

export interface TextMessage {
  invokerName: string;
  invokerUID: string;
  message: string;
  invokerGroups: readonly bigint[] | undefined;
  targetMode: number;
  targetID: bigint;
  invokerID: number;
}

export interface ServerInfo {
  name: string;
  iconId: number | null;
  hostBannerGfxUrl: string | null;
  welcomeMessage: string;
}

/**
 * A narrow compatibility boundary for WebSpeak's old fork-specific SDK events.
 * Wire I/O and command execution are provided by the upstream 1.0 client; this
 * class only translates names and shapes that WebSpeak already consumes.
 */
export class TeamSpeakSdkClient extends EventEmitter implements CommandExecutor {
  private sdkClient: Client | null = null;
  private directoryRevision = -1;

  constructor(
    private readonly identity: Identity,
    private readonly address: string,
    private readonly nickname: string,
    private readonly options: TeamSpeakClientOptions,
  ) {
    super();
  }

  get status(): string | number {
    return this.sdkClient?.status ?? 0;
  }

  get serverInfo(): ServerInfo | null {
    const client = this.sdkClient;
    return client
      ? {
          name: client.view.serverName,
          iconId: client.view.serverIconID ?? null,
          hostBannerGfxUrl: client.view.serverBannerImageURL ?? null,
          welcomeMessage: client.view.server.virtualserver_welcomemessage ?? client.serverCapabilities.welcomeMessage,
        }
      : null;
  }

  get serverFamily(): ServerFamily {
    return this.sdkClient?.serverCapabilities.family ?? "unknown";
  }

  async connect(options: { signal?: AbortSignal } = {}): Promise<void> {
    this.directoryRevision = -1;
    const target = parseTeamSpeakTarget(this.address);
    const localAlias = await resolveLocalTeamSpeakAlias(target.host, { signal: options.signal });
    const address = localAlias ? formatTeamSpeakTarget({ host: localAlias, port: target.port }) : this.address;
    const client = new Client(this.identity, address, this.nickname, {
      ...this.options,
      // Preserve TeamSpeak nickname addresses. The upstream resolver bounds
      // the full SRV/TSDNS/nickname lookup and falls back to the given address.
      nicknameLookup: true,
    });
    this.sdkClient = client;
    this.attachUpstreamEvents(client);
    await client.connect(options);
    // connect() accepts the session before the welcome directory is complete.
    // Share its cancellation/deadline instead of waiting forever for a snapshot.
    await client.view.whenReady(options);
    this.publishDirectory(client);
  }

  async disconnect(): Promise<void> {
    await this.sdkClient?.disconnect();
  }

  async send(request: Parameters<CommandExecutor["send"]>[0], options?: Parameters<CommandExecutor["send"]>[1]) {
    return this.requireClient().send(request, options);
  }

  async exec(command: string, options?: { signal?: AbortSignal; timeoutMs?: number }) {
    return this.requireClient().exec(command, options);
  }

  clientID(): number {
    return Number(this.sdkClient?.clientID ?? 0);
  }

  channelID(): bigint {
    return this.sdkClient?.channelID ?? 0n;
  }

  async execCommand(command: string, timeoutMs?: number): Promise<void> {
    await this.requireClient().exec(command, timeoutMs === undefined ? undefined : { timeoutMs });
  }

  async execCommandWithResponse(command: string, timeoutMs?: number): Promise<Record<string, string>[]> {
    return this.requireClient().exec(command, timeoutMs === undefined ? undefined : { timeoutMs });
  }

  sendVoice(data: Uint8Array, codec: number): void {
    this.requireClient().sendVoice(data, codec as Codec);
  }

  sendWhisper(data: Uint8Array, clientIds: number[], codec: number): void {
    this.requireClient().sendWhisper(data, { clients: clientIds.map(asClientID) }, codec as Codec);
  }

  async fileTransferInitDownload(channelID: bigint, path: string, password: string): Promise<FileDownloadInfo> {
    return initFileDownload(this, asChannelID(channelID), path, { password });
  }

  async downloadFileData(host: string, info: FileDownloadInfo, destination: Writable): Promise<void> {
    await this.requireClient().downloadFileData(host, info, destination);
  }

  async listDirectoryChannels(): Promise<DirectoryChannelInfo[]> {
    return this.readDirectory().channels;
  }

  async listDirectoryClients(): Promise<DirectoryClientInfo[]> {
    return this.readDirectory().clients;
  }

  async getClientAvatarMetadata(clientId: number): Promise<{ uid: string; cacheKey: string; path: string } | null> {
    const info = this.requireClient().view.clients.get(asClientID(clientId));
    if (!info?.uid || !info.avatar) return null;
    return { uid: info.uid, cacheKey: info.avatar, path: `/${avatarFileName(info.uid)}` };
  }

  private readDirectory(): DirectorySnapshot {
    const view = this.requireClient().view;
    if (view.status !== "live") throw new Error("TeamSpeak directory view is not ready");
    return {
      channels: [...view.channels.values()].map(toDirectoryChannel),
      clients: [...view.clients.values()].map(toDirectoryClient),
      complete: true,
    };
  }

  private publishDirectory(client: Client): void {
    if (this.sdkClient !== client || client.view.status !== "live" || client.view.revision === this.directoryRevision) return;
    this.directoryRevision = client.view.revision;
    this.emit("directorySnapshot", this.readDirectory());
  }

  private requireClient(): Client {
    if (!this.sdkClient) throw new Error("TeamSpeak session is not ready");
    return this.sdkClient;
  }

  private attachUpstreamEvents(client: Client): void {
    const isCurrent = () => this.sdkClient === client;
    client.on("viewReady", () => this.publishDirectory(client));
    client.on("viewChanged", () => this.publishDirectory(client));
    client.on("voiceData", (event) => {
      if (!isCurrent()) return;
      this.emit("voiceData", { clientId: Number(event.clientID), codec: event.codec, data: event.data } satisfies VoiceData);
    });
    client.on("textMessage", (event) => {
      if (!isCurrent()) return;
      this.emit("textMessage", {
        ...event,
        invokerGroups: event.invokerGroups,
        targetID: BigInt(event.targetID),
        invokerID: Number(event.invokerID),
      } satisfies TextMessage);
    });
    client.on("poked", (event) => { if (isCurrent()) this.emit("poked", event); });
    client.on("clientEnter", (event) => {
      if (!isCurrent()) return;
      this.emit("clientEnter", toDirectoryClient(event));
    });
    client.on("clientUpdated", (event) => {
      if (!isCurrent()) return;
      const info = client.view.clients.get(event.clientID);
      if (info) this.emit("clientUpdated", { info: toDirectoryClient(info) });
    });
    client.on("clientLeave", (event) => {
      if (!isCurrent()) return;
      const id = Number(event.clientID);
      this.emit("clientLeave", {
        id,
        reasonID: event.reason,
        reasonMsg: event.reasonMessage,
        targetID: id,
      });
    });
    client.on("clientMoved", (event) => {
      if (!isCurrent()) return;
      const id = Number(event.clientID);
      this.emit("clientMoved", {
        id,
        targetChannelID: BigInt(event.targetChannelID),
        reasonID: event.reason,
        invokerID: Number(event.invokerID),
        invokerUID: event.invokerUID,
        invokerName: event.invokerName,
      });
    });
    client.on("kicked", (event) => { if (isCurrent()) this.emit("kicked", event.reasonMessage); });
    client.on("disconnected", (event) => { if (isCurrent()) this.emit("disconnected", event.error); });
    client.on("notification", (event) => {
      if (!isCurrent()) return;
      const notification = { name: event.name, params: { ...event.params } } satisfies RawNotification;
      this.emit("rawNotification", notification);
    });
  }
}

export async function listChannelsCompat(client: TeamSpeakSdkClient): Promise<DirectoryChannelInfo[]> {
  return client.listDirectoryChannels();
}

export async function listClientsCompat(client: TeamSpeakSdkClient): Promise<DirectoryClientInfo[]> {
  return client.listDirectoryClients();
}

export async function moveClientCompat(client: TeamSpeakSdkClient, clientId: number, channelId: bigint, password?: string): Promise<void> {
  await moveClient(client, asClientID(clientId), asChannelID(channelId), { password });
}

export async function sendTextMessageCompat(client: TeamSpeakSdkClient, mode: number, targetId: bigint, message: string): Promise<void> {
  if (mode === 1) await sendPrivateMessage(client, asClientID(Number(targetId)), message);
  else if (mode === 2) await sendChannelMessage(client, message);
  else await sendServerMessage(client, message);
}

export async function pokeCompat(client: TeamSpeakSdkClient, clientId: number, message: string): Promise<void> {
  await pokeClient(client, asClientID(clientId), message);
}

export type { Channel, ClientEntry };

function toDirectoryChannel(channel: Channel): DirectoryChannelInfo {
  return {
    id: BigInt(channel.id),
    parentID: BigInt(channel.parentID),
    order: BigInt(channel.order),
    name: channel.name,
    description: channel.description,
    passwordProtected: channel.hasPassword,
    ...(Number.isInteger(channel.maxClients) && channel.maxClients >= 0 && channel.maxClients <= 65_535
      && typeof channel.isMaxClientsUnlimited === "boolean"
      ? { maxClients: channel.maxClients, maxClientsLimited: !channel.isMaxClientsUnlimited }
      : {}),
  };
}

function toDirectoryClient(entry: ClientEntry): DirectoryClientInfo {
  return {
    id: Number(entry.id),
    nickname: entry.nickname,
    uid: entry.uid,
    serverGroups: entry.serverGroups.map(String),
    channelID: BigInt(entry.channelID),
    type: entry.type,
    ...(entry.isAway !== undefined ? { away: entry.isAway } : {}),
    ...(entry.awayMessage !== undefined ? { awayMessage: entry.awayMessage } : {}),
    ...(entry.isInputMuted !== undefined ? { inputMuted: entry.isInputMuted } : {}),
    ...(entry.isOutputMuted !== undefined ? { outputMuted: entry.isOutputMuted } : {}),
    ...(entry.isChannelCommander !== undefined ? { channelCommander: entry.isChannelCommander } : {}),
  };
}
