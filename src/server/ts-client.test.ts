import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { Writable } from "node:stream";
import pino from "pino";
import { TSClient } from "./ts-client.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

const rows = [{ client_unique_identifier: "member", client_flag_avatar: "marker", client_base64HashClientUID: "abcdefgh" }];
const transfer = { size: 6n };

class SdkStub extends EventEmitter {
  inputCommands: string[] = [];
  inputUpdate = async (_command: string): Promise<void> => {};
  async execCommand(command: string) { this.inputCommands.push(command); await this.inputUpdate(command); }
  initialized = 0;
  downloaded = 0;
  metadata = async () => rows;
  transfer = async () => transfer;
  download = async (destination: Writable) => { destination.write(Buffer.from("GIF89a")); };
  execCommandWithResponse() { return this.metadata(); }
  async fileTransferInitDownload() { this.initialized++; return this.transfer(); }
  async downloadFileData(_host: string, _transfer: unknown, destination: Writable) { this.downloaded++; await this.download(destination); }
}

function fixture() {
  const client = new TSClient({ target: { host: "voice.example.invalid", port: 9987 }, nickname: "Test" }, pino({ enabled: false }));
  const sdk = new SdkStub();
  const state = client as unknown as { client: SdkStub | null; connected: boolean; attachClientListeners(sdk: SdkStub): void };
  state.client = sdk;
  state.connected = true;
  state.attachClientListeners(sdk);
  return { client, sdk, state };
}

test("stream commands wait for server acknowledgement and propagate refusals", async () => {
  const f = fixture();
  const ack = deferred<void>();
  f.sdk.inputUpdate = () => ack.promise;
  let completed = false;
  const pending = f.client.sendProtocolCommand("setupstream name=Test").then(() => { completed = true; });
  await nextTurn();
  assert.equal(completed, false);
  ack.resolve();
  await pending;
  f.sdk.inputUpdate = async () => { throw new Error("missing required parameter"); };
  await assert.rejects(f.client.sendProtocolCommand("removeclientfromstream id=test"), /missing required parameter/);
});

test("stream cleanup flood retries back off and stop after two retries", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flooding = new Error("TeamSpeak server error: client is flooding (id=524)");
  f.sdk.inputUpdate = async () => { throw flooding; };
  const pending = assert.rejects(f.client.sendProtocolCommand("stopstream id=test reason=1"), error => error === flooding);
  await nextTurn();
  t.mock.timers.tick(3999);
  await nextTurn();
  assert.equal(f.sdk.inputCommands.length, 1);
  t.mock.timers.tick(1);
  await nextTurn();
  assert.equal(f.sdk.inputCommands.length, 2);
  t.mock.timers.tick(8000);
  await pending;
  assert.equal(f.sdk.inputCommands.length, 3);
});

test("stream signaling flood refusals are not replayed", async () => {
  const f = fixture();
  f.sdk.inputUpdate = async () => { throw new Error("TeamSpeak server error: client is flooding (id=524)"); };
  await assert.rejects(f.client.sendProtocolCommand("streamsignaling id=test clid=2 json=payload"), /flooding/);
  assert.equal(f.sdk.inputCommands.length, 1);
});

test("stream cleanup retries cannot reach a replacement connection", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.sdk.inputUpdate = async () => { throw new Error("TeamSpeak server error: client is flooding (id=524)"); };
  const pending = assert.rejects(f.client.sendProtocolCommand("removeclientfromstream id=test clid=2 reason=1"), /not ready/);
  await nextTurn();
  await f.client.disconnect();
  f.state.client = f.sdk;
  f.state.connected = true;
  t.mock.timers.tick(4000);
  await pending;
  assert.equal(f.sdk.inputCommands.length, 1);
});

test("accompaniment remains audible with the microphone muted and stopping restores mute", async () => {
  const f = fixture();
  await f.client.setInputMuted(true);
  await f.client.setAccompanimentActive(true);
  await f.client.setInputMuted(true);
  await f.client.setAccompanimentActive(false);
  await f.client.setInputMuted(false);
  assert.deepEqual(f.sdk.inputCommands, [1, 0, 1, 0].map(value => `clientupdate client_input_muted=${value}`));
});

test("unchanged wire mute still records microphone and accompaniment changes", async () => {
  const f = fixture();
  await f.client.setInputMuted(false);
  await f.client.setAccompanimentActive(true);
  await f.client.setInputMuted(true);
  await f.client.setAccompanimentActive(false);
  assert.deepEqual(f.sdk.inputCommands, ["clientupdate client_input_muted=0", "clientupdate client_input_muted=1"]);
});

