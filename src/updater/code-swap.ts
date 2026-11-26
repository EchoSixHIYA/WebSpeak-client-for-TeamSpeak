import { randomBytes } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseStableVersion } from "./version.js";

/**
 * Only package code is ever moved. Persistent state (data/, config.json,
 * certs/) is deliberately absent from this list.
 */
export const CODE_ENTRIES = [
  "dist",
  "web/dist",
  "node_modules",
  "runtime",
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "config.example.json",
  // start-webspeak.sh is deliberately absent: the launcher must stay at the
  // install root for the whole swap so an interrupted update can still be
  // recovered by running ./start-webspeak.sh. It is installed atomically by
  // the updater before the runner swaps any code.
  "start-webspeak.cmd",
] as const;

export type CodeSwapErrorCode = "UPDATE_PACKAGE_INVALID" | "UPDATE_SWAP_FAILED" | "UPDATE_ROLLBACK_FAILED";

export class CodeSwapError extends Error {
  constructor(readonly code: CodeSwapErrorCode, message: string) {
    super(message);
    this.name = "CodeSwapError";
  }
}

export interface StagedPackageOptions {
  version: string;
  platform?: NodeJS.Platform;
}

function requireEntry(root: string, relative: string, kind: "file" | "directory"): void {
  const target = path.join(root, relative);
  let stats;
  try { stats = lstatSync(target); }
  catch { throw new CodeSwapError("UPDATE_PACKAGE_INVALID", `Release package is missing ${relative}.`); }
  if (stats.isSymbolicLink()) throw new CodeSwapError("UPDATE_PACKAGE_INVALID", `Release package entry ${relative} is a symbolic link.`);
  if (kind === "file" ? !stats.isFile() : !stats.isDirectory()) {
    throw new CodeSwapError("UPDATE_PACKAGE_INVALID", `Release package entry ${relative} has the wrong type.`);
  }
}

