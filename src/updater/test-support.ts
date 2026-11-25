import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

/** Test-only archive builders. Not imported by production code. */

export interface TarFixtureEntry {
  name: string;
  data?: Buffer | string;
  type?: "file" | "directory" | "symlink" | "hardlink";
  linkname?: string;
  mode?: number;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width, "0");
}

function tarHeader(entry: TarFixtureEntry): Buffer {
  const buffer = Buffer.alloc(512);
  const directory = entry.type === "directory";
  const link = entry.type === "symlink" || entry.type === "hardlink";
  const data = entry.data === undefined ? Buffer.alloc(0) : Buffer.from(entry.data);
  const size = directory || link ? 0 : data.length;
  buffer.write(entry.name, 0, 100, "utf8");
  buffer.write(`${octal(entry.mode ?? (directory ? 0o755 : 0o644), 7)}\0`, 100, 8, "ascii");
  buffer.write("0000000\0", 108, 8, "ascii");
  buffer.write("0000000\0", 116, 8, "ascii");
  buffer.write(`${octal(size, 11)}\0`, 124, 12, "ascii");
  buffer.write("00000000000\0", 136, 12, "ascii");
  buffer.write("        ", 148, 8, "ascii");
  buffer.write(entry.type === "directory" ? "5" : entry.type === "symlink" ? "2" : entry.type === "hardlink" ? "1" : "0", 156, 1, "ascii");
  if (entry.linkname) buffer.write(entry.linkname, 157, 100, "utf8");
  buffer.write("ustar\0", 257, 6, "ascii");
  buffer.write("00", 263, 2, "ascii");
  buffer.write("root", 265, 32, "ascii");
  buffer.write("root", 297, 32, "ascii");
  buffer.write("0000000\0", 329, 8, "ascii");
  buffer.write("0000000\0", 337, 8, "ascii");
  let checksum = 0;
  for (const byte of buffer) checksum += byte;
  buffer.write(`${octal(checksum, 6)}\0 `, 148, 8, "ascii");
  return buffer;
}

export function createTarGz(entries: TarFixtureEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.type === "directory" || entry.type === "symlink" || entry.type === "hardlink"
      ? Buffer.alloc(0)
      : Buffer.from(entry.data ?? "");
    chunks.push(tarHeader(entry));
    if (data.length) {
      chunks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

export interface ZipFixtureEntry {
  name: string;
  data?: Buffer | string;
  mode?: number;
  directory?: boolean;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries: ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const directory = entry.directory === true || entry.name.endsWith("/");
    const data = directory ? Buffer.alloc(0) : Buffer.from(entry.data ?? "");
    const name = Buffer.from(entry.name, "utf8");
    const mode = entry.mode ?? (directory ? 0o040755 : 0o100644);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const entryCentral = Buffer.alloc(46);
    entryCentral.writeUInt32LE(0x02014b50, 0);
    entryCentral.writeUInt16LE(0x0314, 4);
    entryCentral.writeUInt16LE(20, 6);
    entryCentral.writeUInt16LE(0, 8);
    entryCentral.writeUInt16LE(0, 10);
    entryCentral.writeUInt32LE(0, 12);
    entryCentral.writeUInt32LE(crc, 16);
    entryCentral.writeUInt32LE(data.length, 20);
    entryCentral.writeUInt32LE(data.length, 24);
    entryCentral.writeUInt16LE(name.length, 28);
    entryCentral.writeUInt16LE(0, 30);
    entryCentral.writeUInt16LE(0, 32);
    entryCentral.writeUInt16LE(0, 34);
    entryCentral.writeUInt16LE(0, 36);
    entryCentral.writeUInt32LE((mode << 16) >>> 0, 38);
    entryCentral.writeUInt32LE(offset, 42);
    central.push(entryCentral, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, eocd]);
}

export function sha256Hex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Minimal runnable release-package layout accepted by validateStagedPackage. */
export function createPackageFiles(root: string, version: string, extra: Record<string, string> = {}): void {
  for (const directory of ["dist", "web/dist", "node_modules", "runtime"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "webspeak-webclient", version }), "utf8");
  writeFileSync(path.join(root, "dist", "index.js"), "// package entry\n", "utf8");
  writeFileSync(path.join(root, "web", "dist", "index.html"), "<!doctype html>\n", "utf8");
  writeFileSync(path.join(root, "runtime", "node"), "#!/bin/sh\nexit 0\n", { encoding: "utf8", mode: 0o755 });
  for (const [relative, contents] of Object.entries(extra)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
}
