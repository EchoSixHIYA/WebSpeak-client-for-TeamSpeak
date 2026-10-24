import assert from "node:assert/strict";
import test from "node:test";
import pino from "pino";
import { createVoiceGatewayServer } from "./voice-gateway.js";
import { createVoiceGatewayAuthHeaders } from "./voice-gateway-auth.js";

test("voice relay gateway issues a one-time join ticket only for signed session requests", async t => {
  const sharedToken = "relay-shared-token-that-is-long-enough";
  const gateway = createVoiceGatewayServer({
    host: "127.0.0.1",
    port: 0,
    sharedToken,
    logger: pino({ enabled: false }),
    webRtc: { enabled: true },
  });
  const address = await gateway.start();
  t.after(() => gateway.stop());
  const url = `http://127.0.0.1:${address.port}/api/relay/voice-ticket`;
  const payload = {
    target: { host: "voice.example.invalid", port: 9987 },
    serverPassword: "secret",
    nickname: "Visitor",
    rememberIdentity: true,
  };
  const headers = createVoiceGatewayAuthHeaders(sharedToken, payload);
  const request = () => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

  const accepted = await request();
  assert.equal(accepted.status, 201);
  const body = await accepted.json() as { ok?: boolean; ticket?: string };
  assert.equal(body.ok, true);
  assert.equal(typeof body.ticket, "string");
  assert.ok((body.ticket?.length ?? 0) >= 32);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.equal((await request()).status, 401, "the signed request nonce cannot be replayed");

  const invalidPayload = { ...payload, nickname: "" };
  const invalidHeaders = createVoiceGatewayAuthHeaders(sharedToken, invalidPayload);
  const invalid = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...invalidHeaders },
    body: JSON.stringify(invalidPayload),
  });
  assert.equal(invalid.status, 400);
});
