import assert from "node:assert/strict";
import test from "node:test";
import { generateIdentity } from "@honeybbq/teamspeak-client";
import { JoinTicketStore } from "../src/server/join-ticket.js";

test("join tickets are opaque, one-time, and expire", () => {
  const store = new JoinTicketStore(1000, 2);
  const payload = { target: { host: "example.com", port: 9987 }, serverPassword: "secret", nickname: "Guest" };
  const token = store.create(payload, 100);
  assert.equal(token.includes("secret"), false);
  assert.deepEqual(store.consume(token, 101), payload);
  assert.equal(store.consume(token, 102), null);
  const expired = store.create(payload, 200);
  assert.equal(store.consume(expired, 1201), null);
});

test("join tickets carry identity only in memory and never expose it in the opaque token", () => {
  const store = new JoinTicketStore();
  const identity = generateIdentity(8).toString();
  const payload = { target: { host: "example.com", port: 9987 }, serverPassword: "secret", nickname: "Guest", identity, rememberIdentity: true };
  const token = store.create(payload);
  assert.equal(token.includes(identity), false);
  assert.deepEqual(store.consume(token), payload);
});
