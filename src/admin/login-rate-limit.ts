import { performance } from "node:perf_hooks";

const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;

interface LoginAttempt {
  failures: number;
  pending: number;
  firstFailureAt: number;
}

type Reservation = { allowed: false; retryAfterMs: number }
  | { allowed: true; finish(result: "success" | "failure" | "cancelled"): number };

export class AdminLoginRateLimiter {
  private readonly attempts = new Map<string, LoginAttempt>();
  private pending = 0;

  constructor(private readonly maxTrackedPeers = 1024, private readonly maxConcurrentChecks = 8) {}

  /** Reserve before hashing; pending checks count against capacity, successes are not failures. */
  reserve(peer: string, now = performance.now()): Reservation {
    this.pruneExpired(now);
    const current = this.attempts.get(peer);
    if (current && current.failures + current.pending >= MAX_FAILURES) {
      return { allowed: false, retryAfterMs: Math.max(1000, WINDOW_MS - (now - current.firstFailureAt)) };
    }
    if (this.pending >= this.maxConcurrentChecks || (!current && this.attempts.size >= this.maxTrackedPeers)) {
      // Never evict another visitor's lockout or pending check to admit a new address.
      return { allowed: false, retryAfterMs: 1000 };
    }
    const attempt = current ?? { failures: 0, pending: 0, firstFailureAt: now };
    this.attempts.set(peer, attempt);
    attempt.pending++;
    this.pending++;
    let finished = false;
    return { allowed: true, finish: result => {
      if (finished) return 0;
      finished = true;
      this.pending--;
      attempt.pending--;
      if (result === "success") attempt.failures = 0;
      else if (result === "failure") attempt.failures++;
      if (!attempt.failures && !attempt.pending) this.attempts.delete(peer);
      return result === "failure" ? Math.min(2000, 250 * 2 ** Math.min(3, attempt.failures - 1)) : 0;
    } };
  }

  private pruneExpired(now: number): void {
    for (const [peer, attempt] of this.attempts) {
      if (!attempt.pending && now - attempt.firstFailureAt >= WINDOW_MS) this.attempts.delete(peer);
    }
  }
}

export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
