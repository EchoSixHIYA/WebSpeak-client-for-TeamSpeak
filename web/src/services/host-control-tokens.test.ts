import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_CONTROL_APPLIED_VARIABLES,
  HOST_CONTROL_GLOBAL_TOKEN_PROPERTIES,
  HOST_CONTROL_MIN_ACCENT_CONTRAST,
  HOST_CONTROL_MIN_BORDER_CONTRAST,
  HOST_CONTROL_MIN_FONT_SIZE,
  HOST_CONTROL_MIN_FOREGROUND_CONTRAST,
  HOST_CONTROL_MIN_HIT_TARGET,
  HOST_CONTROL_SIZE_METRICS,
  PERMISSION_CONTROL_DEFAULTS,
  RECOVERY_CONTROL_DEFAULTS,
  SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS,
  applyHostControlTokens,
  contrastRatio,
  fontFamilyNames,
  hasHostControlTokens,
  hostControlTokenKey,
  hostControlTokenProperty,
  parseCssColor,
  relativeLuminance,
  resolveHostControlTokens,
  type HostControlRawTokens,
} from "./host-control-tokens.js";

type TokenMap = Record<string, string>;

const style = (tokens: TokenMap): Pick<CSSStyleDeclaration, "getPropertyValue"> => ({
  getPropertyValue: (name) => tokens[name] ?? "",
});

const prefixed = (prefix: string, tokens: HostControlRawTokens): TokenMap => Object.fromEntries(
  Object.entries(tokens)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => [`--skin-${prefix}-${name}`, value]),
);

const resolveRecovery = (part: HostControlRawTokens = {}, global: HostControlRawTokens = {}) =>
  resolveHostControlTokens(
    style({ ...prefixed("host", global), ...prefixed("recovery", part) }),
    "host.recovery",
    raw => raw,
    RECOVERY_CONTROL_DEFAULTS,
  );

test("host control token names are stable and keep --skin-recovery-* working", () => {
  assert.equal(hostControlTokenKey("host.recovery"), "recovery");
  assert.equal(hostControlTokenKey("app.skin-load-recovery"), "load-recovery");
  assert.equal(hostControlTokenKey("host.permission"), "permission");
  assert.equal(hostControlTokenKey("host.future"), "future");

  assert.equal(hostControlTokenProperty("host.recovery", "background"), "--skin-recovery-background");
  assert.equal(hostControlTokenProperty("app.skin-load-recovery", "size"), "--skin-load-recovery-size");
  assert.equal(hostControlTokenProperty("host.permission", "accent"), "--skin-permission-accent");
  assert.equal(HOST_CONTROL_GLOBAL_TOKEN_PROPERTIES.foreground, "--skin-host-foreground");
});

test("recovery tokens default to the host palette", () => {
  const tokens = resolveHostControlTokens(null, "host.recovery", () => undefined, RECOVERY_CONTROL_DEFAULTS);
  assert.equal(tokens.accent, "rgb(180, 83, 9)");
  assert.equal(tokens.builtInBorder, "rgb(180, 83, 9)");
  assert.equal(tokens.background, "rgb(255, 255, 255)");
  assert.equal(tokens.foreground, "rgb(49, 82, 79)");
  assert.equal(tokens.border, "rgb(157, 182, 178)");
  assert.equal(tokens.radius, 999);
  assert.equal(tokens.font, "ui-sans-serif, system-ui, sans-serif");
  assert.equal(tokens.size, "small");
  assert.equal(tokens.hitTarget, HOST_CONTROL_MIN_HIT_TARGET);
  assert.equal(tokens.fontSize, HOST_CONTROL_MIN_FONT_SIZE);
  assert.ok(contrastRatio(parseCssColor(tokens.onAccent)!, parseCssColor(tokens.accent)!) >= 4.5);
});

test("a readable skin palette is kept and translucent backgrounds become opaque", () => {
  const tokens = resolveRecovery({
    accent: "#47dcc4",
    background: "rgba(9, 19, 23, 0.4)",
    foreground: "#edf8f5",
    border: "#47dcc4",
  });
  assert.equal(tokens.accent, "rgb(71, 220, 196)");
  assert.equal(tokens.background, "rgb(9, 19, 23)");
  assert.equal(tokens.foreground, "rgb(237, 248, 245)");
  assert.equal(tokens.border, "rgb(71, 220, 196)");
});

