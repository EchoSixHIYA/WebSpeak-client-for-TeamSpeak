import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { importSkinPack, resolveSkinCssAssets, SkinPackError } from "./skin-pack.js";
import { scopeBuiltinThemeForCustomSkin } from "./skin-cascade.js";

const manifest = {
  schemaVersion: 1,
  id: "ocean-night",
  name: "Ocean Night",
  version: "1.0.0",
  author: "WebSpeak test",
  license: "MIT",
  minAppVersion: "0.2.4",
  entry: "skin.css",
};

test("skin CSS is scoped, local artwork and fonts work, and global names are isolated", async () => {
  const skin = await importSkinPack(makeSkin(`
    @font-face { font-family: "Wave Font"; src: url("assets/wave.woff2") format("woff2"); }
    @keyframes shimmer { from { opacity: .4; } to { opacity: 1; } }
    :root { --skin-accent: #00a99d; }
    [data-ws-part="voice.member"] { font-family: "Wave Font", sans-serif; animation: shimmer 1s ease-in-out; background-image: image-set("assets/backdrop.png" 1x); }
  `));

  assert.match(skin.css, /\.ws-skin-root\[data-ws-skin="ocean-night"\] \{ --skin-accent: #00a99d; \}/);
  assert.match(skin.css, /@keyframes ws-ocean-night-shimmer/);
  assert.match(skin.css, /animation: ws-ocean-night-shimmer/);
  assert.match(skin.css, /font-family: "ws-ocean-night-Wave-Font"/);
  assert.match(skin.css, /url\("wskin-asset:assets%2Fwave\.woff2"\)/);
  assert.match(skin.css, /image-set\("wskin-asset:assets%2Fbackdrop\.png" 1x\)/);
  assert.ok(skin.warnings.some((warning) => warning.includes("localized text wrapping")));
  assert.equal(skin.contentData, undefined, "skin content is optional; WebSpeak supplies the base interface translations");

  const resolved = resolveSkinCssAssets(skin.css, skin.assets);
  assert.match(resolved.css, /blob:/);
  resolved.objectUrls.forEach((url) => URL.revokeObjectURL(url));
});

test("skin CSS permits visual decoration but prevents layout, text-flow, and control-geometry changes", async () => {
  const skin = await importSkinPack(makeSkin('@keyframes fade-wave { from { opacity: 0; } to { opacity: 1; } } [data-ws-part="demo.wave"] { opacity: var(--skin-decoration-opacity); animation: fade-wave 1s; box-shadow: 0 0 14px #4ff; }'));
  assert.match(skin.css, /opacity: var\(--skin-decoration-opacity\)/);
  assert.match(skin.css, /box-shadow: 0 0 14px #4ff/);
  assert.match(skin.css, /from \{ opacity: 0; \}/);
  assert.match(skin.css, /animation: ws-ocean-night-fade-wave 1s/);

  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { display: none; }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { position: fixed; inset: 0; z-index: 99999; }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.member"] { padding: 30px; transform: scale(1.2); }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="home.hero.title"] { font-size: 3rem; line-height: 1; white-space: nowrap; }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="home.hero.title"] { text-transform: uppercase; }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { opacity: 0; }')), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="demo.wave"] span { display: none; }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { display: var(--skin-hidden); }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { all: unset; }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
  await assert.rejects(importSkinPack(makeSkin('@keyframes hide-control { to { opacity: 0; } } [data-ws-part="voice.screen-player.exit"] { animation: hide-control 1s infinite; }')), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin('@keyframes hide-control { to { opacity: 0; } } [data-ws-part="control"] { animation: var(--custom-animation); }')), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="home"] { --accent: red; }')), (error: unknown) => error instanceof Error && error.message.includes("--skin- prefix"));
  await assert.rejects(importSkinPack(makeSkin(".internal-class { color: red; }")), (error: unknown) => error instanceof Error && error.message.includes("must use :root"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="demo.voice-card"].private-component { color: red; }')), (error: unknown) => error instanceof Error && error.message.includes("must use :root"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="home"] { background-image: image-set("https://example.invalid/remote.png" 1x); }')), (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_EXTERNAL_RESOURCE");
});

test("custom skins can override theme appearance without !important or private class selectors", () => {
  const css = '.ws-skin-root[data-ws-skin="builtin.dark"] .join-page .join-card { color: white; }';
  assert.equal(
    scopeBuiltinThemeForCustomSkin(css, "dark", "community.illusia-voice"),
    ':where(.ws-skin-root[data-ws-skin="community.illusia-voice"]) .join-page .join-card { color: white; }',
  );
});

test("community skins use a scoped light fallback instead of inheriting the night skin", async () => {
  const lightCss = await readFile(new URL("../skins/builtin/light/skin.css", import.meta.url), "utf8");
  const scoped = scopeBuiltinThemeForCustomSkin(lightCss, "light", "community.illusia-voice");
  assert.match(scoped, /:where\(\.ws-skin-root\[data-ws-skin="community\.illusia-voice"\]\) \{\s*color-scheme: light;/);
  assert.match(scoped, /:where\(\.ws-skin-root\[data-ws-skin="community\.illusia-voice"\]\) \.settings-content/);
});

test("all public skin parts are documented and the admin console is outside skin scope", async () => {
  const [webClient, demo, skinSwitcher, languageSwitcher, admin, documentation] = await Promise.all([
    readFile(new URL("../views/WebClient.vue", import.meta.url), "utf8"),
    readFile(new URL("../views/DemoView.vue", import.meta.url), "utf8"),
    readFile(new URL("../components/SkinSwitcher.vue", import.meta.url), "utf8"),
    readFile(new URL("../components/LanguageSwitcher.vue", import.meta.url), "utf8"),
    readFile(new URL("../views/AdminView.vue", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/SKIN_DEVELOPMENT.md", import.meta.url), "utf8"),
  ]);
  const publicParts = new Set([...`${webClient}\n${demo}\n${skinSwitcher}\n${languageSwitcher}`.matchAll(/data-ws-part="([^"]+)"/g)].map((match) => match[1]));
  for (const part of publicParts) assert.ok(documentation.includes(`\`${part}\``), `Undocumented skin part: ${part}`);
  assert.match(skinSwitcher, /data-ws-skin-id/);
  assert.match(skinSwitcher, /data-ws-state/);
  assert.match(languageSwitcher, /data-ws-language/);
  assert.doesNotMatch(admin, /ws-skin-root|data-ws-page=/);
  assert.doesNotMatch(demo, /:global\(:root\[data-theme="dark"\]\)/);
  assert.match(demo, /\.demo-page\[data-ws-skin="builtin\.dark"\]/);
});

test("public skin and language selectors keep readable light surfaces in dark mode", async () => {
  const [skinSwitcher, languageSwitcher, darkSkin] = await Promise.all([
    readFile(new URL("../components/SkinSwitcher.vue", import.meta.url), "utf8"),
    readFile(new URL("../components/LanguageSwitcher.vue", import.meta.url), "utf8"),
    readFile(new URL("../skins/builtin/dark/skin.css", import.meta.url), "utf8"),
  ]);

  assert.match(skinSwitcher, /\.skin-trigger\s*\{[^}]*background:\s*rgba\(250,\s*254,\s*255/i);
  assert.match(skinSwitcher, /\.skin-dropdown\s*\{[^}]*background:\s*linear-gradient/i);
  assert.match(skinSwitcher, /\.skin-option\s*\{[^}]*color:\s*#123849/i);
  assert.match(languageSwitcher, /\.language-dropdown\s*\{[^}]*background:\s*#fff/i);
  assert.doesNotMatch(darkSkin, /\.language-switcher\s+\.language-(?:trigger|dropdown|option)/);
});

test("skin content supports localized interface message overrides and includes the preview as an asset", async () => {
  const content = { defaultLocale: "en", locales: { en: { home: { title: "Welcome" }, messages: { speakingNow: "Live now" } } } };
  const skin = await importSkinPack(makeSkin('[data-ws-part="demo.voice-card"] { background: url(assets/preview.png); }', content));
  assert.equal(skin.contentData?.locales.en?.messages?.speakingNow, "Live now");
  assert.equal(skin.previewBlob?.type, "image/png");
  assert.ok(skin.assets["assets/preview.png"]);
});

test("the ILLUSIA visual-only example imports without replacing WebSpeak's base translations", async () => {
  const bytes = await readFile(new URL("../../../docs/examples/illusia-voice.wskin", import.meta.url));
  const skin = await importSkinPack(new File([bytes], "illusia-voice.wskin", { type: "application/octet-stream" }));
  assert.equal(skin.id, "community.illusia-voice");
  assert.equal(skin.name, "ILLUSIA风");
  assert.equal(skin.version, "1.0.25");
  assert.equal(skin.contentData, undefined);
  assert.equal(skin.previewBlob?.type, "image/webp");
  assert.ok(skin.assets["assets/background-composite.webp"]);
  assert.ok(skin.assets["assets/bg-room-main.webp"]);
  assert.ok(skin.assets["assets/banner-character-main.webp"]);
  assert.ok(skin.assets["assets/foreground-headphone.webp"]);
  assert.ok(skin.assets["assets/chat-empty-chibi.webp"]);
  assert.ok(skin.assets["assets/visitor-avatar.webp"]);
  assert.ok(skin.assets["assets/button-mascot.webp"]);
  assert.ok(skin.assets["assets/footer-wave.png"]);
  assert.match(skin.css, /\.ws-skin-root\[data-ws-skin="community\.illusia-voice"\]/);
  assert.match(skin.css, /home\.visitors.*?nth-child\(2\)/s);
  assert.match(skin.css, /skin\.menu/);
  assert.match(skin.css, /skin\.menu[^{}]*\[role="listbox"\]/);
  assert.match(skin.css, /skin\.option/);
  assert.match(skin.css, /language\.trigger/);
  assert.match(skin.css, /language\.menu[^{}]*\[role="listbox"\]/);
  assert.match(skin.css, /language\.option/);
  assert.match(skin.css, /data-ws-skin-id="community\.illusia-voice"/);
  assert.match(skin.css, /data-ws-part="home\.join-card\.waveform"/);
  assert.match(skin.css, /data-ws-part="home\.join-card\.sonar"/);
  assert.match(skin.css, /data-ws-part="home\.join-card"\]\s*\{[^}]*background-image:\s*url\("wskin-asset:assets%2Fbanner-mascot-blob\.webp"\)/s);
  assert.doesNotMatch(skin.css, /data-ws-part="home\.join-card"\]\s*\{[^}]*radial-gradient/s);
  assert.match(skin.css, /data-ws-part="voice\.member-panel"\]\s*\{[^}]*background-position:\s*0 0, right top, right top, center/s);
  assert.match(skin.css, /data-ws-part="voice\.member-panel"\]\s*::before\s*\{[^}]*background-image:\s*url\("wskin-asset:assets%2Fforeground-headphone\.webp"\)[^}]*filter:\s*drop-shadow/s);
  assert.doesNotMatch(skin.css, /illusia-card-signal|illusia-card-glow/);
  assert.match(skin.css, /illusia-home-aura/);
  assert.match(skin.css, /voice\.activity[\s\S]*?wskin-asset:assets%2Fbanner-character-main\.webp/);
  assert.match(skin.css, /voice\.activity\.artwork[\s\S]*?wskin-asset:assets%2Fbanner-character-main\.webp/);
  assert.match(skin.css, /data-ws-part="voice\.activity"\]\s*\{[^}]*border-color:\s*rgba\(113, 211, 222, \.62\);[^}]*border-radius:\s*24px;[^}]*background-image:[\s\S]*?bg-room-main\.webp[^}]*backdrop-filter:\s*blur\(10px\)/);
  assert.match(skin.css, /voice\.activity\.artwork[^{}]*\{[^}]*background-position:\s*right 34% center;[^}]*background-size:\s*auto 320px;[^}]*filter:\s*drop-shadow\(0 18px 22px/);
  assert.doesNotMatch(skin.css, /voice\.chat\.empty[^{}]*data-ws-state="messages-empty"\]\s*> :first-child/);
  assert.match(skin.css, /data-ws-part="voice\.channel-group"\]\s*\{[^}]*border-color:\s*rgba\(8, 126, 134, \.32\)/);
  assert.match(skin.css, /data-ws-part="voice\.channel-group"\]\[data-ws-state="current"\]\s*\{[^}]*border-color:\s*rgba\(8, 126, 134, \.48\)/);
  assert.match(skin.css, /voice\.chat\.empty[^{}]*data-ws-state="messages-empty"[\s\S]*?wskin-asset:assets%2Fchat-empty-chibi\.webp/);
  assert.match(skin.css, /voice\.chat\.empty[^{}]*\{[^}]*background-size:\s*22px 22px, 300px 250px, cover, min\(340px, 46vw\) auto/s);
  assert.match(skin.css, /voice\.chat\.empty[^{}]*data-ws-state="messages-empty"[^{}]*\{[^}]*background-position:\s*0 0, right center, center, center 8px;[^}]*background-size:\s*22px 22px, 300px 250px, cover, min\(340px, 46vw\) auto/s);
  assert.match(skin.css, /data-ws-state="messages-empty"\]::before\s*\{[^}]*color:\s*rgba\(71, 126, 148, \.9\);[^}]*radial-gradient\(circle, #527f91 0 1\.6px/s);
  assert.match(skin.css, /data-ws-state="messages-empty"\]::after\s*\{[^}]*color:\s*rgba\(71, 126, 148, \.9\)/s);
  assert.match(skin.css, /@media \(max-width: 1100px\)[\s\S]*?voice\.chat\.empty[^{}]*\{[^}]*background-position:\s*0 0, right 8px center, center, center 8px;[^}]*background-size:\s*22px 22px, 260px 220px, cover, min\(300px, 66vw\) auto/s);
  assert.match(skin.css, /@media \(max-width: 1100px\)[\s\S]*?voice\.chat\.empty[^{}]*data-ws-state="messages-empty"[^{}]*\{[^}]*background-position:\s*0 0, right center, center, center 8px;[^}]*background-size:\s*22px 22px, 260px 220px, cover, min\(300px, 66vw\) auto/s);
  assert.doesNotMatch(skin.css, /data-ws-state="messages-empty"[^{}]*\{[^}]*color: transparent/s);
  assert.doesNotMatch(skin.css, /(?:^|[;{\s])(?:position|inset|top|right|bottom|left|width|height|min-height|padding|z-index|transform)\s*:/);
  assert.doesNotMatch(skin.css, /\[data-ws-part="home\.join-card"\]\s*\{[^}]*animation:/);
  assert.doesNotMatch(skin.css, /\[data-ws-part="home\.join-card"\]\s*\{\s*animation: none;/);
  assert.match(skin.css, /home\.footer[\s\S]*?footer-wave\.png/);
  assert.match(skin.css, /\[data-ws-part="home"\] \[data-ws-part="home\.connect"\]/);
  assert.doesNotMatch(skin.css, /\[data-ws-page="home"\] \[data-ws-part="home\.connect"\]/);
  assert.match(skin.css, /home\.connect[\s\S]*?wskin-asset:assets%2Fbutton-mascot\.webp/);
  assert.match(skin.css, /data-ws-page="demo"[^{}]*\{[^}]*wskin-asset:assets%2Fforeground-headphone\.webp[^}]*background-position:\s*left bottom, center, center;[^}]*background-size:\s*min\(34vw, 430px\) auto, auto, cover/s);
  assert.match(skin.css, /voice\.screen-player[\s\S]*?background: linear-gradient\(135deg, rgba\(250, 255, 255, \.96\), rgba\(220, 245, 250, \.94\)\)/);
  assert.doesNotMatch(skin.css, /voice\.screen-player[^{}]*\{[^}]*background: rgba\(10, 34, 45, \.96\)/);
});

