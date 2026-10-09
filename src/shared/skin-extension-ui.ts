import {
  parseSkinPluginDocument,
  type SkinPluginAction,
  type SkinPluginDocument,
  type SkinPluginNode,
} from "./skin-plugin.js";

export const SKIN_EXTENSION_UI_OUTPUT_LIMIT_BYTES = 16 * 1024;

const LOCAL_UI_ACTIONS = new Set<SkinPluginAction>(["ui.setState", "ui.toggleState"]);

export class SkinExtensionUiOutputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinExtensionUiOutputError";
  }
}

function fail(code: string, message: string): never {
  throw new SkinExtensionUiOutputError(code, message);
}

function assertLocalUiNode(node: SkinPluginNode): void {
  if (node.widget) fail("SKIN_EXTENSION_UI_WIDGET_UNSUPPORTED", "Extension UI output cannot embed privileged host widgets.");
  node.children?.forEach(assertLocalUiNode);
}

/** Parses Wasm output into the existing safe component tree, with no added host capabilities. */
export function parseSkinExtensionUiOutput(source: string): SkinPluginDocument {
  if (typeof source !== "string" || !source.length) {
    fail("SKIN_EXTENSION_UI_OUTPUT_INVALID", "Extension UI output must be a non-empty JSON string.");
  }
  if (new TextEncoder().encode(source).byteLength > SKIN_EXTENSION_UI_OUTPUT_LIMIT_BYTES) {
    fail("SKIN_EXTENSION_UI_OUTPUT_SIZE", "Extension UI output exceeds the 16 KiB UTF-8 limit.");
  }

  let input: unknown;
  try { input = JSON.parse(source); }
  catch { fail("SKIN_EXTENSION_UI_OUTPUT_JSON", "Extension UI output must contain valid JSON."); }

  let document: SkinPluginDocument;
  try { document = parseSkinPluginDocument(input); }
  catch { fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Extension UI output does not match the safe component schema."); }
  if (document.schemaVersion !== 3) {
    fail("SKIN_EXTENSION_UI_SCHEMA_UNSUPPORTED", "Extension UI output requires components schema version 3.");
  }

  for (const component of document.components) {
    if (component.page === "demo" || component.mode === "surface" || component.permissions.length > 0) {
      fail("SKIN_EXTENSION_UI_CAPABILITY_UNSUPPORTED", "Extension UI output cannot request skin permissions or replace a page.");
    }
    if (Object.values(component.actions).some((action) => !LOCAL_UI_ACTIONS.has(action.type))) {
      fail("SKIN_EXTENSION_UI_ACTION_UNSUPPORTED", "Extension UI output can only update its own local UI state.");
    }
    assertLocalUiNode(component.root);
  }
  return document;
}
