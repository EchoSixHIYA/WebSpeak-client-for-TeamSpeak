import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import vuePlugin from "@vitejs/plugin-vue";

// Mount the actual SFC setup and router with a headless Vue renderer. HTTP is
// controlled to reorder responses; DOM layout and real authentication are not
// claimed by these lifecycle tests.
let vite, AdminView, createRenderer, createRouter, createMemoryHistory, ssrContextKey, reactive;
let app, router, state, handler, serverModel, operationsModel, skinsModel;
const globals = new Map();
function global(name, value) {
  if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const settings = (extra = {}) => ({
  target: "voice.example:9987", hasPassword: false, accessMode: "fixed", siteName: "Original",
  welcomeText: "", welcomeTextEn: "", welcomeTextDe: "", welcomeTextRu: "", welcomeTextJa: "",
  welcomeDefaults: { zh: "", en: "", de: "", ru: "", ja: "" },
  lastTestAt: null, lastTestLatencyMs: null, lastTestError: null,
  webRtcEnabled: false, webRtcUdpStart: 40000, webRtcUdpEnd: 40099,
  relayConfigured: false, relayEnabled: false, relayName: "", relayTarget: "", hasRelayToken: false,
  relayNodes: [], internalPort: 3040, updatedAt: "2026-10-01T00:00:00Z", ...extra,
});
const overview = { gateway: { status: "running", version: "test", uptimeSeconds: 0 },
  teamSpeak: { target: "voice.example:9987", status: "unknown", lastTestAt: null, latencyMs: null, lastError: null },
  sessions: { active: 0, peak: 0, limit: 100 }, recentEvents: [], legacyConfigImported: false };
const session = nickname => ({ id: nickname, nickname, target: "voice.example:9987", state: "connected", createdAt: "2026-10-01T00:00:00Z", ageSeconds: 0, tsClientId: 1, channelId: "1", memberCount: 1 });
const tsSettings = (extra = {}) => ({ enabled: true, fixedMode: true, transport: "web", queryHost: "", webQueryUrl: "https://query.example", serverId: 1,
  configurationRevision: "reviewed-configuration",
  queryPort: 10022, username: "", hasPassword: false, hasApiKey: true, hostKeyFingerprint: "", updatedAt: "2026-10-01T00:00:00Z", ...extra });
const tsOverview = () => ({ configurationRevision: "reviewed-configuration", serverName: "TS fixture", serverVersion: "6.0.0", serverFamily: "ts6", welcomeMessage: "Welcome", maxClients: 32, uptimeSeconds: 1,
  channelCount: 1, clientCount: 1, channels: [{ id: "1", parentID: "0", name: "Lobby", description: "", totalClients: 1, hasPassword: false }],
  clients: [{ id: 42, uid: "selected-uid", nickname: "Selected user", channelID: "1", serverGroups: ["6"], away: false, inputMuted: false, outputMuted: false }],
  groups: [{ id: "6", name: "Member" }], bans: [], groupsAvailable: true, bansAvailable: true, observedAt: "2026-10-01T00:00:00Z" });
const defaults = path => ({
  "/session": { authenticated: true, mustChangePassword: false, csrfToken: "test-csrf" },
  "/server": settings(), "/overview": overview, "/sessions": { sessions: [] }, "/invites": { invites: [] },
  "/diagnostics": { gateway: { version: "test", node: "test", platform: "test", arch: "test" }, database: { schemaVersion: 1 }, sessions: { created: 0 } },
  "/logs?limit=100": { available: false, entries: [], sessions: [] }, "/audit?limit=50": { events: [] },
  "/skins": { skins: [], defaultSkinId: "builtin.light" },
  "/ts-admin/settings": tsSettings(), "/ts-admin/overview": tsOverview(),
})[path];

before(async () => {
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL("../", import.meta.url)),
    plugins: [vuePlugin()], server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  ({ createRenderer, ssrContextKey, reactive } = await import("vue"));
  ({ createRouter, createMemoryHistory } = await import("vue-router"));
  ({ default: AdminView } = await vite.ssrLoadModule("/src/views/AdminView.vue"));
});
beforeEach(() => {
  const storage = new Map();
  global("localStorage", { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) });
  global("window", { confirm: () => true, setTimeout, clearTimeout });
  global("location", { origin: "https://gateway.example" });
  global("document", undefined);
  handler = (path) => Promise.resolve(json(defaults(path)));
  global("fetch", (url, init) => handler(String(url).replace("/api/admin", ""), init));
});
afterEach(() => { app?.unmount(); app = null; });
after(async () => {
  await vite?.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

async function mount(path = "/admin/server") {
  const renderer = createRenderer({
    createComment: text => ({ text }), createText: text => ({ text }), createElement: () => ({}),
    insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
  });
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }] });
  await router.push(path);
  await router.isReady();
  app = renderer.createApp({ ...AdminView, render: () => null });
  app.provide(ssrContextKey, { modules: new Set() });
  app.use(router);
  app.mount({});
  state = app._instance.setupState;
  serverModel = reactive(state.serverSettings);
  operationsModel = reactive(state.adminOperations);
  skinsModel = reactive(state.adminSkins);
  await nextTurn();
  assert.equal(state.loading, false);
}

