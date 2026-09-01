import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AdminService } from "../src/admin/admin-service.js";
import { WebSpeakDatabase } from "../src/persistence/database.js";
import { loadOrCreateMasterSecret } from "../src/security/master-secret.js";
import { silentLogger } from "./helpers/logger.js";

test("legacy config imports once, seeds the default admin, and allows password rotation", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-admin-service-"));
  const legacyPath = path.join(directory, "config.json");
  const legacyText = JSON.stringify({
    tsHost: "legacy.example.com",
    tsPort: 9988,
    tsServerPassword: "legacy-secret-value",
    tsServerProtocol: "ts6",
    maxClients: 9000,
    port: 9999,
    trustProxy: true,
  }, null, 2);
  writeFileSync(legacyPath, legacyText);
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const service = new AdminService(
    database,
    loadOrCreateMasterSecret(path.join(directory, "master.key")),
    silentLogger,
    legacyPath,
    async () => ({ ok: true, protocol: "ts6", latencyMs: 4, serverName: "Mock TS", requiresPassword: true }),
  );
  await service.initialize();

  assert.equal(readFileSync(legacyPath, "utf8"), legacyText);
  assert.equal(database.getSettings().tsHost, "legacy.example.com");
  assert.equal(database.getSettings().tsPort, 9988);
  assert.equal(service.getConnectionPolicy().serverPassword, "legacy-secret-value");
  assert.equal(readFileSync(path.join(directory, "webspeak.db")).includes(Buffer.from("legacy-secret-value")), false);
  assert.equal(service.isInitialized(), true);
  assert.equal(await service.verifyPassword("admin", "admin"), true);
  assert.equal(await service.verifyPassword("wrong-user", "admin"), false);
  assert.equal(service.isPasswordChangeRequired(), true);
  await service.changePassword("a-secure-admin-password");
  assert.equal(await service.verifyPassword("admin", "a-secure-admin-password"), true);
  assert.equal(await service.verifyPassword("admin", "admin"), false);
  assert.equal(service.isPasswordChangeRequired(), false);
  assert.equal(service.getPublicConfig().accessMode, "fixed");
  assert.equal(service.getPublicConfig().target, "legacy.example.com:9988");

  service.updateSettings({
    target: "public.example.com:9987",
    serverPassword: "replacement-secret",
    passwordAction: "replace",
    accessMode: "open",
    siteName: "Open WebSpeak",
    welcomeText: "Public gateway",
  });
  const publicConfig = service.getPublicConfig();
  assert.equal(publicConfig.target, "public.example.com:9987");
  assert.equal(publicConfig.accessMode, "open");
  assert.equal("serverPassword" in service.getAdminSettings(), false);
  assert.equal(service.getAdminSettings().hasPassword, true);
  assert.equal(service.getConnectionPolicy().serverPassword, "replacement-secret");
  database.close();
});
