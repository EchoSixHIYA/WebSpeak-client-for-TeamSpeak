import assert from "node:assert/strict";
import test from "node:test";
import { orderSequentialFocusTargets } from "./skin-layout-focus.js";

test("focus preview follows browser order: positive tabindex first, then DOM order, excluding negative targets", () => {
  const targets = [
    { id: "first-dom", tabIndex: 0 },
    { id: "second-positive", tabIndex: 2 },
    { id: "first-positive", tabIndex: 1 },
    { id: "programmatic-only", tabIndex: -1 },
    { id: "second-dom", tabIndex: 0 },
    { id: "same-positive", tabIndex: 1 },
  ];

  assert.deepEqual(orderSequentialFocusTargets(targets).map((target) => target.id), [
    "first-positive", "same-positive", "second-positive", "first-dom", "second-dom",
  ]);
});
