import assert from "node:assert/strict";
import test from "node:test";
import { parseServerMessage, parseScreenShareStream, parseVoiceAudioBridgeStats, type ServerMessage } from "./server-messages.js";
import { SCREEN_SHARE_LEGACY_AVATAR_BUDGET } from "./screen-share.js";

const stream = {
  streamId: "stream-1", source: "browser" as const, ownerPeerId: "owner", ownerClientId: 1,
  ownerNickname: "Owner", name: "Screen", audio: true, createdAt: 1_000, viewerCount: 0, viewers: [],
};
const event = { id: "event-1", kind: "joined", message: "Member joined", timestamp: 1_000 };
const samples: Record<ServerMessage["type"], ServerMessage> = {
  connected: { type: "connected", tsClientId: 1, members: [{ id: 1, nickname: "Owner" }], serverEventLog: [event] },
  serverInfo: {
    type: "serverInfo", name: "兄弟们的teamspeak", icon: "data:image/png;base64,iVBORw0KGgo=",
    bannerUrl: "https://assets.example.invalid/teamspeak/banner.png", welcomeMessage: "欢迎来到服务器！\n请遵守频道规则。",
  },
  memberEnter: { type: "memberEnter", id: 2, nickname: "Visitor", uid: "uid-2", isSelf: false },
  memberLeave: { type: "memberLeave", id: 2 },
  memberAvatar: { type: "memberAvatar", id: 2, avatar: "data:image/png;base64,test" },
  channelList: { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", maxClients: 10, maxClientsLimited: true, passwordProtected: true, members: [{ id: 1, nickname: "Owner" }] }] },
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
    { type: "serverInfo", name: "TeamSpeak", icon: "https://example.com/icon.png" },
    { type: "serverInfo", name: "TeamSpeak", bannerUrl: "javascript:alert(1)" },
    { type: "serverInfo", name: "TeamSpeak", welcomeMessage: "x".repeat(4_097) },
    { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", members: [{}] }] },
    { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", maxClients: 10 }] },
    { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", maxClients: 65536, maxClientsLimited: true }] },
    { type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", passwordProtected: "yes" }] },
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

test("screen share viewers carry a client id and still accept a legacy inline avatar", () => {
  const message = parseServerMessage({
    type: "screenShareList",
    streams: [{
      streamId: "s", ownerPeerId: "owner",
      viewers: [
        { peerId: "v1", nickname: "One", clientId: 42 },
        { peerId: "v2", nickname: "Two", avatar: "data:image/png;base64,AAAA" },
        { peerId: "v3", nickname: "Three", clientId: -1 },
        { peerId: "v4", nickname: "Four", clientId: 70_000 },
      ],
    }],
  });
  assert.ok(message?.type === "screenShareList");
  const viewers = message.streams[0]?.viewers ?? [];
  assert.equal(viewers.length, 4);
  assert.equal(viewers[0]?.clientId, 42);
  assert.equal("avatar" in viewers[0]!, false);
  // An older gateway still inlines the avatar; keep honouring it.
  assert.equal(viewers[1]?.avatar, "data:image/png;base64,AAAA");
  assert.equal(viewers[1]?.clientId, undefined);
  // Out-of-range ids are dropped rather than forwarded.
  assert.equal(viewers[2]?.clientId, undefined);
  assert.equal(viewers[3]?.clientId, undefined);
});

test("legacy inline avatars are bounded in total, not merely per entry", () => {
  const avatar = `data:image/png;base64,${"A".repeat(128 * 1024 - 22)}`;
  const message = parseServerMessage({
    type: "screenShareList",
    streams: [{
      streamId: "s", ownerPeerId: "owner",
      viewers: Array.from({ length: 8 }, (_, index) => ({ peerId: `v${index}`, nickname: `n${index}`, avatar })),
    }],
  });
  assert.ok(message?.type === "screenShareList");
  const viewers = message.streams[0]?.viewers ?? [];
  assert.equal(viewers.length, 8, "entries are kept even when their avatar is dropped");
  const accepted = viewers.reduce((total, viewer) => total + (viewer.avatar?.length ?? 0), 0);
  assert.ok(
    accepted <= SCREEN_SHARE_LEGACY_AVATAR_BUDGET,
    `accepted avatar bytes must stay within the roster budget, got ${accepted}`,
  );
  assert.ok(accepted > 0, "the legacy path still renders the leading avatars");
  assert.ok(viewers.some(viewer => viewer.avatar === undefined), "entries past the budget must fall back to a local lookup");
});
