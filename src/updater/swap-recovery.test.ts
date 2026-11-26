import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import test, { type TestContext } from "node:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateService } from "./update-service.js";
import { CODE_ENTRIES, swapCode } from "./code-swap.js";
import { acquireUpdateLock, updateLockIsHeld } from "./update-state.js";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SOURCE_DIR, "..", "..");
const LAUNCHER_SOURCE = path.join(REPO_ROOT, "scripts", "start-webspeak.sh");
const RUNNER_SOURCE = path.join(SOURCE_DIR, "restart-runner.ts");
const TASK_ID = "upd_sigkill_window";

const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };

for (const lockKind of ["live", "unreadable"] as const) {
  test(`launcher preserves a target while the update lock is ${lockKind}`, { timeout: 15_000, skip: process.platform !== "linux" }, async t => {
    const fixture = buildFixture(t, await availablePort());
    swapCode(fixture.rootDir, fixture.stagedRoot, fixture.backupDir);
    const lockPath = path.join(fixture.dataDir, "updates", "update.lock");
    if (lockKind === "live") {
      const release = acquireUpdateLock(lockPath, TASK_ID);
      t.after(release);
      assert.equal(updateLockIsHeld(lockPath, TASK_ID), true);
    } else {
      writeFileSync(lockPath, "{invalid");
    }
    const before = readFileSync(lockPath, "utf8");
    const app = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], {
      cwd: fixture.rootDir, env: { ...process.env, WEBSPEAK_DATA_DIR: fixture.dataDir }, stdio: "ignore",
    });
    t.after(() => stop(app));
    await waitFor(() => app.exitCode !== null, "launcher did not refuse the held update lock", 5_000);
    assert.equal(app.exitCode, 75);
    assert.equal(readFileSync(lockPath, "utf8"), before);
    assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "0.4.0");
    assert.equal(JSON.parse(readFileSync(path.join(fixture.backupDir, "package.json"), "utf8")).version, "0.3.2");
  });
}