test("nickname defaults load and save without forcing the voice port", async () => {
  handler = path => Promise.resolve(json(path === "/server" ? settings({ target: "team eco" }) : defaults(path)));
  await mount();
  assert.equal(serverModel.serverForm.address, "team eco");
  assert.equal(serverModel.serverForm.port, "");
  serverModel.serverForm.address = "voice.example.com";
  assert.equal(serverModel.serverForm.port, "9987");
  serverModel.serverForm.address = "another guild";
  assert.equal(serverModel.serverForm.port, "");
  handler = (path, init) => {
    if (path === "/server" && init.method === "PUT") {
      assert.equal(JSON.parse(init.body).target, "another guild");
      return Promise.resolve(json({ ok: true, settings: settings({ target: "another guild" }) }));
    }
    return Promise.resolve(json(defaults(path)));
  };
  await serverModel.saveServerSettings();
  assert.equal(serverModel.serverForm.port, "");
  assert.equal(state.errorMessage, "");
});

test("saving settings preserves edits made after the request started", async () => {
  await mount();
  const save = deferred();
  handler = (path, init) => path === "/server" && init.method === "PUT" ? save.promise : Promise.resolve(json(defaults(path)));
  serverModel.serverForm.siteName = "Submitted";
  serverModel.serverForm.passwordAction = "replace";
  serverModel.serverForm.serverPassword = "submitted-test-password";
  const pending = serverModel.saveServerSettings();
  serverModel.serverForm.siteName = "New draft";
  serverModel.serverForm.serverPassword = "new-test-password";
  save.resolve(json({ ok: true, settings: settings({ siteName: "Submitted", hasPassword: true }) }));
  await pending;
  assert.equal(serverModel.serverForm.siteName, "New draft");
  assert.equal(serverModel.serverForm.serverPassword, "new-test-password");
  assert.equal(serverModel.serverForm.passwordAction, "replace");
  assert.equal(serverModel.serverForm.hasPassword, true);
});

test("changing the target while probing discards the old server result", async () => {
  await mount();
  const probe = deferred();
  handler = path => path === "/server/test" ? probe.promise : Promise.resolve(json(defaults(path)));
  const pending = serverModel.testServerConnection();
  serverModel.serverForm.address = "replacement.example";
  probe.resolve(json({ ok: true, checkType: "protocol", passwordVerified: false, latencyMs: 20, serverName: "Old", requiresPassword: false }));
  await pending;
  assert.equal(serverModel.testResult, null);
  assert.equal(serverModel.serverForm.lastTestAt, null);
});

test("an older operations refresh cannot overwrite the newer snapshot", async () => {
  await mount();
  const first = deferred();
  let queries = 0;
  handler = path => path === "/sessions"
    ? (++queries === 1 ? first.promise : Promise.resolve(json({ sessions: [session("New")] })))
    : Promise.resolve(json(defaults(path)));
  const old = operationsModel.loadOperations();
  await operationsModel.loadOperations();
  first.resolve(json({ sessions: [session("Old")] }));
  await old;
  assert.deepEqual(operationsModel.operations.sessions.map(item => item.nickname), ["New"]);
});

test("unmounting the admin page prevents late login from navigating back", async () => {
  handler = path => Promise.resolve(json(path === "/session" ? { authenticated: false } : defaults(path)));
  await mount("/admin/login");
  const login = deferred();
  handler = path => path === "/login" ? login.promise : Promise.resolve(json(defaults(path)));
  const pending = state.login();
  app.unmount(); app = null;
  await router.push("/");
  login.resolve(json({ ok: true, mustChangePassword: false, csrfToken: "new-test-csrf" }));
  await pending;
  assert.equal(router.currentRoute.value.path, "/");
});

test("refreshing skins preserves a default selection edited during the request", async () => {
  await mount("/admin/skins");
  const skins = deferred();
  handler = path => path === "/skins" ? skins.promise : Promise.resolve(json(defaults(path)));
  const pending = skinsModel.loadSkinCatalog();
  skinsModel.skinDefaultId = "builtin.dark";
  skins.resolve(json({ skins: [], defaultSkinId: "builtin.light" }));
  await pending;
  assert.equal(skinsModel.skinDefaultId, "builtin.dark");
});

test("a successful settings save clears submitted secrets and updates their stored status", async () => {
  await mount();
  serverModel.serverForm.passwordAction = "replace";
  serverModel.serverForm.serverPassword = "submitted-test-password";
  serverModel.addRelayNode();
  Object.assign(serverModel.serverForm.relayNodes[0], { name: "Relay", target: "relay.example:9000", token: "submitted-test-token" });
  const relay = { ...serverModel.serverForm.relayNodes[0], hasToken: true };
  handler = (path, init) => Promise.resolve(json(path === "/server" && init.method === "PUT"
    ? { ok: true, settings: settings({ hasPassword: true, relayNodes: [relay] }) } : defaults(path)));
  await serverModel.saveServerSettings();
  assert.equal(serverModel.serverForm.serverPassword, "");
  assert.equal(serverModel.serverForm.passwordAction, "keep");
  assert.equal(serverModel.serverForm.hasPassword, true);
  assert.equal(serverModel.serverForm.relayNodes[0].token, "");
  assert.equal(serverModel.serverForm.relayNodes[0].tokenAction, "keep");
  assert.equal(serverModel.serverForm.relayNodes[0].hasToken, true);
  assert.equal(serverModel.serverSaving, false);
  assert.equal(state.errorMessage, "");
});

