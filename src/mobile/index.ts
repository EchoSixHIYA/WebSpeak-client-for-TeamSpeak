import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { parseIdentity } from "@honeybbq/teamspeak/client";
import { createLogger } from "../logger.js";
import { parseTeamSpeakTarget } from "../domain/teamspeak-target.js";
import { JoinTicketStore } from "../server/join-ticket.js";
import { JoinRateLimiter } from "../server/join-rate-limit.js";
import { VoiceBridge } from "../server/voice-bridge.js";
import { DEFAULT_WELCOME_TEXTS } from "../site-copy.js";

const port = Number(process.env.WEBSPEAK_MOBILE_PORT || 3040);
const host = "127.0.0.1";
const dataDir = process.env.WEBSPEAK_DATA_DIR;
const staticDir = process.env.WEBSPEAK_MOBILE_WWW;
if (!dataDir || !staticDir || !existsSync(path.join(staticDir, "index.html"))) {
  throw new Error("Android gateway data or web assets are missing");
}

const logger = createLogger(path.join(dataDir, "logs"));
const app = express();
const server = createServer(app);
const joinTickets = new JoinTicketStore();
const joinRateLimiter = new JoinRateLimiter();
const voiceBridge = new VoiceBridge({ joinTickets, webRtc: { enabled: false } }, logger);

app.use(express.json({ limit: "100kb" }));
app.get("/health", (_request, response) => response.json({ status: "ok", engine: "webspeak-android" }));
app.get("/api/health", (_request, response) => response.json({ status: "ok", engine: "webspeak-android" }));
app.get("/api/public-config", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({
    version: process.env.WEBSPEAK_VERSION ?? "0.2.6",
    initialized: true,
    siteName: "WebSpeak",
    welcomeText: DEFAULT_WELCOME_TEXTS.zh,
    welcomeTextEn: DEFAULT_WELCOME_TEXTS.en,
    welcomeTexts: DEFAULT_WELCOME_TEXTS,
    accessMode: "open",
    target: "",
    targetPrefillBlocked: false,
    accelerationAvailable: false,
    accelerationRelays: [],
    mobile: true,
  });
});
app.get("/api/skins", (_request, response) => {
  response.setHeader("Cache-Control", "no-cache");
  response.json({ skins: [], defaultSkinId: "builtin.light" });
});
app.post("/api/join-ticket", (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (!request.is("application/json") || !isSameOrigin(request)) {
    response.status(403).json({ ok: false, code: "ORIGIN_REJECTED" });
    return;
  }
  if (!joinRateLimiter.allow(request.socket.remoteAddress ?? "unknown")) {
    response.status(429).json({ ok: false, code: "RATE_LIMITED" });
    return;
  }
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 30) : "";
  const channel = typeof body.channel === "string" ? body.channel.trim().slice(0, 100) : "";
  const serverPassword = typeof body.serverPassword === "string" ? body.serverPassword.slice(0, 512) : "";
  if (!nickname) {
    response.status(400).json({ ok: false, code: "INVALID_NICKNAME" });
    return;
  }
  let target;
  try {
    target = parseTeamSpeakTarget(typeof body.target === "string" ? body.target : "");
  } catch {
    response.status(400).json({ ok: false, code: "TARGET_NOT_ALLOWED" });
    return;
  }
  let identity: string | undefined;
  if (typeof body.identity === "string" && body.identity.length <= 8192) {
    try {
      parseIdentity(body.identity);
      identity = body.identity;
    } catch {
      // Corrupt local identity should not prevent an ephemeral join.
    }
  }
  const ticket = joinTickets.create({
    target,
    serverPassword,
    nickname,
    ...(channel ? { channel } : {}),
    ...(identity ? { identity, rememberIdentity: true } : body.rememberIdentity === true ? { rememberIdentity: true } : {}),
  });
  response.status(201).json({ ok: true, ticket });
});

app.use(express.static(staticDir));
app.get(/^(?!\/api|\/ws)/, (_request, response) => response.sendFile(path.join(staticDir, "index.html")));
voiceBridge.attach(server);

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, () => {
    server.off("error", reject);
    resolve();
  });
});
logger.info({ host, port, dataDir }, "Android gateway started");

async function shutdown(): Promise<void> {
  await voiceBridge.shutdown();
  server.close();
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

function isSameOrigin(request: express.Request): boolean {
  const origin = request.header("origin");
  const requestHost = request.header("host");
  try {
    return Boolean(origin && requestHost && new URL(origin).host === requestHost);
  } catch {
    return false;
  }
}
