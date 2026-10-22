import { computed, ref, watch, type Ref } from "vue";
import { BUILTIN_DISCORD_SKIN_ID, BUILTIN_KAAK_SKIN_ID } from "../services/skin-catalog.js";
import { saveLocalPreferences, type LocalPreferences, type RecentServer } from "../services/local-persistence.js";

/** Skins whose voice workspace stays open for returning users. */
const PERSISTENT_WORKSPACE_SKINS = new Set([BUILTIN_KAAK_SKIN_ID, BUILTIN_DISCORD_SKIN_ID]);

/** Keep the KOOK and Discord workspaces available after the first successful connection. */
export function useKookWorkspace(options: {
  skinId: Readonly<Ref<string>>;
  connected: Readonly<Ref<boolean>>;
}) {
  const hasConnected = ref(false);
  const active = computed(() => PERSISTENT_WORKSPACE_SKINS.has(options.skinId.value)
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
