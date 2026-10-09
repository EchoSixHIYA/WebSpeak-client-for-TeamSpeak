import assert from "node:assert/strict";
import test from "node:test";
import { mergeQuickServers } from "./quick-servers.js";

test("quick servers put favorites first and merge matching recent connection details", () => {
  const quickServers = mergeQuickServers(
    [
      { id: "z", label: "Friends", address: "voice.example:9987", nickname: "Saved name" },
      { id: "a", label: "Games", address: "games.example:9987" },
    ],
    [
      {
        id: "recent-z",
        address: "VOICE.EXAMPLE:9987",
        nickname: "Current name",
        lastConnectedAt: 20,
        lastChannelHint: { name: "Lounge" },
      },
      { id: "recent-b", address: "community.example:9987", lastConnectedAt: 30 },
      { id: "recent-b-old", address: "COMMUNITY.example:9987", lastConnectedAt: 10 },
      { id: "recent-a", address: "games.example:9987", lastConnectedAt: 15 },
    ],
  );

  assert.deepEqual(quickServers.map(({ label, isFavorite }) => [label, isFavorite]), [
    ["Friends", true],
    ["Games", true],
    ["community.example:9987", false],
  ]);
  assert.equal(quickServers.length, 3);
  assert.equal(quickServers[0].nickname, "Current name");
  assert.deepEqual(quickServers[0].lastChannelHint, { name: "Lounge" });
  assert.equal(quickServers[2].lastConnectedAt, 30);
});

test("quick server addresses are trimmed, normalized, and empty targets are skipped", () => {
  const quickServers = mergeQuickServers(
    [{ id: "favorite", label: "Favorite", address: "  Voice.Example:9987 " }],
    [
      { id: "same", address: "voice.example:9987", lastConnectedAt: 2 },
      { id: "empty", address: "  ", lastConnectedAt: 3 },
    ],
  );

  assert.equal(quickServers.length, 1);
  assert.equal(quickServers[0].id, "voice.example:9987");
  assert.equal(quickServers[0].address, "Voice.Example:9987");
});