test("ICE settings load, submit and preserve edits made during a pending save", async () => {
  await mount();
  const network = { webRtcPublicHost: "media.example.com", webRtcIpv6Enabled: true, webRtcStunServer: "stun:stun.example.com:3478" };
  handler = path => Promise.resolve(json(path === "/server" ? settings(network) : defaults(path)));
  await serverModel.loadServerSettings();
  for (const [key, value] of Object.entries(network)) assert.equal(serverModel.serverForm[key], value);
  const save = deferred();
  handler = (path, init) => {
    if (path !== "/server" || init.method !== "PUT") return Promise.resolve(json(defaults(path)));
    const submitted = JSON.parse(init.body);
    for (const [key, value] of Object.entries(network)) assert.equal(submitted[key], value);
    return save.promise;
  };
  const pending = serverModel.saveServerSettings();
  serverModel.serverForm.webRtcPublicHost = "new-media.example.com";
  serverModel.serverForm.webRtcIpv6Enabled = false;
  serverModel.serverForm.webRtcStunServer = "";
  save.resolve(json({ ok: true, settings: settings(network) }));
  await pending;
  assert.equal(serverModel.serverForm.webRtcPublicHost, "new-media.example.com");
  assert.equal(serverModel.serverForm.webRtcIpv6Enabled, false);
  assert.equal(serverModel.serverForm.webRtcStunServer, "");
});

test("settings saves preserve relay edits, removals and additions made while awaiting the server", async () => {
  await mount();
  serverModel.addRelayNode(); serverModel.addRelayNode();
  for (const [i, node] of serverModel.serverForm.relayNodes.entries()) Object.assign(node, { name: `Relay ${i}`, target: "relay.example:9000", token: "old-token" });
  const submitted = serverModel.serverForm.relayNodes.map(node => ({ ...node, hasToken: true }));
  const save = deferred();
  handler = (path, init) => path === "/server" && init.method === "PUT" ? save.promise : Promise.resolve(json(defaults(path)));
  const pending = serverModel.saveServerSettings();
  Object.assign(serverModel.serverForm.relayNodes[0], { name: "New name", token: "new-token" });
  serverModel.removeRelayNode(1); serverModel.addRelayNode();
  const addedId = serverModel.serverForm.relayNodes[1].id;
  save.resolve(json({ ok: true, settings: settings({ relayNodes: submitted }) }));
  await pending;
  assert.deepEqual(serverModel.serverForm.relayNodes.map(node => node.id), [submitted[0].id, addedId]);
  assert.equal(serverModel.serverForm.relayNodes[0].name, "New name");
  assert.equal(serverModel.serverForm.relayNodes[0].token, "new-token");
  assert.equal(serverModel.serverForm.relayNodes[0].tokenAction, "replace");
  assert.equal(serverModel.serverForm.relayNodes[0].hasToken, true);
});

test("duplicate saves submit once and failed saves retain the draft", async () => {
  await mount();
  const save = deferred(); let calls = 0;
  handler = (path, init) => path === "/server" && init.method === "PUT"
    ? (++calls, save.promise) : Promise.resolve(json(defaults(path)));
  Object.assign(serverModel.serverForm, { siteName: "Unsaved", passwordAction: "replace", serverPassword: "unsaved-test-password" });
  const pending = serverModel.saveServerSettings();
  await serverModel.saveServerSettings();
  assert.equal(calls, 1);
  assert.equal(serverModel.serverSaving, true);
  save.resolve(json({ code: "REQUEST_FAILED" }, 500));
  await pending;
  assert.equal(serverModel.serverSaving, false);
  assert.equal(serverModel.serverForm.siteName, "Unsaved");
  assert.equal(serverModel.serverForm.serverPassword, "unsaved-test-password");
  assert.ok(state.errorMessage);
});

test("only the latest probe publishes its result and a valid probe still updates the timestamp", async () => {
  await mount();
  const old = deferred(); let probes = 0;
  const result = name => ({ ok: true, checkType: "protocol", passwordVerified: false, latencyMs: 20, serverName: name, requiresPassword: false });
  handler = path => path === "/server/test" ? (++probes === 1 ? old.promise : Promise.resolve(json(result("New")))) : Promise.resolve(json(defaults(path)));
  const pending = serverModel.testServerConnection();
  serverModel.serverForm.address = "new.example";
  await serverModel.testServerConnection();
  old.resolve(json(result("Old"))); await pending;
  assert.equal(serverModel.testResult.serverName, "New");
  assert.equal(serverModel.serverForm.lastTestLatencyMs, 20);
  assert.ok(serverModel.serverForm.lastTestAt);
  assert.equal(serverModel.testing, false);
  assert.equal(state.errorMessage, "");
});

test("an obsolete refresh failure cannot clear a newer spinner or publish an error", async () => {
  await mount("/admin/operations");
  const old = deferred(), latest = deferred(); let calls = 0;
  handler = path => path === "/sessions" ? (++calls === 1 ? old.promise : latest.promise) : Promise.resolve(json(defaults(path)));
  const first = operationsModel.loadOperations(), second = operationsModel.loadOperations();
  old.resolve(json({ code: "REQUEST_FAILED" }, 500)); await first;
  assert.equal(operationsModel.operationsLoading, true);
  assert.equal(state.errorMessage, "");
  latest.resolve(json({ sessions: [session("New")] })); await second;
  assert.equal(operationsModel.operationsLoading, false);
  assert.equal(operationsModel.operations.sessions[0].nickname, "New");
});

