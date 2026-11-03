/** Child-process entrypoint. Reviewed applications run normal Node.js, not a JS sandbox. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type Socket } from "node:net";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import type { JsonValue, PluginRequestContext } from "../shared/plugins.js";

interface RequestContext extends IncomingMessage { webspeak?: PluginRequestContext }
interface Application {
  handle(request: RequestContext, response: ServerResponse): unknown;
  upgrade?(request: RequestContext, socket: Socket, head: Buffer): unknown;
  stop?(): unknown;
}
interface Initialization { type: "initialize"; entry: string; dataDir: string; config: JsonValue; publicConfig: JsonValue; token: string }
const events = new EventEmitter(), abort = new AbortController(), sockets = new Set<Socket>();
let application: Application | undefined, initialized = false, stopping = false, secret = "";
const server = createServer((request: RequestContext, response) => {
  if (!authorize(request)) { response.writeHead(403).end(); return; }
  Promise.resolve().then(() => application!.handle(request, response)).catch(() => {
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
    if (!response.destroyed) response.end('{"error":"PLUGIN_HANDLER_FAILED"}');
  });
});
function authorize(request: RequestContext): boolean {
  if (!secret || request.headers["x-webspeak-runtime"] !== secret) return false;
  delete request.headers["x-webspeak-runtime"];
  try {
    const context = JSON.parse(Buffer.from(String(request.headers["x-webspeak-context"]), "base64url").toString("utf8"));
    if (context?.apiVersion !== 2 || !context.self?.id || !context.scope?.key) return false;
    request.webspeak = context;
    delete request.headers["x-webspeak-context"];
    return true;
  } catch { return false; }
}
server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
server.on("upgrade", (request: RequestContext, socket: Socket, head) => {
  if (!authorize(request) || !application?.upgrade) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
  Promise.resolve().then(() => application!.upgrade!(request, socket, head)).catch(() => socket.destroy());
});
server.on("error", () => { process.send?.({ type: "failed", code: "PLUGIN_LISTEN_FAILED" }); void stop(); });
async function initialize(value: Initialization): Promise<void> {
  if (initialized) return;
  initialized = true; secret = value.token;
  try {
    const module = await import(pathToFileURL(value.entry).href);
    if (typeof module.default !== "function") throw new Error("Expected a default activation function");
    const result = await module.default({
      dataDir: value.dataDir, config: value.config, publicConfig: value.publicConfig, events, signal: abort.signal,
      log(level: string, message: unknown) { process.send?.({ type: "log", level, message: String(message).slice(0, 1000) }); },
    });
    if (stopping) return;
    application = typeof result === "function" ? { handle: result } : result;
    if (!application || typeof application.handle !== "function") throw new Error("Expected a Node HTTP request handler");
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") process.send?.({ type: "ready", port: address.port });
    });
  } catch { process.send?.({ type: "failed", code: "PLUGIN_START_FAILED" }); await stop(); }
}
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true; abort.abort();
  for (const socket of sockets) socket.destroy();
  server.close();
  try { await application?.stop?.(); } catch { /* Disposal cannot keep the worker alive. */ }
  events.removeAllListeners();
  if (process.connected) process.disconnect();
  process.exit(0);
}
process.on("message", (value: unknown) => {
  if (!value || typeof value !== "object" || !("type" in value)) return;
  if (value.type === "initialize") void initialize(value as Initialization);
  else if (value.type === "stop") void stop();
  else if (value.type === "event" && "name" in value && typeof value.name === "string" && !stopping) {
    try { events.emit(value.name, "payload" in value ? value.payload : undefined); } catch { /* App event failure is local to this worker. */ }
  }
});
process.once("disconnect", () => void stop());
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
