export const SKIN_EXTENSION_MANIFEST_SCHEMA_VERSION = 1 as const;
export const SKIN_EXTENSION_API_VERSION = 1 as const;
export const SKIN_EXTENSION_MESSAGE_CHANNEL = "webspeak.skin-extension" as const;

export const SKIN_EXTENSION_PERMISSION_DEFINITIONS = Object.freeze({
  "session.status.read": Object.freeze({
    policyVersion: 1,
    risk: "low",
    description: "Read a minimal snapshot of the current voice session status.",
  }),
} as const);

export type SkinExtensionPermissionId = keyof typeof SKIN_EXTENSION_PERMISSION_DEFINITIONS;

export interface SkinExtensionManifest {
  schemaVersion: typeof SKIN_EXTENSION_MANIFEST_SCHEMA_VERSION;
  packageType: "extension";
  id: string;
  name: string;
  version: string;
  apiVersion: typeof SKIN_EXTENSION_API_VERSION;
  permissions: readonly SkinExtensionPermissionId[];
}

export type SkinExtensionPermissionVersions = Readonly<Partial<Record<SkinExtensionPermissionId, number>>>;

/** A host-created approval record. Package contents can request permissions but cannot create this record. */
export interface SkinExtensionApproval {
  pluginId: string;
  apiVersion: number;
  permissions: SkinExtensionPermissionVersions;
}

export interface SkinExtensionUpgradeConsentDelta {
  addedPermissions: SkinExtensionPermissionId[];
  changedMeaningPermissions: SkinExtensionPermissionId[];
  removedPermissions: SkinExtensionPermissionId[];
  apiVersionChanged: boolean;
  requiresConsent: boolean;
}

export interface SkinExtensionSessionStatus {
  connected: boolean;
  channelName: string | null;
  memberCount: number;
}

export interface SkinExtensionRequestMessage {
  channel: typeof SKIN_EXTENSION_MESSAGE_CHANNEL;
  apiVersion: typeof SKIN_EXTENSION_API_VERSION;
  nonce: string;
  id: string;
  type: "request";
  permission: SkinExtensionPermissionId;
  payload: Record<string, never>;
}

export class SkinExtensionValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SkinExtensionValidationError";
  }
}

const MANIFEST_FIELDS = new Set(["schemaVersion", "packageType", "id", "name", "version", "apiVersion", "permissions"]);
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KNOWN_PERMISSIONS = new Set<string>(Object.keys(SKIN_EXTENSION_PERMISSION_DEFINITIONS));

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value.trim() !== value) {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_MANIFEST_INVALID", `Invalid ${field}.`);
  }
  return value;
}

export function parseSkinExtensionManifest(input: unknown): SkinExtensionManifest {
  if (!isPlainRecord(input)) throw new SkinExtensionValidationError("SKIN_EXTENSION_MANIFEST_INVALID", "The extension manifest must be an object.");
  if (Object.keys(input).some((key) => !MANIFEST_FIELDS.has(key))) {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_UNKNOWN_FIELD", "The extension manifest contains an unsupported field.");
  }
  if (input.schemaVersion !== SKIN_EXTENSION_MANIFEST_SCHEMA_VERSION || input.packageType !== "extension") {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_SCHEMA_UNSUPPORTED", "The extension package schema is not supported.");
  }

  const id = boundedString(input.id, "id", 100);
  if (!PLUGIN_ID_PATTERN.test(id)) throw new SkinExtensionValidationError("SKIN_EXTENSION_MANIFEST_INVALID", "The extension id must use lowercase letters, numbers, dots, or hyphens.");
  const name = boundedString(input.name, "name", 120);
  const version = boundedString(input.version, "version", 64);
  if (!SEMVER_PATTERN.test(version)) throw new SkinExtensionValidationError("SKIN_EXTENSION_MANIFEST_INVALID", "The extension version must use semantic version syntax.");
  if (input.apiVersion !== SKIN_EXTENSION_API_VERSION) {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_API_UNSUPPORTED", "The extension API version is not supported.");
  }
  if (!Array.isArray(input.permissions) || input.permissions.length > 8) {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_MANIFEST_INVALID", "The extension permissions must be a small array.");
  }

  const permissions: SkinExtensionPermissionId[] = [];
  for (const permission of input.permissions) {
    if (typeof permission !== "string" || !KNOWN_PERMISSIONS.has(permission)) {
      throw new SkinExtensionValidationError("SKIN_EXTENSION_PERMISSION_UNKNOWN", "The extension requests an unsupported permission.");
    }
    if (permissions.includes(permission as SkinExtensionPermissionId)) {
      throw new SkinExtensionValidationError("SKIN_EXTENSION_PERMISSION_DUPLICATE", "The extension requests a permission more than once.");
    }
    permissions.push(permission as SkinExtensionPermissionId);
  }

  return Object.freeze({
    schemaVersion: SKIN_EXTENSION_MANIFEST_SCHEMA_VERSION,
    packageType: "extension",
    id,
    name,
    version,
    apiVersion: SKIN_EXTENSION_API_VERSION,
    permissions: Object.freeze(permissions),
  });
}

/** Called only by a future host approval flow after the user approves the exact capabilities. */
export function createSkinExtensionApproval(manifest: SkinExtensionManifest): SkinExtensionApproval {
  const permissions: Partial<Record<SkinExtensionPermissionId, number>> = {};
  for (const permission of manifest.permissions) {
    permissions[permission] = SKIN_EXTENSION_PERMISSION_DEFINITIONS[permission].policyVersion;
  }
  return Object.freeze({
    pluginId: manifest.id,
    apiVersion: manifest.apiVersion,
    permissions: Object.freeze(permissions),
  });
}

