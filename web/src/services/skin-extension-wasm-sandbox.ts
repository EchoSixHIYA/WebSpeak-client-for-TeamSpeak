import {
  isSkinExtensionPermissionApproved,
  parseSkinExtensionApproval,
  parseSkinExtensionManifest,
  sanitizeSkinExtensionSessionStatus,
  type SkinExtensionPermissionId,
  type SkinExtensionSessionStatus,
} from "../../../src/shared/skin-extension.js";
import {
  SKIN_EXTENSION_WASM_EXECUTION_LIMIT_MS,
  SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES,
  SKIN_EXTENSION_WASM_MESSAGE_LIMIT,
  SKIN_EXTENSION_WASM_SOURCE_LIMIT,
  SKIN_EXTENSION_WASM_STARTUP_TIMEOUT_MS,
  SKIN_EXTENSION_WASM_STATUS_READ_LIMIT,
  SKIN_EXTENSION_WASM_UI_OUTPUT_LIMIT_BYTES,
  validateSkinExtensionWasmBytes,
} from "./skin-extension-wasm-policy.js";
import {
  parseSkinExtensionUiInput,
  SKIN_EXTENSION_UI_INPUT_LIMIT_BYTES,
} from "../../../src/shared/skin-extension-ui-input.js";

export const SKIN_EXTENSION_WASM_RUNTIME_ENABLED = true as const;

export class SkinExtensionWasmSandboxError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinExtensionWasmSandboxError";
  }
}

export interface SkinExtensionWasmSandboxResult {
  result: number | string;
  linearMemoryBytes: number;
  statusReadCount: number;
  uiInputReadCount: number;
  uiOutput: string | null;
  sessionSnapshot?: SkinExtensionSessionStatus;
}

export interface SkinExtensionWasmSandboxOptions {
  manifest: unknown;
  approval: unknown;
  wasmBytes: Uint8Array;
  /** Bounded local component state and optional safe fields from a trusted UI event. */
  uiInput?: unknown;
  readSessionStatus: (signal: AbortSignal) => SkinExtensionSessionStatus | Promise<SkinExtensionSessionStatus>;
}

export interface SkinExtensionWasmSandboxHandle {
  readonly ready: Promise<void>;
  readonly result: Promise<SkinExtensionWasmSandboxResult>;
  readonly stopped: Promise<void>;
  readonly closed: boolean;
  readonly closeReason: string | null;
  readonly capabilityRequests: number;
  revokePermission(permission: SkinExtensionPermissionId): void;
  close(reason?: string): void;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function messageSize(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return SKIN_EXTENSION_WASM_MESSAGE_LIMIT + 1; }
}

