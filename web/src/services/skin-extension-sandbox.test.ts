import assert from "node:assert/strict";
import test from "node:test";
import {
  createSkinExtensionApproval,
  getSkinExtensionUpgradeConsentDelta,
  isSkinExtensionBootstrapHello,
  isSkinExtensionPermissionApproved,
  parseSkinExtensionApproval,
  parseSkinExtensionManifest,
  parseSkinExtensionRequestMessage,
  sanitizeSkinExtensionSessionStatus,
  SKIN_EXTENSION_MESSAGE_CHANNEL,
  type SkinExtensionManifest,
} from "../../../src/shared/skin-extension.js";
import {
  createSkinExtensionSandboxPrototype,
  SKIN_EXTENSION_RUNTIME_ENABLED,
  SKIN_EXTENSION_SANDBOX_MESSAGE_LIMIT,
  SKIN_EXTENSION_SANDBOX_REQUESTS_PER_SECOND,
  SKIN_EXTENSION_SANDBOX_SOURCE_LIMIT,
  SkinExtensionSandboxError,
} from "./skin-extension-sandbox.js";

function manifest(overrides: Record<string, unknown> = {}) {
  return parseSkinExtensionManifest({
    schemaVersion: 1,
    packageType: "extension",
    id: "community.status-card",
    name: "Status card",
    version: "1.0.0",
    apiVersion: 1,
    permissions: ["session.status.read"],
    ...overrides,
  });
}

test("extension manifests use a separate strict schema and reject unknown capabilities", () => {
  const parsed = manifest();
  assert.equal(parsed.packageType, "extension");
  assert.deepEqual(parsed.permissions, ["session.status.read"]);
  assert.throws(() => manifest({ unexpected: true }), { code: "SKIN_EXTENSION_UNKNOWN_FIELD" });
  assert.throws(() => manifest({ permissions: ["filesystem.read"] }), { code: "SKIN_EXTENSION_PERMISSION_UNKNOWN" });
  assert.throws(() => manifest({ permissions: ["session.status.read", "session.status.read"] }), { code: "SKIN_EXTENSION_PERMISSION_DUPLICATE" });
  assert.throws(() => manifest({ version: "latest" }), { code: "SKIN_EXTENSION_MANIFEST_INVALID" });
  assert.throws(() => manifest({ apiVersion: 2 }), { code: "SKIN_EXTENSION_API_UNSUPPORTED" });
});

test("approval is host-shaped, permission-specific, and cannot be reused for another extension", () => {
  const parsed = manifest();
  const approval = createSkinExtensionApproval(parsed);
  assert.equal(isSkinExtensionPermissionApproved(approval, parsed.id, "session.status.read"), true);
  assert.equal(isSkinExtensionPermissionApproved(approval, "other.extension", "session.status.read"), false);
  assert.deepEqual(parseSkinExtensionApproval(approval), approval);
  assert.throws(() => parseSkinExtensionApproval({ ...approval, permissions: { "filesystem.read": 1 } }), { code: "SKIN_EXTENSION_APPROVAL_INVALID" });
  assert.throws(() => getSkinExtensionUpgradeConsentDelta(approval, manifest({ id: "other.extension" })), { code: "SKIN_EXTENSION_ID_CHANGED" });
});

test("an extension upgrade needs new consent when it adds or changes a capability", () => {
  const approval = createSkinExtensionApproval(manifest());
  const unchanged = getSkinExtensionUpgradeConsentDelta(approval, manifest({ version: "2.0.0" }));
  assert.equal(unchanged.requiresConsent, false, "a version change alone does not silently change permission meaning");

  const approvalWithoutPermissions = createSkinExtensionApproval(manifest({ permissions: [] }));
  const added = getSkinExtensionUpgradeConsentDelta(approvalWithoutPermissions, manifest({ version: "2.0.0" }));
  assert.deepEqual(added.addedPermissions, ["session.status.read"]);
  assert.equal(added.requiresConsent, true);

  const removed = getSkinExtensionUpgradeConsentDelta(approval, manifest({ version: "2.0.0", permissions: [] }));
  assert.deepEqual(removed.removedPermissions, ["session.status.read"]);
  assert.equal(removed.requiresConsent, false, "removing a capability cannot expand an existing approval");

  const outdatedApproval = { ...approval, permissions: { "session.status.read": 2 } };
  const changedMeaning = getSkinExtensionUpgradeConsentDelta(outdatedApproval, manifest({ version: "2.0.0" }));
  assert.deepEqual(changedMeaning.changedMeaningPermissions, ["session.status.read"]);
  assert.equal(changedMeaning.requiresConsent, true);

  const changedApi = getSkinExtensionUpgradeConsentDelta({ ...approval, apiVersion: 2 }, manifest({ version: "2.0.0" }) as SkinExtensionManifest);
  assert.equal(changedApi.apiVersionChanged, true);
  assert.equal(changedApi.requiresConsent, true);
});

