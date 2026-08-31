import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EndpointProtocolCache, detectTeamSpeakProtocol } from "../src/server/teamspeak-adapter.js";

describe("TeamSpeak protocol adapter", () => {
  it("detects TS3 and TS6 from the normal version response", () => {
    assert.equal(detectTeamSpeakProtocol("version=3.13.7 build=12345"), "ts3");
    assert.equal(detectTeamSpeakProtocol("TeamSpeak 6 version 6.0.0"), "ts6");
    assert.equal(detectTeamSpeakProtocol("unknown"), null);
  });

  it("remembers a successful endpoint only for its bounded TTL", () => {
    const cache = new EndpointProtocolCache(1000, 2);
    const target = { host: "example.com", port: 9987 };
    cache.set(target, "ts6", 1000);
    assert.equal(cache.get(target, 1500), "ts6");
    assert.equal(cache.get(target, 2001), undefined);
  });

  it("evicts the oldest endpoint when bounded", () => {
    const cache = new EndpointProtocolCache(60_000, 2);
    cache.set({ host: "one.example", port: 9987 }, "ts3", 1);
    cache.set({ host: "two.example", port: 9987 }, "ts3", 2);
    cache.set({ host: "three.example", port: 9987 }, "ts6", 3);
    assert.equal(cache.size, 2);
    assert.equal(cache.get({ host: "one.example", port: 9987 }, 4), undefined);
  });
});
