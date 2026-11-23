import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assetKindFor, detectDeployment, isReleasePackageRoot, releaseAssetName, upgradePathFor,
} from "./deployment.js";

function temporary(t: test.TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-deployment-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function releasePackageRoot(t: test.TestContext, platform: "linux" | "win32" = "linux"): string {
  const root = temporary(t);
  const runtime = platform === "win32" ? "node.exe" : "node";
  for (const directory of ["runtime", "dist", "web/dist"]) mkdirSync(path.join(root, directory), { recursive: true });
  writeFileSync(path.join(root, "runtime", runtime), "");
  writeFileSync(path.join(root, "dist", "index.js"), "");
  writeFileSync(path.join(root, "web", "dist", "index.html"), "");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
  return root;
}

test("an explicit release-package override cannot bypass container detection", () => {
  const env = { WEBSPEAK_DEPLOYMENT_MODE: "release-package" };
  const info = detectDeployment({ rootDir: "/does/not/exist", env, isDocker: true, platform: "linux", architecture: "x64" });
  assert.equal(info.mode, "docker");
  assert.equal(info.applyAllowed, false);
  assert.equal(info.reasonCode, "DEPLOYMENT_DOCKER");
  assert.equal(info.upgradePath, "docker-compose");
});

test("an explicit release-package override requires a complete package tree", t => {
  const missing = detectDeployment({
    rootDir: "/does/not/exist",
    env: { WEBSPEAK_DEPLOYMENT_MODE: "release-package" },
    isDocker: false,
    platform: "linux",
    architecture: "x64",
  });
  assert.equal(missing.mode, "source");
  assert.equal(missing.applyAllowed, false);
  assert.equal(missing.reasonCode, "DEPLOYMENT_SOURCE");

  const root = releasePackageRoot(t);
  const complete = detectDeployment({
    rootDir: root,
    env: { WEBSPEAK_DEPLOYMENT_MODE: "release-package" },
    isDocker: false,
    platform: "linux",
    architecture: "x64",
  });
  assert.equal(complete.mode, "release-package");
  assert.equal(complete.applyAllowed, true);
  assert.equal(complete.reasonCode, null);
});

test("docker and source deployments never allow an in-console apply", () => {
  const docker = detectDeployment({ rootDir: "/does/not/exist", env: {}, isDocker: true, platform: "linux", architecture: "x64" });
  assert.deepEqual(
    { mode: docker.mode, applyAllowed: docker.applyAllowed, reasonCode: docker.reasonCode, upgradePath: docker.upgradePath },
    { mode: "docker", applyAllowed: false, reasonCode: "DEPLOYMENT_DOCKER", upgradePath: "docker-compose" },
  );
  const source = detectDeployment({ rootDir: "/does/not/exist", env: {}, isDocker: false, platform: "linux", architecture: "x64" });
  assert.deepEqual(
    { mode: source.mode, applyAllowed: source.applyAllowed, reasonCode: source.reasonCode, upgradePath: source.upgradePath },
    { mode: "source", applyAllowed: false, reasonCode: "DEPLOYMENT_SOURCE", upgradePath: "source" },
  );
});

test("a complete packaged tree is detected as a release package", t => {
  const root = releasePackageRoot(t);
  assert.equal(isReleasePackageRoot(root, "linux"), true);
  const info = detectDeployment({ rootDir: root, env: {}, isDocker: false, platform: "linux", architecture: "arm64" });
  assert.equal(info.mode, "release-package");
  assert.equal(info.assetKind, "linux-arm64");
  assert.equal(info.applyAllowed, true);
  assert.equal(detectDeployment({ rootDir: root, env: { WEBSPEAK_DEPLOYMENT_MODE: "docker" }, isDocker: false, platform: "linux" }).mode, "docker");
});

test("incomplete trees stay in source mode", t => {
  const root = temporary(t);
  assert.equal(isReleasePackageRoot(root, "linux"), false);
  mkdirSync(path.join(root, "runtime"), { recursive: true });
  writeFileSync(path.join(root, "runtime", "node"), "");
  assert.equal(isReleasePackageRoot(root, "linux"), false);
});

test("asset names and platform support are pinned to official release shapes", () => {
  assert.equal(assetKindFor("linux", "x64"), "linux-x64");
  assert.equal(assetKindFor("linux", "arm64"), "linux-arm64");
  assert.equal(assetKindFor("win32", "x64"), "windows-x64");
  assert.equal(assetKindFor("linux", "riscv64"), null);
  assert.equal(assetKindFor("darwin", "arm64"), null);
  assert.equal(releaseAssetName("0.4.0", "linux-x64"), "webspeak-webclient-v0.4.0-linux-x64.tar.gz");
  assert.equal(releaseAssetName("0.4.0", "linux-arm64"), "webspeak-webclient-v0.4.0-linux-arm64.tar.gz");
  assert.equal(releaseAssetName("0.4.0", "windows-x64"), "webspeak-webclient-v0.4.0-windows-x64.zip");
  assert.equal(upgradePathFor("docker"), "docker-compose");
  assert.equal(upgradePathFor("release-package"), "release-package");
  assert.equal(upgradePathFor("source"), "source");
});

test("unsupported platforms are visible but cannot apply", t => {
  const root = releasePackageRoot(t);
  const info = detectDeployment({ rootDir: root, env: {}, isDocker: false, platform: "linux", architecture: "s390x" });
  assert.equal(info.mode, "release-package");
  assert.equal(info.applyAllowed, false);
  assert.equal(info.reasonCode, "ARCH_UNSUPPORTED");
  const darwin = detectDeployment({ rootDir: root, env: {}, isDocker: false, platform: "darwin", architecture: "arm64" });
  assert.equal(darwin.applyAllowed, false);
  assert.equal(darwin.reasonCode, "PLATFORM_UNSUPPORTED");
});
