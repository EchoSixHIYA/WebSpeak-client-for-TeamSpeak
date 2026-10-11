import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import { WebSocket, type WebSocketServer } from "ws";
import pino from "pino";
import { VoiceBridge } from "./voice-bridge.js";
import { JoinTicketStore } from "./join-ticket.js";
import { OpusEncoder } from "./opus-codec.js";
import { normalizeTeamSpeakKickedReason } from "../errors.js";
import type { TSClient, TSClientAvatar, TSDirectorySnapshot } from "./ts-client.js";
import type { AudioFlowStats } from "./audio-stats.js";
import type { WebRtcAudioSession } from "./webrtc-audio.js";

// Real loopback HTTP/WebSocket and native codec, with only the external SDK
// replaced. This validates gateway wiring, not a connection to TeamSpeak.
class TeamSpeakStub extends EventEmitter {
  disconnected = false;
  sent: Buffer[] = [];
  directory: TSDirectorySnapshot = { channels: [], clients: [] };
  avatarRequest: (id: number, uid: string) => Promise<TSClientAvatar | null> = async () => null;
  emitDirectorySnapshotOnConnect = true;
  connectCalls = 0;
  serverInfoCalls = 0;
  async connect() { this.connectCalls++; this.disconnected = false; if (this.emitDirectorySnapshotOnConnect) this.emit("directorySnapshot", this.directory); }
  async disconnect() { this.disconnected = true; }
  getClientId() { return 1; }
  getChannelId() { return 1n; }
  isConnected() { return !this.disconnected; }
  async getServerInfo() { this.serverInfoCalls++; return { name: "兄弟们的teamspeak", iconId: null }; }
  async getServerIcon() { return null; }
  async sendProtocolCommand() {}
  async setAccompanimentActive() {}
  sendVoice(data: Buffer) { this.sent.push(data); this.emit("sent", data); }
  sendWhisper(data: Buffer) { this.sent.push(data); }
  getClientAvatar(id: number, uid: string) { return this.avatarRequest(id, uid); }
}

