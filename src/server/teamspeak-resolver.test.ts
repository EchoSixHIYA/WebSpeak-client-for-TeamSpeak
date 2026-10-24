import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalTeamSpeakAlias } from "./teamspeak-resolver.js";

test("private short hostnames resolve locally before upstream discovery", async () => {
  let lookedUp = "";
  const address = await resolveLocalTeamSpeakAlias("teamspeak", {
    lookup: async (hostname) => {
      lookedUp = hostname;
      return [
        { address: "203.0.113.4", family: 4 },
        { address: "172.18.0.6", family: 4 },
      ];
    },
  });
  assert.equal(lookedUp, "teamspeak");
  assert.equal(address, "172.18.0.6");
});

test("public and dotted names are left to the upstream resolver", async () => {
  let lookupCalls = 0;
  assert.equal(await resolveLocalTeamSpeakAlias("public-alias", {
    lookup: async () => {
      lookupCalls++;
      return [{ address: "203.0.113.4", family: 4 }];
    },
  }), undefined);
  assert.equal(await resolveLocalTeamSpeakAlias("voice.example.com", {
    lookup: async () => {
      lookupCalls++;
      return [{ address: "10.0.0.2", family: 4 }];
    },
  }), undefined);
  assert.equal(lookupCalls, 1);
});

test("a slow local lookup is bounded and falls through to upstream DNS", async () => {
  const result = await resolveLocalTeamSpeakAlias("teamspeak", {
    lookup: async () => new Promise(() => undefined),
    timeoutMs: 20,
  });
  assert.equal(result, undefined);
});

test("aborting a local lookup preserves the connection cancellation", async () => {
  const controller = new AbortController();
  const failure = new Error("connect cancelled");
  const pending = resolveLocalTeamSpeakAlias("teamspeak", {
    lookup: async () => new Promise(() => undefined),
    signal: controller.signal,
  });
  controller.abort(failure);
  await assert.rejects(pending, failure);
});
