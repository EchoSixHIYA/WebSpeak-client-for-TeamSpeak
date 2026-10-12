import { unzipSync } from "fflate";
import { compileSkinCss as compileSharedSkinCss, rewriteSkinCssAssets, SkinCssValidationError } from "../../../src/shared/skin-css.js";

import { parseSkinLayoutJson, type SkinLayoutDocument } from "../../../src/shared/skin-layout.js";
import { listSkinPluginAssetPaths, parseSkinPluginJson, type SkinPluginDocument } from "../../../src/shared/skin-plugin.js";
import { validateSkinExtensionWasmBytes, validateSkinExtensionWasmImportsAndExports } from "./skin-extension-wasm-policy.js";
import {
  listSkinRuntimePluginFilePaths,
  parseSkinRuntimePluginJson,
  SKIN_RUNTIME_PLUGIN_DOCUMENT_LIMIT_BYTES,
  SKIN_RUNTIME_PLUGIN_SOURCE_LIMIT_BYTES,
  SKIN_RUNTIME_PLUGIN_STYLE_LIMIT_BYTES,
  type SkinRuntimePluginDocument,
} from "../../../src/shared/skin-runtime-plugins.js";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_FILE_COUNT = 128;
const MAX_CSS_BYTES = 512 * 1024;
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_FONT_BYTES = 4 * 1024 * 1024;
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_FILE = 0x02014b50;

export interface SkinManifest {
  schemaVersion: 1 | 2 | 3 | 4;
  packageType?: "layout-skin" | "open-skin";
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  description?: string;
  entry: string;
  layout?: string;
  permissions?: [];
  content?: string;
  components?: string;
  plugins?: string;
  minAppVersion: string;
  preview?: string;
}

export interface SkinFeatureCopy {
  title: string;
  description: string;
}

export interface SkinHomeCopy {
  brandName?: string;
  eyebrow?: string;
  title?: string;
  titleAccent?: string;
  description?: string;
  welcomeTitle?: string;
  welcomeDescription?: string;
  features?: SkinFeatureCopy[];
}

export interface SkinContent {
  defaultLocale: string;
  locales: Record<string, { home?: SkinHomeCopy; messages?: Record<string, string> }>;
}

export interface InstalledSkin extends SkinManifest {
  css: string;
  assets: Record<string, Blob>;
  contentData?: SkinContent;
  layoutData?: SkinLayoutDocument;
  pluginData?: SkinPluginDocument;
  runtimePlugins?: SkinRuntimePluginDocument;
  runtimePluginFiles?: Record<string, Blob>;
  runtimePluginStyles?: Record<string, string>;
  previewBlob?: Blob;
  warnings: string[];
  installedAt: number;
}

export class SkinPackError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SkinPackError";
  }
}

interface ZipEntryMetadata {
  path: string;
  compressedSize: number;
  expandedSize: number;
  compression: number;
  isDirectory: boolean;
  flags: number;
  crc: number;
  localOffset: number;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

export async function importSkinPack(file: File): Promise<InstalledSkin> {
  if (!file.name.toLowerCase().endsWith(".wskin")) throw new SkinPackError("Choose a .wskin skin package.", "SKIN_FILE_TYPE");
  if (!file.size || file.size > MAX_ARCHIVE_BYTES) throw new SkinPackError("The skin package must be smaller than 20 MiB.", "SKIN_ARCHIVE_SIZE");

  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  const metadata = inspectZip(archiveBytes);
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(archiveBytes);
  } catch {
    throw new SkinPackError("The skin package is damaged or uses an unsupported ZIP format.", "SKIN_ZIP_INVALID");
  }

