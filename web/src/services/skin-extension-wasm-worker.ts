import {
  sanitizeSkinExtensionSessionStatus,
  type SkinExtensionSessionStatus,
} from "../../../src/shared/skin-extension.js";
import {
  SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES,
  SKIN_EXTENSION_WASM_FUEL_LIMIT,
  SKIN_EXTENSION_WASM_MESSAGE_LIMIT,
  SKIN_EXTENSION_WASM_STATUS_BYTES_LIMIT,
  SKIN_EXTENSION_WASM_STATUS_READ_LIMIT,
  validateSkinExtensionWasmImportsAndExports,
} from "./skin-extension-wasm-policy.js";

interface RunMessage {
  type: "run";
  bytes: ArrayBuffer;
  approvedPermissions: string[];
}

interface CapabilityResponse {
  type: "capability-response";
  requestId: string;
  approved: boolean;
  status?: unknown;
}

interface WasmiInterpreterExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  run: (modulePointer: number, moduleLength: number, statusPointer: number, statusLength: number,
    statusPermissionGranted: number, memoryMaximumPages: number, fuel: bigint) => bigint;
  last_error_code: () => number;
  last_status_read_count: () => number;
  last_guest_memory_bytes: () => number;
}

const scope = self as unknown as {
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
};
let started = false;
let pendingCapability: { requestId: string; resolve: (message: CapabilityResponse) => void } | null = null;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sendError(code: string, message: string): void {
  scope.postMessage({ type: "error", code, message });
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (isPlainRecord(value) && value.type === "capability-response" && pendingCapability
    && value.requestId === pendingCapability.requestId && typeof value.approved === "boolean") {
    const resolve = pendingCapability.resolve;
    pendingCapability = null;
    resolve(value as unknown as CapabilityResponse);
    return;
  }
  if (started || !isPlainRecord(value) || value.type !== "run" || !(value.bytes instanceof ArrayBuffer)
    || !Array.isArray(value.approvedPermissions) || value.approvedPermissions.some((permission) => typeof permission !== "string")
    || Object.keys(value).some((key) => !["type", "bytes", "approvedPermissions"].includes(key))) {
    sendError("SKIN_EXTENSION_WASM_JOB_INVALID", "The isolated Wasm job message is invalid.");
    return;
  }
  started = true;
  void run(value as unknown as RunMessage);
});

async function requestSessionStatus(): Promise<SkinExtensionSessionStatus> {
  const requestId = "session-status-1";
  const response = await new Promise<CapabilityResponse>((resolve) => {
    pendingCapability = { requestId, resolve };
    scope.postMessage({ type: "capability-request", requestId, permission: "session.status.read" });
  });
  if (!response.approved) throw new Error("The host denied session.status.read.");
  return sanitizeSkinExtensionSessionStatus(response.status);
}

