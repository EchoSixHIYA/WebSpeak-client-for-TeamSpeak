import {
  isSkinExtensionBootstrapHello,
  isSkinExtensionPermissionApproved,
  parseSkinExtensionApproval,
  parseSkinExtensionManifest,
  parseSkinExtensionRequestMessage,
  sanitizeSkinExtensionSessionStatus,
  SKIN_EXTENSION_API_VERSION,
  SKIN_EXTENSION_MESSAGE_CHANNEL,
  type SkinExtensionApproval,
  type SkinExtensionManifest,
  type SkinExtensionPermissionId,
  type SkinExtensionSessionStatus,
} from "../../../src/shared/skin-extension.js";

export const SKIN_EXTENSION_RUNTIME_ENABLED = false as const;
export const SKIN_EXTENSION_SANDBOX_SOURCE_LIMIT = 64 * 1024;
export const SKIN_EXTENSION_SANDBOX_MESSAGE_LIMIT = 8 * 1024;
export const SKIN_EXTENSION_SANDBOX_REQUESTS_PER_SECOND = 10;
export const SKIN_EXTENSION_SANDBOX_MAX_REQUESTS = 10_000;

const HANDSHAKE_TIMEOUT_MS = 3_000;
const SHUTDOWN_TIMEOUT_MS = 100;
const MESSAGE_CHANNEL = SKIN_EXTENSION_MESSAGE_CHANNEL;

export class SkinExtensionSandboxError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinExtensionSandboxError";
  }
}

export interface SkinExtensionSandboxOptions {
  container: HTMLElement;
  manifest: unknown;
  approval: unknown;
  source: string;
  readSessionStatus: (signal: AbortSignal) => SkinExtensionSessionStatus | Promise<SkinExtensionSessionStatus>;
  /** The only entry point is explicitly marked as a development prototype and is not wired into the application. */
  prototypeOnly: true;
}

