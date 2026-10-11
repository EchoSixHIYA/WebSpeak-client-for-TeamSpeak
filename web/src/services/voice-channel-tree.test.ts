import assert from "node:assert/strict";
import test from "node:test";
import { buildVoiceChannelTree, filterVoiceChannelTree } from "./voice-channel-tree.js";

test("channel search keeps matching nested channels and only their ancestors", () => {
  const tree = buildVoiceChannelTree([
    { id: "root", depth: 0, name: "大厅" },
    { id: "lobby", depth: 1, name: "聊天大厅" },
    { id: "games", depth: 1, name: "游戏区" },
    { id: "afk", depth: 2, name: "AFK" },
    { id: "music", depth: 2, name: "音乐" },
    { id: "other", depth: 0, name: "其他" },
  ]);

  const results = filterVoiceChannelTree(tree, "  afk ");
  assert.deepEqual(results.map(({ channel }) => channel.id), ["root"]);
  assert.deepEqual(results[0].children.map(({ channel }) => channel.id), ["games"]);
  assert.deepEqual(results[0].children[0].children.map(({ channel }) => channel.id), ["afk"]);
  assert.deepEqual(filterVoiceChannelTree(tree, "大厅").map(({ channel }) => channel.id), ["root"]);
  assert.deepEqual(filterVoiceChannelTree(tree, "missing"), []);
  assert.deepEqual(filterVoiceChannelTree(tree, " "), tree);
});
