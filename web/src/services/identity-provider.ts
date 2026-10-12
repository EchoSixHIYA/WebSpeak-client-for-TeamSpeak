/** Public host contract for future account and identity providers. */
export interface IdentityProviderLoginRequest {
  /** Stable, provider-owned key. Never infer the provider from its display label. */
  providerId: string;
  /** UI label only; adapters should use providerId for all decisions. */
  providerLabel: string;
}

export type IdentityProviderLoginAdapter = (request: Readonly<IdentityProviderLoginRequest>) => void | Promise<void>;

const adapters = new Map<string, IdentityProviderLoginAdapter>();
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Register a host-owned adapter. Skins can request sign-in but cannot register adapters. */
export function registerIdentityProviderAdapter(
  providerId: string,
  adapter: IdentityProviderLoginAdapter,
): () => void {
  if (!PROVIDER_ID_PATTERN.test(providerId)) throw new TypeError("Invalid identity provider ID.");
  if (typeof adapter !== "function") throw new TypeError("An identity provider adapter must be a function.");
  if (adapters.has(providerId)) throw new Error(`An identity provider adapter is already registered for ${providerId}.`);
  adapters.set(providerId, adapter);
  return () => {
    if (adapters.get(providerId) === adapter) adapters.delete(providerId);
  };
}

/** Ask a registered host adapter to handle a user-initiated sign-in request. */
export async function requestIdentityProviderLogin(
  request: Readonly<IdentityProviderLoginRequest>,
): Promise<boolean> {
  if (!PROVIDER_ID_PATTERN.test(request.providerId)) return false;
  const adapter = adapters.get(request.providerId);
  if (!adapter) return false;
  await adapter(Object.freeze({
    providerId: request.providerId,
    providerLabel: request.providerLabel,
  }));
  return true;
}
