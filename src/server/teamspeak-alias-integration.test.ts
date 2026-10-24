import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AdminService, type AdminSettingsInput } from "../admin/admin-service.js";
import { migrateConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { WebSpeakDatabase } from "../persistence/database.js";
import { JoinTicketStore } from "./join-ticket.js";
import { createWebServer } from "./server.js";

const noop = () => {};
const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
const settings = (target: string, accessMode: "open" | "fixed" = "open"): AdminSettingsInput => ({
  target, accessMode, siteName: "WebSpeak", welcomeText: "", webRtcEnabled: false,
  serverPassword: "stored-password", passwordAction: "replace",
});

test("settings, tests, invites, and join tickets resolve nicknames through the gateway", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-alias-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const service = new AdminService(database, Buffer.alloc(32, 1), logger, path.join(directory, "missing-config.json"), async (target) => {
    assert.deepEqual(target, { host: "8.8.8.8", port: 10000 });
    return { ok: true, protocol: "ts3", latencyMs: 1, serverName: "Test", requiresPassword: false };
  });
  await service.initialize();
  let lookupBody = "8.8.8.8:10000";
  let lookups = 0;
  const realFetch = globalThis.fetch;
  context.mock.method(globalThis, "fetch", ((input, options) => {
    if (new URL(String(input)).origin === "https://named.myteamspeak.com") {
      lookups += 1;
      return Promise.resolve(new Response(lookupBody));
    }
    return realFetch(input, options);
  }) as typeof fetch);
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const joinTickets = new JoinTicketStore();
  const server = createWebServer({ port, adminService: service, voiceBridgeOptions: { joinTickets }, logger });
  context.after(async () => {
    await server.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  await server.start();
  const join = async (input: Record<string, unknown>) => {
    const response = await realFetch(`${origin}/api/join-ticket`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ nickname: "Tester", ...input }),
    });
    const body = await response.json() as { code?: string; ticket?: string };
    return { status: response.status, code: body.code, payload: body.ticket ? joinTickets.consume(body.ticket) : null };
  };

  service.updateSettings(settings("team eco"));
  assert.equal(database.getSettings().tsTarget, "team eco");
  assert.equal(service.getPublicConfig().target, "team eco");
  assert.equal(service.getAdminSettings().target, "team eco");
  const publicConfig = await (await realFetch(`${origin}/api/public-config`)).json() as { target: string; targetPrefillBlocked: boolean };
  assert.equal(publicConfig.target, "team eco");
  assert.equal(publicConfig.targetPrefillBlocked, false);
  const first = await join({ target: "https://named.myteamspeak.com/lookup?name=team%20eco" });
  assert.equal(first.status, 201);
  assert.deepEqual(first.payload?.target, { host: "8.8.8.8", port: 10000 });
  assert.equal(first.payload?.serverPassword, "stored-password");
  assert.equal((await join({ target: "another guild" })).payload?.serverPassword, "");
  assert.equal((await join({ target: "another guild:9987" })).payload?.target.port, 9987);
  assert.equal((await service.testConnection("another guild", "", true)).ok, true);

  lookupBody = "1.1.1.1:10001";
  assert.deepEqual((await join({ target: "team eco" })).payload?.target, { host: "1.1.1.1", port: 10001 });
  lookupBody = "127.0.0.1:9987";
  const blockedConfig = await (await realFetch(`${origin}/api/public-config`)).json() as { target: string; targetPrefillBlocked: boolean };
  assert.equal(blockedConfig.target, "");
  assert.equal(blockedConfig.targetPrefillBlocked, true);
  assert.equal((await join({ target: "team eco" })).code, "TARGET_NOT_ALLOWED");
  assert.equal((await join({})).code, "TARGET_NOT_ALLOWED");

  service.updateSettings(settings("team eco", "fixed"));
  const fixed = await join({ target: "untrusted guild" });
  assert.equal(fixed.status, 201);
  assert.equal(fixed.payload?.target.host, "127.0.0.1");
  const invite = service.createManagedInvite({ channel: "Lobby", expiresInHours: 1, maxUses: 0 });
  assert.equal(invite.invite.target, "team eco");
  service.updateSettings(settings("different guild:9987"));
  lookupBody = "1.1.1.1:10001";
  const invited = await join({ invite: invite.token, target: "ignored target" });
  assert.equal(invited.status, 201);
  assert.deepEqual(invited.payload?.target, { host: "1.1.1.1", port: 10001 });
  assert.equal(invited.payload?.channel, "Lobby");
  assert.equal(invited.payload?.serverPassword, "stored-password");
  assert.equal(service.getConnectionPolicy().defaultTarget, "different guild:9987");

  service.updateSettings(settings("retry guild", "fixed"));
  const retryInvite = service.createManagedInvite({ channel: "Lobby", expiresInHours: 1, maxUses: 1 });
  lookupBody = "";
  assert.equal((await join({ invite: retryInvite.token })).code, "HOST_NOT_FOUND");
  assert.equal(service.listManagedInvites().find((item) => item.id === retryInvite.invite.id)?.useCount, 0);
  lookupBody = "1.1.1.1:10001";
  const retriedInvite = await join({ invite: retryInvite.token });
  assert.equal(retriedInvite.status, 201);
  assert.deepEqual(retriedInvite.payload?.target, { host: "1.1.1.1", port: 10001 });
  assert.equal(service.listManagedInvites().find((item) => item.id === retryInvite.invite.id)?.useCount, 1);

  lookupBody = "";
  assert.equal((await join({ target: "missing guild" })).code, "HOST_NOT_FOUND");
  await assert.rejects(service.testConnection("missing guild", "", true), { code: "HOST_NOT_FOUND" });
  assert.ok(lookups >= 9);
  assert.throws(() => service.updateSettings({ ...settings("guild"), relaySettingsAction: "replace", relayTarget: "team eco" }));

  service.updateSettings(settings("8.8.8.8#9988"));
  assert.equal(database.getSettings().tsTarget, null);
  const direct = await join({ target: "8.8.8.8:9988" });
  assert.deepEqual(direct.payload?.target, { host: "8.8.8.8", port: 9988 });
  assert.equal(direct.payload?.serverPassword, "stored-password");
});

