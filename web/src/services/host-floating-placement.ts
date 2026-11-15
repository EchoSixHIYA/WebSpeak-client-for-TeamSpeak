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
 * the caller may fall back to a compact footprint (only when that frees at
 * least one control). The host control stays in the viewport and stays
 * clickable in every position; only its corner changes. It does not move while
 * hovered or focused, and never moves onto the last pointer position or the
 * focused control. A control briefly hidden by a toast (or by the other host
 * floating control) still counts, so a passing toast never makes its corner
 * look free.
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
/** Above dialogs and the other host control: a protected control is the last thing to cover. */
export const FLOATING_WEIGHT_PROTECTED = 16;
export const FLOATING_WEIGHT_DIALOG = 8;
export const FLOATING_WEIGHT_HOST = 8;
/** Weight of the user's last pointer position and focused control when moving. */
export const FLOATING_WEIGHT_POINTER = 8;
/**
 * Folding to the compact mark must free at least one control's worth of score
 * (every covered obstacle costs at least `weight × 0.25`). A sliver less of a
 * viewport-sized click-away layer is not a reason to hide the buttons.
 */
export const FLOATING_FOLD_MIN_GAIN = 0.25;
/**
 * Anti-flap: a move needs the collision to persist for `MOVE_CONFIRM_MS`, moves
 * are at least `MOVE_MIN_INTERVAL_MS` apart, and more than `FLAP_MAX_MOVES`
 * moves within `FLAP_WINDOW_MS` (an animated or hostile skin) park the control
 * at its default corner for `FLAP_FREEZE_MS`, so it is never a moving target
 * (one escape per freeze is allowed when that corner covers a control).
 */
export const HOST_FLOATING_MOVE_CONFIRM_MS = 250;
export const HOST_FLOATING_MOVE_MIN_INTERVAL_MS = 1000;
export const HOST_FLOATING_FLAP_WINDOW_MS = 10_000;
export const HOST_FLOATING_FLAP_MAX_MOVES = 6;
export const HOST_FLOATING_FLAP_FREEZE_MS = 10_000;
/**
 * After the screen changes (home <-> voice page, skin switch) the old spot was
 * chosen for controls that no longer exist, so for this long the control moves
 * as soon as a sample disagrees, without the confirm delay or minimum interval.
 */
