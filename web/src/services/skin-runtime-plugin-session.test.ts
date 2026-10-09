import assert from "node:assert/strict";
import test from "node:test";
import { parseSkinRuntimePluginDocument } from "../../../src/shared/skin-runtime-plugins.js";
import { createSkinRuntimePluginSession, SkinRuntimePluginSessionError } from "./skin-runtime-plugin-session.js";

const plugin = parseSkinRuntimePluginDocument({
  schemaVersion: 1,
  plugins: [{
    id: "voice-surface",
    name: "Voice surface",
    version: "1.0.0",
    apiVersion: 1,
    runtime: "wasm",
    page: "voice",
    mode: "surface",
    entry: "plugins/voice-surface/index.wasm",
    assets: [],
    permissions: ["ui.surface.replace"],
  }],
}).plugins[0];

function output(page = "voice", count = 1): string {
  return JSON.stringify({
    schemaVersion: 5,
    components: Array.from({ length: count }, (_, index) => ({
      id: `surface-${index}`,
      name: "Voice surface",
      page,
      accessibleName: "Voice workspace",
      state: {},
      root: { tag: "main", children: [{ text: "custom voice UI" }] },
    })),
  });
}

function sessionWithOutput(value: string, onError: (error: Error) => void = () => undefined) {
  return createSkinRuntimePluginSession({
    plugin,
    createRun: () => ({ result: Promise.resolve({ uiOutput: value }), close: () => undefined }),
    onError,
  });
}

test("runtime plugin session accepts one generated root for its declared surface", async () => {
  const session = sessionWithOutput(output());
  assert.equal(await session.start(), true);
  assert.equal(session.output, output());
  assert.equal(session.closed, false);
  session.close();
  assert.equal(session.closed, true);
});

test("runtime plugin session rejects output targeting a different page", async () => {
  const errors: Error[] = [];
  const session = sessionWithOutput(output("home"), (error) => errors.push(error));
  assert.equal(await session.start(), false);
  assert.equal(errors[0] instanceof SkinRuntimePluginSessionError, true);
  assert.equal((errors[0] as SkinRuntimePluginSessionError).code, "SKIN_RUNTIME_PLUGIN_PAGE_MISMATCH");
  assert.equal(session.output, null);
});

test("runtime surface plugins cannot emit competing roots", async () => {
  const errors: Error[] = [];
  const session = sessionWithOutput(output("voice", 2), (error) => errors.push(error));
  assert.equal(await session.start(), false);
  assert.ok(errors[0] instanceof SkinRuntimePluginSessionError);
  assert.equal((errors[0] as SkinRuntimePluginSessionError).code, "SKIN_RUNTIME_PLUGIN_SURFACE_OUTPUT_INVALID");
  assert.equal(session.output, null);
});
