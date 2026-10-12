import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import type { ClientInfo } from "@echosixhiya/teamspeak-client";
import type { ServerMessage } from "../shared/server-messages.js";
import { SessionEventCoordinator, type SessionDirectoryState } from "./session-events.js";
import type { TSDirectorySnapshot } from "./ts-client.js";

const member = (id: number, channelID = 1n): ClientInfo => ({ id, channelID, nickname: `Member ${id}`, uid: `uid-${id}`, type: 1, serverGroups: [] });
const channel = (id: bigint, name: string) => ({ id, parentID: 0n, order: 0n, name, description: "" });
const snapshot = (...clients: ClientInfo[]): TSDirectorySnapshot => ({ channels: [channel(1n, "Lobby"), channel(2n, "Room")], clients });

function fixture(t: TestContext) {
  const phase = { current: true, accepting: true, published: false, connected: false, selfId: 1, channelId: 1n };
  const state: SessionDirectoryState = { channelTree: [], members: new Map(), avatarCache: new Map(), whisperTargetIds: new Set(), whisperActive: false };
  const messages: ServerMessage[] = [];
  const events: Array<{ kind: string; message: string }> = [];
  const callbacks: Array<{ kind: string; value?: unknown }> = [];
  const client = Object.assign(new EventEmitter(), {
    getClientId: () => phase.selfId, getChannelId: () => phase.channelId,
    getClientAvatar: async () => null,
  });
  const coordinator = new SessionEventCoordinator({
    state, client, nickname: "Self", requestedChannel: "Lobby",
    isCurrent: () => phase.current, acceptsDirectory: () => phase.accepting,
    isPublished: () => phase.published, isConnected: () => phase.connected,
    sendJson: message => messages.push(message), addEvent: (kind, message) => events.push({ kind, message }),
    onDirectoryReady: () => callbacks.push({ kind: "ready" }),
    onClientLeave: id => callbacks.push({ kind: "leave", value: id }),
    onClientMove: (id, channelId) => callbacks.push({ kind: "move", value: [id, channelId] }),
    onNotification: value => callbacks.push({ kind: "notification", value }),
    onVoice: value => callbacks.push({ kind: "voice", value }),
    onKick: value => callbacks.push({ kind: "kick", value }),
    onDisconnect: value => callbacks.push({ kind: "disconnect", value }),
    onAvatarError: (_id, _uid, value) => callbacks.push({ kind: "avatar-error", value }),
  });
  t.after(() => coordinator.close());
  return { phase, state, messages, events, callbacks, client, coordinator };
}

test("welcome events reconcile before publication and self follows the connected SDK channel", t => {
  const f = fixture(t);
  f.phase.channelId = 2n;
  f.client.emit("clientLeave", { id: 2 });
  f.client.emit("clientEnter", member(3));
  f.client.emit("clientUpdated", { ...member(3), inputMuted: true });
  f.client.emit("directorySnapshot", snapshot(member(1), member(2)));
  f.coordinator.syncSelf();
  assert.equal(f.coordinator.ready, true);
  assert.equal(f.coordinator.selfId, 1);
  assert.deepEqual([...f.state.members.keys()], [1, 3]);
  assert.equal(f.state.members.get(3)?.inputMuted, true);
  assert.equal(f.state.channelTree.find(item => item.id === "2")?.members?.some(item => item.id === 1), true);
  assert.equal(f.messages.length, 0);
  assert.equal(f.events.length, 0);
  assert.equal(f.callbacks.filter(item => item.kind === "ready").length, 1);
  f.phase.published = true;
  f.client.emit("clientUpdated", { ...member(3), nickname: "Renamed" });
  assert.equal(f.state.members.get(3)?.nickname, "Renamed");
  assert.equal(f.messages.at(-1)?.type, "channelList");
});

test("live movement and departure update directory, sharing callbacks and whisper targets", t => {
  const f = fixture(t);
  f.client.emit("directorySnapshot", snapshot(member(1), member(2)));
  f.coordinator.syncSelf(); f.phase.published = true;
  for (const id of [1, 2, 99]) f.state.whisperTargetIds.add(id);
  f.state.whisperActive = true;
  f.client.emit("clientUpdated", { ...member(2), away: true });
  assert.deepEqual([...f.state.whisperTargetIds], [2]);
  assert.deepEqual(f.messages.find(message => message.type === "whisperTargets"), { type: "whisperTargets", targetIds: [2], active: true });
  f.client.emit("clientMoved", { id: 2, targetChannelID: 0n });
  assert.equal(f.callbacks.some(item => item.kind === "move"), false);
  f.client.emit("clientMoved", { id: 2, targetChannelID: 2n });
  assert.deepEqual(f.callbacks.find(item => item.kind === "move")?.value, [2, 2n]);
  assert.equal(f.state.channelTree.find(item => item.id === "2")?.members?.some(item => item.id === 2), true);
  f.client.emit("clientLeave", { id: 2 });
  f.client.emit("clientLeave", { id: 2 });
  assert.equal(f.state.members.has(2), false);
  assert.equal(f.state.whisperActive, false);
  assert.equal(f.state.whisperTargetIds.size, 0);
  assert.equal(f.messages.filter(message => message.type === "memberLeave").length, 1);
  assert.deepEqual(f.events.map(item => item.kind), ["moved", "left"]);
});

