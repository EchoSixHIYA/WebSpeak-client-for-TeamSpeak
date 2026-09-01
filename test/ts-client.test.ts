import assert from "node:assert/strict";
import test from "node:test";
import { generateIdentity } from "@honeybbq/teamspeak-client";
import { parseTeamSpeakTarget } from "../src/domain/teamspeak-target.js";
import { TSClient } from "../src/server/ts-client.js";
import { silentLogger } from "./helpers/logger.js";

test("TSClient keeps the supplied identity material for reconnects", () => {
  const identity = generateIdentity(8);
  const client = new TSClient({ target: parseTeamSpeakTarget("example.com:9987"), nickname: "Guest", identity }, silentLogger);
  assert.equal(client.getIdentityString(), identity.toString());
});
