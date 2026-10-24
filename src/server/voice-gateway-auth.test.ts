import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceGatewayAuthHeaders, parseDelegatedVoiceSession, VoiceGatewayRequestVerifier } from "./voice-gateway-auth.js";

const secret = "relay-auth-secret-long-enough";
const payload = {
  target: { host: "ts.example.invalid", port: 9987 },
  nickname: "Browser user",
  serverPassword: "secret",
  rememberIdentity: true,
};

test("voice gateway request authentication is canonical, time-limited and single-use", () => {
  const now = 1_800_000_000_000;
  const headers = createVoiceGatewayAuthHeaders(secret, payload, now, "a".repeat(32));
  const verifier = new VoiceGatewayRequestVerifier();

  assert.equal(verifier.verify(secret, {
    timestamp: headers["x-webspeak-relay-timestamp"],
    nonce: headers["x-webspeak-relay-nonce"],
    signature: headers["x-webspeak-relay-signature"],
  }, { serverPassword: "secret", nickname: "Browser user", rememberIdentity: true, target: { port: 9987, host: "ts.example.invalid" } }, now), true);
  assert.equal(verifier.verify(secret, {
    timestamp: headers["x-webspeak-relay-timestamp"],
    nonce: headers["x-webspeak-relay-nonce"],
    signature: headers["x-webspeak-relay-signature"],
  }, payload, now), false, "replayed nonces must be rejected");

  const stale = createVoiceGatewayAuthHeaders(secret, payload, now - 31_000, "b".repeat(32));
  assert.equal(verifier.verify(secret, {
    timestamp: stale["x-webspeak-relay-timestamp"],
    nonce: stale["x-webspeak-relay-nonce"],
    signature: stale["x-webspeak-relay-signature"],
  }, payload, now), false, "old signed requests must expire");
});

test("delegated voice session parser accepts only bounded TeamSpeak session data", () => {
  assert.deepEqual(parseDelegatedVoiceSession(payload), {
    target: { host: "ts.example.invalid", port: 9987 },
    serverPassword: "secret",
    nickname: "Browser user",
    rememberIdentity: true,
  });
  assert.equal(parseDelegatedVoiceSession({ ...payload, target: { host: "127.0.0.1/path", port: 9987 } }), null);
  assert.equal(parseDelegatedVoiceSession({ ...payload, nickname: "" }), null);
  assert.equal(parseDelegatedVoiceSession({ ...payload, serverPassword: "x".repeat(513) }), null);
});
