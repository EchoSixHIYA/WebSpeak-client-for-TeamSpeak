import type { FavoriteServer, RecentServer } from "./local-persistence.js";
import { splitTeamSpeakTarget } from "./teamspeak-target.js";

export interface QuickServer {
  id: string;
  address: string;
  label: string;
  nickname?: string;
  identityId?: string;
  lastChannelHint?: { id?: string; name?: string };
  isFavorite: boolean;
  lastConnectedAt?: number;
  serverName?: string;
  serverIcon?: string;
}

export function isSafeQuickServerIcon(value: unknown): value is string {
  return typeof value === "string" && value.length <= 180_000
    && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function isQuickServerAddressLabel(label: string, address: string): boolean {
  const normalizedLabel = label.trim().toLocaleLowerCase();
  const candidates = new Set([address.trim()]);
  try { candidates.add(splitTeamSpeakTarget(address).address.trim()); } catch { /* Persisted targets are validated on write. */ }
  return [...candidates].some((candidate) => candidate.length >= 3 && normalizedLabel.includes(candidate.toLocaleLowerCase()));
}

/**
 * Builds the shared server picker used on the home page and in the voice room.
 * Favorites stay first, while a recent entry for a favorite only enriches its
 * connection details instead of rendering a duplicate row.
 */
export function mergeQuickServers(
  favorites: readonly FavoriteServer[],
  recentServers: readonly RecentServer[],
): QuickServer[] {
  const recentByAddress = new Map<string, RecentServer>();
  for (const recent of [...recentServers].sort((left, right) => right.lastConnectedAt - left.lastConnectedAt)) {
    const key = comparableServerKey(recent.address);
    if (key && !recentByAddress.has(key)) recentByAddress.set(key, recent);
  }

  const result: QuickServer[] = [];
  const seen = new Set<string>();
  for (const favorite of [...favorites].sort((left, right) => left.label.localeCompare(right.label))) {
    const key = comparableServerKey(favorite.address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const recent = recentByAddress.get(key);
    const serverName = recent?.serverName?.trim() || favorite.serverName?.trim() || "";
    const serverIcon = isSafeQuickServerIcon(recent?.serverIcon) ? recent.serverIcon
      : isSafeQuickServerIcon(favorite.serverIcon) ? favorite.serverIcon : "";
    const savedLabel = favorite.label.trim();
    result.push({
      id: serverKey(favorite.address),
      address: favorite.address.trim(),
      label: serverName && (!savedLabel || isQuickServerAddressLabel(savedLabel, favorite.address))
        ? serverName
        : savedLabel || favorite.address.trim(),
      isFavorite: true,
      ...(serverName ? { serverName } : {}),
      ...(serverIcon ? { serverIcon } : {}),
      ...(recent?.nickname || favorite.nickname ? { nickname: recent?.nickname || favorite.nickname } : {}),
      ...(recent?.identityId || favorite.identityId ? { identityId: recent?.identityId || favorite.identityId } : {}),
      ...(recent?.lastChannelHint || favorite.lastChannelHint ? { lastChannelHint: recent?.lastChannelHint ?? favorite.lastChannelHint } : {}),
      ...(recent ? { lastConnectedAt: recent.lastConnectedAt } : {}),
    });
  }

  for (const recent of [...recentServers].sort((left, right) => right.lastConnectedAt - left.lastConnectedAt)) {
    const key = comparableServerKey(recent.address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: serverKey(recent.address),
      address: recent.address.trim(),
      label: recent.serverName?.trim() || recent.address.trim(),
      isFavorite: false,
      ...(recent.serverName?.trim() ? { serverName: recent.serverName.trim() } : {}),
      ...(isSafeQuickServerIcon(recent.serverIcon) ? { serverIcon: recent.serverIcon } : {}),
      ...(recent.nickname ? { nickname: recent.nickname } : {}),
      ...(recent.identityId ? { identityId: recent.identityId } : {}),
      ...(recent.lastChannelHint ? { lastChannelHint: recent.lastChannelHint } : {}),
      lastConnectedAt: recent.lastConnectedAt,
    });
  }

  return result;
}

function serverKey(address: string): string {
  return address.trim().toLowerCase();
}

function comparableServerKey(address: string): string {
  const target = splitTeamSpeakTarget(address);
  const host = target.address.trim().toLowerCase();
  const port = target.port.trim() || "9987";
  return host ? `${host}:${port}` : "";
}

export function quickServerTargetsEqual(left: string, right: string): boolean {
  const leftKey = comparableServerKey(left);
  return Boolean(leftKey) && leftKey === comparableServerKey(right);
}