test("leaving a management section discards its pending read and returning loads fresh data", async () => {
  await mount("/admin/operations");
  const old = deferred();
  handler = path => path === "/sessions" ? old.promise : Promise.resolve(json(defaults(path)));
  const pending = operationsModel.loadOperations();
  state.errorMessage = "Previous section error";
  await router.push("/admin/server");
  await nextTurn();
  old.resolve(json({ sessions: [session("Old")] })); await pending;
  assert.deepEqual(operationsModel.operations.sessions, []);
  assert.equal(operationsModel.operationsLoading, false);
  assert.equal(state.errorMessage, "");
  handler = path => Promise.resolve(json(path === "/sessions" ? { sessions: [session("Current")] } : defaults(path)));
  await router.push("/admin/operations"); await nextTurn();
  assert.equal(operationsModel.operations.sessions[0].nickname, "Current");
});

test("a failed logout preserves the authenticated draft and a successful logout clears private state", async () => {
  await mount("/admin/operations");
  serverModel.serverForm.siteName = "Draft"; serverModel.serverForm.serverPassword = "private-test-password";
  operationsModel.inviteForm.expiresInHours = 48; operationsModel.inviteForm.maxUses = 10;
  operationsModel.createdInvite = { token: "test-only-invite", link: "https://gateway.example/?invite=test-only-invite" };
  handler = path => Promise.resolve(path === "/logout" ? json({ code: "REQUEST_FAILED" }, 500) : json(defaults(path)));
  await state.logout();
  assert.equal(state.screen, "admin");
  assert.equal(serverModel.serverForm.siteName, "Draft");
  assert.equal(serverModel.serverForm.serverPassword, "private-test-password");
  assert.equal(operationsModel.createdInvite?.token, "test-only-invite");
  assert.equal(state.loggingOut, false);
  assert.ok(state.errorMessage);
  handler = path => Promise.resolve(json(path === "/logout" ? { ok: true } : defaults(path)));
  await state.logout();
  assert.equal(state.screen, "login");
  assert.equal(state.csrfToken, "");
  assert.equal(serverModel.serverForm.serverPassword, "");
  assert.equal(operationsModel.operations.diagnostics.node, "");
  assert.equal(operationsModel.inviteForm.expiresInHours, 24);
  assert.equal(operationsModel.inviteForm.maxUses, 0);
  assert.equal(operationsModel.createdInvite, null);
  assert.equal(router.currentRoute.value.path, "/admin/login");
});

test("an old 401 cannot log out a newly authenticated page", async () => {
  await mount("/admin/operations");
  const old = deferred();
  handler = path => path === "/sessions" ? old.promise : Promise.resolve(json(path === "/logout" ? { ok: true } : defaults(path)));
  const pending = operationsModel.loadOperations();
  await state.logout();
  handler = path => Promise.resolve(json(path === "/login" ? { ok: true, mustChangePassword: false, csrfToken: "new-test-csrf" } : defaults(path)));
  await state.login();
  old.resolve(json({ code: "AUTH_REQUIRED" }, 401)); await pending;
  assert.equal(state.screen, "admin");
  assert.equal(state.csrfToken, "new-test-csrf");
  assert.equal(router.currentRoute.value.path, "/admin");
  assert.equal(state.errorMessage, "");
});

test("a current 401 resets the page without leaving an error or loading spinner", async () => {
  await mount("/admin/operations");
  serverModel.serverForm.serverPassword = "private-test-password";
  handler = () => Promise.resolve(json({ code: "AUTH_REQUIRED" }, 401));
  await operationsModel.loadOperations(); await nextTurn();
  assert.equal(state.screen, "login");
  assert.equal(serverModel.serverForm.serverPassword, "");
  assert.equal(operationsModel.operations.diagnostics.version, "");
  assert.equal(operationsModel.operationsLoading, false);
  assert.equal(state.errorMessage, "");
  assert.equal(router.currentRoute.value.path, "/admin/login");
});

test("unmounting during a backup download cannot trigger a late file download", async () => {
  await mount("/admin/operations");
  const backup = deferred(); let downloads = 0;
  global("document", { createElement() { downloads++; return { click() {} }; } });
  handler = path => path === "/backup" ? backup.promise : Promise.resolve(json(defaults(path)));
  const pending = operationsModel.downloadBackup();
  app.unmount(); app = null;
  backup.resolve(new Response(new Uint8Array([0, 1, 255]))); await pending;
  assert.equal(downloads, 0);
  assert.equal(state.errorMessage, "");
});

test("skin mutations are serialized and failure restores the last saved default", async () => {
  await mount("/admin/skins");
  const save = deferred(); let calls = 0;
  handler = path => path === "/skins/default" ? (++calls, save.promise) : Promise.resolve(json(defaults(path)));
  skinsModel.skinDefaultId = "builtin.dark";
  const pending = skinsModel.saveSkinDefault();
  await skinsModel.saveSkinDefault();
  assert.equal(calls, 1);
  assert.equal(skinsModel.skinBusy, true);
  save.resolve(json({ code: "REQUEST_FAILED" }, 500)); await pending;
  assert.equal(skinsModel.skinDefaultId, "builtin.light");
  assert.equal(skinsModel.skinBusy, false);
  assert.ok(skinsModel.skinManagerError);
});

