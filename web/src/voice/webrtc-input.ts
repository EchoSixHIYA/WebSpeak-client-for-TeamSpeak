export interface WebRtcInput {
  readonly stream: MediaStream;
  setAccompaniment(stream: MediaStream | null): void;
  setVolume(value: number): void;
  dispose(): void;
}

/** The capture owner releases this stream; no Web Audio graph or clone owns it. */
export function createNativeWebRtcInput(stream: MediaStream, volume: number): WebRtcInput {
  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState !== "live") throw new Error("No live native microphone track");
  let disposed = false;
  const setVolume = (value: number) => { if (!disposed) track.enabled = value > 0; };
  setVolume(volume);
  return {
    stream,
    setVolume,
    setAccompaniment(source) {
      if (source) throw new DOMException("Native call input does not mix accompaniment", "NotSupportedError");
    },
    dispose() { disposed = true; },
  };
}

// Own only the mixing nodes and their output. Capture controllers own the input
// streams. Keep the sender track alive when accompaniment starts/stops/changes.
export function createWebRtcInput(context: AudioContext, microphone: MediaStream, volume: number): WebRtcInput {
  let destination: MediaStreamAudioDestinationNode | null = null;
  let microphoneSource: MediaStreamAudioSourceNode | null = null;
  let microphoneGain: GainNode | null = null;
  let accompanimentSource: MediaStreamAudioSourceNode | null = null;
  let disposed = false;
  const clean = (operation: () => void): void => { try { operation(); } catch { /* release other resources too */ } };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (accompanimentSource) clean(() => accompanimentSource!.disconnect());
    if (microphoneSource) clean(() => microphoneSource!.disconnect());
    if (microphoneGain) clean(() => microphoneGain!.disconnect());
    if (destination) {
      clean(() => destination!.disconnect());
      for (const track of destination.stream.getTracks()) clean(() => track.stop());
    }
    accompanimentSource = null;
    microphoneSource = null;
    microphoneGain = null;
    destination = null;
  }

  try {
    destination = context.createMediaStreamDestination();
    destination.channelCount = 1;
    destination.channelCountMode = "explicit";
    if (!destination.stream.getAudioTracks().some(track => track.readyState === "live")) {
      throw new Error("WebRTC input has no live output track");
    }
    microphoneSource = context.createMediaStreamSource(microphone);
    microphoneGain = context.createGain();
    microphoneGain.gain.value = volume;
    microphoneSource.connect(microphoneGain);
    microphoneGain.connect(destination);
    return {
      stream: destination.stream,
      setAccompaniment(stream) {
        if (disposed) {
          if (stream) throw new DOMException("WebRTC input closed", "AbortError");
          return;
        }
        let candidate: MediaStreamAudioSourceNode | null = null;
        try {
          if (stream) {
            if (!stream.getAudioTracks().some(track => track.readyState === "live")) {
              throw new Error("Accompaniment has no live audio track");
            }
            candidate = context.createMediaStreamSource(stream);
            // Application audio retains its source level and bypasses microphone
            // gain/denoising. Prepare it before disconnecting the previous source.
            candidate.connect(destination!);
          }
        } catch (error) {
          if (candidate) clean(() => candidate!.disconnect());
          throw error;
        }
        const previous = accompanimentSource;
        accompanimentSource = candidate;
        if (previous) clean(() => previous.disconnect());
      },
      setVolume(value) { if (microphoneGain) microphoneGain.gain.value = value; },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
