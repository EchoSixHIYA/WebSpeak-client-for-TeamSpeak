import { SKIN_PLUGIN_PERMISSIONS, type SkinPluginPermission } from "./skin-plugin.js";
import { parseSkinRuntimePluginDocument, type SkinRuntimePlugin } from "./skin-runtime-plugins.js";

export const SKIN_RUNTIME_PLUGIN_APPROVAL_SCHEMA_VERSION = 1 as const;
export const SKIN_RUNTIME_PLUGIN_DIGEST_ALGORITHM = "SHA-256" as const;
export const SKIN_RUNTIME_PLUGIN_DIGEST_TOTAL_LIMIT_BYTES = 50 * 1024 * 1024;

export interface SkinRuntimePluginApproval {
  schemaVersion: typeof SKIN_RUNTIME_PLUGIN_APPROVAL_SCHEMA_VERSION;
  skinId: string;
  skinVersion: string;
  pluginId: string;
  pluginVersion: string;
  apiVersion: 1;
  digest: string;
  permissions: Readonly<Partial<Record<SkinPluginPermission, number>>>;
}

export class SkinRuntimePluginApprovalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinRuntimePluginApprovalError";
  }
}

function invalid(code: string, message: string): never {
  throw new SkinRuntimePluginApprovalError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return Promise.reject(new SkinRuntimePluginApprovalError("SKIN_RUNTIME_PLUGIN_DIGEST_UNAVAILABLE", "Secure plugin approval requires Web Crypto."));
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return globalThis.crypto.subtle.digest(SKIN_RUNTIME_PLUGIN_DIGEST_ALGORITHM, buffer).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}

/**
 * Binds local consent to the exact plugin descriptor and every declared package file.
 * This is an integrity key for local approval, not a publisher signature.
 */
export async function computeSkinRuntimePluginDigest(
  input: SkinRuntimePlugin,
  files: Readonly<Record<string, Blob>>,
): Promise<string> {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    invalid("SKIN_RUNTIME_PLUGIN_DIGEST_FILE_MISSING", "The declared plugin files are unavailable.");
  }
  const plugin = parseSkinRuntimePluginDocument({ schemaVersion: 1, plugins: [input] }).plugins[0];
  const paths = [plugin.entry, ...(plugin.style ? [plugin.style] : []), ...plugin.assets].sort();
  let totalBytes = 0;
  const fileDigests: Array<{ path: string; size: number; digest: string }> = [];

  for (const path of paths) {
    if (!Object.hasOwn(files, path) || !(files[path] instanceof Blob)) {
      invalid("SKIN_RUNTIME_PLUGIN_DIGEST_FILE_MISSING", "A declared plugin file is missing from the digest input.");
    }
    const blob = files[path];
    totalBytes += blob.size;
    if (totalBytes > SKIN_RUNTIME_PLUGIN_DIGEST_TOTAL_LIMIT_BYTES) {
      invalid("SKIN_RUNTIME_PLUGIN_DIGEST_SIZE", "The declared plugin files exceed the skin package size limit.");
    }
    fileDigests.push({ path, size: blob.size, digest: await sha256(new Uint8Array(await blob.arrayBuffer())) });
  }

  const canonicalPlugin = {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    apiVersion: plugin.apiVersion,
    runtime: plugin.runtime,
    page: plugin.page,
    mode: plugin.mode,
    ...(plugin.mount ? { mount: plugin.mount } : {}),
    entry: plugin.entry,
    ...(plugin.style ? { style: plugin.style } : {}),
    assets: [...plugin.assets].sort(),
    permissions: [...plugin.permissions].sort(),
  };
  const canonical = JSON.stringify({
    domain: "webspeak.skin-runtime-plugin-approval",
    schemaVersion: SKIN_RUNTIME_PLUGIN_APPROVAL_SCHEMA_VERSION,
    plugin: canonicalPlugin,
    files: fileDigests,
  });
  return sha256(new TextEncoder().encode(canonical));
}