const storeFixture = () => ({ repository: "https://github.com/Huddle-Up-Forge/webspeak-skins", appVersion: "0.2.8", fetchedAt: 1,
  entries: [{ id: "store-test", repository: "https://github.com/example/skin", revision: "a".repeat(64), compatible: true, error: null,
    metadata: { schemaVersion: 1, id: "store-test", name: "Fixture", version: "1.0.0", author: "Fixture", license: "MIT", description: "Fixture", minAppVersion: "0.2.8", package: { path: "skin.wskin", ref: "v1.0.0", sha256: "b".repeat(64) } } }] });

test("skin store is loaded lazily and a failed refresh preserves its previous catalog", async () => {
  let reads = 0;
  handler = path => path === "/skin-store" ? (++reads, Promise.resolve(json(storeFixture()))) : Promise.resolve(json(defaults(path)));
  await mount("/admin/skins");
  assert.equal(reads, 0);
  skinsModel.selectSkinTab("store"); await nextTurn();
  assert.equal(reads, 1);
  assert.equal(skinsModel.storeCatalog.entries[0].id, "store-test");
  handler = path => Promise.resolve(json(path === "/skin-store/refresh" ? { code: "SKIN_STORE_UNAVAILABLE" } : defaults(path), path === "/skin-store/refresh" ? 502 : 200));
  await skinsModel.loadSkinStore(true);
  assert.equal(skinsModel.storeCatalog.entries.length, 1);
  assert.ok(skinsModel.storeError);
});

test("leaving skins discards a late store catalog and logout clears store state", async () => {
  await mount("/admin/skins");
  const catalog = deferred();
  handler = path => path === "/skin-store" ? catalog.promise : Promise.resolve(json(defaults(path)));
  const pending = skinsModel.loadSkinStore();
  await router.push("/admin/server"); await nextTurn();
  catalog.resolve(json(storeFixture())); await pending;
  assert.equal(skinsModel.storeCatalog, null);
  assert.equal(skinsModel.storeLoading, false);
  skinsModel.storeCatalog = storeFixture();
  skinsModel.reset();
  assert.equal(skinsModel.storeCatalog, null);
});

test("refreshing the store also reloads packages changed by another administrator", async () => {
  await mount("/admin/skins");
  handler = path => Promise.resolve(json(path === "/skin-store/refresh" ? storeFixture()
    : path === "/skins" ? { skins: [{ ...manifestForStoreTest(), version: "1.1.0", enabled: false }], defaultSkinId: "builtin.light" } : defaults(path)));
  await skinsModel.loadSkinStore(true);
  assert.equal(skinsModel.skinEntries.find(skin => skin.id === "store-test").version, "1.1.0");
  assert.equal(skinsModel.installedStoreSkin(storeFixture().entries[0]).enabled, false);
  assert.equal(skinsModel.storeVersionOrder(storeFixture().entries[0]), -1);
});

test("store install submits the reviewed revision once and reloads the instance catalog", async () => {
  await mount("/admin/skins");
  const install = deferred(); let writes = 0, submitted;
  handler = (path, init) => path === "/skin-store/install" ? (++writes, submitted = JSON.parse(init.body), install.promise) : Promise.resolve(json(defaults(path)));
  const entry = storeFixture().entries[0];
  const pending = skinsModel.installStoreSkin(entry);
  await skinsModel.installStoreSkin(entry);
  await skinsModel.saveSkinDefault();
  assert.equal(writes, 1);
  assert.deepEqual(submitted, { id: entry.id, revision: entry.revision, installedVersion: null });
  assert.equal(skinsModel.skinBusy, true);
  install.resolve(json({ ok: true, skin: { ...manifestForStoreTest(), enabled: true } }));
  await pending;
  assert.equal(skinsModel.skinBusy, false);
  assert.ok(skinsModel.skinManagerNotice);
});
function manifestForStoreTest() { return { id: "store-test", name: "Fixture", version: "1.0.0", author: "Fixture", license: "MIT", minAppVersion: "0.2.8", installedAt: 1 }; }

test("all store translations are explicit in each supported language", async () => {
  const { skinStoreCopy } = await vite.ssrLoadModule("/src/i18n/skin-store.ts");
  const keys = Object.keys(skinStoreCopy.zh).sort();
  for (const language of ["en", "de", "ru", "ja"]) {
    assert.deepEqual(Object.keys(skinStoreCopy[language]).sort(), keys);
    for (const key of keys) assert.ok(skinStoreCopy[language][key].trim());
  }
});

test("a settings response cannot restore probe metadata after the draft password changes", async () => {
  await mount();
  const save = deferred();
  handler = (path, init) => path === "/server" && init.method === "PUT" ? save.promise : Promise.resolve(json(defaults(path)));
  const pending = serverModel.saveServerSettings();
  serverModel.serverForm.passwordAction = "replace";
  serverModel.serverForm.serverPassword = "new-test-password";
  save.resolve(json({ ok: true, settings: settings({ lastTestAt: "2020-01-01T00:00:00Z", lastTestLatencyMs: 30 }) }));
  await pending;
  assert.equal(serverModel.serverForm.lastTestAt, null);
  assert.equal(serverModel.serverForm.lastTestLatencyMs, null);
});

