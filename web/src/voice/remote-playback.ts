import { opusPacketDurationUs } from "./opus-packet.js";
import { computeTargetAheadMs, JitterEstimator, shouldRecover, shouldResetSchedule } from "./jitter-buffer.js";

type RemotePlaybackMode = "legacy" | "adaptive";

interface RemotePlaybackOptions {
  getContext(): AudioContext;
  getVolume(clientId: number): number;
  onDecodeError(): void;
  onDrop(): void;
  /**
   * Legacy keeps the original fixed 80 ms window and decoder teardown. Adaptive
   * is the CFT-oriented path. Defaults to legacy for direct deployments.
   */
  mode?: RemotePlaybackMode | (() => RemotePlaybackMode);
  /** Upper bound for the adaptive buffer; ignored in legacy mode. */
  maxBufferAheadMs?: number | (() => number);
}

interface SpeakerPlayback {
  mode: RemotePlaybackMode;
  codec: 4 | 5;
  context: AudioContext;
  decoder: AudioDecoder | null;
  gain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  playTime: number;
  timestamp: number;
  jitter: JitterEstimator;
  resets: number;
  maxAheadMs: number;
}

export interface FallbackPlaybackStats {
  bufferTargetMs: number;
  bufferResets: number;
  maxBufferAheadMs: number;
}

// Preserve the compatibility path's bounded jitter buffer and decoder queue.
const LEGACY_MAX_PLAY_AHEAD_SECONDS = 0.08;
const LEGACY_MAX_DECODE_QUEUE_FRAMES = 3;
// A decoded-frame queue above this is unusual; adaptive keeps decoding instead
// of tearing down the decoder. Only a deeply stalled queue drops the newest frame.
const MAX_DECODE_QUEUE_FRAMES_HARD = 12;

