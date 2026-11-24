export type SinkAudioElement = HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };

export interface WebRtcPlaybackOptions {
  context(): AudioContext | null;
  volume(): number;
  onEndpoint(output: SinkAudioElement): void;
  onBlocked(blocked: boolean): void;
  onPlaying(): void;
}

interface Playback {
  output: SinkAudioElement;
  disposed: boolean;
  pending: Promise<void> | null;
  removeRetry: (() => void) | null;
}

// Keep remote media on the browser-native playback path, independent from the
// capture AudioContext. Each element owns its play attempt and retry listeners.
export function createWebRtcPlayback(options: WebRtcPlaybackOptions) {
  let current: Playback | null = null;
  const isCurrent = (record: Playback): boolean => current === record && !record.disposed;
  const clean = (operation: () => void): void => { try { operation(); } catch { /* continue teardown */ } };

  function dispose(record: Playback): void {
    if (record.disposed) return;
    record.disposed = true;
    if (record.removeRetry) clean(record.removeRetry);
    record.removeRetry = null;
    clean(() => record.output.pause());
    clean(() => { record.output.srcObject = null; });
    clean(() => record.output.remove());
  }

  function stop(): void {
    const previous = current;
    current = null;
    if (previous) dispose(previous);
    options.onBlocked(false);
  }

  function installRetry(record: Playback): void {
    if (record.removeRetry || !isCurrent(record)) return;
    const retry = (): void => { if (isCurrent(record)) void play(record); };
    const events = ["pointerdown", "touchstart", "keydown"] as const;
    record.removeRetry = () => {
      for (const event of events) clean(() => window.removeEventListener(event, retry));
      clean(() => document.removeEventListener("visibilitychange", retry));
      record.removeRetry = null;
    };
    for (const event of events) window.addEventListener(event, retry, { passive: true });
    document.addEventListener("visibilitychange", retry, { passive: true });
  }

  async function play(record: Playback): Promise<void> {
    if (!isCurrent(record)) return;
    if (record.pending) return record.pending;
    const task = (async () => {
      const context = options.context();
      if (context?.state === "suspended") {
        // Capture may never resume while locked. Native remote playback must
        // not wait on that independent graph, including on a retry gesture.
        try { void context.resume().catch(() => undefined); } catch { /* retry on a user gesture */ }
      }
      if (!isCurrent(record)) return;
      try {
        record.output.muted = false;
        await record.output.play();
        if (!isCurrent(record)) return;
        record.removeRetry?.();
        options.onBlocked(false);
        options.onPlaying();
      } catch {
        if (!isCurrent(record)) return;
        options.onBlocked(true);
        installRetry(record);
      }
    })();
    record.pending = task;
    try { await task; }
    finally { if (record.pending === task) record.pending = null; }
  }

  function attach(stream: MediaStream): void {
    const output = document.createElement("audio") as SinkAudioElement;
    const candidate: Playback = { output, disposed: false, pending: null, removeRetry: null };
    try {
      output.autoplay = true;
      output.muted = false;
      output.setAttribute("playsinline", "");
      output.volume = options.volume();
      output.setAttribute("aria-hidden", "true");
      output.tabIndex = -1;
      output.style.position = "fixed";
      output.style.width = "1px";
      output.style.height = "1px";
      output.style.opacity = "0";
      output.style.pointerEvents = "none";
      output.srcObject = stream;
      document.body.append(output);
    } catch (error) {
      dispose(candidate);
      throw error;
    }
    stop();
    current = candidate;
    options.onEndpoint(output);
    void play(candidate);
  }

  return {
    attach, stop,
    resume(): void { if (current) void play(current); },
    get output(): SinkAudioElement | null { return current?.output ?? null; },
    setVolume(value: number): void { if (current) current.output.volume = value; },
  };
}
