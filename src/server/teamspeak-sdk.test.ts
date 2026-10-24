import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { asChannelGroupID, asChannelID, asClientID, asUID, avatarFileName, type Channel, type ClientEntry } from "@honeybbq/teamspeak";
import { Client, generateIdentitySync, type ServerView } from "@honeybbq/teamspeak/client";
import { TeamSpeakSdkClient, type DirectorySnapshot } from "./teamspeak-sdk.js";

const identity = generateIdentitySync(8);
const uid = "AAAAAAAAAAAAAAAAAAAAAAAAAAA=";
function channel(id = 1): Channel {
  return { id: asChannelID(BigInt(id)), parentID: asChannelID(0n), order: asChannelID(0n), name: "Lobby",
    description: "", hasPassword: true, maxClients: 12, isMaxClientsUnlimited: false } as Channel;
}
function member(id = 1): ClientEntry {
  return { id: asClientID(id), nickname: `Member ${id}`, uid: asUID(uid), channelID: asChannelID(1n), type: 0,
    serverGroups: [], isAway: true, awayMessage: "Away", isInputMuted: true, isOutputMuted: false,
    isChannelCommander: true, avatar: "avatar-hash", isRecording: false, isTalker: false,
    channelGroupID: asChannelGroupID(0n), createdAt: undefined, lastConnectedAt: undefined, idleTimeMs: undefined };
}

function fixture() {
  const sdk = new TeamSpeakSdkClient(identity, "127.0.0.1:9987", "Test", {});
  const native = Object.assign(new EventEmitter(), {
    view: {
      status: "live", revision: 1,
      channels: new Map([[asChannelID(1n), channel()]]),
      clients: new Map([[asClientID(1), member()]]),
      serverName: "Shanghai", serverIconID: undefined, serverBannerImageURL: "https://example.invalid/banner",
      server: { virtualserver_welcomemessage: "Welcome" },
      whenReady: async (_options?: { signal?: AbortSignal }) => {},
    },
    serverCapabilities: { family: "ts6", welcomeMessage: "Old welcome" },
    queries: [] as string[],
    async exec(command: string) { this.queries.push(command); throw new Error("insufficient client permissions (code 2568)"); },
  });
  const state = sdk as unknown as { sdkClient: Client | null; attachUpstreamEvents(client: Client): void };
  state.sdkClient = native as unknown as Client;
  state.attachUpstreamEvents(native as unknown as Client);
  return { sdk, native, state };
}

test("ordinary-client directories and avatar metadata use the live view without list permissions", async () => {
  const { sdk, native } = fixture();
  assert.deepEqual(await sdk.listDirectoryChannels(), [{ id: 1n, parentID: 0n, order: 0n, name: "Lobby", description: "",
    passwordProtected: true, maxClients: 12, maxClientsLimited: true }]);
  assert.deepEqual(await sdk.listDirectoryClients(), [{ id: 1, nickname: "Member 1", uid, channelID: 1n, type: 0,
    serverGroups: [], away: true, awayMessage: "Away", inputMuted: true, outputMuted: false, channelCommander: true }]);
  assert.deepEqual(await sdk.getClientAvatarMetadata(1), { uid, cacheKey: "avatar-hash", path: `/${avatarFileName(uid)}` });
  assert.equal(await sdk.getClientAvatarMetadata(2), null);
  assert.deepEqual(sdk.serverInfo, { name: "Shanghai", iconId: null, hostBannerGfxUrl: "https://example.invalid/banner", welcomeMessage: "Welcome" });
  assert.equal(sdk.serverFamily, "ts6");
  assert.deepEqual(native.queries, []);
});

test("live-view snapshots include channel edits and remove clients that went out of view", () => {
  const { sdk, native } = fixture();
  const snapshots: DirectorySnapshot[] = [];
  sdk.on("directorySnapshot", snapshot => snapshots.push(snapshot));
  native.emit("viewReady");
  native.emit("viewChanged");
  assert.equal(snapshots.length, 1, "an unchanged revision does not duplicate the directory");
  assert.equal(snapshots[0]?.complete, true);
  native.view.clients.clear();
  native.view.channels.set(asChannelID(1n), { ...channel(), name: "Renamed", hasPassword: false, maxClients: 20 });
  native.view.revision++;
  native.emit("viewChanged");
  assert.equal(snapshots.at(-1)?.channels[0]?.name, "Renamed");
  assert.equal(snapshots.at(-1)?.channels[0]?.passwordProtected, false);
  assert.equal(snapshots.at(-1)?.channels[0]?.maxClients, 20);
  assert.deepEqual(snapshots.at(-1)?.clients, []);
  assert.equal(snapshots[0]?.clients.length, 1, "earlier snapshots stay independent");
  native.view.status = "stale";
  native.view.revision++;
  native.emit("viewChanged");
  assert.equal(snapshots.length, 2, "a stale view cannot initialize a session");
});

test("member status changes use the SDK's current record and retired views cannot publish", async () => {
  const { sdk, native, state } = fixture();
  const updates: unknown[] = [];
  const snapshots: unknown[] = [];
  sdk.on("clientUpdated", update => updates.push(update));
  sdk.on("directorySnapshot", snapshot => snapshots.push(snapshot));
  native.view.clients.set(asClientID(1), { ...member(), isInputMuted: false, isOutputMuted: true, isAway: false });
  native.emit("clientUpdated", { clientID: asClientID(1), changes: { isInputMuted: false } });
  assert.equal((updates[0] as { info: { inputMuted: boolean } }).info.inputMuted, false);
  assert.equal((updates[0] as { info: { outputMuted: boolean } }).info.outputMuted, true);
  state.sdkClient = null;
  native.emit("viewChanged");
  native.emit("clientUpdated", { clientID: asClientID(1) });
  assert.equal(updates.length, 1);
  assert.equal(snapshots.length, 0);
  state.sdkClient = native as unknown as Client;
  native.view.status = "stale";
  await assert.rejects(sdk.listDirectoryChannels(), /view is not ready/);
});

test("connect waits for the welcome view and propagates its connection deadline", async t => {
  const { native } = fixture();
  native.view.status = "loading";
  let welcome!: () => void;
  let observedSignal: AbortSignal | undefined;
  native.view.whenReady = options => {
    observedSignal = options?.signal;
    return new Promise<void>(resolve => { welcome = resolve; });
  };
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.getter(Client.prototype, "view", () => native.view as unknown as ServerView);
  const sdk = new TeamSpeakSdkClient(identity, "127.0.0.1:9987", "Test", {});
  const controller = new AbortController();
  let connected = false;
  const snapshots: DirectorySnapshot[] = [];
  sdk.on("directorySnapshot", snapshot => snapshots.push(snapshot));
  const pending = sdk.connect({ signal: controller.signal }).then(() => { connected = true; });
  await nextTurn();
  assert.equal(connected, false, "handshake success alone is not a usable directory");
  assert.equal(observedSignal, controller.signal);
  native.view.status = "live";
  welcome();
  await pending;
  assert.equal(connected, true);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.clients[0]?.id, 1);
});

test("an interrupted welcome rejects connect instead of leaving initialization pending", async t => {
  const { native } = fixture();
  const failure = new Error("welcome connection deadline");
  native.view.status = "loading";
  native.view.whenReady = async options => { options?.signal?.throwIfAborted(); };
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.getter(Client.prototype, "view", () => native.view as unknown as ServerView);
  const sdk = new TeamSpeakSdkClient(identity, "127.0.0.1:9987", "Test", {});
  await assert.rejects(sdk.connect({ signal: AbortSignal.abort(failure) }), error => error === failure);
});
