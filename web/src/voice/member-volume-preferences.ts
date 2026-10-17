import type { ChannelMember } from "../../../src/shared/voice-models.js";

/** Restore stable per-member preferences onto the connection-local client IDs. */
export function applySavedMemberVolumes(
  members: readonly ChannelMember[],
  savedByUid: Readonly<Record<string, number>>,
  volumes: Record<number, number>,
): number[] {
  const updatedIds: number[] = [];
  for (const member of members) {
    if (!member.uid) continue;
    const saved = savedByUid[member.uid];
    if (typeof saved !== "number" || !Number.isFinite(saved)) continue;
    const normalized = Math.max(0, Math.min(4, saved));
    if (volumes[member.id] === normalized) continue;
    volumes[member.id] = normalized;
    updatedIds.push(member.id);
  }
  return updatedIds;
}
