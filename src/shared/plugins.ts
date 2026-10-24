/** Versioned, browser-safe functional plugin contract; independent of .wskin. */
export const PLUGIN_API_VERSION = 1;
export const PLUGIN_STORE_REPOSITORY = "https://github.com/Huddle-Up-Forge/webspeak-plugin";
export const PLUGIN_STORE_INDEX = "https://raw.githubusercontent.com/Huddle-Up-Forge/webspeak-plugin/main/index.json";
export const PLUGIN_LIMIT_BYTES = 512 * 1024;
export const PLUGIN_STATE_LIMIT_BYTES = 16 * 1024;
export const pluginId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9.-]{0,79}$/.test(v);
export const pluginRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export type PluginScope = "server" | "instance";
export type PluginPermission = "room.read" | "room.write";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface PluginManifest {
  apiVersion: 1; id: string; name: string; version: string; author: string; license: string; description: string;
  scopes: PluginScope[]; permissions: PluginPermission[];
}
/** UTF-8 JSON package; code executes only in an opaque-origin browser iframe. */
export interface PluginPackage { manifest: PluginManifest; html: string; script: string; styles: { light: string; dark: string } }
export interface PluginSettings { enabled: boolean; scope: PluginScope; targets: string[]; config: JsonValue }
export interface InstalledPlugin { manifest: PluginManifest; settings: PluginSettings; revision: string; installedAt: number }
export interface PluginStoreEntry { id: string; repository: string; metadataPath: string; manifest: PluginManifest | null; revision: string; error: string | null }
export interface PluginCatalog { repository: string; entries: PluginStoreEntry[] }
export interface PluginRoomSnapshot { roomId: string; revision: number; state: JsonValue; serverTime: number; participants: { id: string; nickname: string }[] }
export interface PluginRequest { type: "pluginRequest"; requestId: string; action: "list" | "open" | "snapshot" | "update" | "close"; pluginId?: string; revision?: number; state?: JsonValue }
export type PluginMessage =
  | { type: "pluginReply"; requestId: string; ok: boolean; result?: unknown; code?: string }
  | { type: "pluginEvent"; pluginId: string; snapshot: PluginRoomSnapshot | null; code?: string };

