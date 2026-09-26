import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_SKIN_CATALOG,
  getPublicDefaultSkinId,
  isPublicSkinEnabled,
  listPublicSkins,
} from "./skin-catalog.js";

test("skin catalog always includes the three protected built-ins and exposes only enabled custom skins", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    defaultSkinId: "sample-skin",
    skins: [
      { id: "sample-skin", name: "Sample", version: "1.0.0", author: "Test", license: "MIT", minAppVersion: "0.2.5-preview", installedAt: 1, enabled: true },
      { id: "disabled-skin", name: "Disabled", version: "1.0.0", author: "Test", license: "MIT", minAppVersion: "0.2.5-preview", installedAt: 2, enabled: false },
      { id: "community.illusia-voice", name: "Spoofed", version: "9.9.9", author: "Other", license: "MIT", minAppVersion: "0.0.1", installedAt: 3 },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const skins = await listPublicSkins();
    assert.deepEqual(skins.map((skin) => skin.id), [
      "builtin.light",
      "builtin.dark",
      "community.illusia-voice",
      "sample-skin",
    ]);
    assert.deepEqual(BUILTIN_SKIN_CATALOG.map((skin) => skin.id), skins.slice(0, 3).map((skin) => skin.id));
    assert.equal(getPublicDefaultSkinId(), "sample-skin");
    assert.equal(isPublicSkinEnabled("sample-skin"), true);
    assert.equal(isPublicSkinEnabled("disabled-skin"), false);
    assert.equal(isPublicSkinEnabled("community.illusia-voice"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid or disabled instance defaults safely fall back to the protected day skin", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    defaultSkinId: "disabled-skin",
    skins: [{ id: "disabled-skin", name: "Disabled", version: "1.0.0", author: "Test", license: "MIT", minAppVersion: "0.2.5-preview", installedAt: 2, enabled: false }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const skins = await listPublicSkins();
    assert.equal(skins.length, 3);
    assert.equal(getPublicDefaultSkinId(), "builtin.light");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