async function fixture(t: TestContext, overrides: {
  createTeamSpeakClient?: () => TSClient;
  createEncoder?: () => Pick<OpusEncoder, "encode" | "dispose">;
  configureSdk?: (sdk: TeamSpeakStub) => void;
  waitForFirstMessage?: boolean;
} = {}) {
  const sdk = new TeamSpeakStub();
  overrides.configureSdk?.(sdk);
  const tickets = new JoinTicketStore();
  const bridge = new VoiceBridge({ joinTickets: tickets }, pino({ enabled: false }), undefined, {
    createTeamSpeakClient: overrides.createTeamSpeakClient ?? (() => sdk as unknown as TSClient),
    ...(overrides.createEncoder ? { createEncoder: overrides.createEncoder } : {}),
  });
  const server = createServer();
  bridge.attach(server);
  const wss = (bridge as unknown as { wss: WebSocketServer }).wss;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const ticket = tickets.create({ target: { host: "voice.example.invalid", port: 9987 }, nickname: "Test", serverPassword: "" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/voice?ticket=${ticket}`);
  const messages: Array<{ data: Buffer; binary: boolean }> = [];
  socket.on("message", (data, binary) => messages.push({ data: data as Buffer, binary }));
  const first = once(socket, "message");
  t.after(async () => {
    socket.terminate();
    // Clean fixtures even when a regression removes the WebSocketServer's own
    // close listener. The membership assertion below tests that behavior first.
    for (const peer of wss.clients) peer.terminate();
    wss.clients.clear();
    await bridge.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  if (overrides.waitForFirstMessage !== false) await first;
  const entries = (bridge as unknown as { entries: Map<string, {
    id: string; ws: WebSocket; audio: AudioFlowStats; webrtc: WebRtcAudioSession | null;
    isAlive: boolean; avatarCache: Map<string, string | null>;
    members: Map<number, { id: number; uid: string }>; eventLog: unknown[];
  }> }).entries;
  return { bridge, sdk, socket, messages, entries, wss };
}

test("a TeamSpeak constructor failure releases the admitted gateway slot", { timeout: 5_000 }, async t => {
  const f = await fixture(t, { createTeamSpeakClient() { throw new Error("Identity initialization failed"); } });
  if (f.socket.readyState !== WebSocket.CLOSED) await once(f.socket, "close");
  await nextTurn();
  assert.equal(JSON.parse(f.messages[0]!.data.toString()).code, "TEAM_SPEAK_CLIENT_UNAVAILABLE");
  assert.equal(f.bridge.getActiveCount(), 0);
});

test("server identity lookup waits until the directory sync publishes the connected state", { timeout: 5_000 }, async t => {
  const f = await fixture(t, { waitForFirstMessage: false, configureSdk(sdk) { sdk.emitDirectorySnapshotOnConnect = false; } });
  while (!f.sdk.connectCalls) await nextTurn();
  await nextTurn();
  assert.equal(f.sdk.serverInfoCalls, 0);

  const serverInfo = new Promise<Record<string, unknown>>(resolve => {
    f.socket.on("message", (data, binary) => {
      if (binary) return;
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type === "serverInfo") resolve(message);
    });
  });
  f.sdk.emit("directorySnapshot", f.sdk.directory);
  assert.deepEqual(await serverInfo, { type: "serverInfo", name: "兄弟们的teamspeak", icon: null });
  const publishedTypes = f.messages.filter(message => !message.binary).map(message => (JSON.parse(message.data.toString()) as { type: string }).type);
  assert.ok(publishedTypes.indexOf("connected") >= 0);
  assert.ok(publishedTypes.indexOf("serverInfo") > publishedTypes.indexOf("connected"));
  assert.equal(f.sdk.serverInfoCalls, 1);
  assert.ok(f.bridge.getActiveCount() > 0);
});

test("a codec disposal failure cannot abandon TeamSpeak or the browser socket", { timeout: 5_000 }, async t => {
  const encoder = new OpusEncoder(48000, 1);
  t.mock.method(encoder, "dispose", () => { throw new Error("Codec already disposed"); });
  const f = await fixture(t, { createEncoder: () => encoder });
  const entry = [...f.entries.values()][0]!;
  await f.bridge.terminateSession(entry.id);
  assert.equal(f.sdk.disconnected, true);
  assert.notEqual(entry.ws.readyState, WebSocket.OPEN);
  assert.equal(f.bridge.getActiveCount(), 0);
});

test("late SDK audio during peer closure cannot write after the session is removed", { timeout: 5_000 }, async t => {
  const f = await fixture(t);
  const entry = [...f.entries.values()][0]!;
  const onVoice = f.sdk.listeners("voiceData")[0]!;
  let release!: () => void;
  const closing = new Promise<void>(resolve => { release = resolve; });
  entry.webrtc = { close: () => closing, getStats: () => ({}) } as unknown as WebRtcAudioSession;
  const writes: unknown[] = [];
  t.mock.method(entry.ws, "send", (data: unknown) => { writes.push(data); });
  const stopped = f.bridge.terminateSession(entry.id);
  try {
    onVoice({ clientId: 2, codec: 4, data: Buffer.from([1, 2, 3]) });
    assert.equal(writes.length, 0);
    assert.equal(entry.audio.tsReceiveFrames, 0);
  } finally {
    release();
    await stopped;
  }
});

test("normal session teardown retains the WebSocketServer close bookkeeping", { timeout: 5_000 }, async t => {
  const f = await fixture(t);
  const entry = [...f.entries.values()][0]!;
  const closed = once(entry.ws, "close");
  await f.bridge.terminateSession(entry.id);
  // Do not await our close listener: a broken removeAllListeners erases it too.
  await once(f.socket, "close");
  await nextTurn();
  assert.equal(f.wss.clients.size, 0);
  await closed;
});

test("loopback PCM reaches the SDK as native Opus and malformed PCM is rejected", { timeout: 5_000 }, async t => {
  const f = await fixture(t);
  const sent = once(f.sdk, "sent");
  f.socket.send(Buffer.alloc(1_920));
  await sent;
  const encoded = f.sdk.sent[0]!;
  assert.ok(encoded.length > 0 && encoded.length < 1_920, "must encode Opus, not pass through PCM");
  const decoder = new OpusEncoder(48_000, 1);
  try { assert.equal(decoder.decode(encoded).length, 1_920); }
  finally { decoder.dispose(); }
  const error = once(f.socket, "message");
  f.socket.send(Buffer.alloc(1_919));
  const [raw] = await error;
  assert.equal(JSON.parse(raw.toString()).error.code, "INVALID_AUDIO_FRAME");
  assert.equal(f.sdk.sent.length, 1);
});

test("failed final peer statistics do not interrupt session cleanup", { timeout: 5_000 }, async t => {
  const f = await fixture(t);
  const entry = [...f.entries.values()][0]!;
  entry.webrtc = { close: async () => {}, getStats() { throw new Error("Closed peer"); } } as unknown as WebRtcAudioSession;
  await f.bridge.terminateSession(entry.id);
  assert.equal(f.sdk.disconnected, true);
  assert.notEqual(entry.ws.readyState, WebSocket.OPEN);
  assert.equal(f.bridge.getActiveCount(), 0);
});

async function avatarFixture(t: TestContext) {
  const calls: number[] = [];
  const avatar = { cacheKey: "sample", data: Buffer.from("GIF89a") };
  let release!: (value: TSClientAvatar) => void;
  let started!: () => void;
  const pending = new Promise<TSClientAvatar>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  t.after(() => release(avatar));
  const f = await fixture(t, { configureSdk(sdk) {
    sdk.directory.clients = [2, 3].map(id => ({ id, uid: `user-${id}`, nickname: `User ${id}`, channelID: 1n, type: 1, serverGroups: [] }));
    sdk.avatarRequest = async id => { calls.push(id); if (calls.length === 1) { started(); return pending; } return avatar; };
  } });
  await firstStarted;
  return { ...f, calls, release: () => release(avatar), entry: [...f.entries.values()][0]! };
}

test("avatar completion after teardown cannot refill the cache or start another SDK request", { timeout: 5_000 }, async t => {
  const f = await avatarFixture(t);
  await f.bridge.terminateSession(f.entry.id);
  f.release();
  await nextTurn();
  assert.equal(f.entry.avatarCache.size, 0);
  assert.deepEqual(f.calls, [2]);
});

test("pending heartbeat acknowledgement does not cancel a live avatar refresh", { timeout: 5_000 }, async t => {
  const f = await avatarFixture(t);
  f.entry.isAlive = false;
  f.release();
  await nextTurn();
  assert.deepEqual(f.calls, [2, 3]);
  assert.equal(f.entry.avatarCache.size, 2);
});

test("an interrupted SDK connection invalidates its pending avatar results", { timeout: 5_000 }, async t => {
  const f = await avatarFixture(t);
  f.sdk.emit("disconnected");
  f.release();
  await nextTurn();
  assert.equal(f.entry.avatarCache.size, 0);
  assert.deepEqual(f.calls, [2]);
});

test("late directory callbacks cannot refill a session while its peer is closing", { timeout: 5_000 }, async t => {
  const f = await fixture(t);
  const entry = [...f.entries.values()][0]!;
  const onEnter = f.sdk.listeners("clientEnter")[0]!;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  entry.webrtc = { close: () => pending, getStats: () => ({}) } as unknown as WebRtcAudioSession;
  const closing = f.bridge.terminateSession(entry.id);
  try {
    onEnter({ id: 9, uid: "", nickname: "Late", channelID: 1n, type: 1, serverGroups: [] });
    assert.equal(entry.members.has(9), false);
  } finally {
    release();
    await closing;
  }
});

test("directory snapshots during reconnect backoff cannot leak members into the next connection", { timeout: 5_000 }, async t => {
  const f = await fixture(t);
  const entry = [...f.entries.values()][0]!;
  const reconnected = new Promise<void>(resolve => {
    f.socket.on("message", (data, binary) => { if (!binary && JSON.parse(data.toString()).type === "reconnected") resolve(); });
  });
  f.sdk.emit("disconnected");
  f.sdk.emit("directorySnapshot", { channels: [], clients: [{ id: 9, uid: "", nickname: "Stale", channelID: 1n, type: 1, serverGroups: [] }] });
  await reconnected;
  assert.equal(entry.members.has(9), false);
});

test("commands arriving during recovery receive a correlated rejection", { timeout: 5_000 }, async t => {
  const f = await fixture(t);
  const rejected = new Promise<{ requestId?: string }>(resolve => {
    f.socket.on("message", (data, binary) => {
      if (binary) return;
      const message = JSON.parse(data.toString());
      if (message.type === "error" && message.error?.code === "SESSION_NOT_READY") resolve(message);
    });
  });
  f.sdk.emit("disconnected");
  f.socket.send(JSON.stringify({ type: "sendServerMessage", requestId: "chat-in-flight", payload: { message: "Hello" } }));
  assert.equal((await rejected).requestId, "chat-in-flight");
});

for (const order of ["kick-first", "disconnect-first"] as const) {
  test(`a kick remains terminal when notifications arrive ${order}`, { timeout: 5_000 }, async t => {
    const f = await fixture(t);
    const kick = normalizeTeamSpeakKickedReason("Removed by operator", 4);
    if (order === "disconnect-first") f.sdk.emit("disconnected");
    f.sdk.emit("kicked", kick);
    if (order === "kick-first") f.sdk.emit("disconnected");
    await nextTurn();
    assert.equal(f.bridge.getActiveCount(), 0);
    if (f.socket.readyState !== WebSocket.CLOSED) await once(f.socket, "close");
    const failures = f.messages.filter(message => !message.binary).map(message => JSON.parse(message.data.toString())).filter(message => message.type === "connectionFailed");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, "KICKED");
    assert.match(failures[0].detail, /Removed by operator/);
  });
}
