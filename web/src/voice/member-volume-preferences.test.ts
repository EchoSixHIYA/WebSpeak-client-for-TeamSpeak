import assert from "node:assert/strict";
import test from "node:test";
import { applySavedMemberVolumes } from "./member-volume-preferences.js";

test("saved member volume follows the stable UID to a new connection-local client ID", () => {
  const volumes: Record<number, number> = {};
  const updated = applySavedMemberVolumes([
    { id: 19, nickname: "Peer", uid: "stable-peer-uid" },
    { id: 20, nickname: "No UID" },
  ], { "stable-peer-uid": 0.35 }, volumes);

  assert.deepEqual(updated, [19]);
  assert.deepEqual(volumes, { 19: 0.35 });
});

test("saved member volumes are clamped and unchanged or invalid values are ignored", () => {
  const volumes: Record<number, number> = { 19: 0.5, 20: 1 };
  const updated = applySavedMemberVolumes([
    { id: 19, nickname: "Peer", uid: "unchanged" },
    { id: 20, nickname: "Peer 2", uid: "invalid" },
    { id: 21, nickname: "Peer 3", uid: "too-high" },
  ], { unchanged: 0.5, invalid: Number.NaN, "too-high": 8 }, volumes);

  assert.deepEqual(updated, [21]);
  assert.deepEqual(volumes, { 19: 0.5, 20: 1, 21: 4 });
});
