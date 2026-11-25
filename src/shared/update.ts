/**
 * Browser-safe projections of the administrator update API.
 *
 * The console never receives download URLs or local paths. It selects a
 * version, and the server re-resolves the official GitHub release asset
 * before doing any work.
 */
export type UpdateDeploymentMode = "docker" | "release-package" | "source";
export type UpdateUpgradePath = "docker-compose" | "release-package" | "source";
export type UpdateTaskStatus =
  | "downloading"
  | "verifying"
  | "extracting"
  | "staging"
  | "restarting"
  | "succeeded"
  | "failed";
export type UpdateStepStatus = "running" | "succeeded" | "failed";

export interface UpdateStepView {
  name: string;
  status: UpdateStepStatus;
  at: string;
  detail?: string;
}

export interface UpdateTaskView {
  id: string;
  status: UpdateTaskStatus;
  fromVersion: string;
  targetVersion: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rolledBack: boolean;
  steps: UpdateStepView[];
}

export interface UpdateDeploymentView {
  mode: UpdateDeploymentMode;
  platform: string;
  architecture: string;
  applyAllowed: boolean;
  reasonCode: string | null;
  upgradePath: UpdateUpgradePath;
}

export interface UpdateStatusView {
  currentVersion: string;
  deployment: UpdateDeploymentView;
  task: UpdateTaskView | null;
}

export interface UpdateReleaseView {
  version: string;
  tag: string;
  publishedAt: string;
  releaseUrl: string;
  assetName: string;
  assetSize: number;
  assetAvailable: boolean;
  hasChecksums: boolean;
  digest: string | null;
  canApply: boolean;
  blockedReason: string | null;
}

export interface UpdateCheckView {
  currentVersion: string;
  releases: UpdateReleaseView[];
}

export interface UpdateApplyInput {
  version: string;
  confirmVersion: string;
}
