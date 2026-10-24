import { isIP } from "node:net";
import { createHash } from "node:crypto";
import {
  addBan, addClientToServerGroup, asBanID, asChannelID, asClientID, asServerGroupID,
  createChannel, deleteBan, deleteChannel, editChannel, editServer, getServerInfo, kickClient,
  listBans, listChannels, listClients, listServerGroups, moveClient, Reason,
  removeClientFromServerGroup, ServerError, type CommandOptions,
} from "@honeybbq/teamspeak";
import { QueryClient, WebQueryHttpError, type QueryClientOptions } from "@honeybbq/teamspeak/query";
import type { Logger } from "../logger.js";
import { WebSpeakDatabase } from "../persistence/database.js";
import { encryptSecret, decryptSecret } from "../security/secret-crypto.js";
import type { TsAdminAction, TsAdminSettingsInput } from "../shared/admin-inputs.js";
import { resolveTeamSpeakTarget } from "../server/teamspeak-alias.js";
import { AdminInputError } from "./admin-errors.js";
import { webQueryFetch } from "./webquery-fetch.js";

const PASSWORD_PURPOSE = "webspeak:ts-admin-query-password:v1";
const API_KEY_PURPOSE = "webspeak:ts-admin-webquery-api-key:v1";
export type TsAdminQueryClientFactory = (options: QueryClientOptions) => QueryClient;
type Policy = { mode: "fixed" | "open"; target: string };

