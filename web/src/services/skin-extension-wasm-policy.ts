import { SKIN_EXTENSION_UI_OUTPUT_LIMIT_BYTES } from "../../../src/shared/skin-extension-ui.js";

export const SKIN_EXTENSION_WASM_SOURCE_LIMIT = 256 * 1024;
export const SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES = 64;
export const SKIN_EXTENSION_WASM_PAGE_BYTES = 64 * 1024;
export const SKIN_EXTENSION_WASM_STARTUP_TIMEOUT_MS = 3_000;
export const SKIN_EXTENSION_WASM_EXECUTION_LIMIT_MS = 100;
export const SKIN_EXTENSION_WASM_UI_OUTPUT_LIMIT_BYTES = SKIN_EXTENSION_UI_OUTPUT_LIMIT_BYTES;
// Worker messages serialize the bounded UI JSON as a string, escaping its quotes
// and backslashes a second time. Allow that envelope plus bounded input metadata.
export const SKIN_EXTENSION_WASM_MESSAGE_LIMIT = SKIN_EXTENSION_WASM_UI_OUTPUT_LIMIT_BYTES * 2 + 8 * 1024;
export const SKIN_EXTENSION_WASM_STATUS_READ_LIMIT = 10;
export const SKIN_EXTENSION_WASM_STATUS_BYTES_LIMIT = 512;
export const SKIN_EXTENSION_WASM_FUEL_LIMIT = 10_000_000n;
export const SKIN_EXTENSION_WASM_INTERPRETER_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
export const SKIN_EXTENSION_WASM_FUNCTION_LIMIT = 128;
export const SKIN_EXTENSION_WASM_FUNCTION_BODY_LIMIT = 32 * 1024;
export const SKIN_EXTENSION_WASM_CODE_BYTES_LIMIT = 192 * 1024;
const SKIN_EXTENSION_WASM_SIGNATURE_VALUE_LIMIT = 64;
const SKIN_EXTENSION_WASM_LOCAL_GROUP_LIMIT = 256;
const SKIN_EXTENSION_WASM_LOCAL_LIMIT = 4_096;

const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00] as const;
const SCALAR_VALUE_TYPES = new Set([0x7f, 0x7e, 0x7d, 0x7c]);
const BOUNDED_VECTOR_COUNTS = new Map<number, number>([
  [1, 128], // types
  [2, 4], // memory, one optional capability, one UI input, and one UI output import
  [3, SKIN_EXTENSION_WASM_FUNCTION_LIMIT],
  [6, 128], // globals
  [7, 64], // exports; the runner later requires exactly run
  [9, 64], // element segments
  [11, 64], // data segments
  [12, 64], // data segments referenced by bulk-memory operations
]);

export class SkinExtensionWasmPolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinExtensionWasmPolicyError";
  }
}

function readU32(bytes: Uint8Array, offset: number, end: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 5; index += 1) {
    if (offset >= end) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module has a truncated section length.");
    const byte = bytes[offset++];
    if (index === 4 && (byte & 0xf0) !== 0) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module has an overflowing section length.");
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: offset };
    shift += 7;
  }
  throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module has an invalid section length.");
}

function skipSignedLeb128(bytes: Uint8Array, offset: number, end: number, maxBytes: number): number {
  for (let index = 0; index < maxBytes; index += 1) {
    if (offset >= end) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension function contains a truncated integer immediate.");
    if ((bytes[offset++] & 0x80) === 0) return offset;
  }
  throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension function contains an oversized integer immediate.");
}

function requireScalarValueType(bytes: Uint8Array, offset: number, end: number): number {
  if (offset >= end) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module contains a truncated value type.");
  if (!SCALAR_VALUE_TYPES.has(bytes[offset])) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE", "The Wasm runtime accepts numeric scalar types only; reference, vector, and GC types are disabled.");
  }
  return offset + 1;
}

