/**
 * Runtime collision avoidance for host-owned floating controls.
 *
 * The recovery capsule (closed-shadow top layer) and the fallback application
 * library launcher float in a fixed viewport corner. Neither knows the active
 * skin's layout, so a skin that puts its own audio dock, chat composer or a
 * dialog's buttons in that corner used to lose those controls under the host
 * control: v0.3.2 already covered the microphone in the Persona skins, the
 * whole Harbor audio dock and the "Cancel" button of the mobile channel
 * password sheet.
 *
 * This module never restricts what a skin may do. It samples the skin's
 * visible interactive controls at runtime and moves the host control to the
 * candidate position that covers the fewest of them (protected parts and
 * controls inside an open dialog count more). When every position collides,
 * the caller may fall back to a compact footprint. The host control stays in
 * the viewport and stays clickable in every position; only its corner changes.
 */

import { PROTECTED_PART_IDS } from "../../../src/shared/skin-visual-parts.js";
import type { HostPartRect } from "./host-chrome-visibility.js";

export const FLOATING_POSITIONS = [
  "bottom-left",
  "bottom-right",
  "top-left",
  "top-right",
  "middle-left",
  "middle-right",
  "bottom-center",
  "top-center",
] as const;

export type FloatingPosition = typeof FLOATING_POSITIONS[number];

export interface FloatingMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FloatingObstacle {
  rect: HostPartRect;
  /** Higher weight = worse to cover (protected part, open dialog, other host control). */
  weight: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface FloatingViewport {
  width: number;
  height: number;
}

/** Interval of the runtime re-check while the control is shown. */
export const HOST_FLOATING_INTERVAL_MS = 400;
/** Extra re-check shortly after a click, which is what usually opens a dialog or sheet. */
export const HOST_FLOATING_AFTER_CLICK_MS = 150;
/** Obstacle weights. */
export const FLOATING_WEIGHT_CONTROL = 1;
export const FLOATING_WEIGHT_PROTECTED = 4;
export const FLOATING_WEIGHT_DIALOG = 8;
export const FLOATING_WEIGHT_HOST = 8;

/** Rect a control of `size` would occupy at `position`. */
export function floatingRect(
  position: FloatingPosition,
  size: FloatingSize,
  viewport: FloatingViewport,
  margins: FloatingMargins,
): HostPartRect {
  const width = Math.max(0, size.width);
  const height = Math.max(0, size.height);
  let left: number;
  if (position.endsWith("left")) left = margins.left;
  else if (position.endsWith("right")) left = viewport.width - margins.right - width;
  else left = (viewport.width - width) / 2;
  let top: number;
  if (position.startsWith("top")) top = margins.top;
  else if (position.startsWith("bottom")) top = viewport.height - margins.bottom - height;
  else top = (viewport.height - height) / 2;
  // Never leave the viewport, even on a viewport narrower than the control.
  left = Math.max(0, Math.min(left, viewport.width - width));
  top = Math.max(0, Math.min(top, viewport.height - height));
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function overlapArea(first: HostPartRect, second: HostPartRect): number {
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  // A one-pixel brush (shadow, border) is not a collision.
  return width > 1 && height > 1 ? width * height : 0;
}

/**
 * Collision score of a footprint: for every obstacle, the covered fraction of
 * that obstacle times its weight. Zero means nothing interactive is covered.
 */
export function floatingScore(footprint: HostPartRect, obstacles: readonly FloatingObstacle[]): number {
  let score = 0;
  for (const obstacle of obstacles) {
    const area = obstacle.rect.width * obstacle.rect.height;
    if (!(area > 0)) continue;
    const covered = overlapArea(footprint, obstacle.rect);
    if (covered > 0) score += obstacle.weight * Math.min(1, covered / area + 0.25);
  }
  return score;
}

export interface FloatingChoice {
  position: FloatingPosition;
  score: number;
}

/**
 * Keep `current` while it is collision-free; otherwise take the position with
 * the lowest score (ties keep `current`, then follow `FLOATING_POSITIONS`
 * order so the default corner wins whenever it is as good as any other).
 */
export function chooseFloatingPosition(input: {
  current: FloatingPosition;
  size: FloatingSize;
  viewport: FloatingViewport;
  margins: FloatingMargins;
  obstacles: readonly FloatingObstacle[];
  positions?: readonly FloatingPosition[];
}): FloatingChoice {
  const positions = input.positions ?? FLOATING_POSITIONS;
  const scoreAt = (position: FloatingPosition) => floatingScore(
    floatingRect(position, input.size, input.viewport, input.margins),
    input.obstacles,
  );
  const currentScore = scoreAt(input.current);
  if (currentScore === 0) return { position: input.current, score: 0 };
  let best: FloatingChoice = { position: input.current, score: currentScore };
  for (const position of positions) {
    if (position === input.current) continue;
    const score = scoreAt(position);
    if (score < best.score - 1e-6) best = { position, score };
    if (best.score === 0) break;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * DOM binding
 * ------------------------------------------------------------------ */

const INTERACTIVE_SELECTOR = "a[href],button,input:not([type='hidden']),select,textarea,summary,[role='button'],[role='tab'],[role='menuitem'],[role='link'],[contenteditable='true']";
const DIALOG_SELECTOR = "dialog[open],[role='dialog'],[role='alertdialog'],[aria-modal='true']";

/** Live host floating controls, so they also avoid each other. */
const registry = new Set<{ owner: Element; rect: () => HostPartRect | null }>();

function toRect(rect: DOMRect | HostPartRect): HostPartRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
}

/**
 * Visible, topmost interactive controls of the page (outside `self`). A control
 * hidden under the host control itself still counts: that is the collision we
 * want to resolve. A control hidden under a modal backdrop does not.
 */
export function collectFloatingObstacles(options: {
  doc: Document;
  /** Elements that belong to the floating control (light DOM wrapper or layer host). */
  isSelf: (element: Element) => boolean;
  owner: Element;
}): FloatingObstacle[] {
  const { doc, isSelf, owner } = options;
  const view = doc.defaultView;
  if (!view) return [];
  const obstacles: FloatingObstacle[] = [];
  const viewportWidth = view.innerWidth;
  const viewportHeight = view.innerHeight;
  for (const element of doc.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)) {
    if (isSelf(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewportWidth || rect.top >= viewportHeight) continue;
    const style = view.getComputedStyle(element);
    if (style.visibility === "hidden" || style.visibility === "collapse" || style.pointerEvents === "none") continue;
    // Disabled controls still count: a "Send" button is disabled only until the
    // user types, and the host control must not sit on it either way.
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), viewportWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), viewportHeight - 1);
    const hit = doc.elementFromPoint(x, y);
    if (!hit || !(hit === element || element.contains(hit) || isSelf(hit))) continue;
    const part = element.closest("[data-ws-part]")?.getAttribute("data-ws-part") ?? "";
    const weight = element.closest(DIALOG_SELECTOR)
      ? FLOATING_WEIGHT_DIALOG
      : PROTECTED_PART_IDS.has(part) ? FLOATING_WEIGHT_PROTECTED : FLOATING_WEIGHT_CONTROL;
    obstacles.push({ rect: toRect(rect), weight });
  }
  for (const entry of registry) {
    if (entry.owner === owner) continue;
    const rect = entry.rect();
    if (rect && rect.width > 0 && rect.height > 0) obstacles.push({ rect, weight: FLOATING_WEIGHT_HOST });
  }
  return obstacles;
}

