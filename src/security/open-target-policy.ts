import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";

export class UnsafeTeamSpeakTargetError extends Error {
  constructor(message = "This TeamSpeak target is not allowed in open mode") {
    super(message);
    this.name = "UnsafeTeamSpeakTargetError";
  }
}

/** Resolve and reject addresses that could turn a public gateway into an internal network probe. */
export async function assertSafeOpenTarget(target: TeamSpeakTarget): Promise<void> {
  await resolveSafeOpenTarget(target);
}

export async function resolveSafeOpenTarget(target: TeamSpeakTarget): Promise<TeamSpeakTarget> {
  const literalVersion = isIP(target.host);
  const addresses = literalVersion
    ? [{ address: target.host, family: literalVersion }]
    : await lookup(target.host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isRestrictedAddress(address))) {
    throw new UnsafeTeamSpeakTargetError();
  }
  // Use the address that was actually validated so a second DNS lookup cannot
  // rebind the gateway connection to a private network.
  return { host: addresses[0]!.address, port: target.port };
}

export function isRestrictedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isRestrictedIpv4(address);
  if (version !== 6) return true;

  const normalized = address.toLocaleLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) !== 4 || isRestrictedIpv4(mapped);
  }
  if (normalized.startsWith("::")) return true; // IPv4-compatible and other special compressed forms
  const first = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // deprecated site-local fec0::/10
  if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (normalized.startsWith("2001:db8:")) return true; // documentation range
  return false;
}

function isRestrictedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && parts[2] === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && parts[2] === 100)
    || (a === 203 && b === 0 && parts[2] === 113)
    || a >= 224;
}
