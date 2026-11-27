export type VoiceProfile = "legacy" | "adaptive";
export type VoiceProfileSetting = VoiceProfile | "auto";

/**
 * `auto` is the deployment default: direct HTTP/WebSocket traffic keeps the
 * historical audio path, while Cloudflare-proxied connections opt into the
 * adaptive path automatically. Explicit `legacy`/`adaptive` wins everywhere.
 */
export function normalizeVoiceProfileSetting(value: unknown): VoiceProfileSetting {
  if (typeof value !== "string") return "auto";
  const normalized = value.trim().toLowerCase();
  return normalized === "legacy" || normalized === "adaptive" ? normalized : "auto";
}

export function resolveVoiceProfile(setting: VoiceProfileSetting, cloudflareRequest: boolean): VoiceProfile {
  if (setting === "legacy" || setting === "adaptive") return setting;
  return cloudflareRequest ? "adaptive" : "legacy";
}

export function isVoiceProfile(value: unknown): value is VoiceProfile {
  return value === "legacy" || value === "adaptive";
}

export function isVoiceProfileSetting(value: unknown): value is VoiceProfileSetting {
  return value === "auto" || isVoiceProfile(value);
}
