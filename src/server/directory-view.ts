import type { ChannelInfo } from "../shared/voice-models.js";
import type { TSDirectorySnapshot } from "./ts-client.js";

export function mapChannelTree(snapshot: TSDirectorySnapshot, avatarCache = new Map<string, string | null>()): ChannelInfo[] {
  return snapshot.channels.map((channel) => ({
    id: String(channel.id),
    parentID: String(channel.parentID),
    order: String(channel.order),
    name: channel.name || "未命名频道",
    description: channel.description || "",
    ...(typeof channel.maxClients === "number" && typeof channel.maxClientsLimited === "boolean"
      ? { maxClients: channel.maxClients, maxClientsLimited: channel.maxClientsLimited }
      : {}),
    members: snapshot.clients
      .filter((client) => client.channelID === channel.id)
      .map((client) => {
        const avatar = client.uid ? avatarCache.get(client.uid) : undefined;
        return {
          id: client.id,
          nickname: client.nickname || "未知用户",
          uid: client.uid,
          ...(avatar ? { avatar } : {}),
          away: client.away,
          awayMessage: client.awayMessage,
          inputMuted: client.inputMuted,
          outputMuted: client.outputMuted,
          channelCommander: client.channelCommander,
        };
      }),
  }));
}

export function avatarDataUrl(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return `data:image/png;base64,${data.toString("base64")}`;
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return `data:image/jpeg;base64,${data.toString("base64")}`;
  if (data.length >= 6 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a")) return `data:image/gif;base64,${data.toString("base64")}`;
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return `data:image/webp;base64,${data.toString("base64")}`;
  return null;
}

export function normalizeDirectorySnapshot(
  snapshot: TSDirectorySnapshot,
  selfId: number,
  selfChannelId: bigint,
  nickname: string,
  requestedChannelName?: string,
): TSDirectorySnapshot {
  if (selfId <= 0) return snapshot;

  const clients = snapshot.clients.slice();
  const selfIndex = clients.findIndex((client) => client.id === selfId);
  const snapshotChannelId = selfIndex >= 0 ? clients[selfIndex]!.channelID : 0n;
  const requestedName = requestedChannelName?.trim().toLocaleLowerCase();
  const requestedChannel = requestedName
    ? snapshot.channels.find((channel) => channel.name.trim().toLocaleLowerCase() === requestedName)
    : undefined;
  const resolvedChannelId = selfChannelId !== 0n
    ? selfChannelId
    : snapshotChannelId !== 0n
      ? snapshotChannelId
      : requestedChannel?.id ?? snapshot.channels[0]?.id ?? 0n;
  if (selfIndex >= 0) {
    const current = clients[selfIndex]!;
    if (resolvedChannelId !== 0n) clients[selfIndex] = { ...current, channelID: resolvedChannelId };
  } else if (resolvedChannelId !== 0n) {
    clients.push({ id: selfId, nickname, uid: "", channelID: resolvedChannelId, type: 1, serverGroups: [] });
  }

  return { ...snapshot, clients };
}
