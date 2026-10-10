import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { importSkinPack, resolveSkinCssAssets, SkinPackError } from "./skin-pack.js";
import { scopeBuiltinThemeForCustomSkin } from "./skin-cascade.js";
import type { SkinPluginDocument, SkinPluginNode } from "../../../src/shared/skin-plugin.js";
import { createSkinExtensionWasmPrefixByteImmediateProbe } from "../../test/skin-extension-wasm-fixture.js";

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
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { d\\69splay: none; }')), (error: unknown) => error instanceof Error && error.message.includes("must not change layout"));
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
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="home"] { background-image: u\\72l("https://example.invalid/escaped.png"); }')), (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_EXTERNAL_RESOURCE");
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="home"] { background-image: u\\72l(h\\74 tps\\3a //example.invalid/escaped-scheme.png); }')), (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_EXTERNAL_RESOURCE");
  await assert.rejects(importSkinPack(makeSkin('@font-face { font-family: "Local Font"; src: l\\6f cal("Arial"); } [data-ws-part="home"] { color: teal; }')), (error: unknown) => error instanceof Error && error.message.includes("local() is not allowed"));
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

async function componentSources(directory: string): Promise<string> {
  const componentRoot = new URL(directory, import.meta.url);
  const componentFiles = (await readdir(componentRoot, { recursive: true })).filter(path => path.endsWith(".vue"));
  return (await Promise.all(componentFiles.map(path => readFile(new URL(path.replaceAll("\\", "/"), componentRoot), "utf8")))).join("\n");
}

test("all public skin parts are documented and the admin console is outside skin scope", async () => {
  const [components, adminComponents] = await Promise.all([
    componentSources("../components/web-client/"), componentSources("../components/admin/"),
  ]);
  const [webClient, demo, skinSwitcher, languageSwitcher, admin, documentation] = await Promise.all([
    readFile(new URL("../views/WebClient.vue", import.meta.url), "utf8"),
    readFile(new URL("../views/DemoView.vue", import.meta.url), "utf8"),
    readFile(new URL("../components/SkinSwitcher.vue", import.meta.url), "utf8"),
    readFile(new URL("../components/LanguageSwitcher.vue", import.meta.url), "utf8"),
    readFile(new URL("../views/AdminView.vue", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/SKIN_DEVELOPMENT.md", import.meta.url), "utf8"),
  ]);
  const publicParts = new Set([...`${webClient}\n${components}\n${demo}\n${skinSwitcher}\n${languageSwitcher}`.matchAll(/data-ws-part="([^"]+)"/g)].map((match) => match[1]));
  for (const part of publicParts) assert.ok(documentation.includes(`\`${part}\``), `Undocumented skin part: ${part}`);
  assert.match(skinSwitcher, /data-ws-skin-id/);
  assert.match(skinSwitcher, /data-ws-state/);
  assert.match(languageSwitcher, /data-ws-language/);
  assert.doesNotMatch(`${admin}\n${adminComponents}`, /ws-skin-root|data-ws-page=/);
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

test("the ILLUSIA v3 example and bundled package import without replacing WebSpeak's base translations", async () => {
  const exampleBytes = await readFile(new URL("../../../docs/examples/illusia-voice.wskin", import.meta.url));
  const bundledBytes = await readFile(new URL("../../public/skins/illusia-voice.wskin", import.meta.url));
  assert.deepEqual(bundledBytes, exampleBytes);
  const skin = await importSkinPack(new File([exampleBytes], "illusia-voice.wskin", { type: "application/octet-stream" }));
  assert.equal(skin.id, "community.illusia-voice");
  assert.equal(skin.name, "ILLUSIA风");
  assert.equal(skin.version, "2.0.0");
  assert.equal(skin.schemaVersion, 3);
  assert.equal(skin.packageType, "open-skin");
  assert.equal(skin.layoutData, undefined);
  assert.equal(skin.pluginData?.components[0].id, "illusia-now-playing");
  assert.deepEqual(skin.pluginData?.components[0].permissions, ["session.status.read"]);
  assert.equal(skin.minAppVersion, "0.2.7-preview");
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
  assert.match(skin.css, /data-ws-part="voice\.favorite-servers\.rail"/);
  assert.match(skin.css, /data-ws-plugin-part="illusia-now-playing\.channel-name"/);
  assert.match(skin.css, /data-ws-part="home\.server-history\.item"/);
  assert.match(skin.css, /data-ws-part="home\.server-history\.favorite-toggle"\]\[data-ws-state="saved"\]/);
  assert.match(skin.css, /data-ws-part="voice\.favorite-servers\.favorite-toggle"\]\[data-ws-state="saved"\]/);
  assert.match(skin.css, /data-ws-part="voice\.favorite-servers\.strip\.favorite-toggle"\]\[data-ws-state="saved"\]/);
  assert.match(skin.css, /data-ws-part="voice\.favorite-servers\.strip\.server"\]\[data-ws-state="current"\]/);
  assert.match(skin.css, /data-ws-part="voice\.favorite-servers\.dialog"\]\s*\{[^}]*background:\s*linear-gradient/s);
  assert.match(skin.css, /data-ws-part="voice\.favorite-servers\.dialog\.input"\]:focus-visible\s*\{[^}]*box-shadow:/s);
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
  assert.match(skin.css, /voice\.activity\.artwork[^{}]*\{[^}]*background-position:\s*right 16px bottom 8px;[^}]*background-size:\s*auto 150px;[^}]*filter:\s*drop-shadow\(0 18px 22px/);
  assert.match(skin.css, /@media \(max-width: 1100px\)[\s\S]*?voice\.activity\.artwork[^{}]*\{[^}]*background-position:\s*right 12px bottom 6px;[^}]*background-size:\s*auto 118px/);
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
  assert.match(skin.css, /illusia-now-playing[^{}]*\{[^}]*position:\s*fixed/);
  assert.match(skin.css, /illusia-now-playing[^{}]*\{[^}]*background-image:[^;]*assets%2Fbanner-mascot-blob\.webp/);
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
  assert.match(css, /:deep\(\.app-shell \.member-panel::before\)\s*\{\s*content: "";\s*position: absolute;\s*z-index: 1;\s*left: -28px;\s*bottom: 18px;\s*width: min\(430px, calc\(100vw - 24px\)\);\s*aspect-ratio: 3 \/ 2;[^}]*perspective\(1100px\) rotateY\(-8deg\)/);
  assert.match(css, /:deep\(\.app-shell \.chat-empty\[data-ws-state="messages-empty"\]\)\s*\{[^}]*min-height: 210px;\s*padding: 126px 12px 10px;/);
  assert.match(css, /:deep\(\.app-shell \.chat-panel \.section-heading\),[\s\S]*?:deep\(\.app-shell \.chat-panel \.message-composer\)\s*\{\s*position: relative;\s*z-index: 3;/);
  assert.match(css, /\.screen-share-player\)?\s*\{[^}]*background: var\(--surface-1\)/);
  assert.match(css, /\.screen-share-player-exit\)?\s*\{[^}]*z-index: 3;/);
  assert.match(css, /\.screen-share-player-stage\)?\s*\{[^}]*var\(--accent\)[^}]*var\(--surface-2\)/);
  assert.match(css, /\.screen-share-player-video\)?\s*\{[^}]*background: var\(--surface-2\)/);
  assert.match(css, /@media \(min-width: 741px\)\s*\{\s*\/\* Keep header menus above the independently stacked screen-share stage\. \*\/\s*\.app-shell \.workspace-header\s*\{\s*position: relative;\s*z-index: 40;/);
});

