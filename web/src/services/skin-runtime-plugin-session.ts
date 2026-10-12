import type { SkinRuntimePlugin } from "../../../src/shared/skin-runtime-plugins.js";
import { parseSkinExtensionUiActionRequest, parseSkinExtensionUiOutput } from "../../../src/shared/skin-extension-ui.js";
import type { SkinExtensionUiInput, SkinExtensionUiEventInput } from "../../../src/shared/skin-extension-ui-input.js";
import type { SkinPluginActionDefinition, SkinPluginDocument } from "../../../src/shared/skin-plugin.js";
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

const HOST_ACTION_EVENT_NAMES = new Set(["click", "dblclick", "submit", "keydown", "keyup", "contextmenu", "pointerdown", "pointerup", "drop"]);

function assertExplicitUserActivation(event: SkinExtensionUiEventInput): void {
  if (!HOST_ACTION_EVENT_NAMES.has(event.eventName)) {
    throw new SkinRuntimePluginSessionError("SKIN_RUNTIME_PLUGIN_ACTION_EVENT_INVALID", "Host actions require an explicit user activation event.");
  }
  if ((event.eventName === "keydown" || event.eventName === "keyup") && !["Enter", " ", "Escape"].includes(event.key ?? "")) {
    throw new SkinRuntimePluginSessionError("SKIN_RUNTIME_PLUGIN_ACTION_KEY_INVALID", "Host actions may only use Enter, Space, or Escape key events.");
  }
}

export interface SkinRuntimePluginSessionOptions {
  plugin: SkinRuntimePlugin;
  createRun(input: SkinExtensionUiInput): SkinExtensionWasmUiLoopRunHandle;
  onOutput?(output: string, document: SkinPluginDocument): void | Promise<void>;
  onAction?(action: SkinPluginActionDefinition, event: SkinExtensionUiEventInput): void | Promise<void>;
  onError?(error: Error): void;
}

/** Binds one authorized v4 descriptor to its page and surface contract. */
export function createSkinRuntimePluginSession(options: SkinRuntimePluginSessionOptions) {
  let output: string | null = null;
  const loop = createSkinExtensionWasmUiLoopPrototype({
    createRun: options.createRun,
    parseOutput: (source) => parseSkinExtensionUiOutput(source, { permissions: options.plugin.permissions }),
    onOutput: async (nextOutput, document, input) => {
      if (document.components.some((component) => component.page !== options.plugin.page)) {
        throw new SkinRuntimePluginSessionError("SKIN_RUNTIME_PLUGIN_PAGE_MISMATCH", "Generated UI must stay on the page declared by its plugin.");
      }
      if (options.plugin.mode === "surface" && document.components.length !== 1) {
        throw new SkinRuntimePluginSessionError("SKIN_RUNTIME_PLUGIN_SURFACE_OUTPUT_INVALID", "A surface plugin must generate exactly one root component.");
      }
      const action = parseSkinExtensionUiActionRequest(nextOutput, options.plugin.permissions);
      if (action) {
        if (action.type === "voice.startScreenShare") {
          throw new SkinRuntimePluginSessionError(
            "SKIN_RUNTIME_PLUGIN_USER_ACTIVATION_REQUIRED",
            "Starting screen capture must use the trusted host control so the browser receives the user's activation.",
          );
        }
        if (!input.event) {
          throw new SkinRuntimePluginSessionError("SKIN_RUNTIME_PLUGIN_ACTION_WITHOUT_EVENT", "A host action can only follow a trusted UI event.");
        }
        assertExplicitUserActivation(input.event);
        if (!options.onAction) {
          throw new SkinRuntimePluginSessionError("SKIN_RUNTIME_PLUGIN_ACTION_UNAVAILABLE", "The host action bridge is unavailable.");
        }
        await options.onAction(action, input.event);
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
    refresh: () => loop.refresh(),
    close: (reason?: string) => loop.close(reason),
  };
}
