import {
  DECORATIVE_PART_IDS,
  HOST_SKIN_ATTRIBUTE,
  HOST_SLOTTABLE_PART_IDS,
  SKIN_ICON_SLOT_IDS,
  TRUSTED_PART_IDS,
  isHostPart,
} from "./skin-visual-parts.js";

/**
 * `chrome.json` is an optional, declarative companion to an open skin.
 *
 * It describes host-chrome capabilities that CSS alone cannot express safely:
 *  - `visibleParts`: decorations the skin asks the host to render. This is the
 *    only opt-in; official and built-in skins stay clean.
 *  - `hiddenParts`: non-critical decorations the skin wants collapsed by
 *    default. Only explicitly optional parts are accepted.
 *  - `icons`: bitmap overrides for stable icon slots, keyed by part name.
 *  - `slots`: declarative anchors for trusted host controls. A skin never
 *    receives the control; it only names a part it already renders so the
 *    host can position its own top-layer capsule (or, with an explicit
 *    `mode: "toolbar"`, chrome-less host buttons) there and fall back to the
 *    default corner when the anchor stops being usable.
 *
 * Both the browser importer and the server-side registry parse the exact same
 * document, so a package accepted by one is accepted by the other.
 */

export const SKIN_CHROME_MAX_BYTES = 32 * 1024;
export const SKIN_CHROME_MAX_HIDDEN_PARTS = 32;
export const SKIN_CHROME_MAX_ICONS = 16;
export const SKIN_CHROME_MAX_SLOTS = 8;
export const SKIN_CHROME_MAX_SLOT_ANCHORS = 8;
export const SKIN_ICON_MAX_BYTES = 64 * 1024;
export const SKIN_ICONS_MAX_TOTAL_BYTES = 512 * 1024;
export const SKIN_ICON_DIRECTORY = "assets/icons/";

/**
 * Anchor names are `data-ws-part` values, including host-rendered v3 component
 * parts (`skin.<page>.<component>.part-<name>`) and v4 runtime plugin parts
 * (`skin.<page>.runtime_plugin_<plugin>__<component>.part-<name>`). Each
 * dot-separated segment follows the same identifier grammar as other part
 * names; the generous overall limit covers a namespaced runtime plugin.
 */
export const SKIN_SLOT_ANCHOR_MAX_LENGTH = 240;
const PART_NAME_SEGMENT = /^[-_a-z][-_a-z0-9]*$/i;

const SUPPORTED_ICON_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif", "gif"]);

/**
 * Decorative host chrome that is hidden unless a skin explicitly opts in.
 * Official and built-in skins ship no `chrome.json`, so they stay identical to
 * production; a host-chrome pack opts in with `chrome.json#visibleParts`.
 */
export const DEFAULT_HIDDEN_HOST_PARTS: ReadonlySet<string> = new Set([
  "host.watermark",
  "host.hint",
  "host.voice-status-decoration",
]);

export interface SkinChromeDocument {
  schemaVersion: 1;
  hiddenParts: string[];
  /**
   * Parts from `DEFAULT_HIDDEN_HOST_PARTS` (or other decorative parts) that a
   * skin asks the host to render. This is the only opt-in for decorations; a
   * chrome.json that omits it keeps the same clean chrome as built-in skins.
   */
  visibleParts?: string[];
  icons: Record<string, string>;
  /** Protected host controls folded into skin-owned layout anchors. */
  slots?: Partial<Record<string, SkinChromeSlot>>;
}

export type SkinChromeSlotAlign = "start" | "center" | "end";

/**
 * How a slotted recovery control is presented:
 *  - `capsule` (default): the existing rounded host capsule with its own shell.
 *  - `toolbar`: independent, chrome-less host buttons that can match a skin's
 *    top bar. The host still creates the buttons, their labels, focus and
 *    click handlers; the skin only names anchors and style tokens.
 *
 * The mode is explicit and never inferred from `compact`: an old slot without
 * `mode` keeps docking the capsule exactly as before.
 */
