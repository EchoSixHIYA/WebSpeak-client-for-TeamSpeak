import {
  SKIN_PLUGIN_PERMISSIONS,
  SKIN_PLUGIN_HOST_WIDGETS,
  missingSkinPluginWidgetPermission,
  parseSkinPluginRuntimeAction,
  SKIN_PLUGIN_NODE_LIMIT,
  SKIN_PLUGIN_TREE_DEPTH_LIMIT,
  parseSkinPluginDocument,
  type SkinPluginAction,
  type SkinPluginActionDefinition,
  type SkinPluginComponent,
  type SkinPluginDocument,
  type SkinPluginNode,
  type SkinPluginHostWidget,
  type SkinPluginPermission,
} from "./skin-plugin.js";
import { parseSkinExtensionUiInput, SKIN_EXTENSION_UI_EVENT_NAMES } from "./skin-extension-ui-input.js";

export const SKIN_EXTENSION_UI_OUTPUT_LIMIT_BYTES = 256 * 1024;

const LOCAL_UI_ACTIONS = new Set<SkinPluginAction>(["ui.setState", "ui.toggleState"]);
const GENERATED_COMPONENT_LIMIT = 64;
const GENERATED_RUNTIME_HOST_WIDGETS = new Set<SkinPluginHostWidget>(["voice.screen-share-start"]);
const GENERATED_CHILD_LIMIT = 256;
const GENERATED_ATTRIBUTE_LIMIT = 64;
const GENERATED_BLOCKED_ELEMENTS = new Set([
  "animate", "animatemotion", "animatetransform", "applet", "base", "embed", "fencedframe", "foreignobject", "frame", "frameset",
  "iframe", "link", "math", "meta", "noembed", "noframes", "object", "plaintext", "portal", "script", "set", "style", "template", "webview", "xmp",
]);
const GENERATED_VOID_ELEMENTS = new Set([
  "br", "col", "hr", "img", "input", "line", "path", "polygon", "polyline", "rect", "stop", "use", "wbr",
]);
const GENERATED_BLOCKED_ATTRIBUTES = new Set([
  "action", "archive", "background", "code", "codebase", "data", "download", "form", "formaction", "formmethod", "formenctype",
  "formtarget", "is", "manifest", "ping", "poster", "profile", "src", "srcdoc", "srcset", "style", "target", "xlink:href",
  "autofocus", "autoplay", "command", "commandfor", "http-equiv", "nonce", "popover", "popovertarget", "popovertargetaction", "slot", "xml:base",
]);

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

function rejectExtensionHostWidgets(node: unknown): void {
  if (!isRecord(node)) return;
  if (node.widget !== undefined) fail("SKIN_EXTENSION_UI_WIDGET_UNSUPPORTED", "Extension UI output cannot embed privileged host widgets.");
  if (Array.isArray(node.children)) node.children.forEach(rejectExtensionHostWidgets);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value: unknown, maximum: number, code: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > maximum) {
    fail(code, `${field} must be bounded non-empty text.`);
  }
  return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", `${context} has an unsupported field.`);
}

