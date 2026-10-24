import { existsSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const defaultCertDirectory = path.join(appRoot, "certs");

export function healthcheckUsesHttps(certDirectory = defaultCertDirectory) {
  return existsSync(path.join(certDirectory, "cert.pem"));
}

export function runDockerHealthcheck({ mode = process.env.WEBSPEAK_MODE, certDirectory = defaultCertDirectory } = {}) {
  const relayMode = mode?.trim().toLowerCase() === "relay";
  const secure = !relayMode && healthcheckUsesHttps(certDirectory);
  const client = secure ? https : http;
  const request = client.get({
    hostname: "127.0.0.1",
    port: relayMode ? process.env.WEBSPEAK_VOICE_GATEWAY_PORT || 3041 : 3040,
    path: "/health",
    ...(secure ? { rejectUnauthorized: false } : {}),
  }, (response) => {
    response.resume();
    process.exitCode = response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1;
  });
  request.setTimeout(4_000, () => request.destroy(new Error("Healthcheck timed out")));
  request.on("error", () => { process.exitCode = 1; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDockerHealthcheck();
}
