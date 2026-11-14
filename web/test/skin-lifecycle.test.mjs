import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { effectScope, ref } from "vue";

let vite, runtime, catalog, authorization, handler, installed, writes, storage, elements, root, usePublicSkin, useWebClientPublicConfig, scope;
const { version: appVersion } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const globals = new Map();
function global(name, value) {
  if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const skin = id => ({ id, name: id, version: "1.0.0", minAppVersion: "0.2.6",
  css: `[data-ws-skin="${id}"] { --skin-test: blue; }`, assets: {}, installedAt: 1 });
const json = body => new Response(JSON.stringify(body));
class Element {
  dataset = {}; textContent = ""; id = ""; attributes = new Map();
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.get(String(name)) ?? null; }
  hasAttribute(name) { return this.attributes.has(String(name)); }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  append(el) { elements.set(el.id, el); }
  remove() { elements.delete(this.id); }
  matches() { return false; }
  querySelectorAll() { return []; }
}

before(async () => {
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL("../", import.meta.url)),
    plugins: [{ name: "controlled-skin-storage", enforce: "pre",
      resolveId(id) { if (id.endsWith("/local-persistence.js")) return "\0skin-storage"; },
      load(id) { if (id === "\0skin-storage") return `
        export const getInstalledSkin = (...args) => globalThis.skinStorage.get(...args);
        export const saveInstalledSkin = (...args) => globalThis.skinStorage.save(...args);
        export const listInstalledSkins = (...args) => globalThis.skinStorage.list(...args);
        export const loadLocalPreferences = (...args) => globalThis.skinStorage.preferences(...args);
        export const saveLocalPreferences = (...args) => globalThis.skinStorage.persist(...args);`; },
    }], server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  runtime = await vite.ssrLoadModule("/src/services/skin-runtime.ts");
  catalog = await vite.ssrLoadModule("/src/services/skin-catalog.ts");
  authorization = await vite.ssrLoadModule('/src/services/instance-authorization.ts');
  ({ usePublicSkin } = await vite.ssrLoadModule("/src/composables/usePublicSkin.ts"));
  ({ useWebClientPublicConfig } = await vite.ssrLoadModule("/src/composables/useWebClientPublicConfig.ts"));
});
beforeEach(async () => {
  installed = new Map(); writes = []; storage = new Map(); elements = new Map(); root = new Element();
  global("localStorage", { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) });
  global("document", { documentElement: new Element(), head: new Element(), body: new Element(),
    getElementById: id => elements.get(id) ?? null, createElement: () => new Element(), querySelectorAll: () => [root] });
  global("HTMLElement", Element);
  global("MutationObserver", class { observe() {} disconnect() {} });
  global("skinStorage", { get: async id => installed.get(id) ?? null,
    save: async value => installed.set(value.id, value), list: async () => [...installed.values()],
    preferences: async () => ({ schemaVersion: 1 }), persist: async value => writes.push(value) });
  handler = async () => json({ skins: [] });
  global("fetch", (...args) => handler(...args));
  // Existing lifecycle cases exercise explicitly authorized custom skins.
  authorization.setInstanceAuthorization(true);
  // A failed directory load keeps locally installed packages available.
  handler = async () => { throw new Error("offline"); };
  await catalog.listPublicSkins();
});
afterEach(() => { scope?.stop(); scope = undefined; runtime.clearCustomSkinStyle(); });
after(async () => {
  await vite?.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test('without instance consent, cached third-party packages are never read or installed', async () => {
  authorization.setInstanceAuthorization(false);
  let reads = 0;
  globalThis.skinStorage.get = async () => { reads++; return skin('community.kaak-voice'); };
  storage.set('webspeak:skin-choice', 'community.kaak-voice');
  storage.set('webspeak:active-skin', 'community.kaak-voice');
  const view = page(); await view.initialize(); await view.select('community.kaak-voice');
  assert.equal(reads, 0);
  assert.equal(view.activeSkinId.value, 'builtin.light');
  assert.equal(view.activeSkin.value, null);
  assert.deepEqual(view.catalogSkins.value.map(skin => skin.id), ['builtin.light', 'builtin.dark', 'community.illusia-voice']);
  assert.equal(view.skinLoadError.value, null, 'declining is not a skin loading error');
});

test('revoking consent cancels an in-flight custom load and removes an already active skin', async () => {
  installed.set('sample.a', skin('sample.a'));
  const view = page({ timeoutMs: 3000 }); await view.select('sample.a');
  assert.equal(elements.has('webspeak-active-custom-skin'), true);
  const read = deferred(); globalThis.skinStorage.get = () => read.promise;
  const loading = view.select('sample.b');
  authorization.setInstanceAuthorization(false);
  await loading; await nextTurn();
  read.resolve(skin('sample.b')); await nextTurn();
  assert.equal(view.activeSkin.value, null);
  assert.equal(view.activeSkinId.value, 'builtin.light');
  assert.equal(elements.has('webspeak-active-custom-skin'), false);
  assert.equal(elements.has('webspeak-active-custom-skin-base'), false);
});

test("a late custom activation cannot replace a newer built-in choice", async () => {
  const read = deferred(); globalThis.skinStorage.get = () => read.promise;
  const old = runtime.activateSkin("sample.a").catch(error => error);
  await runtime.activateSkin("builtin.dark");
  read.resolve(skin("sample.a")); await old;
  assert.equal(runtime.getStoredSkinId(), "builtin.dark");
  assert.equal(root.dataset.wsSkin, "builtin.dark");
  assert.equal(elements.has("webspeak-active-custom-skin"), false);
});
test("a late failed download cannot fall back over a newer custom skin", async () => {
  const download = deferred(); handler = () => download.promise;
  const old = runtime.activateSkin("sample.a").catch(error => error);
  await nextTurn(); installed.set("sample.b", skin("sample.b"));
  await runtime.activateSkin("sample.b");
  download.reject(new Error("old network failure")); await old;
  assert.equal(runtime.getStoredSkinId(), "sample.b");
  assert.equal(root.dataset.wsSkin, "sample.b");
});
test("clearing a skin invalidates an outstanding local read", async () => {
  const read = deferred(); globalThis.skinStorage.get = () => read.promise;
  const old = runtime.activateSkin("sample.a").catch(error => error);
  runtime.clearCustomSkinStyle(); read.resolve(skin("sample.a")); await old;
  assert.equal(elements.has("webspeak-active-custom-skin"), false);
  assert.equal(runtime.getStoredSkinId(), null);
});
test("aborting an activation prevents a late read from modifying the next page", async () => {
  const read = deferred(), owner = new AbortController();
  globalThis.skinStorage.get = () => read.promise;
  const old = runtime.activateSkin("sample.a", undefined, "0.2.6", { signal: owner.signal }).catch(error => error);
  owner.abort(); read.resolve(skin("sample.a")); await old;
  assert.equal(elements.has("webspeak-active-custom-skin"), false);
  assert.equal(runtime.getStoredSkinId(), null);
});
test("a stale directory response cannot enable skins disabled by a newer response", async () => {
  const response = deferred(); handler = () => response.promise;
  const old = catalog.listPublicSkins().catch(error => error);
  handler = async () => json({ skins: [], defaultSkinId: "builtin.dark" });
  await catalog.listPublicSkins();
  response.resolve(json({ skins: [{ ...skin("sample.a"), author: "test", license: "MIT", enabled: true }], defaultSkinId: "sample.a" }));
  await old;
  assert.equal(catalog.getPublicDefaultSkinId(), "builtin.dark");
  assert.equal(catalog.isPublicSkinEnabled("sample.a"), false);
});

function page(options = {}) {
  scope = effectScope();
  return scope.run(() => usePublicSkin({ timeoutMs: 40, ...options }));
}
test("a skin load deadline settles a hung local read and rejects its late result", async () => {
  const read = deferred(); globalThis.skinStorage.get = () => read.promise;
  await assert.rejects(runtime.activateSkin("sample.a", undefined, "0.2.6", { timeoutMs: 10 }), { name: "TimeoutError" });
  read.resolve(skin("sample.a")); await nextTurn();
  assert.equal(elements.has("webspeak-active-custom-skin"), false);
});
test("the directory deadline includes a hanging JSON body and aborts its request", async () => {
  const body = deferred(); let signal;
  handler = async (_url, init) => { signal = init.signal; return { ok: true, json: () => body.promise }; };
  await assert.rejects(catalog.listPublicSkins({ timeoutMs: 10 }), { name: "TimeoutError" });
  assert.equal(signal.aborted, true);
  body.resolve({ skins: [], defaultSkinId: "builtin.dark" }); await nextTurn();
  assert.equal(catalog.getPublicDefaultSkinId(), "builtin.light");
});
test("the package deadline includes a hanging archive body", async () => {
  const body = deferred(); let signal;
  handler = async (_url, init) => { signal = init.signal; return { ok: true, blob: () => body.promise }; };
  await assert.rejects(runtime.activateSkin("sample.a", undefined, "0.2.6", { timeoutMs: 10 }), { name: "TimeoutError" });
  assert.equal(signal.aborted, true);
  body.resolve(new Blob(["invalid"])); await nextTurn();
  assert.equal(runtime.getStoredSkinId(), null);
});
test("page state and saved preferences belong to the last selected skin", async () => {
  const read = deferred(), themeMode = ref("light");
  globalThis.skinStorage.get = () => read.promise;
  const view = page({ themeMode });
  const old = view.select("sample.a");
  await view.select("builtin.dark"); read.resolve(skin("sample.a")); await old;
  assert.equal(view.activeSkinId.value, "builtin.dark");
  assert.equal(view.activeSkin.value, null);
  assert.equal(themeMode.value, "dark");
  assert.deepEqual(writes.map(value => value.skinId), ["builtin.dark"]);
});
test("first paint becomes usable when the directory never answers", async () => {
  const response = deferred(); handler = () => response.promise;
  const view = page(); assert.equal(view.skinReady.value, false);
  await view.initialize();
  assert.equal(view.skinReady.value, true);
  assert.equal(view.activeSkinId.value, "builtin.light");
  await view.select("builtin.dark");
  response.resolve(json({ skins: [], defaultSkinId: "builtin.light" })); await nextTurn();
  assert.equal(view.activeSkinId.value, "builtin.dark");
  assert.equal(root.dataset.wsSkin, "builtin.dark");
});
test("a persisted custom choice cannot keep first paint hidden on a hung package", async () => {
  storage.set("webspeak:skin-choice", "sample.a");
  handler = async url => url === "/api/skins" ? json({ skins: [{ ...skin("sample.a"), author: "test", license: "MIT" }] }) : new Promise(() => {});
  const view = page(); await view.initialize();
  assert.equal(view.skinReady.value, true);
  assert.equal(view.activeSkinId.value, "builtin.light");
  assert.equal(storage.get("webspeak:skin-choice"), "sample.a", "fallback preserves the deliberate choice for a future retry");
});
test("disposing a page settles its pending skin without publishing or persisting", async () => {
  const read = deferred(); globalThis.skinStorage.get = () => read.promise;
  const view = page(), old = view.select("sample.a");
  scope.stop(); await old;
  await runtime.activateSkin("builtin.dark");
  read.resolve(skin("sample.a")); await nextTurn();
  assert.equal(runtime.getStoredSkinId(), "builtin.dark");
  assert.equal(view.activeSkin.value, null);
  assert.deepEqual(writes, []);
});
test("a manual choice wins over an unfinished page initialization", async () => {
  const response = deferred(); handler = () => response.promise;
  const view = page(), old = view.initialize();
  await view.select("builtin.dark");
  response.resolve(json({ skins: [], defaultSkinId: "builtin.light" })); await old;
  assert.equal(view.activeSkinId.value, "builtin.dark");
  assert.equal(view.skinReady.value, true);
  assert.deepEqual(writes.map(value => value.skinId), ["builtin.dark"]);
});
test("normal initialization uses the instance default and cached custom content", async () => {
  const item = { ...skin("sample.a"), author: "test", license: "MIT", contentData: { title: "custom" } };
  installed.set(item.id, item);
  handler = async () => json({ skins: [item], defaultSkinId: item.id });
  const themeMode = ref("system");
  const view = page({ timeoutMs: 1_000, themeMode }); await view.initialize();
  assert.equal(view.skinReady.value, true);
  assert.equal(view.activeSkinId.value, item.id);
  assert.deepEqual(view.activeSkin.value.contentData, item.contentData);
  assert.equal(themeMode.value, "system", "initializing a default custom skin must not override the saved system theme");
  assert.equal(storage.has("webspeak:skin-choice"), false);
  assert.equal(root.dataset.wsSkin, item.id);
});
test("first entry activates a compatible remembered skin before public config arrives", async () => {
  const item = { ...skin("sample.current"), minAppVersion: appVersion, author: "test", license: "MIT" };
  installed.set(item.id, item);
  storage.set("webspeak:skin-choice", item.id);
  const response = deferred();
  global("location", { search: "" });
  handler = async url => url === "/api/public-config" ? response.promise
    : json({ skins: [item], defaultSkinId: "builtin.light" });
  const config = useWebClientPublicConfig({ serverHost: ref(""), serverPort: ref("9987"),
    accelerationRelayId: ref(""), language: ref("en"), t: key => key });
  const loading = config.loadPublicConfig();
  const view = page({ timeoutMs: 1_000, appVersion: () => config.appVersion.value });
  try {
    await view.initialize();
    assert.equal(config.serverConfigLoading.value, true, "the config response is still pending");
    assert.equal(view.activeSkinId.value, item.id);
    assert.equal(view.skinLoadError.value, null);
    assert.equal(root.dataset.wsSkin, item.id);
    await view.select("builtin.dark");
    await view.select(item.id);
    assert.equal(view.activeSkinId.value, item.id, "initial entry and manual selection use the same version");
  } finally {
    response.resolve(json({ version: appVersion }));
    await loading;
  }
});
test("demo initialization uses the running build version without a public config provider", async () => {
  const item = { ...skin("sample.current"), minAppVersion: appVersion, author: "test", license: "MIT" };
  installed.set(item.id, item);
  handler = async () => json({ skins: [item], defaultSkinId: item.id });
  const view = page({ timeoutMs: 1_000 });
  await view.initialize();
  assert.equal(view.activeSkinId.value, item.id);
  assert.equal(view.skinLoadError.value, null);
});
test("using the running build version still rejects a skin requiring a newer runtime", async () => {
  const item = { ...skin("sample.future"), minAppVersion: "999.0.0", author: "test", license: "MIT" };
  installed.set(item.id, item);
  storage.set("webspeak:skin-choice", item.id);
  handler = async () => json({ skins: [item], defaultSkinId: item.id });
  const view = page({ timeoutMs: 1_000 });
  await view.initialize();
  assert.equal(view.activeSkinId.value, "builtin.light");
  assert.equal(view.skinLoadError.value.skinId, item.id);
  assert.equal(storage.get("webspeak:skin-choice"), item.id);
});
test("reset prevents outstanding choices from restoring cleared state", async () => {
  const read = deferred(); globalThis.skinStorage.get = () => read.promise;
  const view = page(), old = view.select("sample.a");
  handler = async () => json({ skins: [] });
  await view.reset(); read.resolve(skin("sample.a")); await old;
  assert.equal(view.activeSkin.value, null);
  assert.equal(view.activeSkinId.value, "builtin.light");
  assert.equal(elements.has("webspeak-active-custom-skin"), false);
  assert.deepEqual(writes, []);
});

test("a failed skin choice falls back, exposes recovery, and remembers the built-in selection", async () => {
  handler = async url => url === "/api/skins"
    ? json({ skins: [{ ...skin("sample.a"), author: "test", license: "MIT" }] })
    : { ok: false, status: 503 };
  await catalog.listPublicSkins();
  const view = page();

  await view.select("sample.a");
  assert.equal(view.activeSkinId.value, "builtin.light");
  assert.deepEqual(view.skinLoadError.value, { skinId: "sample.a" });

  await view.switchToBuiltInAfterLoadError();
  assert.equal(view.skinLoadError.value, null);
  assert.equal(storage.get("webspeak:skin-choice"), "builtin.light");
  assert.equal(runtime.getStoredSkinId(), "builtin.light");
});

test("an already aborted caller cannot cancel the next page's activation", async () => {
  const read = deferred(); globalThis.skinStorage.get = () => read.promise;
  const current = runtime.activateSkin("sample.b");
  const retired = new AbortController(); retired.abort();
  await assert.rejects(runtime.activateSkin("sample.a", undefined, undefined, { signal: retired.signal }), { name: "AbortError" });
  read.resolve(skin("sample.b")); await current;
  assert.equal(runtime.getStoredSkinId(), "sample.b");
});
test("a failed DOM installation releases the candidate's compiled asset URLs", async () => {
  const original = URL.revokeObjectURL, revoked = [];
  URL.revokeObjectURL = value => { revoked.push(value); original(value); };
  installed.set("sample.a", { ...skin("sample.a"), css: 'a { background-image: url("wskin-asset:art.png"); }', assets: { "art.png": new Blob(["asset"]) } });
  const append = document.head.append;
  document.head.append = element => {
    if (element.id === "webspeak-active-custom-skin") throw new Error("simulated DOM failure");
    append(element);
  };
  try {
    assert.equal(await runtime.activateSkin("sample.a"), null);
    assert.equal(revoked.length, 1);
    assert.equal(elements.has("webspeak-active-custom-skin-base"), false);
    assert.equal(runtime.getStoredSkinId(), "builtin.light");
  } finally { URL.revokeObjectURL = original; }
});
