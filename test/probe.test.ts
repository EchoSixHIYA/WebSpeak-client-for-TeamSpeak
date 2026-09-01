import assert from "node:assert/strict";
import test from "node:test";
import { probeTeamSpeak, toProbeError } from "../src/server/teamspeak-probe.js";
import { silentLogger } from "./helpers/logger.js";

test("connection probe reports protocol/server and always tears down", async () => {
  let disconnected = false;
  const result = await probeTeamSpeak({ host: "example.com", port: 9987 }, "", silentLogger, () => ({
    protocol: "ts6",
    client: { execCommandWithResponse: async () => [{ virtualserver_name: "Example TS" }] },
    connect: async () => undefined,
    disconnect: async () => { disconnected = true; },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.protocol, "ts6");
  assert.equal(result.serverName, "Example TS");
  assert.equal(disconnected, true);
});

test("connection probe normalizes DNS errors and tears down failures", async () => {
  let disconnected = false;
  await assert.rejects(
    probeTeamSpeak({ host: "missing.invalid", port: 9987 }, "", silentLogger, () => ({
      protocol: null,
      client: { execCommandWithResponse: async () => [] },
      connect: async () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }); },
      disconnect: async () => { disconnected = true; },
    })),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "HOST_NOT_FOUND"),
  );
  assert.equal(disconnected, true);
  assert.equal(toProbeError(new Error("authentication invalid password")).code, "INVALID_PASSWORD");
});

test("connection probe keeps a successful result when cleanup reports an error", async () => {
  const result = await probeTeamSpeak(
    { host: "voice.example.com", port: 9987 },
    "",
    silentLogger,
    () => ({
      protocol: "ts6",
      client: { execCommandWithResponse: async () => [{ virtualserver_name: "Cleanup Test" }] },
      connect: async () => {},
      disconnect: async () => { throw new Error("already disconnected"); },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.serverName, "Cleanup Test");
});
