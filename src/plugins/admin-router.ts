import express, { Router, type RequestHandler } from "express";
import { PluginRegistry } from "./registry.js";
import { PluginStore } from "./store.js";
import type { PluginRuntime } from "./runtime.js";
import { pluginAssert, pluginRecord, PluginError, parsePluginPackage } from "../shared/plugins.js";

export function createPluginAdminRouter(options: {
  registry?: PluginRegistry; store?: PluginStore; runtime?: PluginRuntime; protect: RequestHandler[];
  audit(event: string, data: { id: string; version?: string }): void;
}) {
  const router = Router(), store = options.store ?? new PluginStore();
  const writeGuard = Router(); writeGuard.use(...options.protect);
  router.use((request, response, next) => {
    if (request.method === "GET") return next();
    // Reuse the admin session's same-origin and CSRF rules for every write.
    writeGuard(request, response, next);
  });
  // The parent authenticates before parsing a potentially large application bundle.
  router.use(express.json({limit:"50mb"}));
  const registry = () => { pluginAssert(options.registry, "PLUGIN_STORAGE_UNAVAILABLE"); return options.registry; };
  const project=(plugin:ReturnType<PluginRegistry["list"]>[number])=>({...plugin,runtime:options.runtime?.status(plugin.manifest.id)??{state:plugin.settings.enabled?(plugin.manifest.server?"stopped":"client"):"disabled"}});
  router.get("/", (_request, response) => response.json({ plugins: registry().list().map(project) }));
  router.get("/runtime",(_request,response)=>{pluginAssert(options.runtime,"PLUGIN_RUNTIME_UNAVAILABLE");response.json({runtime:options.runtime.settings()});});
  router.put("/runtime",async(request,response)=>{
    pluginAssert(options.runtime&&pluginRecord(request.body));const runtime=await options.runtime.configureOrigin(request.body.publicOrigin,request.body.revision);
    options.audit("ADMIN_PLUGIN_RUNTIME_CONFIGURED",{id:"runtime"});response.json({runtime});
  });
  router.get("/store", async (_request, response) => { response.json(await store.list()); });
  router.post("/store/install", async (request, response) => {
    const plugin = await store.install(registry(), request.body);
    options.audit("ADMIN_PLUGIN_INSTALLED", { id: plugin.manifest.id, version: plugin.manifest.version });
    response.status(201).json({ plugin:project(plugin) });
  });
  router.post("/upload", async (request, response) => {
    pluginAssert(pluginRecord(request.body));
    const expected = request.body.installedRevision;
    pluginAssert(expected === null || typeof expected === "string");
    const plugin = await registry().install(parsePluginPackage(request.body.package), expected);
    options.audit("ADMIN_PLUGIN_INSTALLED", { id: plugin.manifest.id, version: plugin.manifest.version });
    response.status(201).json({ plugin:project(plugin) });
  });
  router.put("/:id/settings", async (request, response) => {
    pluginAssert(pluginRecord(request.body) && typeof request.body.revision === "string");
    const plugin = await registry().configure(String(request.params.id), request.body.settings, request.body.revision);
    await options.runtime?.synchronize(plugin.manifest.id);
    options.audit("ADMIN_PLUGIN_CONFIGURED", { id: plugin.manifest.id });
    response.json({ plugin:project(plugin) });
  });
  router.post("/:id/restart",async(request,response)=>{
    pluginAssert(options.runtime&&pluginRecord(request.body));const id=String(request.params.id),plugin=registry().policy(id);
    pluginAssert(plugin,"PLUGIN_NOT_FOUND");pluginAssert(plugin.revision===request.body.revision,"PLUGIN_CHANGED");pluginAssert(plugin.settings.enabled&&plugin.settings.trusted,"PLUGIN_DISABLED");
    await options.runtime.restart(id);options.audit("ADMIN_PLUGIN_RESTARTED",{id});response.json({plugin:project(plugin)});
  });
  router.delete("/:id", async (request, response) => {
    pluginAssert(pluginRecord(request.body) && typeof request.body.revision === "string");
    await registry().remove(String(request.params.id), request.body.revision);
    await options.runtime?.synchronize(String(request.params.id));
    options.audit("ADMIN_PLUGIN_REMOVED", { id: String(request.params.id) }); response.json({ ok: true });
  });
  router.use((error: unknown, _request: unknown, response: import("express").Response, _next: unknown) => {
    const tooLarge=pluginRecord(error)&&error.type==="entity.too.large";
    const code = tooLarge?"PLUGIN_TOO_LARGE":error instanceof PluginError ? error.code : "PLUGIN_FAILED";
    response.status(tooLarge?413:code === "PLUGIN_STORE_UNAVAILABLE" ? 502 : code === "PLUGIN_NOT_FOUND" ? 404 : code === "PLUGIN_CHANGED" ? 409 : 400).json({ ok: false, code });
  });
  return router;
}
