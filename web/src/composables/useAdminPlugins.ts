import { reactive, ref, shallowRef } from "vue";
import { createAdminRequests } from "../services/admin-requests.js";
import { isAdminRequestCancelled, type AdminApi } from "../services/admin-api.js";
import { parsePluginPackage, PLUGIN_LIMIT_BYTES, type InstalledPlugin, type PluginCatalog, type PluginStoreEntry } from "../../../src/shared/plugins.js";

export function useAdminPlugins(api: AdminApi) {
  const installed = shallowRef<InstalledPlugin[]>([]), catalog = shallowRef<PluginCatalog | null>(null);
  const busy = ref(false), error = ref(''), requests = createAdminRequests();
  const drafts = reactive<Record<string, { enabled: boolean; scope: 'server'|'instance'; targets: string; config: string }>>({});
  function apply(records: InstalledPlugin[]) {
    installed.value = records;
    for (const record of records) if (!drafts[record.manifest.id]) drafts[record.manifest.id] = {
      enabled: record.settings.enabled, scope: record.settings.scope, targets: record.settings.targets.join('\n'), config: JSON.stringify(record.settings.config, null, 2),
    };
    for (const id of Object.keys(drafts)) if (!records.some(r => r.manifest.id === id)) delete drafts[id];
  }
  async function work(run: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const request = requests.begin('plugins'); busy.value = true; error.value = '';
    const timer = setTimeout(() => { if (request.isCurrent()) { error.value='PLUGIN_TIMEOUT'; requests.cancel('plugins'); busy.value=false; } }, 90_000);
    try { await run(request.signal, request.isCurrent); }
    catch (e) { if (request.isCurrent() && !isAdminRequestCancelled(e)) error.value = e instanceof Error ? e.message : 'PLUGIN_FAILED'; }
    finally { clearTimeout(timer); if (request.isCurrent()) busy.value = false; request.finish(); }
  }
  function load() { return work(async (signal, current) => {
    const result = await api.plugins(signal); if (current()) apply(result.plugins);
    // Installed packages remain manageable even when GitHub is unavailable.
    const store = await api.pluginStore(signal); if (current()) catalog.value = store;
  }); }
  async function install(entry: PluginStoreEntry) {
    return work(async (signal, current) => {
      const result = await api.installPlugin({ id: entry.id, revision: entry.revision, installedRevision: installed.value.find(p => p.manifest.id === entry.id)?.revision ?? null }, signal);
      if (current()) { delete drafts[entry.id]; apply([...installed.value.filter(p => p.manifest.id !== entry.id), result.plugin]); }
    });
  }
  function save(record: InstalledPlugin) {
    return work(async (signal, current) => {
      const draft = drafts[record.manifest.id], captured = JSON.stringify(draft);
      const settings = { enabled: draft.enabled, scope: draft.scope, targets: draft.targets.split(/\r?\n/).map(t => t.trim()).filter(Boolean), config: JSON.parse(draft.config) };
      const result = await api.configurePlugin(record.manifest.id, record.revision, settings, signal);
      if (current()) { if (JSON.stringify(drafts[record.manifest.id]) === captured) delete drafts[record.manifest.id]; apply(installed.value.map(p => p.manifest.id === record.manifest.id ? result.plugin : p)); }
    });
  }
  function remove(record: InstalledPlugin) { return work(async (signal, current) => { await api.removePlugin(record.manifest.id, record.revision, signal); if (current()) apply(installed.value.filter(p => p.manifest.id !== record.manifest.id)); }); }
  function upload(file: File) { return work(async (signal, current) => {
    if (file.size > PLUGIN_LIMIT_BYTES) throw new Error('PLUGIN_TOO_LARGE');
    const pack = parsePluginPackage(JSON.parse(await file.text())); if (!current()) return;
    const result = await api.uploadPlugin(pack, installed.value.find(p => p.manifest.id === pack.manifest.id)?.revision ?? null, signal);
    if (current()) { delete drafts[pack.manifest.id]; apply([...installed.value.filter(p => p.manifest.id !== pack.manifest.id), result.plugin]); }
  }); }
  function cancelRequests() { requests.reset(); busy.value = false; }
  function reset() { cancelRequests(); installed.value = []; catalog.value = null; error.value = ''; for (const id of Object.keys(drafts)) delete drafts[id]; }
  return { installed, catalog, busy, error, drafts, load, install, save, remove, upload, cancelRequests, reset };
}
