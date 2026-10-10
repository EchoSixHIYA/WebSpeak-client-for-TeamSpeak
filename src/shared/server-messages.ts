import type { ChannelMember, ChannelInfo, ServerEvent, VoiceAudioBridgeStats } from "./voice-models.js";
import { normalizeScreenShareIceServers, parseScreenShareSignal, type ScreenShareIceServer, type ScreenSharePeerSignal, type ScreenShareStreamDescription, type ScreenShareViewerDescription } from "./screen-share.js";

import { normalizeVoiceStunServer } from "./voice-ice.js";
import { isSessionDescription, type SessionDescription } from "./webrtc.js";
export type { SessionDescription } from "./webrtc.js";

type Message<T extends string, Fields = object> = { type: T } & Fields;
type Request = { requestId?: string };
type Failure = { code?: string; detail?: string };
type ChatFields = { invokerId?: number; invokerName?: string; message: string; timestamp?: number };

/** Public JSON messages. Internal sockets, SDK clients and media objects stay out. */
export type ServerMessage =
  | Message<"connected", { tsClientId: number; members?: ChannelMember[]; serverEventLog?: ServerEvent[]; identity?: string; webrtcAvailable?: boolean; webRtcStunServer?: string; whisperTargetIds?: number[]; whisperActive?: boolean; screenShareIceServers?: ScreenShareIceServer[]; accelerated?: boolean }>
  | Message<"memberEnter", ChannelMember>
  | Message<"memberLeave", { id: number }>
  | Message<"memberAvatar", { id: number; uid?: string; avatar?: string }>
  | Message<"channelList", { channels: ChannelInfo[] }>
  | Message<"chatMessage", ChatFields & { scope?: string; senderUid?: string; targetId?: string | number }>
  | Message<"pokeReceived", ChatFields & { invokerUid?: string }>
  | Message<"serverEvent", { event: ServerEvent }>
  | Message<"channelSwitched", Request & { channelId: string | number }>
  | Message<"audioStats", { sequence: string; stats: VoiceAudioBridgeStats }>
  | Message<"latencyPong", { sequence: string; teamSpeakLatencyMs: number | null; teamSpeakReachable: boolean; teamSpeakErrorCode: string | null }>
  | Message<"disconnected", { recoverable?: boolean }>
  | Message<"reconnecting", { attempt?: number; delayMs?: number }>
  | Message<"reconnected">
  | Message<"connectionFailed" | "reconnectFailed" | "webrtcError" | "audioError", Failure>
  | Message<"whisperTargets", { targetIds: number[]; active: boolean }>
  | Message<"webrtcAnswer", { payload: { sdp: SessionDescription } }>
  | Message<"voiceActivity", { clientIds: number[] }>
  | Message<"commandCompleted" | "screenShareCompleted", { requestId: string }>
  | Message<"error", Request & { error?: { code?: string; message?: string; recoverable?: boolean }; message?: string }>
  | Message<"screenShareList", { streams: ScreenShareStreamDescription[] }>
  | Message<"screenShareStarted" | "screenShareJoined", Request & { stream: ScreenShareStreamDescription; owner?: boolean; ownerPeerId?: string; mode?: "browser" | "teamspeak" }>
  | Message<"screenShareViewerCount", { streamId: string; viewerCount?: number; viewers?: ScreenShareViewerDescription[] }>
  | Message<"screenShareStopped" | "screenShareLeft", { streamId: string; reason?: string }>
  | Message<"screenShareViewerJoined" | "screenShareNativeViewerJoined" | "screenShareViewerLeft", { streamId: string; viewerPeerId: string; viewerNickname?: string; viewerClientId?: number }>
  | Message<"screenShareSignal", { streamId: string; fromPeerId: string; signal: ScreenSharePeerSignal }>
  | Message<"screenShareError", Request & { code?: string; message?: string }>;

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
const clientId = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value > 0 && value <= 65535;
const identifier = (value: unknown): value is string => text(value) && value.length > 0 && value.length <= 128;
const channelId = (value: unknown): value is string | number => (text(value) && /^\d{1,20}$/.test(value)) || (finite(value) && Number.isSafeInteger(value) && value >= 0);
const optional = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value);
const arrayOf = (value: unknown, check: (value: unknown) => boolean): boolean => Array.isArray(value) && value.every(check);

function member(value: unknown): value is ChannelMember {
  return isRecord(value) && clientId(value.id) && text(value.nickname)
    && ["uid", "avatar", "awayMessage"].every(key => optional(value[key], text))
    && ["isSelf", "away", "inputMuted", "outputMuted", "channelCommander"].every(key => optional(value[key], boolean));
}

