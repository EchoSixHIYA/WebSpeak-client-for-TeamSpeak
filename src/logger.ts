import pino from "pino";
import { appendFile, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { Writable } from "node:stream";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_ROTATED_LOGS = 3;

export interface Logger {
  debug(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(logDir?: string): Logger {
  const loggerOptions = {
    level: "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["password", "*.password", "serverPassword", "*.serverPassword", "token", "*.token", "identity", "*.identity"],
      censor: "[Redacted]",
    },
  };
  const baseLogger = logDir
    ? createFileLogger(loggerOptions, `${logDir}/webspeak.log`)
    : pino(loggerOptions, pino.destination(1));

  function wrap(l: pino.Logger): Logger {
    function doLog(
      level: "debug" | "info" | "warn" | "error",
      objOrMsg: Record<string, unknown> | string,
      msg?: string,
    ): void {
      if (typeof objOrMsg === "string") {
        l[level](objOrMsg);
      } else {
        l[level](objOrMsg, msg);
      }
    }

    return {
      debug: (objOrMsg: Record<string, unknown> | string, msg?: string) =>
        doLog("debug", objOrMsg, msg),
      info: (objOrMsg: Record<string, unknown> | string, msg?: string) =>
        doLog("info", objOrMsg, msg),
      warn: (objOrMsg: Record<string, unknown> | string, msg?: string) =>
        doLog("warn", objOrMsg, msg),
      error: (objOrMsg: Record<string, unknown> | string, msg?: string) =>
        doLog("error", objOrMsg, msg),
      child: (bindings: Record<string, unknown>) => wrap(l.child(bindings)),
    };
  }

  return wrap(baseLogger);
}

function createFileLogger(options: { level: string; timestamp: typeof pino.stdTimeFunctions.isoTime }, logPath: string): pino.Logger {
  mkdirSync(logPath.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  return pino(options, pino.multistream([
    { level: "info", stream: process.stdout },
    { level: "debug", stream: new RotatingFileStream(logPath) },
  ]));
}

class RotatingFileStream extends Writable {
  private bytes: number;

  constructor(private readonly filePath: string) {
    super();
    this.bytes = existsSync(filePath) ? statSync(filePath).size : 0;
    if (this.bytes >= MAX_LOG_BYTES) this.rotate();
  }

  override _write(chunk: unknown, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding);
    try {
      if (this.bytes + buffer.length > MAX_LOG_BYTES) this.rotate();
      appendFile(this.filePath, buffer, (error) => {
        if (!error) this.bytes += buffer.length;
        callback(error);
      });
    } catch (error: unknown) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private rotate(): void {
    for (let index = MAX_ROTATED_LOGS - 1; index >= 1; index--) {
      const source = `${this.filePath}.${index}`;
      const destination = `${this.filePath}.${index + 1}`;
      if (existsSync(source)) renameSync(source, destination);
    }
    if (existsSync(this.filePath)) renameSync(this.filePath, `${this.filePath}.1`);
    this.bytes = 0;
  }
}
