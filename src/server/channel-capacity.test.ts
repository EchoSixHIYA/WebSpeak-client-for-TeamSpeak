import assert from "node:assert/strict";
import test from "node:test";
import { applyChannelCapacityNotification, parseChannelCapacities } from "./channel-capacity.js";

test("channel capacity rows keep finite limits and distinguish unlimited channels", () => {
  const capacities = parseChannelCapacities([
    { cid: "1", channel_maxclients: "10", channel_flag_maxclients_unlimited: "0" },
    { cid: "2", channel_maxclients: "0", channel_flag_maxclients_unlimited: "1" },
    { cid: "3", channel_maxclients: "65536", channel_flag_maxclients_unlimited: "0" },
    { cid: "4", channel_maxclients: "12" },
    { cid: "18446744073709551616", channel_maxclients: "4", channel_flag_maxclients_unlimited: "0" },
  ]);

  assert.deepEqual(capacities.get(1n), { maxClients: 10, maxClientsLimited: true });
  assert.deepEqual(capacities.get(2n), { maxClients: 0, maxClientsLimited: false });
  assert.equal(capacities.has(3n), false);
  assert.equal(capacities.has(4n), false);
  assert.equal(capacities.size, 2);
});

test("channel capacity notifications merge edits and remove deleted channels", () => {
  const capacities = new Map([[1n, { maxClients: 10, maxClientsLimited: true }]]);

  applyChannelCapacityNotification("notifychanneledited", { cid: "1", channel_maxclients: "16" }, capacities);
  assert.deepEqual(capacities.get(1n), { maxClients: 16, maxClientsLimited: true });

  applyChannelCapacityNotification("notifychanneledited", { cid: "1", channel_flag_maxclients_unlimited: "1" }, capacities);
  assert.deepEqual(capacities.get(1n), { maxClients: 16, maxClientsLimited: false });

  applyChannelCapacityNotification("notifychannelcreated", {
    cid: "2", channel_maxclients: "8", channel_flag_maxclients_unlimited: "0",
  }, capacities);
  assert.deepEqual(capacities.get(2n), { maxClients: 8, maxClientsLimited: true });

  applyChannelCapacityNotification("notifychanneldeleted", { cid: "2" }, capacities);
  assert.equal(capacities.has(2n), false);
});
