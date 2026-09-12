export type WebSpeakErrorCode =
  | "invalid_target"
  | "host_not_found"
  | "unreachable"
  | "connection_refused"
  | "connection_reset"
  | "timeout"
  | "authentication_failed"
  | "protocol_negotiation_failed"
  | "server_full"
  | "unknown";

export type ClientConnectionFailureCode =
  | "INVALID_TARGET"
  | "HOST_NOT_FOUND"
  | "UNREACHABLE"
  | "CONNECTION_REFUSED"
  | "CONNECTION_RESET"
  | "TIMEOUT"
  | "SERVER_PASSWORD_REQUIRED"
  | "INVALID_SERVER_PASSWORD"
  | "PROTOCOL_NEGOTIATION_FAILED"
  | "SERVER_REJECTED"
  | "CONNECTION_FAILED";

export interface TeamSpeakErrorDiagnostics {
  name?: string;
  code?: string;
  id?: string;
  serverMessage?: string;
  message?: string;
  syscall?: string;
  address?: string;
  port?: number | string;
  cause?: string;
}

export class WebSpeakError extends Error {
  readonly code: WebSpeakErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly diagnostics: TeamSpeakErrorDiagnostics;

  constructor(code: WebSpeakErrorCode, message: string, retryable: boolean, cause?: unknown, diagnostics: TeamSpeakErrorDiagnostics = {}) {
    super(message);
    this.name = "WebSpeakError";
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
    this.diagnostics = diagnostics;
  }
}

export function normalizeTeamSpeakError(error: unknown): WebSpeakError {
  if (error instanceof WebSpeakError) return error;

  const diagnostics = collectDiagnostics(error);
  const text = diagnosticText(error).toLocaleLowerCase();

  if (/password|authenticate|authentication|not authorized|invalid.*(credential|password)/.test(text)) {
    return new WebSpeakError("authentication_failed", "TeamSpeak authentication failed", false, error, diagnostics);
  }
  if (/enotfound|eai_again|host not found|name or service not known|dns/.test(text)) {
    return new WebSpeakError("host_not_found", "TeamSpeak server hostname could not be resolved", true, error, diagnostics);
  }
  if (/econnrefused|connection refused/.test(text)) {
    return new WebSpeakError("connection_refused", "TeamSpeak server refused the connection", true, error, diagnostics);
  }
  if (/econnreset|econnaborted|connection reset|connection aborted/.test(text)) {
    return new WebSpeakError("connection_reset", "TeamSpeak connection was reset", true, error, diagnostics);
  }
  if (/timeout|timed out|ack timeout|idle timeout|etimedout/.test(text)) {
    return new WebSpeakError("timeout", "TeamSpeak connection timed out", true, error, diagnostics);
  }
  if (/ehostunreach|enetunreach|network is unreachable|no route to host|network|socket/.test(text)) {
    return new WebSpeakError("unreachable", "TeamSpeak server is unreachable", true, error, diagnostics);
  }
  if (/protocol|handshake|crypto|init1/.test(text)) {
    return new WebSpeakError("protocol_negotiation_failed", "TeamSpeak protocol negotiation failed", true, error, diagnostics);
  }
  return new WebSpeakError("unknown", "TeamSpeak connection failed", false, error, diagnostics);
}

export function clientConnectionFailureCode(error: WebSpeakError, serverPassword = ""): ClientConnectionFailureCode {
  if (error.code === "authentication_failed") {
    return serverPassword.trim() ? "INVALID_SERVER_PASSWORD" : "SERVER_PASSWORD_REQUIRED";
  }
  const mapping: Record<WebSpeakErrorCode, ClientConnectionFailureCode> = {
    invalid_target: "INVALID_TARGET",
    host_not_found: "HOST_NOT_FOUND",
    unreachable: "UNREACHABLE",
    connection_refused: "CONNECTION_REFUSED",
    connection_reset: "CONNECTION_RESET",
    timeout: "TIMEOUT",
    authentication_failed: "SERVER_PASSWORD_REQUIRED",
    protocol_negotiation_failed: "PROTOCOL_NEGOTIATION_FAILED",
    server_full: "SERVER_REJECTED",
    unknown: "CONNECTION_FAILED",
  };
  return mapping[error.code];
}

/** Format useful SDK/Node details for a safe operational log field. */
export function describeTeamSpeakError(error: WebSpeakError): string {
  const details = error.diagnostics;
  const parts = [
    details.name,
    details.code,
    details.id ? `id=${details.id}` : "",
    details.serverMessage,
    details.syscall,
    details.address ? `address=${details.address}` : "",
    details.port !== undefined ? `port=${details.port}` : "",
    details.cause,
    details.message,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : error.message;
}

function diagnosticText(error: unknown): string {
  const values: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) values.push(current.name, current.message);
    else values.push(String(current));
    if (typeof current === "object") {
      const candidate = current as { code?: unknown; id?: unknown; serverMessage?: unknown; cause?: unknown };
      for (const value of [candidate.code, candidate.id, candidate.serverMessage]) if (value !== undefined) values.push(String(value));
      current = candidate.cause;
    } else break;
  }
  return values.join(" ");
}

function collectDiagnostics(error: unknown): TeamSpeakErrorDiagnostics {
  const result: TeamSpeakErrorDiagnostics = {};
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) {
      result.name ??= current.name;
      result.message ??= current.message;
      const errorRecord = current as Error & Record<string, unknown>;
      if (typeof errorRecord.code === "string" || typeof errorRecord.code === "number") result.code ??= String(errorRecord.code);
      if (typeof errorRecord.id === "string" || typeof errorRecord.id === "number") result.id ??= String(errorRecord.id);
      if (typeof errorRecord.serverMessage === "string") result.serverMessage ??= errorRecord.serverMessage;
      if (typeof errorRecord.syscall === "string") result.syscall ??= errorRecord.syscall;
      if (typeof errorRecord.address === "string") result.address ??= errorRecord.address;
      if (typeof errorRecord.port === "string" || typeof errorRecord.port === "number") result.port ??= errorRecord.port;
      const cause = current.cause;
      if (cause && cause !== current) { current = cause; continue; }
      break;
    }
    if (typeof current !== "object") { result.cause ??= String(current); break; }
    const candidate = current as Record<string, unknown>;
    if (typeof candidate.name === "string") result.name ??= candidate.name;
    if (typeof candidate.code === "string" || typeof candidate.code === "number") result.code ??= String(candidate.code);
    if (typeof candidate.id === "string" || typeof candidate.id === "number") result.id ??= String(candidate.id);
    if (typeof candidate.serverMessage === "string") result.serverMessage ??= candidate.serverMessage;
    if (typeof candidate.message === "string") result.message ??= candidate.message;
    if (typeof candidate.syscall === "string") result.syscall ??= candidate.syscall;
    if (typeof candidate.address === "string") result.address ??= candidate.address;
    if (typeof candidate.port === "string" || typeof candidate.port === "number") result.port ??= candidate.port;
    const cause = candidate.cause;
    if (cause && cause !== current) { current = cause; continue; }
    break;
  }
  return result;
}
