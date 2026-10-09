import { SKIN_PLUGIN_PERMISSIONS, type SkinPluginPermission } from "./skin-plugin.js";

export const SKIN_RUNTIME_PLUGIN_DOCUMENT_VERSION = 1 as const;
export const SKIN_RUNTIME_PLUGIN_LIMIT = 64;
export const SKIN_RUNTIME_PLUGIN_ASSET_LIMIT = 32;
export const SKIN_RUNTIME_PLUGIN_DOCUMENT_LIMIT_BYTES = 256 * 1024;
export const SKIN_RUNTIME_PLUGIN_SOURCE_LIMIT_BYTES = 256 * 1024;
export const SKIN_RUNTIME_PLUGIN_STYLE_LIMIT_BYTES = 512 * 1024;

export type SkinRuntimePluginPage = "home" | "voice";
export type SkinRuntimePluginMode = "widget" | "surface";
export type SkinRuntimePluginRuntime = "javascript" | "wasm";

export interface SkinRuntimePlugin {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  runtime: SkinRuntimePluginRuntime;
  page: SkinRuntimePluginPage;
  mode: SkinRuntimePluginMode;
  entry: string;
  style?: string;
  assets: readonly string[];
  permissions: readonly SkinPluginPermission[];
}

export interface SkinRuntimePluginDocument {
  schemaVersion: typeof SKIN_RUNTIME_PLUGIN_DOCUMENT_VERSION;
  plugins: readonly SkinRuntimePlugin[];
}

export class SkinRuntimePluginValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinRuntimePluginValidationError";
  }
}

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PERMISSIONS = new Set<string>(Object.keys(SKIN_PLUGIN_PERMISSIONS));
const ASSET_PATH = /^plugins\/([a-z][a-z0-9-]{0,63})\/assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:png|jpe?g|webp|avif|gif|woff2)$/i;

function invalid(code: string, message: string): never {
  throw new SkinRuntimePluginValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    invalid("SKIN_RUNTIME_PLUGIN_FIELD_INVALID", `${context} contains an unsupported field.`);
  }
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.trim() !== value) {
    invalid("SKIN_RUNTIME_PLUGIN_MANIFEST_INVALID", `${field} must be bounded non-empty text.`);
  }
  return value;
}

function packageFile(value: unknown, field: string, pluginId: string, suffixes: readonly (".js" | ".css" | ".wasm")[]): string {
  const result = text(value, field, 160);
  if (result.includes("\\") || result.startsWith("/") || result.split("/").some((part) => !part || part === "." || part === "..")
    || !result.startsWith(`plugins/${pluginId}/`) || !suffixes.some((suffix) => result.toLowerCase().endsWith(suffix))) {
    invalid("SKIN_RUNTIME_PLUGIN_PATH_INVALID", `${field} must be a safe plugin file inside its plugin directory.`);
  }
  return result;
}

