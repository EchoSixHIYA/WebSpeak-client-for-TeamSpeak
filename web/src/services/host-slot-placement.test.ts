import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_SLOT_MODE_STATE,
  RECOVERY_BUILT_IN_BUTTON_BACKGROUND,
  RECOVERY_MIN_ACCENT_CONTRAST,
  RECOVERY_MIN_FONT_SIZE,
  RECOVERY_MIN_FOREGROUND_CONTRAST,
  RECOVERY_MIN_HIT_TARGET,
  RECOVERY_SIZE_METRICS,
  computeSlotPlacement,
  contrastRatio,
  evaluateSlottedControl,
  nextSlotModeState,
  parseCssColor,
  rectsOverlap,
  relativeLuminance,
  resolveRecoveryTokens,
  type SlotAnchorSnapshot,
} from "./host-slot-placement.js";
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
  minHitTarget: RECOVERY_MIN_HIT_TARGET,
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

test("CSS colours parse to RGB and ignore alpha for contrast", () => {
  assert.deepEqual(parseCssColor("#1d4f9c"), { r: 29, g: 79, b: 156 });
  assert.deepEqual(parseCssColor("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseCssColor("#ffff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseCssColor("rgb(29, 79, 156)"), { r: 29, g: 79, b: 156 });
  assert.deepEqual(parseCssColor("rgb(29 79 156 / 50%)"), { r: 29, g: 79, b: 156 });
  assert.deepEqual(parseCssColor("rgba(255, 0, 0, .4)"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseCssColor("rgb(300, -5, 0)"), { r: 255, g: 0, b: 0 });
  for (const invalid of ["", "red", "hsl(10, 20%, 30%)", "color(srgb 1 0 0)", "#12345", "rgb(1, 2)"]) {
    assert.equal(parseCssColor(invalid), null, invalid);
  }
});

test("WCAG contrast follows the relative-luminance formula", () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
  assert.equal(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), 21);
  assert.equal(contrastRatio({ r: 12, g: 34, b: 56 }, { r: 12, g: 34, b: 56 }), 1);
});

test("skin tokens default to the host palette", () => {
  const tokens = resolveRecoveryTokens();
  assert.deepEqual(tokens, {
    accent: "rgb(180, 83, 9)",
    builtInBorder: "rgb(180, 83, 9)",
    background: "rgb(255, 255, 255)",
    foreground: "rgb(49, 82, 79)",
    radius: 999,
    font: "ui-sans-serif, system-ui, sans-serif",
    size: "small",
    hitTarget: 28,
    fontSize: 11,
  });
});

test("a readable skin palette is kept and translucent backgrounds become opaque", () => {
  const tokens = resolveRecoveryTokens({
    accent: "#47dcc4",
    background: "rgba(9, 19, 23, 0.4)",
    foreground: "#edf8f5",
  });
  assert.equal(tokens.accent, "rgb(71, 220, 196)");
  assert.equal(tokens.background, "rgb(9, 19, 23)");
  assert.equal(tokens.foreground, "rgb(237, 248, 245)");
});

test("an unreadable colour group falls back as a whole", () => {
  const lowForeground = resolveRecoveryTokens({ background: "#777777", foreground: "#888888", accent: "#47dcc4" });
  assert.equal(lowForeground.background, "rgb(255, 255, 255)");
  assert.equal(lowForeground.foreground, "rgb(49, 82, 79)");
  assert.equal(lowForeground.accent, "rgb(180, 83, 9)");

  const lowAccent = resolveRecoveryTokens({ background: "#ffffff", foreground: "#31524f", accent: "#eeeeee" });
  assert.equal(lowAccent.accent, "rgb(180, 83, 9)");
  assert.ok(contrastRatio(parseCssColor(lowAccent.accent)!, parseCssColor(lowAccent.background)!) >= RECOVERY_MIN_ACCENT_CONTRAST);
  assert.ok(contrastRatio(parseCssColor(lowAccent.foreground)!, parseCssColor(lowAccent.background)!) >= RECOVERY_MIN_FOREGROUND_CONTRAST);
});

test("radius, font and size tokens are sanitized and host minimums win", () => {
  assert.equal(resolveRecoveryTokens({ radius: "12px" }).radius, 12);
  assert.equal(resolveRecoveryTokens({ radius: "2000px" }).radius, 999);
  assert.equal(resolveRecoveryTokens({ radius: "-5px" }).radius, 0);
  assert.equal(resolveRecoveryTokens({ radius: "1em" }).radius, 999);
  assert.equal(resolveRecoveryTokens({ radius: "12" }).radius, 999);

  assert.equal(
    resolveRecoveryTokens({ font: 'Tahoma, "Segoe UI", sans-serif' }).font,
    'Tahoma, "Segoe UI", sans-serif',
  );
  for (const font of ["url(https://example.invalid/a.woff2)", "Tahoma; color: red", "x".repeat(121)]) {
    assert.equal(resolveRecoveryTokens({ font }).font, "ui-sans-serif, system-ui, sans-serif", font);
  }

  assert.equal(resolveRecoveryTokens({ size: "medium" }).hitTarget, 32);
  assert.equal(resolveRecoveryTokens({ size: "medium" }).fontSize, 12);
  assert.equal(resolveRecoveryTokens({ size: "large" }).hitTarget, 36);
  assert.equal(resolveRecoveryTokens({ size: "large" }).fontSize, 13);
  assert.equal(resolveRecoveryTokens({ size: "huge" }).size, "small");
  for (const metrics of Object.values(RECOVERY_SIZE_METRICS)) {
    assert.ok(metrics.hitTarget >= RECOVERY_MIN_HIT_TARGET);
    assert.ok(metrics.fontSize >= RECOVERY_MIN_FONT_SIZE);
  }
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

test("rect overlap ignores edge contact and sub-pixel slivers", () => {
  assert.equal(rectsOverlap(rect(0, 0, 100, 40), rect(50, 10, 100, 40)), true);
  assert.equal(rectsOverlap(rect(0, 0, 100, 40), rect(100, 0, 50, 40)), false);
  assert.equal(rectsOverlap(rect(0, 0, 100, 40), rect(99.5, 0, 50, 40)), false);
  assert.equal(rectsOverlap(rect(0, 0, 100, 40), rect(0, 60, 100, 40)), false);
});

test("the built-in button border only uses an accent visible on its fixed light background", () => {
  // Passes against the dark skin background, but vanishes on #fff7ed.
  const pale = resolveRecoveryTokens({ background: "#141414", foreground: "#ffffff", accent: "#fff7ec" });
  assert.equal(pale.accent, "rgb(255, 247, 236)");
  assert.equal(pale.builtInBorder, "rgb(180, 83, 9)");
  assert.ok(contrastRatio(parseCssColor(pale.builtInBorder)!, RECOVERY_BUILT_IN_BUTTON_BACKGROUND) >= RECOVERY_MIN_ACCENT_CONTRAST);

  const strong = resolveRecoveryTokens({ background: "#ffffff", foreground: "#111111", accent: "#1d4ed8" });
  assert.equal(strong.builtInBorder, "rgb(29, 78, 216)");
});
