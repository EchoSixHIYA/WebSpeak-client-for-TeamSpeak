export interface ChannelCapacity {
  maxClients: number;
  maxClientsLimited: boolean;
}

const UINT64_MAX = 18_446_744_073_709_551_615n;

function parseChannelId(value: string | undefined): bigint | null {
  if (!value || !/^\d{1,20}$/.test(value)) return null;
  try {
    const id = BigInt(value);
    return id > 0n && id <= UINT64_MAX ? id : null;
  } catch {
    return null;
  }
}

export function parseChannelCapacity(row: Record<string, string>): ChannelCapacity | null {
  const maxClientsRaw = row.channel_maxclients;
  const unlimitedRaw = row.channel_flag_maxclients_unlimited;
  if (!maxClientsRaw || !/^\d{1,5}$/.test(maxClientsRaw) || (unlimitedRaw !== "0" && unlimitedRaw !== "1")) return null;
  const maxClients = Number(maxClientsRaw);
  if (!Number.isSafeInteger(maxClients) || maxClients > 65_535) return null;
  return { maxClients, maxClientsLimited: unlimitedRaw === "0" };
}

export function parseChannelCapacities(rows: readonly Record<string, string>[]): Map<bigint, ChannelCapacity> {
  const capacities = new Map<bigint, ChannelCapacity>();
  for (const row of rows) {
    const id = parseChannelId(row.cid);
    const capacity = parseChannelCapacity(row);
    if (id !== null && capacity) capacities.set(id, capacity);
  }
  return capacities;
}

/** Keep capacity metadata in step with TeamSpeak's incremental channel events. */
export function applyChannelCapacityNotification(
  name: string,
  params: Record<string, string>,
  capacities: Map<bigint, ChannelCapacity>,
): void {
  const id = parseChannelId(params.cid);
  if (id === null) return;

  if (name === "notifychanneldeleted") {
    capacities.delete(id);
    return;
  }
  if (name !== "notifychannelcreated" && name !== "notifychanneledited") return;

  const current = name === "notifychanneledited" ? capacities.get(id) : undefined;
  const maxClientsRaw = params.channel_maxclients;
  const unlimitedRaw = params.channel_flag_maxclients_unlimited;
  const maxClients = maxClientsRaw !== undefined && /^\d{1,5}$/.test(maxClientsRaw) && Number(maxClientsRaw) <= 65_535
    ? Number(maxClientsRaw)
    : current?.maxClients;
  const unlimited = unlimitedRaw === "0" || unlimitedRaw === "1"
    ? unlimitedRaw === "1"
    : current ? !current.maxClientsLimited : undefined;
  if (maxClients === undefined || unlimited === undefined) return;
  capacities.set(id, { maxClients, maxClientsLimited: !unlimited });
}
