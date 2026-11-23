import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync, copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "../logger.js";
import type { UpdateCheckView, UpdateReleaseView, UpdateStatusView, UpdateTaskStatus, UpdateTaskView } from "../shared/update.js";
import { ArchiveError, extractReleaseArchive } from "./archive.js";
import { CodeSwapError, locatePackageRoot, restoreCode } from "./code-swap.js";
import { detectDeployment, releaseAssetName, type DeploymentInfo } from "./deployment.js";
import {
  assertOfficialDownloadUrl, CHECKSUM_ASSET_NAME, GitHubReleaseSource, ReleaseSourceError,
  type OfficialRelease, type ReleaseAsset,
} from "./releases.js";
import {
  acquireUpdateLock, clearStaleUpdateLock, emptyUpdateState, isActiveTaskStatus, readUpdateState,
  reconcileInterruptedState, updateLockIsHeld, UpdateLockedError, writeUpdateState, type PersistedUpdateState,
} from "./update-state.js";
import { compareVersions, isNewerVersion, isValidVersion } from "./version.js";

export type UpdateErrorCode =
  | "UPDATE_IN_PROGRESS"
  | "UPDATE_NOT_SUPPORTED"
  | "UPDATE_VERSION_INVALID"
  | "UPDATE_VERSION_NOT_NEWER"
  | "UPDATE_VERSION_NOT_FOUND"
  | "UPDATE_CONFIRMATION_REQUIRED"
  | "UPDATE_ASSET_UNAVAILABLE"
  | "UPDATE_CHECKSUM_MISSING"
  | "UPDATE_CHECKSUM_MISMATCH"
  | "UPDATE_DIGEST_MISMATCH"
  | "UPDATE_DIGEST_UNSUPPORTED"
  | "UPDATE_DOWNLOAD_FAILED"
  | "UPDATE_DOWNLOAD_TOO_LARGE"
  | "UPDATE_ARCHIVE_UNSAFE"
  | "UPDATE_ARCHIVE_INVALID"
  | "UPDATE_ARCHIVE_LIMIT"
  | "UPDATE_ARCHIVE_UNSUPPORTED"
  | "UPDATE_PACKAGE_INVALID"
  | "UPDATE_SWAP_FAILED"
  | "UPDATE_ROLLBACK_FAILED"
  | "UPDATE_RELEASE_UNAVAILABLE"
  | "UPDATE_RUNNER_MISSING"
  | "UPDATE_RUNNER_FAILED"
  | "UPDATE_FAILED";

export class UpdateError extends Error {
  constructor(readonly code: UpdateErrorCode, message: string, readonly statusCode = 400) {
    super(message);
    this.name = "UpdateError";
  }
}

export interface UpdateServiceOptions {
  rootDir: string;
  dataDir: string;
  currentVersion: string;
  logger: Logger;
  port?: number;
  https?: boolean;
  platform?: NodeJS.Platform;
  architecture?: string;
  env?: NodeJS.ProcessEnv;
  isDocker?: boolean;
  fetch?: typeof fetch;
  apiBaseUrl?: string;
  repository?: string;
  now?: () => Date;
  /** Compiled directory containing the restart runner and its runtime imports. */
  runnerSourceDir?: string;
  /** Test seam replacing the detached runner spawn. */
  launchRunner?: (planPath: string, runnerDir: string) => Promise<void>;
  /** How long a freshly spawned runner must stay alive before apply succeeds. */
  runnerStartupTimeoutMs?: number;
  healthTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

const CHECKSUM_LIMIT = 1024 * 1024;
const DOWNLOAD_LIMIT = 512 * 1024 * 1024;

/**
 * Every local module the restart runner imports at runtime. The runner is
 * copied into an isolated directory under data/updates, so any omission here
 * makes Node fail with ERR_MODULE_NOT_FOUND before the helper can swap code.
 */
const RUNNER_RUNTIME_FILES = ["restart-runner.js", "code-swap.js", "version.js", "update-state.js"] as const;

interface DownloadResult {
  sha256: string;
  bytes: number;
}

export class UpdateService {
  readonly deployment: DeploymentInfo;
  private readonly source: GitHubReleaseSource;
  private readonly updatesDir: string;
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly tasksDir: string;
  private readonly backupsDir: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private state: PersistedUpdateState = emptyUpdateState();
  private applying = false;
  private releaseLock: (() => void) | null = null;

