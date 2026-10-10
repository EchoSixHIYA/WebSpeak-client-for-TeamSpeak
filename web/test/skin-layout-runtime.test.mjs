import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
let runtime;
const savedGlobals = new Map();

function setGlobal(name, value) {
  if (!savedGlobals.has(name)) savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

class FakeElement {
  dataset = {};
  style = {
    values: new Map(),
    setProperty(name, value) { this.values.set(name, value); },
    removeProperty(name) { this.values.delete(name); },
  };
  parentElement = null;
  children = [];

  matches(selector) { return selector === "[data-ws-part]" && typeof this.dataset.wsPart === "string"; }
  querySelectorAll(selector) {
    if (selector !== "[data-ws-part]") return [];
    return this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]);
  }
  contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
}

function append(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

before(async () => {
  vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
  runtime = await vite.ssrLoadModule("/src/services/skin-layout-runtime.ts");
});

after(async () => {
  await vite?.close();
  for (const [name, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("registered interactive controls retain their minimum hit target without a layout override", () => {
  const root = new FakeElement();
  root.dataset.wsPage = "home";
  root.dataset.wsSkin = "test.skin";
  const connect = append(root, new FakeElement());
  connect.dataset.wsPart = "home.connect";
  const trusted = append(root, new FakeElement());
  trusted.dataset.wsPart = "home.security-note";
  const trustedControl = append(trusted, new FakeElement());
  trustedControl.dataset.wsPart = "control";
  trustedControl.dataset.wsControlKind = "button";
  const unknown = append(root, new FakeElement());
  unknown.dataset.wsPart = "home.unknown";

  setGlobal("document", { querySelectorAll: () => [root] });
  setGlobal("window", { matchMedia: () => ({ matches: false }) });
  runtime.refreshSkinLayout();

  assert.equal(connect.dataset.wsLayoutTouchTarget, "44", "a visible registered control must retain its 44px hit area by default");
  assert.equal(connect.dataset.wsLayoutActive, undefined, "the default hit-area rule must not create a user layout override");
  assert.equal(trustedControl.dataset.wsLayoutTouchTarget, undefined, "trusted host UI must remain outside the editable layout runtime");
  assert.equal(unknown.dataset.wsLayoutTouchTarget, undefined, "unregistered markup must not inherit layout control styles");
});

test("a local order override is applied only to the registered element", () => {
  const root = new FakeElement();
  root.dataset.wsPage = "home";
  root.dataset.wsSkin = "test.skin";
  const ordered = append(root, new FakeElement());
  ordered.dataset.wsPart = "home.header";
  const unrelated = append(root, new FakeElement());
  unrelated.dataset.wsPart = "home.content";
  const pluginRoot = append(root, new FakeElement());
  pluginRoot.dataset.wsPart = "skin.home.runtime_plugin_root_voice-toolbar";
  const collection = JSON.stringify({
    schemaVersion: 2,
    skins: {
      "test.skin": {
        schemaVersion: 1,
        pages: { home: { desktop: {
          "home.header": { order: -7 },
          "skin.home.runtime_plugin_root_voice-toolbar": { order: 3 },
        } } },
      },
    },
    recoveries: {},
  });
  setGlobal("localStorage", { getItem: () => collection, setItem: () => undefined });
  setGlobal("document", { querySelectorAll: () => [root] });
  setGlobal("window", { matchMedia: () => ({ matches: false }) });

  runtime.refreshSkinLayout();

  assert.equal(ordered.dataset.wsLayoutOrder, "true");
  assert.equal(ordered.style.values.get("--ws-layout-order"), "-7");
  assert.equal(unrelated.dataset.wsLayoutOrder, undefined);
  assert.equal(unrelated.style.values.has("--ws-layout-order"), false);
  assert.equal(pluginRoot.dataset.wsLayoutOrder, "true");
  assert.equal(pluginRoot.style.values.get("--ws-layout-order"), "3");
});

test("arbitrary component nodes accept local layout edits while interactive nodes keep a 44px target", () => {
  const root = new FakeElement();
  root.dataset.wsPage = "home";
  root.dataset.wsSkin = "test.skin";
  const content = append(root, new FakeElement());
  content.dataset.wsPart = "skin.home.demo-banner.node-root-0";
  const button = append(root, new FakeElement());
  button.dataset.wsPart = "skin.home.demo-banner.control-node-root-1";

  const collection = JSON.stringify({
    schemaVersion: 2,
    skins: {
      "test.skin": {
        schemaVersion: 1,
        pages: { home: { desktop: {
          "skin.home.demo-banner.node-root-0": { x: 24, y: 36, width: 280, height: 96, visible: false },
          "skin.home.demo-banner.control-node-root-1": { order: 5 },
        } } },
      },
    },
    recoveries: {},
  });
  setGlobal("localStorage", { getItem: () => collection, setItem: () => undefined });
  setGlobal("document", { querySelectorAll: () => [root] });
  setGlobal("window", { matchMedia: () => ({ matches: false }) });

  runtime.refreshSkinLayout();

  assert.equal(content.dataset.wsLayoutActive, "true");
  assert.equal(content.dataset.wsLayoutHidden, "true");
  assert.equal(content.style.values.get("--ws-layout-x"), "24px");
  assert.equal(content.style.values.get("--ws-layout-y"), "36px");
  assert.equal(content.style.values.get("--ws-layout-width"), "280px");
  assert.equal(content.style.values.get("--ws-layout-height"), "96px");
  assert.equal(button.style.values.get("--ws-layout-order"), "5");
  assert.equal(button.dataset.wsLayoutTouchTarget, "44");
});
