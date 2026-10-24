import type { ClientInfo, DirectoryClientInfo } from "./teamspeak-sdk.js";
import type { TSDirectorySnapshot } from "./ts-client.js";

type DirectoryDelta =
  | { type: "clientEnter"; info: ClientInfo }
  | { type: "clientLeave"; id: number }
  | { type: "clientMoved"; id: number; channelID: bigint }
  | { type: "clientUpdated"; info: DirectoryClientInfo }
  | { type: "clientListSnapshot"; clients: DirectoryClientInfo[] };

/**
 * Merges staged welcome snapshots with events received while the snapshot is
 * in flight. Some TS6 welcome data arrives in more than one partial snapshot,
 * so a later snapshot must not hide clients that were present in an earlier
 * one. Explicit leave events remain authoritative removals.
 */
export class DirectorySynchronizer {
  private snapshot: TSDirectorySnapshot | null = null;
  private clients = new Map<number, DirectoryClientInfo>();
  // A delayed welcome snapshot or update must not undo an explicit leave.
  // Client IDs can be reused, so a new enter event releases the tombstone.
  private departedClientIds = new Set<number>();
  private pending: DirectoryDelta[] = [];

  get ready(): boolean {
    return this.snapshot !== null;
  }

  applySnapshot(snapshot: TSDirectorySnapshot): void {
    this.snapshot = { channels: snapshot.channels.slice(), clients: [] };
    // A native SDK view is the complete visible roster. In particular, an
    // unsubscribe removes clients without individual leave notifications.
    if (snapshot.complete) this.clients.clear();
    for (const client of snapshot.clients) {
      if (this.departedClientIds.has(client.id)) continue;
      const previous = this.clients.get(client.id);
      this.clients.set(client.id, previous ? { ...previous, ...client } : client);
    }
    const pending = this.pending.splice(0);
    for (const delta of pending) this.applyDelta(delta);
  }

  applyClientEnter(info: ClientInfo): void {
    this.applyOrQueue({ type: "clientEnter", info });
  }

  applyClientLeave(id: number): void {
    this.applyOrQueue({ type: "clientLeave", id });
  }

  applyClientMoved(id: number, channelID: bigint): void {
    this.applyOrQueue({ type: "clientMoved", id, channelID });
  }

  applyClientUpdated(info: DirectoryClientInfo): void {
    this.applyOrQueue({ type: "clientUpdated", info });
  }

  applyClientListSnapshot(clients: DirectoryClientInfo[]): void {
    this.applyOrQueue({ type: "clientListSnapshot", clients });
  }

  getSnapshot(): TSDirectorySnapshot | null {
    if (!this.snapshot) return null;
    return {
      channels: this.snapshot.channels.slice(),
      clients: [...this.clients.values()],
    };
  }

  clear(): void {
    this.snapshot = null;
    this.clients.clear();
    this.departedClientIds.clear();
    this.pending = [];
  }

  private applyOrQueue(delta: DirectoryDelta): void {
    if (!this.snapshot) {
      if (this.pending.length < 4096) this.pending.push(delta);
      return;
    }
    this.applyDelta(delta);
  }

  private applyDelta(delta: DirectoryDelta): void {
    if (delta.type === "clientEnter") {
      this.departedClientIds.delete(delta.info.id);
      this.clients.set(delta.info.id, delta.info);
      return;
    }
    if (delta.type === "clientLeave") {
      this.departedClientIds.add(delta.id);
      this.clients.delete(delta.id);
      return;
    }
    if (delta.type === "clientUpdated") {
      if (this.departedClientIds.has(delta.info.id)) return;
      const current = this.clients.get(delta.info.id);
      this.clients.set(delta.info.id, current ? { ...current, ...delta.info } : delta.info);
      return;
    }
    if (delta.type === "clientListSnapshot") {
      for (const info of delta.clients) {
        const current = this.clients.get(info.id);
        // A refresh enriches known members; it must not resurrect someone who
        // left while the asynchronous list request was in flight.
        if (current && !this.departedClientIds.has(info.id)) this.clients.set(info.id, { ...current, ...info });
      }
      return;
    }
    const current = this.clients.get(delta.id);
    if (current) this.clients.set(delta.id, { ...current, channelID: delta.channelID });
  }
}
