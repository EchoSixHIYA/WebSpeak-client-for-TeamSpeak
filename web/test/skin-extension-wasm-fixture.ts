function section(id: number, payload: number[]): number[] {
  return [id, ...unsignedLeb128(payload.length), ...payload];
}

function unsignedLeb128(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return bytes;
}

function signedLeb128(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value | 0;
  let more = true;
  while (more) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    const signBitSet = (byte & 0x40) !== 0;
    more = !((remaining === 0 && !signBitSet) || (remaining === -1 && signBitSet));
    if (more) byte |= 0x80;
    bytes.push(byte);
  }
  return bytes;
}

function name(value: string): number[] {
  const bytes = Array.from(value, (character) => character.charCodeAt(0));
  return [bytes.length, ...bytes];
}

function singleRunModule(body: number[], withStatusImport = false): Uint8Array {
  const functionTypes = withStatusImport
    ? [2, 0x60, 2, 0x7f, 0x7f, 1, 0x7f, 0x60, 0, 1, 0x7f]
    : [1, 0x60, 0, 1, 0x7f];
  const imports = [
    1 + Number(withStatusImport),
    ...name("env"), ...name("memory"), 0x02, 0x01, 1, 64,
    ...(withStatusImport ? [...name("env"), ...name("session_status_read"), 0x00, 0] : []),
  ];
  const runType = withStatusImport ? 1 : 0;
  const runFunctionIndex = withStatusImport ? 1 : 0;
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, functionTypes),
    ...section(2, imports),
    ...section(3, [1, runType]),
    ...section(7, [1, ...name("run"), 0, runFunctionIndex]),
    ...section(10, [1, body.length, ...body]),
  ]);
}

/** Grows the host-provided memory to 64 pages, then proves the next page is denied. */
export function createSkinExtensionWasmCappedRunProbe(): Uint8Array {
  return singleRunModule([0, 0x41, 0x3f, 0x40, 0x00, 0x1a, 0x41, 0x01, 0x40, 0x00, 0x0b]);
}

/** Reads the permission-gated status snapshot into bounded linear memory and returns its byte length. */
export function createSkinExtensionWasmStatusProbe(): Uint8Array {
  return singleRunModule([0, 0x41, 0x00, 0x41, 0x80, 0x02, 0x10, 0x00, 0x0b], true);
}

/** Emits one bounded UTF-8 JSON string through the host-owned UI output bridge. */
export function createSkinExtensionWasmUiOutputProbe(output = '{"type":"root"}', emitTwice = false): Uint8Array {
  const outputBytes = Array.from(new TextEncoder().encode(output));
  const outputPointer = 16;
  const emitOutput = [
    0x41, ...signedLeb128(outputPointer),
    0x41, ...signedLeb128(outputBytes.length),
    0x10, 0,
    0x1a,
  ];
  const body = [
    0,
    ...emitOutput,
    ...(emitTwice ? emitOutput : []),
    0x41, 0x07,
    0x0b,
  ];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [2, 0x60, 2, 0x7f, 0x7f, 1, 0x7f, 0x60, 0, 1, 0x7f]),
    ...section(2, [
      2,
      ...name("env"), ...name("memory"), 0x02, 0x01, 1, 64,
      ...name("env"), ...name("ui_emit_json"), 0x00, 0,
    ]),
    ...section(3, [1, 1]),
    ...section(7, [1, ...name("run"), 0, 1]),
    ...section(10, [1, body.length, ...body]),
    ...section(11, [1, 0, 0x41, outputPointer, 0x0b, ...unsignedLeb128(outputBytes.length), ...outputBytes]),
  ]);
}

/** Reads the host-provided bounded local state/event JSON once and echoes it through UI output. */
export function createSkinExtensionWasmUiInputProbe(readTwice = false): Uint8Array {
  const readInput = [
    0x41, 0,
    0x41, ...signedLeb128(8 * 1024),
    0x10, 0,
  ];
  const body = [
    1, 1, 0x7f, // one i32 local for input length
    ...readInput,
    0x21, 0, // local.set 0
    ...(readTwice ? [...readInput, 0x1a] : []),
    0x41, 0,
    0x20, 0,
    0x10, 1, // ui_emit_json(0, input_length)
    0x1a,
    0x41, 7,
    0x0b,
  ];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [2, 0x60, 2, 0x7f, 0x7f, 1, 0x7f, 0x60, 0, 1, 0x7f]),
    ...section(2, [
      3,
      ...name("env"), ...name("memory"), 0x02, 0x01, 1, 64,
      ...name("env"), ...name("ui_input_read"), 0x00, 0,
      ...name("env"), ...name("ui_emit_json"), 0x00, 0,
    ]),
    ...section(3, [1, 1]),
    ...section(7, [1, ...name("run"), 0, 2]),
    ...section(10, [1, body.length, ...body]),
  ]);
}

