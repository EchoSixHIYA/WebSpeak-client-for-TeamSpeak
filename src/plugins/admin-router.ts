import { Router, type RequestHandler } from "express";
import { PluginRegistry } from "./registry.js";
import { PluginStore } from "./store.js";
import { pluginAssert, pluginRecord, PluginError, parsePluginPackage } from "../shared/plugins.js";

export function createPluginAdminRouter(options: {
  registry?: PluginRegistry; store?: PluginStore; protect: RequestHandler[];
  audit(event: string, data: { id: string; version?: string }): void;
}) {
  const router = Router(), store = options.store ?? new PluginStore();
  const writeGuard = Router(); writeGuard.use(...options.protect);
  router.use((request, response, next) => {
    if (request.method === "GET") return next();
    // Reuse the admin session's same-origin and CSRF rules for every write.
    writeGuard(request, response, next);
  });
  const registry = () => { pluginAssert(options.registry, "PLUGIN_STORAGE_UNAVAILABLE"); return options.registry; };
  router.get("/", (_request, response) => response.json({ plugins: registry().list() }));
  router.get("/store", async (_request, response) => { response.json(await store.list()); });
  router.post("/store/install", async (request, response) => {
    const plugin = await store.install(registry(), request.body);
    options.audit("ADMIN_PLUGIN_INSTALLED", { id: plugin.manifest.id, version: plugin.manifest.version });
    response.status(201).json({ plugin });
  });
  router.post("/upload", async (request, response) => {
    pluginAssert(pluginRecord(request.body));
    const expected = request.body.installedRevision;
    pluginAssert(expected === null || typeof expected === "string");
    const plugin = await registry().install(parsePluginPackage(request.body.package), expected);
    options.audit("ADMIN_PLUGIN_INSTALLED", { id: plugin.manifest.id, version: plugin.manifest.version });
    response.status(201).json({ plugin });
  });
  router.put("/:id/settings", async (request, response) => {
    pluginAssert(pluginRecord(request.body) && typeof request.body.revision === "string");
    const plugin = await registry().configure(String(request.params.id), request.body.settings, request.body.revision);
    options.audit("ADMIN_PLUGIN_CONFIGURED", { id: plugin.manifest.id });
    response.json({ plugin });
  });
  router.delete("/:id", async (request, response) => {
    pluginAssert(pluginRecord(request.body) && typeof request.body.revision === "string");
    await registry().remove(String(request.params.id), request.body.revision);
    options.audit("ADMIN_PLUGIN_REMOVED", { id: String(request.params.id) }); response.json({ ok: true });
  });
  router.use((error: unknown, _request: unknown, response: import("express").Response, _next: unknown) => {
    const code = error instanceof PluginError ? error.code : "PLUGIN_FAILED";
    response.status(code === "PLUGIN_STORE_UNAVAILABLE" ? 502 : code === "PLUGIN_NOT_FOUND" ? 404 : code === "PLUGIN_CHANGED" ? 409 : 400).json({ ok: false, code });
  });
  return router;
}