test("bootstrap accepts only the exact opaque iframe source, nonce, origin, and transferred port", () => {
  const expectedSource = {};
  const valid = {
    source: expectedSource,
    origin: "null",
    data: { channel: SKIN_EXTENSION_MESSAGE_CHANNEL, type: "hello", apiVersion: 1, nonce: "secret" },
    ports: [{}],
  };
  assert.equal(isSkinExtensionBootstrapHello(valid, expectedSource, "secret"), true);
  assert.equal(isSkinExtensionBootstrapHello({ ...valid, source: {} }, expectedSource, "secret"), false);
  assert.equal(isSkinExtensionBootstrapHello({ ...valid, origin: "https://webspeak.online" }, expectedSource, "secret"), false);
  assert.equal(isSkinExtensionBootstrapHello({ ...valid, data: { ...valid.data, nonce: "wrong" } }, expectedSource, "secret"), false);
  assert.equal(isSkinExtensionBootstrapHello({ ...valid, ports: [] }, expectedSource, "secret"), false);
  assert.equal(isSkinExtensionBootstrapHello({ ...valid, data: { ...valid.data, extra: true } }, expectedSource, "secret"), false);
});

test("capability requests have a fixed envelope and empty, bounded payload", () => {
  const message = {
    channel: SKIN_EXTENSION_MESSAGE_CHANNEL,
    apiVersion: 1,
    nonce: "secret",
    id: "r1",
    type: "request",
    permission: "session.status.read",
    payload: {},
  };
  assert.deepEqual(parseSkinExtensionRequestMessage(message, "secret"), message);
  assert.equal(parseSkinExtensionRequestMessage({ ...message, nonce: "wrong" }, "secret"), null);
  assert.equal(parseSkinExtensionRequestMessage({ ...message, payload: { includePrivateChat: true } }, "secret"), null);
  assert.equal(parseSkinExtensionRequestMessage({ ...message, extra: true }, "secret"), null);
  assert.equal(parseSkinExtensionRequestMessage({ ...message, permission: "chat.private.read" }, "secret"), null);
  assert.equal(parseSkinExtensionRequestMessage({ ...message, id: "a".repeat(65) }, "secret"), null);
});

test("session status copies only low-sensitivity fields and rejects invalid values", () => {
  const safe = sanitizeSkinExtensionSessionStatus({ connected: true, channelName: "Lounge\n", memberCount: 3, token: "must not escape" });
  assert.deepEqual(safe, { connected: true, channelName: "Lounge ", memberCount: 3 });
  assert.equal("token" in safe, false);
  assert.throws(() => sanitizeSkinExtensionSessionStatus({ connected: true, channelName: null, memberCount: -1 }));
  assert.throws(() => sanitizeSkinExtensionSessionStatus({ connected: "yes", channelName: null, memberCount: 0 }));
});

test("JavaScript extensions stay disabled because Workers have no hard memory quota", () => {
  assert.equal(SKIN_EXTENSION_RUNTIME_ENABLED, false);
  assert.ok(SKIN_EXTENSION_SANDBOX_SOURCE_LIMIT <= 64 * 1024);
  assert.ok(SKIN_EXTENSION_SANDBOX_MESSAGE_LIMIT <= 8 * 1024);
  assert.ok(SKIN_EXTENSION_SANDBOX_REQUESTS_PER_SECOND <= 10);
  assert.ok(new SkinExtensionSandboxError("DISABLED", "disabled") instanceof Error);
});

test("the prototype rejects source beyond its fixed startup budget before creating a frame", () => {
  const parsed = manifest();
  const approval = createSkinExtensionApproval(parsed);
  assert.throws(() => createSkinExtensionSandboxPrototype({
    container: {} as HTMLElement,
    manifest: parsed,
    approval,
    source: "x".repeat(SKIN_EXTENSION_SANDBOX_SOURCE_LIMIT + 1),
    readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
    prototypeOnly: true,
  }), { code: "SKIN_EXTENSION_SOURCE_TOO_LARGE" });
});
