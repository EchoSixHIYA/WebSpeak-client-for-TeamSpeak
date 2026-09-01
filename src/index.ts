import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLogger } from "./logger.js";
import { createWebServer } from "./server/server.js";
import { APP_PORT } from "./constants.js";
import { WebSpeakDatabase } from "./persistence/database.js";
import { loadOrCreateMasterSecret } from "./security/master-secret.js";
import { BootstrapManager } from "./security/bootstrap.js";
import { AdminService } from "./admin/admin-service.js";
import { JoinTicketStore } from "./server/join-ticket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT_DIR, "config.json");
const CERT_DIR = path.join(ROOT_DIR, "certs");
const DATA_DIR = path.join(ROOT_DIR, "data");
const LOG_DIR = path.join(DATA_DIR, "logs");
const STATIC_DIR = path.join(ROOT_DIR, "web", "dist");

async function main() {
  const logger = createLogger(LOG_DIR);
  const database = new WebSpeakDatabase(path.join(DATA_DIR, "webspeak.db"));
  const masterSecret = loadOrCreateMasterSecret(path.join(DATA_DIR, "master.key"));
  const adminService = new AdminService(
    database,
    masterSecret,
    new BootstrapManager(path.join(DATA_DIR, "bootstrap")),
    logger,
    CONFIG_PATH,
  );
  adminService.initialize();
  const joinTickets = new JoinTicketStore();

  logger.info({ dataDir: DATA_DIR }, "Starting WebSpeak server");

  const hasCert = existsSync(path.join(CERT_DIR, "cert.pem"));

  const webServer = createWebServer({
    port: APP_PORT,
    staticDir: STATIC_DIR,
    certDir: hasCert ? CERT_DIR : undefined,
    voiceBridgeOptions: {
      joinTickets,
    },
    adminService,
    logger,
  });

  await webServer.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    await webServer.stop();
    database.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
