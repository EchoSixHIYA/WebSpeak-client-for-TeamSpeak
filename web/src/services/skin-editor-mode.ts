import { readonly, ref } from "vue";
import { adminResponses } from "../../../src/shared/admin-responses.js";

export function createSkinEditorModeController(fetcher: typeof fetch = (...args) => globalThis.fetch(...args)) {
  const isAdmin = ref(false);
  const isEnabled = ref(false);
  let pendingCheck: Promise<boolean> | null = null;

  async function refreshAdminAccess(): Promise<boolean> {
    if (pendingCheck) return pendingCheck;
    pendingCheck = (async () => {
      try {
        const response = await fetcher("/api/admin/session", {
          method: "GET",
          headers: { accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Admin session unavailable");
        const session = adminResponses.session(await response.json());
        const authenticated = session.authenticated && session.mustChangePassword === false;
        isAdmin.value = authenticated;
        if (!authenticated) isEnabled.value = false;
        return authenticated;
      } catch {
        isAdmin.value = false;
        isEnabled.value = false;
        return false;
      } finally {
        pendingCheck = null;
      }
    })();
    return pendingCheck;
  }

  async function setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      isEnabled.value = false;
      return true;
    }
    if (!await refreshAdminAccess()) return false;
    isEnabled.value = true;
    return true;
  }

  return {
    isAdmin: readonly(isAdmin),
    isEnabled: readonly(isEnabled),
    refreshAdminAccess,
    setEnabled,
  };
}

const skinEditorMode = createSkinEditorModeController();

export function useSkinEditorMode() {
  return skinEditorMode;
}
