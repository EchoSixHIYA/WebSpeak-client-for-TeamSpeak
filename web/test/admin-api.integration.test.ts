import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import express from "express";
import { WebSpeakDatabase } from "../../src/persistence/database.js";
import type { Logger } from "../../src/logger.js";
import { AdminService } from "../../src/admin/admin-service.js";
import { AdminSessionStore } from "../../src/admin/admin-session.js";
import { createAdminRouter } from "../../src/admin/admin-router.js";
import { createAdminApi } from "../src/services/admin-api.js";
import { adminResponses } from "../../src/shared/admin-responses.js";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };

test("schema 7 upgrades preserve the previously unused public host and initialize ICE defaults", t => {
  const directory = mkdtempSync(join(tmpdir(), "webspeak-ice-migration-"));
  const filename = join(directory, "test.db");
  const original = new WebSpeakDatabase(filename);
  original.close();
  const legacy = new DatabaseSync(filename);
  legacy.exec("ALTER TABLE settings DROP COLUMN ts_target; ALTER TABLE managed_invites DROP COLUMN target_text; ALTER TABLE settings DROP COLUMN webrtc_ipv6_enabled; ALTER TABLE settings DROP COLUMN webrtc_stun_server; PRAGMA user_version = 7;");
  legacy.prepare("UPDATE settings SET webrtc_public_host = ?").run("media.example.com");
  legacy.close();
  const migrated = new WebSpeakDatabase(filename);
  t.after(() => {
    migrated.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes("webspeak-ice-migration-"));
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(migrated.getSettings().webRtcPublicHost, "media.example.com");
  assert.equal(migrated.getSettings().webRtcIpv6Enabled, false);
  assert.equal(migrated.getSettings().webRtcStunServer, "");
});

test("browser admin API consumes the actual HTTP router and preserves keep/replace/remove secrets", async t => {
  const directory = mkdtempSync(join(tmpdir(), "webspeak-admin-api-"));
  const database = new WebSpeakDatabase(join(directory, "test.db"));
  t.after(() => {
    database.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes("webspeak-admin-api-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const service = new AdminService(database, Buffer.alloc(32, 7), logger, join(directory, "absent-config.json"), undefined, "test-version");
  await service.initialize();
  await service.changePassword("test-only-admin-password");
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter({ service, sessions: new AdminSessionStore(), logger, getActiveSessions: () => 0, getPeakSessions: () => 0, startedAt: Date.now(), version: "test-version" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  let csrf = "";
  const api = createAdminApi({ csrfToken: () => csrf, fetch: async (path, init) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", origin);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${origin}${path}`, { ...init, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return response;
  } });
  assert.equal((await api.session()).authenticated, false);
  csrf = (await api.login("admin", "test-only-admin-password")).csrfToken;
  assert.equal((await api.session()).authenticated, true);
  assert.equal((await api.overview()).gateway.version, "test-version");
  const original = await api.settings();
  assert.equal(original.webRtcPublicHost, "");
  assert.equal(original.webRtcIpv6Enabled, false);
  assert.equal(original.webRtcStunServer, "");
  const network = { webRtcPublicHost: " MEDIA.example.com ", webRtcIpv6Enabled: true, webRtcStunServer: "stun:stun.example.com" };
  const updated = await api.saveSettings({ ...original, ...network });
  assert.equal(updated.settings.webRtcPublicHost, "media.example.com");
  assert.equal(updated.settings.webRtcStunServer, "stun:stun.example.com:3478");
  assert.deepEqual(service.getWebRtcAudioOptions(), { enabled: false, publicHost: "media.example.com", ipv6Enabled: true, stunServer: "stun:stun.example.com:3478", udpPortRange: [40000, 40099] });
  const { webRtcPublicHost, webRtcIpv6Enabled, webRtcStunServer, ...legacyInput } = original;
  await api.saveSettings(legacyInput);
  assert.equal((await api.settings()).webRtcPublicHost, "media.example.com", "older clients must preserve the new settings");
  for (const [key, value, code] of [
    ["webRtcPublicHost", "https://media.example.com", "INVALID_WEBRTC_PUBLIC_HOST"],
    ["webRtcPublicHost", null, "INVALID_WEBRTC_PUBLIC_HOST"],
    ["webRtcStunServer", "turn:user:password@example.com", "INVALID_WEBRTC_STUN_SERVER"],
    ["webRtcStunServer", [], "INVALID_WEBRTC_STUN_SERVER"],
    ["webRtcIpv6Enabled", "true", "INVALID_WEBRTC_IPV6"],
  ] as const) {
    await assert.rejects(api.saveSettings({ ...original, [key]: value } as never), (error: any) => error.code === code);
    assert.equal(database.getSettings().webRtcIpv6Enabled, true, "rejected updates must not change stored settings");
  }
  for (const passwordAction of ["replace", "keep", "remove"] as const) {
    const body = {
      ...original, passwordAction, ...(passwordAction === "replace" ? { serverPassword: "test-server-password" } : {}),
      relayNodes: [{ id: "relay-test", name: "Test relay", target: "relay.example.invalid:1234", enabled: passwordAction !== "remove", tokenAction: passwordAction, ...(passwordAction === "replace" ? { token: "test-relay-token" } : {}) }],
    };
    const saved = await api.saveSettings(body);
    assert.equal(saved.settings.hasPassword, passwordAction !== "remove");
    assert.equal(service.getConnectionPolicy().serverPassword, passwordAction === "remove" ? "" : "test-server-password");
    assert.equal(saved.settings.relayNodes[0].hasToken, passwordAction !== "remove");
    assert.equal(service.getAccelerationRelayOptions()[0]?.token, passwordAction === "remove" ? undefined : "test-relay-token");
  }
  const settings = service.getAdminSettings();
  assert.deepEqual(adminResponses.settings({ ...settings, passwordAction: "remove", serverPassword: "injected" }), settings);
  const created = await api.createInvite({ channel: "Lobby", expiresInHours: 1, maxUses: 1 });
  assert.equal((await api.invites()).invites[0].id, created.invite.id);
  await api.revokeInvite(created.invite.id);
  assert.equal((await api.invites()).invites[0].status, "revoked");
  assert.deepEqual((await api.sessions()).sessions, []);
  assert.equal((await api.diagnostics()).gateway.version, "test-version");
  assert.equal((await api.logs()).available, false);
  assert.ok((await api.audit()).events.length > 0);
  assert.equal((await api.skins()).defaultSkinId, "builtin.light");
  const backup = Buffer.from(await (await api.backup()).arrayBuffer());
  assert.equal(backup.subarray(0, 16).toString(), "SQLite format 3\0");
  await api.logout();
  assert.equal((await api.session()).authenticated, false);
});

test("concurrent admin login failures cannot outrun the attempt limit, which is keyed by the resolved client", async t => {
  const service = {
    isInitialized: () => true,
    isPasswordChangeRequired: () => false,
    // Model the slow scrypt verification that concurrent attempts used to race.
    verifyPassword: async () => { await new Promise(resolve => setTimeout(resolve, 50)); return false; },
    database: { addAudit() {} },
  } as unknown as AdminService;
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter({
    service, sessions: new AdminSessionStore(), logger, getActiveSessions: () => 0, getPeakSessions: () => 0, startedAt: Date.now(),
    clientIp: request => request.header("x-test-client") ?? "unknown",
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const login = (client: string) => fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-test-client": client },
    body: JSON.stringify({ username: "admin", password: "wrong-password" }),
  }).then(response => response.status);

  const statuses = await Promise.all(Array.from({ length: 12 }, () => login("203.0.113.9")));
  assert.equal(statuses.filter(status => status === 401).length, 5);
  assert.equal(statuses.filter(status => status === 429).length, 7);
  // Another visitor behind the same proxy keeps an independent budget.
  assert.equal(await login("198.51.100.4"), 401);
});

test("changing the admin password ends every other admin session", () => {
  const sessions = new AdminSessionStore();
  const login = () => {
    let token = "";
    sessions.create({ cookie: (_name: string, value: string) => { token = value; } } as never, false);
    return { headers: { cookie: `webspeak_admin=${token}` } } as never;
  };
  const current = login();
  const earlier = login();
  assert.ok(sessions.get(current) && sessions.get(earlier));
  sessions.revokeOthers(current);
  assert.ok(sessions.get(current), "the requester stays signed in");
  assert.equal(sessions.get(earlier), null);
});
