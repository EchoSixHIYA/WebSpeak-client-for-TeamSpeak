import { onScopeDispose, ref, shallowRef, type Ref } from "vue";
import { listInstalledSkins, loadLocalPreferences, saveLocalPreferences } from "../services/local-persistence.js";
import { BUILTIN_SKIN_CATALOG, getPublicDefaultSkinId, isPublicSkinEnabled, listPublicSkins, type SkinCatalogEntry } from "../services/skin-catalog.js";
import { activateSkin, BUILTIN_DARK_SKIN, BUILTIN_LIGHT_SKIN, BUILTIN_DISCORD_SKIN, clearCustomSkinStyle, getStoredSkinId } from "../services/skin-runtime.js";
import { createSkinOperation } from "../services/skin-operation.js";
import { getStoredTheme, isDarkTheme, saveTheme, type ThemeMode } from "../services/theme.js";
import type { InstalledSkin } from "../services/skin-pack.js";

interface PublicSkinOptions {
  activeSkin?: Ref<InstalledSkin | null>;
  themeMode?: Ref<ThemeMode>;
  appVersion?: () => string;
  timeoutMs?: number;
}
const readChoice = () => { try { return localStorage.getItem("webspeak:skin-choice"); } catch { return null; } };
const builtin = (id: string) => id === BUILTIN_LIGHT_SKIN || id === BUILTIN_DARK_SKIN || id === BUILTIN_DISCORD_SKIN;
const fallbackId = () => isDarkTheme(getStoredTheme()) ? BUILTIN_DARK_SKIN : BUILTIN_LIGHT_SKIN;

/** One page owns initialization, choices and their late responses, including persistence. */
export function usePublicSkin(options: PublicSkinOptions = {}) {
  const activeSkin = options.activeSkin ?? shallowRef<InstalledSkin | null>(null);
  const stored = getStoredSkinId();
  const activeSkinId = ref(stored ?? fallbackId());
  const skinReady = ref(Boolean(stored && builtin(stored)));
  const installedSkins = ref<InstalledSkin[]>([]);
  const catalogSkins = ref<SkinCatalogEntry[]>([...BUILTIN_SKIN_CATALOG]);
  let current: ReturnType<typeof createSkinOperation> | undefined;
  let disposed = false;
  const owns = (operation: ReturnType<typeof createSkinOperation>) => !disposed && current === operation;
  function cancel() { current?.cancel(); current = undefined; }
  function begin() {
    cancel();
    return current = createSkinOperation({ timeoutMs: options.timeoutMs });
  }
  onScopeDispose(() => { disposed = true; cancel(); });

  async function apply(id: string, operation: ReturnType<typeof createSkinOperation>, persist = true, updateTheme = false) {
    operation.check();
    const entry = catalogSkins.value.find(skin => skin.id === id);
    const skin = await operation.wait(activateSkin(id, entry?.version, options.appVersion?.(), { signal: operation.signal }));
    if (!owns(operation)) return;
    activeSkin.value = skin;
    activeSkinId.value = skin?.id ?? (builtin(id) ? id : fallbackId());
    const mode = activeSkinId.value === BUILTIN_LIGHT_SKIN ? "light"
      : activeSkinId.value === BUILTIN_DARK_SKIN ? "dark" : activeSkinId.value === BUILTIN_DISCORD_SKIN ? "discord" : isDarkTheme(getStoredTheme()) ? "dark" : "light";
    if (options.themeMode && updateTheme) {
      options.themeMode.value = mode;
      saveTheme(mode);
    }
    if (persist) void saveLocalPreferences({ schemaVersion: 1, skinId: activeSkinId.value,
      ...(options.themeMode && updateTheme ? { theme: mode } : {}) }, operation.signal).catch(() => undefined);
  }
  async function recover(error: unknown, operation: ReturnType<typeof createSkinOperation>) {
    if (!owns(operation) || (error as { name?: string })?.name === "AbortError") return;
    // Retire every stage of the old operation before installing a fallback.
    operation.cancel();
    const fallback = begin();
    try { await apply(fallbackId(), fallback, false); }
    catch { /* A newer selection or page can retire the fallback as well. */ }
    finally { if (owns(fallback)) skinReady.value = true; fallback.finish(); }
  }
  async function initialize() {
    if (disposed) return;
    const operation = begin();
    try {
      const [preferences, installed, available] = await operation.wait(Promise.all([
        loadLocalPreferences(), listInstalledSkins(), listPublicSkins({ signal: operation.signal }),
      ]));
      installedSkins.value = installed;
      catalogSkins.value = available;
      if (options.themeMode && !localStorage.getItem("webspeak:theme")) {
        if (preferences.theme) options.themeMode.value = preferences.theme;
        saveTheme(options.themeMode.value);
      }
      // Only an explicit user choice overrides the instance default.
      const choice = readChoice();
      await apply(choice && isPublicSkinEnabled(choice) ? choice : getPublicDefaultSkinId(), operation);
    } catch (error) { await recover(error, operation); }
    finally { if (owns(operation)) skinReady.value = true; operation.finish(); }
  }
  async function select(id: string) {
    if (disposed) return;
    const operation = begin();
    try {
      try { localStorage.setItem("webspeak:skin-choice", id); } catch { /* Optional storage. */ }
      await apply(id, operation, true, true);
    } catch (error) { await recover(error, operation); }
    finally { if (owns(operation)) skinReady.value = true; operation.finish(); }
  }
  async function reset() {
    if (disposed) return;
    const operation = begin();
    clearCustomSkinStyle();
    activeSkin.value = null;
    installedSkins.value = [];
    catalogSkins.value = [...BUILTIN_SKIN_CATALOG];
    const mode: ThemeMode = "system";
    if (options.themeMode) options.themeMode.value = mode;
    saveTheme(mode);
    const builtInMode = isDarkTheme(mode) ? "dark" : "light";
    activeSkinId.value = builtInMode === "dark" ? BUILTIN_DARK_SKIN : BUILTIN_LIGHT_SKIN;
    skinReady.value = true;
    try { catalogSkins.value = await operation.wait(listPublicSkins({ signal: operation.signal })); }
    catch { /* Reset remains usable even if refreshing the optional catalog fails. */ }
    finally { operation.finish(); }
  }
  return { activeSkin, activeSkinId, skinReady, installedSkins, catalogSkins, initialize, select, cancel, reset };
}
