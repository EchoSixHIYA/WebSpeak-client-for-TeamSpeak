import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodeSwapError, restoreCode, swapCode } from "./code-swap.js";
import { takeOverUpdateLock } from "./update-state.js";
import type { PersistedUpdateState } from "./update-state.js";
import type { UpdateTaskView } from "../shared/update.js";

export interface RestartPlan {
  schemaVersion: 1;
  taskId: string;
  rootDir: string;
  statePath: string;
  lockPath: string;
  stagedRoot: string;
  backupDir: string;
  fromVersion: string;
  targetVersion: string;
  /** Absolute path to the runtime bundled with the package (or a test stub). */
  nodePath: string;
  /** Absolute path to dist/index.js after the swap. */
  appEntry: string;
  health: { protocol: "http" | "https"; port: number; path: string };
  waitForPid: number | null;
  parentTimeoutMs: number;
  healthTimeoutMs: number;
  pollIntervalMs: number;
  appLogPath: string;
}

class RunnerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RunnerError";
  }
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function readPlan(planPath: string): RestartPlan {
  const parsed: unknown = JSON.parse(readFileSync(planPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RunnerError("UPDATE_PLAN_INVALID", "Restart plan is invalid.");
  const plan = parsed as Record<string, unknown>;
  if (plan.schemaVersion !== 1
    || typeof plan.taskId !== "string"
    || typeof plan.rootDir !== "string"
    || typeof plan.statePath !== "string"
    || typeof plan.lockPath !== "string"
    || typeof plan.stagedRoot !== "string"
    || typeof plan.backupDir !== "string"
    || typeof plan.fromVersion !== "string"
    || typeof plan.targetVersion !== "string"
    || typeof plan.nodePath !== "string"
    || typeof plan.appEntry !== "string"
    || !plan.health || typeof plan.health !== "object") {
    throw new RunnerError("UPDATE_PLAN_INVALID", "Restart plan is incomplete.");
  }
  const health = plan.health as Record<string, unknown>;
  return {
    schemaVersion: 1,
    taskId: plan.taskId,
    rootDir: plan.rootDir,
    statePath: plan.statePath,
    lockPath: plan.lockPath,
    stagedRoot: plan.stagedRoot,
    backupDir: plan.backupDir,
    fromVersion: plan.fromVersion,
    targetVersion: plan.targetVersion,
    nodePath: plan.nodePath,
    appEntry: plan.appEntry,
    health: {
      protocol: health.protocol === "https" ? "https" : "http",
      port: typeof health.port === "number" ? health.port : 3040,
      path: typeof health.path === "string" ? health.path : "/api/health",
    },
    waitForPid: typeof plan.waitForPid === "number" && Number.isFinite(plan.waitForPid) ? plan.waitForPid : null,
    parentTimeoutMs: typeof plan.parentTimeoutMs === "number" ? plan.parentTimeoutMs : 60_000,
    healthTimeoutMs: typeof plan.healthTimeoutMs === "number" ? plan.healthTimeoutMs : 90_000,
    pollIntervalMs: typeof plan.pollIntervalMs === "number" ? plan.pollIntervalMs : 500,
    appLogPath: typeof plan.appLogPath === "string" ? plan.appLogPath : path.join(path.dirname(plan.statePath), "app.log"),
  };
}

function loadState(plan: RestartPlan): PersistedUpdateState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(plan.statePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>).schemaVersion === 1
      && (parsed as Record<string, unknown>).task
      && typeof (parsed as Record<string, unknown>).task === "object"
      && ((parsed as { task: { id?: unknown } }).task.id === plan.taskId)) {
      return parsed as PersistedUpdateState;
    }
  } catch { /* Build a task below. */ }
  return {
    schemaVersion: 1,
    task: {
      id: plan.taskId,
      status: "restarting",
      fromVersion: plan.fromVersion,
      targetVersion: plan.targetVersion,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      rolledBack: false,
      steps: [],
    },
  };
}

