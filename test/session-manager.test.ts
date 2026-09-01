import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionStateMachine, SessionManager } from "../src/server/session-manager.js";

test("connection state machine accepts the normal lifecycle and rejects illegal jumps", () => {
  const machine = new ConnectionStateMachine();
  machine.transition("connecting");
  machine.transition("authenticating");
  machine.transition("syncing");
  machine.transition("connected");
  machine.transition("interrupted");
  machine.transition("reconnecting");
  machine.transition("connecting");
  assert.throws(() => machine.transition("connected"), /Illegal connection state transition/);
});

test("connection state machine can retry a transient authentication phase", () => {
  const machine = new ConnectionStateMachine();
  machine.transition("connecting");
  machine.transition("authenticating");
  machine.transition("reconnecting");
  machine.transition("connecting");
  machine.transition("authenticating");
  machine.transition("syncing");
  machine.transition("connected");
  assert.equal(machine.state, "connected");
});

test("managed session teardown is idempotent and reaches idle even when cleanup fails", async () => {
  const manager = new SessionManager();
  let cleanupCalls = 0;
  const session = manager.admit("session-a", async () => {
    cleanupCalls++;
    throw new Error("already closed");
  });
  assert.ok(session);
  session.transition("connecting");
  await Promise.all([session.teardown("websocket-close"), session.teardown("websocket-error")]);
  assert.equal(cleanupCalls, 1);
  assert.equal(session.state, "idle");
  assert.equal(manager.activeCount, 1);
  await manager.teardown("session-a", "websocket-close");
  assert.equal(manager.activeCount, 0);
});

test("session manager admits 100 active sessions and rejects the 101st", async () => {
  const manager = new SessionManager();
  for (let index = 0; index < 100; index++) {
    assert.ok(manager.admit(`session-${index}`, async () => undefined));
  }
  assert.equal(manager.activeCount, 100);
  assert.equal(manager.admit("session-100", async () => undefined), null);
  assert.equal(manager.peakCount, 100);
  assert.equal(manager.createdCount, 100);
  await manager.shutdown();
  assert.equal(manager.activeCount, 0);
  assert.equal(manager.isAccepting, false);
  assert.equal(manager.admit("after-shutdown", async () => undefined), null);
});