test("schema 8 settings and invites survive the nickname migration", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-alias-migration-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "webspeak.db");
  const database = new WebSpeakDatabase(file);
  database.createManagedInvite({
    id: "legacy", tokenHash: "legacy-token", targetHost: "voice.example.com", targetPort: 9988,
    channel: "", expiresAt: new Date(Date.now() + 3600000).toISOString(), maxUses: 0, serverPasswordEncrypted: null,
  });
  database.close();
  const legacy = new DatabaseSync(file);
  legacy.exec("DROP TABLE ts_admin_settings; ALTER TABLE relay_nodes DROP COLUMN voice_endpoint; ALTER TABLE settings DROP COLUMN ts_target; ALTER TABLE managed_invites DROP COLUMN target_text; PRAGMA user_version = 8;");
  legacy.close();
  const migrated = new WebSpeakDatabase(file);
  try {
    assert.equal(migrated.schemaVersion, 12);
    assert.equal(migrated.getSettings().tsHost, "127.0.0.1");
    assert.equal(migrated.getSettings().tsTarget, null);
    const invite = migrated.consumeManagedInvite("legacy-token");
    assert.equal(invite?.targetHost, "voice.example.com");
    assert.equal(invite?.targetPort, 9988);
    assert.equal(invite?.targetText, null);
  } finally { migrated.close(); }
});

test("legacy config imports nicknames without silently replacing them with localhost", () => {
  assert.deepEqual(migrateConfig({ tsHost: "team eco" }), { tsHost: "team eco", tsPort: 9987, tsTarget: "team eco", tsServerPassword: "" });
  assert.equal(migrateConfig({ tsHost: "another guild", tsPort: 9988 }).tsTarget, "another guild:9988");
  assert.equal(migrateConfig({ tsHost: "abc:123" }).tsTarget, "abc:123");
  assert.equal(migrateConfig({ tsHost: "https://named.myteamspeak.com/lookup?name=team%20eco" }).tsTarget, "team eco");
  assert.equal(migrateConfig(migrateConfig({ tsHost: "team eco" })).tsTarget, "team eco");
  assert.equal(migrateConfig({ tsHost: "voice.example.com", tsPort: 9988 }).tsHost, "voice.example.com");
  assert.equal(migrateConfig({ tsHost: "::1", tsPort: 9988 }).tsHost, "::1");
});

async function availablePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}
