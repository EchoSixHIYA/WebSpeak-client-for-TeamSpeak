import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AppConfig {
  /** HTTP server port */
  port: number;
  /** TeamSpeak server host */
  tsHost: string;
  /** TeamSpeak voice/UDP port */
  tsPort: number;
  /** TS server password (empty if none) */
  tsServerPassword: string;
  /** Force protocol: "ts3" | "ts6" | undefined for auto-detect */
  tsServerProtocol?: "ts3" | "ts6";
  /** Max concurrent web clients */
  maxClients: number;
  /** Trust X-Forwarded-* headers (for reverse proxy) */
  trustProxy: boolean;
}

export function getDefaultConfig(): AppConfig {
  return {
    port: 3040,
    tsHost: "127.0.0.1",
    tsPort: 9987,
    tsServerPassword: "",
    tsServerProtocol: undefined,
    maxClients: 20,
    trustProxy: false,
  };
}

export function loadConfig(path: string): AppConfig {
  const defaults = getDefaultConfig();
  try {
    const input = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const positiveInt = (value: unknown, fallback: number) => {
      const number = typeof value === "number" ? value : Number(value);
      return Number.isInteger(number) && number > 0 ? number : fallback;
    };
    const protocol = input.tsServerProtocol === "ts3" || input.tsServerProtocol === "ts6"
      ? input.tsServerProtocol
      : defaults.tsServerProtocol;
    return {
      port: positiveInt(input.port, defaults.port),
      tsHost: typeof input.tsHost === "string" && input.tsHost.trim() ? input.tsHost.trim() : defaults.tsHost,
      tsPort: positiveInt(input.tsPort, defaults.tsPort),
      tsServerPassword: typeof input.tsServerPassword === "string" ? input.tsServerPassword : defaults.tsServerPassword,
      tsServerProtocol: protocol,
      maxClients: positiveInt(input.maxClients, defaults.maxClients),
      trustProxy: typeof input.trustProxy === "boolean" ? input.trustProxy : defaults.trustProxy,
    };
  } catch {
    return defaults;
  }
}

export function saveConfig(path: string, config: AppConfig): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // config.json may be read-only (e.g. running under systemd as non-root)
  }
}
