export interface SkinCatalogEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  description?: string;
  minAppVersion: string;
  previewUrl?: string;
  previewMimeType?: string;
  installedAt: number;
  builtIn?: boolean;
  enabled?: boolean;
  previewKind?: "day" | "night" | "illusia" | "discord";
}