/** Runs one approved Wasm module in a disposable worker with bounded memory and execution. */
export function createSkinExtensionWasmSandbox(options: SkinExtensionWasmSandboxOptions): SkinExtensionWasmSandboxHandle {
  if (!(options.wasmBytes instanceof Uint8Array) || !options.wasmBytes.byteLength || options.wasmBytes.byteLength > SKIN_EXTENSION_WASM_SOURCE_LIMIT) {
    throw new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_SIZE", "The extension module is empty or exceeds its source limit.");
  }

  const manifest = parseSkinExtensionManifest(options.manifest);
  const approval = parseSkinExtensionApproval(options.approval);
  validateSkinExtensionWasmBytes(options.wasmBytes);
  const grantedPermissions = manifest.permissions.filter((permission) =>
    isSkinExtensionPermissionApproved(approval, manifest.id, permission));
  const uiInput = parseSkinExtensionUiInput(options.uiInput ?? { schemaVersion: 1, state: {}, event: null });
  const uiInputJson = JSON.stringify(uiInput);
  if (new TextEncoder().encode(uiInputJson).byteLength > SKIN_EXTENSION_UI_INPUT_LIMIT_BYTES) {
    throw new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_UI_INPUT_INVALID", "The local UI input exceeds its bounded size.");
  }
  const wasmBytes = options.wasmBytes.slice();
  const worker = new Worker(new URL("./skin-extension-wasm-worker.ts", import.meta.url), {
    type: "module",
    name: "webspeak-skin-extension-wasm",
  });

  let active = true;
  let closeReason: string | null = null;
  const hostAbortController = new AbortController();
  let readySettled = false;
  let resultSettled = false;
  let capabilityRequests = 0;
  let approvedSessionStatus: SkinExtensionSessionStatus | undefined;
  let startupTimer: number | undefined;
  let executionTimer: number | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveResult!: (value: SkinExtensionWasmSandboxResult) => void;
  let rejectResult!: (error: Error) => void;
  let resolveStopped!: () => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const result = new Promise<SkinExtensionWasmSandboxResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
  void ready.catch(() => undefined);
  void result.catch(() => undefined);

  function finish(reason: string, error?: Error): void {
    if (!active) return;
    active = false;
    closeReason = reason;
    approvedSessionStatus = undefined;
    hostAbortController.abort();
    if (startupTimer !== undefined) clearTimeout(startupTimer);
    if (executionTimer !== undefined) clearTimeout(executionTimer);
    worker.onmessage = null;
    worker.onmessageerror = null;
    worker.onerror = null;
    worker.terminate();
    if (!readySettled) {
      readySettled = true;
      rejectReady(error ?? new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_CLOSED", "The Wasm extension stopped before execution began."));
    }
    if (!resultSettled) {
      resultSettled = true;
      rejectResult(error ?? new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_CLOSED", "The Wasm extension stopped before returning a result."));
    }
    resolveStopped();
  }

  function complete(value: SkinExtensionWasmSandboxResult): void {
    if (!active) return;
    active = false;
    closeReason = "completed";
    if (startupTimer !== undefined) clearTimeout(startupTimer);
    if (executionTimer !== undefined) clearTimeout(executionTimer);
    worker.onmessage = null;
    worker.onmessageerror = null;
    worker.onerror = null;
    worker.terminate();
    if (!readySettled) { readySettled = true; resolveReady(); }
    if (!resultSettled) { resultSettled = true; resolveResult(value); }
    resolveStopped();
  }

  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (!active || messageSize(event.data) > SKIN_EXTENSION_WASM_MESSAGE_LIMIT || !isPlainRecord(event.data)) {
      finish("invalid-message", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_MESSAGE_INVALID", "The Wasm worker returned an invalid or oversized message."));
      return;
    }
    const message = event.data;
    if (message.type === "capability-request") {
      if (Object.keys(message).length !== 3 || message.requestId !== "session-status-1" || message.permission !== "session.status.read"
        || capabilityRequests !== 0 || !grantedPermissions.includes("session.status.read")) {
        finish("capability-denied", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_PERMISSION_INVALID", "The Wasm worker requested an unapproved capability."));
        return;
      }
      capabilityRequests += 1;
      Promise.resolve().then(() => options.readSessionStatus(hostAbortController.signal)).then(sanitizeSkinExtensionSessionStatus).then((status) => {
        if (!active) return;
        approvedSessionStatus = status;
        worker.postMessage({ type: "capability-response", requestId: message.requestId, approved: true, status });
      }).catch(() => {
        if (active) worker.postMessage({ type: "capability-response", requestId: message.requestId, approved: false });
      });
      return;
    }
    if (message.type === "running" && Object.keys(message).length === 1) {
      if (readySettled) {
        finish("invalid-message", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_MESSAGE_INVALID", "The Wasm worker sent an unexpected execution-start message."));
        return;
      }
      readySettled = true;
      if (startupTimer !== undefined) clearTimeout(startupTimer);
      resolveReady();
      executionTimer = window.setTimeout(() => finish("execution-timeout", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_EXECUTION_TIMEOUT", "The Wasm extension exceeded its execution time limit.")), SKIN_EXTENSION_WASM_EXECUTION_LIMIT_MS);
      return;
    }
    if (message.type === "complete") {
      const expectedKeys = ["type", "result", "linearMemoryBytes", "statusReadCount", "uiInputReadCount", "uiOutput"];
      if (Object.keys(message).length !== expectedKeys.length
        || Object.keys(message).some((key) => !expectedKeys.includes(key))
        || (typeof message.result !== "number" && typeof message.result !== "string")
        || (message.uiOutput !== null && typeof message.uiOutput !== "string")
        || (typeof message.uiOutput === "string"
          && new TextEncoder().encode(message.uiOutput).byteLength > SKIN_EXTENSION_WASM_UI_OUTPUT_LIMIT_BYTES)
        || !Number.isSafeInteger(message.linearMemoryBytes) || (message.linearMemoryBytes as number) < 0
        || (message.linearMemoryBytes as number) > SKIN_EXTENSION_WASM_MEMORY_LIMIT_PAGES * 64 * 1024
        || !Number.isSafeInteger(message.statusReadCount) || (message.statusReadCount as number) < 0
        || (message.statusReadCount as number) > SKIN_EXTENSION_WASM_STATUS_READ_LIMIT
        || !Number.isSafeInteger(message.uiInputReadCount) || (message.uiInputReadCount as number) < 0
        || (message.uiInputReadCount as number) > 1) {
        finish("invalid-result", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_RESULT_INVALID", "The Wasm worker returned a result outside its allowed shape."));
        return;
      }
      complete({ result: message.result as number | string, linearMemoryBytes: message.linearMemoryBytes as number,
        statusReadCount: message.statusReadCount as number, uiInputReadCount: message.uiInputReadCount as number,
        uiOutput: message.uiOutput as string | null,
        ...(approvedSessionStatus ? { sessionSnapshot: approvedSessionStatus } : {}) });
      return;
    }
    if (message.type === "error" && Object.keys(message).length === 3
      && typeof message.code === "string" && typeof message.message === "string") {
      finish("worker-error", new SkinExtensionWasmSandboxError(message.code, message.message));
      return;
    }
    finish("invalid-message", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_MESSAGE_INVALID", "The Wasm worker returned an unsupported message."));
  };
  worker.onmessageerror = () => finish("message-deserialization-failed", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_MESSAGE_INVALID", "The Wasm worker message could not be decoded."));
  worker.onerror = () => finish("worker-error", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_WORKER_FAILED", "The isolated Wasm worker failed."));
  startupTimer = window.setTimeout(() => finish("startup-timeout", new SkinExtensionWasmSandboxError("SKIN_EXTENSION_WASM_STARTUP_TIMEOUT", "The Wasm worker did not finish initialization in time.")), SKIN_EXTENSION_WASM_STARTUP_TIMEOUT_MS);

  const bytes = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer;
  worker.postMessage({ type: "run", bytes, approvedPermissions: grantedPermissions, input: uiInputJson }, [bytes]);

  return {
    ready,
    result,
    stopped,
    get closed() { return !active; },
    get closeReason() { return closeReason; },
    get capabilityRequests() { return capabilityRequests; },
    revokePermission(permission) {
      if (manifest.permissions.includes(permission)) finish(`permission-revoked:${permission}`);
    },
    close(reason = "closed") { finish(reason); },
  };
}
