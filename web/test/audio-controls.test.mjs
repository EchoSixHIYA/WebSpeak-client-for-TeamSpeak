import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { effectScope, ref } from "vue";

let vite, useWebClientAudioControls;
before(async () => {
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  ({ useWebClientAudioControls } = await vite.ssrLoadModule("/src/composables/useWebClientAudioControls.ts"));
});
after(async () => { await vite?.close(); });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(t, extra = {}) {
  const scope = effectScope(), settingsOpen = ref(false), stops = [];
  const controls = scope.run(() => useWebClientAudioControls({
    settingsOpen, microphoneMuted: ref(false), inputVolume: ref(1), voxThreshold: ref(.01),
    notificationVolume: ref(1), micLevel: ref(0), microphoneTestActive: ref(false),
    accompanimentActive: ref(false), accompanimentErrorCode: ref(""), whisperTargetIds: new Set(),
    prepareInputDevices: async () => {}, stopMicrophoneTest: () => stops.push("stop"),
    localizedMessage: value => value, t: key => key, ...extra,
  }));
  t.after(() => scope.stop());
  settingsOpen.value = true;
  return { controls, settingsOpen, scope, stops };
}
const deviceEvent = { target: { value: "device" } };

test("a previous opening cannot publish its preparation error after reopening", async t => {
  const first = deferred(), second = deferred(); let calls = 0;
  const { controls, settingsOpen } = mount(t, { prepareInputDevices: () => (++calls === 1 ? first.promise : second.promise) });
  await Promise.resolve(); settingsOpen.value = false; await Promise.resolve(); settingsOpen.value = true; await Promise.resolve();
  first.reject(new DOMException("old", "NotAllowedError")); await Promise.resolve();
  assert.equal(controls.settingsError.value, "");
  second.reject(new DOMException("current", "NotFoundError")); await Promise.resolve();
  assert.match(controls.settingsError.value, /未找到可用的麦克风/);
});

test("a completed newer device selection retires older errors", async t => {
  const old = deferred();
  const { controls } = mount(t, { setOutputDevice: () => old.promise, setInputDevice: async () => {} });
  await Promise.resolve();
  const pending = controls.onOutputDeviceChange(deviceEvent);
  await controls.onInputDeviceChange(deviceEvent);
  old.reject(new Error("old output")); await pending;
  assert.equal(controls.settingsError.value, "");
});

test("the custom device picker can select input and output devices by ID", async t => {
  const selected = [];
  const { controls } = mount(t, {
    setInputDevice: async deviceId => selected.push(["input", deviceId]),
    setOutputDevice: async deviceId => selected.push(["output", deviceId]),
  });
  await controls.onInputDeviceChange("microphone-id");
  await controls.onOutputDeviceChange("speaker-id");
  assert.deepEqual(selected, [["input", "microphone-id"], ["output", "speaker-id"]]);
});

test("an earlier selection cannot replace the current selection's error", async t => {
  const old = deferred();
  const { controls } = mount(t, { setInputDevice: () => old.promise, setOutputDevice: async () => { throw new Error("current output"); } });
  await Promise.resolve();
  const pending = controls.onInputDeviceChange(deviceEvent);
  await controls.onOutputDeviceChange(deviceEvent);
  old.reject(new DOMException("old input", "NotAllowedError")); await pending;
  assert.equal(controls.settingsError.value, "current output");
});

test("closing immediately cancels the test UI and ignores its late rejection", async t => {
  const testStart = deferred();
  const { controls, settingsOpen, stops } = mount(t, { startMicrophoneTest: () => testStart.promise });
  await Promise.resolve();
  const pending = controls.toggleMicTest(); settingsOpen.value = false;
  assert.equal(stops.length, 1);
  testStart.reject(new Error("old recording")); await pending;
  assert.equal(controls.settingsError.value, "");
});

test("unmount stops recording and retires device preparation", async t => {
  const preparation = deferred();
  const { controls, scope, stops } = mount(t, { prepareInputDevices: () => preparation.promise });
  await Promise.resolve(); scope.stop();
  assert.equal(stops.length, 1);
  preparation.reject(new DOMException("old", "NotAllowedError")); await Promise.resolve();
  assert.equal(controls.settingsError.value, "");
});

function whisperFixture(t) {
  const sent = [], captures = new Set();
  const target = { focus() {}, setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
  const fixture = mount(t, { whisperTargetIds: new Set([7]), setWhisperActive: active => sent.push(active) });
  return { ...fixture, sent, captures, pointer: (id = 1, button = 0, isPrimary = true) => ({ pointerId: id, button, isPrimary, currentTarget: target }) };
}
const keyEvent = (key, extra = {}) => ({ key, preventDefault() {}, ...extra });

test("secondary buttons and non-primary pointers cannot start whispering", t => {
  const { controls, pointer, sent } = whisperFixture(t);
  controls.onWhisperPttDown(pointer(1, 2));
  controls.onWhisperPttDown(pointer(2, 0, false));
  assert.deepEqual(sent, []);
});

test("only the pointer that started whispering may release it", t => {
  const { controls, pointer, sent, captures } = whisperFixture(t);
  controls.onWhisperPttDown(pointer());
  controls.onWhisperPttUp(pointer(2));
  assert.equal(controls.whisperPttActive.value, true);
  controls.onWhisperPttDown(pointer(2));
  controls.onWhisperPttUp(pointer());
  controls.onWhisperPttUp(pointer());
  assert.deepEqual(sent, [true, false]);
  assert.equal(captures.size, 0);
});

test("capture failure does not leave whisper enabled", t => {
  const { controls, pointer, sent } = whisperFixture(t);
  const event = pointer();
  event.currentTarget.setPointerCapture = () => { throw new Error("pointer no longer active"); };
  assert.doesNotThrow(() => controls.onWhisperPttDown(event));
  assert.deepEqual(sent, []);
});

test("keyboard whisper ignores repeat and unrelated releases", t => {
  const { controls, sent, pointer } = whisperFixture(t);
  controls.onWhisperPttKeyDown(keyEvent(" "));
  controls.onWhisperPttKeyDown(keyEvent(" ", { repeat: true }));
  controls.onWhisperPttKeyUp(keyEvent("Enter"));
  controls.onWhisperPttUp(pointer());
  assert.equal(controls.whisperPttActive.value, true);
  controls.onWhisperPttKeyUp(keyEvent(" "));
  controls.onWhisperPttKeyDown(keyEvent("Enter"));
  controls.stopWhisperTalk();
  controls.onWhisperPttKeyUp(keyEvent("Enter"));
  assert.deepEqual(sent, [true, false, true, false]);
});

test("scope disposal releases an active whisper and its capture", t => {
  const { controls, sent, captures, pointer, scope } = whisperFixture(t);
  controls.onWhisperPttDown(pointer());
  scope.stop();
  assert.deepEqual(sent, [true, false]);
  assert.equal(captures.size, 0);
});