  constructor(private readonly options: UpdateServiceOptions) {
    this.deployment = detectDeployment({
      rootDir: options.rootDir,
      platform: options.platform,
      architecture: options.architecture,
      env: options.env,
      isDocker: options.isDocker,
    });
    this.source = new GitHubReleaseSource({
      fetch: options.fetch,
      apiBaseUrl: options.apiBaseUrl,
      repository: options.repository,
    });
    this.fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.now = options.now ?? (() => new Date());
    this.updatesDir = path.join(options.dataDir, "updates");
    this.statePath = path.join(this.updatesDir, "state.json");
    this.lockPath = path.join(this.updatesDir, "update.lock");
    this.tasksDir = path.join(this.updatesDir, "tasks");
    this.backupsDir = path.join(this.updatesDir, "backups");
  }

  initialize(): void {
    mkdirSync(this.updatesDir, { recursive: true });
    this.state = readUpdateState(this.statePath);
    const task = this.state.task;
    // A live lock owner (for example a second process starting by mistake)
    // must not have its in-flight task reconciled as interrupted.
    if (!task || !isActiveTaskStatus(task.status) || !updateLockIsHeld(this.lockPath, task.id)) {
      const recovered = task && isActiveTaskStatus(task.status) ? this.recoverInterruptedSwap(task) : null;
      const changed = recovered !== null || reconcileInterruptedState(this.state, this.options.currentVersion, this.now().toISOString());
      if (changed) writeUpdateState(this.statePath, this.state);
    }
    clearStaleUpdateLock(this.lockPath);
    this.options.logger.info({
      deployment: this.deployment.mode,
      version: this.options.currentVersion,
      task: this.state.task?.status ?? "idle",
    }, "Update service initialized");
  }

  /**
   * A crash during the swap leaves the previous code in the backup directory
   * and possibly only partial new code in the install directory. Restore the
   * previous code before reporting the task, rather than trusting a version
   * whose files may be incomplete.
   */
  private recoverInterruptedSwap(task: NonNullable<PersistedUpdateState["task"]>): boolean | null {
    const backupDir = path.join(this.backupsDir, task.id);
    if (!existsSync(backupDir)) return null;
    const now = this.now().toISOString();
    let restored = false;
    try {
      restoreCode(this.options.rootDir, backupDir);
      restored = true;
    } catch (error) {
      this.options.logger.warn({
        taskId: task.id,
        err: error instanceof Error ? error.message : String(error),
      }, "Interrupted update code could not be restored from backup");
    }
    task.status = "failed";
    task.finishedAt = now;
    task.updatedAt = now;
    task.rolledBack = restored;
    if (restored) {
      task.errorCode = "UPDATE_INTERRUPTED";
      task.errorMessage = "The process stopped during the update. The previous version was restored from the backup.";
    } else {
      task.errorCode = "UPDATE_ROLLBACK_FAILED";
      task.errorMessage = "The process stopped during the update and the code could not be restored automatically. Restore the previous version from the backup.";
    }
    return true;
  }

  getStatus(): UpdateStatusView {
    // The restart runner updates the persisted task after this process has
    // already returned a response, so always report the on-disk state. Do not
    // replace the in-memory state: an apply in progress still writes to it.
    const state = readUpdateState(this.statePath);
    return {
      currentVersion: this.options.currentVersion,
      deployment: {
        mode: this.deployment.mode,
        platform: this.deployment.platform,
        architecture: this.deployment.architecture,
        applyAllowed: this.deployment.applyAllowed,
        reasonCode: this.deployment.reasonCode,
        upgradePath: this.deployment.upgradePath,
      },
      task: state.task,
    };
  }

  async checkForUpdates(): Promise<UpdateCheckView> {
    let releases: OfficialRelease[];
    try { releases = await this.source.listStableReleases(); }
    catch (error) { throw mapError(error); }
    const newer = releases
      .filter((release) => isNewerVersion(release.version, this.options.currentVersion))
      .sort((left, right) => compareVersions(right.version, left.version));
    return {
      currentVersion: this.options.currentVersion,
      releases: newer.map((release) => this.toReleaseView(release)),
    };
  }

