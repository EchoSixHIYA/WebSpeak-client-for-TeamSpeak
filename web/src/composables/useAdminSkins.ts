import { computed, onScopeDispose, ref } from "vue";
import type { copy } from "../i18n/admin.js";
import { AdminApiError, isAdminRequestCancelled, type AdminApi } from "../services/admin-api.js";
import { createAdminRequests } from "../services/admin-requests.js";
import { BUILTIN_SKIN_CATALOG, type SkinCatalogEntry } from "../services/skin-catalog.js";
import { compareSkinVersions, type SkinStoreCatalog, type SkinStoreEntry } from "../../../src/shared/skin-store.js";

interface Options { api: AdminApi; tr(key: keyof typeof copy.zh): string }

export function useAdminSkins(options: Options) {
  const requests = createAdminRequests();
  const skinEntries = ref<SkinCatalogEntry[]>([]);
  const skinLoading = ref(false), skinUploading = ref(false), skinDefaultSaving = ref(false);
  const removingSkinId = ref(""), updatingSkinId = ref(""), skinDefaultId = ref("builtin.light");
  const skinManagerError = ref(""), skinManagerNotice = ref("");
  const skinTab = ref<"installed" | "store">("installed");
  const storeCatalog = ref<SkinStoreCatalog | null>(null), storeLoading = ref(false), storeInstallingId = ref("");
  const storeError = ref("");
  const skinBusy = computed(() => skinUploading.value || skinDefaultSaving.value || Boolean(removingSkinId.value || updatingSkinId.value || storeInstallingId.value));
  const enabledSkinEntries = computed(() => skinEntries.value.filter(skin => skin.builtIn || skin.enabled !== false));
  let savedDefault = "builtin.light";
  function cancelRequests() {
    requests.reset();
    skinLoading.value = false; skinUploading.value = false; skinDefaultSaving.value = false;
    removingSkinId.value = ""; updatingSkinId.value = "";
    storeLoading.value = false; storeInstallingId.value = ""; storeError.value = ""; skinTab.value = "installed";
    skinManagerError.value = ""; skinManagerNotice.value = "";
  }
  function reset() { cancelRequests(); skinEntries.value = []; storeCatalog.value = null; savedDefault = skinDefaultId.value = "builtin.light"; }
  onScopeDispose(reset);
  function report(error: unknown, upload = false) {
    if (!isAdminRequestCancelled(error)) skinManagerError.value = upload && error instanceof Error ? error.message : options.tr("operationFailed");
  }
  function storeFailure(error: unknown): string {
    const code = error instanceof AdminApiError ? error.code : "";
    if (["SKIN_STORE_CHANGED", "SKIN_STORE_INSTALLED_CHANGED", "SKIN_STORE_NOT_NEWER"].includes(code)) return options.tr("skinStoreChanged");
    if (code === "SKIN_STORE_INCOMPATIBLE") return options.tr("skinStoreIncompatible");
    if (code.startsWith("SKIN_") && code !== "SKIN_STORE_UNAVAILABLE" && code !== "SKIN_STORAGE_UNAVAILABLE") return options.tr("skinStoreInvalid");
    return options.tr("skinStoreUnavailable");
  }
  async function loadSkinStore(refresh = false) {
    if (storeLoading.value || skinBusy.value) return;
    const request = requests.begin("store");
    storeLoading.value = true; storeError.value = "";
    try {
      const [result] = await Promise.all([options.api.skinStore(refresh, request.signal), refresh ? loadSkinCatalog() : Promise.resolve()]);
      if (request.isCurrent()) storeCatalog.value = result;
    } catch (error) { if (request.isCurrent() && !isAdminRequestCancelled(error)) storeError.value = storeFailure(error); }
    finally { if (request.isCurrent()) storeLoading.value = false; request.finish(); }
  }
  function selectSkinTab(tab: "installed" | "store") {
    skinTab.value = tab;
    if (tab === "store" && !storeCatalog.value) void loadSkinStore();
    if (tab === "installed" && !skinBusy.value) void loadSkinCatalog();
  }
  function installedStoreSkin(entry: SkinStoreEntry) { return skinEntries.value.find(skin => skin.id === entry.id); }
  function storeVersionOrder(entry: SkinStoreEntry): number {
    const installed = installedStoreSkin(entry);
    return installed && entry.metadata ? compareSkinVersions(entry.metadata.version, installed.version) : 1;
  }
  async function installStoreSkin(entry: SkinStoreEntry) {
    if (skinBusy.value || skinLoading.value || !entry.metadata || !entry.compatible || storeVersionOrder(entry) <= 0) return;
    const installed = installedStoreSkin(entry);
    if (installed && !window.confirm(`${options.tr("skinStoreConfirm")}\n${entry.metadata.name}: ${installed.version} → ${entry.metadata.version}`)) return;
    requests.cancel("load"); requests.cancel("store"); storeLoading.value = false;
    const request = requests.begin("mutation");
    storeInstallingId.value = entry.id; skinManagerError.value = ""; skinManagerNotice.value = "";
    try {
      await options.api.installStoreSkin({ id: entry.id, revision: entry.revision, installedVersion: installed?.version ?? null }, request.signal);
      if (!request.isCurrent()) return;
      skinManagerNotice.value = options.tr("skinStoreSuccess");
      await loadSkinCatalog();
    } catch (error) { if (request.isCurrent() && !isAdminRequestCancelled(error)) skinManagerError.value = storeFailure(error); }
    finally { if (request.isCurrent()) storeInstallingId.value = ""; request.finish(); }
  }
  async function loadSkinCatalog() {
    const request = requests.begin("load"), selected = skinDefaultId.value;
    skinLoading.value = true; skinManagerError.value = "";
    try {
      const value = await options.api.skins(request.signal);
      if (!request.isCurrent()) return;
      const protectedIds = new Set(BUILTIN_SKIN_CATALOG.map(skin => skin.id));
      skinEntries.value = [...BUILTIN_SKIN_CATALOG, ...value.skins.filter(skin => !protectedIds.has(skin.id))];
      savedDefault = value.defaultSkinId;
      if (skinDefaultId.value === selected) skinDefaultId.value = savedDefault;
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) skinLoading.value = false; request.finish(); }
  }
  async function saveSkinDefault() {
    if (skinBusy.value) return;
    requests.cancel("load"); skinLoading.value = false;
    const request = requests.begin("mutation"), selected = skinDefaultId.value;
    skinDefaultSaving.value = true; skinManagerError.value = ""; skinManagerNotice.value = "";
    try {
      const result = await options.api.setDefaultSkin(selected, request.signal);
      if (!request.isCurrent()) return;
      savedDefault = result.defaultSkinId;
      if (skinDefaultId.value === selected) skinDefaultId.value = savedDefault;
      skinManagerNotice.value = options.tr("skinDefaultSaved");
    } catch (error) {
      if (request.isCurrent()) { report(error); if (skinDefaultId.value === selected) skinDefaultId.value = savedDefault; }
    } finally { if (request.isCurrent()) skinDefaultSaving.value = false; request.finish(); }
  }
  async function toggleSkinEnabled(skin: SkinCatalogEntry) {
    if (skinBusy.value) return;
    requests.cancel("load"); skinLoading.value = false;
    const request = requests.begin("mutation"), selected = skinDefaultId.value;
    updatingSkinId.value = skin.id; skinManagerError.value = ""; skinManagerNotice.value = "";
    try {
      const result = await options.api.setSkinEnabled(skin.id, skin.enabled === false, request.signal);
      if (!request.isCurrent()) return;
      const current = skinEntries.value.find(entry => entry.id === skin.id);
      if (current) Object.assign(current, result.skin);
      savedDefault = result.defaultSkinId;
      if (skinDefaultId.value === selected) skinDefaultId.value = savedDefault;
      skinManagerNotice.value = options.tr(result.skin.enabled === false ? "skinDisabledNotice" : "skinEnabledNotice");
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) updatingSkinId.value = ""; request.finish(); }
  }
  async function onSkinFileChanged(event: Event) {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    if (!file || skinBusy.value) return;
    requests.cancel("load"); skinLoading.value = false;
    const request = requests.begin("mutation");
    skinUploading.value = true; skinManagerError.value = ""; skinManagerNotice.value = "";
    try {
      const result = await options.api.uploadSkin(file, id => !skinEntries.value.some(entry => entry.id === id) || window.confirm(`${options.tr("skinReplaceConfirm")}\n${id}`), request.signal);
      if (!request.isCurrent() || !result) return;
      skinManagerNotice.value = options.tr("skinImported");
      await loadSkinCatalog();
    } catch (error) { if (request.isCurrent()) report(error, true); }
    finally { input.value = ""; if (request.isCurrent()) skinUploading.value = false; request.finish(); }
  }
  async function removeSkin(skin: SkinCatalogEntry) {
    if (skinBusy.value || !window.confirm(`${options.tr("skinConfirmRemove")}\n${skin.name} (${skin.id})`)) return;
    requests.cancel("load"); skinLoading.value = false;
    const request = requests.begin("mutation");
    removingSkinId.value = skin.id; skinManagerError.value = ""; skinManagerNotice.value = "";
    try {
      await options.api.deleteSkin(skin.id, request.signal);
      if (!request.isCurrent()) return;
      skinManagerNotice.value = options.tr("skinRemoved");
      await loadSkinCatalog();
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) removingSkinId.value = ""; request.finish(); }
  }
  return { skinEntries, skinLoading, skinUploading, skinDefaultSaving, removingSkinId, updatingSkinId, skinDefaultId,
    skinTab, storeCatalog, storeLoading, storeInstallingId, storeError, loadSkinStore, selectSkinTab, installStoreSkin, installedStoreSkin, storeVersionOrder,
    skinManagerError, skinManagerNotice, skinBusy, enabledSkinEntries, loadSkinCatalog, saveSkinDefault, toggleSkinEnabled, onSkinFileChanged, removeSkin, cancelRequests, reset };
}
