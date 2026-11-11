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
    '[data-ws-part="voice.audio-dock"] { margin: 0 0 0 -999px; }',
    '[data-ws-part="voice.audio-dock"] { margin-left: -100vw; }',
    '[data-ws-part="voice.audio-dock"] { margin-left: calc(20px - 500px); }',
    '[data-ws-part="voice.audio-dock"] { transform: matrix(1, 0, 0, 1, -4000, 0); }',
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
  // legitimate v3 theming.
  assert.doesNotThrow(() => compile('[data-ws-part="voice.audio-dock"] { margin: -6px; }'));
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
  assert.throws(() => compile('[data-ws-part="host.watermark"] { position: fixed; }'), /layout is owned by WebSpeak/);
  assert.throws(() => compile('[data-ws-part="host.plugins.overlay"] { width: 100vw; height: 100vh; }'), /fullscreen overlay/);

  // Descendant rules are the same escape: `*` can turn the library contents
  // into a viewport mask even when the shell itself is frozen.
  for (const css of [
    '[data-ws-part="host.plugins.overlay"] * { position: fixed; inset: 0; z-index: 2147483647; }',
    '[data-ws-part="host.plugins.overlay"] * { width: 100vw; height: 100vh; }',
    '[data-ws-part="host.plugins.overlay"] .ws-plugin-library { position: fixed; top: 0; left: 0; }',
    '[data-ws-part="host.watermark"] * { z-index: 2147483647; }',
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

  // Colors, borders, radius, shadows and artwork stay available, including on
  // descendants of the overlay.
  const themed = compile('[data-ws-part="host.plugins.overlay"] { border: 2px solid #1d4f9c; border-radius: 4px; background: #fff; box-shadow: 0 2px 8px #0003; }');
  assert.match(themed.css, /data-ws-part="host\.plugins\.overlay"/);
  assert.doesNotThrow(() => compile('[data-ws-part="host.plugins.overlay"] * { color: #fff; border-color: #1d4f9c; border-radius: 6px; }'));
  assert.doesNotThrow(() => compile('[data-ws-part="host.plugins.launcher"] { background: #1d4f9c; width: 120px; }'));
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
