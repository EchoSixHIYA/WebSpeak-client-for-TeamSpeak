import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  getSkinLayoutComponents,
  getSkinLayoutComponent,
  parseSkinLayoutJson,
  SKIN_LAYOUT_COMPONENTS,
  validateSkinLayout,
  canEditSkinLayoutComponent,
} from "./skin-layout.js";

async function vueSources(directory: URL): Promise<string[]> {
  const files = (await readdir(directory, { recursive: true })).filter((file) => file.endsWith(".vue"));
  return Promise.all(files.map((file) => readFile(new URL(file.replaceAll("\\", "/"), directory), "utf8")));
}

test("the stable layout registry covers public skin hooks and excludes the admin console", async () => {
  const [webClient, demo, sharedComponents, skinSwitcher, languageSwitcher, admin, adminComponents] = await Promise.all([
    readFile(new URL("../../web/src/views/WebClient.vue", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/views/DemoView.vue", import.meta.url), "utf8"),
    vueSources(new URL("../../web/src/components/web-client/", import.meta.url)),
    readFile(new URL("../../web/src/components/SkinSwitcher.vue", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/components/LanguageSwitcher.vue", import.meta.url), "utf8"),
    readFile(new URL("../../web/src/views/AdminView.vue", import.meta.url), "utf8"),
    vueSources(new URL("../../web/src/components/admin/", import.meta.url)),
  ]);
  const publicSource = [webClient, demo, ...sharedComponents, skinSwitcher, languageSwitcher].join("\n");
  const publicParts = new Set([...publicSource.matchAll(/data-ws-part="([^"]+)"/g)].map((match) => match[1]));
  const interactiveParts = new Set<string>();
  for (const match of publicSource.matchAll(/<[A-Za-z][\w.-]*\b[^>]*>/gs)) {
    const attributes = match[0];
    const part = attributes.match(/\bdata-ws-part="([^"]+)"/)?.[1];
    if (!part) continue;
    const isNativeControl = /^<(?:button|a|input|select|textarea)\b/i.test(attributes);
    const hasButtonRole = /\brole="button"/.test(attributes);
    const keyboardAction = /@keydown\.(?:enter|space)\b/.test(attributes);
    const dragAction = /@(?:dragstart|dragover|dragleave|drop)\b|:draggable=/.test(attributes);
    if (isNativeControl || hasButtonRole || keyboardAction || dragAction) interactiveParts.add(part);
  }
  const registered = new Set(SKIN_LAYOUT_COMPONENTS.map((component) => component.selectorPart));
  for (const part of publicParts) assert.ok(registered.has(part), "Unregistered public layout hook: " + part);
  const micStatus = getSkinLayoutComponent("voice.member.mic-status", "voice");
  assert.equal(micStatus?.category, "core");
  assert.equal(micStatus?.editable, true);
  assert.ok(micStatus?.layoutModes.includes("visibility"));
  for (const part of interactiveParts) {
    const component = SKIN_LAYOUT_COMPONENTS.find((entry) => entry.id === part);
    assert.ok(component, "Interactive public hook must have its own component metadata: " + part);
    assert.ok(component.minTouchTarget >= 44, "Interactive public hook needs a 44px touch target: " + part);
    assert.ok(component.minWidth >= 44 && component.minHeight >= 44, "Interactive public hook needs bounded minimum dimensions: " + part);
    assert.ok(component.minScale >= 1, "Interactive public hook must not scale below its natural hit target: " + part);
  }
  assert.match(publicSource, /data-ws-part="demo\.voice-card"[\s\S]*?role="button"[\s\S]*?tabindex="0"[\s\S]*?@keydown\.enter[\s\S]*?@keydown\.space/);
  assert.doesNotMatch([admin, ...adminComponents].join("\n"), /ws-skin-root|data-ws-page=/);
  assert.ok(SKIN_LAYOUT_COMPONENTS.every((component) => !component.id.startsWith("admin.")));
});

test("valid layouts accept only bounded positions and safe visual tokens", () => {
  const layout = validateSkinLayout({
    schemaVersion: 1,
    pages: {
      home: {
        desktop: {
          "home.header": { x: -120, y: 40, scale: 1.25, order: -2, visible: true, foreground: "#aabbcc", radius: 16 },
          "control.button": { background: "#010203", border: "#ffffff" },
        },
        mobile: { "home.join-card": { x: 8, scale: 0.9 } },
        tablet: { "home.join-card": { width: 720, height: 460 } },
      },
    },
  });
  assert.equal(layout.pages.home?.desktop?.["home.header"]?.x, -120);
  assert.equal(layout.pages.home?.desktop?.["home.header"]?.foreground, "#aabbcc");
  assert.equal(layout.pages.home?.desktop?.["home.header"]?.order, -2);
  assert.equal(layout.pages.home?.tablet?.["home.join-card"]?.width, 720);
  assert.equal(getSkinLayoutComponents("home").some((component) => component.id === "home.join-card"), true);
  assert.equal(getSkinLayoutComponents("voice").some((component) => component.id === "home.join-card"), false);
});

test("skin-authored component roots and nodes become independently editable layout parts", () => {
  const maxRuntimeNodeId = `skin.voice.runtime_plugin_${"p".repeat(64)}__${"c".repeat(64)}.control-node-root-0`;
  const dynamicIds = [
    "skin.voice.toolbar",
    "skin.voice.toolbar.node-root",
    "skin.voice.toolbar.part-chat-list",
    "skin.voice.toolbar.control-node-root-0",
    "skin.voice.runtime_plugin_root_voice-toolbar",
    "skin.voice.runtime_plugin_voice-surface__voice-ui",
    "skin.voice.runtime_plugin_voice-surface__voice-ui.node-root",
    "skin.voice.runtime_plugin_voice-surface__voice-ui.part-chat-list",
    "skin.voice.runtime_plugin_voice-surface__voice-ui.control-part-join",
    maxRuntimeNodeId,
  ];
  const components = getSkinLayoutComponents("voice", dynamicIds);
  assert.deepEqual(components.filter((component) => dynamicIds.includes(component.id)).map((component) => component.id), dynamicIds);
  assert.ok(dynamicIds.every((id) => getSkinLayoutComponent(id, "voice")?.editable));
  assert.equal(getSkinLayoutComponent("skin.home.toolbar", "voice"), undefined);
  assert.equal(getSkinLayoutComponent("skin.voice.toolbar.node-root-onclick", "voice"), undefined);

  const layout = validateSkinLayout({
    schemaVersion: 1,
    pages: { voice: { desktop: {
      "skin.voice.toolbar": { x: 18, y: 12, visible: true },
      "skin.voice.toolbar.node-root": { width: 720 },
      "skin.voice.toolbar.part-chat-list": { visible: false },
      "skin.voice.toolbar.control-node-root-0": { scale: 1, width: 60, height: 48 },
      "skin.voice.runtime_plugin_root_voice-toolbar": { order: 2 },
      "skin.voice.runtime_plugin_voice-surface__voice-ui": { width: 800 },
      "skin.voice.runtime_plugin_voice-surface__voice-ui.part-chat-list": { visible: false },
      "skin.voice.runtime_plugin_voice-surface__voice-ui.control-part-join": { width: 60, height: 48 },
    } } },
  });
  assert.equal(layout.pages.voice?.desktop?.["skin.voice.toolbar.part-chat-list"]?.visible, false);
  assert.equal(layout.pages.voice?.desktop?.["skin.voice.runtime_plugin_root_voice-toolbar"]?.order, 2);
  assert.equal(layout.pages.voice?.desktop?.["skin.voice.runtime_plugin_voice-surface__voice-ui"]?.width, 800);
  assert.equal(layout.pages.voice?.desktop?.["skin.voice.runtime_plugin_voice-surface__voice-ui.part-chat-list"]?.visible, false);
  assert.equal(getSkinLayoutComponent("skin.voice.runtime_plugin_voice-surface__voice-ui.control-part-join")?.minTouchTarget, 44);
  assert.equal(getSkinLayoutComponent(maxRuntimeNodeId)?.minTouchTarget, 44);
  assert.equal(getSkinLayoutComponent("skin.voice.toolbar.control-node-root-0")?.minTouchTarget, 44);
  assert.ok(getSkinLayoutComponent("skin.voice.toolbar.control-node-root-0")!.minScale >= 1);

  assert.throws(() => validateSkinLayout({
    schemaVersion: 1,
    pages: { voice: { desktop: { "skin.home.toolbar": { x: 0 } } } },
  }));
  assert.throws(() => validateSkinLayout({
    schemaVersion: 1,
    pages: { voice: { desktop: { "skin.voice.toolbar.control-node-root-0": { scale: 0.8 } } } },
  }));
});

test("layout validation fails closed for unknown pages, components, trusted notices, fields, and values", () => {
  const invalidValues: unknown[] = [
    { schemaVersion: 2, pages: {} },
    { schemaVersion: 1, pages: { admin: { desktop: {} } } },
    { schemaVersion: 1, pages: { home: { desktop: { "home.not-registered": { x: 0 } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { "home.security-note": { visible: false } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { "home.security-note": { order: -1 } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { app: { visible: false } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { "home.header": { position: "fixed" } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { "home.header": { x: 2001 } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { "home.header": { order: 101 } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { "home.header": { width: 8 } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { "voice.connection-status": { visible: false } } } } },
    { schemaVersion: 1, pages: { home: { desktop: { "home.header": { background: "url(https://example.invalid)" } } } } },
  ];
  for (const invalid of invalidValues) assert.throws(() => validateSkinLayout(invalid));
});

test("registered components carry accessibility, responsive, purpose, and data-scope metadata", () => {
  assert.ok(SKIN_LAYOUT_COMPONENTS.length > 100);
  for (const component of SKIN_LAYOUT_COMPONENTS) {
    assert.ok(component.name.length > 0);
    assert.notEqual(component.name, component.id, "registry names must be readable metadata rather than the ID repeated");
    assert.ok(component.purpose.length > 0);
    assert.ok(["core", "optional", "trusted-chrome"].includes(component.category));
    if (component.editable) {
      assert.deepEqual(component.allowedContainers, ["app"]);
      assert.deepEqual(component.layoutModes, ["position", "size", "visibility", "appearance", "order"]);
      assert.ok(component.minWidth > 0 && component.maxWidth >= component.minWidth);
      assert.ok(component.minHeight > 0 && component.maxHeight >= component.minHeight);
      assert.ok(component.minScale > 0 && component.maxScale >= component.minScale);
      assert.ok(component.allowedStyleTokens.length > 0);
    } else {
      assert.deepEqual(component.allowedContainers, []);
      assert.deepEqual(component.layoutModes, []);
      assert.deepEqual(component.allowedStyleTokens, []);
    }
    assert.equal(component.keyboardBehavior, "host-native");
    assert.equal(component.focusOrder, "host-dom");
    assert.equal(component.accessibleNamePolicy, "preserve-host-name");
    assert.ok(component.narrowScreenBehavior.length > 0);
    assert.ok(component.dataSensitivity.length > 0);
  }
  assert.equal(SKIN_LAYOUT_COMPONENTS.find((component) => component.id === "home.connect")?.minTouchTarget, 44);
  assert.equal(SKIN_LAYOUT_COMPONENTS.find((component) => component.id === "control.range")?.minTouchTarget, 44);
  assert.equal(SKIN_LAYOUT_COMPONENTS.find((component) => component.id === "control.checkbox")?.minTouchTarget, 44);
  assert.equal(SKIN_LAYOUT_COMPONENTS.find((component) => component.id === "home.feature")?.category, "optional");
  assert.equal(SKIN_LAYOUT_COMPONENTS.find((component) => component.id === "home.security-note")?.category, "trusted-chrome");
  assert.equal(SKIN_LAYOUT_COMPONENTS.find((component) => component.id === "home.identity-import.security")?.dataSensitivity, "identity");
  assert.equal(SKIN_LAYOUT_COMPONENTS.find((component) => component.id === "demo.voice-card")?.minTouchTarget, 44);
});

test("trusted host components cannot be changed through a nested generic control", () => {
  assert.equal(canEditSkinLayoutComponent("control.button", "home", ["home.form"]), true);
  assert.equal(canEditSkinLayoutComponent("control.button", "home", ["home.identity-import.security"]), false);
  assert.equal(canEditSkinLayoutComponent("control.button", "voice", ["voice.screen-share-error"]), false);
  assert.equal(canEditSkinLayoutComponent("home.security-note", "home"), false);
});

test("touch controls cannot be shrunk below their registered hit-target bounds", () => {
  assert.throws(() => validateSkinLayout({
    schemaVersion: 1,
    pages: { home: { desktop: { "home.connect": { scale: 0.75 } } } },
  }));
  assert.throws(() => validateSkinLayout({
    schemaVersion: 1,
    pages: { home: { desktop: { "control.button": { width: 20 } } } },
  }));
  assert.equal(validateSkinLayout({
    schemaVersion: 1,
    pages: { home: { desktop: { "home.feature": { width: 20, scale: 0.5 } } } },
  }).pages.home?.desktop?.["home.feature"]?.width, 20);
});

test("layout JSON parsing rejects malformed and oversized documents", () => {
  assert.throws(() => parseSkinLayoutJson("{"));
  assert.throws(() => parseSkinLayoutJson(" ".repeat(128 * 1024 + 1)));
  assert.deepEqual(parseSkinLayoutJson('{"schemaVersion":1,"pages":{}}'), { schemaVersion: 1, pages: {} });
});
