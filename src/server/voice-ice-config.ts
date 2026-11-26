import {
  hasVoiceTurnServer,
  normalizeVoiceIceServers,
  normalizeVoiceIceTransportPolicy,
  VOICE_JITTER_DEFAULT_MS,
  VOICE_JITTER_MAX_MS,
  VOICE_JITTER_MIN_MS,
  VOICE_TURN_MIN_SECRET_LENGTH,
  VOICE_TURN_TTL_DEFAULT_SECONDS,
  VOICE_TURN_TTL_MAX_SECONDS,
  VOICE_TURN_TTL_MIN_SECONDS,
  type VoiceIceServer,
  type VoiceIceTransportPolicy,
} from "../shared/voice-ice.js";
import { createTurnRestCredential, type TurnRestConfig } from "./turn-credentials.js";
import { normalizeVoiceProfileSetting, type VoiceProfileSetting } from "../shared/voice-profile.js";

export interface VoiceIceConfig {
  servers: VoiceIceServer[];
  turnRest?: TurnRestConfig;
  /** Browser policy; keep `all` for direct UDP-first deployments. */
  transportPolicy: VoiceIceTransportPolicy;
  /** werift policy; use `relay` only when the gateway itself is behind NAT. */
  gatewayTransportPolicy: VoiceIceTransportPolicy;
  /** Per-connection audio profile: direct traffic defaults to legacy. */
  profile: VoiceProfileSetting;
  opusWebSocket: boolean;
  jitterMaxMs: number;
}

export interface VoiceIceSettings {
  servers: VoiceIceServer[];
  transportPolicy: VoiceIceTransportPolicy;
  gatewayTransportPolicy: VoiceIceTransportPolicy;
  profile: VoiceProfileSetting;
  opusWebSocket: boolean;
  jitterMaxMs: number;
}

/** Baseline used when neither the console nor the environment configures a value. */
export const DEFAULT_VOICE_ICE_CONFIG: VoiceIceConfig = {
  servers: [],
  transportPolicy: "all",
  gatewayTransportPolicy: "all",
  profile: "auto",
  opusWebSocket: false,
  jitterMaxMs: VOICE_JITTER_DEFAULT_MS,
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseStaticServers(raw: string | undefined): VoiceIceServer[] {
  const value = raw?.trim();
  if (!value) return [];
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeVoiceIceServers(parsed);
      if (parsed && typeof parsed === "object") return normalizeVoiceIceServers([parsed]);
      return [];
    } catch {
      // Fall through to the convenient comma/space-separated STUN form.
    }
  }
  return normalizeVoiceIceServers(value.split(/[\s,]+/).filter(Boolean).map((urls) => ({ urls })));
}

function parseTurnRestUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  // Environment parsing stays lenient: one bad entry must not disable a
  // previously working TURN deployment during an upgrade.
  const urls = raw.split(/[\s,]+/).filter(Boolean).flatMap((token) => {
    const [server] = normalizeVoiceIceServers([{ urls: token }]);
    if (!server) return [];
    const candidates = Array.isArray(server.urls) ? server.urls : [server.urls];
    return candidates.filter((url) => /^turns?:/i.test(url));
  });
  return [...new Set(urls)].slice(0, 8);
}

export function readVoiceIceConfig(env: NodeJS.ProcessEnv = process.env): VoiceIceConfig {
  const servers = parseStaticServers(env.WEBSPEAK_VOICE_ICE_SERVERS);
  const turnUrls = parseTurnRestUrls(env.WEBSPEAK_TURN_REST_URLS);
  const secret = env.WEBSPEAK_TURN_REST_SECRET?.trim() ?? "";
  const ttlSeconds = parseInteger(env.WEBSPEAK_TURN_REST_TTL_SECONDS, VOICE_TURN_TTL_DEFAULT_SECONDS, VOICE_TURN_TTL_MIN_SECONDS, VOICE_TURN_TTL_MAX_SECONDS);
  const turnRest = turnUrls.length && secret.length >= VOICE_TURN_MIN_SECRET_LENGTH
    ? { urls: turnUrls, secret, ttlSeconds }
    : undefined;
  return {
    ...DEFAULT_VOICE_ICE_CONFIG,
    servers,
    ...(turnRest ? { turnRest } : {}),
    transportPolicy: normalizeVoiceIceTransportPolicy(env.WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY),
    gatewayTransportPolicy: normalizeVoiceIceTransportPolicy(env.WEBSPEAK_VOICE_GATEWAY_ICE_TRANSPORT_POLICY),
    profile: normalizeVoiceProfileSetting(env.WEBSPEAK_VOICE_PROFILE),
    // Opus over WebSocket is additive and remains opt-in even in adaptive mode.
    opusWebSocket: parseBoolean(env.WEBSPEAK_VOICE_OPUS_WS, false),
    jitterMaxMs: parseInteger(env.WEBSPEAK_VOICE_JITTER_MAX_MS, VOICE_JITTER_DEFAULT_MS, VOICE_JITTER_MIN_MS, VOICE_JITTER_MAX_MS),
  };
}

/** Build the per-connection list, minting one short-lived TURN credential. */
export function resolveVoiceIceServers(
  config: VoiceIceConfig | undefined,
  sessionId: string,
  nowMs = Date.now(),
): VoiceIceServer[] {
  if (!config) return [];
  const servers = [...config.servers];
  if (config.turnRest) {
    servers.push(createTurnRestCredential(config.turnRest, sessionId, nowMs));
  }
  return normalizeVoiceIceServers(servers);
}

export function voiceConfigSettings(config: VoiceIceConfig): VoiceIceSettings {
  return {
    servers: normalizeVoiceIceServers(config.servers),
    transportPolicy: config.transportPolicy,
    gatewayTransportPolicy: config.gatewayTransportPolicy,
    profile: config.profile,
    opusWebSocket: config.opusWebSocket,
    jitterMaxMs: config.jitterMaxMs,
  };
}

export { hasVoiceTurnServer };
