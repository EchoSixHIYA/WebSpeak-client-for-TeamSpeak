import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseSkinPluginDocument,
  parseSkinPluginJson,
  type SkinPluginDocument,
  type SkinPluginNode,
} from "./skin-plugin.js";

function validDocument(): SkinPluginDocument {
  return {
    schemaVersion: 1,
    components: [{
      id: "channel-list",
      name: "Channel list",
      page: "voice",
      accessibleName: "TeamSpeak channels",
      permissions: ["session.channels.read", "session.channel.join"],
      actions: {
        join: { type: "voice.joinChannel", args: { channelId: "{{channel.id}}" } },
      },
      root: {
        tag: "nav",
        repeat: { path: "session.channels", as: "channel" },
        children: [{
          tag: "button",
          attributes: { type: "button", "aria-label": "{{channel.name}}" },
          events: { dblclick: "join" },
          children: [{ text: "{{channel.name}}" }],
        }],
      },
    }],
  };
}

function errorCode(run: () => unknown, expected: string): void {
  assert.throws(run, (error: unknown) => error instanceof Error
    && "code" in error && error.code === expected);
}

test("skin plugin accepts a bounded channel list with a double-click host action", () => {
  const parsed = parseSkinPluginDocument(validDocument());
  assert.equal(parsed.components[0].root.repeat?.path, "session.channels");
  assert.equal(parsed.components[0].root.children?.[0].events?.dblclick, "join");
});

test("KAAK v3 example uses only validated public session data and an explicit join action", async () => {
  const source = await readFile(new URL("../../docs/examples/kaak-voice/components.json", import.meta.url), "utf8");
  const parsed = parseSkinPluginJson(source);
  const sidebar = parsed.components[0];
  assert.equal(sidebar.id, "kaak-room-sidebar");
  assert.deepEqual(sidebar.permissions, ["session.channels.read", "session.members.read", "session.channel.join"]);
  assert.equal(sidebar.actions["join-channel"].type, "voice.joinChannel");
  assert.equal(sidebar.root.children?.[1].children?.[0].repeat?.path, "session.channels");
});

test("skin plugin binds form controls only to declared local state", () => {
  const document = validDocument();
  document.components[0].state = { search: "" };
  document.components[0].root.children = [{
    tag: "input",
    bindValue: "search",
    events: { input: "filter" },
  }];
  document.components[0].actions.filter = { type: "ui.setState", args: { key: "search", value: "{{state.search}}" } };
  assert.equal(parseSkinPluginDocument(document).components[0].state?.search, "");
});

test("skin plugin rejects undeclared permissions, arbitrary paths, and executable markup", () => {
  const missingPermission = validDocument();
  missingPermission.components[0].permissions = ["session.channel.join"];
  errorCode(() => parseSkinPluginDocument(missingPermission), "SKIN_PLUGIN_PERMISSION_MISSING");

  const hiddenPath = validDocument();
  hiddenPath.components[0].root.children![0].children = [{ text: "{{session.credentials.privateKey}}" }];
  errorCode(() => parseSkinPluginDocument(hiddenPath), "SKIN_PLUGIN_BINDING_INVALID");

  const executable = validDocument();
  executable.components[0].root.children![0].attributes = { onclick: "alert(1)" };
  errorCode(() => parseSkinPluginDocument(executable), "SKIN_PLUGIN_ATTRIBUTE_INVALID");

  const unsafeTag = validDocument();
  unsafeTag.components[0].root.children![0].tag = "iframe";
  errorCode(() => parseSkinPluginDocument(unsafeTag), "SKIN_PLUGIN_ELEMENT_INVALID");

  const externalSvgPaint = validDocument();
  externalSvgPaint.components[0].root.children![0].attributes = { fill: "url(https://example.invalid/payload.svg#paint)" };
  errorCode(() => parseSkinPluginDocument(externalSvgPaint), "SKIN_PLUGIN_ATTRIBUTE_INVALID");
});

test("skin plugin restricts repeated fields to the selected collection", () => {
  const document = validDocument();
  document.components[0].root.repeat = { path: "session.channels", as: "channel" };
  document.components[0].root.children = [{ text: "{{channel.author}}" }];
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_BINDING_INVALID");
});

test("skin plugin never dispatches host actions from typing or selection changes", () => {
  const document = validDocument();
  document.components[0].root.children![0].events = { change: "join" };
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_EVENT_INVALID");
});

test("skin plugin JSON parser enforces a bounded document size and valid JSON", () => {
  assert.throws(() => parseSkinPluginJson("{"));
  assert.throws(() => parseSkinPluginJson(" ".repeat(256 * 1024 + 1)));
  assert.equal(parseSkinPluginJson(JSON.stringify(validDocument())).components.length, 1);
});

test("skin plugin enforces each component's node and nesting limits", () => {
  const broad = validDocument();
  broad.components[0].root.children = Array.from({ length: 101 }, () => ({ text: "item" }));
  errorCode(() => parseSkinPluginDocument(broad), "SKIN_PLUGIN_TREE_INVALID");

  const tooMany = validDocument();
  const branch = (depth: number): SkinPluginNode => depth === 0
    ? { tag: "span", children: [{ text: "item" }] }
    : { tag: "span", children: Array.from({ length: 3 }, () => branch(depth - 1)) };
  tooMany.components[0].root.children = Array.from({ length: 3 }, () => branch(5));
  errorCode(() => parseSkinPluginDocument(tooMany), "SKIN_PLUGIN_COMPLEXITY_LIMIT");
});
