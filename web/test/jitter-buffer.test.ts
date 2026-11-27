import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeTargetAheadMs,
  JitterEstimator,
  shouldRecover,
  shouldResetSchedule,
} from "../src/voice/jitter-buffer.ts";

test("target buffer maps jitter to the 80-300 ms adaptive range", () => {
  assert.equal(computeTargetAheadMs(0), 80);
  assert.equal(computeTargetAheadMs(30), 155);
  assert.equal(computeTargetAheadMs(100), 300);
  assert.equal(computeTargetAheadMs(1_000), 300);
});

test("a configured 80 ms ceiling restores the old buffer bound", () => {
  assert.equal(computeTargetAheadMs(100, 80), 80);
  assert.equal(computeTargetAheadMs(0, 80), 80);
});

test("jitter estimator raises the target after a late burst", () => {
  const estimator = new JitterEstimator();
  assert.equal(estimator.observe(0, 20), 80);
  assert.equal(estimator.observe(20, 20), 80);
  const target = estimator.observe(100, 20);
  assert.ok(target > 80, `expected target above 80 ms, received ${target}`);
  assert.ok(target <= 300);
});

test("schedule reset and recovery thresholds keep hysteresis", () => {
  assert.equal(shouldResetSchedule(200, 80), true);
  assert.equal(shouldResetSchedule(130, 80), false);
  assert.equal(shouldRecover(10), true);
  assert.equal(shouldRecover(30), false);
});