function validateTypeSection(bytes: Uint8Array, start: number, end: number): void {
  let cursor = readU32(bytes, start, end);
  if (cursor.value > 128) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "The extension module contains too many function types.");
  for (let typeIndex = 0; typeIndex < cursor.value; typeIndex += 1) {
    if (cursor.next >= end) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension type section is truncated.");
    if (bytes[cursor.next++] !== 0x60) {
      throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE", "The Wasm runtime accepts function types only; GC and recursive types are disabled.");
    }
    const parameters = readU32(bytes, cursor.next, end);
    cursor.next = parameters.next;
    if (parameters.value > SKIN_EXTENSION_WASM_SIGNATURE_VALUE_LIMIT) {
      throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "An extension function signature contains too many parameters.");
    }
    for (let index = 0; index < parameters.value; index += 1) cursor.next = requireScalarValueType(bytes, cursor.next, end);

    const results = readU32(bytes, cursor.next, end);
    cursor.next = results.next;
    if (results.value > SKIN_EXTENSION_WASM_SIGNATURE_VALUE_LIMIT) {
      throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "An extension function signature contains too many results.");
    }
    for (let index = 0; index < results.value; index += 1) cursor.next = requireScalarValueType(bytes, cursor.next, end);
  }
  if (cursor.next !== end) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension type section contains trailing bytes.");
}

function readBlockType(bytes: Uint8Array, offset: number, end: number): number {
  if (offset >= end) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension function contains a truncated block type.");
  const valueType = bytes[offset];
  if (valueType === 0x40 || SCALAR_VALUE_TYPES.has(valueType)) return offset + 1;
  if (valueType === 0x6f || valueType === 0x70 || valueType === 0x7b || valueType === 0x63 || valueType === 0x64) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE", "Reference and vector block types are disabled in the Wasm runtime.");
  }
  return skipSignedLeb128(bytes, offset, end, 5);
}

