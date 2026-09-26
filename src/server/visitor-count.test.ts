import assert from "node:assert/strict";
import test from "node:test";
import { resolveVisitorTotal } from "./visitor-count.js";

test("visitor total never disappears or falls below the current visitor ordinal", () => {
  assert.equal(resolveVisitorTotal(3, 0), 3);
  assert.equal(resolveVisitorTotal(3, 5), 5);
  assert.equal(resolveVisitorTotal(3, undefined), 3);
  assert.equal(resolveVisitorTotal(null, 8), 8);
  assert.equal(resolveVisitorTotal(null, -1), null);
  assert.equal(resolveVisitorTotal(0, 2), 2);
});
