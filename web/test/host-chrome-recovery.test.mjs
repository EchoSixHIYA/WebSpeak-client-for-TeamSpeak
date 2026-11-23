import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { compileSkinCss } from "../../src/shared/skin-css.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const CHROME = [process.env.WEBSPEAK_TEST_CHROME, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]
  .find((candidate) => candidate && existsSync(candidate));

const compileHostile = (css) => compileSkinCss(css, "community.hostile-fixture", {}, 3).css;

/**
 * Hostile rules that the compiler still accepts (they are legitimate page /
 * themable-host styling) but that must not be able to hide, cover, or disable
 * the recovery entry. `fullscreen-audio-dock` is the case the previous review
 * reproduced: a public part promoted to a `z-index: 2147483647` fullscreen layer.
 */
const scenarios = [
  {
    name: "fullscreen-audio-dock",
    css: compileHostile('[data-ws-part="voice.audio-dock"] { position: fixed; inset: 0; z-index: 2147483647; }'),
  },
  {
    name: "opacity-launcher",
    css: compileHostile('[data-ws-part="host.plugins.launcher"] { opacity: 0; }'),
  },
  {
    name: "filter-launcher",
    css: compileHostile('[data-ws-part="host.plugins.launcher"] { filter: opacity(0); }'),
  },
  {
    name: "display-none-overlay",
    css: compileHostile('[data-ws-part="host.plugins.overlay"] { display: none !important; }'),
  },
  {
    name: "pointer-events-none",
    css: compileHostile('[data-ws-part="host.plugins.launcher"], [data-ws-part="host.plugins.overlay"] { pointer-events: none !important; }'),
  },
  {
    // Decorative host chrome may legitimately be a fixed, viewport-sized,
    // max-stacking decoration. Recovery lives in a closed-shadow top layer and
    // must still win the hit test.
    name: "decorative-watermark-overlay",
    css: compileHostile(`
      @keyframes drift { from { transform: translateX(0); } to { transform: translateX(12px); } }
      [data-ws-part="host.watermark"] { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483647; background: #123; animation: drift 3s ease-in-out infinite alternate; }
    `),
  },
];

