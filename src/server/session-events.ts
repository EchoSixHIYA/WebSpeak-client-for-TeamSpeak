import type { ClientInfo } from "@echosixhiya/teamspeak-client";
import type { EventEmitter } from "node:events";
import type { WebSpeakError } from "../errors.js";
import type { ChannelInfo, ChannelMember } from "../shared/voice-models.js";
import type { ServerMessage } from "../shared/server-messages.js";
import { DirectorySynchronizer } from "./directory-sync.js";
import { mapChannelTree, normalizeDirectorySnapshot } from "./directory-view.js";
import { MemberAvatarLoader } from "./member-avatars.js";
import type { TSClient, TSChatMessage, TSDirectoryClient, TSDirectorySnapshot, TSRawNotification, TSVoiceData } from "./ts-client.js";

export interface SessionDirectoryState {
  channelTree: ChannelInfo[];
  members: Map<number, ChannelMember & { uid: string }>;
  avatarCache: Map<string, string | null>;
  whisperTargetIds: Set<number>;
  whisperActive: boolean;
}

interface SdkEvents {
  directorySnapshot: TSDirectorySnapshot;
  clientEnter: ClientInfo;
  clientLeave: { id: number };
  clientMoved: { id: number; targetChannelID?: bigint };
  clientUpdated: TSDirectoryClient;
  directoryClientsSnapshot: TSDirectoryClient[];
  channelPasswordProtectionChanged: { channelId: bigint; passwordProtected: boolean };
  rawNotification: TSRawNotification;
  voiceData: TSVoiceData;
  textMessage: TSChatMessage;
  poked: { invokerID: number; invokerUID: string; invokerName: string; message: string };
  kicked: WebSpeakError;
  disconnected: Error | undefined;
}

export interface SessionEventOptions {
  state: SessionDirectoryState;
  client: Pick<TSClient, "getClientId" | "getChannelId" | "getClientAvatar"> & Partial<Pick<TSClient, "refreshDirectoryClients">> & Pick<EventEmitter, "on" | "off">;
  nickname: string;
  requestedChannel?: string;
  isCurrent(): boolean;
  acceptsDirectory(): boolean;
  isPublished(): boolean;
  isConnected(): boolean;
  sendJson(message: ServerMessage): void;
  addEvent(kind: "joined" | "left" | "moved" | "poke", message: string): void;
  onDirectoryReady(): void;
  onClientLeave(id: number): void;
  onClientMove(id: number, channelId: bigint): void;
  onNotification(notification: TSRawNotification): void;
  onVoice(data: TSVoiceData): void;
  onKick(error: WebSpeakError): void;
  onDisconnect(error?: Error): void;
  onAvatarError(id: number, uid: string, error: unknown): void;
}

