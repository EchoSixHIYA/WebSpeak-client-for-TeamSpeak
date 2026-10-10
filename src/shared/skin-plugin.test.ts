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
  assert.equal(parsed.schemaVersion, 1, "legacy documents retain their original capability boundary");
  assert.equal(parsed.components[0].mode, "widget");
  assert.equal(parsed.components[0].root.repeat?.path, "session.channels");
  assert.equal(parsed.components[0].root.children?.[0].events?.dblclick, "join");
});

test("component schema v2 can replace a public page and compose trusted host widgets", () => {
  const document = validDocument();
  document.schemaVersion = 2;
  document.components[0].mode = "surface";
  document.components[0].permissions = ["ui.surface.replace"];
  document.components[0].actions = {};
  document.components[0].root = {
    tag: "main",
    className: "custom-voice-shell",
    children: [
      { widget: "voice.channel-panel", part: "channels" },
      { widget: "voice.chat-panel" },
    ],
  };

  const parsed = parseSkinPluginDocument(document);
  assert.equal(parsed.components[0].mode, "surface");
  assert.deepEqual(parsed.components[0].root.children?.map((node) => node.widget), ["voice.channel-panel", "voice.chat-panel"]);
  assert.throws(() => parseSkinPluginDocument({ ...document, schemaVersion: 1 }), { code: "SKIN_PLUGIN_SCHEMA_UNSUPPORTED" });
});

test("page surfaces and stateful host widgets cannot be duplicated", () => {
  const document = validDocument();
  document.schemaVersion = 2;
  document.components[0].mode = "surface";
  document.components[0].permissions.push("ui.surface.replace");
  document.components[0].root = { tag: "main", children: [{ widget: "voice.chat-panel" }] };
  document.components.push({
    ...document.components[0],
    id: "second-surface",
    mode: "widget",
    root: { tag: "section", children: [{ widget: "voice.chat-panel" }] },
  });
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_WIDGET_DUPLICATE");

  document.components[1].mode = "surface";
  document.components[1].root.children = [{ widget: "voice.member-cards" }];
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_SURFACE_DUPLICATE");
});

test("replacing a built-in public page requires an explicit user approval capability", () => {
  const document = validDocument();
  document.schemaVersion = 2;
  document.components[0].mode = "surface";
  document.components[0].permissions = [];
  document.components[0].actions = {};
  document.components[0].root = { tag: "main", children: [{ tag: "h1", children: [{ text: "Custom client" }] }] };
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");

  document.components[0].permissions = ["ui.surface.replace"];
  assert.deepEqual(parseSkinPluginDocument(document).components[0].permissions, ["ui.surface.replace"]);
});

test("custom surfaces can safely render and switch unified favorite and recent server entries", () => {
  const document = validDocument();
  document.components[0].permissions = ["servers.quickList.read", "servers.quickList.switch"];
  document.components[0].actions = {
    switch: { type: "quickServers.switch", args: { quickServerId: "{{server.id}}" } },
  };
  document.components[0].root = {
    tag: "nav",
    repeat: { path: "servers.quickList", as: "server" },
    children: [{ tag: "button", events: { dblclick: "switch" }, children: [{ text: "{{server.label}}" }] }],
  };
  const parsed = parseSkinPluginDocument(document).components[0];
  assert.equal(parsed.root.repeat?.path, "servers.quickList");
  assert.equal(parsed.actions.switch.type, "quickServers.switch");

  document.components[0].permissions = ["servers.quickList.read"];
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");
});

test("host widget references stay allowlisted and cannot be used on the demo page", () => {
  const unknownWidget = validDocument();
  unknownWidget.schemaVersion = 2;
  unknownWidget.components[0].root = { tag: "main", children: [{ widget: "filesystem.read" as never }] };
  errorCode(() => parseSkinPluginDocument(unknownWidget), "SKIN_PLUGIN_WIDGET_INVALID");

  const demoWidget = validDocument();
  demoWidget.schemaVersion = 2;
  demoWidget.components[0].page = "demo";
  demoWidget.components[0].root = { tag: "main", children: [{ widget: "voice.chat-panel" }] };
  errorCode(() => parseSkinPluginDocument(demoWidget), "SKIN_PLUGIN_WIDGET_INVALID");
});

test("starting screen share from a skin host widget requires its own permission", () => {
  const document = validDocument();
  document.schemaVersion = 2;
  document.components[0].root = { tag: "main", children: [{ widget: "voice.screen-share-start" }] };
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");

  document.components[0].permissions = ["voice.screenShare.control"];
  document.components[0].actions = {};
  const parsed = parseSkinPluginDocument(document);
  assert.equal(parsed.components[0].root.children?.[0].widget, "voice.screen-share-start");
});

