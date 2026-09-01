import { existsSync } from "node:fs";
import type { Logger } from "../logger.js";
import { loadConfig } from "../config.js";
import { formatTeamSpeakTarget, parseTeamSpeakTarget, type TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { type AccessMode, type SettingsUpdate, WebSpeakDatabase } from "../persistence/database.js";
import { hashAdminPassword, validateAdminPassword, verifyAdminPassword } from "../security/admin-password.js";
import { BootstrapManager } from "../security/bootstrap.js";
import { decryptSecret, encryptSecret } from "../security/secret-crypto.js";
import { probeTeamSpeak, TeamSpeakProbeError, type TeamSpeakProbeResult } from "../server/teamspeak-probe.js";

export interface AdminSettingsInput {
  target: string;
  serverPassword?: string;
  passwordAction?: "keep" | "replace" | "remove";
  accessMode: AccessMode;
  siteName: string;
  welcomeText: string;
}

export interface SetupInput extends AdminSettingsInput {
  bootstrapCode: string;
  adminPassword: string;
}

export interface ConnectionPolicy {
  defaultTarget: TeamSpeakTarget;
  serverPassword: string;
  accessMode: AccessMode;
}

type ProbeFunction = typeof probeTeamSpeak;

export class AdminService {
  constructor(
    readonly database: WebSpeakDatabase,
    private readonly masterSecret: Buffer,
    private readonly bootstrap: BootstrapManager,
    private readonly logger: Logger,
    private readonly legacyConfigPath: string,
    private readonly probe: ProbeFunction = probeTeamSpeak,
  ) {}

  initialize(): void {
    this.importLegacyConfigOnce();
    if (!this.database.hasAdmin()) {
      const code = this.bootstrap.ensure();
      this.logger.warn(`WebSpeak is not initialized. Open /admin/setup and enter bootstrap code: ${code}`);
    }
  }

  isInitialized(): boolean {
    return this.database.hasAdmin();
  }

  verifyBootstrap(code: string): boolean {
    return !this.isInitialized() && this.bootstrap.verify(code);
  }

  async setup(input: SetupInput): Promise<void> {
    if (this.isInitialized()) throw new AdminInputError("ALREADY_INITIALIZED", "WebSpeak is already initialized");
    if (!this.bootstrap.verify(input.bootstrapCode)) {
      throw new AdminInputError("INVALID_BOOTSTRAP", "Bootstrap code is invalid");
    }
    const passwordError = validateAdminPassword(input.adminPassword);
    if (passwordError) throw new AdminInputError("INVALID_ADMIN_PASSWORD", passwordError);
    const credential = await hashAdminPassword(input.adminPassword);
    const settings = this.normalizeSettings(input, this.database.getSettings());
    this.database.initializeAdmin(credential, settings);
    this.bootstrap.consume();
    this.logger.info("WebSpeak administrator initialized");
  }

  async verifyPassword(password: string): Promise<boolean> {
    const credential = this.database.getAdminCredential();
    return credential ? verifyAdminPassword(password, credential) : false;
  }

  getPublicConfig(): Record<string, unknown> {
    const settings = this.database.getSettings();
    return {
      initialized: this.isInitialized(),
      siteName: settings.siteName,
      welcomeText: settings.welcomeText,
      accessMode: settings.accessMode,
      ...(settings.accessMode === "open" ? {
        tsHost: settings.tsHost,
        tsPort: settings.tsPort,
        target: formatTeamSpeakTarget({ host: settings.tsHost, port: settings.tsPort }),
      } : {}),
    };
  }

  getSetupDefaults(): Record<string, unknown> {
    const settings = this.database.getSettings();
    return {
      target: formatTeamSpeakTarget({ host: settings.tsHost, port: settings.tsPort }),
      hasPassword: Boolean(settings.tsPasswordEncrypted),
      accessMode: settings.accessMode,
      siteName: settings.siteName,
      welcomeText: settings.welcomeText,
      legacyConfigImported: this.database.getMeta("legacy_config_imported") === "1",
    };
  }

  getAdminSettings(): Record<string, unknown> {
    const settings = this.database.getSettings();
    return {
      target: formatTeamSpeakTarget({ host: settings.tsHost, port: settings.tsPort }),
      hasPassword: Boolean(settings.tsPasswordEncrypted),
      accessMode: settings.accessMode,
      siteName: settings.siteName,
      welcomeText: settings.welcomeText,
      detectedProtocol: settings.detectedProtocol,
      lastTestAt: settings.lastTestAt,
      lastTestLatencyMs: settings.lastTestLatencyMs,
      lastTestError: settings.lastTestError,
      internalPort: 3040,
      updatedAt: settings.updatedAt,
    };
  }

  updateSettings(input: AdminSettingsInput): void {
    const current = this.database.getSettings();
    const settings = this.normalizeSettings(input, current);
    const targetChanged = current.tsHost !== settings.tsHost || current.tsPort !== settings.tsPort;
    this.database.updateSettings(settings);
    if (targetChanged) this.database.clearConnectionTest();
  }

  getConnectionPolicy(): ConnectionPolicy {
    const settings = this.database.getSettings();
    let serverPassword = "";
    try {
      serverPassword = decryptSecret(settings.tsPasswordEncrypted, this.masterSecret);
    } catch (error: unknown) {
      this.logger.error({ err: error instanceof Error ? error.message : String(error) }, "Stored TeamSpeak password could not be decrypted");
    }
    return {
      defaultTarget: { host: settings.tsHost, port: settings.tsPort },
      serverPassword,
      accessMode: settings.accessMode,
    };
  }

  async testConnection(targetText: string, password: string, persistResult: boolean): Promise<TeamSpeakProbeResult> {
    let target: TeamSpeakTarget;
    try {
      target = parseTeamSpeakTarget(targetText);
    } catch {
      throw new AdminInputError("INVALID_TARGET", "TeamSpeak target is invalid");
    }
    try {
      const result = await this.probe(target, password, this.logger);
      if (persistResult) {
        this.database.recordConnectionTest({ protocol: result.protocol, latencyMs: result.latencyMs, error: null });
        this.database.addAudit("CONNECTION_TEST_SUCCEEDED", { protocol: result.protocol, latencyMs: result.latencyMs });
      }
      return result;
    } catch (error: unknown) {
      const probeError = error instanceof TeamSpeakProbeError
        ? error
        : new TeamSpeakProbeError("INTERNAL_ERROR", "Connection test failed", error);
      if (persistResult) {
        this.database.recordConnectionTest({ protocol: null, latencyMs: null, error: probeError.code });
        this.database.addAudit("CONNECTION_TEST_FAILED", { code: probeError.code });
      }
      throw probeError;
    }
  }

  getOverview(activeSessions: number, peakSessions: number, startedAt: number): Record<string, unknown> {
    const settings = this.database.getSettings();
    return {
      gateway: {
        status: "running",
        version: "0.1.0",
        uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
      },
      teamSpeak: {
        target: formatTeamSpeakTarget({ host: settings.tsHost, port: settings.tsPort }),
        status: settings.lastTestError ? "unreachable" : settings.lastTestAt ? "reachable" : "unknown",
        protocol: settings.detectedProtocol,
        lastTestAt: settings.lastTestAt,
        latencyMs: settings.lastTestLatencyMs,
        lastError: settings.lastTestError,
      },
      sessions: { active: activeSessions, peak: peakSessions, limit: 100 },
      recentEvents: this.database.recentAudit(),
      legacyConfigImported: this.database.getMeta("legacy_import_notice_pending") === "1",
    };
  }

  dismissLegacyImportNotice(): void {
    this.database.setMeta("legacy_import_notice_pending", "0");
  }

  private normalizeSettings(input: AdminSettingsInput, current: ReturnType<WebSpeakDatabase["getSettings"]>): SettingsUpdate {
    let target: TeamSpeakTarget;
    try {
      target = parseTeamSpeakTarget(input.target);
    } catch {
      throw new AdminInputError("INVALID_TARGET", "TeamSpeak target is invalid");
    }
    const siteName = input.siteName.trim();
    const welcomeText = input.welcomeText.trim();
    if (!siteName || siteName.length > 80) throw new AdminInputError("INVALID_SITE_NAME", "Site name must contain 1 to 80 characters");
    if (welcomeText.length > 500) throw new AdminInputError("INVALID_WELCOME_TEXT", "Welcome text cannot exceed 500 characters");
    if (input.accessMode !== "fixed" && input.accessMode !== "open") {
      throw new AdminInputError("INVALID_ACCESS_MODE", "Access mode is invalid");
    }

    let encryptedPassword = current.tsPasswordEncrypted;
    const action = input.passwordAction ?? (input.serverPassword === undefined ? "keep" : "replace");
    if (action === "remove") encryptedPassword = null;
    if (action === "replace") encryptedPassword = input.serverPassword ? encryptSecret(input.serverPassword, this.masterSecret) : null;
    return {
      siteName,
      welcomeText,
      accessMode: input.accessMode,
      tsHost: target.host,
      tsPort: target.port,
      tsPasswordEncrypted: encryptedPassword,
    };
  }

  private importLegacyConfigOnce(): void {
    if (this.database.getMeta("legacy_config_checked") === "1") return;
    if (existsSync(this.legacyConfigPath)) {
      const legacy = loadConfig(this.legacyConfigPath);
      const current = this.database.getSettings();
      this.database.updateSettings({
        siteName: current.siteName,
        welcomeText: current.welcomeText,
        accessMode: current.accessMode,
        tsHost: legacy.tsHost,
        tsPort: legacy.tsPort,
        tsPasswordEncrypted: legacy.tsServerPassword ? encryptSecret(legacy.tsServerPassword, this.masterSecret) : null,
      }, "LEGACY_CONFIG_IMPORTED");
      this.database.setMeta("legacy_config_imported", "1");
      this.database.setMeta("legacy_import_notice_pending", "1");
      this.logger.info("Legacy config imported; WebSpeak settings are now managed from /admin");
    }
    this.database.setMeta("legacy_config_checked", "1");
  }
}

export class AdminInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AdminInputError";
  }
}
