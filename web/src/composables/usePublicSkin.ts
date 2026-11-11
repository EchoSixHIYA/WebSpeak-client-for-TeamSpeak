import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { canUseSkin, thirdPartyAllowed } from '../services/instance-authorization.js';
import { listInstalledSkins, loadLocalPreferences, saveLocalPreferences } from "../services/local-persistence.js";
import { BUILTIN_SKIN_CATALOG, getPublicDefaultSkinId, isPublicSkinEnabled, listPublicSkins, type SkinCatalogEntry } from "../services/skin-catalog.js";
import { activateSkin, BUILTIN_DARK_SKIN, BUILTIN_LIGHT_SKIN, clearCustomSkinStyle, getStoredSkinId } from "../services/skin-runtime.js";
import { createSkinOperation } from "../services/skin-operation.js";
import { setSkinHostChromeParts, setHostChromeActiveSkin, hostBuiltInSkinRequests } from "../services/host-chrome.js";
import { getStoredTheme, isDarkTheme, saveTheme, type ThemeMode } from "../services/theme.js";
import type { InstalledSkin } from "../services/skin-pack.js";

interface PublicSkinOptions {
  activeSkin?: Ref<InstalledSkin | null>;
  themeMode?: Ref<ThemeMode>;
  appVersion?: () => string;
  timeoutMs?: number;
}
const readChoice = () => { try { return localStorage.getItem("webspeak:skin-choice"); } catch { return null; } };
const builtin = (id: string) => id === BUILTIN_LIGHT_SKIN || id === BUILTIN_DARK_SKIN;
const fallbackId = () => isDarkTheme(getStoredTheme()) ? BUILTIN_DARK_SKIN : BUILTIN_LIGHT_SKIN;

/** One page owns initialization, choices and their late responses, including persistence. */
export function usePublicSkin(options: PublicSkinOptions = {}) {
  const activeSkin = options.activeSkin ?? shallowRef<InstalledSkin | null>(null);
  const candidate = getStoredSkinId();
  const stored = candidate && canUseSkin(candidate) ? candidate : null;
  const activeSkinId = ref(stored ?? fallbackId());
  const skinReady = ref(Boolean(stored && builtin(stored)));
  const skinLoadError = shallowRef<{ skinId: string } | null>(null);
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
  // Host decorations depend on the active skin's chrome.json opt-in. Built-in
  // skins leave `activeSkin` empty, which keeps host chrome hidden by default.
  // Only `visibleParts` opts in: chrome.json hiddenParts/icons generate host
  // CSS containing `data-ws-part="host.…"`, so inspecting the combined stylesheet
  // would wrongly treat every hiddenParts-only pack as host-chrome themed.
  watch(activeSkin, (skin) => setSkinHostChromeParts(skin?.chromeData), { immediate: true, flush: "sync" });
  // The recovery affordance is persistent while a non-bundled skin is applied.
  watch(activeSkinId, (id) => setHostChromeActiveSkin(id), { immediate: true, flush: "sync" });

  async function apply(id: string, operation: ReturnType<typeof createSkinOperation>, persist = true, updateTheme = false, clearLoadError = true) {
    operation.check();
    if (!canUseSkin(id)) id = fallbackId();
    const entry = catalogSkins.value.find(skin => skin.id === id);
    const skin = await operation.wait(activateSkin(id, entry?.version, options.appVersion?.(), { signal: operation.signal }));
    if (!owns(operation)) return;
    if (!builtin(id) && !skin) throw new Error("The selected skin could not be activated.");
    activeSkin.value = skin;
    activeSkinId.value = skin?.id ?? (builtin(id) ? id : fallbackId());
    if (clearLoadError) skinLoadError.value = null;
    const mode = activeSkinId.value === BUILTIN_LIGHT_SKIN ? "light"
      : activeSkinId.value === BUILTIN_DARK_SKIN ? "dark" : isDarkTheme(getStoredTheme()) ? "dark" : "light";
    if (options.themeMode && updateTheme) {
      options.themeMode.value = mode;
      saveTheme(mode, { preserveCustomSkins: !builtin(activeSkinId.value) });
    }
    if (persist) void saveLocalPreferences({ schemaVersion: 1, skinId: activeSkinId.value,
      ...(options.themeMode && updateTheme ? { theme: mode } : {}) }, operation.signal).catch(() => undefined);
  }
  async function recover(error: unknown, operation: ReturnType<typeof createSkinOperation>, failedSkinId: string) {
    if (!owns(operation) || (error as { name?: string })?.name === "AbortError") return;
    if (!builtin(failedSkinId)) skinLoadError.value = { skinId: failedSkinId };
    // Retire every stage of the old operation before installing a fallback.
    operation.cancel();
    const fallback = begin();
    try { await apply(fallbackId(), fallback, false, false, false); }
    catch { /* A newer selection or page can retire the fallback as well. */ }
    finally { if (owns(fallback)) skinReady.value = true; fallback.finish(); }
  }
  async function initialize() {
    if (disposed) return;
    const operation = begin();
    let requestedSkinId = fallbackId();
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
      requestedSkinId = choice && isPublicSkinEnabled(choice) ? choice : getPublicDefaultSkinId();
      await apply(requestedSkinId, operation);
    } catch (error) { await recover(error, operation, requestedSkinId); }
    finally { if (owns(operation)) skinReady.value = true; operation.finish(); }
  }
  async function select(id: string) {
    if (disposed) return;
    const operation = begin();
    try {
      try { localStorage.setItem("webspeak:skin-choice", id); } catch { /* Optional storage. */ }
      await apply(id, operation, true, true);
    } catch (error) { await recover(error, operation, id); }
    finally { if (owns(operation)) skinReady.value = true; operation.finish(); }
  }
  async function reset() {
    if (disposed) return;
    const operation = begin();
    skinLoadError.value = null;
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
  async function switchToBuiltInAfterLoadError(): Promise<void> {
    if (!skinLoadError.value) return;
    await select(fallbackId());
  }
  async function switchToBuiltIn(): Promise<void> {
    await select(fallbackId());
  }

  watch(thirdPartyAllowed, allowed => {
    if (disposed) return;
    if (allowed) { void initialize(); return; }
    cancel();
    activeSkin.value = null;
    skinLoadError.value = null;
    clearCustomSkinStyle();
    activeSkinId.value = fallbackId();
    skinReady.value = true;
    void select(fallbackId());
  }, { flush: 'sync' });
  // Host-owned recovery's guaranteed action: reset to the built-in skin. It is
  // independent of the skinnable plugin overlay, so it also works when that
  // overlay is hidden with `display: none`.
  watch(hostBuiltInSkinRequests, () => { if (!disposed) void switchToBuiltIn(); }, { flush: 'sync' });
  return { activeSkin, activeSkinId, skinReady, skinLoadError,
    installedSkins: computed(() => installedSkins.value.filter(skin => canUseSkin(skin.id))),
    catalogSkins: computed(() => catalogSkins.value.filter(skin => canUseSkin(skin.id))),
    initialize, select, cancel, reset, switchToBuiltIn, switchToBuiltInAfterLoadError };
}