export function createRemotePlayback(options: RemotePlaybackOptions) {
  const speakers = new Map<number, SpeakerPlayback>();

  function mode(): RemotePlaybackMode {
    const configured = options.mode;
    try {
      return typeof configured === "function" ? configured() : configured ?? "legacy";
    } catch {
      return "legacy";
    }
  }

  function maxBufferAheadMs(): number {
    const configured = options.maxBufferAheadMs;
    try {
      return typeof configured === "function" ? configured() : configured ?? 300;
    } catch {
      return 300;
    }
  }

  function clear(clientId: number): void {
    const stream = speakers.get(clientId);
    if (!stream) return;
    // Invalidate callbacks before closing their resources.
    speakers.delete(clientId);
    try { stream.decoder?.close(); } catch { /* decoder may already be closed */ }
    for (const source of stream.sources) {
      try { source.stop(); } catch { /* not started or already ended */ }
      source.disconnect();
    }
    stream.sources.clear();
    stream.gain.disconnect();
  }

  function resetSchedule(stream: SpeakerPlayback, targetSeconds: number): void {
    for (const source of stream.sources) {
      try { source.stop(); } catch { /* not started or already ended */ }
      source.disconnect();
    }
    stream.sources.clear();
    stream.playTime = stream.context.currentTime + targetSeconds;
    stream.resets++;
  }

  function enqueueChunk(stream: SpeakerPlayback, chunk: AudioData, startTime: number): number {
    const { context, gain, sources } = stream;
    const { sampleRate, numberOfChannels, numberOfFrames } = chunk;
    const duration = numberOfFrames / sampleRate;
    const buffer = context.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const samples = new Float32Array(numberOfFrames);
      chunk.copyTo(samples, { planeIndex: channel, format: "f32-planar" });
      buffer.copyToChannel(samples, channel);
    }
    const source = context.createBufferSource();
    sources.add(source);
    source.buffer = buffer;
    source.connect(gain);
    source.addEventListener("ended", () => {
      source.disconnect();
      // The old stream owns this set; never delete a replacement's resources.
      sources.delete(source);
    }, { once: true });
    source.start(startTime);
    return duration;
  }

  function outputLegacy(clientId: number, stream: SpeakerPlayback, chunk: AudioData): void {
    const context = stream.context;
    const playTime = Math.max(stream.playTime, context.currentTime);
    const duration = chunk.numberOfFrames / chunk.sampleRate;
    if (playTime + duration > context.currentTime + LEGACY_MAX_PLAY_AHEAD_SECONDS) {
      stream.resets++;
      clear(clientId);
      return;
    }
    enqueueChunk(stream, chunk, playTime);
    stream.playTime = playTime + duration;
    stream.maxAheadMs = Math.max(stream.maxAheadMs, (stream.playTime - context.currentTime) * 1_000);
  }

  function outputAdaptive(clientId: number, stream: SpeakerPlayback, chunk: AudioData): void {
    const context = stream.context;
    const duration = chunk.numberOfFrames / chunk.sampleRate;
    const targetMs = stream.jitter.targetAheadMs(maxBufferAheadMs());
    const targetSeconds = targetMs / 1_000;
    let playTime = stream.playTime;
    if (playTime < context.currentTime - 0.05) {
      // The decoder produced audio after a longer pause. Re-anchor near the
      // target without throwing away decoder state or the stream identity.
      playTime = context.currentTime + targetSeconds;
    }
    const aheadMs = (playTime - context.currentTime) * 1_000;
    if (shouldResetSchedule(aheadMs, targetMs)) {
      resetSchedule(stream, targetSeconds);
      playTime = stream.playTime;
    }
    const startTime = Math.max(playTime, context.currentTime + 0.005);
    enqueueChunk(stream, chunk, startTime);
    stream.playTime = startTime + duration;
    stream.maxAheadMs = Math.max(stream.maxAheadMs, (stream.playTime - context.currentTime) * 1_000);
  }

  function output(clientId: number, stream: SpeakerPlayback, chunk: AudioData): void {
    try {
      if (speakers.get(clientId) !== stream) return;
      if (stream.mode === "legacy") outputLegacy(clientId, stream, chunk);
      else outputAdaptive(clientId, stream, chunk);
    } catch {
      if (speakers.get(clientId) === stream) {
        options.onDecodeError();
        clear(clientId);
      }
    } finally {
      chunk.close();
    }
  }

  function create(clientId: number, context: AudioContext, codec: 4 | 5, streamMode: RemotePlaybackMode): SpeakerPlayback {
    const target = streamMode === "legacy" ? 0 : computeTargetAheadMs(0, maxBufferAheadMs()) / 1_000;
    const stream: SpeakerPlayback = {
      mode: streamMode, codec, context, decoder: null, gain: context.createGain(), sources: new Set(),
      playTime: context.currentTime + target, timestamp: 0,
      jitter: new JitterEstimator(), resets: 0, maxAheadMs: target * 1_000,
    };
    speakers.set(clientId, stream);
    stream.gain.gain.value = options.getVolume(clientId);
    stream.gain.connect(context.destination);
    stream.decoder = new AudioDecoder({
      output: chunk => output(clientId, stream, chunk),
      error: () => {
        if (speakers.get(clientId) !== stream) return;
        options.onDecodeError();
        clear(clientId);
      },
    });
    stream.decoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: codec === 4 ? 1 : 2 });
    return stream;
  }

  function play(clientId: number, codec: 4 | 5, opusData: Uint8Array): void {
    const duration = opusPacketDurationUs(opusData);
    if (!duration || opusData.length < 3) { options.onDrop(); return; }
    try {
      const context = options.getContext();
      const streamMode = mode();
      let stream = speakers.get(clientId);
      const legacyOverflow = stream !== undefined && streamMode === "legacy"
        && (stream.playTime > context.currentTime + LEGACY_MAX_PLAY_AHEAD_SECONDS
          || (stream.decoder?.decodeQueueSize ?? 0) >= LEGACY_MAX_DECODE_QUEUE_FRAMES);
      if (stream && (stream.codec !== codec || stream.context !== context || stream.mode !== streamMode || legacyOverflow)) {
        clear(clientId);
        stream = undefined;
      }
      stream ??= create(clientId, context, codec, streamMode);
      if (speakers.get(clientId) !== stream) return;

      if (streamMode === "legacy") {
        stream.decoder?.decode(new EncodedAudioChunk({ type: "key", timestamp: stream.timestamp, duration, data: opusData }));
        stream.timestamp += duration;
        return;
      }

      const targetMs = stream.jitter.observe(performance.now(), duration / 1_000, maxBufferAheadMs());
      const targetSeconds = targetMs / 1_000;
      const aheadMs = (stream.playTime - context.currentTime) * 1_000;
      if (shouldResetSchedule(aheadMs, targetMs)) {
        resetSchedule(stream, targetSeconds);
      } else if (shouldRecover(aheadMs)) {
        stream.playTime = context.currentTime + targetSeconds;
      }

      const queueSize = stream.decoder?.decodeQueueSize ?? 0;
      if (queueSize >= MAX_DECODE_QUEUE_FRAMES_HARD) {
        // The decoder is deeply backlogged (for example a suspended context).
        // Drop the newest frame rather than destroying a healthy decoder.
        options.onDrop();
        return;
      }
      stream.decoder?.decode(new EncodedAudioChunk({ type: "key", timestamp: stream.timestamp, duration, data: opusData }));
      stream.timestamp += duration;
    } catch {
      options.onDecodeError();
      clear(clientId);
    }
  }

  function getStats(): FallbackPlaybackStats {
    let target = 0;
    let resets = 0;
    let maxAhead = 0;
    for (const stream of speakers.values()) {
      target = Math.max(target, stream.mode === "legacy"
        ? LEGACY_MAX_PLAY_AHEAD_SECONDS * 1_000
        : stream.jitter.targetAheadMs(maxBufferAheadMs()));
      resets += stream.resets;
      maxAhead = Math.max(maxAhead, stream.maxAheadMs);
    }
    return {
      bufferTargetMs: Math.round(target),
      bufferResets: resets,
      maxBufferAheadMs: Math.round(maxAhead),
    };
  }

  return {
    play,
    clear,
    clearAll() { for (const id of speakers.keys()) clear(id); },
    getStats,
    updateVolume(clientId: number) {
      const stream = speakers.get(clientId);
      if (stream) stream.gain.gain.value = options.getVolume(clientId);
    },
    updateVolumes() { for (const [id, stream] of speakers) stream.gain.gain.value = options.getVolume(id); },
  };
}
