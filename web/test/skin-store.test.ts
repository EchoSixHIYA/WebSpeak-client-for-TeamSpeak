import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import express from "express";
import { zipSync, strToU8 } from "fflate";
import { SkinRegistry, SkinRegistryError } from "../../src/admin/skin-registry.js";
import { SkinStore } from "../../src/admin/skin-store.js";
import { createAdminRouter } from "../../src/admin/admin-router.js";
import { AdminSessionStore } from "../../src/admin/admin-session.js";
import type { AdminService } from "../../src/admin/admin-service.js";
import type { Logger } from "../../src/logger.js";
import { SKIN_STORE_INDEX_URL, compareSkinVersions } from "../../src/shared/skin-store.js";
import { createAdminApi } from "../src/services/admin-api.js";

const repository = "https://github.com/example/skin";
const raw = "https://raw.githubusercontent.com/example/skin";
const manifest = { schemaVersion: 1, id: "community.store-test", name: "Store fixture", version: "1.0.0", author: "Fixture", license: "MIT", minAppVersion: "0.2.8", entry: "skin.css" };
function fixture() {
  let version = "1.0.0";
  const archive = () => Buffer.from(zipSync({ "manifest.json": strToU8(JSON.stringify({ ...manifest, version })), "skin.css": strToU8('[data-ws-part="voice.member"] { color: teal; }') }));
  const metadata = () => ({ ...manifest, version, description: "Fixture description", package: { ref: `v${version}`, path: "skin.wskin", sha256: createHash("sha256").update(archive()).digest("hex") } });
  const index = { schemaVersion: 1, skins: [{ id: manifest.id, repository }] };
  const overrides = new Map<string, () => Response>();
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url); calls.push(path);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    if (overrides.has(path)) return overrides.get(path)!();
    if (path === SKIN_STORE_INDEX_URL) return Response.json(index);
    if (path === `${raw}/HEAD/skin.json`) return Response.json(metadata());
    if (path === `${raw}/v${version}/skin.wskin`) return new Response(archive());
    throw new Error("Unexpected outbound URL");
  };
  return { archive, metadata, index, calls, overrides, fetcher, setVersion(value: string) { version = value; } };
}
const errorCode = (expected: string) => (error: unknown) => error instanceof SkinRegistryError && error.code === expected;
async function registry(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "webspeak-store-test-"));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes("webspeak-store-test-"));
    await rm(directory, { force: true, recursive: true });
  });
  return new SkinRegistry(directory);
}
test("store installs exact verified packages and preserves enabled/default state on update", async t => {
  const f = fixture(), store = new SkinStore("0.2.8", f.fetcher), skins = await registry(t);
  const entry = (await store.list()).entries[0];
  assert.equal(entry.compatible, true);
  const input = { id: entry.id, revision: entry.revision, installedVersion: null };
  await store.install(skins, input);
  assert.deepEqual(await skins.readArchive(entry.id), f.archive());
  await skins.setDefaultSkin(entry.id);
  f.setVersion("1.1.0");
  const updated = (await store.list(true)).entries[0];
  await store.install(skins, { ...input, revision: updated.revision, installedVersion: "1.0.0" });
  assert.equal(await skins.getDefaultSkinId(), entry.id);
  await skins.setEnabled(entry.id, false);
  f.setVersion("1.2.0");
  const next = (await store.list(true)).entries[0];
  await store.install(skins, { ...input, revision: next.revision, installedVersion: "1.1.0" });
  assert.equal((await skins.list())[0].enabled, false);
  assert.equal(await skins.getDefaultSkinId(), "builtin.light");
});
test("store blocks changed catalogs, concurrent replacements, downgrades and incompatible apps", async t => {
  const f = fixture(), store = new SkinStore("0.2.8", f.fetcher), skins = await registry(t);
  const entry = (await store.list()).entries[0];
  const input = { id: entry.id, revision: entry.revision, installedVersion: null };
  f.setVersion("1.1.0");
  await assert.rejects(store.install(skins, input), errorCode("SKIN_STORE_CHANGED"));
  f.setVersion("1.0.0");
  await skins.save(f.archive(), entry.id);
  await assert.rejects(store.install(skins, input), errorCode("SKIN_STORE_INSTALLED_CHANGED"));
  await assert.rejects(store.install(skins, { ...input, installedVersion: "1.0.0" }), errorCode("SKIN_STORE_NOT_NEWER"));
  const old = new SkinStore("0.2.7", f.fetcher);
  assert.equal((await old.list()).entries[0].compatible, false);
  await assert.rejects(old.install(skins, input), errorCode("SKIN_STORE_INCOMPATIBLE"));
  assert.equal((await skins.list())[0].version, "1.0.0");
});
test("store rejects unsafe repositories, malformed/duplicate indexes and isolates a failed repository", async () => {
  for (const unsafe of ["http://github.com/a/b", "https://github.com.evil/a/b", "https://github.com/a/b?url=http://127.0.0.1", "https://user:pass@github.com/a/b", "https://github.com/a/..", "https://127.0.0.1/a/b"]) {
    const f = fixture(); f.index.skins[0].repository = unsafe;
    await assert.rejects(new SkinStore("0.2.8", f.fetcher).list(), errorCode("SKIN_STORE_INVALID"));
    assert.deepEqual(f.calls, [SKIN_STORE_INDEX_URL]);
  }
  const f = fixture(); f.index.skins.push({ ...f.index.skins[0] });
  await assert.rejects(new SkinStore("0.2.8", f.fetcher).list(), errorCode("SKIN_STORE_INVALID"));
  f.index.skins.pop();
  f.overrides.set(`${raw}/HEAD/skin.json`, () => new Response(null, { status: 404 }));
  const result = await new SkinStore("0.2.8", f.fetcher).list();
  assert.equal(result.entries[0].metadata, null);
  assert.equal(result.entries[0].error, "SKIN_STORE_UNAVAILABLE");
});
test("store bounds downloads and validates checksum, package identity and metadata before saving", async t => {
  const f = fixture(), store = new SkinStore("0.2.8", f.fetcher), skins = await registry(t);
  const entry = (await store.list()).entries[0], input = { id: entry.id, revision: entry.revision, installedVersion: null };
  const packageUrl = `${raw}/v1.0.0/skin.wskin`;
  f.overrides.set(packageUrl, () => new Response("wrong bytes"));
  await assert.rejects(store.install(skins, input), errorCode("SKIN_STORE_CHECKSUM"));
  f.overrides.set(packageUrl, () => new Response("x", { headers: { "content-length": String(21 * 1024 * 1024) } }));
  await assert.rejects(store.install(skins, input), errorCode("SKIN_STORE_TOO_LARGE"));
  f.overrides.delete(packageUrl);
  f.overrides.set(`${raw}/HEAD/skin.json`, () => Response.json({ ...f.metadata(), name: "Different display name" }));
  const mismatch = (await store.list(true)).entries[0];
  await assert.rejects(store.install(skins, { ...input, revision: mismatch.revision }), errorCode("SKIN_STORE_PACKAGE_MISMATCH"));
  f.overrides.set(`${raw}/HEAD/skin.json`, () => Response.json({ ...f.metadata(), package: { ...f.metadata().package, path: "../private.wskin" } }));
  assert.equal((await store.list(true)).entries[0].error, "SKIN_STORE_INVALID");
  assert.deepEqual(await skins.list(), []);
  f.overrides.set(SKIN_STORE_INDEX_URL, () => new Response("x".repeat(129 * 1024)));
  await assert.rejects(store.list(true), errorCode("SKIN_STORE_TOO_LARGE"));
});
test("catalog reads coalesce/cache and a failed refresh cannot erase the cached catalog", async () => {
  const f = fixture(), store = new SkinStore("0.2.8", f.fetcher);
  await Promise.all([store.list(), store.list()]);
  await store.list();
  assert.equal(f.calls.filter(url => url === SKIN_STORE_INDEX_URL).length, 1);
  f.overrides.set(SKIN_STORE_INDEX_URL, () => new Response(null, { status: 503 }));
  await assert.rejects(store.list(true), errorCode("SKIN_STORE_UNAVAILABLE"));
  assert.equal((await store.list()).entries.length, 1);
});
test("semantic versions handle prereleases, build metadata and multi-digit components", () => {
  assert.equal(compareSkinVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareSkinVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.equal(compareSkinVersions("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareSkinVersions("1.0.0+build", "1.0.0"), 0);
});
test("actual admin HTTP endpoints enforce authentication/CSRF and serialize competing installs", async t => {
  const f = fixture(), skins = await registry(t);
  const logger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
  const service = { isInitialized: () => true, isPasswordChangeRequired: () => false, verifyPassword: async () => true, database: { addAudit() {} } } as unknown as AdminService;
  const app = express(); app.use(express.json());
  app.use("/api/admin", createAdminRouter({ service, sessions: new AdminSessionStore(), logger, getActiveSessions: () => 0, getPeakSessions: () => 0, startedAt: Date.now(), version: "0.2.8", skinRegistry: skins, skinStore: new SkinStore("0.2.8", f.fetcher) }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>(done => server.close(() => done())));
  await new Promise<void>(done => server.once("listening", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let cookie = "", csrf = "";
  const api = createAdminApi({ csrfToken: () => csrf, fetch: async (path, init) => {
    const headers = new Headers(init?.headers); headers.set("origin", origin); if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${origin}${path}`, { ...init, headers });
    const session = response.headers.get("set-cookie"); if (session) cookie = session.split(";")[0]; return response;
  } });
  await assert.rejects(api.skinStore(), (e: any) => e.status === 401);
  csrf = (await api.login("admin", "test-only-password")).csrfToken;
  const entry = (await api.skinStore()).entries[0];
  const input = { id: entry.id, revision: entry.revision, installedVersion: null };
  for (const path of ["/skin-store/refresh", "/skin-store/install"]) {
    const response = await fetch(`${origin}/api/admin${path}`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(response.status, 403);
  }
  const outcomes = await Promise.allSettled([api.installStoreSkin(input), api.installStoreSkin(input)]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(result => result.status === "rejected").length, 1);
  assert.equal((await api.skins()).skins[0].id, entry.id);
  await api.setSkinEnabled(entry.id, false);
  assert.equal((await skins.list())[0].enabled, false);
  await api.deleteSkin(entry.id);
  assert.equal((await api.skins()).skins.length, 0);
});
