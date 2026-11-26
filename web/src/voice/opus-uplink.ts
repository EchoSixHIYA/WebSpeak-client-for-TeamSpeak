/**
 * Optional Opus uplink for the PCM-over-WebSocket fallback path.
 *
 * The browser already has a microphone AudioWorklet that produces 48 kHz
 * mono Float32 samples. WebCodecs encodes the same 20 ms frames that the PCM
 * path would have sent, but at 16-24 kbps instead of ~96 KB/s. Safari and
 * older browsers do not expose an audio AudioEncoder, so the caller keeps the
 * PCM path and this module simply reports itself inactive.
 */

import { VOICE_FRAME_SAMPLES, VOICE_MAX_OPUS_FRAME_BYTES, VOICE_OPUS_TAG } from "../../../src/shared/voice-audio.js";

interface AudioEncoderLike {
  readonly state: "unconfigured" | "configured" | "closed";
  readonly encodeQueueSize: number;
  configure(config: AudioEncoderConfig): void;
  encode(data: AudioData): void;
  reset(): void;
  close(): void;
}

interface OpusUplinkOptions {
  /** Return false when the socket is closed or above its outbound budget. */
  send(frame: Uint8Array): boolean;
  onDrop(): void;
  onFallback(reason: string): void;
  createEncoder?: (output: (chunk: EncodedAudioChunk) => void, error: (error: DOMException) => void) => AudioEncoderLike;
  createAudioData?: (frame: Float32Array, timestampUs: number) => AudioData;
}

const FRAME_DURATION_US = 20_000;
const MAX_ENCODE_QUEUE = 4;
const OPUS_CONFIG: AudioEncoderConfig = {
  codec: "opus",
  sampleRate: 48_000,
  numberOfChannels: 1,
  bitrate: 24_000,
  opus: {
    frameDuration: FRAME_DURATION_US,
    complexity: 5,
    packetlossperc: 0,
    useinbandfec: false,
    usedtx: false,
  },
};

export function createOpusUplink(options: OpusUplinkOptions) {
  let encoder: AudioEncoderLike | null = null;
  let active = false;
  let closed = false;
  let lifecycle = 0;
  let timestampUs = 0;
  let pending = new Float32Array(VOICE_FRAME_SAMPLES);
  let pendingLength = 0;

  function emit(frame: Uint8Array): void {
    if (!active || closed) return;
    if (!options.send(frame)) options.onDrop();
  }

  function handleOutput(chunk: EncodedAudioChunk): void {
    try {
      if (!active || closed || chunk.byteLength <= 0) return;
      if (chunk.byteLength > VOICE_MAX_OPUS_FRAME_BYTES) {
        options.onFallback("OPUS_FRAME_TOO_LARGE");
        deactivate();
        return;
      }
      const frame = new Uint8Array(1 + chunk.byteLength);
      frame[0] = VOICE_OPUS_TAG;
      chunk.copyTo(frame.subarray(1));
      emit(frame);
    } catch (error) {
      options.onFallback(error instanceof Error ? error.message : "OPUS_OUTPUT_FAILED");
      deactivate();
    }
  }

  function handleError(error: DOMException): void {
    if (!active) return;
    options.onFallback(error?.name || "OPUS_ENCODER_ERROR");
    deactivate();
  }

  function deactivate(): void {
    lifecycle++;
    active = false;
    try { encoder?.close(); } catch { /* already closed */ }
    encoder = null;
    pendingLength = 0;
  }

  async function init(): Promise<boolean> {
    if (closed) return false;
    deactivate();
    const attempt = lifecycle;
    const factory = options.createEncoder;
    const Encoder = factory ? null : (globalThis as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder;
    if (!factory && !Encoder) return false;
    try {
      if (!factory && Encoder?.isConfigSupported) {
        const support = await Encoder.isConfigSupported(OPUS_CONFIG);
        if (!support.supported) return false;
      }
      if (closed || attempt !== lifecycle) return false;
      const output = (chunk: EncodedAudioChunk) => { if (attempt === lifecycle) handleOutput(chunk); };
      const error = (reason: DOMException) => { if (attempt === lifecycle) handleError(reason); };
      const next = factory ? factory(output, error) : new Encoder!({ output, error });
      next.configure(OPUS_CONFIG);
      encoder = next;
      active = true;
      timestampUs = 0;
      pendingLength = 0;
      return true;
    } catch (error) {
      if (closed || attempt !== lifecycle) return false;
      options.onFallback(error instanceof Error ? error.message : "OPUS_CONFIG_UNSUPPORTED");
      deactivate();
      return false;
    }
  }

  function encodePending(): void {
    if (!encoder || !active || pendingLength < VOICE_FRAME_SAMPLES) return;
    if (encoder.encodeQueueSize >= MAX_ENCODE_QUEUE) {
      // The encoder is behind; drop the oldest unsent frame rather than
      // building an ever-growing latency tail.
      options.onDrop();
      pending.copyWithin(0, VOICE_FRAME_SAMPLES, pendingLength);
      pendingLength -= VOICE_FRAME_SAMPLES;
      return;
    }
    const frame = pending.slice(0, VOICE_FRAME_SAMPLES);
    try {
      const audioData = options.createAudioData
        ? options.createAudioData(frame, timestampUs)
        : new AudioData({
          format: "f32-planar",
          sampleRate: 48_000,
          numberOfFrames: VOICE_FRAME_SAMPLES,
          numberOfChannels: 1,
          timestamp: timestampUs,
          data: frame.buffer as ArrayBuffer,
        });
      encoder.encode(audioData);
      audioData.close?.();
      timestampUs += FRAME_DURATION_US;
    } catch (error) {
      options.onFallback(error instanceof Error ? error.message : "OPUS_ENCODE_FAILED");
      deactivate();
      return;
    }
    pendingLength -= VOICE_FRAME_SAMPLES;
    if (pendingLength > 0) pending.copyWithin(0, VOICE_FRAME_SAMPLES, VOICE_FRAME_SAMPLES + pendingLength);
  }

  function push(samples: Float32Array): boolean {
    if (!active || closed || !samples.length) return active;
    let offset = 0;
    while (offset < samples.length) {
      const copy = Math.min(VOICE_FRAME_SAMPLES - pendingLength, samples.length - offset);
      pending.set(samples.subarray(offset, offset + copy), pendingLength);
      pendingLength += copy;
      offset += copy;
      if (pendingLength === VOICE_FRAME_SAMPLES) encodePending();
    }
    return active;
  }

  /** Called when VOX closes or the input graph restarts; keeps the encoder configured. */
  function resetStream(): void {
    pendingLength = 0;
    timestampUs = 0;
    try { encoder?.reset(); } catch { /* reset is best effort */ }
  }

  function close(): void {
    closed = true;
    deactivate();
  }

  function disable(): void {
    deactivate();
  }

  return {
    init,
    push,
    resetStream,
    close,
    disable,
    get active() { return active; },
  };
}
