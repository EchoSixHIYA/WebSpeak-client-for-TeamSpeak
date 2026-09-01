import assert from "node:assert/strict";
import test from "node:test";
import { AdminLoginRateLimiter } from "../src/admin/login-rate-limit.js";

test("admin login limiter blocks repeated failures for one peer", () => {
  const limiter = new AdminLoginRateLimiter();
  const start = 1_000_000;
  for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure("peer-a", start + attempt);
  assert.ok(limiter.retryAfterMs("peer-a", start + 5) > 0);
  assert.equal(limiter.retryAfterMs("peer-a", start + 5 * 60 * 1000), 0);
});

test("admin login limiter evicts old peers when its bounded table is full", () => {
  const limiter = new AdminLoginRateLimiter(2);
  for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure("oldest", 10 + attempt);
  limiter.recordFailure("second", 20);
  limiter.recordFailure("newest", 30);
  assert.equal(limiter.retryAfterMs("oldest", 31), 0);
  assert.equal(limiter.retryAfterMs("second", 31), 0);
});
