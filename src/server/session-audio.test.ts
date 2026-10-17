import assert from "node:assert/strict";
import test from "node:test";
import { SessionAudioTransport } from "./session-audio.js";
import { createAudioFlowStats } from "./audio-stats.js";
import type { Logger as LoggerType } from "../logger.js";
import type { ServerMessage } from "../shared/server-messages.js";
import type { TSVoiceData } from "./ts-client.js";

function fixture() {
  const state = { current: true, ready: true, now: 0, targets: null as number[] | null, disposed: 0,
    peer: null as { pushTeamSpeakVoice(data: TSVoiceData): void } | null };
  const audio = createAudioFlowStats();
  const packets: Buffer[] = [];
  const encoded: Buffer[] = [];
  const forwarded: Array<{ data: Buffer; codec: number; targets?: number[] }> = [];
  const notices: ServerMessage[] = [];
  const warnings: Array<Record<string, unknown>> = [];
  const logger: LoggerType = {
    debug: () => {},
    info: () => {},
    error: () => {},
    warn: (objOrMsg: Record<string, unknown> | string) => { if (typeof objOrMsg !== "string") warnings.push(objOrMsg); },
    child: () => logger,
  };
  const socket = { readyState: 1 as 0 | 1 | 2 | 3, bufferedAmount: 0, send: (packet: Buffer) => { packets.push(packet); } };
  const client = {
    sendVoice: (data: Buffer, codec: number) => { forwarded.push({ data, codec }); },
    sendWhisper: (data: Buffer, targets: number[], codec: number) => { forwarded.push({ data, codec, targets }); },
  };
  const encoder = {
    encode(frame: Buffer) { encoded.push(frame); state.now += 3; return Buffer.from([9, 8, 7]); },
    dispose() { state.disposed++; },
  };
  const transport = new SessionAudioTransport({
    audio, socket, client, logger, isCurrent: () => state.current, isReady: () => state.ready,
    selfId: () => 1, peer: () => state.peer, whisperTargets: () => state.targets,
    sendJson: message => { notices.push(message); },
  }, encoder, () => state.now);
  const remote = (clientId = 513) => ({ clientId, codec: 4, data: Buffer.from([11, 12, 13]) });
  return { transport, audio, state, socket, client, encoder, packets, encoded, forwarded, notices, warnings, remote };
}

test("PCM framing preserves codec, whisper routing and timing counters", () => {
  const f = fixture();
  f.transport.receivePcm(Buffer.alloc(1_920));
  f.state.now = 20;
  f.state.targets = [7, 8];
  f.transport.receivePcm(Buffer.alloc(1_920));
  assert.deepEqual(f.forwarded.map(({ codec, targets }) => ({ codec, targets })), [
    { codec: 4, targets: undefined }, { codec: 4, targets: [7, 8] },
  ]);
  assert.equal(f.audio.ingressFrames, 2);
  assert.equal(f.audio.ingressMaxGapMs, 20);
  assert.equal(f.audio.tsSendMaxGapMs, 20);
  assert.equal(f.audio.tsEncodeMaxMs, 3);
});

test("invalid PCM is rejected and reconnecting sessions do not encode audio", () => {
  const f = fixture();
  f.transport.receivePcm(Buffer.alloc(1_919));
  f.state.now = 5_000;
  f.transport.receivePcm(Buffer.alloc(1_921));
  assert.equal(f.notices.length, 2);
  assert.deepEqual(f.notices[0], { type: "error", error: { code: "INVALID_AUDIO_FRAME", message: "音频帧格式无效", recoverable: false } });
  assert.deepEqual(f.notices[1], f.notices[0]);
  f.state.ready = false;
  f.state.now = 10_000;
  f.transport.receivePcm(Buffer.alloc(1_919));
  assert.equal(f.notices.length, 2, "a frame the route discards must not be reported as malformed");
  assert.equal(f.warnings.length, 2, "a frame the route discards must not reach the operator log");
  f.transport.receivePcm(Buffer.alloc(1_920));
  f.transport.receiveWebRtc(Buffer.from([1]), 4);
  f.transport.receiveTeamSpeak(f.remote());
  assert.equal(f.audio.ingressDroppedFrames, 4);
  assert.equal(f.encoded.length, 0);
  assert.equal(f.forwarded.length, 0);
  assert.equal(f.packets.length, 0);
});

