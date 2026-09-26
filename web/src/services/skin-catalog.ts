export interface SkinCatalogEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  description?: string;
  minAppVersion: string;
  previewUrl?: string;
  installedAt: number;
  builtIn?: boolean;
  enabled?: boolean;
  previewKind?: "day" | "night" | "illusia";
}

export const BUILTIN_ILLUSIA_SKIN_ID = "community.illusia-voice";

export const BUILTIN_SKIN_CATALOG: SkinCatalogEntry[] = [
  {
    id: "builtin.light",
    name: "Day mode",
    version: "1.0.0",
    author: "WebSpeak",
    license: "AGPL-3.0-only",
    description: "The default light appearance.",
    minAppVersion: "0.2.5-preview",
    installedAt: 0,
    builtIn: true,
    previewKind: "day",
  },
  {
    id: "builtin.dark",
    name: "Night mode",
    version: "1.0.0",
    author: "WebSpeak",
    license: "AGPL-3.0-only",
    description: "The default dark appearance.",
    minAppVersion: "0.2.5-preview",
    installedAt: 0,
    builtIn: true,
    previewKind: "night",
  },
  {
    id: BUILTIN_ILLUSIA_SKIN_ID,
    name: "ILLUSIA风",
    version: "1.0.25",
    author: "WebSpeak Project",
    license: "All rights reserved",
    description: "A bright original-character art skin for the home, voice room, and demo pages.",
    minAppVersion: "0.2.5-preview",
    previewUrl: "/skins/illusia-voice-preview.webp",
    installedAt: 0,
    builtIn: true,
    previewKind: "illusia",
  },
];

const BUILTIN_ILLUSIA_PACKAGE_URL = "/skins/illusia-voice.wskin";
let publicDirectoryLoaded = false;
let publicEnabledSkinIds = new Set<string>(BUILTIN_SKIN_CATALOG.map((skin) => skin.id));
let publicDefaultSkinId = "builtin.light";

export function getPublicDefaultSkinId(): string {
  return isPublicSkinEnabled(publicDefaultSkinId) ? publicDefaultSkinId : "builtin.light";
}

export function isPublicSkinEnabled(id: string): boolean {
  if (BUILTIN_SKIN_CATALOG.some((skin) => skin.id === id)) return true;
  return !publicDirectoryLoaded || publicEnabledSkinIds.has(id);
}

export function getBundledSkinPackageUrl(id: string): string | null {
  return id === BUILTIN_ILLUSIA_SKIN_ID ? BUILTIN_ILLUSIA_PACKAGE_URL : null;
}

export async function listPublicSkins(): Promise<SkinCatalogEntry[]> {
  publicDirectoryLoaded = false;
  publicEnabledSkinIds = new Set(BUILTIN_SKIN_CATALOG.map((skin) => skin.id));
  publicDefaultSkinId = "builtin.light";
  try {
    const response = await fetch("/api/skins", { headers: { accept: "application/json" }, cache: "no-cache" });
    if (!response.ok) return BUILTIN_SKIN_CATALOG;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { skins?: unknown }).skins)) return BUILTIN_SKIN_CATALOG;
    const directorySkins = (payload as { skins: unknown[] }).skins.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const skin = value as Record<string, unknown>;
      if (typeof skin.id !== "string" || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(skin.id) || skin.id.startsWith("builtin.") || skin.id === BUILTIN_ILLUSIA_SKIN_ID) return [];
      if ([skin.name, skin.version, skin.author, skin.license, skin.minAppVersion].some((field) => typeof field !== "string")) return [];
      const previewUrl = typeof skin.previewUrl === "string" && skin.previewUrl === `/api/skins/${skin.id}/preview` ? skin.previewUrl : undefined;
      return [{
        id: skin.id,
        name: skin.name as string,
        version: skin.version as string,
        author: skin.author as string,
        license: skin.license as string,
        minAppVersion: skin.minAppVersion as string,
        ...(typeof skin.description === "string" ? { description: skin.description } : {}),
        ...(previewUrl ? { previewUrl } : {}),
        installedAt: Number.isFinite(skin.installedAt) ? Number(skin.installedAt) : 0,
        enabled: skin.enabled !== false,
      }];
    });
    publicDirectoryLoaded = true;
    publicEnabledSkinIds = new Set([
      ...BUILTIN_SKIN_CATALOG.map((skin) => skin.id),
      ...directorySkins.filter((skin) => skin.enabled).map((skin) => skin.id),
    ]);
    const requestedDefault = (payload as { defaultSkinId?: unknown }).defaultSkinId;
    publicDefaultSkinId = typeof requestedDefault === "string" && publicEnabledSkinIds.has(requestedDefault) ? requestedDefault : "builtin.light";
    return [...BUILTIN_SKIN_CATALOG, ...directorySkins.filter((skin) => skin.enabled)];
  } catch {
    publicDirectoryLoaded = false;
    publicEnabledSkinIds = new Set(BUILTIN_SKIN_CATALOG.map((skin) => skin.id));
    publicDefaultSkinId = "builtin.light";
    return BUILTIN_SKIN_CATALOG;
  }
}

export async function uploadSkinPackage(file: File, csrfToken: string, confirmReplace?: (id: string) => boolean): Promise<SkinCatalogEntry | null> {
  const { importSkinPack } = await import("./skin-pack.js");
  const skin = await importSkinPack(file);
  if (confirmReplace && !confirmReplace(skin.id)) return null;
  const response = await fetch(`/api/admin/skins/${encodeURIComponent(skin.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "x-csrf-token": csrfToken, accept: "application/json" },
    body: file,
  });
  const payload = await response.json().catch(() => null) as { skin?: SkinCatalogEntry; message?: string; code?: string } | null;
  if (!response.ok || !payload?.skin) throw new Error(payload?.message || payload?.code || `HTTP_${response.status}`);
  return payload.skin;
}

export async function deleteSkinPackage(id: string, csrfToken: string): Promise<void> {
  const response = await fetch(`/api/admin/skins/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken, accept: "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(payload?.code || `HTTP_${response.status}`);
  }
}
