import assert from "node:assert/strict";
import test from "node:test";
import { createRemotePlayback } from "../src/voice/remote-playback.js";

class FakeChunk {
  closed = 0;
  constructor(public readonly init: { timestamp: number; duration: number; data: Uint8Array }) {}
  close() { this.closed++; }
}

class FakeDecoder {
  static instances: FakeDecoder[] = [];
  static failConfigure = false;
  decodeQueueSize = 0;
  closed = 0;
  configured: unknown;
  chunks: FakeChunk[] = [];
  constructor(public readonly callbacks: { output: (chunk: unknown) => void; error: (error: unknown) => void }) {
    FakeDecoder.instances.push(this);
  }
  configure(config: unknown) {
    if (FakeDecoder.failConfigure) throw new Error("codec unavailable");
    this.configured = config;
  }
  decode(chunk: FakeChunk) { this.chunks.push(chunk); }
  close() { this.closed++; }
}

class FakeSource {
  static instances: FakeSource[] = [];
  stopped = 0;
  startedAt = 0;
  buffer: unknown;
  constructor() { FakeSource.instances.push(this); }
  connect() {}
  disconnect() {}
  start(time: number) { this.startedAt = time; }
  stop() { this.stopped++; }
  addEventListener() {}
}

class FakeContext {
  currentTime = 0;
  destination = {};
  createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
  createBuffer(_channels: number, frames: number, sampleRate: number) { return { duration: frames / sampleRate, copyToChannel() {} }; }
  createBufferSource() { return new FakeSource(); }
}

function decodedChunk(closed = 0) {
  return { sampleRate: 48_000, numberOfChannels: 1, numberOfFrames: 960, closed, copyTo() {}, close() { this.closed++; } };
}

function installFakes(t: { after: (callback: () => void) => void }): void {
  const previousDecoder = globalThis.AudioDecoder;
  const previousChunk = globalThis.EncodedAudioChunk;
  FakeDecoder.instances.length = 0;
  FakeSource.instances.length = 0;
  (globalThis as unknown as { AudioDecoder: unknown }).AudioDecoder = FakeDecoder;
  (globalThis as unknown as { EncodedAudioChunk: unknown }).EncodedAudioChunk = FakeChunk;
  t.after(() => {
    (globalThis as unknown as { AudioDecoder: unknown }).AudioDecoder = previousDecoder;
    (globalThis as unknown as { EncodedAudioChunk: unknown }).EncodedAudioChunk = previousChunk;
  });
}

const opusFrame = new Uint8Array([0x78, 1, 2, 3]);

test("legacy playback keeps the original 80 ms window and tears down on overflow", async t => {
  installFakes(t);
  const context = new FakeContext();
  const playback = createRemotePlayback({
    getContext: () => context as unknown as AudioContext,
    getVolume: () => 1,
    onDecodeError() {},
    onDrop() {},
  });
  playback.play(7, 4, opusFrame);
  const decoder = FakeDecoder.instances.at(-1)!;
  for (let index = 0; index < 4; index++) decoder.callbacks.output(decodedChunk());
  assert.deepEqual(FakeSource.instances.map(source => Math.round(source.startedAt * 1_000)), [0, 20, 40, 60]);
  assert.deepEqual(playback.getStats(), { bufferTargetMs: 80, bufferResets: 0, maxBufferAheadMs: 80 });
  const chunk = decodedChunk();
  decoder.callbacks.output(chunk);
  assert.equal(chunk.closed, 1);
  assert.equal(decoder.closed, 1);
  assert.equal(FakeSource.instances.length, 4);
});

test("adaptive playback resets its schedule without destroying the decoder", async t => {
  installFakes(t);
  const context = new FakeContext();
  const playback = createRemotePlayback({
    getContext: () => context as unknown as AudioContext,
    getVolume: () => 1,
    onDecodeError() {},
    onDrop() {},
    mode: "adaptive",
    maxBufferAheadMs: 80,
  });
  playback.play(7, 4, opusFrame);
  const decoder = FakeDecoder.instances.at(-1)!;
  for (let index = 0; index < 5; index++) decoder.callbacks.output(decodedChunk());
  assert.deepEqual(FakeSource.instances.map(source => Math.round(source.startedAt * 1_000)), [80, 100, 120, 140, 80]);
  assert.equal(decoder.closed, 0);
  assert.equal(FakeSource.instances.filter(source => source.stopped === 1).length, 4);
  assert.deepEqual(playback.getStats(), { bufferTargetMs: 80, bufferResets: 1, maxBufferAheadMs: 160 });
});
