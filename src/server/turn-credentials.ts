import { createHmac, randomBytes } from "node:crypto";
import type { VoiceIceServer } from "../shared/voice-ice.js";

export interface TurnRestConfig {
  urls: string[];
  secret: string;
  ttlSeconds: number;
}

/**
 * coturn's `use-auth-secret` REST API:
 *   username = "<expiry unix seconds>:<session id>"
 *   credential = base64(HMAC-SHA1(secret, username))
 *
 * Credentials are minted per browser connection; they are not shared between
 * sessions and never need to be persisted.
 */
export function createTurnRestCredential(
  config: TurnRestConfig,
  sessionId: string,
  nowMs = Date.now(),
): VoiceIceServer {
  const suffix = sessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || randomBytes(8).toString("hex");
  const expiry = Math.floor(nowMs / 1_000) + Math.max(1, Math.trunc(config.ttlSeconds));
  const username = `${expiry}:${suffix}`;
  const credential = createHmac("sha1", config.secret).update(username).digest("base64");
  return {
    urls: config.urls.length === 1 ? config.urls[0]! : [...config.urls],
    username,
    credential,
  };
}

export function createTurnRestUsername(expirySeconds: number, sessionId: string): string {
  return `${Math.trunc(expirySeconds)}:${sessionId}`;
}