/** SDK listeners, directory projection and optional work owned by one session. */
export class SessionEventCoordinator {
  private readonly directory = new DirectorySynchronizer();
  private readonly avatars: MemberAvatarLoader;
  private readonly subscriptions: Array<() => void> = [];
  private closed = false;
  private clientId = 0;
  private channelId = 0n;
  private directoryStatusRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SessionEventOptions) {
    const { state, client } = options;
    this.avatars = new MemberAvatarLoader({
      members: state.members, cache: state.avatarCache,
      isCurrent: () => this.isCurrent() && options.isConnected(),
      load: (id, uid) => client.getClientAvatar(id, uid),
      publish: (id, uid, avatar) => options.sendJson({ type: "memberAvatar", id, uid, avatar }),
      onError: options.onAvatarError,
    });
    // Subscribe before connect(): welcome events may precede the first snapshot.
    this.listenDirectory("directorySnapshot", snapshot => {
      const previousChannels = state.channelTree;
      this.directory.applySnapshot(snapshot);
      this.refresh();
      this.trackChannelEvents(previousChannels);
      options.onDirectoryReady();
      this.publishDirectory();
      this.avatars.schedule();
    });
    this.listenDirectory("clientEnter", info => {
      const candidateSelfId = client.getClientId();
      if (candidateSelfId > 0 && info.id === candidateSelfId) {
        this.clientId = candidateSelfId;
        if (info.channelID !== undefined && info.channelID !== 0n) this.channelId = info.channelID;
      }
      const wasKnown = state.members.has(info.id);
      this.directory.applyClientEnter(info);
      this.refresh();
      if (this.directoryStatusRefreshTimer) clearTimeout(this.directoryStatusRefreshTimer);
      this.directoryStatusRefreshTimer = setTimeout(() => {
        this.directoryStatusRefreshTimer = null;
        void options.client.refreshDirectoryClients?.();
      }, 300);
      if (options.isPublished()) {
        this.publishDirectory();
        if (!wasKnown) options.sendJson({ type: "memberEnter", id: info.id, nickname: info.nickname, uid: info.uid, isSelf: info.id === this.clientId });
        if (!wasKnown && info.id !== this.clientId) options.addEvent("joined", `${info.nickname || "未知用户"} 加入了服务器`);
        this.avatars.schedule();
      }
    });
    this.listenDirectory("clientLeave", info => {
      options.onClientLeave(info.id);
      const member = state.members.get(info.id);
      this.directory.applyClientLeave(info.id);
      this.refresh();
      if (options.isPublished() && member) {
        options.sendJson({ type: "memberLeave", id: info.id });
        this.publishDirectory();
        if (info.id !== this.clientId) options.addEvent("left", `${member.nickname || "用户"} 离开了服务器`);
      }
    });
    this.listenDirectory("clientMoved", info => {
      if (info.targetChannelID === undefined || info.targetChannelID === 0n) return;
      options.onClientMove(info.id, info.targetChannelID);
      const member = state.members.get(info.id);
      if (info.id === this.clientId) this.channelId = info.targetChannelID;
      this.directory.applyClientMoved(info.id, info.targetChannelID);
      this.refresh();
      if (options.isPublished()) {
        this.publishDirectory();
        if (info.id !== this.clientId) options.addEvent("moved", `${member?.nickname || "用户"} 移动到了其他频道`);
      }
    });
    this.listenDirectory("clientUpdated", info => {
      this.directory.applyClientUpdated(info);
      this.refresh();
      this.publishDirectory();
    });
    this.listenDirectory("directoryClientsSnapshot", clients => {
      this.directory.applyClientListSnapshot(clients);
      this.refresh();
      this.publishDirectory();
    });
    this.listenDirectory("channelPasswordProtectionChanged", change => {
      const channelId = String(change.channelId);
      if (!state.channelTree.some(channel => channel.id === channelId)) return;
      state.channelTree = state.channelTree.map(channel => channel.id === channelId
        ? { ...channel, passwordProtected: change.passwordProtected }
        : channel);
      this.publishDirectory();
    });
    this.listen("rawNotification", options.onNotification);
    this.listen("voiceData", options.onVoice);
    this.listen("textMessage", message => {
      const scope = message.targetMode === 1 ? "private" : message.targetMode === 2 ? "channel" : "server";
      const targetId = message.targetId ?? 0n;
      // Channel notifications can omit target; bind them to the current channel.
      const effectiveTargetId = scope === "channel" && targetId === 0n ? client.getChannelId() : targetId;
      options.sendJson({ type: "chatMessage", scope,
        ...(effectiveTargetId !== 0n ? { targetId: String(effectiveTargetId) } : {}),
        senderUid: message.invokerUid, timestamp: Date.now(), invokerName: message.invokerName,
        invokerId: message.invokerId, message: message.message,
      });
    });
    this.listen("poked", event => {
      options.sendJson({ type: "pokeReceived", invokerId: event.invokerID, invokerUid: event.invokerUID, invokerName: event.invokerName, message: event.message, timestamp: Date.now() });
      options.addEvent("poke", `${event.invokerName || "用户"} 戳了你一下`);
    });
    this.listen("kicked", options.onKick);
    this.listen("disconnected", options.onDisconnect);
  }

  get ready(): boolean { return this.directory.ready; }
  get selfId(): number { return this.clientId; }

  private isCurrent(): boolean { return !this.closed && this.options.isCurrent(); }

  private listen<K extends keyof SdkEvents>(name: K, handler: (data: SdkEvents[K]) => void): void {
    const listener = (data: SdkEvents[K]) => { if (this.isCurrent()) handler(data); };
    this.options.client.on(name, listener);
    this.subscriptions.push(() => this.options.client.off(name, listener));
  }

  private listenDirectory<K extends keyof SdkEvents>(name: K, handler: (data: SdkEvents[K]) => void): void {
    this.listen(name, data => { if (this.options.acceptsDirectory()) handler(data); });
  }

  syncSelf(): void {
    if (!this.isCurrent()) return;
    this.clientId = this.options.client.getClientId();
    const channelId = this.options.client.getChannelId();
    if (channelId !== 0n) this.channelId = channelId;
    this.refresh();
    if (this.clientId > 0 && !this.options.state.members.has(this.clientId)) {
      this.directory.applyClientEnter({ id: this.clientId, nickname: this.options.nickname, channelID: this.channelId, uid: "", type: 1, serverGroups: [] });
      this.refresh();
    }
  }

  scheduleAvatars(): void { this.avatars.schedule(); }

  private refresh(): void {
    const snapshot = this.directory.getSnapshot();
    if (!snapshot) return;
    const { state, client } = this.options;
    const previousTargets = [...state.whisperTargetIds].sort((a, b) => a - b);
    const selfId = this.clientId || client.getClientId();
    const sdkChannelId = client.getChannelId();
    if (this.channelId === 0n && sdkChannelId !== 0n) this.channelId = sdkChannelId;
    const normalized = normalizeDirectorySnapshot(snapshot, selfId, this.channelId, this.options.nickname, this.options.requestedChannel);
    state.channelTree = mapChannelTree(normalized, state.avatarCache);
    state.members.clear();
    for (const member of normalized.clients) {
      const avatar = member.uid ? state.avatarCache.get(member.uid) : undefined;
      state.members.set(member.id, { id: member.id, nickname: member.nickname, uid: member.uid,
        ...(avatar ? { avatar } : {}), away: member.away, awayMessage: member.awayMessage,
        inputMuted: member.inputMuted, outputMuted: member.outputMuted, channelCommander: member.channelCommander,
      });
    }
    for (const id of state.whisperTargetIds) {
      if (!state.members.has(id) || id === selfId) state.whisperTargetIds.delete(id);
    }
    if (!state.whisperTargetIds.size) state.whisperActive = false;
    const nextTargets = [...state.whisperTargetIds].sort((a, b) => a - b);
    if (this.options.isPublished() && (previousTargets.length !== nextTargets.length || previousTargets.some((id, index) => id !== nextTargets[index]))) {
      this.options.sendJson({ type: "whisperTargets", targetIds: nextTargets, active: state.whisperActive });
    }
  }

  private publishDirectory(): void {
    if (this.options.isPublished()) this.options.sendJson({ type: "channelList", channels: this.options.state.channelTree });
  }

  private trackChannelEvents(previous: ChannelInfo[]): void {
    if (!this.options.isPublished()) return;
    const before = new Map(previous.map(channel => [channel.id, channel]));
    const after = new Map(this.options.state.channelTree.map(channel => [channel.id, channel]));
    for (const channel of after.values()) {
      if (!before.has(channel.id)) this.options.addEvent("joined", `频道「${channel.name}」已创建`);
      else if (before.get(channel.id)?.name !== channel.name) this.options.addEvent("moved", `频道已重命名为「${channel.name}」`);
    }
    for (const channel of before.values()) if (!after.has(channel.id)) this.options.addEvent("left", `频道「${channel.name}」已删除`);
  }

  reset(): void {
    if (this.directoryStatusRefreshTimer) clearTimeout(this.directoryStatusRefreshTimer);
    this.directoryStatusRefreshTimer = null;
    this.avatars.reset();
    this.clientId = 0;
    this.channelId = 0n;
    this.directory.clear();
    this.options.state.channelTree = [];
    this.options.state.members.clear();
    this.options.state.whisperTargetIds.clear();
    this.options.state.whisperActive = false;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.directoryStatusRefreshTimer) clearTimeout(this.directoryStatusRefreshTimer);
    this.directoryStatusRefreshTimer = null;
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.avatars.close();
    this.reset();
  }
}
