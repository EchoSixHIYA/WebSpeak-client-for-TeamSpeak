import { isSafeQuickServerIcon, type QuickServer } from "./quick-servers.js";
import { splitTeamSpeakTarget } from "./teamspeak-target.js";

export interface SkinPluginQuickServer {
  id: string;
  label: string;
  monogram: string;
  icon: string;
  tone: number;
  current: boolean;
  switchRestricted: boolean;
  switchTitle: string;
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

const CONNECTION_TARGET_PATTERN = /(?:\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b|\[[0-9a-f:]+\](?::\d{1,5})?|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?\b|\b(?:[0-9a-f]{0,4}:){2,}[0-9a-f:]{1,}\b)/i;

function containsConnectionTarget(label: string, address: string): boolean {
  const candidates = new Set([address.trim()]);
  try { candidates.add(splitTeamSpeakTarget(address).address.trim()); } catch { /* Persisted targets are validated on write. */ }
  const normalizedLabel = label.toLocaleLowerCase();
  return CONNECTION_TARGET_PATTERN.test(normalizedLabel)
    || [...candidates].some((candidate) => candidate.length >= 3 && normalizedLabel.includes(candidate.toLocaleLowerCase()));
}

/** Returns a displayable TeamSpeak server name without exposing connection targets. */
export function safeSkinServerDisplayName(name: string, address: string): string {
  const bounded = name.trim().replace(/\u0000/g, "").slice(0, 160);
  return bounded && !containsConnectionTarget(bounded, address) ? bounded : "";
}

/** Projects local favorite/recent entries without exposing their connection targets. */
export function createSkinPluginQuickServerProjection(createId: () => string = randomOpaqueId) {
  const opaqueIdByServerId = new Map<string, string>();
  const targetByOpaqueId = new Map<string, QuickServer>();

  return {
    project(
      servers: readonly QuickServer[],
      isCurrent: (server: QuickServer) => boolean,
      switchRestricted = false,
      switchRestrictedLabel = "Server switching is restricted by the administrator",
    ): SkinPluginQuickServer[] {
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
        const serverName = safeSkinServerDisplayName(server.serverName ?? "", server.address);
        const safeLabel = !label || containsConnectionTarget(label, server.address)
          ? serverName && !containsConnectionTarget(serverName, server.address)
            ? serverName
            : `${server.isFavorite ? "Favorite" : "Recent"} ${index + 1}`
          : label;
        return {
          id: opaqueId,
          label: safeLabel,
          monogram: Array.from(serverName || safeLabel)[0] ?? "?",
          icon: isSafeQuickServerIcon(server.serverIcon) ? server.serverIcon : "",
          tone: safeLabelTone(safeLabel),
          current: isCurrent(server),
          switchRestricted,
          switchTitle: switchRestricted ? switchRestrictedLabel : safeLabel,
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
