/**
 * Runtime placement for trusted host controls that a skin may fold into its
 * own layout.
 *
 * A skin cannot own, style or hide these controls: the control still lives in
 * the host's closed shadow root and top layer. `chrome.json#slots` only names
 * an existing `data-ws-part` anchor inside `.ws-skin-root`; this module reads
 * that anchor, positions the host control over it, and falls back to the
 * default corner whenever the anchor stops being a safe place to click.
 *
 * `isHostPartReachable` stays the single visibility predicate for host parts;
 * the extra checks here cover only slot-specific geometry (anchor size and
 * on-screen ratio, control hit target, top-layer hit test).
 */

import type { SkinChromeSlotAlign } from "../../../src/shared/skin-chrome.js";
import type { HostOwnedLayer } from "./host-owned-layer.js";
import { isHostPartReachable, type HostPartRect } from "./host-chrome-visibility.js";

export interface SlotViewport {
  width: number;
  height: number;
}

/** Small inset so the capsule never touches the viewport edge. */
export const HOST_SLOT_VIEWPORT_INSET = 4;
/** An anchor narrower or shorter than this cannot host a usable control. */
export const HOST_SLOT_MIN_ANCHOR_SIZE = 8;
/** At least half of the anchor must be on screen. */
export const HOST_SLOT_MIN_VISIBLE_RATIO = 0.5;
/** Re-slot only after the anchor stays usable for consecutive checks. */
export const HOST_SLOT_REQUIRED_VALID_CHECKS = 2;
export const HOST_SLOT_SLOTTED_INTERVAL_MS = 400;
export const HOST_SLOT_IDLE_INTERVAL_MS = 1000;

/**
 * Place the control inside the anchor rect, vertically centred and aligned on
 * one horizontal edge. The result is clamped so the whole control stays inside
 * the viewport; when the anchor is smaller than the control the control may
 * overflow the anchor, but never the viewport.
 */
export function computeSlotPlacement(
  anchor: HostPartRect,
  control: { width: number; height: number },
  viewport: SlotViewport,
  align: SkinChromeSlotAlign = "end",
): { left: number; top: number } {
  const width = Math.max(0, control.width);
  const height = Math.max(0, control.height);
  const inset = HOST_SLOT_VIEWPORT_INSET;
  const desiredLeft = align === "start"
    ? anchor.left
    : align === "center"
      ? anchor.left + (anchor.width - width) / 2
      : anchor.right - width;
  const desiredTop = anchor.top + (anchor.height - height) / 2;
  const maxLeft = Math.max(inset, viewport.width - inset - width);
  const maxTop = Math.max(inset, viewport.height - inset - height);
  return {
    left: Math.min(Math.max(inset, desiredLeft), maxLeft),
    top: Math.min(Math.max(inset, desiredTop), maxTop),
  };
}

export type SlotFailureReason =
  | "anchor-missing"
  | "anchor-hidden"
  | "anchor-tiny"
  | "anchor-offscreen"
  | "control-hidden"
  | "control-too-small"
  | "control-offscreen"
  | "hit-test";

export interface SlotAnchorSnapshot {
  rect: HostPartRect;
  display: string;
  visibility: string;
  opacity: string;
  clipPath?: string;
  clip?: string;
}

export interface SlotEvaluationInput {
  anchor: SlotAnchorSnapshot | null | undefined;
  controlRect: HostPartRect;
  viewport: SlotViewport;
  /** Host-enforced minimum hit target for the current size tier. */
  minHitTarget: number;
  /** `document.elementFromPoint` at the control centre is the host layer. */
  hitTestOk: boolean;
}

export type SlotEvaluation = { ok: true } | { ok: false; reason: SlotFailureReason };

function visibleAreaRatio(rect: HostPartRect, viewport: SlotViewport): number {
  const width = Math.min(rect.right, viewport.width) - Math.max(rect.left, 0);
  const height = Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0);
  const area = rect.width * rect.height;
  if (!(area > 0) || !(width > 0) || !(height > 0)) return 0;
  return (width * height) / area;
}

