import { adminResponses, type AdminResponseReader } from "../../../src/shared/admin-responses.js";
import type { AdminSettingsInput, ManagedInviteInput, TsAdminSettingsInput, TsAdminActionRequest } from "../../../src/shared/admin-inputs.js";
import type { SkinStoreInstallInput } from "../../../src/shared/skin-store.js";

export class AdminApiError extends Error {
  constructor(readonly code: string, readonly status = 0, message = code) {
    super(message);
    this.name = "AdminApiError";
  }
}

interface AdminApiOptions {
  csrfToken(): string;
  onUnauthorized?(): void;
  fetch?: typeof fetch;
}

interface RequestContext {
  token: string;
  signal: AbortSignal;
  assertCurrent(): void;
}

export function isAdminRequestCancelled(error: unknown): boolean {
  return error instanceof AdminApiError && error.code === "REQUEST_CANCELLED";
}

export function createAdminApi(options: AdminApiOptions) {
  const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let generation = 0;
  const pending = new Set<AbortController>();

  async function execute<T>(signal: AbortSignal | undefined, run: (context: RequestContext) => Promise<T>): Promise<T> {
    const owner = generation;
    const token = options.csrfToken();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    pending.add(controller);
    const context: RequestContext = { token, signal: controller.signal, assertCurrent() {
      if (controller.signal.aborted || owner !== generation || token !== options.csrfToken()) {
        throw new AdminApiError("REQUEST_CANCELLED");
      }
    } };
    try {
      context.assertCurrent();
      const value = await run(context);
      context.assertCurrent();
      return value;
    } catch (error) {
      context.assertCurrent();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      pending.delete(controller);
    }
  }

  async function transport(context: RequestContext, path: string, init: RequestInit = {}, authenticated = true): Promise<Response> {
    context.assertCurrent();
    const headers = new Headers(init.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    if (init.method && init.method !== "GET") {
      const token = authenticated ? context.token : "";
      if (token) headers.set("x-csrf-token", token);
    }
    let response: Response;
    try {
      response = await fetcher(`/api/admin${path}`, { ...init, headers, signal: context.signal });
    } catch {
      throw new AdminApiError("REQUEST_FAILED");
    }
    // Only the session that started the request may be expired by its response.
    context.assertCurrent();
    // Notify even if a proxy returned HTML instead of a JSON error body.
    if (response.status === 401 && authenticated) options.onUnauthorized?.();
    if (!response.ok) {
      const value: unknown = await response.json().catch(() => undefined);
      const code = value && typeof value === "object" && "code" in value && typeof value.code === "string" && value.code
        ? value.code : "REQUEST_FAILED";
      const message = value && typeof value === "object" && "message" in value && typeof value.message === "string" ? value.message : code;
      throw new AdminApiError(code, response.status, message);
    }
    return response;
  }
  async function decode<T>(response: Response, read: AdminResponseReader<T>): Promise<T> {
    const value: unknown = await response.json().catch(() => undefined);
    try { return read(value); }
    catch { throw new AdminApiError("INVALID_ADMIN_RESPONSE", response.status); }
  }
  function request<T>(path: string, read: AdminResponseReader<T>, method = "GET", body?: unknown, authenticated = true, signal?: AbortSignal): Promise<T> {
    return execute(signal, async context => {
      const response = await transport(context, path, {
        method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      }, authenticated);
      return decode(response, read);
    });
  }

  return {
    invalidate() { generation++; for (const controller of pending) controller.abort(); },
    session: (signal?: AbortSignal) => request("/session", adminResponses.session, "GET", undefined, true, signal),
    login: (username: string, password: string, signal?: AbortSignal) => request("/login", adminResponses.login, "POST", { username, password }, false, signal),
    changePassword: (newPassword: string, signal?: AbortSignal) => request("/change-password", adminResponses.ok, "POST", { newPassword }, true, signal),
    logout: (signal?: AbortSignal) => request("/logout", adminResponses.ok, "POST", {}, true, signal),
    overview: (signal?: AbortSignal) => request("/overview", adminResponses.overview, "GET", undefined, true, signal),
    settings: (signal?: AbortSignal) => request("/server", adminResponses.settings, "GET", undefined, true, signal),
    saveSettings: (body: AdminSettingsInput, signal?: AbortSignal) => request("/server", adminResponses.savedSettings, "PUT", body, true, signal),
    tsAdminSettings: (signal?: AbortSignal) => request("/ts-admin/settings", adminResponses.tsAdminSettings, "GET", undefined, true, signal),
    saveTsAdminSettings: (body: TsAdminSettingsInput, signal?: AbortSignal) => request("/ts-admin/settings", adminResponses.savedTsAdminSettings, "PUT", body, true, signal),
    tsAdminOverview: (signal?: AbortSignal) => request("/ts-admin/overview", adminResponses.tsAdminOverview, "POST", {}, true, signal),
    tsAdminAction: (body: TsAdminActionRequest, signal?: AbortSignal) => request("/ts-admin/action", adminResponses.ok, "POST", body, true, signal),
    probe: (body: Pick<AdminSettingsInput, "target" | "serverPassword" | "passwordAction">, signal?: AbortSignal) => request("/server/test", adminResponses.probe, "POST", body, true, signal),
    sessions: (signal?: AbortSignal) => request("/sessions", adminResponses.sessions, "GET", undefined, true, signal),
    terminateSession: (id: string, signal?: AbortSignal) => request(`/sessions/${encodeURIComponent(id)}/terminate`, adminResponses.ok, "POST", {}, true, signal),
    invites: (signal?: AbortSignal) => request("/invites", adminResponses.invites, "GET", undefined, true, signal),
    createInvite: (body: ManagedInviteInput, signal?: AbortSignal) => request("/invites", adminResponses.createdInvite, "POST", body, true, signal),
    revokeInvite: (id: string, signal?: AbortSignal) => request(`/invites/${encodeURIComponent(id)}/revoke`, adminResponses.ok, "POST", {}, true, signal),
    diagnostics: (signal?: AbortSignal) => request("/diagnostics", adminResponses.diagnostics, "GET", undefined, true, signal),
    logs: (signal?: AbortSignal) => request("/logs?limit=100", adminResponses.logs, "GET", undefined, true, signal),
    audit: (signal?: AbortSignal) => request("/audit?limit=50", adminResponses.audit, "GET", undefined, true, signal),
    skins: (signal?: AbortSignal) => request("/skins", adminResponses.skins, "GET", undefined, true, signal),
    skinStore: (refresh = false, signal?: AbortSignal) => request(refresh ? "/skin-store/refresh" : "/skin-store", adminResponses.skinStore, refresh ? "POST" : "GET", refresh ? {} : undefined, true, signal),
    installStoreSkin: (body: SkinStoreInstallInput, signal?: AbortSignal) => request("/skin-store/install", adminResponses.uploadedSkin, "POST", body, true, signal),
    setDefaultSkin: (id: string, signal?: AbortSignal) => request("/skins/default", adminResponses.defaultSkin, "PUT", { id }, true, signal),
    setSkinEnabled: (id: string, enabled: boolean, signal?: AbortSignal) => request(`/skins/${encodeURIComponent(id)}/enabled`, adminResponses.updatedSkin, "PUT", { enabled }, true, signal),
    deleteSkin: (id: string, signal?: AbortSignal) => request(`/skins/${encodeURIComponent(id)}`, adminResponses.ok, "DELETE", {}, true, signal),
    uploadSkin(file: File, confirmReplace?: (id: string) => boolean, signal?: AbortSignal) {
      return execute(signal, async context => {
        const { importSkinPack } = await import("./skin-pack.js");
        context.assertCurrent();
        const skin = await importSkinPack(file);
        context.assertCurrent();
        if (confirmReplace && !confirmReplace(skin.id)) return null;
        const response = await transport(context, `/skins/${encodeURIComponent(skin.id)}`, {
          method: "PUT", headers: { "content-type": "application/octet-stream" }, body: file,
        });
        return (await decode(response, adminResponses.uploadedSkin)).skin;
      });
    },
    backup: (signal?: AbortSignal) => execute(signal, async context => (await transport(context, "/backup", { headers: { accept: "application/octet-stream" } })).blob()),
    dismissLegacyNotice: (signal?: AbortSignal) => request("/legacy-import/dismiss", adminResponses.ok, "POST", {}, true, signal),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
