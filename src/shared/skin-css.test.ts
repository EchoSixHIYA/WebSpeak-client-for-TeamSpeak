import assert from "node:assert/strict";
import test from "node:test";
import { compileSkinCss, OPTIONAL_VISUAL_PARTS } from "./skin-css.js";
import { DECORATIVE_PART_IDS as LAYOUT_DECORATIVE, PROTECTED_PART_IDS } from "./skin-layout.js";
import { DECORATIVE_PART_IDS } from "./skin-visual-parts.js";
import {
  compileSkinChromeCss,
  DEFAULT_HIDDEN_HOST_PARTS,
  parseHiddenHostParts,
  parseSkinChromeDocument,
  resolveHiddenHostParts,
  SKIN_ICON_MAX_BYTES,
  validateSkinChromeAssets,
} from "./skin-chrome.js";

const assets = new Set<string>();
const compile = (css: string, version: 1 | 2 | 3 | 4 = 3, id = "demo-skin") =>
  compileSkinCss(css, id, assets, version);

test("the CSS hide whitelist and the layout decorative registry are one shared set", () => {
  assert.deepEqual([...OPTIONAL_VISUAL_PARTS].sort(), [...DECORATIVE_PART_IDS].sort());
  assert.deepEqual([...LAYOUT_DECORATIVE].sort(), [...DECORATIVE_PART_IDS].sort());
  for (const part of ["host.watermark", "host.hint", "host.voice-status-decoration", "home.footer.decoration"]) {
    assert.ok(OPTIONAL_VISUAL_PARTS.has(part), `${part} must be hideable`);
  }
  // home.footer contains the necessary "clear local data" link: only its
  // decorative children may be hidden, never the container.
  assert.equal(OPTIONAL_VISUAL_PARTS.has("home.footer"), false);
  assert.ok(PROTECTED_PART_IDS.has("home.footer"), "the footer container must not be hidden");
  assert.ok(PROTECTED_PART_IDS.has("home.footer.clear"));
  // Decorative password-dialog children stay hideable: existing skins rely on it.
  for (const part of ["auth.password.decoration", "auth.password.eyebrow", "auth.password.lead", "auth.password.label", "auth.password.field-icon"]) {
    assert.equal(PROTECTED_PART_IDS.has(part), false, `${part} must stay hideable`);
  }
  for (const part of ["auth.password.dialog", "auth.password.form", "auth.password.field", "auth.password.error", "auth.password.actions"]) {
    assert.ok(PROTECTED_PART_IDS.has(part), `${part} must be protected`);
  }
  // A screen-share exit button is a control but not part of the essential audio
  // path; v3 skins may still hide it, so it is not in the protected set.
  assert.equal(PROTECTED_PART_IDS.has("voice.screen-player.exit"), false);
  // The load-failure banner and the library recovery entry are distinct parts.
  assert.ok(PROTECTED_PART_IDS.has("app.skin-load-recovery"));
  assert.ok(PROTECTED_PART_IDS.has("host.recovery"));
});

test("host chrome selectors compile into the document-level host scope", () => {
  const themed = compile('[data-ws-part="host.plugins.launcher"] { background: #1d4f9c; width: 120px; }');
  assert.match(themed.css, /:root\[data-ws-host-skin="demo-skin"\] \[data-ws-part="host\.plugins\.launcher"\]/);
  assert.doesNotMatch(themed.css, /\.ws-skin-root\[data-ws-skin="demo-skin"\] \[data-ws-part="host\.plugins\.launcher"\]/);

  const scoped = compile('[data-ws-part="host.plugins.launcher"]:hover { color: white; }');
  assert.match(scoped.css, /:root\[data-ws-host-skin="demo-skin"\] \[data-ws-part="host\.plugins\.launcher"\]:hover/);

  const overlay = compile('[data-ws-part="host.plugins.overlay"] { border-color: red; }');
  assert.match(overlay.css, /:root\[data-ws-host-skin="demo-skin"\] \[data-ws-part="host\.plugins\.overlay"\]/);

  // Ordinary page parts keep the original skin-root scope.
  const page = compile('[data-ws-part="home.header"] { color: teal; }');
  assert.match(page.css, /\.ws-skin-root\[data-ws-skin="demo-skin"\] \[data-ws-part="home\.header"\]/);
  assert.doesNotMatch(page.css, /data-ws-host-skin/);
});

test("the extended scope cannot escape to html/body or host internals", () => {
  const rejected: Array<[string, RegExp]> = [
    ['html [data-ws-part="host.watermark"] { color: red; }', /cannot target html or body/],
    ['body [data-ws-part="host.watermark"] { color: red; }', /cannot target html or body/],
    ['[data-ws-host-skin] [data-ws-part="host.watermark"] { color: red; }', /host attribute/],
    ['[data-ws-route="webclient"] [data-ws-part="host.watermark"] { color: red; }', /host attribute/],
    ['[data-ws-part="home.header"] [data-ws-part="host.watermark"] { color: red; }', /cannot be mixed/],
    ['[data-ws-part="host.recovery"] { display: none; }', /Trusted or unknown host part/],
    ['[data-ws-part="host.permission"] { display: none; }', /Trusted or unknown host part/],
    ['[data-ws-part="host.unknown"] { color: red; }', /Trusted or unknown host part/],
    [':root { --ws-internal-token: red; }', /--skin- prefix/],
    ['[data-ws-part="host.hint"] { behavior: url(x.htc); }', /Executable CSS/],
    ['[data-ws-part="host.hint"] { background: url("https://example.invalid/x.png"); }', /Only relative paths/],
  ];
  for (const [css, message] of rejected) {
    assert.throws(() => compile(css), (error: unknown) => error instanceof Error && message.test(error.message), css);
  }
  assert.throws(() => compile('[data-ws-part="host.watermark"] { color: red; }', 1), /requires an open/);
  assert.throws(() => compile('[data-ws-part="host.watermark"] { color: red; }', 2), /requires an open/);
});

