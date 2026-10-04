import assert from "node:assert/strict";
import test from "node:test";
import { findScreenShareSourceChannelId, ScreenShareDiscoveryCoordinator } from "./screen-share-discovery.js";

test("screen-share discovery can run again after a previous pass completes", async () => {
  const coordinator = new ScreenShareDiscoveryCoordinator();
  let scans = 0;

  await coordinator.run("teamspeak.example:9987", async () => { scans += 1; });
  await coordinator.run("teamspeak.example:9987", async () => { scans += 1; });

  assert.equal(scans, 2);
});

test("overlapping discovery requests coalesce and schedule one trailing scan", async () => {
  const coordinator = new ScreenShareDiscoveryCoordinator();
  let scans = 0;
  let releaseFirstScan: (() => void) | undefined;

  const first = coordinator.run("teamspeak.example:9987", () => {
    scans += 1;
    return new Promise<void>((resolve) => { releaseFirstScan = resolve; });
  });
  await Promise.resolve();

  const second = coordinator.run("teamspeak.example:9987", async () => { scans += 1; });
  const third = coordinator.run("teamspeak.example:9987", async () => { scans += 1; });
  assert.ok(releaseFirstScan);
  releaseFirstScan();
  await Promise.all([first, second, third]);

  assert.equal(scans, 2);
});

test("native screen-share channel lookup is scoped to the matching server", () => {
  const sources = [
    { targetKey: "other.example:9987", clientChannelIds: new Map([[42, 99n]]) },
    { targetKey: "teamspeak.example:9987", clientChannelIds: new Map([[42, 7n], [43, 0n]]) },
  ];

  assert.equal(findScreenShareSourceChannelId(sources, "teamspeak.example:9987", 42), 7n);
  assert.equal(findScreenShareSourceChannelId(sources, "teamspeak.example:9987", 43), undefined);
  assert.equal(findScreenShareSourceChannelId(sources, "teamspeak.example:9987", 44), undefined);
});
