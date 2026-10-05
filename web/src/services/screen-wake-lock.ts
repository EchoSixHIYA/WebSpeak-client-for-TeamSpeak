export interface ScreenWakeLockSentinelLike extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}

export interface ScreenWakeLockApi {
  request(type: "screen"): Promise<ScreenWakeLockSentinelLike>;
}

interface NavigatorWithScreenWakeLock {
  wakeLock?: ScreenWakeLockApi;
}

export interface ScreenWakeLockVisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: EventListener): void;
  removeEventListener(type: "visibilitychange", listener: EventListener): void;
}

export interface ScreenWakeLockSnapshot {
  supported: boolean;
  enabled: boolean;
  active: boolean;
  requesting: boolean;
  unavailable: boolean;
}

export interface ScreenWakeLockController {
  readonly supported: boolean;
  snapshot(): ScreenWakeLockSnapshot;
  enable(): void;
  disable(): void;
  dispose(): void;
}

export function getScreenWakeLockApi(
  target: NavigatorWithScreenWakeLock | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator as unknown as NavigatorWithScreenWakeLock,
): ScreenWakeLockApi | undefined {
  return target?.wakeLock;
}

export function createScreenWakeLockController(
  api: ScreenWakeLockApi | undefined,
  visibility: ScreenWakeLockVisibilitySource,
  onChange: (state: ScreenWakeLockSnapshot) => void = () => undefined,
): ScreenWakeLockController {
  let enabled = false;
  let requesting = false;
  let unavailable = false;
  let sentinel: ScreenWakeLockSentinelLike | null = null;
  let requestVersion = 0;
  let disposed = false;

  const supported = Boolean(api);
  const snapshot = (): ScreenWakeLockSnapshot => ({
    supported,
    enabled,
    active: Boolean(sentinel && !sentinel.released),
    requesting,
    unavailable,
  });
  const emit = () => onChange(snapshot());

  const handleVisibilityChange: EventListener = () => {
    if (visibility.visibilityState !== "visible") {
      requestVersion += 1;
      const previousSentinel = sentinel;
      sentinel = null;
      requesting = false;
      unavailable = false;
      if (previousSentinel) void releaseSentinel(previousSentinel);
      emit();
      return;
    }

    if (enabled) {
      unavailable = false;
      void acquire();
    }
  };

  visibility.addEventListener("visibilitychange", handleVisibilityChange);
  emit();

  async function releaseSentinel(value: ScreenWakeLockSentinelLike): Promise<void> {
    try {
      await value.release();
    } catch {
      // The browser may already have released the lock when the document was hidden.
    }
  }

  async function acquire(): Promise<void> {
    if (!api || disposed || !enabled || visibility.visibilityState !== "visible" || sentinel || requesting) return;

    const version = ++requestVersion;
    requesting = true;
    unavailable = false;
    emit();

    try {
      const nextSentinel = await api.request("screen");
      if (disposed || version !== requestVersion || !enabled || visibility.visibilityState !== "visible") {
        await releaseSentinel(nextSentinel);
        return;
      }

      sentinel = nextSentinel;
      requesting = false;
      unavailable = false;
      nextSentinel.addEventListener("release", () => {
        if (sentinel !== nextSentinel) return;
        sentinel = null;
        requesting = false;
        unavailable = enabled;
        emit();
      }, { once: true });
      emit();
    } catch {
      if (version !== requestVersion || disposed) return;
      requesting = false;
      unavailable = true;
      emit();
    }
  }

  function enable(): void {
    if (disposed) return;
    if (!api) {
      enabled = false;
      requesting = false;
      unavailable = true;
      emit();
      return;
    }
    if (enabled && (sentinel || requesting)) return;

    enabled = true;
    unavailable = false;
    emit();
    void acquire();
  }

  function disable(): void {
    const previousSentinel = sentinel;
    if (!enabled && !requesting && !unavailable && !previousSentinel) return;

    enabled = false;
    requesting = false;
    unavailable = false;
    sentinel = null;
    requestVersion += 1;
    if (previousSentinel) void releaseSentinel(previousSentinel);
    emit();
  }

  function dispose(): void {
    if (disposed) return;
    disable();
    disposed = true;
    visibility.removeEventListener("visibilitychange", handleVisibilityChange);
  }

  return { supported, snapshot, enable, disable, dispose };
}
