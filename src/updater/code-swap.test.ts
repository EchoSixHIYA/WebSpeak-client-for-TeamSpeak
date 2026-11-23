import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CodeSwapError, locatePackageRoot, restoreCode, swapCode, validateStagedPackage,
} from "./code-swap.js";
import { createPackageFiles } from "./test-support.js";

function workspace(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-swap-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function packageInvalid(error: unknown): boolean {
  return error instanceof CodeSwapError && error.code === "UPDATE_PACKAGE_INVALID";
}

function persistentState(root: string): void {
  writeFileSync(path.join(root, "config.json"), JSON.stringify({ siteName: "kept" }));
  for (const [directory, file] of [["data", "webspeak.db"], ["certs", "cert.pem"], ["skins", "skin.json"], ["plugins", "plugin.json"]]) {
    mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(path.join(root, directory, file), `${directory}-content`);
  }
}

test("staged packages must be complete, regular files and version-matched", t => {
  const root = workspace(t);
  createPackageFiles(root, "0.4.0");
  assert.doesNotThrow(() => validateStagedPackage(root, { version: "0.4.0", platform: "linux" }));
  assert.throws(() => validateStagedPackage(root, { version: "0.4.1", platform: "linux" }), packageInvalid);

  const missing = workspace(t);
  createPackageFiles(missing, "0.4.0");
  rmSync(path.join(missing, "runtime", "node"));
  assert.throws(() => validateStagedPackage(missing, { version: "0.4.0", platform: "linux" }), packageInvalid);

  const linked = workspace(t);
  createPackageFiles(linked, "0.4.0");
  rmSync(path.join(linked, "runtime", "node"));
  symlinkSync(process.execPath, path.join(linked, "runtime", "node"));
  assert.throws(() => validateStagedPackage(linked, { version: "0.4.0", platform: "linux" }), packageInvalid);
});

test("locatePackageRoot accepts both bare and single-wrapper layouts", t => {
  const bare = workspace(t);
  createPackageFiles(bare, "0.4.0");
  assert.equal(locatePackageRoot(bare, "0.4.0", "linux"), bare);

  const wrapped = workspace(t);
  createPackageFiles(path.join(wrapped, "webspeak"), "0.4.0");
  assert.equal(locatePackageRoot(wrapped, "0.4.0", "linux"), path.join(wrapped, "webspeak"));

  const missing = workspace(t);
  assert.throws(() => locatePackageRoot(missing, "0.4.0", "linux"), packageInvalid);
});

test("code swap replaces only code and preserves data, config, certs, skins and plugins", t => {
  const root = workspace(t), staged = path.join(workspace(t), "staged"), backup = path.join(workspace(t), "backup");
  mkdirSync(path.join(root, "dist"), { recursive: true });
  mkdirSync(path.join(root, "node_modules"), { recursive: true });
  writeFileSync(path.join(root, "dist", "index.js"), "old code");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.3.2" }));
  writeFileSync(path.join(root, "node_modules", "old.txt"), "old dependency");
  persistentState(root);
  createPackageFiles(staged, "0.4.0", { "dist/index.js": "new code", "node_modules/new.txt": "new dependency" });

  swapCode(root, staged, backup);
  assert.equal(readFileSync(path.join(root, "dist", "index.js"), "utf8"), "new code");
  assert.equal(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version, "0.4.0");
  assert.equal(readFileSync(path.join(root, "node_modules", "new.txt"), "utf8"), "new dependency");
  assert.equal(readFileSync(path.join(backup, "dist", "index.js"), "utf8"), "old code");
  assert.equal(readFileSync(path.join(backup, "node_modules", "old.txt"), "utf8"), "old dependency");
  for (const [directory, file, contents] of [
    ["data", "webspeak.db", "data-content"], ["certs", "cert.pem", "certs-content"],
    ["skins", "skin.json", "skins-content"], ["plugins", "plugin.json", "plugins-content"],
  ]) {
    assert.equal(readFileSync(path.join(root, directory, file), "utf8"), contents);
    assert.equal(existsSync(path.join(backup, directory)), false);
  }
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, "config.json"), "utf8")), { siteName: "kept" });
  assert.equal(existsSync(path.join(backup, "config.json")), false);
});

test("restoreCode returns the previous code and keeps rejected code for inspection", t => {
  const root = workspace(t), staged = path.join(workspace(t), "staged"), backup = path.join(workspace(t), "backup");
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(path.join(root, "dist", "index.js"), "old code");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.3.2" }));
  persistentState(root);
  createPackageFiles(staged, "0.4.0", { "dist/index.js": "new code" });

  swapCode(root, staged, backup);
  restoreCode(root, backup);
  assert.equal(readFileSync(path.join(root, "dist", "index.js"), "utf8"), "old code");
  assert.equal(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version, "0.3.2");
  assert.equal(readFileSync(path.join(backup, "rejected", "dist", "index.js"), "utf8"), "new code");
  assert.equal(readFileSync(path.join(root, "data", "webspeak.db"), "utf8"), "data-content");

  assert.throws(() => restoreCode(root, path.join(root, "absent-backup")), (error: unknown) =>
    error instanceof CodeSwapError && error.code === "UPDATE_ROLLBACK_FAILED");
});