export const HOST_FLOATING_SCREEN_CHANGE_MS = 1500;
/** Re-samples after a screen change (the new screen renders over a few frames). */
export const HOST_FLOATING_SCREEN_CHANGE_SAMPLES_MS = [0, 120, 400, 900] as const;
/** Parts that wrap ordinary controls; a control inside them is not "protected" by that alone. */
const CONTAINER_PARTS: ReadonlySet<string> = new Set(["app", "home.footer"]);
/** Radius around the last pointer position that a move must not land on. */
const POINTER_RADIUS = 16;

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
 * the lowest score. Ties keep `current`, then follow `FLOATING_POSITIONS`
 * order. When `home` (the default corner) is given and both it and `current`
 * are free, go back home: a spot picked for one screen must not linger over
 * controls that appear on the next one (e.g. after leaving the voice page).
 * The binding passes `home` only right after a screen change: on the same
 * screen a free-looking default corner may just be hidden for a moment (a
 * modal dialog's backdrop, a toast) and going back there would cover it.
 * `moveObstacles` (the user's pointer and focused control) only count against
 * positions the control would move to, so it never jumps under the cursor or
 * onto the field being typed in.
 */
export function chooseFloatingPosition(input: {
  current: FloatingPosition;
  size: FloatingSize;
  viewport: FloatingViewport;
  margins: FloatingMargins;
  obstacles: readonly FloatingObstacle[];
  moveObstacles?: readonly FloatingObstacle[];
  positions?: readonly FloatingPosition[];
  home?: FloatingPosition;
}): FloatingChoice {
  const positions = input.positions ?? FLOATING_POSITIONS;
  const moveObstacles = input.moveObstacles ?? [];
  const scoreAt = (position: FloatingPosition) => {
    const footprint = floatingRect(position, input.size, input.viewport, input.margins);
    const score = floatingScore(footprint, input.obstacles);
    return position === input.current || !moveObstacles.length ? score : score + floatingScore(footprint, moveObstacles);
  };
  const currentScore = scoreAt(input.current);
  if (currentScore === 0) {
    if (input.home && input.home !== input.current && scoreAt(input.home) === 0) return { position: input.home, score: 0 };
    return { position: input.current, score: 0 };
  }
  let best: FloatingChoice = { position: input.current, score: currentScore };
  for (const position of positions) {
    if (position === input.current) continue;
    const score = scoreAt(position);
    if (score < best.score - 1e-6) best = { position, score };
    if (best.score === 0) break;
  }
  return best;
}

/** Fold to the compact mark only when that frees at least one control's worth. */
export function shouldFold(full: FloatingChoice, reduced: FloatingChoice): boolean {
  return full.score > 0 && reduced.score <= full.score - FLOATING_FOLD_MIN_GAIN + 1e-6;
}

/** Margins of a floating control: its own spacing plus the device safe area. */
export function readSafeAreaInsets(parent: Node & ParentNode): FloatingMargins {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const doc = parent.ownerDocument ?? (parent as unknown as Document);
  const view = doc?.defaultView;
  if (!view) return zero;
  const probe = doc.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;"
    + "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  parent.appendChild(probe);
  try {
    const style = view.getComputedStyle(probe);
    const read = (value: string) => Math.max(0, Number.parseFloat(value) || 0);
    return { top: read(style.paddingTop), right: read(style.paddingRight), bottom: read(style.paddingBottom), left: read(style.paddingLeft) };
  } finally {
    probe.remove();
  }
}

function rectsIntersect(first: HostPartRect, second: HostPartRect): boolean {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}

/* ------------------------------------------------------------------ *
 * DOM binding
 * ------------------------------------------------------------------ */

const INTERACTIVE_SELECTOR = "a[href],button,input:not([type='hidden']),select,textarea,summary,iframe,audio[controls],video[controls],"
  + "[role='button'],[role='tab'],[role='menuitem'],[role='link'],[role='option'],[role='switch'],[role='checkbox'],[role='radio'],"
  + "[contenteditable='true'],[tabindex]:not([tabindex='-1'])";
const DIALOG_SELECTOR = "dialog[open],[role='dialog'],[role='alertdialog'],[aria-modal='true']";
/**
 * Transient layers that float over the skin for a moment (the app toast). A
 * control under one is still there a second later, so it keeps counting as an
 * obstacle: otherwise a toast passing over a corner makes that corner look
 * free and the host control jumps onto the control the toast was covering.
 */
const TRANSIENT_OVERLAY_SELECTOR = "[data-ws-part='app.toast']";

/** Live host floating controls, so they also avoid each other. */
const registry = new Set<{ owner: Element; isSelf: (element: Element) => boolean; rect: () => HostPartRect | null }>();

/**
 * Whether a control is the topmost thing at a point once see-through layers
 * are skipped. `stack` is `elementsFromPoint` (topmost first); `isTarget` is
 * the control (or the floating control being placed, which is the collision
 * we want to resolve); `isTransparent` marks transient overlays and the other
 * host floating controls, which do not hide a control from this check.
 */
export function reachableThrough(
  stack: readonly Element[],
  isTarget: (element: Element) => boolean,
  isTransparent: (element: Element) => boolean,
): boolean {
  for (const element of stack) {
    if (isTarget(element)) return true;
    if (!isTransparent(element)) return false;
  }
  return false;
}

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
  /**
   * Only controls intersecting one of these rects can change a score; others
   * skip the style read and hit test (keeps a 3 000-control skin cheap).
   */
  regions?: readonly HostPartRect[];
}): FloatingObstacle[] {
  const { doc, isSelf, owner, regions } = options;
  const view = doc.defaultView;
  if (!view) return [];
  const obstacles: FloatingObstacle[] = [];
  const viewportWidth = view.innerWidth;
  const viewportHeight = view.innerHeight;
  const otherEntries = [...registry].filter(entry => entry.owner !== owner);
  const others = otherEntries.map(entry => entry.owner);
  const transparent = (element: Element) => element.closest(TRANSIENT_OVERLAY_SELECTOR) !== null
    || otherEntries.some(entry => entry.isSelf(element));
  const stackAt = (x: number, y: number): Element[] => {
    if (typeof doc.elementsFromPoint === "function") return doc.elementsFromPoint(x, y);
    const hit = doc.elementFromPoint(x, y);
    return hit ? [hit] : [];
  };
  for (const element of doc.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)) {
    if (isSelf(element)) continue;
    // Another host floating control is added once below, with its own weight.
    if (others.some(other => other.contains(element))) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewportWidth || rect.top >= viewportHeight) continue;
    if (regions && !regions.some(region => rectsIntersect(region, rect))) continue;
    // Invisible (opacity 0 / visibility hidden) controls cannot be covered.
    if (typeof element.checkVisibility === "function"
      && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const style = view.getComputedStyle(element);
    if (style.visibility === "hidden" || style.visibility === "collapse" || style.pointerEvents === "none") continue;
    // Disabled controls still count: a "Send" button is disabled only until the
    // user types, and the host control must not sit on it either way.
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), viewportWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), viewportHeight - 1);
    // Look through toasts and the other host floating control: what they hide
    // now is back in a moment. A modal backdrop or a skin layer still hides it.
    const isTarget = (hit: Element) => hit === element || element.contains(hit) || isSelf(hit);
    if (!reachableThrough(stackAt(x, y), isTarget, transparent)) continue;
    const part = element.closest("[data-ws-part]")?.getAttribute("data-ws-part") ?? "";
    const protectedPart = PROTECTED_PART_IDS.has(part) && !CONTAINER_PARTS.has(part);
    const weight = protectedPart
      ? FLOATING_WEIGHT_PROTECTED
      : element.closest(DIALOG_SELECTOR) ? FLOATING_WEIGHT_DIALOG : FLOATING_WEIGHT_CONTROL;
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
  /**
   * Fixed margins, or margins derived from the device safe-area insets (the
   * CSS positions the control with `env(safe-area-inset-*)`, so the model must
   * use the same numbers). Insets are re-read on bind and on resize.
   */
  margins: FloatingMargins | ((insets: FloatingMargins) => FloatingMargins);
  /** Where the safe-area probe is inserted (the control's shadow root or element). */
  insetsParent?: Node & ParentNode;
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
  /**
   * The page behind the control changed (route/view or skin switch): drop any
   * pending confirmation and re-place promptly instead of keeping a spot that
   * was picked for the previous screen.
   */
  screenChanged(): void;
  readonly position: FloatingPosition;
  dispose(): void;
}

