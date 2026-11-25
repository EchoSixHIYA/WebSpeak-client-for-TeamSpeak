import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, isNewerVersion, isValidVersion, parseReleaseTag, parseStableVersion } from "./version.js";

test("stable versions require exactly three numeric segments", () => {
  assert.deepEqual(parseStableVersion(" 01.002.0003 "), { major: 1, minor: 2, patch: 3, text: "1.2.3" });
  for (const value of ["1.2", "1.2.3-beta", "v1.2.3", "1.2.3.4", "", null, 1.2]) {
    assert.equal(parseStableVersion(value), null);
  }
});

test("release tags accept only the v-prefixed stable shape", () => {
  assert.equal(parseReleaseTag("v0.3.2")?.text, "0.3.2");
  assert.equal(parseReleaseTag("0.3.2"), null);
  assert.equal(parseReleaseTag("v0.3.2-rc.1"), null);
  assert.equal(parseReleaseTag("vv0.3.2"), null);
});

test("version comparison and newer checks are numeric", () => {
  assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
  assert.ok(compareVersions("1.0.0", "1.0.0") === 0);
  assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
  assert.equal(isNewerVersion("0.3.3", "0.3.2"), true);
  assert.equal(isNewerVersion("0.3.2", "0.3.2"), false);
  assert.equal(isNewerVersion("not-a-version", "0.3.2"), false);
  assert.equal(isValidVersion("2.0.0"), true);
  assert.equal(isValidVersion("2.0"), false);
});
