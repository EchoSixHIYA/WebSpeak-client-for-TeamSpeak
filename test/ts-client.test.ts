import assert from "node:assert/strict";
import test from "node:test";
import { generateIdentity } from "@echosixhiya/teamspeak-client";
import { parseTeamSpeakTarget } from "../src/domain/teamspeak-target.js";
import { TSClient, toTSChatMessage } from "../src/server/ts-client.js";
import { silentLogger } from "./helpers/logger.js";

test("TSClient keeps the supplied identity material for reconnects", () => {
  const identity = generateIdentity(8);
  const client = new TSClient({ target: parseTeamSpeakTarget("example.com:9987"), nickname: "Guest", identity }, silentLogger);
  assert.equal(client.getIdentityString(), identity.toString());
});

test("TSClient preserves the TeamSpeak target id for private chat events", () => {
  const message = toTSChatMessage({
    invokerName: "Alice",
    invokerUID: "uid-alice",
    message: "hello",
    invokerGroups: [],
    targetMode: 1,
    targetID: 42n,
    invokerID: 7,
  });

  assert.equal(message.targetId, 42n);
  assert.equal(message.invokerId, 7);
  assert.equal(message.invokerUid, "uid-alice");
});
