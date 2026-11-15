import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOATING_WEIGHT_CONTROL,
  FLOATING_WEIGHT_DIALOG,
  FLOATING_WEIGHT_PROTECTED,
  chooseFloatingPosition,
  floatingRect,
  floatingScore,
  type FloatingObstacle,
} from "./host-floating-placement.js";
import type { HostPartRect } from "./host-chrome-visibility.js";

const rect = (left: number, top: number, width: number, height: number): HostPartRect => ({
  left, top, width, height, right: left + width, bottom: top + height,
});
const viewport = { width: 1280, height: 800 };
const margins = { top: 12, right: 12, bottom: 38, left: 12 };
const capsule = { width: 200, height: 38 };

test("floating rects follow the corner margins and stay inside the viewport", () => {
  assert.deepEqual(floatingRect("bottom-left", capsule, viewport, margins), rect(12, 724, 200, 38));
  assert.deepEqual(floatingRect("bottom-right", capsule, viewport, margins), rect(1068, 724, 200, 38));
  assert.deepEqual(floatingRect("top-left", capsule, viewport, margins), rect(12, 12, 200, 38));
  assert.deepEqual(floatingRect("middle-right", capsule, viewport, margins), rect(1068, 381, 200, 38));
  assert.deepEqual(floatingRect("bottom-center", capsule, viewport, margins), rect(540, 724, 200, 38));
  // A control wider than a phone viewport is clamped to x = 0, never off-screen.
  const narrow = floatingRect("bottom-right", { width: 500, height: 38 }, { width: 390, height: 844 }, margins);
  assert.equal(narrow.left, 0);
  assert.ok(narrow.bottom <= 844);
});

test("score is zero without overlap, ignores 1px brushes and weights protected/dialog controls", () => {
  const footprint = rect(12, 724, 200, 38);
  assert.equal(floatingScore(footprint, [{ rect: rect(400, 400, 40, 40), weight: 1 }]), 0);
  assert.equal(floatingScore(footprint, [{ rect: rect(211, 724, 40, 38), weight: 1 }]), 0);
  const control = floatingScore(footprint, [{ rect: rect(150, 730, 34, 34), weight: FLOATING_WEIGHT_CONTROL }]);
  const protectedPart = floatingScore(footprint, [{ rect: rect(150, 730, 34, 34), weight: FLOATING_WEIGHT_PROTECTED }]);
  const dialog = floatingScore(footprint, [{ rect: rect(150, 730, 34, 34), weight: FLOATING_WEIGHT_DIALOG }]);
  assert.ok(control > 0 && protectedPart > control && dialog > protectedPart);
});

test("the default corner is kept while it is free", () => {
  const choice = chooseFloatingPosition({ current: "bottom-left", size: capsule, viewport, margins, obstacles: [] });
  assert.deepEqual(choice, { position: "bottom-left", score: 0 });
});

test("a capsule over the microphone moves to the first free corner", () => {
  // Persona-style dock: microphone at x≈226 under the default capsule.
  const obstacles: FloatingObstacle[] = [
    { rect: rect(209, 738, 34, 34), weight: FLOATING_WEIGHT_PROTECTED },
    // Something in the bottom-right corner too (chat composer send button).
    { rect: rect(1200, 730, 40, 40), weight: FLOATING_WEIGHT_CONTROL },
  ];
  const choice = chooseFloatingPosition({ current: "bottom-left", size: capsule, viewport, margins, obstacles });
  assert.equal(choice.position, "top-left");
  assert.equal(choice.score, 0);
});

test("when every position collides, the least harmful one wins and dialogs dominate", () => {
  const mobile = { width: 390, height: 844 };
  const wide = { width: 250, height: 38 };
  // Bottom sheet: Cancel (left) and Enter (right) inside a dialog; header
  // controls at the top are ordinary controls.
  const obstacles: FloatingObstacle[] = [
    { rect: rect(20, 780, 190, 44), weight: FLOATING_WEIGHT_DIALOG },
    { rect: rect(228, 780, 140, 44), weight: FLOATING_WEIGHT_DIALOG },
    { rect: rect(0, 0, 390, 70), weight: FLOATING_WEIGHT_CONTROL },
    { rect: rect(0, 380, 390, 90), weight: FLOATING_WEIGHT_CONTROL },
  ];
  const choice = chooseFloatingPosition({ current: "bottom-left", size: wide, viewport: mobile, margins, obstacles });
  assert.ok(!choice.position.startsWith("bottom"), choice.position);
  assert.ok(choice.score > 0 && choice.score < FLOATING_WEIGHT_DIALOG);
});

test("ties keep the current position (no flapping between equal corners)", () => {
  const obstacles: FloatingObstacle[] = [{ rect: rect(0, 0, 1280, 800), weight: 1 }];
  const choice = chooseFloatingPosition({ current: "top-right", size: capsule, viewport, margins, obstacles });
  assert.equal(choice.position, "top-right");
});
