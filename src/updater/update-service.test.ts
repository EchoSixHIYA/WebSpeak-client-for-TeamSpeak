import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { Writable } from "node:stream";
import test, { type TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../logger.js";
import { CHECKSUM_ASSET_NAME, OFFICIAL_REPOSITORY } from "./releases.js";
import { swapCode } from "./code-swap.js";
import { UpdateError, UpdateService, type UpdateErrorCode, type UpdateServiceOptions } from "./update-service.js";
import { createPackageFiles, createTarGz, sha256Hex, type TarFixtureEntry } from "./test-support.js";
import { acquireUpdateLock, readUpdateState, writeUpdateState } from "./update-state.js";

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
    { name: "webspeak/start-webspeak.sh", data: "#!/bin/sh\nexit 0\n", mode: 0o755 },
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
    isSupervised: false,
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

test("an asynchronous download write failure rejects the update without crashing the process", async t => {
  const archive = packageArchive("0.4.0");
  const checksums = Buffer.from(checksumText(ASSET_NAME, archive));
  const release = releaseJson({
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive },
      { name: CHECKSUM_ASSET_NAME, data: checksums },
    ],
  });
  const originalCreateWriteStream = fs.createWriteStream;
  t.after(() => {
    fs.createWriteStream = originalCreateWriteStream;
    syncBuiltinESMExports();
  });
  fs.createWriteStream = (() => new Writable({
    write(_chunk, _encoding, callback) {
      setImmediate(() => callback(new Error("simulated ENOSPC")));
    },
  })) as unknown as typeof fs.createWriteStream;
  syncBuiltinESMExports();
  const cancelled = new Set<string>();
  const responses: Response[] = [];
  const signals: AbortSignal[] = [];
  const stalledBody = (url: string) => new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
    pull() { return new Promise(() => {}); },
    cancel() { cancelled.add(url); },
  });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === RELEASE_LIST_URL) return new Response(JSON.stringify([release]), { status: 200 });
    signals.push(init!.signal!);
    const response = new Response(stalledBody(String(input)), { status: 200 });
    responses.push(response);
    return response;
  }) as typeof globalThis.fetch;
  const { service, launched } = createService(t, [], new Map(), { fetch });

  await assert.rejects(service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_DOWNLOAD_FAILED"));
  assert.equal(launched.length, 0);
  assert.equal(cancelled.size, 2);
  assert.ok(signals.every(signal => signal.aborted));
  assert.ok(responses.every(response => !response.body!.locked));
});

test("a rejected asset aborts its stalled sibling before update cleanup returns", { timeout: 5_000 }, async t => {
  const archive = packageArchive("0.4.0");
  const checksums = Buffer.from(checksumText(ASSET_NAME, archive));
  const release = releaseJson({ version: "0.4.0", assets: [{ name: ASSET_NAME, data: archive }, { name: CHECKSUM_ASSET_NAME, data: checksums }] });
  const responses: Response[] = [], signals: AbortSignal[] = [];
  let cancelled = 0;
  const { service, dataDir } = createService(t, [], new Map(), { fetch: (async (input, init) => {
    const url = String(input);
    if (url === RELEASE_LIST_URL) return new Response(JSON.stringify([release]));
    signals.push(init!.signal!);
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      pull() { return new Promise(() => {}); },
      cancel() { cancelled++; },
    });
    const response = new Response(body, { headers: url.endsWith(ASSET_NAME) ? { "content-length": String(513 * 1024 * 1024) } : {} });
    responses.push(response);
    return response;
  }) as typeof fetch });
  await assert.rejects(service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_DOWNLOAD_TOO_LARGE"));
  assert.equal(cancelled, 2);
  assert.ok(signals.every(signal => signal.aborted));
  assert.ok(responses.every(response => !response.body!.locked));
  assert.equal(existsSync(path.join(dataDir, "updates", "update.lock")), false);
});

