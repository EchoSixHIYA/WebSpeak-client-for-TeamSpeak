import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_FILE_COUNT = 128;
const MAX_CSS_BYTES = 512 * 1024;
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_FONT_BYTES = 4 * 1024 * 1024;
const MAX_SKINS = 50;
const MAX_TOTAL_ARCHIVES = 200 * 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

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
}

interface SkinArchiveEntry {
  path: string;
  compressedSize: number;
  expandedSize: number;
  compression: number;
  crc: number;
  localOffset: number;
  flags: number;
  isDirectory: boolean;
  unixFileType: number;
}

type ParsedSkinManifest = Omit<SkinCatalogEntry, "installedAt" | "previewUrl" | "previewMimeType"> & {
  entry: string;
  content?: string;
  preview?: string;
};

export class SkinRegistryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SkinRegistryError";
  }
}

export class SkinRegistry {
  constructor(private readonly directory: string) {}

  async list(): Promise<SkinCatalogEntry[]> {
    await mkdir(this.directory, { recursive: true });
    const names = await readdir(this.directory);
    const entries: SkinCatalogEntry[] = [];
    for (const filename of names.filter((item) => item.endsWith(".json"))) {
      try {
        const value: unknown = JSON.parse(await readFile(path.join(this.directory, filename), "utf8"));
        if (!isCatalogEntry(value) || filename !== `${value.id}.json`) continue;
        const archiveInfo = await stat(path.join(this.directory, `${value.id}.wskin`)).catch(() => null);
        if (!archiveInfo?.isFile() || archiveInfo.size < 22 || archiveInfo.size > MAX_ARCHIVE_BYTES) continue;
        entries.push(value);
      } catch {
        // Ignore incomplete or stale metadata. The archive itself remains untouched.
      }
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }

  async save(bytes: Buffer, expectedId: string): Promise<SkinCatalogEntry> {
    if (!isSafeSkinId(expectedId)) throw new SkinRegistryError("Skin ID is invalid.", "SKIN_ID_INVALID");
    const parsed = validateSkinArchive(bytes, expectedId);
    await mkdir(this.directory, { recursive: true });
    const current = await this.list();
    const replacing = current.some((entry) => entry.id === expectedId);
    if (!replacing && current.length >= MAX_SKINS) throw new SkinRegistryError("The instance already has the maximum number of skins.", "SKIN_LIMIT");
    const archivePaths = await Promise.all(current.map(async (entry) => ({ id: entry.id, size: (await stat(path.join(this.directory, `${entry.id}.wskin`)).catch(() => ({ size: 0 }))).size })));
    const totalBytes = archivePaths.reduce((sum, entry) => sum + (entry.id === expectedId ? 0 : entry.size), bytes.byteLength);
    if (totalBytes > MAX_TOTAL_ARCHIVES) throw new SkinRegistryError("The total skin storage limit is 200 MiB.", "SKIN_STORAGE_LIMIT");

    const installedAt = replacing ? current.find((entry) => entry.id === expectedId)!.installedAt : Date.now();
    const catalog: SkinCatalogEntry = {
      ...parsed.manifest,
      installedAt,
      ...(parsed.previewMime ? { previewUrl: `/api/skins/${expectedId}/preview`, previewMimeType: parsed.previewMime } : {}),
    };
    const nonce = randomBytes(6).toString("hex");
    const archiveTemp = path.join(this.directory, `.${expectedId}.${nonce}.tmp`);
    const catalogTemp = path.join(this.directory, `.${expectedId}.${nonce}.json.tmp`);
    const previewTemp = path.join(this.directory, `.${expectedId}.${nonce}.preview.tmp`);
    try {
      await writeFile(archiveTemp, bytes, { flag: "wx", mode: 0o600 });
      await writeFile(catalogTemp, JSON.stringify(catalog), { flag: "wx", mode: 0o600 });
      if (parsed.previewBytes) await writeFile(previewTemp, parsed.previewBytes, { flag: "wx", mode: 0o600 });
      await rename(archiveTemp, path.join(this.directory, `${expectedId}.wskin`));
      await rename(catalogTemp, path.join(this.directory, `${expectedId}.json`));
      const previewPath = path.join(this.directory, `${expectedId}.preview`);
      if (parsed.previewBytes) await rename(previewTemp, previewPath);
      else await unlink(previewPath).catch(() => undefined);
    } catch (error) {
      await Promise.all([archiveTemp, catalogTemp, previewTemp].map((file) => unlink(file).catch(() => undefined)));
      throw error;
    }
    return catalog;
  }

  async readArchive(id: string): Promise<Buffer | null> {
    if (!isSafeSkinId(id)) return null;
    if (!(await this.list()).some((entry) => entry.id === id)) return null;
    try { return await readFile(path.join(this.directory, `${id}.wskin`)); }
    catch { return null; }
  }

  async readPreview(id: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
    if (!isSafeSkinId(id)) return null;
    const catalog = (await this.list()).find((entry) => entry.id === id);
    if (!catalog?.previewUrl) return null;
    const mimeType = catalog.previewMimeType || "application/octet-stream";
    try {
      const bytes = await readFile(path.join(this.directory, `${id}.preview`));
      return { bytes, mimeType };
    } catch { return null; }
  }

  async remove(id: string): Promise<boolean> {
    if (!isSafeSkinId(id)) return false;
    const archive = path.join(this.directory, `${id}.wskin`);
    const catalog = path.join(this.directory, `${id}.json`);
    const preview = path.join(this.directory, `${id}.preview`);
    const present = await Promise.all([archive, catalog, preview].map((file) => stat(file).then(() => true).catch(() => false))).then((items) => items.some(Boolean));
    if (!present) return false;
    await Promise.all([archive, catalog, preview].map((file) => unlink(file).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    })));
    return true;
  }
}

