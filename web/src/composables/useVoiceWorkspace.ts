import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { saveLocalPreferences, type LocalPreferences, type RecentServer } from "../services/local-persistence.js";

export interface VoiceWorkspaceSnapshot {
  preferences: LocalPreferences;
  recent: readonly RecentServer[];
}
/** The selected package opts in; persistence and lifecycle remain host-owned. */
export function useVoiceWorkspace(options: {
  enabled: Readonly<Ref<boolean>>;
  connected: Readonly<Ref<boolean>>;
  save?: typeof saveLocalPreferences;
}) {
  const hasConnected = ref(false);
  const active = computed(() => options.enabled.value && hasConnected.value);
  let epoch = 0;
  let disposed = false;
  let pendingSave: AbortController | undefined;
  function remember() {
    if (disposed) return;
    hasConnected.value = true;
    pendingSave?.abort();
    pendingSave = new AbortController();
    void (options.save ?? saveLocalPreferences)({ schemaVersion: 1, hasConnected: true }, pendingSave.signal).catch(() => undefined);
  }
  watch(options.connected, connected => { if (connected) remember(); }, { flush: "sync", immediate: true });
  async function restore(
    load: () => Promise<VoiceWorkspaceSnapshot>,
    apply?: (snapshot: VoiceWorkspaceSnapshot) => void,
  ): Promise<VoiceWorkspaceSnapshot | undefined> {
    const owner = epoch;
    try {
      const snapshot = await load();
      if (disposed || owner !== epoch) return;
      if (snapshot.preferences.hasConnected === true || snapshot.recent.length > 0) {
        hasConnected.value = true;
        if (snapshot.preferences.hasConnected !== true) remember();
      }
      apply?.(snapshot);
      return snapshot;
    } catch { return undefined; }
  }
  function reset() {
    epoch++;
    pendingSave?.abort();
    pendingSave = undefined;
    hasConnected.value = false;
  }
  onScopeDispose(() => { disposed = true; reset(); });
  return { active, hasConnected, restore, reset };
}
