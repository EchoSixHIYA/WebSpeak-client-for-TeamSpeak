import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { computed, effectScope, nextTick, ref } from "vue";

// Exercise the actual composable and shared wire parser. Only browser/network
// boundaries are simulated; these tests make no claim about real audio quality.
class TestSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  readyState = TestSocket.OPEN;
  bufferedAmount = 0;
  messages = [];
  constructor(url) { this.url = url; TestSocket.instances.push(this); }
  send(raw) { this.messages.push(typeof raw === "string" ? JSON.parse(raw) : raw); }
  close(code = 1000) { this.readyState = TestSocket.CLOSED; this.onclose?.({ code, reason: "" }); }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

class TestTrack extends EventTarget {
  kind = "video";
  readyState = "live";
  stopped = 0;
  stop() { this.stopped++; this.readyState = "ended"; }
  getSettings() { return { displaySurface: "monitor", width: 1920, height: 1080, frameRate: 60 }; }
  async applyConstraints() {}
}

class AudioNodeStub {
  gain = { value: 1 };
  disconnects = 0;
  connect() {}
  disconnect() { this.disconnects++; }
}
class AudioSourceStub extends EventTarget {
  static failStart = false;
  stopped = 0;
  disconnects = 0;
  connect() {}
  disconnect() { this.disconnects++; }
  start(time) { if (AudioSourceStub.failStart) throw new Error("Source cannot start"); this.startedAt = time; }
  stop() { this.stopped++; }
}
class AudioDecoderStub {
  static instances = [];
  static failConfigure = false;
  decodeQueueSize = 0;
  closed = 0;
  constructor(callbacks) { this.callbacks = callbacks; AudioDecoderStub.instances.push(this); }
  configure() { if (AudioDecoderStub.failConfigure) throw new Error("Codec unavailable"); }
  decode(chunk) { this.lastChunk = chunk; }
  close() { this.closed++; }
}
class RecorderStub {
  static instances = [];
  static failStart = false;
  state = "inactive";
  mimeType = "audio/webm";
  stops = 0;
  constructor(stream) { this.stream = stream; RecorderStub.instances.push(this); }
  start() { if (RecorderStub.failStart) throw new Error("Recorder start failed"); this.state = "recording"; }
  stop() { this.stops++; this.state = "inactive"; }
  finish() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["audio"]) }); this.onstop?.(); }
}
function decodedChunk() {
  return { sampleRate: 48000, numberOfChannels: 1, numberOfFrames: 960, closed: 0, copyTo() {}, close() { this.closed++; } };
}
function receiveAudio(socket, clientId = 7) {
  socket.onmessage({ data: new Uint8Array([4, clientId >> 8, clientId & 255, 1, 2, 3]).buffer });
}
class AudioContextStub extends EventTarget {
  static instances = [];
  static processors = [];
  static sources = [];
  static gains = [];
  static mediaSources = [];
  static destinations = [];
  state = "running";
  currentTime = 0;
  sampleRate = 48000;
  destination = new AudioNodeStub();
  constructor() { super(); AudioContextStub.instances.push(this); }
  async setSinkId(id) { this.sinkId = id; }
  close() { this.state = "closed"; return Promise.resolve(); }
  createMediaStreamSource(stream) {
    if (this.state === "closed") throw new Error("Audio context closed");
    const node = Object.assign(new AudioNodeStub(), { stream });
    AudioContextStub.mediaSources.push(node);
    return node;
  }
  createMediaStreamDestination() {
    const node = Object.assign(new AudioNodeStub(), { stream: microphoneStream() });
    AudioContextStub.destinations.push(node);
    return node;
  }
  createGain() { const node = new AudioNodeStub(); AudioContextStub.gains.push(node); return node; }
  createAnalyser() { throw new Error("Analyser unavailable"); }
  createBuffer(channels, frames, sampleRate) { return { duration: frames / sampleRate, copyToChannel() {} }; }
  createBufferSource() { const node = new AudioSourceStub(); AudioContextStub.sources.push(node); return node; }
  createScriptProcessor() { const node = new AudioNodeStub(); AudioContextStub.processors.push(node); return node; }
}
function microphoneStream() {
  const track = new TestTrack();
  track.kind = "audio";
  return { track, getTracks: () => [track], getVideoTracks: () => [], getAudioTracks: () => [track] };
}

function displayStream() {
  const track = new TestTrack();
  return { track, getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class TestPeer extends EventTarget {
  static instances = [];
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription = null;
  remoteDescription = null;
  sender = { track: null, replaceTrack: async track => { this.sender.track = track; } };
  constructor(config) { super(); this.config = config; TestPeer.instances.push(this); }
  addTrack(track) { this.sender.track = track; }
  getSenders() { return [this.sender]; }
  async createOffer() { return { type: "offer", sdp: "test-offer" }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription(description) { this.remoteDescription = description; }
  close() { this.connectionState = "closed"; }
}

const browserTimers = new Set();
const audioElements = new Set();
class TestAudioElement extends EventTarget {
  style = {};
  async play() {}
  pause() {}
  setAttribute() {}
  remove() { audioElements.delete(this); }
}

let vite;
let useVoiceWebSocket;
let useWebClientAudioControls;
let useWebClientI18n;
let useWebClientChat;
let useWebClientChannels;
let webClientTranslations;
let voice;
const savedGlobals = new Map();
function replaceGlobal(name, value) {
  if (!savedGlobals.has(name)) savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

before(async () => {
  // The noise-suppression library declares a worklet subclass at import time.
  replaceGlobal("AudioWorkletNode", class {});
  vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
  ({ useVoiceWebSocket } = await vite.ssrLoadModule("/src/composables/useVoiceWebSocket.ts"));
  ({ useWebClientAudioControls } = await vite.ssrLoadModule("/src/composables/useWebClientAudioControls.ts"));
  ({ useWebClientI18n } = await vite.ssrLoadModule("/src/composables/useWebClientI18n.ts"));
  ({ useWebClientChat } = await vite.ssrLoadModule("/src/composables/useWebClientChat.ts"));
  ({ useWebClientChannels } = await vite.ssrLoadModule("/src/composables/useWebClientChannels.ts"));
  ({ webClientTranslations } = await vite.ssrLoadModule("/src/i18n/web-client.ts"));
});

beforeEach(() => {
  TestSocket.instances.length = 0;
  TestPeer.instances.length = 0;
  AudioContextStub.processors.length = 0;
  AudioContextStub.instances.length = 0;
  AudioContextStub.sources.length = 0;
  AudioContextStub.gains.length = 0;
  AudioContextStub.mediaSources.length = 0;
  AudioContextStub.destinations.length = 0;
  AudioDecoderStub.instances.length = 0;
  AudioDecoderStub.failConfigure = false;
  AudioSourceStub.failStart = false;
  RecorderStub.instances.length = 0;
  RecorderStub.failStart = false;
  audioElements.clear();
  replaceGlobal("RTCPeerConnection", TestPeer);
  replaceGlobal("window", Object.assign(new EventTarget(), {
    setTimeout(callback, ms) {
      const timer = setTimeout(() => { browserTimers.delete(timer); callback(); }, ms);
      browserTimers.add(timer);
      return timer;
    },
    clearTimeout(timer) { clearTimeout(timer); browserTimers.delete(timer); },
  }));
  replaceGlobal("document", Object.assign(new EventTarget(), {
    createElement: () => new TestAudioElement(),
    body: { append: element => audioElements.add(element) },
  }));
  replaceGlobal("WebSocket", TestSocket);
  replaceGlobal("location", { protocol: "https:", host: "gateway.example" });
  replaceGlobal("fetch", async () => ({ ok: true, json: async () => ({ ticket: "test-ticket" }) }));
  replaceGlobal("AudioContext", AudioContextStub);
  replaceGlobal("AudioWorkletNode", class {});
  replaceGlobal("AudioDecoder", AudioDecoderStub);
  replaceGlobal("MediaRecorder", RecorderStub);
  const storage = new Map();
  replaceGlobal("localStorage", { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) });
  replaceGlobal("EncodedAudioChunk", class { constructor(init) { Object.assign(this, init); } });
  replaceGlobal("HTMLMediaElement", class {});
  replaceGlobal("navigator", { mediaDevices: {
    getDisplayMedia: async () => displayStream(),
    getUserMedia: async () => microphoneStream(),
    enumerateDevices: async () => [],
  } });
  voice = useVoiceWebSocket();
});

afterEach(() => {
  voice?.stopMicrophoneTest();
  voice?.disconnect();
  for (const timer of browserTimers) clearTimeout(timer);
  browserTimers.clear();
});
after(async () => {
  await vite?.close();
  for (const [name, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

async function connect() {
  voice.connect("voice.example:9987", "", "Visitor");
  await nextTurn();
  const socket = TestSocket.instances.at(-1);
  assert.ok(socket, "join ticket should open a voice socket");
  return socket;
}

test("directory snapshots keep member names, flags and identity-scoped volume in sync", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "old-user", nickname: "Before" }] });
  voice.setVolume(7, 0.3);
  const memberList = voice.members;
  const channelList = voice.channels;
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", members: [
    { id: 7, uid: "old-user", nickname: "Renamed", away: true, awayMessage: "Lunch", inputMuted: true, outputMuted: true, channelCommander: true },
    { id: 1, uid: "self", nickname: "Visitor" },
  ] }] });
  assert.equal(voice.members, memberList);
  assert.equal(voice.channels, channelList);
  assert.equal(voice.members.find(member => member.id === 7).nickname, "Renamed");
  assert.equal(voice.members.find(member => member.id === 7).awayMessage, "Lunch");
  assert.equal(voice.members.find(member => member.id === 7).inputMuted, true);
  assert.equal(voice.members.find(member => member.id === 1).isSelf, true);
  assert.equal(voice.volumes[7], 0.3);
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", members: [
    { id: 7, uid: "replacement-user", nickname: "Replacement" },
  ] }] });
  assert.deepEqual(voice.members.map(member => member.id), [7]);
  assert.equal(voice.members[0].uid, "replacement-user");
  assert.equal(voice.members[0].away, undefined);
  assert.equal(voice.volumes[7] ?? 1, 1, "a reused numeric ID must not inherit the previous member's gain");
});

test("member-enter preserves status fields and updates an already listed member", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  socket.receive({ type: "memberEnter", id: 7, uid: "user", nickname: "Before", away: true,
    awayMessage: "Away", inputMuted: true, outputMuted: true, channelCommander: true });
  assert.equal(voice.members[0].awayMessage, "Away");
  assert.equal(voice.members[0].outputMuted, true);
  assert.equal(voice.members[0].channelCommander, true);
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", members: [...voice.members] }] });
  socket.receive({ type: "memberEnter", id: 7, uid: "user", nickname: "After", away: false, inputMuted: false });
  assert.equal(voice.members.length, 1);
  assert.equal(voice.members[0].nickname, "After");
  assert.equal(voice.channels[0].members[0].nickname, "After");
  assert.equal(voice.channels[0].members[0].inputMuted, false);
});

test("member departure immediately removes every directory projection and per-ID state", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "user", nickname: "Leaving" }] });
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", members: [...voice.members] }] });
  socket.receive({ type: "whisperTargets", targetIds: [7], active: true });
  voice.setVolume(7, 0.5);
  socket.receive({ type: "memberLeave", id: 7 });
  assert.equal(voice.members.length, 0);
  assert.equal(voice.channels[0].members.length, 0);
  assert.equal(voice.volumes[7], undefined);
  assert.equal(voice.whisperTargetIds.has(7), false);
  assert.equal(voice.whisperActive.value, false);
});

test("omitted channel members preserve known data and avatars reject a different UID", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "user", nickname: "Visitor" }] });
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", members: [...voice.members] }] });
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: "Renamed lobby" }] });
  assert.equal(voice.members.length, 1);
  assert.equal(voice.channels[0].members?.[0]?.nickname, "Visitor");
  socket.receive({ type: "memberAvatar", id: 7, uid: "other-user", avatar: "wrong" });
  assert.equal(voice.members[0].avatar, undefined);
  socket.receive({ type: "memberAvatar", id: 7, uid: "user", avatar: "correct" });
  assert.equal(voice.members[0].avatar, "correct");
  assert.equal(voice.channels[0].members[0].avatar, "correct");
});

test("explicit disconnect and replacement target clear all session history and notifications", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  const history = voice.serverEvents;
  const pokes = voice.pokeNotifications;
  socket.receive({ type: "serverEvent", event: { id: "event", kind: "joined", message: "Old server", timestamp: 1 } });
  socket.receive({ type: "pokeReceived", invokerId: 7, invokerUid: "old-user", invokerName: "Old user", message: "Old poke" });
  voice.disconnect();
  assert.equal(history.length, 0);
  assert.equal(pokes.length, 0);
  await connect();
  assert.equal(voice.serverEvents, history);
  assert.equal(voice.pokeNotifications, pokes);
  assert.equal(pokes.length, 0);
});

test("a recovered session replaces its directory even when the gateway omits members", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "old-user", nickname: "Previous" }] });
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby", members: [...voice.members] }] });
  socket.receive({ type: "chatMessage", invokerId: 7, invokerName: "Previous", message: "Keep room history", scope: "channel" });
  socket.receive({ type: "disconnected", recoverable: true });
  assert.equal(voice.chatMessages.length, 1);
  socket.receive({ type: "connected", tsClientId: 2 });
  assert.equal(voice.members.length, 0);
  assert.equal(voice.channels.length, 0);
  assert.equal(voice.chatMessages.length, 1, "same-socket recovery may retain historical messages");
});