test("stopping accompaniment retries flood rejection before committing restored mute", async t => {
  const f = fixture();
  await f.client.setInputMuted(true);
  await f.client.setAccompanimentActive(true);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  f.sdk.inputUpdate = async () => { if (++attempts === 1) throw new Error("TeamSpeak server error: client is flooding (id=524)"); };
  const pending = f.client.setAccompanimentActive(false);
  await nextTurn();
  assert.equal(attempts, 1);
  t.mock.timers.tick(1000);
  await pending;
  await f.client.setInputMuted(true);
  assert.equal(attempts, 2);
  assert.deepEqual(f.sdk.inputCommands.slice(-2), ["clientupdate client_input_muted=1", "clientupdate client_input_muted=1"]);
});

test("input flood retries are bounded and a rejected update does not poison later changes", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flooding = new Error("TeamSpeak server error: client is flooding (id=524)");
  f.sdk.inputUpdate = async () => { throw flooding; };
  const pending = assert.rejects(f.client.setInputMuted(true), error => error === flooding);
  await nextTurn();
  t.mock.timers.tick(1000);
  await nextTurn();
  t.mock.timers.tick(2000);
  await pending;
  assert.equal(f.sdk.inputCommands.length, 3);
  f.sdk.inputUpdate = async () => {};
  await f.client.setInputMuted(false);
  assert.equal(f.sdk.inputCommands.at(-1), "clientupdate client_input_muted=0");
});

test("a flood retry cannot send into a replaced connection", async t => {
  const f = fixture();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.sdk.inputUpdate = async () => { throw new Error("TeamSpeak server error: client is flooding (id=524)"); };
  const pending = assert.rejects(f.client.setInputMuted(true), /not ready/);
  await nextTurn();
  await f.client.disconnect();
  f.state.client = f.sdk;
  f.state.connected = true;
  t.mock.timers.tick(1000);
  await pending;
  assert.equal(f.sdk.inputCommands.length, 1);
});

test("overlapping microphone and accompaniment changes use the last accepted input state", async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.sdk.inputUpdate = async () => pending.promise;
  const mute = f.client.setInputMuted(true);
  const music = f.client.setAccompanimentActive(true);
  await nextTurn();
  assert.equal(f.sdk.inputCommands.length, 1);
  pending.resolve();
  await Promise.all([mute, music]);
  assert.deepEqual(f.sdk.inputCommands, ["clientupdate client_input_muted=1", "clientupdate client_input_muted=0"]);
});

test("a rejected accompaniment update cannot change later mute decisions or poison the queue", async () => {
  const f = fixture();
  await f.client.setInputMuted(true);
  f.sdk.inputUpdate = async () => { throw new Error("denied"); };
  await assert.rejects(f.client.setAccompanimentActive(true), /denied/);
  f.sdk.inputUpdate = async () => {};
  await f.client.setInputMuted(true);
  assert.equal(f.sdk.inputCommands.at(-1), "clientupdate client_input_muted=1");
});

test("queued and in-flight input changes cannot cross a disconnected session", async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.sdk.inputUpdate = async () => pending.promise;
  const first = assert.rejects(f.client.setAccompanimentActive(true), /session changed/);
  const queued = assert.rejects(f.client.setInputMuted(true), /not ready/);
  await nextTurn();
  await f.client.disconnect();
  f.state.client = f.sdk;
  f.state.connected = true;
  pending.resolve();
  await Promise.all([first, queued]);
  assert.equal(f.sdk.inputCommands.length, 1);
  f.sdk.inputUpdate = async () => {};
  await f.client.setInputMuted(true);
  assert.equal(f.sdk.inputCommands.at(-1), "clientupdate client_input_muted=1");
});

test("an old avatar metadata response cannot start a transfer on a replacement SDK client", async () => {
  const f = fixture();
  const pending = deferred<typeof rows>();
  f.sdk.metadata = () => pending.promise;
  const result = f.client.getClientAvatar(2, "member");
  const replacement = new SdkStub();
  f.state.client = replacement;
  pending.resolve(rows);
  assert.equal(await result, null);
  assert.equal(f.sdk.initialized, 0);
  assert.equal(replacement.initialized, 0);
});

test("disconnect during avatar transfer initialization prevents the subsequent download", async () => {
  const f = fixture();
  const pending = deferred<typeof transfer>();
  f.sdk.transfer = () => pending.promise;
  const result = f.client.getClientAvatar(2, "member");
  await nextTurn();
  assert.equal(f.sdk.initialized, 1);
  await f.client.disconnect();
  pending.resolve(transfer);
  assert.equal(await result, null);
  assert.equal(f.sdk.downloaded, 0);
});

test("a completed avatar download after disconnect is discarded", async () => {
  const f = fixture();
  const pending = deferred<void>();
  f.sdk.download = async destination => { destination.write(Buffer.from("GIF89a")); await pending.promise; };
  const result = f.client.getClientAvatar(2, "member");
  await nextTurn();
  assert.equal(f.sdk.downloaded, 1);
  await f.client.disconnect();
  pending.resolve();
  assert.equal(await result, null);
});

