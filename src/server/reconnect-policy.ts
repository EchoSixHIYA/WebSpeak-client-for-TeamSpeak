import type { WebSpeakError } from "../errors.js";

export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000] as const;
export const RECONNECT_WINDOW_MS = 5 * 60_000;

export function reconnectDelayMs(attempt: number, random = Math.random): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base = RECONNECT_DELAYS_MS[Math.min(safeAttempt, RECONNECT_DELAYS_MS.length) - 1] ?? RECONNECT_DELAYS_MS.at(-1)!;
  const jitter = Math.round(base * ((random() * 0.2) - 0.1));
  return Math.max(250, base + jitter);
}

export function reconnectWindowOpen(startedAt: number, now = Date.now()): boolean {
  return now - startedAt < RECONNECT_WINDOW_MS;
}

export function isRecoverable(error: WebSpeakError | null): boolean {
  return error?.retryable ?? true;
}
