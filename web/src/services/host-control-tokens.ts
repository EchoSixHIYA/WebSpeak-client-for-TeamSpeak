/**
 * Style tokens for host-owned protected controls.
 *
 * Recovery, the skin-load banner and the authorization dialog live inside
 * closed shadow roots, so compiled skin CSS can never reach them. A skin may
 * declare a small, sanitised token set on the active skin root instead; the
 * host reads it, checks readability and applies the result inside the shadow
 * root. The control still owns its structure, hit target and fallback.
 *
 * Token names:
 *   --skin-host-accent | background | foreground | border | radius | font | size
 *   --skin-<part-key>-<token>                                   (per-part override)
 *
 * `host.recovery` keeps its historical `recovery` key so `--skin-recovery-*`
 * continues to work; its per-part values win over the global set.
 */

import type { HostOwnedLayer } from "./host-owned-layer.js";

export type HostControlSizeTier = "small" | "medium" | "large";
export interface HostControlMetrics {
  /** Host-enforced minimum button hit target in CSS pixels. */
  readonly hitTarget: number;
  /** Host-enforced minimum font size in CSS pixels. */
  readonly fontSize: number;
}

export const HOST_CONTROL_MIN_HIT_TARGET = 28;
export const HOST_CONTROL_MIN_FONT_SIZE = 11;
export const HOST_CONTROL_MIN_FOREGROUND_CONTRAST = 4.5;
export const HOST_CONTROL_MIN_ACCENT_CONTRAST = 3;
export const HOST_CONTROL_MIN_BORDER_CONTRAST = 3;

/** Host-controlled size tiers; a skin can choose a tier, never a smaller size. */
export const HOST_CONTROL_SIZE_METRICS: Readonly<Record<HostControlSizeTier, HostControlMetrics>> = {
  small: { hitTarget: 28, fontSize: 11 },
  medium: { hitTarget: 32, fontSize: 12 },
  large: { hitTarget: 36, fontSize: 13 },
};

export const HOST_CONTROL_TOKEN_NAMES = [
  "accent", "background", "foreground", "border", "radius", "font", "size",
] as const;

export type HostControlTokenName = (typeof HOST_CONTROL_TOKEN_NAMES)[number];

/** Global token set read from the active skin root (or a slot anchor). */
export const HOST_CONTROL_GLOBAL_TOKEN_PROPERTIES: Readonly<Record<HostControlTokenName, string>> = {
  accent: "--skin-host-accent",
  background: "--skin-host-background",
  foreground: "--skin-host-foreground",
  border: "--skin-host-border",
  radius: "--skin-host-radius",
  font: "--skin-host-font",
  size: "--skin-host-size",
};

/**
 * Stable per-part token keys. The last dotted segment would turn
 * `app.skin-load-recovery` into `--skin-skin-load-recovery-*`; the explicit
 * keys keep the public names readable.
 */
export const HOST_CONTROL_TOKEN_KEYS: Readonly<Record<string, string>> = {
  "host.recovery": "recovery",
  "app.skin-load-recovery": "load-recovery",
  "host.permission": "permission",
};

export function hostControlTokenKey(part: string): string {
  return HOST_CONTROL_TOKEN_KEYS[part] ?? part.split(".").pop() ?? part;
}

export function hostControlTokenProperty(part: string, token: HostControlTokenName): string {
  return `--skin-${hostControlTokenKey(part)}-${token}`;
}

/** Host-owned variables written inside the closed shadow root. */
export const HOST_CONTROL_APPLIED_VARIABLES = {
  accent: "--ws-control-accent",
  onAccent: "--ws-control-on-accent",
  background: "--ws-control-background",
  foreground: "--ws-control-foreground",
  border: "--ws-control-border",
  radius: "--ws-control-radius",
  font: "--ws-control-font",
  hitTarget: "--ws-control-hit",
  fontSize: "--ws-control-font-size",
  builtInBorder: "--ws-control-builtin-border",
} as const;

export interface HostControlRawTokens {
  /** Computed-style colour values; unresolved values are rejected. */
  accent?: string;
  background?: string;
  foreground?: string;
  border?: string;
  radius?: string;
  font?: string;
  size?: string;
}

export interface HostControlDefaults {
  accent: RgbColor;
  background: RgbColor;
  foreground: RgbColor;
  border: RgbColor;
  radius: number;
  maxRadius: number;
  font: string;
  hitTarget: number;
  fontSize: number;
  /** Optional per-tier metrics; defaults to HOST_CONTROL_SIZE_METRICS. */
  sizeMetrics?: Readonly<Record<HostControlSizeTier, HostControlMetrics>>;
  /** A fixed light-background action that keeps its own border contrast check. */
  builtInButton?: { background: RgbColor; border: RgbColor };
}

