import type { SkinRuntimePlugin } from "../../../src/shared/skin-runtime-plugins.js";
import type { SkinExtensionUiInput } from "../../../src/shared/skin-extension-ui-input.js";
import type { SkinPluginDocument } from "../../../src/shared/skin-plugin.js";
import {
  createSkinExtensionWasmUiLoopPrototype,
  type SkinExtensionWasmUiLoopRunHandle,
} from "./skin-extension-wasm-ui-loop.js";

export class SkinRuntimePluginSessionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinRuntimePluginSessionError";
  }
}

export interface SkinRuntimePluginSessionOptions {
  plugin: SkinRuntimePlugin;
  createRun(input: SkinExtensionUiInput): SkinExtensionWasmUiLoopRunHandle;
  onOutput?(output: string, document: SkinPluginDocument): void | Promise<void>;
  onError?(error: Error): void;
}

/** Binds one authorized v4 descriptor to its page and surface contract. */
export function createSkinRuntimePluginSession(options: SkinRuntimePluginSessionOptions) {
  let output: string | null = null;
  const loop = createSkinExtensionWasmUiLoopPrototype({
    createRun: options.createRun,
    onOutput: async (nextOutput, document) => {
      if (document.components.some((component) => component.page !== options.plugin.page)) {
        throw new SkinRuntimePluginSessionError("SKIN_RUNTIME_PLUGIN_PAGE_MISMATCH", "Generated UI must stay on the page declared by its plugin.");
      }
      if (options.plugin.mode === "surface" && document.components.length !== 1) {
        throw new SkinRuntimePluginSessionError("SKIN_RUNTIME_PLUGIN_SURFACE_OUTPUT_INVALID", "A surface plugin must generate exactly one root component.");
      }
      output = nextOutput;
      await options.onOutput?.(nextOutput, document);
    },
    onError: options.onError,
  });

  return {
    get output() { return output; },
    get closed() { return loop.closed; },
    get running() { return loop.running; },
    start: () => loop.start(),
    dispatch: (input: unknown) => loop.dispatch(input),
    close: (reason?: string) => loop.close(reason),
  };
}