export type SkinChromeSlotMode = "capsule" | "toolbar";

/** One anchor name, or ordered candidates (for example one per page). */
export type SkinChromeSlotAnchor = string | string[];

export interface SkinChromeSlot {
  /**
   * Existing `data-ws-part` inside `.ws-skin-root` used as the anchor box.
   * A list lists page/component candidates: the host takes the first visible
   * one, so one slot can cover both the home and the voice page.
   */
  anchor: SkinChromeSlotAnchor;
  /** Horizontal alignment inside the anchor; the control is vertically centred. */
  align: SkinChromeSlotAlign;
  /** Collapse to the mark only until hovered or focused (capsule mode only). */
  compact: boolean;
  /** Explicit presentation; see `SkinChromeSlotMode`. */
  mode: SkinChromeSlotMode;
}

export interface SkinChromeAssetInfo {
  bytes: number;
  mime: string;
}

export class SkinChromeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SkinChromeError";
  }
}

function reject(message: string, code: string): never {
  throw new SkinChromeError(message, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validate and normalize an icon asset path. Only package-local bitmaps under assets/icons/ are allowed. */
export function normalizeSkinIconPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > 160) {
    return reject("An icon path must be a short, non-empty string.", "SKIN_ICON_PATH");
  }
  const path = raw.split(/[?#]/, 1)[0];
  if (!path.startsWith(SKIN_ICON_DIRECTORY)) {
    return reject(`Icon bitmaps must live in ${SKIN_ICON_DIRECTORY}.`, "SKIN_ICON_PATH");
  }
  const segments = path.split("/");
  if (segments.length !== 3 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return reject("An icon path must be a single file inside assets/icons/.", "SKIN_ICON_PATH");
  }
  const filename = segments[2];
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_ICON_EXTENSIONS.has(extension)) {
    return reject("Icon bitmaps must be PNG, JPEG, WebP, AVIF or GIF files (SVG is not allowed).", "SKIN_ICON_PATH");
  }
  if (/[\\:\0%\s]/.test(path) || /^[a-z]:/i.test(path) || path.startsWith("/") || path.includes("//")) {
    return reject("An icon path must be a safe, package-relative path.", "SKIN_ICON_PATH");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) {
    return reject("An icon filename contains unsupported characters.", "SKIN_ICON_PATH");
  }
  return path;
}

/**
 * A slot anchor is an existing part name, never host-owned UI: a skin must not
 * be able to park a protected control on the launcher, the authorization
 * dialog or another trusted element it could then cover or remove.
 */
function normalizeSlotAnchor(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > SKIN_SLOT_ANCHOR_MAX_LENGTH) {
    return reject(`A slot anchor must be a part name of at most ${SKIN_SLOT_ANCHOR_MAX_LENGTH} characters.`, "SKIN_CHROME_SLOT_INVALID");
  }
  const segments = raw.split(".");
  if (segments.some((segment) => !PART_NAME_SEGMENT.test(segment))) {
    return reject(`A slot anchor is not a valid part name: ${raw}.`, "SKIN_CHROME_SLOT_INVALID");
  }
  if (isHostPart(raw) || TRUSTED_PART_IDS.has(raw)) {
    return reject(`A slot anchor cannot point at trusted host UI: ${raw}.`, "SKIN_CHROME_SLOT_INVALID");
  }
  return raw;
}

/**
 * A slot may name one anchor or an ordered candidate list (one per page or
 * per component variant). Candidates are validated exactly like a single
 * anchor; duplicates are removed so a page cannot be tried twice per check.
 */
