import {
  createSkinPluginApproval,
  isSkinPluginPermissionApproved,
  type SkinPluginApproval,
  type SkinPluginComponent,
  type SkinPluginDocument,
} from "../../../src/shared/skin-plugin.js";

const STORAGE_KEY = "webspeak:skin-plugin-approvals";
interface ApprovalStore { schemaVersion: 1; grants: Record<string, SkinPluginApproval> }

function approvalKey(skinId: string, skinVersion: string, component: SkinPluginComponent): string {
  return `${skinId}@${skinVersion}/${component.page}/${component.id}`;
}

function readStore(): ApprovalStore {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).schemaVersion !== 1
      || !(raw as Record<string, unknown>).grants || typeof (raw as Record<string, unknown>).grants !== "object") {
      return { schemaVersion: 1, grants: {} };
    }
    return raw as ApprovalStore;
  } catch {
    return { schemaVersion: 1, grants: {} };
  }
}

function writeStore(store: ApprovalStore): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* Approval persistence is optional. */ }
}

export function getMissingSkinPluginApprovals(skinId: string, skinVersion: string, document: SkinPluginDocument): SkinPluginComponent[] {
  const grants = readStore().grants;
  return document.components.filter((component) => component.permissions.some((permission) =>
    !isSkinPluginPermissionApproved(grants[approvalKey(skinId, skinVersion, component)], approvalKey(skinId, skinVersion, component), permission)));
}

export function isSkinPluginComponentApproved(skinId: string, skinVersion: string, component: SkinPluginComponent): boolean {
  if (!component.permissions.length) return true;
  const pluginId = approvalKey(skinId, skinVersion, component);
  const grant = readStore().grants[pluginId];
  return component.permissions.every((permission) => isSkinPluginPermissionApproved(grant, pluginId, permission));
}

export function approveSkinPluginComponents(skinId: string, skinVersion: string, components: readonly SkinPluginComponent[]): void {
  const store = readStore();
  for (const component of components) {
    const pluginId = approvalKey(skinId, skinVersion, component);
    store.grants[pluginId] = createSkinPluginApproval(pluginId, component.permissions);
  }
  writeStore(store);
}

export function revokeSkinPluginApprovals(skinId: string): void {
  const store = readStore();
  for (const key of Object.keys(store.grants)) if (key.startsWith(`${skinId}@`)) delete store.grants[key];
  writeStore(store);
}
