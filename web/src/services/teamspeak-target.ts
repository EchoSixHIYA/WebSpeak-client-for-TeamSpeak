export const DEFAULT_TEAM_SPEAK_PORT = "9987";

export interface TeamSpeakTargetFields {
  address: string;
  port: string;
}

/** Split both the current canonical target and the legacy address#port form. */
export function splitTeamSpeakTarget(value: unknown, fallbackPort = DEFAULT_TEAM_SPEAK_PORT): TeamSpeakTargetFields {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) return { address: "", port: fallbackPort };

  const hash = input.lastIndexOf("#");
  if (hash > 0 && isPort(input.slice(hash + 1))) {
    return { address: stripBrackets(input.slice(0, hash)), port: input.slice(hash + 1) };
  }

  if (input.startsWith("[")) {
    const closingBracket = input.indexOf("]");
    if (closingBracket > 0) {
      const address = input.slice(1, closingBracket);
      const suffix = input.slice(closingBracket + 1);
      const port = suffix.startsWith(":") && isPort(suffix.slice(1)) ? suffix.slice(1) : fallbackPort;
      return { address, port };
    }
  }

  const colon = input.lastIndexOf(":");
  if (colon > 0 && input.indexOf(":") === colon && isPort(input.slice(colon + 1))) {
    return { address: input.slice(0, colon), port: input.slice(colon + 1) };
  }

  return { address: stripBrackets(input), port: fallbackPort };
}

/** Build the canonical API value from the two user-facing fields. */
export function combineTeamSpeakTarget(address: string, port: string): string {
  const normalizedAddress = stripBrackets(address.trim());
  const normalizedPort = port.trim() || DEFAULT_TEAM_SPEAK_PORT;
  if (!normalizedAddress) return "";
  return normalizedAddress.includes(":") ? `[${normalizedAddress}]:${normalizedPort}` : `${normalizedAddress}:${normalizedPort}`;
}

export function isValidTeamSpeakPort(value: string): boolean {
  return isPort(value.trim());
}

function isPort(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function stripBrackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}