/** Optional administrator access. Guest voice and WebSpeak management never use these credentials. */
export class TsAdminService {
  private actions: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly database: WebSpeakDatabase,
    private readonly masterSecret: Buffer,
    private readonly logger: Logger,
    private readonly policy: () => Policy,
    private readonly createClient: TsAdminQueryClientFactory = options => new QueryClient(options),
  ) {}

  settings() {
    const { passwordEncrypted, apiKeyEncrypted, ...settings } = this.database.getTsAdminSettings();
    return { ...settings, configurationRevision: this.configuration(), fixedMode: this.policy().mode === "fixed", hasPassword: Boolean(passwordEncrypted), hasApiKey: Boolean(apiKeyEncrypted) };
  }

  save(input: TsAdminSettingsInput): void {
    this.assertFixed();
    const current = this.database.getTsAdminSettings();
    const transport = input.transport ?? current.transport;
    if (!["web", "ssh", "tcp"].includes(transport) || typeof input.enabled !== "boolean") fail("INVALID_TS_ADMIN_SETTINGS");
    const queryPort = input.queryPort;
    if (!Number.isInteger(queryPort) || queryPort < 1 || queryPort > 65535) fail("INVALID_TS_ADMIN_QUERY_PORT");
    const username = text(input.username, 128).trim();
    const hostKeyFingerprint = text(input.hostKeyFingerprint, 128).trim();
    const queryHost = text(input.queryHost ?? current.queryHost, 253).trim();
    if (queryHost && !isIP(queryHost) && !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(queryHost)) fail("INVALID_TS_ADMIN_HOST");
    let webQueryUrl = text(input.webQueryUrl ?? current.webQueryUrl, 2048).trim();
    if (webQueryUrl) {
      try {
        const url = new URL(webQueryUrl);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
        webQueryUrl = url.toString().replace(/\/+$/, "");
      } catch { fail("INVALID_TS_ADMIN_URL"); }
    }
    const serverId = input.serverId ?? current.serverId;
    if (!Number.isSafeInteger(serverId) || serverId < 0 || serverId > 4_294_967_295) fail("INVALID_TS_ADMIN_SERVER_ID");
    const passwordEncrypted = this.secret(input.password, input.passwordAction, current.passwordEncrypted, PASSWORD_PURPOSE, 1024);
    const apiKeyEncrypted = this.secret(input.apiKey, input.apiKeyAction, current.apiKeyEncrypted, API_KEY_PURPOSE, 4096);
    if (input.enabled) {
      if (transport === "web") {
        if (!webQueryUrl) fail("INVALID_TS_ADMIN_URL");
        if (!apiKeyEncrypted) fail("INVALID_TS_ADMIN_API_KEY");
      } else {
        if (!username) fail("INVALID_TS_ADMIN_USERNAME");
        if (!passwordEncrypted) fail("INVALID_TS_ADMIN_PASSWORD");
        if (transport === "ssh" && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(hostKeyFingerprint)) fail("INVALID_TS_ADMIN_HOST_KEY");
      }
    }
    this.database.updateTsAdminSettings({ enabled: input.enabled, transport, queryHost, queryPort, username,
      passwordEncrypted, apiKeyEncrypted, webQueryUrl, serverId, hostKeyFingerprint });
  }

  async overview() {
    return this.withClient(async (client, options, assertCurrent) => {
      const [server, channels, clients] = await Promise.all([
        getServerInfo(client, options), listChannels(client, options),
        listClients(client, { ...options, uid: true, away: true, voice: true, groups: true }),
      ]);
      const [groups, bans] = await Promise.allSettled([listServerGroups(client, options), listBans(client, options)]);
      assertCurrent();
      this.database.addAudit("TS_ADMIN_OVERVIEW_READ", { channels: channels.length, clients: clients.length });
      return {
        configurationRevision: this.configuration(),
        serverName: server.virtualserver_name ?? "", serverVersion: client.serverVersion, serverFamily: client.serverFamily,
        welcomeMessage: server.virtualserver_welcomemessage ?? "", maxClients: numeric(server.virtualserver_maxclients),
        uptimeSeconds: numeric(server.virtualserver_uptime), channelCount: channels.length, clientCount: clients.length,
        channels: channels.map(channel => ({ id: String(channel.id), parentID: String(channel.parentID), name: channel.name,
          description: channel.description, totalClients: channel.totalClients ?? 0, hasPassword: channel.hasPassword })),
        clients: clients.map(entry => ({ id: Number(entry.id), uid: entry.uid, nickname: entry.nickname, channelID: String(entry.channelID),
          serverGroups: entry.serverGroups.map(String), away: entry.isAway, inputMuted: entry.isInputMuted ?? false, outputMuted: entry.isOutputMuted ?? false })),
        groups: groups.status === "fulfilled" ? groups.value.filter(group => group.type === 1).map(group => ({ id: String(group.id), name: group.name })) : [],
        bans: bans.status === "fulfilled" ? bans.value.map(ban => ({ id: String(ban.id), name: ban.name || ban.lastNickname,
          uid: ban.uid, reason: ban.reason, durationSeconds: ban.durationMs / 1000, createdAt: ban.createdAt?.toISOString() ?? null })) : [],
        groupsAvailable: groups.status === "fulfilled", bansAvailable: bans.status === "fulfilled",
        observedAt: new Date().toISOString(),
      };
    });
  }

  /** Serialize writes, then revalidate live client identities immediately before changing them. */
  action(raw: unknown): Promise<{ ok: true }> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("INVALID_TS_ADMIN_ACTION");
    const request = raw as Record<string, unknown>;
    const action = readAction(request.operation);
    // Bind queued work to the configuration the administrator reviewed.
    const expected = this.configuration();
    if (request.configurationRevision !== expected) fail("TS_ADMIN_CONFIG_CHANGED");
    const operation = this.actions.then(() => this.withClient(async (client, options, assertCurrent) => {
      assertCurrent();
      switch (action.action) {
        case "server.update":
          await editServer(client, { virtualserver_name: action.name, virtualserver_welcomemessage: action.welcomeMessage,
            virtualserver_maxclients: String(action.maxClients) }, options); break;
        case "channel.create":
          await createChannel(client, { name: action.name, parentID: asChannelID(BigInt(action.parentId)),
            description: action.description, isPermanent: action.permanent, password: action.password }, options); break;
        case "channel.update":
          await editChannel(client, asChannelID(BigInt(action.channelId)), { name: action.name }, options); break;
        case "channel.delete":
          await deleteChannel(client, asChannelID(BigInt(action.channelId)), { ...options, force: false }); break;
        case "ban.delete":
          await deleteBan(client, asBanID(BigInt(action.banId)), options); break;
        default: {
          const current = (await listClients(client, { ...options, uid: true, groups: true })).find(entry => Number(entry.id) === action.clientId);
          if (!current || !current.uid || current.uid !== action.clientUid || current.type !== 0) fail("TS_ADMIN_CLIENT_CHANGED");
          assertCurrent();
          if (action.action === "client.move") await moveClient(client, current.id, asChannelID(BigInt(action.channelId)), options);
          else if (action.action === "client.kick") await kickClient(client, current.id, Reason.KickServer, { ...options, reasonMessage: action.reason });
          else if (action.action === "client.group") {
            if (!current.databaseID) fail("TS_ADMIN_CLIENT_CHANGED");
            const change = action.remove ? removeClientFromServerGroup : addClientToServerGroup;
            await change(client, asServerGroupID(BigInt(action.groupId)), current.databaseID, options);
          } else {
            // Banning the gateway's IP would disconnect unrelated WebSpeak users.
            await addBan(client, { uid: current.uid, reason: action.reason, durationMs: action.durationSeconds * 1000 }, options);
            try { assertCurrent(); await kickClient(client, current.id, Reason.KickServer, { ...options, reasonMessage: action.reason }); }
            catch { this.database.addAudit("TS_ADMIN_ACTION_PARTIAL", { action: action.action }); fail("TS_ADMIN_PARTIAL_SUCCESS"); }
          }
        }
      }
      this.database.addAudit("TS_ADMIN_ACTION_SUCCEEDED", { action: action.action });
      return { ok: true as const };
    }, expected)).catch(error => {
      this.database.addAudit("TS_ADMIN_ACTION_FAILED", { action: action.action });
      throw error;
    });
    this.actions = operation.catch(() => undefined);
    return operation;
  }

  private configuration(): string {
    return createHash("sha256").update(JSON.stringify([this.policy(), this.database.getTsAdminSettings()])).digest("hex");
  }

  private async withClient<T>(run: (client: QueryClient, options: CommandOptions, assertCurrent: () => void) => Promise<T>, expected?: string): Promise<T> {
    this.assertFixed();
    if (expected !== undefined && this.configuration() !== expected) fail("TS_ADMIN_CONFIG_CHANGED");
    const settings = this.database.getTsAdminSettings();
    if (!settings.enabled) fail("TS_ADMIN_NOT_CONFIGURED");
    const policy = this.policy();
    const captured = JSON.stringify(settings);
    const assertCurrent = () => {
      this.assertFixed();
      if (this.policy().target !== policy.target || JSON.stringify(this.database.getTsAdminSettings()) !== captured) fail("TS_ADMIN_CONFIG_CHANGED");
    };
    let target: { host: string; port: number } | undefined;
    if (!settings.serverId || settings.transport !== "web" && !settings.queryHost) {
      try { target = await resolveTeamSpeakTarget(policy.target); } catch { fail("TS_ADMIN_TARGET_UNAVAILABLE"); }
    }
    const lifetime = new AbortController();
    let transport: QueryClientOptions["transport"];
    if (settings.transport === "web") {
      if (!settings.webQueryUrl || !settings.apiKeyEncrypted) fail("TS_ADMIN_NOT_CONFIGURED");
      transport = { kind: "web", url: settings.webQueryUrl, apiKey: this.decrypt(settings.apiKeyEncrypted, API_KEY_PURPOSE), fetch: webQueryFetch(lifetime.signal) };
    } else {
      if (!settings.passwordEncrypted || !settings.username) fail("TS_ADMIN_NOT_CONFIGURED");
      const host = settings.queryHost || target!.host;
      const password = this.decrypt(settings.passwordEncrypted, PASSWORD_PURPOSE);
      transport = settings.transport === "tcp"
        ? { kind: "tcp", host, port: settings.queryPort, login: { name: settings.username, password } }
        : { kind: "ssh", host, port: settings.queryPort, username: settings.username, password, hostKey: key => {
            if (key.fingerprint !== settings.hostKeyFingerprint) fail("TS_ADMIN_HOST_KEY_MISMATCH");
          } };
    }
    assertCurrent();
    let client: QueryClient | undefined;
    let connected = false;
    try {
      client = this.createClient({ transport, server: settings.serverId ? { id: settings.serverId } : { port: target!.port },
        nickname: "WebSpeak Admin", ...(settings.transport === "web" ? {} : { events: false }) });
      const signal = AbortSignal.timeout(20_000);
      await client.connect({ signal }); connected = true; assertCurrent();
      return await run(client, { signal, timeoutMs: 8_000 }, assertCurrent);
    } catch (error) {
      if (error instanceof AdminInputError) throw error;
      const code = classifyError(error, connected ? "TS_ADMIN_OPERATION_FAILED" : "TS_ADMIN_CONNECTION_FAILED");
      this.logger.warn({ code, transport: settings.transport }, "TeamSpeak administrator request failed");
      return fail(code);
    } finally {
      lifetime.abort();
      try { await client?.disconnect(); } catch { /* no connection can outlive its request */ }
    }
  }

  private assertFixed(): void { if (this.policy().mode !== "fixed") fail("TS_ADMIN_FIXED_MODE_REQUIRED"); }
  private decrypt(value: string, purpose: string): string {
    try { return decryptSecret(value, this.masterSecret, purpose); } catch { fail("TS_ADMIN_CREDENTIALS_UNAVAILABLE"); }
  }
  private secret(value: string | undefined, action: "keep" | "replace" | "remove" | undefined, current: string | null, purpose: string, max: number): string | null {
    if (action === "remove") return null;
    if (action === "replace" || action === undefined && value !== undefined) {
      const secret = text(value ?? "", max);
      return secret ? encryptSecret(secret, this.masterSecret, purpose) : null;
    }
    if (action !== undefined && action !== "keep") fail("INVALID_TS_ADMIN_SETTINGS");
    return current;
  }
}

