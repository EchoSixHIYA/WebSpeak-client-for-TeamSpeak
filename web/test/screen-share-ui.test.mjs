import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import vue from "@vitejs/plugin-vue";
import { createServer } from "vite";
import { createRenderer, createSSRApp, nextTick, shallowRef, markRaw } from "vue";
import { renderToString } from "@vue/server-renderer";
let vite, useWebClientScreenShare, calculateScreenSharePlayerSize, VoiceMemberCards;
const renderer = createRenderer({ createComment: text => ({ text }), createText: text => ({ text }), createElement: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode: () => null, nextSibling: () => null });
before(async () => {
  vite = await createServer({ configFile: false, plugins: [vue()], root: fileURLToPath(new URL("../", import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  ({ useWebClientScreenShare, calculateScreenSharePlayerSize } = await vite.ssrLoadModule("/src/composables/useWebClientScreenShare.ts"));
  ({ default: VoiceMemberCards } = await vite.ssrLoadModule("/src/components/web-client/VoiceMemberCards.vue"));
});
after(async () => { await vite?.close(); });
function mount(t, initialStream = null) {
  const listeners = new Set(), starts = [], storage = new Map(); let exits = 0, ui;
  class Element {}
  class Video extends Element { srcObject = null; volume = 1; plays = 0; async play() { this.plays++; } }
  const doc = { fullscreenElement: null, addEventListener: (_event, fn) => listeners.add(fn), removeEventListener: (_event, fn) => listeners.delete(fn), async exitFullscreen() { exits++; doc.fullscreenElement = null; for (const fn of listeners) fn(); } };
  for (const [key, value] of Object.entries({ HTMLElement: Element, HTMLVideoElement: Video, document: doc, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  const viewing = shallowRef(true), stream = shallowRef(initialStream), volume = shallowRef(.4), streams = [];
  const app = renderer.createApp({ setup() { ui = useWebClientScreenShare({ streams, viewing, viewingStreamId: shallowRef("s"), remoteStream: stream, remoteVolume: volume, error: shallowRef(""), errorCode: shallowRef(""), startScreenShare: async (...args) => starts.push(args), joinScreenShare() {}, leaveScreenShare() {}, nickname: shallowRef("Self"), avatarStyle: () => ({}), t: key => key }); return () => null; } });
  app.mount({});
  return { ui, app, doc, viewing, stream, volume, streams, starts, storage, listeners, exits: () => exits, video: () => markRaw(new Video()), player: () => markRaw(new Element()) };
}

test("a newly mounted or replaced video receives the existing stream and volume", async t => {
  const media = { id: "stream" }, f = mount(t, media);
  try {
    const first = f.video(); f.ui.setVideoElement(first); await nextTick();
    assert.equal(first.srcObject, media); assert.equal(first.volume, .4);
    const second = f.video(); f.ui.setVideoElement(second); await nextTick();
    assert.equal(first.srcObject, null); assert.equal(second.srcObject, media); assert.equal(second.volume, .4);
    f.volume.value = .7; await nextTick(); assert.equal(second.volume, .7);
  } finally { f.app.unmount(); }
});

test("screen-share player dimensions follow source orientation and stay inside the viewport bounds", () => {
  assert.deepEqual(calculateScreenSharePlayerSize(1080, 1920, 1100, 720), { width: 405, height: 720 });
  assert.deepEqual(calculateScreenSharePlayerSize(1920, 1080, 1100, 720), { width: 1100, height: 618 });
  assert.equal(calculateScreenSharePlayerSize(0, 1080, 1100, 720), null);
});

test("screen-share player keeps a visible fallback width while video metadata is pending", async () => {
  const css = await readFile(new URL("../src/styles/web-client.css", import.meta.url), "utf8");
  const component = await readFile(new URL("../src/components/web-client/ScreenSharePlayer.vue", import.meta.url), "utf8");
  const playerRule = css.match(/:deep\(\.screen-share-player\)\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(playerRule, /width:\s*min\(100%,\s*1100px\)/);
  assert.doesNotMatch(playerRule, /width:\s*fit-content/);
  assert.doesNotMatch(component, /ResizeObserver/, "player sizing must not create a resize-feedback loop while video starts");
  assert.match(component, /if \(playerElement\.value === next\) return;/, "stable function refs must not rewrite player styles on every render");
  assert.match(component, /if \(stageElement\.value === next\) return;/, "stable function refs must not rewrite stage styles on every render");
  assert.match(playerRule, /z-index:\s*3/, "the shared video must layer above decorative activity artwork");
});

test("unmount detaches video and retires a pending binding without stopping its stream", async t => {
  let stops = 0; const media = { getTracks: () => [{ stop: () => stops++ }] }, f = mount(t, media);
  try { const video = f.video(); f.ui.setVideoElement(video); await nextTick();
    f.volume.value = .8; f.app.unmount(); await nextTick();
    assert.equal(video.srcObject, null); assert.equal(stops, 0); assert.equal(f.listeners.size, 0);
  } finally { if (f.listeners.size) f.app.unmount(); }
});

test("absent player is never fullscreen and does not request fullscreen exit", async t => {
  const f = mount(t);
  try { f.ui.syncFullscreen(); assert.equal(f.ui.fullscreen.value, false); f.viewing.value = false; await nextTick(); assert.equal(f.exits(), 0); }
  finally { f.app.unmount(); }
});

test("removing a fullscreen player exits only that player's fullscreen", async t => {
  const f = mount(t);
  try { const player = f.player(); f.ui.setPlayerElement(player); f.doc.fullscreenElement = player; f.ui.syncFullscreen();
    assert.equal(f.ui.fullscreen.value, true); f.ui.setPlayerElement(null); await nextTick();
    assert.equal(f.exits(), 1); assert.equal(f.ui.fullscreen.value, false);
    f.ui.setPlayerElement(f.player()); f.doc.fullscreenElement = f.player(); f.ui.setPlayerElement(null);
    assert.equal(f.exits(), 1);
  } finally { f.app.unmount(); }
});

test("known screen owner IDs cannot fall back to another member with the same nickname", t => {
  const f = mount(t);
  try { f.streams.push({ streamId: "s", ownerClientId: 7, ownerPeerId: "peer", ownerNickname: "Same", source: "browser" });
    assert.equal(f.ui.streamForMember({ id: 8, nickname: "Same" }), null);
    assert.equal(f.ui.streamForMember({ id: 7, nickname: "Renamed" }).streamId, "s");
    f.streams[0] = { streamId: "ts", ownerPeerId: "ts-7", ownerNickname: "Same", source: "teamspeak" };
    assert.equal(f.ui.streamForMember({ id: 8, nickname: "Same" }), null);
    f.streams[0] = { streamId: "legacy", ownerPeerId: "unknown", ownerNickname: "Same", source: "browser" };
    assert.equal(f.ui.streamForMember({ id: 8, nickname: "Same" }).streamId, "legacy");
  } finally { f.app.unmount(); }
});

test("member cards detect and expose a remote share without depending on local share status", async () => {
  let lookupCount = 0;
  const html = await renderToString(createSSRApp(VoiceMemberCards, {
    currentMembers: [
      { id: 7, nickname: "Remote sharer", isSelf: false, inputMuted: false },
      { id: 8, nickname: "Local viewer", isSelf: true, inputMuted: false },
    ],
    isMobileViewport: false,
    controls: {
      streamForMember: member => { lookupCount++; return member.id === 7 ? { streamId: "active-share" } : null; },
      toggleForMember() {},
      startWithSettings() {},
    },
    isSpeaking: () => false,
    avatarStyle: () => ({}),
    avatarInitial: nickname => nickname[0],
    t: key => key,
  }));

  assert.ok(lookupCount > 0, "member cards query the available share controls");
  assert.match(html, /screen-share-live-indicator/);
  assert.match(html, /sharingScreen/);
  assert.match(html, /screen-share-card-button/);
  assert.match(html, /watchScreenShare/);
  assert.equal((html.match(/screen-share-card-actions/g) ?? []).length, 1);
  assert.doesNotMatch(html, /startScreenShare/);
});

test("a skin can explicitly opt the member-card widget out of screen-share UI", async () => {
  const html = await renderToString(createSSRApp(VoiceMemberCards, {
    currentMembers: [{ id: 7, nickname: "Remote sharer", isSelf: false, inputMuted: false }],
    isMobileViewport: false,
    showScreenShare: false,
    controls: { streamForMember: () => ({ streamId: "active-share" }), toggleForMember() {}, startWithSettings() {} },
    isSpeaking: () => false,
    avatarStyle: () => ({}),
    avatarInitial: nickname => nickname[0],
    t: key => key,
  }));

  assert.doesNotMatch(html, /screen-share-live-indicator|screen-share-card-button/);
});

test("share settings submit the selected resolution and frame rate", async t => {
  const f = mount(t);
  try { f.ui.settingsOpen.value = true; f.ui.resolutionPreset.value = "720p"; f.ui.frameRate.value = 30; await f.ui.startWithSettings();
    assert.deepEqual(f.starts, [[true, { maxWidth: 1280, maxHeight: 720, maxFrameRate: 30 }]]);
    assert.equal(f.ui.settingsOpen.value, false); assert.equal(f.storage.get("webspeak:screen-share-framerate"), "30");
  } finally { f.app.unmount(); }
});
