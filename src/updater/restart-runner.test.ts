import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setCodeSwapCopyForTests } from "./code-swap.js";
import { runRestartPlan } from "./restart-runner.js";

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await sleep(50);
  }
}

function appScript(version: string, port: number, pidFile: string, status = "ok"): string {
  return `const http = require("node:http");
const { writeFileSync } = require("node:fs");
const server = http.createServer((request, response) => {
  if (request.url === "/api/health") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: ${JSON.stringify(status)}, version: ${JSON.stringify(version)} }));
    return;
  }
  response.statusCode = 404;
  response.end();
});
server.listen(${port}, "127.0.0.1", () => writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)));
process.on("SIGTERM", () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); });
`;
}

interface RunnerFixture {
  directory: string;
  rootDir: string;
  stagedRoot: string;
  backupDir: string;
  planPath: string;
  statePath: string;
  lockPath: string;
  pidFile: string;
  taskId: string;
}

function runnerFixture(t: TestContext): RunnerFixture {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-runner-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const rootDir = path.join(directory, "app");
  const stagedRoot = path.join(directory, "staged");
  const backupDir = path.join(directory, "backup");
  const statePath = path.join(directory, "data", "updates", "state.json");
  const lockPath = path.join(directory, "data", "updates", "update.lock");
  const taskId = "upd_runner_test";
  for (const directoryName of ["data", "config.json", "certs", "skins", "plugins"]) {
    const target = path.join(rootDir, directoryName);
    if (directoryName === "config.json") writeFileSync(target, JSON.stringify({ kept: true }));
    else {
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "marker.txt"), `${directoryName} preserved`);
    }
  }
  for (const [root, version] of [[rootDir, "1.0.0"], [stagedRoot, "2.0.0"]] as const) {
    mkdirSync(path.join(root, "dist"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
    writeFileSync(path.join(root, "dist", "index.js"), `// version marker ${version}\n`);
  }
  return {
    directory, rootDir, stagedRoot, backupDir, statePath, lockPath, taskId,
    pidFile: path.join(directory, "app.pid"),
    planPath: path.join(directory, "plan.json"),
  };
}

function writePlan(fixture: RunnerFixture, port: number, pidFile: string, options: { targetVersion: string; reportedVersion: string; reportedStatus?: string; healthTimeoutMs?: number }) {
  mkdirSync(path.dirname(fixture.statePath), { recursive: true });
  writeFileSync(fixture.lockPath, JSON.stringify({ pid: process.pid, taskId: fixture.taskId, createdAt: new Date().toISOString() }));
  writeFileSync(path.join(fixture.stagedRoot, "dist", "index.js"), appScript(options.reportedVersion, port, pidFile, options.reportedStatus));
  writeFileSync(fixture.planPath, JSON.stringify({
    schemaVersion: 1,
    taskId: fixture.taskId,
    rootDir: fixture.rootDir,
    statePath: fixture.statePath,
    lockPath: fixture.lockPath,
    stagedRoot: fixture.stagedRoot,
    backupDir: fixture.backupDir,
    fromVersion: "1.0.0",
    targetVersion: options.targetVersion,
    nodePath: process.execPath,
    appEntry: path.join(fixture.rootDir, "dist", "index.js"),
    health: { protocol: "http", port, path: "/api/health" },
    waitForPid: null,
    parentTimeoutMs: 2_000,
    healthTimeoutMs: options.healthTimeoutMs ?? 1_500,
    pollIntervalMs: 50,
    appLogPath: path.join(fixture.directory, "app.log"),
  }, null, 2));
}

async function stopPidFile(pidFile: string): Promise<void> {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid, "SIGTERM"); } catch { /* Already gone. */ }
    for (let attempt = 0; attempt < 40; attempt++) {
      try { process.kill(pid, 0); await sleep(50); }
      catch { return; }
    }
    try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ }
  }
}

test("a runner refused by another lock owner leaves its files and state untouched", async t => {
  const fixture = runnerFixture(t);
  writePlan(fixture, await availablePort(), fixture.pidFile, { targetVersion: "2.0.0", reportedVersion: "2.0.0" });
  const owner = JSON.stringify({ pid: process.pid, taskId: "recovery_owner", createdAt: new Date().toISOString() });
  writeFileSync(fixture.lockPath, owner);
  writeFileSync(fixture.statePath, JSON.stringify({ schemaVersion: 1, task: null }));
  const before = readFileSync(fixture.statePath, "utf8");
  assert.equal(await runRestartPlan(fixture.planPath), 1);
  assert.equal(readFileSync(fixture.statePath, "utf8"), before);
  assert.equal(readFileSync(fixture.lockPath, "utf8"), owner);
  assert.equal(existsSync(fixture.backupDir), false);
  assert.equal(existsSync(fixture.pidFile), false);
  assert.equal(JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version, "1.0.0");
});

