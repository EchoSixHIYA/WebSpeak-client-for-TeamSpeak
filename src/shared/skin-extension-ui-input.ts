import {
  projectSkinRuntimePluginContext,
  SKIN_RUNTIME_PLUGIN_DATA_PERMISSIONS,
} from "./skin-runtime-plugin-context.js";

export const SKIN_EXTENSION_UI_INPUT_SCHEMA_VERSION = 1 as const;
export const SKIN_EXTENSION_UI_INPUT_LIMIT_BYTES = 64 * 1024;
export const SKIN_EXTENSION_UI_STATE_KEY_LIMIT = 64;
export const SKIN_EXTENSION_UI_EVENT_NAMES = Object.freeze([
  "click", "dblclick", "change", "input", "submit", "keydown", "keyup", "contextmenu", "focus", "blur",
  "pointerdown", "pointerup", "pointerenter", "pointerleave", "dragstart", "dragover", "drop",
] as const);

export type SkinExtensionUiEventName = typeof SKIN_EXTENSION_UI_EVENT_NAMES[number];
export type SkinExtensionUiScalar = string | number | boolean;

export interface SkinExtensionUiEventInput {
  componentId: string;
  handlerId: string;
  eventName: SkinExtensionUiEventName;
  key?: string;
  value?: string;
  checked?: boolean;
}

export interface SkinExtensionUiInput {
  schemaVersion: typeof SKIN_EXTENSION_UI_INPUT_SCHEMA_VERSION;
  state: Record<string, SkinExtensionUiScalar>;
  event: SkinExtensionUiEventInput | null;
  /** Host-projected public application data; permissions are enforced before this is populated. */
  data?: Record<string, unknown>;
}

export class SkinExtensionUiInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinExtensionUiInputError";
  }
}

function fail(message: string): never {
  throw new SkinExtensionUiInputError("SKIN_EXTENSION_UI_INPUT_INVALID", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanState(value: unknown): Record<string, SkinExtensionUiScalar> {
  if (!isRecord(value) || Object.keys(value).length > SKIN_EXTENSION_UI_STATE_KEY_LIMIT) {
    return fail("UI state must be a bounded scalar object.");
  }
  const state: Record<string, SkinExtensionUiScalar> = Object.create(null) as Record<string, SkinExtensionUiScalar>;
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[a-z][a-zA-Z0-9_.-]{0,63}$/.test(key)
      || (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean")
      || (typeof entry === "string" && entry.length > 1_024)
      || (typeof entry === "number" && (!Number.isFinite(entry) || Math.abs(entry) > 1_000_000_000))) {
      return fail("UI state contains an invalid key or scalar value.");
    }
    state[key] = entry;
  }
  return state;
}

function cleanEvent(value: unknown): SkinExtensionUiEventInput | null {
  if (value === null) return null;
  if (!isRecord(value)) return fail("A UI event must be an object or null.");
  const allowed = ["componentId", "handlerId", "eventName", "key", "value", "checked"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return fail("A UI event contains an unsupported field.");
  const slug = (entry: unknown): entry is string => typeof entry === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(entry);
  if (!slug(value.componentId) || !slug(value.handlerId)
    || typeof value.eventName !== "string"
    || !(SKIN_EXTENSION_UI_EVENT_NAMES as readonly string[]).includes(value.eventName)) {
    return fail("A UI event has an invalid component, handler, or event name.");
  }
  const event: SkinExtensionUiEventInput = {
    componentId: value.componentId,
    handlerId: value.handlerId,
    eventName: value.eventName as SkinExtensionUiEventName,
  };
  if (value.key !== undefined) {
    if (typeof value.key !== "string" || !value.key || value.key.length > 32 || /[\u0000-\u001f]/.test(value.key)) {
      return fail("A UI event key is invalid.");
    }
    if (event.eventName !== "keydown" && event.eventName !== "keyup") return fail("Only keyboard events may carry a key.");
    event.key = value.key;
  }
  if (value.value !== undefined) {
    if (typeof value.value !== "string" || value.value.length > 2_048) return fail("A UI event value exceeds its limit.");
    if (event.eventName !== "input" && event.eventName !== "change") return fail("Only input and change events may carry a value.");
    event.value = value.value;
  }
  if (value.checked !== undefined) {
    if (typeof value.checked !== "boolean") return fail("A UI event checked value must be boolean.");
    if (event.eventName !== "input" && event.eventName !== "change") return fail("Only input and change events may carry a checked value.");
    event.checked = value.checked;
  }
  return event;
}

/** Validates bounded local UI state, one safe event, and a host-projected data snapshot. */
export function parseSkinExtensionUiInput(input: unknown): SkinExtensionUiInput {
  let value = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > SKIN_EXTENSION_UI_INPUT_LIMIT_BYTES) {
      return fail("UI input exceeds its 64 KiB limit.");
    }
    try { value = JSON.parse(input); }
    catch { return fail("UI input must be valid JSON."); }
  }
  if (!isRecord(value) || Object.keys(value).some((key) => !["schemaVersion", "state", "event", "data"].includes(key))
    || value.schemaVersion !== SKIN_EXTENSION_UI_INPUT_SCHEMA_VERSION) {
    return fail("UI input uses an unsupported schema or contains unsupported fields.");
  }
  if (value.data !== undefined && !isRecord(value.data)) return fail("UI data must be a bounded object.");
  const parsed = {
    schemaVersion: SKIN_EXTENSION_UI_INPUT_SCHEMA_VERSION,
    state: cleanState(value.state),
    event: cleanEvent(value.event),
    ...(value.data === undefined ? {} : { data: projectSkinRuntimePluginContext(SKIN_RUNTIME_PLUGIN_DATA_PERMISSIONS, value.data) }),
  } satisfies SkinExtensionUiInput;
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > SKIN_EXTENSION_UI_INPUT_LIMIT_BYTES) {
    return fail("UI input exceeds its 64 KiB limit.");
  }
  return parsed;
}
