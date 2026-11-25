import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { UpdateTaskView } from "../shared/update.js";
import {
  acquireUpdateLock, clearStaleUpdateLock, emptyUpdateState, isActiveTaskStatus, readUpdateState,
  reconcileInterruptedState, takeOverUpdateLock, UpdateLockedError, updateLockIsHeld, writeUpdateState,
} from "./update-state.js";

function workspace(t: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-state-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function task(overrides: Partial<UpdateTaskView> = {}): UpdateTaskView {
  return {
    id: "upd_test",
    status: "restarting",
    fromVersion: "0.3.2",
    targetVersion: "0.4.0",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    rolledBack: false,
    steps: [{ name: "swap", status: "running", at: "2026-01-01T00:00:00.000Z" }],
    ...overrides,
  };
}

/** A second process that stays alive while a lock records its pid. */
async function liveProcess(t: TestContext): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  t.after(() => { try { child.kill("SIGKILL"); } catch { /* Already gone. */ } });
  await once(child, "spawn");
  return child;
}

test("state files round-trip and malformed files fall back to idle", t => {
  const directory = workspace(t), filename = path.join(directory, "state.json");
  assert.deepEqual(readUpdateState(filename), emptyUpdateState());
  writeUpdateState(filename, { schemaVersion: 1, task: task() });
  const loaded = readUpdateState(filename);
  assert.equal(loaded.task?.id, "upd_test");
  assert.deepEqual(loaded.task?.steps, [{ name: "swap", status: "running", at: "2026-01-01T00:00:00.000Z" }]);
  for (const contents of ["not json", "{}", JSON.stringify({ schemaVersion: 2, task: task() }), JSON.stringify({ schemaVersion: 1, task: { id: 42 } })]) {
    writeFileSync(filename, contents);
    assert.deepEqual(readUpdateState(filename), emptyUpdateState());
  }
});

test("interrupted tasks reconcile against the version that is actually running", () => {
  const completed = { schemaVersion: 1 as const, task: task({ targetVersion: "0.4.0" }) };
  assert.equal(reconcileInterruptedState(completed, "0.4.0", "2026-01-01T01:00:00.000Z"), true);
  assert.equal(completed.task?.status, "succeeded");
  assert.equal(completed.task?.finishedAt, "2026-01-01T01:00:00.000Z");

  const interrupted = { schemaVersion: 1 as const, task: task({ targetVersion: "0.4.0" }) };
  assert.equal(reconcileInterruptedState(interrupted, "0.3.2", "2026-01-01T01:00:00.000Z"), true);
  assert.equal(interrupted.task?.status, "failed");
  assert.equal(interrupted.task?.errorCode, "UPDATE_INTERRUPTED");

  const finished = { schemaVersion: 1 as const, task: task({ status: "succeeded" as const }) };
  assert.equal(reconcileInterruptedState(finished, "0.3.2", "2026-01-01T01:00:00.000Z"), false);
  assert.equal(isActiveTaskStatus("downloading"), true);
  assert.equal(isActiveTaskStatus("failed"), false);
});

test("the update lock is exclusive and safe to release", t => {
  const directory = workspace(t), lock = path.join(directory, "update.lock");
  const release = acquireUpdateLock(lock, "task-one");
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).taskId, "task-one");
  assert.throws(() => acquireUpdateLock(lock, "task-two"), (error: unknown) => error instanceof UpdateLockedError);
  release();
  assert.equal(existsSync(lock), false);
  const second = acquireUpdateLock(lock, "task-two");
  second();
  assert.equal(existsSync(lock), false);
});

