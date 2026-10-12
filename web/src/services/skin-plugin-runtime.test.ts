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
import { webClientTranslations } from "../i18n/web-client.js";
import "./skin-plugin-asset-urls.test.js";

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

  assert.deepEqual(rows.map(({ label, monogram }) => [label, monogram]), [
    ["Favorite 1", "F"],
    ["Recent 2", "R"],
    ["Friends", "F"],
  ]);
  assert.ok(rows.every(({ tone }) => Number.isInteger(tone) && tone >= 0 && tone < 7));
  assert.deepEqual(rows.map(({ label, kind, favorite, current }) => [label, kind, favorite, current]), [
    ["Favorite 1", "favorite", true, false],
    ["Recent 2", "recent", false, false],
    ["Friends", "favorite", true, true],
  ]);
  assert.ok(rows.every(({ switchRestricted, switchTitle }) => !switchRestricted && typeof switchTitle === "string"));
  assert.equal(JSON.stringify(rows).includes("192.0.2.10"), false);
  assert.equal(JSON.stringify(rows).includes("voice.example"), false);
  const friendsTone = rows.find(({ label }) => label === "Friends")?.tone;
  const reorderedTone = projection.project([servers[2], servers[0], servers[1]], (server) => server.id === "voice2.example:9987")
    .find(({ label }) => label === "Friends")?.tone;
  assert.equal(reorderedTone, friendsTone, "a server keeps its color tone when its saved-list position changes");
  assert.equal(projection.resolve("opaque-1")?.address, "192.0.2.10:9987");
  assert.equal(projection.resolve("192.0.2.10:9987"), undefined);

  const restricted = projection.project(servers, () => false, true, "管理员不允许切换TS服务器");
  assert.ok(restricted.every(({ switchRestricted, switchTitle }) => switchRestricted && switchTitle === "管理员不允许切换TS服务器"));
  assert.equal(JSON.stringify(restricted).includes("192.0.2.10"), false);
});

test("skin quick-server projection uses the TeamSpeak name and public icon while keeping its target private", () => {
  const icon = "data:image/png;base64,iVBORw0KGgo=";
  const projection = createSkinPluginQuickServerProjection(() => "opaque-server");
  const [server] = projection.project([{
    id: "shanghai.example:9987",
    address: "shanghai.example:9987",
    label: "shanghai.example:9987",
    serverName: "兄弟们的teamspeak",
    serverIcon: icon,
    isFavorite: false,
  }], () => true);

  assert.equal(server.label, "兄弟们的teamspeak");
  assert.equal(server.monogram, "兄");
  assert.equal(server.icon, icon);
  assert.equal(JSON.stringify(server).includes("shanghai.example"), false);
});

test("skin quick-server projection does not expose a network target used as the TeamSpeak name", () => {
  const projection = createSkinPluginQuickServerProjection(() => "opaque-target-name");
  const [server] = projection.project([{
    id: "current.example:9987",
    address: "current.example:9987",
    label: "current.example:9987",
    serverName: "server.example.invalid:9987",
    isFavorite: true,
  }], () => true);

  assert.equal(server.label, "Favorite 1");
  assert.equal(server.monogram, "F");
  assert.equal(JSON.stringify(server).includes("server.example.invalid"), false);
});

test("fixed-mode server controls use the requested Chinese restriction messages", () => {
  assert.equal(webClientTranslations.zh.serverFeatureAdminDisabled, "该功能已被管理员关闭");
  assert.equal(webClientTranslations.zh.serverSwitchRestricted, "管理员不允许切换TS服务器");
});