function chatView(t, overrides = {}) {
  const scope = effectScope();
  t.after(() => scope.stop());
  return scope.run(() => useWebClientChat({
    messages: voice.chatMessages, members: voice.members,
    currentChannel: ref({ id: "1", parentID: "0", name: "Lobby" }), currentChannelName: ref("Lobby"),
    selectedChannelId: ref("1"), clientId: computed(() => voice.state.tsClientId),
    connected: computed(() => voice.state.connected), sessionEpoch: voice.sessionEpoch, serverKey: ref("example.test:9987"),
    memberConversationKey: id => voice.memberConversationKey(id),
    isMobileViewport: ref(false), mobileSection: ref("chat"), closeMemberMenu() {}, notifyPrivateMessage() {},
    sendTextMessage: voice.sendTextMessage, sendServerMessage: voice.sendServerMessage, sendPrivateMessage: voice.sendPrivateMessage,
    t: key => key, ...overrides,
  }));
}

function chatScroller(chat) {
  const calls = [];
  chat.listElement.value = {
    scrollHeight: 1200, clientHeight: 400, scrollTop: 800,
    scrollTo(options) { calls.push(options); this.scrollTop = this.scrollHeight - this.clientHeight; },
  };
  return calls;
}

test("incoming chat preserves history reading and follows again when the reader returns to the bottom", async t => {
  const chat = chatView(t);
  const calls = chatScroller(chat);
  chat.listElement.value.scrollTop = 100;
  chat.onScroll();
  voice.chatMessages.push({ id: "incoming-1", scope: "channel", message: "Hello", timestamp: 1 });
  await nextTick();
  await nextTick();
  assert.equal(calls.length, 0);
  chat.scrollIfFollowing(); // Keyboard resizing must also preserve the reading position.
  await nextTick();
  assert.equal(calls.length, 0);
  chat.listElement.value.scrollTop = 800;
  chat.onScroll();
  voice.chatMessages.push({ id: "incoming-2", scope: "channel", message: "Latest", timestamp: 2 });
  await nextTick();
  await nextTick();
  assert.deepEqual(calls, [{ top: 1200, behavior: "auto" }]);
});

test("own messages and conversation switches reveal the latest message, unrelated chat does not move the list", async t => {
  const chat = chatView(t);
  const calls = chatScroller(chat);
  chat.listElement.value.scrollTop = 100;
  chat.onScroll();
  voice.chatMessages.push({ id: "elsewhere", scope: "server", message: "Other conversation", timestamp: 1 });
  await nextTick();
  await nextTick();
  assert.equal(calls.length, 0);
  voice.chatMessages.push({ id: "own", scope: "channel", message: "Sent", timestamp: 2, isSelf: true });
  await nextTick();
  await nextTick();
  assert.equal(calls.length, 1);
  chat.listElement.value.scrollTop = 100;
  chat.onScroll();
  chat.tab.value = "server";
  await nextTick();
  await nextTick();
  assert.ok(calls.length > 1);
  assert.equal(chat.listElement.value.scrollTop, 800);
});

test("chat history stays scoped to its channel, server, or private conversation", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "alice", nickname: "Alice" }] });
  const chat = chatView(t, { currentChannel: ref(undefined) });
  voice.chatMessages.push(
    { id: "history-channel-current", scope: "channel", targetId: "1", invokerName: "Alice", message: "Current room", timestamp: 1, isHistory: true },
    { id: "history-channel-other", scope: "channel", targetId: "2", invokerName: "Alice", message: "Other room", timestamp: 2, isHistory: true },
    { id: "history-channel-legacy", scope: "channel", invokerName: "Alice", message: "Legacy room message", timestamp: 3, isHistory: true },
    { id: "history-server", scope: "server", invokerName: "Alice", message: "Server message", timestamp: 4, isHistory: true },
    { id: "history-private", scope: "private", conversationId: "7", conversationKey: "uid:alice", conversationName: "Alice", invokerName: "Alice", message: "Private message", timestamp: 5, isHistory: true },
  );

  assert.deepEqual(chat.visibleMessages.value.map(message => message.id), ["history-channel-current", "history-channel-legacy"]);
  chat.tab.value = "server";
  assert.deepEqual(chat.visibleMessages.value.map(message => message.id), ["history-server"]);
  chat.openPrivateChat(7);
  assert.deepEqual(chat.visibleMessages.value.map(message => message.id), ["history-private"]);
  assert.equal(chat.conversations.value[0].name, "Alice");
});

test("opening a first private chat creates its tab and expands a collapsed chat panel", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "alice", nickname: "Alice" }] });
  const chat = chatView(t);
  chat.togglePanel();
  assert.equal(chat.panelOpen.value, false);

  chat.openPrivateChat(7);
  assert.equal(chat.tab.value, "private");
  assert.equal(chat.panelOpen.value, true);
  assert.deepEqual(chat.conversations.value.map(conversation => conversation.name), ["Alice"]);
  assert.equal(chat.visibleMessages.value.length, 0, "a new conversation still renders its empty state");
});

test("hidden mobile chat defers scrolling until shown and ignores zero-height scroll events", async t => {
  const section = ref("voice");
  const chat = chatView(t, { isMobileViewport: ref(true), mobileSection: section });
  const calls = chatScroller(chat);
  chat.listElement.value.clientHeight = 0;
  chat.onScroll();
  voice.chatMessages.push({ id: "mobile", scope: "channel", message: "Hello", timestamp: 1 });
  await nextTick();
  await nextTick();
  assert.equal(calls.length, 0);
  chat.listElement.value.clientHeight = 400;
  section.value = "chat";
  await nextTick();
  await nextTick();
  assert.equal(calls.length, 1);
});

test("chat cannot create a local success while disconnected or recovering", async () => {
  await assert.rejects(async () => voice.sendServerMessage("Offline"));
  assert.equal(voice.chatMessages.length, 0);
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  socket.receive({ type: "reconnecting", attempt: 1 });
  await assert.rejects(async () => voice.sendTextMessage("Recovering", "1"));
  assert.equal(socket.messages.some(message => message.type === "sendTextMessage"), false);
  assert.equal(voice.chatMessages.length, 0);
});

test("chat waits for acknowledgement and keeps server rejection out of successful history", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  const sent = voice.sendServerMessage(" Hello ");
  assert.equal(voice.chatMessages.length, 0);
  const command = socket.messages.at(-1);
  assert.ok(command.requestId);
  socket.receive({ type: "chatMessage", invokerId: 1, message: "Hello", scope: "server" });
  socket.receive({ type: "commandCompleted", requestId: command.requestId });
  await sent;
  assert.equal(voice.chatMessages.length, 1);
  assert.equal(voice.chatMessages[0].message, "Hello");
  const rejected = voice.sendServerMessage("Refused");
  const rejection = assert.rejects(rejected, error => error.code === "PERMISSION_DENIED");
  socket.receive({ type: "error", requestId: socket.messages.at(-1).requestId, error: { code: "PERMISSION_DENIED", message: "Refused" } });
  await rejection;
  assert.equal(voice.chatMessages.length, 1);
});

test("acknowledgement queued immediately before replacement cannot append into the new room", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  const sent = voice.sendServerMessage("Old room");
  const rejected = assert.rejects(sent);
  socket.receive({ type: "commandCompleted", requestId: socket.messages.at(-1).requestId });
  voice.disconnect();
  await rejected;
  assert.equal(voice.chatMessages.length, 0);
});

test("chat submission keeps rejected drafts, coalesces clicks and preserves newer typing", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  let pending = deferred(), calls = 0;
  const chat = chatView(t, { sendTextMessage: () => { calls++; return pending.promise; } });
  chat.messageDraft.value = "Keep this";
  const first = chat.submitMessage();
  const duplicate = chat.submitMessage();
  assert.equal(calls, 1);
  pending.reject(new Error("Rejected"));
  await Promise.all([first, duplicate]);
  assert.equal(chat.messageDraft.value, "Keep this");
  assert.equal(chat.sendError.value, "chatSendFailed");
  pending = deferred();
  const next = chat.submitMessage();
  chat.messageDraft.value = "New typing";
  pending.resolve();
  await next;
  assert.equal(chat.messageDraft.value, "New typing");
  pending = deferred();
  const final = chat.submitMessage();
  pending.resolve();
  await final;
  assert.equal(chat.messageDraft.value, "");
});

test("changing servers resets private selection and draft before another member reuses the ID", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "old", nickname: "Old" }] });
  const chat = chatView(t);
  chat.openPrivateChat(7);
  chat.messageDraft.value = "Old private draft";
  voice.connect("different.example:9987", "", "Visitor");
  await nextTurn();
  TestSocket.instances.at(-1).receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "new", nickname: "New" }] });
  await nextTick();
  assert.equal(chat.privateClientId.value, 0);
  assert.equal(chat.tab.value, "channel");
  assert.equal(chat.messageDraft.value, "");
});

test("private history and selection do not follow a reused client ID", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "old", nickname: "Old" }] });
  const chat = chatView(t);
  socket.receive({ type: "chatMessage", scope: "private", invokerId: 7, senderUid: "old", invokerName: "Old", message: "Old private message" });
  chat.openPrivateChat(7);
  chat.messageDraft.value = "For old user";
  socket.receive({ type: "memberLeave", id: 7 });
  socket.receive({ type: "memberEnter", id: 7, uid: "new", nickname: "New" });
  await nextTick();
  await chat.submitMessage();
  assert.equal(socket.messages.some(message => message.type === "sendPrivateMessage"), false);
  assert.equal(chat.messageDraft.value, "For old user");
  assert.equal(chat.conversations.value[0].name, "Old");
  chat.openPrivateChat(7);
  assert.equal(chat.visibleMessages.value.length, 0, "the new member does not inherit the old member's private history");
});

test("a retired chat submission cannot clear or report errors in the next session", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  const pending = deferred();
  const chat = chatView(t, { sendTextMessage: () => pending.promise });
  chat.messageDraft.value = "Same text";
  const submitting = chat.submitMessage();
  voice.disconnect();
  await nextTick();
  chat.messageDraft.value = "Same text";
  pending.resolve();
  await submitting;
  assert.equal(chat.messageDraft.value, "Same text");
  assert.equal(chat.sendError.value, "");
});

test("private sends carry the recipient UID and confirmed history keeps the recipient name", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "recipient", nickname: "Alice" }] });
  const chat = chatView(t);
  chat.openPrivateChat(7);
  chat.messageDraft.value = "Private";
  const sent = chat.submitMessage();
  const command = socket.messages.at(-1);
  assert.equal(command.payload.clientUid, "recipient");
  socket.receive({ type: "commandCompleted", requestId: command.requestId });
  await sent;
  socket.receive({ type: "memberLeave", id: 7 });
  assert.equal(chat.conversations.value[0].name, "Alice");
  assert.equal(chat.visibleMessages.value[0].message, "Private");
  assert.equal(chat.messageDraft.value, "");
});

test("legacy members without UIDs get fresh private scopes after departure and recovery", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, nickname: "Legacy" }] });
  const chat = chatView(t);
  chat.openPrivateChat(7);
  const before = chat.privateConversationKey.value;
  socket.receive({ type: "chatMessage", scope: "private", invokerId: 7, invokerName: "Legacy", message: "Old" });
  assert.equal(chat.visibleMessages.value.length, 1);
  socket.receive({ type: "memberLeave", id: 7 });
  socket.receive({ type: "memberEnter", id: 7, nickname: "Another" });
  chat.openPrivateChat(7);
  assert.notEqual(chat.privateConversationKey.value, before);
  assert.equal(chat.visibleMessages.value.length, 0);
  const second = chat.privateConversationKey.value;
  socket.receive({ type: "disconnected", recoverable: true });
  socket.receive({ type: "connected", tsClientId: 2, members: [{ id: 7, nickname: "Recovered" }] });
  assert.notEqual(voice.memberConversationKey(7), second);
  assert.equal(chat.canSend.value, false);
});

test("leaving the chat scope retires pending feedback and manual submission", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  const pending = deferred();
  let calls = 0;
  const scope = effectScope();
  const chat = scope.run(() => chatView({ after: cleanup => t.after(cleanup) }, { sendTextMessage: () => { calls++; return pending.promise; } }));
  chat.messageDraft.value = "Keep";
  const sent = chat.submitMessage();
  scope.stop();
  pending.reject(new Error("Late rejection"));
  await sent;
  await chat.submitMessage();
  assert.equal(calls, 1);
  assert.equal(chat.messageDraft.value, "Keep");
  assert.equal(chat.sendError.value, "");
});

test("chat feedback is translated in all five languages", () => {
  for (const key of ["chatSending", "chatSendFailed", "chatNotConnected", "chatTargetUnavailable", "chatChannelChanged"]) {
    const values = ["zh", "en", "de", "ru", "ja"].map(language => webClientTranslations[language][key]);
    assert.ok(values.every(value => typeof value === "string" && value.length > 0));
    assert.equal(new Set(values).size, 5);
  }
});

test("returning to a pending conversation cannot submit it twice", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  let calls = 0;
  const pending = deferred();
  const chat = chatView(t, { sendTextMessage: () => { calls++; return pending.promise; } });
  chat.messageDraft.value = "In flight";
  const sending = chat.submitMessage();
  chat.tab.value = "server";
  chat.messageDraft.value = "Server draft";
  chat.tab.value = "channel";
  const duplicate = chat.submitMessage();
  assert.equal(calls, 1);
  chat.tab.value = "server";
  pending.resolve();
  await Promise.all([sending, duplicate]);
  assert.equal(chat.messageDraft.value, "Server draft");
  chat.tab.value = "channel";
  assert.equal(chat.messageDraft.value, "", "acknowledgement clears only the submitted conversation's unchanged draft");
});

