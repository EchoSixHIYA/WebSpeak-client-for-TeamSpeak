import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSpeakDatabase } from "../src/persistence/database.js";
import { hashAdminPassword } from "../src/security/admin-password.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.WEBSPEAK_DATA_DIR?.trim() || path.join(ROOT_DIR, "data");
const dbPath = path.join(DATA_DIR, "webspeak.db");

const newPassword = process.argv[2] || "admin";

console.log(`Checking database at: ${dbPath}`);

if (!existsSync(dbPath)) {
  console.log(`[Info] Database does not exist yet. When you first start the server, admin password will default to: admin`);
  process.exit(0);
}

try {
  const database = new WebSpeakDatabase(dbPath);
  const credential = await hashAdminPassword(newPassword, {
    username: "admin",
    mustChangePassword: newPassword === "admin",
    allowWeakPassword: true,
  });

  if (database.hasAdmin()) {
    database.updateAdminCredential(credential);
    console.log(`[Success] Admin password successfully reset to: ${newPassword}`);
  } else {
    database.initializeAdmin(credential, {
      siteName: "WebSpeak",
      welcomeText: "欢迎来到 WebSpeak 语音频道",
      accessMode: "open",
      tsHost: "127.0.0.1",
      tsPort: 9987,
      webRtcEnabled: false,
      relayConfigured: false,
      relayEnabled: false,
      relayName: "",
      relayHost: "",
      relayPort: 0,
      relayTokenEncrypted: null,
    });
    console.log(`[Success] Admin account initialized with password: ${newPassword}`);
  }
  database.close();
} catch (err) {
  console.error(`[Error] Failed to reset admin password:`, err);
  process.exit(1);
}