export function bindFloatingAvoidance(options: FloatingAvoidanceOptions): FloatingAvoidance {
  const { element, isSelf, apply, onCompactChange } = options;
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const defaultPosition = options.defaultPosition ?? "bottom-left";
  let position: FloatingPosition = defaultPosition;
  let compact = false;
  let fullSize: FloatingSize = { width: 0, height: 0 };
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastViewport = { width: 0, height: 0 };
  let margins: FloatingMargins = { top: 0, right: 0, bottom: 0, left: 0 };
  let pointer: { x: number; y: number } | null = null;
  let pendingSince = 0;
  let lastMoveAt = Number.NEGATIVE_INFINITY;
  let frozenUntil = 0;
  let frozenEscaped = false;
  let moveTimes: number[] = [];
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let urgentUntil = 0;
  let screenTimers: ReturnType<typeof setTimeout>[] = [];
  function scheduleConfirm(delay: number) {
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { confirmTimer = undefined; safeEvaluate(); }, Math.max(0, delay) + 20);
  }
  function refreshMargins() {
    const spec = options.margins;
    if (typeof spec !== "function") { margins = spec; return; }
    let insets = { top: 0, right: 0, bottom: 0, left: 0 };
    try { insets = readSafeAreaInsets(options.insetsParent ?? element); } catch { /* keep zero insets */ }
    margins = spec(insets);
  }
  refreshMargins();
  const entry = {
    owner: element as Element,
    isSelf,
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
    const viewport = { width: view.innerWidth, height: view.innerHeight };
    if (viewport.width !== lastViewport.width || viewport.height !== lastViewport.height) {
      // Rotation / resize: re-read the safe area and forget the old footprint.
      lastViewport = viewport;
      fullSize = { width: 0, height: 0 };
      refreshMargins();
    }
    // Score with the expanded footprint the user sees on hover/focus: the live
    // size while expanded (it follows language changes), the last expanded
    // size while folded.
    if (!compact) fullSize = { width: box.width, height: box.height };
    const size = fullSize.width > 0 ? fullSize : { width: box.width, height: box.height };
    const small = options.compactSize?.() ?? null;
    const regions: HostPartRect[] = [];
    for (const candidate of FLOATING_POSITIONS) {
      regions.push(floatingRect(candidate, size, viewport, margins));
      if (small && small.width > 0 && small.height > 0) regions.push(floatingRect(candidate, small, viewport, margins));
    }
    const obstacles = collectFloatingObstacles({ doc, isSelf, owner: element, regions });
    const moveObstacles: FloatingObstacle[] = [];
    if (pointer) {
      moveObstacles.push({ rect: { left: pointer.x - POINTER_RADIUS, top: pointer.y - POINTER_RADIUS, width: POINTER_RADIUS * 2, height: POINTER_RADIUS * 2, right: pointer.x + POINTER_RADIUS, bottom: pointer.y + POINTER_RADIUS }, weight: FLOATING_WEIGHT_POINTER });
    }
    const focused = doc.activeElement;
    if (focused && focused !== doc.body && focused !== doc.documentElement && !isSelf(focused)) {
      const rect = focused.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) moveObstacles.push({ rect: toRect(rect), weight: FLOATING_WEIGHT_POINTER });
    }
    const now = Date.now();
    const urgent = now < urgentUntil;
    // Return home only after a screen change (see chooseFloatingPosition).
    const home = urgent ? defaultPosition : undefined;
    const full = chooseFloatingPosition({ current: position, size, viewport, margins, obstacles, moveObstacles, home });
    let next = full;
    let nextCompact = false;
    if (full.score > 0 && small && small.width > 0 && small.height > 0) {
      const reduced = chooseFloatingPosition({ current: full.position, size: small, viewport, margins, obstacles, moveObstacles });
      if (shouldFold(full, reduced)) {
        next = reduced;
        nextCompact = true;
      }
    }
    if (next.position === position && nextCompact === compact) {
      pendingSince = 0;
      return;
    }
    const frozen = now < frozenUntil;
    if (frozen) {
      // Frozen at the default corner: hold still, except one escape per
      // freeze when the parked spot covers a control and the move frees some
      // of it (e.g. a toast hid that control when the control was parked).
      const parked = floatingRect(position, compact && small ? small : size, viewport, margins);
      const parkedScore = floatingScore(parked, obstacles);
      if (frozenEscaped || !(parkedScore > 0 && next.score < parkedScore - 1e-6)) return;
    }
    if (!urgent && !pendingSince) {
      pendingSince = now;
      scheduleConfirm(HOST_FLOATING_MOVE_CONFIRM_MS);
      return;
    }
    if (!urgent && now - pendingSince < HOST_FLOATING_MOVE_CONFIRM_MS) {
      scheduleConfirm(HOST_FLOATING_MOVE_CONFIRM_MS - (now - pendingSince));
      return;
    }
    if (!urgent && now - lastMoveAt < HOST_FLOATING_MOVE_MIN_INTERVAL_MS) {
      scheduleConfirm(HOST_FLOATING_MOVE_MIN_INTERVAL_MS - (now - lastMoveAt));
      return;
    }
    pendingSince = 0;
    lastMoveAt = now;
    if (frozen) {
      // The escape does not count as flapping, and is the only one until the freeze ends.
      frozenEscaped = true;
      if (next.position !== position) {
        position = next.position;
        apply(position);
      }
      setCompact(nextCompact);
      return;
    }
    moveTimes = moveTimes.filter(time => now - time < HOST_FLOATING_FLAP_WINDOW_MS);
    moveTimes.push(now);
    if (moveTimes.length > HOST_FLOATING_FLAP_MAX_MOVES) {
      // Flapping: park at the default corner, expanded, and hold still.
      moveTimes = [];
      frozenUntil = now + HOST_FLOATING_FLAP_FREEZE_MS;
      frozenEscaped = false;
      if (position !== defaultPosition) {
        position = defaultPosition;
        apply(position);
      }
      setCompact(false);
      return;
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
  const onPointer = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
  const onPointerLeave = () => { pointer = null; };
  if (view) {
    timer = setInterval(safeEvaluate, HOST_FLOATING_INTERVAL_MS);
    view.addEventListener("resize", safeEvaluate, { passive: true });
    doc.addEventListener("click", afterClick, { capture: true, passive: true });
    // A scrolled list can carry a control under the host control.
    doc.addEventListener("scroll", afterClick, { capture: true, passive: true });
    doc.addEventListener("pointermove", onPointer, { capture: true, passive: true });
    doc.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
    doc.documentElement.addEventListener("pointerleave", onPointerLeave, { passive: true });
  }
  safeEvaluate();

  function screenChanged() {
    if (disposed) return;
    for (const pending of screenTimers) clearTimeout(pending);
    pendingSince = 0;
    urgentUntil = Date.now() + HOST_FLOATING_SCREEN_CHANGE_MS;
    screenTimers = HOST_FLOATING_SCREEN_CHANGE_SAMPLES_MS.map(delay => setTimeout(safeEvaluate, delay));
  }

  return {
    revalidate: safeEvaluate,
    screenChanged,
    get position() { return position; },
    dispose() {
      disposed = true;
      for (const pending of screenTimers) clearTimeout(pending);
      registry.delete(entry);
      if (timer) clearInterval(timer);
      if (clickTimer) clearTimeout(clickTimer);
      if (confirmTimer) clearTimeout(confirmTimer);
      view?.removeEventListener("resize", safeEvaluate);
      doc.removeEventListener("click", afterClick, { capture: true });
      doc.removeEventListener("scroll", afterClick, { capture: true });
      doc.removeEventListener("pointermove", onPointer, { capture: true });
      doc.removeEventListener("pointerdown", onPointer, { capture: true });
      doc.documentElement.removeEventListener("pointerleave", onPointerLeave);
      setCompact(false);
    },
  };
}
