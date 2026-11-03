import { computed, readonly, ref } from 'vue';
import type { SiteLanguage } from '../../../src/site-copy.js';

export const INSTANCE_AUTHORIZATION_KEY = 'webspeak:instance-authorization:v1';
export const OFFICIAL_SKIN_IDS = new Set(['builtin.light', 'builtin.dark', 'community.illusia-voice']);
type AuthorizationStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** A decision belongs to this browser origin, never to a skin package or a TS account. */
export function createInstanceAuthorization(storage: AuthorizationStorage) {
  function read(): boolean | null {
    try {
      const value = JSON.parse(storage.getItem(INSTANCE_AUTHORIZATION_KEY) ?? 'null');
      return value?.schemaVersion === 1 && typeof value.allowed === 'boolean' ? value.allowed : null;
    } catch { return null; }
  }
  const decision = ref<boolean | null>(read());
  return {
    decision: readonly(decision),
    allowed: computed(() => decision.value === true),
    set(allowed: boolean) {
      // Notify consumers synchronously so revocation also retires in-flight loads.
      decision.value = allowed;
      try { storage.setItem(INSTANCE_AUTHORIZATION_KEY, JSON.stringify({ schemaVersion: 1, allowed })); } catch { /* Keep this page's explicit decision when storage is unavailable. */ }
    },
    reload() { decision.value = read(); },
  };
}

const store = createInstanceAuthorization({
  getItem: key => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key, value) => { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); },
});
export const authorizationDecision = store.decision;
export const thirdPartyAllowed = store.allowed;
export const authorizationRequested = ref(false);
export const authorizationLanguage = ref<SiteLanguage>('zh');
export const setInstanceAuthorization = store.set;
export const canUseSkin = (id: string) => OFFICIAL_SKIN_IDS.has(id) || thirdPartyAllowed.value;
export function openInstanceAuthorization() { authorizationRequested.value = true; }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('storage', event => {
  if (event.key === INSTANCE_AUTHORIZATION_KEY || event.key === null) store.reload();
});
