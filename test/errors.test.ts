import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTeamSpeakError } from "../src/errors.js";

describe("normalized connection errors", () => {
  it("classifies authentication failures as non-retryable", () => {
    const error = normalizeTeamSpeakError(new Error("invalid server password"));
    assert.equal(error.code, "authentication_failed");
    assert.equal(error.retryable, false);
  });

  it("classifies network and timeout failures", () => {
    assert.equal(normalizeTeamSpeakError(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })).code, "unreachable");
    assert.equal(normalizeTeamSpeakError(new Error("ack timeout")).code, "timeout");
  });
});
