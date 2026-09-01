import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createAdminRouter } from "../src/admin/admin-router.js";
import { AdminService } from "../src/admin/admin-service.js";
import { AdminSessionStore } from "../src/admin/admin-session.js";
import { WebSpeakDatabase } from "../src/persistence/database.js";
import { BootstrapManager } from "../src/security/bootstrap.js";
import { loadOrCreateMasterSecret } from "../src/security/master-secret.js";
import { silentLogger } from "./helpers/logger.js";

test("admin API completes bootstrap, authentication, test, save, CSRF, and logout", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-admin-api-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const bootstrap = new BootstrapManager(path.join(directory, "bootstrap"));
  const service = new AdminService(
    database,
    loadOrCreateMasterSecret(path.join(directory, "master.key")),
    bootstrap,
    silentLogger,
    path.join(directory, "missing-config.json"),
    async (_target, password) => ({ ok: true, protocol: "ts6", latencyMs: 7, serverName: "Mock Server", requiresPassword: Boolean(password) }),
  );
  service.initialize();
  const bootstrapCode = bootstrap.ensure();

  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter({
    service,
    sessions: new AdminSessionStore(),
    logger: silentLogger,
    getActiveSessions: () => 2,
    getPeakSessions: () => 4,
    startedAt: Date.now() - 5000,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const status = await request(origin, "/api/admin/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.response.headers.get("cache-control"), "no-store");
  assert.equal(status.body.initialized, false);
  assert.equal("setupDefaults" in status.body, false);

  const rejectedDefaults = await request(origin, "/api/admin/setup/defaults", {
    method: "POST",
    body: { bootstrapCode: "not-the-bootstrap-code" },
  });
  assert.equal(rejectedDefaults.response.status, 403);
  assert.equal(rejectedDefaults.body.code, "INVALID_BOOTSTRAP");

  const defaults = await request(origin, "/api/admin/setup/defaults", {
    method: "POST",
    body: { bootstrapCode },
  });
  assert.equal(defaults.body.target, "127.0.0.1:9987");

  const tested = await request(origin, "/api/admin/setup/test", {
    method: "POST",
    body: { bootstrapCode, target: "voice.example.com:9987", serverPassword: "server-secret", passwordAction: "replace" },
  });
  assert.equal(tested.body.ok, true);
  assert.equal(tested.body.protocol, "ts6");

  const setup = await request(origin, "/api/admin/setup", {
    method: "POST",
    body: {
      bootstrapCode,
      adminPassword: "integration-admin-password",
      target: "voice.example.com:9987",
      serverPassword: "server-secret",
      passwordAction: "replace",
      accessMode: "fixed",
      siteName: "Integration WebSpeak",
      welcomeText: "Welcome",
    },
  });
  assert.equal(setup.response.status, 201);
  assert.equal(setup.body.ok, true);
  assert.equal(typeof setup.body.csrfToken, "string");
  const cookie = setup.response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie?.startsWith("webspeak_admin="));
  assert.match(setup.response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.match(setup.response.headers.get("set-cookie") ?? "", /SameSite=Strict/i);

  const session = await request(origin, "/api/admin/session", { cookie });
  assert.equal(session.body.authenticated, true);

  const overview = await request(origin, "/api/admin/overview", { cookie });
  assert.deepEqual(overview.body.sessions, { active: 2, peak: 4, limit: 100 });

  const rejectedMutation = await request(origin, "/api/admin/server", {
    method: "PUT",
    cookie,
    body: { target: "voice.example.com:9988", accessMode: "open", siteName: "Changed", welcomeText: "" },
  });
  assert.equal(rejectedMutation.response.status, 403);
  assert.equal(rejectedMutation.body.code, "CSRF_REJECTED");

  const saved = await request(origin, "/api/admin/server", {
    method: "PUT",
    cookie,
    csrf: setup.body.csrfToken,
    body: {
      target: "voice.example.com:9988",
      passwordAction: "remove",
      accessMode: "open",
      siteName: "Changed",
      welcomeText: "Open access",
    },
  });
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.settings.accessMode, "open");
  assert.equal(saved.body.settings.hasPassword, false);
  assert.equal("serverPassword" in saved.body.settings, false);

  const probe = await request(origin, "/api/admin/server/test", {
    method: "POST",
    cookie,
    csrf: setup.body.csrfToken,
    body: { target: "voice.example.com:9988", passwordAction: "remove" },
  });
  assert.equal(probe.body.protocol, "ts6");
  const settings = await request(origin, "/api/admin/server", { cookie });
  assert.equal(settings.body.detectedProtocol, "ts6");
  assert.equal(settings.body.lastTestLatencyMs, 7);

  const logout = await request(origin, "/api/admin/logout", { method: "POST", cookie, csrf: setup.body.csrfToken, body: {} });
  assert.equal(logout.body.ok, true);
  const denied = await request(origin, "/api/admin/overview", { cookie });
  assert.equal(denied.response.status, 401);
});

async function request(
  origin: string,
  pathname: string,
  options: { method?: string; body?: unknown; cookie?: string; csrf?: string } = {},
): Promise<{ response: Response; body: any }> {
  const method = options.method ?? "GET";
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      accept: "application/json",
      ...(method !== "GET" ? { "content-type": "application/json", origin } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.csrf ? { "x-csrf-token": options.csrf } : {}),
    },
    ...(method !== "GET" ? { body: JSON.stringify(options.body ?? {}) } : {}),
  });
  return { response, body: await response.json() };
}
