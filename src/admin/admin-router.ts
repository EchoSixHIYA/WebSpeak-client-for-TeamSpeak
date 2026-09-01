import { Router, type NextFunction, type Request, type Response } from "express";
import type { Logger } from "../logger.js";
import { AdminInputError, AdminService, type AdminSettingsInput } from "./admin-service.js";
import { AdminSessionStore, isSecureRequest } from "./admin-session.js";
import { AdminLoginRateLimiter, waitFor } from "./login-rate-limit.js";
import { TeamSpeakProbeError } from "../server/teamspeak-probe.js";

export interface AdminRouterOptions {
  service: AdminService;
  sessions: AdminSessionStore;
  logger: Logger;
  getActiveSessions(): number;
  getPeakSessions(): number;
  startedAt: number;
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();
  const limiter = new AdminLoginRateLimiter();
  const logger = options.logger.child({ component: "admin-api" });

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/status", (_request, response) => {
    response.json({ initialized: options.service.isInitialized() });
  });

  router.get("/session", (request, response) => {
    const session = options.sessions.get(request);
    response.json({
      initialized: options.service.isInitialized(),
      authenticated: Boolean(session),
      mustChangePassword: Boolean(session) && options.service.isPasswordChangeRequired(),
      ...(session ? { csrfToken: session.csrfToken, expiresAt: session.expiresAt } : {}),
    });
  });

  router.post("/login", requireSameOrigin, async (request, response) => {
    if (!options.service.isInitialized()) {
      response.status(409).json({ ok: false, code: "NOT_INITIALIZED" });
      return;
    }
    const peer = request.socket.remoteAddress ?? "unknown";
    const retryAfterMs = limiter.retryAfterMs(peer);
    if (retryAfterMs > 0) {
      response.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      response.status(429).json({ ok: false, code: "RATE_LIMITED", retryAfterMs });
      return;
    }
    const body = asRecord(request.body);
    const username = readString(body, "username", 64).trim();
    const password = readOptionalString(body, "password", 1024);
    if (!await options.service.verifyPassword(username, password)) {
      const delayMs = limiter.recordFailure(peer);
      await waitFor(delayMs);
      options.service.database.addAudit("ADMIN_LOGIN_FAILED");
      logger.warn("Administrator login failed");
      response.status(401).json({ ok: false, code: "INVALID_PASSWORD" });
      return;
    }
    limiter.recordSuccess(peer);
    options.service.database.addAudit("ADMIN_LOGIN_SUCCEEDED");
    const session = options.sessions.create(response, isSecureRequest(request));
    response.json({ ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt, mustChangePassword: options.service.isPasswordChangeRequired() });
  });

  router.post("/change-password", requireSameOrigin, requireCsrf(options.sessions), async (request, response) => {
    try {
      const body = asRecord(request.body);
      await options.service.changePassword(readString(body, "newPassword", 1024));
      response.json({ ok: true, mustChangePassword: false });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.post("/logout", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    options.sessions.destroy(request, response, isSecureRequest(request));
    options.service.database.addAudit("ADMIN_LOGOUT");
    response.json({ ok: true });
  });

  router.use(requireAdmin(options.sessions, options.service));

  router.get("/overview", (_request, response) => {
    response.json(options.service.getOverview(
      options.getActiveSessions(),
      options.getPeakSessions(),
      options.startedAt,
    ));
  });

  router.get("/server", (_request, response) => {
    response.json(options.service.getAdminSettings());
  });

  router.put("/server", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    try {
      options.service.updateSettings(readSettingsInput(asRecord(request.body)));
      response.json({ ok: true, settings: options.service.getAdminSettings() });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.post("/server/test", requireSameOrigin, requireCsrf(options.sessions), async (request, response) => {
    const body = asRecord(request.body);
    const action = readPasswordAction(body.passwordAction);
    const password = action === "remove"
      ? ""
      : typeof body.serverPassword === "string"
        ? body.serverPassword.slice(0, 512)
        : options.service.getConnectionPolicy().serverPassword;
    await runProbe(options.service, response, readString(body, "target", 300), password, true);
  });

  router.post("/legacy-import/dismiss", requireSameOrigin, requireCsrf(options.sessions), (_request, response) => {
    options.service.dismissLegacyImportNotice();
    response.json({ ok: true });
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendAdminError(response, error);
  });

  return router;
}

function requireAdmin(sessions: AdminSessionStore, service: AdminService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!sessions.get(request)) {
      response.status(401).json({ ok: false, code: "AUTH_REQUIRED" });
      return;
    }
    if (service.isPasswordChangeRequired()) {
      response.status(403).json({ ok: false, code: "PASSWORD_CHANGE_REQUIRED" });
      return;
    }
    next();
  };
}

function requireCsrf(sessions: AdminSessionStore) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const session = sessions.get(request);
    const csrf = request.header("x-csrf-token");
    if (!session || !csrf || csrf !== session.csrfToken) {
      response.status(403).json({ ok: false, code: "CSRF_REJECTED" });
      return;
    }
    next();
  };
}

function requireSameOrigin(request: Request, response: Response, next: NextFunction): void {
  if (!request.is("application/json")) {
    response.status(415).json({ ok: false, code: "JSON_REQUIRED" });
    return;
  }
  const origin = request.header("origin");
  const host = request.header("host");
  try {
    if (!origin || !host || new URL(origin).host !== host) throw new Error("origin mismatch");
  } catch {
    response.status(403).json({ ok: false, code: "ORIGIN_REJECTED" });
    return;
  }
  next();
}

async function runProbe(
  service: AdminService,
  response: Response,
  target: string,
  password: string,
  persistResult: boolean,
): Promise<void> {
  try {
    response.json(await service.testConnection(target, password, persistResult));
  } catch (error: unknown) {
    if (error instanceof TeamSpeakProbeError) {
      response.status(400).json({ ok: false, code: error.code });
      return;
    }
    sendAdminError(response, error);
  }
}

function readSettingsInput(body: Record<string, unknown>): AdminSettingsInput {
  return {
    target: readString(body, "target", 300),
    serverPassword: typeof body.serverPassword === "string" ? body.serverPassword.slice(0, 512) : undefined,
    passwordAction: readPasswordAction(body.passwordAction),
    accessMode: body.accessMode === "open" ? "open" : body.accessMode === "fixed" ? "fixed" : body.accessMode as never,
    siteName: readString(body, "siteName", 80),
    welcomeText: readOptionalString(body, "welcomeText", 500),
  };
}

function readPasswordAction(value: unknown): "keep" | "replace" | "remove" {
  return value === "replace" || value === "remove" ? value : "keep";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminInputError("INVALID_REQUEST", "Request body is invalid");
  return value as Record<string, unknown>;
}

function readString(body: Record<string, unknown>, key: string, max: number): string {
  if (typeof body[key] !== "string" || body[key].length > max) throw new AdminInputError("INVALID_REQUEST", `${key} is invalid`);
  return body[key];
}

function readOptionalString(body: Record<string, unknown>, key: string, max: number): string {
  return typeof body[key] === "string" ? body[key].slice(0, max) : "";
}

function sendAdminError(response: Response, error: unknown): void {
  if (error instanceof AdminInputError) {
    response.status(400).json({ ok: false, code: error.code });
    return;
  }
  response.status(500).json({ ok: false, code: "INTERNAL_ERROR" });
}
