import { createHash } from "node:crypto";
import { SkinRegistry, SkinRegistryError, validateSkinArchive, isBuiltinSkinId } from "./skin-registry.js";
import {
  SKIN_STORE_INDEX_URL, SKIN_STORE_REPOSITORY, compareSkinVersions, isSkinStoreVersion,
  type SkinStoreCatalog, type SkinStoreEntry, type SkinStoreMetadata, type SkinStoreInstallInput,
} from "../shared/skin-store.js";

const MAX_PACK_BYTES = 20 * 1024 * 1024;
const MAX_INDEX_BYTES = 128 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const CACHE_MS = 5 * 60 * 1000;
const ID = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const SHA = /^[a-f0-9]{64}$/;
const fail = (code: string): never => { throw new SkinRegistryError(code, code); };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("SKIN_STORE_INVALID");
  return value as Record<string, unknown>;
};

export function skinRepository(value: unknown): string {
  if (typeof value !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value)
    || value.endsWith("/.") || value.endsWith("/..") || value.endsWith(".git")) return fail("SKIN_STORE_INVALID");
  return value;
}

function parseIndex(value: unknown): { id: string; repository: string }[] {
  const root = record(value);
  if (root.schemaVersion !== 1 || !Array.isArray(root.skins) || root.skins.length > 50) return fail("SKIN_STORE_INVALID");
  const seen = new Set<string>();
  return root.skins.map(item => {
    const entry = record(item);
    if (typeof entry.id !== "string" || !ID.test(entry.id) || isBuiltinSkinId(entry.id) || entry.id.startsWith("builtin.") || seen.has(entry.id)) return fail("SKIN_STORE_INVALID");
    seen.add(entry.id);
    return { id: entry.id, repository: skinRepository(entry.repository) };
  });
}

function parseMetadata(value: unknown, id: string): SkinStoreMetadata {
  const root = record(value), pack = record(root.package);
  const field = (key: string, max: number, empty = false): string => {
    const value = root[key];
    if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) return fail("SKIN_STORE_INVALID");
    return value;
  };
  if (root.schemaVersion !== 1 || root.id !== id || !isSkinStoreVersion(root.version) || !isSkinStoreVersion(root.minAppVersion)
    || typeof pack.ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(pack.ref)
    || typeof pack.path !== "string" || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.wskin$/.test(pack.path) || pack.path.length > 200
    || typeof pack.sha256 !== "string" || !SHA.test(pack.sha256)) return fail("SKIN_STORE_INVALID");
  return { schemaVersion: 1, id, name: field("name", 80), author: field("author", 80), license: field("license", 80),
    description: field("description", 400, true), version: root.version, minAppVersion: root.minAppVersion,
    package: { ref: pack.ref, path: pack.path, sha256: pack.sha256 } };
}

export class SkinStore {
  private cached: SkinStoreCatalog | null = null;
  private loading: Promise<SkinStoreCatalog> | null = null;
  constructor(private readonly appVersion: string, private readonly fetcher: typeof fetch = fetch) {}

  /** No arbitrary URLs, redirects, credentials, or unbounded downloads enter the server. */
  private async download(url: string, limit: number): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const parsed = new URL(url);
      if (parsed.origin !== "https://raw.githubusercontent.com" || parsed.username || parsed.password) return fail("SKIN_STORE_INVALID");
      const response = await this.fetcher(url, { redirect: "error", signal: controller.signal, headers: { accept: "application/octet-stream" }, credentials: "omit" });
      if (!response.ok || !response.body) return fail("SKIN_STORE_UNAVAILABLE");
      const declared = response.headers.get("content-length");
      if (declared && Number(declared) > limit) { await response.body.cancel(); return fail("SKIN_STORE_TOO_LARGE"); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > limit) { await reader.cancel(); return fail("SKIN_STORE_TOO_LARGE"); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (error instanceof SkinRegistryError) throw error;
      return fail("SKIN_STORE_UNAVAILABLE");
    } finally { clearTimeout(timeout); }
  }
  private async json(url: string, limit: number): Promise<unknown> {
    const bytes = await this.download(url, limit);
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return fail("SKIN_STORE_INVALID"); }
  }
  private async entry(source: { id: string; repository: string }): Promise<SkinStoreEntry> {
    const metadata = parseMetadata(await this.json(`${source.repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/HEAD/skin.json`, MAX_METADATA_BYTES), source.id);
    return { ...source, metadata, revision: createHash("sha256").update(JSON.stringify({ ...source, metadata })).digest("hex"),
      compatible: isSkinStoreVersion(this.appVersion) && compareSkinVersions(this.appVersion, metadata.minAppVersion) >= 0, error: null };
  }
  async list(refresh = false): Promise<SkinStoreCatalog> {
    if (this.loading) return this.loading;
    if (!refresh && this.cached && Date.now() - this.cached.fetchedAt < CACHE_MS) return this.cached;
    const pending = this.readCatalog();
    this.loading = pending;
    try { this.cached = await pending; return this.cached; }
    finally { this.loading = null; }
  }
  private async readCatalog(): Promise<SkinStoreCatalog> {
    const sources = parseIndex(await this.json(SKIN_STORE_INDEX_URL, MAX_INDEX_BYTES));
    const entries: SkinStoreEntry[] = new Array(sources.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, sources.length) }, async () => {
      while (cursor < sources.length) {
        const index = cursor++;
        try { entries[index] = await this.entry(sources[index]); }
        catch (error) { entries[index] = { ...sources[index], metadata: null, revision: "", compatible: false,
          error: error instanceof SkinRegistryError ? error.code : "SKIN_STORE_UNAVAILABLE" }; }
      }
    }));
    return { repository: SKIN_STORE_REPOSITORY, appVersion: this.appVersion, fetchedAt: Date.now(), entries };
  }
  /** Caller serializes this with all other registry mutations. */
  async install(registry: SkinRegistry, value: unknown) {
    const input = record(value) as unknown as SkinStoreInstallInput;
    if (typeof input.id !== "string" || !ID.test(input.id) || typeof input.revision !== "string" || !SHA.test(input.revision)
      || !(input.installedVersion === null || isSkinStoreVersion(input.installedVersion))) return fail("SKIN_STORE_INVALID");
    const sources = parseIndex(await this.json(SKIN_STORE_INDEX_URL, MAX_INDEX_BYTES));
    const source = sources.find(entry => entry.id === input.id);
    if (!source) return fail("SKIN_STORE_NOT_FOUND");
    const entry = await this.entry(source);
    if (entry.revision !== input.revision) return fail("SKIN_STORE_CHANGED");
    if (!entry.compatible) return fail("SKIN_STORE_INCOMPATIBLE");
    const installed = (await registry.list()).find(item => item.id === input.id);
    if ((installed?.version ?? null) !== input.installedVersion) return fail("SKIN_STORE_INSTALLED_CHANGED");
    const metadata = entry.metadata!;
    if (installed && compareSkinVersions(metadata.version, installed.version) <= 0) return fail("SKIN_STORE_NOT_NEWER");
    const bytes = await this.download(`${source.repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${metadata.package.ref}/${metadata.package.path}`, MAX_PACK_BYTES);
    if (createHash("sha256").update(bytes).digest("hex") !== metadata.package.sha256) return fail("SKIN_STORE_CHECKSUM");
    const { manifest } = validateSkinArchive(bytes, input.id);
    for (const key of ["id", "name", "version", "author", "license", "minAppVersion"] as const) {
      if (manifest[key] !== metadata[key]) return fail("SKIN_STORE_PACKAGE_MISMATCH");
    }
    return registry.save(bytes, input.id);
  }
}
