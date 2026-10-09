import assert from "node:assert/strict";
import test from "node:test";
import { parseSkinPluginDocument, type SkinPluginDocument } from "../../../src/shared/skin-plugin.js";
import {
  approveSkinPluginComponents,
  getMissingSkinPluginApprovals,
  isSkinPluginComponentApproved,
  revokeSkinPluginApprovals,
} from "./skin-plugin-approval.js";
import { createSkinPluginQuickServerProjection } from "./skin-plugin-context.js";

function surfaceDocument(): SkinPluginDocument {
  return {
    schemaVersion: 2,
    components: [{
      id: "custom-surface",
      name: "Custom surface",
      page: "voice",
      mode: "surface",
      accessibleName: "Custom voice page",
      permissions: ["ui.surface.replace"],
      actions: {},
      root: { tag: "main", children: [{ tag: "h1", children: [{ text: "Custom client" }] }] },
    }],
  };
}

test("page replacement stays disabled until local approval and returns to the host after revocation", () => {
  const storage = new Map<string, string>();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    },
  });
  try {
    const document = parseSkinPluginDocument(surfaceDocument());
    const component = document.components[0];

    assert.deepEqual(getMissingSkinPluginApprovals("test.skin", "1.0.0", document), [component]);
    assert.equal(isSkinPluginComponentApproved("test.skin", "1.0.0", component), false);
    approveSkinPluginComponents("test.skin", "1.0.0", [component]);
    assert.deepEqual(getMissingSkinPluginApprovals("test.skin", "1.0.0", document), []);
    assert.equal(isSkinPluginComponentApproved("test.skin", "1.0.0", component), true);
    revokeSkinPluginApprovals("test.skin");
    assert.equal(isSkinPluginComponentApproved("test.skin", "1.0.0", component), false);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("skin quick-server data redacts connection targets and resolves only host-generated opaque IDs", () => {
  const servers = [
    { id: "192.0.2.10:9987", address: "192.0.2.10:9987", label: "192.0.2.10:9987", isFavorite: true },
    { id: "voice.example:9987", address: "voice.example:9987", label: "Friends (voice.example:9987)", isFavorite: false },
    { id: "voice2.example:9987", address: "voice2.example:9987", label: "Friends", isFavorite: true },
  ];
  let sequence = 0;
  const projection = createSkinPluginQuickServerProjection(() => `opaque-${++sequence}`);
  const rows = projection.project(servers, (server) => server.id === "voice2.example:9987");

  assert.deepEqual(rows.map(({ label, kind, favorite, current }) => [label, kind, favorite, current]), [
    ["Favorite 1", "favorite", true, false],
    ["Recent 2", "recent", false, false],
    ["Friends", "favorite", true, true],
  ]);
  assert.equal(JSON.stringify(rows).includes("192.0.2.10"), false);
  assert.equal(JSON.stringify(rows).includes("voice.example"), false);
  assert.equal(projection.resolve("opaque-1")?.address, "192.0.2.10:9987");
  assert.equal(projection.resolve("192.0.2.10:9987"), undefined);
});
