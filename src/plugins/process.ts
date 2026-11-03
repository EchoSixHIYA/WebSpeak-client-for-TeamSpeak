import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Logger } from "../logger.js";
import { PluginError, pluginRecord, type JsonValue } from "../shared/plugins.js";

export class PluginProcess {
  readonly token = randomBytes(32).toString("base64url");
  readonly child: ChildProcess;
  readonly ready: Promise<number>;
  readonly exited: Promise<void>;
  port = 0;
  private stopping = false;
  private finished = false;
  private closePromise?: Promise<void>;
  constructor(options: {
    entry: string; codeDirectory: string; dataDirectory: string; config: JsonValue; publicConfig: JsonValue;
    logger: Logger; onExit(): void; startupMs?: number;
  }) {
    const typescript = import.meta.url.endsWith(".ts");
    const worker = fileURLToPath(new URL(typescript ? "./worker.ts" : "./worker.js", import.meta.url));
    const execArgv = [...(typescript ? ["--import", import.meta.resolve("tsx")] : []), "--max-old-space-size=256"];
    // Separate process and reduced environment; reviewed backend code still has the OS user's permissions.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "NODE_EXTRA_CA_CERTS"]) if (process.env[key]) env[key] = process.env[key];
    this.child = spawn(process.execPath, [...execArgv, worker], { cwd: options.codeDirectory, env, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    let resolveExit!: () => void;
    this.exited = new Promise(resolve => { resolveExit = resolve; });
    let resolveReady!: (port: number) => void, rejectReady!: (error: Error) => void;
    this.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const timer = setTimeout(() => { rejectReady(new PluginError("PLUGIN_START_TIMEOUT")); void this.close(); }, options.startupMs ?? 10000);
    let logWindow = Date.now(), logs = 0;
    this.child.on("message", value => {
      if (!pluginRecord(value) || this.stopping) return;
      if (value.type === "ready" && Number.isInteger(value.port) && Number(value.port) > 0 && Number(value.port) <= 65535) {
        clearTimeout(timer); this.port = Number(value.port); resolveReady(this.port);
      } else if (value.type === "failed") {
        clearTimeout(timer); rejectReady(new PluginError("PLUGIN_START_FAILED")); void this.close();
      } else if (value.type === "log" && typeof value.message === "string") {
        if (Date.now() - logWindow > 1000) { logWindow = Date.now(); logs = 0; }
        if (++logs <= 20) options.logger.debug({ message: value.message.slice(0, 1000) }, "Plugin application log");
      }
    });
    const finish = () => {
      if (this.finished) return; this.finished = true; clearTimeout(timer);
      rejectReady(new PluginError(this.stopping ? "PLUGIN_STOPPED" : "PLUGIN_PROCESS_EXITED"));
      resolveExit(); if (!this.stopping) options.onExit();
    };
    this.child.once("error", finish); this.child.once("exit", finish);
    this.child.send({ type: "initialize", entry: options.entry, dataDir: options.dataDirectory, config: options.config, publicConfig: options.publicConfig, token: this.token }, error => {
      if (error) { rejectReady(new PluginError("PLUGIN_START_FAILED")); void this.close(); }
    });
  }
  event(name: string, payload: unknown): void {
    if (this.stopping || this.finished || !this.child.connected) return;
    try { this.child.send({ type: "event", name, payload }, () => undefined); } catch { /* Retired worker. */ }
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.stopping = true;
    this.closePromise = (async () => {
      if (this.finished) return;
      if (this.child.connected) { try { this.child.send({ type: "stop" }, () => undefined); } catch {} }
      const killer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
      try { await this.exited; } finally { clearTimeout(killer); }
    })();
    return this.closePromise;
  }
}