export class PluginError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PluginError"; }
}
export function pluginAssert(value: unknown, code = "PLUGIN_INVALID"): asserts value {
  if (!value) throw new PluginError(code);
}
export function parsePluginManifest(value: unknown): PluginManifest {
  pluginAssert(pluginRecord(value));
  pluginAssert(value.apiVersion === 1 && pluginId(value.id));
  for (const [key, max] of [["name",80],["author",80],["license",80],["description",400],["version",32]] as const)
    pluginAssert(typeof value[key] === "string" && value[key].trim().length > 0 && value[key].length <= max && !/[\u0000-\u001f\u007f]/.test(value[key]));
  pluginAssert(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.version as string));
  pluginAssert(Array.isArray(value.scopes) && value.scopes.length > 0 && value.scopes.length <= 2 && new Set(value.scopes).size === value.scopes.length && value.scopes.every(s => s === "server" || s === "instance"));
  pluginAssert(Array.isArray(value.permissions) && value.permissions.length <= 2 && new Set(value.permissions).size === value.permissions.length && value.permissions.every(p => p === "room.read" || p === "room.write"));
  pluginAssert(!value.permissions.includes("room.write") || value.permissions.includes("room.read"));
  return { apiVersion: 1, id: value.id, name: value.name as string, version: value.version as string, author: value.author as string,
    license: value.license as string, description: value.description as string, scopes: [...value.scopes], permissions: [...value.permissions] };
}
export function parsePluginPackage(value: unknown): PluginPackage {
  pluginAssert(pluginRecord(value) && pluginRecord(value.styles));
  for (const s of [value.html, value.script, value.styles.light, value.styles.dark]) pluginAssert(typeof s === "string" && s.trim().length > 0 && s.length <= 256 * 1024);
  const result = { manifest: parsePluginManifest(value.manifest), html: value.html as string, script: value.script as string,
    styles: { light: value.styles.light as string, dark: value.styles.dark as string } };
  pluginAssert(new TextEncoder().encode(JSON.stringify(result)).length <= PLUGIN_LIMIT_BYTES, "PLUGIN_TOO_LARGE");
  return result;
}
export function parsePluginJson(value: unknown, maxBytes = PLUGIN_STATE_LIMIT_BYTES): JsonValue {
  let count = 0;
  function visit(v: unknown, depth: number): void {
    pluginAssert(depth <= 16 && ++count <= 4096);
    if (v === null || typeof v === "boolean" || typeof v === "string") return;
    if (typeof v === "number") { pluginAssert(Number.isFinite(v)); return; }
    pluginAssert(Array.isArray(v) || pluginRecord(v));
    if (Array.isArray(v)) v.forEach(x => visit(x, depth + 1));
    else for (const [key, item] of Object.entries(v)) { pluginAssert(!["__proto__", "prototype", "constructor"].includes(key)); visit(item, depth + 1); }
  }
  visit(value, 0);
  const json = JSON.stringify(value);
  pluginAssert(new TextEncoder().encode(json).length <= maxBytes, "PLUGIN_TOO_LARGE");
  return JSON.parse(json) as JsonValue;
}
export function parsePluginRequest(value: unknown): PluginRequest {
  pluginAssert(pluginRecord(value) && value.type === "pluginRequest" && typeof value.requestId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value.requestId));
  pluginAssert(["list", "open", "snapshot", "update", "close"].includes(String(value.action)));
  pluginAssert(value.action === "list" || pluginId(value.pluginId));
  if (value.action === "update") pluginAssert(Number.isSafeInteger(value.revision) && (value.revision as number) >= 0);
  return { type: "pluginRequest", requestId: value.requestId, action: value.action as PluginRequest["action"],
    ...(value.action === "list" ? {} : { pluginId: value.pluginId as string }),
    ...(value.action === "update" ? { revision: value.revision as number, state: parsePluginJson(value.state) } : {}) };
}

export function readInstalledPlugin(value: unknown): InstalledPlugin {
  pluginAssert(pluginRecord(value) && pluginRecord(value.settings) && typeof value.revision === "string" && /^[a-f0-9]{64}$/.test(value.revision) && typeof value.installedAt === "number" && Number.isFinite(value.installedAt));
  const manifest = parsePluginManifest(value.manifest), s = value.settings;
  pluginAssert(typeof s.enabled === "boolean" && manifest.scopes.includes(s.scope as never) && Array.isArray(s.targets) && s.targets.length <= 50 && s.targets.every(t => typeof t === "string" && t.length <= 300));
  return { manifest, revision: value.revision, installedAt: value.installedAt,
    settings: { enabled: s.enabled, scope: s.scope as PluginScope, targets: [...s.targets], config: parsePluginJson(s.config, 8192) } };
}
export const pluginResponses = {
  installed(value: unknown): { plugins: InstalledPlugin[] } {
    pluginAssert(pluginRecord(value) && Array.isArray(value.plugins) && value.plugins.length <= 50);
    return { plugins: value.plugins.map(readInstalledPlugin) };
  },
  saved(value: unknown): { plugin: InstalledPlugin } { pluginAssert(pluginRecord(value)); return { plugin: readInstalledPlugin(value.plugin) }; },
  catalog(value: unknown): PluginCatalog {
    pluginAssert(pluginRecord(value) && value.repository === PLUGIN_STORE_REPOSITORY && Array.isArray(value.entries) && value.entries.length <= 50);
    const entries = value.entries.map(v => {
      pluginAssert(pluginRecord(v) && pluginId(v.id) && typeof v.repository === "string" && /^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(v.repository)
        && typeof v.metadataPath === "string" && typeof v.revision === "string" && (v.error === null || typeof v.error === "string"));
      return { id: v.id, repository: v.repository, metadataPath: v.metadataPath, revision: v.revision, error: v.error, manifest: v.manifest === null ? null : parsePluginManifest(v.manifest) };
    });
    return { repository: value.repository, entries };
  },
};