function scanFunctionBody(bytes: Uint8Array, start: number, end: number): number {
  let cursor = readU32(bytes, start, end);
  if (cursor.value > SKIN_EXTENSION_WASM_LOCAL_GROUP_LIMIT) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "An extension function contains too many local groups.");
  }
  const localGroupCount = cursor.value;
  let localCount = 0;
  for (let index = 0; index < localGroupCount; index += 1) {
    const group = readU32(bytes, cursor.next, end);
    cursor.next = group.next;
    localCount += group.value;
    if (localCount > SKIN_EXTENSION_WASM_LOCAL_LIMIT) {
      throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "An extension module declares too many local values.");
    }
    cursor.next = requireScalarValueType(bytes, cursor.next, end);
  }

  while (cursor.next < end) {
    const opcode = bytes[cursor.next++];
    if ((opcode >= 0x45 && opcode <= 0xc4)
      || opcode === 0x00 || opcode === 0x01 || opcode === 0x05 || opcode === 0x0b
      || opcode === 0x0f || opcode === 0x1a || opcode === 0x1b) continue;

    if (opcode === 0x02 || opcode === 0x03 || opcode === 0x04) {
      cursor.next = readBlockType(bytes, cursor.next, end);
      continue;
    }
    if (opcode === 0x0c || opcode === 0x0d || opcode === 0x10
      || (opcode >= 0x20 && opcode <= 0x24)) {
      cursor = readU32(bytes, cursor.next, end);
      continue;
    }
    if (opcode === 0x0e) {
      const labels = readU32(bytes, cursor.next, end);
      cursor.next = labels.next;
      if (labels.value > end - cursor.next) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension branch table is truncated.");
      for (let index = 0; index <= labels.value; index += 1) cursor = readU32(bytes, cursor.next, end);
      continue;
    }
    if (opcode === 0x11) {
      cursor = readU32(bytes, cursor.next, end);
      const table = readU32(bytes, cursor.next, end);
      if (table.value !== 0) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "The extension function references an unsupported table.");
      cursor.next = table.next;
      continue;
    }
    if (opcode === 0x1c) {
      const selected = readU32(bytes, cursor.next, end);
      cursor.next = selected.next;
      if (selected.value > SKIN_EXTENSION_WASM_SIGNATURE_VALUE_LIMIT) {
        throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "A typed selection contains too many values.");
      }
      for (let index = 0; index < selected.value; index += 1) cursor.next = requireScalarValueType(bytes, cursor.next, end);
      continue;
    }
    if (opcode >= 0x28 && opcode <= 0x3e) {
      const alignment = readU32(bytes, cursor.next, end);
      cursor.next = alignment.next;
      if (alignment.value > 3) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE", "Multi-memory and over-aligned memory operations are disabled.");
      cursor = readU32(bytes, cursor.next, end);
      continue;
    }
    if (opcode === 0x3f || opcode === 0x40) {
      const memory = readU32(bytes, cursor.next, end);
      if (memory.value !== 0) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "The extension function references an unsupported memory.");
      cursor.next = memory.next;
      continue;
    }
    if (opcode === 0x41 || opcode === 0x42) {
      cursor.next = skipSignedLeb128(bytes, cursor.next, end, opcode === 0x41 ? 5 : 10);
      continue;
    }
    if (opcode === 0x43 || opcode === 0x44) {
      const immediateBytes = opcode === 0x43 ? 4 : 8;
      if (cursor.next + immediateBytes > end) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension function contains a truncated floating-point immediate.");
      cursor.next += immediateBytes;
      continue;
    }
    if (opcode === 0xfc) {
      const operation = readU32(bytes, cursor.next, end);
      cursor.next = operation.next;
      if (operation.value <= 7) continue; // Saturating numeric conversions.
      if (operation.value === 8) {
        cursor = readU32(bytes, cursor.next, end); // data index
        const memory = readU32(bytes, cursor.next, end);
        if (memory.value !== 0) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "The extension function references an unsupported memory.");
        cursor.next = memory.next;
        continue;
      }
      if (operation.value === 9) { cursor = readU32(bytes, cursor.next, end); continue; } // data.drop
      if (operation.value === 10) {
        const firstMemory = readU32(bytes, cursor.next, end);
        const secondMemory = readU32(bytes, firstMemory.next, end);
        if (firstMemory.value !== 0 || secondMemory.value !== 0) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "The extension function references an unsupported memory.");
        cursor.next = secondMemory.next;
        continue;
      }
      if (operation.value === 11) {
        const memory = readU32(bytes, cursor.next, end);
        if (memory.value !== 0) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "The extension function references an unsupported memory.");
        cursor.next = memory.next;
        continue;
      }
      throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE", "Table, GC, SIMD, thread, and unknown Wasm extension instructions are disabled.");
    }
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE", "The Wasm runtime accepts scalar core instructions only; reference, GC, SIMD, thread, and unknown extension instructions are disabled.");
  }
  return localCount;
}

/**
 * Resource-policy preflight before the fixed Wasmi interpreter parses an extension.
 * It bounds the binary work up front; Wasmi still performs full module validation.
 */
