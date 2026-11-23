import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_SLOT_VIEWPORT_INSET,
  INITIAL_SLOT_MODE_STATE,
  computeSlotPlacement,
  evaluateSlottedControl,
  nextSlotModeState,
  rectsOverlap,
  type SlotAnchorSnapshot,
} from "./host-slot-placement.js";
import { HOST_CONTROL_MIN_HIT_TARGET } from "./host-control-tokens.js";
import type { HostPartRect } from "./host-chrome-visibility.js";

const rect = (left: number, top: number, width: number, height: number): HostPartRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const anchor = (overrides: Partial<SlotAnchorSnapshot> = {}): SlotAnchorSnapshot => ({
  rect: rect(100, 100, 200, 40),
  display: "flex",
  visibility: "visible",
  opacity: "1",
  ...overrides,
});

const baseEvaluation = {
  anchor: anchor(),
  controlRect: rect(180, 105, 120, 30),
  viewport: { width: 800, height: 600 },
  minHitTarget: HOST_CONTROL_MIN_HIT_TARGET,
  hitTestOk: true,
};

test("slot placement aligns inside the anchor and centres vertically", () => {
  const control = { width: 120, height: 30 };
  assert.deepEqual(computeSlotPlacement(anchor().rect, control, baseEvaluation.viewport, "start"), { left: 100, top: 105 });
  assert.deepEqual(computeSlotPlacement(anchor().rect, control, baseEvaluation.viewport, "center"), { left: 140, top: 105 });
  assert.deepEqual(computeSlotPlacement(anchor().rect, control, baseEvaluation.viewport), { left: 180, top: 105 });
  assert.deepEqual(computeSlotPlacement(anchor().rect, control, baseEvaluation.viewport, "end"), { left: 180, top: 105 });
});

test("slot placement clamps the control fully inside the viewport", () => {
  const viewport = { width: 800, height: 600 };
  const control = { width: 120, height: 30 };
  // Anchor off the left/top edge: the control stops at the safe inset.
  assert.deepEqual(computeSlotPlacement(rect(-500, -200, 100, 40), control, viewport, "start"), { left: 4, top: 4 });
  // Anchor off the right/bottom edge: the control stops before the edge.
  assert.deepEqual(computeSlotPlacement(rect(900, 700, 100, 40), control, viewport, "end"), { left: 676, top: 566 });
  // The anchor may be smaller than the control; the control overflows the
  // anchor but still stays inside the viewport.
  const tiny = computeSlotPlacement(rect(400, 300, 20, 10), control, viewport, "center");
  assert.ok(tiny.left >= 4 && tiny.left + control.width <= viewport.width - 4);
  assert.ok(tiny.top >= 4 && tiny.top + control.height <= viewport.height - 4);
});

test("a usable slotted control passes every check", () => {
  assert.deepEqual(evaluateSlottedControl(baseEvaluation), { ok: true });
});

test("missing, hidden, tiny and off-screen anchors fall back", () => {
  assert.deepEqual(evaluateSlottedControl({ ...baseEvaluation, anchor: null }), { ok: false, reason: "anchor-missing" });
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, anchor: anchor({ display: "none" }) }),
    { ok: false, reason: "anchor-hidden" },
  );
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, anchor: anchor({ visibility: "hidden" }) }),
    { ok: false, reason: "anchor-hidden" },
  );
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, anchor: anchor({ opacity: "0" }) }),
    { ok: false, reason: "anchor-hidden" },
  );
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, anchor: anchor({ rect: rect(100, 100, 4, 4) }) }),
    { ok: false, reason: "anchor-tiny" },
  );
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, anchor: anchor({ rect: rect(-500, -500, 100, 40) }) }),
    { ok: false, reason: "anchor-offscreen" },
  );
  // Only a small fraction of the anchor is on screen.
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, anchor: anchor({ rect: rect(790, 100, 100, 40) }) }),
    { ok: false, reason: "anchor-offscreen" },
  );
  // A clipped anchor is unusable even when its box looks fine.
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, anchor: anchor({ clipPath: "inset(50%)" }) }),
    { ok: false, reason: "anchor-offscreen" },
  );
});

test("an anchor that is at least half visible can host the control", () => {
  assert.deepEqual(
    evaluateSlottedControl({
      ...baseEvaluation,
      anchor: anchor({ rect: rect(750, 100, 100, 40) }),
      controlRect: rect(700, 100, 60, 30),
    }),
    { ok: true },
  );
});