test("per-part tokens win over the global set and both fall back as a colour group", () => {
  const readable = resolveRecovery(
    { background: "#102030", foreground: "#ffffff", accent: "#47dcc4" },
    { background: "#ffffff", foreground: "#111111", accent: "#1d4ed8" },
  );
  assert.equal(readable.background, "rgb(16, 32, 48)", "the per-part background must win");
  assert.equal(readable.foreground, "rgb(255, 255, 255)");
  assert.equal(readable.accent, "rgb(71, 220, 196)");

  // An unreadable per-part group falls back to a readable global palette.
  const globalFallback = resolveRecovery(
    { background: "#777777", foreground: "#888888", accent: "#47dcc4" },
    { background: "#102030", foreground: "#ffffff", accent: "#47dcc4" },
  );
  assert.equal(globalFallback.background, "rgb(16, 32, 48)");
  assert.equal(globalFallback.foreground, "rgb(255, 255, 255)");
  assert.equal(globalFallback.accent, "rgb(71, 220, 196)");

  // No readable layer: the built-in palette wins as a whole.
  const reset = resolveRecovery(
    { background: "#777777", foreground: "#888888", accent: "#47dcc4" },
    { background: "#888888", foreground: "#999999", accent: "#eeeeee" },
  );
  assert.equal(reset.background, "rgb(255, 255, 255)");
  assert.equal(reset.foreground, "rgb(49, 82, 79)");
  assert.equal(reset.accent, "rgb(180, 83, 9)");
});

test("the border only uses a colour visible against the resolved background", () => {
  assert.equal(resolveRecovery({ border: "#ffffff" }).border, "rgb(157, 182, 178)");
  assert.equal(resolveRecovery({ border: "#000000" }).border, "rgb(0, 0, 0)");

  const globalFallback = resolveRecovery({ border: "#ffffff" }, { border: "#000000" });
  assert.equal(globalFallback.border, "rgb(0, 0, 0)");
  assert.ok(contrastRatio(parseCssColor(globalFallback.border)!, parseCssColor(globalFallback.background)!) >= HOST_CONTROL_MIN_BORDER_CONTRAST);
});

test("radius, font and size tokens are sanitized and host minimums win", () => {
  assert.equal(resolveRecovery({ radius: "12px" }).radius, 12);
  assert.equal(resolveRecovery({ radius: "2000px" }).radius, 999);
  assert.equal(resolveRecovery({ radius: "-5px" }).radius, 0);
  assert.equal(resolveRecovery({ radius: "1em" }).radius, 999);
  assert.equal(resolveRecovery({ radius: "12" }).radius, 999);

  assert.equal(resolveRecovery({ font: 'Tahoma, "Segoe UI", sans-serif' }).font, 'Tahoma, "Segoe UI", sans-serif');
  for (const font of ["url(https://example.invalid/a.woff2)", "Tahoma; color: red", "x".repeat(121)]) {
    assert.equal(resolveRecovery({ font }).font, "ui-sans-serif, system-ui, sans-serif", font);
  }

  assert.equal(resolveRecovery({ size: "medium" }).hitTarget, 32);
  assert.equal(resolveRecovery({ size: "medium" }).fontSize, 12);
  assert.equal(resolveRecovery({ size: "large" }).hitTarget, 36);
  assert.equal(resolveRecovery({ size: "large" }).fontSize, 13);
  assert.equal(resolveRecovery({ size: "huge" }).size, "small");
  for (const metrics of Object.values(HOST_CONTROL_SIZE_METRICS)) {
    assert.ok(metrics.hitTarget >= HOST_CONTROL_MIN_HIT_TARGET);
    assert.ok(metrics.fontSize >= HOST_CONTROL_MIN_FONT_SIZE);
  }

  // Controls with a larger built-in action never shrink below it.
  const banner = resolveHostControlTokens(
    style(prefixed("host", { size: "small" })),
    "app.skin-load-recovery",
    raw => raw,
    SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS,
  );
  assert.equal(banner.hitTarget, 44);
  assert.equal(banner.fontSize, 14);
  const bannerLarge = resolveHostControlTokens(
    style(prefixed("load-recovery", { size: "large" })),
    "app.skin-load-recovery",
    raw => raw,
    SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS,
  );
  assert.equal(bannerLarge.hitTarget, 48);
  assert.equal(bannerLarge.fontSize, 16);
});

test("the built-in button border only uses an accent visible on its fixed light background", () => {
  const pale = resolveRecovery({ background: "#141414", foreground: "#ffffff", accent: "#fff7ec" });
  assert.equal(pale.accent, "rgb(255, 247, 236)");
  assert.equal(pale.builtInBorder, "rgb(180, 83, 9)");

  const strong = resolveRecovery({ background: "#ffffff", foreground: "#111111", accent: "#1d4ed8" });
  assert.equal(strong.builtInBorder, "rgb(29, 78, 216)");
});

