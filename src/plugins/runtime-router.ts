import { Router } from "express";
import { PluginRuntime } from "./runtime.js";
import { pluginAssert, PluginError, pluginRecord } from "../shared/plugins.js";

/** Control plane only. Application HTTP/WebSocket traffic lives on the independent origin. */
export function createPluginRuntimeRouter(runtime?: PluginRuntime) {
  const router=Router();
  router.use((_request,response,next)=>{
    response.setHeader("access-control-allow-origin","*");
    response.setHeader("access-control-allow-headers","authorization, content-type");
    response.setHeader("access-control-allow-methods","GET, POST, PATCH, DELETE, OPTIONS");
    response.setHeader("cache-control","no-store");next();
  });
  router.options(/.*/,(_request,response)=>{response.sendStatus(204);});
  const token=(authorization:string|undefined)=>{pluginAssert(typeof authorization==="string"&&authorization.startsWith("Bearer "),"PLUGIN_NOT_CONNECTED");return authorization.slice(7);};
  const service=()=>{pluginAssert(runtime,"PLUGIN_RUNTIME_UNAVAILABLE");return runtime;};
  router.get("/",(request,response)=>{response.json({plugins:service().directory(token(request.header("authorization")))});});
  router.post("/:id/open",async(request,response)=>{
    const origin=request.header("origin")??`${request.protocol}://${request.header("host")}`;
    response.status(201).json(await service().open(token(request.header("authorization")),String(request.params.id),request.body,origin));
  });
  router.delete("/opening/:id",(request,response)=>{service().cancelOpen(token(request.header("authorization")),String(request.params.id));response.json({ok:true});});
  router.patch("/apps/:id",(request,response)=>{
    pluginAssert(pluginRecord(request.body));service().appearance(String(request.params.id),token(request.header("authorization")),request.body);response.json({ok:true});
  });
  router.delete("/apps/:id",(request,response)=>{
    const instance=service(),id=String(request.params.id);pluginAssert(instance.authorizeApp(id,token(request.header("authorization"))),"PLUGIN_NOT_OPEN");instance.closeApp(id);response.json({ok:true});
  });
  router.use((error:unknown,_request:unknown,response:import("express").Response,_next:unknown)=>{
    const code=error instanceof PluginError?error.code:"PLUGIN_RUNTIME_FAILED";
    response.status(code==="PLUGIN_NOT_CONNECTED"?401:code==="PLUGIN_NOT_FOUND"?404:code==="PLUGIN_RUNTIME_UNAVAILABLE"?503:403).json({ok:false,code});
  });
  return router;
}
