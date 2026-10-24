import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, type QueryClientOptions } from "@honeybbq/teamspeak/query";
import { WebSpeakDatabase } from "../persistence/database.js";
import { decryptSecret } from "../security/secret-crypto.js";
import type { TsAdminAction } from "../shared/admin-inputs.js";
import type { Logger } from "../logger.js";
import { TsAdminService } from "./ts-admin-service.js";
import { webQueryFetch } from "./webquery-fetch.js";

const uid = "a-real-voice-identity=";
const channel = { cid: "1", cpid: "0", channel_name: "Lobby", total_clients: "1", channel_flag_password: "0" };
const member = { clid: "42", client_database_id: "77", client_unique_identifier: uid, client_nickname: "Guest", cid: "1", client_type: "0", client_servergroups: "6,7" };
type Reply = { body: Record<string, string>[]; status: { code: number; message: string } };
const ok = (body: Reply["body"] = []): Reply => ({ body, status: { code: 0, message: "ok" } });
const denied = (): Reply => ({ body: [], status: { code: 2568, message: "insufficient permissions: secret-value-must-not-escape" } });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; }
const hasCode = (code: string) => (error: any) => error.code === code && error.message === code;

/** Real published QueryClient + WebQuery transport, with a disposable HTTP server. */
async function fixture(t: TestContext, family: "ts3" | "ts6" = "ts6") {
  const directory = mkdtempSync(join(tmpdir(), "webspeak-ts-admin-"));
  const database = new WebSpeakDatabase(join(directory, "test.sqlite"));
  const master = Buffer.alloc(32, 5), logs: unknown[] = [];
  const logger: Logger = { debug() {}, info() {}, error() {}, warn(...args: unknown[]) { logs.push(args); }, child() { return this; } };
  const policy = { mode: "fixed" as "fixed" | "open", target: "127.0.0.1:9987" };
  const calls: Array<{ path: string; command: string; params: Record<string, string>; key: string }> = [];
  const clients: QueryClient[] = [];
  const clientOptions: QueryClientOptions[] = [];
  let httpStatus = 200;
  let httpCommand: string | undefined;
  let jsonErrors = false;
  let reply: (command: string, params: Record<string, string>) => Reply | Promise<Reply> = command => {
    switch (command) {
      case "version": return ok([{ version: family === "ts3" ? "3.13.7" : "6.0.0-beta13" }]);
      case "whoami": return ok([{ client_id: "99" }]);
      case "serverinfo": return ok([{ virtualserver_name: "Test TeamSpeak", virtualserver_welcomemessage: "Welcome", virtualserver_maxclients: "32", virtualserver_uptime: "123" }]);
      case "channellist": return ok([channel]);
      case "clientlist": return ok([member]);
      case "servergrouplist": return ok([{ sgid: "6", name: "Member", type: "1" }, { sgid: "1", name: "Query template", type: "0" }]);
      case "banlist": return ok([{ banid: "8", uid, lastnickname: "Guest", reason: "Test", duration: "3600", created: "1700000000" }]);
      case "channelcreate": return ok([{ cid: "2" }]);
      case "banadd": return ok([{ banid: "9" }]);
      default: return ok();
    }
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const path = req.url!, command = path.split("/").at(-1)!;
    const params = JSON.parse(body || "{}");
    calls.push({ path, command, params, key: String(req.headers["x-api-key"]) });
    const answer = await reply(command, params);
    res.setHeader("content-type", "application/json");
    res.statusCode = httpCommand === undefined || httpCommand === command ? httpStatus : 200;
    res.end(res.statusCode === 200 || jsonErrors ? JSON.stringify(answer) : "Access denied");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const service = new TsAdminService(database, master, logger, () => policy, options => {
    clientOptions.push(options);
    const client = new QueryClient(options); clients.push(client); return client;
  });
  const settings = { enabled: true, transport: "web" as const, queryPort: 10022, queryHost: "", username: "", hostKeyFingerprint: "",
    webQueryUrl: `http://127.0.0.1:${address.port}/query`, serverId: 7, apiKey: "secret-local-fixture-api-key", apiKeyAction: "replace" as const };
  service.save(settings);
  t.after(async () => {
    await Promise.all(clients.map(client => client.disconnect()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    database.close(); rmSync(directory, { recursive: true, force: true });
  });
  return { service, database, master, settings, calls, policy, logs, clientOptions,
    action: (operation: unknown) => service.action({ operation, configurationRevision: service.settings().configurationRevision }),
    set httpStatus(value: number) { httpStatus = value; },
    set httpCommand(value: string) { httpCommand = value; },
    set jsonErrors(value: boolean) { jsonErrors = value; },
    get reply() { return reply; }, set reply(value) { reply = value; } };
}

for (const family of ["ts3", "ts6"] as const) test(`WebQuery ${family} selects the virtual server, parses typed data and sends no login or notifications`, async t => {
  const f = await fixture(t, family);
  const result = await f.service.overview();
  assert.equal(result.serverFamily, family); assert.equal(result.serverName, "Test TeamSpeak");
  assert.equal(result.welcomeMessage, "Welcome"); assert.equal(result.maxClients, 32);
  assert.equal(result.channels[0].id, "1"); assert.equal(result.clients[0].uid, uid);
  assert.deepEqual(result.groups, [{ id: "6", name: "Member" }]);
  assert.equal(result.bans[0].durationSeconds, 3600);
  assert.ok(f.calls.every(call => call.path.startsWith("/query/7/") && call.key === f.settings.apiKey));
  assert.ok(!f.calls.some(call => /login|notify|clientupdate/.test(call.command)));
  assert.equal(f.clientOptions[0].events, undefined, "WebQuery rejects even an explicit events:false option");
  assert.equal(f.clientOptions[0].reconnect, undefined);
  f.service.save({ ...f.settings, serverId: 0, apiKeyAction: "keep", apiKey: undefined });
  f.calls.length = 0;
  await f.service.overview();
  assert.ok(f.calls.every(call => call.path.startsWith("/query/byport/9987/")));
});

test("Query credentials are encrypted separately, projected out, and keep/remove is explicit", async t => {
  const f = await fixture(t);
  f.service.save({ ...f.settings, passwordAction: "replace", password: "local-query-password" });
  const stored = f.database.getTsAdminSettings();
  assert.notEqual(stored.apiKeyEncrypted, f.settings.apiKey);
  assert.equal(decryptSecret(stored.apiKeyEncrypted, f.master, "webspeak:ts-admin-webquery-api-key:v1"), f.settings.apiKey);
  assert.equal(decryptSecret(stored.passwordEncrypted, f.master, "webspeak:ts-admin-query-password:v1"), "local-query-password");
  assert.throws(() => decryptSecret(stored.apiKeyEncrypted, f.master, "webspeak:ts-admin-query-password:v1"));
  const shown = f.service.settings();
  assert.equal(shown.hasApiKey, true); assert.equal(shown.hasPassword, true);
  assert.ok(!("apiKeyEncrypted" in shown) && !("passwordEncrypted" in shown));
  f.service.save({ ...f.settings, apiKey: "ignored", apiKeyAction: "keep" });
  assert.equal(f.database.getTsAdminSettings().apiKeyEncrypted, stored.apiKeyEncrypted);
  assert.throws(() => f.service.save({ ...f.settings, apiKeyAction: "remove" }), hasCode("INVALID_TS_ADMIN_API_KEY"));
  assert.equal(f.database.getTsAdminSettings().apiKeyEncrypted, stored.apiKeyEncrypted, "invalid settings must be atomic");
  f.service.save({ ...f.settings, enabled: false, apiKeyAction: "remove", passwordAction: "remove" });
  assert.equal(f.service.settings().hasApiKey, false);
  assert.equal(f.service.settings().hasPassword, false);
  await assert.rejects(f.service.overview(), hasCode("TS_ADMIN_NOT_CONFIGURED"));
  assert.equal(f.calls.length, 0);
});

test("invalid endpoints and selectors are rejected without changing stored settings", async t => {
  const f = await fixture(t), stored = f.database.getTsAdminSettings();
  for (const webQueryUrl of ["file:///etc/passwd", "https://user:password@example.com", "https://example.com?api_key=secret", "https://example.com/#fragment", "no-url"]) {
    assert.throws(() => f.service.save({ ...f.settings, webQueryUrl }), hasCode("INVALID_TS_ADMIN_URL"));
  }
  for (const serverId of [-1, 1.2, 4_294_967_296]) assert.throws(() => f.service.save({ ...f.settings, serverId }), hasCode("INVALID_TS_ADMIN_SERVER_ID"));
  assert.throws(() => f.service.save({ ...f.settings, queryHost: "host:10022" }), hasCode("INVALID_TS_ADMIN_HOST"));
  assert.deepEqual(f.database.getTsAdminSettings(), stored);
  f.policy.mode = "open";
  assert.throws(() => f.service.save(f.settings), hasCode("TS_ADMIN_FIXED_MODE_REQUIRED"));
  await assert.rejects(f.service.overview(), hasCode("TS_ADMIN_FIXED_MODE_REQUIRED"));
});

test("limited list permissions preserve the rest of the overview and error details stay private", async t => {
  const f = await fixture(t), original = f.reply;
  f.reply = (command, params) => ["servergrouplist", "banlist"].includes(command) ? denied() : original(command, params);
  const result = await f.service.overview();
  assert.equal(result.groupsAvailable, false); assert.equal(result.bansAvailable, false);
  assert.equal(result.groupsErrorCode, "TS_ADMIN_PERMISSION_DENIED"); assert.equal(result.bansErrorCode, "TS_ADMIN_PERMISSION_DENIED");
  assert.equal(result.channels.length, 1); assert.equal(result.clients.length, 1);
  f.reply = (command, params) => command === "serverinfo" ? denied() : original(command, params);
  await assert.rejects(f.service.overview(), hasCode("TS_ADMIN_PERMISSION_DENIED"));
  assert.ok(!JSON.stringify(f.logs).includes("secret-value-must-not-escape"));
  assert.ok(!JSON.stringify(f.logs).includes(f.settings.apiKey));
});

test("Query connections never appear in member lists or channel and server member counts", async t => {
  const f = await fixture(t), original = f.reply;
  f.reply = (command, params) => {
    if (command === "clientlist") return ok([member, { ...member, clid: "99", client_type: "1", client_nickname: "serveradmin" }]);
    if (command === "channellist") return ok([{ ...channel, total_clients: "2" }, { ...channel, cid: "2", channel_name: "Empty" }]);
    return original(command, params);
  };
  const result = await f.service.overview();
  assert.equal(result.clientCount, 1); assert.deepEqual(result.clients.map(entry => entry.id), [42]);
  assert.deepEqual(result.channels.map(entry => entry.totalClients), [1, 0]);
  f.reply = (command, params) => command === "clientlist" ? ok([{ ...member, clid: "99", client_type: "1" }]) : original(command, params);
  const empty = await f.service.overview();
  assert.equal(empty.clientCount, 0); assert.deepEqual(empty.clients, []); assert.equal(empty.channels[0].totalClients, 0);
});

for (const [code, expected] of [[524, "TS_ADMIN_RATE_LIMITED"], [2568, "TS_ADMIN_PERMISSION_DENIED"], [1538, "TS_ADMIN_READ_FAILED"]] as const) {
  test(`optional list error ${code} retains its cause rather than inventing a permission failure`, async t => {
    const f = await fixture(t), original = f.reply;
    f.reply = (command, params) => command === "servergrouplist" ? { body: [], status: { code, message: "private-error-detail" } } : original(command, params);
    const result = await f.service.overview();
    assert.equal(result.groupsAvailable, false); assert.equal(result.groupsErrorCode, expected);
    assert.equal(result.bansAvailable, true); assert.equal(result.bansErrorCode, null);
    assert.equal(result.clients.length, 1); assert.ok(!JSON.stringify(result).includes("private-error-detail"));
  });
}

for (const state of ["disconnected", "reused-id"] as const) test(`a successful UID ban with ${state} does not kick another connection or report partial failure`, async t => {
  const f = await fixture(t), original = f.reply;
  let banned = false;
  f.reply = (command, params) => {
    if (command === "banadd") banned = true;
    if (command === "clientlist" && banned) return ok(state === "disconnected" ? [] : [{ ...member, client_unique_identifier: "replacement-identity=" }]);
    return original(command, params);
  };
  assert.deepEqual(await f.action({ action: "client.ban", clientId: 42, clientUid: uid, reason: "UID only", durationSeconds: 120 }), { ok: true });
  assert.equal(f.calls.filter(call => call.command === "banadd").length, 1);
  assert.ok(!f.calls.some(call => call.command === "clientkick"));
  assert.ok(!f.database.recentAudit(50).some(entry => entry.event === "TS_ADMIN_ACTION_PARTIAL"));
});

test("a banned client leaving between the fresh identity check and kick is successful", async t => {
  const f = await fixture(t), original = f.reply;
  f.reply = (command, params) => command === "clientkick" ? { body: [], status: { code: 512, message: "invalid clientID" } } : original(command, params);
  assert.deepEqual(await f.action({ action: "client.ban", clientId: 42, clientUid: uid, reason: "UID only", durationSeconds: 120 }), { ok: true });
  assert.equal(f.calls.filter(call => call.command === "clientkick").length, 1);
});

for (const [status, expected] of [[429, "TS_ADMIN_RATE_LIMITED"], [408, "TS_ADMIN_TIMEOUT"], [504, "TS_ADMIN_TIMEOUT"]] as const) test(`HTTP ${status} has a specific safe Query failure`, async t => {
  const f = await fixture(t);
  f.httpStatus = status;
  await assert.rejects(f.service.overview(), hasCode(expected));
});

for (const [status, expected] of [[429, "TS_ADMIN_RATE_LIMITED"], [503, "TS_ADMIN_READ_FAILED"]] as const) test(`HTTP ${status} cannot become a successful list through a JSON status.code=0 body`, async t => {
  const f = await fixture(t);
  f.httpStatus = status; f.httpCommand = "servergrouplist"; f.jsonErrors = true;
  const result = await f.service.overview();
  assert.equal(result.groupsAvailable, false); assert.equal(result.groupsErrorCode, expected);
  assert.equal(result.bansAvailable, true); assert.equal(result.clientCount, 1);
});

test("HTTP errors carrying genuine TS permission errors keep the SDK error classification", async t => {
  const f = await fixture(t), original = f.reply;
  f.httpStatus = 403; f.httpCommand = "servergrouplist"; f.jsonErrors = true;
  f.reply = (command, params) => command === "servergrouplist" ? denied() : original(command, params);
  const result = await f.service.overview();
  assert.equal(result.groupsErrorCode, "TS_ADMIN_PERMISSION_DENIED");
});

test("administrator actions use typed SDK commands, escaping and UID-only bans", async t => {
  const f = await fixture(t);
  const actions: TsAdminAction[] = [
    { action: "server.update", name: "A | name", welcomeMessage: "Hello\nworld", maxClients: 48 },
    { action: "channel.create", name: "Channel | special", parentId: "1", description: "Line1\nLine2", permanent: true, password: "test password" },
    { action: "channel.update", channelId: "2", name: "New name" },
    { action: "channel.delete", channelId: "2" },
    { action: "client.move", clientId: 42, clientUid: uid, channelId: "1" },
    { action: "client.kick", clientId: 42, clientUid: uid, reason: "Test reason" },
    { action: "client.group", clientId: 42, clientUid: uid, groupId: "6", remove: false },
    { action: "client.group", clientId: 42, clientUid: uid, groupId: "6", remove: true },
    { action: "client.ban", clientId: 42, clientUid: uid, reason: "UID ban", durationSeconds: 3600 },
    { action: "ban.delete", banId: "9" },
  ];
  for (const action of actions) assert.deepEqual(await f.action(action), { ok: true });
  const command = (name: string) => f.calls.find(call => call.command === name)!.params;
  assert.deepEqual(command("serveredit"), { virtualserver_name: "A | name", virtualserver_welcomemessage: "Hello\nworld", virtualserver_maxclients: "48" });
  assert.equal(command("channelcreate").channel_description, "Line1\nLine2");
  assert.equal(command("channelcreate").channel_password, "test password");
  assert.deepEqual(command("channeledit"), { cid: "2", channel_name: "New name" }, "rename must preserve unread channel metadata");
  assert.equal(command("channeldelete").force, "0");
  assert.deepEqual(command("clientmove"), { clid: "42", cid: "1" });
  assert.equal(command("clientkick").reasonid, "5");
  assert.deepEqual(command("servergroupaddclient"), { sgid: "6", cldbid: "77" });
  assert.deepEqual(command("servergroupdelclient"), { sgid: "6", cldbid: "77" });
  assert.deepEqual(command("banadd"), { uid, time: "3600", banreason: "UID ban" });
  assert.equal(command("bandel").banid, "9");
});

test("stale client identities never receive a mutation, and failed writes are not retried", async t => {
  const f = await fixture(t), original = f.reply;
  f.reply = (command, params) => command === "clientlist" ? ok([{ ...member, client_unique_identifier: "replacement-identity=" }]) : original(command, params);
  await assert.rejects(f.action({ action: "client.kick", clientId: 42, clientUid: uid, reason: "" }), hasCode("TS_ADMIN_CLIENT_CHANGED"));
  assert.ok(!f.calls.some(call => call.command === "clientkick"));
  f.reply = (command, params) => command === "clientkick" ? denied() : original(command, params);
  await assert.rejects(f.action({ action: "client.kick", clientId: 42, clientUid: uid, reason: "" }), hasCode("TS_ADMIN_PERMISSION_DENIED"));
  assert.equal(f.calls.filter(call => call.command === "clientkick").length, 1);
  await assert.rejects(f.action({ action: "client.ban", clientId: 42, clientUid: uid, reason: "", durationSeconds: 0 }), hasCode("TS_ADMIN_PARTIAL_SUCCESS"));
  assert.equal(f.calls.filter(call => call.command === "banadd").length, 1);
  assert.equal(f.calls.find(call => call.command === "banadd")!.params.time, undefined, "permanent UID ban has no expiry");
});

test("configuration changes cancel in-flight and queued writes instead of targeting another server", async t => {
  const f = await fixture(t), original = f.reply, entered = deferred(), release = deferred();
  f.reply = async (command, params) => {
    if (command === "clientlist") { entered.resolve(); await release.promise; }
    return original(command, params);
  };
  const first = f.action({ action: "client.kick", clientId: 42, clientUid: uid, reason: "" });
  const queued = f.action({ action: "channel.delete", channelId: "1" });
  const firstCheck = assert.rejects(first, hasCode("TS_ADMIN_CONFIG_CHANGED"));
  const queuedCheck = assert.rejects(queued, hasCode("TS_ADMIN_CONFIG_CHANGED"));
  await entered.promise;
  f.service.save({ ...f.settings, serverId: 8 });
  release.resolve();
  await Promise.all([firstCheck, queuedCheck]);
  assert.ok(!f.calls.some(call => ["clientkick", "channeldelete"].includes(call.command)));
  assert.ok(f.calls.every(call => call.path.startsWith("/query/7/")));
  f.reply = original;
  assert.deepEqual(await f.action({ action: "channel.delete", channelId: "2" }), { ok: true }, "failed queue entries must not block later work");
});

test("an old browser snapshot cannot mutate a newly configured management server", async t => {
  const f = await fixture(t);
  const snapshot = await f.service.overview();
  const operation: TsAdminAction = { action: "channel.delete", channelId: "1" };
  f.service.save({ ...f.settings, serverId: 8 });
  f.calls.length = 0;
  assert.throws(() => f.service.action({ operation, configurationRevision: snapshot.configurationRevision }), hasCode("TS_ADMIN_CONFIG_CHANGED"));
  assert.throws(() => f.service.action({ operation }), hasCode("TS_ADMIN_CONFIG_CHANGED"));
  assert.equal(f.calls.length, 0, "stale UI must fail before connecting to the new server");
});

test("administrator command whitelist rejects arbitrary commands and invalid object identifiers", async t => {
  const f = await fixture(t);
  for (const action of [null, [], { action: "serverstop" }, { action: "channel.delete", channelId: "0" },
    { action: "channel.delete", channelId: "1|serverstop" }, { action: "channel.delete", channelId: "18446744073709551616" },
    { action: "client.kick", clientId: 42, clientUid: "", reason: "" },
    { action: "client.ban", clientId: 42, clientUid: uid, reason: "", durationSeconds: -1 },
    { action: "server.update", name: "", welcomeMessage: "", maxClients: 32 },
  ]) assert.throws(() => f.action(action), hasCode("INVALID_TS_ADMIN_ACTION"));
  assert.equal(f.calls.length, 0);
});

test("WebQuery HTTP and TS API-key authentication failures have a useful safe error", async t => {
  const f = await fixture(t);
  for (const status of [401, 403]) {
    f.httpStatus = status;
    await assert.rejects(f.service.overview(), hasCode("TS_ADMIN_AUTH_FAILED"));
  }
  f.httpStatus = 200;
  f.reply = () => ({ body: [], status: { code: 5122, message: "invalid API key: secret-value-must-not-escape" } });
  await assert.rejects(f.service.overview(), hasCode("TS_ADMIN_AUTH_FAILED"));
  assert.ok(!JSON.stringify(f.logs).includes("secret-value-must-not-escape"));
});

test("disposing an administrator request cancels its underlying WebQuery HTTP request", async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), controller = new AbortController();
  f.reply = async () => { entered.resolve(); await release.promise; return ok(); };
  const pending = webQueryFetch(controller.signal)(`${f.settings.webQueryUrl}/7/version`, { method: "POST", body: "{}" });
  const check = assert.rejects(pending, (error: any) => error.name === "AbortError");
  await entered.promise;
  controller.abort(); await check;
  release.resolve();
});
