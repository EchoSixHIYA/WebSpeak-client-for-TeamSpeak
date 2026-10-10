/** Owns object URLs for one rendered skin-plugin outlet. */
export function createSkinPluginAssetUrlCache() {
  const urls = new Map<string, { asset: Blob; url: string }>();

  function release(path: string): void {
    const entry = urls.get(path);
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    urls.delete(path);
  }

  return {
    resolve(path: string, assets: Readonly<Record<string, Blob>>): string | undefined {
      const asset = assets[path];
      const existing = urls.get(path);
      if (!(asset instanceof Blob)) {
        release(path);
        return undefined;
      }
      if (existing?.asset === asset) return existing.url;
      release(path);
      const url = URL.createObjectURL(asset);
      urls.set(path, { asset, url });
      return url;
    },
    clear(): void {
      for (const path of urls.keys()) release(path);
    },
    get size(): number { return urls.size; },
  };
}
