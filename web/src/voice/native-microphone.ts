import type { MicrophoneCapture } from "./microphone-capture.js";

/** Native browser processing only: no RNNoise, PCM worklet, analyser or gain graph. */
export function createNativeMicrophoneCapture(stream: MediaStream): MicrophoneCapture {
  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState !== "live") throw new DOMException("No live microphone", "NotReadableError");
  const settings = track.getSettings();
  let disposed = false;
  return {
    processedStream: stream,
    processing: {
      echoCancellation: typeof settings.echoCancellation === "boolean" ? settings.echoCancellation : null,
      noiseSuppression: typeof settings.noiseSuppression === "boolean" ? settings.noiseSuppression : null,
      autoGainControl: typeof settings.autoGainControl === "boolean" ? settings.autoGainControl : null,
      rnnoise: false,
    },
    activate() {},
    setVolume() {},
    stopCapture() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const item of stream.getTracks()) {
        try { item.stop(); } catch { /* release the other tracks too */ }
      }
    },
  };
}
