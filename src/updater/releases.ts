import { compareVersions, parseReleaseTag } from "./version.js";

export const OFFICIAL_REPOSITORY = "EchoSixHIYA/WebSpeak-client-for-TeamSpeak";
export const CHECKSUM_ASSET_NAME = "SHA256SUMS.txt";

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  digest: string | null;
}

export interface OfficialRelease {
  version: string;
  tag: string;
  publishedAt: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

export type ReleaseSourceErrorCode = "UPDATE_RELEASE_UNAVAILABLE";

export class ReleaseSourceError extends Error {
  readonly code: ReleaseSourceErrorCode = "UPDATE_RELEASE_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "ReleaseSourceError";
  }
}

export interface ReleaseSourceOptions {
  fetch?: typeof fetch;
  apiBaseUrl?: string;
  repository?: string;
  userAgent?: string;
  timeoutMs?: number;
}

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export class GitHubReleaseSource {
  private readonly fetcher: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly repository: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  constructor(options: ReleaseSourceOptions = {}) {
    this.fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/+$/, "");
    this.repository = options.repository ?? OFFICIAL_REPOSITORY;
    this.userAgent = options.userAgent ?? "WebSpeak-Console-Updater";
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  private get owner(): string {
    return this.repository.split("/")[0];
  }

  private get repo(): string {
    return this.repository.split("/")[1];
  }

  async listStableReleases(): Promise<OfficialRelease[]> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBaseUrl}/repos/${this.repository}/releases?per_page=30`, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": this.userAgent,
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new ReleaseSourceError("The official release list could not be reached.");
    }
    if (!response.ok) throw new ReleaseSourceError(`The official release list returned HTTP ${response.status}.`);
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new ReleaseSourceError("The official release list is not valid JSON."); }
    if (!Array.isArray(value)) throw new ReleaseSourceError("The official release list is not an array.");
    const releases: OfficialRelease[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (record.draft === true || record.prerelease === true) continue;
      const tag = typeof record.tag_name === "string" ? record.tag_name : "";
      const version = parseReleaseTag(tag)?.text;
      if (!version || seen.has(version)) continue;
      const releaseUrl = typeof record.html_url === "string" ? record.html_url : "";
      if (!isOfficialReleasePage(releaseUrl, this.owner, this.repo)) continue;
      const assets: ReleaseAsset[] = [];
      if (Array.isArray(record.assets)) {
        for (const asset of record.assets) {
          if (!asset || typeof asset !== "object" || Array.isArray(asset)) continue;
          const item = asset as Record<string, unknown>;
          const name = typeof item.name === "string" ? item.name : "";
          const url = typeof item.browser_download_url === "string" ? item.browser_download_url : "";
          if (!name || !url) continue;
          try { assertOfficialDownloadUrl(url, this.owner, this.repo); }
          catch { continue; }
          assets.push({
            name,
            size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
            url,
            digest: typeof item.digest === "string" && item.digest ? item.digest : null,
          });
        }
      }
      seen.add(version);
      releases.push({
        version,
        tag,
        publishedAt: typeof record.published_at === "string" ? record.published_at : "",
        releaseUrl,
        assets,
      });
    }
    return releases.sort((left, right) => compareVersions(right.version, left.version));
  }

  async findRelease(version: string): Promise<OfficialRelease | null> {
    const releases = await this.listStableReleases();
    return releases.find((release) => release.version === version) ?? null;
  }
}

export function isOfficialReleasePage(value: string, owner: string, repo: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username && !url.password
      && url.hostname === "github.com"
      && url.pathname.startsWith(`/${owner}/${repo}/releases/`);
  } catch {
    return false;
  }
}

/**
 * Only GitHub-owned hosts are accepted. For the release download path the
 * repository prefix is pinned so a tampered asset URL cannot point elsewhere.
 */
export function assertOfficialDownloadUrl(value: string, owner: string, repo: string): void {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ReleaseSourceError("The release asset URL is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new ReleaseSourceError("The release asset is not hosted on an official GitHub domain.");
  }
  if (url.hostname === "github.com" && !url.pathname.startsWith(`/${owner}/${repo}/releases/download/`)) {
    throw new ReleaseSourceError("The release asset is not part of the official repository.");
  }
}
