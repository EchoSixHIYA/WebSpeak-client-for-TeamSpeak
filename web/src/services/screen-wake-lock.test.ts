import assert from "node:assert/strict";
import test from "node:test";
import {
  createScreenWakeLockController,
  type ScreenWakeLockApi,
  type ScreenWakeLockSentinelLike,
  type ScreenWakeLockSnapshot,
  type ScreenWakeLockVisibilitySource,
} from "./screen-wake-lock.js";

class TestSentinel extends EventTarget implements ScreenWakeLockSentinelLike {
  released = false;

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

class TestVisibility extends EventTarget implements ScreenWakeLockVisibilitySource {
  visibilityState = "visible";

  setVisibility(visibilityState: string): void {
    this.visibilityState = visibilityState;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function createHarness(api: ScreenWakeLockApi | undefined) {
  const visibility = new TestVisibility();
  const states: ScreenWakeLockSnapshot[] = [];
  const controller = createScreenWakeLockController(api, visibility, (state) => states.push(state));
  return { controller, visibility, states };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("enabling acquires the screen lock and disabling releases it", async () => {
  const sentinel = new TestSentinel();
  let requests = 0;
  const { controller, states } = createHarness({
    async request(type) {
      assert.equal(type, "screen");
      requests += 1;
      return sentinel;
    },
  });

  controller.enable();
  await flushPromises();

  assert.equal(requests, 1);
  assert.deepEqual(controller.snapshot(), {
    supported: true,
    enabled: true,
    active: true,
    requesting: false,
    unavailable: false,
  });

  controller.disable();
  await flushPromises();

  assert.equal(sentinel.released, true);
  assert.equal(controller.snapshot().enabled, false);
  assert.equal(controller.snapshot().active, false);
  assert.equal(states.at(-1)?.enabled, false);
  controller.dispose();
});

test("the lock is released while hidden and reacquired when the page becomes visible", async () => {
  const sentinels: TestSentinel[] = [];
  const { controller, visibility } = createHarness({
    async request() {
      const sentinel = new TestSentinel();
      sentinels.push(sentinel);
      return sentinel;
    },
  });

  controller.enable();
  await flushPromises();
  visibility.setVisibility("hidden");
  await flushPromises();

  assert.equal(sentinels[0]?.released, true);
  assert.equal(controller.snapshot().enabled, true);
  assert.equal(controller.snapshot().active, false);

  visibility.setVisibility("visible");
  await flushPromises();

  assert.equal(sentinels.length, 2);
  assert.equal(controller.snapshot().active, true);
  controller.dispose();
});

test("failed requests are reported and can be retried", async () => {
  let requests = 0;
  const sentinel = new TestSentinel();
  const { controller } = createHarness({
    async request() {
      requests += 1;
      if (requests === 1) throw new Error("system denied the lock");
      return sentinel;
    },
  });

  controller.enable();
  await flushPromises();
  assert.equal(controller.snapshot().unavailable, true);

  controller.enable();
  await flushPromises();
  assert.equal(requests, 2);
  assert.equal(controller.snapshot().active, true);
  assert.equal(controller.snapshot().unavailable, false);
  controller.dispose();
});

test("a lock granted after the request is cancelled is immediately released", async () => {
  let resolveRequest: ((sentinel: ScreenWakeLockSentinelLike) => void) | undefined;
  const sentinel = new TestSentinel();
  const { controller } = createHarness({
    request: () => new Promise((resolve) => { resolveRequest = resolve; }),
  });

  controller.enable();
  controller.disable();
  resolveRequest?.(sentinel);
  await flushPromises();

  assert.equal(sentinel.released, true);
  assert.equal(controller.snapshot().enabled, false);
  assert.equal(controller.snapshot().active, false);
  controller.dispose();
});

test("unsupported browsers are reported without attempting a request", () => {
  const { controller } = createHarness(undefined);

  controller.enable();

  assert.deepEqual(controller.snapshot(), {
    supported: false,
    enabled: false,
    active: false,
    requesting: false,
    unavailable: true,
  });
  controller.dispose();
});
