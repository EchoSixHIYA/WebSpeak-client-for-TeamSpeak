import { isIP } from "node:net";
import { lookup, resolveSrv } from "node:dns/promises";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { parseTeamSpeakTarget } from "../domain/teamspeak-target.js";

export class UnsafeTeamSpeakTargetError extends Error {
  constructor(message = "This TeamSpeak target is not allowed in open mode") {
    super(message);
    this.name = "UnsafeTeamSpeakTargetError";
  }
}

export class TeamSpeakTargetResolutionError extends Error {
  constructor(message = "TeamSpeak target could not be resolved", options?: ErrorOptions) {
    super(message, options);
    this.name = "TeamSpeakTargetResolutionError";
  }
}

/** Resolve and reject addresses that could turn a public gateway into an internal network probe. */
export async function assertSafeOpenTarget(target: TeamSpeakTarget): Promise<void> {
  await resolveSafeOpenTarget(target);
}

type ResolvedAddress = { address: string; family: number };
type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>;
type TeamSpeakSrvRecord = { name: string; port: number; priority: number; weight: number };
type TeamSpeakSrvLookup = (service: string) => Promise<TeamSpeakSrvRecord[]>;

export async function resolveSafeOpenTarget(
  target: TeamSpeakTarget,
  options: { lookup?: AddressLookup; resolveSrv?: TeamSpeakSrvLookup } = {},
): Promise<TeamSpeakTarget> {
  const addressLookup = options.lookup ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
  if (!isIP(target.host) && target.host.includes(".") && target.host !== "localhost") {
    const srvLookup = options.resolveSrv ?? resolveSrv;
    let srvRecords: TeamSpeakSrvRecord[] = [];
    try {
      srvRecords = await srvLookup(`_ts3._udp.${target.host}`);
    } catch {
      // No SRV record is normal; use the regular address lookup below.
    }

    if (srvRecords.length > 0) {
      const srvTargets = srvRecords.map(({ name, port }) => {
        const srvHost = name.replace(/\.$/, "");
        if (!srvHost || !Number.isInteger(port) || port < 1 || port > 65535) {
          throw new TeamSpeakTargetResolutionError("Invalid TeamSpeak SRV record");
        }
        try {
          return parseTeamSpeakTarget(`${srvHost}:${port}`);
        } catch (error: unknown) {
          throw new TeamSpeakTargetResolutionError("Invalid TeamSpeak SRV record", { cause: error });
        }
      });
      const safeTargets = await Promise.all(srvTargets.map((srvTarget) => resolveSafeAddress(srvTarget, addressLookup)));
      // The SDK uses the first record returned by the system SRV resolver;
      // keep that ordering while validating every advertised destination.
      return safeTargets[0]!;
    }
  }

  return resolveSafeAddress(target, addressLookup);
}

async function resolveSafeAddress(target: TeamSpeakTarget, addressLookup: AddressLookup): Promise<TeamSpeakTarget> {
  const literalVersion = isIP(target.host);
  let addresses: ResolvedAddress[];
  try {
    addresses = literalVersion
      ? [{ address: target.host, family: literalVersion }]
      : await addressLookup(target.host);
  } catch (error: unknown) {
    throw new TeamSpeakTargetResolutionError(undefined, { cause: error });
  }
  // Mihomo's default fake-IP pool is 198.18.0.0/16, allowing its TUN to
  // route the eventual socket by hostname. Accept this only for DNS names
  // whose complete answer set is synthetic; literal and mixed answers remain
  // blocked, preserving the open-mode SSRF boundary.
  const mihomoFakeIpResolution = !literalVersion
    && addresses.length > 0
    && addresses.every(({ address }) => isMihomoFakeIpv4(address));
  if (!addresses.length || (!mihomoFakeIpResolution && addresses.some(({ address }) => isRestrictedAddress(address)))) {
    throw new UnsafeTeamSpeakTargetError();
  }
  // Use the address that was actually validated so a second DNS lookup cannot
  // rebind the gateway connection to a private network.
  return { host: addresses[0]!.address, port: target.port };
}

/** A bounded, non-authoritative check used only to avoid pre-filling a target that open mode will reject. */
export async function isSafeOpenTargetForPrefill(
  target: TeamSpeakTarget,
  options: { timeoutMs?: number; resolveTarget?: (target: TeamSpeakTarget) => Promise<TeamSpeakTarget> } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const resolveTarget = options.resolveTarget ?? resolveSafeOpenTarget;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => resolveTarget(target)).then(() => true, () => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

function isMihomoFakeIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 198 && second === 18;
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
