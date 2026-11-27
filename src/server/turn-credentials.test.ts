import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { createTurnRestCredential, createTurnRestUsername } from "./turn-credentials.js";

test("TURN REST username and credential match coturn's HMAC contract", () => {
  const secret = "a-test-secret-with-enough-length";
  const config = { urls: ["turns:turn.example.com:443?transport=tcp"], secret, ttlSeconds: 3_600 };
  const now = 1_700_000_000_000;
  const credential = createTurnRestCredential(config, "session-1", now);
  const expiry = Math.floor(now / 1_000) + 3_600;
  const username = createTurnRestUsername(expiry, "session-1");
  assert.equal(credential.username, username);
  assert.equal(credential.credential, createHmac("sha1", secret).update(username).digest("base64"));
});

test("TURN REST session ids are sanitized and expiry stays in the future", () => {
  const credential = createTurnRestCredential(
    { urls: ["turn:turn.example.com:3478?transport=udp"], secret: "another-long-test-secret", ttlSeconds: 300 },
    "bad session:id!",
    1_000,
  );
  assert.match(credential.username!, /^[0-9]+:badsessionid/);
  assert.equal(credential.credential?.length, 28);
});
