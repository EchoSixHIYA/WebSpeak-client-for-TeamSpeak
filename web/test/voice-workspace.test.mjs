import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { effectScope, ref } from "vue";
let vite, useVoiceWorkspace;
before(async () => {
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL("../", import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  ({ useVoiceWorkspace } = await vite.ssrLoadModule("/src/composables/useVoiceWorkspace.ts"));
});
after(async () => { await vite?.close(); });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function mount(t, save = async () => undefined) {
  const scope = effectScope(), enabled = ref(true), connected = ref(false), writes = [];
  const model = scope.run(() => useVoiceWorkspace({ enabled, connected, save: (value, signal) => { writes.push({value,signal}); return save(value,signal); } }));
  t.after(() => scope.stop());
  return { ...model, enabled, connected, writes, scope };
}
const snapshot = (preferences = {}, recent = []) => ({ preferences: {schemaVersion: 1, ...preferences}, recent });
test("a first-time or failed connection retains onboarding, while success persists the workspace", async t => {
  const model = mount(t); await model.restore(async () => snapshot());
  assert.equal(model.active.value, false);
  model.connected.value = true; model.connected.value = false;
  assert.equal(model.active.value, true);
  assert.deepEqual(model.writes[0].value, {schemaVersion: 1, hasConnected: true});
});
test("returning users restore the workspace without starting voice or requiring saved targets", async t => {
  const model = mount(t); await model.restore(async () => snapshot({hasConnected: true}));
  assert.equal(model.active.value, true); assert.equal(model.connected.value, false);
  assert.equal(model.writes.length, 0);
});
test("recent success history migrates even when its displayed entry is also a favorite", async t => {
  const model = mount(t); await model.restore(async () => snapshot({}, [{id:'opaque-test',lastConnectedAt:1}]));
  assert.equal(model.active.value, true); assert.equal(model.writes.length, 1);
});
test("a saved nickname is not evidence of a successful connection", async t => {
  const model = mount(t); await model.restore(async () => snapshot({lastNickname:'Failed attempt'}));
  assert.equal(model.active.value, false);
});
test("the selected package's policy controls the flow without hard-coded skin IDs", async t => {
  const model = mount(t); await model.restore(async () => snapshot({hasConnected:true}));
  model.enabled.value = false; assert.equal(model.active.value, false);
  model.enabled.value = true; assert.equal(model.active.value, true);
});
test("late preference restoration cannot undo a successful live connection", async t => {
  const model = mount(t), load = deferred(); const pending = model.restore(() => load.promise);
  model.connected.value = true; model.connected.value = false;
  load.resolve(snapshot()); await pending;
  assert.equal(model.active.value, true);
});
test("clearing local data retires pending restoration and aborts outstanding preference writes", async t => {
  const model = mount(t), load = deferred(); const pending = model.restore(() => load.promise);
  model.connected.value = true; const oldSignal = model.writes[0].signal;
  model.reset(); assert.equal(oldSignal.aborted, true);
  load.resolve(snapshot({hasConnected:true})); assert.equal(await pending, undefined);
  assert.equal(model.active.value, false);
});
test("disposal discards late restoration and prevents late history writes", async t => {
  const model = mount(t), load = deferred(); const pending = model.restore(() => load.promise);
  model.scope.stop(); load.resolve(snapshot({}, [{id:'late',lastConnectedAt:1}]));
  assert.equal(await pending, undefined); assert.equal(model.writes.length,0);
});
test("unavailable optional browser storage does not break a successful live connection", async t => {
  const model = mount(t,async () => {throw new Error('blocked storage');});
  assert.equal(await model.restore(async () => {throw new Error('unavailable');}),undefined);
  model.connected.value = true; await Promise.resolve();
  assert.equal(model.active.value,true);
});


test("retired restoration cannot apply target or language preferences to a replacement page", async t => {
  const model = mount(t), load = deferred(), applied = [];
  const pending = model.restore(() => load.promise, value => applied.push(value));
  model.reset();
  load.resolve(snapshot({hasConnected:true,lastNickname:'Retired'}));
  await pending;
  assert.deepEqual(applied, []);
});