function fullyInsideViewport(rect: HostPartRect, viewport: SlotViewport): boolean {
  const epsilon = 0.5;
  return rect.left >= -epsilon
    && rect.top >= -epsilon
    && rect.right <= viewport.width + epsilon
    && rect.bottom <= viewport.height + epsilon;
}

export function evaluateSlottedControl(input: SlotEvaluationInput): SlotEvaluation {
  const { anchor, controlRect, viewport, minHitTarget, hitTestOk } = input;
  if (!anchor) return { ok: false, reason: "anchor-missing" };
  if (anchor.display === "none" || anchor.visibility === "hidden" || anchor.visibility === "collapse") {
    return { ok: false, reason: "anchor-hidden" };
  }
  const opacity = Number.parseFloat(anchor.opacity);
  if (Number.isFinite(opacity) && opacity <= 0.01) return { ok: false, reason: "anchor-hidden" };
  if (anchor.rect.width < HOST_SLOT_MIN_ANCHOR_SIZE || anchor.rect.height < HOST_SLOT_MIN_ANCHOR_SIZE) {
    return { ok: false, reason: "anchor-tiny" };
  }
  // The anchor itself does not have to accept pointer events: the control is
  // hit-tested separately, above it.
  if (!isHostPartReachable({
    display: anchor.display,
    visibility: anchor.visibility,
    opacity: anchor.opacity,
    pointerEvents: "auto",
    clipPath: anchor.clipPath,
    clip: anchor.clip,
    rect: anchor.rect,
    viewport,
  })) {
    return { ok: false, reason: "anchor-offscreen" };
  }
  if (visibleAreaRatio(anchor.rect, viewport) < HOST_SLOT_MIN_VISIBLE_RATIO) {
    return { ok: false, reason: "anchor-offscreen" };
  }

  if (!(controlRect.width > 0) || !(controlRect.height > 0)) return { ok: false, reason: "control-hidden" };
  if (controlRect.width < minHitTarget || controlRect.height < minHitTarget) {
    return { ok: false, reason: "control-too-small" };
  }
  if (!fullyInsideViewport(controlRect, viewport)) return { ok: false, reason: "control-offscreen" };
  if (!hitTestOk) return { ok: false, reason: "hit-test" };
  return { ok: true };
}

export interface SlotModeState {
  slotted: boolean;
  /** Consecutive valid checks since the last fallback. */
  validStreak: number;
  /** Once true, re-slotting needs the anti-flap streak. */
  hasSlotted: boolean;
}

export const INITIAL_SLOT_MODE_STATE: SlotModeState = { slotted: false, validStreak: 0, hasSlotted: false };

/**
 * The first valid check slots immediately (no initial flash); after any
 * fallback, the anchor must stay valid for `requiredValidChecks` checks so a
 * flickering CSS animation cannot make the capsule jump every frame.
 */
export function nextSlotModeState(
  current: SlotModeState,
  ok: boolean,
  requiredValidChecks = HOST_SLOT_REQUIRED_VALID_CHECKS,
): SlotModeState {
  if (!ok) {
    return { slotted: false, validStreak: 0, hasSlotted: current.hasSlotted };
  }
  if (current.slotted) return { ...current, validStreak: 0 };
  const validStreak = current.validStreak + 1;
  const slotted = !current.hasSlotted || validStreak >= Math.max(1, requiredValidChecks);
  return {
    slotted,
    validStreak: slotted ? 0 : validStreak,
    hasSlotted: current.hasSlotted || slotted,
  };
}

/* ------------------------------------------------------------------ *
 * Style tokens
 * ------------------------------------------------------------------ */

export type RecoverySizeTier = "small" | "medium" | "large";

export interface RecoverySizeMetrics {
  /** Host-enforced minimum button hit target in CSS pixels. */
  readonly hitTarget: number;
  /** Host-enforced minimum font size in CSS pixels. */
  readonly fontSize: number;
}