  const regularFiles = metadata.filter((entry) => !entry.isDirectory);
  const rootPrefix = findSingleRootFolder(regularFiles.map((entry) => entry.path));
  const files = new Map<string, Uint8Array>();
  for (const entry of regularFiles) {
    const path = rootPrefix ? entry.path.slice(rootPrefix.length) : entry.path;
    if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new SkinPackError("The package contains an unsafe file path.", "SKIN_PATH_INVALID");
    }
    const bytes = unpacked[entry.path];
    if (!bytes || bytes.byteLength !== entry.expandedSize) throw new SkinPackError("A package file failed its size check.", "SKIN_ZIP_INVALID");
    files.set(path, bytes);
  }

  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes || manifestBytes.byteLength > 32 * 1024) throw new SkinPackError("The package must contain a small root-level manifest.json.", "SKIN_MANIFEST_MISSING");
  const manifest = parseManifest(manifestBytes);
  const cssBytes = files.get(manifest.entry);
  if (!cssBytes || cssBytes.byteLength > MAX_CSS_BYTES) throw new SkinPackError("The CSS entry is missing or exceeds 512 KiB.", "SKIN_CSS_SIZE");

  let runtimePlugins: SkinRuntimePluginDocument | undefined;
  if (manifest.plugins) {
    const pluginsBytes = files.get(manifest.plugins);
    if (!pluginsBytes || pluginsBytes.byteLength > SKIN_RUNTIME_PLUGIN_DOCUMENT_LIMIT_BYTES) {
      throw new SkinPackError("plugins.json is missing or exceeds 256 KiB.", "SKIN_RUNTIME_PLUGIN_SIZE");
    }
    try { runtimePlugins = parseSkinRuntimePluginJson(decoder.decode(pluginsBytes)); }
    catch (error) { throw new SkinPackError("plugins.json is invalid: " + (error instanceof Error ? error.message : "unknown plugin error"), "SKIN_RUNTIME_PLUGIN_INVALID"); }
  }

  const runtimePluginFiles: Record<string, Blob> = Object.create(null) as Record<string, Blob>;
  const assets: Record<string, Blob> = Object.create(null) as Record<string, Blob>;
  const runtimePluginPaths = runtimePlugins ? listSkinRuntimePluginFilePaths(runtimePlugins) : [];
  const runtimePluginPathSet = new Set(runtimePluginPaths.map((path) => path.toLowerCase()));
  const manifestPathSet = ["manifest.json", manifest.entry, manifest.layout, manifest.content, manifest.components, manifest.plugins, manifest.preview]
    .filter((path): path is string => Boolean(path)).map((path) => path.toLowerCase());
  if (runtimePluginPaths.some((path) => manifestPathSet.includes(path))) {
    throw new SkinPackError("Plugin files cannot reuse skin manifest, CSS, content, component, or preview paths.", "SKIN_RUNTIME_PLUGIN_FILE_DUPLICATE");
  }
  for (const pluginPath of runtimePluginPaths) {
    const bytes = files.get(pluginPath);
    if (!bytes) throw new SkinPackError(`A declared plugin file is missing: ${pluginPath}`, "SKIN_RUNTIME_PLUGIN_FILE_MISSING");
    const lowerPath = pluginPath.toLowerCase();
    if (lowerPath.endsWith(".js")) {
      if (bytes.byteLength > SKIN_RUNTIME_PLUGIN_SOURCE_LIMIT_BYTES) throw new SkinPackError("Plugin entry files must be smaller than 256 KiB.", "SKIN_RUNTIME_PLUGIN_SOURCE_SIZE");
      try { decoder.decode(bytes); } catch { throw new SkinPackError("Plugin entry files must contain valid UTF-8.", "SKIN_RUNTIME_PLUGIN_ENCODING_INVALID"); }
      runtimePluginFiles[pluginPath] = new Blob([bytes], { type: "text/javascript" });
    } else if (lowerPath.endsWith(".wasm")) {
      if (bytes.byteLength > SKIN_RUNTIME_PLUGIN_SOURCE_LIMIT_BYTES) throw new SkinPackError("Wasm plugin entry files must be smaller than 256 KiB.", "SKIN_RUNTIME_PLUGIN_SOURCE_SIZE");
      const plugin = runtimePlugins?.plugins.find((candidate) => candidate.entry === pluginPath);
      if (!plugin || plugin.runtime !== "wasm") throw new SkinPackError("A Wasm entry must be declared as a Wasm plugin runtime.", "SKIN_RUNTIME_PLUGIN_WASM_INVALID");
      try {
        validateSkinExtensionWasmBytes(bytes);
        validateSkinExtensionWasmImportsAndExports(bytes, plugin.permissions);
      } catch (error) {
        throw new SkinPackError(`The Wasm plugin entry is invalid: ${error instanceof Error ? error.message : "unknown validation error"}`, "SKIN_RUNTIME_PLUGIN_WASM_INVALID");
      }
      runtimePluginFiles[pluginPath] = new Blob([bytes], { type: "application/wasm" });
    } else if (lowerPath.endsWith(".css")) {
      if (bytes.byteLength > SKIN_RUNTIME_PLUGIN_STYLE_LIMIT_BYTES) throw new SkinPackError("Plugin style files must be smaller than 512 KiB.", "SKIN_RUNTIME_PLUGIN_STYLE_SIZE");
      try { decoder.decode(bytes); } catch { throw new SkinPackError("Plugin style files must contain valid UTF-8.", "SKIN_RUNTIME_PLUGIN_ENCODING_INVALID"); }
      runtimePluginFiles[pluginPath] = new Blob([bytes], { type: "text/css" });
    } else {
      const mimeType = assetMimeType(pluginPath);
      if (!mimeType) throw new SkinPackError(`Unsupported plugin asset: ${pluginPath}`, "SKIN_RUNTIME_PLUGIN_ASSET_INVALID");
      if (mimeType.startsWith("font/") && bytes.byteLength > MAX_FONT_BYTES) throw new SkinPackError("Plugin fonts must be smaller than 4 MiB.", "SKIN_FONT_SIZE");
      if (mimeType.startsWith("image/") && bytes.byteLength > MAX_IMAGE_BYTES) throw new SkinPackError("Plugin images must be smaller than 16 MiB.", "SKIN_IMAGE_SIZE");
      runtimePluginFiles[pluginPath] = new Blob([bytes], { type: mimeType });
      assets[pluginPath] = runtimePluginFiles[pluginPath];
    }
  }

  for (const [path, bytes] of files) {
    if (["manifest.json", manifest.entry, manifest.layout, manifest.content, manifest.components, manifest.plugins].includes(path)
      || runtimePluginPathSet.has(path.toLowerCase())) continue;
    const mimeType = assetMimeType(path);
    if (!mimeType) throw new SkinPackError(`Unsupported package file: ${path}`, "SKIN_FILE_UNSUPPORTED");
    if (mimeType.startsWith("font/") && bytes.byteLength > MAX_FONT_BYTES) throw new SkinPackError("Fonts must be smaller than 4 MiB.", "SKIN_FONT_SIZE");
    if (mimeType.startsWith("image/") && bytes.byteLength > MAX_IMAGE_BYTES) throw new SkinPackError("Each image must be smaller than 16 MiB.", "SKIN_IMAGE_SIZE");
    assets[path] = new Blob([bytes], { type: mimeType });
  }

  const runtimePluginStyles: Record<string, string> = Object.create(null) as Record<string, string>;
  const runtimePluginWarnings: string[] = [];
  for (const plugin of runtimePlugins?.plugins ?? []) {
    if (!plugin.style) continue;
    const style = runtimePluginFiles[plugin.style];
    if (!style) throw new SkinPackError(`A declared plugin style is missing: ${plugin.style}`, "SKIN_RUNTIME_PLUGIN_FILE_MISSING");
    const pluginAssetPrefix = `plugins/${plugin.id}/assets/`;
    const pluginAssets = Object.fromEntries(Object.entries(assets).filter(([path]) =>
      path.startsWith("assets/") || path.startsWith(pluginAssetPrefix)));
    const compiledStyle = compileSkinCss(await style.text(), manifest.id, pluginAssets, manifest.schemaVersion, plugin.id);
    runtimePluginStyles[plugin.id] = compiledStyle.css;
    runtimePluginWarnings.push(...compiledStyle.warnings);
  }

  let contentData: SkinContent | undefined;
  if (manifest.content) {
    const contentBytes = files.get(manifest.content);
    if (!contentBytes || contentBytes.byteLength > MAX_CONTENT_BYTES) throw new SkinPackError("content.json is missing or exceeds 256 KiB.", "SKIN_CONTENT_SIZE");
    contentData = parseContent(contentBytes);
  }

  let pluginData: SkinPluginDocument | undefined;
  if (manifest.components) {
    const componentsBytes = files.get(manifest.components);
    if (!componentsBytes || componentsBytes.byteLength > MAX_CONTENT_BYTES) throw new SkinPackError("components.json is missing or exceeds 256 KiB.", "SKIN_PLUGIN_SIZE");
    try { pluginData = parseSkinPluginJson(decoder.decode(componentsBytes)); }
    catch (error) { throw new SkinPackError("components.json is invalid: " + (error instanceof Error ? error.message : "unknown plugin error"), "SKIN_PLUGIN_INVALID"); }
    for (const assetPath of listSkinPluginAssetPaths(pluginData)) {
      if (!assets[assetPath]?.type.startsWith("image/")) throw new SkinPackError(`Component image asset is missing or unsupported: ${assetPath}`, "SKIN_PLUGIN_ASSET_INVALID");
    }
  }

  let layoutData: SkinLayoutDocument | undefined;
  if (manifest.layout) {
    const layoutBytes = files.get(manifest.layout);
    if (!layoutBytes) throw new SkinPackError("layout.json is missing from the package.", "SKIN_LAYOUT_MISSING");
    try { layoutData = parseSkinLayoutJson(decoder.decode(layoutBytes)); }
    catch (error) { throw new SkinPackError("layout.json is invalid: " + (error instanceof Error ? error.message : "unknown layout error"), "SKIN_LAYOUT_INVALID"); }
  }

  let previewBlob: Blob | undefined;
  if (manifest.preview) {
    const previewBytes = files.get(manifest.preview);
    const previewMime = assetMimeType(manifest.preview);
    if (!previewBytes || !previewMime?.startsWith("image/") || previewBytes.byteLength > MAX_IMAGE_BYTES) {
      throw new SkinPackError("The preview must be a supported image inside the package.", "SKIN_PREVIEW_INVALID");
    }
    previewBlob = new Blob([previewBytes], { type: previewMime });
  }

  const compiled = compileSkinCss(decoder.decode(cssBytes), manifest.id, assets, manifest.schemaVersion);
  const hasConflictingSurface = (pluginData?.components ?? []).some((component) => component.mode === "surface"
    && runtimePlugins?.plugins.some((plugin) => plugin.mode === "surface" && plugin.page === component.page));
  if (hasConflictingSurface) throw new SkinPackError("A page cannot declare both a v3 and v4 surface.", "SKIN_PLUGIN_SURFACE_DUPLICATE");

  return {
    ...manifest,
    css: compiled.css,
    assets,
    contentData,
    layoutData,
    pluginData,
    runtimePlugins,
    runtimePluginFiles,
    runtimePluginStyles,
    previewBlob,
    warnings: [...compiled.warnings, ...runtimePluginWarnings],
    installedAt: Date.now(),
  };
}

