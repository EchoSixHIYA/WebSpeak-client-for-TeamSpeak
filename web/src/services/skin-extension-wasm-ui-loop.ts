import {
  parseSkinExtensionUiInput,
  type SkinExtensionUiInput,
} from "../../../src/shared/skin-extension-ui-input.js";
import { parseSkinExtensionUiOutput } from "../../../src/shared/skin-extension-ui.js";
import type { SkinPluginComponent, SkinPluginDocument } from "../../../src/shared/skin-plugin.js";
import type { SkinExtensionWasmSandboxResult } from "./skin-extension-wasm-sandbox.js";

export const SKIN_EXTENSION_WASM_UI_EVENT_QUEUE_LIMIT = 8;

export interface SkinExtensionWasmUiLoopRunHandle {
  result: Promise<Pick<SkinExtensionWasmSandboxResult, "uiOutput">>;
  close(reason?: string): void;
}

export interface SkinExtensionWasmUiLoopOptions {
  /** Creates one bounded, disposable Wasm job for the supplied UI input. */
  createRun(input: SkinExtensionUiInput): SkinExtensionWasmUiLoopRunHandle;
  /** Supplies manifest permissions when generated output may embed a privileged host widget. */
  parseOutput?(output: string): SkinPluginDocument;
  onOutput?(output: string, document: SkinPluginDocument, input: SkinExtensionUiInput): void | Promise<void>;
  onError?(error: Error): void;
}

export class SkinExtensionWasmUiLoopError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinExtensionWasmUiLoopError";
  }
}

function isDeclaredCallback(component: SkinPluginComponent, handlerId: string, eventName: string): boolean {
  let found = false;
  const visit = (node: SkinPluginComponent["root"]): void => {
    if (node.events?.[eventName as keyof typeof node.events] === handlerId) found = true;
    node.children?.forEach(visit);
  };
  visit(component.root);
  return found;
}

function acceptsEvent(document: SkinPluginDocument | null, input: SkinExtensionUiInput): boolean {
  const event = input.event;
  if (!document || !event) return false;
  const component = document.components.find((candidate) => candidate.id === event.componentId);
  if (!component?.runtimeCallbacks || !component.state) return false;
  if (Object.keys(input.state).some((key) => !Object.hasOwn(component.state!, key))) return false;
  return isDeclaredCallback(component, event.handlerId, event.eventName);
}

/**
 * Development-only callback lifecycle. Every event starts a fresh bounded job;
 * plugin memory and execution state never persist outside the explicit scalar UI state.
 */
export function createSkinExtensionWasmUiLoopPrototype(options: SkinExtensionWasmUiLoopOptions) {
  let started = false;
  let closed = false;
  let running = false;
  let output: string | null = null;
  let document: SkinPluginDocument | null = null;
  let lastState: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>;
  let activeRun: SkinExtensionWasmUiLoopRunHandle | null = null;
  const queue: Array<{ input: SkinExtensionUiInput; kind: "event" | "refresh"; resolve: Array<(ran: boolean) => void> }> = [];

  function report(error: unknown): void {
    try { options.onError?.(error instanceof Error ? error : new Error("The bounded Wasm UI callback failed.")); }
    catch { /* Host diagnostics must not interrupt queued callback cleanup. */ }
  }

  async function execute(input: SkinExtensionUiInput): Promise<boolean> {
    let run: SkinExtensionWasmUiLoopRunHandle | null = null;
    try {
      run = options.createRun(input);
      activeRun = run;
      const result = await run.result;
      if (closed || activeRun !== run) return false;
      lastState = { ...input.state };
      if (result.uiOutput !== null) {
        const nextDocument = options.parseOutput?.(result.uiOutput) ?? parseSkinExtensionUiOutput(result.uiOutput);
        output = result.uiOutput;
        document = nextDocument;
        await options.onOutput?.(output, nextDocument, input);
      }
      return true;
    } catch (error) {
      if (!closed) report(error);
      return false;
    } finally {
      if (activeRun === run) activeRun = null;
    }
  }

  async function drain(): Promise<void> {
    if (running || closed) return;
    running = true;
    try {
      while (queue.length && !closed) {
        const pending = queue.shift()!;
        const accepted = pending.kind === "refresh"
          ? pending.input.event === null
          : acceptsEvent(document, pending.input);
        if (!accepted) {
          pending.resolve.forEach((resolve) => resolve(false));
          continue;
        }
        const ran = await execute(pending.input);
        pending.resolve.forEach((resolve) => resolve(ran));
      }
    } finally {
      running = false;
      if (queue.length && !closed) void drain();
    }
  }

  return {
    get output() { return output; },
    get pendingEventCount() { return queue.filter((item) => item.kind === "event").length; },
    get running() { return running || activeRun !== null; },
    get closed() { return closed; },
    async start(): Promise<boolean> {
      if (started || closed) throw new SkinExtensionWasmUiLoopError("SKIN_EXTENSION_WASM_UI_LOOP_STATE", "The Wasm UI loop has already started or closed.");
      started = true;
      const initialInput = parseSkinExtensionUiInput({ schemaVersion: 1, state: {}, event: null });
      return execute(initialInput);
    },
    dispatch(inputValue: unknown): Promise<boolean> {
      if (!started || closed) return Promise.resolve(false);
      let input: SkinExtensionUiInput;
      try { input = parseSkinExtensionUiInput(inputValue); }
      catch { return Promise.resolve(false); }
      if (!acceptsEvent(document, input) || queue.length >= SKIN_EXTENSION_WASM_UI_EVENT_QUEUE_LIMIT) return Promise.resolve(false);
      const result = new Promise<boolean>((resolve) => queue.push({ input, kind: "event", resolve: [resolve] }));
      void drain();
      return result;
    },
    refresh(): Promise<boolean> {
      if (!started || closed) return Promise.resolve(false);
      const input = parseSkinExtensionUiInput({ schemaVersion: 1, state: { ...lastState }, event: null });
      const queued = queue.find((item) => item.kind === "refresh");
      if (queued) {
        queued.input = input;
        return new Promise<boolean>((resolve) => queued.resolve.push(resolve));
      }
      if (queue.length >= SKIN_EXTENSION_WASM_UI_EVENT_QUEUE_LIMIT) return Promise.resolve(false);
      const result = new Promise<boolean>((resolve) => queue.push({ input, kind: "refresh", resolve: [resolve] }));
      void drain();
      return result;
    },
    close(reason = "closed"): void {
      if (closed) return;
      closed = true;
      queue.splice(0).forEach((pending) => pending.resolve.forEach((resolve) => resolve(false)));
      activeRun?.close(reason);
      activeRun = null;
    },
  };
}
