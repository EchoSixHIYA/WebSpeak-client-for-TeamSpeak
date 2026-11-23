import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Logger } from "../logger.js";
import { CHECKSUM_ASSET_NAME, OFFICIAL_REPOSITORY } from "./releases.js";
import { UpdateError, UpdateService, type UpdateErrorCode, type UpdateServiceOptions } from "./update-service.js";
import { createPackageFiles, createTarGz, sha256Hex, type TarFixtureEntry } from "./test-support.js";
import { readUpdateState } from "./update-state.js";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
const ASSET_NAME = "webspeak-webclient-v0.4.0-linux-x64.tar.gz";
const RELEASE_LIST_URL = `https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases?per_page=30`;

interface AssetFixture { name: string; data: Buffer; digest?: string | null; url?: string }
interface ReleaseFixture {
  version: string;
  assets: AssetFixture[];
  prerelease?: boolean;
  draft?: boolean;
  releaseUrl?: string;
}

function workspace(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-update-service-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function releaseJson(fixture: ReleaseFixture) {
  return {
    tag_name: `v${fixture.version}`,
    draft: fixture.draft === true,
    prerelease: fixture.prerelease === true,
    html_url: fixture.releaseUrl ?? `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v${fixture.version}`,
    published_at: "2026-01-01T00:00:00.000Z",
    assets: fixture.assets.map((asset) => ({
      name: asset.name,
      size: asset.data.length,
      browser_download_url: asset.url ?? `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v${fixture.version}/${asset.name}`,
      digest: asset.digest ?? null,
    })),
  };
}

function fakeFetch(releases: ReleaseFixture[], downloads: Map<string, Buffer>) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === RELEASE_LIST_URL) {
      return new Response(JSON.stringify(releases.map(releaseJson)), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = downloads.get(url);
    if (body) return new Response(body as unknown as BodyInit, { status: 200, headers: { "content-type": "application/octet-stream" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function packageArchive(version: string, extra: TarFixtureEntry[] = []): Buffer {
  return createTarGz([
    { name: "webspeak/", type: "directory" },
    { name: "webspeak/package.json", data: JSON.stringify({ name: "webspeak-webclient", version }) },
    { name: "webspeak/dist/index.js", data: "// package entry\n" },
    { name: "webspeak/web/dist/index.html", data: "<!doctype html>\n" },
    { name: "webspeak/node_modules/.keep", data: "" },
    { name: "webspeak/runtime/node", data: "#!/bin/sh\nexit 0\n", mode: 0o755 },
    ...extra,
  ]);
}

function checksumText(assetName: string, archive: Buffer): string {
  return `${sha256Hex(archive)}  ${assetName}\n`;
}

interface ServiceFixture {
  service: UpdateService;
  launched: string[];
  dataDir: string;
  rootDir: string;
}

function createService(
  t: TestContext,
  releases: ReleaseFixture[],
  downloads: Map<string, Buffer>,
  options: Partial<UpdateServiceOptions> = {},
): ServiceFixture {
  const directory = workspace(t);
  const rootDir = options.rootDir ?? path.join(directory, "app");
  if (!options.rootDir) createPackageFiles(rootDir, "0.3.2");
  const dataDir = path.join(directory, "data");
  const launched: string[] = [];
  const service = new UpdateService({
    rootDir,
    dataDir,
    currentVersion: "0.3.2",
    logger,
    platform: "linux",
    architecture: "x64",
    env: {},
    isDocker: false,
    fetch: fakeFetch(releases, downloads),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    launchRunner: async (planPath) => { launched.push(planPath); },
    healthTimeoutMs: 100,
    downloadTimeoutMs: 2_000,
    ...options,
  });
  service.initialize();
  return { service, launched, dataDir, rootDir };
}

function updateErrorCode(code: UpdateErrorCode) {
  return (error: unknown) => error instanceof UpdateError && error.code === code;
}

function digest(archive: Buffer): string {
  return `sha256:${sha256Hex(archive)}`;
}

test("release checks list only official stable versions and expose blocked reasons", async t => {
  const archive = packageArchive("0.4.0");
  const downloads = new Map<string, Buffer>();
  const assetUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${ASSET_NAME}`;
  const checksumUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${CHECKSUM_ASSET_NAME}`;
  downloads.set(assetUrl, archive);
  downloads.set(checksumUrl, Buffer.from(checksumText(ASSET_NAME, archive)));
  const { service } = createService(t, [
    {
      version: "0.4.0",
      assets: [
        { name: ASSET_NAME, data: archive, digest: digest(archive) },
        { name: CHECKSUM_ASSET_NAME, data: Buffer.from(checksumText(ASSET_NAME, archive)), digest: digest(Buffer.from(checksumText(ASSET_NAME, archive))) },
      ],
    },
    { version: "0.4.1", assets: [{ name: "webspeak-webclient-v0.4.1-linux-x64.tar.gz", data: archive }] },
    {
      version: "0.4.2",
      assets: [{ name: ASSET_NAME, data: archive }],
      releaseUrl: "https://evil.example/releases/tag/v0.4.2",
    },
    {
      version: "0.4.3",
      assets: [{ name: "webspeak-webclient-v0.4.3-linux-x64.tar.gz", data: archive, url: "https://evil.example/package.tar.gz" }],
    },
    { version: "0.5.0", assets: [], prerelease: true },
    { version: "0.6.0", assets: [], draft: true },
    { version: "0.3.2", assets: [] },
  ], downloads);

  const check = await service.checkForUpdates();
  assert.deepEqual(check.releases.map((release) => release.version), ["0.4.3", "0.4.1", "0.4.0"]);
  const ready = check.releases.find((release) => release.version === "0.4.0")!;
  assert.equal(ready.assetName, ASSET_NAME);
  assert.equal(ready.assetAvailable, true);
  assert.equal(ready.hasChecksums, true);
  assert.equal(ready.canApply, true);
  assert.equal(ready.blockedReason, null);
  assert.equal(ready.digest, digest(archive));
  const noChecksum = check.releases.find((release) => release.version === "0.4.1")!;
  assert.equal(noChecksum.canApply, false);
  assert.equal(noChecksum.blockedReason, "UPDATE_CHECKSUM_MISSING");
  const maliciousAsset = check.releases.find((release) => release.version === "0.4.3")!;
  assert.equal(maliciousAsset.assetAvailable, false);
  assert.equal(maliciousAsset.canApply, false);
  assert.equal(maliciousAsset.blockedReason, "UPDATE_ASSET_UNAVAILABLE");
});

test("apply requires a matching confirmation and a supported deployment", async t => {
  const archive = packageArchive("0.4.0");
  const { service, launched } = createService(t, [{
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive },
      { name: CHECKSUM_ASSET_NAME, data: Buffer.from(checksumText(ASSET_NAME, archive)) },
    ],
  }], new Map());
  await assert.rejects(service.applyUpdate("0.4.0", "0.4.1"), updateErrorCode("UPDATE_CONFIRMATION_REQUIRED"));
  await assert.rejects((service.applyUpdate as unknown as (version: string) => Promise<unknown>)("0.4.0"), updateErrorCode("UPDATE_CONFIRMATION_REQUIRED"));
  await assert.rejects(service.applyUpdate("not-a-version", "not-a-version"), updateErrorCode("UPDATE_VERSION_INVALID"));
  await assert.rejects(service.applyUpdate("0.3.2", "0.3.2"), updateErrorCode("UPDATE_VERSION_NOT_NEWER"));
  assert.equal(launched.length, 0);

  const sourceDirectory = workspace(t);
  const source = createService(t, [], new Map(), { rootDir: sourceDirectory });
  assert.equal(source.service.getStatus().deployment.mode, "source");
  await assert.rejects(source.service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_NOT_SUPPORTED"));
  assert.equal(source.launched.length, 0);

  const docker = createService(t, [], new Map(), { isDocker: true });
  assert.equal(docker.service.getStatus().deployment.mode, "docker");
  await assert.rejects(docker.service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_NOT_SUPPORTED"));
  assert.equal(docker.launched.length, 0);
});

test("a missing SHA256SUMS entry refuses the update and persists a failed task", async t => {
  const archive = packageArchive("0.4.0");
  const assetName = "webspeak-webclient-v0.4.1-linux-x64.tar.gz";
  const { service, launched, dataDir } = createService(t, [{
    version: "0.4.1",
    assets: [{ name: assetName, data: archive }],
  }], new Map([[`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.1/${assetName}`, archive]]));

  const check = await service.checkForUpdates();
  assert.equal(check.releases[0].blockedReason, "UPDATE_CHECKSUM_MISSING");
  await assert.rejects(service.applyUpdate("0.4.1", "0.4.1"), updateErrorCode("UPDATE_CHECKSUM_MISSING"));
  assert.equal(launched.length, 0);
  const state = readUpdateState(path.join(dataDir, "updates", "state.json"));
  assert.equal(state.task?.status, "failed");
  assert.equal(state.task?.errorCode, "UPDATE_CHECKSUM_MISSING");
  assert.equal(existsSync(path.join(dataDir, "updates", "update.lock")), false);
  assert.equal(existsSync(path.join(dataDir, "updates", "tasks", state.task!.id)), false);
});

test("a wrong checksum, digest mismatch or unsupported digest refuses the package", async t => {
  const archive = packageArchive("0.4.0");
  const baseRelease = (digestValue: string | null): ReleaseFixture => ({
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive, digest: digestValue },
      { name: CHECKSUM_ASSET_NAME, data: Buffer.from(checksumText(ASSET_NAME, archive)) },
    ],
  });
  const archiveUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${ASSET_NAME}`;
  const checksumUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${CHECKSUM_ASSET_NAME}`;
  const downloads = new Map<string, Buffer>([
    [archiveUrl, archive],
    [checksumUrl, Buffer.from(checksumText(ASSET_NAME, archive))],
  ]);

  const badChecksum = createService(t, [{
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive },
      { name: CHECKSUM_ASSET_NAME, data: Buffer.from(`${"0".repeat(64)}  ${ASSET_NAME}\n`) },
    ],
  }], new Map([[archiveUrl, archive], [checksumUrl, Buffer.from(`${"0".repeat(64)}  ${ASSET_NAME}\n`)]]));
  await assert.rejects(badChecksum.service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_CHECKSUM_MISMATCH"));
  assert.equal(badChecksum.launched.length, 0);

  const wrongDigest = createService(t, [baseRelease(`sha256:${"0".repeat(64)}`)], new Map(downloads));
  await assert.rejects(wrongDigest.service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_DIGEST_MISMATCH"));

  const unsupportedDigest = createService(t, [baseRelease("md5:abc")], new Map(downloads));
  await assert.rejects(unsupportedDigest.service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_DIGEST_UNSUPPORTED"));
});

test("unsafe archives are refused before any code is staged", async t => {
  const archive = packageArchive("0.4.0", [{ name: "webspeak/../../escape.txt", data: "owned" }]);
  const { service, launched, dataDir } = createService(t, [{
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive },
      { name: CHECKSUM_ASSET_NAME, data: Buffer.from(checksumText(ASSET_NAME, archive)) },
    ],
  }], new Map([
    [`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${ASSET_NAME}`, archive],
    [`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${CHECKSUM_ASSET_NAME}`, Buffer.from(checksumText(ASSET_NAME, archive))],
  ]));

  await assert.rejects(service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_ARCHIVE_UNSAFE"));
  assert.equal(launched.length, 0);
  assert.equal(existsSync(path.join(dataDir, "..", "escape.txt")), false);
  const state = readUpdateState(path.join(dataDir, "updates", "state.json"));
  assert.equal(state.task?.errorCode, "UPDATE_ARCHIVE_UNSAFE");
});

test("a verified package is staged, persisted and handed to the restart runner", async t => {
  const archive = packageArchive("0.4.0");
  const checksums = Buffer.from(checksumText(ASSET_NAME, archive));
  const { service, launched, dataDir } = createService(t, [{
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive, digest: digest(archive) },
      { name: CHECKSUM_ASSET_NAME, data: checksums, digest: digest(checksums) },
    ],
  }], new Map([
    [`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${ASSET_NAME}`, archive],
    [`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${CHECKSUM_ASSET_NAME}`, checksums],
  ]));

  const task = await service.applyUpdate("0.4.0", "0.4.0");
  assert.equal(task.status, "restarting");
  assert.equal(task.targetVersion, "0.4.0");
  assert.deepEqual(task.steps.map((step) => [step.name, step.status]), [
    ["download", "succeeded"],
    ["checksum", "succeeded"],
    ["extract", "succeeded"],
    ["stage", "succeeded"],
    ["restart", "running"],
  ]);

  const state = readUpdateState(path.join(dataDir, "updates", "state.json"));
  assert.equal(state.task?.id, task.id);
  assert.equal(state.task?.status, "restarting");
  assert.equal(launched.length, 1);
  const plan = JSON.parse(readFileSync(launched[0], "utf8"));
  assert.equal(plan.taskId, task.id);
  assert.equal(plan.targetVersion, "0.4.0");
  assert.equal(plan.fromVersion, "0.3.2");
  assert.equal(JSON.parse(readFileSync(path.join(plan.stagedRoot, "package.json"), "utf8")).version, "0.4.0");
  assert.equal(existsSync(path.join(dataDir, "updates", "update.lock")), true);

  // The old process is gone once the restarted instance reads the state.
  writeFileSync(path.join(dataDir, "updates", "update.lock"), JSON.stringify({ pid: 0, taskId: task.id, createdAt: "2026-01-01T00:00:00.000Z" }));
  const restarted = new UpdateService({
    rootDir: path.dirname(plan.rootDir),
    dataDir,
    currentVersion: "0.4.0",
    logger,
    platform: "linux",
    architecture: "x64",
    env: {},
    isDocker: false,
    fetch: fakeFetch([], new Map()),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  restarted.initialize();
  assert.equal(restarted.getStatus().task?.status, "succeeded");
  assert.equal(restarted.getStatus().task?.finishedAt, "2026-01-01T00:00:00.000Z");
});

test("a concurrent lock leaves the running task state untouched", async t => {
  const archive = packageArchive("0.4.0");
  const { service, dataDir } = createService(t, [{
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive },
      { name: CHECKSUM_ASSET_NAME, data: Buffer.from(checksumText(ASSET_NAME, archive)) },
    ],
  }], new Map());
  mkdirSync(path.join(dataDir, "updates"), { recursive: true });
  writeFileSync(path.join(dataDir, "updates", "update.lock"), JSON.stringify({ pid: process.pid, taskId: "upd_running", createdAt: "2026-01-01T00:00:00.000Z" }));
  writeFileSync(path.join(dataDir, "updates", "state.json"), JSON.stringify({ schemaVersion: 1, task: null }));
  service.initialize();

  await assert.rejects(service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_IN_PROGRESS"));
  assert.equal(readUpdateState(path.join(dataDir, "updates", "state.json")).task, null);
  assert.equal(service.getStatus().task, null);
});

test("initialization keeps a live task but reconciles it once its process is gone", async t => {
  const fixture = createService(t, [], new Map());
  const running = {
    schemaVersion: 1 as const,
    task: {
      id: "upd_live", status: "downloading" as const, fromVersion: "0.3.2", targetVersion: "0.4.0",
      startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
      errorCode: null, errorMessage: null, rolledBack: false, steps: [],
    },
  };
  const statePath = path.join(fixture.dataDir, "updates", "state.json");
  const lockPath = path.join(fixture.dataDir, "updates", "update.lock");
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(running));
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, taskId: "upd_live", createdAt: "2026-01-01T00:00:00.000Z" }));
  const restarted = new UpdateService({
    rootDir: fixture.rootDir, dataDir: fixture.dataDir, currentVersion: "0.3.2", logger,
    platform: "linux", architecture: "x64", env: {}, isDocker: false, fetch: fakeFetch([], new Map()),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  restarted.initialize();
  assert.equal(restarted.getStatus().task?.status, "downloading");

  writeFileSync(lockPath, JSON.stringify({ pid: 0, taskId: "upd_live", createdAt: "2026-01-01T00:00:00.000Z" }));
  restarted.initialize();
  assert.equal(restarted.getStatus().task?.status, "failed");
  assert.equal(restarted.getStatus().task?.errorCode, "UPDATE_INTERRUPTED");
});
