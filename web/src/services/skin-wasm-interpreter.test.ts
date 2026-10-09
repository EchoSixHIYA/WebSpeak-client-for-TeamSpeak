import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createSkinExtensionWasmCappedRunProbe,
  createSkinExtensionWasmInfiniteRunProbe,
  createSkinExtensionWasmPrefixByteImmediateProbe,
} from "../../test/skin-extension-wasm-fixture.js";

interface WasmiInterpreterExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  run: (modulePointer: number, moduleLength: number, statusPointer: number, statusLength: number,
    statusPermissionGranted: number, memoryMaximumPages: number, fuel: bigint) => bigint;
  last_error_code: () => number;
  last_guest_memory_bytes: () => number;
}

test("the fixed Wasmi artifact caps its own memory and stops guest execution at fuel", async () => {
  const artifact = await readFile(new URL("../../public/skin-wasm-interpreter.wasm", import.meta.url));
  const { instance } = await WebAssembly.instantiate(artifact);
  const runtime = instance.exports as unknown as WasmiInterpreterExports;

  function run(module: Uint8Array): { result: number; error: number; guestMemoryBytes: number } {
    const pointer = runtime.alloc(module.byteLength);
    assert.notEqual(pointer, 0, "the bounded interpreter should accept the small fixture");
    new Uint8Array(runtime.memory.buffer, pointer, module.byteLength).set(module);
    const result = runtime.run(pointer, module.byteLength, 0, 0, 0, 64, 10_000_000n);
    return {
      result: Number(result),
      error: runtime.last_error_code(),
      guestMemoryBytes: runtime.last_guest_memory_bytes(),
    };
  }

  assert.deepEqual(run(createSkinExtensionWasmPrefixByteImmediateProbe()), {
    result: 123,
    error: 0,
    guestMemoryBytes: 64 * 1024,
  });
  assert.equal(run(createSkinExtensionWasmInfiniteRunProbe()).error, 5, "the fuel budget must trap a non-returning module");
  assert.deepEqual(run(createSkinExtensionWasmCappedRunProbe()), {
    result: -1,
    error: 0,
    guestMemoryBytes: 4 * 1024 * 1024,
  });

  const memory = runtime.memory;
  const currentPages = memory.buffer.byteLength / (64 * 1024);
  memory.grow(1024 - currentPages);
  assert.equal(memory.buffer.byteLength, 64 * 1024 * 1024, "the interpreter container should reach its 64 MiB cap");
  assert.throws(() => memory.grow(1), RangeError, "the interpreter container must not grow beyond its cap");
});
