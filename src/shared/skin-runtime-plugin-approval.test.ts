import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSkinRuntimePluginDigest,
  createSkinRuntimePluginApproval,
  isSkinRuntimePluginApproved,
  parseSkinRuntimePluginApproval,
  SkinRuntimePluginApprovalError,
} from "./skin-runtime-plugin-approval.js";
import { parseSkinRuntimePluginDocument, type SkinRuntimePlugin } from "./skin-runtime-plugins.js";

function plugin(overrides: Record<string, unknown> = {}): SkinRuntimePlugin {
  return parseSkinRuntimePluginDocument({
    schemaVersion: 1,
    plugins: [{
      id: "voice-toolbar",
      name: "Voice toolbar",
      version: "1.0.0",
      apiVersion: 1,
      page: "voice",
      mode: "widget",
      entry: "plugins/voice-toolbar/index.js",
      style: "plugins/voice-toolbar/style.css",
      assets: ["plugins/voice-toolbar/assets/icon.png"],
      permissions: ["session.status.read"],
      ...overrides,
    }],
  }).plugins[0];
}

function files(entry = "export default () => {};", style = ".toolbar { color: teal; }", icon = "icon-v1") {
  return {
    "plugins/voice-toolbar/index.js": new Blob([entry]),
    "plugins/voice-toolbar/style.css": new Blob([style]),
    "plugins/voice-toolbar/assets/icon.png": new Blob([icon]),
  };
}

test("plugin digest is deterministic and binds all declared source, style, assets, and descriptor fields", async () => {
  const definition = plugin();
  const packageFiles = files();
  const first = await computeSkinRuntimePluginDigest(definition, packageFiles);
  assert.equal(first, await computeSkinRuntimePluginDigest(definition, packageFiles));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, await computeSkinRuntimePluginDigest(definition, files("export default () => 1;")));
  assert.notEqual(first, await computeSkinRuntimePluginDigest(definition, files(undefined, ".toolbar { color: red; }")));
  assert.notEqual(first, await computeSkinRuntimePluginDigest(definition, files(undefined, undefined, "icon-v2")));
  assert.notEqual(first, await computeSkinRuntimePluginDigest(plugin({ permissions: [] }), packageFiles));
  assert.notEqual(first, await computeSkinRuntimePluginDigest(plugin({ mode: "surface", permissions: ["ui.surface.replace"] }), packageFiles));
});

test("plugin approval is pinned to skin and plugin versions, content digest, and permission policy", async () => {
  const definition = plugin();
  const digest = await computeSkinRuntimePluginDigest(definition, files());
  const approval = createSkinRuntimePluginApproval("community.sample", "2.0.0", definition, digest);
  assert.equal(isSkinRuntimePluginApproved(approval, "community.sample", "2.0.0", definition, digest), true);
  assert.equal(isSkinRuntimePluginApproved(approval, "community.sample", "2.0.0", definition, "0".repeat(64)), false);
  assert.equal(isSkinRuntimePluginApproved(approval, "community.sample", "2.1.0", definition, digest), false);
  assert.equal(isSkinRuntimePluginApproved(approval, "other.skin", "2.0.0", definition, digest), false);
  assert.equal(isSkinRuntimePluginApproved(approval, "community.sample", "2.0.0", plugin({ version: "1.1.0" }), digest), false);
  assert.deepEqual(parseSkinRuntimePluginApproval(approval), approval);

  const stalePolicy = parseSkinRuntimePluginApproval({
    ...approval,
    permissions: { "session.status.read": 99 },
  });
  assert.equal(isSkinRuntimePluginApproved(stalePolicy, "community.sample", "2.0.0", definition, digest), false);
});

test("plugin approval parser rejects malformed identities, digests, and unrecognized grants", async () => {
  const definition = plugin();
  const digest = await computeSkinRuntimePluginDigest(definition, files());
  const approval = createSkinRuntimePluginApproval("community.sample", "2.0.0", definition, digest);
  for (const candidate of [
    { ...approval, digest: "short" },
    { ...approval, pluginId: "../other" },
    { ...approval, permissions: { "filesystem.read": 1 } },
    { ...approval, extra: true },
  ]) {
    assert.throws(() => parseSkinRuntimePluginApproval(candidate), (error: unknown) =>
      error instanceof SkinRuntimePluginApprovalError && error.code === "SKIN_RUNTIME_PLUGIN_APPROVAL_INVALID");
  }
  assert.throws(() => createSkinRuntimePluginApproval("", "2.0.0", definition, digest), { code: "SKIN_RUNTIME_PLUGIN_APPROVAL_INVALID" });
});

test("plugin digest refuses missing declared files and packages beyond the ZIP expansion bound", async () => {
  const definition = plugin();
  await assert.rejects(
    computeSkinRuntimePluginDigest(definition, {}),
    (error: unknown) => error instanceof SkinRuntimePluginApprovalError && error.code === "SKIN_RUNTIME_PLUGIN_DIGEST_FILE_MISSING",
  );
  await assert.rejects(
    computeSkinRuntimePluginDigest(definition, {
      ...files(),
      "plugins/voice-toolbar/assets/icon.png": new Blob([new Uint8Array(50 * 1024 * 1024)]),
    }),
    (error: unknown) => error instanceof SkinRuntimePluginApprovalError && error.code === "SKIN_RUNTIME_PLUGIN_DIGEST_SIZE",
  );
});
