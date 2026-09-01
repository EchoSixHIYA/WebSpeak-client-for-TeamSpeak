import assert from "node:assert/strict";
import test from "node:test";
import { JoinRateLimiter } from "../src/server/join-rate-limit.js";

test("join ticket creation is bounded per peer and resets after its window", () => {
  const limiter = new JoinRateLimiter(2);
  let now = 10_000;
  for (let attempt = 0; attempt < 30; attempt++) assert.equal(limiter.allow("peer-a", now), true);
  assert.equal(limiter.allow("peer-a", now), false);
  assert.equal(limiter.allow("peer-b", now), true);
  now += 60_000;
  assert.equal(limiter.allow("peer-a", now), true);
});
