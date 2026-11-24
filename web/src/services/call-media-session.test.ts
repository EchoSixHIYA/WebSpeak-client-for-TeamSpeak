import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createCallMediaSession } from "./call-media-session.js";

function fixture(t: TestContext, unsupported = false) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "MediaMetadata");
  Object.defineProperty(globalThis, "MediaMetadata", { configurable: true, value: class {
    title: string;
    constructor(init: { title: string }) { this.title = init.title; }
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "MediaMetadata", original);
    else Reflect.deleteProperty(globalThis, "MediaMetadata");
  });
  const handlers = new Map<string, (() => void) | null>();
  const events: string[] = [];
  const session = {
    metadata: null as MediaMetadata | null, playbackState: "none" as MediaSessionPlaybackState,
    setActionHandler(action: string, callback: (() => void) | null) {
      if (unsupported && action === "togglemicrophone") throw new Error("Not supported");
      handlers.set(action, callback);
    },
    setMicrophoneActive(active: boolean) { events.push(`mic:${active}`); },
  };
  const audioSession = { type: "auto" };
  const controller = createCallMediaSession({ resume: () => events.push("play"), pause: () => events.push("pause"),
    toggleMicrophone: () => events.push("toggle"), hangup: () => events.push("hangup") }, { mediaSession: session as unknown as MediaSession, audioSession });
  t.after(() => controller.dispose());
  const sync = (active = true, muted = false) => controller.sync({ active, muted, outputMuted: false, title: "Test room" });
  return { controller, handlers, events, session, audioSession, sync };
}

test("call media controls are opt-in, reflect mute, and restore OS state on release", t => {
  const f = fixture(t);
  f.sync(false);
  assert.equal(f.handlers.size, 0);
  f.sync();
  assert.equal(f.audioSession.type, "play-and-record");
  assert.equal(f.session.metadata?.title, "Test room");
  f.handlers.get("play")!();
  f.handlers.get("pause")!();
  f.handlers.get("togglemicrophone")!();
  f.sync(true, true);
  assert.ok(f.events.includes("mic:false"));
  f.sync(false);
  assert.equal(f.audioSession.type, "auto");
  assert.equal(f.session.metadata, null);
  assert.equal(f.session.playbackState, "none");
  assert.ok([...f.handlers.values()].every(value => value === null));
});

test("a queued OS action cannot affect a disconnected or replacement call", t => {
  const f = fixture(t);
  f.sync();
  const stale = f.handlers.get("togglemicrophone")!;
  f.sync(false);
  f.sync();
  stale();
  assert.ok(!f.events.includes("toggle"));
  f.handlers.get("togglemicrophone")!();
  assert.equal(f.events.filter(e => e === "toggle").length, 1);
});

test("partial API support leaves the other call controls functional", t => {
  const f = fixture(t, true);
  assert.doesNotThrow(() => f.sync());
  f.handlers.get("hangup")!();
  assert.ok(f.events.includes("hangup"));
  assert.equal(f.handlers.has("togglemicrophone"), false);
  assert.doesNotThrow(() => f.controller.dispose());
});

test("missing system APIs never prevent calling", () => {
  const controller = createCallMediaSession({ resume() {}, pause() {}, toggleMicrophone() {}, hangup() {} }, {});
  assert.doesNotThrow(() => controller.sync({ active: true, muted: false, outputMuted: false, title: "Room" }));
  assert.doesNotThrow(() => controller.dispose());
});