/** Tries to alter the copied snapshot before returning; host results must remain host-owned. */
export function createSkinExtensionWasmStatusMutationProbe(): Uint8Array {
  return singleRunModule([1, 1, 0x7f, 0x41, 0x00, 0x41, 0x80, 0x02, 0x10, 0x00,
    0x21, 0x00, 0x41, 0x00, 0x41, 0x00, 0x3a, 0x00, 0x00, 0x20, 0x00, 0x0b], true);
}

/** Runs forever after the trusted worker has announced that execution began. */
export function createSkinExtensionWasmInfiniteRunProbe(): Uint8Array {
  // Mark the path after the endless loop unreachable so the i32-returning
  // function remains valid without adding a reachable fallthrough value.
  return singleRunModule([0, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x00, 0x0b]);
}

/** Hangs inside the Wasm start section, before the worker can announce run readiness. */
export function createSkinExtensionWasmInfiniteStartProbe(): Uint8Array {
  const runBody = [0, 0x41, 0x00, 0x0b];
  const startBody = [0, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x0b];
  const imports = [1, ...name("env"), ...name("memory"), 0x02, 0x01, 1, 64];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [2, 0x60, 0, 1, 0x7f, 0x60, 0, 0]),
    ...section(2, imports),
    ...section(3, [2, 0, 1]),
    ...section(7, [1, ...name("run"), 0, 0]),
    ...section(8, [1]),
    ...section(10, [2, runBody.length, ...runBody, startBody.length, ...startBody]),
  ]);
}

/** Imports only env.memory; the exports fill the cap, exceed it, and spin forever. */
export function createSkinExtensionWasmResourceProbe(): Uint8Array {
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [2, 0x60, 0, 1, 0x7f, 0x60, 0, 0]),
    ...section(2, [1, ...name("env"), ...name("memory"), 0x02, 0x01, 1, 64]),
    ...section(3, [3, 0, 0, 1]),
    ...section(7, [3, ...name("fill"), 0, 0, ...name("grow"), 0, 1, ...name("spin"), 0, 2]),
    ...section(10, [3, 6, 0, 0x41, 0x3f, 0x40, 0, 0x0b, 7, 0, 0x41, 0xc0, 0, 0x40, 0, 0x0b, 7, 0, 0x03, 0x40, 0x0c, 0, 0x0b, 0x0b]),
  ]);
}

/** A valid-looking module that defines its own unbounded linear memory. */
export function createSkinExtensionWasmInternalMemoryProbe(): Uint8Array {
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...section(5, [1, 0, 1])]);
}

export function createSkinExtensionWasmInternalTableProbe(): Uint8Array {
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...section(4, [1, 0x70, 0, 0])]);
}

export function createSkinExtensionWasmTooManyFunctionsProbe(): Uint8Array {
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...section(3, [0x81, 0x01])]);
}

export function createSkinExtensionWasmOversizedFunctionBodyProbe(): Uint8Array {
  const body = new Array(32 * 1024 + 1).fill(0);
  return Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...section(10, [1, ...unsignedLeb128(body.length), ...body])]);
}

/** A valid Wasm GC module whose struct allocation is outside the linear-memory cap. */
export function createSkinExtensionWasmGcAllocationProbe(): Uint8Array {
  const imports = [1, ...name("env"), ...name("memory"), 0x02, 0x01, 1, 64];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [2, 0x5f, 0, 0x60, 0, 0]), // empty struct type, then () -> ()
    ...section(2, imports),
    ...section(3, [1, 1]),
    ...section(7, [1, ...name("run"), 0, 0]),
    ...section(10, [1, 6, 0, 0xfb, 0, 0, 0x1a, 0x0b]), // struct.new 0; drop; end
  ]);
}

/** Encodes an impossible signature parameter count in a small binary. */
export function createSkinExtensionWasmOversizedSignatureProbe(): Uint8Array {
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [1, 0x60, ...unsignedLeb128(0x10000000), 0, 0]),
  ]);
}

/** Encodes an impossible local count that must be rejected before Wasm compilation. */
export function createSkinExtensionWasmOversizedLocalProbe(): Uint8Array {
  return singleRunModule([1, ...unsignedLeb128(0x10000000), 0x7f, 0x41, 0, 0x0b]);
}

/** Encodes a huge passive element vector; element segments are unsupported because tables are disabled. */
export function createSkinExtensionWasmOversizedElementVectorProbe(): Uint8Array {
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(9, [1, 3, 0, ...unsignedLeb128(0x10000000)]),
  ]);
}

/** A legal signed LEB immediate contains byte 0xfb and must not look like an instruction prefix. */
export function createSkinExtensionWasmPrefixByteImmediateProbe(): Uint8Array {
  return singleRunModule([0, 0x41, 0xfb, 0x00, 0x0b]); // i32.const 123
}