function normalizeSlotAnchors(raw: unknown): SkinChromeSlotAnchor {
  if (!Array.isArray(raw)) return normalizeSlotAnchor(raw);
  if (!raw.length || raw.length > SKIN_CHROME_MAX_SLOT_ANCHORS) {
    return reject(`A slot anchor list must contain between 1 and ${SKIN_CHROME_MAX_SLOT_ANCHORS} part names.`, "SKIN_CHROME_SLOT_INVALID");
  }
  const anchors: string[] = [];
  for (const entry of raw) {
    const anchor = normalizeSlotAnchor(entry);
    if (!anchors.includes(anchor)) anchors.push(anchor);
  }
  return anchors;
}

function isSlotMode(value: unknown): value is SkinChromeSlotMode {
  return value === "capsule" || value === "toolbar";
}

function isSlotAlign(value: unknown): value is SkinChromeSlotAlign {
  return value === "start" || value === "center" || value === "end";
}

export function parseSkinChromeDocument(source: string): SkinChromeDocument {
  const bytes = new TextEncoder().encode(source).byteLength;
  if (!bytes || bytes > SKIN_CHROME_MAX_BYTES) {
    return reject("chrome.json must be between 1 byte and 32 KiB.", "SKIN_CHROME_SIZE");
  }
  let raw: unknown;
  try { raw = JSON.parse(source); }
  catch { return reject("chrome.json is not valid JSON.", "SKIN_CHROME_INVALID"); }
  if (!isRecord(raw)) return reject("chrome.json must be an object.", "SKIN_CHROME_INVALID");
  for (const key of Object.keys(raw)) {
    if (key !== "schemaVersion" && key !== "hiddenParts" && key !== "visibleParts" && key !== "icons" && key !== "slots") {
      return reject(`chrome.json contains an unsupported field: ${key}.`, "SKIN_CHROME_INVALID");
    }
  }
  if (raw.schemaVersion !== 1) return reject("chrome.json must use schemaVersion 1.", "SKIN_CHROME_INVALID");

  const hiddenParts: string[] = [];
  if (raw.hiddenParts !== undefined) {
    if (!Array.isArray(raw.hiddenParts) || raw.hiddenParts.length > SKIN_CHROME_MAX_HIDDEN_PARTS) {
      return reject("hiddenParts must be an array of at most 32 part names.", "SKIN_CHROME_HIDDEN_INVALID");
    }
    for (const entry of raw.hiddenParts) {
      if (typeof entry !== "string" || !DECORATIVE_PART_IDS.has(entry)) {
        return reject(`Only explicitly optional decorative parts may be hidden: ${String(entry)}.`, "SKIN_CHROME_HIDDEN_INVALID");
      }
      if (!hiddenParts.includes(entry)) hiddenParts.push(entry);
    }
  }

  let visibleParts: string[] | undefined;
  if (raw.visibleParts !== undefined) {
    if (!Array.isArray(raw.visibleParts) || raw.visibleParts.length > SKIN_CHROME_MAX_HIDDEN_PARTS) {
      return reject("visibleParts must be an array of at most 32 part names.", "SKIN_CHROME_VISIBLE_INVALID");
    }
    visibleParts = [];
    for (const entry of raw.visibleParts) {
      if (typeof entry !== "string" || !DECORATIVE_PART_IDS.has(entry)) {
        return reject(`Only explicitly optional decorative parts may be shown: ${String(entry)}.`, "SKIN_CHROME_VISIBLE_INVALID");
      }
      if (!visibleParts.includes(entry)) visibleParts.push(entry);
    }
  }

  const icons: Record<string, string> = Object.create(null) as Record<string, string>;
  if (raw.icons !== undefined) {
    if (!isRecord(raw.icons)) return reject("icons must be an object mapping slot names to asset paths.", "SKIN_ICON_INVALID");
    const entries = Object.entries(raw.icons);
    if (entries.length > SKIN_CHROME_MAX_ICONS) {
      return reject(`A skin may override at most ${SKIN_CHROME_MAX_ICONS} icons.`, "SKIN_ICON_INVALID");
    }
    for (const [slot, path] of entries) {
      if (!SKIN_ICON_SLOT_IDS.has(slot)) {
        return reject(`Unknown icon slot: ${slot}.`, "SKIN_ICON_INVALID");
      }
      icons[slot] = normalizeSkinIconPath(path);
    }
  }
  let slots: Partial<Record<string, SkinChromeSlot>> | undefined;
  if (raw.slots !== undefined) {
    if (!isRecord(raw.slots)) {
      return reject("slots must be an object mapping protected part names to anchors.", "SKIN_CHROME_SLOT_INVALID");
    }
    const entries = Object.entries(raw.slots);
    if (entries.length > SKIN_CHROME_MAX_SLOTS) {
      return reject(`A skin may declare at most ${SKIN_CHROME_MAX_SLOTS} slots.`, "SKIN_CHROME_SLOT_INVALID");
    }
    slots = Object.create(null) as Partial<Record<string, SkinChromeSlot>>;
    for (const [part, value] of entries) {
      if (!HOST_SLOTTABLE_PART_IDS.has(part)) {
        return reject(`Unknown slottable host part: ${part}.`, "SKIN_CHROME_SLOT_INVALID");
      }
      if (!isRecord(value)) {
        return reject(`Slot ${part} must be an object.`, "SKIN_CHROME_SLOT_INVALID");
      }
      for (const key of Object.keys(value)) {
        if (key !== "anchor" && key !== "align" && key !== "compact" && key !== "mode") {
          return reject(`Slot ${part} contains an unsupported field: ${key}.`, "SKIN_CHROME_SLOT_INVALID");
        }
      }
      const anchor = normalizeSlotAnchors(value.anchor);
      const align = value.align === undefined ? "end" : value.align;
      if (!isSlotAlign(align)) {
        return reject(`Slot ${part} has an invalid align value: ${String(align)}.`, "SKIN_CHROME_SLOT_INVALID");
      }
      // The group slot keeps the historical capsule default. The two
      // single-action slots only exist for toolbar presentation; a one-button
      // capsule would be a new, ambiguous surface with no product need.
      const mode = value.mode === undefined
        ? (part === "host.recovery" ? "capsule" : "toolbar")
        : value.mode;
      if (!isSlotMode(mode)) {
        return reject(`Slot ${part} has an invalid mode value: ${String(mode)}.`, "SKIN_CHROME_SLOT_INVALID");
      }
      if (part !== "host.recovery" && mode !== "toolbar") {
        return reject(`Slot ${part} only supports toolbar mode.`, "SKIN_CHROME_SLOT_INVALID");
      }
      const compact = value.compact === undefined ? false : value.compact;
      if (typeof compact !== "boolean") {
        return reject(`Slot ${part} compact must be a boolean.`, "SKIN_CHROME_SLOT_INVALID");
      }
      if (mode === "toolbar" && compact) {
        return reject(`Slot ${part} compact is only valid in capsule mode.`, "SKIN_CHROME_SLOT_INVALID");
      }
      slots[part] = { anchor, align, compact, mode };
    }
    const perAction = slots["host.recovery.built-in"] !== undefined || slots["host.recovery.library"] !== undefined;
    if (slots["host.recovery"] && perAction) {
      return reject(
        "Declare either host.recovery or its per-action slots (host.recovery.built-in / host.recovery.library), not both.",
        "SKIN_CHROME_SLOT_INVALID",
      );
    }
  }

  return {
    schemaVersion: 1,
    hiddenParts,
    ...(visibleParts ? { visibleParts } : {}),
    icons,
    ...(slots ? { slots } : {}),
  };
}

