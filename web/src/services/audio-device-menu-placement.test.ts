import assert from "node:assert/strict";
import { test } from "node:test";
import { placeAudioDeviceMenu } from "./audio-device-menu-placement.js";

test("device menu opens below the trigger and keeps the 240px cap", () => {
  assert.deepEqual(
    placeAudioDeviceMenu({ top: 80, bottom: 120, left: 40, width: 280 }, { width: 1280, height: 720 }, 20),
    { top: 124, left: 40, width: 280, maxHeight: 240 },
  );
});

test("device menu opens above when the bottom edge cannot fit the list", () => {
  assert.deepEqual(
    placeAudioDeviceMenu({ top: 600, bottom: 640, left: 80, width: 300 }, { width: 1280, height: 700 }, 20),
    { top: 356, left: 80, width: 300, maxHeight: 240 },
  );
});

test("device menu shrinks to the remaining space in a short viewport", () => {
  const placement = placeAudioDeviceMenu(
    { top: 40, bottom: 60, left: 8, width: 180 },
    { width: 320, height: 84 },
    8,
  );

  assert.deepEqual(placement, { top: 8, left: 8, width: 180, maxHeight: 28 });
  assert.ok(placement.top + placement.maxHeight <= 84 - 8);
});

test("device menu width stays inside narrow viewport bounds", () => {
  assert.deepEqual(
    placeAudioDeviceMenu({ top: 20, bottom: 40, left: 120, width: 220 }, { width: 200, height: 400 }, 4),
    { top: 44, left: 8, width: 184, maxHeight: 136 },
  );
});