test("locks left by dead processes are reclaimed while live locks are preserved", t => {
  const directory = workspace(t), lock = path.join(directory, "update.lock");
  writeFileSync(lock, JSON.stringify({ pid: 0, taskId: "dead-task", createdAt: "2026-01-01T00:00:00.000Z" }));
  const release = acquireUpdateLock(lock, "new-task");
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).taskId, "new-task");
  release();

  writeFileSync(lock, JSON.stringify({ pid: process.pid, taskId: "live-task", createdAt: "2026-01-01T00:00:00.000Z" }));
  clearStaleUpdateLock(lock);
  assert.equal(existsSync(lock), true);
  writeFileSync(lock, JSON.stringify({ pid: 0, taskId: "dead-task", createdAt: "2026-01-01T00:00:00.000Z" }));
  clearStaleUpdateLock(lock);
  assert.equal(existsSync(lock), false);
});

test("a live lock and an unreadable lock are never cleared, and count as held", async t => {
  const directory = workspace(t), lock = path.join(directory, "update.lock");
  const owner = await liveProcess(t);
  writeFileSync(lock, JSON.stringify({ pid: owner.pid, taskId: "live-task", createdAt: "2026-01-01T00:00:00.000Z" }));
  clearStaleUpdateLock(lock);
  assert.equal(existsSync(lock), true);
  assert.equal(updateLockIsHeld(lock), true);
  assert.equal(updateLockIsHeld(lock, "live-task"), true);
  assert.equal(updateLockIsHeld(lock, "other-task"), false);
  assert.throws(() => acquireUpdateLock(lock, "new-task"), (error: unknown) => error instanceof UpdateLockedError);

  // A lock that cannot be parsed may belong to a live owner, so it must not
  // be deleted and must conservatively block new updates.
  writeFileSync(lock, "not a lock record");
  clearStaleUpdateLock(lock);
  assert.equal(existsSync(lock), true);
  assert.equal(updateLockIsHeld(lock), true);
  assert.throws(() => acquireUpdateLock(lock, "new-task"), (error: unknown) => error instanceof UpdateLockedError);
});

test("a lock left by a dead process is reported free and reclaimed", t => {
  const directory = workspace(t), lock = path.join(directory, "update.lock");
  writeFileSync(lock, JSON.stringify({ pid: 0, taskId: "dead-task", createdAt: "2026-01-01T00:00:00.000Z" }));
  assert.equal(updateLockIsHeld(lock), false);
  clearStaleUpdateLock(lock);
  assert.equal(existsSync(lock), false);
  const release = acquireUpdateLock(lock, "new-task");
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).taskId, "new-task");
  release();
});

test("the restart runner can take over its own task but never another task's lock", async t => {
  const directory = workspace(t), lock = path.join(directory, "update.lock");
  const previousOwner = await liveProcess(t);
  writeFileSync(lock, JSON.stringify({ pid: previousOwner.pid, taskId: "task-shared", createdAt: "2026-01-01T00:00:00.000Z" }));
  assert.doesNotThrow(() => process.kill(previousOwner.pid!, 0), "the original owner is still alive");

  const release = takeOverUpdateLock(lock, "task-shared");
  const record = JSON.parse(readFileSync(lock, "utf8"));
  assert.equal(record.pid, process.pid);
  assert.equal(record.taskId, "task-shared");
  assert.equal(updateLockIsHeld(lock, "task-shared"), true);
  release();
  assert.equal(existsSync(lock), false);

  writeFileSync(lock, JSON.stringify({ pid: previousOwner.pid, taskId: "task-other", createdAt: "2026-01-01T00:00:00.000Z" }));
  assert.throws(() => takeOverUpdateLock(lock, "task-shared"), (error: unknown) => error instanceof UpdateLockedError);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).taskId, "task-other");
  assert.equal(updateLockIsHeld(lock, "task-other"), true);
});

test("state writes replace the destination atomically", t => {
  const directory = workspace(t), filename = path.join(directory, "nested", "state.json");
  writeUpdateState(filename, { schemaVersion: 1, task: task({ id: "first" }) });
  writeUpdateState(filename, { schemaVersion: 1, task: task({ id: "second" }) });
  assert.equal(readUpdateState(filename).task?.id, "second");
  assert.equal(existsSync(`${filename}.${process.pid}.tmp`), false);
});