test("an unidentified private sender cannot become a later member with the same numeric ID", async t => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  const chat = chatView(t);
  socket.receive({ type: "chatMessage", scope: "private", invokerId: 7, invokerName: "Unknown old sender", message: "Old" });
  socket.receive({ type: "memberEnter", id: 7, nickname: "New legacy member" });
  chat.openPrivateChat(7);
  assert.equal(chat.visibleMessages.value.length, 0);
  assert.equal(chat.conversations.value[0].name, "Unknown old sender");
});

function channelView(t, channels) {
  const scope = effectScope();
  t.after(() => scope.stop());
  return scope.run(() => useWebClientChannels({ channels, members: [], clientId: ref(1), selectedChannelId: ref(""),
    channelName: ref(""), memberQuery: ref(""), whisperTargetIds: new Set(), t: key => key }));
}

test("cyclic, orphaned and duplicate channel entries produce a finite unique tree", t => {
  const view = channelView(t, [
    { id: "1", parentID: "1", name: "Self cycle" },
    { id: "2", parentID: "3", name: "Cycle A" }, { id: "3", parentID: "2", name: "Cycle B" },
    { id: "4", parentID: "99", name: "Orphan" }, { id: "4", parentID: "0", name: "Duplicate" },
  ]);
  assert.equal(view.channelTree.value.length, 4);
  assert.equal(new Set(view.channelTree.value.map(channel => channel.id)).size, 4);
  assert.equal(view.channelTree.value.find(channel => channel.id === "4").name, "Orphan");
  assert.ok(view.channelTree.value.every(channel => channel.depth >= 0 && channel.depth <= 1));
});

test("channel traversal preserves sibling predecessors and handles a deep directory without recursion", t => {
  const normal = channelView(t, [
    { id: "3", parentID: "0", order: "2", name: "Third" }, { id: "2", parentID: "0", order: "1", name: "Second" },
    { id: "1", parentID: "0", order: "0", name: "First" }, { id: "4", parentID: "1", name: "Child" },
  ]);
  assert.deepEqual(normal.channelTree.value.map(channel => [channel.id, channel.depth]), [["1", 0], ["4", 1], ["2", 0], ["3", 0]]);
  const deep = channelView(t, Array.from({ length: 5_000 }, (_, index) => ({ id: String(index + 1), parentID: String(index), name: "Deep" })).reverse());
  assert.equal(deep.channelTree.value.length, 5_000);
  assert.equal(deep.channelTree.value.at(-1).depth, 4_999);
});

async function connectWebRtc() {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true });
  await nextTurn();
  assert.ok(socket.messages.some(message => message.type === "webrtcOffer"));
  return { socket, peer: TestPeer.instances.at(-1) };
}

function enableMicrophoneMeter(t) {
  const analysers = [];
  const intervals = [];
  const cleared = [];
  t.mock.method(AudioContextStub.prototype, "createAnalyser", () => {
    const analyser = Object.assign(new AudioNodeStub(), { fftSize: 512, level: 0.1, reads: 0,
      getFloatTimeDomainData(samples) { this.reads++; samples.fill(this.level); } });
    analysers.push(analyser);
    return analyser;
  });
  t.mock.method(globalThis, "setInterval", (callback, delay) => {
    const timer = { callback, delay };
    intervals.push(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearInterval", timer => { cleared.push(timer); });
  return { analysers, intervals, cleared };
}

function controlRequestTimers(t) {
  const active = new Set();
  const scheduled = [];
  const set = globalThis.setTimeout;
  const clear = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    if (delay !== 8_000 && delay !== 15_000) return set(callback, delay, ...args);
    const timer = { delay, callback };
    active.add(timer);
    scheduled.push(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", timer => {
    if (scheduled.includes(timer)) active.delete(timer);
    else clear(timer);
  });
  return { active, scheduled, fire(timer) { assert.ok(timer, "a request deadline must exist"); active.delete(timer); timer.callback(); } };
}

test("a command send failure rejects immediately and releases its deadline", async t => {
  const socket = await connect();
  const timers = controlRequestTimers(t);
  socket.send = () => { throw new Error("Socket cannot send"); };
  await assert.rejects(voice.moveClient(2, "1"), /Socket cannot send/);
  assert.equal(timers.active.size, 0);
});

test("confirmed and rejected commands release deadlines and preserve server error codes", async t => {
  const socket = await connect();
  const timers = controlRequestTimers(t);
  const moved = voice.moveClient(2, "1");
  const request = socket.messages.at(-1);
  assert.equal(request.type, "moveClient");
  socket.receive({ type: "commandCompleted", requestId: request.requestId });
  socket.receive({ type: "commandCompleted", requestId: request.requestId });
  await moved;
  assert.equal(timers.active.size, 0);
  const rejected = assert.rejects(voice.moveClient(3, "1"), { code: "PERMISSION_DENIED" });
  socket.receive({ type: "error", requestId: socket.messages.at(-1).requestId,
    error: { code: "PERMISSION_DENIED", message: "Permission denied" } });
  await rejected;
  assert.equal(timers.active.size, 0);
});

test("command timeout and disconnect settle once without touching replacement commands", async t => {
  const old = await connect();
  const oldMessage = old.onmessage;
  const timers = controlRequestTimers(t);
  const expired = assert.rejects(voice.moveClient(2, "1"), /操作超时/);
  const expiredRequest = old.messages.at(-1);
  timers.fire(timers.scheduled.at(-1));
  await expired;
  old.receive({ type: "commandCompleted", requestId: expiredRequest.requestId });
  const closed = assert.rejects(voice.moveClient(3, "1"), /语音连接已关闭/);
  const oldRequest = old.messages.at(-1);
  const oldTimer = timers.scheduled.at(-1);
  const current = await connect();
  await closed;
  assert.equal(timers.active.size, 0);
  let completed = false;
  const moved = voice.moveClient(4, "2").then(() => { completed = true; });
  const currentRequest = current.messages.at(-1);
  oldTimer.callback();
  oldMessage({ data: JSON.stringify({ type: "commandCompleted", requestId: currentRequest.requestId }) });
  current.receive({ type: "commandCompleted", requestId: oldRequest.requestId });
  await nextTurn();
  assert.equal(completed, false);
  assert.equal(timers.active.size, 1);
  current.receive({ type: "commandCompleted", requestId: currentRequest.requestId });
  await moved;
  assert.equal(timers.active.size, 0);
});

test("disconnect immediately aborts a pending join request and releases its deadline", async t => {
  const timers = controlRequestTimers(t);
  const response = deferred();
  let signal;
  globalThis.fetch = (_, options) => { signal = options.signal; return response.promise; };
  voice.connect("voice.example:9987", "", "Visitor");
  await nextTurn();
  voice.disconnect();
  assert.equal(signal?.aborted, true);
  assert.equal(timers.active.size, 0);
  response.reject(new Error("Late network failure"));
  await nextTurn();
  assert.equal(voice.state.errorCode, "");
  assert.equal(voice.state.connecting, false);
});

test("a replaced join request cannot read an old body or alter the new target", async t => {
  const timers = controlRequestTimers(t);
  const response = deferred();
  const requests = [];
  globalThis.fetch = (_, options) => {
    requests.push(options);
    return requests.length === 1 ? response.promise : Promise.resolve({ ok: true, json: async () => ({ ticket: "new-ticket" }) });
  };
  voice.connect("old.example:9987", "", "Old");
  await nextTurn();
  voice.connect("new.example:9987", "2", "New", "password", "identity", true, "invite", true, "relay");
  await nextTurn();
  assert.equal(requests[0].signal?.aborted, true);
  assert.deepEqual(JSON.parse(requests[1].body), { target: "new.example:9987", channel: "2", nickname: "New", serverPassword: "password", identity: "identity", rememberIdentity: true, invite: "invite", accelerated: true, accelerationRelayId: "relay" });
  let oldBodyReads = 0;
  response.resolve({ ok: true, json: async () => { oldBodyReads++; return { ticket: "old-ticket" }; } });
  await nextTurn();
  assert.equal(oldBodyReads, 0);
  assert.equal(TestSocket.instances.length, 1);
  assert.match(voice.ws.value.url, /ticket=new-ticket$/);
  assert.equal(timers.active.size, 0);
});

for (const phase of ["request", "body"]) {
  test(`the join deadline covers a hanging ${phase} and rejects its late result`, async t => {
    const timers = controlRequestTimers(t);
    const pending = deferred();
    let signal;
    globalThis.fetch = (_, options) => {
      signal = options.signal;
      return phase === "request" ? pending.promise : Promise.resolve({ ok: true, json: () => pending.promise });
    };
    voice.connect("voice.example:9987", "", "Visitor");
    await nextTurn();
    assert.equal(voice.state.connecting, true);
    timers.fire(timers.scheduled.at(-1));
    assert.equal(signal.aborted, true);
    assert.equal(voice.state.connecting, false);
    assert.equal(voice.state.errorCode, "REQUEST_TIMEOUT");
    assert.equal(timers.active.size, 0);
    pending.resolve(phase === "request" ? { ok: true, json: async () => ({ ticket: "late-ticket" }) } : { ticket: "late-ticket" });
    await nextTurn();
    assert.equal(TestSocket.instances.length, 0);
    assert.equal(voice.state.errorCode, "REQUEST_TIMEOUT");
  });
}

test("cancelling response-body parsing cannot report a failure in the replacement session", async t => {
  const timers = controlRequestTimers(t);
  const body = deferred();
  let signal;
  globalThis.fetch = async (_, options) => { signal = options.signal; return { ok: true, json: () => body.promise }; };
  voice.connect("old.example:9987", "", "Old");
  await nextTurn();
  const oldSignal = signal;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ticket: "new-ticket" }) });
  const current = await connect();
  assert.equal(oldSignal?.aborted, true);
  body.reject(new Error("Old body failed"));
  await nextTurn();
  assert.equal(voice.ws.value, current);
  assert.equal(voice.state.errorCode, "");
  assert.equal(timers.active.size, 0);
});

test("a rejected join request preserves its public error and clears its deadline", async t => {
  const timers = controlRequestTimers(t);
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ code: "INVITE_INVALID" }) });
  voice.connect("voice.example:9987", "", "Visitor");
  await nextTurn();
  assert.equal(voice.state.errorCode, "INVITE_INVALID");
  assert.equal(voice.state.connecting, false);
  assert.equal(TestSocket.instances.length, 0);
  assert.equal(timers.active.size, 0);
});

test("join timeouts explain the gateway wait in all five languages", async t => {
  const timers = controlRequestTimers(t);
  globalThis.fetch = () => new Promise(() => {});
  voice.connect("voice.example:9987", "", "Visitor");
  await nextTurn();
  timers.fire(timers.scheduled.at(-1));
  for (const language of ["zh", "en", "de", "ru", "ja"]) {
    const expected = webClientTranslations[language].joinRequestTimeout;
    assert.ok(expected, `${language} explicitly translates the request timeout`);
    assert.equal(useWebClientI18n(ref(language)).localizedMessage(voice.state.error), expected);
  }
});

test("a queued old join deadline cannot abort the replacement request", async t => {
  const timers = controlRequestTimers(t);
  const signals = [];
  const pending = deferred();
  globalThis.fetch = (_, options) => { signals.push(options.signal); return pending.promise; };
  voice.connect("old.example:9987", "", "Old");
  await nextTurn();
  const oldTimer = timers.scheduled.at(-1);
  voice.connect("new.example:9987", "", "New");
  await nextTurn();
  oldTimer.callback();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.equal(voice.state.connecting, true);
  assert.equal(voice.state.errorCode, "");
  assert.equal(timers.active.size, 1);
  pending.resolve({ ok: true, json: async () => ({ ticket: "current-ticket" }) });
  await nextTurn();
  assert.equal(TestSocket.instances.length, 1);
  assert.equal(timers.active.size, 0);
});

test("gateway close reasons survive generic errors and stale close callbacks", async () => {
  const old = await connect();
  const lateClose = old.onclose;
  old.onerror({});
  assert.equal(voice.state.errorCode, "");
  old.close(4005);
  assert.equal(voice.state.errorCode, "IDENTITY_IN_USE");
  const current = await connect();
  lateClose({ code: 4004, reason: "SERVER_REJECTED" });
  assert.equal(voice.ws.value, current);
  assert.equal(voice.state.errorCode, "");
});

test("a socket close failure cannot leave the session connected or retain socket handlers", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 1, nickname: "Self" }] });
  await nextTurn();
  socket.close = () => { throw new Error("Already disposed"); };
  assert.doesNotThrow(() => voice.disconnect());
  assert.equal(voice.ws.value, null);
  assert.equal(voice.state.connected, false);
  assert.equal(voice.members.length, 0);
  assert.equal(socket.onmessage, null);
  assert.equal(socket.onclose, null);
});

test("late control messages from a replaced socket cannot change the new session", async () => {
  const old = await connect();
  const lateMessage = old.onmessage;
  const current = await connect();
  current.receive({ type: "memberEnter", id: 2, nickname: "Current" });
  lateMessage({ data: JSON.stringify({ type: "memberEnter", id: 3, nickname: "Previous" }) });
  assert.deepEqual(voice.members.map(member => member.nickname), ["Current"]);
});