test("repeated malformed frames are counted in full but reported once per window", () => {
  const f = fixture();
  for (const now of [0, 1, 4_999, 5_000]) { f.state.now = now; f.transport.receivePcm(Buffer.alloc(1_919)); }
  assert.equal(f.audio.ingressDroppedFrames, 4, "every discarded frame still reaches the flow counters");
  assert.equal(f.notices.length, 2, "the browser sees one error per window, not one per frame");
  assert.deepEqual(f.warnings, [
    { code: "INVALID_AUDIO_FRAME", frameBytes: 1_919, expectedBytes: 1_920, droppedFrames: 1 },
    { code: "INVALID_AUDIO_FRAME", frameBytes: 1_919, expectedBytes: 1_920, droppedFrames: 4 },
  ], "operators get the same rate-limited view through the logger");
});

test("an encoder failure and a malformed frame do not suppress each other", t => {
  const f = fixture();
  t.mock.method(f.encoder, "encode", () => { throw new Error("Codec failed"); });
  f.transport.receivePcm(Buffer.alloc(1_919));
  f.transport.receivePcm(Buffer.alloc(1_920));
  assert.deepEqual(f.notices.map(message => message.type), ["error", "audioError"]);
  t.mock.restoreAll();
});

test("WebRTC ingress excludes queued PCM and fallback re-enables PCM", () => {
  const f = fixture();
  f.state.peer = { pushTeamSpeakVoice() {} };
  f.transport.receivePcm(Buffer.alloc(1_920));
  const opus = Buffer.from([3, 2, 1]);
  f.transport.receiveWebRtc(opus, 5);
  assert.equal(f.encoded.length, 0);
  assert.deepEqual(f.forwarded, [{ data: opus, codec: 5 }]);
  assert.equal(f.audio.ingressDroppedFrames, 1);
  f.state.peer = null;
  f.transport.receivePcm(Buffer.alloc(1_920));
  assert.equal(f.encoded.length, 1);
  assert.equal(f.audio.tsSendFrames, 2);
});

test("TeamSpeak packets keep the three-byte header and exclude self playback", () => {
  const f = fixture();
  f.transport.receiveTeamSpeak(f.remote(1));
  const remote = f.remote();
  f.transport.receiveTeamSpeak(remote);
  remote.data.fill(0);
  assert.deepEqual([...f.packets[0]!], [4, 2, 1, 11, 12, 13]);
  assert.equal(f.audio.tsReceiveFrames, 2);
  assert.equal(f.audio.egressFrames, 1);
  assert.deepEqual(f.audio.egressFramesByClient, { "513": 1 });
});

test("backpressure drops bursts above 4096 bytes and resumes without a retained queue", () => {
  const f = fixture();
  f.socket.bufferedAmount = 4_096;
  f.transport.receiveTeamSpeak(f.remote());
  f.socket.bufferedAmount = 4_097;
  for (let i = 0; i < 100; i++) f.transport.receiveTeamSpeak(f.remote());
  assert.equal(f.packets.length, 1);
  assert.equal(f.audio.egressDroppedFrames, 100);
  f.socket.bufferedAmount = 0;
  f.transport.receiveTeamSpeak(f.remote());
  assert.equal(f.packets.length, 2);
  assert.equal(f.audio.egressPeakBufferedBytes, 4_097);
});

test("WebRTC downlink owns egress without a duplicate WebSocket packet", () => {
  const f = fixture();
  const received: TSVoiceData[] = [];
  f.state.peer = { pushTeamSpeakVoice: data => { received.push(data); } };
  f.transport.receiveTeamSpeak(f.remote());
  assert.equal(received.length, 1);
  assert.equal(f.packets.length, 0);
  f.state.peer = null;
  f.transport.receiveTeamSpeak(f.remote());
  assert.equal(received.length, 1);
  assert.equal(f.packets.length, 1);
});

