import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createSkinExtensionWasmCappedRunProbe,
  createSkinExtensionWasmInfiniteRunProbe,
  createSkinExtensionWasmPrefixByteImmediateProbe,
  createSkinExtensionWasmUiInputProbe,
  createSkinExtensionWasmUiOutputProbe,
} from "../../test/skin-extension-wasm-fixture.js";

interface WasmiInterpreterExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  run: (modulePointer: number, moduleLength: number, statusPointer: number, statusLength: number,
    uiInputPointer: number, uiInputLength: number, statusPermissionGranted: number,
    memoryMaximumPages: number, fuel: bigint) => bigint;
  last_error_code: () => number;
  last_ui_input_read_count: () => number;
  last_guest_memory_bytes: () => number;
  last_ui_output_pointer: () => number;
  last_ui_output_length: () => number;
}

test("the fixed Wasmi artifact caps its own memory and stops guest execution at fuel", async () => {
  const artifact = await readFile(new URL("../../public/skin-wasm-interpreter.wasm", import.meta.url));
  const { instance } = await WebAssembly.instantiate(artifact);
  const runtime = instance.exports as unknown as WasmiInterpreterExports;

  function run(module: Uint8Array, input = '{"schemaVersion":1,"state":{},"event":null}'):
    { result: number; error: number; guestMemoryBytes: number; uiInputReadCount: number; uiOutput: string | null } {
    const inputBytes = new TextEncoder().encode(input);
    const pointer = runtime.alloc(module.byteLength + inputBytes.byteLength);
    assert.notEqual(pointer, 0, "the bounded interpreter should accept the small fixture");
    new Uint8Array(runtime.memory.buffer, pointer, module.byteLength).set(module);
    const inputPointer = pointer + module.byteLength;
    new Uint8Array(runtime.memory.buffer, inputPointer, inputBytes.byteLength).set(inputBytes);
    const result = runtime.run(pointer, module.byteLength, 0, 0, inputPointer, inputBytes.byteLength, 0, 64, 10_000_000n);
    return {
      result: Number(result),
      error: runtime.last_error_code(),
      guestMemoryBytes: runtime.last_guest_memory_bytes(),
      uiInputReadCount: runtime.last_ui_input_read_count(),
      uiOutput: runtime.last_ui_output_length() === 0
        ? null
        : new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(
          runtime.memory.buffer,
          runtime.last_ui_output_pointer(),
          runtime.last_ui_output_length(),
        )),
    };
  }

  assert.deepEqual(run(createSkinExtensionWasmPrefixByteImmediateProbe()), {
    result: 123,
    error: 0,
    guestMemoryBytes: 64 * 1024,
    uiInputReadCount: 0,
    uiOutput: null,
  });
  assert.equal(run(createSkinExtensionWasmInfiniteRunProbe()).error, 5, "the fuel budget must trap a non-returning module");
  assert.deepEqual(run(createSkinExtensionWasmCappedRunProbe()), {
    result: -1,
    error: 0,
    guestMemoryBytes: 4 * 1024 * 1024,
    uiInputReadCount: 0,
    uiOutput: null,
  });

  assert.deepEqual(run(createSkinExtensionWasmUiOutputProbe()), {
    result: 7,
    error: 0,
    guestMemoryBytes: 64 * 1024,
    uiInputReadCount: 0,
    uiOutput: '{"type":"root"}',
  });
  const uiInput = '{"schemaVersion":1,"state":{"open":true},"event":{"componentId":"rail","handlerId":"toggle","eventName":"click"}}';
  assert.deepEqual(run(createSkinExtensionWasmUiInputProbe(), uiInput), {
    result: 7,
    error: 0,
    guestMemoryBytes: 64 * 1024,
    uiInputReadCount: 1,
    uiOutput: uiInput,
  });
  assert.equal(run(createSkinExtensionWasmUiInputProbe(true), uiInput).error, 13,
    "the host must reject a second UI input read in one guest invocation");
  assert.equal(run(createSkinExtensionWasmUiOutputProbe("x".repeat(16 * 1024 + 1))).uiOutput?.length, 16 * 1024 + 1,
    "the interpreter must accept payloads larger than the previous 16 KiB cap");
  assert.equal(run(createSkinExtensionWasmUiOutputProbe('{"type":"root"}', true)).error, 12,
    "the interpreter must reject more than one UI payload per execution");

  const memory = runtime.memory;
  const currentPages = memory.buffer.byteLength / (64 * 1024);
  memory.grow(1024 - currentPages);
  assert.equal(memory.buffer.byteLength, 64 * 1024 * 1024, "the interpreter container should reach its 64 MiB cap");
  assert.throws(() => memory.grow(1), RangeError, "the interpreter container must not grow beyond its cap");
});
