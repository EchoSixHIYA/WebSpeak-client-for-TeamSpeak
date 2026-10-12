import assert from "node:assert/strict";
import test from "node:test";
import {
  approveSkinRuntimePlugin,
  getMissingSkinRuntimePluginApprovals,
  getSkinRuntimePluginApproval,
  revokeSkinRuntimePluginApprovals,
} from "./skin-runtime-plugin-approval.js";
import { computeSkinRuntimePluginDigest } from "../../../src/shared/skin-runtime-plugin-approval.js";
import { parseSkinRuntimePluginDocument } from "../../../src/shared/skin-runtime-plugins.js";

const STORAGE_KEY = "webspeak:skin-runtime-plugin-approvals";
function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    read: () => values.get(STORAGE_KEY),
  };
}

const plugin = parseSkinRuntimePluginDocument({
  schemaVersion: 1,
  plugins: [{
    id: "voice-toolbar",
    name: "Voice toolbar",
    version: "1.0.0",
    apiVersion: 1,
    page: "voice",
    mode: "widget",
    entry: "plugins/voice-toolbar/index.js",
    assets: [],
    permissions: ["session.status.read"],
  }],
}).plugins[0];

test("local plugin grants require explicit approval and match the complete package digest", async () => {
  const storage = memoryStorage();
  const files = { "plugins/voice-toolbar/index.js": new Blob(["export default () => 1;"]) };
  const digest = await computeSkinRuntimePluginDigest(plugin, files);
  assert.deepEqual(getMissingSkinRuntimePluginApprovals("community.sample", "2.0.0", [plugin], { [plugin.id]: digest }, storage), [plugin]);
  assert.equal(getSkinRuntimePluginApproval("community.sample", "2.0.0", plugin, digest, storage), null);

  approveSkinRuntimePlugin("community.sample", "2.0.0", plugin, digest, storage);
  assert.deepEqual(getMissingSkinRuntimePluginApprovals("community.sample", "2.0.0", [plugin], { [plugin.id]: digest }, storage), []);
  assert.equal(getSkinRuntimePluginApproval("community.sample", "2.0.0", plugin, digest, storage)?.digest, digest);
  assert.deepEqual(getMissingSkinRuntimePluginApprovals("community.sample", "2.0.0", [plugin], { [plugin.id]: "0".repeat(64) }, storage), [plugin]);
  assert.deepEqual(getMissingSkinRuntimePluginApprovals("community.sample", "2.1.0", [plugin], { [plugin.id]: digest }, storage), [plugin]);
});

test("plugin approval revocation can target a skin plugin or every plugin in a skin", async () => {
  const storage = memoryStorage();
  const other = parseSkinRuntimePluginDocument({
    schemaVersion: 1,
    plugins: [{ ...plugin, id: "other-widget", name: "Other widget", entry: "plugins/other-widget/index.js" }],
  }).plugins[0];
  const digest = await computeSkinRuntimePluginDigest(plugin, { [plugin.entry]: new Blob(["one"]) });
  const otherDigest = await computeSkinRuntimePluginDigest(other, { [other.entry]: new Blob(["two"]) });
  approveSkinRuntimePlugin("community.sample", "2.0.0", plugin, digest, storage);
  approveSkinRuntimePlugin("community.sample", "2.0.0", other, otherDigest, storage);
  approveSkinRuntimePlugin("community.other", "2.0.0", plugin, digest, storage);

  revokeSkinRuntimePluginApprovals("community.sample", plugin.id, storage);
  assert.equal(getSkinRuntimePluginApproval("community.sample", "2.0.0", plugin, digest, storage), null);
  assert.ok(getSkinRuntimePluginApproval("community.sample", "2.0.0", other, otherDigest, storage));
  assert.ok(getSkinRuntimePluginApproval("community.other", "2.0.0", plugin, digest, storage));
  revokeSkinRuntimePluginApprovals("community.sample", undefined, storage);
  assert.equal(getSkinRuntimePluginApproval("community.sample", "2.0.0", other, otherDigest, storage), null);
  assert.ok(getSkinRuntimePluginApproval("community.other", "2.0.0", plugin, digest, storage));
});

test("corrupt local grant data fails closed and failed persistence cannot create an in-memory grant", async () => {
  const corrupt = memoryStorage("not json");
  const digest = await computeSkinRuntimePluginDigest(plugin, { [plugin.entry]: new Blob(["code"]) });
  assert.equal(getSkinRuntimePluginApproval("community.sample", "2.0.0", plugin, digest, corrupt), null);
  const readonlyStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  approveSkinRuntimePlugin("community.sample", "2.0.0", plugin, digest, readonlyStorage);
  assert.equal(getSkinRuntimePluginApproval("community.sample", "2.0.0", plugin, digest, readonlyStorage), null);
});
