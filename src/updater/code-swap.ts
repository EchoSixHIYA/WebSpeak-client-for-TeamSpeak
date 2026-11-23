import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
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
  "start-webspeak.sh",
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
  } catch (error) {
    // Staging and backups may live on another filesystem than the install
    // directory. A rename cannot cross devices, so fall back to a copy that
    // only removes the source once the copy has completed.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    cpSync(from, to, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
    rmSync(from, { recursive: true, force: true });
  }
}

function moveIfPresent(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(path.dirname(to), { recursive: true });
  moveEntry(from, to);
}

/**
 * Move the previous code aside, then move the verified side-by-side package
 * into place. `data/`, `config.json` and `certs/` are never in CODE_ENTRIES.
 */
export function swapCode(rootDir: string, stagedRoot: string, backupDir: string): void {
  try {
    if (existsSync(backupDir)) throw new Error("Backup directory already exists.");
    mkdirSync(backupDir, { recursive: true });
    for (const entry of CODE_ENTRIES) moveIfPresent(path.join(rootDir, entry), path.join(backupDir, entry));
    for (const entry of CODE_ENTRIES) moveIfPresent(path.join(stagedRoot, entry), path.join(rootDir, entry));
  } catch (error) {
    try { restoreCode(rootDir, backupDir); }
    catch { /* Report the original swap error; rollback failure is handled by the caller. */ }
    if (error instanceof CodeSwapError) throw error;
    throw new CodeSwapError("UPDATE_SWAP_FAILED", error instanceof Error ? error.message : "Release package swap failed.");
  }
}

/**
 * Restore the previous code. New code is moved aside instead of deleted so it
 * remains available for diagnostics.
 */
export function restoreCode(rootDir: string, backupDir: string): void {
  if (!existsSync(backupDir)) throw new CodeSwapError("UPDATE_ROLLBACK_FAILED", "Code backup directory is missing.");
  const rejected = path.join(backupDir, "rejected");
  try {
    for (const entry of CODE_ENTRIES) {
      const current = path.join(rootDir, entry);
      if (existsSync(current) && existsSync(path.join(backupDir, entry))) {
        moveIfPresent(current, path.join(rejected, entry));
      }
    }
    for (const entry of CODE_ENTRIES) moveIfPresent(path.join(backupDir, entry), path.join(rootDir, entry));
  } catch (error) {
    throw new CodeSwapError("UPDATE_ROLLBACK_FAILED", error instanceof Error ? error.message : "Code rollback failed.");
  }
}

export function removeStagingDirectory(directory: string): void {
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* Best-effort cleanup. */ }
}
