import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArchiveError, extractReleaseArchive } from "./archive.js";
import { createTarGz, createZip } from "./test-support.js";

function fixture(t: test.TestContext, name: string, data: Buffer): { directory: string; archive: string; destination: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-archive-"));
  const archive = path.join(directory, name);
  writeFileSync(archive, data);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, archive, destination: path.join(directory, "out") };
}

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof ArchiveError && error.code === code;
}

test("tar.gz release archives extract files and directories", async t => {
  const { archive, destination } = fixture(t, "release.tar.gz", createTarGz([
    { name: "webspeak/", type: "directory", mode: 0o755 },
    { name: "webspeak/package.json", data: JSON.stringify({ version: "0.4.0" }) },
    { name: "webspeak/dist/index.js", data: "console.log('ok');\n", mode: 0o755 },
  ]));
  await extractReleaseArchive(archive, destination, "release.tar.gz");
  assert.equal(JSON.parse(readFileSync(path.join(destination, "webspeak/package.json"), "utf8")).version, "0.4.0");
  assert.equal(readFileSync(path.join(destination, "webspeak/dist/index.js"), "utf8"), "console.log('ok');\n");
});

test("zip release archives extract stored entries", async t => {
  const { archive, destination } = fixture(t, "release.zip", createZip([
    { name: "webspeak/", directory: true },
    { name: "webspeak/package.json", data: JSON.stringify({ version: "0.4.0" }) },
    { name: "webspeak/web/dist/index.html", data: "<!doctype html>" },
  ]));
  await extractReleaseArchive(archive, destination, "release.zip");
  assert.equal(JSON.parse(readFileSync(path.join(destination, "webspeak/package.json"), "utf8")).version, "0.4.0");
  assert.equal(readFileSync(path.join(destination, "webspeak/web/dist/index.html"), "utf8"), "<!doctype html>");
});

test("tar entries that traverse or use absolute paths are rejected before writing", async t => {
  for (const name of ["../escape.txt", "/etc/escape.txt", "a/../../escape.txt", "C:/escape.txt"]) {
    const { directory, archive, destination } = fixture(t, "release.tar.gz", createTarGz([{ name, data: "owned" }]));
    await assert.rejects(extractReleaseArchive(archive, destination, "release.tar.gz"), rejectsWith("UPDATE_ARCHIVE_UNSAFE"));
    assert.equal(existsSync(path.join(directory, "out", "escape.txt")), false);
    assert.equal(existsSync(path.join(directory, "escape.txt")), false);
  }
});

test("zip entries that traverse or use absolute paths are rejected before writing", async t => {
  for (const name of ["../escape.txt", "/etc/escape.txt", "a/../../escape.txt", "C:\\escape.txt"]) {
    const { directory, archive, destination } = fixture(t, "release.zip", createZip([{ name, data: "owned" }]));
    await assert.rejects(extractReleaseArchive(archive, destination, "release.zip"), rejectsWith("UPDATE_ARCHIVE_UNSAFE"));
    assert.equal(existsSync(path.join(directory, "out", "escape.txt")), false);
    assert.equal(existsSync(path.join(directory, "escape.txt")), false);
  }
});

test("symbolic and hard links are refused for both archive formats", async t => {
  const tarSymlink = fixture(t, "release.tar.gz", createTarGz([{ name: "link", type: "symlink", linkname: "/etc/passwd" }]));
  await assert.rejects(extractReleaseArchive(tarSymlink.archive, tarSymlink.destination, "release.tar.gz"), rejectsWith("UPDATE_ARCHIVE_UNSAFE"));
  const tarHardlink = fixture(t, "release.tar.gz", createTarGz([{ name: "link", type: "hardlink", linkname: "target" }]));
  await assert.rejects(extractReleaseArchive(tarHardlink.archive, tarHardlink.destination, "release.tar.gz"), rejectsWith("UPDATE_ARCHIVE_UNSAFE"));
  const zipSymlink = fixture(t, "release.zip", createZip([{ name: "link", data: "/etc/passwd", mode: 0o120777 }]));
  await assert.rejects(extractReleaseArchive(zipSymlink.archive, zipSymlink.destination, "release.zip"), rejectsWith("UPDATE_ARCHIVE_UNSAFE"));
});

test("unsupported archive formats and malformed archives are rejected", async t => {
  const unsupported = fixture(t, "release.rar", Buffer.from("not an archive"));
  await assert.rejects(extractReleaseArchive(unsupported.archive, unsupported.destination, "release.rar"), rejectsWith("UPDATE_ARCHIVE_UNSUPPORTED"));
  const truncated = fixture(t, "release.tar.gz", Buffer.from("short"));
  await assert.rejects(extractReleaseArchive(truncated.archive, truncated.destination, "release.tar.gz"));
  const brokenZip = fixture(t, "release.zip", Buffer.alloc(64));
  await assert.rejects(extractReleaseArchive(brokenZip.archive, brokenZip.destination, "release.zip"), rejectsWith("UPDATE_ARCHIVE_INVALID"));
  const invalidName = fixture(t, "release.tar.gz", createTarGz([{ name: "", data: "x" }]));
  await assert.rejects(extractReleaseArchive(invalidName.archive, invalidName.destination, "release.tar.gz"));
});

test("declared extraction limits stop archive bombs", async t => {
  const { archive, destination } = fixture(t, "release.tar.gz", createTarGz([
    { name: "one.txt", data: "one" },
    { name: "two.txt", data: "two" },
  ]));
  await assert.rejects(
    extractReleaseArchive(archive, destination, "release.tar.gz", { maxEntries: 1 }),
    rejectsWith("UPDATE_ARCHIVE_LIMIT"),
  );
  const fileLimit = fixture(t, "release.zip", createZip([{ name: "big.txt", data: "1234567890" }]));
  await assert.rejects(
    extractReleaseArchive(fileLimit.archive, fileLimit.destination, "release.zip", { maxFileBytes: 4 }),
    rejectsWith("UPDATE_ARCHIVE_LIMIT"),
  );
});