function validateSkinArchive(bytes: Buffer, expectedId?: string): { manifest: ParsedSkinManifest; previewBytes?: Buffer; previewMime?: string } {
  const entries = inspectArchive(bytes);
  const regularEntries = entries.filter((entry) => !entry.isDirectory);
  const rootPrefix = singleRootPrefix(regularEntries.map((entry) => entry.path));
  const fileBytes = new Map<string, Buffer>();
  for (const entry of regularEntries) {
    const packagePath = rootPrefix ? entry.path.slice(rootPrefix.length) : entry.path;
    if (!isSafePackagePath(packagePath)) throw new SkinRegistryError("The package contains an unsafe path.", "SKIN_PATH_INVALID");
    const content = extractEntry(bytes, entry);
    if (content.byteLength !== entry.expandedSize || crc32(content) !== entry.crc) throw new SkinRegistryError("The package has a damaged file entry.", "SKIN_ZIP_INVALID");
    if (fileBytes.has(packagePath.toLowerCase())) throw new SkinRegistryError("The package contains duplicate paths.", "SKIN_PATH_DUPLICATE");
    fileBytes.set(packagePath, content);
  }
  const manifestBytes = fileBytes.get("manifest.json");
  if (!manifestBytes || manifestBytes.byteLength > 32 * 1024) throw new SkinRegistryError("The package needs a small root-level manifest.json.", "SKIN_MANIFEST_MISSING");
  const manifest = parseManifest(manifestBytes);
  if (expectedId && manifest.id !== expectedId) throw new SkinRegistryError("The skin ID does not match the upload target.", "SKIN_ID_MISMATCH");
  const cssBytes = fileBytes.get(manifest.entry);
  if (!cssBytes || !cssBytes.byteLength || cssBytes.byteLength > MAX_CSS_BYTES) throw new SkinRegistryError("The CSS entry is missing or exceeds 512 KiB.", "SKIN_CSS_SIZE");
  decodeUtf8(cssBytes, "The CSS entry is not valid UTF-8.");

  let previewBytes: Buffer | undefined;
  let previewMime: string | undefined;
  for (const [packagePath, data] of fileBytes) {
    if (["manifest.json", manifest.entry, manifest.content, manifest.preview].includes(packagePath)) continue;
    const mimeType = imageMime(packagePath) ?? (packagePath.toLowerCase().endsWith(".woff2") ? "font/woff2" : null);
    if (!mimeType) throw new SkinRegistryError(`Unsupported package file: ${packagePath}`, "SKIN_FILE_UNSUPPORTED");
    if (mimeType.startsWith("image/") && data.byteLength > MAX_IMAGE_BYTES) throw new SkinRegistryError("Each image must be smaller than 16 MiB.", "SKIN_IMAGE_SIZE");
    if (mimeType.startsWith("font/") && data.byteLength > MAX_FONT_BYTES) throw new SkinRegistryError("Fonts must be smaller than 4 MiB.", "SKIN_FONT_SIZE");
  }
  if (manifest.content) {
    const content = fileBytes.get(manifest.content);
    if (!content || content.byteLength > MAX_CONTENT_BYTES) throw new SkinRegistryError("content.json is missing or exceeds 256 KiB.", "SKIN_CONTENT_SIZE");
    decodeUtf8(content, "content.json is not valid UTF-8.");
    try { JSON.parse(content.toString("utf8")); }
    catch { throw new SkinRegistryError("content.json is not valid JSON.", "SKIN_CONTENT_INVALID"); }
  }
  if (manifest.preview) {
    previewBytes = fileBytes.get(manifest.preview);
    previewMime = imageMime(manifest.preview) ?? undefined;
    if (!previewBytes || !previewMime || previewBytes.byteLength > MAX_IMAGE_BYTES) throw new SkinRegistryError("The preview must be a supported image inside the package.", "SKIN_PREVIEW_INVALID");
  }
  return { manifest, ...(previewBytes ? { previewBytes, previewMime } : {}) };
}

