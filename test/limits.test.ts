import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAcceptSession, MAX_ACTIVE_SESSIONS } from "../src/constants.js";

describe("session safety limit", () => {
  it("uses the fixed 100-session product limit", () => {
    assert.equal(MAX_ACTIVE_SESSIONS, 100);
    assert.equal(canAcceptSession(99), true);
    assert.equal(canAcceptSession(100), false);
    assert.equal(canAcceptSession(101), false);
  });
});