export function resolveSkinCssAssets(css: string, assets: Record<string, Blob>): { css: string; objectUrls: string[] } {
  const objectUrls: string[] = [];
  try {
    const rewritten = rewriteSkinCssAssets(css, (assetPath) => {
        const blob = assets[assetPath];
        if (!blob) throw new SkinPackError(`Skin asset is missing: ${assetPath}`, "SKIN_ASSET_MISSING");
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return url;
    });
    return { css: rewritten, objectUrls };
  } catch (error) {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}

function inspectZip(bytes: Uint8Array): ZipEntryMetadata[] {
  if (bytes.byteLength < 22) throw new SkinPackError("The selected file is not a valid ZIP package.", "SKIN_ZIP_INVALID");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD) { eocd = offset; break; }
  }
  if (eocd < 0) throw new SkinPackError("The selected file is not a valid ZIP package.", "SKIN_ZIP_INVALID");
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || !entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || eocd + 22 + commentLength !== bytes.byteLength) {
    throw new SkinPackError("Multi-disk and ZIP64 skin packages are not supported.", "SKIN_ZIP_FORMAT");
  }
  if (entryCount > MAX_FILE_COUNT || centralOffset + centralSize !== eocd) throw new SkinPackError("The package contains too many files or an invalid directory.", "SKIN_FILE_COUNT");

  const entries: ZipEntryMetadata[] = [];
  const seenPaths = new Set<string>();
  let expandedTotal = 0;
  let compressedTotal = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== ZIP_CENTRAL_FILE) throw new SkinPackError("The package has an invalid ZIP directory entry.", "SKIN_ZIP_INVALID");
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentSize;
    if (recordEnd > eocd || diskStart !== 0 || flags & ~0x0800 || (compression !== 0 && compression !== 8) || compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) throw new SkinPackError("Encrypted, multi-disk, and unsupported ZIP entries are not allowed.", "SKIN_ZIP_FORMAT");
    const unixFileType = (externalAttributes >>> 16) & 0xf000;
    if (unixFileType !== 0 && unixFileType !== 0x8000 && unixFileType !== 0x4000) throw new SkinPackError("Only regular files and directories are allowed in a skin package.", "SKIN_FILE_TYPE");
    let rawName: string;
    try { rawName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); }
    catch { throw new SkinPackError("A package path is not valid UTF-8.", "SKIN_PATH_INVALID"); }
    const path = validateArchivePath(rawName);
    const isDirectory = path.endsWith("/");
    if ((unixFileType === 0x4000) !== isDirectory && unixFileType !== 0) throw new SkinPackError("ZIP file type does not match its path.", "SKIN_FILE_TYPE");
    if (isDirectory && (compressedSize !== 0 || expandedSize !== 0)) throw new SkinPackError("ZIP directory entries cannot contain data.", "SKIN_ZIP_INVALID");
    if (compression === 0 && compressedSize !== expandedSize) throw new SkinPackError("A stored ZIP entry has inconsistent sizes.", "SKIN_ZIP_INVALID");
    if (seenPaths.has(path.toLowerCase())) throw new SkinPackError("The package contains duplicate or case-conflicting paths.", "SKIN_PATH_DUPLICATE");
    seenPaths.add(path.toLowerCase());
    expandedTotal += expandedSize;
    compressedTotal += compressedSize;
    if (expandedTotal > MAX_EXPANDED_BYTES) throw new SkinPackError("The expanded skin package must be smaller than 50 MiB.", "SKIN_EXPANDED_SIZE");
    if (expandedSize > 1024 * 1024 && expandedSize > Math.max(compressedSize, 1) * 250) throw new SkinPackError("The package has an abnormal compression ratio.", "SKIN_COMPRESSION_RATIO");
    entries.push({ path, compressedSize, expandedSize, compression, isDirectory, flags, crc: view.getUint32(offset + 16, true), localOffset });
    offset = recordEnd;
  }
  if (offset !== centralOffset + centralSize || compressedTotal > bytes.byteLength) throw new SkinPackError("The package directory is inconsistent.", "SKIN_ZIP_INVALID");
  validateLocalEntries(bytes, entries, centralOffset);
  return entries;
}

