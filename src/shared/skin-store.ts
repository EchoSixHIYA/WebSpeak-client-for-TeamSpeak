/** Public GitHub distribution contract. Packages still use the ordinary .wskin importer. */
export const SKIN_STORE_REPOSITORY = "https://github.com/Huddle-Up-Forge/webspeak-skins";
export const SKIN_STORE_INDEX_URL = "https://raw.githubusercontent.com/Huddle-Up-Forge/webspeak-skins/master/index.json";

export interface SkinStoreMetadata {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  description: string;
  minAppVersion: string;
  package: { ref: string; path: string; sha256: string };
}

export interface SkinStoreEntry {
  id: string;
  repository: string;
  metadata: SkinStoreMetadata | null;
  revision: string;
  compatible: boolean;
  error: string | null;
}

export interface SkinStoreCatalog {
  repository: string;
  appVersion: string;
  fetchedAt: number;
  entries: SkinStoreEntry[];
}

export interface SkinStoreInstallInput {
  id: string;
  revision: string;
  /** Compare-and-set: do not overwrite a package another administrator changed. */
  installedVersion: string | null;
}

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export function isSkinStoreVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32 && semver.test(value);
}

/** SemVer precedence, including prereleases; build metadata does not affect ordering. */
export function compareSkinVersions(left: string, right: string): number {
  const a = semver.exec(left), b = semver.exec(right);
  if (!a || !b) throw new Error("INVALID_SKIN_VERSION");
  for (let i = 1; i <= 3; i++) {
    if (a[i] !== b[i]) return BigInt(a[i]) < BigInt(b[i]) ? -1 : 1;
  }
  if (a[4] === b[4]) return 0;
  if (!a[4]) return 1;
  if (!b[4]) return -1;
  const x = a[4].split("."), y = b[4].split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] === y[i]) continue;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    if (nx && ny) return BigInt(x[i]) < BigInt(y[i]) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}
