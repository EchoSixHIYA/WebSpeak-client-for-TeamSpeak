import { createHash } from "node:crypto";
import { PluginRegistry } from "./registry.js";
import { PLUGIN_STORE_INDEX, PLUGIN_STORE_REPOSITORY, PLUGIN_LIMIT_BYTES, pluginAssert, pluginId, pluginRecord,
  parsePluginManifest, parsePluginPackage, PluginError, type PluginCatalog, type PluginStoreEntry } from "../shared/plugins.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const SHA = /^[a-f0-9]{64}$/;
export class PluginStore {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async read(url: string, limit: number): Promise<Buffer> {
    pluginAssert(new URL(url).origin === "https://raw.githubusercontent.com");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.fetcher(url, { signal: controller.signal, redirect: "error", credentials: "omit" });
      pluginAssert(response.ok && response.body, "PLUGIN_STORE_UNAVAILABLE");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > limit) { await reader.cancel(); throw new PluginError("PLUGIN_TOO_LARGE"); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      return Buffer.concat(chunks, size);
    } catch (error) { if (error instanceof PluginError) throw error; throw new PluginError("PLUGIN_STORE_UNAVAILABLE"); }
    finally { clearTimeout(timer); }
  }
  private async json(url: string): Promise<unknown> {
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await this.read(url, 128 * 1024))); }
    catch (e) { if (e instanceof PluginError) throw e; throw new PluginError("PLUGIN_INVALID"); }
  }
  private async sources() {
    const root = await this.json(PLUGIN_STORE_INDEX);
    pluginAssert(pluginRecord(root) && root.schemaVersion === 1 && Array.isArray(root.plugins) && root.plugins.length <= 50);
    const seen = new Set<string>();
    return root.plugins.map(item => {
      pluginAssert(pluginRecord(item) && pluginId(item.id) && !seen.has(item.id)); seen.add(item.id);
      pluginAssert(typeof item.repository === "string" && /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(item.repository) && !item.repository.endsWith(".git"));
      const metadataPath = item.metadataPath ?? "plugin.json";
      pluginAssert(typeof metadataPath === "string" && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/.test(metadataPath) && metadataPath.length <= 160);
      return { id: item.id, repository: item.repository, metadataPath };
    });
  }
  private async metadata(source: { id: string; repository: string; metadataPath: string }) {
    const rawBase = source.repository.replace("https://github.com/", "https://raw.githubusercontent.com/");
    const value = await this.json(`${rawBase}/HEAD/${source.metadataPath}`);
    pluginAssert(pluginRecord(value) && pluginRecord(value.package));
    const manifest = parsePluginManifest(value.manifest), pack = value.package;
    pluginAssert(manifest.id === source.id && typeof pack.ref === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(pack.ref));
    pluginAssert(typeof pack.path === "string" && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.wplugin$/.test(pack.path) && pack.path.length <= 160);
    pluginAssert(typeof pack.sha256 === "string" && SHA.test(pack.sha256));
    const descriptor = { ref: pack.ref, path: pack.path, sha256: pack.sha256 };
    return { manifest, descriptor, revision: hash({ source, manifest, package: descriptor }), url: `${rawBase}/${pack.ref}/${pack.path}` };
  }
  async list(): Promise<PluginCatalog> {
    const sources = await this.sources(), entries = new Array<PluginStoreEntry>(sources.length); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, sources.length) }, async () => {
      while (cursor < sources.length) { const i = cursor++, source = sources[i];
        try { const meta = await this.metadata(source); entries[i] = { ...source, manifest: meta.manifest, revision: meta.revision, error: null }; }
        catch (e) { entries[i] = { ...source, manifest: null, revision: "", error: e instanceof PluginError ? e.code : "PLUGIN_STORE_UNAVAILABLE" }; }
      }
    }));
    return { repository: PLUGIN_STORE_REPOSITORY, entries };
  }
  async install(registry: PluginRegistry, input: unknown) {
    pluginAssert(pluginRecord(input) && pluginId(input.id) && typeof input.revision === "string" && SHA.test(input.revision));
    pluginAssert(input.installedRevision === null || typeof input.installedRevision === "string" && SHA.test(input.installedRevision));
    const source = (await this.sources()).find(s => s.id === input.id); pluginAssert(source, "PLUGIN_NOT_FOUND");
    const metadata = await this.metadata(source); pluginAssert(metadata.revision === input.revision, "PLUGIN_CHANGED");
    const bytes = await this.read(metadata.url, PLUGIN_LIMIT_BYTES);
    pluginAssert(createHash("sha256").update(bytes).digest("hex") === metadata.descriptor.sha256, "PLUGIN_CHECKSUM");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new PluginError("PLUGIN_INVALID"); }
    const pack = parsePluginPackage(value); pluginAssert(JSON.stringify(pack.manifest) === JSON.stringify(metadata.manifest), "PLUGIN_PACKAGE_MISMATCH");
    return registry.install(pack, input.installedRevision as string | null);
  }
}
