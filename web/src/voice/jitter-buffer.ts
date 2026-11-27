/**
 * Playback buffer policy for the PCM-over-WebSocket compatibility path.
 *
 * Cloudflare Tunnel adds bursty delivery on top of normal network jitter. The
 * old player treated every 80 ms overrun as a fatal error and rebuilt the
 * decoder, which turned a short tunnel stall into repeated audible gaps.
 * This policy keeps a small target buffer that grows with observed jitter and
 * lets the player reschedule queued audio without discarding decoder state.
 */

export const MIN_TARGET_AHEAD_MS = 80;
export const MAX_TARGET_AHEAD_MS = 300;
export const MAX_BUFFER_AHEAD_SETTING_MS = 500;

const JITTER_EWMA_FACTOR = 0.9;
const TARGET_JITTER_FACTOR = 2.5;
const MAX_OBSERVED_JITTER_MS = 500;

/** Target play-ahead for a measured jitter; 0 ms maps to the 80 ms floor. */
export function computeTargetAheadMs(jitterMs: number, maxMs = MAX_TARGET_AHEAD_MS): number {
  const boundedMax = Math.max(
    MIN_TARGET_AHEAD_MS,
    Math.min(MAX_BUFFER_AHEAD_SETTING_MS, Number.isFinite(maxMs) ? maxMs : MAX_TARGET_AHEAD_MS),
  );
  const boundedJitter = Math.max(0, Math.min(MAX_OBSERVED_JITTER_MS, Number.isFinite(jitterMs) ? jitterMs : 0));
  return Math.min(boundedMax, Math.max(MIN_TARGET_AHEAD_MS, MIN_TARGET_AHEAD_MS + boundedJitter * TARGET_JITTER_FACTOR));
}

/**
 * Tracks inter-arrival deviation from the frame duration (RFC 3550 style,
 * simplified for a fixed 20 ms Opus stream). A burst or a late packet raises
 * the estimate; sustained stable delivery brings it back down.
 */
export class JitterEstimator {
  private jitterMs = 0;
  private lastArrivalAt: number | null = null;
  private lastDurationMs = 20;

  observe(arrivalAt: number, durationMs: number, maxMs = MAX_TARGET_AHEAD_MS): number {
    const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 20;
    if (this.lastArrivalAt !== null) {
      const delta = arrivalAt - this.lastArrivalAt - this.lastDurationMs;
      const observed = Math.min(MAX_OBSERVED_JITTER_MS, Math.abs(delta));
      this.jitterMs = this.jitterMs * JITTER_EWMA_FACTOR + observed * (1 - JITTER_EWMA_FACTOR);
    }
    this.lastArrivalAt = arrivalAt;
    this.lastDurationMs = duration;
    return this.targetAheadMs(maxMs);
  }

  targetAheadMs(maxMs = MAX_TARGET_AHEAD_MS): number {
    return computeTargetAheadMs(this.jitterMs, maxMs);
  }

  get jitter(): number {
    return this.jitterMs;
  }

  reset(): void {
    this.jitterMs = 0;
    this.lastArrivalAt = null;
    this.lastDurationMs = 20;
  }
}

/** A large positive overrun: drop only the schedule, never the decoder. */
export function shouldResetSchedule(aheadMs: number, targetMs: number): boolean {
  return aheadMs > targetMs + 60;
}

/** The play head is close to real time; pull it back to the target. */
export function shouldRecover(aheadMs: number): boolean {
  return aheadMs < 20;
}
