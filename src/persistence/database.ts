import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AdminCredential } from "../security/admin-password.js";
import type { TeamSpeakProtocol } from "../server/teamspeak-adapter.js";

export const DATABASE_SCHEMA_VERSION = 1;
export type AccessMode = "fixed" | "open";

export interface PersistedSettings {
  siteName: string;
  welcomeText: string;
  accessMode: AccessMode;
  tsHost: string;
  tsPort: number;
  tsPasswordEncrypted: string | null;
  detectedProtocol: TeamSpeakProtocol | null;
  lastTestAt: string | null;
  lastTestLatencyMs: number | null;
  lastTestError: string | null;
  updatedAt: string;
}

export interface SettingsUpdate {
  siteName: string;
  welcomeText: string;
  accessMode: AccessMode;
  tsHost: string;
  tsPort: number;
  tsPasswordEncrypted: string | null;
}

interface SettingsRow extends Record<string, unknown> {
  site_name: string;
  welcome_text: string;
  access_mode: string;
  ts_host: string;
  ts_port: number;
  ts_password_encrypted: string | null;
  detected_protocol: string | null;
  last_test_at: string | null;
  last_test_latency_ms: number | null;
  last_test_error: string | null;
  updated_at: string;
}

export class WebSpeakDatabase {
  private readonly database: DatabaseSync;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    const existed = existsSync(path);
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate(existed);
  }

  close(): void {
    this.database.close();
  }

  get schemaVersion(): number {
    return Number((this.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  }

  hasAdmin(): boolean {
    return Boolean(this.database.prepare("SELECT 1 AS present FROM admin_credentials WHERE id = 1").get());
  }

  getAdminCredential(): AdminCredential | null {
    const row = this.database.prepare("SELECT credential_json FROM admin_credentials WHERE id = 1").get() as { credential_json?: string } | undefined;
    if (!row?.credential_json) return null;
    return JSON.parse(row.credential_json) as AdminCredential;
  }

  initializeAdmin(credential: AdminCredential, settings: SettingsUpdate): void {
    this.transaction(() => {
      if (this.hasAdmin()) throw new Error("WebSpeak is already initialized");
      const now = new Date().toISOString();
      this.database.prepare(
        "INSERT INTO admin_credentials (id, credential_json, created_at, updated_at) VALUES (1, ?, ?, ?)",
      ).run(JSON.stringify(credential), now, now);
      this.writeSettings(settings, now);
      this.insertAudit("ADMIN_INITIALIZED", { accessMode: settings.accessMode, target: `${settings.tsHost}:${settings.tsPort}` }, now);
    });
  }

  getSettings(): PersistedSettings {
    const row = this.database.prepare("SELECT * FROM settings WHERE id = 1").get() as SettingsRow;
    return {
      siteName: row.site_name,
      welcomeText: row.welcome_text,
      accessMode: row.access_mode === "open" ? "open" : "fixed",
      tsHost: row.ts_host,
      tsPort: row.ts_port,
      tsPasswordEncrypted: row.ts_password_encrypted,
      detectedProtocol: row.detected_protocol === "ts3" || row.detected_protocol === "ts6" ? row.detected_protocol : null,
      lastTestAt: row.last_test_at,
      lastTestLatencyMs: row.last_test_latency_ms,
      lastTestError: row.last_test_error,
      updatedAt: row.updated_at,
    };
  }

  updateSettings(settings: SettingsUpdate, auditEvent = "SETTINGS_CHANGED"): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.writeSettings(settings, now);
      this.insertAudit(auditEvent, { accessMode: settings.accessMode, target: `${settings.tsHost}:${settings.tsPort}` }, now);
    });
  }

  recordConnectionTest(result: {
    protocol: TeamSpeakProtocol | null;
    latencyMs: number | null;
    error: string | null;
  }): void {
    this.database.prepare(
      `UPDATE settings
       SET detected_protocol = ?, last_test_at = ?, last_test_latency_ms = ?, last_test_error = ?
       WHERE id = 1`,
    ).run(result.protocol, new Date().toISOString(), result.latencyMs, result.error);
  }

  clearConnectionTest(): void {
    this.database.exec(
      "UPDATE settings SET detected_protocol = NULL, last_test_at = NULL, last_test_latency_ms = NULL, last_test_error = NULL WHERE id = 1",
    );
  }

  getMeta(key: string): string | null {
    const row = this.database.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.database.prepare(
      "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }

  addAudit(event: string, details: Record<string, unknown> = {}): void {
    this.insertAudit(event, details, new Date().toISOString());
  }

  recentAudit(limit = 8): Array<{ event: string; createdAt: string }> {
    const normalizedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.database.prepare(
      "SELECT event, created_at FROM audit_events ORDER BY id DESC LIMIT ?",
    ).all(normalizedLimit) as Array<{ event: string; created_at: string }>;
    return rows.map((row) => ({ event: row.event, createdAt: row.created_at }));
  }

  private migrate(existed: boolean): void {
    const version = this.schemaVersion;
    if (version > DATABASE_SCHEMA_VERSION) {
      throw new Error(`Database schema ${version} is newer than this WebSpeak build`);
    }
    if (version === DATABASE_SCHEMA_VERSION) return;
    if (existed && version > 0) {
      copyFileSync(this.path, `${this.path}.schema-${version}.bak`);
    }
    this.transaction(() => {
      if (version === 0) {
        this.database.exec(`
          CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
          CREATE TABLE admin_credentials (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            credential_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            site_name TEXT NOT NULL,
            welcome_text TEXT NOT NULL,
            access_mode TEXT NOT NULL CHECK (access_mode IN ('fixed', 'open')),
            ts_host TEXT NOT NULL,
            ts_port INTEGER NOT NULL CHECK (ts_port BETWEEN 1 AND 65535),
            ts_password_encrypted TEXT,
            detected_protocol TEXT CHECK (detected_protocol IS NULL OR detected_protocol IN ('ts3', 'ts6')),
            last_test_at TEXT,
            last_test_latency_ms INTEGER,
            last_test_error TEXT,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            details_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `);
        const now = new Date().toISOString();
        this.database.prepare(
          `INSERT INTO settings (
             id, site_name, welcome_text, access_mode, ts_host, ts_port,
             ts_password_encrypted, detected_protocol, last_test_at,
             last_test_latency_ms, last_test_error, updated_at
           ) VALUES (1, 'WebSpeak', '', 'fixed', '127.0.0.1', 9987, NULL, NULL, NULL, NULL, NULL, ?)`,
        ).run(now);
        this.database.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION}`);
      }
    });
  }

  private writeSettings(settings: SettingsUpdate, now: string): void {
    this.database.prepare(
      `UPDATE settings SET
         site_name = ?, welcome_text = ?, access_mode = ?, ts_host = ?, ts_port = ?,
         ts_password_encrypted = ?, updated_at = ?
       WHERE id = 1`,
    ).run(
      settings.siteName,
      settings.welcomeText,
      settings.accessMode,
      settings.tsHost,
      settings.tsPort,
      settings.tsPasswordEncrypted,
      now,
    );
  }

  private insertAudit(event: string, details: Record<string, unknown>, now: string): void {
    this.database.prepare(
      "INSERT INTO audit_events (event, details_json, created_at) VALUES (?, ?, ?)",
    ).run(event, JSON.stringify(details), now);
  }

  private transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