test("reusing the SDK client after interruption cannot revive an earlier avatar request", async () => {
  const f = fixture();
  const pending = deferred<typeof rows>();
  f.sdk.metadata = () => pending.promise;
  const result = f.client.getClientAvatar(2, "member");
  f.sdk.emit("disconnected");
  f.state.connected = true;
  pending.resolve(rows);
  assert.equal(await result, null);
  assert.equal(f.sdk.initialized, 0);
});

test("a current avatar download preserves its bytes and rejects a mismatched identity", async () => {
  const f = fixture();
  assert.deepEqual(await f.client.getClientAvatar(2, "member"), { cacheKey: "marker", data: Buffer.from("GIF89a") });
  assert.equal(await f.client.getClientAvatar(2, "different-member"), null);
  assert.equal(f.sdk.initialized, 1);
  assert.equal(f.sdk.downloaded, 1);
});

test("public channel capacity survives directory snapshots and follows channel edits", () => {
  const f = fixture();
  const snapshots: Array<{ channels: Array<{ id: bigint; maxClients?: number; maxClientsLimited?: boolean }>; clients: unknown[] }> = [];
  f.client.on("directorySnapshot", snapshot => snapshots.push(snapshot));

  f.sdk.emit("rawNotification", {
    name: "notifychannelcreated",
    params: { cid: "1", channel_maxclients: "10", channel_flag_maxclients_unlimited: "0" },
  });
  f.sdk.emit("directorySnapshot", {
    channels: [{ id: 1n, parentID: 0n, order: 0n, name: "Room", description: "" }],
    clients: [],
  });
  assert.equal(snapshots.at(-1)?.channels[0]?.maxClients, 10);
  assert.equal(snapshots.at(-1)?.channels[0]?.maxClientsLimited, true);

  f.sdk.emit("rawNotification", { name: "notifychanneledited", params: { cid: "1", channel_maxclients: "12" } });
  f.sdk.emit("directorySnapshot", {
    channels: [{ id: 1n, parentID: 0n, order: 0n, name: "Room", description: "" }],
    clients: [],
  });
  assert.equal(snapshots.at(-1)?.channels[0]?.maxClients, 12);
  assert.equal(snapshots.at(-1)?.channels[0]?.maxClientsLimited, true);

  f.sdk.emit("rawNotification", { name: "notifychanneldeleted", params: { cid: "1" } });
  f.sdk.emit("directorySnapshot", {
    channels: [{ id: 1n, parentID: 0n, order: 0n, name: "Room", description: "" }],
    clients: [],
  });
  assert.equal(snapshots.at(-1)?.channels[0]?.maxClients, undefined);
});

test("a retired SDK client's disconnect cannot invalidate a current avatar request", async () => {
  const f = fixture();
  const replacement = new SdkStub();
  const pending = deferred<typeof rows>();
  replacement.metadata = () => pending.promise;
  f.state.client = replacement;
  f.state.attachClientListeners(replacement);
  const result = f.client.getClientAvatar(2, "member");
  f.sdk.emit("disconnected");
  assert.equal(f.client.isConnected(), true);
  pending.resolve(rows);
  assert.deepEqual(await result, { cacheKey: "marker", data: Buffer.from("GIF89a") });
  assert.equal(replacement.downloaded, 1);
});

const retiredEvents: Array<[string, unknown]> = [
  ["voiceData", { clientId: 2, codec: 4, data: Buffer.from([1]) }],
  ["directorySnapshot", { channels: [], clients: [] }],
  ["rawNotification", { name: "notification", params: {} }],
  ["textMessage", { invokerName: "Member", invokerID: 2, invokerUID: "uid", targetMode: 2, targetID: 1n, message: "Message" }],
  ["poked", { invokerName: "Member", invokerID: 2, invokerUID: "uid", message: "Poke" }],
  ["clientEnter", { id: 2, nickname: "Member", uid: "uid", channelID: 1n, type: 1, serverGroups: [] }],
  ["clientLeave", { id: 2, reasonID: 4 }],
  ["clientMoved", { id: 2, targetChannelID: 2n }],
  ["clientUpdated", { info: { id: 2, inputMuted: true } }],
  ["kicked", "Removed"],
];

for (const [name, payload] of retiredEvents) {
  test(`a retired SDK client's ${name} event cannot reach its replacement session`, () => {
    const f = fixture();
    const replacement = new SdkStub();
    f.state.client = replacement;
    f.state.attachClientListeners(replacement);
    const observed: unknown[] = [];
    f.client.on(name, data => observed.push(data));
    f.sdk.emit(name, payload);
    assert.equal(observed.length, 0);
    replacement.emit(name, payload);
    assert.equal(observed.length, 1);
  });
}
