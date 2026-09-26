import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { importSkinPack, resolveSkinCssAssets, SkinPackError } from "./skin-pack.js";

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
    :root { --accent: #00a99d; }
    .voice-card { font-family: "Wave Font", sans-serif; animation: shimmer 1s ease-in-out; background-image: image-set("assets/backdrop.png" 1x); }
  `));

  assert.match(skin.css, /\.ws-skin-root\[data-ws-skin="ocean-night"\] \{ --accent: #00a99d; \}/);
  assert.match(skin.css, /@keyframes ws-ocean-night-shimmer/);
  assert.match(skin.css, /animation: ws-ocean-night-shimmer/);
  assert.match(skin.css, /font-family: "ws-ocean-night-Wave-Font"/);
  assert.match(skin.css, /url\("wskin-asset:assets%2Fwave\.woff2"\)/);
  assert.match(skin.css, /image-set\("wskin-asset:assets%2Fbackdrop\.png" 1x\)/);

  const resolved = resolveSkinCssAssets(skin.css, skin.assets);
  assert.match(resolved.css, /blob:/);
  resolved.objectUrls.forEach((url) => URL.revokeObjectURL(url));
});

test("skin CSS permits hiding explicitly optional decoration while protecting controls and containers", async () => {
  const skin = await importSkinPack(makeSkin('@keyframes fade-wave { from { opacity: 0; } to { opacity: 1; } } [data-ws-part="demo.wave"] { display: none !important; opacity: var(--decorative-opacity); all: unset; animation: fade-wave 1s; }'));
  assert.match(skin.css, /display: none !important/);
  assert.match(skin.css, /opacity: var\(--decorative-opacity\)/);
  assert.match(skin.css, /all: unset/);
  assert.match(skin.css, /from \{ opacity: 0; \}/);
  assert.match(skin.css, /animation: ws-ocean-night-fade-wave 1s/);

  await assert.rejects(importSkinPack(makeSkin(".required { display: none; }")), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { opacity: 0; }')), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="demo.wave"] .child { display: none; }')), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { display: var(--hidden); }')), (error: unknown) => error instanceof Error && error.message.includes("indirect values"));
  await assert.rejects(importSkinPack(makeSkin('[data-ws-part="voice.screen-player.exit"] { all: unset; }')), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin('@keyframes hide-control { to { opacity: 0; } } [data-ws-part="voice.screen-player.exit"] { animation: hide-control 1s infinite; }')), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin('@keyframes hide-control { to { opacity: 0; } } [data-ws-part="control"] { animation: var(--custom-animation); }')), (error: unknown) => error instanceof Error && error.message.includes("explicitly optional visual parts"));
  await assert.rejects(importSkinPack(makeSkin(".art { background-image: image-set(\"https://example.invalid/remote.png\" 1x); }")), (error: unknown) => error instanceof SkinPackError && error.code === "SKIN_EXTERNAL_RESOURCE");
});

test("all public skin parts are documented and the admin console is outside skin scope", async () => {
  const [webClient, demo, admin, documentation] = await Promise.all([
    readFile(new URL("../views/WebClient.vue", import.meta.url), "utf8"),
    readFile(new URL("../views/DemoView.vue", import.meta.url), "utf8"),
    readFile(new URL("../views/AdminView.vue", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/SKIN_DEVELOPMENT.md", import.meta.url), "utf8"),
  ]);
  const publicParts = new Set([...`${webClient}\n${demo}`.matchAll(/data-ws-part="([^"]+)"/g)].map((match) => match[1]));
  for (const part of publicParts) assert.ok(documentation.includes(`\`${part}\``), `Undocumented skin part: ${part}`);
  assert.doesNotMatch(admin, /ws-skin-root|data-ws-page=/);
});

test("skin content supports localized interface message overrides and includes the preview as an asset", async () => {
  const content = { defaultLocale: "en", locales: { en: { home: { title: "Welcome" }, messages: { speakingNow: "Live now" } } } };
  const skin = await importSkinPack(makeSkin(".voice-card { background: url(assets/preview.png); }", content));
  assert.equal(skin.contentData?.locales.en?.messages?.speakingNow, "Live now");
  assert.equal(skin.previewBlob?.type, "image/png");
  assert.ok(skin.assets["assets/preview.png"]);
});

test("the documented Aurora Voice example package imports with its artwork and localized copy", async () => {
  const bytes = await readFile(new URL("../../../docs/examples/aurora-voice.wskin", import.meta.url));
  const skin = await importSkinPack(new File([bytes], "aurora-voice.wskin", { type: "application/octet-stream" }));
  assert.equal(skin.id, "community.aurora-voice");
  assert.equal(skin.contentData?.locales["zh-CN"]?.home?.title, "自在");
  assert.equal(skin.contentData?.locales.en?.messages?.["demo.heroLead"], "This demo is styled by the same package as the connection and voice pages.");
  assert.equal(skin.previewBlob?.type, "image/jpeg");
  assert.match(skin.css, /\.ws-skin-root\[data-ws-skin="community\.aurora-voice"\]/);
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
