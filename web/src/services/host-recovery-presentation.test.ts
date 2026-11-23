import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostRecoveryPresentation } from "./host-recovery-presentation.js";

const base = {
  visible: true,
  shortcutOpen: false,
  libraryAvailable: true,
  builtIn: { available: false, docked: false },
  library: { available: false, docked: false },
};

test("a capsule-only skin keeps both actions in the capsule", () => {
  const result = resolveHostRecoveryPresentation(base);
  assert.deepEqual(result.capsuleActions, ["built-in", "library"]);
  assert.equal(result.capsuleVisible, true);
  assert.equal(result.suppressLauncher, false);
  assert.equal(result.toolbar.docked, false);
});

test("a docked toolbar group removes both actions from the capsule", () => {
  const result = resolveHostRecoveryPresentation({
    ...base,
    builtIn: { available: true, docked: true },
    library: { available: true, docked: true },
  });
  assert.deepEqual(result.docked, { builtIn: true, library: true });
  assert.deepEqual(result.capsuleActions, []);
  assert.equal(result.capsuleVisible, false);
  assert.equal(result.suppressLauncher, true, "the toolbar library is the only library entry");
});

test("a failed anchor returns its action to the capsule without duplicating the other", () => {
  const result = resolveHostRecoveryPresentation({
    ...base,
    builtIn: { available: true, docked: true },
    library: { available: true, docked: false },
  });
  assert.deepEqual(result.docked, { builtIn: true, library: false });
  assert.deepEqual(result.capsuleActions, ["library"]);
  assert.equal(result.capsuleVisible, true);
  assert.equal(result.suppressLauncher, true, "the floating capsule now carries the only library entry");
});

test("the shortcut forces the complete capsule and hides the toolbar", () => {
  const result = resolveHostRecoveryPresentation({
    ...base,
    shortcutOpen: true,
    builtIn: { available: true, docked: true },
    library: { available: true, docked: true },
  });
  assert.deepEqual(result.docked, { builtIn: false, library: false });
  assert.deepEqual(result.capsuleActions, ["built-in", "library"]);
  assert.equal(result.capsuleVisible, true);
  assert.equal(result.toolbar.visible, false);
});

test("no recovery entry means no capsule, no toolbar and no launcher suppression", () => {
  const result = resolveHostRecoveryPresentation({
    ...base,
    visible: false,
    builtIn: { available: true, docked: true },
    library: { available: true, docked: true },
  });
  assert.deepEqual(result.capsuleActions, []);
  assert.equal(result.capsuleVisible, false);
  assert.equal(result.toolbar.visible, false);
  assert.equal(result.suppressLauncher, false);
});

test("an unavailable library never renders or suppresses anything", () => {
  const result = resolveHostRecoveryPresentation({
    ...base,
    libraryAvailable: false,
    library: { available: false, docked: true },
  });
  assert.deepEqual(result.capsuleActions, ["built-in"]);
  assert.equal(result.suppressLauncher, false);
});

test("a docked built-in toolbar button leaves only the library in the capsule", () => {
  const result = resolveHostRecoveryPresentation({
    ...base,
    builtIn: { available: true, docked: true },
    library: { available: false, docked: false },
  });
  assert.deepEqual(result.capsuleActions, ["library"]);
  assert.equal(result.capsuleVisible, true);
});