test("a settings response cannot overwrite a newer probe completed during the save", async () => {
  await mount();
  const save = deferred();
  handler = (path, init) => path === "/server" && init.method === "PUT" ? save.promise : Promise.resolve(json(path === "/server/test"
    ? { ok: true, checkType: "protocol", passwordVerified: false, latencyMs: 10, serverName: "Current", requiresPassword: false } : defaults(path)));
  const pending = serverModel.saveServerSettings();
  await serverModel.testServerConnection();
  const testedAt = serverModel.serverForm.lastTestAt;
  save.resolve(json({ ok: true, settings: settings({ lastTestAt: "2020-01-01T00:00:00Z", lastTestLatencyMs: 30 }) }));
  await pending;
  assert.equal(serverModel.serverForm.lastTestAt, testedAt);
  assert.equal(serverModel.serverForm.lastTestLatencyMs, 10);
});

test("duplicate invite revocation sends one mutation", async () => {
  await mount("/admin/operations");
  const revoke = deferred(); let calls = 0;
  handler = path => path === "/invites/test/revoke" ? (++calls, revoke.promise) : Promise.resolve(json(defaults(path)));
  const pending = operationsModel.revokeInvite({ id: "test" });
  const duplicate = operationsModel.revokeInvite({ id: "test" });
  revoke.resolve(json({ ok: true }));
  await Promise.all([pending, duplicate]);
  assert.equal(calls, 1);
});

test("TS management saves keep newer credential edits and invalidate pending overview reads", async () => {
  await mount("/admin/ts-admin");
  const model = reactive(state.adminTsAdmin), oldOverview = deferred(), save = deferred();
  handler = (path, init) => path === "/ts-admin/overview" ? oldOverview.promise : path === "/ts-admin/settings" && init.method === "PUT" ? save.promise : Promise.resolve(json(defaults(path)));
  const reading = model.connectAndRefresh();
  model.form.apiKeyAction = "replace"; model.form.apiKey = "submitted-key";
  const saving = model.saveSettings();
  model.form.apiKey = "newer-draft-key";
  save.resolve(json({ ok: true, settings: tsSettings({ hasApiKey: true }) }));
  await saving;
  oldOverview.resolve(json(tsOverview())); await reading;
  assert.equal(model.form.apiKey, "newer-draft-key");
  assert.equal(model.form.apiKeyAction, "replace");
  assert.equal(model.overview, null);
  assert.equal(model.connecting, false); assert.equal(model.saving, false);
  handler = () => Promise.resolve(json({ ok: true, settings: tsSettings({ hasApiKey: true }) }));
  await model.saveSettings();
  assert.equal(model.form.apiKey, ""); assert.equal(model.form.apiKeyAction, "keep");
});

test("TS mutations send the selected UID once and a failed refresh never retries a completed write", async () => {
  await mount("/admin/ts-admin");
  const model = reactive(state.adminTsAdmin);
  await model.connectAndRefresh();
  model.beginAction("client.kick", model.overview.clients[0]);
  model.editor.reason = "Test reason";
  const response = deferred(); let writes = 0;
  handler = (path, init) => {
    if (path === "/ts-admin/action") {
      writes++;
      assert.deepEqual(JSON.parse(init.body), { configurationRevision: "reviewed-configuration", operation: { action: "client.kick", clientId: 42, clientUid: "selected-uid", reason: "Test reason" } });
      return response.promise;
    }
    if (path === "/ts-admin/overview") return Promise.resolve(json({ code: "TS_ADMIN_CONNECTION_FAILED" }, 400));
    return Promise.resolve(json(defaults(path)));
  };
  const pending = model.runAction(); await model.runAction();
  response.resolve(json({ ok: true })); await pending;
  assert.equal(writes, 1); assert.equal(model.acting, false); assert.equal(model.editor.action, "");
  assert.ok(model.noticeMessage); assert.equal(state.errorMessage, "");
  assert.ok(model.refreshWarning.includes("操作已完成")); assert.ok(model.refreshWarning.includes("勿重复执行"));
  assert.equal(model.overview, null);
  handler = path => Promise.resolve(json(defaults(path)));
  await model.connectAndRefresh();
  assert.equal(model.refreshWarning, ""); assert.ok(model.overview);
});

test("leaving TS management discards a late response and logout clears saved credential drafts", async () => {
  await mount("/admin/ts-admin");
  const model = reactive(state.adminTsAdmin), read = deferred();
  handler = path => path === "/ts-admin/overview" ? read.promise : Promise.resolve(json(path === "/logout" ? { ok: true } : defaults(path)));
  const pending = model.connectAndRefresh();
  await router.push("/admin"); await nextTurn();
  read.resolve(json(tsOverview())); await pending;
  assert.equal(model.overview, null); assert.equal(model.connecting, false);
  model.form.apiKey = "private-key-draft"; model.form.password = "private-password-draft";
  await state.logout();
  assert.equal(model.form.apiKey, ""); assert.equal(model.form.password, ""); assert.equal(model.settings.hasApiKey, false);
});

