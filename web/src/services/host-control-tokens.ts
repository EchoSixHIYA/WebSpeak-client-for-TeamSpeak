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

/**
 * Extra tokens read only for `mode: "toolbar"` recovery buttons. They make a
 * host-owned button able to match a neighbouring top-bar button without
 * giving the skin any DOM control:
 *
 *   --skin-recovery-toolbar-<token>          (per-part)
 *   --skin-host-toolbar-<token>              (global fallback)
 *
 * Colours fall back to the normal `--skin-recovery-*` / `--skin-host-*` set;
 * radius, padding, height, font size and shadow use toolbar defaults so a
 * capsule radius (999px) or the fixed pale built-in button never leaks in.
 */
export const HOST_TOOLBAR_TOKEN_NAMES = [
  "background", "foreground", "border", "radius", "font", "font-size", "padding", "height", "shadow",
  "hover-background", "hover-border", "surface", "gap", "icon-size",
] as const;

export type HostToolbarTokenName = (typeof HOST_TOOLBAR_TOKEN_NAMES)[number];

export const HOST_TOOLBAR_GLOBAL_TOKEN_PROPERTIES: Readonly<Record<HostToolbarTokenName, string>> = {
  background: "--skin-host-toolbar-background",
  foreground: "--skin-host-toolbar-foreground",
  border: "--skin-host-toolbar-border",
  radius: "--skin-host-toolbar-radius",
  font: "--skin-host-toolbar-font",
  "font-size": "--skin-host-toolbar-font-size",
  padding: "--skin-host-toolbar-padding",
  height: "--skin-host-toolbar-height",
  shadow: "--skin-host-toolbar-shadow",
  "hover-background": "--skin-host-toolbar-hover-background",
  "hover-border": "--skin-host-toolbar-hover-border",
  surface: "--skin-host-toolbar-surface",
  gap: "--skin-host-toolbar-gap",
  "icon-size": "--skin-host-toolbar-icon-size",
};

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

