export interface ChannelCapacity {
  maxClients: number;
  maxClientsLimited: boolean;
}

export interface ChannelPasswordProtection {
  passwordProtected: boolean;
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

/** The password flag reveals whether a password is required, never the password itself. */
export function parseChannelPasswordProtection(row: Record<string, string>): boolean | null {
  if (row.channel_flag_password === "1") return true;
  if (row.channel_flag_password === "0") return false;
  return null;
}

export function parseChannelPasswordProtections(rows: readonly Record<string, string>[]): Map<bigint, boolean> {
  const protections = new Map<bigint, boolean>();
  for (const row of rows) {
    const id = parseChannelId(row.cid);
    const passwordProtected = parseChannelPasswordProtection(row);
    if (id !== null && passwordProtected !== null) protections.set(id, passwordProtected);
  }
  return protections;
}

/** Keep the password-required flag current as channels are created or edited. */
export function applyChannelPasswordProtectionNotification(
  name: string,
  params: Record<string, string>,
  protections: Map<bigint, boolean>,
): { channelId: bigint; passwordProtected: boolean } | null {
  const id = parseChannelId(params.cid);
  if (id === null) return null;

  if (name === "notifychanneldeleted") {
    protections.delete(id);
    return null;
  }
  if (name !== "notifychannelcreated" && name !== "notifychanneledited") return null;

  const passwordProtected = parseChannelPasswordProtection(params);
  if (passwordProtected === null) return null;
  protections.set(id, passwordProtected);
  return { channelId: id, passwordProtected };
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
