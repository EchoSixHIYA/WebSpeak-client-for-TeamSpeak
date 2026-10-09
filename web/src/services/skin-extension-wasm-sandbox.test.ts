import assert from "node:assert/strict";
import test from "node:test";
import { createSkinExtensionApproval, parseSkinExtensionManifest } from "../../../src/shared/skin-extension.js";
import {
  createSkinExtensionWasmSandboxPrototype,
  SKIN_EXTENSION_WASM_RUNTIME_ENABLED,
} from "./skin-extension-wasm-sandbox.js";
import { SKIN_EXTENSION_WASM_SOURCE_LIMIT } from "./skin-extension-wasm-policy.js";
import { parseSkinExtensionUiInput } from "../../../src/shared/skin-extension-ui-input.js";

const manifest = parseSkinExtensionManifest({
  schemaVersion: 1,
  packageType: "extension",
  id: "test.wasm-extension",
  name: "Wasm extension",
  version: "1.0.0",
  apiVersion: 1,
  permissions: [],
});

test("production Wasm execution remains disabled while the bounded runner is prototype-only", () => {
  assert.equal(SKIN_EXTENSION_WASM_RUNTIME_ENABLED, false);
  assert.throws(() => createSkinExtensionWasmSandboxPrototype({
    manifest,
    approval: createSkinExtensionApproval(manifest),
    wasmBytes: new Uint8Array(SKIN_EXTENSION_WASM_SOURCE_LIMIT + 1),
    readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
    prototypeOnly: true,
  }), { code: "SKIN_EXTENSION_WASM_SIZE" });
});

test("Wasm UI input preserves bounded local state and safe event data", () => {
  const parsed = parseSkinExtensionUiInput({
    schemaVersion: 1,
    state: { open: true, query: "team", count: 2 },
    event: { componentId: "server-rail", handlerId: "select-server", eventName: "click" },
  });
  assert.deepEqual({ ...parsed.state }, { open: true, query: "team", count: 2 });
  assert.deepEqual(parsed.event, { componentId: "server-rail", handlerId: "select-server", eventName: "click" });
});

test("Wasm UI input rejects unsupported fields, oversized text, and mismatched event values", () => {
  assert.throws(() => parseSkinExtensionUiInput({ schemaVersion: 1, state: {}, event: null, trusted: true }), {
    code: "SKIN_EXTENSION_UI_INPUT_INVALID",
  });
  assert.throws(() => parseSkinExtensionUiInput({ schemaVersion: 1, state: {}, event: {
    componentId: "server-rail", handlerId: "select-server", eventName: "click", value: "forged",
  } }), { code: "SKIN_EXTENSION_UI_INPUT_INVALID" });
  assert.throws(() => parseSkinExtensionUiInput({
    schemaVersion: 1,
    state: { query: "x".repeat(1_025) },
    event: null,
  }), { code: "SKIN_EXTENSION_UI_INPUT_INVALID" });
});
