import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { UpdateTaskView } from "../shared/update.js";
import {
  acquireUpdateLock, clearStaleUpdateLock, emptyUpdateState, isActiveTaskStatus, readUpdateState,
  reconcileInterruptedState, UpdateLockedError, writeUpdateState,
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

test("state writes replace the destination atomically", t => {
  const directory = workspace(t), filename = path.join(directory, "nested", "state.json");
  writeUpdateState(filename, { schemaVersion: 1, task: task({ id: "first" }) });
  writeUpdateState(filename, { schemaVersion: 1, task: task({ id: "second" }) });
  assert.equal(readUpdateState(filename).task?.id, "second");
  assert.equal(existsSync(`${filename}.${process.pid}.tmp`), false);
});