function generatedNode(
  input: unknown,
  depth: number,
  count: { value: number },
  allowEvents: boolean,
  page: "home" | "voice",
  permissions: readonly SkinPluginPermission[],
): SkinPluginNode {
  count.value += 1;
  if (count.value > SKIN_PLUGIN_NODE_LIMIT || depth > SKIN_PLUGIN_TREE_DEPTH_LIMIT || !isRecord(input)) {
    fail("SKIN_EXTENSION_UI_COMPLEXITY_LIMIT", "The generated UI tree exceeds its node or depth limit.");
  }
  onlyKeys(input, ["widget", "tag", "text", "part", "className", "attributes", "asset", "children", ...(allowEvents ? ["events"] : [])], "A generated UI node");
  const hasWidget = input.widget !== undefined;
  const hasTag = input.tag !== undefined;
  const hasText = input.text !== undefined;
  if (Number(hasWidget) + Number(hasTag) + Number(hasText) !== 1) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "A generated node must contain exactly one widget, tag, or text.");

  const node: SkinPluginNode = {};
  if (hasWidget) {
    if (typeof input.widget !== "string" || !SKIN_PLUGIN_HOST_WIDGETS.includes(input.widget as SkinPluginHostWidget)
      || !GENERATED_RUNTIME_HOST_WIDGETS.has(input.widget as SkinPluginHostWidget)) {
      fail("SKIN_EXTENSION_UI_WIDGET_UNSUPPORTED", "The generated UI requested a host widget that is not available to runtime plugins.");
    }
    if (page !== "voice") fail("SKIN_EXTENSION_UI_WIDGET_UNSUPPORTED", "The screen-share host widget is available only on the voice page.");
    const widget = input.widget as SkinPluginHostWidget;
    const requiredPermission = missingSkinPluginWidgetPermission(widget, permissions);
    if (requiredPermission) {
      fail("SKIN_EXTENSION_UI_PERMISSION_MISSING", `The ${widget} widget requires ${requiredPermission}.`);
    }
    onlyKeys(input, ["widget", "part", "className"], "A generated host widget node");
    node.widget = widget;
    if (input.part !== undefined) {
      const part = boundedText(input.part, 64, "SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "node.part");
      if (!/^[a-z][a-z0-9-]*$/.test(part)) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "A generated part uses an invalid name.");
      node.part = part;
    }
    if (input.className !== undefined) {
      if (typeof input.className !== "string" || input.className.length > 512 || /[<>\u0000-\u001f]/.test(input.className)) {
        fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Generated class names must be bounded plain text.");
      }
      node.className = input.className;
    }
    return node;
  }
  if (hasText) {
    if (typeof input.text !== "string" || input.text.length > 8_192) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Generated text exceeds its limit.");
    node.text = input.text;
  }
  if (hasTag) {
    const tag = boundedText(input.tag, 64, "SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "node.tag");
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(tag) || GENERATED_BLOCKED_ELEMENTS.has(tag.toLowerCase())) {
      fail("SKIN_EXTENSION_UI_ELEMENT_INVALID", `The generated element '${tag}' is invalid or has active browser capabilities.`);
    }
    node.tag = tag;
  }
  if (input.part !== undefined) {
    const part = boundedText(input.part, 64, "SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "node.part");
    if (!/^[a-z][a-z0-9-]*$/.test(part)) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "A generated part uses an invalid name.");
    node.part = part;
  }
  if (input.className !== undefined) {
    if (typeof input.className !== "string" || input.className.length > 512 || /[<>\u0000-\u001f]/.test(input.className)) {
      fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Generated class names must be bounded plain text.");
    }
    node.className = input.className;
  }
  if (input.attributes !== undefined) {
    if (!isRecord(input.attributes) || Object.keys(input.attributes).length > GENERATED_ATTRIBUTE_LIMIT) {
      fail("SKIN_EXTENSION_UI_ATTRIBUTE_INVALID", "Generated attributes must be a bounded object.");
    }
    const attributes: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>;
    for (const [key, value] of Object.entries(input.attributes)) {
      if (key !== key.toLowerCase() || !/^[a-z][a-z0-9:_-]{0,63}$/.test(key) || key.startsWith("on")
        || key.startsWith("data-ws-") || GENERATED_BLOCKED_ATTRIBUTES.has(key)) {
        fail("SKIN_EXTENSION_UI_ATTRIBUTE_INVALID", `The generated attribute '${key}' is not allowed.`);
      }
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        fail("SKIN_EXTENSION_UI_ATTRIBUTE_INVALID", "Generated attribute values must be scalar.");
      }
      if (typeof value === "string" && value.length > 4_096) fail("SKIN_EXTENSION_UI_ATTRIBUTE_INVALID", "A generated attribute exceeds its size limit.");
      if (key === "href" && (typeof value !== "string" || !/^#[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(value))) {
        fail("SKIN_EXTENSION_UI_ATTRIBUTE_INVALID", "Generated links may only target a same-document fragment.");
      }
      if (["fill", "stroke", "clip-path", "filter", "mask", "marker-start", "marker-mid", "marker-end"].includes(key)
        && typeof value === "string" && /url\s*\(|javascript\s*:/i.test(value)) {
        fail("SKIN_EXTENSION_UI_ATTRIBUTE_INVALID", "SVG attributes cannot load external or executable resources.");
      }
      attributes[key] = value;
    }
    node.attributes = attributes;
    if (node.tag === "input" && typeof attributes.type === "string"
      && ["password", "file", "hidden"].includes(attributes.type.toLowerCase())) {
      fail("SKIN_EXTENSION_UI_ATTRIBUTE_INVALID", "Generated input controls cannot collect password, file, or hidden values.");
    }
  }
  if (input.asset !== undefined) {
    const asset = boundedText(input.asset, 120, "SKIN_EXTENSION_UI_ASSET_INVALID", "node.asset");
    if (node.tag !== "img" || !/^assets\/[A-Za-z0-9._/-]+$/.test(asset) || asset.split("/").some((part) => !part || part === "." || part === "..")) {
      fail("SKIN_EXTENSION_UI_ASSET_INVALID", "Generated image assets must use safe package-relative paths.");
    }
    node.asset = asset;
  }
  if (input.events !== undefined) {
    if (!allowEvents || !isRecord(input.events) || Object.keys(input.events).length > SKIN_EXTENSION_UI_EVENT_NAMES.length) {
      fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Generated event callbacks are supported only by UI output schema 5.");
    }
    const events: NonNullable<SkinPluginNode["events"]> = {};
    for (const [eventName, handlerId] of Object.entries(input.events)) {
      if (!(SKIN_EXTENSION_UI_EVENT_NAMES as readonly string[]).includes(eventName)
        || typeof handlerId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(handlerId)) {
        fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "A generated callback uses an unsupported event or handler ID.");
      }
      events[eventName as keyof typeof events] = handlerId;
    }
    node.events = events;
  }
  if (input.children !== undefined) {
    if (!Array.isArray(input.children) || input.children.length > GENERATED_CHILD_LIMIT) {
      fail("SKIN_EXTENSION_UI_COMPLEXITY_LIMIT", "A generated node has too many children.");
    }
    if (node.tag && GENERATED_VOID_ELEMENTS.has(node.tag) && input.children.length > 0) {
      fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Void generated elements cannot contain children.");
    }
    node.children = input.children.map((child) => generatedNode(child, depth + 1, count, allowEvents, page, permissions));
  }
  return node;
}

