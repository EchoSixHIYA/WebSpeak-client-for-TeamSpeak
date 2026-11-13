/** Portable application runtime v2. Independent of skins and their component APIs. */
export const PLUGIN_API_VERSION = 2;
export const PLUGIN_STORE_REPOSITORY = "https://github.com/Huddle-Up-Forge/webspeak-plugin";
export const PLUGIN_STORE_INDEX = "https://raw.githubusercontent.com/Huddle-Up-Forge/webspeak-plugin/main/index.json";
export const PLUGIN_LIMIT_BYTES = 48 * 1024 * 1024;
export const PLUGIN_CONTENT_LIMIT_BYTES = 32 * 1024 * 1024;
export const PLUGIN_FILE_LIMIT_BYTES = 16 * 1024 * 1024;
export const pluginId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9.-]{0,79}$/.test(v);
export const pluginRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export type PluginScope = "server" | "instance";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface PluginManifest {
  apiVersion: 2; id: string; name: string; version: string; author: string; license: string; description: string;
  scopes: PluginScope[]; client: { entry: string }; server?: { entry: string };
}
export interface PluginFile { encoding: "utf8" | "base64"; data: string }
export interface PluginPackage { manifest: PluginManifest; files: Record<string, PluginFile> }
export interface PluginSettings { enabled: boolean; trusted: boolean; toolbarPinned: boolean; scope: PluginScope; targets: string[]; config: JsonValue; hasServerConfig: boolean }
export interface PluginSettingsInput {
  enabled: boolean; trusted: boolean; toolbarPinned?: boolean; scope: PluginScope; targets: string[]; config: JsonValue;
  serverConfigAction?: "keep" | "replace" | "remove"; serverConfig?: JsonValue;
}
export interface PluginRuntimeStatus { state: "disabled" | "client" | "stopped" | "starting" | "running" | "failed"; error?: string }
export interface InstalledPlugin { manifest: PluginManifest; settings: PluginSettings; revision: string; installedAt: number; runtime?: PluginRuntimeStatus }
export interface PluginStoreEntry { id: string; repository: string; metadataPath: string; manifest: PluginManifest | null; revision: string; error: string | null }
export interface PluginCatalog { repository: string; entries: PluginStoreEntry[] }
/** Public context, never a TS private identity, voice socket or administrator credential. */
export interface PluginParticipant {
  id: string; nickname: string; uid?: string; target: string; channelId: string;
  members: { id: number; nickname: string; uid?: string }[];
}
export interface PluginRequestContext {
  apiVersion: 2; appId: string; self: { id: string; nickname: string; uid?: string };
  connection: { target: string; channelId: string };
  scope: { type: PluginScope; key: string };
}
export interface PluginAppContext extends PluginRequestContext {
  plugin: PluginManifest;
  connection: PluginRequestContext["connection"] & { members: PluginParticipant["members"] };
  config: JsonValue;
  theme: "light" | "dark"; language: "zh" | "en" | "de" | "ru" | "ja";
  serverUrl: string | null; socketUrl: string | null; contextUrl: string;
}
export interface PluginAppLaunch { id: string; url: string; manifest: PluginManifest }
export interface PluginRuntimeSettings { publicOrigin: string; port: number; available: boolean; revision: string }
export class PluginError extends Error { constructor(readonly code: string) { super(code); this.name = "PluginError"; } }
export function pluginAssert(v: unknown, code = "PLUGIN_INVALID"): asserts v { if (!v) throw new PluginError(code); }
export function pluginPath(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 500 && v.split("/").every(s =>
    /^[A-Za-z0-9._@+~-]+$/.test(s) && s !== "." && s !== ".." && !s.endsWith(".") && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
}
export function parsePluginManifest(v: unknown): PluginManifest {
  pluginAssert(pluginRecord(v)); pluginAssert(v.apiVersion === PLUGIN_API_VERSION, "PLUGIN_API_UNSUPPORTED"); pluginAssert(pluginId(v.id));
  for (const [key,max] of [["name",80],["author",80],["license",80],["description",400],["version",32]] as const)
    pluginAssert(typeof v[key] === "string" && v[key].trim().length > 0 && v[key].length <= max && !/[\u0000-\u001f\u007f]/.test(v[key]));
  pluginAssert(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(v.version as string));
  pluginAssert(Array.isArray(v.scopes) && v.scopes.length > 0 && v.scopes.length <= 2 && new Set(v.scopes).size === v.scopes.length && v.scopes.every(s => s === "server" || s === "instance"));
  pluginAssert(v.permissions === undefined, "PLUGIN_API_UNSUPPORTED");
  pluginAssert(pluginRecord(v.client) && pluginPath(v.client.entry) && v.client.entry.startsWith("client/") && v.client.entry.endsWith(".html"));
  let server: { entry: string } | undefined;
  if (v.server !== undefined) { pluginAssert(pluginRecord(v.server) && pluginPath(v.server.entry) && v.server.entry.startsWith("server/") && /\.(?:mjs|cjs)$/.test(v.server.entry)); server = {entry:v.server.entry}; }
  return {apiVersion:2,id:v.id,name:v.name as string,version:v.version as string,author:v.author as string,license:v.license as string,description:v.description as string,scopes:[...v.scopes],client:{entry:v.client.entry},...(server?{server}:{})};
}
export function pluginFileSize(file: PluginFile): number {
  return file.encoding === "utf8" ? new TextEncoder().encode(file.data).length : file.data.length / 4 * 3 - (file.data.endsWith("==") ? 2 : file.data.endsWith("=") ? 1 : 0);
}
export function pluginFileBytes(file: PluginFile): Uint8Array { return file.encoding === "utf8" ? new TextEncoder().encode(file.data) : Uint8Array.from(atob(file.data), c => c.charCodeAt(0)); }
export function parsePluginPackage(v: unknown): PluginPackage {
  pluginAssert(pluginRecord(v)); const manifest = parsePluginManifest(v.manifest); pluginAssert(pluginRecord(v.files)); const entries = Object.entries(v.files);
  pluginAssert(entries.length > 0 && entries.length <= 4096);
  const files: Record<string,PluginFile> = Object.create(null), names = new Set<string>(); let total = 0;
  for (const [name,file] of entries) {
    pluginAssert(pluginPath(name) && (name.startsWith("client/") || name.startsWith("server/")) && !names.has(name.toLowerCase())); names.add(name.toLowerCase());
    pluginAssert(pluginRecord(file) && (file.encoding === "utf8" || file.encoding === "base64") && typeof file.data === "string" && file.data.length <= PLUGIN_LIMIT_BYTES);
    if (file.encoding === "base64") pluginAssert(file.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(file.data));
    const content: PluginFile = {encoding:file.encoding,data:file.data}; const size = pluginFileSize(content);
    pluginAssert(size <= PLUGIN_FILE_LIMIT_BYTES && (total += size) <= PLUGIN_CONTENT_LIMIT_BYTES,"PLUGIN_TOO_LARGE"); files[name] = content;
  }
  for (const name of names) for (let i=name.indexOf("/");i>=0;i=name.indexOf("/",i+1)) pluginAssert(!names.has(name.slice(0,i)));
  pluginAssert(files[manifest.client.entry]?.encoding === "utf8"); if (manifest.server) pluginAssert(files[manifest.server.entry]?.encoding === "utf8");
  const result = {manifest,files}; pluginAssert(new TextEncoder().encode(JSON.stringify(result)).length <= PLUGIN_LIMIT_BYTES,"PLUGIN_TOO_LARGE"); return result;
}
export function parsePluginJson(v: unknown, maxBytes = 64 * 1024): JsonValue {
  let count = 0;
  function visit(item: unknown, depth: number): void {
    pluginAssert(depth <= 64 && ++count <= 100000);
    if (item === null || typeof item === "boolean" || typeof item === "string") return;
    if (typeof item === "number") { pluginAssert(Number.isFinite(item)); return; }
    pluginAssert(Array.isArray(item) || pluginRecord(item));
    if (Array.isArray(item)) item.forEach(child=>visit(child,depth+1));
    else for (const [key,child] of Object.entries(item)) { pluginAssert(!["__proto__","prototype","constructor"].includes(key)); visit(child,depth+1); }
  }
  visit(v,0); const json=JSON.stringify(v); pluginAssert(new TextEncoder().encode(json).length <= maxBytes,"PLUGIN_TOO_LARGE"); return JSON.parse(json) as JsonValue;
}
export function readInstalledPlugin(v: unknown): InstalledPlugin {
  pluginAssert(pluginRecord(v) && pluginRecord(v.settings) && typeof v.revision === "string" && /^[a-f0-9]{64}$/.test(v.revision) && typeof v.installedAt === "number" && Number.isFinite(v.installedAt));
  const manifest=parsePluginManifest(v.manifest),s=v.settings;
  pluginAssert(typeof s.enabled === "boolean" && typeof s.trusted === "boolean" && (s.toolbarPinned === undefined || typeof s.toolbarPinned === "boolean") && typeof s.hasServerConfig === "boolean" && manifest.scopes.includes(s.scope as PluginScope) && Array.isArray(s.targets) && s.targets.length <= 50 && s.targets.every(t=>typeof t === "string" && t.length <= 300));
  const result: InstalledPlugin={manifest,revision:v.revision,installedAt:v.installedAt,settings:{enabled:s.enabled,trusted:s.trusted,toolbarPinned:s.toolbarPinned===true,scope:s.scope as PluginScope,targets:[...s.targets],config:parsePluginJson(s.config),hasServerConfig:s.hasServerConfig}};
  if(v.runtime!==undefined){pluginAssert(pluginRecord(v.runtime) && ["disabled","client","stopped","starting","running","failed"].includes(String(v.runtime.state)) && (v.runtime.error===undefined||typeof v.runtime.error==="string"));result.runtime={state:v.runtime.state as PluginRuntimeStatus["state"],...(v.runtime.error?{error:v.runtime.error as string}:{})};}
  return result;
}
export const pluginResponses = {
  runtime(v:unknown):{runtime:PluginRuntimeSettings}{
    pluginAssert(pluginRecord(v)&&pluginRecord(v.runtime));const r=v.runtime;
    pluginAssert(typeof r.publicOrigin==='string'&&r.publicOrigin.length<=300&&typeof r.available==='boolean'&&typeof r.port==='number'&&Number.isInteger(r.port)&&r.port>=0&&r.port<=65535&&typeof r.revision==='string'&&/^[a-f0-9]{64}$/.test(r.revision));
    return {runtime:{publicOrigin:r.publicOrigin,port:r.port,available:r.available,revision:r.revision}};
  },
  installed(v: unknown): {plugins:InstalledPlugin[]} {pluginAssert(pluginRecord(v)&&Array.isArray(v.plugins)&&v.plugins.length<=50);return {plugins:v.plugins.map(readInstalledPlugin)};},
  saved(v: unknown): {plugin:InstalledPlugin} {pluginAssert(pluginRecord(v));return {plugin:readInstalledPlugin(v.plugin)};},
  catalog(v: unknown): PluginCatalog {
    pluginAssert(pluginRecord(v)&&v.repository===PLUGIN_STORE_REPOSITORY&&Array.isArray(v.entries)&&v.entries.length<=50);
    const entries=v.entries.map(e=>{pluginAssert(pluginRecord(e)&&pluginId(e.id)&&typeof e.repository==="string"&&/^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(e.repository)&&typeof e.metadataPath==="string"&&typeof e.revision==="string"&&(e.error===null||typeof e.error==="string"));return {id:e.id,repository:e.repository,metadataPath:e.metadataPath,revision:e.revision,error:e.error,manifest:e.manifest===null?null:parsePluginManifest(e.manifest)};});return {repository:v.repository,entries};
  },
};
