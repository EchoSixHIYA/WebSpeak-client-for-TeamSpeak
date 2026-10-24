import express from "express";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VoiceBridge, type VoiceBridgeOptions } from "./voice-bridge.js";
import type { Logger } from "../logger.js";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { formatTeamSpeakConnectionTarget, parseTeamSpeakConnectionTarget } from "../domain/teamspeak-connection-target.js";
import { resolveTeamSpeakTarget, TeamSpeakAliasLookupError } from "./teamspeak-alias.js";
import { createAdminRouter } from "../admin/admin-router.js";
import type { AdminService } from "../admin/admin-service.js";
import { AdminSessionStore } from "../admin/admin-session.js";
import { isSafeOpenTargetForPrefill, resolveSafeOpenTarget, TeamSpeakTargetResolutionError } from "../security/open-target-policy.js";
import { parseIdentity } from "@honeybbq/teamspeak/client";
import { JoinRateLimiter } from "./join-rate-limit.js";
import type { ConfiguredAccelerationRelay } from "./acceleration-relay.js";
import { createVoiceGatewayAuthHeaders, type DelegatedVoiceSession } from "./voice-gateway-auth.js";
import type { SkinRegistry } from "../admin/skin-registry.js";
import { resolveVisitorTotal } from "./visitor-count.js";
import type { PluginRegistry } from "../plugins/registry.js";

export interface WebServerOptions {
  port: number;
  version?: string;
  logFile?: string;
  staticDir?: string;
  certDir?: string; // path to cert.pem + key.pem for HTTPS
  voiceBridgeOptions: VoiceBridgeOptions;
  adminService: AdminService;
  skinRegistry?: SkinRegistry;
  pluginRegistry?: PluginRegistry;
  logger: Logger;
  nextVisitorNumber?: () => number;
  visitorCount?: () => number;
}

export interface WebServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const VISITOR_NUMBER_COOKIE = "webspeak_visitor_number";