export function createSkinRuntimePluginApproval(
  skinId: string,
  skinVersion: string,
  input: SkinRuntimePlugin,
  digest: string,
): SkinRuntimePluginApproval {
  if (typeof skinId !== "string" || !skinId.trim() || skinId.length > 120
    || typeof skinVersion !== "string" || !skinVersion.trim() || skinVersion.length > 32
    || !validDigest(digest)) {
    invalid("SKIN_RUNTIME_PLUGIN_APPROVAL_INVALID", "The host approval identity or plugin digest is invalid.");
  }
  const plugin = parseSkinRuntimePluginDocument({ schemaVersion: 1, plugins: [input] }).plugins[0];
  const permissions: Partial<Record<SkinPluginPermission, number>> = {};
  for (const permission of plugin.permissions) permissions[permission] = SKIN_PLUGIN_PERMISSIONS[permission].policyVersion;
  return Object.freeze({
    schemaVersion: SKIN_RUNTIME_PLUGIN_APPROVAL_SCHEMA_VERSION,
    skinId,
    skinVersion,
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    apiVersion: plugin.apiVersion,
    digest,
    permissions: Object.freeze(permissions),
  });
}

export function parseSkinRuntimePluginApproval(input: unknown): SkinRuntimePluginApproval {
  const fields = ["schemaVersion", "skinId", "skinVersion", "pluginId", "pluginVersion", "apiVersion", "digest", "permissions"];
  if (!isRecord(input) || Object.keys(input).length !== fields.length || fields.some((field) => !Object.hasOwn(input, field))) {
    invalid("SKIN_RUNTIME_PLUGIN_APPROVAL_INVALID", "The stored plugin approval has an invalid shape.");
  }
  if (input.schemaVersion !== SKIN_RUNTIME_PLUGIN_APPROVAL_SCHEMA_VERSION
    || typeof input.skinId !== "string" || !input.skinId.trim() || input.skinId.length > 120
    || typeof input.skinVersion !== "string" || !input.skinVersion.trim() || input.skinVersion.length > 32
    || typeof input.pluginId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(input.pluginId)
    || typeof input.pluginVersion !== "string" || input.pluginVersion.length > 32
    || input.apiVersion !== 1 || !validDigest(input.digest) || !isRecord(input.permissions)) {
    invalid("SKIN_RUNTIME_PLUGIN_APPROVAL_INVALID", "The stored plugin approval has invalid identity fields.");
  }
  const permissions: Partial<Record<SkinPluginPermission, number>> = {};
  for (const [permission, policyVersion] of Object.entries(input.permissions)) {
    if (!Object.hasOwn(SKIN_PLUGIN_PERMISSIONS, permission)
      || !Number.isSafeInteger(policyVersion) || (policyVersion as number) < 1) {
      invalid("SKIN_RUNTIME_PLUGIN_APPROVAL_INVALID", "The stored plugin approval contains an unsupported permission.");
    }
    permissions[permission as SkinPluginPermission] = policyVersion as number;
  }
  return Object.freeze({
    schemaVersion: SKIN_RUNTIME_PLUGIN_APPROVAL_SCHEMA_VERSION,
    skinId: input.skinId,
    skinVersion: input.skinVersion,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    apiVersion: 1,
    digest: input.digest,
    permissions: Object.freeze(permissions),
  });
}

export function isSkinRuntimePluginApproved(
  approval: SkinRuntimePluginApproval,
  skinId: string,
  skinVersion: string,
  input: SkinRuntimePlugin,
  digest: string,
): boolean {
  let plugin: SkinRuntimePlugin;
  try { plugin = parseSkinRuntimePluginDocument({ schemaVersion: 1, plugins: [input] }).plugins[0]; }
  catch { return false; }
  return approval.skinId === skinId
    && approval.skinVersion === skinVersion
    && approval.pluginId === plugin.id
    && approval.pluginVersion === plugin.version
    && approval.apiVersion === plugin.apiVersion
    && approval.digest === digest
    && validDigest(digest)
    && plugin.permissions.every((permission) =>
      approval.permissions[permission] === SKIN_PLUGIN_PERMISSIONS[permission].policyVersion);
}
