import type { ClientInfo } from "@honeybbq/teamspeak-client";
import type { TSDirectorySnapshot } from "./ts-client.js";

type DirectoryDelta =
  | { type: "clientEnter"; info: ClientInfo }
  | { type: "clientLeave"; id: number }
  | { type: "clientMoved"; id: number; channelID: bigint };

/**
 * Merges staged welcome snapshots with events received while the snapshot is
 * in flight. Some TS6 welcome data arrives in more than one partial snapshot,
 * so a later snapshot must not hide clients that were present in an earlier
 * one. Explicit leave events remain authoritative removals.
 */
export class DirectorySynchronizer {
  private snapshot: TSDirectorySnapshot | null = null;
  private clients = new Map<number, ClientInfo>();
  private pending: DirectoryDelta[] = [];

  get ready(): boolean {
    return this.snapshot !== null;
  }

  applySnapshot(snapshot: TSDirectorySnapshot): void {
    this.snapshot = { channels: snapshot.channels.slice(), clients: [] };
    for (const client of snapshot.clients) {
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
      this.clients.set(delta.info.id, delta.info);
      return;
    }
    if (delta.type === "clientLeave") {
      this.clients.delete(delta.id);
      return;
    }
    const current = this.clients.get(delta.id);
    if (current) this.clients.set(delta.id, { ...current, channelID: delta.channelID });
  }
}