test("TS administration actually renders transport forms, operations and all five translations", async () => {
  const { createSSRApp } = await import("vue");
  const { renderToString } = await import("vue/server-renderer");
  const { default: Component } = await vite.ssrLoadModule("/src/components/admin/AdminTsAdmin.vue");
  await mount("/admin/ts-admin");
  const model = state.adminTsAdmin, readable = reactive(model);
  await readable.connectAndRefresh();
  for (const language of ["zh", "en", "de", "ru", "ja"]) {
    state.language = language;
    const html = await renderToString(createSSRApp(Component, { model, i18n: state.i18n, targetAddress: "voice.example", targetPort: "9987" }));
    assert.ok(html.includes("WebQuery")); assert.ok(html.includes("https://query.example"));
    assert.ok(html.includes("Selected user")); assert.ok(html.includes("Lobby"));
    assert.ok(!html.includes("undefined"));
    readable.beginAction("channel.create");
    const creating = await renderToString(createSSRApp(Component, { model, i18n: state.i18n, targetAddress: "voice.example", targetPort: "9987" }));
    assert.ok(creating.includes(state.i18n.tr("tsAdminChannelPassword")));
    assert.ok(!creating.includes(`<span>${state.i18n.tr("tsAdminPassword")}</span><input type="password" autocomplete="new-password" maxlength="512"`));
    readable.closeAction();
  }
  readable.form.transport = "ssh";
  let html = await renderToString(createSSRApp(Component, { model, i18n: state.i18n, targetAddress: "voice.example", targetPort: "9987" }));
  assert.ok(html.includes("SHA256:")); assert.ok(!html.includes('type="url"'));
  readable.form.transport = "web";
  await nextTurn();
  readable.beginAction("client.move", readable.overview.clients[0]);
  html = await renderToString(createSSRApp(Component, { model, i18n: state.i18n, targetAddress: "voice.example", targetPort: "9987" }));
  assert.ok(html.includes('class="operation-card ts-admin-editor"')); assert.ok(html.includes("Selected user"));
});

test("TS list warnings distinguish rate limits, permissions, timeouts and other read failures in every language", async () => {
  const { createSSRApp } = await import("vue");
  const { renderToString } = await import("vue/server-renderer");
  const { default: Component } = await vite.ssrLoadModule("/src/components/admin/AdminTsAdmin.vue");
  await mount("/admin/ts-admin");
  const model = reactive(state.adminTsAdmin);
  await model.connectAndRefresh();
  for (const code of ["TS_ADMIN_RATE_LIMITED", "TS_ADMIN_PERMISSION_DENIED", "TS_ADMIN_TIMEOUT", "TS_ADMIN_READ_FAILED"]) {
    model.overview.groupsAvailable = false; model.overview.bansAvailable = false;
    model.overview.groupsErrorCode = code; model.overview.bansErrorCode = code;
    for (const language of ["zh", "en", "de", "ru", "ja"]) {
      state.language = language;
      const html = await renderToString(createSSRApp(Component, { model: state.adminTsAdmin, i18n: state.i18n, targetAddress: "voice.example", targetPort: "9987" }));
      assert.equal(html.split(state.i18n.errorText(code)).length - 1, 2);
      assert.ok(!html.includes(state.i18n.tr("tsAdminRestricted")));
    }
  }
});


test("WebSpeak routes work in open and fixed modes without any TS management request", async () => {
  for (const accessMode of ["open", "fixed"]) {
    const paths = [];
    handler = (path, init) => {
      paths.push(path);
      assert.ok(!path.startsWith("/ts-admin/"), "WebSpeak pages must not depend on Query availability");
      return Promise.resolve(json(path === "/server" ? init.method === "PUT" ? { ok: true, settings: settings({ accessMode }) } : settings({ accessMode }) : defaults(path)));
    };
    await mount("/admin");
    for (const route of ["/admin/server", "/admin/operations", "/admin/skins", "/admin"]) {
      await router.push(route); await nextTurn();
    }
    serverModel.serverForm.siteName = "Saved without Query";
    await serverModel.saveServerSettings();
    assert.equal(state.errorMessage, "");
    assert.ok(paths.includes("/sessions")); assert.ok(paths.includes("/skins"));
    app.unmount(); app = null;
  }
});

test("TS target presentation uses saved settings rather than an unsaved WebSpeak draft", async () => {
  await mount("/admin/server");
  serverModel.serverForm.address = "unsaved.example";
  serverModel.serverForm.port = "9999";
  serverModel.serverForm.accessMode = "open";
  await router.push("/admin/ts-admin"); await nextTurn();
  assert.deepEqual(state.savedTsTarget, { address: "voice.example", port: "9987" });
  assert.equal(serverModel.savedSettings.accessMode, "fixed");
  assert.equal(serverModel.serverForm.address, "unsaved.example");
  handler = (path, init) => Promise.resolve(json(path === "/server" && init.method === "PUT"
    ? { ok: true, settings: settings({ target: "new-saved.example:9990", accessMode: "open" }) } : defaults(path)));
  await serverModel.saveServerSettings();
  assert.deepEqual(state.savedTsTarget, { address: "new-saved.example", port: "9990" });
  assert.equal(serverModel.savedSettings.accessMode, "open");
  serverModel.reset();
  assert.equal(serverModel.savedSettings, null);
});

