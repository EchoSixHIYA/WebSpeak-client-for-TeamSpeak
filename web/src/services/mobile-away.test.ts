import assert from "node:assert/strict";
import test from "node:test";
import { createMobileAwayController, type MobileAwayVisibilitySource } from "./mobile-away.js";

class TestVisibility extends EventTarget implements MobileAwayVisibilitySource {
  visibilityState = "visible";

  setVisibility(visibilityState: string): void {
    this.visibilityState = visibilityState;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function createHarness({ mobile = true, connected = true, away = false } = {}) {
  const visibility = new TestVisibility();
  const pageLifecycle = new EventTarget();
  const calls: boolean[] = [];
  const state = { mobile, connected, away };
  const controller = createMobileAwayController(visibility, pageLifecycle, {
    isMobileClient: () => state.mobile,
    isConnected: () => state.connected,
    isAway: () => state.away,
    setAway(value) {
      calls.push(value);
      state.away = value;
    },
  });
  return { controller, visibility, pageLifecycle, calls, state };
}

test("mobile background marks away and foreground restores online", () => {
  const { controller, visibility, calls, state } = createHarness();

  visibility.setVisibility("hidden");
  assert.deepEqual(calls, [true]);
  assert.equal(state.away, true);

  visibility.setVisibility("visible");
  assert.deepEqual(calls, [true, false]);
  assert.equal(state.away, false);
  controller.dispose();
});

test("desktop sessions are not automatically marked away", () => {
  const { controller, visibility, calls, pageLifecycle } = createHarness({ mobile: false });

  visibility.setVisibility("hidden");
  pageLifecycle.dispatchEvent(new Event("pagehide"));
  pageLifecycle.dispatchEvent(new Event("pageshow"));

  assert.deepEqual(calls, []);
  controller.dispose();
});

test("a manual away state is not cleared when the mobile page returns", () => {
  const { controller, visibility, calls, state } = createHarness({ away: true });

  visibility.setVisibility("hidden");
  visibility.setVisibility("visible");

  assert.deepEqual(calls, []);
  assert.equal(state.away, true);
  controller.dispose();
});

test("page lifecycle events are a fallback and reconnection is synchronized", () => {
  const { controller, visibility, pageLifecycle, calls, state } = createHarness({ connected: false });

  pageLifecycle.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(calls, []);

  state.connected = true;
  controller.sync();
  assert.deepEqual(calls, [true]);

  pageLifecycle.dispatchEvent(new Event("pageshow"));
  assert.deepEqual(calls, [true, false]);
  assert.equal(state.away, false);
  controller.dispose();
  visibility.setVisibility("hidden");
  assert.deepEqual(calls, [true, false]);
});

test("an automatic away state is re-applied after reconnecting in the background", () => {
  const { controller, visibility, calls, state, pageLifecycle } = createHarness();

  visibility.setVisibility("hidden");
  state.connected = false;
  state.away = false;
  controller.sync();
  state.connected = true;
  controller.sync();

  assert.deepEqual(calls, [true, true]);
  visibility.visibilityState = "visible";
  pageLifecycle.dispatchEvent(new Event("pageshow"));
  assert.deepEqual(calls, [true, true, false]);
  controller.dispose();
});

test("manual status changes relinquish automatic restore ownership", () => {
  const { controller, visibility, calls, state } = createHarness();

  visibility.setVisibility("hidden");
  controller.preserveManualStatus();
  visibility.setVisibility("visible");

  assert.deepEqual(calls, [true]);
  assert.equal(state.away, true);
  controller.dispose();
});
