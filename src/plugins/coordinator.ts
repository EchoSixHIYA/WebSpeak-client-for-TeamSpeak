import { randomUUID } from "node:crypto";
import { teamSpeakTargetKey, type TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { PluginRegistry } from "./registry.js";
import { parsePluginRequest, pluginAssert, PluginError, type PluginMessage, type JsonValue, type PluginRequest, type PluginRoomSnapshot } from "../shared/plugins.js";

export interface PluginParticipant {
  id: string; nickname: string; target: TeamSpeakTarget;
  session: { state: string };
  tsClient: { getChannelId(): bigint; isConnected(): boolean };
}
interface Membership { room: string; packageRevision: string }
interface Room { id: string; state: JsonValue; revision: number; members: Set<string>; writeWindow: number; writes: number }
/** Generic bounded JSON rooms. No package code or video-specific behavior runs on the server. */
export class PluginCoordinator {
  private readonly rooms = new Map<string, Room>();
  private readonly memberships = new Map<string, Map<string, Membership>>();
  private readonly limits = new Map<string, { time: number; count: number }>();
  private readonly changed = (id: string) => {
    for (const [entryId, memberships] of [...this.memberships]) if (memberships.has(id)) this.leave(entryId, id, "PLUGIN_CHANGED");
  };
  constructor(private readonly registry: PluginRegistry | undefined, private readonly entries: ReadonlyMap<string, PluginParticipant>,
    private readonly send: (entryId: string, message: PluginMessage) => void) { registry?.listeners.add(this.changed); }
  private key(entry: PluginParticipant, id: string): string {
    const plugin = this.registry?.policy(id); pluginAssert(plugin?.settings.enabled, "PLUGIN_DISABLED");
    pluginAssert(entry.session.state === "connected" && entry.tsClient.isConnected(), "PLUGIN_NOT_CONNECTED");
    if (plugin.settings.scope === "instance") return `${id}\u0000instance`;
    const target = teamSpeakTargetKey(entry.target);
    pluginAssert(plugin.settings.targets.includes(target), "PLUGIN_NOT_ALLOWED");
    return `${id}\u0000${target}\u0000${entry.tsClient.getChannelId()}`;
  }
  private snapshot(room: Room): PluginRoomSnapshot {
    return { roomId: room.id, revision: room.revision, state: structuredClone(room.state), serverTime: Date.now(),
      participants: [...room.members].flatMap(id => { const e = this.entries.get(id); return e ? [{ id, nickname: e.nickname }] : []; }) };
  }
  private broadcast(key: string, id: string): void {
    const room = this.rooms.get(key); if (!room) return;
    for (const entryId of [...room.members]) {
      const entry = this.entries.get(entryId); let valid = false;
      try { valid = !!entry && this.key(entry, id) === key; } catch { /* stale scope */ }
      if (!valid) this.leave(entryId, id, "PLUGIN_CONTEXT_CHANGED", false);
    }
    const snapshot = this.snapshot(room);
    if (this.registry?.policy(id)?.manifest.permissions.includes("room.read"))
      for (const entryId of room.members) this.send(entryId, { type: "pluginEvent", pluginId: id, snapshot });
  }
  handle(entry: PluginParticipant, value: unknown): void {
    let request: PluginRequest;
    try { request = parsePluginRequest(value); }
    catch { return; }
    const reply = (ok: boolean, result?: unknown, code?: string) => this.send(entry.id, { type: "pluginReply", requestId: request.requestId, ok, ...(ok ? { result } : { code }) });
    try {
      const limit = this.limits.get(entry.id), now = Date.now();
      if (!limit || now - limit.time > 1000) this.limits.set(entry.id, { time: now, count: 1 });
      else if (request.action !== "close") pluginAssert(++limit.count <= 20, "PLUGIN_RATE_LIMITED");
      pluginAssert(entry.session.state === "connected" && entry.tsClient.isConnected(), "PLUGIN_NOT_CONNECTED");
      if (request.action === "list") {
        const plugins = (this.registry?.list() ?? []).filter(p => { try { this.key(entry, p.manifest.id); return true; } catch { return false; } });
        reply(true, plugins.map(p => ({ manifest: p.manifest, revision: p.revision, scope: p.settings.scope }))); return;
      }
      const id = request.pluginId!;
      if (request.action === "close") { this.leave(entry.id, id); reply(true, null); return; }
      const key = this.key(entry, id), plugin = this.registry!.policy(id)!;
      const memberships = this.memberships.get(entry.id) ?? new Map<string, Membership>();
      const previous = memberships.get(id);
      if (previous && (previous.room !== key || previous.packageRevision !== plugin.revision)) this.leave(entry.id, id, "PLUGIN_CONTEXT_CHANGED");
      if (request.action === "open") {
        pluginAssert(memberships.size < 8 || memberships.has(id), "PLUGIN_LIMIT");
        let room = this.rooms.get(key);
        if (!room) { pluginAssert(this.rooms.size < 800, "PLUGIN_LIMIT"); room = { id: randomUUID(), state: null, revision: 0, members: new Set(), writeWindow: 0, writes: 0 }; this.rooms.set(key, room); }
        const current = this.memberships.get(entry.id) ?? new Map<string, Membership>();
        current.set(id, { room: key, packageRevision: plugin.revision }); this.memberships.set(entry.id, current); room.members.add(entry.id);
        const snapshot = plugin.manifest.permissions.includes("room.read") ? this.snapshot(room)
          : { roomId: room.id, revision: 0, state: null, serverTime: Date.now(), participants: [] };
        reply(true, { package: this.registry!.get(id)!.package, config: plugin.settings.config, self: { id: entry.id, nickname: entry.nickname }, scope: plugin.settings.scope, snapshot });
        this.broadcast(key, id); return;
      }
      const membership = this.memberships.get(entry.id)?.get(id);
      pluginAssert(membership?.room === key && membership.packageRevision === plugin.revision, "PLUGIN_NOT_OPEN");
      const room = this.rooms.get(key)!;
      pluginAssert(plugin.manifest.permissions.includes("room.read"), "PLUGIN_PERMISSION_DENIED");
      if (request.action === "update") {
        pluginAssert(plugin.manifest.permissions.includes("room.write"), "PLUGIN_PERMISSION_DENIED");
        pluginAssert(request.revision === room.revision, "PLUGIN_REVISION_CONFLICT");
        if (now - room.writeWindow >= 1000) { room.writeWindow = now; room.writes = 0; }
        pluginAssert(++room.writes <= 10, "PLUGIN_RATE_LIMITED");
        room.state = request.state!; room.revision++;
      }
      reply(true, this.snapshot(room)); if (request.action === "update") this.broadcast(key, id);
    } catch (error) { reply(false, undefined, error instanceof PluginError ? error.code : "PLUGIN_FAILED"); }
  }
  private leave(entryId: string, id: string, code?: string, broadcast = true): void {
    const memberships = this.memberships.get(entryId), membership = memberships?.get(id); if (!membership) return;
    memberships!.delete(id); if (!memberships!.size) this.memberships.delete(entryId);
    const room = this.rooms.get(membership.room); room?.members.delete(entryId);
    if (!room?.members.size) this.rooms.delete(membership.room);
    if (code) this.send(entryId, { type: "pluginEvent", pluginId: id, snapshot: null, code });
    if (broadcast) this.broadcast(membership.room, id);
  }
  remove(entryId: string): void { for (const id of [...(this.memberships.get(entryId)?.keys() ?? [])]) this.leave(entryId, id, "PLUGIN_CONTEXT_CHANGED"); this.limits.delete(entryId); }
  reconcile(entry: PluginParticipant): void {
    for (const [id, membership] of [...(this.memberships.get(entry.id) ?? [])]) {
      try { if (this.key(entry, id) !== membership.room) this.leave(entry.id, id, "PLUGIN_CONTEXT_CHANGED"); }
      catch { this.leave(entry.id, id, "PLUGIN_CONTEXT_CHANGED"); }
    }
  }
  dispose(): void { this.registry?.listeners.delete(this.changed); this.memberships.clear(); this.rooms.clear(); this.limits.clear(); }
}
