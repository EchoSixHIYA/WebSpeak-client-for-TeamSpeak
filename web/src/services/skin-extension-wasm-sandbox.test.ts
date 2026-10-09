import assert from "node:assert/strict";
import test from "node:test";
import { createSkinExtensionApproval, parseSkinExtensionManifest } from "../../../src/shared/skin-extension.js";
import {
  createSkinExtensionWasmSandboxPrototype,
  SKIN_EXTENSION_WASM_RUNTIME_ENABLED,
} from "./skin-extension-wasm-sandbox.js";
import { SKIN_EXTENSION_WASM_SOURCE_LIMIT } from "./skin-extension-wasm-policy.js";

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
