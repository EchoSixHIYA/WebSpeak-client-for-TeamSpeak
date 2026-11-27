import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { encryptSecret, decryptSecret } from "../security/secret-crypto.js";
import { DATABASE_SCHEMA_VERSION, WebSpeakDatabase } from "./database.js";

test("voice overrides preserve schema 13 and survive an old binary updating ordinary settings", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-voice-rollback-"));
  const filename = path.join(directory, "webspeak.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = new WebSpeakDatabase(filename);
  const encrypted = encryptSecret("turn-test-secret-value", Buffer.alloc(32, 7), "webspeak:voice-turn-rest-secret:v1");
  database.updateSettings({ ...database.getSettings(), voiceProfile: "adaptive", voiceTurnUrls: "turn:turn.example.com:3478",
    voiceTurnSecretEncrypted: encrypted, voiceTurnTtlSeconds: 3600, voiceOpusWs: true, voiceJitterMaxMs: 200 });
  database.close();
  const legacy = new DatabaseSync(filename);
  try {
    const version = legacy.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(version.user_version, 13, "0.3.3 rejects any schema version above 13");
    assert.equal((legacy.prepare("PRAGMA table_info(settings)").all() as { name: string }[]).some(row => row.name.startsWith("voice_")), false);
    legacy.prepare("UPDATE settings SET site_name = ? WHERE id = 1").run("Updated by old binary");
  } finally { legacy.close(); }
  const reopened = new WebSpeakDatabase(filename);
  try {
    const settings = reopened.getSettings();
    assert.equal(settings.siteName, "Updated by old binary");
    assert.equal(settings.voiceProfile, "adaptive");
    assert.equal(settings.voiceTurnSecretEncrypted, encrypted);
    assert.equal(settings.voiceOpusWs, true);
    assert.equal(settings.voiceJitterMaxMs, 200);
    reopened.setMeta("voice_settings_v1", "invalid-json");
    assert.equal(reopened.getSettings().voiceProfile, null);
  } finally { reopened.close(); }
});

test("relay voice endpoint is stored by the current database migration", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-relay-db-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.sqlite"));
  context.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(DATABASE_SCHEMA_VERSION, 13);
  assert.equal(database.schemaVersion, DATABASE_SCHEMA_VERSION);
  assert.equal(database.getTsAdminSettings().transport, "web");
  assert.equal(database.getTsAdminSettings().enabled, false);
  database.replaceRelayNodes([{
    id: "de-relay",
    name: "Germany relay",
    enabled: true,
    host: "relay.example.com",
    port: 39087,
    voiceEndpoint: "https://relay.example.com",
    tokenEncrypted: null,
  }]);
  assert.equal(database.listRelayNodes()[0]?.voiceEndpoint, "https://relay.example.com");
});

test("schema 11 migration preserves encrypted SSH credentials and does not silently switch transport", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-ts-admin-migration-"));
  const filename = path.join(directory, "test.sqlite"), master = Buffer.alloc(32, 9);
  const encrypted = encryptSecret("fixture-ssh-password", master, "webspeak:ts-admin-query-password:v1");
  const original = new WebSpeakDatabase(filename);
  original.close();
  const old = new DatabaseSync(filename);
  old.exec("ALTER TABLE ts_admin_settings DROP COLUMN transport; ALTER TABLE ts_admin_settings DROP COLUMN query_host; ALTER TABLE ts_admin_settings DROP COLUMN web_query_url; ALTER TABLE ts_admin_settings DROP COLUMN api_key_encrypted; ALTER TABLE ts_admin_settings DROP COLUMN server_id; DROP TABLE workspace_invites; PRAGMA user_version = 11;");
  old.prepare("UPDATE ts_admin_settings SET enabled=1, query_port=10222, username='query-owner', password_encrypted=?, host_key_fingerprint=?").run(encrypted, `SHA256:${"A".repeat(43)}`);
  old.close();
  const migrated = new WebSpeakDatabase(filename);
  t.after(() => { migrated.close(); rmSync(directory, { recursive: true, force: true }); });
  const settings = migrated.getTsAdminSettings();
  assert.equal(migrated.schemaVersion, 13);
  assert.equal(settings.transport, "ssh"); assert.equal(settings.enabled, true);
  assert.equal(settings.queryPort, 10222); assert.equal(settings.username, "query-owner");
  assert.equal(settings.passwordEncrypted, encrypted);
  assert.equal(decryptSecret(settings.passwordEncrypted, master, "webspeak:ts-admin-query-password:v1"), "fixture-ssh-password");
  assert.equal(settings.apiKeyEncrypted, null); assert.equal(settings.webQueryUrl, ""); assert.equal(settings.serverId, 0);
});
