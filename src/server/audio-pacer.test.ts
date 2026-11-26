import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioPacer } from "./audio-pacer.js";

function fakeClock() {
  let now = 0;
  let nextId = 1;
  let task: { id: number; at: number; callback: () => void } | null = null;
  const schedule = (callback: () => void, delayMs: number) => {
    task = { id: nextId++, at: now + delayMs, callback };
    return task as unknown as ReturnType<typeof setTimeout>;
  };
  const cancel = (handle: ReturnType<typeof setTimeout>) => {
    if (task && task.id === (handle as unknown as { id: number }).id) task = null;
  };
  const runNext = () => {
    assert.ok(task, "expected a scheduled tick");
    now = Math.max(now, task.at);
    const callback = task.callback;
    task = null;
    callback();
  };
  return { now: () => now, setNow: (value: number) => { now = value; }, schedule, cancel, runNext, hasTask: () => task !== null };
}

test("pacer emits one frame every 20 ms and preserves order", () => {
  const clock = fakeClock();
  const sent: number[] = [];
  const pacer = new AudioPacer((_data, codec) => sent.push(codec), {
    now: clock.now, schedule: clock.schedule, cancel: clock.cancel, maxFrames: 4,
  });
  pacer.push(Buffer.from([1]), 1);
  pacer.push(Buffer.from([2]), 2);
  pacer.push(Buffer.from([3]), 3);
  assert.equal(sent.length, 0, "frames wait for the first timer turn");
  clock.runNext();
  assert.deepEqual(sent, [1]);
  assert.equal(pacer.getStats().currentFrames, 2);
  clock.runNext();
  assert.deepEqual(sent, [1, 2]);
  clock.runNext();
  assert.deepEqual(sent, [1, 2, 3]);
  assert.equal(pacer.getStats().currentFrames, 0);
  assert.equal(clock.hasTask(), false);
});

test("pacer drops the oldest frame when the queue is full and records peak", () => {
  const clock = fakeClock();
  const pacer = new AudioPacer(() => {}, { now: clock.now, schedule: clock.schedule, cancel: clock.cancel, maxFrames: 2 });
  pacer.push(Buffer.from([1]), 1);
  pacer.push(Buffer.from([2]), 2);
  pacer.push(Buffer.from([3]), 3);
  const stats = pacer.getStats();
  assert.equal(stats.currentFrames, 2);
  assert.equal(stats.peakFrames, 2);
  assert.equal(stats.droppedFrames, 1);
  pacer.close();
});

test("a late event-loop turn resets the deadline instead of bursting", () => {
  const clock = fakeClock();
  const sent: number[] = [];
  const pacer = new AudioPacer(() => sent.push(1), {
    now: clock.now, schedule: clock.schedule, cancel: clock.cancel, maxFrames: 4,
  });
  pacer.push(Buffer.from([1]), 1);
  pacer.push(Buffer.from([2]), 2);
  clock.setNow(100);
  clock.runNext();
  assert.equal(sent.length, 1);
  assert.equal(pacer.getStats().lateTicks, 1);
  pacer.close();
});