function inspectArchive(bytes: Buffer): SkinArchiveEntry[] {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_ARCHIVE_BYTES) throw new SkinRegistryError("A skin package must be smaller than 20 MiB.", "SKIN_ARCHIVE_SIZE");
  const minOffset = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new SkinRegistryError("The upload is not a valid ZIP package.", "SKIN_ZIP_INVALID");
  const disk = bytes.readUInt16LE(endOffset + 4);
  const centralDisk = bytes.readUInt16LE(endOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(endOffset + 8);
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  const commentLength = bytes.readUInt16LE(endOffset + 20);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || endOffset + 22 + commentLength !== bytes.byteLength) {
    throw new SkinRegistryError("Multi-disk and ZIP64 packages are not supported.", "SKIN_ZIP_FORMAT");
  }
  if (!entryCount || entryCount > MAX_FILE_COUNT || centralOffset + centralSize !== endOffset) throw new SkinRegistryError("The ZIP directory is invalid or contains too many files.", "SKIN_FILE_COUNT");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: SkinArchiveEntry[] = [];
  const seenPaths = new Set<string>();
  let offset = centralOffset;
  let totalExpanded = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new SkinRegistryError("The ZIP directory entry is invalid.", "SKIN_ZIP_INVALID");
    const madeBy = bytes.readUInt16LE(offset + 4);
    const flags = bytes.readUInt16LE(offset + 8);
    const compression = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const expandedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const fileCommentLength = bytes.readUInt16LE(offset + 32);
    const diskStart = bytes.readUInt16LE(offset + 34);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const recordEnd = offset + 46 + nameLength + extraLength + fileCommentLength;
    if (recordEnd > endOffset || diskStart !== 0 || flags & ~0x0800 || (compression !== 0 && compression !== 8) || compressedSize === 0xffffffff || expandedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new SkinRegistryError("Encrypted, multi-disk, and unsupported ZIP entries are not allowed.", "SKIN_ZIP_FORMAT");
    }
    let entryPath: string;
    try { entryPath = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); }
    catch { throw new SkinRegistryError("ZIP filenames must be valid UTF-8.", "SKIN_PATH_INVALID"); }
    if (!(flags & 0x800) && /[^\x00-\x7f]/.test(entryPath)) throw new SkinRegistryError("Non-ASCII ZIP filenames must be encoded as UTF-8.", "SKIN_PATH_INVALID");
    if (!isSafePackagePath(entryPath, entryPath.endsWith("/"))) throw new SkinRegistryError("The package contains an unsafe path.", "SKIN_PATH_INVALID");
    const normalizedPath = entryPath.toLowerCase();
    if (seenPaths.has(normalizedPath)) throw new SkinRegistryError("The package contains duplicate or case-conflicting paths.", "SKIN_PATH_DUPLICATE");
    seenPaths.add(normalizedPath);
    const unixFileType = madeBy >> 8 === 3 ? (externalAttributes >>> 16) & 0xf000 : 0;
    if (unixFileType !== 0 && unixFileType !== 0x8000 && unixFileType !== 0x4000) throw new SkinRegistryError("Only regular files and directories are allowed in a skin package.", "SKIN_FILE_TYPE");
    const isDirectory = entryPath.endsWith("/");
    if ((unixFileType === 0x4000) !== isDirectory && unixFileType !== 0) throw new SkinRegistryError("ZIP file type does not match its path.", "SKIN_FILE_TYPE");
    if (isDirectory && (compressedSize !== 0 || expandedSize !== 0)) throw new SkinRegistryError("ZIP directory entries cannot contain data.", "SKIN_ZIP_INVALID");
    if (compression === 0 && compressedSize !== expandedSize) throw new SkinRegistryError("A stored ZIP entry has inconsistent sizes.", "SKIN_ZIP_INVALID");
    if (!isDirectory) {
      totalExpanded += expandedSize;
      if (totalExpanded > MAX_EXPANDED_BYTES) throw new SkinRegistryError("The expanded package exceeds 50 MiB.", "SKIN_EXPANDED_SIZE");
      if (expandedSize > 1024 * 1024 && expandedSize > Math.max(compressedSize, 1) * 250) throw new SkinRegistryError("The package has an abnormal compression ratio.", "SKIN_COMPRESSION_RATIO");
    }
    entries.push({ path: entryPath, compressedSize, expandedSize, compression, crc, localOffset, flags, isDirectory, unixFileType });
    offset = recordEnd;
  }
  if (offset !== centralOffset + centralSize) throw new SkinRegistryError("The ZIP directory length is inconsistent.", "SKIN_ZIP_INVALID");
  validateLocalEntries(bytes, entries, centralOffset, decoder);
  return entries;
}

