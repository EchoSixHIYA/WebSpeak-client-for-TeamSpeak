import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelInfo, ClientInfo } from "@honeybbq/teamspeak-client";
import { DirectorySynchronizer } from "../src/server/directory-sync.js";

const root: ChannelInfo = { id: 1n, parentID: 0n, name: "Lobby", description: "", };
const games: ChannelInfo = { id: 2n, parentID: 1n, name: "Games", description: "", };

function client(id: number, nickname: string, channelID: bigint): ClientInfo {
  return { id, nickname, uid: `uid-${id}`, channelID, type: 1, serverGroups: [] };
}

test("directory synchronizer merges welcome events that arrive before the snapshot", () => {
  const sync = new DirectorySynchronizer();
  sync.applyClientEnter(client(7, "Alice", 1n));
  sync.applyClientMoved(7, 2n);
  sync.applySnapshot({ channels: [root, games], clients: [client(3, "Bob", 1n)] });
  assert.equal(sync.ready, true);
  assert.deepEqual(sync.getSnapshot()?.clients.map((item) => [item.id, item.channelID]), [[3, 1n], [7, 2n]]);
});

test("directory state and movement events remain isolated per session", () => {
  const first = new DirectorySynchronizer();
  const second = new DirectorySynchronizer();
  const snapshot = { channels: [root, games], clients: [client(3, "Bob", 1n)] };
  first.applySnapshot(snapshot);
  second.applySnapshot(snapshot);
  first.applyClientEnter(client(7, "Alice", 2n));
  first.applyClientMoved(3, 2n);
  first.applyClientLeave(7);
  assert.deepEqual(first.getSnapshot()?.clients.map((item) => [item.id, item.channelID]), [[3, 2n]]);
  assert.deepEqual(second.getSnapshot()?.clients.map((item) => [item.id, item.channelID]), [[3, 1n]]);
});
