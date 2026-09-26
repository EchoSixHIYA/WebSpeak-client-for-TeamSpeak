import postcss, { type AtRule, type Declaration, type Node, type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";
import { unzipSync } from "fflate";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_FILE_COUNT = 128;
const MAX_CSS_BYTES = 512 * 1024;
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_FONT_BYTES = 4 * 1024 * 1024;
const ALLOWED_AT_RULES = new Set(["media", "supports", "container", "layer", "font-face", "keyframes", "-webkit-keyframes"]);
const LAYOUT_AFFECTING_PROPERTIES = new Set([
  "all", "display", "position", "top", "right", "bottom", "left", "inset", "inset-block", "inset-inline",
  "width", "height", "min-width", "min-height", "max-width", "max-height", "inline-size", "block-size",
  "min-inline-size", "min-block-size", "max-inline-size", "max-block-size", "aspect-ratio", "box-sizing",
  "gap", "row-gap", "column-gap", "grid", "flex", "order", "float", "clear", "overflow", "overflow-x",
  "overflow-y", "overflow-block", "overflow-inline", "overscroll-behavior", "z-index", "visibility",
  "pointer-events", "clip", "clip-path", "mask", "mask-image", "transform", "transform-origin", "transform-style", "translate", "scale", "rotate",
  "perspective", "perspective-origin", "contain", "content-visibility", "container", "container-name",
  "container-type", "contain-intrinsic-size", "resize", "columns", "column-count", "column-width", "scrollbar-width", "font",
  "font-size", "line-height", "letter-spacing", "word-spacing", "white-space", "word-break", "overflow-wrap", "word-wrap",
  "text-wrap", "text-overflow", "text-indent", "text-transform", "text-combine-upright", "text-autospace", "text-spacing-trim",
  "line-clamp", "tab-size", "hyphens", "line-break", "text-size-adjust", "initial-letter", "shape-outside", "baseline-shift",
  "box-orient", "box-direction", "box-lines", "ruby-position", "caption-side", "table-layout", "border-collapse", "border-spacing",
  "writing-mode", "direction", "unicode-bidi", "vertical-align", "appearance", "zoom", "scrollbar-gutter", "touch-action", "user-select", "cursor", "content",
  "position-anchor", "position-area", "position-try-fallbacks", "position-try-order", "anchor-name", "anchor-scope",
]);
const OPTIONAL_VISUAL_PARTS = new Set([
  "home.hero.eyebrow",
  "home.gateway-status",
  "home.features",
  "home.feature",
  "home.visitors",
  "home.join-card.waveform",
  "home.join-card.sonar",
  "voice.activity-heading",
  "voice.member.avatar",
  "voice.member.live-indicator",
  "voice.member-row.avatar",
  "voice.screen-player.viewer-avatar",
  "voice.screen-player.live",
  "demo.badge",
  "demo.wave",
  "demo.avatar",
  "demo.member-status",
  "demo.note",
]);
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_FILE = 0x02014b50;

export interface SkinManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  description?: string;
  entry: string;
  content?: string;
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

  const assets: Record<string, Blob> = Object.create(null) as Record<string, Blob>;
  for (const [path, bytes] of files) {
    if (["manifest.json", manifest.entry, manifest.content].includes(path)) continue;
    const mimeType = assetMimeType(path);
    if (!mimeType) throw new SkinPackError(`Unsupported package file: ${path}`, "SKIN_FILE_UNSUPPORTED");
    if (mimeType.startsWith("font/") && bytes.byteLength > MAX_FONT_BYTES) throw new SkinPackError("Fonts must be smaller than 4 MiB.", "SKIN_FONT_SIZE");
    if (mimeType.startsWith("image/") && bytes.byteLength > MAX_IMAGE_BYTES) throw new SkinPackError("Each image must be smaller than 16 MiB.", "SKIN_IMAGE_SIZE");
    assets[path] = new Blob([bytes], { type: mimeType });
  }

  let contentData: SkinContent | undefined;
  if (manifest.content) {
    const contentBytes = files.get(manifest.content);
    if (!contentBytes || contentBytes.byteLength > MAX_CONTENT_BYTES) throw new SkinPackError("content.json is missing or exceeds 256 KiB.", "SKIN_CONTENT_SIZE");
    contentData = parseContent(contentBytes);
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

  const compiled = compileSkinCss(decoder.decode(cssBytes), manifest.id, assets);
  return { ...manifest, css: compiled.css, assets, contentData, previewBlob, warnings: compiled.warnings, installedAt: Date.now() };
}

export function resolveSkinCssAssets(css: string, assets: Record<string, Blob>): { css: string; objectUrls: string[] } {
  const objectUrls: string[] = [];
  try {
    const root = postcss.parse(css, { from: undefined });
    root.walkDecls((declaration) => {
      declaration.value = rewriteAssetUrls(declaration.value, (assetPath) => {
        const blob = assets[assetPath];
        if (!blob) throw new SkinPackError(`Skin asset is missing: ${assetPath}`, "SKIN_ASSET_MISSING");
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return url;
      });
    });
    return { css: root.toString(), objectUrls };
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
  const stringField = (key: string, max: number, required = true): string | undefined => {
    const field = raw[key];
    if (field == null && !required) return undefined;
    if (typeof field !== "string" || !field.trim() || field.length > max) throw new SkinPackError(`manifest.json has an invalid ${key} field.`, "SKIN_MANIFEST_INVALID");
    return field.trim();
  };
  if (raw.schemaVersion !== 1) throw new SkinPackError("This skin package version is not supported.", "SKIN_SCHEMA_VERSION");
  const id = stringField("id", 80)!;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(id) || id.startsWith("builtin.")) throw new SkinPackError("Skin IDs must be unique lowercase IDs and cannot use the reserved builtin. prefix.", "SKIN_ID_INVALID");
  const entry = stringField("entry", 120)!;
  const content = stringField("content", 120, false);
  const preview = stringField("preview", 120, false);
  for (const path of [entry, content, preview].filter((item): item is string => Boolean(item))) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new SkinPackError(`manifest.json has an unsafe path: ${path}`, "SKIN_PATH_INVALID");
  }
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const version = stringField("version", 32)!;
  const minAppVersion = stringField("minAppVersion", 32)!;
  if (!semver.test(version) || !semver.test(minAppVersion)) throw new SkinPackError("Skin and minimum app versions must use semantic version format.", "SKIN_MANIFEST_INVALID");
  if (!entry.toLowerCase().endsWith(".css") || (content && !content.toLowerCase().endsWith(".json")) || (preview && !assetMimeType(preview)?.startsWith("image/"))) throw new SkinPackError("The entry must be CSS, content must be JSON, and preview must be a supported image.", "SKIN_MANIFEST_INVALID");
  const declaredFiles = ["manifest.json", entry, ...(content ? [content] : []), ...(preview ? [preview] : [])].map((item) => item.toLowerCase());
  if (new Set(declaredFiles).size !== declaredFiles.length) throw new SkinPackError("Manifest files must use separate package paths.", "SKIN_MANIFEST_INVALID");
  return {
    schemaVersion: 1,
    id,
    name: stringField("name", 80)!,
    version,
    author: stringField("author", 80)!,
    license: stringField("license", 80)!,
    description: stringField("description", 400, false),
    entry,
    content,
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

function compileSkinCss(source: string, id: string, assets: Record<string, Blob>): { css: string; warnings: string[] } {
  const size = new TextEncoder().encode(source).byteLength;
  if (!size || size > MAX_CSS_BYTES) throw new SkinPackError("The CSS entry must be between 1 byte and 512 KiB.", "SKIN_CSS_SIZE");
  let root: postcss.Root;
  try { root = postcss.parse(source, { from: undefined }); }
  catch (error) { throw new SkinPackError(`The CSS file could not be parsed: ${(error as Error).message}`, "SKIN_CSS_INVALID"); }

  const scope = `.ws-skin-root[data-ws-skin="${id}"]`;
  const namespace = `ws-${id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const scopeNodes = selectorParser().astSync(scope).first!.nodes.map((node) => node.clone());
  const warnings = new Set<string>();
  const keyframeNames = new Map<string, string>();
  const fontFamilyNames = new Map<string, string>();
  const hideableRules = new WeakSet<Rule>();
  let nodeCount = 0;
  root.walk((node) => {
    nodeCount += 1;
    if (nodeCount > 12000) throw new SkinPackError("The CSS file contains too many rules.", "SKIN_CSS_COMPLEXITY");
  });

  root.walkAtRules((rule: AtRule) => {
    const name = rule.name.toLowerCase();
    if (!ALLOWED_AT_RULES.has(name)) throw rule.error(`The @${rule.name} rule is not allowed in a skin package.`);
    if (name.endsWith("keyframes")) {
      const keyframeName = rule.params.trim();
      if (!/^[-_a-z][-_a-z0-9]*$/i.test(keyframeName)) throw rule.error("Keyframe names must be simple CSS identifiers.");
      keyframeNames.set(keyframeName, `${namespace}-${keyframeName}`);
      rule.params = `${namespace}-${keyframeName}`;
    } else if (name === "layer") {
      const layers = rule.params.split(",").map((layer) => layer.trim());
      if (!layers.length || layers.some((layer) => !layer || !layer.split(".").every((part) => /^[-_a-z][-_a-z0-9]*$/i.test(part)))) {
        throw rule.error("Skin CSS must use named @layer values so layer names can be isolated.");
      }
      rule.params = layers.map((layer) => `${namespace}-${layer.split(".").join(`.${namespace}-`)}`).join(", ");
    } else if (name === "font-face") {
      if (/\blocal\s*\(/i.test(rule.toString())) throw rule.error("@font-face local() is not allowed; include a WOFF2 file in the package.");
      const family = rule.nodes?.find((node): node is Declaration => node.type === "decl" && node.prop.toLowerCase() === "font-family");
      if (!family) throw rule.error("Each @font-face rule must declare font-family.");
      const originalFamily = parseSingleFontFamily(family.value);
      const scopedFamily = `${namespace}-${originalFamily.replace(/[^a-z0-9_-]/gi, "-")}`;
      fontFamilyNames.set(originalFamily.toLowerCase(), scopedFamily);
      family.value = `"${scopedFamily}"`;
    }
  });

  root.walkRules((rule: Rule) => {
    if (hasKeyframesAncestor(rule)) return;
    if (rule.parent?.type === "rule") throw rule.error("Nested style rules are not supported; use flat selectors.");
    if (!selectorUsesPublicHook(rule.selector)) throw rule.error("Skin selectors must use :root, [data-ws-page], or [data-ws-part] so they stay attached to WebSpeak's stable visual interface.");
    if (targetsOnlyOptionalVisualParts(rule.selector)) hideableRules.add(rule);
    try {
      rule.selector = selectorParser((selectors) => {
        selectors.each((selector) => {
          const text = selector.toString().trim();
          if (!text) throw new SkinPackError("Empty selectors are not allowed.", "SKIN_CSS_SELECTOR");
          if (/:global\s*\(|:host(?:-context)?\b/i.test(text)) throw new SkinPackError("Shadow and global escape selectors are not allowed.", "SKIN_CSS_SELECTOR");
          if (/^:root\b/.test(text)) {
            selector.replaceWith(selectorParser().astSync(text.replace(/^:root\b/, scope)).first!.clone());
            return;
          }
          selector.prepend(selectorParser.combinator({ value: " " }));
          for (let index = scopeNodes.length - 1; index >= 0; index -= 1) selector.prepend(scopeNodes[index].clone());
        });
      }).processSync(rule.selector);
    } catch (error) {
      if (error instanceof SkinPackError) throw error;
      throw rule.error(`A CSS selector is invalid: ${(error as Error).message}`);
    }
  });

  const referencedKeyframes = new Set<string>();
  const nonOptionalKeyframes = new Set<string>();
  root.walkRules((rule: Rule) => {
    if (hasKeyframesAncestor(rule)) return;
    const optionalTarget = hideableRules.has(rule);
    rule.walkDecls((declaration: Declaration) => {
      const property = declaration.prop.toLowerCase();
      if (property !== "animation" && property !== "animation-name") return;
      const value = declaration.value;
      if (/\b(?:var|attr)\s*\(|\\/i.test(value)) {
        keyframeNames.forEach((_, name) => nonOptionalKeyframes.add(name));
        return;
      }
      for (const name of keyframeNames.keys()) {
        if (!referencesCssIdentifier(value, name)) continue;
        referencedKeyframes.add(name);
        if (!optionalTarget) nonOptionalKeyframes.add(name);
      }
    });
  });
  const optionalOnlyKeyframes = new Set([...referencedKeyframes]
    .filter((name) => !nonOptionalKeyframes.has(name))
    .map((name) => keyframeNames.get(name)!));

  root.walkDecls((declaration: Declaration) => {
    const property = declaration.prop.toLowerCase();
    const value = declaration.value.trim();
    const owningRule = findOwningRule(declaration);
    const keyframesRule = owningRule ? findKeyframesRule(owningRule) : null;
    const canHideTarget = owningRule
      ? hideableRules.has(owningRule) || Boolean(keyframesRule && optionalOnlyKeyframes.has(keyframesRule.params.trim()))
      : false;
    if (property.startsWith("--") && !/^--skin-[a-z0-9_-]+$/i.test(property)) {
      throw declaration.error("Custom skin variables must use the --skin- prefix so they cannot replace WebSpeak's structural tokens.");
    }
    if (isLayoutAffectingProperty(property)) {
      throw declaration.error("Skin CSS may change component artwork and appearance, but must not change layout, positioning, sizing, text flow, or interaction geometry.");
    }
    if (property === "font-family") warnings.add("Custom fonts can change localized text wrapping; verify every WebSpeak language before publishing.");
    if (["behavior", "-moz-binding"].includes(property) || /expression\s*\(|javascript\s*:|vbscript\s*:/i.test(value)) {
      throw declaration.error("Executable CSS values are not allowed.");
    }
    const compactValue = valueParser(value).nodes.filter((node) => node.type !== "space" && node.type !== "comment").map((node) => node.value ?? "").join("").toLowerCase();
    if (["display", "visibility", "opacity", "pointer-events", "clip-path", "mask", "mask-image"].includes(property) && /\b(?:var|attr)\s*\(/i.test(value)) {
      if (!canHideTarget) throw declaration.error("Visibility and interaction styles can only use indirect values on explicitly optional visual parts.");
    }
    const removesVisual = property === "all"
      || (property === "display" && compactValue === "none")
      || (property === "visibility" && /^(?:hidden|collapse)$/.test(compactValue))
      || (property === "opacity" && /^0(?:\.0+)?%?$/.test(compactValue))
      || (property === "pointer-events" && compactValue === "none")
      || (property === "clip-path" && /inset\(\s*50%/.test(compactValue))
      || (property === "mask" && /(?:alpha\(0\)|luminance\(0\))/.test(compactValue));
    if (removesVisual && !canHideTarget) {
      throw declaration.error("Only explicitly optional visual parts may be hidden or reset; required controls and their containers must remain available.");
    }
    const visuallyRemoves = (property === "transform" && /scale(?:3d)?\(\s*0(?:\s*[,)]|\s*\))/i.test(value))
      || (property === "clip-path" && /inset\(\s*50%/i.test(value))
      || (property === "filter" && /(?:opacity|brightness)\(\s*0(?:%|\s*[,)]|\s*\))/i.test(value));
    if (visuallyRemoves && !canHideTarget) {
      throw declaration.error("Only explicitly optional visual parts may be visually removed.");
    }
    if (/\bz-index\s*:\s*(?:[1-9]\d{4,}|-\d{4,})\b/i.test(`${property}:${value}`) || (property === "position" && value === "fixed")) warnings.add("Fixed positioning or extreme stacking may cover important controls; check the preview on desktop and mobile.");
    const withScopedNames = rewriteScopedNames(value, property, keyframeNames, fontFamilyNames);
    declaration.value = rewriteAssetUrls(withScopedNames, (assetPath) => {
      const blob = assets[assetPath];
      if (!blob) throw declaration.error(`CSS references an asset not present in the package: ${assetPath}`);
      return `wskin-asset:${encodeURIComponent(assetPath)}`;
    });
  });

  return { css: root.toString(), warnings: [...warnings] };
}

function targetsOnlyOptionalVisualParts(selector: string): boolean {
  try {
    const parsed = selectorParser().astSync(selector);
    return parsed.nodes.length > 0 && parsed.nodes.every((item) => {
      if (item.nodes.length !== 1 || item.nodes[0].type !== "attribute") return false;
      const attribute = item.nodes[0];
      if (attribute.attribute.toLowerCase() !== "data-ws-part" || attribute.operator !== "=") return false;
      const part = (attribute.value ?? "").replace(/^['"]|['"]$/g, "");
      return OPTIONAL_VISUAL_PARTS.has(part);
    });
  } catch {
    return false;
  }
}

function selectorUsesPublicHook(selector: string): boolean {
  try {
    const parsed = selectorParser().astSync(selector);
    return parsed.nodes.length > 0 && parsed.nodes.every((item) => {
      let scoped = false;
      let usesPrivateName = false;
      item.walk((node) => {
        if (node.type === "attribute" && ["data-ws-part", "data-ws-page"].includes(node.attribute.toLowerCase())) scoped = true;
        if (node.type === "pseudo" && node.value.toLowerCase() === ":root") scoped = true;
        if (node.type === "class" || node.type === "id") usesPrivateName = true;
      });
      return scoped && !usesPrivateName;
    });
  } catch {
    return false;
  }
}

function isLayoutAffectingProperty(property: string): boolean {
  const unprefixed = property.replace(/^-(?:webkit|moz|ms|o)-/, "");
  if (LAYOUT_AFFECTING_PROPERTIES.has(unprefixed)) return true;
  if (/^(?:margin|padding)(?:-|$)/.test(unprefixed)) return true;
  if (/^border(?:-|$)/.test(unprefixed) && !/^border-(?:color(?:-|$)|radius(?:-|$))/.test(unprefixed)) return true;
  if (/^(?:grid|flex|align-(?:content|items|self)|justify-(?:content|items|self)|place-(?:content|items|self)|offset|transform|overscroll|overflow|column)(?:-|$)/.test(unprefixed)) return true;
  return /^font-(?!family$|weight$|style$|synthesis$|palette$)/.test(unprefixed);
}

function findOwningRule(node: Node): Rule | null {
  let parent = node.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "rule") return parent as Rule;
    parent = parent.parent;
  }
  return null;
}

function findKeyframesRule(rule: Rule): AtRule | null {
  let parent = rule.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && /(?:^|-)?keyframes$/i.test(parent.name)) return parent as AtRule;
    parent = parent.parent;
  }
  return null;
}

function referencesCssIdentifier(value: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^-_a-z0-9])${escaped}(?=$|[^-_a-z0-9])`, "i").test(value);
}

function rewriteAssetUrls(value: string, resolve: (path: string) => string): string {
  const parsed = valueParser(value);
  const resolvePackageAsset = (rawValue: string): string => {
    const raw = rawValue.trim();
    if (!raw || raw.startsWith("#")) throw new SkinPackError("CSS images and fonts must point to assets inside this skin package.", "SKIN_EXTERNAL_RESOURCE");
    const isInternalMarker = raw.startsWith("wskin-asset:");
    if (!isInternalMarker && /^(?:data:|blob:|https?:|\/\/|file:|javascript:)/i.test(raw)) throw new SkinPackError("Only relative paths to assets inside this skin package are allowed in url().", "SKIN_EXTERNAL_RESOURCE");
    let path: string;
    try { path = isInternalMarker ? decodeURIComponent(raw.slice("wskin-asset:".length)) : normalizeAssetPath(raw); }
    catch { throw new SkinPackError("A skin asset reference is invalid.", "SKIN_ASSET_PATH"); }
    return resolve(path);
  };
  const visit = (nodes: typeof parsed.nodes, inImageSet = false): void => {
    for (const node of nodes) {
      if (node.type === "function" && node.value.toLowerCase() === "url") {
        const raw = valueParser.stringify(node.nodes).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim();
        node.nodes = [{ type: "string", quote: '"', value: resolvePackageAsset(raw), sourceIndex: 0, sourceEndIndex: 0, unclosed: undefined }];
        node.before = "";
        node.after = "";
        continue;
      }
      if (node.type === "function" && (node.value.toLowerCase() === "image-set" || node.value.toLowerCase() === "-webkit-image-set")) {
        for (const child of node.nodes) {
          if (child.type === "string") child.value = resolvePackageAsset(child.value);
          else if (child.type === "function") visit([child]);
        }
        continue;
      }
      if (node.type === "function") visit(node.nodes, inImageSet);
      else if (inImageSet && node.type === "string") node.value = resolvePackageAsset(node.value);
    }
  };
  visit(parsed.nodes);
  return parsed.toString();
}

function parseSingleFontFamily(value: string): string {
  const parsed = valueParser(value).nodes.filter((node) => node.type !== "space" && node.type !== "comment");
  if (parsed.length !== 1 || (parsed[0].type !== "string" && parsed[0].type !== "word") || !parsed[0].value.trim()) {
    throw new SkinPackError("@font-face must declare exactly one font family.", "SKIN_FONT_FAMILY");
  }
  return parsed[0].value.trim();
}

function rewriteScopedNames(value: string, property: string, keyframes: Map<string, string>, fontFamilies: Map<string, string>): string {
  const parsed = valueParser(value);
  if (["animation", "animation-name", "font", "font-family"].includes(property)) {
    parsed.walk((node) => {
      if (node.type !== "word" && node.type !== "string") return;
      const keyframe = keyframes.get(node.value);
      if (keyframe) node.value = keyframe;
      const family = fontFamilies.get(node.value.toLowerCase());
      if (family) node.value = family;
    });
  }
  return parsed.toString();
}

function normalizeAssetPath(raw: string): string {
  let path = raw.split(/[?#]/, 1)[0];
  try { path = decodeURIComponent(path); } catch { throw new SkinPackError("An asset URL contains invalid encoding.", "SKIN_ASSET_PATH"); }
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || /^[a-z]:/i.test(path)) throw new SkinPackError("An asset URL must be a relative package path.", "SKIN_ASSET_PATH");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new SkinPackError("An asset URL cannot leave the skin package.", "SKIN_ASSET_PATH");
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (!segments.length) throw new SkinPackError("An asset URL must point to a package file.", "SKIN_ASSET_PATH");
  return segments.join("/");
}

function hasKeyframesAncestor(rule: Rule): boolean {
  let parent = rule.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && /keyframes$/i.test(parent.name)) return true;
    parent = parent.parent;
  }
  return false;
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
