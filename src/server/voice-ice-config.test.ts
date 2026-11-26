import assert from "node:assert/strict";
import { test } from "node:test";
import { readVoiceIceConfig, resolveVoiceIceServers } from "./voice-ice-config.js";

test("voice ICE env parses static servers and direct-first defaults", () => {
  const config = readVoiceIceConfig({
    WEBSPEAK_VOICE_ICE_SERVERS: '[{"urls":"stun:stun.example.com:3478"}]',
  });
  assert.deepEqual(config.servers, [{ urls: "stun:stun.example.com:3478" }]);
  assert.equal(config.transportPolicy, "all");
  assert.equal(config.gatewayTransportPolicy, "all");
  assert.equal(config.profile, "auto");
  assert.equal(config.opusWebSocket, false);
  assert.equal(config.jitterMaxMs, 300);
  assert.equal(config.turnRest, undefined);
});

test("voice profile is explicit-only for Opus and can force legacy or adaptive", () => {
  assert.equal(readVoiceIceConfig({}).profile, "auto");
  assert.equal(readVoiceIceConfig({ WEBSPEAK_VOICE_PROFILE: "legacy" }).profile, "legacy");
  assert.equal(readVoiceIceConfig({ WEBSPEAK_VOICE_PROFILE: "adaptive" }).profile, "adaptive");
  assert.equal(readVoiceIceConfig({ WEBSPEAK_VOICE_PROFILE: "invalid" }).profile, "auto");
  assert.equal(readVoiceIceConfig({ WEBSPEAK_VOICE_PROFILE: "adaptive", WEBSPEAK_VOICE_OPUS_WS: "1" }).opusWebSocket, true);
});

test("TURN REST env mints a per-session credential and keeps direct-first policy", () => {
  const config = readVoiceIceConfig({
    WEBSPEAK_TURN_REST_URLS: "turns:turn.example.com:443?transport=tcp,turn:turn.example.com:3478?transport=udp",
    WEBSPEAK_TURN_REST_SECRET: "a-test-secret-with-enough-length",
    WEBSPEAK_TURN_REST_TTL_SECONDS: "3600",
    WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY: "relay",
  });
  assert.equal(config.transportPolicy, "relay");
  assert.ok(config.turnRest);
  const servers = resolveVoiceIceServers(config, "session-a", 1_000_000);
  assert.equal(servers.length, 1);
  assert.match(servers[0]!.username!, /^[0-9]+:session-a$/);
  assert.ok(servers[0]!.credential);
});

test("short TURN secret is ignored instead of starting a broken relay", () => {
  const config = readVoiceIceConfig({
    WEBSPEAK_TURN_REST_URLS: "turns:turn.example.com:443",
    WEBSPEAK_TURN_REST_SECRET: "short",
  });
  assert.equal(config.turnRest, undefined);
  assert.deepEqual(resolveVoiceIceServers(config, "x"), []);
});
