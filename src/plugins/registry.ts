import { mkdir, readFile, readdir, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseTeamSpeakTarget, teamSpeakTargetKey } from "../domain/teamspeak-target.js";
import { parsePluginPackage, parsePluginJson, pluginAssert, pluginId, pluginRecord, PluginError, PLUGIN_LIMIT_BYTES,
  type InstalledPlugin, type PluginPackage, type PluginSettings } from "../shared/plugins.js";

interface StoredPlugin extends InstalledPlugin { package: PluginPackage }
export class PluginRegistry {
  private records = new Map<string, StoredPlugin>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly listeners = new Set<(id: string) => void>();
  constructor(private readonly directory: string) {}
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const file of await readdir(this.directory)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(this.directory, file));
        pluginAssert(raw.length <= PLUGIN_LIMIT_BYTES + 32 * 1024);
        const value = JSON.parse(raw.toString("utf8"));
        const pack = parsePluginPackage(value.package);
        pluginAssert(file === `${pack.manifest.id}.json` && typeof value.installedAt === "number");
        const settings = this.settings(value.settings, pack);
        this.records.set(pack.manifest.id, { package: pack, manifest: pack.manifest, settings, installedAt: value.installedAt, revision: this.hash(pack, settings) });
      } catch { /* An invalid package is never executed or exposed. */ }
    }
  }
  list(): InstalledPlugin[] { return [...this.records.values()].map(({ package: _, ...value }) => structuredClone(value)); }
  get(id: string): StoredPlugin | undefined { const r = this.records.get(id); return r ? structuredClone(r) : undefined; }
  policy(id: string): InstalledPlugin | undefined {
    const record = this.records.get(id); if (!record) return undefined;
    const { package: _, ...policy } = record; return structuredClone(policy);
  }
  private hash(pack: PluginPackage, settings: PluginSettings): string { return createHash("sha256").update(JSON.stringify({ pack, settings })).digest("hex"); }
  private settings(value: unknown, pack: PluginPackage): PluginSettings {
    pluginAssert(pluginRecord(value) && typeof value.enabled === "boolean" && pack.manifest.scopes.includes(value.scope as never));
    pluginAssert(Array.isArray(value.targets) && value.targets.length <= 50 && value.targets.every(t => typeof t === "string" && t.length <= 300));
    let targets: string[];
    try { targets = [...new Set(value.targets.map(t => teamSpeakTargetKey(parseTeamSpeakTarget(t))))]; }
    catch { throw new PluginError("PLUGIN_TARGET_INVALID"); }
    pluginAssert(value.scope !== "server" || !value.enabled || targets.length > 0, "PLUGIN_TARGET_REQUIRED");
    return { enabled: value.enabled, scope: value.scope as PluginSettings["scope"], targets, config: parsePluginJson(value.config, 8192) };
  }
  private mutate<T>(run: () => Promise<T>): Promise<T> { const next = this.queue.then(run, run); this.queue = next.catch(() => undefined); return next; }
  private async commit(record: StoredPlugin): Promise<InstalledPlugin> {
    const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record), { flag: "wx", mode: 0o600 });
      await rename(temporary, path.join(this.directory, `${record.manifest.id}.json`));
    } finally { await unlink(temporary).catch(() => undefined); }
    this.records.set(record.manifest.id, record);
    for (const listener of this.listeners) { try { listener(record.manifest.id); } catch { /* Commit already succeeded. */ } }
    const { package: _, ...result } = record; return structuredClone(result);
  }
  install(pack: PluginPackage, expectedRevision: string | null): Promise<InstalledPlugin> {
    return this.mutate(async () => {
      pack = parsePluginPackage(pack);
      const previous = this.records.get(pack.manifest.id);
      pluginAssert((previous?.revision ?? null) === expectedRevision, "PLUGIN_CHANGED");
      pluginAssert(previous || this.records.size < 50, "PLUGIN_LIMIT");
      // Updates require an explicit enable/review of the new permission set.
      const settings = { ...(previous?.settings ?? { scope: pack.manifest.scopes[0], targets: [], config: {} }), enabled: false };
      if (!pack.manifest.scopes.includes(settings.scope)) settings.scope = pack.manifest.scopes[0];
      return this.commit({ package: pack, manifest: pack.manifest, settings, revision: this.hash(pack, settings), installedAt: previous?.installedAt ?? Date.now() });
    });
  }
  configure(id: string, input: unknown, revision: string): Promise<InstalledPlugin> {
    return this.mutate(async () => {
      const record = this.records.get(id); pluginAssert(record, "PLUGIN_NOT_FOUND");
      pluginAssert(record.revision === revision, "PLUGIN_CHANGED");
      const settings = this.settings(input, record.package);
      return this.commit({ ...record, settings, revision: this.hash(record.package, settings) });
    });
  }
  remove(id: string, revision: string): Promise<void> {
    return this.mutate(async () => {
      pluginAssert(pluginId(id)); const record = this.records.get(id); pluginAssert(record, "PLUGIN_NOT_FOUND");
      pluginAssert(record.revision === revision, "PLUGIN_CHANGED");
      await unlink(path.join(this.directory, `${id}.json`)); this.records.delete(id);
      for (const listener of this.listeners) { try { listener(id); } catch { /* Removal already succeeded. */ } }
    });
  }
}