/**
 * Merge the instance default, the skin's explicit opt-ins and its hidden list
 * into the set of optional host parts the host must not render.
 *
 * Decorations are hidden by default so official/built-in skins match
 * production. A pack opts in with `visibleParts`; a pack that ships a
 * chrome.json without that field (icons-only or hiddenParts-only) stays hidden,
 * and `hiddenParts` still wins over both.
 *
 * The decision is intentionally independent of the generated host CSS: the
 * importer appends `compileSkinChromeCss()` output after the author CSS, so
 * sniffing the combined string for `data-ws-part="host.…"` would treat every
 * hiddenParts entry as a declaration that the skin themes host chrome.
 */
export function resolveHiddenHostParts(
  document: SkinChromeDocument | undefined,
  instanceHiddenParts: readonly string[],
): ReadonlySet<string> {
  const hidden = new Set<string>(instanceHiddenParts.filter((part) => DECORATIVE_PART_IDS.has(part)));
  const visible = new Set<string>(document?.visibleParts ?? []);
  for (const part of DEFAULT_HIDDEN_HOST_PARTS) {
    if (!visible.has(part)) hidden.add(part);
  }
  for (const part of document?.hiddenParts ?? []) hidden.add(part);
  return hidden;
}

/** Compile-time path and size validation against the actual package contents. */
export function validateSkinChromeAssets(
  document: SkinChromeDocument,
  lookup: (path: string) => SkinChromeAssetInfo | undefined,
): void {
  let total = 0;
  for (const [slot, path] of Object.entries(document.icons)) {
    const asset = lookup(path);
    if (!asset) return reject(`Icon bitmap is missing from the package: ${path}`, "SKIN_ICON_MISSING");
    if (!asset.mime.startsWith("image/") || asset.mime === "image/svg+xml") {
      return reject(`Icon bitmap is not a supported raster image: ${path}`, "SKIN_ICON_INVALID");
    }
    if (!asset.bytes || asset.bytes > SKIN_ICON_MAX_BYTES) {
      return reject(`Icon bitmap ${path} exceeds ${SKIN_ICON_MAX_BYTES / 1024} KiB.`, "SKIN_ICON_SIZE");
    }
    total += asset.bytes;
    if (total > SKIN_ICONS_MAX_TOTAL_BYTES) {
      return reject(`All icon bitmaps together exceed ${SKIN_ICONS_MAX_TOTAL_BYTES / 1024} KiB.`, "SKIN_ICON_SIZE");
    }
    void slot;
  }
}