/** Parses the v4 author-plugin descriptor. It never evaluates plugin code. */
export function parseSkinRuntimePluginDocument(input: unknown): SkinRuntimePluginDocument {
  if (!isRecord(input)) invalid("SKIN_RUNTIME_PLUGIN_DOCUMENT_INVALID", "plugins.json must contain an object.");
  onlyKeys(input, ["schemaVersion", "plugins"], "plugins.json");
  if (input.schemaVersion !== SKIN_RUNTIME_PLUGIN_DOCUMENT_VERSION || !Array.isArray(input.plugins)
    || input.plugins.length < 1 || input.plugins.length > SKIN_RUNTIME_PLUGIN_LIMIT) {
    invalid("SKIN_RUNTIME_PLUGIN_DOCUMENT_INVALID", "plugins.json uses an unsupported version or plugin count.");
  }

  const ids = new Set<string>();
  const files = new Set<string>();
  const plugins: SkinRuntimePlugin[] = [];
  for (const raw of input.plugins) {
    if (!isRecord(raw)) invalid("SKIN_RUNTIME_PLUGIN_MANIFEST_INVALID", "A plugin definition must be an object.");
    onlyKeys(raw, ["id", "name", "version", "apiVersion", "runtime", "page", "mode", "entry", "style", "assets", "permissions"], "Plugin definition");

    const id = text(raw.id, "plugin.id", 64);
    if (!PLUGIN_ID.test(id) || ids.has(id)) invalid("SKIN_RUNTIME_PLUGIN_ID_INVALID", "Plugin IDs must be unique lowercase slugs.");
    ids.add(id);
    const name = text(raw.name, "plugin.name", 80);
    const version = text(raw.version, "plugin.version", 32);
    if (!SEMVER.test(version)) invalid("SKIN_RUNTIME_PLUGIN_MANIFEST_INVALID", "Plugin versions must use semantic version syntax.");
    if (raw.apiVersion !== 1) invalid("SKIN_RUNTIME_PLUGIN_API_UNSUPPORTED", "The plugin API version is not supported.");
    if (raw.page !== "home" && raw.page !== "voice") invalid("SKIN_RUNTIME_PLUGIN_MANIFEST_INVALID", "Plugins may target only the public home or voice page.");
    if (raw.mode !== "widget" && raw.mode !== "surface") invalid("SKIN_RUNTIME_PLUGIN_MANIFEST_INVALID", "Plugin mode must be widget or surface.");

    const runtime = raw.runtime === undefined
      ? (typeof raw.entry === "string" && raw.entry.toLowerCase().endsWith(".wasm") ? "wasm" : "javascript")
      : raw.runtime;
    if (runtime !== "javascript" && runtime !== "wasm") invalid("SKIN_RUNTIME_PLUGIN_RUNTIME_INVALID", "A plugin runtime must be javascript or wasm.");
    const entry = packageFile(raw.entry, "plugin.entry", id, [runtime === "wasm" ? ".wasm" : ".js"]);
    const style = raw.style === undefined ? undefined : packageFile(raw.style, "plugin.style", id, [".css"]);
    if (!Array.isArray(raw.assets) || raw.assets.length > SKIN_RUNTIME_PLUGIN_ASSET_LIMIT) {
      invalid("SKIN_RUNTIME_PLUGIN_ASSET_INVALID", "A plugin must declare a bounded asset list.");
    }
    const assets: string[] = [];
    for (const rawPath of raw.assets) {
      const assetPath = text(rawPath, "plugin.asset", 180);
      const match = ASSET_PATH.exec(assetPath);
      if (!match || match[1] !== id) invalid("SKIN_RUNTIME_PLUGIN_ASSET_INVALID", "Plugin assets must be safe local image or font files inside that plugin's assets directory.");
      assets.push(assetPath);
    }
    if (new Set(assets.map((path) => path.toLowerCase())).size !== assets.length) {
      invalid("SKIN_RUNTIME_PLUGIN_ASSET_INVALID", "A plugin asset path is duplicated.");
    }

    if (!Array.isArray(raw.permissions) || raw.permissions.length > 32) {
      invalid("SKIN_RUNTIME_PLUGIN_PERMISSION_INVALID", "Plugin permissions must be a bounded array.");
    }
    const permissions: SkinPluginPermission[] = [];
    for (const permission of raw.permissions) {
      if (typeof permission !== "string" || !PERMISSIONS.has(permission)) {
        invalid("SKIN_RUNTIME_PLUGIN_PERMISSION_INVALID", "The plugin requests an unsupported permission.");
      }
      if (permissions.includes(permission as SkinPluginPermission)) {
        invalid("SKIN_RUNTIME_PLUGIN_PERMISSION_DUPLICATE", "A plugin permission is duplicated.");
      }
      permissions.push(permission as SkinPluginPermission);
    }
    if (raw.mode === "surface" && !permissions.includes("ui.surface.replace")) {
      invalid("SKIN_RUNTIME_PLUGIN_PERMISSION_MISSING", "A surface plugin requires ui.surface.replace.");
    }

    for (const path of [entry, ...(style ? [style] : []), ...assets]) {
      const normalized = path.toLowerCase();
      if (files.has(normalized)) invalid("SKIN_RUNTIME_PLUGIN_FILE_DUPLICATE", "Plugin files cannot be shared between definitions.");
      files.add(normalized);
    }
    plugins.push({
      id,
      name,
      version,
      apiVersion: 1,
      runtime,
      page: raw.page,
      mode: raw.mode,
      entry,
      ...(style ? { style } : {}),
      assets,
      permissions,
    });
  }

  const surfacePages = new Set<SkinRuntimePluginPage>();
  for (const plugin of plugins) {
    if (plugin.mode !== "surface") continue;
    if (surfacePages.has(plugin.page)) invalid("SKIN_RUNTIME_PLUGIN_SURFACE_DUPLICATE", "Only one surface plugin may replace each public page.");
    surfacePages.add(plugin.page);
  }

  const immutablePlugins = plugins.map((plugin) => Object.freeze({
    ...plugin,
    assets: Object.freeze([...plugin.assets]),
    permissions: Object.freeze([...plugin.permissions]),
  }));
  return Object.freeze({ schemaVersion: SKIN_RUNTIME_PLUGIN_DOCUMENT_VERSION, plugins: Object.freeze(immutablePlugins) });
}

export function parseSkinRuntimePluginJson(source: string): SkinRuntimePluginDocument {
  if (typeof source !== "string" || !source.length
    || new TextEncoder().encode(source).byteLength > SKIN_RUNTIME_PLUGIN_DOCUMENT_LIMIT_BYTES) {
    invalid("SKIN_RUNTIME_PLUGIN_DOCUMENT_SIZE", "plugins.json is empty or exceeds 256 KiB.");
  }
  let input: unknown;
  try { input = JSON.parse(source); }
  catch { invalid("SKIN_RUNTIME_PLUGIN_DOCUMENT_INVALID", "plugins.json must contain valid JSON."); }
  return parseSkinRuntimePluginDocument(input);
}

export function listSkinRuntimePluginFilePaths(document: SkinRuntimePluginDocument): string[] {
  return document.plugins.flatMap((plugin) => [plugin.entry, ...(plugin.style ? [plugin.style] : []), ...plugin.assets]);
}