test("schema v3 host audio controls require read and control permissions while v2 remains compatible", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].actions = {};
  document.components[0].root = { tag: "main", children: [{ widget: "voice.audio-controls" }] };
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");

  document.components[0].permissions = ["audio.status.read", "audio.microphone.control"];
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");

  document.components[0].permissions = ["audio.status.read", "audio.microphone.control", "audio.output.control"];
  assert.equal(parseSkinPluginDocument(document).components[0].root.children?.[0].widget, "voice.audio-controls");

  const legacyDocument = structuredClone(document);
  legacyDocument.schemaVersion = 2;
  legacyDocument.components[0].permissions = [];
  assert.equal(parseSkinPluginDocument(legacyDocument).components[0].root.children?.[0].widget, "voice.audio-controls");
});

test("KAAK v3 example splits validated channel and member data by component", async () => {
  const source = await readFile(new URL("../../docs/examples/kaak-voice/components.json", import.meta.url), "utf8");
  const parsed = parseSkinPluginJson(source);
  const channelSidebar = parsed.components.find((component) => component.id === "kaak-channel-sidebar");
  const memberSidebar = parsed.components.find((component) => component.id === "kaak-members-sidebar");
  assert.ok(channelSidebar);
  assert.ok(memberSidebar);
  assert.deepEqual(channelSidebar.permissions, ["session.channels.read", "session.members.read", "session.channel.join"]);
  assert.equal(channelSidebar.actions["join-channel"].type, "voice.joinChannel");
  assert.equal(channelSidebar.root.children?.[1].children?.[0].children?.[0].events?.dblclick, "join-channel");
  assert.equal(channelSidebar.root.children?.[1].children?.[0].repeat?.path, "session.channels");
  const nestedMembers = channelSidebar.root.children?.[1].children?.[0].children?.[1].children?.[0];
  assert.equal(nestedMembers?.repeat?.path, "channel.members");
  assert.equal(nestedMembers?.children?.[1].children?.[0].text, "{{member.name}}");
  assert.deepEqual(memberSidebar.permissions, ["session.members.read"]);
  assert.equal(memberSidebar.root.children?.[2].children?.[0].repeat?.path, "session.members");
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

test("skin plugins can repeat channel members only under a channel alias and with member permission", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].permissions.push("session.members.read");
  document.components[0].root.children = [{
    tag: "ul",
    children: [{
      tag: "li",
      repeat: { path: "channel.members", as: "member" },
      children: [{ text: "{{channel.name}} — {{member.name}}" }],
    }],
  }];
  const parsed = parseSkinPluginDocument(document);
  const nestedMember = parsed.components[0].root.children?.[0].children?.[0];
  assert.deepEqual(nestedMember?.repeat, { path: "channel.members", as: "member" });

  const missingPermission = structuredClone(document);
  missingPermission.components[0].permissions = ["session.channels.read", "session.channel.join"];
  errorCode(() => parseSkinPluginDocument(missingPermission), "SKIN_PLUGIN_PERMISSION_MISSING");

  const outsideChannel = structuredClone(document);
  outsideChannel.components[0].root.repeat = undefined;
  outsideChannel.components[0].root.children = [{ tag: "ul", repeat: { path: "channel.members", as: "member" } }];
  errorCode(() => parseSkinPluginDocument(outsideChannel), "SKIN_PLUGIN_REPEAT_INVALID");
});

test("skin plugins keep live typing local but can run host actions on committed changes", () => {
  const document = validDocument();
  const input = document.components[0].root.children![0];
  input.events = { input: "join" };
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_EVENT_INVALID");

  input.events = { change: "join" };
  assert.equal(parseSkinPluginDocument(document).components[0].root.children?.[0].events?.change, "join");
});

test("skin conditions can compare public repeated data with local component state", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].state = { selectedchannel: "" };
  document.components[0].root.children![0].when = {
    path: "state.selectedchannel",
    equals: "{{channel.id}}",
  };
  const parsed = parseSkinPluginDocument(document);
  assert.deepEqual(parsed.components[0].root.children?.[0].when, {
    path: "state.selectedchannel",
    equals: "{{channel.id}}",
  });

  const legacyDocument = structuredClone(document);
  legacyDocument.schemaVersion = 2;
  errorCode(() => parseSkinPluginDocument(legacyDocument), "SKIN_PLUGIN_SCHEMA_UNSUPPORTED");

  document.components[0].root.children![0].when!.equals = "{{channel.address}}";
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_BINDING_INVALID");
});