test("the activity artwork layer floats above room content without intercepting controls", async () => {
  const css = await readFile(new URL("../styles/web-client.css", import.meta.url), "utf8");
  assert.match(css, /\.app-shell \.workspace-content\s*\{\s*position: relative;\s*isolation: isolate;/);
  assert.match(css, /\.voice-activity-artwork\s*\{\s*position: absolute;\s*z-index: 2;\s*inset: -26px 0 -48px;[^}]*pointer-events: none;/);
  assert.match(css, /\.voice-activity-artwork\s*\{[^}]*transform: perspective\(1100px\) rotateY\(-2\.5deg\) translateZ\(22px\)/);
  assert.match(css, /\.app-shell \.member-panel::before\s*\{\s*content: "";\s*position: absolute;\s*z-index: 1;\s*left: -28px;\s*bottom: 18px;\s*width: min\(430px, calc\(100vw - 24px\)\);\s*aspect-ratio: 3 \/ 2;[^}]*perspective\(1100px\) rotateY\(-8deg\)/);
  assert.match(css, /\.app-shell \.chat-empty\[data-ws-state="messages-empty"\]\s*\{[^}]*min-height: 210px;\s*padding: 126px 12px 10px;/);
  assert.match(css, /\.app-shell \.chat-panel \.section-heading,[\s\S]*?\.app-shell \.chat-panel \.message-composer\s*\{\s*position: relative;\s*z-index: 3;/);
  assert.match(css, /\.screen-share-player\s*\{[^}]*background: var\(--surface-1\)/);
  assert.match(css, /\.screen-share-player-exit\s*\{[^}]*z-index: 3;/);
  assert.match(css, /\.screen-share-player-stage\s*\{[^}]*var\(--accent\)[^}]*var\(--surface-2\)/);
  assert.match(css, /\.screen-share-player-video\s*\{[^}]*background: var\(--surface-2\)/);
  assert.match(css, /@media \(min-width: 741px\)\s*\{\s*\/\* Keep header menus above the independently stacked screen-share stage\. \*\/\s*\.app-shell \.workspace-header\s*\{\s*position: relative;\s*z-index: 40;/);
});

test("channel empty state removes its bubble ornament and keeps the text-channel label", async () => {
  const [view, chat] = await Promise.all([
    readFile(new URL("../views/WebClient.vue", import.meta.url), "utf8"),
    readFile(new URL("../composables/useWebClientChat.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(view, /data-ws-state="messages-empty"><div class="chat-empty-icon"/);
  assert.match(view, /class="section-kicker">\{\{ chatTabLabel \}\}/);
  assert.match(chat, /tab\.value === "channel" \? t\("textChannel"\)/);
});

test("homepage motion and room content spacing preserve the ILLUSIA layout", async () => {
  const css = await readFile(new URL("../styles/web-client.css", import.meta.url), "utf8");
  assert.ok(css.includes('.join-page *:not([data-ws-part="home.join-card"])'));
  assert.ok(css.includes("animation: none !important"));
  assert.doesNotMatch(css, /\.join-page \*, \.join-page \*::before, \.join-page \*::after\s*\{\s*animation: none !important/);
  assert.ok(css.includes("padding: 0 clamp(12px, 1.4vw, 22px);"), "homepage header contents keep an inset from their container edge");
  assert.ok(css.includes(".chat-panel { margin-top: 34px; padding: 0 clamp(14px, 1.8vw, 24px) 20px;"), "chat children keep horizontal and bottom breathing room");
  assert.match(css, /\.app-shell \.voice-section \{\s*position: relative;\s*padding: clamp\(14px, 1\.8vw, 24px\);/);
  assert.match(css, /@media \(max-width: 740px\) \{\s*\.app-shell \.voice-section \{\s*padding: 14px 10px 16px;/);
  assert.match(css, /\.promise-list \{\s*display: grid;\s*width: 100%;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.promise-item \{\s*min-width: 0;\s*min-height: 58px;[\s\S]*?padding: 9px 11px;/);
  assert.match(css, /@media \(max-width: 420px\) \{\s*\.promise-list \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.join-card-waveform i \{[^}]*animation: screen-share-wave 1\.1s ease-in-out infinite alternate;/);
  assert.match(css, /@keyframes join-card-sonar-ring[\s\S]*?transform: scale\(\.6\); opacity: \.62;[\s\S]*?transform: scale\(1\); opacity: 0;/);
});

function makeSkin(css: string, content?: unknown): File {
  const packageFiles: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify({ ...manifest, ...(content ? { content: "content.json" } : {}), preview: "assets/preview.png" })),
    "skin.css": strToU8(css),
    "assets/backdrop.png": new Uint8Array([1, 2, 3, 4]),
    "assets/preview.png": new Uint8Array([5, 6, 7, 8]),
    "assets/wave.woff2": new Uint8Array([9, 10, 11, 12]),
  };
  if (content) packageFiles["content.json"] = strToU8(JSON.stringify(content));
  const bytes = zipSync(packageFiles);
  return new File([bytes.slice().buffer as ArrayBuffer], "skin.wskin", { type: "application/octet-stream" });
}
