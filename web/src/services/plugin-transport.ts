import { pluginRecord, type PluginRequest, type PluginMessage } from "../../../src/shared/plugins.js";

/** Owns requests and event subscribers for one voice connection. */
export function createPluginTransport(socket: () => WebSocket | null, connected: () => boolean) {
  let sequence = 0;
  const pending = new Map<string, { finish(value?: unknown, error?: Error): void }>();
  const listeners = new Set<(message: PluginMessage | { type: "pluginReset" }) => void>();
  function emit(message: PluginMessage | { type: "pluginReset" }): void { for (const listener of [...listeners]) { try { listener(message); } catch { /* isolate presentation */ } } }
  return {
    request(action: PluginRequest["action"], fields: { pluginId?: string; revision?: number; state?: unknown } = {}): Promise<unknown> {
      const ws = socket();
      if (!connected() || ws?.readyState !== 1) return Promise.reject(new Error("PLUGIN_NOT_CONNECTED"));
      if (pending.size >= 16) return Promise.reject(new Error("PLUGIN_RATE_LIMITED"));
      const requestId = `plugin-${Date.now().toString(36)}-${++sequence}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(undefined, new Error("PLUGIN_TIMEOUT")), 15_000);
        const finish = (value?: unknown, error?: Error) => { if (!pending.delete(requestId)) return; clearTimeout(timer); error ? reject(error) : resolve(value); };
        pending.set(requestId, { finish });
        try { ws.send(JSON.stringify({ type: "pluginRequest", requestId, action, ...fields })); }
        catch { finish(undefined, new Error("PLUGIN_NOT_CONNECTED")); }
      });
    },
    receive(value: unknown): boolean {
      if (!pluginRecord(value)) return false;
      if (value.type === "pluginReply") {
        if (typeof value.requestId === "string" && typeof value.ok === "boolean") pending.get(value.requestId)?.finish(value.result,
          value.ok ? undefined : new Error(typeof value.code === "string" ? value.code.slice(0, 80) : "PLUGIN_FAILED"));
        return true;
      }
      if (value.type === "pluginEvent" && typeof value.pluginId === "string" && (value.snapshot === null || pluginRecord(value.snapshot))) {
        emit(value as unknown as PluginMessage); return true;
      }
      return false;
    },
    subscribe(listener: (message: PluginMessage | { type: "pluginReset" }) => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
    reset(): void { for (const item of [...pending.values()]) item.finish(undefined, new Error("PLUGIN_NOT_CONNECTED")); emit({ type: "pluginReset" }); },
  };
}
export type PluginTransport = ReturnType<typeof createPluginTransport>;
