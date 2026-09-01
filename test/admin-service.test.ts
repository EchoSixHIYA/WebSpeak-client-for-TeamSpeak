import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AdminService } from "../src/admin/admin-service.js";
import { WebSpeakDatabase } from "../src/persistence/database.js";
import { BootstrapManager } from "../src/security/bootstrap.js";
import { loadOrCreateMasterSecret } from "../src/security/master-secret.js";
import { silentLogger } from "./helpers/logger.js";

test("legacy config imports once, remains untouched, and setup consumes bootstrap", async () => {
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
  const bootstrap = new BootstrapManager(path.join(directory, "bootstrap"));
  const service = new AdminService(
    database,
    loadOrCreateMasterSecret(path.join(directory, "master.key")),
    bootstrap,
    silentLogger,
    legacyPath,
    async () => ({ ok: true, protocol: "ts6", latencyMs: 4, serverName: "Mock TS", requiresPassword: true }),
  );
  service.initialize();

  assert.equal(readFileSync(legacyPath, "utf8"), legacyText);
  assert.equal(database.getSettings().tsHost, "legacy.example.com");
  assert.equal(database.getSettings().tsPort, 9988);
  assert.equal(service.getConnectionPolicy().serverPassword, "legacy-secret-value");
  assert.equal(readFileSync(path.join(directory, "webspeak.db")).includes(Buffer.from("legacy-secret-value")), false);
  assert.equal(service.getSetupDefaults().legacyConfigImported, true);

  const code = bootstrap.ensure();
  await service.setup({
    bootstrapCode: code,
    adminPassword: "a-secure-admin-password",
    target: "[2001:db8::10]:9989",
    passwordAction: "keep",
    accessMode: "fixed",
    siteName: "My WebSpeak",
    welcomeText: "Hello everyone",
  });
  assert.equal(service.isInitialized(), true);
  assert.equal(await service.verifyPassword("a-secure-admin-password"), true);
  assert.equal(await service.verifyPassword("not-the-password"), false);
  assert.equal(service.getPublicConfig().accessMode, "fixed");
  assert.equal("target" in service.getPublicConfig(), false);

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
