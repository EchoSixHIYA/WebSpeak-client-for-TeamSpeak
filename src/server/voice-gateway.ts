import { createServer } from "node:http";
import express from "express";
import { VoiceBridge, type VoiceBridgeOptions } from "./voice-bridge.js";
import { JoinTicketStore } from "./join-ticket.js";
import { parseDelegatedVoiceSession, VoiceGatewayRequestVerifier } from "./voice-gateway-auth.js";
import type { Logger } from "../logger.js";
import type { WebRtcAudioOptions } from "./webrtc-audio.js";
import type { ScreenShareIceServer } from "./screen-share.js";

export interface VoiceGatewayServerOptions {
  workspaceInvites?: import("./workspace-invites.js").WorkspaceInvites;
  host: string;
  port: number;
  sharedToken: string;
  logger: Logger;
  webRtc: WebRtcAudioOptions;
  screenShareIceServers?: ScreenShareIceServer[];
  trustedProxies?: readonly string[];
}

export interface VoiceGatewayServer {
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
}

export function createVoiceGatewayServer(options: VoiceGatewayServerOptions): VoiceGatewayServer {
  if (options.sharedToken.trim().length < 16) throw new Error("Voice gateway token must contain at least 16 characters");
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  const tickets = new JoinTicketStore();
  const verifier = new VoiceGatewayRequestVerifier();
  const voiceBridgeOptions: VoiceBridgeOptions = {
    joinTickets: tickets,
    ...(options.workspaceInvites ? { createWorkspaceInvite: (credentials, minutes) => options.workspaceInvites!.create(credentials, minutes) } : {}),
    webRtc: options.webRtc,
    screenShareIceServers: options.screenShareIceServers,
    trustedProxies: options.trustedProxies,
  };
  const bridge = new VoiceBridge(voiceBridgeOptions, options.logger);
  const server = createServer(app);

  app.get("/health", (_request, response) => response.json({ status: "ok", role: "voice-gateway" }));
  app.post("/api/relay/voice-ticket", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!request.is("application/json")) {
      response.status(415).json({ ok: false, code: "JSON_REQUIRED" });
      return;
    }
    const authenticated = verifier.verify(options.sharedToken, {
      timestamp: request.get("x-webspeak-relay-timestamp"),
      nonce: request.get("x-webspeak-relay-nonce"),
      signature: request.get("x-webspeak-relay-signature"),
    }, request.body);
    if (!authenticated) {
      response.status(401).json({ ok: false, code: "RELAY_AUTH_REJECTED" });
      return;
    }
    const session = parseDelegatedVoiceSession(request.body);
    if (!session) {
      response.status(400).json({ ok: false, code: "RELAY_SESSION_INVALID" });
      return;
    }
    response.status(201).json({ ok: true, ticket: tickets.create(session) });
  });

  app.post("/api/relay/workspace-invite", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const authenticated = verifier.verify(options.sharedToken, {
      timestamp: request.get("x-webspeak-relay-timestamp"), nonce: request.get("x-webspeak-relay-nonce"), signature: request.get("x-webspeak-relay-signature"),
    }, request.body);
    if (!authenticated) { response.status(401).json({ ok: false, code: "RELAY_AUTH_REJECTED" }); return; }
    const body = request.body;
    if (body?.purpose !== "workspace-invite" || typeof body.token !== "string" || !/^wi_[A-Za-z0-9_-]{43}$/.test(body.token)) { response.status(400).json({ ok: false }); return; }
    const access = options.workspaceInvites?.get(body.token);
    if (!access) { response.status(404).json({ ok: false }); return; }
    response.json({ ok: true, access });
  });

  bridge.attach(server);

  return {
    start(): Promise<{ host: string; port: number }> {
      return new Promise((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          const address = server.address();
          resolve({ host: options.host, port: typeof address === "object" && address ? address.port : options.port });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(options.port, options.host);
      });
    },
    async stop(): Promise<void> {
      await bridge.shutdown();
      await new Promise<void>((resolve) => {
        if (!server.listening) { resolve(); return; }
        server.close(() => resolve());
      });
    },
  };
}
