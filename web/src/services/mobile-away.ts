type EventSource = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface MobileAwayVisibilitySource extends EventSource {
  readonly visibilityState: string;
}

export interface MobileAwayController {
  sync(): void;
  preserveManualStatus(): void;
  dispose(): void;
}

export interface MobileAwayOptions {
  isMobileClient: () => boolean;
  isConnected: () => boolean;
  isAway: () => boolean;
  setAway: (away: boolean) => void;
}

/** Mark mobile sessions away while backgrounded, and only undo our own mark. */
export function createMobileAwayController(
  visibility: MobileAwayVisibilitySource,
  pageLifecycle: EventSource,
  options: MobileAwayOptions,
): MobileAwayController {
  let pageHidden = visibility.visibilityState !== "visible";
  let autoAwayApplied = false;
  let wasConnected = options.isConnected();
  let disposed = false;

  const reconcile = (connectionRestored = false): void => {
    if (disposed || !options.isMobileClient() || !options.isConnected()) return;

    const hidden = pageHidden || visibility.visibilityState !== "visible";
    if (hidden) {
      if ((!autoAwayApplied || connectionRestored) && !options.isAway()) {
        autoAwayApplied = true;
        options.setAway(true);
      }
      return;
    }

    if (autoAwayApplied) {
      autoAwayApplied = false;
      options.setAway(false);
    }
  };

  const onVisibilityChange: EventListener = () => {
    pageHidden = visibility.visibilityState !== "visible";
    reconcile();
  };
  const onPageHide: EventListener = () => {
    pageHidden = true;
    reconcile();
  };
  const onPageShow: EventListener = () => {
    pageHidden = false;
    reconcile();
  };

  visibility.addEventListener("visibilitychange", onVisibilityChange);
  pageLifecycle.addEventListener("pagehide", onPageHide);
  pageLifecycle.addEventListener("pageshow", onPageShow);

  const sync = (): void => {
    const connected = options.isConnected();
    const connectionRestored = connected && !wasConnected;
    wasConnected = connected;
    reconcile(connectionRestored);
  };

  return {
    sync,
    preserveManualStatus() {
      autoAwayApplied = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      visibility.removeEventListener("visibilitychange", onVisibilityChange);
      pageLifecycle.removeEventListener("pagehide", onPageHide);
      pageLifecycle.removeEventListener("pageshow", onPageShow);
    },
  };
}
