export type AccompanimentErrorCode = "" | "unsupported" | "needsWebRtc" | "noAudio" | "permission" | "audio" | "backgroundMode";

interface AccompanimentTarget {
  setAccompaniment(stream: MediaStream | null): void;
}

interface AccompanimentOptions {
  isSupported(): boolean;
  getTarget(): AccompanimentTarget | null;
  onActive(active: boolean): void;
  onError(code: AccompanimentErrorCode): void;
}

interface Capture {
  stream: MediaStream;
  target: AccompanimentTarget;
  audio: MediaStreamTrack | null;
  onEnded: () => void;
  disposed: boolean;
}

// Own both prepared and active captures. A generation also invalidates browser
// permission requests which cannot be cancelled until their streams arrive.
export function createAccompaniment(options: AccompanimentOptions) {
  let generation = 0;
  let pending: Capture | null = null;
  let current: Capture | null = null;
  function stopTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      try { if (track.readyState !== "ended") track.stop(); } catch { /* stop remaining tracks too */ }
    }
  }
  function release(capture: Capture | null): void {
    if (!capture || capture.disposed) return;
    capture.disposed = true;
    capture.audio?.removeEventListener("ended", capture.onEnded);
    stopTracks(capture.stream);
  }
  function cancelPending(): void {
    const capture = pending;
    pending = null;
    release(capture);
  }
  function stop(): void {
    generation++;
    cancelPending();
    const previous = current;
    current = null;
    // Use the original target even if the caller has already invalidated its
    // peer. Stopping capture cannot leave an attached source or active flag.
    try { previous?.target.setAccompaniment(null); }
    finally {
      release(previous);
      options.onActive(false);
      options.onError("");
    }
  }

  async function start(): Promise<void> {
    const ownGeneration = ++generation;
    cancelPending();
    options.onError("");
    if (!options.isSupported()) {
      options.onError("unsupported");
      throw new Error("Accompaniment sharing is unavailable");
    }
    const target = options.getTarget();
    if (!target) {
      options.onError("needsWebRtc");
      throw new Error("Accompaniment requires WebRTC");
    }
    const isCurrent = (): boolean => generation === ownGeneration && options.getTarget() === target;
    const processing: MediaTrackConstraints = { autoGainControl: false, echoCancellation: false, noiseSuppression: false };
    const audio = { ...processing } as MediaTrackConstraints & { restrictOwnAudio?: boolean };
    const supported = navigator.mediaDevices.getSupportedConstraints?.() as Record<string, boolean> | undefined;
    if (supported?.restrictOwnAudio) audio.restrictOwnAudio = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" }, audio,
        selfBrowserSurface: "exclude", systemAudio: "include", windowAudio: "window",
      } as unknown as DisplayMediaStreamOptions);
    } catch (error) {
      if (!isCurrent() || (error instanceof DOMException && error.name === "AbortError")) return;
      options.onError("permission");
      throw error;
    }
    if (!isCurrent()) { stopTracks(stream); return; }

    const candidate: Capture = { stream, target, audio: null, onEnded: () => {}, disposed: false };
    pending = candidate;
    let errorCode: AccompanimentErrorCode = "audio";
    try {
      for (const track of stream.getVideoTracks()) track.stop();
      const track = stream.getAudioTracks()[0];
      if (!track) { errorCode = "noAudio"; throw new Error("The selected source has no audio"); }
      candidate.audio = track;
      candidate.onEnded = () => {
        if (current === candidate) stop();
        else if (pending === candidate) cancelPending();
      };
      track.addEventListener("ended", candidate.onEnded, { once: true });
      // Optional display constraints vary by browser. Do not pass the
      // Chromium-only restrictOwnAudio hint to applyConstraints.
      try { await track.applyConstraints(processing); } catch { /* capture can still be used */ }
      if (!isCurrent() || candidate.disposed || track.readyState !== "live") return;
      try { if ("contentHint" in track) track.contentHint = "music"; } catch { /* optional hint */ }
      target.setAccompaniment(stream);
      const previous = current;
      current = candidate;
      pending = null;
      release(previous);
      options.onActive(true);
    } catch (error) {
      if (!isCurrent() || candidate.disposed) return;
      options.onError(errorCode);
      throw error;
    } finally {
      if (pending === candidate) pending = null;
      if (current !== candidate) release(candidate);
    }
  }

  return { start, stop };
}