test("TS management is optional and opening its page never connects automatically", async () => {
  const paths = [];
  handler = path => {
    paths.push(path);
    assert.notEqual(path, "/ts-admin/overview");
    return Promise.resolve(json(path === "/ts-admin/settings" ? tsSettings({ enabled: false }) : defaults(path)));
  };
  await mount("/admin/ts-admin");
  const model = reactive(state.adminTsAdmin);
  assert.ok(paths.includes("/ts-admin/settings"));
  await model.connectAndRefresh();
  assert.equal(model.overview, null);
  await router.push("/admin/operations"); await nextTurn();
  assert.equal(state.errorMessage, "");
});

test("unsaved TS connection changes block both reads and writes until saved", async () => {
  await mount("/admin/ts-admin");
  const model = reactive(state.adminTsAdmin);
  await model.connectAndRefresh();
  model.beginAction("client.kick", model.overview.clients[0]);
  model.form.webQueryUrl = "https://replacement.example";
  let calls = 0;
  handler = (path, init) => { calls++; return Promise.resolve(json(path === "/ts-admin/settings" && init.method === "PUT"
    ? { ok: true, settings: tsSettings({ webQueryUrl: "https://replacement.example", configurationRevision: "replacement" }) } : defaults(path))); };
  assert.equal(model.settingsDirty, true);
  await model.connectAndRefresh(); await model.runAction();
  assert.equal(calls, 0);
  await model.saveSettings();
  assert.equal(calls, 1); assert.equal(model.settingsDirty, false);
  assert.equal(model.overview, null); assert.equal(model.editor.action, "");
});

test("a changed saved TS connection discards an old overview and pending read", async () => {
  await mount("/admin/ts-admin");
  const model = reactive(state.adminTsAdmin), oldRead = deferred();
  await model.connectAndRefresh(); model.beginAction("channel.update", model.overview.channels[0]);
  handler = path => path === "/ts-admin/overview" ? oldRead.promise : Promise.resolve(json(tsSettings({ configurationRevision: "new-connection" })));
  const pending = model.connectAndRefresh();
  await model.loadSettings();
  assert.equal(model.overview, null); assert.equal(model.editor.action, "");
  oldRead.resolve(json(tsOverview())); await pending;
  assert.equal(model.overview, null); assert.equal(model.connecting, false);
});

test("settings and operations render explicit localized sections with valid deep links", async () => {
  const { createSSRApp } = await import("vue");
  const { renderToString } = await import("vue/server-renderer");
  const { default: Settings } = await vite.ssrLoadModule("/src/components/admin/AdminServerSettings.vue");
  const { default: Operations } = await vite.ssrLoadModule("/src/components/admin/AdminOperations.vue");
  const { adminOrganizationCopy } = await vite.ssrLoadModule("/src/i18n/admin-organization.ts");
  await mount("/admin/server?section=site");
  assert.equal(state.initialSection, "site");
  for (const language of ["zh", "en", "de", "ru", "ja"]) {
    state.language = language;
    const translations = adminOrganizationCopy[language];
    assert.deepEqual(Object.keys(translations).sort(), Object.keys(adminOrganizationCopy.zh).sort());
    const settingsHtml = await renderToString(createSSRApp(Settings, { model: state.serverSettings, i18n: state.i18n, initialSection: "site", welcomeLanguage: "zh" }));
    assert.ok(settingsHtml.includes(translations.adminSiteAnnouncement));
    assert.ok(settingsHtml.includes('data-admin-section="site"'));
    assert.ok(!settingsHtml.includes("undefined"));
    const operationsHtml = await renderToString(createSSRApp(Operations, { model: state.adminOperations, i18n: state.i18n, initialSection: "maintenance" }));
    assert.ok(operationsHtml.includes(translations.adminBrowserSessionsLead));
    assert.ok(operationsHtml.includes('data-admin-section="maintenance"'));
    assert.ok(!operationsHtml.includes("undefined"));
  }
});


test("loading saved custom Query ports never treats them as unsaved transport defaults", async () => {
  for (const [transport, queryPort] of [["ssh", 10011], ["tcp", 10022]]) {
    handler = path => Promise.resolve(json(path === "/ts-admin/settings" ? tsSettings({ transport, queryPort, username: "serveradmin", hasPassword: true }) : defaults(path)));
    await mount("/admin/ts-admin");
    const model = reactive(state.adminTsAdmin);
    assert.equal(model.form.queryPort, String(queryPort));
    assert.equal(model.settingsDirty, false);
    await model.connectAndRefresh();
    assert.ok(model.overview);
    app.unmount(); app = null;
  }
});


test("a pending TS settings load preserves the port selected for a newer transport draft", async () => {
  await mount("/admin/ts-admin");
  const model = reactive(state.adminTsAdmin), read = deferred();
  handler = () => read.promise;
  const pending = model.loadSettings();
  model.form.transport = "ssh";
  read.resolve(json(tsSettings({ queryPort: 10011 })));
  await pending;
  assert.equal(model.settings.queryPort, 10011);
  assert.equal(model.form.transport, "ssh");
  assert.equal(model.form.queryPort, "10022");
  assert.equal(model.settingsDirty, true);
});
