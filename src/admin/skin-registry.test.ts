import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SkinRegistry, SkinRegistryError } from "./skin-registry.js";

const manifest = {
  schemaVersion: 1,
  id: "sample-skin",
  name: "Sample skin",
  version: "1.0.0",
  author: "WebSpeak test",
  license: "MIT",
  minAppVersion: "0.2.4",
  entry: "skin.css",
  content: "content.json",
  preview: "assets/preview.png",
};

test("skin registry validates, lists, replaces, serves, and removes packages", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-skin-registry-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const registry = new SkinRegistry(directory);

  assert.equal(await registry.readArchive("sample-skin"), null);
  const firstArchive = createZip([
    ["manifest.json", Buffer.from(JSON.stringify(manifest))],
    ["skin.css", Buffer.from(".voice-card { background: url(assets/background.png); }")],
    ["content.json", Buffer.from(JSON.stringify({ defaultLocale: "en", locales: { en: { home: { title: "Hello" } } } }))],
    ["assets/background.png", Buffer.from([1, 2, 3, 4])],
    ["assets/preview.png", Buffer.from([5, 6, 7, 8])],
  ]);
  const first = await registry.save(firstArchive, "sample-skin");
  assert.equal(first.id, "sample-skin");
  assert.equal(first.previewUrl, "/api/skins/sample-skin/preview");
  assert.equal((await registry.list()).length, 1);
  assert.deepEqual(await registry.readArchive("sample-skin"), firstArchive);
  assert.deepEqual((await registry.readPreview("sample-skin"))?.bytes, Buffer.from([5, 6, 7, 8]));

  const replacement = { ...manifest, version: "2.0.0", content: undefined, preview: undefined };
  const secondArchive = createZip([
    ["manifest.json", Buffer.from(JSON.stringify(replacement))],
    ["skin.css", Buffer.from(".voice-card { border-radius: 0; }")],
  ]);
  const second = await registry.save(secondArchive, "sample-skin");
  assert.equal(second.version, "2.0.0");
  assert.equal(second.installedAt, first.installedAt);
  assert.equal(await registry.readPreview("sample-skin"), null);
  assert.deepEqual(await registry.readArchive("sample-skin"), secondArchive);

  assert.equal(await registry.remove("sample-skin"), true);
  assert.deepEqual(await registry.list(), []);
  assert.equal(await registry.readArchive("sample-skin"), null);
  assert.equal(await registry.remove("sample-skin"), false);
});

test("skin registry rejects path traversal and mismatched local ZIP headers", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-skin-invalid-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const registry = new SkinRegistry(directory);
  const goodFiles: Array<[string, Buffer]> = [
    ["manifest.json", Buffer.from(JSON.stringify({ ...manifest, content: undefined, preview: undefined }))],
    ["skin.css", Buffer.from(".voice-card { color: teal; }")],
  ];

  await assert.rejects(registry.save(createZip([["../escape.png", Buffer.from([1])], ...goodFiles]), "sample-skin"), (error: unknown) => error instanceof SkinRegistryError && error.code === "SKIN_PATH_INVALID");
  const mismatched = createZip(goodFiles);
  mismatched[30] ^= 1;
  await assert.rejects(registry.save(mismatched, "sample-skin"), (error: unknown) => error instanceof SkinRegistryError && error.code === "SKIN_ZIP_INVALID");

  await writeFile(path.join(directory, "orphan.wskin"), createZip(goodFiles));
  assert.equal(await registry.readArchive("orphan"), null);
  assert.deepEqual(await registry.list(), []);
});

test("the documented Aurora Voice package passes the server-side upload validator", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-skin-example-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const registry = new SkinRegistry(directory);
  const archive = await readFile(new URL("../../docs/examples/aurora-voice.wskin", import.meta.url));
  const entry = await registry.save(archive, "community.aurora-voice");
  assert.equal(entry.name, "Aurora Voice");
  assert.equal(entry.previewUrl, "/api/skins/community.aurora-voice/preview");
  assert.equal((await registry.list()).length, 1);
});

function createZip(files: Array<[string, Buffer]>): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const [name, bytes] of files) {
    const filename = Buffer.from(name, "utf8");
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + filename.length + bytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);
    bytes.copy(local, 30 + filename.length);
    localRecords.push(local);

    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(0x81a40000, 38);
    central.writeUInt32LE(localOffset, 42);
    filename.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
