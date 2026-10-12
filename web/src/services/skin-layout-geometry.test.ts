import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSkinLayoutGeometry,
  clampSkinLayoutOffset,
  getSkinLayoutOffsetBounds,
} from "./skin-layout-geometry.js";

const page = { left: 0, top: 0, right: 800, bottom: 600 };

test("layout diagnostics detect collision and overflow only when bounds actually intersect", () => {
  const target = { left: 700, top: 520, right: 840, bottom: 660 };
  const issues = analyzeSkinLayoutGeometry([target], page, [{ left: 720, top: 540, right: 780, bottom: 580 }]);
  assert.deepEqual(issues, { overflow: true, overlap: true });
  assert.deepEqual(analyzeSkinLayoutGeometry(
    [{ left: 0, top: 0, right: 40, bottom: 40 }], page,
    [{ left: 48, top: 0, right: 90, bottom: 40 }],
  ), { overflow: false, overlap: false });
  assert.deepEqual(analyzeSkinLayoutGeometry([
    { left: 0, top: 0, right: 140, bottom: 80 },
    { left: 100, top: 0, right: 240, bottom: 80 },
  ], page, []), { overflow: false, overlap: true });
});

test("position controls clamp every matching instance inside the available layout container", () => {
  const bounds = getSkinLayoutOffsetBounds([
    { left: 100, top: 80, right: 220, bottom: 160 },
    { left: 300, top: 300, right: 420, bottom: 380 },
  ], page, 0, "x");
  assert.deepEqual(bounds, { minimum: -100, maximum: 380 });
  assert.equal(clampSkinLayoutOffset(-500, bounds), -100);
  assert.equal(clampSkinLayoutOffset(500, bounds), 380);
  assert.equal(getSkinLayoutOffsetBounds([{ left: -40, top: 20, right: 860, bottom: 50 }], page, 0, "x"), null);
});