function channel(value: unknown): value is ChannelInfo {
  return isRecord(value) && text(value.id) && channelId(value.id) && text(value.parentID) && channelId(value.parentID)
    && text(value.name) && optional(value.order, text) && optional(value.description, text)
    && optional(value.maxClients, maximum => finite(maximum) && Number.isInteger(maximum) && maximum >= 0 && maximum <= 65_535)
    && optional(value.maxClientsLimited, boolean)
    && (value.maxClients === undefined) === (value.maxClientsLimited === undefined)
    && optional(value.members, members => arrayOf(members, member));
}

function event(value: unknown): value is ServerEvent {
  return isRecord(value) && text(value.id) && text(value.kind) && text(value.message) && finite(value.timestamp);
}

export function parseVoiceAudioBridgeStats(value: unknown): VoiceAudioBridgeStats | null {
  if (!isRecord(value)) return null;
  const count = (key: string): number => finite(value[key]) && value[key] >= 0 ? value[key] : 0;
  return {
    transport: value.transport === "webrtc" ? "webrtc" : "websocket",
    ingressFrames: count("ingressFrames"), ingressDroppedFrames: count("ingressDroppedFrames"), ingressMaxGapMs: count("ingressMaxGapMs"),
    tsSendFrames: count("tsSendFrames"), tsSendErrors: count("tsSendErrors"), tsSendMaxGapMs: count("tsSendMaxGapMs"),
    tsReceiveFrames: count("tsReceiveFrames"), tsReceiveMaxGapMs: count("tsReceiveMaxGapMs"),
    egressFrames: count("egressFrames"), egressDroppedFrames: count("egressDroppedFrames"), egressMaxGapMs: count("egressMaxGapMs"),
    webrtcIngressRtpFrames: count("webrtcIngressRtpFrames"), webrtcIngressRtpMaxGapMs: count("webrtcIngressRtpMaxGapMs"),
    webrtcEgressRtpFrames: count("webrtcEgressRtpFrames"), webrtcEgressRtpMaxGapMs: count("webrtcEgressRtpMaxGapMs"),
    webrtcQueueDroppedFrames: count("webrtcQueueDroppedFrames"), webrtcQueueUnderrunTicks: count("webrtcQueueUnderrunTicks"),
    webrtcPacerLateTicks: count("webrtcPacerLateTicks"), webrtcIngressDecodeErrors: count("webrtcIngressDecodeErrors"),
    webrtcDownlinkDecodeErrors: count("webrtcDownlinkDecodeErrors"),
  };
}

export function parseScreenShareViewers(raw: unknown): ScreenShareViewerDescription[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((viewer): viewer is RecordValue & { peerId: string; nickname: string } => isRecord(viewer) && text(viewer.peerId) && text(viewer.nickname))
    .slice(0, 64).map(viewer => ({
      peerId: viewer.peerId.slice(0, 128), nickname: viewer.nickname.slice(0, 120),
      ...(text(viewer.avatar) && viewer.avatar.length <= 128 * 1024 ? { avatar: viewer.avatar } : {}),
    }));
}

/** Defaults preserve stream descriptions sent by older gateway versions. */
export function parseScreenShareStream(value: unknown): ScreenShareStreamDescription | null {
  if (!isRecord(value) || !identifier(value.streamId) || !identifier(value.ownerPeerId)) return null;
  return {
    streamId: value.streamId, ownerPeerId: value.ownerPeerId,
    source: value.source === "teamspeak" ? "teamspeak" : "browser",
    ...(clientId(value.ownerClientId) ? { ownerClientId: value.ownerClientId } : {}),
    ownerNickname: text(value.ownerNickname) ? value.ownerNickname : "TeamSpeak 用户",
    name: text(value.name) ? value.name : "屏幕共享", audio: value.audio === true,
    createdAt: finite(value.createdAt) ? value.createdAt : Date.now(),
    viewerCount: finite(value.viewerCount) ? Math.max(0, Math.floor(value.viewerCount)) : 0,
    viewers: parseScreenShareViewers(value.viewers),
  };
}

