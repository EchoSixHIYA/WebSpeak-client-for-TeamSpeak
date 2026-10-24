/** Runtime-checked browser projections of the administration API. */
export type AdminResponseReader<T> = (value: unknown) => T;
type Reader = AdminResponseReader<unknown>;

function invalid(): never { throw new Error("INVALID_ADMIN_RESPONSE"); }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
const text: AdminResponseReader<string> = value => typeof value === "string" ? value : invalid();
const number: AdminResponseReader<number> = value => typeof value === "number" && Number.isFinite(value) ? value : invalid();
const boolean: AdminResponseReader<boolean> = value => typeof value === "boolean" ? value : invalid();
const nonempty: AdminResponseReader<string> = value => text(value).length > 0 ? text(value) : invalid();
const nullable = <T>(read: AdminResponseReader<T>): AdminResponseReader<T | null> => value => value === null ? null : read(value);
const optional = <T>(read: AdminResponseReader<T>): AdminResponseReader<T | undefined> => value => value === undefined ? undefined : read(value);
const array = <T>(read: AdminResponseReader<T>): AdminResponseReader<T[]> => value => Array.isArray(value) ? value.map(read) : invalid();
const choice = <T extends string | boolean>(...values: T[]): AdminResponseReader<T> => value => values.includes(value as T) ? value as T : invalid();
function object<T extends Record<string, Reader>>(fields: T): AdminResponseReader<{ [K in keyof T]: ReturnType<T[K]> }> {
  return value => {
    const source = record(value);
    // Project only declared fields, so response extensions cannot overwrite form state.
    return Object.fromEntries(Object.entries(fields).map(([key, read]) => [key, read(source[key])])) as { [K in keyof T]: ReturnType<T[K]> };
  };
}

const auditEvent = object({ event: text, createdAt: text });
const relayNode = object({ id: text, name: text, enabled: boolean, target: text, voiceEndpoint: text, hasToken: boolean });
const welcomeTexts = object({ zh: text, en: text, de: text, ru: text, ja: text });
const settings = object({
  target: text, hasPassword: boolean, accessMode: choice("fixed", "open"), siteName: text,
  welcomeText: text, welcomeTextEn: text, welcomeTextDe: text, welcomeTextRu: text, welcomeTextJa: text,
  welcomeDefaults: welcomeTexts, lastTestAt: nullable(text), lastTestLatencyMs: nullable(number), lastTestError: nullable(text),
  webRtcEnabled: boolean, webRtcUdpStart: number, webRtcUdpEnd: number,
  webRtcPublicHost: value => value === undefined ? "" : text(value),
  webRtcIpv6Enabled: value => value === undefined ? false : boolean(value),
  webRtcStunServer: value => value === undefined ? "" : text(value),
  relayConfigured: boolean, relayEnabled: boolean, relayName: text, relayTarget: text, hasRelayToken: boolean,
  relayNodes: array(relayNode), internalPort: number, updatedAt: text,
});
const teamSpeak = object({ target: text, status: text, lastTestAt: nullable(text), latencyMs: nullable(number), lastError: nullable(text) });
const overview = object({
  gateway: object({ status: text, version: text, uptimeSeconds: number }), teamSpeak,
  sessions: object({ active: number, peak: number, limit: number }),
  recentEvents: array(auditEvent), legacyConfigImported: boolean,
});
const session = object({
  id: text, nickname: text, target: text, state: text, createdAt: text,
  ageSeconds: number, tsClientId: nullable(number), channelId: nullable(text), memberCount: number,
});
const invite = object({
  id: text, target: text, channel: text, expiresAt: text, maxUses: number,
  useCount: number, createdAt: text, revokedAt: nullable(text), status: choice("active", "expired", "exhausted", "revoked"),
});
const logContext: AdminResponseReader<Record<string, string | number | boolean>> = value => Object.fromEntries(
  Object.entries(record(value)).map(([key, entry]) => [key, typeof entry === "string" || typeof entry === "boolean" ? entry : number(entry)]),
);
const logEntry = object({ timestamp: nullable(text), level: text, message: text, context: logContext });
const connection = object({
  id: text, nickname: text, clientIp: text, target: text, relayName: nullable(text), relayTarget: nullable(text),
  startedAt: text, connectedAt: nullable(text), disconnectedAt: nullable(text), durationSeconds: nullable(number),
  status: choice("active", "connecting", "disconnected", "failed"), reason: nullable(text), failureDetail: nullable(text),
});
const skin = object({
  id: text, name: text, version: text, author: text, license: text, minAppVersion: text, installedAt: number,
  description: optional(text), previewUrl: optional(text), previewMimeType: optional(text),
  builtIn: optional(boolean), enabled: optional(boolean), previewKind: optional(choice("day", "night", "illusia")),
});
const storeMetadata = object({
  schemaVersion: value => value === 1 ? 1 as const : invalid(),
  id: text, name: text, version: text, author: text, license: text, description: text, minAppVersion: text,
  package: object({ ref: text, path: text, sha256: text }),
});
const skinStore = object({
  repository: text, appVersion: text, fetchedAt: number,
  entries: array(object({ id: text, repository: text, metadata: nullable(storeMetadata), revision: text, compatible: boolean, error: nullable(text) })),
});
const tsAdminSettings = object({
  configurationRevision: text,
  fixedMode: boolean, enabled: boolean, queryPort: number, username: text,
  transport: choice("web", "ssh", "tcp"), queryHost: text, webQueryUrl: text, serverId: number, hasApiKey: boolean,
  hasPassword: boolean, hostKeyFingerprint: text, updatedAt: text,
});
const tsAdminOverview = object({
  configurationRevision: text,
  serverName: text, serverVersion: text, serverFamily: choice("ts3", "ts6", "unknown"),
  channelCount: number, clientCount: number,
  welcomeMessage: text, maxClients: number, uptimeSeconds: number,
  channels: array(object({ id: text, parentID: text, name: text, description: text, totalClients: number, hasPassword: boolean })),
  clients: array(object({ id: number, uid: text, nickname: text, channelID: text, serverGroups: array(text), away: boolean, inputMuted: boolean, outputMuted: boolean })),
  groups: array(object({ id: text, name: text })), groupsAvailable: boolean, bansAvailable: boolean,
  groupsErrorCode: optional(nullable(text)), bansErrorCode: optional(nullable(text)),
  bans: array(object({ id: text, name: text, uid: text, reason: text, durationSeconds: number, createdAt: nullable(text) })),
  observedAt: text,
});
const savedTsAdminSettings = object({ ok: choice(true), settings: tsAdminSettings });
const sessionStatus = object({ authenticated: boolean, mustChangePassword: optional(boolean), csrfToken: optional(text) });