test("unexpected socket closure releases active screen capture and pending commands", async () => {
  const stream = displayStream();
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  const socket = await connect();
  await voice.startScreenShare();
  const start = socket.messages.find(message => message.type === "screenShareStart");
  socket.receive({ type: "screenShareStarted", requestId: start.requestId, owner: true,
    stream: { streamId: "share-1", ownerPeerId: "owner" } });
  assert.equal(voice.screenShareActive.value, true);
  const command = assert.rejects(voice.moveClient(2, "1"), /语音连接已关闭/);
  socket.close(1006);
  await command;
  assert.equal(stream.track.readyState, "ended");
  assert.equal(voice.screenShareActive.value, false);
  assert.equal(voice.screenShareStreams.length, 0);
  assert.equal(voice.ws.value, null);
});

test("screen permission resolved after socket closure releases the late stream", async () => {
  const capture = deferred();
  const stream = displayStream();
  navigator.mediaDevices.getDisplayMedia = () => capture.promise;
  const socket = await connect();
  const pendingStart = voice.startScreenShare();
  socket.close(1006);
  capture.resolve(stream);
  await pendingStart;
  assert.equal(stream.track.readyState, "ended");
  assert.equal(voice.screenShareStarting.value, false);
  assert.equal(socket.messages.some(message => message.type === "screenShareStart"), false);
});

test("shared message validation rejects malformed directories without disturbing valid state", async () => {
  const socket = await connect();
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: "Lobby" }] });
  socket.receive({ type: "channelList", channels: [{ id: "1", parentID: "0", name: { invalid: true } }] });
  assert.deepEqual(voice.channels.map(channel => channel.name), ["Lobby"]);
});

test("a microphone permission result after disconnect is cancelled and its track stopped", async () => {
  const permission = deferred();
  const stream = microphoneStream();
  navigator.mediaDevices.getUserMedia = () => permission.promise;
  const pending = voice.ensureMicrophone();
  const cancelled = assert.rejects(pending, { name: "AbortError" });
  voice.disconnect();
  permission.resolve(stream);
  await cancelled;
  assert.equal(stream.track.readyState, "ended");
  assert.equal(voice.state.microphoneErrorCode, "");
});

test("a new connection acquires its own microphone while old permission is still pending", async () => {
  const oldPermission = deferred();
  const oldStream = microphoneStream();
  let requests = 0;
  navigator.mediaDevices.getUserMedia = () => ++requests === 1 ? oldPermission.promise : Promise.resolve(microphoneStream());
  const first = await connect();
  first.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  const second = await connect();
  second.receive({ type: "connected", tsClientId: 2 });
  await nextTurn();
  const observedRequests = requests;
  oldPermission.resolve(oldStream);
  await nextTurn();
  assert.equal(observedRequests, 2);
  assert.equal(oldStream.track.readyState, "ended");
  assert.equal(voice.state.microphoneErrorCode, "");
});

test("accompaniment permission arriving after disconnect releases every returned track", async () => {
  await connectWebRtc();
  const permission = deferred();
  const stream = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = () => permission.promise;
  const pending = voice.startAccompaniment();
  voice.disconnect();
  permission.resolve(stream);
  await pending;
  assert.equal(stream.track.readyState, "ended");
  assert.equal(voice.accompanimentActive.value, false);
});

test("a superseded accompaniment capture cannot replace or stop its successor", async () => {
  await connectWebRtc();
  const firstPermission = deferred();
  const old = microphoneStream();
  const current = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = () => firstPermission.promise;
  const first = voice.startAccompaniment();
  navigator.mediaDevices.getDisplayMedia = async () => current;
  await voice.startAccompaniment();
  firstPermission.resolve(old);
  await first;
  assert.equal(old.track.readyState, "ended");
  assert.equal(current.track.readyState, "live");
  assert.equal(voice.accompanimentActive.value, true);
});

test("stopping accompaniment while constraints are pending cancels the capture", async () => {
  await connectWebRtc();
  const constraints = deferred();
  const stream = microphoneStream();
  stream.track.applyConstraints = () => constraints.promise;
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  const pending = voice.startAccompaniment();
  await nextTurn();
  await voice.stopAccompaniment();
  const stateAtStop = stream.track.readyState;
  constraints.resolve();
  await pending;
  assert.equal(stateAtStop, "ended", "cancellation must release capture before constraints settle");
  assert.equal(stream.track.readyState, "ended");
  assert.equal(voice.accompanimentActive.value, false);
});

test("an old accompaniment ended event cannot stop the replacement track", async () => {
  await connectWebRtc();
  const old = microphoneStream();
  const current = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = async () => old;
  await voice.startAccompaniment();
  navigator.mediaDevices.getDisplayMedia = async () => current;
  await voice.startAccompaniment();
  old.track.dispatchEvent(new Event("ended"));
  await nextTurn();
  assert.equal(current.track.readyState, "live");
  assert.equal(voice.accompanimentActive.value, true);
});

test("accompaniment allocation failure preserves the live microphone sender", async t => {
  const { socket, peer } = await connectWebRtc();
  const originalTrack = peer.sender.track;
  const candidate = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = async () => candidate;
  const context = AudioContextStub.instances.at(-1);
  const createSource = context.createMediaStreamSource.bind(context);
  t.mock.method(context, "createMediaStreamSource", stream => {
    if (stream === candidate) throw new Error("Cannot allocate accompaniment source");
    return createSource(stream);
  });
  await assert.rejects(voice.startAccompaniment(), /Cannot allocate/);
  assert.equal(originalTrack.readyState, "live");
  assert.equal(peer.sender.track, originalTrack);
  assert.equal(candidate.track.readyState, "ended");
  assert.equal(voice.accompanimentActive.value, false);
  assert.equal(socket.messages.some(message => message.type === "setAccompanimentActive" && message.payload.active), false);
});

test("failed accompaniment replacement keeps the previous capture and disconnects the candidate node", async t => {
  const { peer } = await connectWebRtc();
  const current = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = async () => current;
  await voice.startAccompaniment();
  const originalTrack = peer.sender.track;
  const candidate = microphoneStream();
  const failedNode = new AudioNodeStub();
  failedNode.connect = () => { throw new Error("Cannot connect accompaniment source"); };
  navigator.mediaDevices.getDisplayMedia = async () => candidate;
  const context = AudioContextStub.instances.at(-1);
  const createSource = context.createMediaStreamSource.bind(context);
  t.mock.method(context, "createMediaStreamSource", stream => stream === candidate ? failedNode : createSource(stream));
  await assert.rejects(voice.startAccompaniment(), /Cannot connect/);
  assert.equal(current.track.readyState, "live");
  assert.equal(voice.accompanimentActive.value, true);
  assert.equal(originalTrack.readyState, "live");
  assert.equal(candidate.track.readyState, "ended");
  assert.equal(failedNode.disconnects, 1);
});

test("starting and stopping accompaniment never ends the microphone sender track", async () => {
  const { peer } = await connectWebRtc();
  const originalTrack = peer.sender.track;
  const stream = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  await voice.startAccompaniment();
  assert.equal(originalTrack.readyState, "live");
  assert.equal(peer.sender.track, originalTrack);
  await voice.stopAccompaniment();
  assert.equal(originalTrack.readyState, "live");
  assert.equal(peer.sender.track, originalTrack);
  assert.equal(stream.track.readyState, "ended");
});

test("stopping accompaniment succeeds even when another output cannot be allocated", async t => {
  const { peer } = await connectWebRtc();
  const stream = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  await voice.startAccompaniment();
  const originalTrack = peer.sender.track;
  t.mock.method(AudioContextStub.instances.at(-1), "createMediaStreamDestination", () => { throw new Error("No output available"); });
  await voice.stopAccompaniment();
  assert.equal(originalTrack.readyState, "live");
  assert.equal(peer.sender.track, originalTrack);
  assert.equal(stream.track.readyState, "ended");
});

test("disconnect releases pending accompaniment without waiting for constraints", async () => {
  await connectWebRtc();
  const constraints = deferred();
  const stream = microphoneStream();
  stream.track.applyConstraints = () => constraints.promise;
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  const pending = voice.startAccompaniment();
  await nextTurn();
  voice.disconnect();
  const stateAtDisconnect = stream.track.readyState;
  constraints.resolve();
  await pending;
  assert.equal(stateAtDisconnect, "ended");
  assert.equal(voice.accompanimentActive.value, false);
});

test("a newer accompaniment request immediately releases an older pending candidate", async () => {
  await connectWebRtc();
  const constraints = deferred();
  const old = microphoneStream();
  old.track.applyConstraints = () => constraints.promise;
  navigator.mediaDevices.getDisplayMedia = async () => old;
  const pending = voice.startAccompaniment();
  await nextTurn();
  const current = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = async () => current;
  await voice.startAccompaniment();
  const oldStateAtReplacement = old.track.readyState;
  constraints.resolve();
  await pending;
  assert.equal(oldStateAtReplacement, "ended");
  assert.equal(current.track.readyState, "live");
  assert.equal(voice.accompanimentActive.value, true);
});

test("capture ended during accompaniment preparation is never announced as active", async () => {
  const { socket } = await connectWebRtc();
  const constraints = deferred();
  const stream = microphoneStream();
  stream.track.applyConstraints = () => constraints.promise;
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  const pending = voice.startAccompaniment();
  await nextTurn();
  stream.track.readyState = "ended";
  stream.track.dispatchEvent(new Event("ended"));
  constraints.resolve();
  await pending;
  assert.equal(voice.accompanimentActive.value, false);
  assert.equal(socket.messages.some(message => message.type === "setAccompanimentActive" && message.payload.active), false);
});

test("an optional content hint failure does not abandon or fail accompaniment capture", async () => {
  await connectWebRtc();
  const stream = microphoneStream();
  Object.defineProperty(stream.track, "contentHint", { set() { throw new Error("Hint unavailable"); } });
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  await voice.startAccompaniment();
  assert.equal(voice.accompanimentActive.value, true);
  await voice.stopAccompaniment();
  assert.equal(stream.track.readyState, "ended");
});

test("failed initial WebRTC input allocation releases partial nodes before PCM fallback", async t => {
  const createGain = AudioContextStub.prototype.createGain;
  let gainCalls = 0;
  t.mock.method(AudioContextStub.prototype, "createGain", function () {
    if (++gainCalls === 3) throw new Error("Mixed input gain unavailable");
    return createGain.call(this);
  });
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true });
  await nextTurn();
  assert.equal(TestPeer.instances[0].connectionState, "closed");
  assert.equal(AudioContextStub.destinations[1].stream.track.readyState, "ended");
  assert.ok(AudioContextStub.mediaSources[1].disconnects > 0);
  assert.equal(voice.state.microphoneErrorCode, "");
  assert.equal(voice.state.audioNoticeCode, "WEBRTC_FALLBACK");
});

test("a failing mix-node disconnect cannot prevent peer and microphone cleanup", async t => {
  const microphone = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => microphone;
  const { peer } = await connectWebRtc();
  const outputTrack = peer.sender.track;
  t.mock.method(AudioContextStub.mediaSources[1], "disconnect", () => { throw new Error("Node already unavailable"); }, { times: 1 });
  assert.doesNotThrow(() => voice.disconnect());
  assert.equal(peer.connectionState, "closed");
  assert.equal(outputTrack.readyState, "ended");
  assert.equal(microphone.track.readyState, "ended");
});

test("audio setup failure shows a distinct accompaniment message in every language", async t => {
  await connectWebRtc();
  navigator.mediaDevices.getDisplayMedia = async () => microphoneStream();
  t.mock.method(AudioContextStub.instances.at(-1), "createMediaStreamSource", () => { throw new Error("Source unavailable"); });
  const scope = effectScope();
  t.after(() => scope.stop());
  for (const language of ["zh", "en", "de", "ru", "ja"]) {
    const messages = [];
    const translations = webClientTranslations[language];
    const controls = scope.run(() => useWebClientAudioControls({ ...voice, settingsOpen: ref(false),
      localizedMessage: value => value, showToast: message => messages.push(message), t: key => translations[key] }));
    await controls.toggleAccompaniment();
    assert.equal(voice.accompanimentErrorCode.value, "audio");
    assert.equal(messages.at(-1), translations.accompanimentAudioFailed);
    assert.ok(messages.at(-1));
    assert.notEqual(messages.at(-1), translations.accompanimentPermissionDenied);
  }
});

test("accompaniment keeps display processing off and preserves microphone mute and gain", async () => {
  const { peer, socket } = await connectWebRtc();
  const originalTrack = peer.sender.track;
  const micGain = AudioContextStub.gains.at(-1);
  voice.setInputVolume(0.4);
  const audio = microphoneStream();
  const video = displayStream();
  audio.track.contentHint = "";
  let applied, requested;
  audio.track.applyConstraints = async value => { applied = value; throw new Error("Optional constraints unavailable"); };
  navigator.mediaDevices.getSupportedConstraints = () => ({ restrictOwnAudio: true });
  navigator.mediaDevices.getDisplayMedia = async options => {
    requested = options;
    return { getTracks: () => [audio.track, video.track], getAudioTracks: () => [audio.track], getVideoTracks: () => [video.track] };
  };
  await voice.startAccompaniment();
  assert.deepEqual(applied, { autoGainControl: false, echoCancellation: false, noiseSuppression: false });
  assert.deepEqual(requested.audio, { ...applied, restrictOwnAudio: true });
  assert.equal(requested.selfBrowserSurface, "exclude");
  assert.equal(requested.systemAudio, "include");
  assert.equal(requested.windowAudio, "window");
  assert.equal(audio.track.contentHint, "music");
  assert.equal(video.track.readyState, "ended");
  assert.equal(micGain.gain.value, 0.4);
  voice.setMicrophoneMuted(true);
  assert.equal(micGain.gain.value, 0);
  assert.equal(audio.track.readyState, "live");
  voice.setInputVolume(0.7);
  assert.equal(micGain.gain.value, 0);
  voice.setMicrophoneMuted(false);
  assert.equal(micGain.gain.value, 0.7);
  audio.track.readyState = "ended";
  audio.track.dispatchEvent(new Event("ended"));
  assert.equal(voice.accompanimentActive.value, false);
  assert.equal(peer.sender.track, originalTrack);
  assert.equal(originalTrack.readyState, "live");
  assert.deepEqual(socket.messages.filter(message => message.type === "setAccompanimentActive").map(message => message.payload.active), [true, false]);
});

