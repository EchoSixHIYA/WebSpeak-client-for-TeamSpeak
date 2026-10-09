import {
  createSkinExtensionApproval,
  parseSkinExtensionManifest,
  type SkinExtensionSessionStatus,
} from "../../src/shared/skin-extension.js";
import {
  createSkinExtensionSandboxPrototype,
  SKIN_EXTENSION_RUNTIME_ENABLED,
  type SkinExtensionSandboxHandle,
} from "../src/services/skin-extension-sandbox.js";
import {
  createSkinExtensionWasmSandboxPrototype,
  SKIN_EXTENSION_WASM_RUNTIME_ENABLED,
  type SkinExtensionWasmSandboxHandle,
} from "../src/services/skin-extension-wasm-sandbox.js";
import {
  createSkinExtensionWasmCappedRunProbe,
  createSkinExtensionWasmInfiniteStartProbe,
  createSkinExtensionWasmInfiniteRunProbe,
  createSkinExtensionWasmStatusMutationProbe,
  createSkinExtensionWasmStatusProbe,
  createSkinExtensionWasmUiOutputProbe,
  createSkinExtensionWasmGcAllocationProbe,
  createSkinExtensionWasmOversizedFunctionBodyProbe,
  createSkinExtensionWasmOversizedElementVectorProbe,
  createSkinExtensionWasmOversizedLocalProbe,
  createSkinExtensionWasmOversizedSignatureProbe,
  createSkinExtensionWasmPrefixByteImmediateProbe,
  createSkinExtensionWasmTooManyFunctionsProbe,
} from "./skin-extension-wasm-fixture.js";

const results = document.querySelector<HTMLOListElement>("#results")!;
const host = document.querySelector<HTMLElement>("#sandbox-host")!;
const bufferedMessages = new WeakMap<object, Map<string, unknown>>();
const messageWaiters = new WeakMap<object, Map<string, (value: unknown) => void>>();

window.addEventListener("message", (event) => {
  if (event.origin !== "null" || !event.source || !event.data || typeof event.data !== "object") return;
  const source = event.source as object;
  const key = (event.data as Record<string, unknown>).__skinHarness;
  if (typeof key !== "string") return;
  const waiter = messageWaiters.get(source)?.get(key);
  if (waiter) {
    messageWaiters.get(source)?.delete(key);
    waiter(event.data);
    return;
  }
  const buffered = bufferedMessages.get(source) ?? new Map<string, unknown>();
  buffered.set(key, event.data);
  bufferedMessages.set(source, buffered);
});

function extension(
  permissions: string[],
  source: string,
  container: HTMLElement = host,
  readSessionStatus: (signal: AbortSignal) => SkinExtensionSessionStatus | Promise<SkinExtensionSessionStatus> = () => ({ connected: true, channelName: "Quiet Zone", memberCount: 2 }),
) {
  const manifest = parseSkinExtensionManifest({
    schemaVersion: 1,
    packageType: "extension",
    id: "test.sandbox-check",
    name: "Sandbox check",
    version: "1.0.0",
    apiVersion: 1,
    permissions,
  });
  let statusReads = 0;
  const sandbox = createSkinExtensionSandboxPrototype({
    container,
    manifest,
    approval: createSkinExtensionApproval(manifest),
    source,
    readSessionStatus: (signal) => {
      statusReads += 1;
      return readSessionStatus(signal);
    },
    prototypeOnly: true,
  });
  return { sandbox, get statusReads() { return statusReads; } };
}

function wasmExtension(
  wasmBytes: Uint8Array,
  permissions: string[] = [],
  readSessionStatus: (signal: AbortSignal) => SkinExtensionSessionStatus | Promise<SkinExtensionSessionStatus> = () => ({ connected: true, channelName: "Quiet Zone", memberCount: 2 }),
) {
  const manifest = parseSkinExtensionManifest({
    schemaVersion: 1,
    packageType: "extension",
    id: "test.wasm-check",
    name: "Wasm check",
    version: "1.0.0",
    apiVersion: 1,
    permissions,
  });
  let statusReads = 0;
  const sandbox = createSkinExtensionWasmSandboxPrototype({
    manifest,
    approval: createSkinExtensionApproval(manifest),
    wasmBytes,
    readSessionStatus: (signal) => {
      statusReads += 1;
      return readSessionStatus(signal);
    },
    prototypeOnly: true,
  });
  return { sandbox, get statusReads() { return statusReads; } };
}

