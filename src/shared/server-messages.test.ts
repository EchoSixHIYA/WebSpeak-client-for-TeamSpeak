import assert from "node:assert/strict";
import test from "node:test";
import { parseServerMessage, parseScreenShareStream, parseVoiceAudioBridgeStats, type ServerMessage } from "./server-messages.js";

const stream = {
  streamId: "stream-1", source: "browser" as const, ownerPeerId: "owner", ownerClientId: 1,
  ownerNickname: "Owner", name: "Screen", audio: true, createdAt: 1_000, viewerCount: 0, viewers: [],
};
const event = { id: "event-1", kind: "joined", message: "Member joined", timestamp: 1_000 };
const samples: Record<ServerMessage["type"], ServerMessage> = {
  connected: { type: "connected", tsClientId: 1, members: [{ id: 1, nickname: "Owner" }], serverEventLog: [event] },
  memberEnter: { type: "memberEnter", id: 2, nickname: "Visitor", uid: "uid-2", isSelf: false },
  memberLeave: { type: "memberLeave", id: 2 },
  memberAvatar: { type: "memberAvatar", id: 2, avatar: "data:image/png;base64,test" },
  channelList: { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", maxClients: 10, maxClientsLimited: true, members: [{ id: 1, nickname: "Owner" }] }] },
  chatMessage: { type: "chatMessage", scope: "channel", targetId: "1", invokerId: 2, message: "hello" },
  pokeReceived: { type: "pokeReceived", invokerId: 2, message: "poke" },
  serverEvent: { type: "serverEvent", event },
  channelSwitched: { type: "channelSwitched", channelId: "1" },
  audioStats: { type: "audioStats", sequence: "probe", stats: parseVoiceAudioBridgeStats({})! },
  latencyPong: { type: "latencyPong", sequence: "legacy", teamSpeakLatencyMs: null, teamSpeakReachable: false, teamSpeakErrorCode: "TIMEOUT" },
  disconnected: { type: "disconnected", recoverable: false },
  reconnecting: { type: "reconnecting", attempt: 2, delayMs: 1_000 },
  reconnected: { type: "reconnected" },
  connectionFailed: { type: "connectionFailed", code: "INVALID_SERVER_PASSWORD" },
  reconnectFailed: { type: "reconnectFailed", code: "TIMEOUT" },
  webrtcError: { type: "webrtcError", code: "WEBRTC_UNAVAILABLE" },
  audioError: { type: "audioError", code: "AUDIO_ENCODER_UNAVAILABLE" },
  whisperTargets: { type: "whisperTargets", targetIds: [2], active: true },
  webrtcAnswer: { type: "webrtcAnswer", payload: { sdp: { type: "answer", sdp: "v=0\r\n" } } },
  voiceActivity: { type: "voiceActivity", clientIds: [1, 2] },
  commandCompleted: { type: "commandCompleted", requestId: "command-1" },
  error: { type: "error", requestId: "command-1", error: { code: "PERMISSION_DENIED", message: "denied", recoverable: false } },
  screenShareCompleted: { type: "screenShareCompleted", requestId: "share-1" },
  screenShareList: { type: "screenShareList", streams: [stream] },
  screenShareStarted: { type: "screenShareStarted", stream, owner: true, requestId: "share-1" },
  screenShareJoined: { type: "screenShareJoined", stream, mode: "browser", ownerPeerId: "owner" },
  screenShareViewerCount: { type: "screenShareViewerCount", streamId: "stream-1", viewerCount: 1, viewers: [{ peerId: "viewer", nickname: "Visitor" }] },
  screenShareStopped: { type: "screenShareStopped", streamId: "stream-1", reason: "owner-left" },
  screenShareLeft: { type: "screenShareLeft", streamId: "stream-1" },
  screenShareViewerJoined: { type: "screenShareViewerJoined", streamId: "stream-1", viewerPeerId: "viewer", viewerNickname: "Visitor" },
  screenShareNativeViewerJoined: { type: "screenShareNativeViewerJoined", streamId: "stream-1", viewerPeerId: "ts-viewer-2", viewerClientId: 2 },
  screenShareViewerLeft: { type: "screenShareViewerLeft", streamId: "stream-1", viewerPeerId: "viewer" },
  screenShareSignal: { type: "screenShareSignal", streamId: "stream-1", fromPeerId: "owner", signal: { kind: "offer", sdp: "v=0\r\n" } },
  screenShareError: { type: "screenShareError", requestId: "share-1", code: "SCREEN_SHARE_NOT_FOUND", message: "ended" },
};

test("every current gateway message survives JSON transport and shared validation", () => {
  for (const [kind, message] of Object.entries(samples)) {
    const decoded = parseServerMessage(JSON.parse(JSON.stringify(message)));
    assert.equal(decoded?.type, kind, kind);
    if (kind !== "connected") assert.deepEqual(decoded, message, kind);
    else assert.deepEqual({ ...decoded, screenShareIceServers: undefined }, { ...message, screenShareIceServers: undefined });
  }
});

test("malformed nested directory and event data is rejected before client state changes", () => {
  for (const message of [
    null, [], {}, { type: "toString" }, { type: "futureMessage" },
    { type: "connected", tsClientId: 1, members: [null] },
    { type: "connected", tsClientId: 1, members: [{ id: "1", nickname: "bad id" }] },
    { type: "connected", tsClientId: 1, serverEventLog: [{ id: "incomplete" }] },
    { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", members: [{}] }] },
    { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", maxClients: 10 }] },
    { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", maxClients: 65536, maxClientsLimited: true }] },
    { type: "memberEnter", id: 65536, nickname: "bad id" },
    { type: "memberEnter", id: 1, nickname: "bad flag", inputMuted: "false" },
    { type: "serverEvent", event: { ...event, timestamp: Infinity } },
    { type: "error", error: [] },
    { type: "commandCompleted", requestId: "x".repeat(65) },
    { type: "webrtcAnswer", payload: { sdp: { type: "offer", sdp: "v=0" } } },
    { type: "screenShareSignal", streamId: "s", fromPeerId: "p", signal: { kind: "offer", sdp: 12 } },
  ]) assert.equal(parseServerMessage(message), null, JSON.stringify(message));
});

test("legacy chat sentinels, numeric channel acknowledgements and incomplete stats remain compatible", () => {
  assert.deepEqual(parseServerMessage({ type: "chatMessage", targetId: 0, message: "legacy" }), { type: "chatMessage", targetId: 0, message: "legacy" });
  assert.deepEqual(parseServerMessage({ type: "channelSwitched", channelId: 4 }), { type: "channelSwitched", channelId: 4 });
  const message = parseServerMessage({ type: "audioStats", sequence: "probe", stats: { ingressFrames: 4, tsSendErrors: -1, egressFrames: "bad" } });
  assert.ok(message?.type === "audioStats");
  assert.equal(message.stats.ingressFrames, 4);
  assert.equal(message.stats.tsSendErrors, 0);
  assert.equal(message.stats.egressFrames, 0);
});

test("legacy screen streams receive defaults and untrusted viewer data is bounded", () => {
  const message = parseServerMessage({ type: "screenShareList", streams: [null, { streamId: "old", ownerPeerId: "owner", viewers: [null, { peerId: "v".repeat(200), nickname: "n".repeat(200) }] }] });
  assert.ok(message?.type === "screenShareList");
  assert.equal(message.streams.length, 1);
  assert.equal(message.streams[0]?.source, "browser");
  assert.equal(message.streams[0]?.viewerCount, 0);
  assert.equal(message.streams[0]?.viewers[0]?.peerId.length, 128);
  assert.equal(message.streams[0]?.viewers[0]?.nickname.length, 120);
  assert.equal(parseScreenShareStream({ streamId: "s", ownerPeerId: [] }), null);
});
