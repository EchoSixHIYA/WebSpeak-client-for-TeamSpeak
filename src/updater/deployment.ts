import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { UpdateDeploymentMode, UpdateDeploymentView, UpdateUpgradePath } from "../shared/update.js";

export interface DeploymentDetectionOptions {
  rootDir: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  env?: NodeJS.ProcessEnv;
  /** Test seam; omitted means inspect the real container markers. */
  isDocker?: boolean;
}

export interface DeploymentInfo extends UpdateDeploymentView {
  platform: NodeJS.Platform;
  assetKind: "linux-x64" | "linux-arm64" | "windows-x64" | null;
}

export function detectDeployment(options: DeploymentDetectionOptions): DeploymentInfo {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const env = options.env ?? process.env;
  const explicit = env.WEBSPEAK_DEPLOYMENT_MODE?.trim().toLowerCase();
  const packaged = isReleasePackageRoot(options.rootDir, platform);
  let mode: UpdateDeploymentMode;
  // Container detection always wins: an explicit "release-package" override
  // must never make an image replaceable from inside the container.
  if (explicit === "docker" || (options.isDocker ?? runningInContainer(env))) {
    mode = "docker";
  } else if (explicit === "source") {
    mode = "source";
  } else {
    // An explicit "release-package" only counts when the tree really is a
    // complete release package; otherwise applying would be unsafe.
    mode = packaged ? "release-package" : "source";
  }
  const assetKind = mode === "release-package" ? assetKindFor(platform, architecture) : null;
  let applyAllowed = mode === "release-package" && assetKind !== null;
  let reasonCode: string | null = null;
  if (mode === "docker") reasonCode = "DEPLOYMENT_DOCKER";
  else if (mode === "source") reasonCode = "DEPLOYMENT_SOURCE";
  else if (!assetKind) reasonCode = platform !== "linux" && platform !== "win32" ? "PLATFORM_UNSUPPORTED" : "ARCH_UNSUPPORTED";
  else if (platform === "win32") {
    // The copy-node.exe-then-swap approach has not been verified against a
    // real Windows release package. Report versions, but never fake an apply.
    applyAllowed = false;
    reasonCode = "WINDOWS_APPLY_UNVERIFIED";
  } else if (platform === "linux" && architecture === "arm64") {
    // arm64 packages are built and can be checked, but the in-place swap has
    // only been exercised on x64. Gate on the detected capability itself so
    // "unverified" is never rendered as "can apply" in the UI.
    applyAllowed = false;
    reasonCode = "LINUX_ARM64_APPLY_UNVERIFIED";
  }
  return {
    mode,
    platform,
    architecture,
    applyAllowed,
    reasonCode,
    upgradePath: upgradePathFor(mode),
    assetKind,
  };
}

export function runningInContainer(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WEBSPEAK_DEPLOYMENT_MODE?.trim().toLowerCase() === "docker") return true;
  if (existsSync("/.dockerenv")) return true;
  if (env.container) return true;
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    return /(?:docker|kubepods|containerd|libpod|podman)/i.test(cgroup);
  } catch {
    return false;
  }
}

export function isReleasePackageRoot(rootDir: string, platform: NodeJS.Platform = process.platform): boolean {
  const runtime = platform === "win32" ? path.join(rootDir, "runtime", "node.exe") : path.join(rootDir, "runtime", "node");
  return existsSync(runtime)
    && existsSync(path.join(rootDir, "dist", "index.js"))
    && existsSync(path.join(rootDir, "web", "dist", "index.html"))
    && existsSync(path.join(rootDir, "package.json"));
}

export function assetKindFor(platform: NodeJS.Platform, architecture: string): DeploymentInfo["assetKind"] {
  if (platform === "win32" && architecture === "x64") return "windows-x64";
  if (platform === "linux" && architecture === "x64") return "linux-x64";
  if (platform === "linux" && architecture === "arm64") return "linux-arm64";
  return null;
}

export function releaseAssetName(version: string, assetKind: NonNullable<DeploymentInfo["assetKind"]>): string {
  return assetKind === "windows-x64"
    ? `webspeak-webclient-v${version}-windows-x64.zip`
    : `webspeak-webclient-v${version}-${assetKind}.tar.gz`;
}

export function upgradePathFor(mode: UpdateDeploymentMode): UpdateUpgradePath {
  return mode === "docker" ? "docker-compose" : mode === "release-package" ? "release-package" : "source";
}
