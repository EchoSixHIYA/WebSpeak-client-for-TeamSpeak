export type WebSpeakErrorCode =
  | "invalid_target"
  | "unreachable"
  | "timeout"
  | "authentication_failed"
  | "protocol_negotiation_failed"
  | "server_full"
  | "unknown";

export class WebSpeakError extends Error {
  readonly code: WebSpeakErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(code: WebSpeakErrorCode, message: string, retryable: boolean, cause?: unknown) {
    super(message);
    this.name = "WebSpeakError";
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
}

export function normalizeTeamSpeakError(error: unknown): WebSpeakError {
  if (error instanceof WebSpeakError) return error;

  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  const text = `${code} ${message}`.toLocaleLowerCase();

  if (/password|authenticate|authentication|not authorized|invalid.*(credential|password)/.test(text)) {
    return new WebSpeakError("authentication_failed", "TeamSpeak authentication failed", false, error);
  }
  if (/timeout|timed out|ack timeout|idle timeout/.test(text)) {
    return new WebSpeakError("timeout", "TeamSpeak connection timed out", true, error);
  }
  if (/econnrefused|enotfound|ehostunreach|enetunreach|network|socket|dns/.test(text)) {
    return new WebSpeakError("unreachable", "TeamSpeak server is unreachable", true, error);
  }
  if (/protocol|handshake|crypto|init1/.test(text)) {
    return new WebSpeakError("protocol_negotiation_failed", "TeamSpeak protocol negotiation failed", true, error);
  }
  return new WebSpeakError("unknown", "TeamSpeak connection failed", false, error);
}
