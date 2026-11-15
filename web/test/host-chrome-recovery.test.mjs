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
  const [hostChrome, authorization, ownedLayer, hostChromeService, publicSkin, recoveryNotice, slotPlacement] = await Promise.all([
    read("../src/components/HostChrome.vue"),
    read("../src/components/InstanceAuthorization.vue"),
    read("../src/services/host-owned-layer.ts"),
    read("../src/services/host-chrome.ts"),
    read("../src/composables/usePublicSkin.ts"),
    read("../src/components/SkinLoadRecoveryNotice.vue"),
    read("../src/services/host-slot-placement.ts"),
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
