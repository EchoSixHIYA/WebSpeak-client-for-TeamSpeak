import assert from "node:assert/strict";
import test from "node:test";
import { createSkinPluginAssetUrlCache } from "./skin-plugin-asset-urls.js";

test("plugin asset URLs are reused only for the same Blob and released on replacement or skin change", () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = () => {
    const url = `blob:skin-test-${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => { revoked.push(url); };

  try {
    const cache = createSkinPluginAssetUrlCache();
    const path = "assets/icon.png";
    const firstAsset = new Blob(["first skin"]);
    const secondAsset = new Blob(["second skin"]);

    const firstUrl = cache.resolve(path, { [path]: firstAsset });
    assert.equal(firstUrl, "blob:skin-test-1");
    assert.equal(cache.resolve(path, { [path]: firstAsset }), firstUrl);
    assert.equal(cache.size, 1);

    const secondUrl = cache.resolve(path, { [path]: secondAsset });
    assert.equal(secondUrl, "blob:skin-test-2");
    assert.deepEqual(revoked, [firstUrl]);
    assert.equal(cache.size, 1);

    cache.clear();
    assert.deepEqual(revoked, [firstUrl, secondUrl]);
    assert.equal(cache.size, 0);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("a missing plugin asset releases a cached URL instead of returning stale artwork", () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.createObjectURL = () => "blob:skin-test";
  URL.revokeObjectURL = (url) => { revoked.push(url); };

  try {
    const cache = createSkinPluginAssetUrlCache();
    const path = "assets/icon.png";
    cache.resolve(path, { [path]: new Blob(["old"]) });
    assert.equal(cache.resolve(path, {}), undefined);
    assert.deepEqual(revoked, ["blob:skin-test"]);
    assert.equal(cache.size, 0);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
