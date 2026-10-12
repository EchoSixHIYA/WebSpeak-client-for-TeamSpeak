import assert from "node:assert/strict";
import test from "node:test";
import { createSkinRuntimePluginWasmGovernor, SkinRuntimePluginWasmGovernorError } from "./skin-runtime-plugin-wasm-governor.js";

test("Wasm worker governor grants slots FIFO and releases each slot once", async () => {
  const governor = createSkinRuntimePluginWasmGovernor({ maxConcurrentRuns: 1, maxPendingRuns: 2, queueTimeoutMs: 100 });
  const first = await governor.acquire(new AbortController().signal);
  const order: number[] = [];
  const second = governor.acquire(new AbortController().signal).then((release) => { order.push(2); return release; });
  const third = governor.acquire(new AbortController().signal).then((release) => { order.push(3); return release; });
  assert.equal(governor.activeRuns, 1);
  assert.equal(governor.pendingRuns, 2);
  first();
  first();
  const secondRelease = await second;
  assert.deepEqual(order, [2]);
  secondRelease();
  const thirdRelease = await third;
  assert.deepEqual(order, [2, 3]);
  thirdRelease();
  assert.equal(governor.activeRuns, 0);
});

test("Wasm worker governor bounds its queue and removes cancelled waiters", async () => {
  const governor = createSkinRuntimePluginWasmGovernor({ maxConcurrentRuns: 1, maxPendingRuns: 1, queueTimeoutMs: 100 });
  const release = await governor.acquire(new AbortController().signal);
  const cancelled = new AbortController();
  const waiting = governor.acquire(cancelled.signal);
  assert.equal(governor.pendingRuns, 1);
  await assert.rejects(governor.acquire(new AbortController().signal), (error: unknown) =>
    error instanceof SkinRuntimePluginWasmGovernorError && error.code === "SKIN_EXTENSION_WASM_QUEUE_FULL");
  cancelled.abort();
  await assert.rejects(waiting, (error: unknown) =>
    error instanceof SkinRuntimePluginWasmGovernorError && error.code === "SKIN_EXTENSION_WASM_QUEUE_CANCELLED");
  assert.equal(governor.pendingRuns, 0);
  release();
  assert.equal(governor.activeRuns, 0);
});

test("Wasm worker governor rejects queued work after the bounded wait", async () => {
  const governor = createSkinRuntimePluginWasmGovernor({ maxConcurrentRuns: 1, maxPendingRuns: 1, queueTimeoutMs: 5 });
  const release = await governor.acquire(new AbortController().signal);
  await assert.rejects(governor.acquire(new AbortController().signal), (error: unknown) =>
    error instanceof SkinRuntimePluginWasmGovernorError && error.code === "SKIN_EXTENSION_WASM_QUEUE_TIMEOUT");
  assert.equal(governor.pendingRuns, 0);
  release();
});

test("Wasm worker governor stays bounded and drains a saturated burst in FIFO order", async () => {
  const maxConcurrentRuns = 2;
  const maxPendingRuns = 64;
  const burstSize = 2_000;
  const governor = createSkinRuntimePluginWasmGovernor({
    maxConcurrentRuns,
    maxPendingRuns,
    queueTimeoutMs: 10_000,
  });
  const started: number[] = [];
  let active = 0;
  let peakActive = 0;
  const acquisitions = Array.from({ length: burstSize }, (_, index) => governor.acquire(new AbortController().signal)
    .then((release) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      started.push(index);
      return {
        index,
        release: () => {
          active -= 1;
          release();
        },
      };
    }, (error: unknown) => ({ index, error })));

  assert.equal(governor.activeRuns, maxConcurrentRuns);
  assert.equal(governor.pendingRuns, maxPendingRuns);
  const overflow = await Promise.all(acquisitions.slice(maxConcurrentRuns + maxPendingRuns));
  assert.equal(overflow.length, burstSize - maxConcurrentRuns - maxPendingRuns);
  assert.ok(overflow.every((item) => "error" in item
    && item.error instanceof SkinRuntimePluginWasmGovernorError
    && item.error.code === "SKIN_EXTENSION_WASM_QUEUE_FULL"));

  for (let index = 0; index < maxConcurrentRuns + maxPendingRuns; index += maxConcurrentRuns) {
    const batch = await Promise.all(acquisitions.slice(index, index + maxConcurrentRuns));
    assert.ok(batch.every((item) => "release" in item));
    batch.forEach((item) => {
      if ("release" in item) item.release();
    });
  }

  assert.deepEqual(started, Array.from({ length: maxConcurrentRuns + maxPendingRuns }, (_, index) => index));
  assert.equal(peakActive, maxConcurrentRuns);
  assert.equal(governor.activeRuns, 0);
  assert.equal(governor.pendingRuns, 0);
});