export interface SkinExtensionSandboxHandle {
  readonly frame: HTMLIFrameElement;
  readonly manifest: SkinExtensionManifest;
  readonly approval: SkinExtensionApproval;
  readonly ready: Promise<void>;
  readonly stopped: Promise<void>;
  readonly closed: boolean;
  readonly closeReason: string | null;
  readonly acceptedRequests: number;
  readonly rejectedRequests: number;
  revokePermission(permission: SkinExtensionPermissionId): void;
  close(reason?: string): void;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function randomNonce(view: Window): string {
  const bytes = new Uint8Array(32);
  view.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function toBase64(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function createWorkerDataUrl(source: string): string {
  const pluginModuleUrl = `data:text/javascript;base64,${toBase64(source)}`;
  const workerBootstrap = `
const __wsPluginModuleUrl = ${JSON.stringify(pluginModuleUrl)};
const __wsApiVersion = ${SKIN_EXTENSION_API_VERSION};
const __wsDeniedGlobals = ["Worker", "SharedWorker", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "importScripts", "indexedDB", "caches", "WebAssembly"];
for (const __wsName of __wsDeniedGlobals) {
  try { Object.defineProperty(globalThis, __wsName, { value: undefined, writable: false, configurable: false }); } catch {}
  if (globalThis[__wsName] !== undefined) throw new Error("The worker cannot disable a restricted global.");
}
let __wsPort = null;
let __wsSequence = 0;
const __wsPending = new Map();
self.addEventListener("message", async function __wsInitialize(event) {
  if (__wsPort || event.data?.type !== "initialize" || event.ports.length !== 1 || Object.keys(event.data).length !== 1) return;
  __wsPort = event.ports[0];
  __wsPort.onmessage = (portEvent) => {
    const response = portEvent.data;
    if (!response || typeof response !== "object" || response.type !== "response" || typeof response.id !== "string") return;
    const pending = __wsPending.get(response.id);
    if (!pending) return;
    __wsPending.delete(response.id);
    if (response.ok === true) pending.resolve(response.data);
    else pending.reject(new Error(typeof response.error?.message === "string" ? response.error.message : "Extension request denied."));
  };
  __wsPort.start();
  const api = Object.freeze({
    apiVersion: __wsApiVersion,
    request(permission, payload = {}) {
      if (!__wsPort) return Promise.reject(new Error("Extension runtime is closed."));
      if (typeof permission !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 0) return Promise.reject(new Error("Invalid extension request."));
      if (__wsPending.size >= 16) return Promise.reject(new Error("Too many pending extension requests."));
      const id = "r" + (++__wsSequence).toString(36);
      return new Promise((resolve, reject) => {
        __wsPending.set(id, { resolve, reject });
        __wsPort.postMessage({ type: "request", id, permission, payload: {} });
      });
    },
  });
  Object.defineProperty(globalThis, "WebSpeakExtension", { value: api, writable: false, configurable: false });
  __wsPort.postMessage({ type: "worker-ready" });
  try { await import(__wsPluginModuleUrl); }
  catch { __wsPort.postMessage({ type: "plugin-error" }); }
});`;
  return `data:text/javascript;base64,${toBase64(workerBootstrap)}`;
}

function createSandboxDocument(workerUrl: string, nonce: string): string {
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' data:`,
    "style-src 'unsafe-inline'",
    "connect-src 'none'",
    "img-src 'none'",
    "media-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src data:",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "navigate-to 'none'",
  ].join("; ");

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<title>Isolated WebSpeak extension</title></head>
<body><main id="extension-root" aria-label="Extension component"></main>
<script nonce="${nonce}">
(() => {
  "use strict";
  const channelName = ${JSON.stringify(MESSAGE_CHANNEL)};
  const apiVersion = ${SKIN_EXTENSION_API_VERSION};
  const nonce = ${JSON.stringify(nonce)};
  const workerUrl = ${JSON.stringify(workerUrl)};
  const parentChannel = new MessageChannel();
  const parentPort = parentChannel.port1;
  const workerChannel = new MessageChannel();
  let worker = null;
  let workerPort = workerChannel.port1;
  let started = false;
  let stopped = false;

  function stopWorker() {
    if (stopped) return;
    stopped = true;
    if (worker) worker.terminate();
    if (workerPort) { workerPort.onmessage = null; workerPort.close(); }
    parentPort.postMessage({ channel: channelName, apiVersion, nonce, type: "shutdown-complete" });
  }

  function validHostEnvelope(data) {
    return !!data && typeof data === "object" && !Array.isArray(data)
      && data.channel === channelName && data.apiVersion === apiVersion && data.nonce === nonce;
  }

  parentPort.onmessage = (event) => {
    const data = event.data;
    if (!validHostEnvelope(data)) return;
    if (data.type === "shutdown" && Object.keys(data).length === 4) { stopWorker(); return; }
    if (data.type === "host-ready" && Object.keys(data).length === 4 && !started) {
      started = true;
      try {
        worker = new Worker(workerUrl, { type: "module", name: "webspeak-skin-extension" });
        worker.onerror = () => parentPort.postMessage({ channel: channelName, apiVersion, nonce, type: "runtime-error" });
        workerPort.onmessage = (workerEvent) => {
          const message = workerEvent.data;
          if (!message || typeof message !== "object" || Array.isArray(message)) return;
          if (message.type === "worker-ready" && Object.keys(message).length === 1) {
            parentPort.postMessage({ channel: channelName, apiVersion, nonce, type: "client-ready" });
            return;
          }
          if (message.type === "plugin-error" && Object.keys(message).length === 1) {
            parentPort.postMessage({ channel: channelName, apiVersion, nonce, type: "runtime-error" });
            return;
          }
          const keys = Object.keys(message).sort().join(",");
          if (message.type !== "request" || keys !== "id,payload,permission,type" || !/^r[A-Za-z0-9_-]{0,63}$/.test(message.id)
            || typeof message.permission !== "string" || !message.payload || typeof message.payload !== "object"
            || Array.isArray(message.payload) || Object.keys(message.payload).length !== 0) return;
          parentPort.postMessage({ channel: channelName, apiVersion, nonce, id: message.id, type: "request", permission: message.permission, payload: {} });
        };
        workerPort.start();
        worker.postMessage({ type: "initialize" }, [workerChannel.port2]);
      } catch {
        parentPort.postMessage({ channel: channelName, apiVersion, nonce, type: "runtime-error" });
      }
      return;
    }
    if (data.type === "response" && typeof data.id === "string") {
      try { workerPort.postMessage(data); } catch { stopWorker(); }
    }
  };
  parentPort.onmessageerror = stopWorker;
  parentPort.start();
  parent.postMessage({ channel: channelName, apiVersion, nonce, type: "hello" }, "*", [parentChannel.port2]);
})();
</script></body></html>`;
}

function serializedMessageBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isReadyMessage(value: unknown, nonce: string): boolean {
  return isPlainRecord(value)
    && Object.keys(value).length === 4
    && value.channel === MESSAGE_CHANNEL
    && value.apiVersion === SKIN_EXTENSION_API_VERSION
    && value.nonce === nonce
    && value.type === "client-ready";
}

export function createSkinExtensionSandboxPrototype(options: SkinExtensionSandboxOptions): SkinExtensionSandboxHandle {
  if (options.prototypeOnly !== true) {
    throw new SkinExtensionSandboxError("SKIN_EXTENSION_RUNTIME_DISABLED", "Executable extensions are disabled.");
  }
  if (!options.container || typeof options.source !== "string") {
    throw new SkinExtensionSandboxError("SKIN_EXTENSION_INPUT_INVALID", "The extension runtime input is invalid.");
  }

  const manifest = parseSkinExtensionManifest(options.manifest);
  const approval = parseSkinExtensionApproval(options.approval);
  if (approval.pluginId !== manifest.id || approval.apiVersion !== manifest.apiVersion) {
    throw new SkinExtensionSandboxError("SKIN_EXTENSION_RECONSENT_REQUIRED", "The extension must be reviewed and approved again.");
  }
  for (const permission of manifest.permissions) {
    if (!isSkinExtensionPermissionApproved(approval, manifest.id, permission)) {
      throw new SkinExtensionSandboxError("SKIN_EXTENSION_RECONSENT_REQUIRED", "A requested extension permission has not been approved.");
    }
  }
  if (new TextEncoder().encode(options.source).byteLength > SKIN_EXTENSION_SANDBOX_SOURCE_LIMIT) {
    throw new SkinExtensionSandboxError("SKIN_EXTENSION_SOURCE_TOO_LARGE", "The extension source exceeds the prototype size limit.");
  }

  const document = options.container.ownerDocument;
  const view = document.defaultView;
  if (!view || !view.crypto?.getRandomValues || typeof MessageChannel === "undefined") {
    throw new SkinExtensionSandboxError("SKIN_EXTENSION_BROWSER_UNSUPPORTED", "This browser cannot create the isolated extension prototype.");
  }
  const hostWindow = view;
  const nonce = randomNonce(hostWindow);
  const workerUrl = createWorkerDataUrl(options.source);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("allow", "camera 'none'; microphone 'none'; display-capture 'none'; geolocation 'none'");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", `${manifest.name} isolated component`);
  frame.tabIndex = 0;
  frame.style.display = "block";
  frame.style.width = "100%";
  frame.style.height = "100%";
  frame.style.border = "0";
  frame.style.background = "transparent";
  frame.srcdoc = createSandboxDocument(workerUrl, nonce);

  let active = true;
  let closeReason: string | null = null;
  let port: MessagePort | null = null;
  let readySettled = false;
  let stopTimer: number | undefined;
  let stoppedSettled = false;
  let loadCount = 0;
  let invalidMessages = 0;
  let totalRequests = 0;
  let acceptedRequests = 0;
  let rejectedRequests = 0;
  const requestTimes: number[] = [];
  const recentRequestIds = new Set<string>();
  const recentRequestIdOrder: string[] = [];
  const pendingHostRequests = new Map<string, AbortController>();
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
  const timer = hostWindow.setTimeout(() => close("handshake-timeout", new SkinExtensionSandboxError("SKIN_EXTENSION_HANDSHAKE_TIMEOUT", "The extension did not complete its isolated handshake.")), HANDSHAKE_TIMEOUT_MS);

  function finalizeStop(): void {
    if (stoppedSettled) return;
    stoppedSettled = true;
    if (stopTimer !== undefined) hostWindow.clearTimeout(stopTimer);
    if (port) {
      port.onmessage = null;
      port.onmessageerror = null;
      port.close();
      port = null;
    }
    frame.remove();
    resolveStopped();
  }

  function close(reason = "closed", error?: Error): void {
    if (!active) return;
    active = false;
    closeReason = reason;
    hostWindow.clearTimeout(timer);
    hostWindow.removeEventListener("message", onWindowMessage);
    frame.removeEventListener("load", onFrameLoad);
    frame.removeEventListener("error", onFrameError);
    for (const controller of pendingHostRequests.values()) controller.abort();
    pendingHostRequests.clear();
    requestTimes.length = 0;
    recentRequestIds.clear();
    recentRequestIdOrder.length = 0;
    if (!readySettled) {
      readySettled = true;
      rejectReady(error ?? new SkinExtensionSandboxError("SKIN_EXTENSION_RUNTIME_CLOSED", "The extension runtime closed before it was ready."));
    }
    if (port) {
      try {
        port.postMessage({ channel: MESSAGE_CHANNEL, apiVersion: SKIN_EXTENSION_API_VERSION, nonce, type: "shutdown" });
        stopTimer = hostWindow.setTimeout(finalizeStop, SHUTDOWN_TIMEOUT_MS);
      } catch {
        finalizeStop();
      }
    } else finalizeStop();
  }

  function failInvalidMessage(): void {
    invalidMessages += 1;
    if (invalidMessages >= 3) close("invalid-protocol");
  }

  function sendResponse(id: string, ok: true, data: SkinExtensionSessionStatus): void;
  function sendResponse(id: string, ok: false, code: string, message: string): void;
  function sendResponse(id: string, ok: boolean, dataOrCode: SkinExtensionSessionStatus | string, message?: string): void {
    if (!active || !port) return;
    const response = ok
      ? { channel: MESSAGE_CHANNEL, apiVersion: SKIN_EXTENSION_API_VERSION, nonce, id, type: "response", ok: true, data: dataOrCode }
      : { channel: MESSAGE_CHANNEL, apiVersion: SKIN_EXTENSION_API_VERSION, nonce, id, type: "response", ok: false, error: { code: dataOrCode, message } };
    try { port.postMessage(response); }
    catch { close("response-failed"); }
  }

  function consumeRequestRate(now: number): boolean {
    while (requestTimes.length > 0 && now - requestTimes[0] >= 1000) requestTimes.shift();
    if (requestTimes.length >= SKIN_EXTENSION_SANDBOX_REQUESTS_PER_SECOND) return false;
    requestTimes.push(now);
    return true;
  }

  async function handleRequest(value: unknown): Promise<void> {
    if (!active || !port) return;
    if (serializedMessageBytes(value) > SKIN_EXTENSION_SANDBOX_MESSAGE_LIMIT) {
      close("message-too-large");
      return;
    }
    if (!consumeRequestRate(hostWindow.performance.now())) {
      close("message-rate-exceeded");
      return;
    }
    const request = parseSkinExtensionRequestMessage(value, nonce);
    if (!request) {
      failInvalidMessage();
      return;
    }
    if (recentRequestIds.has(request.id) || pendingHostRequests.has(request.id)) {
      close("duplicate-request-id");
      return;
    }
    recentRequestIds.add(request.id);
    recentRequestIdOrder.push(request.id);
    if (recentRequestIdOrder.length > 256) recentRequestIds.delete(recentRequestIdOrder.shift()!);
    totalRequests += 1;
    if (totalRequests > SKIN_EXTENSION_SANDBOX_MAX_REQUESTS) {
      close("request-budget-exceeded");
      return;
    }
    if (!manifest.permissions.includes(request.permission)
      || !isSkinExtensionPermissionApproved(approval, manifest.id, request.permission)) {
      rejectedRequests += 1;
      sendResponse(request.id, false, "CAPABILITY_NOT_APPROVED", "The extension capability is not approved.");
      return;
    }
    if (request.permission !== "session.status.read") {
      rejectedRequests += 1;
      sendResponse(request.id, false, "CAPABILITY_UNAVAILABLE", "The extension capability is unavailable in this prototype.");
      return;
    }

    acceptedRequests += 1;
    const controller = new AbortController();
    pendingHostRequests.set(request.id, controller);
    try {
      const status = sanitizeSkinExtensionSessionStatus(await options.readSessionStatus(controller.signal));
      if (active && pendingHostRequests.get(request.id) === controller) {
        pendingHostRequests.delete(request.id);
        sendResponse(request.id, true, status);
      }
    } catch {
      if (pendingHostRequests.get(request.id) === controller) pendingHostRequests.delete(request.id);
      if (active) sendResponse(request.id, false, "HOST_DATA_UNAVAILABLE", "The requested session status is unavailable.");
    }
  }

  function onPortMessage(event: MessageEvent): void {
    if (!active) {
      const value = event.data;
      if (isPlainRecord(value) && Object.keys(value).length === 4
        && value.channel === MESSAGE_CHANNEL && value.apiVersion === SKIN_EXTENSION_API_VERSION
        && value.nonce === nonce && value.type === "shutdown-complete") finalizeStop();
      return;
    }
    if (serializedMessageBytes(event.data) > SKIN_EXTENSION_SANDBOX_MESSAGE_LIMIT) {
      close("message-too-large");
      return;
    }
    if (isPlainRecord(event.data) && Object.keys(event.data).length === 4
      && event.data.channel === MESSAGE_CHANNEL && event.data.apiVersion === SKIN_EXTENSION_API_VERSION
      && event.data.nonce === nonce && event.data.type === "runtime-error") {
      close("worker-error", new SkinExtensionSandboxError("SKIN_EXTENSION_WORKER_FAILED", "The isolated extension worker failed."));
      return;
    }
    if (!readySettled) {
      if (!isReadyMessage(event.data, nonce)) {
        close("invalid-handshake", new SkinExtensionSandboxError("SKIN_EXTENSION_HANDSHAKE_INVALID", "The isolated extension handshake was invalid."));
        return;
      }
      readySettled = true;
      hostWindow.clearTimeout(timer);
      resolveReady();
      return;
    }
    void handleRequest(event.data);
  }

  function onWindowMessage(event: MessageEvent): void {
    if (!active || port) {
      for (const transferredPort of event.ports) transferredPort.close();
      return;
    }
    const validHello = isSkinExtensionBootstrapHello({ source: event.source, origin: event.origin, data: event.data, ports: event.ports }, frame.contentWindow, nonce);
    if (!validHello) {
      for (const transferredPort of event.ports) transferredPort.close();
      return;
    }
    port = event.ports[0];
    port.onmessage = onPortMessage;
    port.onmessageerror = () => close("message-deserialization-failed");
    port.start();
    hostWindow.removeEventListener("message", onWindowMessage);
    port.postMessage({ channel: MESSAGE_CHANNEL, apiVersion: SKIN_EXTENSION_API_VERSION, nonce, type: "host-ready" });
  }

  function onFrameLoad(): void {
    loadCount += 1;
    if (loadCount > 1) close("frame-navigation");
  }

  function onFrameError(): void { close("frame-error"); }

  hostWindow.addEventListener("message", onWindowMessage);
  frame.addEventListener("load", onFrameLoad);
  frame.addEventListener("error", onFrameError);
  options.container.append(frame);

  return {
    frame,
    manifest,
    approval,
    ready,
    stopped,
    get closed() { return !active; },
    get closeReason() { return closeReason; },
    get acceptedRequests() { return acceptedRequests; },
    get rejectedRequests() { return rejectedRequests; },
    revokePermission(permission) {
      if (manifest.permissions.includes(permission)) close(`permission-revoked:${permission}`);
    },
    close,
  };
}
