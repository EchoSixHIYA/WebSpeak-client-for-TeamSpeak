import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
  /** Opaque process start marker; guards against PID reuse where available. */
  processStart?: string | null;
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
 * Linux exposes the process start time in /proc/<pid>/stat. It is used only
 * as an extra guard against PID reuse: when it is unavailable (Windows,
 * macOS, restricted /proc) liveness falls back to the pid check alone and
 * never throws.
 */
function processStartMarker(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    // Field 3 is the state; starttime is field 22, i.e. index 19 here.
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

function parseLockRecord(raw: string): UpdateLockRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const pid = Number(record.pid);
    if (!Number.isInteger(pid) || pid < 0 || typeof record.taskId !== "string" || !record.taskId) return null;
    return {
      pid,
      taskId: record.taskId,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
      processStart: typeof record.processStart === "string" ? record.processStart : null,
    };
  } catch {
    return null;
  }
}

interface LockFile {
  raw: string;
  record: UpdateLockRecord | null;
}

/**
 * Missing lock => null. A lock that exists but cannot be read or parsed is
 * reported with `record: null`; callers must treat it as potentially held
 * rather than deleting a lock another process may still own.
 */
function readLockFile(lockPath: string): LockFile | null {
  try {
    const raw = readFileSync(lockPath, "utf8");
    return { raw, record: parseLockRecord(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { raw: "", record: null };
  }
}

function lockOwnerIsAlive(record: UpdateLockRecord): boolean {
  if (!processIsAlive(record.pid)) return false;
  if (!record.processStart) return true;
  const current = processStartMarker(record.pid);
  // If the platform cannot report a start marker, keep the pid-only answer.
  return current === null || current === record.processStart;
}

function lockPayload(taskId: string): string {
  return JSON.stringify({
    pid: process.pid,
    taskId,
    createdAt: new Date().toISOString(),
    processStart: processStartMarker(process.pid),
  } satisfies UpdateLockRecord);
}

function releaseLock(lockPath: string, payload: string, taskId: string): () => void {
  return () => {
    const file = readLockFile(lockPath);
    // Never delete a lock that became unreadable or was replaced by another
    // process; only remove the exact record this process wrote.
    if (!file || !file.record || file.raw !== payload) return;
    if (file.record.taskId !== taskId || file.record.pid !== process.pid) return;
    try { unlinkSync(lockPath); } catch { /* Another process reclaimed it. */ }
  };
}

/** Remove a lock only after proving the observed record is dead and unchanged. */
function reclaimDeadLock(lockPath: string, observed: LockFile): void {
  const current = readLockFile(lockPath);
  if (!current || current.raw !== observed.raw) return;
  try { unlinkSync(lockPath); } catch { /* Another process reclaimed it. */ }
}

/**
 * Cross-process mutex. Lock files written by a dead process are reclaimed so
 * a crash cannot permanently block the maintenance page. A lock that cannot
 * be parsed is treated as held: refusing an update is safer than deleting a
 * live lock.
 */
export function acquireUpdateLock(lockPath: string, taskId: string): () => void {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = lockPayload(taskId);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      writeFileSync(lockPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return releaseLock(lockPath, payload, taskId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const file = readLockFile(lockPath);
      if (!file) continue;
      if (!file.record) {
        throw new UpdateLockedError("An unreadable update lock is present; refusing to start an update.");
      }
      if (file.record.pid === process.pid && file.record.taskId === taskId) {
        return releaseLock(lockPath, file.raw, taskId);
      }
      if (lockOwnerIsAlive(file.record)) throw new UpdateLockedError();
      reclaimDeadLock(lockPath, file);
    }
  }
  throw new UpdateLockedError();
}

/**
 * The restart runner inherits an update that its parent process started but
 * cannot finish. It must own the lock while it swaps and health-checks the
 * new code, otherwise a second instance starting in that window would see a
 * dead parent pid and roll the healthy code back.
 *
 * Only the same task may be taken over. A live lock for another task is
 * never stolen, and an unreadable lock is refused.
 */
export function takeOverUpdateLock(lockPath: string, taskId: string): () => void {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = lockPayload(taskId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const file = readLockFile(lockPath);
    if (!file) {
      try {
        writeFileSync(lockPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
        return releaseLock(lockPath, payload, taskId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
    }
    if (!file.record) {
      throw new UpdateLockedError("The update lock is unreadable; the restart runner will not take over.");
    }
    if (file.record.taskId !== taskId) {
      throw new UpdateLockedError("A different update task holds the lock; the restart runner will not steal it.");
    }
    const temporary = `${lockPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, lockPath);
      return releaseLock(lockPath, payload, taskId);
    } catch (error) {
      try { rmSync(temporary, { force: true }); } catch { /* Best effort. */ }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  throw new UpdateLockedError("The update lock could not be taken over.");
}

/**
 * Remove a lock only when its owner is provably dead. Unreadable locks are
 * left in place so a live owner is never deleted by mistake.
 */
export function clearStaleUpdateLock(lockPath: string): void {
  const file = readLockFile(lockPath);
  if (!file || !file.record) return;
  if (lockOwnerIsAlive(file.record)) return;
  reclaimDeadLock(lockPath, file);
}

/**
 * True when a live process still owns the lock, optionally for a specific
 * task. An unreadable lock is conservatively reported as held.
 */
export function updateLockIsHeld(lockPath: string, taskId?: string): boolean {
  const file = readLockFile(lockPath);
  if (!file) return false;
  if (!file.record) return true;
  if (!lockOwnerIsAlive(file.record)) return false;
  return taskId === undefined || file.record.taskId === taskId;
}