test("an old accompaniment permission rejection cannot change a successful replacement", async () => {
  await connectWebRtc();
  const permission = deferred();
  navigator.mediaDevices.getDisplayMedia = () => permission.promise;
  const old = voice.startAccompaniment();
  const stream = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  await voice.startAccompaniment();
  permission.reject(new DOMException("Old permission denied", "NotAllowedError"));
  await old;
  assert.equal(voice.accompanimentActive.value, true);
  assert.equal(voice.accompanimentErrorCode.value, "");
  assert.equal(stream.track.readyState, "live");
});

test("a failed source selection preserves active accompaniment and disconnect clears its error", async () => {
  const { peer } = await connectWebRtc();
  const stream = microphoneStream();
  navigator.mediaDevices.getDisplayMedia = async () => stream;
  await voice.startAccompaniment();
  const rejected = displayStream();
  navigator.mediaDevices.getDisplayMedia = async () => rejected;
  await assert.rejects(voice.startAccompaniment(), /no audio/);
  assert.equal(voice.accompanimentErrorCode.value, "noAudio");
  assert.equal(rejected.track.readyState, "ended");
  assert.equal(stream.track.readyState, "live");
  assert.equal(peer.sender.track.readyState, "live");
  assert.equal(voice.accompanimentActive.value, true);
  voice.disconnect();
  assert.equal(voice.accompanimentActive.value, false);
  assert.equal(voice.accompanimentErrorCode.value, "");
});

test("an unavailable microphone analyser releases its partial source without failing voice", async () => {
  const { peer } = await connectWebRtc();
  assert.equal(AudioContextStub.mediaSources[2].disconnects, 1);
  assert.notEqual(peer.connectionState, "closed");
  assert.equal(peer.sender.track.readyState, "live");
});

test("a failed microphone meter connection releases all prepared meter nodes", async t => {
  const analyser = new AudioNodeStub();
  analyser.connect = () => { throw new Error("Meter unavailable"); };
  t.mock.method(AudioContextStub.prototype, "createAnalyser", () => analyser);
  const { peer } = await connectWebRtc();
  assert.equal(AudioContextStub.mediaSources[2].disconnects, 1);
  assert.equal(analyser.disconnects, 1);
  assert.equal(AudioContextStub.gains.at(-1).disconnects, 1);
  assert.equal(peer.sender.track.readyState, "live");
});

test("a queued old microphone meter tick cannot read or change a replacement session", async t => {
  const meter = enableMicrophoneMeter(t);
  await connectWebRtc();
  const oldTick = meter.intervals[0].callback;
  await connectWebRtc();
  const current = meter.analysers.at(-1);
  oldTick();
  assert.equal(current.reads, 0);
  assert.equal(voice.micLevel.value, 0);
  assert.ok(meter.cleared.includes(meter.intervals[0]));
});

test("a microphone analyser read failure stops only the meter and clears its level", async t => {
  const meter = enableMicrophoneMeter(t);
  const { peer } = await connectWebRtc();
  meter.intervals[0].callback();
  assert.ok(voice.micLevel.value > 0);
  meter.analysers[0].getFloatTimeDomainData = () => { throw new Error("Analyser closed"); };
  assert.doesNotThrow(() => meter.intervals[0].callback());
  assert.equal(voice.micLevel.value, 0);
  assert.ok(meter.cleared.includes(meter.intervals[0]));
  assert.equal(meter.analysers[0].disconnects, 1);
  assert.equal(AudioContextStub.mediaSources[2].disconnects, 1);
  assert.equal(AudioContextStub.gains.at(-1).disconnects, 1);
  assert.notEqual(peer.connectionState, "closed");
  assert.equal(peer.sender.track.readyState, "live");
});

test("a meter disconnect failure cannot interrupt the remaining session cleanup", async t => {
  const meter = enableMicrophoneMeter(t);
  const microphone = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => microphone;
  const { peer } = await connectWebRtc();
  t.mock.method(AudioContextStub.mediaSources[2], "disconnect", () => { throw new Error("Meter already closed"); }, { times: 1 });
  assert.doesNotThrow(() => voice.disconnect());
  assert.equal(peer.connectionState, "closed");
  assert.equal(microphone.track.readyState, "ended");
  assert.equal(meter.analysers[0].disconnects, 1);
  assert.equal(AudioContextStub.gains.at(-1).disconnects, 1);
});

test("microphone metering preserves its cadence and bounded level and stops on disconnect", async t => {
  const meter = enableMicrophoneMeter(t);
  await connectWebRtc();
  assert.equal(meter.intervals[0].delay, 50);
  meter.intervals[0].callback();
  assert.ok(Math.abs(voice.micLevel.value - 0.6) < 0.00001);
  meter.analysers[0].level = 0.8;
  meter.intervals[0].callback();
  assert.equal(voice.micLevel.value, 1);
  voice.disconnect();
  assert.equal(voice.micLevel.value, 0);
  const reads = meter.analysers[0].reads;
  meter.intervals[0].callback();
  assert.equal(meter.analysers[0].reads, reads);
});

test("a rejected old WebRTC answer cannot force the new peer into fallback", async () => {
  const first = await connectWebRtc();
  const answer = deferred();
  first.peer.setRemoteDescription = () => answer.promise;
  first.socket.receive({ type: "webrtcAnswer", payload: { sdp: { type: "answer", sdp: "old-answer" } } });
  const current = await connectWebRtc();
  answer.reject(new Error("old peer closed"));
  await nextTurn();
  assert.notEqual(current.peer.connectionState, "closed");
  assert.equal(current.socket.messages.some(message => message.type === "webrtcStop"), false);
  assert.equal(voice.state.audioNoticeCode, "");
});

test("a successful old WebRTC answer cannot activate WebRTC for a compatibility connection", async () => {
  const first = await connectWebRtc();
  const answer = deferred();
  first.peer.setRemoteDescription = () => answer.promise;
  first.socket.receive({ type: "webrtcAnswer", payload: { sdp: { type: "answer", sdp: "old-answer" } } });
  const current = await connect();
  current.receive({ type: "connected", tsClientId: 2 });
  await nextTurn();
  answer.resolve();
  await nextTurn();
  voice.setVolume(9, 0.4);
  assert.equal(current.messages.some(message => message.type === "setMemberVolume"), false);
});

test("a queued track event from a closed peer cannot replace current playback", async () => {
  const first = await connectWebRtc();
  const oldOnTrack = first.peer.ontrack;
  const current = await connectWebRtc();
  current.peer.ontrack({ streams: [microphoneStream()] });
  const output = [...audioElements][0];
  oldOnTrack({ streams: [microphoneStream()] });
  assert.deepEqual([...audioElements], [output]);
});

test("a late playback rejection does not restore notices or retry listeners after disconnect", async () => {
  const { peer } = await connectWebRtc();
  const playback = deferred();
  const output = new TestAudioElement();
  output.play = () => playback.promise;
  document.createElement = () => output;
  peer.ontrack({ streams: [microphoneStream()] });
  voice.disconnect();
  playback.reject(new Error("autoplay blocked"));
  await nextTurn();
  assert.equal(voice.state.audioNoticeCode, "");
  assert.equal(audioElements.size, 0);
});

test("a playback pause failure cannot prevent peer and microphone cleanup", async t => {
  const microphone = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => microphone;
  const { peer } = await connectWebRtc();
  peer.ontrack({ streams: [microphoneStream()] });
  const output = [...audioElements][0];
  t.mock.method(output, "pause", () => { throw new Error("Playback unavailable"); }, { times: 1 });
  assert.doesNotThrow(() => voice.disconnect());
  assert.equal(peer.connectionState, "closed");
  assert.equal(microphone.track.readyState, "ended");
  assert.equal(audioElements.size, 0);
  assert.equal(output.srcObject, null);
});

test("a peer close failure cannot prevent microphone and session cleanup", async t => {
  const microphone = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => microphone;
  const { peer } = await connectWebRtc();
  t.mock.method(peer, "close", () => { throw new Error("Peer unavailable"); }, { times: 1 });
  assert.doesNotThrow(() => voice.disconnect());
  assert.equal(microphone.track.readyState, "ended");
  assert.equal(voice.state.connected, false);
  assert.equal(voice.ws.value, null);
  assert.equal(peer.ontrack, null);
  assert.equal(browserTimers.size, 0);
});

test("a playback setup failure releases its element and restores compatibility audio", async () => {
  const { peer, socket } = await connectWebRtc();
  const output = new TestAudioElement();
  let removed = false;
  output.remove = () => { removed = true; audioElements.delete(output); };
  Object.defineProperty(output, "srcObject", { set(value) { if (value) throw new Error("Playback source unavailable"); } });
  document.createElement = () => output;
  assert.doesNotThrow(() => peer.ontrack({ streams: [microphoneStream()] }));
  await nextTurn();
  assert.equal(removed, true);
  assert.equal(peer.connectionState, "closed");
  assert.equal(voice.state.audioNoticeCode, "WEBRTC_FALLBACK");
  assert.equal(voice.state.microphoneErrorCode, "");
  assert.equal(socket.messages.filter(message => message.type === "webrtcStop").length, 1);
});

test("a queued old playback retry cannot play a replacement session", async t => {
  let retry;
  const addListener = window.addEventListener.bind(window);
  t.mock.method(window, "addEventListener", (type, callback, options) => {
    if (type === "pointerdown") retry = callback;
    addListener(type, callback, options);
  });
  const first = await connectWebRtc();
  const blocked = new TestAudioElement();
  blocked.play = async () => { throw new Error("Gesture required"); };
  document.createElement = () => blocked;
  first.peer.ontrack({ streams: [microphoneStream()] });
  await nextTurn();
  const oldRetry = retry;
  assert.equal(typeof oldRetry, "function");
  const next = await connectWebRtc();
  const output = new TestAudioElement();
  let plays = 0;
  output.play = async () => { plays++; };
  document.createElement = () => output;
  next.peer.ontrack({ streams: [microphoneStream()] });
  await nextTurn();
  assert.equal(plays, 1);
  oldRetry();
  await nextTurn();
  assert.equal(plays, 1);
  assert.equal(voice.state.audioNoticeCode, "");
});

test("overlapping playback retry gestures share one in-flight play attempt", async () => {
  const { peer } = await connectWebRtc();
  const output = new TestAudioElement();
  const playback = deferred();
  let plays = 0;
  output.play = () => ++plays === 1 ? Promise.reject(new Error("Gesture required")) : playback.promise;
  document.createElement = () => output;
  peer.ontrack({ streams: [microphoneStream()] });
  await nextTurn();
  window.dispatchEvent(new Event("pointerdown"));
  window.dispatchEvent(new Event("keydown"));
  const attempts = plays;
  playback.resolve();
  await nextTurn();
  assert.equal(attempts, 2);
  assert.equal(voice.state.audioNoticeCode, "");
});

test("failed fallback signaling still releases WebRTC and resumes compatibility capture", async t => {
  t.mock.method(TestPeer.prototype, "createOffer", async () => { throw new Error("Negotiation unavailable"); });
  const send = TestSocket.prototype.send;
  t.mock.method(TestSocket.prototype, "send", function (raw) {
    if (typeof raw === "string" && JSON.parse(raw).type === "webrtcStop") throw new Error("Signal send failed");
    return send.call(this, raw);
  });
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true });
  await nextTurn();
  assert.equal(TestPeer.instances[0].connectionState, "closed");
  assert.equal(voice.state.microphoneErrorCode, "");
  assert.equal(voice.state.audioNoticeCode, "WEBRTC_FALLBACK");
  AudioContextStub.processors.at(-1).onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(960).fill(0.2) } });
  assert.ok(socket.messages.some(message => message instanceof ArrayBuffer && message.byteLength === 1920));
});

test("an old fallback microphone failure cannot report into a replacement connection", async () => {
  const { peer } = await connectWebRtc();
  const permission = deferred();
  navigator.mediaDevices.getUserMedia = () => permission.promise;
  peer.connectionState = "failed";
  peer.onconnectionstatechange();
  await nextTurn();
  navigator.mediaDevices.getUserMedia = async () => microphoneStream();
  await connectWebRtc();
  permission.reject(new DOMException("Old permission rejected", "NotAllowedError"));
  await nextTurn();
  assert.equal(voice.state.microphoneErrorCode, "");
  assert.equal(voice.state.audioNoticeCode, "");
});

test("an old answer timeout cannot hide the replacement deadline from cleanup", async t => {
  const timers = [];
  const setTimer = window.setTimeout.bind(window);
  t.mock.method(window, "setTimeout", (callback, ms) => {
    if (ms === 8000) timers.push(callback);
    return setTimer(callback, ms);
  });
  await connectWebRtc();
  await connectWebRtc();
  timers[0]();
  voice.disconnect();
  assert.equal(browserTimers.size, 0);
});

