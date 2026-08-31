import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidTeamSpeakTargetError,
  formatTeamSpeakTarget,
  parseTeamSpeakTarget,
  parseTeamSpeakTargetParts,
  teamSpeakTargetKey,
} from "../src/domain/teamspeak-target.js";

describe("TeamSpeak target parser", () => {
  it("uses 9987 when the port is omitted", () => {
    assert.deepEqual(parseTeamSpeakTarget("Example.COM"), { host: "example.com", port: 9987 });
  });

  it("parses a custom port", () => {
    assert.deepEqual(parseTeamSpeakTarget("ts.example.com:9988"), { host: "ts.example.com", port: 9988 });
  });

  it("supports bracketed IPv6", () => {
    const target = parseTeamSpeakTarget("[2001:DB8::1]:9987");
    assert.deepEqual(target, { host: "2001:db8::1", port: 9987 });
    assert.equal(formatTeamSpeakTarget(target), "[2001:db8::1]:9987");
  });

  it("accepts legacy split fields", () => {
    assert.deepEqual(parseTeamSpeakTargetParts("[::1]", "9988"), { host: "::1", port: 9988 });
    assert.deepEqual(parseTeamSpeakTargetParts("ts.example.com", undefined), { host: "ts.example.com", port: 9987 });
  });

  it("rejects ambiguous raw IPv6 and invalid ports", () => {
    assert.throws(() => parseTeamSpeakTarget("2001:db8::1"), InvalidTeamSpeakTargetError);
    assert.throws(() => parseTeamSpeakTarget("example.com:0"), InvalidTeamSpeakTargetError);
    assert.throws(() => parseTeamSpeakTarget("example.com:65536"), InvalidTeamSpeakTargetError);
  });

  it("creates a stable case-insensitive cache key", () => {
    assert.equal(teamSpeakTargetKey({ host: "TS.Example.COM", port: 9987 }), "ts.example.com:9987");
  });
});
