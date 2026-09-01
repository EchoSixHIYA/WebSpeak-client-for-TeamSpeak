import { canAcceptSession, MAX_ACTIVE_SESSIONS } from "../constants.js";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "syncing"
  | "connected"
  | "interrupted"
  | "reconnecting"
  | "disconnecting"
  | "failed";

export type SessionTeardownReason =
  | "client-disconnect"
  | "websocket-close"
  | "websocket-error"
  | "protocol-error"
  | "teamSpeak-disconnect"
  | "teamSpeak-connect-failed"
  | "heartbeat-timeout"
  | "gateway-shutdown";

const ALLOWED_TRANSITIONS: Record<ConnectionState, readonly ConnectionState[]> = {
  idle: ["connecting", "disconnecting"],
  connecting: ["authenticating", "failed", "disconnecting"],
  authenticating: ["syncing", "failed", "disconnecting"],
  syncing: ["connected", "failed", "disconnecting"],
  connected: ["interrupted", "failed", "disconnecting"],
  interrupted: ["reconnecting", "failed", "disconnecting"],
  reconnecting: ["connecting", "failed", "disconnecting"],
  disconnecting: ["idle"],
  failed: ["disconnecting", "idle"],
};

export class ConnectionStateMachine {
  private current: ConnectionState = "idle";

  get state(): ConnectionState {
    return this.current;
  }

  transition(next: ConnectionState): void {
    if (next === this.current) return;
    if (!ALLOWED_TRANSITIONS[this.current].includes(next)) {
      throw new Error(`Illegal connection state transition: ${this.current} -> ${next}`);
    }
    this.current = next;
  }
}

export type SessionCleanup = (reason: SessionTeardownReason) => Promise<void>;

export class ManagedSession {
  readonly createdAt = Date.now();
  private readonly stateMachine = new ConnectionStateMachine();
  private teardownPromise: Promise<void> | null = null;

  constructor(
    readonly id: string,
    private readonly cleanup: SessionCleanup,
  ) {}

  get state(): ConnectionState {
    return this.stateMachine.state;
  }

  transition(next: ConnectionState): void {
    this.stateMachine.transition(next);
  }

  async teardown(reason: SessionTeardownReason): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise;
    this.teardownPromise = (async () => {
      if (this.state !== "idle" && this.state !== "disconnecting") {
        this.stateMachine.transition("disconnecting");
      } else if (this.state === "idle") {
        this.stateMachine.transition("disconnecting");
      }
      try {
        await this.cleanup(reason);
      } catch {
        // Teardown is best effort and must not be interrupted by an already
        // closed socket, TeamSpeak client, or codec resource.
      } finally {
        if (this.state === "disconnecting") this.stateMachine.transition("idle");
      }
    })();
    return this.teardownPromise;
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private accepting = true;
  private peak = 0;
  private created = 0;

  admit(id: string, cleanup: SessionCleanup): ManagedSession | null {
    if (!this.accepting || !canAcceptSession(this.sessions.size)) return null;
    if (this.sessions.has(id)) throw new Error(`Session already exists: ${id}`);
    const session = new ManagedSession(id, cleanup);
    this.sessions.set(id, session);
    this.created++;
    this.peak = Math.max(this.peak, this.sessions.size);
    return session;
  }

  get(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  get peakCount(): number {
    return this.peak;
  }

  get createdCount(): number {
    return this.created;
  }

  get isAccepting(): boolean {
    return this.accepting;
  }

  async teardown(id: string, reason: SessionTeardownReason): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    await session.teardown(reason);
    this.sessions.delete(id);
  }

  async shutdown(reason: SessionTeardownReason = "gateway-shutdown"): Promise<void> {
    this.accepting = false;
    await Promise.all([...this.sessions.keys()].map((id) => this.teardown(id, reason)));
  }

  get maxSessions(): number {
    return MAX_ACTIVE_SESSIONS;
  }
}