test("disconnect settles an audio probe while browser stats are still pending", async () => {
  const { peer, socket } = await connectWebRtc();
  const stats = deferred();
  peer.getStats = () => stats.promise;
  let settled = false;
  const pending = voice.measureVoiceAudioStatus().then(sample => { settled = true; return sample; });
  const request = socket.messages.find(message => message.type === "audioStatsProbe");
  socket.receive({ type: "audioStats", sequence: request.payload.sequence, stats: { transport: "webrtc" } });
  voice.disconnect();
  await nextTurn();
  const settledAtDisconnect = settled;
  stats.resolve(new Map());
  const result = await pending;
  assert.equal(settledAtDisconnect, true);
  assert.equal(result, null);
});

test("an audio probe keeps its deadline after the gateway replies", async () => {
  const { peer, socket } = await connectWebRtc();
  const stats = deferred();
  peer.getStats = () => stats.promise;
  let settled = false;
  const pending = voice.measureVoiceAudioStatus(10).then(sample => { settled = true; return sample; });
  const request = socket.messages.find(message => message.type === "audioStatsProbe");
  socket.receive({ type: "audioStats", sequence: request.payload.sequence, stats: { transport: "webrtc" } });
  await new Promise(resolve => setTimeout(resolve, 25));
  const settledAtDeadline = settled;
  stats.resolve(new Map());
  const result = await pending;
  assert.equal(settledAtDeadline, true);
  assert.equal(result, null);
});

test("an old peer's browser stats cannot be combined with a replacement peer", async () => {
  const { peer, socket } = await connectWebRtc();
  const stats = deferred();
  peer.getStats = () => stats.promise;
  const pending = voice.measureVoiceAudioStatus();
  const request = socket.messages.find(message => message.type === "audioStatsProbe");
  socket.receive({ type: "audioStats", sequence: request.payload.sequence, stats: { transport: "webrtc" } });
  await voice.setInputDevice("replacement");
  assert.notEqual(TestPeer.instances.at(-1), peer);
  stats.resolve(new Map());
  assert.equal(await pending, null);
});

test("a failed audio probe send completes without an unhandled diagnostic rejection", async t => {
  const { socket } = await connectWebRtc();
  const send = socket.send.bind(socket);
  t.mock.method(socket, "send", raw => {
    if (typeof raw === "string" && JSON.parse(raw).type === "audioStatsProbe") throw new Error("Probe send failed");
    return send(raw);
  });
  assert.equal(await voice.measureVoiceAudioStatus(), null);
});

test("a current audio probe retains browser metrics and accepts missing browser stats", async () => {
  const { peer, socket } = await connectWebRtc();
  peer.getStats = async () => new Map([
    ["out", { type: "outbound-rtp", kind: "audio", bytesSent: 100, packetsSent: 10 }],
    ["remote", { type: "remote-inbound-rtp", kind: "audio", packetsLost: 2, roundTripTime: 0.05 }],
  ]);
  const pending = voice.measureVoiceAudioStatus();
  const request = socket.messages.find(message => message.type === "audioStatsProbe");
  socket.receive({ type: "audioStats", sequence: request.payload.sequence, stats: { transport: "webrtc", tsSendFrames: 12 } });
  const sample = await pending;
  assert.equal(sample.transport, "webrtc");
  assert.equal(sample.bridge.tsSendFrames, 12);
  assert.equal(sample.browser.outboundPackets, 10);
  assert.equal(sample.browser.outboundBytes, 100);
  assert.equal(sample.browser.outboundRttMs, 50);
  assert.equal(sample.browser.outboundLossPercent, 20);
  peer.getStats = async () => { throw new Error("Stats unavailable"); };
  const missing = voice.measureVoiceAudioStatus();
  const nextRequest = socket.messages.filter(message => message.type === "audioStatsProbe").at(-1);
  socket.receive({ type: "audioStats", sequence: nextRequest.payload.sequence, stats: { transport: "webrtc" } });
  assert.equal((await missing).browser, null);
});

async function audioSample(socket, bridge = {}) {
  const pending = voice.measureVoiceAudioStatus();
  const request = socket.messages.filter(message => message.type === "audioStatsProbe").at(-1);
  socket.receive({ type: "audioStats", sequence: request.payload.sequence, stats: { transport: "websocket", ...bridge } });
  return pending;
}

test("diagnostic sample scopes follow peer replacement and fallback on one socket", async () => {
  const { socket } = await connectWebRtc();
  const first = await audioSample(socket);
  const next = await audioSample(socket);
  assert.equal(typeof first.scopeId, "number");
  assert.equal(next.scopeId, first.scopeId);
  await voice.setInputDevice("replacement");
  const replaced = await audioSample(socket);
  assert.notEqual(replaced.scopeId, first.scopeId);
  socket.receive({ type: "webrtcError", code: "WEBRTC_UNAVAILABLE" });
  await nextTurn();
  const fallback = await audioSample(socket);
  assert.notEqual(fallback.scopeId, replaced.scopeId);
  assert.equal(fallback.transport, "websocket");
});

test("session recovery resets compatibility diagnostics without mutating old snapshots", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  receiveAudio(socket);
  receiveAudio(socket);
  socket.onmessage({ data: new Uint8Array([1, 2]).buffer });
  const previous = await audioSample(socket);
  assert.equal(previous.fallbackPlayback.framesReceived, 2);
  assert.equal(previous.fallbackPlayback.framesDropped, 1);
  socket.receive({ type: "disconnected", recoverable: true });
  socket.receive({ type: "connected", tsClientId: 2 });
  await nextTurn();
  const current = await audioSample(socket);
  assert.notEqual(current.scopeId, previous.scopeId);
  assert.deepEqual(current.fallbackPlayback, { framesReceived: 0, framesDropped: 0, decodeErrors: 0 });
  assert.equal(previous.fallbackPlayback.framesReceived, 2);
});

test("a probe started before peer allocation cannot survive a failed transport attempt", async t => {
  t.mock.method(TestPeer.prototype, "createOffer", async () => { throw new Error("Offer unavailable"); });
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true });
  const pending = voice.measureVoiceAudioStatus();
  const request = socket.messages.filter(message => message.type === "audioStatsProbe").at(-1);
  await nextTurn();
  assert.equal(TestPeer.instances.at(-1).connectionState, "closed");
  socket.receive({ type: "audioStats", sequence: request.payload.sequence, stats: { transport: "websocket" } });
  assert.equal(await pending, null);
});

test("disconnect clears the WebRTC answer deadline immediately", async () => {
  await connectWebRtc();
  assert.ok(browserTimers.size > 0);
  voice.disconnect();
  assert.equal(browserTimers.size, 0);
});

test("negotiation failure resumes bounded PCM capture without a false microphone error", async t => {
  t.mock.method(TestPeer.prototype, "createOffer", async () => { throw new Error("negotiation failed"); });
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true });
  await nextTurn();
  assert.equal(TestPeer.instances[0].connectionState, "closed");
  assert.equal(voice.state.audioNoticeCode, "WEBRTC_FALLBACK");
  assert.equal(voice.state.microphoneErrorCode, "");
  const capture = AudioContextStub.processors.at(-1);
  capture.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(960).fill(0.2) } });
  assert.ok(socket.messages.some(message => message instanceof ArrayBuffer && message.byteLength === 1920));
  assert.equal(socket.messages.filter(message => message.type === "webrtcStop").length, 1);
});

test("track setup failure also releases the peer and restores compatibility capture", async t => {
  t.mock.method(TestPeer.prototype, "addTrack", () => { throw new Error("track rejected"); });
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true });
  await nextTurn();
  assert.equal(TestPeer.instances[0].connectionState, "closed");
  assert.equal(voice.state.audioNoticeCode, "WEBRTC_FALLBACK");
  assert.equal(voice.state.microphoneErrorCode, "");
  AudioContextStub.processors.at(-1).onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(960).fill(0.2) } });
  assert.ok(socket.messages.some(message => message instanceof ArrayBuffer && message.byteLength === 1920));
});

test("a current answer completes negotiation and removes its timeout", async () => {
  const { socket, peer } = await connectWebRtc();
  socket.receive({ type: "webrtcAnswer", payload: { sdp: { type: "answer", sdp: "current-answer" } } });
  await nextTurn();
  assert.equal(peer.remoteDescription.sdp, "current-answer");
  assert.equal(browserTimers.size, 0);
  assert.equal(socket.messages.some(message => message.type === "webrtcStop"), false);
});

test("disconnect cancels an ICE gathering wait without sending an offer", async t => {
  t.mock.method(TestPeer.prototype, "setLocalDescription", async function(description) {
    this.localDescription = description;
    this.iceGatheringState = "gathering";
  });
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true });
  await nextTurn();
  assert.ok(browserTimers.size > 0);
  voice.disconnect();
  await nextTurn();
  assert.equal(browserTimers.size, 0);
  assert.equal(socket.messages.some(message => message.type === "webrtcOffer"), false);
  assert.equal(voice.state.microphoneErrorCode, "");
});

test("an offer rejected after a new connection opens cannot report a microphone error", async t => {
  const oldOffer = deferred();
  let calls = 0;
  t.mock.method(TestPeer.prototype, "createOffer", () => ++calls === 1 ? oldOffer.promise : Promise.resolve({ type: "offer", sdp: "new-offer" }));
  const old = await connect();
  old.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true });
  await nextTurn();
  const current = await connectWebRtc();
  oldOffer.reject(new Error("old peer closed"));
  await nextTurn();
  assert.notEqual(current.peer.connectionState, "closed");
  assert.equal(voice.state.microphoneErrorCode, "");
  assert.equal(voice.state.audioNoticeCode, "");
});


test("resetting an overloaded remote decoder disconnects its old gain", async () => {
  const socket = await connect();
  receiveAudio(socket);
  const gain = AudioContextStub.gains.at(-1);
  AudioDecoderStub.instances.at(-1).decodeQueueSize = 3;
  receiveAudio(socket);
  assert.equal(gain.disconnects, 1);
  assert.equal(AudioDecoderStub.instances.length, 2);
});

test("an old source ending cannot hide replacement playback from session cleanup", async () => {
  const socket = await connect();
  receiveAudio(socket);
  const first = AudioDecoderStub.instances.at(-1);
  first.callbacks.output(decodedChunk());
  const oldSource = AudioContextStub.sources.at(-1);
  first.decodeQueueSize = 3;
  receiveAudio(socket);
  AudioDecoderStub.instances.at(-1).callbacks.output(decodedChunk());
  const replacement = AudioContextStub.sources.at(-1);
  oldSource.dispatchEvent(new Event("ended"));
  voice.disconnect();
  assert.equal(replacement.stopped, 1);
});

test("decoder failure releases the speaker's queued sources and gain immediately", async () => {
  const socket = await connect();
  receiveAudio(socket);
  const decoder = AudioDecoderStub.instances.at(-1);
  decoder.callbacks.output(decodedChunk());
  const source = AudioContextStub.sources.at(-1);
  const gain = AudioContextStub.gains.at(-1);
  decoder.callbacks.error(new Error("Decode failed"));
  assert.equal(source.stopped, 1);
  assert.equal(gain.disconnects, 1);
});

test("codec configuration failure is contained and releases the partially created stream", async () => {
  const socket = await connect();
  AudioDecoderStub.failConfigure = true;
  assert.doesNotThrow(() => receiveAudio(socket));
  assert.equal(AudioDecoderStub.instances.at(-1).closed, 1);
  assert.equal(AudioContextStub.gains.at(-1).disconnects, 1);
  AudioDecoderStub.failConfigure = false;
  receiveAudio(socket);
  assert.equal(AudioDecoderStub.instances.length, 2);
});

test("a failed audio source start does not retain a connected playback node", async () => {
  const socket = await connect();
  receiveAudio(socket);
  AudioSourceStub.failStart = true;
  const chunk = decodedChunk();
  AudioDecoderStub.instances.at(-1).callbacks.output(chunk);
  assert.ok(AudioContextStub.sources.at(-1).disconnects > 0);
  assert.equal(chunk.closed, 1);
});

test("late decoded chunks after disconnect close without creating playback", async () => {
  const socket = await connect();
  receiveAudio(socket);
  const old = AudioDecoderStub.instances.at(-1);
  voice.disconnect();
  const chunk = decodedChunk();
  old.callbacks.output(chunk);
  assert.equal(chunk.closed, 1);
  assert.equal(AudioContextStub.sources.length, 0);
});

test("a departing speaker releases only its own playback", async () => {
  const socket = await connect();
  socket.receive({ type: "memberEnter", id: 7, nickname: "Leaving" });
  socket.receive({ type: "memberEnter", id: 8, nickname: "Staying" });
  receiveAudio(socket, 7);
  receiveAudio(socket, 8);
  const [leaving, staying] = AudioDecoderStub.instances;
  leaving.callbacks.output(decodedChunk());
  staying.callbacks.output(decodedChunk());
  const [oldSource, currentSource] = AudioContextStub.sources;
  socket.receive({ type: "memberLeave", id: 7 });
  assert.deepEqual(voice.members.map(member => member.id), [8]);
  assert.equal(leaving.closed, 1);
  assert.equal(oldSource.stopped, 1);
  assert.equal(staying.closed, 0);
  assert.equal(currentSource.stopped, 0);
});