function validateLocalEntries(bytes: Uint8Array, entries: ZipEntryMetadata[], centralOffset: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const spans: Array<{ start: number; end: number }> = [];
  for (const entry of entries) {
    const offset = entry.localOffset;
    if (offset + 30 > centralOffset || view.getUint32(offset, true) !== 0x04034b50) throw new SkinPackError("A ZIP local file header is invalid.", "SKIN_ZIP_INVALID");
    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const expandedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const headerEnd = offset + 30 + nameLength + extraLength;
    if (headerEnd > centralOffset || flags !== entry.flags || compression !== entry.compression || crc !== entry.crc || compressedSize !== entry.compressedSize || expandedSize !== entry.expandedSize) {
      throw new SkinPackError("ZIP local and central headers disagree.", "SKIN_ZIP_INVALID");
    }
    let localPath: string;
    try { localPath = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength)); }
    catch { throw new SkinPackError("A package path is not valid UTF-8.", "SKIN_PATH_INVALID"); }
    if (localPath !== entry.path) throw new SkinPackError("ZIP local and central filenames disagree.", "SKIN_ZIP_INVALID");
    const end = headerEnd + entry.compressedSize;
    if (end > centralOffset) throw new SkinPackError("A ZIP entry overlaps the central directory.", "SKIN_ZIP_INVALID");
    spans.push({ start: offset, end });
  }
  spans.sort((left, right) => left.start - right.start);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) throw new SkinPackError("ZIP local file entries overlap.", "SKIN_ZIP_INVALID");
  }
}

