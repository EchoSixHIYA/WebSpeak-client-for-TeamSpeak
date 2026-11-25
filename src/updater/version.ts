/** Stable semantic versions only. Pre-release/rolling channels are deliberate non-goals. */
export interface StableVersion {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

const STABLE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export function parseStableVersion(value: unknown): StableVersion | null {
  if (typeof value !== "string") return null;
  const match = STABLE.exec(value.trim());
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch), text: `${Number(major)}.${Number(minor)}.${Number(patch)}` };
}

/** `v1.2.3` is the only accepted release tag shape. */
export function parseReleaseTag(value: unknown): StableVersion | null {
  if (typeof value !== "string" || !value.startsWith("v")) return null;
  return parseStableVersion(value.slice(1));
}

export function isValidVersion(value: unknown): value is string {
  return parseStableVersion(value) !== null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  if (!a || !b) return 0;
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