test("remote playback preserves member volume through output mute and decoder reset", async () => {
  const socket = await connect();
  voice.setVolume(7, 0.4);
  voice.setOutputVolume(0.5);
  receiveAudio(socket, 7);
  receiveAudio(socket, 8);
  assert.deepEqual(AudioContextStub.gains.map(node => node.gain.value), [0.2, 0.5]);
  voice.toggleOutputMute();
  assert.deepEqual(AudioContextStub.gains.map(node => node.gain.value), [0, 0]);
  const old = AudioDecoderStub.instances[0];
  old.decodeQueueSize = 3;
  receiveAudio(socket, 7);
  const replacement = AudioDecoderStub.instances.at(-1);
  old.callbacks.error(new Error("stale decoder error"));
  assert.equal(replacement.closed, 0);
  assert.equal(AudioContextStub.gains.at(-1).gain.value, 0);
  voice.toggleOutputMute();
  assert.equal(AudioContextStub.gains.at(-1).gain.value, 0.2);
  assert.equal(AudioContextStub.gains[1].gain.value, 0.5);
});

test("decoded audio stays within the 80 ms playback window and recovers after overflow", async () => {
  const socket = await connect();
  receiveAudio(socket);
  const decoder = AudioDecoderStub.instances[0];
  const chunks = Array.from({ length: 5 }, decodedChunk);
  for (const chunk of chunks) decoder.callbacks.output(chunk);
  assert.deepEqual(AudioContextStub.sources.map(source => source.startedAt), [0, 0.02, 0.04, 0.06]);
  assert.equal(decoder.closed, 1);
  assert.ok(AudioContextStub.sources.every(source => source.stopped === 1));
  assert.ok(chunks.every(chunk => chunk.closed === 1));
  receiveAudio(socket);
  const replacement = AudioDecoderStub.instances.at(-1);
  replacement.callbacks.output(decodedChunk());
  assert.notEqual(replacement, decoder);
  assert.equal(AudioContextStub.sources.at(-1).startedAt, 0);
});

test("old socket audio cannot create a decoder in a replacement session", async () => {
  const old = await connect();
  const lateAudio = old.onmessage;
  const current = await connect();
  lateAudio({ data: new Uint8Array([4, 0, 7, 1, 2, 3]).buffer });
  assert.equal(AudioDecoderStub.instances.length, 0);
  receiveAudio(current);
  assert.equal(AudioDecoderStub.instances.length, 1);
});

test("disconnect stops a microphone test and discards its late recording", async () => {
  await voice.startMicrophoneTest();
  const recorder = RecorderStub.instances.at(-1);
  voice.disconnect();
  assert.equal(recorder.stops, 1);
  assert.equal(voice.microphoneTestActive.value, false);
  recorder.finish();
  assert.equal(voice.testAudioUrl.value, "");
});

test("a replacement microphone test stops the old recorder and ignores its late result", async t => {
  const created = [];
  t.mock.method(URL, "createObjectURL", blob => { created.push(blob); return `blob:test-${created.length}`; });
  t.mock.method(URL, "revokeObjectURL", () => {});
  await voice.startMicrophoneTest();
  const old = RecorderStub.instances.at(-1);
  await voice.startMicrophoneTest();
  const current = RecorderStub.instances.at(-1);
  assert.equal(old.stops, 1);
  current.finish();
  const currentUrl = voice.testAudioUrl.value;
  old.finish();
  assert.equal(voice.testAudioUrl.value, currentUrl);
  assert.equal(created.length, 1);
});

test("an old microphone test permission failure cannot stop a new recording", async () => {
  const oldPermission = deferred();
  let requests = 0;
  navigator.mediaDevices.getUserMedia = () => ++requests === 1 ? oldPermission.promise : Promise.resolve(microphoneStream());
  const old = voice.startMicrophoneTest().catch(() => {});
  voice.stopMicrophoneTest();
  await voice.startMicrophoneTest();
  oldPermission.reject(new Error("Old permission failed"));
  await old;
  assert.equal(voice.microphoneTestActive.value, true);
  assert.equal(RecorderStub.instances.at(-1).state, "recording");
});

test("stopping a microphone test while devices refresh prevents recorder creation", async () => {
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  const refresh = deferred();
  navigator.mediaDevices.enumerateDevices = () => refresh.promise;
  const pending = voice.startMicrophoneTest();
  voice.stopMicrophoneTest();
  refresh.resolve([]);
  await pending;
  assert.equal(RecorderStub.instances.length, 0);
  assert.equal(voice.microphoneTestActive.value, false);
});

test("a naturally finished microphone recording clears active state and standalone capture", async t => {
  const revoked = [];
  t.mock.method(URL, "createObjectURL", () => "blob:finished");
  t.mock.method(URL, "revokeObjectURL", url => revoked.push(url));
  await voice.startMicrophoneTest();
  const recorder = RecorderStub.instances.at(-1);
  recorder.finish();
  assert.equal(voice.microphoneTestActive.value, false);
  assert.equal(recorder.stream.track.readyState, "ended");
  assert.equal(voice.testAudioUrl.value, "blob:finished");
  voice.disconnect();
  assert.deepEqual(revoked, ["blob:finished"]);
  assert.equal(voice.testAudioUrl.value, "");
});

test("recorder startup failure releases standalone microphone capture", async () => {
  RecorderStub.failStart = true;
  await assert.rejects(voice.startMicrophoneTest(), /Recorder start failed/);
  assert.equal(voice.microphoneTestActive.value, false);
  assert.equal(RecorderStub.instances.at(-1).stream.track.readyState, "ended");
});

test("stopping a connected microphone test publishes its recording without stopping room capture", async t => {
  t.mock.method(URL, "createObjectURL", () => "blob:connected");
  t.mock.method(URL, "revokeObjectURL", () => {});
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  await voice.startMicrophoneTest();
  const recorder = RecorderStub.instances.at(-1);
  voice.stopMicrophoneTest();
  recorder.finish();
  assert.equal(voice.testAudioUrl.value, "blob:connected");
  assert.equal(recorder.stream.track.readyState, "live");
  assert.equal(voice.state.connected, true);
});

test("the microphone test deadline stops recording and is removed on completion", async t => {
  let deadline;
  const cleared = [];
  t.mock.method(window, "setTimeout", (callback, delay) => { assert.equal(delay, 5_000); deadline = callback; return 123; });
  t.mock.method(window, "clearTimeout", timer => cleared.push(timer));
  await voice.startMicrophoneTest();
  const recorder = RecorderStub.instances.at(-1);
  deadline();
  assert.equal(recorder.stops, 1);
  assert.equal(voice.microphoneTestActive.value, false);
  assert.deepEqual(cleared, [123]);
});

test("an asynchronous recorder failure stops capture and reports a microphone error", async () => {
  await voice.startMicrophoneTest();
  const recorder = RecorderStub.instances.at(-1);
  recorder.onerror({ error: new Error("Recorder failed") });
  assert.equal(recorder.stops, 1);
  assert.equal(recorder.stream.track.readyState, "ended");
  assert.equal(voice.microphoneTestActive.value, false);
  assert.notEqual(voice.state.microphoneErrorCode, "");
  recorder.finish();
  assert.equal(voice.testAudioUrl.value, "");
});

const availableDevices = [
  ...["mic-a", "mic-b"].map(deviceId => ({ deviceId, kind: "audioinput", label: deviceId, groupId: "" })),
  ...["speaker-a", "speaker-b"].map(deviceId => ({ deviceId, kind: "audiooutput", label: deviceId, groupId: "" })),
];

test("an old input switch failure cannot roll back a newer microphone selection", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.ensureMicrophone();
  const permission = deferred();
  const current = microphoneStream();
  navigator.mediaDevices.getUserMedia = ({ audio }) => audio.deviceId.exact === "mic-a" ? permission.promise : Promise.resolve(current);
  const old = voice.setInputDevice("mic-a").catch(() => {});
  await voice.setInputDevice("mic-b");
  permission.reject(new Error("Old microphone unavailable"));
  await old;
  assert.equal(voice.selectedInputDeviceId.value, "mic-b");
  assert.equal(localStorage.getItem("webspeak:input-device"), "mic-b");
  assert.equal(current.track.readyState, "live");
});

test("a failed microphone switch leaves an existing WebRTC peer and capture alive", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const stream = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => stream;
  const { peer, socket } = await connectWebRtc();
  navigator.mediaDevices.getUserMedia = async () => { throw new Error("New device unavailable"); };
  await assert.rejects(voice.setInputDevice("mic-a"), /New device unavailable/);
  assert.notEqual(peer.connectionState, "closed");
  receiveAudio(socket);
  assert.equal(AudioDecoderStub.instances.length, 0, "WebRTC still owns playback");
  assert.equal(stream.track.readyState, "live");
  assert.equal(voice.selectedInputDeviceId.value, "");
});

test("an old output switch rejection cannot roll back the latest selection", async t => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.ensureMicrophone();
  const ctx = AudioContextStub.instances.at(-1);
  const oldSink = deferred();
  t.mock.method(ctx, "setSinkId", id => id === "speaker-a" ? oldSink.promise : Promise.resolve());
  const old = voice.setOutputDevice("speaker-a").catch(() => {});
  await nextTurn();
  const current = voice.setOutputDevice("speaker-b");
  oldSink.reject(new Error("Old output unavailable"));
  await Promise.all([old, current]);
  assert.equal(voice.selectedOutputDeviceId.value, "speaker-b");
  assert.equal(localStorage.getItem("webspeak:output-device"), "speaker-b");
});

test("overlapping output switches leave the actual sink on the latest device", async t => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.ensureMicrophone();
  const ctx = AudioContextStub.instances.at(-1);
  const oldSink = deferred();
  t.mock.method(ctx, "setSinkId", async id => { if (id === "speaker-a") await oldSink.promise; ctx.sinkId = id; });
  const old = voice.setOutputDevice("speaker-a");
  await nextTurn();
  const current = voice.setOutputDevice("speaker-b");
  oldSink.resolve();
  await Promise.all([old, current]);
  assert.equal(ctx.sinkId, "speaker-b");
  assert.equal(voice.selectedOutputDeviceId.value, "speaker-b");
});

test("an older device enumeration cannot replace a newer device list", async () => {
  const oldDevices = deferred();
  let calls = 0;
  navigator.mediaDevices.enumerateDevices = () => ++calls === 1 ? oldDevices.promise : Promise.resolve(availableDevices);
  const old = voice.refreshAudioDevices();
  await voice.refreshAudioDevices();
  oldDevices.resolve([]);
  await old;
  assert.deepEqual(voice.inputDevices.map(device => device.deviceId), ["mic-a", "mic-b"]);
});

test("device enumeration rejected after disconnect cannot restore an audio notice", async () => {
  const devices = deferred();
  navigator.mediaDevices.enumerateDevices = () => devices.promise;
  const pending = voice.refreshAudioDevices();
  voice.disconnect();
  devices.reject(new Error("Old device query rejected"));
  await pending;
  assert.equal(voice.state.audioNoticeCode, "");
});

test("a successful microphone switch replaces the WebRTC peer and persists the new device", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const initial = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => initial;
  const { peer: old, socket } = await connectWebRtc();
  const replacement = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => replacement;
  await voice.setInputDevice("mic-b");
  assert.equal(old.connectionState, "closed");
  assert.notEqual(TestPeer.instances.at(-1), old);
  assert.equal(initial.track.readyState, "ended");
  assert.equal(replacement.track.readyState, "live");
  assert.equal(socket.messages.filter(message => message.type === "webrtcOffer").length, 2);
  assert.equal(localStorage.getItem("webspeak:input-device"), "mic-b");
});

test("a failed replacement input restores the last working device instead of another pending choice", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.ensureMicrophone();
  const permission = deferred();
  navigator.mediaDevices.getUserMedia = ({ audio }) => audio.deviceId.exact === "mic-a"
    ? permission.promise : Promise.reject(new Error("Replacement failed"));
  const old = voice.setInputDevice("mic-a");
  await assert.rejects(voice.setInputDevice("mic-b"), /Replacement failed/);
  const late = microphoneStream();
  permission.resolve(late);
  await old;
  assert.equal(voice.selectedInputDeviceId.value, "");
  assert.equal(localStorage.getItem("webspeak:input-device"), "");
  assert.equal(late.track.readyState, "ended");
});

test("disconnect skips queued output changes and keeps only the last committed device", async t => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.ensureMicrophone();
  const ctx = AudioContextStub.instances.at(-1);
  const oldSink = deferred();
  const applied = [];
  t.mock.method(ctx, "setSinkId", async id => { applied.push(id); await oldSink.promise; });
  const first = voice.setOutputDevice("speaker-a");
  await nextTurn();
  const second = voice.setOutputDevice("speaker-b");
  voice.disconnect();
  oldSink.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(applied, ["speaker-a"]);
  assert.equal(voice.selectedOutputDeviceId.value, "");
  assert.equal(localStorage.getItem("webspeak:output-device"), null);
});

test("failure on the WebRTC output restores the previously committed context sink", async t => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const { peer } = await connectWebRtc();
  peer.ontrack({ streams: [microphoneStream()] });
  const output = [...audioElements][0];
  output.setSinkId = async id => { if (id === "speaker-a") throw new Error("Output denied"); output.sinkId = id; };
  const ctx = AudioContextStub.instances.at(-1);
  await assert.rejects(voice.setOutputDevice("speaker-a"), /Output denied/);
  assert.equal(ctx.sinkId, "default");
  assert.equal(output.sinkId, "default");
  assert.equal(voice.selectedOutputDeviceId.value, "");
});

test("a failed noise suppression change restores its setting and preserves WebRTC capture", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const initial = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => initial;
  const { peer } = await connectWebRtc();
  navigator.mediaDevices.getUserMedia = async () => { throw new Error("Capture reconfiguration failed"); };
  await voice.setNoiseSuppressionEnabled(false);
  assert.notEqual(peer.connectionState, "closed");
  assert.equal(voice.noiseSuppressionEnabled.value, true);
  assert.equal(initial.track.readyState, "live");
  assert.notEqual(voice.state.microphoneErrorCode, "");
});