test("channel changes preserve large identifiers and publish only actual create, rename and delete events", t => {
  const f = fixture(t);
  f.client.emit("directorySnapshot", snapshot(member(1)));
  f.coordinator.syncSelf(); f.phase.published = true;
  const large = 9_007_199_254_740_993n;
  f.client.emit("directorySnapshot", { channels: [channel(1n, "Renamed"), channel(large, "Large")], clients: [member(3, large)] });
  assert.deepEqual(f.events.map(item => item.kind), ["moved", "joined", "left"]);
  assert.equal(f.state.channelTree[1]?.id, String(large));
  assert.equal(f.state.channelTree[1]?.members?.[0]?.id, 3);
  assert.doesNotThrow(() => JSON.stringify(f.messages));
  f.events.length = 0;
  f.client.emit("directorySnapshot", { channels: [channel(1n, "Renamed"), channel(large, "Large")], clients: [] });
  assert.equal(f.events.length, 0);
});

test("live channel password changes update and publish the lock state without a full tree refresh", t => {
  const f = fixture(t);
  f.client.emit("directorySnapshot", snapshot(member(1)));
  f.coordinator.syncSelf(); f.phase.published = true;

  f.client.emit("channelPasswordProtectionChanged", { channelId: 2n, passwordProtected: true });
  assert.equal(f.state.channelTree.find(item => item.id === "2")?.passwordProtected, true);
  let published = f.messages.at(-1);
  assert.equal(published?.type, "channelList");
  if (published?.type === "channelList") assert.equal(published.channels.find(item => item.id === "2")?.passwordProtected, true);

  f.client.emit("channelPasswordProtectionChanged", { channelId: 2n, passwordProtected: false });
  assert.equal(f.state.channelTree.find(item => item.id === "2")?.passwordProtected, false);
  published = f.messages.at(-1);
  assert.equal(published?.type, "channelList");
  if (published?.type === "channelList") assert.equal(published.channels.find(item => item.id === "2")?.passwordProtected, false);
});

test("reset rejects backoff events and close detaches only owned listeners including captured callbacks", t => {
  const f = fixture(t);
  f.client.emit("directorySnapshot", snapshot(member(1), member(2)));
  const captured = f.client.listeners("clientEnter")[0]!;
  let externalEvents = 0;
  f.client.on("clientEnter", () => externalEvents++);
  f.state.avatarCache.set("uid-2", "cached");
  f.coordinator.reset(); f.phase.accepting = false;
  f.client.emit("directorySnapshot", snapshot(member(9)));
  assert.equal(f.coordinator.ready, false);
  assert.equal(f.state.members.size, 0);
  assert.equal(f.state.avatarCache.size, 0);
  f.phase.accepting = true;
  f.client.emit("directorySnapshot", snapshot(member(1)));
  assert.equal(f.state.members.has(9), false);
  f.coordinator.close(); f.coordinator.close();
  f.client.emit("clientEnter", member(10));
  captured(member(11));
  assert.equal(f.state.members.size, 0);
  assert.equal(f.client.listenerCount("clientEnter"), 1);
  assert.equal(externalEvents, 1);
  assert.equal(f.client.listenerCount("directorySnapshot"), 0);
});

test("chat routing, poke and forwarded SDK events retain their payloads and stop with the session", t => {
  const f = fixture(t);
  const chat = { invokerName: "Speaker", invokerId: 2, invokerUid: "uid-2", message: "Hello" };
  f.client.emit("textMessage", { ...chat, targetMode: 2, targetId: 0n });
  f.phase.channelId = 2n;
  f.client.emit("textMessage", { ...chat, targetMode: 1, targetId: 9_007_199_254_740_993n });
  f.client.emit("textMessage", { ...chat, targetMode: 3, targetId: 0n });
  const routed = f.messages.filter(message => message.type === "chatMessage");
  assert.deepEqual(routed.map(message => [message.scope, message.targetId]), [["channel", "1"], ["private", "9007199254740993"], ["server", undefined]]);
  f.client.emit("poked", { invokerID: 2, invokerUID: "uid-2", invokerName: "Speaker", message: "Wake up" });
  const voice = { clientId: 2, codec: 4, data: Buffer.from([1]) };
  const notification = { name: "stream", params: { id: "a" } };
  f.client.emit("voiceData", voice); f.client.emit("rawNotification", notification); f.client.emit("disconnected");
  assert.equal(f.events.at(-1)?.kind, "poke");
  assert.equal(f.callbacks.find(item => item.kind === "voice")?.value, voice);
  assert.equal(f.callbacks.find(item => item.kind === "notification")?.value, notification);
  f.phase.current = false;
  f.client.emit("textMessage", { ...chat, targetMode: 2 });
  f.client.emit("poked", {}); f.client.emit("voiceData", voice); f.client.emit("rawNotification", notification); f.client.emit("disconnected");
  assert.equal(f.messages.length, 4);
  assert.equal(f.callbacks.length, 3);
});
