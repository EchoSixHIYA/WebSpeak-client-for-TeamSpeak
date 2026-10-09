import type { FavoriteServer, RecentServer } from "./local-persistence.js";

export interface QuickServer {
  id: string;
  address: string;
  label: string;
  nickname?: string;
  identityId?: string;
  lastChannelHint?: { id?: string; name?: string };
  isFavorite: boolean;
  lastConnectedAt?: number;
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
    const key = serverKey(recent.address);
    if (key && !recentByAddress.has(key)) recentByAddress.set(key, recent);
  }

  const result: QuickServer[] = [];
  const seen = new Set<string>();
  for (const favorite of [...favorites].sort((left, right) => left.label.localeCompare(right.label))) {
    const key = serverKey(favorite.address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const recent = recentByAddress.get(key);
    result.push({
      id: key,
      address: favorite.address.trim(),
      label: favorite.label.trim() || favorite.address.trim(),
      isFavorite: true,
      ...(recent?.nickname || favorite.nickname ? { nickname: recent?.nickname || favorite.nickname } : {}),
      ...(recent?.identityId || favorite.identityId ? { identityId: recent?.identityId || favorite.identityId } : {}),
      ...(recent?.lastChannelHint || favorite.lastChannelHint ? { lastChannelHint: recent?.lastChannelHint ?? favorite.lastChannelHint } : {}),
      ...(recent ? { lastConnectedAt: recent.lastConnectedAt } : {}),
    });
  }

  for (const recent of [...recentServers].sort((left, right) => right.lastConnectedAt - left.lastConnectedAt)) {
    const key = serverKey(recent.address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: key,
      address: recent.address.trim(),
      label: recent.address.trim(),
      isFavorite: false,
      ...(recent.nickname ? { nickname: recent.nickname } : {}),
      ...(recent.identityId ? { identityId: recent.identityId } : {}),
      ...(recent.lastChannelHint ? { lastChannelHint: recent.lastChannelHint } : {}),
      lastConnectedAt: recent.lastConnectedAt,
    });
  }

  return result;
}

function serverKey(address: string): string {
  return address.trim().toLocaleLowerCase();
}
