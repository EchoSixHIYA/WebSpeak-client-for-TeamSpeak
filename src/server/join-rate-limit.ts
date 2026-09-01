const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 30;

interface PeerWindow {
  startedAt: number;
  requests: number;
}

/** Bounds opaque join-ticket creation so one peer cannot fill the in-memory store. */
export class JoinRateLimiter {
  private readonly peers = new Map<string, PeerWindow>();

  constructor(private readonly maxTrackedPeers = 2048) {}

  allow(peer: string, now = Date.now()): boolean {
    const current = this.peers.get(peer);
    if (!current || now - current.startedAt >= WINDOW_MS) {
      this.prune(now);
      while (this.peers.size >= this.maxTrackedPeers) {
        const oldest = this.peers.keys().next().value;
        if (!oldest) break;
        this.peers.delete(oldest);
      }
      this.peers.set(peer, { startedAt: now, requests: 1 });
      return true;
    }
    if (current.requests >= MAX_REQUESTS) return false;
    current.requests += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [peer, window] of this.peers) {
      if (now - window.startedAt >= WINDOW_MS) this.peers.delete(peer);
    }
  }
}
