/** A media host is an address, never an HTTP URL or an address with a port. */
export function normalizeVoiceMediaHost(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 253) return null;
  const host = value.trim();
  if (!host) return "";
  if (/[:\[\]]/.test(host)) {
    if (!/^(?:\[[\da-f:.]+\]|[\da-f:.]+)$/i.test(host)) return null;
    try {
      const parsed = new URL(`http://${host.startsWith("[") ? host : `[${host}]`}`);
      return parsed.hostname.startsWith("[") && !parsed.port && parsed.pathname === "/"
        ? parsed.hostname.slice(1, -1) : null;
    } catch { return null; }
  }
  if (!host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return host.toLowerCase();
}

/** UDP STUN discovery only; TURN credentials are supplied separately. */
export function normalizeVoiceStunServer(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  if (!value.trim()) return "";
  // werift currently performs srflx discovery on IPv4 sockets. IPv6 media
  // candidates still work independently, but an IPv6-only STUN URL would not.
  const match = /^stun:([a-z\d.-]+)(?::(\d{1,5}))?$/i.exec(value.trim());
  if (!match) return null;
  const host = normalizeVoiceMediaHost(match[1]);
  const port = Number(match[2] ?? 3478);
  if (!host || port < 1 || port > 65535) return null;
  return `stun:${host}:${port}`;
}

export interface VoiceIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type VoiceIceTransportPolicy = "all" | "relay";

export const VOICE_TURN_TTL_DEFAULT_SECONDS = 21_600;
export const VOICE_TURN_TTL_MIN_SECONDS = 300;
export const VOICE_TURN_TTL_MAX_SECONDS = 86_400;
export const VOICE_TURN_MIN_SECRET_LENGTH = 16;
export const VOICE_JITTER_DEFAULT_MS = 300;
export const VOICE_JITTER_MIN_MS = 80;
export const VOICE_JITTER_MAX_MS = 500;

const MAX_ICE_SERVER_COUNT = 8;
const MAX_ICE_URL_LENGTH = 512;
const MAX_ICE_CREDENTIAL_LENGTH = 512;
const ICE_URL_PATTERN = /^(stun|stuns|turn|turns):([a-z0-9.-]+|\[[0-9a-f:.]+\])(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i;

function normalizeIceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || url.length > MAX_ICE_URL_LENGTH) return null;
  const match = ICE_URL_PATTERN.exec(url);
  if (!match) return null;
  const scheme = match[1]!.toLowerCase();
  const port = match[3] === undefined ? undefined : Number(match[3]);
  if (port !== undefined && (port < 1 || port > 65_535)) return null;
  const transport = match[4]?.toLowerCase();
  if (scheme === "stun" || scheme === "stuns") {
    return transport ? null : `${scheme}:${match[2]}${port === undefined ? "" : `:${port}`}`;
  }
  if (scheme === "turns" && transport === "udp") return null;
  return `${scheme}:${match[2]}${port === undefined ? "" : `:${port}`}${transport ? `?transport=${transport}` : ""}`;
}

/**
 * Bound server-owned ICE configuration before it reaches a browser or werift.
 * TURN is accepted only as an explicitly configured external service; no
 * gateway-owned relay is inserted here.
 */
export function normalizeVoiceIceServers(value?: readonly unknown[]): VoiceIceServer[] {
  if (!value?.length) return [];
  const normalized: VoiceIceServer[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    const rawUrls = candidate.urls;
    const urls = (Array.isArray(rawUrls) ? rawUrls : [rawUrls])
      .map(normalizeIceUrl)
      .filter((url): url is string => url !== null);
    const uniqueUrls = [...new Set(urls)];
    if (!uniqueUrls.length) continue;
    const username = typeof candidate.username === "string" && candidate.username.length <= MAX_ICE_CREDENTIAL_LENGTH
      ? candidate.username
      : undefined;
    const credential = typeof candidate.credential === "string" && candidate.credential.length <= MAX_ICE_CREDENTIAL_LENGTH
      ? candidate.credential
      : undefined;
    // Do not forward a half-configured TURN credential pair.
    if ((username === undefined) !== (credential === undefined)) continue;
    const key = JSON.stringify([uniqueUrls, username ?? ""]);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      urls: uniqueUrls.length === 1 ? uniqueUrls[0]! : uniqueUrls,
      ...(username !== undefined ? { username } : {}),
      ...(credential !== undefined ? { credential } : {}),
    });
    if (normalized.length >= MAX_ICE_SERVER_COUNT) break;
  }
  return normalized;
}

export function normalizeVoiceIceTransportPolicy(value: unknown): VoiceIceTransportPolicy {
  return value === "relay" ? "relay" : "all";
}

/**
 * Normalize the TURN REST service URL list used by the admin console.
 * Unlike the environment parser, an invalid token is a configuration error
 * rather than a silently ignored value.
 */
export function normalizeVoiceTurnRestUrls(value: unknown): string[] | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  const tokens = value.trim() ? value.trim().split(/[\s,]+/).filter(Boolean) : [];
  if (tokens.length > MAX_ICE_SERVER_COUNT) return null;
  const urls: string[] = [];
  for (const token of tokens) {
    const [server] = normalizeVoiceIceServers([{ urls: token }]);
    if (!server) return null;
    const candidates = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!candidates.every((url) => /^turns?:/i.test(url))) return null;
    urls.push(...candidates);
  }
  return [...new Set(urls)];
}

export function hasVoiceTurnServer(servers: readonly VoiceIceServer[]): boolean {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => /^turns?:/i.test(url));
  });
}