test("control size, position and hit test are enforced", () => {
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, controlRect: rect(180, 105, 0, 0) }),
    { ok: false, reason: "control-hidden" },
  );
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, controlRect: rect(180, 105, 20, 20) }),
    { ok: false, reason: "control-too-small" },
  );
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, controlRect: rect(760, 105, 120, 30) }),
    { ok: false, reason: "control-offscreen" },
  );
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, hitTestOk: false }),
    { ok: false, reason: "hit-test" },
  );
});

test("the mode gate does not flap between the anchor and the fallback", () => {
  let state = INITIAL_SLOT_MODE_STATE;
  // The first valid check slots immediately, even under the anti-flap rule.
  state = nextSlotModeState(state, true);
  assert.deepEqual(state, { slotted: true, validStreak: 0, hasSlotted: true });

  // Any failure returns to the floating position at once.
  state = nextSlotModeState(state, false);
  assert.deepEqual(state, { slotted: false, validStreak: 0, hasSlotted: true });

  // A single valid sample is not enough to re-slot.
  state = nextSlotModeState(state, true);
  assert.equal(state.slotted, false);
  assert.equal(state.validStreak, 1);

  // A failure resets the streak.
  state = nextSlotModeState(state, false);
  assert.equal(state.validStreak, 0);

  state = nextSlotModeState(state, true);
  assert.equal(state.slotted, false);
  state = nextSlotModeState(state, true);
  assert.equal(state.slotted, true);
  assert.equal(state.hasSlotted, true);
});

test("a slotted capsule that would cover a protected control falls back", () => {
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, coversProtected: true }),
    { ok: false, reason: "covers-protected" },
  );
  assert.deepEqual(evaluateSlottedControl({ ...baseEvaluation, coversProtected: false }), { ok: true });
});

test("a toolbar that would cover another docked host control falls back", () => {
  assert.deepEqual(
    evaluateSlottedControl({
      ...baseEvaluation,
      otherControls: [rect(160, 105, 120, 30)],
    }),
    { ok: false, reason: "covers-host-control" },
  );
  // Edge contact is not a collision; both toolbars can still dock side by side.
  assert.deepEqual(
    evaluateSlottedControl({
      ...baseEvaluation,
      otherControls: [rect(60, 105, 120, 30)],
    }),
    { ok: true },
  );
  assert.deepEqual(
    evaluateSlottedControl({ ...baseEvaluation, otherControls: [] }),
    { ok: true },
  );
});

test("rect overlap ignores edge contact and sub-pixel slivers", () => {
  assert.equal(rectsOverlap(rect(0, 0, 100, 40), rect(50, 10, 100, 40)), true);
  assert.equal(rectsOverlap(rect(0, 0, 100, 40), rect(100, 0, 50, 40)), false);
  assert.equal(rectsOverlap(rect(0, 0, 100, 40), rect(99.5, 0, 50, 40)), false);
  assert.equal(rectsOverlap(rect(0, 0, 100, 40), rect(0, 60, 100, 40)), false);
});

test("toolbar buttons with long localised labels stay inside a narrow viewport", () => {
  // German "Integrierten Skin verwenden" / Russian / Japanese labels make a
  // toolbar button much wider than the capsule's short actions. The placement
  // clamps it into the viewport; when the control is wider than the viewport
  // the slot rejects it and the caller falls back to the capsule.
  const viewport = { width: 320, height: 640 };
  const wide = { width: 300, height: 64 };
  const placement = computeSlotPlacement(rect(280, 8, 32, 32), wide, viewport, "end");
  assert.ok(placement.left >= HOST_SLOT_VIEWPORT_INSET);
  assert.ok(placement.left + wide.width <= viewport.width - HOST_SLOT_VIEWPORT_INSET);

  const tooWide = rect(4, 8, 340, 64);
  assert.deepEqual(
    evaluateSlottedControl({
      anchor: anchor({ rect: rect(0, 0, 320, 48) }),
      controlRect: tooWide,
      viewport,
      minHitTarget: HOST_CONTROL_MIN_HIT_TARGET,
      hitTestOk: true,
    }),
    { ok: false, reason: "control-offscreen" },
    "an oversized toolbar must fall back to the visible capsule, not disappear",
  );

  // A wrapped two-line button (64px high) still passes the minimum hit target.
  assert.deepEqual(
    evaluateSlottedControl({
      anchor: anchor({ rect: rect(0, 0, 320, 120) }),
      controlRect: rect(4, 8, 300, 64),
      viewport,
      minHitTarget: HOST_CONTROL_MIN_HIT_TARGET,
      hitTestOk: true,
    }),
    { ok: true },
  );
});