function waitForSourceMessage(source: object, key: string, timeoutMs = 1500): Promise<unknown> {
  const buffered = bufferedMessages.get(source)?.get(key);
  if (buffered !== undefined) {
    bufferedMessages.get(source)?.delete(key);
    return Promise.resolve(buffered);
  }
  return new Promise((resolve, reject) => {
    const waiters = messageWaiters.get(source) ?? new Map<string, (value: unknown) => void>();
    const timer = window.setTimeout(() => {
      waiters.delete(key);
      reject(new Error(`Timed out waiting for ${key}.`));
    }, timeoutMs);
    waiters.set(key, (value) => {
      window.clearTimeout(timer);
      resolve(value);
    });
    messageWaiters.set(source, waiters);
  });
}

function waitForWindowMessage(predicate: (event: MessageEvent) => boolean, timeoutMs = 1500): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for the window message."));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      if (!predicate(event)) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event);
    };
    window.addEventListener("message", onMessage);
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (predicate()) resolve();
      else if (performance.now() - started >= timeoutMs) reject(new Error("Timed out waiting for the sandbox state."));
      else window.setTimeout(check, 20);
    };
    check();
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(Object.is(actual, expected), `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

function throws(operation: () => unknown, code: string, message: string): void {
  let error: unknown;
  try { operation(); } catch (reason) { error = reason; }
  assert(error !== undefined && typeof error === "object" && "code" in error && error.code === code, message);
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

async function rejects(promise: Promise<unknown>, code: string, message: string): Promise<void> {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  assert(error !== null && typeof error === "object" && "code" in error && error.code === code, message);
}

async function test(name: string, run: () => Promise<void>): Promise<void> {
  const item = document.createElement("li");
  try {
    await run();
    item.className = "pass";
    item.textContent = `PASS — ${name}`;
  } catch (error) {
    item.className = "fail";
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? ` [${error.code}]` : "";
    item.textContent = `FAIL — ${name}${code}: ${error instanceof Error ? error.message : String(error)}`;
  }
  results.append(item);
}

async function closeSandbox(sandbox: SkinExtensionSandboxHandle): Promise<void> {
  sandbox.close("harness-complete");
  await sandbox.stopped;
}

async function waitForReady(sandbox: SkinExtensionSandboxHandle): Promise<void> {
  try { await sandbox.ready; }
  catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} (reason: ${sandbox.closeReason ?? "unknown"})`);
  }
}

await test("production extension runtime remains disabled", async () => {
  assert(SKIN_EXTENSION_RUNTIME_ENABLED === false, "Executable extensions must remain disabled.");
  assert(SKIN_EXTENSION_WASM_RUNTIME_ENABLED === false, "The Wasm prototype must remain disabled in production.");
});