test("a leading :root cannot escape the skin root through a sibling combinator", () => {
  // `:root` is rewritten in place, so these become `.ws-skin-root … ~ …` and
  // would select the body-level host layer in the preview/fixture topology.
  for (const css of [
    ':root ~ [data-ws-host-layer] { display: none !important; }',
    ':root ~ * { display: none !important; }',
    ':root ~ div { pointer-events: none !important; }',
    ':root + [data-ws-host-layer] { display: none; }',
    ':root + * { visibility: hidden; }',
    ':root:hover ~ * { display: none !important; }',
    ':ROOT ~ * { display: none !important; }',
  ]) {
    assert.throws(() => compile(css), /sibling combinator after :root/, css);
  }

  // Descendant scoping (the documented form) still compiles into the skin root.
  const descendant = compile(':root [data-ws-part="home.header"] { color: teal; }');
  assert.match(descendant.css, /\.ws-skin-root\[data-ws-skin="demo-skin"\] \[data-ws-part="home\.header"\]/);
  // `>` and the descendant combinator are not sibling escapes.
  assert.doesNotThrow(() => compile(':root > [data-ws-part="home.header"] { color: teal; }'));
  assert.doesNotThrow(() => compile(':root { --skin-accent: #4c8f88; }'));
});

test("host-owned layer attributes are not skin hooks", () => {
  for (const attribute of [
    "data-ws-host-layer",
    "data-ws-host-recovery",
    "data-ws-host-layer-content",
    "data-ws-recovery-action",
  ]) {
    // A public hook in the same selector gets past the "must use a public hook"
    // check, so the attribute-name rejection is what stops the selector.
    assert.throws(() => compile(`:root [${attribute}] { display: none; }`), /host attribute/, attribute);
    assert.throws(() => compile(`[data-ws-part="home.header"] [${attribute}] { color: red; }`), /host attribute/, attribute);
    assert.throws(() => compile(`[data-ws-part="home.header"] [${attribute}="x"] { color: red; }`), /host attribute/, attribute);
  }
  // Normal descendant theming of a public part remains accepted.
  assert.doesNotThrow(() => compile(':root [data-ws-part="home.header"] { color: teal; }'));
});

test("trusted, permission, recovery and essential audio controls stay available even for v3 skins", () => {
  for (const part of [
    "voice.audio-dock",
    "voice.audio-dock.microphone",
    "voice.audio-dock.output",
    "voice.connection-status",
    "voice.audio-status",
    "voice.connection-status.reconnect",
    "home.security-note",
    "home.footer",
    "home.footer.clear",
    "app.toast",
  ]) {
    const mustNameSubject = (error: unknown) => error instanceof Error
      && error.message.includes(`"${part}"`)
      && /must remain available/.test(error.message);
    assert.throws(() => compile(`[data-ws-part="${part}"] { display: none; }`), mustNameSubject, part);
    assert.throws(() => compile(`[data-ws-part="${part}"] { opacity: 0; }`), mustNameSubject, part);
  }
  // Existing skins legitimately hide a decorative child *inside* the audio
  // dock; only the dock/control subject itself is protected.
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] > div:first-child { display: none; }'));
  // Hiding the screen-share exit button is a visual choice, not an essential
  // audio/recovery path: v3 skins may still do it. Legacy v1/v2 skins keep the
  // layout guard, so this cannot be used as a positioning attack.
  assert.doesNotThrow(() => compile('[data-ws-part="voice.screen-player.exit"] { display: none; }'));
  assert.throws(() => compile('[data-ws-part="voice.screen-player.exit"] { display: none; }', 1), /must not change layout/);
  // Explicitly optional decorations remain hideable.
  assert.doesNotThrow(() => compile('[data-ws-part="host.watermark"] { display: none; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="home.footer.decoration"] { visibility: hidden; }'));
});

