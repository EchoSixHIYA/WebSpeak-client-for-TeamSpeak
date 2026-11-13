import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createRenderer, ref, nextTick } from "vue";

let vite, useWebClientPerformance, app, monitor, connected, measure;
const intervals = new Map();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const renderer = createRenderer({
  createComment: text => ({ text }), createText: text => ({ text }), createElement: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null,
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function sample(extra = {}, bridge = {}, browser = {}) {
  return {
    scopeId: 1, sampledAt: 1_000, transport: "webrtc", connectionState: "connected",
    microphoneMuted: false, microphoneReady: true, microphonePermission: "granted", playbackState: "playing",
    bridge: { transport: "webrtc", tsSendFrames: 0, tsSendErrors: 0, egressFrames: 0,
      ingressDroppedFrames: 0, egressDroppedFrames: 0, webrtcIngressDecodeErrors: 0,
      webrtcDownlinkDecodeErrors: 0, webrtcQueueDroppedFrames: 0, webrtcQueueUnderrunTicks: 0,
      ingressMaxGapMs: 0, egressMaxGapMs: 0, ...bridge },
    browser: { outboundBytes: 0, outboundPackets: 0, outboundPacketsLost: 0, outboundLossPercent: 0,
      outboundRttMs: 20, inboundBytes: 0, inboundPackets: 0, inboundPacketsLost: 0, inboundLossPercent: 0,
      inboundJitterMs: 5, concealedSamples: 0, ...browser },
    fallbackPlayback: { framesReceived: 0, framesDropped: 0, decodeErrors: 0 },
    ...extra,
  };
}

before(async () => {
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  ({ useWebClientPerformance } = await vite.ssrLoadModule("/src/composables/useWebClientPerformance.ts"));
});
beforeEach(t => {
  intervals.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setInterval(callback, delay) { assert.equal(delay, 2_000); const timer = {}; intervals.set(timer, callback); return timer; },
  } });
  const clear = globalThis.clearInterval;
  t.mock.method(globalThis, "clearInterval", timer => { if (!intervals.delete(timer)) clear(timer); });
  connected = ref(true);
  measure = async () => sample();
});
afterEach(() => { app?.unmount(); app = null; });
after(async () => {
  await vite?.close();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
});
async function mount() {
  const trace = { events: ref([]), record() {}, snapshot: () => [] };
  app = renderer.createApp({ setup() { monitor = useWebClientPerformance(connected, () => measure(), trace); return () => null; } });
  app.mount({});
  await nextTurn();
}
async function refresh(value) {
  measure = async () => value;
  monitor.refresh();
  await nextTurn();
}

test("transport changes do not subtract RTP packets from compatibility frames", async () => {
  measure = async () => sample({}, {}, { inboundPackets: 20 });
  await mount();
  await refresh(sample({ transport: "websocket", sampledAt: 3_000,
    fallbackPlayback: { framesReceived: 200, framesDropped: 0, decodeErrors: 0 } }));
  assert.equal(monitor.stats.value.downlinkFramesPerSecond, null);
  assert.equal(monitor.stats.value.health, "quiet");
});

test("replacement peers and reconnects start a fresh counter baseline", async () => {
  await mount();
  await refresh(sample({ scopeId: 2, sampledAt: 3_000 }, { tsSendFrames: 500, tsSendErrors: 10 },
    { outboundBytes: 50_000, inboundBytes: 40_000, inboundPackets: 200 }));
  assert.equal(monitor.stats.value.uplinkFramesPerSecond, null);
  assert.equal(monitor.stats.value.uplinkBitrateKbps, null);
  assert.equal(monitor.stats.value.downlinkFramesPerSecond, null);
  assert.equal(monitor.stats.value.sendErrors, null);
  assert.equal(monitor.stats.value.health, "quiet");
  await refresh(sample({ scopeId: 2, sampledAt: 5_000 }, { tsSendFrames: 600, tsSendErrors: 10 },
    { outboundBytes: 58_000, inboundBytes: 44_000, inboundPackets: 300 }));
  assert.equal(monitor.stats.value.uplinkFramesPerSecond, 50);
  assert.equal(monitor.stats.value.downlinkFramesPerSecond, 50);
  assert.equal(monitor.stats.value.uplinkBitrateKbps, 32);
  assert.equal(monitor.stats.value.health, "active");
});

