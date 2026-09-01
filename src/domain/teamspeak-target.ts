export const DEFAULT_TEAM_SPEAK_PORT = 9987;

export interface TeamSpeakTarget {
  host: string;
  port: number;
}

export class InvalidTeamSpeakTargetError extends Error {
  constructor(message = "Invalid TeamSpeak server address") {
    super(message);
    this.name = "InvalidTeamSpeakTargetError";
  }
}

/** Parse a user-facing TeamSpeak target such as example.com:9988 or example.com#9988. */
export function parseTeamSpeakTarget(value: string, fallbackPort = DEFAULT_TEAM_SPEAK_PORT): TeamSpeakTarget {
  const input = value.trim();
  if (!input) throw new InvalidTeamSpeakTargetError("TeamSpeak server address is required");

  const hash = input.indexOf("#");
  if (hash >= 0) {
    if (input.indexOf("#", hash + 1) >= 0) {
      throw new InvalidTeamSpeakTargetError("TeamSpeak target has too many port separators");
    }
    const hashHost = input.slice(0, hash);
    const host = hashHost.startsWith("[") && hashHost.endsWith("]") ? hashHost.slice(1, -1) : hashHost;
    return createTarget(host, input.slice(hash + 1));
  }

  if (input.startsWith("[")) {
    const closingBracket = input.indexOf("]");
    if (closingBracket < 0) throw new InvalidTeamSpeakTargetError("IPv6 addresses must close with ]");
    const host = input.slice(1, closingBracket);
    const suffix = input.slice(closingBracket + 1);
    if (suffix && !suffix.startsWith(":")) {
      throw new InvalidTeamSpeakTargetError("Invalid port separator after IPv6 address");
    }
    return createTarget(host, suffix ? suffix.slice(1) : fallbackPort);
  }

  const colon = input.indexOf(":");
  if (colon < 0) return createTarget(input, fallbackPort);
  if (input.indexOf(":", colon + 1) >= 0) {
    throw new InvalidTeamSpeakTargetError("IPv6 addresses must use bracket notation");
  }
  return createTarget(input.slice(0, colon), input.slice(colon + 1));
}

/** Parse the legacy split host/port fields while accepting a bracketed IPv6 host. */
export function parseTeamSpeakTargetParts(
  hostValue: string,
  portValue?: string | number,
  fallbackPort = DEFAULT_TEAM_SPEAK_PORT,
): TeamSpeakTarget {
  const host = hostValue.trim();
  if (!host) throw new InvalidTeamSpeakTargetError("TeamSpeak server address is required");

  if (portValue !== undefined && String(portValue).trim() !== "") {
    const hostOnly = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (hostOnly.includes(":")) return createTarget(hostOnly, portValue);
    if (host.includes(":")) {
      throw new InvalidTeamSpeakTargetError("Use one TeamSpeak address field when specifying a port");
    }
    return createTarget(hostOnly, portValue);
  }

  return parseTeamSpeakTarget(host, fallbackPort);
}

export function formatTeamSpeakTarget(target: TeamSpeakTarget): string {
  return target.host.includes(":") ? `[${target.host}]:${target.port}` : `${target.host}:${target.port}`;
}

export function teamSpeakTargetKey(target: TeamSpeakTarget): string {
  return formatTeamSpeakTarget(target).toLocaleLowerCase();
}

function createTarget(hostValue: string, portValue: string | number): TeamSpeakTarget {
  const host = hostValue.trim().toLocaleLowerCase();
  if (!host || host.length > 255 || /[\s/\\?#@\[\]]/.test(host)) {
    throw new InvalidTeamSpeakTargetError("Invalid TeamSpeak server address");
  }
  if (host.includes(":")) {
    // A raw IPv6 host is valid only when it came from bracket notation.
    if (!host.split(":").every((part) => /^[0-9a-f]*$/i.test(part))) {
      throw new InvalidTeamSpeakTargetError("Invalid IPv6 server address");
    }
  } else if (!/^[a-z0-9._-]+$/i.test(host)) {
    throw new InvalidTeamSpeakTargetError("Invalid TeamSpeak server address");
  }

  const portText = String(portValue).trim();
  if (!/^\d+$/.test(portText)) throw new InvalidTeamSpeakTargetError("TeamSpeak port must be a number");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidTeamSpeakTargetError("TeamSpeak port must be between 1 and 65535");
  }
  return { host, port };
}
