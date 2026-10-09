import type { SkinPluginPermission } from "./skin-plugin.js";

/** Maximum serialized, permission-filtered application data passed to one Wasm UI run. */
export const SKIN_RUNTIME_PLUGIN_CONTEXT_LIMIT_BYTES = 48 * 1024;

export const SKIN_RUNTIME_PLUGIN_DATA_PERMISSIONS: readonly SkinPluginPermission[] = Object.freeze([
  "session.status.read",
  "session.channels.read",
  "session.members.read",
  "chat.channel.read",
  "favorites.read",
  "servers.quickList.read",
  "audio.status.read",
  "voice.whisper.status.read",
  "voice.screenShare.status.read",
  "voice.screenShare.read",
]);

interface CollectionProjection {
  path: readonly string[];
  permission: SkinPluginPermission;
  fields: ReadonlySet<string>;
  maxItems: number;
  keepNewest?: boolean;
}

const COLLECTIONS: readonly CollectionProjection[] = Object.freeze([
  { path: ["session", "channels"], permission: "session.channels.read", fields: new Set(["id", "name", "parentId", "depth", "memberCount", "current"]), maxItems: 128 },
  { path: ["session", "members"], permission: "session.members.read", fields: new Set(["id", "name", "channelId", "status", "speaking", "self"]), maxItems: 256 },
  { path: ["favorites", "items"], permission: "favorites.read", fields: new Set(["id", "label", "current", "kind"]), maxItems: 100 },
  { path: ["servers", "quickList"], permission: "servers.quickList.read", fields: new Set(["id", "label", "current", "kind", "favorite"]), maxItems: 100 },
  { path: ["chat", "messages"], permission: "chat.channel.read", fields: new Set(["id", "author", "text", "time", "kind", "channelId"]), maxItems: 50, keepNewest: true },
  { path: ["screenShare", "streams"], permission: "voice.screenShare.read", fields: new Set(["streamId", "source", "ownerClientId", "ownerNickname", "name", "audio", "viewerCount"]), maxItems: 32 },
]);

interface ContextProjection {
  path: readonly string[];
  permission: SkinPluginPermission;
  fields: ReadonlySet<string>;
}

const CONTEXTS: readonly ContextProjection[] = Object.freeze([
  { path: ["session", "status"], permission: "session.status.read", fields: new Set(["connected", "connecting", "channelId", "channelName", "userName"]) },
  { path: ["audio", "status"], permission: "audio.status.read", fields: new Set(["microphoneMuted", "outputMuted"]) },
  { path: ["whisper", "status"], permission: "voice.whisper.status.read", fields: new Set(["active", "targetCount"]) },
  { path: ["screenShare", "status"], permission: "voice.screenShare.status.read", fields: new Set(["active", "starting", "viewing"]) },
]);

const BOOLEAN_FIELDS = new Set(["connected", "connecting", "current", "favorite", "speaking", "self", "audio", "microphoneMuted", "outputMuted", "active", "starting", "viewing"]);
const NUMBER_FIELDS = new Set(["depth", "memberCount", "targetCount", "ownerClientId", "viewerCount"]);
const TEXT_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  id: 128,
  streamId: 128,
  channelId: 128,
  parentId: 128,
  name: 160,
  label: 160,
  channelName: 160,
  userName: 160,
  ownerNickname: 160,
  author: 160,
  status: 48,
  source: 48,
  kind: 48,
  time: 48,
  text: 1_024,
});

const CONNECTION_TARGET_PATTERN = /(?:\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b|\[[0-9a-f:]+\](?::\d{1,5})?|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?\b|\b(?:[0-9a-f]{0,4}:){2,}[0-9a-f:]{1,}\b)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function boundedValue(field: string, value: unknown): string | number | boolean | null | undefined {
  if (value === null) return field === "parentId" ? null : undefined;
  if (BOOLEAN_FIELDS.has(field)) return typeof value === "boolean" ? value : undefined;
  if (NUMBER_FIELDS.has(field)) return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : undefined;
  if (typeof value !== "string") return undefined;
  const maximum = TEXT_LIMITS[field] ?? 160;
  if (value.length > maximum) return undefined;
  return value.replace(/\u0000/g, "");
}

function projectRecord(value: unknown, fields: ReadonlySet<string>): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const projected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) continue;
    const safe = boundedValue(field, value[field]);
    if (safe !== undefined) projected[field] = safe;
  }
  return projected;
}

function projectCollectionItem(
  definition: CollectionProjection,
  value: unknown,
  index: number,
): Record<string, unknown> | null {
  const projected = projectRecord(value, definition.fields);
  if (!projected || typeof projected.label !== "string" || !CONNECTION_TARGET_PATTERN.test(projected.label)) return projected;

  const isFavoriteList = definition.path[0] === "favorites" || projected.favorite === true || projected.kind === "favorite";
  projected.label = `${isFavoriteList ? "Favorite" : "Recent"} ${index + 1}`;
  return projected;
}

function writePath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    const existing = current[segment];
    if (!isRecord(existing)) current[segment] = Object.create(null) as Record<string, unknown>;
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

function encodedSize(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return SKIN_RUNTIME_PLUGIN_CONTEXT_LIMIT_BYTES + 1; }
}

/**
 * Copies only public, permission-matched fields into an immutable-by-convention snapshot.
 * Addresses, credentials, SDK objects, and unknown fields never cross the guest boundary.
 */
export function projectSkinRuntimePluginContext(
  permissions: readonly string[],
  context: unknown,
): Record<string, unknown> {
  const allowed = new Set(permissions);
  const projected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const projectedCollections: Array<{ definition: CollectionProjection; items: Record<string, unknown>[] }> = [];

  for (const definition of CONTEXTS) {
    if (!allowed.has(definition.permission)) continue;
    const record = projectRecord(readPath(context, definition.path), definition.fields);
    if (record && Object.keys(record).length) writePath(projected, definition.path, record);
  }

  for (const definition of COLLECTIONS) {
    if (!allowed.has(definition.permission)) continue;
    const raw = readPath(context, definition.path);
    if (!Array.isArray(raw)) continue;
    const selected = definition.keepNewest ? raw.slice(-definition.maxItems) : raw.slice(0, definition.maxItems);
    const items = selected.map((item, index) => projectCollectionItem(definition, item, index)).filter((item): item is Record<string, unknown> => Boolean(item));
    writePath(projected, definition.path, items);
    projectedCollections.push({ definition, items });
  }

  // Keep the snapshot within the independent context budget even when a server is unusually large.
  while (encodedSize(projected) > SKIN_RUNTIME_PLUGIN_CONTEXT_LIMIT_BYTES) {
    const largest = projectedCollections
      .filter(({ items }) => items.length > 0)
      .sort((left, right) => encodedSize(right.items) - encodedSize(left.items))[0];
    if (!largest) break;
    const nextLength = Math.max(0, Math.floor(largest.items.length * 0.75));
    const removeCount = largest.items.length - nextLength;
    largest.items.splice(largest.definition.keepNewest ? 0 : nextLength, removeCount);
  }

  return projected;
}
