import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { getChatHistoryConversationKey, loadLocalPreferences, loadStoredChannelPassword, normalizeBrowserCredentialServerKey, normalizeChatHistoryServerKey, saveInstalledSkin, saveLocalPreferences, saveStoredChannelPassword, saveStoredServerPassword } from "./local-persistence.js";
import type { InstalledSkin } from "./skin-pack.js";

// Control IndexedDB's request and transaction completion separately. These tests
// exercise the public storage APIs, including cancellation before opening the DB.
const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
let opening: any;
let transactions: Transaction[] = [];
class Transaction {
  oncomplete?: () => void; onerror?: () => void; onabort?: () => void;
  getRequest: any; getKey: unknown; putRequest: any; written: unknown; aborted = false;
  objectStore() { return {
    get: (key: unknown) => { this.getKey = key; return this.getRequest = {}; },
    put: (value: unknown) => { this.written = value; return this.putRequest = {}; },
  }; }
  abort() { this.aborted = true; this.onabort?.(); }
  read(value: unknown) { this.getRequest.result = value; this.getRequest.onsuccess(); }
  writtenSuccessfully() { this.putRequest.onsuccess(); }
  commit() { assert.equal(this.aborted, false); this.oncomplete?.(); }
}
const database = { transaction: () => { const tx = new Transaction(); transactions.push(tx); return tx; } };
const sample = { id: "sample.a", css: "", assets: {} } as InstalledSkin;

test("chat history keys isolate server targets and group private messages by stable conversation", () => {
  assert.equal(normalizeChatHistoryServerKey(" Example.COM:9987 "), "example.com:9987");
  const privateMessage = { id: "m1", scope: "private", conversationKey: "uid:peer", invokerName: "Peer", message: "hi", timestamp: 1 } as const;
  assert.equal(getChatHistoryConversationKey(privateMessage), "private:uid:peer");
  assert.equal(getChatHistoryConversationKey({ ...privateMessage, conversationKey: "unknown-member-session-1", conversationId: "7", conversationName: "Peer" }), 'private:client:["7","Peer"]');
  assert.equal(getChatHistoryConversationKey({ ...privateMessage, scope: "channel", targetId: "42" }), "channel:42");
});
before(() => Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
  open: () => opening = { result: database },
} }));
beforeEach(() => { transactions = []; });
after(() => {
  if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
  else Reflect.deleteProperty(globalThis, "indexedDB");
});

test("cancelling a skin while IndexedDB opens prevents the delayed write", async () => {
  const owner = new AbortController();
  const pending = saveInstalledSkin(sample, owner.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  owner.abort(); opening.onsuccess();
  await rejected;
  assert.equal(transactions.length, 0);
});
test("browser credentials are normalized and scoped by server plus channel", async () => {
  assert.equal(normalizeBrowserCredentialServerKey(" Example.COM:9987 "), "example.com:9987");
  const serverWrite = saveStoredServerPassword("Example.COM:9987", "server-secret");
  await nextTurn();
  const serverTx = transactions[0]!;
  const serverRecord = serverTx.written as { id: string; serverKey: string; kind: string; password: string; updatedAt: number };
  assert.equal(serverRecord.id, "server:example.com:9987");
  assert.equal(serverRecord.serverKey, "example.com:9987");
  assert.equal(serverRecord.kind, "server-password");
  assert.equal(serverRecord.password, "server-secret");
  assert.equal(typeof serverRecord.updatedAt, "number");
  serverTx.writtenSuccessfully(); serverTx.commit(); await serverWrite;

  const channelWrite = saveStoredChannelPassword("example.com:9987", "42", "channel-secret");
  await nextTurn();
  const channelTx = transactions[1]!;
  const channelRecord = channelTx.written as { id: string; serverKey: string; kind: string; channelId: string; password: string; updatedAt: number };
  assert.equal(channelRecord.id, 'channel:["example.com:9987","42"]');
  assert.equal(channelRecord.serverKey, "example.com:9987");
  assert.equal(channelRecord.kind, "channel-password");
  assert.equal(channelRecord.channelId, "42");
  assert.equal(channelRecord.password, "channel-secret");
  assert.equal(typeof channelRecord.updatedAt, "number");
  channelTx.writtenSuccessfully(); channelTx.commit(); await channelWrite;

  const channelRead = loadStoredChannelPassword("other.example:9987", "42");
  await nextTurn();
  const readTx = transactions[2]!;
  assert.equal(readTx.getKey, 'channel:["other.example:9987","42"]');
  readTx.read({ id: 'channel:["other.example:9987","42"]', serverKey: "other.example:9987", kind: "channel-password", channelId: "42", password: "other-secret" });
  readTx.commit();
  assert.equal(await channelRead, "other-secret");
});
test("a successful request is not reported as durable until its transaction commits", async () => {
  let settled = false;
  const pending = saveInstalledSkin(sample).then(() => { settled = true; });
  await nextTurn(); const tx = transactions[0];
  tx.writtenSuccessfully(); await nextTurn();
  assert.equal(settled, false);
  tx.commit(); await pending;
  assert.equal(settled, true);
});
test("retiring a skin aborts its outstanding write transaction", async () => {
  const owner = new AbortController();
  const pending = saveInstalledSkin(sample, owner.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await nextTurn(); const tx = transactions[0];
  tx.writtenSuccessfully(); owner.abort(); await rejected;
  assert.equal(tx.aborted, true);
});
test("skin preferences merge current unrelated fields in the same transaction", async () => {
  const pending = saveLocalPreferences({ schemaVersion: 1, skinId: "builtin.dark" });
  await nextTurn(); assert.equal(transactions.length, 1);
  const tx = transactions[0];
  tx.read({ schemaVersion: 1, language: "de", inputGain: 0.5, volumesByUid: { member: 0.2 } });
  assert.deepEqual(tx.written, { id: "singleton", schemaVersion: 1, language: "de", inputGain: 0.5, skinId: "builtin.dark", volumesByUid: { member: 0.2 } });
  tx.writtenSuccessfully(); tx.commit(); await pending;
});
test("cancelling a pending preference merge aborts it without blocking the caller", async () => {
  const owner = new AbortController();
  const pending = saveLocalPreferences({ schemaVersion: 1, skinId: "sample.a" }, owner.signal);
  await nextTurn(); const tx = transactions[0];
  owner.abort(); await pending;
  assert.equal(tx.aborted, true);
  assert.equal(tx.written, undefined);
});
test("storage read success still returns its original data after transaction completion", async () => {
  const pending = loadLocalPreferences();
  await nextTurn(); const tx = transactions[0];
  tx.read({ schemaVersion: 1, skinId: "builtin.dark" }); tx.commit();
  assert.deepEqual(await pending, { schemaVersion: 1, skinId: "builtin.dark", volumesByUid: {} });
});