export interface HostControlTokens {
  accent: string;
  /** Text colour that stays readable on top of `accent`. */
  onAccent: string;
  background: string;
  foreground: string;
  border: string;
  radius: number;
  font: string;
  size: HostControlSizeTier;
  hitTarget: number;
  fontSize: number;
  builtInBorder?: string;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const DEFAULT_ACCENT: RgbColor = { r: 180, g: 83, b: 9 };
const DEFAULT_BACKGROUND: RgbColor = { r: 255, g: 255, b: 255 };
const DEFAULT_FOREGROUND: RgbColor = { r: 49, g: 82, b: 79 };
const DEFAULT_BORDER: RgbColor = { r: 157, g: 182, b: 178 };
const RECOVERY_BUILT_IN_BACKGROUND: RgbColor = { r: 255, g: 247, b: 237 };
const RECOVERY_BUILT_IN_BORDER: RgbColor = { r: 180, g: 83, b: 9 };
const ON_ACCENT_LIGHT: RgbColor = { r: 255, g: 255, b: 255 };
const ON_ACCENT_DARK: RgbColor = { r: 17, g: 24, b: 39 };
const MAX_RADIUS = 999;
const MAX_FONT_LENGTH = 120;
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"-]{1,120}$/;

/** Defaults for the recovery capsule: white surface, teal text, amber accent. */
export const RECOVERY_CONTROL_DEFAULTS: HostControlDefaults = {
  accent: DEFAULT_ACCENT,
  background: DEFAULT_BACKGROUND,
  foreground: DEFAULT_FOREGROUND,
  border: DEFAULT_BORDER,
  radius: 999,
  maxRadius: MAX_RADIUS,
  font: "ui-sans-serif, system-ui, sans-serif",
  hitTarget: HOST_CONTROL_MIN_HIT_TARGET,
  fontSize: HOST_CONTROL_MIN_FONT_SIZE,
  builtInButton: { background: RECOVERY_BUILT_IN_BACKGROUND, border: RECOVERY_BUILT_IN_BORDER },
};

/** Defaults for the skin-load failure banner: amber alert, 44px action. */
export const SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS: HostControlDefaults = {
  accent: { r: 180, g: 83, b: 9 },
  background: { r: 255, g: 251, b: 235 },
  foreground: { r: 120, g: 53, b: 15 },
  border: { r: 245, g: 158, b: 11 },
  radius: 12,
  maxRadius: 64,
  font: "ui-sans-serif, system-ui, sans-serif",
  hitTarget: 44,
  fontSize: 14,
  sizeMetrics: {
    small: { hitTarget: 44, fontSize: 14 },
    medium: { hitTarget: 46, fontSize: 15 },
    large: { hitTarget: 48, fontSize: 16 },
  },
};

/** Defaults for the host-owned authorization ("permission") dialog. */
export const PERMISSION_CONTROL_DEFAULTS: HostControlDefaults = {
  accent: { r: 82, g: 101, b: 223 },
  background: { r: 255, g: 255, b: 255 },
  foreground: { r: 37, g: 50, b: 75 },
  border: { r: 219, g: 227, b: 241 },
  radius: 20,
  maxRadius: 64,
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  hitTarget: 42,
  fontSize: 14,
  sizeMetrics: {
    small: { hitTarget: 42, fontSize: 14 },
    medium: { hitTarget: 44, fontSize: 15 },
    large: { hitTarget: 46, fontSize: 16 },
  },
};

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. */
export function parseCssColor(value: string | undefined | null): RgbColor | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: Number.parseInt(digits[0] + digits[0], 16),
        g: Number.parseInt(digits[1] + digits[1], 16),
        b: Number.parseInt(digits[2] + digits[2], 16),
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: Number.parseInt(digits.slice(0, 2), 16),
        g: Number.parseInt(digits.slice(2, 4), 16),
        b: Number.parseInt(digits.slice(4, 6), 16),
      };
    }
    return null;
  }

  const fn = /^rgba?\(([^()]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const channels: number[] = [];
  for (const part of parts.slice(0, 3)) {
    const percent = part.endsWith("%");
    const parsed = Number.parseFloat(part);
    if (!Number.isFinite(parsed)) return null;
    const channel = percent ? parsed * 2.55 : parsed;
    channels.push(Math.round(Math.min(255, Math.max(0, channel))));
  }
  return { r: channels[0], g: channels[1], b: channels[2] };
}

export function formatRgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: RgbColor): number {
  const channel = (value: number): number => {
    const normalized = Math.min(255, Math.max(0, value)) / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(first: RgbColor, second: RgbColor): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function isHostControlSizeTier(value: unknown): value is HostControlSizeTier {
  return value === "small" || value === "medium" || value === "large";
}

function sanitizeRadius(value: string | undefined, fallback: number, maxRadius: number): number {
  if (!value) return fallback;
  const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (!match) return fallback;
  const radius = Number.parseFloat(match[1]);
  return Number.isFinite(radius) ? Math.min(maxRadius, Math.max(0, radius)) : fallback;
}

/** Lower-cased family names from a `font-family` list, quotes removed. */
export function fontFamilyNames(value: string): string[] {
  return value.split(",").map((name) => name.trim().replace(/^["']|["']$/g, "").trim().toLowerCase()).filter(Boolean);
}

function sanitizeFont(value: string | undefined, fallback: string, isWebFont: WebFontCheck): string {
  if (!value) return fallback;
  const font = value.trim().replace(/\s+/g, " ");
  if (!font || font.length > MAX_FONT_LENGTH || !FONT_FAMILY_PATTERN.test(font) || !/[A-Za-z0-9]/.test(font)) {
    return fallback;
  }
  // A skin-supplied @font-face can ship glyph-less outlines and blank the
  // control's label, so host-owned controls only accept installed/generic fonts.
  if (fontFamilyNames(font).some(isWebFont)) return fallback;
  return font;
}

function readTokenSet(
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> | null,
  resolveProperty: (token: HostControlTokenName) => string,
): HostControlRawTokens {
  if (!style) return {};
  const read = (token: HostControlTokenName): string | undefined => {
    const value = style.getPropertyValue(resolveProperty(token)).trim();
    return value || undefined;
  };
  return {
    accent: read("accent"),
    background: read("background"),
    foreground: read("foreground"),
    border: read("border"),
    radius: read("radius"),
    font: read("font"),
    size: read("size"),
  };
}

function mergeRawTokens(...layers: readonly HostControlRawTokens[]): HostControlRawTokens {
  const merged: HostControlRawTokens = {};
  for (const layer of layers) {
    for (const token of HOST_CONTROL_TOKEN_NAMES) {
      if (layer[token] !== undefined) merged[token] = layer[token];
    }
  }
  return merged;
}

type ColorProbe = (raw: string | undefined) => string | undefined;
/** True when a (lower-cased, unquoted) family is provided by a document @font-face. */
type WebFontCheck = (family: string) => boolean;
const NO_WEB_FONTS: WebFontCheck = () => false;

function resolvePalette(
  raw: HostControlRawTokens,
  defaults: HostControlDefaults,
  probeColor: ColorProbe,
): { accent: RgbColor; background: RgbColor; foreground: RgbColor } {
  return {
    accent: parseCssColor(probeColor(raw.accent)) ?? defaults.accent,
    background: parseCssColor(probeColor(raw.background)) ?? defaults.background,
    foreground: parseCssColor(probeColor(raw.foreground)) ?? defaults.foreground,
  };
}

function paletteReadable(palette: { accent: RgbColor; background: RgbColor; foreground: RgbColor }): boolean {
  return contrastRatio(palette.foreground, palette.background) >= HOST_CONTROL_MIN_FOREGROUND_CONTRAST
    && contrastRatio(palette.accent, palette.background) >= HOST_CONTROL_MIN_ACCENT_CONTRAST;
}

function resolveBorder(
  raw: string | undefined,
  background: RgbColor,
  probeColor: ColorProbe,
): RgbColor | undefined {
  const color = parseCssColor(probeColor(raw));
  return color && contrastRatio(color, background) >= HOST_CONTROL_MIN_BORDER_CONTRAST ? color : undefined;
}

function readableOnAccent(accent: RgbColor): RgbColor {
  return contrastRatio(ON_ACCENT_LIGHT, accent) >= contrastRatio(ON_ACCENT_DARK, accent)
    ? ON_ACCENT_LIGHT
    : ON_ACCENT_DARK;
}

/** True when the skin root declares at least one global or per-part token. */
export function hasHostControlTokens(
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> | null,
  part: string,
): boolean {
  if (!style) return false;
  return HOST_CONTROL_TOKEN_NAMES.some((token) =>
    Boolean(style.getPropertyValue(hostControlTokenProperty(part, token)).trim())
    || Boolean(style.getPropertyValue(HOST_CONTROL_GLOBAL_TOKEN_PROPERTIES[token]).trim())
  );
}

/**
 * Read and sanitize the skin token layers from one computed style.
 *
 * `--skin-<part-key>-*` wins per token; unset values fall back to
 * `--skin-host-*`, then to the control's built-in defaults. Colours are
 * all-or-nothing: if the combined foreground/background/accent palette is
 * unreadable, the resolver retries the global layer and finally the built-in
 * palette, so a skin can never make a protected control unreadable. The
 * border is optional and must stay visible against the resolved background.
 * Fonts registered by the document (skin `@font-face`) are ignored.
 */
export function resolveHostControlTokens(
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> | null,
  part: string,
  probeColor: ColorProbe,
  defaults: HostControlDefaults,
  isWebFont: WebFontCheck = NO_WEB_FONTS,
): HostControlTokens {
  const partTokens = readTokenSet(style, (token) => hostControlTokenProperty(part, token));
  const globalTokens = readTokenSet(style, (token) => HOST_CONTROL_GLOBAL_TOKEN_PROPERTIES[token]);
  const merged = mergeRawTokens(globalTokens, partTokens);

  let palette = resolvePalette(merged, defaults, probeColor);
  if (!paletteReadable(palette)) palette = resolvePalette(globalTokens, defaults, probeColor);
  if (!paletteReadable(palette)) palette = resolvePalette({}, defaults, probeColor);

  const border = resolveBorder(merged.border, palette.background, probeColor)
    ?? resolveBorder(globalTokens.border, palette.background, probeColor)
    ?? defaults.border;

  const sizeValue = merged.size?.trim();
  const size = isHostControlSizeTier(sizeValue) ? sizeValue : "small";
  const tierMetrics = (defaults.sizeMetrics ?? HOST_CONTROL_SIZE_METRICS)[size];
  const hitTarget = Math.max(defaults.hitTarget, tierMetrics.hitTarget);
  const fontSize = Math.max(defaults.fontSize, tierMetrics.fontSize);
  const builtInBorder = defaults.builtInButton
    ? contrastRatio(palette.accent, defaults.builtInButton.background) >= HOST_CONTROL_MIN_ACCENT_CONTRAST
      ? palette.accent
      : defaults.builtInButton.border
    : undefined;

  return {
    accent: formatRgb(palette.accent),
    onAccent: formatRgb(readableOnAccent(palette.accent)),
    background: formatRgb(palette.background),
    foreground: formatRgb(palette.foreground),
    border: formatRgb(border),
    radius: sanitizeRadius(merged.radius, defaults.radius, defaults.maxRadius),
    font: sanitizeFont(merged.font, defaults.font, isWebFont),
    size,
    hitTarget,
    fontSize,
    ...(builtInBorder ? { builtInBorder: formatRgb(builtInBorder) } : {}),
  };
}

/** Apply (or clear) host-owned variables on the control inside the shadow root. */
export function applyHostControlTokens(control: HTMLElement, tokens: HostControlTokens | null): void {
  const style = control.style;
  for (const property of Object.values(HOST_CONTROL_APPLIED_VARIABLES)) style.removeProperty(property);
  if (!tokens) return;
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.accent, tokens.accent);
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.onAccent, tokens.onAccent);
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.background, tokens.background);
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.foreground, tokens.foreground);
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.border, tokens.border);
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.radius, `${tokens.radius}px`);
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.font, tokens.font);
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.hitTarget, `${tokens.hitTarget}px`);
  style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.fontSize, `${tokens.fontSize}px`);
  if (tokens.builtInBorder) style.setProperty(HOST_CONTROL_APPLIED_VARIABLES.builtInBorder, tokens.builtInBorder);
}