function validateLocalEntries(bytes: Buffer, entries: SkinArchiveEntry[], centralOffset: number, decoder: TextDecoder): void {
  const spans: Array<{ start: number; end: number }> = [];
  for (const entry of entries) {
    const offset = entry.localOffset;
    if (offset + 30 > centralOffset || bytes.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new SkinRegistryError("A ZIP local file header is invalid.", "SKIN_ZIP_INVALID");
    const flags = bytes.readUInt16LE(offset + 6);
    const compression = bytes.readUInt16LE(offset + 8);
    const crc = bytes.readUInt32LE(offset + 14);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const expandedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const headerEnd = offset + 30 + nameLength + extraLength;
    if (headerEnd > centralOffset || flags !== entry.flags || compression !== entry.compression || crc !== entry.crc || compressedSize !== entry.compressedSize || expandedSize !== entry.expandedSize) {
      throw new SkinRegistryError("ZIP local and central headers disagree.", "SKIN_ZIP_INVALID");
    }
    let localPath: string;
    try { localPath = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength)); }
    catch { throw new SkinRegistryError("ZIP filenames must be valid UTF-8.", "SKIN_PATH_INVALID"); }
    if (localPath !== entry.path) throw new SkinRegistryError("ZIP local and central filenames disagree.", "SKIN_ZIP_INVALID");
    const end = headerEnd + entry.compressedSize;
    if (end > centralOffset) throw new SkinRegistryError("A ZIP entry overlaps the central directory.", "SKIN_ZIP_INVALID");
    spans.push({ start: offset, end });
  }
  spans.sort((left, right) => left.start - right.start);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) throw new SkinRegistryError("ZIP local file entries overlap.", "SKIN_ZIP_INVALID");
  }
}

function extractEntry(archive: Buffer, entry: SkinArchiveEntry): Buffer {
  const offset = entry.localOffset;
  if (offset + 30 > archive.byteLength || archive.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new SkinRegistryError("A ZIP local file header is invalid.", "SKIN_ZIP_INVALID");
  const flags = archive.readUInt16LE(offset + 6);
  const compression = archive.readUInt16LE(offset + 8);
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  if (flags !== entry.flags || compression !== entry.compression) throw new SkinRegistryError("ZIP headers disagree about file compression.", "SKIN_ZIP_INVALID");
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.byteLength) throw new SkinRegistryError("A ZIP entry extends past the archive.", "SKIN_ZIP_INVALID");
  const compressed = archive.subarray(dataStart, dataEnd);
  if (entry.compression === 0) return Buffer.from(compressed);
  try { return inflateRawSync(compressed, { maxOutputLength: entry.expandedSize + 1 }); }
  catch { throw new SkinRegistryError("A ZIP entry could not be safely decompressed.", "SKIN_ZIP_INVALID"); }
}