export function createWebServer(options: WebServerOptions): WebServer {
  const app = express();
  const logger = options.logger.child({ component: "web" });

  let server: ReturnType<typeof createHttpsServer> | ReturnType<typeof createHttpServer>;

  if (options.certDir) {
    const cert = readFileSync(path.join(options.certDir, "cert.pem"));
    const key = readFileSync(path.join(options.certDir, "key.pem"));
    server = createHttpsServer({ cert, key }, app);
    logger.info("HTTPS enabled");
  } else {
    server = createHttpServer(app);
  }

  app.use("/api/admin/plugins/upload", express.json({ limit: "600kb" }));
  app.use(express.json({ limit: "100kb" }));

  const voiceBridge = new VoiceBridge({ ...options.voiceBridgeOptions, pluginRegistry: options.pluginRegistry }, logger);
  const adminSessions = new AdminSessionStore();
  const joinRateLimiter = new JoinRateLimiter();
  const startedAt = Date.now();

  const healthHandler: express.RequestHandler = (_request, response) => {
    response.json({ status: "ok", version: options.version ?? "0.1.0" });
  };
  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);

  app.get("/api/public-config", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const acceleration = resolveAccelerationOptions(options.voiceBridgeOptions.acceleration);
    let visitorNumber = readVisitorNumberCookie(request.header("cookie"));
    if (visitorNumber === null && options.nextVisitorNumber) {
      try {
        visitorNumber = options.nextVisitorNumber();
        response.setHeader(
          "Set-Cookie",
          `${VISITOR_NUMBER_COOKIE}=${visitorNumber}; Max-Age=31536000; Path=/; SameSite=Lax${options.certDir ? "; Secure" : ""}`,
        );
      } catch (error: unknown) {
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Visitor number could not be assigned");
      }
    }
    let visitorTotal = resolveVisitorTotal(visitorNumber, null);
    if (options.visitorCount) {
      try {
        visitorTotal = resolveVisitorTotal(visitorNumber, options.visitorCount());
      } catch (error: unknown) {
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Visitor total could not be read");
      }
    } else if (visitorNumber !== null) {
      visitorTotal = visitorNumber;
    }
    const publicConfig = options.adminService.getPublicConfig();
    let target = typeof publicConfig.target === "string" ? publicConfig.target : "";
    let targetPrefillBlocked = false;
    if (publicConfig.accessMode === "open" && target.trim()) {
      try {
        targetPrefillBlocked = !await isSafeOpenTargetForPrefill(await resolveTeamSpeakTarget(target));
      } catch {
        targetPrefillBlocked = true;
      }
      if (targetPrefillBlocked) target = "";
    }
    response.json({
      ...publicConfig,
      target,
      targetPrefillBlocked,
      ...(visitorNumber === null ? {} : { visitorNumber }),
      ...(visitorTotal === null ? {} : { visitorTotal }),
      accelerationAvailable: acceleration.length > 0,
      accelerationRelays: acceleration.map((relay) => ({ id: relay.id, name: relay.name })),
    });
  });

  app.get("/api/skins", async (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.json({
      skins: await options.skinRegistry?.list() ?? [],
      defaultSkinId: await options.skinRegistry?.getDefaultSkinId() ?? "builtin.light",
    });
  });

  app.get("/api/skins/:id/package", async (request, response) => {
    const id = typeof request.params.id === "string" ? request.params.id : "";
    const archive = await options.skinRegistry?.readArchive(id);
    if (!archive) {
      response.status(404).json({ ok: false, code: "SKIN_NOT_FOUND" });
      return;
    }
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Disposition", `attachment; filename="${id}.wskin"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(archive);
  });

  app.get("/api/skins/:id/preview", async (request, response) => {
    const id = typeof request.params.id === "string" ? request.params.id : "";
    const preview = await options.skinRegistry?.readPreview(id);
    if (!preview) {
      response.status(404).end();
      return;
    }
    response.setHeader("Cache-Control", "public, max-age=300");
    response.setHeader("Content-Type", preview.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(preview.bytes);
  });

  app.post("/api/join-ticket", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!request.is("application/json") || !isSameOrigin(request)) {
      response.status(403).json({ ok: false, code: "ORIGIN_REJECTED" });
      return;
    }
    if (!options.adminService.isInitialized()) {
      response.status(503).json({ ok: false, code: "NOT_INITIALIZED" });
      return;
    }
    if (!joinRateLimiter.allow(request.socket.remoteAddress ?? "unknown")) {
      response.status(429).json({ ok: false, code: "RATE_LIMITED" });
      return;
    }
    const body = isRecord(request.body) ? request.body : {};
    const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 30) : "";
    const requestedChannel = typeof body.channel === "string" ? body.channel.trim().slice(0, 100) : "";
    const inviteToken = typeof body.invite === "string" ? body.invite.trim().slice(0, 128) : "";
    const requestedIdentity = typeof body.identity === "string" && body.identity.length <= 8192 ? body.identity : "";
    let identity: string | undefined;
    if (requestedIdentity) {
      try {
        parseIdentity(requestedIdentity);
        identity = requestedIdentity;
      } catch {
        // A stale/corrupt local identity must not block a normal ephemeral join.
      }
    }
    if (!nickname) {
      response.status(400).json({ ok: false, code: "INVALID_NICKNAME" });
      return;
    }

    const policy = options.adminService.getConnectionPolicy();
    const managedInvite = inviteToken ? options.adminService.getManagedInvite(inviteToken) : null;
    if (inviteToken && !managedInvite) {
      response.status(400).json({ ok: false, code: "INVITE_INVALID" });
      return;
    }
    let targetText = managedInvite?.target ?? policy.defaultTarget;
    let target: TeamSpeakTarget;
    let serverPassword = policy.serverPassword;
    const channel = requestedChannel || managedInvite?.channel || "";
    const requestedRelayId = typeof body.accelerationRelayId === "string" ? body.accelerationRelayId.trim().slice(0, 110) : "";
    const accelerationRequested = body.accelerated === true || Boolean(requestedRelayId);
    const acceleration = resolveAccelerationOptions(options.voiceBridgeOptions.acceleration);
    if (accelerationRequested && acceleration.length === 0) {
      response.status(400).json({ ok: false, code: "ACCELERATION_UNAVAILABLE" });
      return;
    }
    if (requestedRelayId && !acceleration.some((relay) => relay.id === requestedRelayId)) {
      response.status(400).json({ ok: false, code: "ACCELERATION_UNAVAILABLE" });
      return;
    }
    try {
      if (!managedInvite) {
        if (policy.accessMode === "open" && typeof body.target === "string" && body.target.trim()) {
          targetText = formatTeamSpeakConnectionTarget(parseTeamSpeakConnectionTarget(body.target));
          const isDefault = targetText === policy.defaultTarget;
          if (!isDefault) serverPassword = typeof body.serverPassword === "string" ? body.serverPassword.slice(0, 512) : "";
          else if (typeof body.serverPassword === "string" && body.serverPassword.trim()) serverPassword = body.serverPassword.slice(0, 512);
        } else if (policy.accessMode === "fixed" && typeof body.serverPassword === "string" && body.serverPassword.trim()) {
          // The fixed target remains administrator-controlled, but a user may
          // retry its server password after the gateway reports that one is
          // required. The target itself is never taken from this request.
          serverPassword = body.serverPassword.slice(0, 512);
        }
      }
      target = await resolveTeamSpeakTarget(targetText);
      // Open-mode defaults are user targets too; validate the resolved address
      // and pass that exact IP to the voice connection to prevent DNS rebinding.
      if (!managedInvite && policy.accessMode === "open") target = await resolveSafeOpenTarget(target);
    } catch (error) {
      response.status(400).json({ ok: false, code: error instanceof TeamSpeakAliasLookupError || error instanceof TeamSpeakTargetResolutionError ? "HOST_NOT_FOUND" : "TARGET_NOT_ALLOWED" });
      return;
    }

    if (inviteToken) {
      const consumedInvite = options.adminService.consumeManagedInvite(inviteToken);
      if (!consumedInvite) {
        response.status(400).json({ ok: false, code: "INVITE_INVALID" });
        return;
      }
      serverPassword = consumedInvite.serverPassword;
    }

    const sessionPayload: DelegatedVoiceSession = {
      target,
      serverPassword,
      nickname,
      ...(channel ? { channel } : {}),
      ...(identity ? { identity, rememberIdentity: true } : body.rememberIdentity === true ? { rememberIdentity: true } : {}),
    };
    const selectedRelay = accelerationRequested
      ? requestedRelayId ? acceleration.find((relay) => relay.id === requestedRelayId) : acceleration[0]
      : undefined;
    if (selectedRelay?.voiceEndpoint) {
      try {
        const ticket = await createRemoteVoiceTicket(selectedRelay, sessionPayload);
        response.status(201).json({ ok: true, ticket, voiceEndpoint: selectedRelay.voiceEndpoint });
        return;
      } catch (error: unknown) {
        logger.warn({ relayId: selectedRelay.id, err: error instanceof Error ? error.message : String(error) }, "Relay voice gateway ticket request failed; using legacy UDP acceleration");
      }
    }

    const ticket = options.voiceBridgeOptions.joinTickets.create({
      ...sessionPayload,
      ...(accelerationRequested && selectedRelay ? { accelerated: true, accelerationRelayId: selectedRelay.id } : {}),
    });
    response.status(201).json({ ok: true, ticket });
  });

  app.use("/api/admin", createAdminRouter({
    service: options.adminService,
    sessions: adminSessions,
    logger,
    getActiveSessions: () => voiceBridge.getActiveCount(),
    getPeakSessions: () => voiceBridge.getPeakCount(),
    getCreatedSessions: () => voiceBridge.getCreatedCount(),
    getSessionSummaries: () => voiceBridge.getSessionSummaries(),
    terminateSession: (id) => voiceBridge.terminateSession(id),
    skinRegistry: options.skinRegistry,
    pluginRegistry: options.pluginRegistry,
    version: options.version,
    logFile: options.logFile,
    startedAt,
  }));

  // Serve static frontend
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api|\/ws)/, (_req, res) => {
      res.sendFile(path.join(options.staticDir!, "index.html"));
    });
  }

  voiceBridge.attach(server);

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(options.port, () => {
          logger.info({ port: options.port }, "Web server started");
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      await voiceBridge.shutdown();
      adminSessions.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function resolveAccelerationOptions(
  configured: ConfiguredAccelerationRelay[] | (() => ConfiguredAccelerationRelay[]) | undefined,
): ConfiguredAccelerationRelay[] {
  const value = typeof configured === "function" ? configured() : configured;
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function createRemoteVoiceTicket(relay: ConfiguredAccelerationRelay, payload: DelegatedVoiceSession): Promise<string> {
  const endpoint = new URL("/api/relay/voice-ticket", relay.voiceEndpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...createVoiceGatewayAuthHeaders(relay.token, payload),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Relay voice gateway returned HTTP ${response.status}`);
  const result: unknown = await response.json().catch(() => null);
  if (!isRecord(result) || result.ok !== true || typeof result.ticket !== "string" || result.ticket.length < 16) {
    throw new Error("Relay voice gateway returned an invalid ticket");
  }
  return result.ticket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readVisitorNumberCookie(header: string | undefined): number | null {
  if (!header) return null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    if (name !== VISITOR_NUMBER_COOKIE) continue;
    const rawValue = entry.slice(separator + 1).trim();
    const number = Number.parseInt(rawValue, 10);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  return null;
}

function isSameOrigin(request: express.Request): boolean {
  const origin = request.header("origin");
  const host = request.header("host");
  try {
    return Boolean(origin && host && new URL(origin).host === host);
  } catch {
    return false;
  }
}
