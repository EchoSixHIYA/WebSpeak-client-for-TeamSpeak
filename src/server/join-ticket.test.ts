import assert from "node:assert/strict";
import test from "node:test";
import { JoinTicketStore, type JoinTicketPayload } from "./join-ticket.js";

const payload: JoinTicketPayload = {
  target: { host: "voice.example.com", port: 9987 },
  serverPassword: "test-password",
  nickname: "Visitor",
  channel: "Lobby",
  identity: "test-identity",
  rememberIdentity: true,
  accelerated: true,
  accelerationRelayId: "relay-1",
};

test("join tickets preserve connection options and can only be consumed once", () => {
  const tickets = new JoinTicketStore();
  const token = tickets.create(payload, 1_000);
  assert.deepEqual(tickets.consume(token, 1_001), payload);
  assert.equal(tickets.consume(token, 1_002), null);
  assert.equal(tickets.consume("unknown-ticket", 1_002), null);
});

test("join tickets expire at their deadline even if no new ticket was created", () => {
  const tickets = new JoinTicketStore(100);
  const valid = tickets.create(payload, 1_000);
  const expired = tickets.create(payload, 1_000);
  assert.deepEqual(tickets.consume(valid, 1_099), payload);
  assert.equal(tickets.consume(expired, 1_100), null);
  assert.equal(tickets.consume(expired, 1_101), null);
});

test("ticket capacity evicts the oldest request while keeping newer joins usable", () => {
  const tickets = new JoinTicketStore(100, 2);
  const oldest = tickets.create(payload, 0);
  const second = tickets.create({ ...payload, nickname: "Second" }, 1);
  const newest = tickets.create({ ...payload, nickname: "Newest" }, 2);
  assert.equal(tickets.consume(oldest, 3), null);
  assert.equal(tickets.consume(second, 3)?.nickname, "Second");
  assert.equal(tickets.consume(newest, 3)?.nickname, "Newest");
});

test("expired tickets do not evict a still-valid join when capacity is reclaimed", () => {
  const tickets = new JoinTicketStore(100, 2);
  const expired = tickets.create(payload, 0);
  const live = tickets.create(payload, 90);
  const latest = tickets.create(payload, 100);
  assert.equal(tickets.consume(expired, 100), null);
  assert.deepEqual(tickets.consume(live, 100), payload);
  assert.deepEqual(tickets.consume(latest, 100), payload);
});


test("invitation expiry also bounds a previously issued one-use join ticket", () => {
  const store = new JoinTicketStore();
  const token = store.create({ target: { host: "1.1.1.1", port: 9987 }, serverPassword: "secret", nickname: "Guest", inviteExpiresAt: 2000 }, 1000);
  assert.equal(store.consume(token,2000),null);
});
