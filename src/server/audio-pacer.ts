import { performance } from "node:perf_hooks";

/**
 * A tiny 20 ms sender for browser PCM/Opus uplink. Cloudflare Tunnel can
 * deliver a burst of WebSocket frames at once; forwarding those frames to
 * TeamSpeak immediately preserves the burst and makes the receiving client's
 * jitter buffer work harder. This pacer absorbs the burst and emits at a fixed
 * cadence, dropping the oldest frame only when the queue is genuinely behind.
 */

export interface PacerFrame {
  data: Buffer;
  codec: number;
  enqueuedAt: number;
}

export interface AudioPacerOptions {
  frameMs?: number;
  maxFrames?: number;
  maxLagMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  onStats?: (stats: AudioPacerStats) => void;
}

export interface AudioPacerStats {
  currentFrames: number;
  peakFrames: number;
  droppedFrames: number;
  lateTicks: number;
  sentFrames: number;
}

export class AudioPacer {
  private readonly frameMs: number;
  private readonly maxFrames: number;
  private readonly maxLagMs: number;
  private readonly now: () => number;
  private readonly schedule: NonNullable<AudioPacerOptions["schedule"]>;
  private readonly cancel: NonNullable<AudioPacerOptions["cancel"]>;
  private readonly onStats: AudioPacerOptions["onStats"];
  private readonly queue: PacerFrame[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt: number | null = null;
  private closed = false;
  private droppedFrames = 0;
  private lateTicks = 0;
  private sentFrames = 0;
  private peakFrames = 0;

  constructor(
    private readonly send: (data: Buffer, codec: number) => void,
    options: AudioPacerOptions = {},
  ) {
    this.frameMs = Math.max(1, options.frameMs ?? 20);
    this.maxFrames = Math.max(1, options.maxFrames ?? 6);
    this.maxLagMs = Math.max(0, options.maxLagMs ?? 40);
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle));
    this.onStats = options.onStats;
  }

  push(data: Buffer, codec: number): boolean {
    if (this.closed || !data.length) return false;
    while (this.queue.length >= this.maxFrames) {
      this.queue.shift();
      this.droppedFrames++;
    }
    this.queue.push({ data, codec, enqueuedAt: this.now() });
    this.peakFrames = Math.max(this.peakFrames, this.queue.length);
    if (!this.timer) {
      this.nextAt = this.now();
      this.arm(0);
    }
    this.emitStats();
    return true;
  }

  private arm(delayMs: number): void {
    this.timer = this.schedule(() => this.tick(), Math.max(0, delayMs));
    // Do not keep the Node process alive solely for an idle voice pacer.
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  private tick(): void {
    this.timer = null;
    if (this.closed) return;
    if (!this.queue.length) {
      this.nextAt = null;
      return;
    }
    const now = this.now();
    if (this.nextAt !== null && now - this.nextAt > this.maxLagMs) {
      // A late event loop turn must not create a catch-up burst. Drop the
      // accumulated backlog of time and emit one frame from the current time.
      this.lateTicks++;
      this.nextAt = now;
    }
    const frame = this.queue.shift()!;
    try { this.send(frame.data, frame.codec); } catch { /* sendVoice reports its own failure */ }
    this.sentFrames++;
    if (this.queue.length) {
      this.nextAt = this.nextAt === null ? now + this.frameMs : this.nextAt + this.frameMs;
      if (this.nextAt < now + 1) this.nextAt = now + this.frameMs;
      this.arm(this.nextAt - now);
    } else {
      this.nextAt = null;
    }
    this.emitStats();
  }

  private emitStats(): void {
    this.onStats?.(this.getStats());
  }

  getStats(): AudioPacerStats {
    return {
      currentFrames: this.queue.length,
      peakFrames: this.peakFrames,
      droppedFrames: this.droppedFrames,
      lateTicks: this.lateTicks,
      sentFrames: this.sentFrames,
    };
  }

  close(): void {
    this.closed = true;
    if (this.timer) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.queue.length = 0;
    this.nextAt = null;
    this.emitStats();
  }
}
