import { createReadStream, createWriteStream, type Stats } from "node:fs";
import { chmod, mkdir, open, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { createGunzip, createInflateRaw } from "node:zlib";
import { Transform as StreamTransform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ArchiveErrorCode =
  | "UPDATE_ARCHIVE_INVALID"
  | "UPDATE_ARCHIVE_UNSAFE"
  | "UPDATE_ARCHIVE_LIMIT"
  | "UPDATE_ARCHIVE_UNSUPPORTED";

export class ArchiveError extends Error {
  constructor(readonly code: ArchiveErrorCode, message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

export interface ExtractLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

const DEFAULT_LIMITS: ExtractLimits = {
  maxEntries: 50_000,
  maxTotalBytes: 4 * 1024 ** 3,
  maxFileBytes: 2 * 1024 ** 3,
};

export async function extractReleaseArchive(
  archivePath: string,
  destination: string,
  archiveName: string,
  limits: Partial<ExtractLimits> = {},
): Promise<void> {
  const effective = { ...DEFAULT_LIMITS, ...limits };
  await mkdir(destination, { recursive: true });
  if (/\.zip$/i.test(archiveName)) {
    await extractZip(archivePath, destination, effective);
    return;
  }
  if (/\.(?:tar\.gz|tgz)$/i.test(archiveName)) {
    await extractTarGz(archivePath, destination, effective);
    return;
  }
  throw new ArchiveError("UPDATE_ARCHIVE_UNSUPPORTED", "Only .tar.gz and .zip release packages are supported.");
}

function unsafe(message: string): never {
  throw new ArchiveError("UPDATE_ARCHIVE_UNSAFE", message);
}

function invalid(message: string): never {
  throw new ArchiveError("UPDATE_ARCHIVE_INVALID", message);
}

function limitExceeded(message: string): never {
  throw new ArchiveError("UPDATE_ARCHIVE_LIMIT", message);
}

/** Reject absolute paths, drive letters, parent traversal and NUL bytes. */
export function safeArchivePath(raw: string): string {
  if (!raw || raw.includes("\0")) unsafe("Archive entry has an invalid name.");
  const normalized = raw.replaceAll("\\", "/");
  if (normalized.startsWith("/")) unsafe("Archive entry uses an absolute path.");
  if (/^[A-Za-z]:/.test(normalized)) unsafe("Archive entry uses a drive-qualified path.");
  const parts = normalized.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) unsafe("Archive entry escapes the extraction directory.");
  return parts.join("/");
}

function resolveEntry(destination: string, relative: string): string {
  const target = path.resolve(destination, relative);
  const root = path.resolve(destination);
  if (target !== root && !target.startsWith(root + path.sep)) unsafe("Archive entry escapes the extraction directory.");
  return target;
}

function isZeroBlock(buffer: Buffer): boolean {
  for (const byte of buffer) if (byte !== 0) return false;
  return true;
}

function readCString(buffer: Buffer): string {
  const end = buffer.indexOf(0);
  return (end >= 0 ? buffer.subarray(0, end) : buffer).toString("utf8");
}

function readOctal(buffer: Buffer): number {
  const text = readCString(buffer).trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) invalid("Archive header has an invalid numeric field.");
  return Number.parseInt(text, 8);
}

function verifyTarChecksum(header: Buffer): void {
  const expected = readOctal(header.subarray(148, 156));
  if (!expected) return;
  let sum = 0;
  for (let index = 0; index < header.length; index++) {
    sum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (sum !== expected) invalid("Archive header checksum does not match.");
}

interface PaxFields {
  path?: string;
  linkpath?: string;
}

function parsePax(buffer: Buffer): PaxFields {
  const fields: PaxFields = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number.parseInt(buffer.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > buffer.length) break;
    const record = buffer.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) {
      const key = record.slice(0, equals);
      const value = record.slice(equals + 1);
      if (key === "path") fields.path = value;
      else if (key === "linkpath") fields.linkpath = value;
    }
    offset += length;
  }
  return fields;
}

class TarReader {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Buffer>;
  constructor(stream: NodeJS.ReadableStream) {
    this.iterator = (stream as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  }
  async readExact(size: number): Promise<Buffer> {
    while (this.buffer.length < size) {
      const next = await this.iterator.next();
      if (next.done) invalid("Release archive ended unexpectedly.");
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, next.value]) : next.value;
    }
    const result = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return result;
  }
  async skip(size: number): Promise<void> {
    let remaining = size;
    while (remaining > 0) {
      const current = this.buffer.length ? this.buffer : undefined;
      if (current) {
        const take = Math.min(current.length, remaining);
        this.buffer = current.subarray(take);
        remaining -= take;
      } else {
        const next = await this.iterator.next();
        if (next.done) invalid("Release archive ended unexpectedly.");
        this.buffer = next.value;
      }
    }
  }
}