async function run(job: RunMessage): Promise<void> {
  try {
    const bytes = new Uint8Array(job.bytes);
    const metadata = validateSkinExtensionWasmImportsAndExports(bytes, job.approvedPermissions);
    const interpreter = await loadWasmiInterpreter();
    const status = metadata.usesSessionStatus ? await requestSessionStatus() : null;
    const statusBytes = status ? new TextEncoder().encode(JSON.stringify(status)) : null;
    if (statusBytes && statusBytes.byteLength > SKIN_EXTENSION_WASM_STATUS_BYTES_LIMIT) {
      sendError("SKIN_EXTENSION_WASM_STATUS_SIZE", "The approved session snapshot exceeds its size limit.");
      return;
    }

    const payloadLength = bytes.byteLength + (statusBytes?.byteLength ?? 0);
    const pointer = interpreter.alloc(payloadLength);
    if (!pointer) {
      sendError("SKIN_EXTENSION_WASM_INTERPRETER_MEMORY_LIMIT", "The extension input exceeds the interpreter's bounded memory.");
      return;
    }
    new Uint8Array(interpreter.memory.buffer, pointer, bytes.byteLength).set(bytes);
    const statusPointer = statusBytes ? pointer + bytes.byteLength : 0;
    if (statusBytes) new Uint8Array(interpreter.memory.buffer, statusPointer, statusBytes.byteLength).set(statusBytes);

    scope.postMessage({ type: "running" });
    const rawResult = interpreter.run(pointer, bytes.byteLength, statusPointer, statusBytes?.byteLength ?? 0,
      metadata.usesSessionStatus ? 1 : 0, metadata.memoryMaximumPages, SKIN_EXTENSION_WASM_FUEL_LIMIT);
    const errorCode = interpreter.last_error_code();
    if (errorCode !== 0) {
      const code = errorCode === 5 ? "SKIN_EXTENSION_WASM_EXECUTION_LIMIT"
        : errorCode === 6 ? "SKIN_EXTENSION_WASM_MEMORY_LIMIT"
          : errorCode === 10 ? "SKIN_EXTENSION_WASM_IMPORT_INVALID"
            : errorCode === 11 ? "SKIN_EXTENSION_WASM_PERMISSION_INVALID"
              : "SKIN_EXTENSION_WASM_INTERPRETER_FAILED";
      sendError(code, "The extension was rejected or stopped inside the bounded Wasmi interpreter.");
      return;
    }

    const result = Number(rawResult);
    const statusReadCount = interpreter.last_status_read_count();
    const linearMemoryBytes = interpreter.last_guest_memory_bytes();
    if (!Number.isSafeInteger(result) || !Number.isSafeInteger(statusReadCount) || statusReadCount < 0
      || statusReadCount > SKIN_EXTENSION_WASM_STATUS_READ_LIMIT || !Number.isSafeInteger(linearMemoryBytes)
      || linearMemoryBytes < 0 || linearMemoryBytes > metadata.memoryMaximumPages * 64 * 1024
      || linearMemoryBytes > SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES * 64 * 1024) {
      sendError("SKIN_EXTENSION_WASM_RESULT_INVALID", "The interpreter returned a value outside the allowed resource policy.");
      return;
    }
    const message = {
      type: "complete",
      result,
      linearMemoryBytes,
      statusReadCount,
    };
    if (new TextEncoder().encode(JSON.stringify(message)).byteLength > SKIN_EXTENSION_WASM_MESSAGE_LIMIT) {
      sendError("SKIN_EXTENSION_WASM_MESSAGE_SIZE", "The module result exceeds its message limit.");
      return;
    }
    scope.postMessage(message);
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate?.code === "string" ? candidate.code : "SKIN_EXTENSION_WASM_FAILED";
    const detail = typeof candidate?.message === "string" ? ` ${candidate.message.slice(0, 240)}` : "";
    sendError(code, `The bounded Wasm extension failed validation or execution.${detail}`);
  }
}

async function loadWasmiInterpreter(): Promise<WasmiInterpreterExports> {
  const response = await fetch(new URL("/skin-wasm-interpreter.wasm", self.location.origin), { cache: "force-cache" });
  if (!response.ok) throw new Error("The bounded Wasmi interpreter asset could not be loaded.");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && (contentLength < 8 || contentLength > 8 * 1024 * 1024)) {
    throw new Error("The bounded Wasmi interpreter asset has an invalid size.");
  }
  const artifact = await response.arrayBuffer();
  if (artifact.byteLength < 8 || artifact.byteLength > 8 * 1024 * 1024) {
    throw new Error("The bounded Wasmi interpreter asset has an invalid size.");
  }
  const { instance } = await WebAssembly.instantiate(artifact);
  const exports = instance.exports as unknown as WasmiInterpreterExports;
  if (!(exports.memory instanceof WebAssembly.Memory) || typeof exports.alloc !== "function"
    || typeof exports.run !== "function" || typeof exports.last_error_code !== "function"
    || typeof exports.last_status_read_count !== "function" || typeof exports.last_guest_memory_bytes !== "function") {
    throw new Error("The bounded Wasmi interpreter exposes an incompatible runtime interface.");
  }
  return exports;
}