export function validateSkinExtensionWasmBytes(source: Uint8Array): void {
  if (!(source instanceof Uint8Array) || source.byteLength < WASM_HEADER.length || source.byteLength > SKIN_EXTENSION_WASM_SOURCE_LIMIT) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_SIZE", "The extension module is empty, invalid, or exceeds its size limit.");
  }
  if (WASM_HEADER.some((byte, index) => source[index] !== byte)) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module header or version is unsupported.");
  }

  let offset: number = WASM_HEADER.length;
  let previousSectionRank = 0;
  let customSectionCount = 0;
  const seenSections = new Set<number>();
  let definedFunctionCount: number | undefined;
  let codeFunctionCount: number | undefined;
  let codeBytes = 0;
  let totalLocalCount = 0;
  while (offset < source.byteLength) {
    const sectionId = source[offset++];
    if (sectionId > 12) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module contains an unknown section.");
    if (sectionId === 0) {
      customSectionCount += 1;
      if (customSectionCount > 8) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "The extension module contains too many custom sections.");
    } else {
      if (seenSections.has(sectionId)) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module contains a duplicate section.");
      seenSections.add(sectionId);
      // The data-count section (12) is ordered immediately before code (10) by the Wasm binary format.
      const rank = sectionId === 12 ? 9.5 : sectionId;
      if (rank <= previousSectionRank) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module sections are out of order.");
      previousSectionRank = rank;
    }
    if (sectionId === 8) {
      throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE", "Module start functions are disabled; extensions may enter only through the exported run function.");
    }
    const sectionLength = readU32(source, offset, source.byteLength);
    offset = sectionLength.next;
    const sectionEnd = offset + sectionLength.value;
    if (sectionEnd > source.byteLength) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module has a truncated section.");

    if (sectionId === 1) validateTypeSection(source, offset, sectionEnd);

    const vectorLimit = BOUNDED_VECTOR_COUNTS.get(sectionId);
    if (vectorLimit !== undefined) {
      const count = readU32(source, offset, sectionEnd);
      if (count.value > vectorLimit) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "The extension module exceeds a structural item limit.");
      if (sectionId === 3) definedFunctionCount = count.value;
    }

    // This model permits exactly one host-provided bounded linear memory and no tables.
    // Module-defined memories, tables, and element segments would bypass that resource model.
    if (sectionId === 4 || sectionId === 5) {
      const count = readU32(source, offset, sectionEnd).value;
      if (count !== 0) {
        throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "Extension modules must import bounded memory and cannot define memory or tables.");
      }
    }
    if (sectionId === 9 && readU32(source, offset, sectionEnd).value !== 0) {
      throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "Extension modules cannot declare element segments or tables.");
    }

    if (sectionId === 10) {
      let cursor = offset;
      const count = readU32(source, cursor, sectionEnd);
      cursor = count.next;
      if (count.value > SKIN_EXTENSION_WASM_FUNCTION_LIMIT) {
        throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "The extension module contains too many function bodies.");
      }
      codeFunctionCount = count.value;
      for (let index = 0; index < count.value; index += 1) {
        const body = readU32(source, cursor, sectionEnd);
        cursor = body.next;
        if (!body.value || body.value > SKIN_EXTENSION_WASM_FUNCTION_BODY_LIMIT) {
          throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "An extension function body exceeds its size limit.");
        }
        codeBytes += body.value;
        if (codeBytes > SKIN_EXTENSION_WASM_CODE_BYTES_LIMIT) {
          throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "The extension code section exceeds its total size limit.");
        }
        const bodyEnd = cursor + body.value;
        if (bodyEnd > sectionEnd) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "An extension function body is truncated.");
        totalLocalCount += scanFunctionBody(source, cursor, bodyEnd);
        if (totalLocalCount > SKIN_EXTENSION_WASM_LOCAL_LIMIT) {
          throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT", "The extension module declares too many local values.");
        }
        cursor = bodyEnd;
      }
      if (cursor !== sectionEnd) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension code section contains trailing bytes.");
    }
    offset = sectionEnd;
  }
  if (definedFunctionCount !== undefined && codeFunctionCount !== undefined && definedFunctionCount !== codeFunctionCount) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension function and code counts do not match.");
  }
}

export interface SkinExtensionWasmModuleMetadata {
  usesSessionStatus: boolean;
  usesUiInput: boolean;
  usesUiOutput: boolean;
  memoryMaximumPages: number;
}

function readWasmName(bytes: Uint8Array, offset: number, end: number): { value: string; next: number } {
  const length = readU32(bytes, offset, end);
  if (length.value > 80 || length.next + length.value > end) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "The module contains an invalid import or export name.");
  }
  try {
    return {
      value: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(length.next, length.next + length.value)),
      next: length.next + length.value,
    };
  } catch {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "The module contains an invalid UTF-8 import or export name.");
  }
}

function readImportedMemoryMaximum(bytes: Uint8Array, offset: number, end: number): { maximumPages: number; next: number } {
  const flags = readU32(bytes, offset, end);
  if (flags.value !== 0 && flags.value !== 1) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "Shared and memory64 imports are not supported.");
  }
  const minimum = readU32(bytes, flags.next, end);
  let next = minimum.next;
  let maximumPages = SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES;
  if (flags.value === 1) {
    const maximum = readU32(bytes, next, end);
    next = maximum.next;
    maximumPages = maximum.value;
    if (maximumPages < 1 || maximumPages > SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES || maximumPages < minimum.value) {
      throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "The imported memory limit is outside the host's allowed range.");
    }
  }
  if (minimum.value > 1 || minimum.value > maximumPages) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_RESOURCE_DECLARATION", "The module requests more initial memory than the host provides.");
  }
  return { maximumPages, next };
}