const valid: Record<ServerMessage["type"], (message: RecordValue) => boolean> = {
  connected: m => clientId(m.tsClientId) && optional(m.members, v => arrayOf(v, member)) && optional(m.serverEventLog, v => arrayOf(v, event))
    && optional(m.identity, v => text(v) && v.length <= 8192) && optional(m.webrtcAvailable, boolean) && optional(m.webRtcStunServer, v => normalizeVoiceStunServer(v) !== null)
    && optional(m.whisperTargetIds, v => arrayOf(v, clientId)) && optional(m.whisperActive, boolean) && optional(m.accelerated, boolean),
  memberEnter: member,
  memberLeave: m => clientId(m.id),
  memberAvatar: m => clientId(m.id) && optional(m.uid, text) && optional(m.avatar, text),
  channelList: m => arrayOf(m.channels, channel),
  chatMessage: m => text(m.message) && optional(m.invokerId, finite) && optional(m.invokerName, text) && optional(m.timestamp, finite)
    && optional(m.scope, text) && optional(m.senderUid, text) && optional(m.targetId, channelId),
  pokeReceived: m => text(m.message) && optional(m.invokerId, finite) && optional(m.invokerName, text) && optional(m.timestamp, finite) && optional(m.invokerUid, text),
  serverEvent: m => event(m.event),
  channelSwitched: m => channelId(m.channelId),
  audioStats: m => text(m.sequence) && m.sequence.length <= 64 && isRecord(m.stats),
  latencyPong: m => text(m.sequence) && (m.teamSpeakLatencyMs === null || finite(m.teamSpeakLatencyMs)) && boolean(m.teamSpeakReachable)
    && (m.teamSpeakErrorCode === null || text(m.teamSpeakErrorCode)),
  disconnected: m => optional(m.recoverable, boolean),
  reconnecting: m => optional(m.attempt, finite) && optional(m.delayMs, finite),
  reconnected: () => true,
  connectionFailed: m => optional(m.code, text) && optional(m.detail, text),
  reconnectFailed: m => optional(m.code, text) && optional(m.detail, text),
  webrtcError: m => optional(m.code, text) && optional(m.detail, text),
  audioError: m => optional(m.code, text) && optional(m.detail, text),
  whisperTargets: m => arrayOf(m.targetIds, clientId) && boolean(m.active),
  webrtcAnswer: m => isRecord(m.payload) && isSessionDescription(m.payload.sdp, "answer"),
  voiceActivity: m => arrayOf(m.clientIds, clientId),
  commandCompleted: m => text(m.requestId),
  screenShareCompleted: m => text(m.requestId),
  error: m => optional(m.message, text) && optional(m.error, v => isRecord(v) && optional(v.code, text) && optional(v.message, text) && optional(v.recoverable, boolean)),
  screenShareList: m => Array.isArray(m.streams),
  screenShareStarted: m => isRecord(m.stream) && optional(m.owner, boolean) && optional(m.ownerPeerId, identifier) && optional(m.mode, v => v === "browser" || v === "teamspeak"),
  screenShareJoined: m => isRecord(m.stream) && optional(m.owner, boolean) && optional(m.ownerPeerId, identifier) && optional(m.mode, v => v === "browser" || v === "teamspeak"),
  screenShareViewerCount: m => identifier(m.streamId) && optional(m.viewerCount, finite) && optional(m.viewers, Array.isArray),
  screenShareStopped: m => identifier(m.streamId) && optional(m.reason, text),
  screenShareLeft: m => identifier(m.streamId) && optional(m.reason, text),
  screenShareViewerJoined: m => identifier(m.streamId) && identifier(m.viewerPeerId) && optional(m.viewerNickname, text) && optional(m.viewerClientId, clientId),
  screenShareNativeViewerJoined: m => identifier(m.streamId) && identifier(m.viewerPeerId) && optional(m.viewerNickname, text) && optional(m.viewerClientId, clientId),
  screenShareViewerLeft: m => identifier(m.streamId) && identifier(m.viewerPeerId) && optional(m.viewerNickname, text) && optional(m.viewerClientId, clientId),
  screenShareSignal: m => identifier(m.streamId) && identifier(m.fromPeerId) && Boolean(parseScreenShareSignal(m.signal)),
  screenShareError: m => optional(m.code, text) && optional(m.message, text),
};

/** Unknown future messages are ignored; malformed known messages never reach UI state. */
export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value) || !text(value.type) || !Object.hasOwn(valid, value.type)) return null;
  if (!optional(value.requestId, v => text(v) && v.length <= 64)) return null;
  if (!valid[value.type as ServerMessage["type"]](value)) return null;
  let result = value;
  if (value.type === "connected") {
    result = { ...value, ...(value.webRtcStunServer === undefined ? {} : { webRtcStunServer: normalizeVoiceStunServer(value.webRtcStunServer)! }), screenShareIceServers: normalizeScreenShareIceServers(Array.isArray(value.screenShareIceServers) ? value.screenShareIceServers : undefined) };
  } else if (value.type === "audioStats") {
    result = { ...value, stats: parseVoiceAudioBridgeStats(value.stats) };
  } else if (value.type === "screenShareList") {
    result = { ...value, streams: (value.streams as unknown[]).map(parseScreenShareStream).filter(stream => stream !== null) };
  } else if (value.type === "screenShareStarted" || value.type === "screenShareJoined") {
    const stream = parseScreenShareStream(value.stream);
    if (!stream) return null;
    result = { ...value, stream };
  } else if (value.type === "screenShareViewerCount" && value.viewers !== undefined) {
    result = { ...value, viewers: parseScreenShareViewers(value.viewers) };
  } else if (value.type === "screenShareSignal") {
    result = { ...value, signal: parseScreenShareSignal(value.signal) };
  }
  // Every discriminant above has a validator; normalized nested objects are
  // checked at the boundary before the single conversion to the public union.
  return result as ServerMessage;
}
