import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpusUplink } from "../src/voice/opus-uplink.ts";

function fakeUplink() {
  let output: ((chunk: { byteLength: number; copyTo(target: Uint8Array): void }) => void) | null = null;
  const encoded: AudioData[] = [];
  const sent: Uint8Array[] = [];
  let dropped = 0;
  let configured = false;
  const encoder = {
    state: "unconfigured" as "unconfigured" | "configured" | "closed",
    encodeQueueSize: 0,
    configure() { configured = true; this.state = "configured"; },
    encode(data: AudioData) {
      if (this.state !== "configured") throw new DOMException("Encoder is not configured", "InvalidStateError");
      encoded.push(data);
      output?.({ byteLength: 3, copyTo(target: Uint8Array) { target.set([1, 2, 3]); } });
    },
    reset() { this.state = "unconfigured"; },
    close() { this.state = "closed"; },
  };
  const uplink = createOpusUplink({
    send(frame) { sent.push(frame); return true; },
    onDrop() { dropped++; },
    onFallback() {},
    createEncoder: (nextOutput) => { output = nextOutput; return encoder; },
    createAudioData: () => ({}) as AudioData,
  });
  return { uplink, encoded, sent, encoder, configured: () => configured, dropped: () => dropped };
}

test("Opus uplink accumulates 960 samples, emits tagged frames and resets on VOX close", async () => {
  const f = fakeUplink();
  assert.equal(await f.uplink.init(), true);
  assert.equal(f.configured(), true);
  f.uplink.push(new Float32Array(960));
  assert.equal(f.encoded.length, 1);
  assert.deepEqual([...f.sent[0]!], [2, 1, 2, 3]);
  f.uplink.push(new Float32Array(480));
  assert.equal(f.encoded.length, 1);
  f.uplink.push(new Float32Array(480));
  assert.equal(f.encoded.length, 2);
  f.uplink.resetStream();
  assert.equal(f.encoder.state, "configured");
  f.uplink.push(new Float32Array(960));
  assert.equal(f.encoded.length, 3);
  f.uplink.disable();
  assert.equal(f.uplink.active, false);
});

test("an encoder error partway through a large capture chunk exits the loop and falls back", async () => {
  const f = fakeUplink();
  await f.uplink.init();
  f.encoder.encode = () => { throw new DOMException("Encoding failed", "EncodingError"); };
  assert.equal(f.uplink.push(new Float32Array(4096)), false);
  assert.equal(f.uplink.active, false);
});

test("Opus uplink cancels initialization when disabled during capability detection", async t => {
  const previousEncoder = globalThis.AudioEncoder;
  let resolveSupport!: (value: { supported: boolean }) => void;
  let constructed = 0;
  (globalThis as unknown as { AudioEncoder: unknown }).AudioEncoder = class {
    static isConfigSupported() {
      return new Promise<{ supported: boolean }>(resolve => { resolveSupport = resolve; });
    }
    constructor() { constructed++; }
  };
  t.after(() => { (globalThis as unknown as { AudioEncoder: unknown }).AudioEncoder = previousEncoder; });

  const uplink = createOpusUplink({ send() { return true; }, onDrop() {}, onFallback() {} });
  const initializing = uplink.init();
  uplink.disable();
  resolveSupport({ supported: true });
  assert.equal(await initializing, false);
  assert.equal(uplink.active, false);
  assert.equal(constructed, 0);
});

test("Opus uplink drops a frame when the encoder queue is full", async () => {
  const f = fakeUplink();
  assert.equal(await f.uplink.init(), true);
  f.encoder.encodeQueueSize = 4;
  f.uplink.push(new Float32Array(960));
  assert.equal(f.encoded.length, 0);
  assert.equal(f.dropped(), 1);
  f.encoder.encodeQueueSize = 0;
  f.uplink.push(new Float32Array(960));
  assert.equal(f.encoded.length, 1);
});