function fail(code: string): never { throw new AdminInputError(code, code); }
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || /[\0]/.test(value) || required && !value.trim()) fail("INVALID_TS_ADMIN_ACTION");
  return value;
}
function numeric(value: string | undefined): number { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }
function id(value: unknown, zero = false): string {
  const v = text(value, 20, true);
  if (!/^\d+$/.test(v) || BigInt(v) > 18_446_744_073_709_551_615n || !zero && BigInt(v) === 0n) fail("INVALID_TS_ADMIN_ACTION");
  return v;
}
function readAction(raw: unknown): TsAdminAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("INVALID_TS_ADMIN_ACTION");
  const r = raw as Record<string, unknown>;
  const action = r.action;
  if (action === "server.update") {
    if (!Number.isInteger(r.maxClients) || Number(r.maxClients) < 1 || Number(r.maxClients) > 65535) fail("INVALID_TS_ADMIN_ACTION");
    return { action, name: text(r.name, 64, true), welcomeMessage: text(r.welcomeMessage, 4096), maxClients: Number(r.maxClients) };
  }
  if (action === "channel.create") {
    if (typeof r.permanent !== "boolean") fail("INVALID_TS_ADMIN_ACTION");
    return { action, name: text(r.name, 40, true), parentId: id(r.parentId, true), description: text(r.description, 8192),
      permanent: r.permanent, ...(r.password === undefined ? {} : { password: text(r.password, 512) }) };
  }
  if (action === "channel.update") return { action, channelId: id(r.channelId), name: text(r.name, 40, true) };
  if (action === "channel.delete") return { action, channelId: id(r.channelId) };
  if (action === "ban.delete") return { action, banId: id(r.banId) };
  if (!Number.isInteger(r.clientId) || Number(r.clientId) < 1 || Number(r.clientId) > 65535) fail("INVALID_TS_ADMIN_ACTION");
  const member = { clientId: Number(r.clientId), clientUid: text(r.clientUid, 128, true) };
  if (action === "client.move") return { action, ...member, channelId: id(r.channelId) };
  if (action === "client.kick") return { action, ...member, reason: text(r.reason, 200) };
  if (action === "client.group") {
    if (typeof r.remove !== "boolean") fail("INVALID_TS_ADMIN_ACTION");
    return { action, ...member, groupId: id(r.groupId), remove: r.remove };
  }
  if (action === "client.ban") {
    if (!Number.isSafeInteger(r.durationSeconds) || Number(r.durationSeconds) < 0 || Number(r.durationSeconds) > 31_536_000) fail("INVALID_TS_ADMIN_ACTION");
    return { action, ...member, reason: text(r.reason, 200), durationSeconds: Number(r.durationSeconds) };
  }
  fail("INVALID_TS_ADMIN_ACTION");
}
function classifyError(error: unknown, fallback: string): string {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    if (error.message === "TS_ADMIN_HOST_KEY_MISMATCH") return error.message;
    if (error instanceof WebQueryHttpError && [401, 403].includes(error.status)) return "TS_ADMIN_AUTH_FAILED";
    if (error instanceof ServerError) {
      if ([2568, 2569, 2570, 5120].includes(error.code)) return "TS_ADMIN_PERMISSION_DENIED";
      if ([520, 5122, 5124].includes(error.code)) return "TS_ADMIN_AUTH_FAILED";
      if (error.code === 524) return "TS_ADMIN_RATE_LIMITED";
    }
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(String((error as NodeJS.ErrnoException).code ?? ""))) return "TS_ADMIN_TLS_FAILED";
    error = error.cause;
  }
  return fallback;
}