async function writeAll(stream: ReturnType<typeof createWriteStream>, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function extractTarGz(file: string, destination: string, limits: ExtractLimits): Promise<void> {
  const reader = new TarReader(createReadStream(file).pipe(createGunzip()));
  let entries = 0;
  let total = 0;
  let longName: string | undefined;
  let pax: PaxFields = {};
  for (;;) {
    const header = await reader.readExact(512);
    if (isZeroBlock(header)) break;
    verifyTarChecksum(header);
    let name = readCString(header.subarray(0, 100));
    const prefix = readCString(header.subarray(345, 500));
    if (prefix) name = `${prefix}/${name}`;
    const size = readOctal(header.subarray(124, 136));
    if (size > limits.maxFileBytes) limitExceeded("Archive entry exceeds the file size limit.");
    const mode = readOctal(header.subarray(100, 108)) & 0o777;
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const padded = Math.ceil(size / 512) * 512;
    if (type === "L") {
      if (size > 1024 * 1024) limitExceeded("Archive long-name header is too large.");
      longName = (await reader.readExact(size)).toString("utf8").replace(/\0+$/, "");
      await reader.skip(padded - size);
      continue;
    }
    if (type === "x" || type === "X") {
      if (size > 1024 * 1024) limitExceeded("Archive extended header is too large.");
      pax = { ...pax, ...parsePax(await reader.readExact(size)) };
      await reader.skip(padded - size);
      continue;
    }
    if (type === "g") {
      await reader.skip(padded);
      continue;
    }
    const entryName = pax.path ?? longName ?? name;
    longName = undefined;
    pax = {};
    if (!entryName) invalid("Archive entry has no name.");
    if (type === "1" || type === "2") {
      unsafe(`Archive entry ${entryName} is a ${type === "1" ? "hard link" : "symbolic link"}; links are not accepted.`);
    }
    if (type !== "0" && type !== "7" && type !== "5") {
      throw new ArchiveError("UPDATE_ARCHIVE_UNSUPPORTED", `Archive entry ${entryName} has unsupported type ${type}.`);
    }
    entries++;
    if (entries > limits.maxEntries) limitExceeded("Archive contains too many entries.");
    total += size;
    if (total > limits.maxTotalBytes) limitExceeded("Archive expands beyond the size limit.");
    const relative = safeArchivePath(entryName);
    const target = resolveEntry(destination, relative);
    if (type === "5") {
      await mkdir(target, { recursive: true, mode: mode || 0o755 });
      await reader.skip(padded);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    const stream = createWriteStream(target, { mode: mode || 0o644, flags: "wx" });
    try {
      let remaining = size;
      while (remaining > 0) {
        const chunk = await reader.readExact(Math.min(remaining, 64 * 1024));
        remaining -= chunk.length;
        await writeAll(stream, chunk);
      }
      stream.end();
      await once(stream, "finish");
    } catch (error) {
      stream.destroy();
      throw error;
    }
    await reader.skip(padded - size);
  }
}

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  mode: number;
  directory: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

async function extractZip(file: string, destination: string, limits: ExtractLimits): Promise<void> {
  const handle = await open(file, "r");
  try {
    const info: Stats = await handle.stat();
    if (info.size < 22) invalid("ZIP archive is truncated.");
    const tailSize = Math.min(info.size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, info.size - tailSize);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === EOCD_SIGNATURE) {
        const commentLength = tail.readUInt16LE(index + 20);
        if (index + 22 + commentLength === tail.length) { eocd = index; break; }
      }
    }
    if (eocd < 0) invalid("ZIP end-of-directory record was not found.");
    const entryCount = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new ArchiveError("UPDATE_ARCHIVE_UNSUPPORTED", "ZIP64 release packages are not supported.");
    }
    if (entryCount > limits.maxEntries) limitExceeded("Archive contains too many entries.");
    if (directoryOffset + directorySize > info.size) invalid("ZIP central directory is outside the archive.");
    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);
    const entries: ZipEntry[] = [];
    let offset = 0;
    let total = 0;
    for (let index = 0; index < entryCount; index++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
        invalid("ZIP central directory is malformed.");
      }
      const versionMadeBy = directory.readUInt16LE(offset + 4);
      const flags = directory.readUInt16LE(offset + 8);
      const method = directory.readUInt16LE(offset + 10);
      const compressedSize = directory.readUInt32LE(offset + 20);
      const uncompressedSize = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const externalAttributes = directory.readUInt32LE(offset + 38);
      const localOffset = directory.readUInt32LE(offset + 42);
      const nameStart = offset + 46;
      if (nameStart + nameLength > directory.length) invalid("ZIP entry name is truncated.");
      const name = directory.subarray(nameStart, nameStart + nameLength).toString("utf8");
      offset = nameStart + nameLength + extraLength + commentLength;
      if (flags & 0x1) unsafe(`ZIP entry ${name} is encrypted.`);
      if (method !== 0 && method !== 8) throw new ArchiveError("UPDATE_ARCHIVE_UNSUPPORTED", `ZIP entry ${name} uses unsupported compression.`);
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new ArchiveError("UPDATE_ARCHIVE_UNSUPPORTED", "ZIP64 release packages are not supported.");
      }
      const unixMode = versionMadeBy >> 8 === 3 ? externalAttributes >>> 16 : 0;
      const fileType = unixMode & 0o170000;
      if (fileType === 0o120000) unsafe(`ZIP entry ${name} is a symbolic link.`);
      if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
        unsafe(`ZIP entry ${name} has an unsupported file type.`);
      }
      const directoryEntry = name.endsWith("/") || fileType === 0o040000;
      if (!directoryEntry && uncompressedSize > limits.maxFileBytes) limitExceeded("Archive entry exceeds the file size limit.");
      total += directoryEntry ? 0 : uncompressedSize;
      if (total > limits.maxTotalBytes) limitExceeded("Archive expands beyond the size limit.");
      entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset, mode: unixMode & 0o777, directory: directoryEntry });
    }
    for (const entry of entries) {
      const relative = safeArchivePath(entry.name);
      if (!relative) invalid("ZIP entry has an empty path.");
      const target = resolveEntry(destination, relative);
      if (entry.directory) {
        await mkdir(target, { recursive: true, mode: entry.mode || 0o755 });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      if (entry.compressedSize === 0) {
        await writeFile(target, Buffer.alloc(0), { mode: entry.mode || 0o644, flag: "wx" });
        continue;
      }
      const header = Buffer.alloc(30);
      await handle.read(header, 0, 30, entry.localOffset);
      if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) invalid(`ZIP entry ${entry.name} has an invalid local header.`);
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const dataStart = entry.localOffset + 30 + nameLength + extraLength;
      if (dataStart + entry.compressedSize > info.size) invalid(`ZIP entry ${entry.name} is truncated.`);
      const source = createReadStream(file, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
      let writtenBytes = 0;
      const limiter = new StreamTransform({
        transform(chunk: Buffer, _encoding, callback) {
          writtenBytes += chunk.length;
          if (writtenBytes > entry.uncompressedSize) callback(new ArchiveError("UPDATE_ARCHIVE_INVALID", `ZIP entry ${entry.name} exceeds its declared size.`));
          else callback(null, chunk);
        },
      });
      const sink = createWriteStream(target, { mode: entry.mode || 0o644, flags: "wx" });
      if (entry.method === 8) await pipeline(source, createInflateRaw(), limiter, sink);
      else await pipeline(source, limiter, sink);
      const written = await stat(target);
      if (written.size !== entry.uncompressedSize) invalid(`ZIP entry ${entry.name} has an unexpected size.`);
      if (entry.mode) await chmod(target, entry.mode);
    }
  } finally {
    await handle.close();
  }
}