test("schema v3 can render empty states only for permissioned public collections", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].permissions.push("chat.channel.read");
  document.components[0].root.children = [{
    tag: "p",
    when: { path: "chat.messages", empty: true },
    children: [{ text: "No messages yet" }],
  }];
  assert.equal(parseSkinPluginDocument(document).components[0].root.children?.[0].when?.empty, true);

  document.components[0].permissions.push("session.status.read");
  document.components[0].root.children[0].when!.path = "session.status.serverLabel";
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_CONDITION_INVALID");
});

test("component schema v3 exposes composable interaction patterns and permission-gated voice actions", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].permissions = [
    "audio.microphone.control", "audio.output.control", "audio.status.read", "voice.disconnect", "voice.presence.write",
    "voice.whisper.control", "voice.whisper.status.read", "voice.screenShare.control", "voice.screenShare.read", "voice.screenShare.status.read",
  ];
  document.components[0].state = { menuopen: false, volume: 0.5, awaymessage: "" };
  document.components[0].actions = {
    "toggle-menu": { type: "ui.toggleState", args: { key: "menuopen" } },
    microphone: { type: "voice.toggleMicrophone", args: {} },
    speaker: { type: "voice.toggleOutputMute", args: {} },
    volume: { type: "voice.setOutputVolume", args: { volume: "{{state.volume}}" } },
    disconnect: { type: "voice.disconnect", args: {} },
    away: { type: "voice.setAway", args: { away: true, message: "{{state.awaymessage}}" } },
    whisper: { type: "voice.setWhisperActive", args: { active: true } },
    "start-share": { type: "voice.startScreenShare", args: {} },
    "stop-share": { type: "voice.stopScreenShare", args: {} },
    "join-share": { type: "voice.joinScreenShare", args: { streamId: "{{share.streamId}}" } },
    "leave-share": { type: "voice.leaveScreenShare", args: {} },
  };
  document.components[0].root = {
    tag: "main",
    attributes: { "data-layout": "room", "aria-label": "Custom voice page" },
    children: [
      { tag: "button", events: { contextmenu: "toggle-menu", pointerenter: "toggle-menu" }, children: [{ text: "Menu" }] },
      { tag: "button", events: { click: "microphone" }, children: [{ text: "Microphone" }] },
      { tag: "button", events: { click: "speaker" }, children: [{ text: "Speaker" }] },
      { tag: "button", events: { click: "volume" }, children: [{ text: "Volume" }] },
      { tag: "button", events: { click: "disconnect" }, children: [{ text: "Disconnect" }] },
      { tag: "button", events: { click: "away" }, children: [{ text: "Away" }] },
      { tag: "button", events: { click: "whisper" }, children: [{ text: "Whisper" }] },
      { tag: "button", events: { click: "start-share" }, children: [{ text: "Share" }] },
      { tag: "button", events: { click: "stop-share" }, children: [{ text: "Stop sharing" }] },
      { tag: "div", repeat: { path: "screenShare.streams", as: "share" }, children: [
        { tag: "button", events: { click: "join-share" }, children: [{ text: "{{share.name}}" }] },
      ] },
      { tag: "button", events: { click: "leave-share" }, children: [{ text: "Leave share" }] },
    ],
  };
  const parsed = parseSkinPluginDocument(document);
  assert.equal(parsed.schemaVersion, 3);
  assert.equal(parsed.components[0].root.children?.[0].events?.contextmenu, "toggle-menu");
  assert.equal(parsed.components[0].actions["join-share"].type, "voice.joinScreenShare");
  assert.equal(parsed.components[0].root.children?.[9].repeat?.path, "screenShare.streams");

  const passiveVoiceControl = structuredClone(document);
  passiveVoiceControl.components[0].root.children![0].events = { pointerenter: "microphone" };
  errorCode(() => parseSkinPluginDocument(passiveVoiceControl), "SKIN_PLUGIN_EVENT_INVALID");

  const missingPermission = structuredClone(document);
  missingPermission.components[0].permissions = missingPermission.components[0].permissions.filter((item) => item !== "audio.microphone.control");
  errorCode(() => parseSkinPluginDocument(missingPermission), "SKIN_PLUGIN_PERMISSION_MISSING");

  const oldSchema = structuredClone(document);
  oldSchema.schemaVersion = 2;
  errorCode(() => parseSkinPluginDocument(oldSchema), "SKIN_PLUGIN_SCHEMA_UNSUPPORTED");
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
