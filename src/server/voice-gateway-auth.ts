import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";

const MAX_CLOCK_SKEW_MS = 30_000;
const NONCE_TTL_MS = MAX_CLOCK_SKEW_MS * 2;
const MAX_NONCES = 10_000;

export interface DelegatedVoiceSession {
  target: TeamSpeakTarget;
  serverPassword: string;
  nickname: string;
  channel?: string;
  identity?: string;
  rememberIdentity?: boolean;
}

export interface VoiceGatewayAuthHeaders {
  "x-webspeak-relay-timestamp": string;
  "x-webspeak-relay-nonce": string;
  "x-webspeak-relay-signature": string;
}

export function createVoiceGatewayAuthHeaders(
  secret: string,
  body: unknown,
  now = Date.now(),
  nonce = randomBytes(16).toString("hex"),
): VoiceGatewayAuthHeaders {
  const timestamp = String(now);
  return {
    "x-webspeak-relay-timestamp": timestamp,
    "x-webspeak-relay-nonce": nonce,
    "x-webspeak-relay-signature": signature(secret, timestamp, nonce, body),
  };
}

/** Verifies short-lived, one-use requests from a configured gateway. */
export class VoiceGatewayRequestVerifier {
  private readonly usedNonces = new Map<string, number>();

  verify(
    secret: string,
    headers: { timestamp: string | undefined; nonce: string | undefined; signature: string | undefined },
    body: unknown,
    now = Date.now(),
  ): boolean {
    if (secret.length < 16 || !headers.timestamp || !headers.nonce || !headers.signature) return false;
    if (!/^\d{10,16}$/.test(headers.timestamp) || !/^[a-f\d]{32}$/i.test(headers.nonce) || !/^[a-f\d]{64}$/i.test(headers.signature)) return false;
    const timestamp = Number(headers.timestamp);
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) return false;

    this.prune(now);
    if (this.usedNonces.has(headers.nonce) || this.usedNonces.size >= MAX_NONCES) return false;

    const expected = Buffer.from(signature(secret, headers.timestamp, headers.nonce, body), "hex");
    const received = Buffer.from(headers.signature, "hex");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;

    this.usedNonces.set(headers.nonce, timestamp + NONCE_TTL_MS);
    return true;
  }

  private prune(now: number): void {
    for (const [nonce, expiresAt] of this.usedNonces) {
      if (expiresAt <= now) this.usedNonces.delete(nonce);
    }
  }
}

export function parseDelegatedVoiceSession(value: unknown): DelegatedVoiceSession | null {
  if (!isRecord(value) || !isRecord(value.target)) return null;
  const { host, port } = value.target;
  if (typeof host !== "string" || host.length < 1 || host.length > 253 || /[\s\u0000-\u001f\u007f\/#@?]/.test(host)) return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof value.serverPassword !== "string" || value.serverPassword.length > 512) return null;
  if (typeof value.nickname !== "string" || !value.nickname.trim() || value.nickname.length > 30) return null;
  if (value.channel !== undefined && (typeof value.channel !== "string" || value.channel.length > 100)) return null;
  if (value.identity !== undefined && (typeof value.identity !== "string" || value.identity.length > 8192)) return null;
  if (value.rememberIdentity !== undefined && typeof value.rememberIdentity !== "boolean") return null;

  return {
    target: { host, port },
    serverPassword: value.serverPassword,
    nickname: value.nickname.trim(),
    ...(typeof value.channel === "string" && value.channel ? { channel: value.channel } : {}),
    ...(typeof value.identity === "string" && value.identity ? { identity: value.identity } : {}),
    ...(value.rememberIdentity === true ? { rememberIdentity: true } : {}),
  };
}

function signature(secret: string, timestamp: string, nonce: string, body: unknown): string {
  return createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(timestamp)
    .update("\n")
    .update(nonce)
    .update("\n")
    .update(canonicalJson(body))
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record).filter(key => record[key] !== undefined).sort();
  return `{${fields.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
