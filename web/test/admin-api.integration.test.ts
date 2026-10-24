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
import type { QueryClient, QueryClientOptions } from "@honeybbq/teamspeak/query";
import { decryptSecret } from "../../src/security/secret-crypto.js";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };

test("schema 7 upgrades preserve the previously unused public host and initialize ICE defaults", t => {
  const directory = mkdtempSync(join(tmpdir(), "webspeak-ice-migration-"));
  const filename = join(directory, "test.db");
  const original = new WebSpeakDatabase(filename);
  original.close();
  const legacy = new DatabaseSync(filename);
  legacy.exec("DROP TABLE ts_admin_settings; ALTER TABLE relay_nodes DROP COLUMN voice_endpoint; ALTER TABLE settings DROP COLUMN ts_target; ALTER TABLE managed_invites DROP COLUMN target_text; ALTER TABLE settings DROP COLUMN webrtc_ipv6_enabled; ALTER TABLE settings DROP COLUMN webrtc_stun_server; PRAGMA user_version = 7;");
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
  let mismatchHostKey = true;
  const queryFactory = (queryOptions: QueryClientOptions) => ({
    async connect() {
      if (queryOptions.transport.kind !== "ssh") throw new Error("expected SSH transport");
      queryOptions.transport.hostKey({
        host: "127.0.0.1", port: queryOptions.transport.port ?? 10022, keyType: "ssh-ed25519",
        key: new Uint8Array(), fingerprint: `SHA256:${(mismatchHostKey ? "B" : "A").repeat(43)}`,
      });
    },
    async disconnect() {},
    serverVersion: "6.0.0-beta-test",
    serverFamily: "ts6",
    async send(request: { command: string }) {
      if (request.command === "serverinfo") return [{ virtualserver_name: "Test TeamSpeak" }];
      if (request.command === "channellist") return [{
        cid: "1", cpid: "0", channel_name: "Lobby", channel_flag_password: "0", channel_flag_default: "1",
        channel_flag_permanent: "1", channel_flag_semi_permanent: "0", channel_codec: "4", channel_codec_quality: "6",
        channel_maxclients: "-1", channel_maxfamilyclients: "-1", total_clients: "1", total_clients_family: "1",
        channel_needed_talk_power: "0", channel_order: "0", channel_icon_id: "0",
      }];
      if (request.command === "clientlist") return [{
        clid: "42", client_nickname: "Guest", client_unique_identifier: "", cid: "1", client_type: "0",
        client_servergroups: "6,7", client_channel_group_id: "1", client_away: "0", client_is_recording: "0", client_is_talker: "0",
      }];
      throw new Error(`Unexpected ServerQuery command ${request.command}`);
    },
  }) as unknown as QueryClient;
  const service = new AdminService(database, Buffer.alloc(32, 7), logger, join(directory, "absent-config.json"), undefined, "test-version", queryFactory);
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
  const actionPath = `${origin}/api/admin/ts-admin/action`;
  assert.equal((await fetch(actionPath, { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{}' })).status, 401);
  csrf = (await api.login("admin", "test-only-admin-password")).csrfToken;
  assert.equal((await api.session()).authenticated, true);
  assert.equal((await fetch(actionPath, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: '{}' })).status, 403);
  assert.equal((await fetch(actionPath, { method: "POST", headers: { origin: "https://untrusted.example", cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: '{}' })).status, 403);
  assert.equal((await api.overview()).gateway.version, "test-version");
  const tsAdminInitial = await api.tsAdminSettings();
  assert.deepEqual({ fixedMode: tsAdminInitial.fixedMode, enabled: tsAdminInitial.enabled, hasPassword: tsAdminInitial.hasPassword }, { fixedMode: true, enabled: false, hasPassword: false });
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
  const verifiedFingerprint = `SHA256:${"A".repeat(43)}`;
  const tsAdminSaved = await api.saveTsAdminSettings({
    enabled: true, transport: "ssh", queryPort: 10022, username: "query-admin", passwordAction: "replace",
    password: "query-secret-test", hostKeyFingerprint: verifiedFingerprint,
  });
  assert.equal(tsAdminSaved.settings.hasPassword, true);
  assert.equal(tsAdminSaved.settings.hostKeyFingerprint, verifiedFingerprint);
  assert.equal(JSON.stringify(tsAdminSaved).includes("query-secret-test"), false);
  assert.notEqual(database.getTsAdminSettings().passwordEncrypted, "query-secret-test");
  assert.equal(decryptSecret(database.getTsAdminSettings().passwordEncrypted, Buffer.alloc(32, 7), "webspeak:ts-admin-query-password:v1"), "query-secret-test");
  assert.throws(() => decryptSecret(database.getTsAdminSettings().passwordEncrypted, Buffer.alloc(32, 7)));
  assert.deepEqual(adminResponses.tsAdminSettings({ ...service.getTsAdminSettings(), password: "query-secret-test" }), service.getTsAdminSettings());
  await assert.rejects(api.tsAdminOverview(), (error: any) => error.code === "TS_ADMIN_HOST_KEY_MISMATCH");
  mismatchHostKey = false;
  const tsAdminOverview = await api.tsAdminOverview();
  assert.equal(tsAdminOverview.serverName, "Test TeamSpeak");
  assert.equal(tsAdminOverview.serverFamily, "ts6");
  assert.equal(tsAdminOverview.channels[0].name, "Lobby");
  assert.equal(tsAdminOverview.clients[0].nickname, "Guest");
  assert.deepEqual(tsAdminOverview.clients[0].serverGroups, ["6", "7"]);
  await assert.rejects(api.tsAdminAction({ configurationRevision: tsAdminOverview.configurationRevision, operation: { action: "channel.delete", channelId: "0" } }), (error: any) => error.code === "INVALID_TS_ADMIN_ACTION");
  await assert.rejects(api.tsAdminAction({ configurationRevision: tsAdminOverview.configurationRevision, operation: { action: "client.kick", clientId: 42, clientUid: "stale", reason: "" } }), (error: any) => error.code === "TS_ADMIN_CLIENT_CHANGED");
  mismatchHostKey = true;
  await assert.rejects(api.tsAdminOverview(), (error: any) => error.code === "TS_ADMIN_HOST_KEY_MISMATCH");
  assert.equal((await api.overview()).gateway.version, "test-version", "WebSpeak management does not depend on TS management connectivity");
  assert.equal((await api.settings()).accessMode, "fixed");
  const settingsWithOpenMode = service.getAdminSettings();
  await api.saveSettings({ ...settingsWithOpenMode, accessMode: "open" });
  assert.equal((await api.tsAdminSettings()).fixedMode, false);
  assert.equal((await api.tsAdminSettings()).enabled, false, "switching to open mode disables the TeamSpeak admin panel");
  await assert.rejects(api.tsAdminOverview(), (error: any) => error.code === "TS_ADMIN_FIXED_MODE_REQUIRED");
  await assert.rejects(api.saveTsAdminSettings({ enabled: true, queryPort: 10022, username: "query-admin", hostKeyFingerprint: verifiedFingerprint }), (error: any) => error.code === "TS_ADMIN_FIXED_MODE_REQUIRED");
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
