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
  const [hostChrome, authorization, ownedLayer, hostChromeService, publicSkin, recoveryNotice, slotPlacement, floatingPlacement, pluginPanel, presentation, controlTokens] = await Promise.all([
    read("../src/components/HostChrome.vue"),
    read("../src/components/InstanceAuthorization.vue"),
    read("../src/services/host-owned-layer.ts"),
    read("../src/services/host-chrome.ts"),
    read("../src/composables/usePublicSkin.ts"),
    read("../src/components/SkinLoadRecoveryNotice.vue"),
    read("../src/services/host-slot-placement.ts"),
    read("../src/services/host-floating-placement.ts"),
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
  assert.match(hostChrome, /:aria-label="copy\.useBuiltIn"/);
  assert.match(hostChrome, /:aria-label="copy\.library"/);
  assert.match(hostChrome, /class="ws-host-toolbar-icon" aria-hidden="true"/);
  assert.match(hostChrome, /focusable="false"/);
  assert.match(hostChrome, /--ws-toolbar-hover-background/);
  assert.match(hostChrome, /--ws-toolbar-hover-border/);
  assert.match(hostChrome, /--ws-toolbar-gap/);
  assert.match(hostChrome, /--ws-toolbar-icon-size/);
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
  // Two split recovery toolbars must not cover each other on a narrow screen.
  assert.match(slotPlacement, /covers-host-control/);
  assert.match(hostChrome, /otherControls:/);
  // A fallback capsule must also avoid toolbars that are still docked: they
  // live in the closed shadow root and are invisible to the light-DOM obstacle
  // scan, so the document scan alone cannot protect their labels/clicks.
  assert.match(hostChrome, /avoidRects:/);
  assert.match(hostChrome, /dockedToolbarRects\(\)/);
  assert.match(floatingPlacement, /avoidRects\?:/);
  assert.match(floatingPlacement, /forbiddenAt\(/);
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

test("a docked toolbar does not resize-observe its measurement-only fallback", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
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
    `http://127.0.0.1:${port}/test/fixtures/host-slot-observer-loop.html`,
    ["--virtual-time-budget=5000", "--window-size=1280,800"],
  );
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the observer fixture did not emit a result block");
  const payload = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(payload.error, undefined, payload.error);
  assert.equal(payload.initial.mode, "slotted");
  assert.equal(payload.initial.open, true);
  assert.ok(payload.initial.width >= 160 && payload.initial.height >= 28);
  assert.ok(payload.initial.observed.includes("anchor"), "the docked toolbar stopped observing its anchor");
  assert.ok(payload.initial.observed.includes("measurement-toolbar"), "the docked toolbar stopped observing its own rendered size");
  assert.equal(payload.whileDockedButHidden.mode, "slotted");
  assert.equal(payload.whileDockedButHidden.open, false);
  assert.ok(payload.whileDockedButHidden.resizeCallbacks <= 4, `hiding a docked toolbar caused ${payload.whileDockedButHidden.resizeCallbacks} ResizeObserver callbacks`);
  assert.ok(payload.whileDockedButHidden.frameCallbacks <= 4, `hiding a docked toolbar scheduled ${payload.whileDockedButHidden.frameCallbacks} animation frames`);
  assert.equal(payload.whileDockedButHidden.observed.includes("measurement-toolbar"), false, "a hidden docked toolbar remained in its own ResizeObserver feedback path");
  assert.equal(payload.afterAnchorRemoved.mode, "floating");
  assert.equal(payload.afterAnchorRemoved.reason, "anchor-missing");
  assert.equal(payload.afterAnchorRemoved.open, false);
  assert.ok(payload.afterAnchorRemoved.resizeCallbacks <= 4, `measurement display changes caused ${payload.afterAnchorRemoved.resizeCallbacks} ResizeObserver callbacks`);
  assert.ok(payload.afterAnchorRemoved.frameCallbacks <= 4, `measurement display changes scheduled ${payload.afterAnchorRemoved.frameCallbacks} animation frames`);
  assert.equal(payload.afterAnchorRemoved.modeChanges, 1, "the fallback repeatedly changed presentation");
  assert.equal(payload.afterAnchorRemoved.observed.includes("measurement-toolbar"), false, "the floating measurement-only toolbar remained in its own ResizeObserver feedback path");
});

test("docked-toolbar exclusion still scores pointer and focus obstacles", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
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
    `http://127.0.0.1:${port}/test/fixtures/host-floating-avoid-pointer.html`,
    ["--virtual-time-budget=5000", "--window-size=1280,800"],
  );
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the floating avoidance fixture did not emit a result block");
  const payload = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(payload.error, undefined, payload.error);
  assert.notEqual(payload.position, "top-left", "the first toolbar-free candidate bypassed pointer avoidance");
  assert.equal(payload.pointerHit, false, "the replacement position landed on the pointer");
  assert.ok(payload.rect.left >= 0 && payload.rect.top >= 0);
  assert.ok(payload.rect.left + payload.rect.width <= 1280 && payload.rect.top + payload.rect.height <= 800);
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

test("Classic toolbar icons keep 22px geometry, transparency, names and full-label shortcut recovery", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
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
    `http://127.0.0.1:${port}/test/fixtures/host-recovery-toolbar-classic.html`,
    ["--virtual-time-budget=10000", "--window-size=1280,800"],
  );
  const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
  assert.ok(match, "the Classic toolbar fixture did not emit a result block");
  const payload = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.equal(payload.error, undefined, payload.error);

  const initial = payload.initial;
  assert.equal(initial.toolbarOpen, true);
  assert.equal(initial.capsuleOpen, false);
  assert.equal(initial.actionCount, 2);
  assert.equal(initial.height, 22);
  assert.equal(initial.width, 24);
  assert.equal(initial.minHeight, "22px");
  assert.equal(initial.paddingTop, "0px");
  assert.equal(initial.paddingRight, "0px");
  assert.equal(initial.paddingBottom, "0px");
  assert.equal(initial.paddingLeft, "0px");
  assert.equal(initial.borderTopWidth, "1px");
  assert.equal(initial.radius, "2px");
  assert.equal(initial.fontSize, "11px");
  assert.equal(initial.background, "rgba(0, 0, 0, 0)");
  assert.equal(initial.foreground, "rgb(26, 26, 26)");
  assert.equal(initial.gap, "1px");
  assert.equal(initial.hoverBackground, "rgb(234, 242, 253)");
  assert.equal(initial.hoverBorder, "rgb(184, 207, 232)");
  assert.equal(initial.iconWidth, 16);
  assert.equal(initial.iconHeight, 16);
  assert.equal(initial.iconDisplay, "block");
  assert.equal(initial.iconAriaHidden, "true");
  assert.equal(initial.svgFocusable, "false");
  assert.deepEqual(initial.visibleText, ["", ""]);
  assert.deepEqual(initial.accessibleNames, ["Use built-in skin", "Application library"]);
  assert.equal(initial.titles[0], "Restore the built-in skin (Ctrl+Alt+Shift+R, or ⌘+⌥+⇧+R on macOS)");
  assert.equal(initial.titles[1], "Application library");
  assert.equal(initial.groupName, "Restore built-in skin");
  assert.equal(initial.hitIsLayerHost, true);
  assert.equal(initial.builtInClicked, true);
  assert.equal(initial.libraryClicked, true);

  assert.equal(payload.shortcut.capsuleOpen, true);
  assert.equal(payload.shortcut.toolbarOpen, false);
  assert.deepEqual(payload.shortcut.labels, ["Use built-in skin", "Application library"]);
  assert.ok(payload.shortcut.height >= 28);
  assert.equal(payload.shortcut.builtInBackground, "rgb(255, 247, 237)");
  assert.equal(payload.shortcut.builtInForeground, "rgb(124, 45, 18)");
  assert.equal(payload.shortcut.focusedAction, "built-in");
  assert.equal(payload.afterEscape.capsuleOpen, false);
  assert.equal(payload.afterEscape.toolbarOpen, true);
  assert.equal(payload.invalidTokens.background, "rgb(255, 255, 255)");
  assert.equal(payload.invalidTokens.foreground, "rgb(49, 82, 79)");
  assert.equal(payload.invalidTokens.visible, true);
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
  assert.equal(initial.alignedWithAnchor, true, JSON.stringify(initial));
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
  assert.equal(payload.afterSwitch.alignedWithVoiceAnchor, true, "the toolbar stayed on the previous page anchor");
  assert.equal(payload.afterSwitch.resolvedVoice, "voice-anchor", "the candidate list did not resolve the voice anchor");

  assert.equal(payload.fallback.toolbarOpen, false, "the toolbar stayed visible with a broken anchor");
  assert.equal(payload.fallback.capsuleVisible, true, "no visible floating recovery entry after the anchor failed");
  assert.deepEqual(payload.fallback.capsuleActions, ["built-in", "library"]);
  assert.equal(payload.fallback.launcherSuppressed, true, "the fallback capsule must keep exactly one library entry");

  assert.equal(payload.redocked.toolbarOpen, true, "the toolbar did not re-dock after the anchor returned");
  assert.equal(payload.redocked.alignedWithVoiceAnchor, true);
  assert.equal(payload.redocked.capsuleOpen, false);

  assert.equal(payload.shortcut.capsuleOpen, true, "the shortcut did not summon the recovery capsule");
  assert.equal(payload.shortcut.toolbarOpen, false, "the docked toolbar must yield to the summoned capsule");
  assert.equal(payload.shortcut.focusedAction, "built-in", "the shortcut did not focus the first host button");
  assert.deepEqual(payload.shortcut.capsuleActions, ["built-in", "library"]);
  assert.equal(payload.afterEscape.capsuleOpen, false);
  assert.equal(payload.afterEscape.toolbarOpen, true, "closing the shortcut did not restore the docked toolbar");

  // The macOS chord arrives with a derived `key` (®) + physical `code` KeyR,
  // under a capture listener that calls preventDefault(); it must still work.
  assert.equal(payload.macShortcut.capsuleOpen, true, "the macOS ⌘⌥⇧R chord did not summon the capsule");
  assert.equal(payload.macShortcut.toolbarOpen, false, "the macOS chord must yield to the summoned capsule");
  assert.equal(payload.macShortcut.focusedAction, "built-in", "the macOS chord did not focus the first host button");
  assert.deepEqual(payload.macShortcut.capsuleActions, ["built-in", "library"]);
  assert.equal(payload.afterMacEscape.capsuleOpen, false);
  assert.equal(payload.afterMacEscape.toolbarOpen, true, "closing the macOS chord did not restore the docked toolbar");
  assert.equal(payload.afterFocusOut.activeId, "blank", "focus did not leave the summoned capsule");
  assert.equal(payload.afterFocusOut.focusedAction, null);
  assert.equal(payload.afterFocusOut.capsuleOpen, false, "focusout left the full shortcut capsule open");
  assert.equal(payload.afterFocusOut.toolbarOpen, true, "focusout did not restore the docked toolbar");
  assert.equal(payload.afterBlankClick.capsuleOpen, false, "clicking blank space left the full shortcut capsule open");
  assert.equal(payload.afterBlankClick.toolbarOpen, true, "clicking blank space did not restore the docked toolbar");

  assert.equal(payload.invalidTokens.visible, true, "invalid toolbar tokens hid the button");
  assert.equal(payload.invalidTokens.inViewport, true);
  assert.equal(payload.invalidTokens.background, "rgb(255, 255, 255)", "unreadable transparent foreground must fall back to a visible surface");
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

test("real PluginPanel launcher is de-duplicated by group and split toolbars on desktop and a real 320px viewport", { skip: !CHROME && "google-chrome is not installed" }, async (t) => {
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

  const base = `http://127.0.0.1:${port}/test/fixtures`;
  const run = async (mode, real320 = false) => {
    // Headless Chrome clamps --window-size=320 to a 500px viewport. The
    // wrapper opens the fixture inside a genuine 320px iframe so window.innerWidth,
    // 100vw, flex-wrap and the slot viewport checks all see 320px.
    const url = real320
      ? `${base}/host-recovery-toolbar-viewport.html#${mode}`
      : `${base}/host-recovery-toolbar-plugin-panel.html#${mode}`;
    const dom = await dumpDom(url, ["--virtual-time-budget=30000", "--window-size=1280,800"]);
    const match = dom.match(/<pre id="result"[^>]*>([\s\S]*?)<\/pre>/);
    assert.ok(match, `${mode} @ ${real320 ? 320 : 1280}: the fixture did not emit a result block`);
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  };
  const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const observableButtons = (snapshot, context, count = 2) => {
    const entries = snapshot.visibleActions;
    assert.equal(entries.length, count, `${context}: expected ${count} visible buttons, got ${JSON.stringify(entries)}`);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        assert.equal(overlaps(entries[i].rect, entries[j].rect), false, `${context}: buttons overlap each other`);
      }
    }
    for (const entry of entries) {
      assert.ok(entry.text && entry.text.length > 0, `${context}: button lost its label`);
      assert.equal(entry.visible, true, `${context}: button is not visible`);
      assert.equal(entry.inViewport, true, `${context}: button escaped the viewport: ${JSON.stringify(entry.rect)}`);
      assert.ok(entry.height >= 28, `${context}: button fell below the host hit target (${entry.height})`);
      // A visible box is not enough: elementFromPoint at the button's own
      // centre must resolve to that button, not to a sibling host control.
      assert.equal(entry.docHitIsLayerHost, true, `${context}: ${entry.action} is not in the host top layer`);
      assert.equal(entry.hitAction, entry.action, `${context}: ${entry.action} centre is covered by ${entry.hitAction}`);
    }
  };

  const group = await run("group");
  assert.equal(group.error, undefined, group.error);
  assert.equal(group.initial.toolbarCount, 1);
  assert.equal(group.initial.toolbars[0].open, true, "the group toolbar did not dock");
  assert.deepEqual(group.initial.toolbars[0].labels, ["Integrierten Skin verwenden", "Anwendungsbibliothek"]);
  assert.equal(group.initial.launcherPresent, false, "the real PluginPanel launcher was not suppressed");
  assert.equal(group.initial.launcherCount, 0);
  assert.equal(group.initial.inlineFlag, true);
  assert.equal(group.initial.capsuleOpen, false);
  assert.equal(group.initial.visibleLibraryEntries, 1);
  observableButtons(group.initial, "group desktop");
  assert.equal(group.clicks.builtIn, true);
  assert.equal(group.clicks.library, true);
  assert.equal(group.afterSwitch.toolbars[0].open, true, "the toolbar did not survive the page switch");
  assert.equal(group.afterSwitch.alignedWithVoiceAnchor, true);
  assert.equal(group.afterSwitch.resolvedVoice, "voice-anchor");
  assert.equal(group.fallback.toolbars[0].open, false, "the toolbar stayed docked with a broken anchor");
  assert.equal(group.fallback.capsuleVisible, true);
  assert.deepEqual(group.fallback.capsuleActions, ["built-in", "library"]);
  assert.equal(group.fallback.launcherPresent, false, "the fallback added a second real library entry");
  assert.equal(group.fallback.visibleLibraryEntries, 1);
  assert.equal(group.redocked.toolbars[0].open, true);
  assert.equal(group.shortcut.capsuleOpen, true);
  assert.equal(group.shortcut.toolbars[0].open, false);
  assert.equal(group.shortcut.focusedAction, "built-in");
  assert.equal(group.afterEscape.capsuleOpen, false);
  assert.equal(group.afterEscape.toolbars[0].open, true);
  assert.equal(group.redocked.stable, true, "the docked toolbar flapped between the anchor and the capsule");

  const split = await run("split");
  assert.equal(split.error, undefined, split.error);
  assert.equal(split.initial.toolbarCount, 2, "split mode must render two separately observable toolbars");
  assert.deepEqual(split.initial.toolbars.map((bar) => bar.labels), [["Integrierten Skin verwenden"], ["Anwendungsbibliothek"]]);
  assert.equal(split.initial.toolbars[0].open, true);
  assert.equal(split.initial.toolbars[1].open, true);
  assert.equal(split.initial.toolbarOverlap, false);
  assert.equal(split.initial.launcherPresent, false, "the real launcher survived the split toolbar");
  assert.equal(split.initial.visibleLibraryEntries, 1);
  observableButtons(split.initial, "split desktop");
  assert.equal(split.clicks.builtIn, true, "the built-in split toolbar button was not clickable");
  assert.equal(split.clicks.library, true, "the library split toolbar button was not clickable");
  assert.equal(split.afterSwitch.toolbars[0].open, true);
  assert.equal(split.afterSwitch.toolbars[1].open, true);
  assert.equal(split.afterSwitch.alignedWithVoiceAnchor, true);
  for (const lang of ["de", "ru", "ja"]) {
    observableButtons({ visibleActions: split.languages[lang] }, `${lang} split desktop`);
  }
  assert.equal(split.fallback.toolbars.every((bar) => !bar.open), true);
  assert.equal(split.fallback.capsuleVisible, true);
  assert.deepEqual(split.fallback.capsuleActions, ["built-in", "library"]);
  assert.equal(split.fallback.launcherPresent, false, "the bad-anchor fallback restored a second library entry");
  assert.equal(split.fallback.visibleLibraryEntries, 1);
  assert.equal(split.redocked.toolbars.filter((bar) => bar.open).length, 2);
  assert.equal(split.redocked.stable, true, "split toolbars flapped between the anchor and the capsule");
  assert.equal(split.shortcut.capsuleOpen, true);
  assert.equal(split.shortcut.toolbars.every((bar) => !bar.open), true);
  assert.equal(split.shortcut.focusedAction, "built-in");
  assert.equal(split.afterEscape.capsuleOpen, false);
  assert.equal(split.afterEscape.toolbars.filter((bar) => bar.open).length, 2);

  // Legacy capsule mode is the control: the real launcher must be able to
  // render at all, otherwise "suppressed" above would be a false positive.
  const capsule = await run("capsule");
  assert.equal(capsule.error, undefined, capsule.error);
  assert.equal(capsule.initial.toolbarCount, 0);
  assert.equal(capsule.initial.capsuleOpen, true);
  assert.equal(capsule.initial.launcherPresent, true, "the real PluginPanel launcher never rendered");
  assert.equal(capsule.initial.launcherVisible, true);
  assert.equal(capsule.initial.launcherCount, 1);
  assert.equal(capsule.initial.inlineFlag, false);

  // Real 320px viewport: group labels wrap and stay tappable; split falls back
  // to a visible capsule for the action that would cover its sibling toolbar.
  const narrowGroup = await run("group", true);
  assert.equal(narrowGroup.error, undefined, narrowGroup.error);
  assert.equal(narrowGroup.initial.viewport, 320, "the iframe did not provide a real 320px viewport");
  assert.equal(narrowGroup.initial.toolbars[0].open, true);
  assert.equal(narrowGroup.initial.toolbarOverlap, false);
  assert.equal(narrowGroup.initial.launcherPresent, false);
  assert.equal(narrowGroup.initial.visibleLibraryEntries, 1);
  observableButtons(narrowGroup.initial, "group 320px");
  assert.equal(narrowGroup.clicks.builtIn, true);
  assert.equal(narrowGroup.clicks.library, true);
  for (const lang of ["de", "ru", "ja"]) {
    observableButtons({ visibleActions: narrowGroup.languages[lang] }, `${lang} group 320px`);
  }
  assert.equal(narrowGroup.redocked.stable, true);

  const narrowSplit = await run("split", true);
  assert.equal(narrowSplit.error, undefined, narrowSplit.error);
  assert.equal(narrowSplit.initial.viewport, 320, "the iframe did not provide a real 320px viewport");
  assert.equal(narrowSplit.initial.toolbarCount, 2);
  assert.equal(narrowSplit.initial.toolbarOverlap, false, "docked split toolbars still cover each other at 320px");
  assert.equal(narrowSplit.initial.launcherPresent, false, "the real launcher reappeared at 320px");
  assert.equal(narrowSplit.initial.visibleLibraryEntries, 1, "the narrow fallback added a duplicate library entry");
  observableButtons(narrowSplit.initial, "split 320px");
  // The pushed-out library toolbar falls back to the capsule while built-in
  // stays docked. Both bottom corners of the fixture are occupied, which is
  // what drives the capsule toward the top bar (the GUI-retested failure).
  // Assert the two footprints are disjoint and each action's centre resolves
  // to its own button via elementFromPoint, not a synthetic element.click().
  const dockedSplitBar = narrowSplit.initial.toolbars.find((bar) => bar.open);
  const dockedSplitButton = narrowSplit.initial.visibleActions.find((entry) => entry.action === "built-in");
  const capsuleSplitButton = narrowSplit.initial.visibleActions.find((entry) => entry.action === "library");
  assert.ok(dockedSplitBar && dockedSplitButton && capsuleSplitButton, "split 320px did not show one docked and one fallback action");
  assert.equal(
    overlaps(dockedSplitBar.rect, capsuleSplitButton.rect), false,
    `fallback capsule covers the docked toolbar at 320px: ${JSON.stringify({ toolbar: dockedSplitBar.rect, capsule: capsuleSplitButton.rect })}`,
  );
  assert.equal(dockedSplitButton.hitAction, "built-in", "the docked built-in button is not the hit target at its centre");
  assert.equal(capsuleSplitButton.hitAction, "library", "the fallback library button is not the hit target at its centre");
  assert.equal(narrowSplit.clicks.builtIn, true, "the docked split button was not clickable at 320px");
  assert.equal(narrowSplit.clicks.library, true, "the fallback capsule button was not clickable at 320px");
  for (const lang of ["de", "ru", "ja"]) {
    observableButtons({ visibleActions: narrowSplit.languages[lang] }, `${lang} split 320px`);
  }
  assert.equal(narrowSplit.fallback.capsuleVisible, true);
  assert.equal(narrowSplit.fallback.visibleLibraryEntries, 1);
  assert.equal(narrowSplit.redocked.stable, true, "the narrow split fallback flapped between controls");
  assert.equal(narrowSplit.shortcut.capsuleOpen, true);
  assert.equal(narrowSplit.shortcut.toolbars.every((bar) => !bar.open), true);
  assert.equal(narrowSplit.afterEscape.toolbars.filter((bar) => bar.open).length, 1);
  assert.equal(narrowSplit.afterEscape.capsuleOpen, true, "the fallback entry vanished after Esc at 320px");
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
  assert.ok(payload.capsuleHeight >= 28, "the legacy capsule lost its original size floor");
  assert.ok(payload.builtInHeight >= 28, "the legacy capsule action lost its original size floor");
  assert.equal(payload.builtInBackground, "rgb(255, 247, 237)", "the capsule built-in action must keep its fixed light background");
  assert.equal(payload.builtInForeground, "rgb(124, 45, 18)");
  assert.equal(payload.clicked, true);
});
