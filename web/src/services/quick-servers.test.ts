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

test("server-provided name and image replace address placeholders while custom favorite names stay intact", () => {
  const icon = "data:image/png;base64,iVBORw0KGgo=";
  const quickServers = mergeQuickServers(
    [
      { id: "shanghai", label: "shanghai.example:9987", address: "shanghai.example:9987" },
      { id: "custom", label: "My room", address: "custom.example:9987" },
    ],
    [
      { id: "recent-shanghai", address: "shanghai.example:9987", serverName: "兄弟们的teamspeak", serverIcon: icon, lastConnectedAt: 2 },
      { id: "recent-custom", address: "custom.example:9987", serverName: "Original TeamSpeak name", lastConnectedAt: 1 },
    ],
  );

  const shanghai = quickServers.find((server) => server.address === "shanghai.example:9987");
  const custom = quickServers.find((server) => server.address === "custom.example:9987");
  assert.equal(shanghai?.label, "兄弟们的teamspeak");
  assert.equal(shanghai?.serverIcon, icon);
  assert.equal(custom?.label, "My room");
  assert.equal(custom?.serverName, "Original TeamSpeak name");
});

test("unsafe or non-image server icon URLs are ignored", () => {
  const quickServers = mergeQuickServers([], [{
    id: "recent",
    address: "voice.example:9987",
    serverName: "Voice",
    serverIcon: "https://tracking.example/image.png",
    lastConnectedAt: 1,
  }]);
  assert.equal(quickServers[0].serverIcon, undefined);
});
