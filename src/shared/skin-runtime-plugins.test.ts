import assert from "node:assert/strict";
import test from "node:test";
import {
  listSkinRuntimePluginFilePaths,
  parseSkinRuntimePluginDocument,
  parseSkinRuntimePluginJson,
  SkinRuntimePluginValidationError,
  SKIN_RUNTIME_PLUGIN_DOCUMENT_LIMIT_BYTES,
} from "./skin-runtime-plugins.js";

const plugin = {
  id: "voice-toolbar",
  name: "Voice toolbar",
  version: "1.2.3",
  apiVersion: 1,
  page: "voice",
  mode: "widget",
  entry: "plugins/voice-toolbar/index.js",
  style: "plugins/voice-toolbar/style.css",
  assets: ["plugins/voice-toolbar/assets/icon.png"],
  permissions: ["session.channels.read"],
};

function document(plugins: unknown[] = [plugin]): unknown {
  return { schemaVersion: 1, plugins };
}

test("v4 plugin descriptors accept bounded local files and freeze their parsed data", () => {
  const parsed = parseSkinRuntimePluginDocument(document() as never);
  assert.deepEqual(listSkinRuntimePluginFilePaths(parsed), [
    "plugins/voice-toolbar/index.js",
    "plugins/voice-toolbar/style.css",
    "plugins/voice-toolbar/assets/icon.png",
  ]);
  assert.equal(parsed.plugins[0].permissions[0], "session.channels.read");
  assert.equal(parsed.plugins[0].runtime, "javascript");
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.plugins) && Object.isFrozen(parsed.plugins[0]));
  assert.ok(Object.isFrozen(parsed.plugins[0].assets) && Object.isFrozen(parsed.plugins[0].permissions));
});

test("v4 plugin descriptors recognize Wasm entries and reject a runtime/file mismatch", () => {
  const wasm = parseSkinRuntimePluginDocument(document([{ ...plugin, runtime: "wasm", entry: "plugins/voice-toolbar/index.wasm" }]) as never);
  assert.equal(wasm.plugins[0].runtime, "wasm");
  assert.equal(wasm.plugins[0].entry, "plugins/voice-toolbar/index.wasm");
  assert.throws(
    () => parseSkinRuntimePluginDocument(document([{ ...plugin, runtime: "wasm" }]) as never),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_PATH_INVALID",
  );
  assert.throws(
    () => parseSkinRuntimePluginDocument(document([{ ...plugin, runtime: "native" }]) as never),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_RUNTIME_INVALID",
  );
  assert.throws(
    () => parseSkinRuntimePluginDocument(document([{ ...plugin, permissions: ["ui.surface.replace"] }]) as never),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_PERMISSION_INVALID",
  );
});

test("surface replacement is an explicit page-scoped plugin capability", () => {
  const surface = { ...plugin, mode: "surface", permissions: ["ui.surface.replace"] };
  const parsed = parseSkinRuntimePluginDocument(document([surface]) as never);
  assert.equal(parsed.plugins[0].mode, "surface");
  assert.throws(
    () => parseSkinRuntimePluginDocument(document([{ ...surface, permissions: [] }]) as never),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_PERMISSION_MISSING",
  );
  assert.throws(
    () => parseSkinRuntimePluginDocument(document([surface, { ...surface, id: "other-surface", entry: "plugins/other-surface/index.js", style: "plugins/other-surface/style.css", assets: ["plugins/other-surface/assets/icon.png"] }]) as never),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_SURFACE_DUPLICATE",
  );
});

test("runtime plugins can request explicit access to values from their own UI inputs", () => {
  const inputReader = parseSkinRuntimePluginDocument(document([{ ...plugin, permissions: ["ui.input.read"] }]) as never);
  assert.deepEqual(inputReader.plugins[0].permissions, ["ui.input.read"]);
});

test("runtime widget mount slots are page-scoped and included in the parsed descriptor", () => {
  const voiceWidget = parseSkinRuntimePluginDocument(document([{ ...plugin, mount: "voice.chat.before" }]) as never);
  assert.equal(voiceWidget.plugins[0].mount, "voice.chat.before");
  for (const value of [
    { ...plugin, mount: "voice.chat.before", page: "home" },
    { ...plugin, mount: "admin.header" },
    { ...plugin, mode: "surface", mount: "voice.workspace.overlay", permissions: ["ui.surface.replace"] },
  ]) {
    assert.throws(
      () => parseSkinRuntimePluginDocument(document([value]) as never),
      (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_MOUNT_INVALID",
    );
  }
});

test("v4 plugin descriptors reject unknown fields, path escape, wrong ownership, and executable assets", () => {
  const cases: Array<[unknown, string]> = [
    [{ ...plugin, arbitraryCodeHook: "run" }, "SKIN_RUNTIME_PLUGIN_FIELD_INVALID"],
    [{ ...plugin, entry: "plugins/voice-toolbar/../other.js" }, "SKIN_RUNTIME_PLUGIN_PATH_INVALID"],
    [{ ...plugin, entry: "plugins/other/index.js" }, "SKIN_RUNTIME_PLUGIN_PATH_INVALID"],
    [{ ...plugin, assets: ["plugins/voice-toolbar/assets/plugin.js"] }, "SKIN_RUNTIME_PLUGIN_ASSET_INVALID"],
    [{ ...plugin, assets: ["plugins/another/assets/icon.png"] }, "SKIN_RUNTIME_PLUGIN_ASSET_INVALID"],
    [{ ...plugin, permissions: ["network.fetch"] }, "SKIN_RUNTIME_PLUGIN_PERMISSION_INVALID"],
    [{ ...plugin, assets: [plugin.assets[0], plugin.assets[0]] }, "SKIN_RUNTIME_PLUGIN_ASSET_INVALID"],
  ];
  for (const [value, code] of cases) {
    assert.throws(
      () => parseSkinRuntimePluginDocument(document([value]) as never),
      (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === code,
    );
  }
  assert.throws(
    () => parseSkinRuntimePluginDocument(document([plugin, { ...plugin }]) as never),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_ID_INVALID",
  );
});

test("v4 plugin documents enforce schema, counts, and UTF-8 byte limits", () => {
  assert.throws(
    () => parseSkinRuntimePluginDocument({ schemaVersion: 2, plugins: [plugin] } as never),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_DOCUMENT_INVALID",
  );
  assert.throws(
    () => parseSkinRuntimePluginDocument({ schemaVersion: 1, plugins: [] } as never),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_DOCUMENT_INVALID",
  );
  assert.throws(
    () => parseSkinRuntimePluginJson(" ".repeat(SKIN_RUNTIME_PLUGIN_DOCUMENT_LIMIT_BYTES + 1)),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_DOCUMENT_SIZE",
  );
  assert.throws(
    () => parseSkinRuntimePluginJson("{"),
    (error: unknown) => error instanceof SkinRuntimePluginValidationError && error.code === "SKIN_RUNTIME_PLUGIN_DOCUMENT_INVALID",
  );
});