test("encoding failures are counted and reported at most once per five seconds", t => {
  const f = fixture();
  t.mock.method(f.encoder, "encode", () => { throw new Error("Codec failed"); });
  for (const now of [0, 1, 4_999, 5_000]) { f.state.now = now; f.transport.receivePcm(Buffer.alloc(1_920)); }
  assert.equal(f.audio.tsSendErrors, 4);
  assert.equal(f.audio.ingressDroppedFrames, 4);
  assert.equal(f.forwarded.length, 0);
  assert.equal(f.notices.length, 2);
  assert.deepEqual(f.notices[0], { type: "audioError", code: "AUDIO_ENCODER_UNAVAILABLE", detail: "Opus encoder unavailable" });
  t.mock.restoreAll();
  f.transport.receivePcm(Buffer.alloc(1_920));
  assert.equal(f.audio.tsSendFrames, 1);
});

test("SDK and downlink failures cannot escape the audio callbacks", t => {
  const f = fixture();
  t.mock.method(f.client, "sendVoice", () => { throw new Error("SDK disconnected"); });
  f.transport.receivePcm(Buffer.alloc(1_920));
  assert.equal(f.audio.tsSendErrors, 1);
  assert.equal(f.notices.length, 0, "SDK failure must not be reported as an encoder failure");
  t.mock.method(f.socket, "send", () => { throw new Error("Socket closed"); });
  f.transport.receiveTeamSpeak(f.remote());
  f.state.peer = { pushTeamSpeakVoice() { throw new Error("Peer closed"); } };
  f.transport.receiveTeamSpeak(f.remote());
  assert.equal(f.audio.egressDroppedFrames, 2);
});

test("removed sessions and closed sockets ignore late frames without changing counters", () => {
  const f = fixture();
  const baseline = structuredClone(f.audio);
  const lateFrames = () => {
    f.transport.receivePcm(Buffer.alloc(1_920));
    f.transport.receiveWebRtc(Buffer.from([1]), 4);
    f.transport.receiveTeamSpeak(f.remote());
  };
  f.state.current = false;
  lateFrames();
  f.state.current = true;
  f.socket.readyState = 3;
  lateFrames();
  assert.deepEqual(f.audio, baseline);
  assert.equal(f.encoded.length, 0);
});

test("codec cleanup is idempotent even if disposal throws", t => {
  const f = fixture();
  let attempts = 0;
  t.mock.method(f.encoder, "dispose", () => { attempts++; throw new Error("Already closed"); });
  f.transport.close();
  f.transport.close();
  f.transport.receivePcm(Buffer.alloc(1_920));
  f.transport.receiveWebRtc(Buffer.from([1]), 4);
  f.transport.receiveTeamSpeak(f.remote());
  assert.equal(attempts, 1);
  assert.equal(f.audio.ingressFrames, 0);
  assert.equal(f.audio.tsReceiveFrames, 0);
});

test("invalid SDK speaker IDs and codecs cannot throw while packing the header", () => {
  const f = fixture();
  for (const clientId of [-1, 65_536, NaN]) f.transport.receiveTeamSpeak(f.remote(clientId));
  for (const codec of [-1, 256, NaN]) f.transport.receiveTeamSpeak({ ...f.remote(), codec });
  assert.equal(f.audio.egressDroppedFrames, 6);
  assert.equal(f.packets.length, 0);
});

test("PCM sent faster than real time is dropped without throttling a real-time stream", () => {
  const paced = fixture();
  for (let i = 0; i < 500; i++) { paced.state.now = i * 20; paced.transport.receivePcm(Buffer.alloc(1_920)); }
  assert.equal(paced.forwarded.length, 500);
  assert.equal(paced.audio.ingressDroppedFrames, 0);

  // A one-second stall followed by its backlog still gets through in full.
  const stalled = fixture();
  stalled.state.now = 1_000;
  for (let i = 0; i < 50; i++) stalled.transport.receivePcm(Buffer.alloc(1_920));
  assert.equal(stalled.forwarded.length, 50);

  const flood = fixture();
  for (let i = 0; i < 1_000; i++) flood.transport.receivePcm(Buffer.alloc(1_920));
  assert.ok(flood.forwarded.length < 100, `forwarded ${flood.forwarded.length} flooded frames`);
  assert.equal(flood.audio.ingressDroppedFrames, 1_000 - flood.forwarded.length);
  assert.equal(flood.warnings.filter(warning => warning.code === "AUDIO_RATE_EXCEEDED").length, 1);
  assert.equal(flood.notices.length, 0, "rate drops are not reported to the browser as malformed audio");
});