await test("a data worker inherits network CSP and can be terminated while its owner stays responsive", async () => {
  await fetch("http://127.0.0.1:5176/reset");
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-workerprobe' data:; worker-src data:; connect-src 'none'; base-uri 'none'">
    <script nonce="workerprobe">
      const source = "(async () => { let blocked = false; try { await fetch('http://127.0.0.1:5176/probe'); } catch { blocked = true; } self.postMessage({ started: true, hasDom: typeof self.document !== 'undefined', fetchBlocked: blocked }); while (true) {} })();";
      const worker = new Worker("data:text/javascript;base64," + btoa(source), { type: "module" });
      worker.onmessage = (event) => { parent.postMessage({ __skinHarness: "worker", ...event.data }, "*"); setTimeout(() => { worker.terminate(); parent.postMessage({ __skinHarness: "workerTerminated" }, "*"); }, 100); };
      worker.onerror = () => parent.postMessage({ __skinHarness: "workerError" }, "*");
    <\/script>`;
  document.body.append(frame);
  try {
    const workerResult = await waitForSourceMessage(frame.contentWindow!, "worker") as Record<string, unknown>;
    assert(workerResult.hasDom === false, "The worker unexpectedly received a DOM.");
    await waitForSourceMessage(frame.contentWindow!, "workerTerminated");
    const probeCount = await fetch("http://127.0.0.1:5176/count").then((response) => response.json()) as { hits?: unknown };
    assert(workerResult.fetchBlocked === true && probeCount.hits === 0, `The worker reached the network probe or did not fail closed: ${JSON.stringify({ workerResult, probeCount })}`);
  } finally {
    frame.remove();
  }
});

await test("opaque-origin sandbox still permits its own URL navigation", async () => {
  await fetch("http://127.0.0.1:5176/reset");
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-frameprobe'; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'; navigate-to 'none'">
    <script nonce="frameprobe">setTimeout(() => location.replace('http://127.0.0.1:5176/probe?source=frame-navigation'), 0);</script>`;
  document.body.append(frame);
  try {
    let hits = 0;
    const deadline = performance.now() + 2_000;
    while (performance.now() < deadline && hits === 0) {
      const result = await fetch("http://127.0.0.1:5176/count").then((response) => response.json()) as { hits?: unknown };
      if (typeof result.hits === "number") hits = result.hits;
      if (hits === 0) await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    assert(hits === 1, "The sandboxed document did not navigate to the loopback-only probe; review whether browser navigation policy changed.");
    assert(frame.isConnected, "The probe navigation must remain scoped to the nested test browsing context.");
  } finally {
    frame.remove();
  }
});

await test("the development Wasm prototype bounds linear memory at 64 pages", async () => {
  const { sandbox } = wasmExtension(createSkinExtensionWasmCappedRunProbe());
  try {
    await sandbox.ready;
    const result = await sandbox.result;
    equal(result.result, -1, "memory.grow must fail when it would exceed the host maximum");
    equal(result.linearMemoryBytes, 64 * 64 * 1024, "the run must stop at the configured 4 MiB linear-memory cap");
    equal(sandbox.closeReason, "completed", "a bounded run should finish normally");
  } finally {
    sandbox.close("test-complete");
    await sandbox.stopped;
  }
});

await test("Wasm can return one bounded UTF-8 UI payload to the host", async () => {
  const { sandbox } = wasmExtension(createSkinExtensionWasmUiOutputProbe());
  try {
    await sandbox.ready;
    const result = await sandbox.result;
    equal(result.uiOutput, '{"type":"root"}', "the host should receive the exact bounded UI payload");
    equal(result.result, 7, "the ordinary scalar return value should remain available");
  } finally {
    sandbox.close("test-complete");
    await sandbox.stopped;
  }
});

await test("Wasm UI output is rejected when it exceeds the host byte limit", async () => {
  const { sandbox } = wasmExtension(createSkinExtensionWasmUiOutputProbe("x".repeat(16 * 1024 + 1)));
  try {
    await sandbox.ready;
    await rejects(sandbox.result, "SKIN_EXTENSION_WASM_UI_OUTPUT_INVALID", "oversized UI output must fail closed");
    await sandbox.stopped;
  } finally {
    sandbox.close("test-complete");
    await sandbox.stopped;
  }
});

await test("Wasm UI output rejects malformed JSON and repeated emissions", async () => {
  for (const bytes of [
    createSkinExtensionWasmUiOutputProbe("not-json"),
    createSkinExtensionWasmUiOutputProbe('{"type":"root"}', true),
  ]) {
    const { sandbox } = wasmExtension(bytes);
    try {
      await sandbox.ready;
      await rejects(sandbox.result, "SKIN_EXTENSION_WASM_UI_OUTPUT_INVALID", "invalid UI output must fail closed");
      await sandbox.stopped;
    } finally {
      sandbox.close("test-complete");
      await sandbox.stopped;
    }
  }
});

await test("Wasm complexity limits reject too many functions and oversized bodies before Worker creation", async () => {
  throws(() => wasmExtension(createSkinExtensionWasmTooManyFunctionsProbe()), "SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT",
    "the host must reject an excessive function count before starting a Worker");
  throws(() => wasmExtension(createSkinExtensionWasmOversizedFunctionBodyProbe()), "SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT",
    "the host must reject an oversized function body before starting a Worker");
});

await test("Wasm preflight rejects GC allocations and oversized signatures or locals before interpretation", async () => {
  const gcAllocation = createSkinExtensionWasmGcAllocationProbe();
  assert(WebAssembly.validate(gcAllocation), "The browser must recognize the GC allocation fixture for this boundary test.");
  throws(() => wasmExtension(gcAllocation), "SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE",
    "a GC allocation must not bypass the bounded linear-memory policy");
  throws(() => wasmExtension(createSkinExtensionWasmOversizedSignatureProbe()), "SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT",
    "an oversized type vector must be rejected before entering the interpreter");
  throws(() => wasmExtension(createSkinExtensionWasmOversizedLocalProbe()), "SKIN_EXTENSION_WASM_COMPLEXITY_LIMIT",
    "an oversized local vector must be rejected before interpretation");
  throws(() => wasmExtension(createSkinExtensionWasmOversizedElementVectorProbe()), "SKIN_EXTENSION_WASM_RESOURCE_DECLARATION",
    "an unsupported element segment must be rejected before interpretation");
});

await test("Wasm preflight parses signed integer immediates without mistaking them for opcodes", async () => {
  const { sandbox } = wasmExtension(createSkinExtensionWasmPrefixByteImmediateProbe());
  try {
    await sandbox.ready;
    const result = await sandbox.result;
    equal(result.result, 123, "a legal signed LEB immediate containing 0xfb should still run");
    equal(sandbox.closeReason, "completed", "the scalar function should finish normally");
  } finally {
    sandbox.close("test-complete");
    await sandbox.stopped;
  }
});

await test("the Wasm capability proxy requires approval and exposes only a sanitized snapshot", async () => {
  const denied = wasmExtension(createSkinExtensionWasmStatusProbe());
  await rejects(denied.sandbox.ready, "SKIN_EXTENSION_WASM_PERMISSION_INVALID", "an unapproved capability import must be rejected");
  await denied.sandbox.stopped;
  equal(denied.statusReads, 0, "a denied module must not reach the host data provider");

  const approved = wasmExtension(createSkinExtensionWasmStatusProbe(), ["session.status.read"]);
  try {
    await approved.sandbox.ready;
    const result = await approved.sandbox.result;
    equal(approved.statusReads, 1, "the host provider should be called only after the approved import is requested");
    equal(approved.sandbox.capabilityRequests, 1, "the approved status import should be requested once");
    equal(result.statusReadCount, 1, "the status import should be read once");
    deepEqual(result.sessionSnapshot, { connected: true, channelName: "Quiet Zone", memberCount: 2 }, "the extension should receive only the sanitized snapshot");
  } finally {
    approved.sandbox.close("test-complete");
    await approved.sandbox.stopped;
  }
});

await test("revoking a Wasm capability aborts pending host data work", async () => {
  const provider = { signal: null as AbortSignal | null };
  const pendingStatus = (signal: AbortSignal) => new Promise<SkinExtensionSessionStatus>((_resolve, reject) => {
    provider.signal = signal;
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const { sandbox } = wasmExtension(createSkinExtensionWasmStatusProbe(), ["session.status.read"], pendingStatus);
  try {
    await waitFor(() => sandbox.capabilityRequests === 1);
    sandbox.revokePermission("session.status.read");
    await sandbox.stopped;
    assert(provider.signal?.aborted === true, "revocation did not abort the pending host data provider");
    equal(sandbox.closeReason, "permission-revoked:session.status.read", "revocation should stop the pending Wasm request");
  } finally {
    sandbox.close("test-complete");
    await sandbox.stopped;
  }
});

await test("Wasm code cannot rewrite the host-owned session snapshot returned to the host", async () => {
  const approved = wasmExtension(createSkinExtensionWasmStatusMutationProbe(), ["session.status.read"]);
  try {
    await approved.sandbox.ready;
    const result = await approved.sandbox.result;
    equal(result.statusReadCount, 1, "the module should invoke the approved status import once");
    deepEqual(result.sessionSnapshot, { connected: true, channelName: "Quiet Zone", memberCount: 2 }, "the host result should come from the trusted provider rather than mutable Wasm memory");
  } finally {
    approved.sandbox.close("test-complete");
    await approved.sandbox.stopped;
  }
});

await test("the interpreter fuel budget stops a Wasm export that does not return", async () => {
  const { sandbox } = wasmExtension(createSkinExtensionWasmInfiniteRunProbe());
  try {
    await sandbox.ready;
    await rejects(sandbox.result, "SKIN_EXTENSION_WASM_EXECUTION_LIMIT", "the interpreter should stop the non-returning export at its fuel limit");
    await sandbox.stopped;
    equal(sandbox.closed, true, "the fuel-limited extension should be closed");
    equal(sandbox.closeReason, "worker-error", "the close reason should identify the interpreter's fuel trap");
  } finally {
    sandbox.close("test-complete");
    await sandbox.stopped;
  }
});

await test("Wasm start functions are rejected before interpreter startup", async () => {
  throws(() => wasmExtension(createSkinExtensionWasmInfiniteStartProbe()), "SKIN_EXTENSION_WASM_UNSUPPORTED_FEATURE",
    "a module start function must be rejected before it can delay the worker startup path");
});

await test("revoking a Wasm capability terminates its running worker", async () => {
  const { sandbox } = wasmExtension(createSkinExtensionWasmInfiniteRunProbe(), ["session.status.read"]);
  try {
    await sandbox.ready;
    sandbox.revokePermission("session.status.read");
    await sandbox.stopped;
    equal(sandbox.closed, true, "revocation should close the Wasm worker");
    equal(sandbox.closeReason, "permission-revoked:session.status.read", "revocation should be recorded as the close reason");
  } finally {
    sandbox.close("test-complete");
    await sandbox.stopped;
  }
});

await test("worker code cannot access host DOM/storage, import same-origin code, use network, or navigate the shell", async () => {
  await fetch("http://127.0.0.1:5176/reset");
  const instance = extension(["session.status.read"], `
    if (typeof globalThis.document !== "undefined" || typeof globalThis.window !== "undefined"
      || typeof globalThis.parent !== "undefined" || typeof globalThis.localStorage !== "undefined"
      || typeof globalThis.fetch !== "undefined" || typeof globalThis.Worker !== "undefined"
      || typeof globalThis.WebSocket !== "undefined" || typeof globalThis.WebAssembly !== "undefined") {
      throw new Error("A restricted worker global remained available.");
    }
    let sameOriginModuleLoaded = false;
    try {
      await import("http://127.0.0.1:5175/test/skin-extension-same-origin-probe.mjs");
      sameOriginModuleLoaded = true;
    } catch {}
    if (sameOriginModuleLoaded) await globalThis.WebSpeakExtension.request("network.fetch").catch(() => {});
    if (typeof globalThis.fetch === "function") {
      try { await globalThis.fetch("http://127.0.0.1:5176/probe"); } catch {}
    }
    self.postMessage({ type: "navigate", url: "http://127.0.0.1:5176/probe" });
    await globalThis.WebSpeakExtension.request("session.status.read").catch(() => {});
  `);
  const { sandbox } = instance;
  await waitForReady(sandbox);
  await waitFor(() => instance.statusReads === 1);
  const probeCount = await fetch("http://127.0.0.1:5176/count").then((response) => response.json()) as { hits?: unknown };
  assert(sandbox.frame.getAttribute("sandbox") === "allow-scripts", "The frame received extra sandbox privileges.");
  assert(sandbox.frame.contentDocument === null, "The host can access the opaque-origin frame document.");
  assert(sandbox.rejectedRequests === 0, "The worker imported same-origin code and reached the host API proxy.");
  assert(probeCount.hits === 0, "The extension reached the network probe.");
  assert(!sandbox.closed && sandbox.frame.isConnected, "A worker message navigated or replaced the shell frame.");
  await closeSandbox(sandbox);
});

await test("a forged hello from a different opaque iframe cannot claim the sandbox channel", async () => {
  const staging = document.createElement("div");
  const instance = extension(["session.status.read"], `
    await globalThis.WebSpeakExtension.request("session.status.read").catch(() => {});
  `, staging);
  const { sandbox } = instance;
  const nonce = /const nonce = "([a-f0-9]{64})";/.exec(sandbox.frame.srcdoc)?.[1];
  assert(nonce, "The test could not read the prototype handshake nonce.");

  const rogue = document.createElement("iframe");
  rogue.setAttribute("sandbox", "allow-scripts");
  const spoofedMessage = {
    channel: "webspeak.skin-extension",
    apiVersion: 1,
    nonce,
    type: "hello",
  };
  const observed = waitForWindowMessage((event) => event.source === rogue.contentWindow
    && event.origin === "null" && event.data?.type === "hello");
  rogue.srcdoc = `<script>const channel = new MessageChannel(); parent.postMessage(${JSON.stringify(spoofedMessage)}, "*", [channel.port1]); channel.port2.close();</script>`;
  document.body.append(rogue);

  try {
    const event = await observed;
    assert(event.ports.length === 1, "The spoof did not include the transferable port it was trying to claim.");
    assert(!sandbox.closed, "A wrong-source hello closed the legitimate extension runtime.");
    host.append(staging);
    await waitForReady(sandbox);
    await waitFor(() => instance.statusReads === 1);
    assert(!sandbox.closed && instance.statusReads === 1, "The legitimate iframe could not complete the handshake after the spoof attempt.");
    await closeSandbox(sandbox);
  } finally {
    rogue.remove();
    staging.remove();
    if (!sandbox.closed) await closeSandbox(sandbox);
  }
});

await test("undeclared capabilities are denied without reaching the host provider", async () => {
  const instance = extension([], `
    await globalThis.WebSpeakExtension.request("session.status.read").catch(() => {});
  `);
  const { sandbox } = instance;
  await waitForReady(sandbox);
  await waitFor(() => sandbox.rejectedRequests === 1);
  assert(instance.statusReads === 0, "The unapproved capability reached the host provider.");
  await closeSandbox(sandbox);
});

await test("revoking an approved capability terminates the worker and closes the channel", async () => {
  const instance = extension(["session.status.read"], `
    setInterval(() => globalThis.WebSpeakExtension.request("session.status.read").catch(() => {}), 100);
  `);
  const { sandbox } = instance;
  await waitForReady(sandbox);
  await waitFor(() => instance.statusReads > 0);
  sandbox.revokePermission("session.status.read");
  await sandbox.stopped;
  assert(sandbox.closed && !sandbox.frame.isConnected, "Revocation did not remove the running frame.");
  assert(sandbox.closeReason === "permission-revoked:session.status.read", "Revocation did not record the reason.");
  const statusReadsAtRevoke = instance.statusReads;
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  assert(instance.statusReads === statusReadsAtRevoke, "Host calls continued after permission revocation.");
});

await test("revoking an approved capability aborts pending host status work", async () => {
  const provider = { signal: null as AbortSignal | null };
  const pendingStatus = (signal: AbortSignal) => new Promise<SkinExtensionSessionStatus>((_resolve, reject) => {
    provider.signal = signal;
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const instance = extension(["session.status.read"], `
    await globalThis.WebSpeakExtension.request("session.status.read").catch(() => {});
  `, host, pendingStatus);
  const { sandbox } = instance;
  try {
    await waitForReady(sandbox);
    await waitFor(() => provider.signal !== null);
    sandbox.revokePermission("session.status.read");
    await sandbox.stopped;
    assert(provider.signal?.aborted === true, "revocation did not abort the pending host data provider");
    assert(sandbox.closeReason === "permission-revoked:session.status.read", "revocation should stop the pending host request");
  } finally {
    if (!sandbox.closed) await closeSandbox(sandbox);
  }
});

await test("a burst of API calls terminates the extension", async () => {
  const instance = extension(["session.status.read"], `
    for (let index = 0; index < 20; index += 1) {
      globalThis.WebSpeakExtension.request("session.status.read").catch(() => {});
    }
  `);
  const { sandbox } = instance;
  await waitForReady(sandbox);
  await waitFor(() => sandbox.closed);
  await sandbox.stopped;
  assert(sandbox.closeReason === "message-rate-exceeded", "The rate limiter did not terminate a flooding extension.");
});

await test("the host can terminate a worker stuck in an infinite loop", async () => {
  const instance = extension(["session.status.read"], `
    void globalThis.WebSpeakExtension.request("session.status.read").catch(() => {});
    while (true) {}
  `);
  const { sandbox } = instance;
  await waitForReady(sandbox);
  await waitFor(() => instance.statusReads === 1);
  sandbox.close("cpu-abuse-probe");
  await sandbox.stopped;
  assert(sandbox.closed && !sandbox.frame.isConnected, "The host could not stop the busy worker and remove its shell.");
});