test("concurrent launchers cannot restore the same interrupted tree together", { timeout: 20_000, skip: process.platform !== "linux" }, async t => {
  const port = await availablePort();
  const fixture = buildFixture(t, port);
  swapCode(fixture.rootDir, fixture.stagedRoot, fixture.backupDir);
  const bin = path.join(fixture.directory, "bin");
  mkdirSync(bin);
  // Pause the first real restore at mv, without adding a production test hook.
  writeFileSync(path.join(bin, "mv"), `#!/bin/sh
printf '%s' "$$" > "$RECOVERY_TEST_BARRIER/entered"
attempt=0
while [ ! -f "$RECOVERY_TEST_BARRIER/resume" ] && [ "$attempt" -lt 200 ]; do
  sleep 0.05
  attempt=$((attempt + 1))
done
exec /bin/mv "$@"
`, { mode: 0o755 });
  const env = { ...process.env, WEBSPEAK_DATA_DIR: fixture.dataDir,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`, RECOVERY_TEST_BARRIER: fixture.barrierDir };
  const first = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], { cwd: fixture.rootDir, env, stdio: "ignore" });
  let second: ChildProcess | undefined;
  try {
    await waitFor(() => existsSync(path.join(fixture.barrierDir, "entered")), "first launcher did not start restoring");
    const lockPath = path.join(fixture.dataDir, "updates", "update.lock");
    assert.equal(updateLockIsHeld(lockPath), true);
    const owner = readFileSync(lockPath, "utf8");
    second = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], { cwd: fixture.rootDir, env, stdio: "ignore" });
    await waitFor(() => second!.exitCode !== null, "second launcher did not refuse concurrent recovery", 5_000);
    assert.equal(second.exitCode, 75);
    assert.equal(readFileSync(lockPath, "utf8"), owner);
    writeFileSync(path.join(fixture.barrierDir, "resume"), "");
    await waitFor(() => healthVersion(port).then(version => version === "0.3.2"), "first launcher did not finish recovery");
    assert.equal(existsSync(lockPath), false);
  } finally {
    // Stop children before buildFixture's after hook removes their files.
    writeFileSync(path.join(fixture.barrierDir, "resume"), "");
    stop(first); stop(second);
    await waitFor(() => !processAlive(first.pid) && !processAlive(second?.pid), "recovery processes did not stop", 5_000);
  }
});

// Exercise a kill after every old entry's rename, before the manifest is
// updated. In particular the backup is still partial for the first entries.
for (const entry of CODE_ENTRIES) {
  test(`launcher recovers a SIGKILL immediately after moving old ${entry}`, { timeout: 30_000, skip: process.platform !== "linux" }, async t => {
    const port = await availablePort();
    const fixture = buildFixture(t, port, true);
    // The Linux package need not contain the Windows launcher, but include it
    // here so the entire code-entry list has a tested interruption point.
    writeFileSync(path.join(fixture.rootDir, "start-webspeak.cmd"), "old launcher");
    const runner = spawn(process.execPath, ["--import", "tsx", RUNNER_SOURCE, path.join(fixture.dataDir, "updates", "plan.json")], {
      cwd: REPO_ROOT,
      env: { ...process.env, WEBSPEAK_TEST_SWAP_BARRIER_DIR: fixture.barrierDir, WEBSPEAK_TEST_SWAP_BARRIER_AFTER_ENTRY: entry },
      stdio: "ignore",
    });
    let app: ChildProcess | undefined;
    t.after(() => { stop(app); stop(runner); });
    await waitFor(() => existsSync(path.join(fixture.barrierDir, "swap-window-reached")), `runner never reached ${entry}`);
    stop(runner);
    await waitFor(() => !processAlive(runner.pid), "runner did not stop", 5_000);
    app = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], {
      cwd: fixture.rootDir, env: { ...process.env, WEBSPEAK_DATA_DIR: fixture.dataDir }, stdio: "ignore",
    });
    await waitFor(() => healthVersion(port).then(version => version === "0.3.2"), `launcher failed after ${entry}`);
    assert.equal(readFileSync(path.join(fixture.rootDir, "dist", "index.js"), "utf8"), appScript());
    for (const [key, file] of Object.entries(fixture.markerFiles)) {
      if (key !== "config") assert.equal(readFileSync(file, "utf8"), `${key} preserved`);
    }
    const stale = path.join(fixture.dataDir, "updates", "backups", "aaa_stale_backup", "package.json");
    assert.equal(JSON.parse(readFileSync(stale, "utf8")).version, "0.1.0");
    stop(app);
    await waitFor(() => !processAlive(app?.pid), "app did not stop", 5_000);
  });
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitFor(check: () => boolean | Promise<boolean>, message: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(message);
    await sleep(25);
  }
}

async function healthVersion(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return null;
    const body = await response.json() as { status?: string; version?: string };
    return body.status === "ok" ? body.version ?? null : null;
  } catch {
    return null;
  }
}

function startedVersion(fixture: Fixture): string | null {
  const { startedFile } = JSON.parse(readFileSync(fixture.markerFiles.config, "utf8")) as { startedFile: string };
  return existsSync(startedFile) ? readFileSync(startedFile, "utf8") : null;
}

function processAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function stop(child: ChildProcess | undefined): void {
  if (!child || !processAlive(child.pid)) return;
  try { child.kill("SIGKILL"); } catch { /* Already gone. */ }
}

/** The stub reports the version from package.json, as the real app does. */
function appScript(): string {
  return `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config.json"), "utf8"));
const version = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version;
http.createServer((request, response) => {
  if (request.url === "/api/health") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok", version }));
    return;
  }
  response.statusCode = 404;
  response.end();
}).listen(config.port, "127.0.0.1", () => fs.writeFileSync(config.startedFile, version));
`;
}

interface Fixture {
  directory: string;
  rootDir: string;
  dataDir: string;
  stagedRoot: string;
  backupDir: string;
  barrierDir: string;
  port: number;
  markerFiles: Record<string, string>;
}

function buildFixture(t: TestContext, port: number, withStaleBackup = false): Fixture {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-swap-recovery-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const rootDir = path.join(directory, "app");
  const dataDir = path.join(rootDir, "data");
  const updatesDir = path.join(dataDir, "updates");
  const stagedRoot = path.join(updatesDir, "tasks", TASK_ID, "staged");
  const backupDir = path.join(updatesDir, "backups", TASK_ID);
  const barrierDir = path.join(directory, "barrier");

  for (const relative of ["dist", "web/dist", "node_modules", "runtime"]) {
    mkdirSync(path.join(rootDir, relative), { recursive: true });
  }
  writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "webspeak-webclient", version: "0.3.2" }));
  writeFileSync(path.join(rootDir, "package-lock.json"), "{}");
  writeFileSync(path.join(rootDir, "README.md"), "old readme");
  writeFileSync(path.join(rootDir, "LICENSE"), "old license");
  writeFileSync(path.join(rootDir, "config.example.json"), "{}");
  writeFileSync(path.join(rootDir, "web", "dist", "index.html"), "<!doctype html>\n");
  writeFileSync(path.join(rootDir, "node_modules", ".keep"), "");
  writeFileSync(path.join(rootDir, "dist", "index.js"), appScript());
  copyFileSync(process.execPath, path.join(rootDir, "runtime", "node"));
  chmodSync(path.join(rootDir, "runtime", "node"), 0o755);
  // This is the same file CI ships and applyUpdate installs before the swap.
  copyFileSync(LAUNCHER_SOURCE, path.join(rootDir, "start-webspeak.sh"));
  chmodSync(path.join(rootDir, "start-webspeak.sh"), 0o755);

  const markerFiles: Record<string, string> = {
    config: path.join(rootDir, "config.json"),
    database: path.join(dataDir, "webspeak.db"),
    identity: path.join(dataDir, "identity.key"),
    cert: path.join(rootDir, "certs", "cert.pem"),
    skin: path.join(dataDir, "skins", "skin.json"),
    plugin: path.join(dataDir, "plugins", "plugin.json"),
  };
  mkdirSync(path.dirname(markerFiles.database), { recursive: true });
  mkdirSync(path.dirname(markerFiles.identity), { recursive: true });
  mkdirSync(path.dirname(markerFiles.cert), { recursive: true });
  mkdirSync(path.dirname(markerFiles.skin), { recursive: true });
  mkdirSync(path.dirname(markerFiles.plugin), { recursive: true });
  writeFileSync(markerFiles.config, JSON.stringify({ port, startedFile: path.join(directory, "started.txt") }));
  for (const [key, value] of Object.entries(markerFiles)) {
    if (key !== "config") writeFileSync(value, `${key} preserved`);
  }

  mkdirSync(updatesDir, { recursive: true });
  mkdirSync(stagedRoot, { recursive: true });
  mkdirSync(path.join(stagedRoot, "dist"), { recursive: true });
  mkdirSync(path.join(stagedRoot, "web", "dist"), { recursive: true });
  mkdirSync(path.join(stagedRoot, "node_modules"), { recursive: true });
  mkdirSync(path.join(stagedRoot, "runtime"), { recursive: true });
  writeFileSync(path.join(stagedRoot, "package.json"), JSON.stringify({ name: "webspeak-webclient", version: "0.4.0" }));
  writeFileSync(path.join(stagedRoot, "package-lock.json"), "{}");
  writeFileSync(path.join(stagedRoot, "README.md"), "new readme");
  writeFileSync(path.join(stagedRoot, "LICENSE"), "new license");
  writeFileSync(path.join(stagedRoot, "config.example.json"), "{}");
  writeFileSync(path.join(stagedRoot, "dist", "index.js"), "// new code marker\n");
  writeFileSync(path.join(stagedRoot, "web", "dist", "index.html"), "<!doctype html>\n");
  writeFileSync(path.join(stagedRoot, "node_modules", ".keep"), "");
  writeFileSync(path.join(stagedRoot, "runtime", "node"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  copyFileSync(LAUNCHER_SOURCE, path.join(stagedRoot, "start-webspeak.sh"));

  writeFileSync(path.join(updatesDir, "state.json"), JSON.stringify({
    schemaVersion: 1,
    task: {
      id: TASK_ID, status: "restarting", fromVersion: "0.3.2", targetVersion: "0.4.0",
      startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
      errorCode: null, errorMessage: null, rolledBack: false, steps: [],
    },
  }));
  writeFileSync(path.join(updatesDir, "update.lock"), JSON.stringify({ pid: 0, taskId: TASK_ID, createdAt: "2026-01-01T00:00:00.000Z" }));
  writeFileSync(path.join(updatesDir, "plan.json"), JSON.stringify({
    schemaVersion: 1,
    taskId: TASK_ID,
    rootDir,
    statePath: path.join(updatesDir, "state.json"),
    lockPath: path.join(updatesDir, "update.lock"),
    stagedRoot,
    backupDir,
    fromVersion: "0.3.2",
    targetVersion: "0.4.0",
    nodePath: process.execPath,
    appEntry: path.join(rootDir, "dist", "index.js"),
    health: { protocol: "http", port, path: "/api/health" },
    waitForPid: null,
    parentTimeoutMs: 2_000,
    healthTimeoutMs: 300,
    pollIntervalMs: 50,
    appLogPath: path.join(updatesDir, "app.log"),
  }, null, 2));
  if (withStaleBackup) {
    // A complete backup from an earlier, already successful update. Its name
    // sorts before the in-progress task's id, so the old "first complete
    // backup wins" launcher logic would wrongly restore this older build.
    const staleDir = path.join(updatesDir, "backups", "aaa_stale_backup");
    for (const relative of ["dist", "web/dist", "node_modules", "runtime"]) {
      mkdirSync(path.join(staleDir, relative), { recursive: true });
    }
    writeFileSync(path.join(staleDir, "dist", "index.js"), appScript());
    writeFileSync(path.join(staleDir, "web", "dist", "index.html"), "<!doctype html>\n");
    writeFileSync(path.join(staleDir, "node_modules", ".keep"), "");
    writeFileSync(path.join(staleDir, "package.json"), JSON.stringify({ name: "webspeak-webclient", version: "0.1.0" }));
    writeFileSync(path.join(staleDir, "package-lock.json"), "{}");
    writeFileSync(path.join(staleDir, "README.md"), "stale readme");
    writeFileSync(path.join(staleDir, "LICENSE"), "stale license");
    writeFileSync(path.join(staleDir, "config.example.json"), "{}");
    copyFileSync(process.execPath, path.join(staleDir, "runtime", "node"));
    chmodSync(path.join(staleDir, "runtime", "node"), 0o755);
    writeFileSync(path.join(staleDir, ".webspeak-swap.json"), JSON.stringify({
      schemaVersion: 1,
      entries: ["dist", "web/dist", "node_modules", "runtime", "package.json", "package-lock.json", "README.md", "LICENSE", "config.example.json"],
    }, null, 2));
  }

  mkdirSync(barrierDir, { recursive: true });

  return { directory, rootDir, dataDir, stagedRoot, backupDir, barrierDir, port, markerFiles };
}

test(
  "SIGKILL in the exact swap window is recovered by the official launcher with data intact",
  { timeout: 40_000 },
  async t => {
    const port = await availablePort();
    const fixture = buildFixture(t, port);
    let runner: ChildProcess | undefined;
    let app: ChildProcess | undefined;
    t.after(() => { stop(app); stop(runner); });

    let runnerOutput = "";
    runner = spawn(process.execPath, ["--import", "tsx", RUNNER_SOURCE, path.join(fixture.dataDir, "updates", "plan.json")], {
      cwd: REPO_ROOT,
      env: { ...process.env, WEBSPEAK_TEST_SWAP_BARRIER_DIR: fixture.barrierDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    runner.stdout?.on("data", (chunk: Buffer) => { runnerOutput += chunk.toString(); });
    runner.stderr?.on("data", (chunk: Buffer) => { runnerOutput += chunk.toString(); });
    await waitFor(
      () => existsSync(path.join(fixture.barrierDir, "swap-window-reached")),
      `runner never reached the exact swap window: ${runnerOutput}`,
    );

    // Precisely the failure state: old dist moved aside, new dist not yet in.
    assert.equal(existsSync(path.join(fixture.rootDir, "dist", "index.js")), false);
    assert.equal(existsSync(path.join(fixture.backupDir, "dist", "index.js")), true);
    assert.equal(existsSync(path.join(fixture.rootDir, "start-webspeak.sh")), true, "official launcher survived the swap");

    stop(runner);
    await waitFor(() => !processAlive(runner?.pid), "runner did not die after SIGKILL", 5_000);

    // Restart through the shipped launcher itself, not a harness wrapper.
    app = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], {
      cwd: fixture.rootDir,
      env: { ...process.env, WEBSPEAK_DATA_DIR: fixture.dataDir },
      stdio: "ignore",
    });
    await waitFor(() => healthVersion(port).then(version => version === "0.3.2"), "official launcher did not restore a healthy install");

    assert.equal(readFileSync(path.join(fixture.rootDir, "dist", "index.js"), "utf8"), appScript());
    assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "0.3.2");
    assert.deepEqual(JSON.parse(readFileSync(fixture.markerFiles.config, "utf8")), { port, startedFile: path.join(fixture.directory, "started.txt") });
    for (const [key, file] of Object.entries(fixture.markerFiles)) {
      if (key !== "config") assert.equal(readFileSync(file, "utf8"), `${key} preserved`, `${key} survived recovery`);
    }
    assert.equal(existsSync(path.join(fixture.backupDir, "rejected", "dist")), false, "no partial new code in the install root");

    // Once Node is up, the existing initialize() path records the real failure.
    stop(app);
    await waitFor(() => !processAlive(app?.pid), "app did not stop", 5_000);
    const service = new UpdateService({
      rootDir: fixture.rootDir,
      dataDir: fixture.dataDir,
      currentVersion: "0.3.2",
      logger,
      platform: "linux",
      architecture: "x64",
      env: {},
      isDocker: false,
    });
    service.initialize();
    const status = service.getStatus();
    assert.equal(status.task?.status, "failed");
    assert.equal(status.task?.errorCode, "UPDATE_INTERRUPTED");
    assert.equal(status.task?.rolledBack, true);
  },
);

test(
  "launcher resumes a partial current backup instead of installing a stale complete backup",
  { timeout: 20_000 },
  async t => {
    const port = await availablePort();
    const fixture = buildFixture(t, port, true);
    const staleDir = path.join(fixture.dataDir, "updates", "backups", "aaa_stale_backup");
    mkdirSync(fixture.backupDir, { recursive: true });
    renameSync(path.join(fixture.rootDir, "dist"), path.join(fixture.backupDir, "dist"));
    writeFileSync(path.join(fixture.backupDir, ".webspeak-swap.json"), JSON.stringify({ schemaVersion: 1, entries: ["dist"] }));
    let app: ChildProcess | undefined;
    t.after(() => stop(app));

    app = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], {
      cwd: fixture.rootDir,
      env: { ...process.env, WEBSPEAK_DATA_DIR: fixture.dataDir },
      stdio: "ignore",
    });
    await waitFor(() => startedVersion(fixture) !== null, "launcher did not resume the partial current backup");
    assert.equal(startedVersion(fixture), "0.3.2");
    assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "0.3.2");
    assert.equal(JSON.parse(readFileSync(path.join(staleDir, "package.json"), "utf8")).version, "0.1.0");
    assert.equal(existsSync(path.join(staleDir, "dist", "index.js")), true);
  },
);

test(
  "launcher resumes a rollback that already consumed part of the current backup",
  { timeout: 20_000 },
  async t => {
    const port = await availablePort();
    const fixture = buildFixture(t, port);
    swapCode(fixture.rootDir, fixture.stagedRoot, fixture.backupDir);
    for (const entry of ["runtime", "package.json"]) {
      rmSync(path.join(fixture.rootDir, entry), { recursive: true, force: true });
      renameSync(path.join(fixture.backupDir, entry), path.join(fixture.rootDir, entry));
    }
    mkdirSync(path.join(fixture.backupDir, "rejected"), { recursive: true });
    renameSync(path.join(fixture.rootDir, "dist"), path.join(fixture.backupDir, "rejected", "dist"));
    let app: ChildProcess | undefined;
    t.after(() => stop(app));

    app = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], {
      cwd: fixture.rootDir,
      env: { ...process.env, WEBSPEAK_DATA_DIR: fixture.dataDir },
      stdio: "ignore",
    });
    await waitFor(() => startedVersion(fixture) !== null, "launcher did not resume the interrupted rollback");
    assert.equal(startedVersion(fixture), "0.3.2");
    assert.equal(existsSync(path.join(fixture.rootDir, "dist", "index.js")), true);
  },
);

test(
  "launcher rolls back an active fully swapped tree before starting the target",
  { timeout: 20_000 },
  async t => {
    const port = await availablePort();
    const fixture = buildFixture(t, port);
    writeFileSync(path.join(fixture.stagedRoot, "dist", "index.js"), appScript());
    copyFileSync(process.execPath, path.join(fixture.stagedRoot, "runtime", "node"));
    chmodSync(path.join(fixture.stagedRoot, "runtime", "node"), 0o755);
    swapCode(fixture.rootDir, fixture.stagedRoot, fixture.backupDir);
    let app: ChildProcess | undefined;
    t.after(() => stop(app));

    app = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], {
      cwd: fixture.rootDir,
      env: { ...process.env, WEBSPEAK_DATA_DIR: fixture.dataDir },
      stdio: "ignore",
    });
    await waitFor(() => startedVersion(fixture) !== null, "launcher did not resolve the active swapped tree");
    assert.equal(startedVersion(fixture), "0.3.2");
    assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "0.3.2");
  },
);

test(
  "recovery prefers the in-progress task backup over an older lexicographically-first backup",
  { timeout: 40_000 },
  async t => {
    const port = await availablePort();
    const fixture = buildFixture(t, port, true);
    const staleDir = path.join(fixture.dataDir, "updates", "backups", "aaa_stale_backup");
    let runner: ChildProcess | undefined;
    let app: ChildProcess | undefined;
    t.after(() => { stop(app); stop(runner); });

    let runnerOutput = "";
    runner = spawn(process.execPath, ["--import", "tsx", RUNNER_SOURCE, path.join(fixture.dataDir, "updates", "plan.json")], {
      cwd: REPO_ROOT,
      env: { ...process.env, WEBSPEAK_TEST_SWAP_BARRIER_DIR: fixture.barrierDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    runner.stdout?.on("data", (chunk: Buffer) => { runnerOutput += chunk.toString(); });
    runner.stderr?.on("data", (chunk: Buffer) => { runnerOutput += chunk.toString(); });
    await waitFor(
      () => existsSync(path.join(fixture.barrierDir, "swap-window-reached")),
      `runner never reached the exact swap window: ${runnerOutput}`,
    );

    // Old code is only in the current task's backup; the stale backup is
    // untouched and still sitting under a lexicographically earlier name.
    assert.equal(existsSync(path.join(fixture.rootDir, "dist", "index.js")), false);
    assert.equal(existsSync(path.join(fixture.backupDir, "dist", "index.js")), true);
    assert.equal(existsSync(path.join(staleDir, "dist", "index.js")), true);

    stop(runner);
    await waitFor(() => !processAlive(runner?.pid), "runner did not die after SIGKILL", 5_000);

    app = spawn(path.join(fixture.rootDir, "start-webspeak.sh"), [], {
      cwd: fixture.rootDir,
      env: { ...process.env, WEBSPEAK_DATA_DIR: fixture.dataDir },
      stdio: "ignore",
    });
    await waitFor(() => healthVersion(port).then(version => version === "0.3.2"), "launcher did not restore the current task's 0.3.2 build");

    // The current task's version, not the stale 0.1.0 build, is back in place.
    assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "0.3.2");
    assert.equal(readFileSync(path.join(fixture.rootDir, "dist", "index.js"), "utf8"), appScript());
    assert.equal(JSON.parse(readFileSync(path.join(staleDir, "package.json"), "utf8")).version, "0.1.0", "stale backup was not consumed");
    assert.equal(existsSync(path.join(staleDir, "dist", "index.js")), true, "stale backup is still intact");

    assert.deepEqual(JSON.parse(readFileSync(fixture.markerFiles.config, "utf8")), { port, startedFile: path.join(fixture.directory, "started.txt") });
    for (const [key, file] of Object.entries(fixture.markerFiles)) {
      if (key !== "config") assert.equal(readFileSync(file, "utf8"), `${key} preserved`, `${key} survived recovery`);
    }
  },
);
