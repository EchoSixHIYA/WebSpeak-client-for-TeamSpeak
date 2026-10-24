/** Public workspace API v1. No skin IDs or connection credentials belong here. */
export interface SkinWorkspacePolicy {
  apiVersion: 1;
  mode: "persistent";
}

export function parseSkinWorkspacePolicy(value: unknown, schemaVersion: number): SkinWorkspacePolicy | undefined {
  if (value === undefined) return undefined;
  if (schemaVersion < 3 || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Workspace policy requires an open-skin package.");
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).some(key => key !== "apiVersion" && key !== "mode") || policy.apiVersion !== 1 || policy.mode !== "persistent") {
    throw new Error("Unsupported workspace policy or API version.");
  }
  return { apiVersion: 1, mode: "persistent" };
}