function validateArchivePath(rawPath: string): string {
  if (!rawPath || rawPath.includes("\\") || rawPath.startsWith("/") || /^[a-z]:/i.test(rawPath) || rawPath.includes("\0")) {
    throw new SkinPackError("The package contains an absolute or unsafe path.", "SKIN_PATH_INVALID");
  }
  const segments = rawPath.split("/");
  const directory = segments.at(-1) === "";
  const usableSegments = directory ? segments.slice(0, -1) : segments;
  if (!usableSegments.length || usableSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))) {
    throw new SkinPackError("The package contains an unsafe path segment.", "SKIN_PATH_INVALID");
  }
  return usableSegments.join("/") + (directory ? "/" : "");
}

function findSingleRootFolder(paths: string[]): string {
  if (paths.includes("manifest.json")) return "";
  const firstSegments = paths.map((path) => path.split("/")[0]);
  const candidate = firstSegments[0];
  if (!candidate || !paths.every((path) => path.startsWith(`${candidate}/`))) return "";
  return `${candidate}/`;
}

function parseManifest(bytes: Uint8Array): SkinManifest {
  let value: unknown;
  try { value = JSON.parse(decoder.decode(bytes)); }
  catch { throw new SkinPackError("manifest.json must contain valid UTF-8 JSON.", "SKIN_MANIFEST_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SkinPackError("manifest.json must be an object.", "SKIN_MANIFEST_INVALID");
  const raw = value as Record<string, unknown>;
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4) throw new SkinPackError("This skin package version is not supported.", "SKIN_SCHEMA_VERSION");
  if (schemaVersion >= 2) {
    const fields = new Set(["schemaVersion", "packageType", "id", "name", "version", "author", "license", "description", "entry", "layout", "permissions", "content", "minAppVersion", "preview"]);
    if (schemaVersion >= 3) { fields.delete("permissions"); fields.add("components"); }
    if (schemaVersion === 4) fields.add("plugins");
    const unknown = Object.keys(raw).find((key) => !fields.has(key));
    if (unknown) throw new SkinPackError(`Version 2 skin manifest contains an unsupported field: ${unknown}.`, "SKIN_MANIFEST_INVALID");
  }
  const stringField = (key: string, max: number, required = true): string | undefined => {
    const field = raw[key];
    if (field == null && !required) return undefined;
    if (typeof field !== "string" || !field.trim() || field.length > max) throw new SkinPackError(`manifest.json has an invalid ${key} field.`, "SKIN_MANIFEST_INVALID");
    return field.trim();
  };
  if (schemaVersion === 2 && (raw.packageType !== "layout-skin" || !Array.isArray(raw.permissions) || raw.permissions.length !== 0)) {
    throw new SkinPackError("Layout skin packages must declare the layout-skin type and no executable permissions.", "SKIN_PERMISSION_INVALID");
  }
  if (schemaVersion === 3 && raw.packageType !== "open-skin") {
    throw new SkinPackError("Version 3 skin packages must declare the open-skin type.", "SKIN_MANIFEST_INVALID");
  }
  if (schemaVersion === 4 && raw.packageType !== "open-skin") {
    throw new SkinPackError("Version 4 skin packages must declare the open-skin type.", "SKIN_MANIFEST_INVALID");
  }
  if (schemaVersion === 1 && (raw.layout !== undefined || raw.packageType !== undefined || raw.permissions !== undefined || raw.components !== undefined || raw.plugins !== undefined)) {
    throw new SkinPackError("Version 1 skin packages cannot declare layout or plugin fields.", "SKIN_SCHEMA_VERSION");
  }
  const id = stringField("id", 80)!;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(id) || id.startsWith("builtin.")) throw new SkinPackError("Skin IDs must be unique lowercase IDs and cannot use the reserved builtin. prefix.", "SKIN_ID_INVALID");
  const entry = stringField("entry", 120)!;
  const layout = schemaVersion >= 2 ? stringField("layout", 120, schemaVersion === 2)! : undefined;
  const components = schemaVersion >= 3 ? stringField("components", 120, false) : undefined;
  const plugins = schemaVersion === 4 ? stringField("plugins", 120)! : undefined;
  const content = stringField("content", 120, false);
  const preview = stringField("preview", 120, false);
  for (const path of [entry, layout, content, components, plugins, preview].filter((item): item is string => Boolean(item))) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new SkinPackError(`manifest.json has an unsafe path: ${path}`, "SKIN_PATH_INVALID");
  }
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const version = stringField("version", 32)!;
  const minAppVersion = stringField("minAppVersion", 32)!;
  if (!semver.test(version) || !semver.test(minAppVersion)) throw new SkinPackError("Skin and minimum app versions must use semantic version format.", "SKIN_MANIFEST_INVALID");
  if (!entry.toLowerCase().endsWith(".css") || (layout && !layout.toLowerCase().endsWith(".json")) || (content && !content.toLowerCase().endsWith(".json")) || (components && !components.toLowerCase().endsWith(".json")) || (plugins && !plugins.toLowerCase().endsWith(".json")) || (preview && !assetMimeType(preview)?.startsWith("image/"))) throw new SkinPackError("The CSS entry, layout, content, plugin, or preview path is invalid.", "SKIN_MANIFEST_INVALID");
  const declaredFiles = ["manifest.json", entry, ...(layout ? [layout] : []), ...(content ? [content] : []), ...(components ? [components] : []), ...(plugins ? [plugins] : []), ...(preview ? [preview] : [])].map((item) => item.toLowerCase());
  if (new Set(declaredFiles).size !== declaredFiles.length) throw new SkinPackError("Manifest files must use separate package paths.", "SKIN_MANIFEST_INVALID");
  return {
    schemaVersion,
    ...(schemaVersion === 2 ? { packageType: "layout-skin" as const, permissions: [] as [] } : schemaVersion >= 3 ? { packageType: "open-skin" as const } : {}),
    id,
    name: stringField("name", 80)!,
    version,
    author: stringField("author", 80)!,
    license: stringField("license", 80)!,
    description: stringField("description", 400, false),
    entry,
    layout,
    content,
    components,
    plugins,
    minAppVersion,
    preview,
  };
}

