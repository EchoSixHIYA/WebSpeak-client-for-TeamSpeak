import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type { Logger } from "../logger.js";
import { AdminService } from "./admin-service.js";
import { AdminSessionStore } from "./admin-session.js";
import { createAdminRouter } from "./admin-router.js";
import { WebSpeakDatabase } from "../persistence/database.js";
import { UpdateError, type UpdateService } from "../updater/update-service.js";
import type { UpdateCheckView, UpdateStatusView, UpdateTaskView } from "../shared/update.js";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };

const statusView: UpdateStatusView = {
  currentVersion: "0.3.2",
  deployment: {
    mode: "release-package", platform: "linux", architecture: "x64",
    applyAllowed: true, reasonCode: null, upgradePath: "release-package",
  },
  task: null,
};

const taskView: UpdateTaskView = {
  id: "upd_route_test", status: "restarting", fromVersion: "0.3.2", targetVersion: "0.4.0",
  startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", finishedAt: null,
  errorCode: null, errorMessage: null, rolledBack: false, steps: [],
};

const checkView: UpdateCheckView = {
  currentVersion: "0.3.2",
  releases: [{
    version: "0.4.0", tag: "v0.4.0", publishedAt: "2026-01-01T00:00:00.000Z",
    releaseUrl: "https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.4.0",
    assetName: "webspeak-webclient-v0.4.0-linux-x64.tar.gz", assetSize: 10,
    assetAvailable: true, hasChecksums: true, digest: null, canApply: true, blockedReason: null,
  }],
};

interface Fixture {
  origin: string;
  service: AdminService;
  database: WebSpeakDatabase;
  applyCalls: Array<[string, string]>;
  restarted: () => boolean;
  login(): Promise<{ cookie: string; csrf: string }>;
  post(route: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
}

async function fixture(t: TestContext, options: { updateService?: boolean } = {}): Promise<Fixture> {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-update-routes-"));
  const database = new WebSpeakDatabase(path.join(directory, "test.db"));
  const service = new AdminService(database, Buffer.alloc(32, 3), logger, path.join(directory, "absent.json"), undefined, "0.3.2");
  await service.initialize();
  await service.changePassword("test-only-admin-password");
  const applyCalls: Array<[string, string]> = [];
  let restarted = false;
  const updateService = {
    getStatus: () => statusView,
    checkForUpdates: async () => checkView,
    applyUpdate: async (version: string, confirmVersion: string) => {
      applyCalls.push([version, confirmVersion]);
      if (version !== confirmVersion) throw new UpdateError("UPDATE_CONFIRMATION_REQUIRED", "confirmation mismatch");
      return taskView;
    },
  } as unknown as UpdateService;
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter({
    service, sessions: new AdminSessionStore(), logger,
    getActiveSessions: () => 0, getPeakSessions: () => 0, startedAt: Date.now(), version: "0.3.2",
    ...(options.updateService === false ? {} : { updateService, restartAfterUpdate: () => { restarted = true; } }),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/admin${route}`, {
    method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const login = async () => {
    const response = await post("/login", { username: "admin", password: "test-only-admin-password" });
    assert.equal(response.status, 200);
    const body = await response.json() as { csrfToken: string };
    return { cookie: response.headers.get("set-cookie")!.split(";", 1)[0]!, csrf: body.csrfToken };
  };
  return { origin, service, database, applyCalls, restarted: () => restarted, login, post };
}

test("update routes require an authenticated session", async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.origin}/api/admin/update`)).status, 401);
  assert.equal((await f.post("/update/check", {})).status, 401);
  assert.equal((await f.post("/update/apply", { version: "0.4.0", confirmVersion: "0.4.0" })).status, 401);
});

test("update routes reject missing CSRF tokens and cross-origin requests", async t => {
  const f = await fixture(t);
  const { cookie, csrf } = await f.login();
  const noCsrf = await f.post("/update/check", {}, { cookie });
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json() as { code: string }).code, "CSRF_REJECTED");
  const crossOrigin = await fetch(`${f.origin}/api/admin/update/apply`, {
    method: "POST",
    headers: { origin: "https://evil.example", cookie, "x-csrf-token": csrf, "content-type": "application/json" },
    body: JSON.stringify({ version: "0.4.0", confirmVersion: "0.4.0" }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json() as { code: string }).code, "ORIGIN_REJECTED");
  const wrongType = await fetch(`${f.origin}/api/admin/update/check`, {
    method: "POST",
    headers: { origin: f.origin, cookie, "x-csrf-token": csrf, "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json() as { code: string }).code, "JSON_REQUIRED");
  assert.equal((await f.post("/update/check", {}, { cookie, "x-csrf-token": csrf })).status, 200);
});

test("apply requires version and confirmVersion to match before touching the service", async t => {
  const f = await fixture(t);
  const { cookie, csrf } = await f.login();
  const response = await f.post("/update/apply", { version: "0.4.0", confirmVersion: "0.4.1" }, { cookie, "x-csrf-token": csrf });
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { code: string }).code, "UPDATE_CONFIRMATION_REQUIRED");
  assert.deepEqual(f.applyCalls, []);
  const missing = await f.post("/update/apply", { version: "0.4.0" }, { cookie, "x-csrf-token": csrf });
  assert.equal(missing.status, 400);
  assert.deepEqual(f.applyCalls, []);
});

test("a confirmed apply returns the task and stops the process after the response", async t => {
  const f = await fixture(t);
  const { cookie, csrf } = await f.login();
  const response = await f.post("/update/apply", { version: "0.4.0", confirmVersion: "0.4.0" }, { cookie, "x-csrf-token": csrf });
  assert.equal(response.status, 202);
  const body = await response.json() as { ok: boolean; task: UpdateTaskView };
  assert.equal(body.ok, true);
  assert.equal(body.task.id, "upd_route_test");
  assert.deepEqual(f.applyCalls, [["0.4.0", "0.4.0"]]);
  assert.ok(f.database.recentAudit(10).some((event) => event.event === "ADMIN_UPDATE_STARTED"));
  await new Promise<void>((resolve) => setTimeout(resolve, 400));
  assert.equal(f.restarted(), true);
});

test("update status and check return the service projections", async t => {
  const f = await fixture(t);
  const { cookie, csrf } = await f.login();
  const status = await fetch(`${f.origin}/api/admin/update`, { headers: { cookie } });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), statusView);
  const check = await f.post("/update/check", {}, { cookie, "x-csrf-token": csrf });
  assert.equal(check.status, 200);
  assert.deepEqual(await check.json(), checkView);
});

test("deployments without an update service expose a read-only source status", async t => {
  const f = await fixture(t, { updateService: false });
  const { cookie, csrf } = await f.login();
  const status = await fetch(`${f.origin}/api/admin/update`, { headers: { cookie } });
  assert.equal(status.status, 200);
  const body = await status.json() as UpdateStatusView;
  assert.equal(body.deployment.mode, "source");
  assert.equal(body.deployment.applyAllowed, false);
  assert.equal(body.deployment.reasonCode, "UPDATE_UNAVAILABLE");
  assert.equal((await f.post("/update/check", {}, { cookie, "x-csrf-token": csrf })).status, 503);
  assert.equal((await f.post("/update/apply", { version: "0.4.0", confirmVersion: "0.4.0" }, { cookie, "x-csrf-token": csrf })).status, 503);
});
