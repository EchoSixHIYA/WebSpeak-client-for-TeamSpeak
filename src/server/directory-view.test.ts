import assert from "node:assert/strict";
import test from "node:test";
import type { TSDirectorySnapshot } from "./ts-client.js";
import { mapChannelTree, normalizeDirectorySnapshot } from "./directory-view.js";
import { parseServerMessage } from "../shared/server-messages.js";

const directory = (): TSDirectorySnapshot => ({
  channels: [{ id: 1n, parentID: 0n, order: 0n, name: "Lobby", description: "" }, { id: 18446744073709551615n, parentID: 1n, order: 1n, name: "Room", description: "", maxClients: 10, maxClientsLimited: true, passwordProtected: true }],
  clients: [{ id: 2, channelID: 1n, nickname: "Member", uid: "uid-2", type: 0, serverGroups: [], away: true, inputMuted: true }],
});

test("permanent channel flags survive the gateway wire, without guessing omitted flags", () => {
  const source = directory();
  source.channels[0] = { ...source.channels[0], name: "[cspacer0]Section", isPermanent: true };
  source.channels[1] = { ...source.channels[1], isPermanent: false };
  const channels = mapChannelTree(source);
  const message = parseServerMessage(JSON.parse(JSON.stringify({ type: "channelList", channels })));
  assert.ok(message?.type === "channelList");
  assert.equal(message.channels[0].name, "[cspacer0]Section");
  assert.equal(message.channels[0].isPermanent, true);
  assert.equal(message.channels[1].isPermanent, false);
  assert.equal(Object.hasOwn(mapChannelTree(directory())[0], "isPermanent"), false);
  assert.equal(parseServerMessage({ type: "channelList", channels: [{ ...channels[0], isPermanent: "true" }] }), null);
});

test("self restoration uses the connected channel before a snapshot or requested channel", () => {
  const source = directory();
  const result = normalizeDirectorySnapshot(source, 2, 18446744073709551615n, "Self", "Lobby");
  assert.equal(result.clients[0]?.channelID, 18446744073709551615n);
  assert.equal(result.clients[0]?.uid, "uid-2");
  assert.equal(source.clients[0]?.channelID, 1n);
  assert.equal(normalizeDirectorySnapshot(source, 0, 1n, "Unknown"), source);
});

test("partial welcome data can restore self by channel name without duplicating existing members", () => {
  const source = directory();
  const result = normalizeDirectorySnapshot(source, 3, 0n, "Self", " room ");
  assert.equal(result.clients.length, 2);
  assert.equal(result.clients[1]?.channelID, 18446744073709551615n);
  assert.equal(normalizeDirectorySnapshot(result, 3, 0n, "Self").clients.length, 2);
  assert.equal(source.clients.length, 1);
});

test("directory presentation survives JSON transport with large IDs, member flags and cached avatars", () => {
  const source = directory();
  const channels = mapChannelTree(source, new Map([["uid-2", "data:image/png;base64,test"]]));
  const decoded = parseServerMessage(JSON.parse(JSON.stringify({ type: "channelList", channels })));
  assert.ok(decoded?.type === "channelList");
  assert.equal(decoded.channels[1]?.id, "18446744073709551615");
  assert.equal(decoded.channels[0]?.members?.[0]?.inputMuted, true);
  assert.equal(decoded.channels[0]?.members?.[0]?.away, true);
  assert.equal(decoded.channels[0]?.members?.[0]?.avatar, "data:image/png;base64,test");
  assert.equal(decoded.channels[1]?.maxClients, 10);
  assert.equal(decoded.channels[1]?.maxClientsLimited, true);
  assert.equal(decoded.channels[1]?.passwordProtected, true);
  assert.deepEqual(decoded.channels[1]?.members, []);
});
