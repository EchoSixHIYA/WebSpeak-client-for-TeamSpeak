import assert from "node:assert/strict";
import test from "node:test";
import { DirectorySynchronizer } from "./directory-sync.js";

test("client-list refresh fills status omitted by client-enter without resurrecting departed members", () => {
  const directory = new DirectorySynchronizer();
  directory.applySnapshot({ channels: [], clients: [] });
  directory.applyClientEnter({
    id: 41,
    nickname: "New member",
    uid: "uid-41",
    channelID: 7n,
    type: 0,
    serverGroups: [],
  });

  directory.applyClientListSnapshot([{
    id: 41,
    nickname: "New member",
    uid: "uid-41",
    channelID: 7n,
    type: 0,
    serverGroups: [],
    away: true,
    awayMessage: "Be right back",
    inputMuted: false,
    outputMuted: true,
    channelCommander: false,
  }]);
  directory.applyClientLeave(41);
  directory.applyClientListSnapshot([{
    id: 41,
    nickname: "New member",
    uid: "uid-41",
    channelID: 7n,
    type: 0,
    serverGroups: [],
    away: true,
  }]);

  assert.deepEqual(directory.getSnapshot()?.clients, []);
});

test("client-list refresh is queued until the first directory snapshot", () => {
  const directory = new DirectorySynchronizer();
  directory.applyClientEnter({
    id: 41,
    nickname: "New member",
    uid: "uid-41",
    channelID: 7n,
    type: 0,
    serverGroups: [],
  });
  directory.applyClientListSnapshot([{
    id: 41,
    nickname: "New member",
    uid: "uid-41",
    channelID: 7n,
    type: 0,
    serverGroups: [],
    away: true,
  }]);
  directory.applySnapshot({ channels: [], clients: [] });

  assert.equal(directory.getSnapshot()?.clients[0]?.away, true);
});
