import assert from "node:assert/strict";
import test from "node:test";
import { WebSpeakError } from "../src/errors.js";
import { RECONNECT_WINDOW_MS, isRecoverable, reconnectDelayMs, reconnectWindowOpen } from "../src/server/reconnect-policy.js";

test("reconnect backoff follows the bounded policy and applies deterministic jitter", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 8].map((attempt) => reconnectDelayMs(attempt, () => 0.5)), [1000, 2000, 4000, 8000, 15000, 30000, 30000]);
  assert.equal(reconnectDelayMs(1, () => 0), 900);
  assert.equal(reconnectDelayMs(1, () => 1), 1100);
  assert.equal(reconnectDelayMs(0, () => 0.5), 1000);
});

test("reconnect eligibility distinguishes transient failures from authentication failures", () => {
  assert.equal(isRecoverable(new WebSpeakError("unreachable", "offline", true)), true);
  assert.equal(isRecoverable(new WebSpeakError("authentication_failed", "bad password", false)), false);
  assert.equal(isRecoverable(null), true);
  assert.equal(reconnectWindowOpen(10_000, 10_000 + RECONNECT_WINDOW_MS - 1), true);
  assert.equal(reconnectWindowOpen(10_000, 10_000 + RECONNECT_WINDOW_MS), false);
});
