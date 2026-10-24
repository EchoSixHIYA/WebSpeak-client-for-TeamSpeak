import { computed, onScopeDispose, reactive, ref, watch, type Ref } from "vue";
import type { TsAdminAction } from "../../../src/shared/admin-inputs.js";
import type { copy } from "../i18n/admin.js";
import type { AdminApi } from "../services/admin-api.js";
import { isAdminRequestCancelled } from "../services/admin-api.js";
import { createAdminRequests } from "../services/admin-requests.js";

interface Options {
  api: AdminApi; errorMessage: Ref<string>; errorText(code?: string): string;
  tr(key: keyof typeof copy.zh, vars?: Record<string, string | number>): string;
}
const emptySettings = () => ({ fixedMode: true, enabled: false, transport: "web" as "web" | "ssh" | "tcp",
  queryHost: "", webQueryUrl: "", serverId: 0, queryPort: 10022, username: "serveradmin", hasPassword: false,
  hasApiKey: false, hostKeyFingerprint: "", updatedAt: "", configurationRevision: "" });
const emptyForm = () => ({ enabled: false, transport: "web" as "web" | "ssh" | "tcp", queryHost: "", webQueryUrl: "", serverId: 0,
  queryPort: "10022", username: "serveradmin", password: "", passwordAction: "keep" as "keep" | "replace" | "remove",
  apiKey: "", apiKeyAction: "keep" as "keep" | "replace" | "remove", hostKeyFingerprint: "" });
type Form = ReturnType<typeof emptyForm>;
const emptyEditor = () => ({ action: "" as TsAdminAction["action"] | "", id: "", uid: "", targetName: "", name: "", description: "",
  parentId: "0", channelId: "", groupId: "", password: "", permanent: true, remove: false, reason: "", durationSeconds: 3600,
  welcomeMessage: "", maxClients: 32 });