test("download rejection cancels its body and releases the reader, including unread responses", async t => {
  for (const declaredSize of [false, true]) {
    let cancelled = false;
    let signal: AbortSignal | null | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { cancelled = true; },
    });
    const { service } = createService(t, [], new Map(), { fetch: (async (_input, init) => {
      signal = init?.signal;
      return new Response(body, { headers: declaredSize ? { "content-length": "3" } : {} });
    }) as typeof fetch });
    const target = path.join(workspace(t), "asset");
    // A small injected byte limit exercises the production rejection path
    // without allocating or writing a 512 MiB package in a regression test.
    const download = service as unknown as { downloadAsset(asset: { name: string; url: string; size: number; digest: null }, destination: string, limit: number): Promise<unknown> };
    await assert.rejects(download.downloadAsset({ name: ASSET_NAME,
      url: `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${ASSET_NAME}`, size: 3, digest: null }, target, 1),
    updateErrorCode("UPDATE_DOWNLOAD_TOO_LARGE"));
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
    assert.equal(signal?.aborted, true);
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(`${target}.${process.pid}.tmp`), false);
  }
});

test("a successful download releases its reader without aborting the request", async t => {
  let signal: AbortSignal | null | undefined;
  const response = new Response(new Uint8Array([1, 2, 3]));
  const { service } = createService(t, [], new Map(), { fetch: (async (_input, init) => {
    signal = init?.signal; return response;
  }) as typeof fetch });
  const target = path.join(workspace(t), "asset");
  const download = service as unknown as { downloadAsset(asset: { name: string; url: string; size: number; digest: null }, destination: string, limit: number): Promise<unknown> };
  await download.downloadAsset({ name: ASSET_NAME,
    url: `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${ASSET_NAME}`, size: 3, digest: null }, target, 4);
  assert.deepEqual(readFileSync(target), Buffer.from([1, 2, 3]));
  assert.equal(response.body!.locked, false);
  assert.equal(signal?.aborted, false);
});

test("a download redirected outside GitHub is refused before it is written", async t => {
  const archive = packageArchive("0.4.0");
  const checksums = Buffer.from(checksumText(ASSET_NAME, archive));
  const release = releaseJson({
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive },
      { name: CHECKSUM_ASSET_NAME, data: checksums },
    ],
  });
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === RELEASE_LIST_URL) return new Response(JSON.stringify([release]), { status: 200 });
    const response = new Response(url.endsWith(ASSET_NAME) ? new Uint8Array(archive) : new Uint8Array(checksums), { status: 200 });
    if (url.endsWith(ASSET_NAME)) Object.defineProperty(response, "url", { value: "https://example.invalid/package.tar.gz" });
    return response;
  }) as typeof globalThis.fetch;
  const { service, launched } = createService(t, [], new Map(), { fetch });

  await assert.rejects(service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_RELEASE_UNAVAILABLE"));
  assert.equal(launched.length, 0);
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

test("getStatus reports the task the restart runner persisted, not stale memory", async t => {
  const archive = packageArchive("0.4.0");
  const checksums = Buffer.from(checksumText(ASSET_NAME, archive));
  const { service, dataDir } = createService(t, [{
    version: "0.4.0",
    assets: [
      { name: ASSET_NAME, data: archive },
      { name: CHECKSUM_ASSET_NAME, data: checksums },
    ],
  }], new Map([
    [`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${ASSET_NAME}`, archive],
    [`https://github.com/${OFFICIAL_REPOSITORY}/releases/download/v0.4.0/${CHECKSUM_ASSET_NAME}`, checksums],
  ]));

  const task = await service.applyUpdate("0.4.0", "0.4.0");
  assert.equal(service.getStatus().task?.status, "restarting");
  // The runner rolls the task back in another process, after this one
  // already returned the prepared task.
  writeUpdateState(path.join(dataDir, "updates", "state.json"), {
    schemaVersion: 1,
    task: {
      ...task, status: "failed", finishedAt: "2026-01-01T00:05:00.000Z", updatedAt: "2026-01-01T00:05:00.000Z",
      errorCode: "UPDATE_HEALTH_CHECK_FAILED", errorMessage: "health check failed", rolledBack: true,
    },
  });
  const status = service.getStatus();
  assert.equal(status.task?.status, "failed");
  assert.equal(status.task?.rolledBack, true);
  assert.equal(status.task?.errorCode, "UPDATE_HEALTH_CHECK_FAILED");
});

test("initialization restores the previous code from an interrupted swap backup", t => {
  const fixture = createService(t, [], new Map());
  const taskId = "upd_interrupted_swap";
  const statePath = path.join(fixture.dataDir, "updates", "state.json");
  const lockPath = path.join(fixture.dataDir, "updates", "update.lock");
  const backupDir = path.join(fixture.dataDir, "updates", "backups", taskId);

  // The process died after moving the previous code aside and only part of
  // the new package had been moved in.
  mkdirSync(path.join(backupDir, "dist"), { recursive: true });
  writeFileSync(path.join(backupDir, "dist", "index.js"), "// old code\n");
  writeFileSync(path.join(backupDir, "package.json"), JSON.stringify({ name: "webspeak-webclient", version: "0.3.2" }));
  writeFileSync(path.join(fixture.rootDir, "dist", "index.js"), "// new code\n");
  writeFileSync(path.join(fixture.rootDir, "package.json"), JSON.stringify({ name: "webspeak-webclient", version: "0.4.0" }));

  writeUpdateState(statePath, {
    schemaVersion: 1,
    task: {
      id: taskId, status: "restarting", fromVersion: "0.3.2", targetVersion: "0.4.0",
      startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
      errorCode: null, errorMessage: null, rolledBack: false, steps: [],
    },
  });
  writeFileSync(lockPath, JSON.stringify({ pid: 0, taskId, createdAt: "2026-01-01T00:00:00.000Z" }));

  const restarted = new UpdateService({
    rootDir: fixture.rootDir, dataDir: fixture.dataDir, currentVersion: "0.3.2", logger,
    platform: "linux", architecture: "x64", env: {}, isDocker: false, fetch: fakeFetch([], new Map()),
    now: () => new Date("2026-01-01T00:10:00.000Z"),
  });
  restarted.initialize();

  assert.equal(readFileSync(path.join(fixture.rootDir, "dist", "index.js"), "utf8"), "// old code\n");
  assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "0.3.2");
  const status = restarted.getStatus();
  assert.equal(status.task?.status, "failed");
  assert.equal(status.task?.rolledBack, true);
  assert.equal(status.task?.errorCode, "UPDATE_INTERRUPTED");
  assert.equal(existsSync(lockPath), false);
});