test("temporarily missing RTP stats do not turn bridge counters into packet deltas", async () => {
  measure = async () => sample({}, { egressFrames: 1_000 }, { inboundPackets: 20 });
  await mount();
  await refresh(sample({ sampledAt: 3_000, browser: null }, { egressFrames: 1_100 }));
  assert.equal(monitor.stats.value.downlinkFramesPerSecond, null);
  await refresh(sample({ sampledAt: 5_000, browser: null }, { egressFrames: 1_200 }));
  assert.equal(monitor.stats.value.downlinkFramesPerSecond, 50);
});

test("a missing sample clears stale activity and a later sample starts a new baseline", async () => {
  await mount();
  await refresh(sample({ sampledAt: 3_000 }, { tsSendFrames: 100 }));
  assert.equal(monitor.stats.value.health, "active");
  await refresh(null);
  assert.equal(monitor.stats.value.ready, false);
  assert.equal(monitor.stats.value.health, "sampling");
  assert.equal(monitor.running.value, false);
  await refresh(sample({ sampledAt: 7_000 }, { tsSendFrames: 300 }));
  assert.equal(monitor.stats.value.uplinkFramesPerSecond, null);
});

test("a rejected probe is contained and the next refresh can recover", async () => {
  await mount();
  measure = async () => { throw new Error("Stats unavailable"); };
  monitor.refresh();
  await nextTurn();
  assert.equal(monitor.stats.value.ready, false);
  assert.equal(monitor.running.value, false);
  await refresh(sample());
  assert.equal(monitor.stats.value.ready, true);
});

test("a queued old polling callback cannot start work or wedge a replacement connection", async () => {
  let calls = 0;
  measure = async () => { calls++; return sample(); };
  await mount();
  const oldTick = [...intervals.values()][0];
  connected.value = false;
  await nextTick();
  assert.equal(intervals.size, 0);
  connected.value = true;
  await nextTurn();
  const callsBefore = calls;
  oldTick();
  await nextTurn();
  assert.equal(calls, callsBefore);
  assert.equal(monitor.running.value, false);
  monitor.refresh();
  await nextTurn();
  assert.equal(calls, callsBefore + 1);
});

test("unmount retires pending results, queued timers and manual refresh", async () => {
  const pending = deferred();
  let calls = 0;
  measure = () => { calls++; return pending.promise; };
  await mount();
  const oldTick = [...intervals.values()][0];
  app.unmount();
  app = null;
  assert.equal(intervals.size, 0);
  oldTick();
  monitor.refresh();
  pending.resolve(sample());
  await nextTurn();
  assert.equal(calls, 1);
  assert.equal(monitor.running.value, false);
  assert.equal(monitor.stats.value.ready, false);
});

test("late samples from an old connection cannot replace current diagnostics", async () => {
  const pending = deferred();
  measure = () => pending.promise;
  await mount();
  connected.value = false;
  await nextTick();
  measure = async () => sample({ scopeId: 2, transport: "websocket" });
  connected.value = true;
  await nextTurn();
  pending.resolve(sample({ scopeId: 1, connectionState: "failed" }));
  await nextTurn();
  assert.equal(monitor.stats.value.transport, "websocket");
  assert.equal(monitor.stats.value.health, "quiet");
  assert.equal(monitor.running.value, false);
});

test("uplink loss uses sent packets while downlink loss includes missing packets", async () => {
  await mount();
  await refresh(sample({ sampledAt: 3_000 }, {}, {
    outboundPackets: 100, outboundPacketsLost: 20, inboundPackets: 80, inboundPacketsLost: 20,
  }));
  assert.equal(monitor.stats.value.uplinkLossPercent, 20);
  assert.equal(monitor.stats.value.downlinkLossPercent, 20);
});

test("normal counters preserve activity, warning and playback diagnostics", async () => {
  await mount();
  await refresh(sample({ sampledAt: 3_000, playbackState: "paused" }, { tsSendFrames: 100 }, { inboundPackets: 100 }));
  assert.equal(monitor.stats.value.uplinkFramesPerSecond, 50);
  assert.equal(monitor.stats.value.downlinkFramesPerSecond, 50);
  assert.equal(monitor.stats.value.health, "warning");
  assert.equal(monitor.stats.value.uplinkRttMs, 20);
  assert.equal(monitor.stats.value.downlinkJitterMs, 5);
  connected.value = false;
  await nextTick();
  assert.equal(monitor.stats.value.health, "disconnected");
  assert.equal(monitor.stats.value.ready, false);
});