export interface HostControlThemeBindingOptions {
  layer: HostOwnedLayer;
  /** The host-owned element whose inline `--ws-control-*` variables are set. */
  control: () => HTMLElement | null;
  part: string;
  defaults: HostControlDefaults;
  /** The active skin root (or a slot anchor) to read token values from. */
  source: () => Element | null;
  /**
   * When this returns false another owner (the recovery slot binding) is
   * writing the control's tokens, so `apply()` leaves them untouched.
   */
  active?: () => boolean;
}

export interface HostControlThemeBinding {
  apply(): void;
  dispose(): void;
}

/**
 * Bind one host-owned control to the active skin's token set. The returned
 * binding owns the hidden probe and never stores a token value on the skin
 * side. Callers re-apply it when the active skin or the control changes; the
 * binding also re-applies itself when stylesheets in `<head>` or the document
 * root attributes change, because a stored skin id is known before its CSS
 * (and therefore its tokens) has been injected.
 */
export function bindHostControlTheme(options: HostControlThemeBindingOptions): HostControlThemeBinding {
  let probe: HostControlProbe | null = null;
  let observer: MutationObserver | null = null;
  const doc = options.layer.shadow.ownerDocument;
  const win = doc.defaultView;

  // MutationObserver already batches a burst of changes into one callback.
  // Frames are avoided on purpose: they do not run in background tabs.
  if (win && typeof win.MutationObserver === "function") {
    observer = new win.MutationObserver(() => binding.apply());
    observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
    observer.observe(doc.documentElement, { attributes: true });
  }

  const binding: HostControlThemeBinding = {
    apply() {
      if (options.active && !options.active()) return;
      const control = options.control();
      if (!control) return;
      const source = options.source();
      const view = source?.ownerDocument.defaultView;
      if (!source || !view) {
        applyHostControlTokens(control, null);
        return;
      }
      const style = view.getComputedStyle(source);
      // No token declaration keeps the control's built-in CSS fallback.
      if (!hasHostControlTokens(style, options.part)) {
        applyHostControlTokens(control, null);
        return;
      }
      probe ??= createHostControlProbe(options.layer.shadow);
      applyHostControlTokens(
        control,
        resolveHostControlTokens(style, options.part, probe.probeColor, options.defaults, probe.isWebFont),
      );
    },
    dispose() {
      observer?.disconnect();
      observer = null;
      probe?.dispose();
      probe = null;
    },
  };
  return binding;
}

