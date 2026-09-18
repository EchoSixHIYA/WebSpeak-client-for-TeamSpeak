import type { Logger } from "../logger.js";
import { normalizeTeamSpeakError, type WebSpeakErrorCode } from "../errors.js";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { TSClient } from "./ts-client.js";
import type { TeamSpeakProtocol } from "./teamspeak-adapter.js";

export type ProbeErrorCode =
  | "INVALID_NICKNAME"
  | "HOST_NOT_FOUND"
  | "UNREACHABLE"
  | "CONNECTION_REFUSED"
  | "CONNECTION_RESET"
  | "TIMEOUT"
  | "PASSWORD_REQUIRED"
  | "INVALID_PASSWORD"
  | "PROTOCOL_NEGOTIATION_FAILED"
  | "SERVER_REJECTED"
  | "INTERNAL_ERROR";

export interface TeamSpeakProbeResult {
  ok: true;
  protocol: TeamSpeakProtocol | null;
  latencyMs: number;
  serverName: string | null;
  requiresPassword: boolean;
}

export class TeamSpeakProbeError extends Error {
  constructor(readonly code: ProbeErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TeamSpeakProbeError";
  }
}

interface ProbeAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly protocol?: TeamSpeakProtocol | null;
  getProtocol?(): TeamSpeakProtocol | null;
  execCommandWithResponse?(command: string, timeoutMs?: number): Promise<Record<string, string>[]>;
  readonly client?: {
    execCommandWithResponse(command: string, timeoutMs?: number): Promise<Record<string, string>[]>;
  };
}

export type ProbeAdapterFactory = (input: {
  target: TeamSpeakTarget;
  password: string;
  logger: Logger;
}) => ProbeAdapter;

export async function probeTeamSpeak(
  target: TeamSpeakTarget,
  password: string,
  logger: Logger,
  factory: ProbeAdapterFactory = ({ target: probeTarget, password: probePassword, logger: probeLogger }) =>
    (() => {
      const client = new TSClient({ target: probeTarget, nickname: "WebSpeak Probe", serverPassword: probePassword }, probeLogger);
      return {
        connect: () => client.connect(),
        disconnect: () => client.disconnect(),
        getProtocol: () => client.getProtocol(),
        execCommandWithResponse: (command: string, timeoutMs?: number) => client.execCommandWithResponse(command, timeoutMs),
      };
    })(),
): Promise<TeamSpeakProbeResult> {
  const startedAt = Date.now();
  const adapter = factory({ target, password, logger: logger.child({ component: "teamspeak-probe" }) });
  try {
    await adapter.connect();
    let serverName: string | null = null;
    try {
      const execute = adapter.execCommandWithResponse?.bind(adapter) ?? adapter.client?.execCommandWithResponse.bind(adapter.client);
      if (!execute) throw new Error("Probe adapter does not support commands");
      const rows = await execute("serverinfo", 3000);
      const first = rows[0] ?? {};
      serverName = first.virtualserver_name ?? first.server_name ?? first.name ?? null;
    } catch {
      // A connected server can restrict serverinfo; reachability is still proven.
    }
    return {
      ok: true,
      protocol: adapter.protocol ?? adapter.getProtocol?.() ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      serverName,
      requiresPassword: Boolean(password),
    };
  } catch (error: unknown) {
    throw toProbeError(error, password);
  } finally {
    try {
      await adapter.disconnect();
    } catch (error: unknown) {
      logger.warn({ err: extractErrorText(error) }, "TeamSpeak probe cleanup failed");
    }
  }
}

export function toProbeError(error: unknown, password = ""): TeamSpeakProbeError {
  if (error instanceof TeamSpeakProbeError) return error;
  const normalized = normalizeTeamSpeakError(error);
  const raw = `${extractErrorText(error)} ${extractErrorText(normalized.cause)}`.toLocaleLowerCase();
  if (/enotfound|eai_again|getaddrinfo|host not found/.test(raw)) {
    return new TeamSpeakProbeError("HOST_NOT_FOUND", "TeamSpeak host was not found", error);
  }
  // 探测只回答「该地址是否可用」，因此把网关能细分的拒绝原因收敛到既有探测码，
  // 具体原因由连接/重连路径向浏览器上报。
  // The probe only answers "can this address be used at all", so the richer
  // rejection reasons the gateway can now name are bucketed into the existing
  // probe codes; the exact reason is reported by the connect/reconnect path.
  const mapping: Record<WebSpeakErrorCode, ProbeErrorCode> = {
    invalid_target: "INTERNAL_ERROR",
    invalid_nickname: "INVALID_NICKNAME",
    nickname_in_use: "INVALID_NICKNAME",
    invalid_parameter_size: "INVALID_NICKNAME",
    unreachable: "UNREACHABLE",
    host_not_found: "HOST_NOT_FOUND",
    connection_refused: "CONNECTION_REFUSED",
    connection_reset: "CONNECTION_RESET",
    timeout: "TIMEOUT",
    authentication_failed: password.trim() ? "INVALID_PASSWORD" : "PASSWORD_REQUIRED",
    channel_password_required: "PASSWORD_REQUIRED",
    identity_security_level_too_low: "SERVER_REJECTED",
    identity_limit_reached: "SERVER_REJECTED",
    client_version_outdated: "SERVER_REJECTED",
    flooding: "SERVER_REJECTED",
    banned: "SERVER_REJECTED",
    kicked: "SERVER_REJECTED",
    server_shutting_down: "SERVER_REJECTED",
    connection_initialisation_failed: "SERVER_REJECTED",
    protocol_negotiation_failed: "PROTOCOL_NEGOTIATION_FAILED",
    server_full: "SERVER_REJECTED",
    unknown: "SERVER_REJECTED",
  };
  return new TeamSpeakProbeError(mapping[normalized.code] ?? "INTERNAL_ERROR", normalized.message, error);
}

function extractErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "");
  const candidate = error as { code?: unknown; id?: unknown; serverMessage?: unknown; message?: unknown };
  return `${typeof candidate.code === "string" ? candidate.code : ""} ${typeof candidate.id === "string" || typeof candidate.id === "number" ? candidate.id : ""} ${typeof candidate.serverMessage === "string" ? candidate.serverMessage : ""} ${typeof candidate.message === "string" ? candidate.message : ""}`;
}