export function useAdminTsAdmin(options: Options) {
  const requests = createAdminRequests();
  const settings = reactive(emptySettings()), form = reactive(emptyForm()), editor = reactive(emptyEditor());
  const overview = ref<Awaited<ReturnType<AdminApi["tsAdminOverview"]>> | null>(null);
  const noticeMessage = ref("");
  const loading = ref(false), saving = ref(false), connecting = ref(false), acting = ref(false);
  const settingsDirty = computed(() => form.enabled !== settings.enabled || form.transport !== settings.transport
    || form.queryHost !== settings.queryHost || form.webQueryUrl !== settings.webQueryUrl
    || form.serverId !== settings.serverId || form.queryPort !== String(settings.queryPort)
    || form.username !== (settings.username || "serveradmin") || form.hostKeyFingerprint !== settings.hostKeyFingerprint
    || form.passwordAction !== "keep" || form.apiKeyAction !== "keep" || Boolean(form.password) || Boolean(form.apiKey));
  let applyingSettings = false;
  watch(() => form.transport, (next, previous) => {
    if (applyingSettings) return;
    if (next === "ssh" && form.queryPort === "10011") form.queryPort = "10022";
    else if (next === "tcp" && (previous === "web" || form.queryPort === "10022")) form.queryPort = "10011";
  }, { flush: "sync" });
  function cancelRequests() {
    requests.reset(); loading.value = false; saving.value = false; connecting.value = false; acting.value = false;
    Object.assign(editor, emptyEditor());
  }
  function reset() {
    cancelRequests(); Object.assign(settings, emptySettings()); Object.assign(form, emptyForm()); overview.value = null; noticeMessage.value = "";
  }
  onScopeDispose(reset);
  function report(error: unknown) {
    if (!isAdminRequestCancelled(error)) options.errorMessage.value = options.errorText((error as { code?: string }).code);
  }
  function mergeSettings(value: Awaited<ReturnType<AdminApi["tsAdminSettings"]>>, baseline: Form) {
    if (settings.configurationRevision && settings.configurationRevision !== value.configurationRevision) {
      requests.cancel("overview"); connecting.value = false; overview.value = null; Object.assign(editor, emptyEditor());
    }
    Object.assign(settings, value);
    const next: Form = { enabled: value.enabled, transport: value.transport, queryHost: value.queryHost, webQueryUrl: value.webQueryUrl,
      serverId: value.serverId, queryPort: String(value.queryPort), username: value.username || "serveradmin", password: "", passwordAction: "keep",
      apiKey: "", apiKeyAction: "keep", hostKeyFingerprint: value.hostKeyFingerprint };
    const changedApiKey = form.apiKey !== baseline.apiKey, changedPassword = form.password !== baseline.password;
    const changedTransport = form.transport !== baseline.transport;
    applyingSettings = true;
    try {
      for (const key of Object.keys(next) as Array<keyof Form>) {
        if (key === "apiKeyAction" && changedApiKey || key === "passwordAction" && changedPassword || key === "queryPort" && changedTransport) continue;
        if (form[key] === baseline[key]) Object.assign(form, { [key]: next[key] });
      }
    } finally { applyingSettings = false; }
  }
  async function loadSettings() {
    const request = requests.begin("settings"), baseline = { ...form };
    loading.value = true; options.errorMessage.value = "";
    try { const value = await options.api.tsAdminSettings(request.signal); if (request.isCurrent()) mergeSettings(value, baseline); }
    catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) loading.value = false; request.finish(); }
  }
  async function saveSettings() {
    if (saving.value || acting.value) return;
    requests.cancel("overview"); connecting.value = false;
    const request = requests.begin("settings"), baseline = { ...form };
    saving.value = true; loading.value = false; options.errorMessage.value = ""; noticeMessage.value = "";
    try {
      const saved = await options.api.saveTsAdminSettings({ ...baseline, queryPort: Number(baseline.queryPort),
        password: baseline.passwordAction === "replace" ? baseline.password : undefined,
        apiKey: baseline.apiKeyAction === "replace" ? baseline.apiKey : undefined,
      }, request.signal);
      if (!request.isCurrent()) return;
      mergeSettings(saved.settings, baseline); overview.value = null; Object.assign(editor, emptyEditor());
      noticeMessage.value = options.tr("tsAdminSaved");
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) saving.value = false; request.finish(); }
  }
  async function connectAndRefresh() {
    if (loading.value || connecting.value || saving.value || acting.value || settingsDirty.value || !settings.enabled || !settings.fixedMode) return;
    const request = requests.begin("overview");
    connecting.value = true; options.errorMessage.value = "";
    try { const value = await options.api.tsAdminOverview(request.signal); if (request.isCurrent()) overview.value = value; }
    catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) connecting.value = false; request.finish(); }
  }
  function beginAction(action: TsAdminAction["action"], target?: { id: number | string; uid?: string; nickname?: string; name?: string; channelID?: string }) {
    if (acting.value || saving.value || loading.value || settingsDirty.value || !settings.enabled || !settings.fixedMode || !overview.value) return;
    Object.assign(editor, emptyEditor(), { action, id: String(target?.id ?? ""), uid: target?.uid ?? "",
      targetName: target?.nickname || target?.name || target?.uid || String(target?.id ?? ""), name: target?.name ?? "",
      channelId: target?.channelID ?? overview.value.channels[0]?.id ?? "", groupId: overview.value.groups[0]?.id ?? "",
      ...(action === "server.update" ? { name: overview.value.serverName, welcomeMessage: overview.value.welcomeMessage, maxClients: overview.value.maxClients } : {}),
    });
  }
  function closeAction() { if (!acting.value) Object.assign(editor, emptyEditor()); }
  function actionPayload(): TsAdminAction {
    const action = editor.action;
    if (action === "server.update") return { action, name: editor.name, welcomeMessage: editor.welcomeMessage, maxClients: Number(editor.maxClients) };
    if (action === "channel.create") return { action, name: editor.name, description: editor.description, parentId: editor.parentId,
      permanent: editor.permanent, ...(editor.password ? { password: editor.password } : {}) };
    if (action === "channel.update") return { action, channelId: editor.id, name: editor.name };
    if (action === "channel.delete") return { action, channelId: editor.id };
    if (action === "ban.delete") return { action, banId: editor.id };
    const member = { clientId: Number(editor.id), clientUid: editor.uid };
    if (action === "client.move") return { action, ...member, channelId: editor.channelId };
    if (action === "client.kick") return { action, ...member, reason: editor.reason };
    if (action === "client.ban") return { action, ...member, reason: editor.reason, durationSeconds: Number(editor.durationSeconds) };
    if (action === "client.group") return { action, ...member, groupId: editor.groupId, remove: editor.remove };
    throw new Error("INVALID_TS_ADMIN_ACTION");
  }
  async function runAction() {
    if (acting.value || saving.value || loading.value || settingsDirty.value || !settings.enabled || !settings.fixedMode || !editor.action || !overview.value) return;
    requests.cancel("overview"); connecting.value = false;
    const request = requests.begin("action"), body = { operation: actionPayload(), configurationRevision: overview.value.configurationRevision };
    acting.value = true; options.errorMessage.value = ""; noticeMessage.value = "";
    try {
      await options.api.tsAdminAction(body, request.signal);
      if (!request.isCurrent()) return;
      Object.assign(editor, emptyEditor()); noticeMessage.value = options.tr("tsAdminActionSaved"); overview.value = null;
      // A failed refresh must never retry the write or report that it did not happen.
      acting.value = false;
      await connectAndRefresh();
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) acting.value = false; request.finish(); }
  }
  return { settings, form, editor, overview, settingsDirty, noticeMessage, loading, saving, connecting, acting,
    loadSettings, saveSettings, connectAndRefresh, beginAction, closeAction, runAction, cancelRequests, reset };
}