/** The active skin root; the token source for controls without a slot anchor. */
export function findSkinRoot(skinId: string | undefined, doc: Document = document): Element | null {
  for (const root of doc.querySelectorAll(".ws-skin-root")) {
    if (!skinId || root.getAttribute("data-ws-skin") === skinId) return root;
  }
  return null;
}

export interface HostControlProbe {
  /** Resolve a CSS colour through the browser, inside the closed shadow root. */
  probeColor(raw: string | undefined): string | undefined;
  /** True when `family` (lower-cased, unquoted) comes from a document `@font-face`. */
  isWebFont(family: string): boolean;
  dispose(): void;
}

/**
 * A hidden probe for resolving arbitrary CSS colour syntax (for example
 * `color-mix()` or `oklch()`) to a concrete `rgb()` value, and for spotting
 * fonts that a skin registered itself.
 */
export function createHostControlProbe(shadow: ShadowRoot): HostControlProbe {
  const doc = shadow.ownerDocument;
  const win = doc.defaultView;
  let canvas: CanvasRenderingContext2D | null | undefined;
  const element = doc.createElement("span");
  element.setAttribute("aria-hidden", "true");
  element.style.cssText = "position:absolute;left:-9999px;top:0;width:0;height:0;visibility:hidden;pointer-events:none;";
  shadow.append(element);

  const resolveWith = (raw: string, sentinel: string): string | undefined => {
    if (!win) return undefined;
    // An invalid value leaves the previous colour in place. Probe against two
    // different sentinels so a real token equal to one of them still resolves.
    element.style.color = sentinel;
    element.style.color = raw;
    return win.getComputedStyle(element).color;
  };

  /**
   * Browsers serialise `oklch()`, `lab()` and most `color-mix()` results in
   * their own colour space instead of `rgb()`. Paint those into a 1×1 canvas
   * to get sRGB channels the contrast check understands.
   */
  const toRgb = (computed: string): string | undefined => {
    if (parseCssColor(computed)) return computed;
    if (canvas === undefined) {
      canvas = doc.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (canvas) canvas.canvas.width = canvas.canvas.height = 1;
    }
    if (!canvas) return undefined;
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = "#000";
    canvas.fillStyle = computed;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
    return formatRgb({ r, g, b });
  };

  return {
    probeColor(raw) {
      if (!raw) return undefined;
      const first = resolveWith(raw, "rgb(1, 2, 3)");
      if (first !== "rgb(1, 2, 3)") return first === undefined ? undefined : toRgb(first);
      const second = resolveWith(raw, "rgb(4, 5, 6)");
      return second === undefined || second === "rgb(4, 5, 6)" ? undefined : toRgb(second);
    },
    isWebFont(family) {
      const fonts = doc.fonts;
      if (!fonts) return false;
      let found = false;
      fonts.forEach((face) => {
        if (!found && fontFamilyNames(face.family).includes(family)) found = true;
      });
      return found;
    },
    dispose() {
      element.remove();
    },
  };
}