test("initialization keeps a complete target tree consistent with the running target version", t => {
  const fixture = createService(t, [], new Map());
  const taskId = "upd_complete_target";
  const statePath = path.join(fixture.dataDir, "updates", "state.json");
  const lockPath = path.join(fixture.dataDir, "updates", "update.lock");
  const backupDir = path.join(fixture.dataDir, "updates", "backups", taskId);
  const stagedRoot = path.join(fixture.dataDir, "updates", "tasks", taskId, "staged");
  createPackageFiles(stagedRoot, "0.4.0", { "dist/index.js": "// complete target code\n" });
  swapCode(fixture.rootDir, stagedRoot, backupDir);
  writeUpdateState(statePath, {
    schemaVersion: 1,
    task: {
      id: taskId, status: "restarting", fromVersion: "0.3.2", targetVersion: "0.4.0",
      startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
      errorCode: null, errorMessage: null, rolledBack: false, steps: [],
    },
  });
  writeFileSync(lockPath, JSON.stringify({ pid: 0, taskId, createdAt: "2026-01-01T00:00:00.000Z" }));

  const restarted = new UpdateService({
    rootDir: fixture.rootDir, dataDir: fixture.dataDir, currentVersion: "0.4.0", logger,
    platform: "linux", architecture: "x64", env: {}, isDocker: false, fetch: fakeFetch([], new Map()),
    now: () => new Date("2026-01-01T00:10:00.000Z"),
  });
  restarted.initialize();

  assert.equal(readFileSync(path.join(fixture.rootDir, "dist", "index.js"), "utf8"), "// complete target code\n");
  assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "0.4.0");
  assert.equal(restarted.getStatus().task?.status, "succeeded");
  assert.equal(restarted.getStatus().task?.rolledBack, false);
  assert.equal(existsSync(lockPath), false);
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

test("initialization preserves an interrupted tree while a launcher recovery owns the lock", t => {
  const fixture = createService(t, [], new Map());
  const taskId = "upd_launcher_recovery";
  const updates = path.join(fixture.dataDir, "updates");
  const staged = path.join(updates, "tasks", taskId, "staged");
  createPackageFiles(staged, "0.4.0");
  const backup = path.join(updates, "backups", taskId);
  swapCode(fixture.rootDir, staged, backup);
  writeUpdateState(path.join(updates, "state.json"), { schemaVersion: 1, task: {
    id: taskId, status: "restarting", fromVersion: "0.3.2", targetVersion: "0.4.0",
    startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
    errorCode: null, errorMessage: null, rolledBack: false, steps: [],
  } });
  const lockPath = path.join(updates, "update.lock");
  const release = acquireUpdateLock(lockPath, "recovery_other_launcher");
  t.after(release);
  const owner = readFileSync(lockPath, "utf8");
  fixture.service.initialize();
  assert.equal(readFileSync(lockPath, "utf8"), owner);
  assert.equal(fixture.service.getStatus().task?.status, "restarting");
  assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "0.4.0");
  assert.equal(JSON.parse(readFileSync(path.join(backup, "package.json"), "utf8")).version, "0.3.2");
});