function parseManifest(bytes: Buffer): ParsedSkinManifest {
  let raw: unknown;
  try { raw = JSON.parse(decodeUtf8(bytes, "manifest.json is not valid UTF-8.")); }
  catch { throw new SkinRegistryError("manifest.json must contain valid JSON.", "SKIN_MANIFEST_INVALID"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SkinRegistryError("manifest.json must be an object.", "SKIN_MANIFEST_INVALID");
  const value = raw as Record<string, unknown>;
  const read = (key: string, max: number): string => {
    const item = value[key];
    if (typeof item !== "string" || !item.trim() || item.length > max) throw new SkinRegistryError(`manifest.json has an invalid ${key} field.`, "SKIN_MANIFEST_INVALID");
    return item.trim();
  };
  const id = read("id", 80);
  if (value.schemaVersion !== 1 || !isSafeSkinId(id)) throw new SkinRegistryError("The skin schema version or ID is unsupported.", "SKIN_SCHEMA_VERSION");
  const version = read("version", 32);
  const minAppVersion = read("minAppVersion", 32);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(minAppVersion)) throw new SkinRegistryError("Skin and minimum app versions must use semantic version format.", "SKIN_MANIFEST_INVALID");
  const entry = read("entry", 120);
  const readOptional = (key: string, max: number): string | undefined => value[key] == null ? undefined : read(key, max);
  const content = readOptional("content", 120);
  const preview = readOptional("preview", 120);
  for (const candidate of [entry, content, preview].filter((item): item is string => Boolean(item))) if (!isSafePackagePath(candidate)) throw new SkinRegistryError("The manifest references an unsafe path.", "SKIN_PATH_INVALID");
  if (!entry.toLowerCase().endsWith(".css") || (content && !content.toLowerCase().endsWith(".json")) || (preview && !imageMime(preview))) throw new SkinRegistryError("The entry must be CSS, content must be JSON, and preview must be a supported image.", "SKIN_MANIFEST_INVALID");
  if (new Set(["manifest.json", entry, ...(content ? [content] : []), ...(preview ? [preview] : [])].map((item) => item.toLowerCase())).size !== 2 + Number(Boolean(content)) + Number(Boolean(preview))) throw new SkinRegistryError("Manifest files must use separate package paths.", "SKIN_MANIFEST_INVALID");
  const description = readOptional("description", 400);
  return { id, name: read("name", 80), version, author: read("author", 80), license: read("license", 80), minAppVersion, entry, ...(content ? { content } : {}), ...(preview ? { preview } : {}), ...(description ? { description } : {}) };
}

function singleRootPrefix(paths: string[]): string {
  if (!paths.length) return "";
  const firstSlash = paths[0].indexOf("/");
  if (firstSlash < 1) return "";
  const prefix = paths[0].slice(0, firstSlash + 1);
  return paths.every((item) => item.startsWith(prefix)) ? prefix : "";
}

function isSafePackagePath(value: string, allowDirectory = false): boolean {
  const candidate = allowDirectory ? value.slice(0, -1) : value;
  return Boolean(candidate) && !candidate.startsWith("/") && !candidate.includes("\\") && !candidate.includes("\0") && !/^[a-z]:/i.test(candidate)
    && candidate.split("/").every((part) => Boolean(part) && part !== "." && part !== ".." && !part.includes(":"));
}

function isSafeSkinId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.startsWith("builtin.");
}

function imageMime(filename: string): string | null {
  switch (path.extname(filename).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    case ".gif": return "image/gif";
    default: return null;
  }
}

function decodeUtf8(bytes: Buffer, message: string): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new SkinRegistryError(message, "SKIN_ENCODING_INVALID"); }
}

function isCatalogEntry(value: unknown): value is SkinCatalogEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!isSafeSkinId(item.id) || !isShortText(item.name, 80) || !isShortText(item.author, 80) || !isShortText(item.license, 80)) return false;
  if (typeof item.version !== "string" || !semver.test(item.version) || typeof item.minAppVersion !== "string" || !semver.test(item.minAppVersion)) return false;
  if (!Number.isSafeInteger(item.installedAt) || (item.installedAt as number) < 0) return false;
  if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 400)) return false;
  const hasPreview = item.previewUrl !== undefined || item.previewMimeType !== undefined;
  return !hasPreview || (item.previewUrl === `/api/skins/${item.id}/preview` && ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"].includes(String(item.previewMimeType)));
}

function isShortText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