  private toReleaseView(release: OfficialRelease): UpdateReleaseView {
    const assetName = this.deployment.assetKind ? releaseAssetName(release.version, this.deployment.assetKind) : "";
    const asset = assetName ? release.assets.find((item) => item.name === assetName) ?? null : null;
    const checksums = release.assets.find((item) => item.name === CHECKSUM_ASSET_NAME) ?? null;
    let blockedReason: string | null = null;
    if (!this.deployment.applyAllowed) blockedReason = this.deployment.reasonCode ?? "DEPLOYMENT_SOURCE";
    else if (!asset) blockedReason = "UPDATE_ASSET_UNAVAILABLE";
    else if (!checksums) blockedReason = "UPDATE_CHECKSUM_MISSING";
    return {
      version: release.version,
      tag: release.tag,
      publishedAt: release.publishedAt,
      releaseUrl: release.releaseUrl,
      assetName,
      assetSize: asset?.size ?? 0,
      assetAvailable: Boolean(asset),
      hasChecksums: Boolean(checksums),
      digest: asset?.digest ?? null,
      canApply: blockedReason === null,
      blockedReason,
    };
  }

  async applyUpdate(version: string, confirmVersion: string): Promise<UpdateTaskView> {
    if (version !== confirmVersion) {
      throw new UpdateError("UPDATE_CONFIRMATION_REQUIRED", "The confirmation does not match the selected version.");
    }
    if (!this.deployment.applyAllowed) {
      throw new UpdateError("UPDATE_NOT_SUPPORTED", this.deployment.reasonCode ?? "Updates cannot be applied from this deployment.", 409);
    }
    if (!isValidVersion(version)) throw new UpdateError("UPDATE_VERSION_INVALID", "The selected version is invalid.");
    if (!isNewerVersion(version, this.options.currentVersion)) {
      throw new UpdateError("UPDATE_VERSION_NOT_NEWER", "The selected version is not newer than the running version.", 409);
    }
    if (this.applying || (this.state.task && isActiveTaskStatus(this.state.task.status))) {
      throw new UpdateError("UPDATE_IN_PROGRESS", "Another update task is already running.", 409);
    }
    this.applying = true;
    const taskId = `upd_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
    const startedAt = this.now().toISOString();
    const task: UpdateTaskView = {
      id: taskId,
      status: "downloading",
      fromVersion: this.options.currentVersion,
      targetVersion: version,
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      rolledBack: false,
      steps: [],
    };
    const taskDirectory = path.join(this.tasksDir, taskId);
    try {
      this.releaseLock = acquireUpdateLock(this.lockPath, taskId);
      this.state = { schemaVersion: 1, task };
      writeUpdateState(this.statePath, this.state);
      mkdirSync(taskDirectory, { recursive: true });
      const release = await this.source.findRelease(version);
      if (!release) throw new UpdateError("UPDATE_VERSION_NOT_FOUND", "The selected stable release is no longer published.", 404);
      if (!this.deployment.assetKind) throw new UpdateError("UPDATE_NOT_SUPPORTED", "This platform has no release package.", 409);
      const assetName = releaseAssetName(version, this.deployment.assetKind);
      const asset = release.assets.find((item) => item.name === assetName);
      if (!asset) throw new UpdateError("UPDATE_ASSET_UNAVAILABLE", "The official release has no package for this platform.", 404);
      const checksumAsset = release.assets.find((item) => item.name === CHECKSUM_ASSET_NAME);
      if (!checksumAsset) throw new UpdateError("UPDATE_CHECKSUM_MISSING", "The official release has no SHA256SUMS.txt; updates are refused.", 409);
      const downloadDirectory = path.join(taskDirectory, "download");
      mkdirSync(downloadDirectory, { recursive: true });
      const archivePath = path.join(downloadDirectory, assetName);
      const checksumPath = path.join(downloadDirectory, CHECKSUM_ASSET_NAME);
      this.startStep(task, "download");
      const [archive, checksumFile] = await Promise.all([
        this.downloadAsset(asset, archivePath, DOWNLOAD_LIMIT),
        this.downloadAsset(checksumAsset, checksumPath, CHECKSUM_LIMIT),
      ]);
      this.finishStep(task, "download", "succeeded");
      this.updateTaskStatus(task, "verifying");
      this.startStep(task, "checksum");
      this.verifyChecksums(checksumPath, assetName, archive.sha256, checksumFile.sha256, asset, checksumAsset);
      this.finishStep(task, "checksum", "succeeded");
      this.updateTaskStatus(task, "extracting");
      this.startStep(task, "extract");
      const extractedDirectory = path.join(taskDirectory, "extracted");
      try {
        await extractReleaseArchive(archivePath, extractedDirectory, assetName);
      } catch (error) {
        if (error instanceof ArchiveError) throw new UpdateError(error.code, error.message, 422);
        throw error;
      }
      this.finishStep(task, "extract", "succeeded");
      this.updateTaskStatus(task, "staging");
      this.startStep(task, "stage");
      let stagedRoot: string;
      try {
        if (!existsSync(archivePath)) throw new Error("Downloaded release package is missing.");
        stagedRoot = locatePackageRoot(extractedDirectory, version, this.deployment.platform);
      } catch (error) {
        if (error instanceof CodeSwapError) throw new UpdateError("UPDATE_PACKAGE_INVALID", error.message, 422);
        throw error;
      }
      this.finishStep(task, "stage", "succeeded");
      const planPath = path.join(taskDirectory, "plan.json");
      const runnerDirectory = path.join(taskDirectory, "runner");
      const plan = {
        schemaVersion: 1,
        taskId,
        rootDir: this.options.rootDir,
        statePath: this.statePath,
        lockPath: this.lockPath,
        stagedRoot,
        backupDir: path.join(this.backupsDir, taskId),
        fromVersion: this.options.currentVersion,
        targetVersion: version,
        nodePath: path.join(this.options.rootDir, this.deployment.platform === "win32" ? "runtime/node.exe" : "runtime/node"),
        appEntry: path.join(this.options.rootDir, "dist", "index.js"),
        health: {
          protocol: this.options.https ? "https" : "http",
          port: this.options.port ?? 3040,
          path: "/api/health",
        },
        waitForPid: process.pid,
        parentTimeoutMs: 60_000,
        healthTimeoutMs: this.options.healthTimeoutMs ?? 90_000,
        pollIntervalMs: 500,
        appLogPath: path.join(taskDirectory, "app.log"),
      };
      writeFileSync(planPath, JSON.stringify(plan, null, 2), { encoding: "utf8", mode: 0o600 });
      this.updateTaskStatus(task, "restarting");
      this.startStep(task, "restart");
      writeUpdateState(this.statePath, this.state);
      try {
        if (this.options.launchRunner) await this.options.launchRunner(planPath, runnerDirectory);
        else await this.launchRunner(planPath, runnerDirectory);
      } catch (error) {
        if (error instanceof UpdateError) throw error;
        throw new UpdateError("UPDATE_RUNNER_FAILED", error instanceof Error ? error.message : "The restart runner could not be started.");
      }
      this.releaseLock = null;
      this.options.logger.info({ taskId, from: task.fromVersion, to: version }, "Update prepared; restart runner started");
      return task;
    } catch (error) {
      const updateError = mapError(error);
      // A lock conflict belongs to another task. Never overwrite its persisted
      // state just because this request was rejected.
      const ownsTask = this.releaseLock !== null || this.state.task?.id === taskId;
      task.status = "failed";
      task.updatedAt = this.now().toISOString();
      task.finishedAt = task.updatedAt;
      task.errorCode = updateError.code;
      task.errorMessage = updateError.message;
      const runningStep = [...task.steps].reverse().find((step) => step.status === "running");
      this.finishStep(task, runningStep?.name ?? "prepare", "failed", updateError.message);
      if (ownsTask) {
        this.state = { schemaVersion: 1, task };
        try { writeUpdateState(this.statePath, this.state); } catch { /* Preserve the original error. */ }
      }
      try { rmSync(taskDirectory, { recursive: true, force: true }); } catch { /* Best effort. */ }
      this.releaseLock?.();
      this.releaseLock = null;
      // A runner that died after taking over leaves its own pid in the lock.
      // Only a provably dead owner is removed; a live lock is left alone.
      clearStaleUpdateLock(this.lockPath);
      throw updateError;
    } finally {
      this.applying = false;
    }
  }

  private updateTaskStatus(task: UpdateTaskView, status: UpdateTaskStatus): void {
    task.status = status;
    task.updatedAt = this.now().toISOString();
    writeUpdateState(this.statePath, this.state);
  }

  private startStep(task: UpdateTaskView, name: string, detail?: string): void {
    const at = this.now().toISOString();
    const existing = task.steps.find((step) => step.name === name);
    if (existing) { existing.status = "running"; existing.at = at; if (detail) existing.detail = detail; }
    else task.steps.push({ name, status: "running", at, ...(detail ? { detail } : {}) });
    task.updatedAt = at;
  }

  private finishStep(task: UpdateTaskView, name: string, status: "succeeded" | "failed", detail?: string): void {
    const at = this.now().toISOString();
    const existing = task.steps.find((step) => step.name === name);
    if (existing) { existing.status = status; existing.at = at; if (detail) existing.detail = detail; }
    else task.steps.push({ name, status, at, ...(detail ? { detail } : {}) });
    task.updatedAt = at;
  }

  private verifyChecksums(
    checksumPath: string,
    assetName: string,
    archiveSha256: string,
    checksumSha256: string,
    asset: ReleaseAsset,
    checksumAsset: ReleaseAsset,
  ): void {
    const text = readFileSync(checksumPath, "utf8");
    const expected = parseChecksumFile(text).get(assetName);
    if (!expected) throw new UpdateError("UPDATE_CHECKSUM_MISSING", "SHA256SUMS.txt has no entry for the selected package; the update is refused.", 409);
    if (expected !== archiveSha256) throw new UpdateError("UPDATE_CHECKSUM_MISMATCH", "The downloaded package does not match SHA256SUMS.txt.", 422);
    this.crossCheckDigest(asset, archiveSha256);
    this.crossCheckDigest(checksumAsset, checksumSha256);
  }

  private crossCheckDigest(asset: ReleaseAsset, actual: string): void {
    if (!asset.digest) return;
    const [algorithm, value] = asset.digest.split(":", 2);
    if (algorithm?.toLowerCase() !== "sha256" || !/^[a-f0-9]{64}$/i.test(value ?? "")) {
      throw new UpdateError("UPDATE_DIGEST_UNSUPPORTED", "GitHub supplied an unsupported asset digest.", 409);
    }
    if (value.toLowerCase() !== actual) throw new UpdateError("UPDATE_DIGEST_MISMATCH", "The package does not match the GitHub asset digest.", 422);
  }

  private async downloadAsset(asset: ReleaseAsset, destination: string, limit: number): Promise<DownloadResult> {
    try { assertOfficialDownloadUrl(asset.url, ...repositoryParts(this.options.repository)); }
    catch (error) { throw mapError(error); }
    let response: Response;
    try {
      response = await this.fetcher(asset.url, {
        headers: { "user-agent": "WebSpeak-Console-Updater", accept: "application/octet-stream" },
        signal: AbortSignal.timeout(this.options.downloadTimeoutMs ?? 300_000),
      });
    } catch (error) {
      throw new UpdateError("UPDATE_DOWNLOAD_FAILED", error instanceof Error ? error.message : "The release asset could not be downloaded.", 502);
    }
    if (response.url) {
      try { assertOfficialDownloadUrl(response.url, ...repositoryParts(this.options.repository)); }
      catch (error) { throw mapError(error); }
    }
    if (!response.ok || !response.body) throw new UpdateError("UPDATE_DOWNLOAD_FAILED", `The release asset returned HTTP ${response.status}.`, 502);
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > limit) throw new UpdateError("UPDATE_DOWNLOAD_TOO_LARGE", "The release asset exceeds the download limit.", 422);
    const temporary = `${destination}.${process.pid}.tmp`;
    const hash = createHash("sha256");
    const stream = createWriteStream(temporary, { mode: 0o600, flags: "wx" });
    let bytes = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > limit) throw new UpdateError("UPDATE_DOWNLOAD_TOO_LARGE", "The release asset exceeds the download limit.", 422);
        hash.update(buffer);
        if (!stream.write(buffer)) await new Promise<void>((resolve) => stream.once("drain", resolve));
      }
      stream.end();
      await new Promise<void>((resolve, reject) => {
        stream.once("finish", resolve);
        stream.once("error", reject);
      });
      await rename(temporary, destination);
    } catch (error) {
      stream.destroy();
      await rm(temporary, { force: true }).catch(() => undefined);
      if (error instanceof UpdateError) throw error;
      throw new UpdateError("UPDATE_DOWNLOAD_FAILED", error instanceof Error ? error.message : "The release asset could not be saved.", 502);
    }
    return { sha256: hash.digest("hex"), bytes };
  }

  /**
   * Copy the runner and all of its runtime imports into an isolated directory,
   * start it detached, and wait briefly to prove it did not die on startup.
   * A successful spawn alone is not enough: Node resolves the whole ESM module
   * graph before executing the helper, so a missing file only shows up as an
   * early exit. Returning here means the helper is actually running.
   */
  async launchRunner(planPath: string, runnerDirectory: string): Promise<number> {
    const sourceDirectory = this.options.runnerSourceDir ?? path.dirname(fileURLToPath(import.meta.url));
    const missing = RUNNER_RUNTIME_FILES.filter((file) => !existsSync(path.join(sourceDirectory, file)));
    if (missing.length > 0) {
      throw new UpdateError(
        "UPDATE_RUNNER_MISSING",
        `The compiled restart runner is incomplete (missing ${missing.join(", ")}); rebuild the application before updating.`,
        500,
      );
    }
    mkdirSync(runnerDirectory, { recursive: true });
    for (const file of RUNNER_RUNTIME_FILES) {
      copyFileSync(path.join(sourceDirectory, file), path.join(runnerDirectory, file));
    }
    writeFileSync(path.join(runnerDirectory, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    let nodePath: string;
    if (this.deployment.platform === "win32") {
      nodePath = path.join(runnerDirectory, "node.exe");
      copyFileSync(process.execPath, nodePath);
    } else {
      nodePath = process.execPath;
    }
    const log = path.join(path.dirname(planPath), "runner.log");
    const graceMs = this.options.runnerStartupTimeoutMs ?? 750;
    return new Promise<number>((resolve, reject) => {
      let child: ChildProcess;
      let fd: number | null = null;
      try {
        fd = openSync(log, "a");
        child = spawn(nodePath, [path.join(runnerDirectory, "restart-runner.js"), planPath], {
          cwd: this.options.rootDir,
          env: process.env,
          detached: true,
          windowsHide: true,
          stdio: ["ignore", fd, fd],
        });
      } catch (error) {
        reject(error);
        return;
      } finally {
        if (fd !== null) closeSync(fd);
      }
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(new UpdateError("UPDATE_RUNNER_FAILED", message, 500));
      };
      child.once("error", (error) => fail(error.message));
      child.once("exit", (code, signal) => {
        fail(`The restart runner exited before taking over (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
      });
      child.once("spawn", () => {
        child.unref();
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          if (!child.pid) {
            reject(new UpdateError("UPDATE_RUNNER_FAILED", "The restart runner did not report a process id.", 500));
            return;
          }
          resolve(child.pid);
        }, graceMs);
      });
    });
  }
}

function repositoryParts(repository: string | undefined): [string, string] {
  const [owner, repo] = (repository ?? "EchoSixHIYA/WebSpeak-client-for-TeamSpeak").split("/");
  return [owner, repo];
}

export function parseChecksumFile(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (!match) continue;
    const name = match[2].replace(/^\.\//, "");
    if (!entries.has(name)) entries.set(name, match[1].toLowerCase());
  }
  return entries;
}

function mapError(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error;
  if (error instanceof UpdateLockedError) return new UpdateError("UPDATE_IN_PROGRESS", error.message, 409);
  if (error instanceof ReleaseSourceError) return new UpdateError("UPDATE_RELEASE_UNAVAILABLE", error.message, 502);
  if (error instanceof ArchiveError) return new UpdateError(error.code, error.message, 422);
  if (error instanceof CodeSwapError) return new UpdateError(error.code, error.message, 422);
  return new UpdateError("UPDATE_FAILED", error instanceof Error ? error.message : "The update failed.", 500);
}