/** Instance-level default: comma/space separated optional part names, or a JSON array. */
export function parseHiddenHostParts(value: unknown): string[] {
  const entries = typeof value === "string"
    ? value.split(/[\s,]+/)
    : Array.isArray(value) ? value : [];
  const result: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !DECORATIVE_PART_IDS.has(entry)) continue;
    if (!result.includes(entry) && result.length < SKIN_CHROME_MAX_HIDDEN_PARTS) result.push(entry);
  }
  return result;
}

function cssString(value: string): string {
  return value.replace(/["\\\n\r]/g, (character) => `\\${character}`);
}

/**
 * Generate host-owned CSS. It is appended to the compiled skin CSS by the
 * importer, so `wskin-asset:` markers are resolved together with author CSS.
 * The document-level scope reaches both the skin root and Teleported host
 * chrome, while never selecting arbitrary html/body content.
 */
export function compileSkinChromeCss(document: SkinChromeDocument, skinId: string): string {
  const scope = `:root[${HOST_SKIN_ATTRIBUTE}="${cssString(skinId)}"]`;
  const rules: string[] = [];
  for (const part of document.hiddenParts) {
    rules.push(`${scope} [data-ws-part="${cssString(part)}"] { display: none !important; }`);
  }
  for (const [slot, path] of Object.entries(document.icons)) {
    const target = `${scope} [data-ws-icon-slot="${cssString(slot)}"]`;
    rules.push(`${target} { background-image: url("wskin-asset:${encodeURIComponent(path)}") !important; background-position: center !important; background-repeat: no-repeat !important; background-size: contain !important; }`);
    rules.push(`${target} > * { visibility: hidden !important; }`);
  }
  return rules.length ? rules.join("\n") + "\n" : "";
}