export function parseSkinExtensionApproval(input: unknown): SkinExtensionApproval {
  if (!isPlainRecord(input) || Object.keys(input).some((key) => !["pluginId", "apiVersion", "permissions"].includes(key))) {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_APPROVAL_INVALID", "The extension approval record is invalid.");
  }
  const pluginId = boundedString(input.pluginId, "approval.pluginId", 100);
  if (!PLUGIN_ID_PATTERN.test(pluginId) || input.apiVersion !== SKIN_EXTENSION_API_VERSION || !isPlainRecord(input.permissions)) {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_APPROVAL_INVALID", "The extension approval record is invalid.");
  }
  const permissions: Partial<Record<SkinExtensionPermissionId, number>> = {};
  for (const [permission, policyVersion] of Object.entries(input.permissions)) {
    if (!KNOWN_PERMISSIONS.has(permission) || !Number.isSafeInteger(policyVersion) || (policyVersion as number) < 1) {
      throw new SkinExtensionValidationError("SKIN_EXTENSION_APPROVAL_INVALID", "The extension approval record contains an unsupported grant.");
    }
    permissions[permission as SkinExtensionPermissionId] = policyVersion as number;
  }
  return Object.freeze({
    pluginId,
    apiVersion: SKIN_EXTENSION_API_VERSION,
    permissions: Object.freeze(permissions),
  });
}

export function getSkinExtensionUpgradeConsentDelta(
  previousApproval: SkinExtensionApproval,
  nextManifest: SkinExtensionManifest,
): SkinExtensionUpgradeConsentDelta {
  if (previousApproval.pluginId !== nextManifest.id) {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_ID_CHANGED", "An approval cannot be reused for a different extension id.");
  }

  const addedPermissions = nextManifest.permissions.filter((permission) => previousApproval.permissions[permission] === undefined);
  const changedMeaningPermissions = nextManifest.permissions.filter((permission) => {
    const grantedPolicyVersion = previousApproval.permissions[permission];
    return grantedPolicyVersion !== undefined
      && grantedPolicyVersion !== SKIN_EXTENSION_PERMISSION_DEFINITIONS[permission].policyVersion;
  });
  const removedPermissions = Object.keys(previousApproval.permissions)
    .filter((permission): permission is SkinExtensionPermissionId => KNOWN_PERMISSIONS.has(permission))
    .filter((permission) => !nextManifest.permissions.includes(permission));
  const apiVersionChanged = previousApproval.apiVersion !== nextManifest.apiVersion;

  return {
    addedPermissions,
    changedMeaningPermissions,
    removedPermissions,
    apiVersionChanged,
    requiresConsent: addedPermissions.length > 0 || changedMeaningPermissions.length > 0 || apiVersionChanged,
  };
}

export function isSkinExtensionPermissionApproved(
  approval: SkinExtensionApproval,
  pluginId: string,
  permission: SkinExtensionPermissionId,
): boolean {
  return approval.pluginId === pluginId
    && approval.permissions[permission] === SKIN_EXTENSION_PERMISSION_DEFINITIONS[permission].policyVersion;
}

export function isSkinExtensionBootstrapHello(
  event: { source: unknown; origin: string; data: unknown; ports: readonly unknown[] },
  expectedSource: unknown,
  expectedNonce: string,
): boolean {
  if (event.source !== expectedSource || event.origin !== "null" || event.ports.length !== 1 || !isPlainRecord(event.data)) return false;
  const data = event.data;
  return Object.keys(data).length === 4
    && data.channel === SKIN_EXTENSION_MESSAGE_CHANNEL
    && data.type === "hello"
    && data.apiVersion === SKIN_EXTENSION_API_VERSION
    && data.nonce === expectedNonce;
}

export function parseSkinExtensionRequestMessage(value: unknown, expectedNonce: string): SkinExtensionRequestMessage | null {
  if (!isPlainRecord(value) || !isPlainRecord(value.payload)) return null;
  const expectedFields = ["channel", "apiVersion", "nonce", "id", "type", "permission", "payload"];
  if (Object.keys(value).length !== expectedFields.length || expectedFields.some((field) => !(field in value))) return null;
  if (Object.keys(value.payload).length !== 0) return null;
  if (value.channel !== SKIN_EXTENSION_MESSAGE_CHANNEL || value.apiVersion !== SKIN_EXTENSION_API_VERSION
    || value.nonce !== expectedNonce || value.type !== "request") return null;
  if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) return null;
  if (typeof value.permission !== "string" || !KNOWN_PERMISSIONS.has(value.permission)) return null;
  return value as unknown as SkinExtensionRequestMessage;
}

/** Copies only the low-sensitivity fields registered for the prototype capability. */
export function sanitizeSkinExtensionSessionStatus(value: unknown): SkinExtensionSessionStatus {
  if (!isPlainRecord(value) || typeof value.connected !== "boolean") {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_STATUS_INVALID", "The host session status is invalid.");
  }
  const channelName = value.channelName;
  const memberCount = value.memberCount;
  if (channelName !== null && typeof channelName !== "string") {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_STATUS_INVALID", "The host session status is invalid.");
  }
  if (!Number.isSafeInteger(memberCount) || (memberCount as number) < 0 || (memberCount as number) > 10000) {
    throw new SkinExtensionValidationError("SKIN_EXTENSION_STATUS_INVALID", "The host session status is invalid.");
  }
  const safeChannelName = typeof channelName === "string"
    ? channelName.slice(0, 120).replace(/[\u0000-\u001f\u007f]/g, " ")
    : null;
  return Object.freeze({
    connected: value.connected,
    channelName: safeChannelName,
    memberCount: memberCount as number,
  });
}