test("host chrome renders recovery and authorization in a closed-shadow top layer", async () => {
  const [hostChrome, authorization, ownedLayer, hostChromeService, publicSkin, recoveryNotice, slotPlacement, pluginPanel, presentation, controlTokens] = await Promise.all([
    read("../src/components/HostChrome.vue"),
    read("../src/components/InstanceAuthorization.vue"),
    read("../src/services/host-owned-layer.ts"),
    read("../src/services/host-chrome.ts"),
    read("../src/composables/usePublicSkin.ts"),
    read("../src/components/SkinLoadRecoveryNotice.vue"),
    read("../src/services/host-slot-placement.ts"),
    read("../src/components/PluginPanel.vue"),
    read("../src/services/host-recovery-presentation.ts"),
    read("../src/services/host-control-tokens.ts"),
  ]);

  // Recovery: closed shadow root + manual popover + no skin hook.
  assert.match(hostChrome, /createHostOwnedLayer\("recovery"/);
  assert.match(hostChrome, /popover="manual"/);
  assert.match(hostChrome, /data-ws-recovery-action="built-in"/);
  assert.match(hostChrome, /requestBuiltInSkin/);
  assert.match(hostChrome, /isThirdPartySkinActive/);
  // The shortcut runs in the capture phase so a plugin/skin capture listener
  // cannot swallow it with preventDefault().
  assert.match(hostChrome, /addEventListener\("keydown", onKeydown, true\)/);
  assert.match(hostChrome, /removeEventListener\("keydown", onKeydown, true\)/);
  // Escape closes the popover from inside its closed shadow root.
  assert.match(hostChrome, /@keydown\.escape="onRecoveryEscape"/);
  assert.match(hostChrome, /function onRecoveryEscape\(\) \{\s*shortcutOpen\.value = false;/);
  assert.doesNotMatch(hostChrome, /event\.defaultPrevented \|\| event\.repeat/);
  assert.doesNotMatch(hostChrome, /data-ws-part="host\.recovery"/);
  assert.doesNotMatch(hostChrome, /ws-host-recovery-layer/);
  // Slots are a declarative anchor, not a skin hook: the host still binds the
  // capsule itself and switches back to the fixed position at runtime.
  assert.match(hostChrome, /activeHostSlot\("host\.recovery"\)/);
  assert.match(hostChrome, /bindHostSlot\(/);
  assert.match(hostChrome, /onModeChange/);
  // Explicit toolbar presentation: plain host buttons, no capsule shell, real
  // host click handlers and i18n labels. The mode is a separate schema field,
  // not inferred from compact.
  assert.match(hostChrome, /activeHostSlot\("host\.recovery\.built-in"\)/);
  assert.match(hostChrome, /activeHostSlot\("host\.recovery\.library"\)/);
  assert.match(hostChrome, /presentation: "toolbar"/);
  assert.match(hostChrome, /resolveHostRecoveryPresentation/);
  assert.match(hostChrome, /class="ws-host-toolbar-action"/);
  assert.match(hostChrome, /data-ws-recovery-action="built-in"[\s\S]*?@click="useBuiltInSkin"/);
  assert.match(hostChrome, /data-ws-recovery-action="library"[\s\S]*?@click="openLibrary"/);
  assert.match(hostChrome, /resolveHostRecoveryPresentation\(/);
  assert.match(presentation, /suppressLauncher/);
  assert.match(hostChrome, /setInlineLibraryEntryVisible/);
  assert.match(pluginPanel, /isInlineLibraryEntryVisible/);
  assert.match(pluginPanel, /!inlineLibraryEntry/);
  // Toolbar tokens are sanitized by the same shared reader with their own
  // geometry defaults; no capsule shadow/radius/pale fixed background.
  assert.match(controlTokens, /HOST_TOOLBAR_TOKEN_NAMES/);
  assert.match(controlTokens, /resolveHostControlToolbarTokens/);
  assert.match(slotPlacement, /applyHostControlToolbarTokens/);
  assert.match(slotPlacement, /resolveHostControlToolbarTokens/);
  assert.match(slotPlacement, /presentation === "toolbar"/);
  assert.match(slotPlacement, /querySelectorAll\("\.ws-skin-root"\)/);
  assert.match(slotPlacement, /isHostPartReachable\(/);
  assert.match(slotPlacement, /evaluateSlottedControl/);
  assert.match(hostChromeService, /export function activeHostSlot/);
  assert.match(hostChromeService, /HOST_SLOTTABLE_PART_IDS\.has\(part\)/);
  assert.match(hostChromeService, /isThirdPartySkinActive\(\)/);
  // Host-owned controls share one sanitized token reader; no per-control palette copy.
  assert.match(hostChrome, /bindHostControlTheme/);
  assert.match(hostChrome, /--ws-control-background/);
  assert.match(recoveryNotice, /SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS/);
  assert.match(recoveryNotice, /--ws-control-background/);
  assert.match(authorization, /PERMISSION_CONTROL_DEFAULTS/);
  assert.match(authorization, /--ws-control-background/);

  // Authorization: showModal() inside the same host-owned mechanism.
  assert.match(authorization, /createHostOwnedLayer\('authorization'/);
  assert.match(authorization, /showModal\(\)/);
  assert.doesNotMatch(authorization, /data-ws-part="host\.permission"/);

  // The load-failure banner is trusted UI too: closed shadow layer, stylesheet
  // inside the boundary, no document-level scoped stylesheet to override.
  assert.match(recoveryNotice, /createHostOwnedLayer\("skin-load"/);
  assert.match(recoveryNotice, /data-ws-part="app\.skin-load-recovery"/);
  assert.doesNotMatch(recoveryNotice, /<style scoped>/);

  // The layer itself: closed shadow root, no data-ws-part, fixed fallback.
  assert.match(ownedLayer, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.match(ownedLayer, /data-ws-host-layer/);
  assert.doesNotMatch(ownedLayer, /setAttribute\("data-ws-part"/);

  // The reset path is independent of the skinnable plugin overlay.
  assert.match(hostChromeService, /requestBuiltInSkin/);
  assert.match(hostChromeService, /isThirdPartySkinActive/);
  assert.match(publicSkin, /hostBuiltInSkinRequests/);
  assert.match(publicSkin, /switchToBuiltIn/);

  // Defense in depth: there is still no compiler route to a "host.recovery"
  // selector, even if a node ever regressed to carrying that attribute.
  for (const selector of ['[data-ws-part="host.recovery"]', '[data-ws-part="host.permission"]']) {
    assert.throws(() => compileSkinCss(`${selector} { display: none; }`, "community.evil", {}, 3), /Trusted or unknown host part/);
  }

  // A leading `:root` must not reach body-level siblings (the host layer in the
  // preview/fixture topology) through `+` / `~`.
  for (const selector of [
    ":root ~ [data-ws-host-layer]",
    ":root ~ *",
    ":root + [data-ws-host-layer]",
    ":root:hover ~ *",
  ]) {
    assert.throws(
      () => compileSkinCss(`${selector} { display: none !important; }`, "community.evil", {}, 3),
      /sibling combinator after :root/,
      selector,
    );
  }
});

test("the themed preview keeps recovery in its own hookless top layer", async () => {
  const [preview, bridge] = await Promise.all([
    read("../host-chrome-preview.html"),
    read("../src/services/host-chrome-preview.ts"),
  ]);
  assert.match(bridge, /resolveHiddenHostParts/);
  assert.match(preview, /host-chrome-preview\.ts/);
  assert.match(preview, /resolveHiddenHostParts\(chromeData, \[\]\)/);
  assert.match(preview, /hiddenParts\.has\(part\)/);
  assert.match(preview, /isHostPartReachable\(/);
  assert.match(preview, /launcherReachable/);
  assert.match(preview, /recoveryLayer\.remove\(\)/);
  assert.match(preview, /popover="manual"/);
  assert.doesNotMatch(preview, /data-ws-part="host\.recovery"/);
  assert.doesNotMatch(preview, /const watermarkHidden = getComputedStyle/);
});

test("the public-skin composable opts in only through chrome.json#visibleParts", async () => {
  const usePublicSkin = await read("../src/composables/usePublicSkin.ts");
  assert.match(usePublicSkin, /setSkinHostChromeParts\(skin\?\.chromeData\)/);
  // Sniffing the combined stylesheet would match the importer-generated
  // hiddenParts/icon CSS and leak decorations for hiddenParts-only packs.
  assert.doesNotMatch(usePublicSkin, /\.test\(skin\.css\)/);
});

async function dumpDom(url, extraArgs = []) {
  return await new Promise((resolve, reject) => {
    const child = spawn(CHROME, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      ...extraArgs,
      "--dump-dom",
      url,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Headless Chrome timed out.\n${stderr.slice(-2000)}`));
    }, 60000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!stdout.includes('id="result"')) {
        reject(new Error(`Headless Chrome exited ${code} without a result.\n${stderr.slice(-2000)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

test("recovery stays visible and clickable under hostile compiled skins", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, ws: false },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? address.port : 0;
  assert.ok(port, "Vite did not expose a listening port");

  const hash = encodeURIComponent(JSON.stringify(scenarios));
  const dom = await dumpDom(`http://127.0.0.1:${port}/test/fixtures/host-chrome-recovery.html#${hash}`);
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the fixture did not emit a result block");
  const payload = JSON.parse(match[1]);
  assert.equal(payload.error, undefined, payload.error);
  assert.equal(payload.results.length, scenarios.length);

  assert.ok(payload.authorization, "the authorization dialog was not mounted");
  assert.equal(payload.authorization.modalOpen, true, "the authorization dialog is not modal / in the top layer");
  assert.equal(payload.authorization.topLayerHit, true, "the hostile layer covers the authorization dialog");
  assert.equal(payload.authorization.hostileCovered, false, "the hostile layer received the authorization hit test");
  assert.equal(payload.authorization.layerOutsideSkinRoot, true, "the authorization dialog was rendered inside .ws-skin-root");
  assert.equal(payload.authorization.sized, true, "the authorization dialog has no layout box");

  // The pre-Popover / rejected-promotion fallback must actually lay the capsule
  // out: a closed [popover] is display:none !important until the attribute goes.
  assert.ok(payload.popoverFallback, "the fixture did not exercise the popover fallback");
  assert.equal(payload.popoverFallback.display, "flex", "the fallback capsule is not displayed");
  assert.equal(payload.popoverFallback.popoverAttribute, false, "the popover attribute still forces display:none");
  assert.equal(payload.popoverFallback.visible, true, "the fallback capsule has no layout box");

  for (const result of payload.results) {
    assert.equal(result.popoverOpen, true, `${result.name}: recovery popover is not in the top layer`);
    assert.equal(result.topLayerHit, true, `${result.name}: recovery is covered by the hostile layer`);
    assert.equal(result.hitIsLayerHost, true, `${result.name}: elementFromPoint did not retarget the closed shadow root to the layer host`);
    assert.equal(result.hostileCovered, false, `${result.name}: the hostile layer received the hit test`);
    assert.equal(result.visible, true, `${result.name}: recovery is visually hidden or non-interactive`);
    assert.equal(result.clicked, true, `${result.name}: clicking "use built-in skin" did not reach the handler`);
    assert.equal(result.layerOutsideSkinRoot, true, `${result.name}: recovery was rendered inside .ws-skin-root`);
  }
});

test("a declared slot docks the capsule and falls back at runtime", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, ws: false },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? address.port : 0;
  assert.ok(port, "Vite did not expose a listening port");

  const dom = await dumpDom(`http://127.0.0.1:${port}/test/fixtures/host-slot-placement.html`);
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the fixture did not emit a result block");
  const payload = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(payload.error, undefined, payload.error);
  const byName = Object.fromEntries(payload.results.map((result) => [result.name, result]));

  const initial = byName.initial;
  assert.equal(initial.mode, "slotted", JSON.stringify(payload));
  assert.equal(initial.insideAnchor, true, "the capsule is not placed over the anchor");
  assert.equal(initial.hitIsLayerHost, true, "the docked capsule is not the hit-test target");
  assert.equal(initial.background, "rgb(16, 32, 48)", "skin background token was not applied");
  assert.equal(initial.color, "rgb(255, 255, 255)", "skin foreground token was not applied");
  assert.ok(initial.buttonHeight >= 36, "the large size tier minimum was not enforced");

  for (const position of ["middle-left", "middle-right", "top-center", "bottom-center"]) {
    const fallback = byName[`fallback-${position}`];
    assert.equal(fallback.mode, "floating", JSON.stringify(fallback));
    assert.equal(fallback.translated, true, "floating CSS translation was not restored");
    const docked = byName[`redocked-${position}`];
    assert.equal(docked.mode, "slotted", JSON.stringify(docked));
    assert.equal(docked.insideAnchor, true, JSON.stringify(docked));
    assert.equal(docked.hitIsLayerHost, true, JSON.stringify(docked));
    assert.equal(docked.translate, "none", JSON.stringify(docked));
  }

  assert.equal(byName["anchor-hidden"].mode, "floating");
  assert.equal(byName["anchor-hidden"].reason, "anchor-missing");
  assert.equal(byName["anchor-hidden"].inlineLeft, "");
  assert.equal(byName["anchor-hidden"].atDefaultCorner, true);

  // Anti-flap: one good check after a fallback is not enough to re-dock.
  assert.equal(byName["restored-once"].mode, "floating");
  assert.equal(byName["restored-twice"].mode, "slotted");
  assert.equal(byName["restored-twice"].insideAnchor, true);

  assert.equal(byName["covers-mic"].mode, "floating");
  assert.equal(byName["covers-mic"].reason, "covers-protected");
  assert.equal(byName["covers-mic"].atDefaultCorner, true);

  assert.equal(byName["anchor-offscreen"].mode, "floating");
  // An invisible/off-screen element is never resolved as the anchor at all.
  assert.equal(byName["anchor-offscreen"].reason, "anchor-missing");
  assert.equal(byName["anchor-offscreen"].atDefaultCorner, true);

  // Foreground equal to background: the whole colour group reverts.
  assert.equal(byName["unreadable-tokens"].background, "rgb(255, 255, 255)");
  assert.equal(byName["unreadable-tokens"].color, "rgb(49, 82, 79)");

  assert.equal(byName.disposed.inlineLeft, "");
  assert.equal(byName.disposed.atDefaultCorner, true);
  assert.equal(byName.disposed.leftoverAccent, "");
});

test("floating host controls move off skin controls at runtime", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, ws: false },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? address.port : 0;
  assert.ok(port, "Vite did not expose a listening port");

  const dom = await dumpDom(`http://127.0.0.1:${port}/test/fixtures/host-floating-placement.html`, ["--virtual-time-budget=60000", "--window-size=1280,800"]);
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the fixture did not emit a result block");
  const payload = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(payload.error, undefined, payload.error);
  const byName = Object.fromEntries(payload.results.map((result) => [result.name, result]));

  // Default corner covers the microphone, bottom-right covers the (disabled)
  // Send button and top-left a server strip: the capsule takes a free spot.
  const first = byName["dock-and-send"];
  assert.deepEqual(first.covered, [], JSON.stringify(payload));
  assert.notEqual(first.position, "bottom-left");
  assert.notEqual(first.position, "bottom-right");
  assert.equal(first.capsuleHit, true, "the moved capsule is not clickable");
  assert.equal(first.compact, false);

  // Settled: repeated re-checks over ~2 s never move it again (no jitter).
  assert.deepEqual(byName.stable.positions, [first.position], JSON.stringify(byName.stable));
  // A full-screen click-away layer is no reason to fold to the mark.
  assert.equal(byName["click-away"].compact, false, JSON.stringify(byName["click-away"]));
  // Two host floating controls never overlap, settle, and neither covers Send.
  const two = byName["two-controls"];
  assert.equal(two.overlap, false, JSON.stringify(two));
  assert.equal(two.capMoves, 1, JSON.stringify(two));
  assert.ok(two.libMoves <= 2, JSON.stringify(two));
  assert.equal(two.sendCovered, false, JSON.stringify(two));
  assert.deepEqual(two.covered, [], JSON.stringify(two));

  // A modal sheet opened by a click: its buttons are freed within one re-check.
  // Controls under the modal backdrop are not reachable anyway and do not count.
  assert.deepEqual(byName["after-click-sheet"].covered.filter((id) => id === "cancel" || id === "enter"), [], JSON.stringify(byName["after-click-sheet"]));
  assert.equal(byName["after-click-sheet"].capsuleHit, true);
  assert.notEqual(byName["after-click-sheet"].position, byName["after-click-sheet"].before, "the capsule did not move off the sheet");

  // Nowhere is free: the capsule folds to its mark but stays clickable.
  assert.equal(byName.wall.compact, true, JSON.stringify(byName.wall));
  assert.equal(byName.wall.capsuleHit, true);

  assert.equal(byName["wall-removed"].compact, false);
  // A screen change re-places the capsule within ~150 ms: back to the free
  // default corner, off the control that appeared under its old spot.
  const screen = byName["screen-change"];
  assert.notEqual(screen.away, "bottom-left", JSON.stringify(screen));
  assert.equal(screen.position, "bottom-left", JSON.stringify(screen));
  assert.equal(screen.exportCovered, false, JSON.stringify(screen));
  // Weighting: plain skin buttons are ordinary even inside the protected app root.
  assert.deepEqual(
    { plain: byName.weights.plain, mic: byName.weights.mic, ghost: byName.weights.ghost, custom: byName.weights.custom },
    { plain: 1, mic: 16, ghost: 0, custom: 1 },
    JSON.stringify(byName.weights),
  );
  // 12 s of a control hopping every 200 ms: at most a handful of moves, then the
  // capsule holds still (moves ≥ 1 s apart, frozen after 6 in 10 s).
  t.diagnostic(`flap ${JSON.stringify(byName.flap)} two ${JSON.stringify(byName["two-controls"])}`);
  assert.ok(byName.flap.moves <= 8, JSON.stringify(byName.flap));
  assert.equal(byName.flap.capsuleHit, true);
  assert.equal(byName.disposed.compact, false);
});

test("floating host controls see through toasts and still step off a control while frozen", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, ws: false },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? address.port : 0;
  assert.ok(port, "Vite did not expose a listening port");

  const dom = await dumpDom(`http://127.0.0.1:${port}/test/fixtures/host-floating-transient.html`, ["--virtual-time-budget=60000", "--window-size=1280,800"]);
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the fixture did not emit a result block");
  const payload = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(payload.error, undefined, payload.error);
  const byName = Object.fromEntries(payload.results.map((result) => [result.name, result]));
  t.diagnostic(JSON.stringify(payload.results));

  // open-voice-surface desktop: toasts passing over "Share accompaniment" (or
  // the audio-settings modal) no longer make the default corner look free.
  const toast = byName["toast-transient"];
  assert.notEqual(toast.settled, "bottom-right", JSON.stringify(toast));
  assert.ok(!toast.positions.includes("bottom-right"), JSON.stringify(toast));
  assert.equal(toast.coveredSamples, 0, JSON.stringify(toast));
  assert.equal(toast.finalCovered, false, JSON.stringify(toast));
  // Same screen, modal backdrop over the corner: no return home, so the
  // button is usable the moment the dialog closes.
  assert.ok(!toast.afterModal.positions.includes("bottom-right"), JSON.stringify(toast));
  assert.equal(toast.afterModal.accompanimentCovered, false, JSON.stringify(toast));

  // Parked at the default corner by the flap freeze on top of a control: one
  // escape about 1 s after the freeze (inside the 3 s pin), then still for the rest of it.
  const freeze = byName["freeze-escape"];
  assert.equal(freeze.flapMoves, 6, JSON.stringify(freeze));
  assert.equal(freeze.parkedPosition, "bottom-right", JSON.stringify(freeze));
  assert.equal(freeze.escapes.length, 1, JSON.stringify(freeze));
  assert.notEqual(freeze.escapes[0].position, "bottom-right", JSON.stringify(freeze));
  assert.ok(freeze.escapes[0].afterPinMs < 3000, JSON.stringify(freeze));
  assert.equal(freeze.movesWhileHeld, 0, JSON.stringify(freeze));

  const screen = byName["screen-change-during-freeze"];
  assert.ok(screen.sinceFreezeMs < 10000, "the test must switch screens before the old freeze expires");
  assert.equal(screen.coveredBeforeScreenChange, true, JSON.stringify(screen));
  assert.notEqual(screen.position, screen.frozenPosition, JSON.stringify(screen));
  assert.equal(screen.microphoneCovered, false, JSON.stringify(screen));
});

test("compiled quoted keyword animations still run in the browser", { skip: !CHROME && "google-chrome is not installed" }, async () => {
  const raw = '@keyframes linear { from { opacity: .5; } to { opacity: 1; } } [data-ws-part="home.feature"] { animation: "linear" 10s ease-in-out infinite; }';
  const compiled = compileSkinCss(raw, "community.animation-fixture", {}, 3).css;
  const html = `<!doctype html><html><head><style id="css"></style></head><body>
    <div class="ws-skin-root" data-ws-skin="community.animation-fixture"><div data-ws-part="home.feature">Feature</div></div>
    <pre id="result"></pre><script>
    const target = document.querySelector('[data-ws-part="home.feature"]');
    const style = document.getElementById('css');
    style.textContent = ${JSON.stringify(raw)};
    const before = target.getAnimations().length;
    style.textContent = ${JSON.stringify(compiled)};
    document.getElementById('result').textContent = JSON.stringify({ before, after: target.getAnimations().length });
    </script></body></html>`;
  const dom = await dumpDom(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the animation fixture did not emit a result block");
  const payload = JSON.parse(match[1]);
  assert.equal(payload.before, 1, JSON.stringify(payload));
  assert.equal(payload.after, 1, JSON.stringify(payload));
});

test("host control tokens follow late skin CSS, resolve modern colours and refuse skin fonts", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, ws: false },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? address.port : 0;
  assert.ok(port, "Vite did not expose a listening port");

  // The fixture awaits animation frames, so give headless Chrome virtual time.
  const dom = await dumpDom(`http://127.0.0.1:${port}/test/fixtures/host-control-theme.html`, ["--virtual-time-budget=10000"]);
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the fixture did not emit a result block");
  const payload = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(payload.error, undefined, payload.error);
  const byName = Object.fromEntries(payload.results.map((result) => [result.name, result]));

  assert.equal(byName["before-skin-css"].inlineBackground, "", "tokens were applied before the skin declared any");
  const late = byName["late-skin-css"];
  assert.match(late.inlineBackground, /^rgb\(\d+, \d+, \d+\)$/, "late skin CSS did not re-theme the control");
  assert.notEqual(late.inlineBackground, "rgb(255, 251, 235)", "the oklch() background fell back to the default palette");
  assert.equal(late.background, late.inlineBackground);
  assert.equal(late.inlineFont, "ui-sans-serif, system-ui, sans-serif", "a skin @font-face reached a host-owned control");
  assert.equal(byName["system-font"].inlineFont, 'Tahoma, "Segoe UI", sans-serif');
  assert.equal(byName["media-gated-skin-font"].inlineFont, "ui-sans-serif, system-ui, sans-serif", "a media-gated skin @font-face reached a host-owned control");
  const resized = byName["media-token-resize"];
  assert.equal(resized.beforeResize, "rgb(16, 32, 48)", "an @media token was not applied");
  assert.notEqual(resized.inlineBackground, resized.beforeResize, "a viewport change did not refresh @media tokens");
  assert.equal(byName["after-dispose"].inlineBackground, late.inlineBackground, "a disposed binding kept observing the document");
});

test("toolbar-mode recovery docks plain host buttons, de-duplicates the library and falls back", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, ws: false },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? address.port : 0;
  assert.ok(port, "Vite did not expose a listening port");

  const run = async (windowSize) => {
    const dom = await dumpDom(
      `http://127.0.0.1:${port}/test/fixtures/host-recovery-toolbar.html`,
      ["--virtual-time-budget=30000", `--window-size=${windowSize}`],
    );
    const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
    assert.ok(match, "the toolbar fixture did not emit a result block");
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  };

  const payload = await run("1280,800");
  assert.equal(payload.error, undefined, payload.error);

  const initial = payload.initial;
  assert.equal(initial.toolbarOpen, true, "the toolbar did not dock into the declared anchor");
  assert.equal(initial.insideAnchor, true, "the toolbar is not placed inside the page anchor");
  assert.equal(initial.insideViewport, true);
  assert.equal(initial.actionCount, 2, "the group slot must render both independent host buttons");
  assert.deepEqual(initial.labels, ["Integrierten Skin verwenden", "Anwendungsbibliothek"]);
  assert.equal(initial.capsuleOpen, false, "the capsule shell must not be shown next to a docked toolbar");
  assert.equal(initial.background, "rgb(16, 32, 48)", "toolbar background token was not applied");
  assert.equal(initial.foreground, "rgb(255, 255, 255)", "toolbar foreground token was not applied");
  assert.equal(initial.border, "rgb(71, 220, 196)", "toolbar border token was not applied");
  assert.equal(initial.radius, "8px", "toolbar radius token was not applied");
  assert.equal(initial.fontSize, "14px", "toolbar font-size token was not applied");
  assert.equal(initial.minHeight, "36px", "toolbar height token was not applied");
  assert.equal(initial.shadow, "none", "the capsule shadow must not leak into toolbar mode");
  assert.equal(initial.clickable, true);
  assert.equal(initial.launcherSuppressed, true, "the host library button must replace the ordinary launcher");
  assert.equal(payload.builtInClicked, true, "clicking the toolbar button must run the host reset action");
  assert.equal(payload.libraryClicked, true, "clicking the toolbar library button must reach the host handler");

  for (const lang of ["de", "ru", "ja"]) {
    const entries = payload.languages[lang];
    assert.equal(entries.length, 2, `${lang}: both host buttons must stay rendered`);
    for (const entry of entries) {
      assert.ok(entry.text && entry.text.length > 0, `${lang}: button lost its visible label`);
      assert.equal(entry.visible, true, `${lang}: button is not visible`);
      assert.equal(entry.inViewport, true, `${lang}: button escaped the viewport`);
      assert.ok(entry.height >= 28, `${lang}: button fell below the host hit target (${entry.height})`);
    }
  }

  assert.equal(payload.afterSwitch.toolbarOpen, true, "the toolbar did not survive the home -> voice page switch");
  assert.equal(payload.afterSwitch.insideVoiceAnchor, true, "the toolbar stayed on the previous page anchor");
  assert.equal(payload.afterSwitch.resolvedVoice, "voice-anchor", "the candidate list did not resolve the voice anchor");

  assert.equal(payload.fallback.toolbarOpen, false, "the toolbar stayed visible with a broken anchor");
  assert.equal(payload.fallback.capsuleVisible, true, "no visible floating recovery entry after the anchor failed");
  assert.deepEqual(payload.fallback.capsuleActions, ["built-in", "library"]);
  assert.equal(payload.fallback.launcherSuppressed, true, "the fallback capsule must keep exactly one library entry");

  assert.equal(payload.redocked.toolbarOpen, true, "the toolbar did not re-dock after the anchor returned");
  assert.equal(payload.redocked.insideVoiceAnchor, true);
  assert.equal(payload.redocked.capsuleOpen, false);

  assert.equal(payload.shortcut.capsuleOpen, true, "the shortcut did not summon the recovery capsule");
  assert.equal(payload.shortcut.toolbarOpen, false, "the docked toolbar must yield to the summoned capsule");
  assert.equal(payload.shortcut.focusedAction, "built-in", "the shortcut did not focus the first host button");
  assert.deepEqual(payload.shortcut.capsuleActions, ["built-in", "library"]);
  assert.equal(payload.afterEscape.capsuleOpen, false);
  assert.equal(payload.afterEscape.toolbarOpen, true, "closing the shortcut did not restore the docked toolbar");

  assert.equal(payload.invalidTokens.visible, true, "invalid toolbar tokens hid the button");
  assert.equal(payload.invalidTokens.inViewport, true);
  assert.equal(payload.invalidTokens.background, "rgb(255, 255, 255)", "transparent background must fall back to a visible surface");
  assert.equal(payload.invalidTokens.foreground, "rgb(49, 82, 79)");
  assert.equal(payload.invalidTokens.shadow, "none", "the invalid shadow token must not be applied");

  // Narrow viewport: long labels wrap inside the viewport and stay tappable.
  const narrow = await run("320,640");
  assert.equal(narrow.error, undefined, narrow.error);
  assert.equal(narrow.initial.toolbarOpen, true, JSON.stringify(narrow.initial));
  assert.equal(narrow.initial.insideViewport, true, JSON.stringify(narrow.initial.rect));
  assert.equal(narrow.initial.actionCount, 2);
  for (const entry of narrow.languages.de) {
    assert.equal(entry.visible, true);
    assert.equal(entry.inViewport, true, JSON.stringify(entry.rect));
    assert.ok(entry.height >= 28, JSON.stringify(entry));
  }
});

test("legacy slots without a mode still dock the capsule", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
  const server = await createServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, ws: false },
  });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  const port = address && typeof address === "object" ? address.port : 0;
  assert.ok(port, "Vite did not expose a listening port");

  const dom = await dumpDom(
    `http://127.0.0.1:${port}/test/fixtures/host-recovery-legacy-slot.html`,
    ["--virtual-time-budget=10000", "--window-size=1280,800"],
  );
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the legacy slot fixture did not emit a result block");
  const payload = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(payload.error, undefined, payload.error);
  assert.equal(payload.capsuleOpen, true, "an old slot without mode must keep the capsule presentation");
  assert.equal(payload.toolbarRendered, false, "an old slot must not grow a toolbar");
  assert.equal(payload.insideAnchor, true, "the capsule did not dock into the legacy anchor");
  assert.deepEqual(payload.actions, ["built-in", "library"]);
  assert.equal(payload.background, "rgb(16, 32, 48)", "the capsule still reads --skin-recovery-* tokens");
  assert.equal(payload.foreground, "rgb(255, 255, 255)");
  assert.equal(payload.clicked, true);
});