test("a healthy target version completes the swap and leaves persistent state alone", { timeout: 20_000 }, async t => {
  const fixture = runnerFixture(t);
  const port = await availablePort();
  writePlan(fixture, port, fixture.pidFile, { targetVersion: "2.0.0", reportedVersion: "2.0.0" });
  t.after(() => stopPidFile(fixture.pidFile));

  assert.equal(await runRestartPlan(fixture.planPath), 0);
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
  assert.equal(state.task.status, "succeeded");
  assert.equal(state.task.finishedAt === null, false);
  assert.deepEqual(state.task.steps.map((step: { name: string; status: string }) => [step.name, step.status]), [
    ["restart", "succeeded"],
    ["swap", "succeeded"],
  ]);
  assert.match(readFileSync(path.join(fixture.rootDir, "dist", "index.js"), "utf8"), /version: "2\.0\.0"/);
  assert.match(readFileSync(path.join(fixture.backupDir, "dist", "index.js"), "utf8"), /version marker 1\.0\.0/);
  for (const directoryName of ["data", "certs", "skins", "plugins"]) {
    assert.equal(readFileSync(path.join(fixture.rootDir, directoryName, "marker.txt"), "utf8"), `${directoryName} preserved`);
  }
  assert.deepEqual(JSON.parse(readFileSync(path.join(fixture.rootDir, "config.json"), "utf8")), { kept: true });
  assert.equal(existsSync(fixture.lockPath), false);
  assert.equal(existsSync(fixture.stagedRoot), false);
  await waitFor(() => existsSync(fixture.pidFile));
});

test("a failed in-process rollback is persisted as a rollback failure", { timeout: 20_000 }, async t => {
  const fixture = runnerFixture(t);
  const port = await availablePort();
  writePlan(fixture, port, fixture.pidFile, { targetVersion: "2.0.0", reportedVersion: "2.0.0" });
  const originalRename = fs.renameSync;
  t.after(() => {
    fs.renameSync = originalRename;
    syncBuiltinESMExports();
    setCodeSwapCopyForTests(null);
  });
  const exdev = () => Object.assign(new Error("cross-device link"), { code: "EXDEV" });
  fs.renameSync = ((from, to) => {
    if (from === path.join(fixture.rootDir, "dist") && to === path.join(fixture.backupDir, "dist")) throw exdev();
    if (from === path.join(fixture.stagedRoot, "dist") && to === path.join(fixture.rootDir, "dist")) throw new Error("simulated staging failure");
    if (from === path.join(fixture.backupDir, "dist") && to === path.join(fixture.rootDir, "dist")) throw exdev();
    return originalRename(from, to);
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  let copies = 0;
  setCodeSwapCopyForTests((from, to) => {
    copies += 1;
    if (copies === 2) throw new Error("simulated rollback copy failure");
    fs.cpSync(from, to, { recursive: true });
  });

  assert.equal(await runRestartPlan(fixture.planPath), 1);
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
  assert.equal(state.task.status, "failed");
  assert.equal(state.task.rolledBack, false);
  assert.equal(state.task.errorCode, "UPDATE_ROLLBACK_FAILED");
  assert.equal(existsSync(path.join(fixture.rootDir, "dist", "index.js")), false);
  assert.equal(existsSync(path.join(fixture.backupDir, "dist", "index.js")), true);
});

test("a target reporting the expected version with an error status is not accepted as healthy", { timeout: 20_000 }, async t => {
  const fixture = runnerFixture(t);
  const port = await availablePort();
  writePlan(fixture, port, fixture.pidFile, {
    targetVersion: "2.0.0", reportedVersion: "2.0.0", reportedStatus: "error", healthTimeoutMs: 500,
  });
  writeFileSync(path.join(fixture.rootDir, "dist", "index.js"), appScript("1.0.0", port, fixture.pidFile));
  t.after(() => stopPidFile(fixture.pidFile));

  assert.equal(await runRestartPlan(fixture.planPath), 1);
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
  assert.equal(state.task.status, "failed");
  assert.equal(state.task.rolledBack, true);
  assert.equal(state.task.errorCode, "UPDATE_HEALTH_CHECK_FAILED");
  assert.match(readFileSync(path.join(fixture.rootDir, "dist", "index.js"), "utf8"), /version: "1\.0\.0"/);
});

test("a failed health check rolls back to the previous code and reports the failure", { timeout: 20_000 }, async t => {
  const fixture = runnerFixture(t);
  const port = await availablePort();
  writePlan(fixture, port, fixture.pidFile, { targetVersion: "2.0.0", reportedVersion: "9.9.9", healthTimeoutMs: 800 });
  writeFileSync(path.join(fixture.rootDir, "dist", "index.js"), appScript("1.0.0", port, fixture.pidFile));
  // Simulate the previous process still serving while the runner takes over.
  const previous = spawn(process.execPath, [path.join(fixture.rootDir, "dist", "index.js")], { stdio: "ignore", detached: true });
  previous.unref();
  t.after(async () => { await stopPidFile(fixture.pidFile); try { previous.kill("SIGKILL"); } catch { /* Exited. */ } });
  await waitFor(() => existsSync(fixture.pidFile) && Number(readFileSync(fixture.pidFile, "utf8")) === previous.pid);

  assert.equal(await runRestartPlan(fixture.planPath), 1);
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
  assert.equal(state.task.status, "failed");
  assert.equal(state.task.rolledBack, true);
  assert.equal(state.task.errorCode, "UPDATE_HEALTH_CHECK_FAILED");
  assert.match(readFileSync(path.join(fixture.rootDir, "dist", "index.js"), "utf8"), /version: "1\.0\.0"/);
  assert.match(readFileSync(path.join(fixture.backupDir, "rejected", "dist", "index.js"), "utf8"), /version: "9\.9\.9"/);
  for (const directoryName of ["data", "certs", "skins", "plugins"]) {
    assert.equal(readFileSync(path.join(fixture.rootDir, directoryName, "marker.txt"), "utf8"), `${directoryName} preserved`);
  }
  assert.deepEqual(JSON.parse(readFileSync(path.join(fixture.rootDir, "config.json"), "utf8")), { kept: true });
  assert.equal(existsSync(fixture.lockPath), false);
});
