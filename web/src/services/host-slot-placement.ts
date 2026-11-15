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
import { PROTECTED_PART_IDS } from "../../../src/shared/skin-visual-parts.js";
import {
  RECOVERY_CONTROL_DEFAULTS,
  applyHostControlTokens,
  createHostControlColorProbe,
  findSkinRoot,
  resolveHostControlTokens,
  type HostControlTokens,
  type HostControlColorProbe,
} from "./host-control-tokens.js";

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
  | "covers-protected"
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
  /**
   * The capsule's footprint (at its largest observed size, so a compact
   * capsule that expands on hover is included) overlaps a visible protected
   * control such as the microphone, output or "clear local data" link. The
   * capsule is top layer, so it would block those controls for the pointer.
   */
  coversProtected?: boolean;
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
  if (input.coversProtected) return { ok: false, reason: "covers-protected" };
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

/** Overlap of two rects in CSS pixels on both axes (more than 1px each). */
export function rectsOverlap(first: HostPartRect, second: HostPartRect): boolean {
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return width > 1 && height > 1;
}

const INTERACTIVE_SELECTOR = "a[href],button,input,select,textarea,[role='button'],[tabindex],[contenteditable='true']";

/**
 * Protected controls (`PROTECTED_PART_IDS`) that the capsule must not sit on.
 * Ancestors of the anchor (for example `app` or `voice.audio-dock` around a
 * dedicated anchor node) are containers, not click targets, and are skipped;
 * the anchor itself only counts when it is or contains an interactive control.
 */
export function protectedPartsCovered(
  footprint: HostPartRect,
  anchorElement: Element,
  doc: Document = anchorElement.ownerDocument,
): boolean {
  const view = doc.defaultView;
  for (const element of doc.querySelectorAll<HTMLElement>("[data-ws-part]")) {
    const part = element.getAttribute("data-ws-part") ?? "";
    if (!PROTECTED_PART_IDS.has(part)) continue;
    if (element === anchorElement) {
      if (!element.matches(INTERACTIVE_SELECTOR) && !element.querySelector(INTERACTIVE_SELECTOR)) continue;
    } else if (element.contains(anchorElement)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) continue;
    if (view) {
      const style = view.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") continue;
    }
    if (rectsOverlap(footprint, rectOf(rect))) return true;
  }
  return false;
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
  const colorProbe: HostControlColorProbe = createHostControlColorProbe(layer.shadow);
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** Largest capsule size seen; covers a compact capsule's expanded footprint. */
  let maxSize = { width: 0, height: 0 };

  const requestFrame = (callback: FrameRequestCallback): number => win.requestAnimationFrame(callback);
  const cancelFrame = (handle: number): void => win.cancelAnimationFrame(handle);

  function readTokens(source: Element | null): HostControlTokens {
    if (!source) return resolveHostControlTokens(null, "host.recovery", colorProbe.probeColor, RECOVERY_CONTROL_DEFAULTS);
    return resolveHostControlTokens(
      win.getComputedStyle(source),
      "host.recovery",
      colorProbe.probeColor,
      RECOVERY_CONTROL_DEFAULTS,
    );
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
    applyHostControlTokens(control, tokenSource ? tokens : null);

    const controlBox = control.getBoundingClientRect();
    maxSize = {
      width: Math.max(maxSize.width, controlBox.width),
      height: Math.max(maxSize.height, controlBox.height),
    };
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
    let coversProtected = false;
    if (anchorElement && anchorSnapshot && placement) {
      const footprintPlacement = computeSlotPlacement(anchorSnapshot.rect, maxSize, viewport, align);
      coversProtected = protectedPartsCovered({
        width: maxSize.width,
        height: maxSize.height,
        left: footprintPlacement.left,
        top: footprintPlacement.top,
        right: footprintPlacement.left + maxSize.width,
        bottom: footprintPlacement.top + maxSize.height,
      }, anchorElement, doc);
    }
    if (placement) applyPlacement(placement.left, placement.top);
    const evaluation = evaluateSlottedControl({
      anchor: anchorSnapshot,
      controlRect: intendedRect,
      viewport,
      minHitTarget: tokens.hitTarget,
      coversProtected,
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

  /** Any unexpected error returns the capsule to the default corner. */
  function failSafe(): void {
    const wasSlotted = state.slotted;
    state = nextSlotModeState(state, false);
    clearPlacement();
    if (wasSlotted) onModeChange?.({ mode: "floating" });
  }

  function schedule(): void {
    if (disposed || frame !== undefined) return;
    frame = requestFrame(() => {
      frame = undefined;
      try {
        evaluate();
      } catch {
        failSafe();
      }
    });
  }

  function scheduleTick(): void {
    if (disposed) return;
    timer = setTimeout(() => {
      if (disposed) return;
      // The periodic check is the safety net; one failing pass must not stop it.
      try {
        evaluate();
      } catch {
        failSafe();
      } finally {
        scheduleTick();
      }
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
      applyHostControlTokens(control, null);
      colorProbe.dispose();
    },
  };
}