test("chrome.json declares hidden parts and icon bitmaps, with path and size validation", () => {
  const valid = parseSkinChromeDocument(JSON.stringify({
    schemaVersion: 1,
    hiddenParts: ["host.watermark", "host.hint", "host.watermark"],
    icons: { "language.trigger": "assets/icons/language.png", "host.plugins.launcher": "assets/icons/apps.png" },
  }));
  assert.deepEqual(valid.hiddenParts, ["host.watermark", "host.hint"]);
  assert.equal(valid.icons["language.trigger"], "assets/icons/language.png");
  assert.equal(valid.visibleParts, undefined);

  const optedIn = parseSkinChromeDocument(JSON.stringify({
    schemaVersion: 1,
    visibleParts: ["host.watermark", "host.hint", "host.watermark"],
  }));
  assert.deepEqual(optedIn.visibleParts, ["host.watermark", "host.hint"]);

  const lookup = (path: string) => path.endsWith(".png") ? { bytes: 128, mime: "image/png" } : undefined;
  assert.doesNotThrow(() => validateSkinChromeAssets(valid, lookup));
  const generated = compileSkinChromeCss(valid, "demo-skin");
  assert.match(generated, /:root\[data-ws-host-skin="demo-skin"\] \[data-ws-part="host\.watermark"\] \{ display: none !important; \}/);
  assert.match(generated, /\[data-ws-icon-slot="language\.trigger"\] \{ background-image: url\("wskin-asset:assets%2Ficons%2Flanguage\.png"\)/);
  assert.match(generated, /\[data-ws-icon-slot="language\.trigger"\] > \* \{ visibility: hidden/);

  const invalidDocuments: Array<[unknown, RegExp]> = [
    [{ schemaVersion: 2, hiddenParts: [] }, /schemaVersion 1/],
    [{ schemaVersion: 1, hiddenParts: ["voice.audio-dock"] }, /explicitly optional/],
    [{ schemaVersion: 1, hiddenParts: ["host.recovery"] }, /explicitly optional/],
    [{ schemaVersion: 1, hiddenParts: ["home.footer"] }, /explicitly optional/],
    [{ schemaVersion: 1, visibleParts: ["voice.audio-dock"] }, /explicitly optional/],
    [{ schemaVersion: 1, icons: { "unknown.slot": "assets/icons/x.png" } }, /Unknown icon slot/],
    [{ schemaVersion: 1, icons: { "language.trigger": "../escape.png" } }, /assets\/icons/],
    [{ schemaVersion: 1, icons: { "language.trigger": "assets/icons/x.svg" } }, /SVG is not allowed/],
    [{ schemaVersion: 1, icons: { "language.trigger": "https://example.invalid/x.png" } }, /assets\/icons/],
    [{ schemaVersion: 1, extra: true }, /unsupported field/],
  ];
  for (const [value, message] of invalidDocuments) {
    assert.throws(() => parseSkinChromeDocument(JSON.stringify(value)), message, JSON.stringify(value));
  }
  assert.throws(() => validateSkinChromeAssets(valid, () => undefined), /missing from the package/);
  assert.throws(() => validateSkinChromeAssets(valid, () => ({ bytes: SKIN_ICON_MAX_BYTES + 1, mime: "image/png" })), /exceeds/);
  assert.throws(() => validateSkinChromeAssets(valid, () => ({ bytes: 10, mime: "text/plain" })), /raster image/);
});

test("instance-level hidden parts ignore unknown and protected names", () => {
  assert.deepEqual(parseHiddenHostParts("host.watermark, host.hint voice.audio-dock home.footer"), ["host.watermark", "host.hint"]);
  assert.deepEqual(parseHiddenHostParts(["host.hint", "host.hint", "nope"]), ["host.hint"]);
  assert.deepEqual(parseHiddenHostParts(undefined), []);
});

test("host-scope CSS cannot make the document root the subject of a hiding rule", () => {
  for (const css of [
    // The verified escape: the root is promoted to the host scope but still the subject.
    ':root:has([data-ws-part="host.watermark"]) { display: none; }',
    ':root:has([data-ws-part="host.hint"]) { visibility: hidden; }',
    '[data-ws-part="host.watermark"] :root { display: none; }',
    '*:has([data-ws-part="host.watermark"]) { display: none; }',
    'html:has([data-ws-part="host.watermark"]) { display: none; }',
    'body:has([data-ws-part="host.watermark"]) { display: none; }',
    '[data-ws-part="host.watermark"] + body { display: none; }',
  ]) {
    assert.throws(() => compile(css), /must start from a themeable|document root|cannot target html or body/, css);
  }

  // Legitimate host-part theming still compiles into the document-level scope.
  const launcher = compile('[data-ws-part="host.plugins.launcher"] { color: white; }');
  assert.match(launcher.css, /:root\[data-ws-host-skin="demo-skin"\] \[data-ws-part="host\.plugins\.launcher"\]/);
  assert.doesNotThrow(() => compile('[data-ws-part="host.watermark"]:has(span) { color: red; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="host.plugins.launcher"] [data-ws-icon-slot="host.plugins.launcher"] { opacity: .5; }'));
});

test("protected controls cannot be hidden through variables or moved off-screen", () => {
  assert.throws(
    () => compile(':root { --skin-hide: none; } [data-ws-part="voice.audio-dock"] { display: var(--skin-hide); }'),
    /cannot use indirect values/,
  );
  assert.throws(
    () => compile('[data-ws-part="voice.audio-dock"] { position: fixed; left: -9999px; }'),
    /must remain on screen/,
  );
  assert.throws(
    () => compile('[data-ws-part="voice.audio-dock.microphone"] { transform: translateY(-9999px); }'),
    /must remain on screen/,
  );
  assert.throws(
    () => compile('[data-ws-part="voice.audio-dock"] { inset: 0 0 0 -120vw; }'),
    /must remain on screen/,
  );

  // Large negative margins are the same escape as an inset: reject the pattern
  // generically, including longhands, shorthand, relative units and calc().
  for (const css of [
    '[data-ws-part="voice.audio-dock"] { margin-left: -9999px; }',
    '[data-ws-part="voice.audio-dock"] { margin-inline: -9999px; }',
    '[data-ws-part="voice.audio-dock"] { margin-block-start: -1200px; }',
    '[data-ws-part="voice.audio-dock"] { margin: 0 0 0 -1000px; }',
    '[data-ws-part="voice.audio-dock"] { margin-left: -100vw; }',
    '[data-ws-part="voice.audio-dock"] { margin-left: calc(20px - 5000px); }',
    '[data-ws-part="voice.audio-dock"] { transform: matrix(1, 0, 0, 1, -4000, 0); }',
    '[data-ws-part="voice.audio-dock"] { margin-left: -1e4px; }',
    '[data-ws-part="voice.audio-dock"] { transform: translateX(calc(2px*-1000)); }',
  ]) {
    assert.throws(() => compile(css), /must remain on screen/, css);
  }
  assert.throws(
    () => compile(':root { --skin-pull: -9999px; } [data-ws-part="voice.audio-dock"] { margin-left: var(--skin-pull); }'),
    /cannot use indirect values/,
  );

  // Ordinary appearance tokens and optional decorations keep working.
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { background: var(--skin-panel); }'));
  assert.doesNotThrow(() => compile(':root { --skin-hide: none; } [data-ws-part="host.watermark"] { display: var(--skin-hide); }'));
  // A small margin on a protected control and a decorative dock child are still
  // legitimate v3 theming. Ordinary placement is no longer mistaken for a
  // yeet: only values clearly beyond a viewport are rejected.
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { margin: -6px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { margin: 0 0 0 -999px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { margin-left: calc(20px - 500px); }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { position: fixed; top: 140px; left: 260px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { margin-top: 120px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { margin: 0 auto 120px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { top: 100%; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { scale: 100%; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { rotate: 4deg; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { transform: rotate(8deg); }'));
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] > div:first-child { display: none; }'));
  // The off-screen guard only protects the subject, not decorative or
  // non-protected parts.
  assert.doesNotThrow(() => compile('[data-ws-part="home.header"] { margin-left: -9999px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="host.watermark"] { margin-left: -9999px; }'));
});

test("host chrome cannot be restyled into a viewport-sized overlay", () => {
  assert.throws(
    () => compile('[data-ws-part="host.plugins.overlay"] { position: fixed; inset: 0; z-index: 2147483647; }'),
    /layout is owned by WebSpeak/,
  );
  assert.throws(() => compile('[data-ws-part="host.plugins.overlay"] { width: 100vw; height: 100vh; }'), /fullscreen overlay/);

  // Descendant rules are the same escape: `*` can turn the library contents
  // into a viewport mask even when the shell itself is frozen.
  for (const css of [
    '[data-ws-part="host.plugins.overlay"] * { position: fixed; inset: 0; z-index: 2147483647; }',
    '[data-ws-part="host.plugins.overlay"] * { width: 100vw; height: 100vh; }',
    '[data-ws-part="host.plugins.overlay"] .ws-plugin-library { position: fixed; top: 0; left: 0; }',
  ]) {
    assert.throws(() => compile(css), /layout is owned by WebSpeak|fullscreen overlay/, css);
  }
  // zoom (and any comparable scaling) must not blow the shell up either.
  for (const css of [
    '[data-ws-part="host.plugins.overlay"] { zoom: 10; }',
    '[data-ws-part="host.plugins.overlay"] * { zoom: 10; }',
    '[data-ws-part="host.plugins.overlay"] { transform: scale(10); }',
  ]) {
    assert.throws(() => compile(css), /layout is owned by WebSpeak|fullscreen overlay/, css);
  }

  // Decorative host chrome is not on the recovery path: it may be repositioned,
  // resized, restacked and animated, at most with a warning.
  for (const css of [
    '[data-ws-part="host.watermark"] { position: fixed; }',
    '[data-ws-part="host.watermark"] * { z-index: 2147483647; }',
    '[data-ws-part="host.watermark"] { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483647; opacity: .2; }',
    '[data-ws-part="host.plugins.launcher"] { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; }',
    '[data-ws-part="host.hint"] { position: absolute; transform: translateX(-10px); }',
    '[data-ws-part="host.voice-status-decoration"] { position: fixed; inset: 0; pointer-events: none; }',
  ]) {
    assert.doesNotThrow(() => compile(css), css);
  }

  // Colors, borders, radius, shadows and artwork stay available, including on
  // descendants of the overlay.
  const themed = compile('[data-ws-part="host.plugins.overlay"] { border: 2px solid #1d4f9c; border-radius: 4px; background: #fff; box-shadow: 0 2px 8px #0003; }');
  assert.match(themed.css, /data-ws-part="host\.plugins\.overlay"/);
  assert.doesNotThrow(() => compile('[data-ws-part="host.plugins.overlay"] * { color: #fff; border-color: #1d4f9c; border-radius: 6px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="host.plugins.launcher"] { background: #1d4f9c; width: 120px; }'));
  // Overlay contents may use normal sizing and margins; only a viewport-sized
  // box would turn the library contents into a fullscreen mask.
  assert.doesNotThrow(() => compile('[data-ws-part="host.plugins.overlay"] button { min-width: 44px; min-height: 44px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="host.plugins.overlay"] * { margin: 0; }'));
});

test("keyframes follow the same protected-control rules as regular declarations", () => {
  const rejected: Array<[string, RegExp]> = [
    ['@keyframes k { to { display: none; opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain available/],
    ['@keyframes k { to { visibility: hidden; } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain available/],
    ['@keyframes k { to { transform: translateX(-9999px); } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain on screen/],
    ['@keyframes k { to { inset: 0 0 0 -120vw; } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain on screen/],
    ['@keyframes k { to { filter: opacity(0); } } [data-ws-part="voice.audio-dock"] { animation-name: k; }', /must remain available/],
    ['@keyframes k { to { filter: brightness(0); } } [data-ws-part="voice.audio-dock"] { animation-name: k; }', /must remain available/],
    // A variable animation name must not hide the name from the walk.
    [':root { --skin-anim: k; } @keyframes k { to { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: var(--skin-anim) 1s forwards; }', /cannot use indirect values/],
    ['@keyframes k { to { opacity: 0; } } [data-ws-part="home.title"] { --skin-anim: k; } [data-ws-part="voice.audio-dock"] { animation-name: var(--skin-anim); }', /cannot use indirect values/],
  ];
  for (const [css, message] of rejected) {
    assert.throws(() => compile(css), (error: unknown) => error instanceof Error && message.test(error.message), css);
  }
  // A keyframe shared by a protected and a non-protected part is judged by the
  // protected reference.
  assert.throws(
    () => compile('@keyframes k { to { opacity: 0; } } [data-ws-part="home.title"] { animation: k 1s; } [data-ws-part="voice.audio-dock"] { animation: k 1s; }'),
    /must remain available/,
  );

  // Harmless fades, color tweens and gentle motion on non-protected parts, and
  // visual / motion keyframes on decorative host parts, still compile.
  for (const css of [
    '@keyframes fade { from { opacity: 0; } to { opacity: 1; } } [data-ws-part="home.title"] { animation: fade 2s ease; }',
    '@keyframes tint { from { color: #fff; } to { color: #1d4f9c; } } [data-ws-part="home.header"] { animation: tint 1.2s; }',
    '@keyframes drift { from { transform: translateY(0); } to { transform: translateY(-6px); } } [data-ws-part="home.hero.eyebrow"] { animation: drift 3s infinite alternate; }',
    '@keyframes wm { from { opacity: .1; color: #8ab9cf; transform: translateX(0); } to { opacity: .3; color: #2b6d8a; transform: translateX(20px); } } [data-ws-part="host.watermark"] { animation: wm 4s infinite alternate; }',
    '@keyframes big { to { width: 100vw; height: 100vh; opacity: .2; } } [data-ws-part="host.watermark"] { animation: big 1s forwards; }',
    '@keyframes hide { to { display: none; } } [data-ws-part="host.hint"] { animation: hide 1s forwards; }',
  ]) {
    assert.doesNotThrow(() => compile(css), css);
  }
});

test("keyframes hide protected parts only when the animation can rest there", () => {
  // Entrances and pulses that merely pass through a hidden/intermediate state
  // are legitimate: only `to`/`100%` (and a genuinely resting `from`) count.
  for (const css of [
    '@keyframes in { from { opacity: 0; } to { opacity: 1; } } [data-ws-part="app"] { animation: in .3s; }',
    '@keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } } [data-ws-part="app.toast"] { animation: toastIn .3s; }',
    '@keyframes fade { from { opacity: 0; } to { opacity: 1; } } [data-ws-part="voice.connection-status"] { animation: fade .4s; }',
    '@keyframes slide { from { transform: translateX(-100%); } to { transform: none; } } [data-ws-part="voice.mobile-nav"] { animation: slide .25s; }',
    '@keyframes pop { from { transform: scale(0); } to { transform: scale(1); } } [data-ws-part="app.toast"] { animation: pop .2s; }',
    '@keyframes pulse { 50% { opacity: 0; } 100% { opacity: 1; } } [data-ws-part="voice.connection-status"] { animation: pulse 2s infinite; }',
    '@keyframes in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } } [data-ws-part="host.plugins.overlay"] { animation: in .2s; }',
    '@keyframes pop { from { scale: 0; } to { scale: 1; } } [data-ws-part="host.plugins.overlay"] { animation: pop .2s; }',
    '@keyframes pop { from { transform: scale(0); } to { transform: scale(1); } } [data-ws-part="host.plugins.overlay"] { animation: pop .2s; }',
    '@keyframes slide { from { transform: translateY(8px); } to { transform: translateY(0); } } [data-ws-part="host.plugins.overlay"] { animation: slide .2s; }',
    // A keyframe without a `to` frame ends on the element's own style.
    '@keyframes tint { 50% { opacity: 0; } } [data-ws-part="voice.connection-status"] { animation: tint 2s; }',
  ]) {
    assert.doesNotThrow(() => compile(css), css);
  }

  const rejected: Array<[string, RegExp]> = [
    ['@keyframes k { to { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain available/],
    ['@keyframes k { 100% { display: none; } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain available/],
    ['@keyframes k { to { transform: translateX(-5000px); } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain on screen/],
    // Reverse/alternate/fill-backwards animations can end (or hold) on `from`.
    ['@keyframes k { from { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: k 1s reverse; }', /must remain available/],
    ['@keyframes k { from { display: none; } } [data-ws-part="voice.audio-dock"] { animation: k 1s alternate; }', /must remain available/],
    ['@keyframes k { from { visibility: hidden; } } [data-ws-part="voice.audio-dock"] { animation: k 1s; animation-direction: alternate-reverse; }', /must remain available/],
    ['@keyframes k { from { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: k 1s; animation-fill-mode: both; }', /must remain available/],
    ['@keyframes k { 0% { filter: brightness(0); } } [data-ws-part="voice.audio-dock"] { animation: k 1s reverse; }', /must remain available/],
    // Declaration order cannot hide a reverse direction behind a longhand.
    ['@keyframes k { from { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation-direction: normal; animation: k 1s reverse; }', /must remain available/],
    // A variable fill mode is unknowable, so the start frame is treated as resting.
    ['@keyframes k { from { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation-name: k; animation-fill-mode: var(--skin-fill); }', /must remain available/],
    // A paused animation renders its start frame from the first paint.
    ['@keyframes k { from { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: k 1s paused; }', /must remain available/],
    ['@keyframes k { from { display: none; } } [data-ws-part="voice.audio-dock"] { animation-name: k; animation-play-state: paused; }', /must remain available/],
    // Escaped `to`/`from` and `1e2%` must still be recognised as resting steps.
    ['@keyframes k { \\74 o { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain available/],
    ['@keyframes k { t\\6f { transform: translateX(-5000px); } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain on screen/],
    ['@keyframes k { \\66 rom { opacity: 0; } to { opacity: 1; } } [data-ws-part="voice.audio-dock"] { animation: k 1s reverse; }', /must remain available/],
    ['@keyframes k { 1e2% { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: k 1s forwards; }', /must remain available/],
    // Direction/fill longhands in a sibling rule on the same subject still rest on `from`.
    ['@keyframes k { from { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation: k 1s; } [data-ws-part="voice.audio-dock"] { animation-direction: reverse; animation-fill-mode: both; }', /must remain available/],
  ];
  for (const [css, message] of rejected) {
    assert.throws(() => compile(css), (error: unknown) => error instanceof Error && message.test(error.message), css);
  }
});

test("escaped animation names are matched and rewritten", () => {
  const escaped = compile('@keyframes pulse { from { opacity: 0; } to { opacity: 1; } } [data-ws-part="home.title"] { animation-name: p\\75 lse; }');
  assert.match(escaped.css, /animation-name: ws-demo-skin-pulse/);
  assert.doesNotMatch(escaped.css, /p\\75 lse/);

  const shorthand = compile('@keyframes pulse { from { opacity: 0; } to { opacity: 1; } } [data-ws-part="home.title"] { animation: p\\75 lse .3s ease; }');
  assert.match(shorthand.css, /animation: ws-demo-skin-pulse \.3s ease/);

  // Only the name slot is rewritten: a keyframe named like a timing keyword
  // must not turn the timing function into a keyframe reference.
  const timing = compile('@keyframes linear { from { opacity: 1; } to { opacity: 1; } } [data-ws-part="home.title"] { animation: linear 1s linear; }');
  assert.match(timing.css, /animation: linear 1s ws-demo-skin-linear/);
});

test("keyword-shaped animation tokens do not become keyframe references", () => {
  const named = compile('@keyframes alternate { from { opacity: 1; } to { opacity: 1; } } @keyframes bob { from { transform: translateY(0); } to { transform: translateY(4px); } } [data-ws-part="voice.audio-dock"] { animation: bob 2s alternate; }');
  assert.match(named.css, /@keyframes ws-demo-skin-alternate/);
  assert.match(named.css, /animation: ws-demo-skin-bob 2s alternate/);
  assert.doesNotMatch(named.css, /animation: bob 2s ws-demo-skin-alternate/);
});

test("normalised hidden values cannot hide protected parts", () => {
  const hidden: Array<[string, string]> = [
    ["display", "none"],
    ["visibility", "hidden"],
    ["visibility", "collapse"],
    ["opacity", ".0"],
    ["opacity", "+0"],
    ["opacity", "-1"],
    ["opacity", "0%"],
    ["opacity", "0.5%"],
    ["opacity", "0.001"],
    ["opacity", "calc(0)"],
    ["filter", "opacity(0.0)"],
    ["filter", "brightness(0)"],
    ["-webkit-filter", "opacity(0)"],
    ["pointer-events", "none"],
    ["transform", "scale(0)"],
    ["transform", "scaleX(0)"],
    ["transform", "scaleY(0)"],
    ["transform", "scale3d(0, 1, 1)"],
    ["transform", "scale(0 0)"],
    ["scale", "0"],
    ["scale", "0%"],
    ["scale", "0 0"],
    ["content-visibility", "hidden"],
    ["clip-path", "inset(50%)"],
    ["clip-path", "inset(60% 0)"],
    ["clip-path", "inset(0 60%)"],
    ["clip-path", "circle(0)"],
    ["clip-path", "ellipse(0 10px)"],
    ["clip", "rect(0,0,0,0)"],
    ["clip", "rect(0 0 0 0)"],
    ["mask", "alpha(0)"],
    ["mask-image", "luminance(0)"],
    ["mask-image", "linear-gradient(transparent, transparent)"],
    ["mask-image", "linear-gradient(#0000, #0000)"],
    ["mask-image", "linear-gradient(rgb(0 0 0 / 0), rgb(0 0 0 / 0))"],
    ["mask-image", "conic-gradient(from 0deg, transparent, transparent)"],
    ["opacity", "0e0"],
    ["opacity", "1e-3"],
    ["filter", "opacity(1e-2)"],
    ["transform", "scale(0e0)"],
    ["scale", "1e-9"],
  ];
  for (const [property, value] of hidden) {
    const direct = `[data-ws-part="voice.audio-dock"] { ${property}: ${value}; }`;
    assert.throws(() => compile(direct), /must remain available/, direct);
    const frame = `@keyframes k { to { ${property}: ${value}; } } [data-ws-part="voice.audio-dock"] { animation: k 1s; }`;
    assert.throws(() => compile(frame), /must remain available/, frame);
  }
  // Partial effects and artwork clipping remain legitimate.
  for (const css of [
    '[data-ws-part="voice.audio-dock"] { opacity: .5; }',
    '[data-ws-part="voice.audio-dock"] { filter: opacity(.4); }',
    '[data-ws-part="voice.audio-dock"] { transform: scale(.5); }',
    '[data-ws-part="voice.audio-dock"] { scale: .8; }',
    '[data-ws-part="voice.audio-dock"] { clip-path: polygon(0 0, 100% 0, 100% 80%, 0 100%); }',
    '[data-ws-part="voice.audio-dock"] { clip-path: inset(20%); }',
    '[data-ws-part="voice.audio-dock"] { mask-image: linear-gradient(transparent, red); }',
  ]) {
    assert.doesNotThrow(() => compile(css), css);
  }
});

test("selector variants cannot disguise a protected subject", () => {
  for (const css of [
    '[data-ws-part="VOICE.AUDIO-DOCK" i] { display: none; }',
    '[data-ws-part="voice.audio-dock" I] { opacity: 0; }',
    ':not(:not([data-ws-part="voice.audio-dock"])) { display: none; }',
    ':not(:not([data-ws-part="voice.audio-dock"]):hover) { visibility: hidden; }',
    ':nth-child(2n of [data-ws-part="voice.audio-dock"]) { display: none; }',
    ':nth-last-child(odd of .member, [data-ws-part="voice.audio-dock"]) { pointer-events: none; }',
    ':not(:not([data-ws-part="voice.audio-dock"]), [data-ws-part="home.title"]) { display: none; }',
    ':not(:is(:not([data-ws-part="voice.audio-dock"]))) { display: none; }',
  ]) {
    assert.throws(() => compile(css), /must remain available/, css);
  }
  // The `s` flag keeps matching case-sensitive, so this selects nothing.
  assert.doesNotThrow(() => compile('[data-ws-part="VOICE.AUDIO-DOCK" s] { display: none; }'));
  // A single :not() still means "every other element".
  assert.doesNotThrow(() => compile(':not([data-ws-part="voice.audio-dock"]) { display: none; }'));
});

test("escaped, namespaced and :is()/:where() animation names cannot bypass the protected-control locks", () => {
  const rejected: Array<[string, RegExp]> = [
    // Escaped property name used to skip the keyframe mapping walk.
    ['@keyframes k { to { display: none; } } [data-ws-part="voice.audio-dock"] { anim\\61 tion: k 1s forwards; }', /must remain available/],
    // A pack can predict the namespace and reference the already-renamed keyframe.
    ['@keyframes k { to { display: none; } } [data-ws-part="voice.audio-dock"] { animation: ws-demo-skin-k 1s forwards; }', /must remain available/],
    // The protected subject can be wrapped in a functional pseudo-class.
    [':is([data-ws-part="voice.audio-dock"]) { display: none; }', /must remain available/],
    [':where([data-ws-part="voice.audio-dock"]) { display: none; }', /must remain available/],
    ['@keyframes k { to { opacity: 0; } } :is([data-ws-part="voice.audio-dock"]) { animation: k 1s forwards; }', /must remain available/],
    // -webkit-* animation longhands participate in the same walks.
    ['@keyframes k { to { display: none; } } [data-ws-part="voice.audio-dock"] { -webkit-animation: k 1s forwards; }', /must remain available/],
    ['@keyframes k { to { display: none; } } [data-ws-part="voice.audio-dock"] { -webkit-animation-name: k; }', /must remain available/],
    ['[data-ws-part="voice.audio-dock"] { -webkit-animation: var(--skin-a); }', /cannot use indirect values/],
    // Escaped *values* used to bail out of the mapping walk on a backslash and
    // still resolve to the renamed keyframe in the browser.
    ['@keyframes k { to { display: none; } } [data-ws-part="voice.audio-dock"] { animation: ws-demo-skin-\\6b  1s forwards; }', /must remain available/],
    ['@keyframes k { to { display: none; } } [data-ws-part="voice.audio-dock"] { animation: ws-demo-skin-\\00006b  1s forwards; }', /must remain available/],
    ['@keyframes k { to { opacity: 0; } } [data-ws-part="voice.audio-dock"] { animation-name: \\6b; }', /must remain available/],
    // Prefixed visual-removal properties must use the same checks as the unprefixed form.
    ['[data-ws-part="voice.audio-dock"] { -webkit-filter: opacity(0); }', /must remain available/],
    ['[data-ws-part="voice.audio-dock"] { -webkit-transform: scale(0); }', /must remain available/],
  ];
  for (const [css, message] of rejected) {
    assert.throws(() => compile(css), (error: unknown) => error instanceof Error && message.test(error.message), css);
  }

  // `:not()` does not make the protected part the subject; only a v3 warning.
  assert.doesNotThrow(() => compile(':not([data-ws-part="voice.audio-dock"]) { display: none; }'));

  // A harmless -webkit-animation on a non-protected part still compiles and its
  // keyframe name is rewritten into the skin namespace.
  const webkit = compile('@keyframes fade { from { opacity: 0; } to { opacity: 1; } } [data-ws-part="home.title"] { -webkit-animation: fade 2s ease; }');
  assert.match(webkit.css, /@keyframes ws-demo-skin-fade/);
  assert.match(webkit.css, /-webkit-animation: ws-demo-skin-fade 2s ease/);
});

test("keyframes cannot turn the plugin overlay into a fullscreen layer", () => {
  for (const css of [
    '@keyframes k { to { position: fixed; inset: 0; z-index: 2147483647; } } [data-ws-part="host.plugins.overlay"] { animation: k 1s forwards; }',
    '@keyframes k { to { width: 100vw; height: 100vh; } } [data-ws-part="host.plugins.overlay"] * { animation: k 1s forwards; }',
    '@keyframes k { to { zoom: 10; } } [data-ws-part="host.plugins.overlay"] { animation: k 1s forwards; }',
    '@keyframes k { to { transform: scale(10); } } [data-ws-part="host.plugins.overlay"] { animation-name: k; }',
    '@keyframes k { to { position: fixed; inset: 0; z-index: 2147483647; } } [data-ws-part="host.plugins.overlay"] { --skin-a: ws-demo-skin-k; animation: var(--skin-a) 1s forwards; }',
    '[data-ws-part="host.plugins.overlay"] * { width: calc(50vw * 2); }',
    '[data-ws-part="host.plugins.overlay"] * { width: calc(99vw + 1vw); }',
  ]) {
    assert.throws(() => compile(css), /layout is owned by WebSpeak|fullscreen overlay/, css);
  }
  // The same animation is harmless on decorative host chrome.
  assert.doesNotThrow(() => compile('@keyframes k { to { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483647; opacity: .2; } } [data-ws-part="host.watermark"] { animation: k 1s forwards; }'));
});

test("large layout restyles of non-protected parts and decorative host chrome compile", () => {
  for (const css of [
    '[data-ws-part="home.header"] { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; position: relative; width: 80vw; height: 50vh; }',
    '[data-ws-part="home.header"] { display: flex; flex-direction: column; align-items: stretch; translate: 24px 0; }',
    '[data-ws-part="voice.audio-dock"] > div:first-child { position: absolute; width: 100vw; height: 100vh; }',
    // Whole-page and protected-part layout rewrites are the owner's explicit
    // use case; placement is no longer mistaken for a yeet.
    '[data-ws-part="app"] { display: grid; grid-template-areas: "rail main"; grid-template-columns: 72px 1fr; position: relative; }',
    '[data-ws-part="voice.audio-dock"] { position: fixed; top: 140px; left: 260px; display: flex; flex-direction: column; gap: 10px; }',
    '[data-ws-part="home"] { display: flex; flex-direction: column; align-items: stretch; min-height: 100vh; }',
    // Official example skins (harbor, kaak) clip their own artwork.
    '[data-ws-part="home.header"] { clip-path: polygon(0 0, 100% 0, 100% 82%, 0 100%); }',
    '[data-ws-part="host.watermark"] { position: fixed; inset: 0; width: 100vw; height: 100vh; transform: rotate(-8deg); }',
  ]) {
    assert.doesNotThrow(() => compile(css), css);
  }
});

test("official and built-in skins hide host decorations unless the active skin opts in", () => {
  const decorations = ["host.watermark", "host.hint", "host.voice-status-decoration"];
  assert.deepEqual([...DEFAULT_HIDDEN_HOST_PARTS].sort(), [...decorations].sort());

  // Built-in skins ship no chrome.json: decorations are hidden, launcher stays.
  const builtin = resolveHiddenHostParts(undefined, []);
  for (const part of decorations) assert.ok(builtin.has(part), `${part} must be hidden for built-in skins`);
  assert.equal(builtin.has("host.plugins.launcher"), false);

  // An explicit opt-in shows them again; hiddenParts still wins.
  const optedIn = resolveHiddenHostParts({ schemaVersion: 1, hiddenParts: [], visibleParts: decorations, icons: {} }, []);
  for (const part of decorations) assert.equal(optedIn.has(part), false, `${part} must be visible after opting in`);
  const explicitlyHidden = resolveHiddenHostParts({ schemaVersion: 1, hiddenParts: ["host.hint"], visibleParts: decorations, icons: {} }, []);
  assert.ok(explicitlyHidden.has("host.hint"));

  // hiddenParts-only chrome.json is not an opt-in: decorations stay hidden.
  // This is the production path that previously reported a false positive
  // because the appended chrome CSS itself contained `data-ws-part="host.…"`.
  const hiddenOnly = resolveHiddenHostParts({ schemaVersion: 1, hiddenParts: ["host.plugins.launcher"], icons: {} }, []);
  for (const part of decorations) assert.ok(hiddenOnly.has(part), `${part} must stay hidden for a hiddenParts-only pack`);
  assert.ok(hiddenOnly.has("host.plugins.launcher"));
  const watermarkOnly = resolveHiddenHostParts({ schemaVersion: 1, hiddenParts: ["host.watermark"], icons: {} }, []);
  for (const part of decorations) assert.ok(watermarkOnly.has(part), `${part} must stay hidden when only watermark is declared`);

  // chrome.json alone (for example an icon-only override) is not an opt-in.
  const iconOnly = resolveHiddenHostParts({ schemaVersion: 1, hiddenParts: [], icons: {} }, []);
  for (const part of decorations) assert.ok(iconOnly.has(part), `${part} must stay hidden without visibleParts`);

  // Instance defaults cannot be re-enabled by a skin.
  const instanceHidden = resolveHiddenHostParts({ schemaVersion: 1, hiddenParts: [], visibleParts: decorations, icons: {} }, ["host.watermark"]);
  assert.ok(instanceHidden.has("host.watermark"));
});