test("a replacement app can update again after the runner finishes its cached task", async t => {
  const fixture = createService(t, [], new Map());
  const statePath = path.join(fixture.dataDir, "updates", "state.json");
  const lockPath = path.join(fixture.dataDir, "updates", "update.lock");
  const task = {
    id: "upd_completed_runner", status: "restarting" as const, fromVersion: "0.3.1", targetVersion: "0.3.2",
    startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
    errorCode: null, errorMessage: null, rolledBack: false, steps: [],
  };
  const release = acquireUpdateLock(lockPath, task.id);
  t.after(release);
  writeUpdateState(statePath, { schemaVersion: 1, task });
  fixture.service.initialize();
  assert.equal(fixture.service.getStatus().task?.status, "restarting");
  writeUpdateState(statePath, { schemaVersion: 1, task: { ...task, status: "succeeded", finishedAt: "2026-01-01T00:01:00.000Z" } });
  release();
  assert.equal(fixture.service.getStatus().task?.status, "succeeded");
  // It reaches release lookup instead of being rejected by a stale active task.
  await assert.rejects(fixture.service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_VERSION_NOT_FOUND"));
});

test("supervised packages can check releases but cannot download or launch an update", async t => {
  const fixture = createService(t, [{ version: "0.4.0", assets: [] }], new Map(), { isSupervised: true });
  const checked = await fixture.service.checkForUpdates();
  assert.equal(checked.releases[0]?.blockedReason, "DEPLOYMENT_SUPERVISED");
  assert.equal(checked.releases[0]?.canApply, false);
  await assert.rejects(fixture.service.applyUpdate("0.4.0", "0.4.0"), updateErrorCode("UPDATE_NOT_SUPPORTED"));
  assert.deepEqual(fixture.launched, []);
  assert.equal(fixture.service.getStatus().task, null);
});

test("initialization does not roll back a task whose lock belongs to another live process", async t => {
  const fixture = createService(t, [], new Map());
  const taskId = "upd_other_process";
  const statePath = path.join(fixture.dataDir, "updates", "state.json");
  const lockPath = path.join(fixture.dataDir, "updates", "update.lock");
  const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  t.after(() => { try { owner.kill("SIGKILL"); } catch { /* Already gone. */ } });
  await once(owner, "spawn");
  assert.ok(owner.pid);

  writeUpdateState(statePath, {
    schemaVersion: 1,
    task: {
      id: taskId, status: "restarting", fromVersion: "0.3.2", targetVersion: "0.4.0",
      startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
      errorCode: null, errorMessage: null, rolledBack: false, steps: [],
    },
  });
  writeFileSync(lockPath, JSON.stringify({ pid: owner.pid, taskId, createdAt: "2026-01-01T00:00:00.000Z" }));

  const restarted = new UpdateService({
    rootDir: fixture.rootDir, dataDir: fixture.dataDir, currentVersion: "0.3.2", logger,
    platform: "linux", architecture: "x64", env: {}, isDocker: false, fetch: fakeFetch([], new Map()),
    now: () => new Date("2026-01-01T00:10:00.000Z"),
  });
  restarted.initialize();

  const status = restarted.getStatus();
  assert.equal(status.task?.status, "restarting");
  assert.equal(status.task?.errorCode, null);
  assert.equal(status.task?.rolledBack, false);
  assert.equal(existsSync(lockPath), true);
});

/** Every module the detached runner imports, compiled side by side. */
const RUNNER_RUNTIME_FILES = ["restart-runner.js", "code-swap.js", "version.js", "update-state.js"];

async function compileRunnerSources(destination: string): Promise<void> {
  const { build } = await import("esbuild");
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  await build({
    entryPoints: RUNNER_RUNTIME_FILES.map((file) => path.join(sourceDirectory, file.replace(/\.js$/, ".ts"))),
    outdir: destination,
    bundle: false,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

async function stopProcess(pid: number): Promise<void> {
  try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && processIsAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("the real restart runner starts with every runtime module and survives the grace window", async t => {
  const directory = workspace(t);
  const compiled = path.join(directory, "compiled");
  await compileRunnerSources(compiled);
  const rootDir = path.join(directory, "app");
  createPackageFiles(rootDir, "0.3.2");
  const dataDir = path.join(directory, "data");
  const updatesDir = path.join(dataDir, "updates");
  mkdirSync(updatesDir, { recursive: true });
  const taskId = "upd_real_runner";
  const statePath = path.join(updatesDir, "state.json");
  writeUpdateState(statePath, {
    schemaVersion: 1,
    task: {
      id: taskId, status: "restarting", fromVersion: "0.3.2", targetVersion: "0.4.0",
      startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
      errorCode: null, errorMessage: null, rolledBack: false, steps: [],
    },
  });
  const planPath = path.join(updatesDir, "plan.json");
  const runnerDirectory = path.join(updatesDir, "runner");
  const lockPath = path.join(updatesDir, "update.lock");
  writeFileSync(planPath, JSON.stringify({
    schemaVersion: 1,
    taskId,
    rootDir,
    statePath,
    lockPath,
    stagedRoot: path.join(updatesDir, "staged"),
    backupDir: path.join(updatesDir, "backups", taskId),
    fromVersion: "0.3.2",
    targetVersion: "0.4.0",
    nodePath: process.execPath,
    appEntry: path.join(rootDir, "dist", "index.js"),
    // Deliberately not 3040 so the test cannot collide with a real server.
    health: { protocol: "http", port: 39999, path: "/api/health" },
    // The test process stays alive, so the runner waits instead of swapping.
    waitForPid: process.pid,
    parentTimeoutMs: 60_000,
    healthTimeoutMs: 100,
    pollIntervalMs: 50,
    appLogPath: path.join(updatesDir, "app.log"),
  }, null, 2));

  const service = new UpdateService({
    rootDir, dataDir, currentVersion: "0.3.2", logger,
    platform: "linux", architecture: "x64", env: {}, isDocker: false,
    fetch: fakeFetch([], new Map()),
    runnerSourceDir: compiled,
    runnerStartupTimeoutMs: 600,
  });
  // Call the real launcher: no spawn mock, the compiled runner is executed.
  const pid = await service.launchRunner(planPath, runnerDirectory);
  t.after(() => stopProcess(pid));

  assert.ok(Number.isInteger(pid) && pid > 0, "the runner reported a pid");
  for (const file of RUNNER_RUNTIME_FILES) {
    assert.equal(existsSync(path.join(runnerDirectory, file)), true, `${file} was copied next to the runner`);
  }
  assert.doesNotThrow(() => process.kill(pid, 0), "the runner is still alive after the grace window");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.equal(lock.taskId, taskId);
  assert.equal(lock.pid, pid);
  const log = readFileSync(path.join(updatesDir, "runner.log"), "utf8");
  assert.ok(!log.includes("ERR_MODULE_NOT_FOUND"), `runner log has no missing module: ${log}`);
});

test("the runner handshake requires lock takeover and a later death is caught before exit", async t => {
  const directory = workspace(t);
  const compiled = path.join(directory, "compiled");
  await compileRunnerSources(compiled);
  const rootDir = path.join(directory, "app");
  createPackageFiles(rootDir, "0.3.2");
  const dataDir = path.join(directory, "data");
  const updatesDir = path.join(dataDir, "updates");
  mkdirSync(updatesDir, { recursive: true });
  const taskId = "upd_handshake";
  const statePath = path.join(updatesDir, "state.json");
  const lockPath = path.join(updatesDir, "update.lock");
  const planPath = path.join(updatesDir, "plan.json");
  const makeTask = () => ({
    id: taskId, status: "restarting" as const, fromVersion: "0.3.2", targetVersion: "0.4.0",
    startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
    errorCode: null, errorMessage: null, rolledBack: false, steps: [],
  });
  const writePlan = () => writeFileSync(planPath, JSON.stringify({
    schemaVersion: 1, taskId, rootDir, statePath, lockPath,
    stagedRoot: path.join(updatesDir, "staged"),
    backupDir: path.join(updatesDir, "backups", taskId),
    fromVersion: "0.3.2", targetVersion: "0.4.0", nodePath: process.execPath,
    appEntry: path.join(rootDir, "dist", "index.js"),
    health: { protocol: "http", port: 39998, path: "/api/health" },
    waitForPid: process.pid, parentTimeoutMs: 60_000, healthTimeoutMs: 100, pollIntervalMs: 50,
    appLogPath: path.join(updatesDir, "app.log"),
  }, null, 2));
  writeUpdateState(statePath, { schemaVersion: 1, task: makeTask() });
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, taskId, createdAt: "2026-01-01T00:00:00.000Z" }));
  writePlan();

  const service = new UpdateService({
    rootDir, dataDir, currentVersion: "0.3.2", logger, platform: "linux", architecture: "x64", env: {}, isDocker: false,
    fetch: fakeFetch([], new Map()), runnerSourceDir: compiled, runnerStartupTimeoutMs: 1_500,
  });
  const pid = await service.launchRunner(planPath, path.join(updatesDir, "runner"));
  t.after(() => stopProcess(pid));
  assert.equal(service.runnerStillHealthy(), true, "runner owns the lock right after the handshake");

  await stopProcess(pid);
  assert.equal(service.runnerStillHealthy(), false, "a runner that died after 202 is caught before process.exit");
});

test("a runner that cannot take over the lock never passes the handshake", async t => {
  const directory = workspace(t);
  const compiled = path.join(directory, "compiled");
  await compileRunnerSources(compiled);
  const rootDir = path.join(directory, "app");
  createPackageFiles(rootDir, "0.3.2");
  const dataDir = path.join(directory, "data");
  const updatesDir = path.join(dataDir, "updates");
  mkdirSync(updatesDir, { recursive: true });
  const taskId = "upd_bad_lock";
  const statePath = path.join(updatesDir, "state.json");
  const lockPath = path.join(updatesDir, "update.lock");
  const planPath = path.join(updatesDir, "plan.json");
  writeUpdateState(statePath, {
    schemaVersion: 1,
    task: {
      id: taskId, status: "restarting", fromVersion: "0.3.2", targetVersion: "0.4.0",
      startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
      errorCode: null, errorMessage: null, rolledBack: false, steps: [],
    },
  });
  // A different task owns the lock: the runner must refuse to steal it.
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, taskId: "upd_other", createdAt: "2026-01-01T00:00:00.000Z" }));
  writeFileSync(planPath, JSON.stringify({
    schemaVersion: 1, taskId, rootDir, statePath, lockPath,
    stagedRoot: path.join(updatesDir, "staged"),
    backupDir: path.join(updatesDir, "backups", taskId),
    fromVersion: "0.3.2", targetVersion: "0.4.0", nodePath: process.execPath,
    appEntry: path.join(rootDir, "dist", "index.js"),
    health: { protocol: "http", port: 39997, path: "/api/health" },
    waitForPid: process.pid, parentTimeoutMs: 60_000, healthTimeoutMs: 100, pollIntervalMs: 50,
    appLogPath: path.join(updatesDir, "app.log"),
  }, null, 2));

  const service = new UpdateService({
    rootDir, dataDir, currentVersion: "0.3.2", logger, platform: "linux", architecture: "x64", env: {}, isDocker: false,
    fetch: fakeFetch([], new Map()), runnerSourceDir: compiled, runnerStartupTimeoutMs: 1_500,
  });
  await assert.rejects(
    service.launchRunner(planPath, path.join(updatesDir, "runner")),
    updateErrorCode("UPDATE_RUNNER_FAILED"),
  );
  assert.equal(service.runnerStillHealthy(), true, "no runner was recorded, so the guard is a no-op");
});