export const RECOVERY_MIN_HIT_TARGET = 28;
export const RECOVERY_MIN_FONT_SIZE = 11;
export const RECOVERY_MIN_FOREGROUND_CONTRAST = 4.5;
export const RECOVERY_MIN_ACCENT_CONTRAST = 3;

/** Host-controlled metrics; a skin can choose a tier, never a smaller size. */
export const RECOVERY_SIZE_METRICS: Readonly<Record<RecoverySizeTier, RecoverySizeMetrics>> = {
  small: { hitTarget: RECOVERY_MIN_HIT_TARGET, fontSize: RECOVERY_MIN_FONT_SIZE },
  medium: { hitTarget: 32, fontSize: 12 },
  large: { hitTarget: 36, fontSize: 13 },
};

export interface RecoveryRawTokens {
  /** Computed-style colour values; unresolved CSS values are rejected. */
  accent?: string;
  background?: string;
  foreground?: string;
  radius?: string;
  font?: string;
  size?: string;
}

export interface RecoveryTokens {
  accent: string;
  background: string;
  foreground: string;
  radius: number;
  font: string;
  size: RecoverySizeTier;
  hitTarget: number;
  fontSize: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** CSS custom properties a skin declares on the anchor or an ancestor. */
export const RECOVERY_SKIN_TOKEN_PROPERTIES = {
  accent: "--skin-recovery-accent",
  background: "--skin-recovery-background",
  foreground: "--skin-recovery-foreground",
  radius: "--skin-recovery-radius",
  font: "--skin-recovery-font",
  size: "--skin-recovery-size",
} as const;

/** Host-owned variables set inside the closed shadow root. */
export const RECOVERY_APPLIED_VARIABLES = {
  accent: "--ws-recovery-accent",
  background: "--ws-recovery-background",
  foreground: "--ws-recovery-foreground",
  radius: "--ws-recovery-radius",
  font: "--ws-recovery-font",
  hitTarget: "--ws-recovery-hit",
  fontSize: "--ws-recovery-font-size",
} as const;

const DEFAULT_ACCENT: RgbColor = { r: 180, g: 83, b: 9 };
const DEFAULT_BACKGROUND: RgbColor = { r: 255, g: 255, b: 255 };
const DEFAULT_FOREGROUND: RgbColor = { r: 49, g: 82, b: 79 };
const DEFAULT_RADIUS = 999;
const DEFAULT_FONT = "ui-sans-serif, system-ui, sans-serif";
const MAX_RADIUS = 999;
const MAX_FONT_LENGTH = 120;
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"-]{1,120}$/;

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

export function isRecoverySizeTier(value: unknown): value is RecoverySizeTier {
  return value === "small" || value === "medium" || value === "large";
}

function sanitizeRadius(value: string | undefined): number {
  if (!value) return DEFAULT_RADIUS;
  const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (!match) return DEFAULT_RADIUS;
  const radius = Number.parseFloat(match[1]);
  return Number.isFinite(radius) ? Math.min(MAX_RADIUS, Math.max(0, radius)) : DEFAULT_RADIUS;
}

function sanitizeFont(value: string | undefined): string {
  if (!value) return DEFAULT_FONT;
  const font = value.trim().replace(/\s+/g, " ");
  if (!font || font.length > MAX_FONT_LENGTH || !FONT_FAMILY_PATTERN.test(font) || !/[A-Za-z0-9]/.test(font)) {
    return DEFAULT_FONT;
  }
  return font;
}

/**
 * Sanitize skin-provided tokens. Colours are all-or-nothing: a readable
 * foreground/background pair and a visible accent keep the skin palette;
 * otherwise the whole colour group reverts to the host palette so a skin can
 * never make the recovery action unreadable.
 */
export function resolveRecoveryTokens(raw: RecoveryRawTokens = {}): RecoveryTokens {
  const accent = parseCssColor(raw.accent) ?? DEFAULT_ACCENT;
  const background = parseCssColor(raw.background) ?? DEFAULT_BACKGROUND;
  const foreground = parseCssColor(raw.foreground) ?? DEFAULT_FOREGROUND;
  const readable = contrastRatio(foreground, background) >= RECOVERY_MIN_FOREGROUND_CONTRAST
    && contrastRatio(accent, background) >= RECOVERY_MIN_ACCENT_CONTRAST;
  const palette = readable ? { accent, background, foreground } : {
    accent: DEFAULT_ACCENT,
    background: DEFAULT_BACKGROUND,
    foreground: DEFAULT_FOREGROUND,
  };
  const sizeValue = raw.size?.trim();
  const size = isRecoverySizeTier(sizeValue) ? sizeValue : "small";
  const metrics = RECOVERY_SIZE_METRICS[size];
  return {
    accent: formatRgb(palette.accent),
    background: formatRgb(palette.background),
    foreground: formatRgb(palette.foreground),
    radius: sanitizeRadius(raw.radius),
    font: sanitizeFont(raw.font),
    size,
    hitTarget: metrics.hitTarget,
    fontSize: metrics.fontSize,
  };
}

/** Apply (or clear) host-owned variables on the control inside the shadow root. */
export function applyRecoveryTokens(control: HTMLElement, tokens: RecoveryTokens | null): void {
  const style = control.style;
  if (!tokens) {
    for (const property of Object.values(RECOVERY_APPLIED_VARIABLES)) style.removeProperty(property);
    return;
  }
  style.setProperty(RECOVERY_APPLIED_VARIABLES.accent, tokens.accent);
  style.setProperty(RECOVERY_APPLIED_VARIABLES.background, tokens.background);
  style.setProperty(RECOVERY_APPLIED_VARIABLES.foreground, tokens.foreground);
  style.setProperty(RECOVERY_APPLIED_VARIABLES.radius, `${tokens.radius}px`);
  style.setProperty(RECOVERY_APPLIED_VARIABLES.font, tokens.font);
  style.setProperty(RECOVERY_APPLIED_VARIABLES.hitTarget, `${tokens.hitTarget}px`);
  style.setProperty(RECOVERY_APPLIED_VARIABLES.fontSize, `${tokens.fontSize}px`);
}

/* ------------------------------------------------------------------ *
 * DOM binding
 * ------------------------------------------------------------------ */

function rectOf(rect: DOMRect | HostPartRect): HostPartRect {
  return {
    width: rect.width,
    height: rect.height,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function isVisibleAnchor(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  return isHostPartReachable({
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    pointerEvents: "auto",
    clipPath: style.clipPath,
    clip: style.clip,
    rect: rectOf(element.getBoundingClientRect()),
    viewport: { width: view.innerWidth, height: view.innerHeight },
  });
}

/**
 * Resolve the first visible `[data-ws-part="<anchor>"]` inside the active
 * skin's DOM. Plugin and surface hosts render inside `.ws-skin-root` too
 * (runtime plugins may Teleport to a `data-ws-skin-mount` slot, but every
 * mount slot is part of the skin root), so a skin cannot point the recovery
 * control at host chrome outside its own subtree.
 */
export function resolveSkinAnchor(
  anchor: string,
  doc: Document = document,
  skinId?: string,
): HTMLElement | null {
  const selector = `[data-ws-part="${anchor}"]`;
  for (const root of doc.querySelectorAll(".ws-skin-root")) {
    if (skinId && root.getAttribute("data-ws-skin") !== skinId) continue;
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (isVisibleAnchor(element)) return element;
    }
  }
  return null;
}

/** The active skin's root element; the token source while no anchor is usable. */
export function findSkinRoot(skinId: string | undefined, doc: Document = document): Element | null {
  for (const root of doc.querySelectorAll(".ws-skin-root")) {
    if (!skinId || root.getAttribute("data-ws-skin") === skinId) return root;
  }
  return null;
}

export interface HostSlotModeChange {
  mode: "slotted" | "floating";
  reason?: SlotFailureReason;
}

export interface HostSlotBindingOptions {
  layer: HostOwnedLayer;
  control: HTMLElement;
  anchor: string;
  /** Restricts anchor resolution and token fallback to this active skin. */
  skinId?: string;
  align?: SkinChromeSlotAlign;
  resolveAnchor?: (anchor: string) => HTMLElement | null;
  onModeChange?: (change: HostSlotModeChange) => void;
}

export interface HostSlotBinding {
  revalidate(): void;
  dispose(): void;
}

const NOOP_BINDING: HostSlotBinding = {
  revalidate: () => undefined,
  dispose: () => undefined,
};

/**
 * Position the controlled host element over its anchor, re-check it on layout
 * changes and return it to the default floating position on any failure.
 * Tokens are read from the anchor's computed style and applied inside the
 * closed shadow root; the skin never writes to the control itself.
 */
export function bindHostSlot(options: HostSlotBindingOptions): HostSlotBinding {
  const { layer, control, anchor: anchorName, onModeChange } = options;
  const align = options.align ?? "end";
  const doc = control.ownerDocument;
  const view = doc.defaultView;
  if (!view) return NOOP_BINDING;
  const win = view;
  const resolveAnchor = options.resolveAnchor
    ?? ((name: string) => resolveSkinAnchor(name, doc, options.skinId));

  let state = INITIAL_SLOT_MODE_STATE;
  let lastReason: SlotFailureReason | undefined;
  let currentAnchor: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;
  let probe: HTMLElement | null = null;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const requestFrame = (callback: FrameRequestCallback): number => win.requestAnimationFrame(callback);
  const cancelFrame = (handle: number): void => win.cancelAnimationFrame(handle);

  function ensureProbe(): HTMLElement | null {
    if (probe) return probe;
    probe = doc.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;left:-9999px;top:0;width:0;height:0;visibility:hidden;pointer-events:none;";
    layer.shadow.append(probe);
    return probe;
  }

  /** Resolve a CSS colour through the browser, inside the closed shadow root. */
  function probeColor(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const element = ensureProbe();
    if (!element) return undefined;
    element.style.color = "rgb(1, 2, 3)";
    element.style.color = raw;
    const computed = win.getComputedStyle(element).color;
    return computed === "rgb(1, 2, 3)" ? undefined : computed;
  }

  function readTokens(source: Element | null): RecoveryTokens {
    if (!source) return resolveRecoveryTokens();
    const style = win.getComputedStyle(source);
    const read = (property: string): string | undefined => style.getPropertyValue(property).trim() || undefined;
    return resolveRecoveryTokens({
      accent: probeColor(read(RECOVERY_SKIN_TOKEN_PROPERTIES.accent)),
      background: probeColor(read(RECOVERY_SKIN_TOKEN_PROPERTIES.background)),
      foreground: probeColor(read(RECOVERY_SKIN_TOKEN_PROPERTIES.foreground)),
      radius: read(RECOVERY_SKIN_TOKEN_PROPERTIES.radius),
      font: read(RECOVERY_SKIN_TOKEN_PROPERTIES.font),
      size: read(RECOVERY_SKIN_TOKEN_PROPERTIES.size),
    });
  }

  function clearPlacement(): void {
    control.style.removeProperty("position");
    control.style.removeProperty("left");
    control.style.removeProperty("top");
    control.style.removeProperty("right");
    control.style.removeProperty("bottom");
  }

  function applyPlacement(left: number, top: number): void {
    control.style.position = "fixed";
    control.style.left = `${left}px`;
    control.style.top = `${top}px`;
    control.style.right = "auto";
    control.style.bottom = "auto";
  }

  function hitTestAt(left: number, top: number, size: { width: number; height: number }): boolean {
    if (typeof doc.elementFromPoint !== "function") return true;
    // A hit inside the closed shadow root retargets to the layer host, which is
    // exactly what `elementFromPoint` returns for the top-layer capsule.
    const hit = doc.elementFromPoint(left + size.width / 2, top + size.height / 2);
    return hit === layer.host;
  }

  function observe(anchorElement: HTMLElement | null): void {
    if (currentAnchor === anchorElement) return;
    currentAnchor = anchorElement;
    if (!observer && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => schedule());
    }
    if (!observer) return;
    observer.disconnect();
    observer.observe(control);
    if (anchorElement) observer.observe(anchorElement);
  }

  function evaluate(): void {
    if (disposed) return;
    const anchorElement = resolveAnchor(anchorName);
    observe(anchorElement);
    // The fallback keeps the skin palette: read tokens from the anchor, or
    // from the skin root when the anchor is missing or hidden.
    const tokenSource = anchorElement
      ?? (options.skinId ? findSkinRoot(options.skinId, doc) : null);
    const tokens = readTokens(tokenSource);
    applyRecoveryTokens(control, tokenSource ? tokens : null);

    const controlBox = control.getBoundingClientRect();
    const viewport: SlotViewport = { width: win.innerWidth, height: win.innerHeight };
    let anchorSnapshot: SlotAnchorSnapshot | null = null;
    if (anchorElement) {
      const style = win.getComputedStyle(anchorElement);
      anchorSnapshot = {
        rect: rectOf(anchorElement.getBoundingClientRect()),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        clipPath: style.clipPath,
        clip: style.clip,
      };
    }

    const canPlace = Boolean(anchorSnapshot) && controlBox.width > 0 && controlBox.height > 0;
    const placement = canPlace && anchorSnapshot
      ? computeSlotPlacement(anchorSnapshot.rect, controlBox, viewport, align)
      : null;
    const intendedRect: HostPartRect = placement
      ? {
        width: controlBox.width,
        height: controlBox.height,
        left: placement.left,
        top: placement.top,
        right: placement.left + controlBox.width,
        bottom: placement.top + controlBox.height,
      }
      : rectOf(controlBox);
    // Move first, then hit-test: the capsule has to actually occupy the
    // intended point before `elementFromPoint` can see it. The move and a
    // failed revert happen in one task, so nothing paints in between.
    if (placement) applyPlacement(placement.left, placement.top);
    const evaluation = evaluateSlottedControl({
      anchor: anchorSnapshot,
      controlRect: intendedRect,
      viewport,
      minHitTarget: tokens?.hitTarget ?? RECOVERY_SIZE_METRICS.small.hitTarget,
      hitTestOk: placement
        ? hitTestAt(placement.left, placement.top, { width: controlBox.width, height: controlBox.height })
        : false,
    });

    const next = nextSlotModeState(state, evaluation.ok);
    const changed = next.slotted !== state.slotted;
    state = next;
    if (state.slotted && placement) applyPlacement(placement.left, placement.top);
    else clearPlacement();

    const reason = evaluation.ok ? undefined : evaluation.reason;
    const mode = state.slotted ? "slotted" : "floating";
    if (changed || (mode === "floating" && reason !== lastReason)) {
      lastReason = reason;
      onModeChange?.({ mode, ...(reason ? { reason } : {}) });
    }
  }

  function schedule(): void {
    if (disposed || frame !== undefined) return;
    frame = requestFrame(() => {
      frame = undefined;
      evaluate();
    });
  }

  function scheduleTick(): void {
    if (disposed) return;
    timer = setTimeout(() => {
      if (disposed) return;
      evaluate();
      scheduleTick();
    }, state.slotted ? HOST_SLOT_SLOTTED_INTERVAL_MS : HOST_SLOT_IDLE_INTERVAL_MS);
  }

  win.addEventListener("resize", schedule, { passive: true });
  win.addEventListener("scroll", schedule, { capture: true, passive: true });
  evaluate();
  scheduleTick();

  return {
    revalidate: evaluate,
    dispose() {
      disposed = true;
      observer?.disconnect();
      observer = null;
      if (frame !== undefined) cancelFrame(frame);
      if (timer) clearTimeout(timer);
      win.removeEventListener("resize", schedule);
      win.removeEventListener("scroll", schedule, { capture: true });
      clearPlacement();
      applyRecoveryTokens(control, null);
      probe?.remove();
      probe = null;
    },
  };
}
