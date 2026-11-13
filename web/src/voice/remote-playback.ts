import { opusPacketDurationUs } from "./opus-packet.js";

interface RemotePlaybackOptions {
  getContext(): AudioContext;
  getVolume(clientId: number): number;
  onDecodeError(): void;
  onDrop(): void;
}

interface SpeakerPlayback {
  codec: 4 | 5;
  context: AudioContext;
  decoder: AudioDecoder | null;
  gain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  playTime: number;
  timestamp: number;
}

// Preserve the compatibility path's bounded jitter buffer and decoder queue.
const MAX_PLAY_AHEAD_SECONDS = 0.08;
const MAX_DECODE_QUEUE_FRAMES = 3;

export function createRemotePlayback(options: RemotePlaybackOptions) {
  const speakers = new Map<number, SpeakerPlayback>();

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

  function output(clientId: number, stream: SpeakerPlayback, chunk: AudioData): void {
    try {
      if (speakers.get(clientId) !== stream) return;
      const { context, gain, sources } = stream;
      const { sampleRate, numberOfChannels, numberOfFrames } = chunk;
      const playTime = Math.max(stream.playTime, context.currentTime);
      const duration = numberOfFrames / sampleRate;
      if (playTime + duration > context.currentTime + MAX_PLAY_AHEAD_SECONDS) {
        clear(clientId);
        return;
      }
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
      source.start(playTime);
      stream.playTime = playTime + duration;
    } catch {
      if (speakers.get(clientId) === stream) {
        options.onDecodeError();
        clear(clientId);
      }
    } finally {
      chunk.close();
    }
  }

  function create(clientId: number, context: AudioContext, codec: 4 | 5): SpeakerPlayback {
    const stream: SpeakerPlayback = {
      codec, context, decoder: null, gain: context.createGain(), sources: new Set(),
      playTime: context.currentTime, timestamp: 0,
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
      let stream = speakers.get(clientId);
      if (stream && (stream.codec !== codec || stream.context !== context || stream.playTime > context.currentTime + MAX_PLAY_AHEAD_SECONDS || (stream.decoder?.decodeQueueSize ?? 0) >= MAX_DECODE_QUEUE_FRAMES)) {
        clear(clientId);
        stream = undefined;
      }
      stream ??= create(clientId, context, codec);
      if (speakers.get(clientId) !== stream) return;
      stream.decoder?.decode(new EncodedAudioChunk({ type: "key", timestamp: stream.timestamp, duration, data: opusData }));
      stream.timestamp += duration;
    } catch {
      options.onDecodeError();
      clear(clientId);
    }
  }

  return {
    play,
    clear,
    clearAll() { for (const id of speakers.keys()) clear(id); },
    updateVolume(clientId: number) {
      const stream = speakers.get(clientId);
      if (stream) stream.gain.gain.value = options.getVolume(clientId);
    },
    updateVolumes() { for (const [id, stream] of speakers) stream.gain.gain.value = options.getVolume(id); },
  };
}
