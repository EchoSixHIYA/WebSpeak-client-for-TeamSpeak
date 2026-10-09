import assert from "node:assert/strict";
import test from "node:test";
import {
  SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES,
  SKIN_EXTENSION_WASM_SOURCE_LIMIT,
  SkinExtensionWasmPolicyError,
  validateSkinExtensionWasmBytes,
  validateSkinExtensionWasmImportsAndExports,
} from "./skin-extension-wasm-policy.js";
import {
  createSkinExtensionWasmCappedRunProbe,
  createSkinExtensionWasmGcAllocationProbe,
  createSkinExtensionWasmInfiniteStartProbe,
  createSkinExtensionWasmInternalMemoryProbe,
  createSkinExtensionWasmInternalTableProbe,
  createSkinExtensionWasmOversizedElementVectorProbe,
  createSkinExtensionWasmOversizedFunctionBodyProbe,
  createSkinExtensionWasmOversizedLocalProbe,
  createSkinExtensionWasmOversizedSignatureProbe,
  createSkinExtensionWasmPrefixByteImmediateProbe,
  createSkinExtensionWasmStatusProbe,
  createSkinExtensionWasmTooManyFunctionsProbe,
  createSkinExtensionWasmUiInputProbe,
  createSkinExtensionWasmUiOutputProbe,
} from "../../test/skin-extension-wasm-fixture.js";

test("Wasm metadata policy accepts only a single run export and one bounded host memory", () => {
  const metadata = validateSkinExtensionWasmImportsAndExports(createSkinExtensionWasmPrefixByteImmediateProbe());
  assert.deepEqual(metadata, { usesSessionStatus: false, usesUiInput: false, usesUiOutput: false, memoryMaximumPages: SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES });
});

test("Wasm policy rejects module-defined memory or tables that bypass host limits", () => {
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmInternalMemoryProbe()), {
    code: "SKIN_EXTENSION_WASM_RESOURCE_DECLARATION",
  });
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmInternalTableProbe()), {
    code: "SKIN_EXTENSION_WASM_RESOURCE_DECLARATION",
  });
});

test("Wasm metadata parser rejects missing import memory, malformed sections, and oversized modules", () => {
  assert.throws(() => validateSkinExtensionWasmImportsAndExports(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])), {
    code: "SKIN_EXTENSION_WASM_IMPORT_INVALID",
  });
  assert.throws(() => validateSkinExtensionWasmBytes(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 127])), {
    code: "SKIN_EXTENSION_WASM_INVALID",
  });
  assert.throws(() => validateSkinExtensionWasmBytes(new Uint8Array(SKIN_EXTENSION_WASM_SOURCE_LIMIT + 1)), {
    code: "SKIN_EXTENSION_WASM_SIZE",
  });
  assert.ok(new SkinExtensionWasmPolicyError("test", "test") instanceof Error);
});

test("Wasm preflight caps function count and body size before the interpreter sees a module", () => {
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmTooManyFunctionsProbe()), {
    code: "SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT",
  });
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmOversizedFunctionBodyProbe()), {
    code: "SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT",
  });
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmInfiniteStartProbe()), {
    code: "SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE",
  });
});

test("Wasm preflight rejects GC allocation and bounds nested vectors before interpretation", () => {
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmGcAllocationProbe()), {
    code: "SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE",
  });
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmOversizedSignatureProbe()), {
    code: "SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT",
  });
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmOversizedLocalProbe()), {
    code: "SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT",
  });
  assert.throws(() => validateSkinExtensionWasmBytes(createSkinExtensionWasmOversizedElementVectorProbe()), {
    code: "SKIN_EXTENSION_WASM_RESOURCE_DECLARATION",
  });
});

test("Wasm import parsing reads the bounded permission contract without native compilation", () => {
  const status = createSkinExtensionWasmStatusProbe();
  assert.throws(() => validateSkinExtensionWasmImportsAndExports(status), {
    code: "SKIN_EXTENSION_WASM_PERMISSION_INVALID",
  });
  assert.deepEqual(validateSkinExtensionWasmImportsAndExports(status, ["session.status.read"]), {
    usesSessionStatus: true,
    usesUiInput: false,
    usesUiOutput: false,
    memoryMaximumPages: SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES,
  });
  assert.equal(validateSkinExtensionWasmImportsAndExports(createSkinExtensionWasmCappedRunProbe()).usesSessionStatus, false);
  assert.deepEqual(validateSkinExtensionWasmImportsAndExports(createSkinExtensionWasmUiOutputProbe()), {
    usesSessionStatus: false,
    usesUiInput: false,
    usesUiOutput: true,
    memoryMaximumPages: SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES,
  });
  assert.deepEqual(validateSkinExtensionWasmImportsAndExports(createSkinExtensionWasmUiInputProbe()), {
    usesSessionStatus: false,
    usesUiInput: true,
    usesUiOutput: true,
    memoryMaximumPages: SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES,
  });
});

test("Wasm instruction scanning distinguishes extension prefixes from signed integer bytes", () => {
  const bytes = createSkinExtensionWasmPrefixByteImmediateProbe();
  assert.doesNotThrow(() => validateSkinExtensionWasmBytes(bytes));
  assert.deepEqual(validateSkinExtensionWasmImportsAndExports(bytes), {
    usesSessionStatus: false,
    usesUiInput: false,
    usesUiOutput: false,
    memoryMaximumPages: SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES,
  });
});
