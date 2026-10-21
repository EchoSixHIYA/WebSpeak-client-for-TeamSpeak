import { computed, ref, watch, type Ref } from "vue";
import { BUILTIN_KAAK_SKIN_ID } from "../services/skin-catalog.js";
import { saveLocalPreferences, type LocalPreferences, type RecentServer } from "../services/local-persistence.js";

/** Keep the KOOK workspace available after the first successful connection. */
export function useKookWorkspace(options: {
  skinId: Readonly<Ref<string>>;
  connected: Readonly<Ref<boolean>>;
}) {
  const hasConnected = ref(false);
  const active = computed(() => options.skinId.value === BUILTIN_KAAK_SKIN_ID
    && hasConnected.value);

  watch(options.connected, (connected) => {
    if (!connected) return;
    hasConnected.value = true;
    void saveLocalPreferences({ schemaVersion: 1, hasConnected: true });
  }, { flush: "sync", immediate: true });

  function restore(preferences: LocalPreferences, recent: readonly RecentServer[]): void {
    // Recent servers were already recorded only after successful connections,
    // so existing users do not need to repeat onboarding after this update.
    hasConnected.value ||= preferences.hasConnected === true || recent.length > 0;
  }

  function reset(): void {
    hasConnected.value = false;
  }

  return { active, restore, reset };
}
