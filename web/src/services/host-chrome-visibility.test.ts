import assert from "node:assert/strict";
import test from "node:test";
import { isBundledSkin } from "./host-chrome.js";
import { isHostPartReachable, shouldShowRecovery, type HostPartVisibilitySnapshot } from "./host-chrome-visibility.js";

const snapshot = (overrides: Partial<HostPartVisibilitySnapshot> = {}): HostPartVisibilitySnapshot => ({
  display: "inline-flex",
  visibility: "visible",
  opacity: "1",
  pointerEvents: "auto",
  rect: { width: 120, height: 40, left: 600, top: 700, right: 720, bottom: 740 },
  viewport: { width: 1280, height: 800 },
  ...overrides,
});

test("a rendered, on-screen host part is reachable", () => {
  assert.equal(isHostPartReachable(snapshot()), true);
  // Partially off-screen is still usable.
  assert.equal(isHostPartReachable(snapshot({ rect: { width: 120, height: 40, left: -40, top: 700, right: 80, bottom: 740 } })), true);
});

test("CSS-only hiding makes a host part unreachable", () => {
  for (const hidden of [
    snapshot({ display: "none" }),
    snapshot({ visibility: "hidden" }),
    snapshot({ visibility: "collapse" }),
    snapshot({ opacity: "0" }),
    snapshot({ pointerEvents: "none" }),
    snapshot({ clipPath: "inset(50%)" }),
    snapshot({ clipPath: "circle(0px)" }),
    snapshot({ clip: "rect(0px, 0px, 0px, 0px)" }),
    snapshot({ rect: { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 } }),
  ]) {
    assert.equal(isHostPartReachable(hidden), false);
  }
  // Decorative clipping that leaves a usable area does not trigger recovery.
  assert.equal(isHostPartReachable(snapshot({ clipPath: "inset(2px)" })), true);
  assert.equal(isHostPartReachable(snapshot({ clipPath: "none" })), true);
});

test("a host part moved entirely outside the viewport is unreachable", () => {
  assert.equal(isHostPartReachable(snapshot({ rect: { width: 120, height: 40, left: -9999, top: 700, right: -9879, bottom: 740 } })), false);
  assert.equal(isHostPartReachable(snapshot({ rect: { width: 120, height: 40, left: 600, top: 900, right: 720, bottom: 940 } })), false);
  assert.equal(isHostPartReachable(snapshot({ rect: { width: 120, height: 40, left: 1400, top: 700, right: 1520, bottom: 740 } })), false);
});

test("bundled and third-party skins are classified for the recovery affordance", () => {
  // Official Day/Night and the bundled ILLUSIA/KAAK packs stay quiet.
  for (const id of [undefined, "builtin.light", "builtin.dark", "community.illusia-voice", "community.kaak-voice"]) {
    assert.equal(isBundledSkin(id), true, String(id));
  }
  for (const id of ["community.hostile-fixture", "community.some-open-skin", "builtin.future"]) {
    // `builtin.*` is reserved for future host packs; everything else is third-party.
    assert.equal(isBundledSkin(id), id.startsWith("builtin."), id);
  }
});

test("the recovery entry is persistent for third-party skins only", () => {
  const base = {
    connected: true,
    thirdPartyAllowed: true,
    thirdPartySkinActive: false,
    launcherHiddenByConfig: false,
    launcherReachable: true,
  };
  assert.equal(shouldShowRecovery(base), false);
  // A non-bundled skin keeps a small host-owned affordance visible even when
  // the launcher is reachable: if the skin hides/covers it, recovery is there.
  assert.equal(shouldShowRecovery({ ...base, thirdPartySkinActive: true }), true);
  assert.equal(shouldShowRecovery({ ...base, thirdPartySkinActive: true, connected: false }), true);
  // Bundled/official skins never gain the affordance while the launcher works.
  assert.equal(shouldShowRecovery({ ...base, thirdPartySkinActive: false, launcherReachable: false, connected: false }), false);
  // Declarative hiding (chrome.json / instance setting) on a bundled skin.
  assert.equal(shouldShowRecovery({ ...base, launcherHiddenByConfig: true }), true);
  // CSS-only hiding discovered at runtime.
  assert.equal(shouldShowRecovery({ ...base, launcherReachable: false }), true);
  // Never show a recovery entry without authorization.
  assert.equal(shouldShowRecovery({ ...base, thirdPartyAllowed: false, thirdPartySkinActive: true }), false);
  assert.equal(shouldShowRecovery({ ...base, thirdPartyAllowed: false, launcherHiddenByConfig: true }), false);
});