/** The extracted package must be a complete runnable release for this platform. */
export function validateStagedPackage(root: string, options: StagedPackageOptions): void {
  requireEntry(root, "dist/index.js", "file");
  requireEntry(root, "web/dist/index.html", "file");
  requireEntry(root, "node_modules", "directory");
  requireEntry(root, "package.json", "file");
  requireEntry(root, options.platform === "win32" ? "runtime/node.exe" : "runtime/node", "file");
  requireEntry(root, options.platform === "win32" ? "start-webspeak.cmd" : "start-webspeak.sh", "file");
  let manifest: unknown;
  try { manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")); }
  catch { throw new CodeSwapError("UPDATE_PACKAGE_INVALID", "Release package manifest is not valid JSON."); }
  const version = manifest && typeof manifest === "object" && !Array.isArray(manifest)
    ? (manifest as Record<string, unknown>).version
    : undefined;
  if (!parseStableVersion(version) || version !== options.version) {
    throw new CodeSwapError("UPDATE_PACKAGE_INVALID", "Release package version does not match the selected release.");
  }
}

/** Archives usually contain one wrapper directory; accept both layouts. */
export function locatePackageRoot(extractedDir: string, version: string, platform?: NodeJS.Platform): string {
  const entries = readdirSync(extractedDir, { withFileTypes: true });
  const root = entries.length === 1 && entries[0].isDirectory()
    ? path.join(extractedDir, entries[0].name)
    : extractedDir;
  if (!existsSync(path.join(root, "package.json"))) {
    throw new CodeSwapError("UPDATE_PACKAGE_INVALID", "Release package root was not found after extraction.");
  }
  validateStagedPackage(root, { version, platform });
  return root;
}

function moveEntry(from: string, to: string): void {
  try {
    renameSync(from, to);
    return;
  } catch (error) {
    // Staging and backups may live on another filesystem than the install
    // directory. A rename cannot cross devices, so fall back to a copy.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  // Copy into a temporary sibling first: a failure halfway through must
  // never leave a partial entry at `to`, because rollback would otherwise
  // mistake it for the complete previous version.
  const temporary = `${to}.copy-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    copyEntry(from, temporary);
    renameSync(temporary, to);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  // The copy is committed at `to`. Removing the source is cleanup only.
  try { rmSync(from, { recursive: true, force: true }); } catch { /* Source remains for later cleanup. */ }
}

type CopyEntry = (from: string, to: string) => void;

const defaultCopyEntry: CopyEntry = (from, to) => {
  cpSync(from, to, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
};

let copyEntry: CopyEntry = defaultCopyEntry;

/** Test seam for exercising a cross-device copy that fails halfway through. */
export function setCodeSwapCopyForTests(copy: CopyEntry | null): void {
  copyEntry = copy ?? defaultCopyEntry;
}

/**
 * Test-only fault-injection seam. When the named directory exists, the swap
 * pauses in the exact window between "old code moved aside" and "new code
 * moved in" so a test can SIGKILL the runner. Production never sets this
 * variable; it is a local barrier directory, not a URL or network switch.
 */
const SWAP_BARRIER_ENV = "WEBSPEAK_TEST_SWAP_BARRIER_DIR";

function swapWindowBarrier(entry?: string): void {
  const directory = process.env[SWAP_BARRIER_ENV];
  if (!directory || !existsSync(directory)) return;
  if ((process.env.WEBSPEAK_TEST_SWAP_BARRIER_AFTER_ENTRY ?? "") !== (entry ?? "")) return;
  writeFileSync(path.join(directory, "swap-window-reached"), String(process.pid));
  const resume = path.join(directory, "resume");
  const deadline = Date.now() + 30_000;
  const waiter = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(resume) && Date.now() < deadline) {
    Atomics.wait(waiter, 0, 0, 20);
  }
}

function moveIfPresent(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(path.dirname(to), { recursive: true });
  moveEntry(from, to);
}

/**
 * Backups written by this version journal each entry before moving it. The
 * journal may therefore contain an entry whose move never started, but it can
 * never omit an entry that reached the backup. Recovery acts only on entries
 * that actually exist in the backup, so a kill between journal and move is safe.
 */
const SWAP_MANIFEST = ".webspeak-swap.json";

function writeSwapManifest(backupDir: string, entries: string[]): void {
  const target = path.join(backupDir, SWAP_MANIFEST);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, entries }, null, 2), "utf8");
  renameSync(temporary, target);
}

function readSwapManifest(backupDir: string): Set<string> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(backupDir, SWAP_MANIFEST), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== 1 || !Array.isArray(record.entries)) return null;
    return new Set(record.entries.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return null;
  }
}

/**
 * Undo only the entries that this swap actually moved. The entry whose move
 * failed is left untouched: its source is still intact and no partial
 * destination exists.
 */
function restoreMovedEntries(rootDir: string, backupDir: string, movedToBackup: string[], movedToRoot: string[]): void {
  const rejected = path.join(backupDir, "rejected");
  for (const entry of [...movedToRoot].reverse()) {
    moveIfPresent(path.join(rootDir, entry), path.join(rejected, entry));
  }
  for (const entry of [...movedToBackup].reverse()) {
    const saved = path.join(backupDir, entry);
    if (!existsSync(saved)) continue;
    const current = path.join(rootDir, entry);
    if (existsSync(current)) moveIfPresent(current, path.join(rejected, entry));
    moveIfPresent(saved, current);
  }
}

/**
 * Move the previous code aside, then move the verified side-by-side package
 * into place. `data/`, `config.json` and `certs/` are never in CODE_ENTRIES.
 */
export function swapCode(rootDir: string, stagedRoot: string, backupDir: string): void {
  const movedToBackup: string[] = [];
  const movedToRoot: string[] = [];
  try {
    if (existsSync(backupDir)) throw new Error("Backup directory already exists.");
    mkdirSync(backupDir, { recursive: true });
    writeSwapManifest(backupDir, []);
    for (const entry of CODE_ENTRIES) {
      if (!existsSync(path.join(rootDir, entry))) continue;
      movedToBackup.push(entry);
      writeSwapManifest(backupDir, movedToBackup);
      moveIfPresent(path.join(rootDir, entry), path.join(backupDir, entry));
      swapWindowBarrier(entry);
    }
    swapWindowBarrier();
    for (const entry of CODE_ENTRIES) {
      if (!existsSync(path.join(stagedRoot, entry))) continue;
      moveIfPresent(path.join(stagedRoot, entry), path.join(rootDir, entry));
      movedToRoot.push(entry);
    }
  } catch (error) {
    try { restoreMovedEntries(rootDir, backupDir, movedToBackup, movedToRoot); }
    catch (rollbackError) {
      throw new CodeSwapError(
        "UPDATE_ROLLBACK_FAILED",
        `${error instanceof Error ? error.message : "Release package swap failed."} Code rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : "unknown error"}`,
      );
    }
    if (error instanceof CodeSwapError) throw error;
    throw new CodeSwapError("UPDATE_SWAP_FAILED", error instanceof Error ? error.message : "Release package swap failed.");
  }
}

/**
 * Restore the previous code. New code is moved aside instead of deleted so it
 * remains available for diagnostics. When a swap manifest exists, only
 * entries it proves were moved completely are considered.
 */
export function restoreCode(rootDir: string, backupDir: string): void {
  if (!existsSync(backupDir)) throw new CodeSwapError("UPDATE_ROLLBACK_FAILED", "Code backup directory is missing.");
  const manifest = readSwapManifest(backupDir);
  const rejected = path.join(backupDir, "rejected");
  try {
    for (const entry of CODE_ENTRIES) {
      if (manifest && !manifest.has(entry)) continue;
      const current = path.join(rootDir, entry);
      if (existsSync(current) && existsSync(path.join(backupDir, entry))) {
        moveIfPresent(current, path.join(rejected, entry));
      }
    }
    for (const entry of CODE_ENTRIES) {
      if (manifest && !manifest.has(entry)) continue;
      moveIfPresent(path.join(backupDir, entry), path.join(rootDir, entry));
    }
  } catch (error) {
    throw new CodeSwapError("UPDATE_ROLLBACK_FAILED", error instanceof Error ? error.message : "Code rollback failed.");
  }
}

export function removeStagingDirectory(directory: string): void {
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* Best-effort cleanup. */ }
}
