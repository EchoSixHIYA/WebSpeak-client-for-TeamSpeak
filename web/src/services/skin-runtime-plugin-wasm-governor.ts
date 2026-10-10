export const SKIN_RUNTIME_PLUGIN_WASM_MAX_CONCURRENT_RUNS = 2;
export const SKIN_RUNTIME_PLUGIN_WASM_MAX_PENDING_RUNS = 64;
export const SKIN_RUNTIME_PLUGIN_WASM_QUEUE_TIMEOUT_MS = 120_000;

export class SkinRuntimePluginWasmGovernorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinRuntimePluginWasmGovernorError";
  }
}

interface Waiter {
  signal: AbortSignal;
  resolve(release: () => void): void;
  reject(error: Error): void;
  onAbort: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SkinRuntimePluginWasmGovernorOptions {
  maxConcurrentRuns: number;
  maxPendingRuns: number;
  queueTimeoutMs: number;
}

/** Fairly limits guest workers across all runtime plugins in this WebClient. */
export function createSkinRuntimePluginWasmGovernor(options: SkinRuntimePluginWasmGovernorOptions) {
  if (!Number.isSafeInteger(options.maxConcurrentRuns) || options.maxConcurrentRuns < 1
    || !Number.isSafeInteger(options.maxPendingRuns) || options.maxPendingRuns < 0
    || !Number.isSafeInteger(options.queueTimeoutMs) || options.queueTimeoutMs < 1) {
    throw new RangeError("The Wasm worker governor requires positive integer limits.");
  }

  let activeRuns = 0;
  const waiters: Waiter[] = [];

  function removeWaiter(waiter: Waiter): void {
    const index = waiters.indexOf(waiter);
    if (index >= 0) waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }

  function lease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeRuns -= 1;
      drain();
    };
  }

  function drain(): void {
    while (activeRuns < options.maxConcurrentRuns && waiters.length > 0) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal.aborted) {
        waiter.reject(new SkinRuntimePluginWasmGovernorError("SKIN_EXTENSION_WASM_QUEUE_CANCELLED", "The plugin run was cancelled while waiting for an execution slot."));
        continue;
      }
      activeRuns += 1;
      waiter.resolve(lease());
    }
  }

  return {
    get activeRuns() { return activeRuns; },
    get pendingRuns() { return waiters.length; },
    acquire(signal: AbortSignal): Promise<() => void> {
      if (signal.aborted) {
        return Promise.reject(new SkinRuntimePluginWasmGovernorError("SKIN_EXTENSION_WASM_QUEUE_CANCELLED", "The plugin run was cancelled before acquiring an execution slot."));
      }
      if (activeRuns < options.maxConcurrentRuns && waiters.length === 0) {
        activeRuns += 1;
        return Promise.resolve(lease());
      }
      if (waiters.length >= options.maxPendingRuns) {
        return Promise.reject(new SkinRuntimePluginWasmGovernorError("SKIN_EXTENSION_WASM_QUEUE_FULL", "Too many skin plugin runs are waiting for an execution slot."));
      }

      return new Promise((resolve, reject) => {
        let waiter!: Waiter;
        const onAbort = () => {
          removeWaiter(waiter);
          reject(new SkinRuntimePluginWasmGovernorError("SKIN_EXTENSION_WASM_QUEUE_CANCELLED", "The plugin run was cancelled while waiting for an execution slot."));
          drain();
        };
        const timer = setTimeout(() => {
          removeWaiter(waiter);
          reject(new SkinRuntimePluginWasmGovernorError("SKIN_EXTENSION_WASM_QUEUE_TIMEOUT", "The plugin run waited too long for an execution slot."));
          drain();
        }, options.queueTimeoutMs);
        waiter = { signal, resolve, reject, onAbort, timer };
        waiters.push(waiter);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

export const skinRuntimePluginWasmGovernor = createSkinRuntimePluginWasmGovernor({
  maxConcurrentRuns: SKIN_RUNTIME_PLUGIN_WASM_MAX_CONCURRENT_RUNS,
  maxPendingRuns: SKIN_RUNTIME_PLUGIN_WASM_MAX_PENDING_RUNS,
  queueTimeoutMs: SKIN_RUNTIME_PLUGIN_WASM_QUEUE_TIMEOUT_MS,
});