test("changing processing during an input switch commits the device actually acquired", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.ensureMicrophone();
  const permission = deferred();
  let calls = 0;
  navigator.mediaDevices.getUserMedia = () => ++calls === 1 ? permission.promise : Promise.resolve(microphoneStream());
  const input = voice.setInputDevice("mic-a");
  await voice.setNoiseSuppressionEnabled(false);
  const late = microphoneStream();
  permission.resolve(late);
  await input;
  assert.equal(localStorage.getItem("webspeak:input-device"), "mic-a");
  assert.equal(late.track.readyState, "ended");
  voice.disconnect();
  assert.equal(voice.selectedInputDeviceId.value, "mic-a");
});

test("closing audio settings releases standalone capture even without a recording test", async () => {
  const stream = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => stream;
  await voice.prepareInputDevices();
  voice.stopMicrophoneTest();
  assert.equal(stream.track.readyState, "ended");
});

test("compatibility capture keeps sending while a replacement permission is pending or fails", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  const capture = AudioContextStub.processors.at(-1);
  const permission = deferred();
  navigator.mediaDevices.getUserMedia = () => permission.promise;
  const pending = voice.setInputDevice("mic-a");
  const rejected = assert.rejects(pending, /Device denied/);
  const samples = new Float32Array(960).fill(0.25);
  capture.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
  const beforeFailure = socket.messages.filter(message => message instanceof ArrayBuffer).length;
  permission.reject(new Error("Device denied"));
  await rejected;
  capture.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
  assert.equal(beforeFailure, 1);
  assert.equal(socket.messages.filter(message => message instanceof ArrayBuffer).length, 2);
});

test("replacing compatibility capture prevents the old graph from sending into the new session", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  const old = AudioContextStub.processors.at(-1);
  await voice.setInputDevice("mic-b");
  const current = AudioContextStub.processors.at(-1);
  const event = { inputBuffer: { getChannelData: () => new Float32Array(960).fill(0.25) } };
  old.onaudioprocess(event);
  current.onaudioprocess(event);
  assert.equal(socket.messages.filter(message => message instanceof ArrayBuffer).length, 1);
  voice.disconnect();
  current.onaudioprocess(event);
  assert.equal(socket.messages.filter(message => message instanceof ArrayBuffer).length, 1);
});

test("a failed replacement processing graph preserves the live microphone and PCM path", async t => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const initial = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => initial;
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  const capture = AudioContextStub.processors.at(-1);
  const replacement = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => replacement;
  const ctx = AudioContextStub.instances.at(-1);
  const processing = { ...voice.microphoneProcessing };
  t.mock.method(ctx, "createGain", () => { throw new Error("Gain allocation failed"); });
  await assert.rejects(voice.setInputDevice("mic-b"), /Gain allocation failed/);
  assert.equal(initial.track.readyState, "live");
  assert.equal(replacement.track.readyState, "ended");
  capture.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(960).fill(0.25) } });
  assert.equal(socket.messages.filter(message => message instanceof ArrayBuffer).length, 1);
  assert.deepEqual({ ...voice.microphoneProcessing }, processing);
  assert.equal(voice.selectedInputDeviceId.value, "");
  assert.notEqual(voice.state.microphoneErrorCode, "");
});

test("waiting for a replacement worklet keeps the current graph sending", async t => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  const capture = AudioContextStub.processors.at(-1);
  const module = deferred();
  AudioContextStub.instances.at(-1).audioWorklet = { addModule: url => url === "/mic-capture-worklet.js" ? module.promise : Promise.resolve() };
  // A missing worklet constructor must still permit the ScriptProcessor fallback.
  replaceGlobal("AudioWorkletNode", class { constructor() { throw new Error("Worklet unavailable"); } });
  t.after(() => module.resolve());
  const pending = voice.setInputDevice("mic-a");
  await nextTurn();
  capture.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(960).fill(0.25) } });
  const framesWhilePreparing = socket.messages.filter(message => message instanceof ArrayBuffer).length;
  module.resolve();
  await pending;
  assert.equal(framesWhilePreparing, 1);
  AudioContextStub.processors.at(-1).onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(960).fill(0.25) } });
  assert.equal(socket.messages.filter(message => message instanceof ArrayBuffer).length, 2);
});

test("disconnect during worklet preparation releases every candidate node and track", async t => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.ensureMicrophone();
  const module = deferred();
  const ctx = AudioContextStub.instances.at(-1);
  ctx.audioWorklet = { addModule: url => url === "/mic-capture-worklet.js" ? module.promise : Promise.resolve() };
  const source = new AudioNodeStub();
  const destination = Object.assign(new AudioNodeStub(), { stream: microphoneStream() });
  t.mock.method(ctx, "createMediaStreamSource", () => source);
  t.mock.method(ctx, "createMediaStreamDestination", () => destination);
  const stream = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => stream;
  const pending = voice.setInputDevice("mic-a");
  t.after(() => module.resolve());
  await nextTurn();
  voice.disconnect();
  assert.equal(stream.track.readyState, "ended");
  assert.equal(destination.stream.track.readyState, "ended");
  assert.ok(source.disconnects > 0);
  module.resolve();
  await pending;
  assert.equal(voice.ws.value, null);
});

test("a failed first capture graph reports an error and releases its stream", async t => {
  const stream = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => stream;
  t.mock.method(AudioContextStub.prototype, "createScriptProcessor", () => { throw new Error("Capture node unavailable"); });
  await assert.rejects(voice.ensureMicrophone(), /Capture node unavailable/);
  assert.equal(stream.track.readyState, "ended");
  assert.notEqual(voice.state.microphoneErrorCode, "");
});

test("removing the selected microphone restarts WebRTC with the default input", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.setInputDevice("mic-a");
  const { peer, socket } = await connectWebRtc();
  navigator.mediaDevices.enumerateDevices = async () => availableDevices.filter(device => device.deviceId !== "mic-a");
  const replacement = microphoneStream();
  navigator.mediaDevices.getUserMedia = async () => replacement;
  await voice.refreshAudioDevices();
  await nextTurn();
  assert.equal(peer.connectionState, "closed");
  assert.equal(socket.messages.filter(message => message.type === "webrtcOffer").length, 2);
  assert.equal(voice.selectedInputDeviceId.value, "");
  assert.equal(localStorage.getItem("webspeak:input-device"), "");
  assert.equal(replacement.track.readyState, "live");
});

test("a failed default input fallback does not overwrite the last successful preference", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.setInputDevice("mic-a");
  await voice.ensureMicrophone();
  navigator.mediaDevices.enumerateDevices = async () => availableDevices.filter(device => device.deviceId !== "mic-a");
  navigator.mediaDevices.getUserMedia = async () => { throw new Error("Default microphone unavailable"); };
  await voice.refreshAudioDevices();
  await nextTurn();
  assert.equal(voice.selectedInputDeviceId.value, "mic-a");
  assert.equal(localStorage.getItem("webspeak:input-device"), "mic-a");
  assert.notEqual(voice.state.microphoneErrorCode, "");
});

test("a rejected default output fallback preserves the last preference and reports the failure", async t => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.prepareInputDevices();
  await voice.setOutputDevice("speaker-a");
  navigator.mediaDevices.enumerateDevices = async () => availableDevices.filter(device => device.deviceId !== "speaker-a");
  const ctx = AudioContextStub.instances.at(-1);
  t.mock.method(ctx, "setSinkId", async id => { if (id === "default") throw new Error("Default output unavailable"); ctx.sinkId = id; });
  await voice.refreshAudioDevices();
  await nextTurn();
  assert.equal(voice.selectedOutputDeviceId.value, "speaker-a");
  assert.equal(localStorage.getItem("webspeak:output-device"), "speaker-a");
  assert.equal(voice.state.audioNoticeCode, "OUTPUT_DEVICE_UNAVAILABLE");
});

test("an AudioWorklet capture sends PCM and ignores late port messages after teardown", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1 });
  await nextTurn();
  const worklets = [];
  replaceGlobal("AudioWorkletNode", class extends AudioNodeStub {
    port = { onmessage: null, closed: false, close() { this.closed = true; } };
    constructor() { super(); worklets.push(this); }
  });
  AudioContextStub.instances.at(-1).audioWorklet = { addModule: async () => {} };
  await voice.setInputDevice("mic-b");
  const capture = worklets.at(-1);
  const onmessage = capture.port.onmessage;
  onmessage({ data: { samples: new Float32Array(960).fill(0.25) } });
  assert.equal(socket.messages.filter(message => message instanceof ArrayBuffer).length, 1);
  voice.disconnect();
  assert.equal(capture.port.closed, true);
  assert.ok(capture.disconnects > 0);
  onmessage({ data: { samples: new Float32Array(960).fill(0.25) } });
  assert.equal(socket.messages.filter(message => message instanceof ArrayBuffer).length, 1);
});

test("a failed newer switch restores the device whose graph is already live during enumeration", async () => {
  navigator.mediaDevices.enumerateDevices = async () => availableDevices;
  await voice.ensureMicrophone();
  const enumeration = deferred();
  let reads = 0;
  navigator.mediaDevices.enumerateDevices = () => ++reads === 1 ? enumeration.promise : Promise.resolve(availableDevices);
  const replacement = microphoneStream();
  navigator.mediaDevices.getUserMedia = ({ audio }) => audio.deviceId.exact === "mic-a"
    ? Promise.resolve(replacement) : Promise.reject(new Error("Newer input failed"));
  const first = voice.setInputDevice("mic-a");
  await nextTurn();
  await assert.rejects(voice.setInputDevice("mic-b"), /Newer input failed/);
  enumeration.resolve(availableDevices);
  await first;
  assert.equal(replacement.track.readyState, "live");
  assert.equal(voice.selectedInputDeviceId.value, "mic-a");
  assert.equal(localStorage.getItem("webspeak:input-device"), "mic-a");
});

test("disconnect while initial device labels load still cancels microphone readiness", async () => {
  const enumeration = deferred();
  navigator.mediaDevices.enumerateDevices = () => enumeration.promise;
  const readiness = voice.ensureMicrophone();
  await nextTurn();
  voice.disconnect();
  enumeration.resolve(availableDevices);
  await assert.rejects(readiness, error => error.name === "AbortError");
  assert.equal(voice.state.microphoneErrorCode, "");
});


test("voice STUN configuration reaches the browser peer and resets on a legacy connection", async () => {
  let socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, webrtcAvailable: true, webRtcStunServer: "stun:stun.example.com:3478" });
  await nextTurn();
  assert.deepEqual(TestPeer.instances.at(-1).config.iceServers, [{ urls: "stun:stun.example.com:3478" }]);
  voice.disconnect();
  socket = await connect();
  socket.receive({ type: "connected", tsClientId: 2, webrtcAvailable: true });
  await nextTurn();
  assert.deepEqual(TestPeer.instances.at(-1).config.iceServers, []);
});

test("connecting restores browser-local chat history before it is displayed", async t => {
  let queriedServerKey = "";
  const records = [
    { id: "channel-current", serverKey: "history.example:9987", conversationKey: "channel:1", messages: [
      { id: "saved-channel", scope: "channel", targetId: "1", invokerName: "Alice", message: "Saved channel message", timestamp: 1 },
    ] },
    { id: "channel-other", serverKey: "history.example:9987", conversationKey: "channel:2", messages: [
      { id: "other-channel", scope: "channel", targetId: "2", invokerName: "Alice", message: "Other channel", timestamp: 2 },
    ] },
    { id: "server", serverKey: "history.example:9987", conversationKey: "server", messages: [
      { id: "saved-server", scope: "server", invokerName: "Alice", message: "Saved server message", timestamp: 3 },
    ] },
    { id: "private", serverKey: "history.example:9987", conversationKey: "private:uid:alice", messages: [
      { id: "saved-private", scope: "private", conversationId: "7", conversationKey: "uid:alice", conversationName: "Alice", invokerName: "Alice", message: "Saved private message", timestamp: 4 },
    ] },
  ];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const database = {
    onversionchange: undefined,
    close() {},
    transaction() {
      const transaction = { oncomplete: undefined };
      return Object.assign(transaction, {
        objectStore() {
          return {
            index() {
              return {
                getAll(serverKey) {
                  queriedServerKey = serverKey;
                  const request = {};
                  queueMicrotask(() => {
                    request.result = records.filter(record => record.serverKey === serverKey);
                    request.onsuccess?.();
                    transaction.oncomplete?.();
                  });
                  return request;
                },
              };
            },
          };
        },
      });
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open: () => {
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  });

  const chat = chatView(t, { serverKey: ref("history.example:9987") });
  const socket = await connect();
  socket.receive({ type: "connected", tsClientId: 1, members: [{ id: 7, uid: "alice", nickname: "Alice" }] });
  await nextTurn();
  await nextTick();

  assert.equal(queriedServerKey, "history.example:9987");
  assert.deepEqual(voice.chatMessages.map(message => message.id), ["saved-channel", "other-channel", "saved-server", "saved-private"]);
  assert.ok(voice.chatMessages.every(message => message.isHistory), "restored messages are marked so they are not written back as new traffic");
  assert.deepEqual(chat.visibleMessages.value.map(message => message.id), ["saved-channel"]);
  chat.tab.value = "server";
  assert.deepEqual(chat.visibleMessages.value.map(message => message.id), ["saved-server"]);
  chat.openPrivateChat(7);
  assert.deepEqual(chat.visibleMessages.value.map(message => message.id), ["saved-private"]);
});