class StateWriter {
  private state: PersistedUpdateState;
  constructor(private readonly plan: RestartPlan) {
    this.state = loadState(plan);
  }
  private write(): void {
    const task = this.state.task!;
    task.updatedAt = new Date().toISOString();
    mkdirSync(path.dirname(this.plan.statePath), { recursive: true });
    const temporary = `${this.plan.statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(temporary, this.plan.statePath);
  }
  get task(): UpdateTaskView {
    return this.state.task!;
  }
  step(name: string, status: UpdateTaskView["steps"][number]["status"], detail?: string): void {
    const task = this.state.task!;
    const existing = task.steps.find((step) => step.name === name);
    const at = new Date().toISOString();
    if (existing) {
      existing.status = status;
      existing.at = at;
      if (detail) existing.detail = detail;
    } else {
      task.steps.push({ name, status, at, ...(detail ? { detail } : {}) });
    }
    this.write();
  }
  status(status: UpdateTaskView["status"], error?: { code: string; message: string }): void {
    const task = this.state.task!;
    task.status = status;
    if (error) {
      task.errorCode = error.code;
      task.errorMessage = error.message;
    }
    if (status === "succeeded" || status === "failed") task.finishedAt = new Date().toISOString();
    this.write();
  }
  rolledBack(value: boolean): void {
    this.state.task!.rolledBack = value;
    this.write();
  }
}

function processAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForParent(pid: number | null, timeoutMs: number): Promise<void> {
  if (!pid) return;
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid)) {
    if (Date.now() > deadline) throw new RunnerError("UPDATE_RESTART_TIMEOUT", "The previous process did not stop in time.");
    await sleep(100);
  }
}

interface HealthResponse {
  status?: string;
  version?: string;
}

function probeHealth(plan: RestartPlan): Promise<HealthResponse | null> {
  return new Promise((resolve) => {
    const client = plan.health.protocol === "https" ? https : http;
    const request = client.get({
      hostname: "127.0.0.1",
      port: plan.health.port,
      path: plan.health.path,
      timeout: 2_000,
      ...(plan.health.protocol === "https" ? { rejectUnauthorized: false } : {}),
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); resolve(null); return; }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { if (body.length < 64 * 1024) body += chunk; });
      response.on("end", () => {
        try {
          const parsed: unknown = JSON.parse(body);
          resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as HealthResponse : null);
        } catch { resolve(null); }
      });
      response.on("error", () => resolve(null));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

async function waitForVersion(plan: RestartPlan, version: string, timeoutMs: number): Promise<HealthResponse | null> {
  const deadline = Date.now() + timeoutMs;
  let last: HealthResponse | null = null;
  while (Date.now() < deadline) {
    last = await probeHealth(plan);
    if (last?.status === "ok" && last.version === version) return last;
    await sleep(plan.pollIntervalMs);
  }
  return null;
}

function startApp(plan: RestartPlan): ChildProcess {
  mkdirSync(path.dirname(plan.appLogPath), { recursive: true });
  const log = openSync(plan.appLogPath, "a");
  try {
    const child = spawn(plan.nodePath, [plan.appEntry], {
      cwd: plan.rootDir,
      env: process.env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    return child;
  } finally {
    closeSync(log);
  }
}

async function ensureApp(plan: RestartPlan, expectedVersion: string): Promise<boolean> {
  let healthy = await waitForVersion(plan, expectedVersion, Math.min(5_000, plan.healthTimeoutMs));
  if (healthy) return true;
  let child: ChildProcess | undefined;
  try {
    child = startApp(plan);
    healthy = await waitForVersion(plan, expectedVersion, plan.healthTimeoutMs);
    if (healthy) return true;
    await stopApp(child);
    return false;
  } finally {
    child?.unref();
  }
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopApp(child: ChildProcess | undefined): Promise<void> {
  if (!child || exited(child)) return;
  try { child.kill("SIGTERM"); } catch { /* Already gone. */ }
  const deadline = Date.now() + 6_000;
  while (!exited(child) && Date.now() < deadline) await sleep(100);
  if (exited(child)) return;
  try { child.kill("SIGKILL"); } catch { /* Already gone. */ }
  const hardDeadline = Date.now() + 2_000;
  while (!exited(child) && Date.now() < hardDeadline) await sleep(100);
}

export async function runRestartPlan(planPath: string): Promise<number> {
  const plan = readPlan(planPath);
  const state = new StateWriter(plan);
  let swapped = false;
  let newApp: ChildProcess | undefined;
  state.status("restarting");
  state.step("restart", "running");
  // Take over the update lock before doing anything else. The parent process
  // is about to exit and its lock would otherwise have a dead pid, letting a
  // second instance starting in this window roll the healthy code back.
  let releaseLock: (() => void) | null = null;
  try {
    try {
      releaseLock = takeOverUpdateLock(plan.lockPath, plan.taskId);
    } catch (error) {
      throw new RunnerError("UPDATE_LOCK_FAILED", error instanceof Error ? error.message : "The update lock could not be taken over.");
    }
    await waitForParent(plan.waitForPid, plan.parentTimeoutMs);
    state.step("swap", "running");
    swapCode(plan.rootDir, plan.stagedRoot, plan.backupDir);
    swapped = true;
    state.step("swap", "succeeded");
    let healthy = await waitForVersion(plan, plan.targetVersion, Math.min(5_000, plan.healthTimeoutMs));
    if (!healthy) {
      newApp = startApp(plan);
      healthy = await waitForVersion(plan, plan.targetVersion, plan.healthTimeoutMs);
    }
    if (!healthy) throw new RunnerError("UPDATE_HEALTH_CHECK_FAILED", `The updated version did not report ${plan.targetVersion} on /api/health.`);
    state.step("restart", "succeeded");
    state.status("succeeded");
    releaseLock();
    releaseLock = null;
    try { rmSync(plan.stagedRoot, { recursive: true, force: true }); } catch { /* Best effort. */ }
    return 0;
  } catch (error) {
    await stopApp(newApp);
    const code = error instanceof RunnerError || error instanceof CodeSwapError
      ? error.code
      : "UPDATE_RESTART_FAILED";
    const message = error instanceof Error ? error.message : "The update could not be completed.";
    state.step("restart", "failed", message);
    if (!swapped && code === "UPDATE_ROLLBACK_FAILED") {
      state.rolledBack(false);
      state.status("failed", { code, message });
      releaseLock?.();
      return 1;
    }
    let rolledBack = !swapped;
    if (swapped) {
      state.step("rollback", "running");
      try {
        restoreCode(plan.rootDir, plan.backupDir);
        state.step("rollback", "succeeded");
        rolledBack = true;
      } catch (rollbackError) {
        state.step("rollback", "failed", rollbackError instanceof Error ? rollbackError.message : "Code rollback failed.");
        state.rolledBack(false);
        state.status("failed", { code: "UPDATE_ROLLBACK_FAILED", message: `${message} Code rollback also failed.` });
        releaseLock?.();
        return 1;
      }
    }
    const healthy = await ensureApp(plan, plan.fromVersion);
    state.rolledBack(rolledBack);
    if (!healthy) {
      state.status("failed", { code: "UPDATE_ROLLBACK_HEALTH_FAILED", message: `${message} The previous version did not become healthy.` });
    } else {
      state.status("failed", { code, message });
    }
    releaseLock?.();
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("Usage: restart-runner <plan.json>");
    process.exit(2);
  }
  runRestartPlan(planPath)
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
