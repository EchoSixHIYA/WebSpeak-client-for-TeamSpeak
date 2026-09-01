import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSpeakDatabase, DATABASE_SCHEMA_VERSION } from "../src/persistence/database.js";
import { hashAdminPassword } from "../src/security/admin-password.js";

test("SQLite persistence initializes schema and stores the single admin/settings model", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-db-"));
  const dbPath = path.join(directory, "webspeak.db");
  const database = new WebSpeakDatabase(dbPath);
  assert.equal(database.schemaVersion, DATABASE_SCHEMA_VERSION);
  assert.equal(database.hasAdmin(), false);
  assert.equal(database.getSettings().accessMode, "fixed");

  const credential = await hashAdminPassword("database-admin-password");
  database.initializeAdmin(credential, {
    siteName: "Private Voice",
    welcomeText: "Welcome",
    accessMode: "open",
    tsHost: "voice.example.com",
    tsPort: 9988,
    tsPasswordEncrypted: "v1:ciphertext",
  });
  assert.equal(database.hasAdmin(), true);
  assert.equal(database.getAdminCredential()?.hash, credential.hash);
  assert.deepEqual(database.getSettings(), {
    siteName: "Private Voice",
    welcomeText: "Welcome",
    accessMode: "open",
    tsHost: "voice.example.com",
    tsPort: 9988,
    tsPasswordEncrypted: "v1:ciphertext",
    detectedProtocol: null,
    lastTestAt: null,
    lastTestLatencyMs: null,
    lastTestError: null,
    updatedAt: database.getSettings().updatedAt,
  });
  assert.equal(database.recentAudit()[0]?.event, "ADMIN_INITIALIZED");
  database.close();

  const reopened = new WebSpeakDatabase(dbPath);
  assert.equal(reopened.hasAdmin(), true);
  assert.equal(reopened.getSettings().siteName, "Private Voice");
  reopened.close();
});
