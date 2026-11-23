import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UpdateTaskStatus, UpdateTaskView } from "../shared/update.js";

export interface PersistedUpdateState {
  schemaVersion: 1;
  task: UpdateTaskView | null;
}

export interface UpdateLockRecord {
  pid: number;
  taskId: string;
  createdAt: string;
}

export class UpdateLockedError extends Error {
  readonly code = "UPDATE_IN_PROGRESS";
  constructor(message = "Another update task is already running.") {
    super(message);
    this.name = "UpdateLockedError";
  }
}

const ACTIVE_STATUSES: UpdateTaskStatus[] = ["downloading", "verifying", "extracting", "staging", "restarting"];

export function isActiveTaskStatus(status: UpdateTaskStatus | string): boolean {
  return (ACTIVE_STATUSES as string[]).includes(status);
}

export function emptyUpdateState(): PersistedUpdateState {
  return { schemaVersion: 1, task: null };
}

export function readUpdateState(filename: string): PersistedUpdateState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filename, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyUpdateState();
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== 1) return emptyUpdateState();
    return { schemaVersion: 1, task: parseTask(record.task) };
  } catch {
    return emptyUpdateState();
  }
}

function parseTask(value: unknown): UpdateTaskView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const task = value as Record<string, unknown>;
  if (typeof task.id !== "string" || !task.id
    || typeof task.status !== "string"
    || typeof task.fromVersion !== "string"
    || typeof task.targetVersion !== "string"
    || typeof task.startedAt !== "string"
    || typeof task.updatedAt !== "string") return null;
  return {
    id: task.id,
    status: task.status as UpdateTaskStatus,
    fromVersion: task.fromVersion,
    targetVersion: task.targetVersion,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    finishedAt: typeof task.finishedAt === "string" ? task.finishedAt : null,
    errorCode: typeof task.errorCode === "string" ? task.errorCode : null,
    errorMessage: typeof task.errorMessage === "string" ? task.errorMessage : null,
    rolledBack: task.rolledBack === true,
    steps: Array.isArray(task.steps)
      ? task.steps.filter((step): step is UpdateTaskView["steps"][number] => Boolean(step)
        && typeof step === "object"
        && !Array.isArray(step)
        && typeof (step as Record<string, unknown>).name === "string"
        && typeof (step as Record<string, unknown>).status === "string"
        && typeof (step as Record<string, unknown>).at === "string")
        .map((step) => ({
          name: step.name,
          status: step.status,
          at: step.at,
          ...(typeof step.detail === "string" ? { detail: step.detail } : {}),
        }))
      : [],
  };
}

export function writeUpdateState(filename: string, state: PersistedUpdateState): void {
  mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filename);
}

/**
 * Reconcile a task that was active when the previous process stopped. If the
 * running version already matches the target the update completed; otherwise
 * it failed and is reported as interrupted.
 */
export function reconcileInterruptedState(state: PersistedUpdateState, currentVersion: string, now: string): boolean {
  const task = state.task;
  if (!task || !isActiveTaskStatus(task.status)) return false;
  if (task.targetVersion === currentVersion) {
    task.status = "succeeded";
    task.finishedAt = now;
    task.updatedAt = now;
    return true;
  }
  task.status = "failed";
  task.finishedAt = now;
  task.updatedAt = now;
  task.errorCode = "UPDATE_INTERRUPTED";
  task.errorMessage = "The process stopped before the update completed. The previous version is still running.";
  return true;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Cross-process mutex. Lock files written by a dead process are reclaimed so
 * a crash cannot permanently block the maintenance page.
 */
export function acquireUpdateLock(lockPath: string, taskId: string): () => void {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, taskId, createdAt: new Date().toISOString() } satisfies UpdateLockRecord);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return () => {
        try {
          const current = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<UpdateLockRecord>;
          if (current.taskId === taskId) unlinkSync(lockPath);
        } catch { /* The lock may already have been reclaimed. */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let current: Partial<UpdateLockRecord> = {};
      try { current = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<UpdateLockRecord>; } catch { /* Treat as stale. */ }
      const alive = processIsAlive(Number(current.pid));
      if (alive && current.taskId !== taskId) throw new UpdateLockedError();
      try { unlinkSync(lockPath); } catch { /* Another process reclaimed it first. */ }
    }
  }
  throw new UpdateLockedError();
}

export function clearStaleUpdateLock(lockPath: string): void {
  try {
    const current = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<UpdateLockRecord>;
    if (!processIsAlive(Number(current.pid))) unlinkSync(lockPath);
  } catch {
    try { if (existsSync(lockPath)) unlinkSync(lockPath); } catch { /* Best effort. */ }
  }
}

/** True when a live process still owns the lock, optionally for a specific task. */
export function updateLockIsHeld(lockPath: string, taskId?: string): boolean {
  try {
    const current = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<UpdateLockRecord>;
    if (!processIsAlive(Number(current.pid))) return false;
    return taskId === undefined || current.taskId === taskId;
  } catch {
    return false;
  }
}
