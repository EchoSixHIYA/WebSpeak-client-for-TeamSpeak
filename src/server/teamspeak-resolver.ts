import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const LOCAL_ALIAS_LOOKUP_TIMEOUT_MS = 1_000;

type LocalAddress = { address: string; family: number };
type LocalLookup = (hostname: string) => Promise<LocalAddress[]>;

/**
 * Resolve an internal short hostname before the upstream SDK's SRV/TSDNS and
 * optional nickname resolution. Public hosts are left to the SDK's resolver.
 */
export async function resolveLocalTeamSpeakAlias(
  host: string,
  options: { lookup?: LocalLookup; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string | undefined> {
  if (!/^[a-z0-9_-]+$/i.test(host)) return undefined;
  const localLookup = options.lookup ?? ((name: string) => lookup(name, { all: true, verbatim: true }));
  const addresses = await raceWithTimeout(
    Promise.resolve().then(() => localLookup(host)),
    options.timeoutMs ?? LOCAL_ALIAS_LOOKUP_TIMEOUT_MS,
    options.signal,
  ).catch((error: unknown) => {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    return null;
  });
  return addresses?.find(({ address }) => isPrivateNetworkAddress(address))?.address;
}

function isPrivateNetworkAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number];
    return a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (version !== 6) return false;

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateNetworkAddress(normalized.slice("::ffff:".length));
  if (normalized === "::" || normalized === "::1") return true;
  const firstGroup = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  return (firstGroup & 0xfe00) === 0xfc00 || (firstGroup & 0xffc0) === 0xfe80;
}

function raceWithTimeout<T>(work: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("TeamSpeak address resolution was aborted"));

  return new Promise<T | null>((resolve, reject) => {
    let settled = false;
    const finish = (callback: (value: T | null) => void, value: T | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("TeamSpeak address resolution was aborted"));
    };
    const timer = setTimeout(() => finish(resolve, null), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => finish(resolve, value),
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
