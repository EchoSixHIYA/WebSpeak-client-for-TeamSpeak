import {
  createSkinRuntimePluginApproval,
  isSkinRuntimePluginApproved,
  parseSkinRuntimePluginApproval,
  type SkinRuntimePluginApproval,
} from "../../../src/shared/skin-runtime-plugin-approval.js";
import type { SkinRuntimePlugin } from "../../../src/shared/skin-runtime-plugins.js";

const STORAGE_KEY = "webspeak:skin-runtime-plugin-approvals";
interface ApprovalStore { schemaVersion: 1; grants: Record<string, SkinRuntimePluginApproval> }
type ApprovalStorage = Pick<Storage, "getItem" | "setItem">;
const unavailableStorage: ApprovalStorage = { getItem: () => null, setItem: () => undefined };

function pluginKey(skinId: string, skinVersion: string, pluginId: string): string {
  return JSON.stringify([skinId, skinVersion, pluginId]);
}

function readStore(storage: ApprovalStorage): ApprovalStore {
  try {
    const raw: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).schemaVersion !== 1
      || !(raw as Record<string, unknown>).grants || typeof (raw as Record<string, unknown>).grants !== "object") {
      return { schemaVersion: 1, grants: {} };
    }
    const grants: Record<string, SkinRuntimePluginApproval> = Object.create(null) as Record<string, SkinRuntimePluginApproval>;
    for (const [key, value] of Object.entries((raw as ApprovalStore).grants)) {
      try { grants[key] = parseSkinRuntimePluginApproval(value); } catch { /* Ignore corrupt local grants. */ }
    }
    return { schemaVersion: 1, grants };
  } catch {
    return { schemaVersion: 1, grants: {} };
  }
}

function writeStore(storage: ApprovalStorage, store: ApprovalStore): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* Approval persistence is optional. */ }
}

function defaultStorage(): ApprovalStorage {
  try { return window.localStorage; } catch { return unavailableStorage; }
}

export function getSkinRuntimePluginApproval(
  skinId: string,
  skinVersion: string,
  plugin: SkinRuntimePlugin,
  digest: string,
  storage: ApprovalStorage = defaultStorage(),
): SkinRuntimePluginApproval | null {
  const grant = readStore(storage).grants[pluginKey(skinId, skinVersion, plugin.id)];
  return grant && isSkinRuntimePluginApproved(grant, skinId, skinVersion, plugin, digest) ? grant : null;
}

/** Called only by the host consent UI after a user explicitly approves this exact package. */
export function approveSkinRuntimePlugin(
  skinId: string,
  skinVersion: string,
  plugin: SkinRuntimePlugin,
  digest: string,
  storage: ApprovalStorage = defaultStorage(),
): void {
  const store = readStore(storage);
  const key = pluginKey(skinId, skinVersion, plugin.id);
  store.grants[key] = createSkinRuntimePluginApproval(skinId, skinVersion, plugin, digest);
  writeStore(storage, store);
}

export function getMissingSkinRuntimePluginApprovals(
  skinId: string,
  skinVersion: string,
  plugins: readonly SkinRuntimePlugin[],
  digests: Readonly<Record<string, string>>,
  storage: ApprovalStorage = defaultStorage(),
): SkinRuntimePlugin[] {
  const grants = readStore(storage).grants;
  return plugins.filter((plugin) => {
    const digest = digests[plugin.id];
    const grant = grants[pluginKey(skinId, skinVersion, plugin.id)];
    return !digest || !grant || !isSkinRuntimePluginApproved(grant, skinId, skinVersion, plugin, digest);
  });
}

export function revokeSkinRuntimePluginApprovals(
  skinId: string,
  pluginId?: string,
  storage: ApprovalStorage = defaultStorage(),
): void {
  const store = readStore(storage);
  for (const [key, grant] of Object.entries(store.grants)) {
    if (grant.skinId === skinId && (!pluginId || grant.pluginId === pluginId)) delete store.grants[key];
  }
  writeStore(storage, store);
}
