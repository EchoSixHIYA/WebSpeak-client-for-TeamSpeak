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
}

export async function listPublicSkins(): Promise<SkinCatalogEntry[]> {
  try {
    const response = await fetch("/api/skins", { headers: { accept: "application/json" }, cache: "no-cache" });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as { skins?: unknown }).skins)) return [];
    return (payload as { skins: unknown[] }).skins.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const skin = value as Record<string, unknown>;
      if (typeof skin.id !== "string" || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(skin.id) || skin.id.startsWith("builtin.")) return [];
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
      }];
    });
  } catch {
    return [];
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