function parseContent(bytes: Uint8Array): SkinContent {
  let raw: unknown;
  try { raw = JSON.parse(decoder.decode(bytes)); }
  catch { throw new SkinPackError("content.json must contain valid UTF-8 JSON.", "SKIN_CONTENT_INVALID"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SkinPackError("content.json must be an object.", "SKIN_CONTENT_INVALID");
  const root = raw as Record<string, unknown>;
  if (typeof root.defaultLocale !== "string" || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(root.defaultLocale) || !root.locales || typeof root.locales !== "object" || Array.isArray(root.locales)) throw new SkinPackError("content.json needs a valid defaultLocale and locales.", "SKIN_CONTENT_INVALID");
  const localeEntries = Object.entries(root.locales as Record<string, unknown>);
  if (!localeEntries.length || localeEntries.length > 20) throw new SkinPackError("content.json must contain between 1 and 20 locales.", "SKIN_CONTENT_INVALID");
  const allowed = new Set<keyof SkinHomeCopy>(["brandName", "eyebrow", "title", "titleAccent", "description", "welcomeTitle", "welcomeDescription", "features"]);
  const locales: SkinContent["locales"] = {};
  for (const [locale, entry] of localeEntries) {
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale) || !entry || typeof entry !== "object" || Array.isArray(entry)) throw new SkinPackError("content.json contains an invalid locale entry.", "SKIN_CONTENT_INVALID");
    const localeValue = entry as Record<string, unknown>;
    const localeCopy: SkinContent["locales"][string] = {};
    if (localeValue.home !== undefined) {
      if (!localeValue.home || typeof localeValue.home !== "object" || Array.isArray(localeValue.home)) throw new SkinPackError("A locale home section must be an object.", "SKIN_CONTENT_INVALID");
      const homeCopy: SkinHomeCopy = {};
      for (const [key, field] of Object.entries(localeValue.home as Record<string, unknown>)) {
        if (!allowed.has(key as keyof SkinHomeCopy)) throw new SkinPackError(`Unknown homepage content field: ${key}`, "SKIN_CONTENT_INVALID");
        if (key === "features") {
          if (!Array.isArray(field) || field.length > 8) throw new SkinPackError("Each locale may define up to 8 homepage features.", "SKIN_CONTENT_INVALID");
          homeCopy.features = field.map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) throw new SkinPackError("A homepage feature must be an object.", "SKIN_CONTENT_INVALID");
            const feature = item as Record<string, unknown>;
            if (typeof feature.title !== "string" || typeof feature.description !== "string" || feature.title.length > 80 || feature.description.length > 240) throw new SkinPackError("Homepage feature text is too long or invalid.", "SKIN_CONTENT_INVALID");
            return { title: feature.title, description: feature.description };
          });
        } else if (typeof field === "string" && field.length <= 500) {
          homeCopy[key as Exclude<keyof SkinHomeCopy, "features">] = field;
        } else {
          throw new SkinPackError(`Invalid or oversized homepage content field: ${key}`, "SKIN_CONTENT_INVALID");
        }
      }
      localeCopy.home = homeCopy;
    }
    if (localeValue.messages !== undefined) {
      if (!localeValue.messages || typeof localeValue.messages !== "object" || Array.isArray(localeValue.messages)) throw new SkinPackError("Locale messages must be an object.", "SKIN_CONTENT_INVALID");
      const messageEntries = Object.entries(localeValue.messages as Record<string, unknown>);
      if (messageEntries.length > 200) throw new SkinPackError("Each locale may override up to 200 interface strings.", "SKIN_CONTENT_INVALID");
      const messages: Record<string, string> = {};
      for (const [key, text] of messageEntries) {
        if (!/^[a-z][a-zA-Z0-9.]*$/.test(key) || typeof text !== "string" || text.length > 500) throw new SkinPackError("A locale message key or value is invalid or too long.", "SKIN_CONTENT_INVALID");
        messages[key] = text;
      }
      localeCopy.messages = messages;
    }
    if (!localeCopy.home && !localeCopy.messages) throw new SkinPackError("Each locale must define home content or messages.", "SKIN_CONTENT_INVALID");
    locales[locale] = localeCopy;
  }
  if (!locales[root.defaultLocale]) throw new SkinPackError("defaultLocale must have a matching content entry.", "SKIN_CONTENT_INVALID");
  return { defaultLocale: root.defaultLocale, locales };
}

function compileSkinCss(source: string, id: string, assets: Record<string, Blob>, schemaVersion: SkinManifest["schemaVersion"], pluginId?: string): { css: string; warnings: string[] } {
  try { return compileSharedSkinCss(source, id, assets, schemaVersion, pluginId); }
  catch (error) {
    const cssError = error instanceof SkinCssValidationError
      ? error
      : new SkinCssValidationError(error instanceof Error ? error.message : "The CSS file is invalid.", "SKIN_CSS_INVALID");
    throw new SkinPackError(cssError.message, cssError.code);
  }
}

function assetMimeType(path: string): string | null {
  const extension = path.split(".").at(-1)?.toLowerCase();
  switch (extension) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    case "gif": return "image/gif";
    case "woff2": return "font/woff2";
    default: return null;
  }
}