export function hostToolbarTokenProperty(part: string, token: HostToolbarTokenName): string {
  return `--skin-${hostControlTokenKey(part)}-toolbar-${token}`;
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

/** Host-owned variables read by the toolbar-mode button CSS. */
export const HOST_TOOLBAR_APPLIED_VARIABLES = {
  background: "--ws-toolbar-background",
  foreground: "--ws-toolbar-foreground",
  border: "--ws-toolbar-border",
  radius: "--ws-toolbar-radius",
  font: "--ws-toolbar-font",
  fontSize: "--ws-toolbar-font-size",
  paddingX: "--ws-toolbar-padding-x",
  paddingY: "--ws-toolbar-padding-y",
  minHeight: "--ws-toolbar-min-height",
  shadow: "--ws-toolbar-shadow",
  focus: "--ws-toolbar-focus",
  hoverBackground: "--ws-toolbar-hover-background",
  hoverBorder: "--ws-toolbar-hover-border",
  gap: "--ws-toolbar-gap",
  iconSize: "--ws-toolbar-icon-size",
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

/** Resolved style of a toolbar-mode recovery button (applied to its wrapper). */
export interface HostControlToolbarTokens {
  background: string;
  foreground: string;
  border: string;
  radius: number;
  font: string;
  fontSize: number;
  paddingX: number;
  paddingY: number;
  /** Minimum button height; defaults to the size tier and may reach 22px in toolbar mode. */
  minHeight: number;
  shadow: string;
  hoverBackground: string;
  hoverBorder: string;
  /** Space between grouped host buttons. */
  gap: number;
  /** Size of the host-owned toolbar icon. */
  iconSize: number;
  /** Focus ring colour, from the readable accent of the control palette. */
  focus: string;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface RgbaColor extends RgbColor {
  a: number;
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
/** Toolbar-mode geometry limits; only an explicit height may reach 22px. */
export const TOOLBAR_MIN_HEIGHT = 22;
export const TOOLBAR_DEFAULT_RADIUS = 6;
export const TOOLBAR_MAX_RADIUS = 24;
export const TOOLBAR_DEFAULT_PADDING_X = 12;
export const TOOLBAR_DEFAULT_PADDING_Y = 6;
export const TOOLBAR_MAX_PADDING = 48;
export const TOOLBAR_MAX_HEIGHT = 72;
export const TOOLBAR_MAX_FONT_SIZE = 20;
export const TOOLBAR_DEFAULT_GAP = 4;
export const TOOLBAR_MAX_GAP = 16;
export const TOOLBAR_DEFAULT_ICON_SIZE = 16;
export const TOOLBAR_MIN_ICON_SIZE = 12;
export const TOOLBAR_MAX_ICON_SIZE = 24;
const MAX_SHADOW_LENGTH = 160;
const LENGTH_PX_PATTERN = /^(-?\d+(?:\.\d+)?)px$/i;
const PADDING_PATTERN = /^(0|\d+(?:\.\d+)?px)(?:\s+(0|\d+(?:\.\d+)?px))?$/i;
/**
 * A single box-shadow value: optional `inset`, two to four px offsets/sizes
 * and one simple colour. `url()`, `var()`, extra shadows and declarations are
 * rejected so a token can never load a resource or escape the inline value.
 */
const SHADOW_PATTERN = /^(?:none|(?:inset\s+)?(?:-?(?:0|(?:\d+(?:\.\d+)?)px)\s+){2,4}(?:#[0-9a-f]{3,8}|rgba?\([^()]*\)|[a-z]+))$/i;
/**
 * The skin compiler renames every skin/plugin `@font-face` family to
 * `ws-<skin id>[-<plugin id>]-<name>` (see `compileSkinCss` in
 * src/shared/skin-css.ts), so that prefix identifies a skin font even when the
 * face is not in `document.fonts` yet (for example behind a non-matching
 * `@media` that activates after the token was accepted).
 */
const SCOPED_SKIN_FONT_PREFIX = "ws-";

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

/** Parse CSS colours to sRGB channels plus alpha for toolbar transparency checks. */
export function parseCssColorWithAlpha(value: string | undefined | null): RgbaColor | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: Number.parseInt(digits[0] + digits[0], 16),
        g: Number.parseInt(digits[1] + digits[1], 16),
        b: Number.parseInt(digits[2] + digits[2], 16),
        a: digits.length === 4 ? Number.parseInt(digits[3] + digits[3], 16) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: Number.parseInt(digits.slice(0, 2), 16),
        g: Number.parseInt(digits.slice(2, 4), 16),
        b: Number.parseInt(digits.slice(4, 6), 16),
        a: digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
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
  let alpha = 1;
  if (parts.length === 4) {
    const rawAlpha = Number.parseFloat(parts[3]);
    if (!Number.isFinite(rawAlpha)) return null;
    alpha = parts[3].endsWith("%") ? rawAlpha / 100 : rawAlpha;
    alpha = Math.min(1, Math.max(0, alpha));
  }
  return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
}

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. */
export function parseCssColor(value: string | undefined | null): RgbColor | null {
  const color = parseCssColorWithAlpha(value);
  return color ? { r: color.r, g: color.g, b: color.b } : null;
}

/** Composite a possibly translucent colour over an opaque sRGB surface. */
export function compositeRgb(foreground: RgbaColor, background: RgbColor): RgbColor {
  const alpha = Math.min(1, Math.max(0, foreground.a));
  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
  };
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
  if (fontFamilyNames(font).some((name) => name.startsWith(SCOPED_SKIN_FONT_PREFIX) || isWebFont(name))) return fallback;
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
    && contrastRatio(palette.accent, palette.background) >= HOST_CONTROL_MIN_ACCENT_CONTRAST
    // Primary actions put host-chosen text on the accent; mid-tone accents
    // where neither black nor white reaches the text floor are rejected.
    && contrastRatio(readableOnAccent(palette.accent), palette.accent) >= HOST_CONTROL_MIN_FOREGROUND_CONTRAST;
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
 * Fonts registered by the document (skin `@font-face`) and names carrying the
 * compiler's scoped skin-font prefix (`ws-`) are ignored.
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

function readToolbarTokenSet(
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> | null,
  resolveProperty: (token: HostToolbarTokenName) => string,
): Partial<Record<HostToolbarTokenName, string>> {
  if (!style) return {};
  const tokens: Partial<Record<HostToolbarTokenName, string>> = {};
  for (const token of HOST_TOOLBAR_TOKEN_NAMES) {
    const value = style.getPropertyValue(resolveProperty(token)).trim();
    if (value) tokens[token] = value;
  }
  return tokens;
}

function sanitizeToolbarFontSize(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = LENGTH_PX_PATTERN.exec(value.trim());
  if (!match) return fallback;
  const size = Number.parseFloat(match[1]);
  return Number.isFinite(size)
    ? Math.min(TOOLBAR_MAX_FONT_SIZE, Math.max(HOST_CONTROL_MIN_FONT_SIZE, fallback, size))
    : fallback;
}

function sanitizeToolbarPadding(value: string | undefined): { x: number; y: number } | undefined {
  if (!value) return undefined;
  const match = PADDING_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const first = Number.parseFloat(match[1]);
  const second = match[2] === undefined ? first : Number.parseFloat(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return undefined;
  const clamp = (size: number) => Math.min(TOOLBAR_MAX_PADDING, Math.max(0, size));
  return { x: clamp(second), y: clamp(first) };
}

function sanitizeToolbarHeight(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = LENGTH_PX_PATTERN.exec(value.trim());
  if (!match) return fallback;
  const height = Number.parseFloat(match[1]);
  return Number.isFinite(height)
    ? Math.min(TOOLBAR_MAX_HEIGHT, Math.max(TOOLBAR_MIN_HEIGHT, height))
    : fallback;
}

function sanitizeToolbarLength(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const match = LENGTH_PX_PATTERN.exec(value.trim());
  if (!match) return fallback;
  const length = Number.parseFloat(match[1]);
  return Number.isFinite(length) ? Math.min(max, Math.max(min, length)) : fallback;
}

function sanitizeToolbarShadow(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const shadow = value.trim().replace(/\s+/g, " ");
  if (!shadow || shadow.length > MAX_SHADOW_LENGTH || !SHADOW_PATTERN.test(shadow)) return undefined;
  return shadow;
}

/** True when the skin declares at least one toolbar-mode token. */
export function hasHostToolbarTokens(
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> | null,
  part: string,
): boolean {
  if (!style) return false;
  return HOST_TOOLBAR_TOKEN_NAMES.some((token) =>
    Boolean(style.getPropertyValue(hostToolbarTokenProperty(part, token)).trim())
    || Boolean(style.getPropertyValue(HOST_TOOLBAR_GLOBAL_TOKEN_PROPERTIES[token]).trim())
  );
}

function parseToolbarColor(raw: string | undefined, probeColor: ColorProbe): RgbaColor | null {
  return parseCssColorWithAlpha(raw ? probeColor(raw) : undefined);
}

function formatToolbarColor(color: RgbaColor): string {
  return color.a === 0 ? "transparent" : formatRgb(color);
}

function resolveToolbarSurface(
  partTokens: Partial<Record<HostToolbarTokenName, string>>,
  globalTokens: Partial<Record<HostToolbarTokenName, string>>,
  probeColor: ColorProbe,
  sampledSurface: RgbColor | null | undefined,
  defaults: HostControlDefaults,
): RgbColor {
  for (const raw of [partTokens.surface, globalTokens.surface]) {
    const color = parseToolbarColor(raw, probeColor);
    if (color?.a === 1) return { r: color.r, g: color.g, b: color.b };
  }
  return sampledSurface ?? defaults.background;
}

function resolveToolbarBorder(
  raw: string | undefined,
  background: RgbColor,
  fallback: string,
  probeColor: ColorProbe,
): string {
  const color = parseToolbarColor(raw, probeColor);
  if (!color) return fallback;
  if (color.a === 0) return "transparent";
  return contrastRatio(color, background) >= HOST_CONTROL_MIN_BORDER_CONTRAST ? formatRgb(color) : fallback;
}

function resolveToolbarHoverBorder(raw: string | undefined, fallback: string, probeColor: ColorProbe): string {
  const color = parseToolbarColor(raw, probeColor);
  if (!color) return fallback;
  // Classic's subtle #b8cfe8 hover edge is intentionally below the 3:1
  // non-text contrast floor; validate syntax without rejecting that design.
  return formatToolbarColor(color);
}

/**
 * Resolve the toolbar button palette and geometry.
 *
 * Transparent backgrounds and borders are valid. Text is checked against an
 * explicit opaque `surface` token, or the caller's sampled anchor/ancestor
 * surface, never against transparent black. Opaque colours keep the existing
 * capsule contrast floors. Hover colours fall back independently to the normal
 * button colours, and only an explicit toolbar height may reach the 22px
 * Classic toolbar floor; the size-tier default remains 28/32/36px.
 */
export function resolveHostControlToolbarTokens(
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> | null,
  part: string,
  probeColor: ColorProbe,
  defaults: HostControlDefaults,
  isWebFont: WebFontCheck = NO_WEB_FONTS,
  sampledSurface?: RgbColor | null,
): HostControlToolbarTokens {
  const base = resolveHostControlTokens(style, part, probeColor, defaults, isWebFont);
  const globalTokens = readToolbarTokenSet(style, (token) => HOST_TOOLBAR_GLOBAL_TOKEN_PROPERTIES[token]);
  const partTokens = readToolbarTokenSet(style, (token) => hostToolbarTokenProperty(part, token));
  const merged = { ...globalTokens, ...partTokens };

  const baseBackground = parseCssColor(base.background) ?? defaults.background;
  const baseForeground = parseCssColor(base.foreground) ?? defaults.foreground;
  const baseBorder = parseCssColor(base.border) ?? defaults.border;
  const surface = resolveToolbarSurface(partTokens, globalTokens, probeColor, sampledSurface, defaults);
  let background = parseToolbarColor(merged.background, probeColor) ?? { ...baseBackground, a: 1 };
  let foreground = parseToolbarColor(merged.foreground, probeColor) ?? { ...baseForeground, a: 1 };
  let effectiveBackground = background.a === 0 ? surface : background;
  if (contrastRatio(foreground, effectiveBackground) < HOST_CONTROL_MIN_FOREGROUND_CONTRAST) {
    background = { ...baseBackground, a: 1 };
    foreground = { ...baseForeground, a: 1 };
    effectiveBackground = baseBackground;
  }
  const border = resolveToolbarBorder(merged.border, effectiveBackground, base.border, probeColor);

  let hoverBackground = parseToolbarColor(merged["hover-background"], probeColor) ?? background;
  let effectiveHoverBackground = hoverBackground.a === 0 ? surface : hoverBackground;
  if (contrastRatio(foreground, effectiveHoverBackground) < HOST_CONTROL_MIN_FOREGROUND_CONTRAST) {
    hoverBackground = background;
    effectiveHoverBackground = effectiveBackground;
  }
  const hoverBorder = resolveToolbarHoverBorder(merged["hover-border"], border, probeColor);
  const padding = sanitizeToolbarPadding(merged.padding);

  return {
    background: formatToolbarColor(background),
    foreground: formatRgb(foreground),
    border,
    radius: sanitizeRadius(merged.radius, TOOLBAR_DEFAULT_RADIUS, TOOLBAR_MAX_RADIUS),
    font: sanitizeFont(merged.font, base.font, isWebFont),
    fontSize: sanitizeToolbarFontSize(merged["font-size"], base.fontSize),
    paddingX: padding?.x ?? TOOLBAR_DEFAULT_PADDING_X,
    paddingY: padding?.y ?? TOOLBAR_DEFAULT_PADDING_Y,
    minHeight: sanitizeToolbarHeight(merged.height, base.hitTarget),
    shadow: sanitizeToolbarShadow(merged.shadow) ?? "none",
    hoverBackground: formatToolbarColor(hoverBackground),
    hoverBorder,
    gap: sanitizeToolbarLength(merged.gap, TOOLBAR_DEFAULT_GAP, 0, TOOLBAR_MAX_GAP),
    iconSize: sanitizeToolbarLength(
      merged["icon-size"],
      TOOLBAR_DEFAULT_ICON_SIZE,
      TOOLBAR_MIN_ICON_SIZE,
      TOOLBAR_MAX_ICON_SIZE,
    ),
    focus: base.accent,
  };
}

/** Apply (or clear) toolbar-mode variables on the button wrapper. */
export function applyHostControlToolbarTokens(
  control: HTMLElement,
  tokens: HostControlToolbarTokens | null,
): void {
  const style = control.style;
  for (const property of Object.values(HOST_TOOLBAR_APPLIED_VARIABLES)) style.removeProperty(property);
  if (!tokens) return;
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.background, tokens.background);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.foreground, tokens.foreground);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.border, tokens.border);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.radius, `${tokens.radius}px`);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.font, tokens.font);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.fontSize, `${tokens.fontSize}px`);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.paddingX, `${tokens.paddingX}px`);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.paddingY, `${tokens.paddingY}px`);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.minHeight, `${tokens.minHeight}px`);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.shadow, tokens.shadow);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.focus, tokens.focus);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.hoverBackground, tokens.hoverBackground);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.hoverBorder, tokens.hoverBorder);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.gap, `${tokens.gap}px`);
  style.setProperty(HOST_TOOLBAR_APPLIED_VARIABLES.iconSize, `${tokens.iconSize}px`);
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
 * (and therefore its tokens) has been injected, and on viewport resize, because
 * tokens may be declared inside `@media`.
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
  // Tokens declared inside `@media` change with the viewport, not the DOM.
  const onResize = (): void => binding.apply();
  win?.addEventListener("resize", onResize, { passive: true });

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
      win?.removeEventListener("resize", onResize);
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
    const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
    return a === 255 ? formatRgb({ r, g, b }) : `rgba(${r}, ${g}, ${b}, ${a / 255})`;
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
