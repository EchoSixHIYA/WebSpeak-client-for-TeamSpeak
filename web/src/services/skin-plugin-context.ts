import type { QuickServer } from "./quick-servers.js";
import { splitTeamSpeakTarget } from "./teamspeak-target.js";

export interface SkinPluginQuickServer {
  id: string;
  label: string;
  monogram: string;
  tone: number;
  current: boolean;
  kind: "favorite" | "recent";
  favorite: boolean;
}

function randomOpaqueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `quick-server-${Math.random().toString(36).slice(2)}`;
}

function safeLabelTone(label: string): number {
  let hash = 0;
  for (let index = 0; index < label.length; index++) hash = (Math.imul(hash, 31) + label.charCodeAt(index)) | 0;
  return (hash >>> 0) % 7;
}

function containsConnectionTarget(label: string, address: string): boolean {
  const candidates = new Set([address.trim()]);
  try { candidates.add(splitTeamSpeakTarget(address).address.trim()); } catch { /* Persisted targets are validated on write. */ }
  const normalizedLabel = label.toLocaleLowerCase();
  return [...candidates].some((candidate) => candidate.length >= 3 && normalizedLabel.includes(candidate.toLocaleLowerCase()));
}

/** Projects local favorite/recent entries without exposing their connection targets. */
export function createSkinPluginQuickServerProjection(createId: () => string = randomOpaqueId) {
  const opaqueIdByServerId = new Map<string, string>();
  const targetByOpaqueId = new Map<string, QuickServer>();

  return {
    project(servers: readonly QuickServer[], isCurrent: (server: QuickServer) => boolean): SkinPluginQuickServer[] {
      const activeServerIds = new Set(servers.map((server) => server.id));
      for (const id of opaqueIdByServerId.keys()) if (!activeServerIds.has(id)) opaqueIdByServerId.delete(id);
      targetByOpaqueId.clear();

      return servers.map((server, index) => {
        let opaqueId = opaqueIdByServerId.get(server.id);
        if (!opaqueId) {
          opaqueId = createId();
          opaqueIdByServerId.set(server.id, opaqueId);
        }
        targetByOpaqueId.set(opaqueId, server);
        const label = server.label.trim();
        const safeLabel = !label || containsConnectionTarget(label, server.address)
          ? `${server.isFavorite ? "Favorite" : "Recent"} ${index + 1}`
          : label;
        return {
          id: opaqueId,
          label: safeLabel,
          monogram: Array.from(safeLabel)[0] ?? "?",
          tone: safeLabelTone(safeLabel),
          current: isCurrent(server),
          kind: server.isFavorite ? "favorite" : "recent",
          favorite: server.isFavorite,
        };
      });
    },
    resolve(opaqueId: string): QuickServer | undefined {
      return targetByOpaqueId.get(opaqueId);
    },
  };
}
