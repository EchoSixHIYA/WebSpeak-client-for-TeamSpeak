interface CallSnapshot { active: boolean; muted: boolean; outputMuted: boolean; title: string }
interface AudioSession { type: string }
type CallAction = MediaSessionAction | "hangup" | "togglemicrophone";
type CallNavigator = Pick<Navigator, "mediaSession"> & { audioSession?: AudioSession };
interface CallActions {
  resume(): void;
  pause(): void;
  toggleMicrophone(): void;
  hangup(): void;
}

/** Optional OS integration, never a keepalive or permission to restart capture. */
export function createCallMediaSession(actions: CallActions, target: Partial<CallNavigator> = navigator) {
  let active = false;
  let generation = 0;
  let metadata: MediaMetadata | null = null;
  let oldMetadata: MediaMetadata | null = null;
  let oldPlayback: MediaSessionPlaybackState = "none";
  let oldAudioType: string | undefined;
  const installed: CallAction[] = [];
  const safely = (operation: () => void) => { try { operation(); } catch { /* platform may only implement part of the API */ } };

  function stop(): void {
    if (!active) return;
    active = false;
    generation++;
    const session = target.mediaSession;
    safely(() => (session as (MediaSession & { setMicrophoneActive?: (active: boolean) => void }) | undefined)?.setMicrophoneActive?.(false));
    for (const action of installed.splice(0)) safely(() => session?.setActionHandler(action as MediaSessionAction, null));
    if (session && session.metadata === metadata) {
      safely(() => { session.metadata = oldMetadata; session.playbackState = oldPlayback; });
    }
    safely(() => {
      if (target.audioSession?.type === "play-and-record" && oldAudioType !== undefined) target.audioSession.type = oldAudioType;
    });
    metadata = null;
  }

  return {
    sync(snapshot: CallSnapshot): void {
      if (!snapshot.active) { stop(); return; }
      const session = target.mediaSession;
      if (!active) {
        active = true;
        const currentGeneration = ++generation;
        oldMetadata = session?.metadata ?? null;
        oldPlayback = session?.playbackState ?? "none";
        safely(() => {
          oldAudioType = target.audioSession?.type;
          if (target.audioSession) target.audioSession.type = "play-and-record";
        });
        if (session) {
          const handlers: Partial<Record<CallAction, () => void>> = {
            play: actions.resume, pause: actions.pause,
            stop: actions.hangup, hangup: actions.hangup, togglemicrophone: actions.toggleMicrophone,
          };
          for (const [action, handler] of Object.entries(handlers)) safely(() => {
            session.setActionHandler(action as MediaSessionAction, () => { if (active && generation === currentGeneration) handler(); });
            installed.push(action as CallAction);
          });
        }
      }
      if (!session) return;
      safely(() => {
        if (!metadata || metadata.title !== snapshot.title) {
          metadata = new MediaMetadata({ title: snapshot.title, artist: "WebSpeak" });
          session.metadata = metadata;
        }
        session.playbackState = snapshot.outputMuted ? "paused" : "playing";
      });
      safely(() => (session as MediaSession & { setMicrophoneActive?: (active: boolean) => void }).setMicrophoneActive?.(!snapshot.muted));
    },
    dispose: stop,
  };
}