export interface FloatingAvoidanceOptions {
  /** The floating element whose box is measured. */
  element: HTMLElement;
  /** Element that identifies "self" for hit tests (layer host or the element). */
  isSelf: (element: Element) => boolean;
  margins: FloatingMargins;
  defaultPosition?: FloatingPosition;
  /** Apply a position (attribute/class on the element; never inline skin styles). */
  apply: (position: FloatingPosition) => void;
  /** Optional smaller footprint used when every full-size position collides. */
  compactSize?: () => FloatingSize | null;
  onCompactChange?: (compact: boolean) => void;
  /** Skip re-evaluation (hovered, focused, slotted, drawer open…). */
  paused?: () => boolean;
}

export interface FloatingAvoidance {
  revalidate(): void;
  readonly position: FloatingPosition;
  dispose(): void;
}

export function bindFloatingAvoidance(options: FloatingAvoidanceOptions): FloatingAvoidance {
  const { element, isSelf, margins, apply, onCompactChange } = options;
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const defaultPosition = options.defaultPosition ?? "bottom-left";
  let position: FloatingPosition = defaultPosition;
  let compact = false;
  let fullSize: FloatingSize = { width: 0, height: 0 };
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const entry = {
    owner: element as Element,
    rect: () => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? toRect(rect) : null;
    },
  };
  registry.add(entry);
  apply(position);

  function setCompact(next: boolean) {
    if (compact === next) return;
    compact = next;
    onCompactChange?.(next);
  }

  function evaluate() {
    if (disposed || !view) return;
    if (options.paused?.()) return;
    const box = element.getBoundingClientRect();
    if (!(box.width > 0) || !(box.height > 0)) return;
    // The expanded footprint is what the user sees on hover/focus, so score
    // with the largest full size observed (never the compact size).
    if (!compact) fullSize = { width: Math.max(fullSize.width, box.width), height: Math.max(fullSize.height, box.height) };
    const size = fullSize.width > 0 ? fullSize : { width: box.width, height: box.height };
    const viewport = { width: view.innerWidth, height: view.innerHeight };
    const obstacles = collectFloatingObstacles({ doc, isSelf, owner: element });
    const full = chooseFloatingPosition({ current: position, size, viewport, margins, obstacles });
    let next = full;
    let nextCompact = false;
    const small = full.score > 0 ? options.compactSize?.() : null;
    if (small && small.width > 0 && small.height > 0) {
      const reduced = chooseFloatingPosition({ current: full.position, size: small, viewport, margins, obstacles });
      if (reduced.score < full.score - 1e-6) {
        next = reduced;
        nextCompact = true;
      }
    }
    if (next.position !== position) {
      position = next.position;
      apply(position);
    }
    setCompact(nextCompact);
  }

  function safeEvaluate() {
    try {
      evaluate();
    } catch {
      // A failed sample must never strand the control; return to the default.
      if (position !== defaultPosition) {
        position = defaultPosition;
        apply(position);
      }
      setCompact(false);
    }
  }

  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const afterClick = () => {
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(safeEvaluate, HOST_FLOATING_AFTER_CLICK_MS);
  };
  if (view) {
    timer = setInterval(safeEvaluate, HOST_FLOATING_INTERVAL_MS);
    view.addEventListener("resize", safeEvaluate, { passive: true });
    doc.addEventListener("click", afterClick, { capture: true, passive: true });
  }
  safeEvaluate();

  return {
    revalidate: safeEvaluate,
    get position() { return position; },
    dispose() {
      disposed = true;
      registry.delete(entry);
      if (timer) clearInterval(timer);
      if (clickTimer) clearTimeout(clickTimer);
      view?.removeEventListener("resize", safeEvaluate);
      doc.removeEventListener("click", afterClick, { capture: true });
      setCompact(false);
    },
  };
}
