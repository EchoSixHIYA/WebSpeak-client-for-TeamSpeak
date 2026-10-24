import assert from "node:assert/strict";
import test from "node:test";
import type { DirectoryClientInfo, DirectorySnapshot } from "./teamspeak-sdk.js";
import { DirectorySynchronizer } from "./directory-sync.js";

function member(id: number, channelID = 1n, overrides: Partial<DirectoryClientInfo> = {}): DirectoryClientInfo {
  return { id, channelID, nickname: `Member ${id}`, uid: `uid-${id}`, serverGroups: [], type: 0, ...overrides };
}

function snapshot(...clients: DirectoryClientInfo[]): DirectorySnapshot {
  return { channels: [{ id: 1n, parentID: 0n, order: 0n, name: "Lobby", description: "" }], clients };
}

test("events received during the welcome sequence override the initial snapshot in order", () => {
  const directory = new DirectorySynchronizer();
  directory.applyClientMoved(1, 2n);
  directory.applyClientLeave(2);
  directory.applyClientEnter(member(3));
  directory.applyClientUpdated(member(3, 1n, { inputMuted: true }));
  assert.equal(directory.ready, false);
  assert.equal(directory.getSnapshot(), null);
  directory.applySnapshot(snapshot(member(1), member(2)));
  assert.equal(directory.ready, true);
  assert.deepEqual(directory.getSnapshot()?.clients, [member(1, 2n), member(3, 1n, { inputMuted: true })]);
});

test("partial snapshots retain earlier clients and state omitted by a later snapshot", () => {
  const directory = new DirectorySynchronizer();
  directory.applySnapshot(snapshot(member(1, 1n, { inputMuted: true }), member(2)));
  directory.applySnapshot(snapshot(member(1, 2n), member(3)));
  assert.deepEqual(directory.getSnapshot()?.clients, [member(1, 2n, { inputMuted: true }), member(2), member(3)]);
});

test("complete SDK views remove unsubscribed clients instead of retaining them as partial welcome data", () => {
  const directory = new DirectorySynchronizer();
  directory.applySnapshot({ ...snapshot(member(1), member(2)), complete: true });
  directory.applySnapshot({ ...snapshot(member(1, 1n, { inputMuted: true })), complete: true });
  assert.deepEqual(directory.getSnapshot()?.clients, [member(1, 1n, { inputMuted: true })]);
  directory.applySnapshot({ ...snapshot(member(1), member(2, 2n)), complete: true });
  assert.deepEqual(directory.getSnapshot()?.clients.map(client => client.id), [1, 2]);
});

test("a stale partial snapshot cannot bring back a departed client before an explicit rejoin", () => {
  const directory = new DirectorySynchronizer();
  directory.applySnapshot(snapshot(member(1), member(2)));
  directory.applyClientLeave(2);
  directory.applySnapshot(snapshot(member(2), member(3)));
  directory.applyClientUpdated(member(2, 1n, { away: true }));
  assert.deepEqual(directory.getSnapshot()?.clients.map((client) => client.id), [1, 3]);
  directory.applyClientEnter(member(2, 2n, { uid: "new-uid" }));
  assert.deepEqual(directory.getSnapshot()?.clients.find((client) => client.id === 2), member(2, 2n, { uid: "new-uid" }));
});

test("a status refresh enriches current clients without adding clients or restoring departures", () => {
  const directory = new DirectorySynchronizer();
  directory.applySnapshot(snapshot(member(1), member(2)));
  directory.applyClientLeave(2);
  directory.applyClientListSnapshot([
    member(1, 1n, { away: true, inputMuted: true, outputMuted: false }),
    member(2, 1n, { away: false, inputMuted: false }),
    member(3, 1n, { inputMuted: true }),
  ]);
  assert.deepEqual(directory.getSnapshot()?.clients, [
    member(1, 1n, { away: true, inputMuted: true, outputMuted: false }),
  ]);
});

test("a status snapshot received before the welcome directory is merged after queued enter and leave events", () => {
  const directory = new DirectorySynchronizer();
  directory.applyClientEnter(member(3));
  directory.applyClientLeave(2);
  directory.applyClientListSnapshot([member(2, 1n, { inputMuted: true }), member(3, 1n, { inputMuted: true })]);
  directory.applySnapshot(snapshot(member(1), member(2)));
  assert.deepEqual(directory.getSnapshot()?.clients, [
    member(1),
    member(3, 1n, { inputMuted: true }),
  ]);
});

test("clearing the directory drops pending events and departure history for a new connection", () => {
  const directory = new DirectorySynchronizer();
  directory.applyClientLeave(1);
  directory.applyClientEnter(member(2));
  directory.clear();
  directory.applySnapshot(snapshot(member(1)));
  directory.applyClientLeave(1);
  directory.clear();
  assert.equal(directory.ready, false);
  directory.applySnapshot(snapshot(member(1)));
  const exposed = directory.getSnapshot()!;
  assert.deepEqual(exposed.clients, [member(1)]);
  exposed.clients.pop();
  exposed.channels.pop();
  assert.equal(directory.getSnapshot()?.clients.length, 1);
  assert.equal(directory.getSnapshot()?.channels.length, 1);
});