function parseGeneratedDocument(
  input: Record<string, unknown>,
  allowEvents: boolean,
  allowRequest = false,
  permissions: readonly SkinPluginPermission[] = [],
): SkinPluginDocument {
  onlyKeys(input, ["schemaVersion", "components", ...(allowRequest ? ["request"] : [])], "Generated UI document");
  if (!Array.isArray(input.components) || input.components.length < 1 || input.components.length > GENERATED_COMPONENT_LIMIT) {
    fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "The generated document has an unsupported component count.");
  }
  const ids = new Set<string>();
  const components: SkinPluginComponent[] = input.components.map((raw, index) => {
    if (!isRecord(raw)) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", `Generated component ${index} must be an object.`);
    onlyKeys(raw, ["id", "name", "page", "accessibleName", "root", ...(allowEvents ? ["state"] : [])], "Generated component");
    const id = boundedText(raw.id, 64, "SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "component.id");
    if (!/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Generated component IDs must be unique lowercase slugs.");
    ids.add(id);
    const name = boundedText(raw.name, 80, "SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "component.name");
    const accessibleName = boundedText(raw.accessibleName, 120, "SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "component.accessibleName");
    if (raw.page !== "home" && raw.page !== "voice") fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Generated components may target only the public home or voice page.");
    const root = generatedNode(raw.root, 1, { value: 0 }, allowEvents, raw.page, permissions);
    if (!root.tag) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "A generated component root must be an element.");
    const state = allowEvents
      ? parseSkinExtensionUiInput({ schemaVersion: 1, state: raw.state ?? {}, event: null }).state
      : undefined;
    return {
      id, name, page: raw.page, accessibleName, permissions: [], actions: Object.create(null) as Record<string, never>, root,
      ...(state ? { state } : {}),
      ...(allowEvents ? { runtimeCallbacks: true } : {}),
    };
  });
  return { schemaVersion: 3, components };
}

function parseOutputInput(source: string): Record<string, unknown> {
  if (typeof source !== "string" || !source.length) {
    fail("SKIN_EXTENSION_UI_OUTPUT_INVALID", "Extension UI output must be a non-empty JSON string.");
  }
  if (new TextEncoder().encode(source).byteLength > SKIN_EXTENSION_UI_OUTPUT_LIMIT_BYTES) {
    fail("SKIN_EXTENSION_UI_OUTPUT_SIZE", "Extension UI output exceeds the 256 KiB UTF-8 limit.");
  }
  let input: unknown;
  try { input = JSON.parse(source); }
  catch { fail("SKIN_EXTENSION_UI_OUTPUT_JSON", "Extension UI output must contain valid JSON."); }
  if (!isRecord(input)) fail("SKIN_EXTENSION_UI_OUTPUT_SCHEMA", "Extension UI output must be an object.");
  return input;
}

/** Parse a single host action effect from schema 6 output and require its permission in the plugin manifest. */
export function parseSkinExtensionUiActionRequest(
  source: string,
  permissions: readonly SkinPluginPermission[],
): SkinPluginActionDefinition | null {
  const input = parseOutputInput(source);
  if (input.schemaVersion !== 6 || input.request === undefined) return null;
  try { return parseSkinPluginRuntimeAction(input.request, permissions); }
  catch { fail("SKIN_EXTENSION_UI_ACTION_INVALID", "The requested host action is malformed or lacks an approved plugin permission."); }
}

/** Parses bounded Wasm output. Schema 5 adds trusted callbacks; schema 6 adds one permission-checked host action effect. */
export function parseSkinExtensionUiOutput(
  source: string,
  options: { permissions?: readonly SkinPluginPermission[] } = {},
): SkinPluginDocument {
  const input = parseOutputInput(source);
  const permissions = options.permissions ?? [];
  if (input.schemaVersion === 4) return parseGeneratedDocument(input, false, false, permissions);
  if (input.schemaVersion === 5) return parseGeneratedDocument(input, true, false, permissions);
  if (input.schemaVersion === 6) {
    const document = parseGeneratedDocument(input, true, true, permissions);
    if (input.request !== undefined) {
      try { parseSkinPluginRuntimeAction(input.request, Object.keys(SKIN_PLUGIN_PERMISSIONS) as SkinPluginPermission[]); }
      catch { fail("SKIN_EXTENSION_UI_ACTION_INVALID", "The generated host action request is malformed."); }
    }
    return document;
  }

  if (input.schemaVersion === 3 && Array.isArray(input.components)) {
    for (const rawComponent of input.components) {
      if (isRecord(rawComponent)) rejectExtensionHostWidgets(rawComponent.root);
    }
  }

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