export const adminResponses = {
  session(value: unknown) {
    const result = sessionStatus(value);
    if (result.authenticated && (!result.csrfToken || result.mustChangePassword === undefined)) invalid();
    return result;
  },
  login: object({ ok: choice(true), csrfToken: nonempty, mustChangePassword: boolean }),
  ok: object({ ok: choice(true) }),
  overview,
  settings,
  savedSettings: object({ ok: choice(true), settings }),
  sessions: object({ sessions: array(session) }),
  invites: object({ invites: array(invite) }),
  createdInvite: object({ ok: choice(true), token: nonempty, invite }),
  audit: object({ events: array(auditEvent) }),
  logs: object({ available: boolean, entries: array(logEntry), sessions: array(connection) }),
  diagnostics: object({
    gateway: object({ version: text, node: text, platform: text, arch: text }),
    database: object({ schemaVersion: number }), sessions: object({ created: number }),
  }),
  skins: object({ skins: array(skin), defaultSkinId: text }),
  skinStore,
  tsAdminSettings,
  savedTsAdminSettings,
  tsAdminOverview,
  defaultSkin: object({ ok: choice(true), defaultSkinId: text }),
  updatedSkin: object({ ok: choice(true), skin, defaultSkinId: text }),
  uploadedSkin: object({ ok: choice(true), skin }),
  probe: object({
    ok: boolean, checkType: choice("network", "protocol"), passwordVerified: boolean,
    latencyMs: number, serverName: nullable(text), requiresPassword: boolean,
    packetLossPercent: optional(number), attempts: optional(number), successfulAttempts: optional(number), errorCode: optional(text),
  }),
};

export type AdminSettings = ReturnType<typeof settings>;
export type AdminOverview = ReturnType<typeof overview>;
export type AdminSession = ReturnType<typeof session>;
export type ManagedInvite = ReturnType<typeof invite>;
export type AdminLog = ReturnType<typeof logEntry>;
export type AdminConnectionRecord = ReturnType<typeof connection>;
