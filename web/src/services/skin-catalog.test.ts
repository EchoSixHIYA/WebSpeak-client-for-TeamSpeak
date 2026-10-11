import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BUILTIN_SKIN_CATALOG,
  getPublicDefaultSkinId,
  isPublicSkinEnabled,
  listPublicSkins,
} from "./skin-catalog.js";

test("built-in appearance manifests and catalog versions match the bundled share treatments", async () => {
  const [lightManifestText, darkManifestText, lightCss, darkCss] = await Promise.all([
    readFile(new URL("../skins/builtin/light/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../skins/builtin/dark/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../skins/builtin/light/skin.css", import.meta.url), "utf8"),
    readFile(new URL("../skins/builtin/dark/skin.css", import.meta.url), "utf8"),
  ]);
  const lightManifest = JSON.parse(lightManifestText) as { id: string; version: string };
  const darkManifest = JSON.parse(darkManifestText) as { id: string; version: string };

  for (const manifest of [lightManifest, darkManifest]) {
    assert.equal(BUILTIN_SKIN_CATALOG.find((skin) => skin.id === manifest.id)?.version, manifest.version);
  }
  assert.equal(lightManifest.version, "1.0.1");
  assert.equal(darkManifest.version, "1.0.1");
  assert.match(lightCss, /\.screen-share-live-indicator\s*\{[^}]*background:/s);
  assert.match(lightCss, /\.screen-share-card-button\.viewing\s*\{[^}]*background:/s);
  assert.match(darkCss, /\.screen-share-live-indicator\s*\{[^}]*background:/s);
  assert.match(darkCss, /\.screen-share-card-button\.viewing\s*\{[^}]*background:/s);
});

test("skin catalog always includes protected built-ins and exposes only enabled custom skins", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    defaultSkinId: "sample-skin",
    skins: [
      { id: "sample-skin", name: "Sample", version: "1.0.0", author: "Test", license: "MIT", minAppVersion: "0.2.6", installedAt: 1, enabled: true },
      { id: "disabled-skin", name: "Disabled", version: "1.0.0", author: "Test", license: "MIT", minAppVersion: "0.2.6", installedAt: 2, enabled: false },
      { id: "community.illusia-voice", name: "Spoofed", version: "9.9.9", author: "Other", license: "MIT", minAppVersion: "0.0.1", installedAt: 3 },
      { id: "community.kaak-voice", name: "Spoofed KAAK", version: "9.9.9", author: "Other", license: "MIT", minAppVersion: "0.0.1", installedAt: 4 },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const skins = await listPublicSkins();
    assert.deepEqual(skins.map((skin) => skin.id), [
      "builtin.light",
      "builtin.dark",
      "community.illusia-voice",
      "community.kaak-voice",
      "sample-skin",
    ]);
    assert.deepEqual(BUILTIN_SKIN_CATALOG.map((skin) => skin.id), skins.slice(0, 4).map((skin) => skin.id));
    assert.equal(getPublicDefaultSkinId(), "sample-skin");
    assert.equal(isPublicSkinEnabled("sample-skin"), true);
    assert.equal(isPublicSkinEnabled("disabled-skin"), false);
    assert.equal(isPublicSkinEnabled("community.illusia-voice"), true);
    assert.equal(isPublicSkinEnabled("community.kaak-voice"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid or disabled instance defaults safely fall back to the protected day skin", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    defaultSkinId: "disabled-skin",
    skins: [{ id: "disabled-skin", name: "Disabled", version: "1.0.0", author: "Test", license: "MIT", minAppVersion: "0.2.6", installedAt: 2, enabled: false }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const skins = await listPublicSkins();
    assert.equal(skins.length, 4);
    assert.equal(getPublicDefaultSkinId(), "builtin.light");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
