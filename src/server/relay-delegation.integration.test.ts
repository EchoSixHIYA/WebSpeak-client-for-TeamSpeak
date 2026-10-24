import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createPortProbe } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AdminService, type AdminSettingsInput } from "../admin/admin-service.js";
import type { Logger } from "../logger.js";
import { WebSpeakDatabase } from "../persistence/database.js";
import { JoinTicketStore } from "./join-ticket.js";
import { createWebServer } from "./server.js";
import { createVoiceGatewayServer } from "./voice-gateway.js";

const noop = () => {};
const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };

test("ingress keeps the page origin and delegates the voice ticket to the selected relay", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-relay-delegation-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const relayPort = await availablePort();
  const ingressPort = await availablePort();
  const relayToken = "integration-test-relay-token";
  const relayEndpoint = `http://127.0.0.1:${relayPort}`;
  const relay = createVoiceGatewayServer({
    host: "127.0.0.1",
    port: relayPort,
    sharedToken: relayToken,
    logger,
    webRtc: { enabled: false },
  });
  const service = new AdminService(
    database,
    Buffer.alloc(32, 7),
    logger,
    path.join(directory, "missing-config.json"),
    async () => ({ ok: true, protocol: "ts3", latencyMs: 1, serverName: "Test", requiresPassword: false }),
  );
  const localTickets = new JoinTicketStore();
  const ingress = createWebServer({
    port: ingressPort,
    adminService: service,
    voiceBridgeOptions: { joinTickets: localTickets, acceleration: () => service.getAccelerationRelayOptions() },
    logger,
  });
  context.after(async () => {
    await ingress.stop();
    await relay.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  await service.initialize();
  const settings: AdminSettingsInput = {
    target: "203.0.113.20#9987",
    accessMode: "fixed",
    siteName: "WebSpeak",
    welcomeText: "",
    webRtcEnabled: false,
    relayNodes: [{
      id: "de-relay",
      name: "Germany relay",
      target: "relay.example.com#39087",
      voiceEndpoint: relayEndpoint,
      enabled: true,
      token: relayToken,
      tokenAction: "replace",
    }],
  };
  service.updateSettings(settings);
  await relay.start();
  await ingress.start();

  const origin = `http://127.0.0.1:${ingressPort}`;
  const response = await fetch(`${origin}/api/join-ticket`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ nickname: "Tester", accelerated: true }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json() as { ticket?: string; voiceEndpoint?: string };
  assert.ok(result.ticket);
  assert.equal(result.voiceEndpoint, relayEndpoint);
  assert.equal(localTickets.consume(result.ticket!), null);
});

async function availablePort(): Promise<number> {
  const socket = createPortProbe();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}