/** Parses only bounded imports/exports; author bytes never reach the browser's native Wasm compiler. */
export function validateSkinExtensionWasmImportsAndExports(
  bytes: Uint8Array,
  grantedPermissions: readonly string[] = [],
): SkinExtensionWasmModuleMetadata {
  validateSkinExtensionWasmBytes(bytes);
  let offset: number = WASM_HEADER.length;
  let memoryMaximumPages = SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES;
  let hasMemory = false;
  let usesSessionStatus = false;
  let usesUiInput = false;
  let usesUiOutput = false;
  let hasExports = false;

  while (offset < bytes.byteLength) {
    const sectionId = bytes[offset++];
    const sectionLength = readU32(bytes, offset, bytes.byteLength);
    offset = sectionLength.next;
    const end = offset + sectionLength.value;
    if (end > bytes.byteLength) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_INVALID", "The extension module has a truncated section.");

    if (sectionId === 2) {
      const count = readU32(bytes, offset, end);
      if (count.value < 1 || count.value > 4) {
        throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "The module must import one host memory and may import the bounded status, UI input, and UI output functions.");
      }
      let cursor = count.next;
      for (let index = 0; index < count.value; index += 1) {
        const moduleName = readWasmName(bytes, cursor, end);
        const fieldName = readWasmName(bytes, moduleName.next, end);
        cursor = fieldName.next;
        if (cursor >= end || moduleName.value !== "env") {
          throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "The module may import only the host's env memory and approved capability.");
        }
        const kind = bytes[cursor++];
        if (kind === 0) {
          const typeIndex = readU32(bytes, cursor, end);
          cursor = typeIndex.next;
          if (fieldName.value === "session_status_read" && !usesSessionStatus) {
            usesSessionStatus = true;
          } else if (fieldName.value === "ui_input_read" && !usesUiInput) {
            usesUiInput = true;
          } else if (fieldName.value === "ui_emit_json" && !usesUiOutput) {
            usesUiOutput = true;
          } else {
            throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "The module requested an unsupported or duplicate function import.");
          }
        } else if (kind === 2) {
          if (fieldName.value !== "memory" || hasMemory) {
            throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "The module must import exactly one env.memory value.");
          }
          const memory = readImportedMemoryMaximum(bytes, cursor, end);
          cursor = memory.next;
          memoryMaximumPages = memory.maximumPages;
          hasMemory = true;
        } else {
          throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "Tables, globals, tags, and unknown imports are not supported.");
        }
      }
      if (cursor !== end || !hasMemory) {
        throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "The module must import exactly one env.memory value.");
      }
    }

    if (sectionId === 7) {
      const count = readU32(bytes, offset, end);
      if (count.value !== 1) {
        throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_EXPORT_INVALID", "The module must export only one run function.");
      }
      let cursor = count.next;
      const name = readWasmName(bytes, cursor, end);
      cursor = name.next;
      if (cursor >= end || name.value !== "run" || bytes[cursor++] !== 0) {
        throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_EXPORT_INVALID", "The module must export one function named run.");
      }
      const functionIndex = readU32(bytes, cursor, end);
      cursor = functionIndex.next;
      if (cursor !== end) throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_EXPORT_INVALID", "The module has trailing export data.");
      hasExports = true;
    }

    offset = end;
  }

  if (!hasMemory || !hasExports) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_IMPORT_INVALID", "The module must import bounded env.memory and export a run function.");
  }
  if (usesSessionStatus && !grantedPermissions.includes("session.status.read")) {
    throw new SkinExtensionWasmPolicyError("SKIN_EXTENSION_WASM_PERMISSION_INVALID", "The module imports session status without an approved session.status.read capability.");
  }
  return { usesSessionStatus, usesUiInput, usesUiOutput, memoryMaximumPages };
}