test("channel empty state removes its bubble ornament and keeps the text-channel label", async () => {
  const [view, chat] = await Promise.all([
    readFile(new URL("../components/web-client/ChatPanel.vue", import.meta.url), "utf8"),
    readFile(new URL("../composables/useWebClientChat.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(view, /data-ws-state="messages-empty"><div class="chat-empty-icon"/);
  assert.match(view, /class="section-kicker">\{\{ chatTabLabel \}\}/);
  assert.match(chat, /tab\.value === "channel" \? t\("textChannel"\)/);
});

test("homepage motion and room content spacing preserve the ILLUSIA layout", async () => {
  const css = await readFile(new URL("../styles/web-client.css", import.meta.url), "utf8");
  assert.ok(css.includes('.join-page :deep(*:not([data-ws-part="home.join-card"]))'));
  assert.ok(css.includes("animation: none !important"));
  assert.doesNotMatch(css, /\.join-page \*, \.join-page \*::before, \.join-page \*::after\s*\{\s*animation: none !important/);
  assert.ok(css.includes("padding: 0 clamp(12px, 1.4vw, 22px);"), "homepage header contents keep an inset from their container edge");
  assert.match(css, /\.chat-panel\s*\{\s*margin-top: 34px;\s*padding: 0 clamp\(14px, 1\.8vw, 24px\) 20px;/, "chat children keep horizontal and bottom breathing room");
  assert.match(css, /\.app-shell \.voice-section \{\s*position: relative;\s*padding: clamp\(14px, 1\.8vw, 24px\);/);
  assert.match(css, /@media \(max-width: 740px\) \{\s*\.app-shell \.voice-section \{\s*padding: 14px 10px 16px;/);
  assert.match(css, /\.promise-list \{\s*display: grid;\s*width: 100%;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.promise-item \{\s*min-width: 0;\s*min-height: 58px;[\s\S]*?padding: 9px 11px;/);
  assert.match(css, /@media \(max-width: 420px\) \{\s*\.promise-list \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.join-card-waveform i \{[^}]*animation: screen-share-wave 1\.1s ease-in-out infinite alternate;/);
  assert.match(css, /@keyframes join-card-sonar-ring[\s\S]*?transform: scale\(\.6\);\s*opacity: \.62;[\s\S]*?transform: scale\(1\);\s*opacity: 0;/);
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

test("schema version 2 skin packages load only validated declarative layouts with no permissions", async () => {
  const layout = {
    schemaVersion: 1,
    pages: {
      home: { desktop: { "home.header": { x: 48, y: -12, scale: 1.1, background: "#123456" } } },
    },
  };
  const skin = await importSkinPack(makeSkinV2(layout));
  assert.equal(skin.schemaVersion, 2);
  assert.equal(skin.packageType, "layout-skin");
  assert.deepEqual(skin.permissions, []);
  assert.equal(skin.layoutData?.pages.home?.desktop?.["home.header"]?.x, 48);
  assert.equal(skin.layoutData?.pages.home?.desktop?.["home.header"]?.background, "#123456");

  await assert.rejects(
    importSkinPack(makeSkinV2(layout, { permissions: ["network.fetch"] })),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_PERMISSION_INVALID",
  );
  await assert.rejects(
    importSkinPack(makeSkinV2(layout, { capabilities: ["network.fetch"] })),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_MANIFEST_INVALID",
  );
  await assert.rejects(
    importSkinPack(makeSkinV2({ schemaVersion: 1, pages: { home: { desktop: { "home.unknown": { x: 4 } } } } })),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_LAYOUT_INVALID",
  );
  await assert.rejects(
    importSkinPack(makeSkinV2({ schemaVersion: 1, pages: { home: { desktop: { "home.security-note": { visible: false } } } } })),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_LAYOUT_INVALID",
  );
});

test("schema version 3 supports arbitrary public layouts and validated declarative plugin components", async () => {
  const components = {
    schemaVersion: 1,
    components: [{
      id: "channel-list",
      name: "Channel list",
      page: "voice",
      accessibleName: "TeamSpeak channels",
      permissions: ["session.channels.read", "session.channel.join"],
      actions: { join: { type: "voice.joinChannel", args: { channelId: "{{channel.id}}" } } },
      root: {
        tag: "nav",
        repeat: { path: "session.channels", as: "channel" },
        children: [{ tag: "button", part: "row", events: { dblclick: "join" }, children: [{ text: "{{channel.name}}" }] }],
      },
    }],
  };
  const skin = await importSkinPack(makeSkinV3(components, `
    [data-ws-part="voice.channel-group"] { display: none; }
    .channel-row[data-ws-plugin-part="channel-list.row"] { position: fixed; inset: 10px; width: 240px; order: 1; }
  `));
  assert.equal(skin.schemaVersion, 3);
  assert.equal(skin.packageType, "open-skin");
  assert.equal(skin.pluginData?.components[0].id, "channel-list");
  assert.equal(skin.pluginData?.components[0].root.children?.[0].events?.dblclick, "join");
  assert.match(skin.css, /position: fixed/);
  assert.match(skin.css, /display: none/);
  assert.ok(skin.warnings.some((warning) => warning.includes("hides an interface part")));

  const unsafe = structuredClone(components) as typeof components;
  unsafe.components[0].permissions = ["network.fetch"];
  await assert.rejects(importSkinPack(makeSkinV3(unsafe, "[data-ws-part=app] { color: red; }")), (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_PLUGIN_INVALID");
  await assert.rejects(importSkinPack(makeSkinV3({ schemaVersion: 1, components: [] }, "[data-ws-part=app] { color: red; }")), (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_PLUGIN_INVALID");
  const missingAsset = structuredClone(components) as unknown as SkinPluginDocument;
  missingAsset.components[0].root = { tag: "img", asset: "assets/missing.webp" };
  await assert.rejects(importSkinPack(makeSkinV3(missingAsset, "[data-ws-part=app] { color: red; }")), (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_PLUGIN_ASSET_INVALID");
});

test("schema version 3 permits an open visual skin without a components document", async () => {
  const bytes = zipSync({
    "manifest.json": strToU8(JSON.stringify({ ...manifest, schemaVersion: 3, packageType: "open-skin" })),
    "skin.css": strToU8('[data-ws-part="app"] { position: fixed; }'),
  });
  const skin = await importSkinPack(new File([bytes.slice().buffer as ArrayBuffer], "v3-visual-only.wskin"));
  assert.equal(skin.schemaVersion, 3);
  assert.equal(skin.pluginData, undefined);
  assert.match(skin.css, /position: fixed/);
});

test("schema version 3 accepts a schema v2 full-page surface with host widgets", async () => {
  const components = {
    schemaVersion: 2,
    components: [{
      id: "custom-voice-surface",
      name: "Custom voice surface",
      page: "voice",
      mode: "surface",
      accessibleName: "Custom voice workspace",
      permissions: ["ui.surface.replace"],
      actions: {},
      root: {
        tag: "main",
        className: "custom-workspace",
        children: [
          { widget: "voice.channel-panel" },
          { widget: "voice.member-cards" },
          { widget: "voice.chat-panel" },
          { widget: "voice.audio-controls" },
        ],
      },
    }],
  };
  const skin = await importSkinPack(makeSkinV3(components, '[data-ws-part="app"] { --skin-surface: #123456; }'));
  assert.equal(skin.pluginData?.schemaVersion, 2);
  assert.equal(skin.pluginData?.components[0].mode, "surface");
  assert.deepEqual(skin.pluginData?.components[0].root.children?.map((node) => node.widget), [
    "voice.channel-panel", "voice.member-cards", "voice.chat-panel", "voice.audio-controls",
  ]);
});

test("schema version 4 validates and caches isolated plugin package files without executing them", async () => {
  const defaultLayout = {
    schemaVersion: 1,
    pages: { voice: { desktop: { "skin.voice.runtime_plugin_root_voice-toolbar": { order: 2, visible: true } } } },
  };
  const skin = await importSkinPack(makeSkinV4(undefined, { layout: defaultLayout }));
  const entry = "plugins/voice-toolbar/index.js";
  const style = "plugins/voice-toolbar/style.css";
  const icon = "plugins/voice-toolbar/assets/icon.png";
  assert.equal(skin.schemaVersion, 4);
  assert.equal(skin.packageType, "open-skin");
  assert.equal(skin.runtimePlugins?.plugins[0].id, "voice-toolbar");
  assert.equal(await skin.runtimePluginFiles?.[entry].text(), "export const render = () => document.createElement('button');");
  assert.equal(await skin.runtimePluginFiles?.[style].text(), ".toolbar { color: teal; }");
  assert.equal(skin.runtimePluginFiles?.[icon].type, "image/png");
  assert.equal(skin.assets[icon]?.type, "image/png", "declared plugin media is available only by its package path for scoped CSS and host remapping");
  assert.match(skin.runtimePluginStyles?.["voice-toolbar"] ?? "", /data-ws-runtime-plugin="voice-toolbar".*?\.toolbar/s);
  assert.match(skin.runtimePluginStyles?.["voice-toolbar"] ?? "", /color: teal/);
  assert.match(skin.css, /position: fixed/);
  assert.deepEqual(skin.layoutData?.pages.voice?.desktop?.["skin.voice.runtime_plugin_root_voice-toolbar"], { order: 2, visible: true });

  await assert.rejects(
    importSkinPack(makeSkinV4(undefined, { includeEntry: false })),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_RUNTIME_PLUGIN_FILE_MISSING",
  );
  await assert.rejects(
    importSkinPack(makeSkinV4(undefined, { extra: { "plugins/unlisted/rogue.js": strToU8("export {};") } })),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_FILE_UNSUPPORTED",
  );
  await assert.rejects(
    importSkinPack(makeSkinV4(undefined, { entryBytes: new Uint8Array(256 * 1024 + 1) })),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_RUNTIME_PLUGIN_SOURCE_SIZE",
  );
});

test("a v4 surface cannot compete with a v3 surface on the same public page", async () => {
  const components = {
    schemaVersion: 2,
    components: [{
      id: "voice-v3-surface",
      name: "Voice v3 surface",
      page: "voice",
      mode: "surface",
      accessibleName: "Voice workspace",
      permissions: ["ui.surface.replace"],
      actions: {},
      root: { tag: "main", children: [{ tag: "p", children: [{ text: "replacement UI" }] }] },
    }],
  };
  const plugins = {
    schemaVersion: 1,
    plugins: [{
      id: "voice-v4-surface",
      name: "Voice v4 surface",
      version: "1.0.0",
      apiVersion: 1,
      runtime: "wasm",
      page: "voice",
      mode: "surface",
      entry: "plugins/voice-v4-surface/index.wasm",
      assets: [],
      permissions: ["ui.surface.replace"],
    }],
  };
  const files = {
    "manifest.json": strToU8(JSON.stringify({ ...manifest, schemaVersion: 4, packageType: "open-skin", components: "components.json", plugins: "plugins.json" })),
    "skin.css": strToU8('[data-ws-part="app"] { color: teal; }'),
    "components.json": strToU8(JSON.stringify(components)),
    "plugins.json": strToU8(JSON.stringify(plugins)),
    "plugins/voice-v4-surface/index.wasm": createSkinExtensionWasmPrefixByteImmediateProbe(),
  };
  const archive = zipSync(files);
  await assert.rejects(
    importSkinPack(new File([archive.slice().buffer as ArrayBuffer], "competing-surfaces.wskin")),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_PLUGIN_SURFACE_DUPLICATE",
  );
});

test("the distributable KAAK v3 package validates end to end", async () => {
  const archive = await readFile(new URL("../../../docs/examples/kaak-voice.wskin", import.meta.url));
  const file = new File([archive], "kaak-voice.wskin", { type: "application/octet-stream" });
  const skin = await importSkinPack(file);
  assert.equal(skin.id, "community.kaak-voice");
  assert.equal(skin.schemaVersion, 3);
  assert.deepEqual(skin.pluginData?.components.map((component) => component.id), ["kaak-channel-sidebar", "kaak-members-sidebar"]);
  assert.equal(skin.pluginData?.components[0].root.children?.[1].children?.[0].children?.[0].events?.dblclick, "join-channel");
  assert.ok(skin.pluginData?.components[0].permissions.includes("session.members.read"));
  assert.equal(skin.pluginData?.components[0].root.children?.[1].children?.[0].children?.[1].children?.[0].repeat?.path, "channel.members");
  assert.ok(skin.css.includes('data-ws-plugin-part="kaak-channel-sidebar.channel-row"'));
  assert.ok(skin.css.includes('data-ws-plugin-part="kaak-channel-sidebar.channel-members"'));
  assert.ok(skin.css.includes('data-ws-plugin-part="kaak-members-sidebar.member-row-content"'));
});

test("v4 skin packages validate Wasm entry ABI and cache it as application/wasm", async () => {
  const wasmPlugin = {
    schemaVersion: 1,
    plugins: [{
      id: "voice-toolbar",
      name: "Voice toolbar",
      version: "1.0.0",
      apiVersion: 1,
      runtime: "wasm",
      page: "voice",
      mode: "widget",
      entry: "plugins/voice-toolbar/index.wasm",
      style: "plugins/voice-toolbar/style.css",
      assets: ["plugins/voice-toolbar/assets/icon.png"],
      permissions: [],
    }],
  };
  const skin = await importSkinPack(makeSkinV4(wasmPlugin, {
    entryPath: "plugins/voice-toolbar/index.wasm",
    entryBytes: createSkinExtensionWasmPrefixByteImmediateProbe(),
  }));
  assert.equal(skin.runtimePlugins?.plugins[0].runtime, "wasm");
  assert.equal(skin.runtimePluginFiles?.["plugins/voice-toolbar/index.wasm"]?.type, "application/wasm");

  await assert.rejects(
    importSkinPack(makeSkinV4(wasmPlugin, {
      entryPath: "plugins/voice-toolbar/index.wasm",
      entryBytes: new Uint8Array([0, 1, 2, 3]),
    })),
    (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_RUNTIME_PLUGIN_WASM_INVALID",
  );
});

test("the full voice surface example packages home, voice, and host-owned controls", async () => {
  const archive = await readFile(new URL("../../../docs/examples/open-voice-surface.wskin", import.meta.url));
  const file = new File([archive], "open-voice-surface.wskin", { type: "application/octet-stream" });
  const skin = await importSkinPack(file);
  assert.equal(skin.id, "community.open-voice-surface");
  assert.equal(skin.pluginData?.schemaVersion, 2);
  assert.deepEqual(skin.pluginData?.components.map((component) => [component.page, component.mode]), [
    ["home", "surface"], ["voice", "surface"],
  ]);
  const voiceSurface = skin.pluginData?.components.find((component) => component.page === "voice");
  assert.ok(voiceSurface?.permissions.includes("ui.surface.replace"));
  assert.ok(voiceSurface?.permissions.includes("servers.quickList.read"));
  assert.ok(voiceSurface?.permissions.includes("servers.quickList.switch"));
  assert.ok(voiceSurface?.permissions.includes("session.channels.read"));
  assert.ok(voiceSurface?.permissions.includes("session.members.read"));
  assert.ok(skin.css.includes("@media (max-width: 800px)"));
});

test("the Harbor voice skin imports a complete voice-only KOOK-inspired workspace", async () => {
  const archive = await readFile(new URL("../../../docs/examples/harbor-voice.wskin", import.meta.url));
  const file = new File([archive], "harbor-voice.wskin", { type: "application/octet-stream" });
  const skin = await importSkinPack(file);
  assert.equal(skin.id, "community.harbor-voice");
  assert.equal(skin.pluginData?.schemaVersion, 3);
  assert.deepEqual(skin.pluginData?.components.map((component) => [component.page, component.mode]), [
    ["home", "surface"], ["voice", "surface"],
  ]);
  const voiceSurface = skin.pluginData?.components.find((component) => component.page === "voice");
  assert.ok(voiceSurface?.permissions.includes("session.channel.join"));
  assert.ok(voiceSurface?.permissions.includes("servers.quickList.switch"));
  assert.ok(voiceSurface?.permissions.includes("session.members.read"));
  assert.ok(voiceSurface?.permissions.includes("chat.channel.read"));
  assert.ok(voiceSurface?.permissions.includes("chat.channel.send"));
  assert.ok(voiceSurface?.permissions.includes("audio.microphone.control"));
  assert.ok(voiceSurface?.permissions.includes("audio.output.control"));
  assert.ok(voiceSurface?.permissions.includes("voice.screenShare.control"));
  function findPart(node: SkinPluginNode | undefined, part: string): SkinPluginNode | undefined {
    if (!node) return undefined;
    if (node.part === part) return node;
    for (const child of node.children ?? []) {
      const found = findPart(child, part);
      if (found) return found;
    }
    return undefined;
  }
  const channelRow = findPart(voiceSurface?.root, "channel-row");
  assert.equal(channelRow?.events?.click, "select-channel", "single-click only selects a channel in this skin");
  assert.equal(channelRow?.events?.dblclick, "join-channel", "channel switching follows TeamSpeak's double-click join behavior");
  assert.equal(channelRow?.attributes?.["data-depth"], "{{channel.depth}}", "the channel hierarchy is represented without a new host API");
  assert.equal(findPart(channelRow, "selected-channel-indicator")?.when?.equals, "{{channel.id}}");
  const identityEntry = findPart(voiceSurface?.root, "identity-entry");
  assert.equal(identityEntry?.attributes?.role, "group");
  assert.equal(identityEntry?.when?.path, "session.status.userName");
  assert.equal(findPart(identityEntry, "identity-name")?.children?.[0]?.text, "{{session.status.userName}}");
  const channelVoiceMembers = findPart(voiceSurface?.root, "channel-voice-members");
  assert.equal(channelVoiceMembers?.when?.path, "channel.current");
  assert.equal(findPart(channelVoiceMembers, "channel-voice-member")?.repeat?.path, "channel.members");
  assert.equal(findPart(channelVoiceMembers, "channel-member-muted")?.when?.path, "voicemember.status");
  assert.equal(findPart(voiceSurface?.root, "member-away-state")?.when?.path, "member.status");
  const voiceDockActions = findPart(voiceSurface?.root, "voice-dock-actions");
  assert.equal(findPart(voiceDockActions, "screen-share-start")?.widget, "voice.screen-share-start");
  assert.equal(findPart(voiceDockActions, "audio-controls")?.widget, "voice.audio-controls");
  assert.equal(findPart(voiceDockActions, "disconnect-control")?.events?.click, "disconnect");
  const chat = findPart(voiceSurface?.root, "chat");
  assert.equal(findPart(chat, "chat-message")?.repeat?.path, "chat.messages");
  assert.equal(findPart(chat, "chat-composer")?.events?.submit, "send-message");
  assert.equal(findPart(chat, "chat-input")?.bindValue, "message");
  assert.equal(findPart(chat, "chat-empty")?.when?.empty, true);
  assert.equal(findPart(voiceSurface?.root, "whisper-start")?.events?.click, "whisper-on");
  assert.ok(skin.css.includes("@media (max-width: 820px)"));
  assert.ok(skin.css.includes('[data-ws-plugin-part="harbor-workspace.channel-row"][data-depth="1"]'));
  assert.ok(skin.css.includes('[data-ws-plugin-part="harbor-workspace.identity-entry"]'));
  assert.ok(skin.css.includes('data-ws-plugin-part="harbor-workspace.screen-share-start"'), "the host screen-share control uses the stable plugin part hook");
  assert.ok(skin.css.includes(".accompaniment-toggle { display: none; }"));
  assert.ok(!skin.css.includes("https://"), "the skin uses no remote artwork or font resources");
});

function makeSkinV2(layout: unknown, manifestChanges: Record<string, unknown> = {}): File {
  const packageFiles: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify({
      ...manifest,
      schemaVersion: 2,
      packageType: "layout-skin",
      layout: "layout.json",
      permissions: [],
      ...manifestChanges,
    })),
    "skin.css": strToU8('[data-ws-part="home.header"] { color: #123456; }'),
    "layout.json": strToU8(JSON.stringify(layout)),
  };
  const bytes = zipSync(packageFiles);
  return new File([bytes.slice().buffer as ArrayBuffer], "skin-v2.wskin", { type: "application/octet-stream" });
}

function makeSkinV3(components: unknown, css: string, assets: Record<string, Uint8Array> = {}): File {
  const packageFiles: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify({ ...manifest, schemaVersion: 3, packageType: "open-skin", components: "components.json" })),
    "skin.css": strToU8(css),
    "components.json": strToU8(JSON.stringify(components)),
    ...assets,
  };
  const bytes = zipSync(packageFiles);
  return new File([bytes.slice().buffer as ArrayBuffer], "skin-v3.wskin", { type: "application/octet-stream" });
}

function makeSkinV4(
  pluginDocument: unknown = {
    schemaVersion: 1,
    plugins: [{
      id: "voice-toolbar",
      name: "Voice toolbar",
      version: "1.0.0",
      apiVersion: 1,
      page: "voice",
      mode: "widget",
      entry: "plugins/voice-toolbar/index.js",
      style: "plugins/voice-toolbar/style.css",
      assets: ["plugins/voice-toolbar/assets/icon.png"],
      permissions: ["session.channels.read"],
    }],
  },
  options: { includeEntry?: boolean; entryBytes?: Uint8Array; entryPath?: string; layout?: unknown; extra?: Record<string, Uint8Array> } = {},
): File {
  const packageFiles: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify({ ...manifest, schemaVersion: 4, packageType: "open-skin", plugins: "plugins.json", ...(options.layout ? { layout: "layout.json" } : {}) })),
    "skin.css": strToU8('[data-ws-part="app"] { position: fixed; color: teal; }'),
    "plugins.json": strToU8(JSON.stringify(pluginDocument)),
    ...(options.layout ? { "layout.json": strToU8(JSON.stringify(options.layout)) } : {}),
    "plugins/voice-toolbar/style.css": strToU8(".toolbar { color: teal; }"),
    "plugins/voice-toolbar/assets/icon.png": new Uint8Array([1, 2, 3, 4]),
    ...options.extra,
  };
  const entryPath = options.entryPath ?? "plugins/voice-toolbar/index.js";
  if (options.includeEntry !== false) packageFiles[entryPath] = options.entryBytes ?? strToU8("export const render = () => document.createElement('button');");
  const bytes = zipSync(packageFiles);
  return new File([bytes.slice().buffer as ArrayBuffer], "skin-v4.wskin", { type: "application/octet-stream" });
}