test("global tokens theme the banner and the authorization dialog", () => {
  const root = style(prefixed("host", {
    background: "#102030",
    foreground: "#ffffff",
    accent: "#47dcc4",
    border: "#47dcc4",
    radius: "18px",
    font: "Tahoma, sans-serif",
    size: "large",
  }));
  const banner = resolveHostControlTokens(root, "app.skin-load-recovery", raw => raw, SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS);
  assert.equal(banner.background, "rgb(16, 32, 48)");
  assert.equal(banner.foreground, "rgb(255, 255, 255)");
  assert.equal(banner.radius, 18);
  assert.equal(banner.font, "Tahoma, sans-serif");
  assert.equal(banner.hitTarget, 48);

  const dialog = resolveHostControlTokens(root, "host.permission", raw => raw, PERMISSION_CONTROL_DEFAULTS);
  assert.equal(dialog.background, "rgb(16, 32, 48)");
  assert.equal(dialog.foreground, "rgb(255, 255, 255)");
  assert.ok(contrastRatio(parseCssColor(dialog.onAccent)!, parseCssColor(dialog.accent)!) >= 4.5);
  assert.equal(dialog.hitTarget, 46);

  const override = resolveHostControlTokens(
    style({ ...prefixed("host", { background: "#102030", foreground: "#ffffff", accent: "#47dcc4" }), ...prefixed("load-recovery", { background: "#ffffff", foreground: "#111111", accent: "#1d4ed8" }) }),
    "app.skin-load-recovery",
    raw => raw,
    SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS,
  );
  assert.equal(override.background, "rgb(255, 255, 255)");
});

test("only a declared global or per-part token triggers host theming", () => {
  assert.equal(hasHostControlTokens(style({}), "host.recovery"), false);
  assert.equal(hasHostControlTokens(style({ "--skin-unrelated": "red" }), "host.recovery"), false);
  assert.equal(hasHostControlTokens(style({ "--skin-host-background": "#102030" }), "host.recovery"), true);
  assert.equal(hasHostControlTokens(style({ "--skin-recovery-radius": "8px" }), "host.recovery"), true);
  assert.equal(hasHostControlTokens(style({ "--skin-load-recovery-accent": "#123456" }), "app.skin-load-recovery"), true);
  assert.equal(hasHostControlTokens(style({ "--skin-permission-font": "Tahoma" }), "host.permission"), true);
});

test("applying and clearing tokens writes only host-owned variables", () => {
  const values = new Map<string, string>();
  const control = {
    style: {
      setProperty: (name: string, value: string) => { values.set(name, value); },
      removeProperty: (name: string) => { values.delete(name); },
    },
  } as unknown as HTMLElement;
  const tokens = resolveRecovery({ background: "#102030", foreground: "#ffffff", accent: "#47dcc4", radius: "8px" });
  applyHostControlTokens(control, tokens);
  assert.equal(values.get(HOST_CONTROL_APPLIED_VARIABLES.background), "rgb(16, 32, 48)");
  assert.equal(values.get(HOST_CONTROL_APPLIED_VARIABLES.radius), "8px");
  assert.ok(values.has(HOST_CONTROL_APPLIED_VARIABLES.onAccent));
  applyHostControlTokens(control, null);
  assert.equal(values.size, 0);
});

test("CSS colours parse to RGB and ignore alpha for contrast", () => {
  assert.deepEqual(parseCssColor("#1d4f9c"), { r: 29, g: 79, b: 156 });
  assert.deepEqual(parseCssColor("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseCssColor("#ffff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseCssColor("rgb(29, 79, 156)"), { r: 29, g: 79, b: 156 });
  assert.deepEqual(parseCssColor("rgb(29 79 156 / 50%)"), { r: 29, g: 79, b: 156 });
  assert.deepEqual(parseCssColor("rgba(255, 0, 0, .4)"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseCssColor("rgb(300, -5, 0)"), { r: 255, g: 0, b: 0 });
  for (const invalid of ["", "red", "hsl(10, 20%, 30%)", "color(srgb 1 0 0)", "#12345", "rgb(1, 2)"]) {
    assert.equal(parseCssColor(invalid), null, invalid);
  }
});

test("WCAG contrast follows the relative-luminance formula", () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
  assert.equal(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), 21);
  assert.equal(contrastRatio({ r: 12, g: 34, b: 56 }, { r: 12, g: 34, b: 56 }), 1);
  assert.ok(HOST_CONTROL_MIN_FOREGROUND_CONTRAST > HOST_CONTROL_MIN_ACCENT_CONTRAST);
});

test("host controls ignore fonts registered by a skin @font-face", () => {
  assert.deepEqual(fontFamilyNames(`"Wave Font", 'Other' , sans-serif`), ["wave font", "other", "sans-serif"]);
  const webFonts = new Set(["blank glyphs"]);
  const isWebFont = (family: string) => webFonts.has(family);
  const resolve = (font: string) => resolveHostControlTokens(
    style({ "--skin-host-font": font }),
    "app.skin-load-recovery",
    raw => raw,
    SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS,
    isWebFont,
  ).font;
  assert.equal(resolve('"Blank Glyphs", sans-serif'), SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS.font);
  assert.equal(resolve("Tahoma, 'blank glyphs'"), SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS.font);
  assert.equal(resolve('Tahoma, "Segoe UI", sans-serif'), 'Tahoma, "Segoe UI", sans-serif');
});
