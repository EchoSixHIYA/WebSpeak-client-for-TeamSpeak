import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseSkinPluginDocument,
  parseSkinPluginJson,
  skinPluginWidgetPermissions,
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
  document.schemaVersion = 3;
  document.components[0].permissions = ["servers.quickList.read", "servers.quickList.switch"];
  document.components[0].actions = {
    switch: { type: "quickServers.switch", args: { quickServerId: "{{server.id}}" } },
  };
  document.components[0].root = {
    tag: "nav",
    repeat: { path: "servers.quickList", as: "server" },
    children: [{
      tag: "button",
      attributes: { "aria-disabled": "{{server.switchRestricted}}", title: "{{server.switchTitle}}" },
      events: { dblclick: "switch" },
      children: [{ text: "{{server.label}}" }],
    }],
  };
  const parsed = parseSkinPluginDocument(document).components[0];
  assert.equal(parsed.root.repeat?.path, "servers.quickList");
  assert.equal(parsed.root.children?.[0].attributes?.["aria-disabled"], "{{server.switchRestricted}}");
  assert.equal(parsed.root.children?.[0].attributes?.title, "{{server.switchTitle}}");
  assert.equal(parsed.actions.switch.type, "quickServers.switch");

  document.components[0].permissions = ["servers.quickList.read"];
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");
});

test("server list skins may display only the host-provided TeamSpeak icon image", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].actions = {};
  document.components[0].permissions = ["servers.quickList.read"];
  document.components[0].root = {
    tag: "nav",
    repeat: { path: "servers.quickList", as: "server" },
    children: [{ tag: "img", attributes: { src: "{{server.icon}}", alt: "" } }],
  };
  assert.equal(parseSkinPluginDocument(document).components[0].root.children?.[0].attributes?.src, "{{server.icon}}");

  document.components[0].root.children![0].attributes!.src = "https://example.com/icon.png";
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_ATTRIBUTE_INVALID");
  document.components[0].root.children![0].attributes!.src = "{{server.icon}}";
  document.components[0].root.children![0].tag = "span";
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_ATTRIBUTE_INVALID");
});

test("skin-owned localization messages are available without adding host permissions", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].name = "{{skin.messages.demo.title}}";
  document.components[0].accessibleName = "{{skin.messages.accessibleName}}";
  document.components[0].permissions = [];
  document.components[0].actions = {};
  document.components[0].root = {
    tag: "section",
    attributes: { "aria-label": "{{skin.messages.demo.accessibility.label}}" },
    children: [{ text: "{{skin.messages.demo.greeting}}" }],
  };

  const component = parseSkinPluginDocument(document).components[0];
  assert.equal(component.name, "{{skin.messages.demo.title}}");
  assert.equal(component.accessibleName, "{{skin.messages.accessibleName}}");
  assert.equal(component.root.children?.[0].text, "{{skin.messages.demo.greeting}}");
});

test("chat panel visibility is host-controlled and its toggle requires chat access", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].permissions = ["chat.channel.read"];
  document.components[0].actions = {
    toggle: { type: "chat.togglePanel", args: {} },
  };
  document.components[0].root = {
    tag: "button",
    attributes: { "aria-expanded": "{{chat.status.panelOpen}}" },
    events: { click: "toggle" },
    children: [{ text: "{{chat.status.tabLabel}}" }],
  };
  const parsed = parseSkinPluginDocument(document).components[0];
  assert.equal(parsed.actions.toggle.type, "chat.togglePanel");
  assert.equal(parsed.root.attributes?.["aria-expanded"], "{{chat.status.panelOpen}}");

  document.components[0].permissions = [];
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");
});

test("copying a session invite link is an explicit permission-gated host action", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].actions = {
    invite: { type: "session.copyInviteLink", args: {} },
  };
  document.components[0].root = {
    tag: "button",
    events: { click: "invite" },
  };

  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");

  document.components[0].permissions = ["session.invite.copy"];
  const parsed = parseSkinPluginDocument(document).components[0];
  assert.equal(parsed.actions.invite.type, "session.copyInviteLink");
  assert.equal(Object.keys(parsed.actions.invite.args).length, 0);
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

test("server banner host widget only exposes public session status fields", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].actions = {};
  document.components[0].root = { tag: "main", children: [{ widget: "voice.server-banner" }] };
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");

  document.components[0].permissions = ["session.status.read"];
  const parsed = parseSkinPluginDocument(document);
  assert.equal(parsed.components[0].root.children?.[0].widget, "voice.server-banner");
});

test("home connection status widget requires the public session status permission", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].page = "home";
  document.components[0].actions = {};
  document.components[0].root = { tag: "main", children: [{ widget: "home.connection-status" }] };
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");

  document.components[0].permissions = ["session.status.read"];
  assert.equal(parseSkinPluginDocument(document).components[0].root.children?.[0].widget, "home.connection-status");
  assert.deepEqual(skinPluginWidgetPermissions("home.connection-status"), ["session.status.read"]);
});

test("visitor count is a permission-free public home widget and cannot mount on other pages", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].page = "home";
  document.components[0].permissions = [];
  document.components[0].actions = {};
  document.components[0].root = { tag: "main", children: [{ widget: "home.visitor-count", part: "visitors" }] };

  const parsed = parseSkinPluginDocument(document);
  assert.equal(parsed.components[0].root.children?.[0].widget, "home.visitor-count");
  assert.deepEqual(skinPluginWidgetPermissions("home.visitor-count"), []);

  document.components[0].page = "voice";
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_WIDGET_INVALID");
});

test("generic identity-provider entry is a host button with no connection permission or skin action", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].page = "home";
  document.components[0].permissions = [];
  document.components[0].actions = {};
  document.components[0].root = {
    tag: "main",
    children: [{ widget: "home.identity-provider", options: { identityProviderId: "myts", identityProviderLabel: "myts" } }],
  };

  const parsed = parseSkinPluginDocument(document);
  assert.equal(parsed.components[0].root.children?.[0].widget, "home.identity-provider");
  assert.deepEqual(parsed.components[0].root.children?.[0].options, { identityProviderId: "myts", identityProviderLabel: "myts" });
  assert.deepEqual(skinPluginWidgetPermissions("home.identity-provider"), []);
  assert.deepEqual(Object.keys(parsed.components[0].actions), []);
});

test("skin SVG illustrations support bounded path and circle geometry attributes", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].root = {
    tag: "svg",
    attributes: { viewbox: "0 0 100 100", role: "img" },
    children: [
      { tag: "circle", attributes: { cx: 25, cy: 30, r: 12, fill: "#b0f49b" } },
      { tag: "path", attributes: { d: "M10 20h30v40", stroke: "white", "stroke-width": 2, fill: "none" } },
    ],
  };
  const parsed = parseSkinPluginDocument(document).components[0].root;
  assert.equal(parsed.children?.[0].attributes?.cx, 25);
  assert.equal(parsed.children?.[1].attributes?.d, "M10 20h30v40");

  document.components[0].root.children![1].attributes!.d = "x".repeat(513);
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_ATTRIBUTE_INVALID");
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
  document.components[0].root.children![0] = { widget: "voice.audio-controls" };
  const genericAudioControls = parseSkinPluginDocument(document).components[0].root.children?.[0];
  assert.equal(genericAudioControls?.widget, "voice.audio-controls");
  assert.equal(genericAudioControls?.options, undefined);

  const invalidLayout = structuredClone(document);
  invalidLayout.components[0].root.children![0] = { widget: "voice.audio-controls", options: { layout: "room-panel" } as never };
  errorCode(() => parseSkinPluginDocument(invalidLayout), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");

  const legacyDocument = structuredClone(document);
  legacyDocument.schemaVersion = 2;
  legacyDocument.components[0].permissions = [];
  legacyDocument.components[0].root.children![0] = { widget: "voice.audio-controls" };
  assert.equal(parseSkinPluginDocument(legacyDocument).components[0].root.children?.[0].widget, "voice.audio-controls");
});

test("schema v3 member cards require a separate permission to display cached profile pictures", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].actions = {};
  document.components[0].permissions = ["session.members.read", "voice.screenShare.read", "voice.screenShare.control"];
  document.components[0].root = { tag: "main", children: [{ widget: "voice.member-cards" }] };
  errorCode(() => parseSkinPluginDocument(document), "SKIN_PLUGIN_PERMISSION_MISSING");

  document.components[0].permissions.push("session.memberAvatars.read");
  assert.equal(parseSkinPluginDocument(document).components[0].root.children?.[0].widget, "voice.member-cards");
});

test("generic home identity-provider widget validates provider metadata", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].page = "home";
  document.components[0].permissions = [];
  document.components[0].actions = {};
  document.components[0].root = {
    tag: "main",
    children: [{ widget: "home.identity-provider", options: { identityProviderId: "myts", identityProviderLabel: "myts" } }],
  };
  const widget = parseSkinPluginDocument(document).components[0].root.children?.[0];
  assert.equal(widget?.widget, "home.identity-provider");
  assert.deepEqual(widget?.options, { identityProviderId: "myts", identityProviderLabel: "myts" });

  const missing = structuredClone(document);
  missing.components[0].root.children![0] = { widget: "home.identity-provider" };
  errorCode(() => parseSkinPluginDocument(missing), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");

  const invalidProvider = structuredClone(document);
  invalidProvider.components[0].root.children![0] = {
    widget: "home.identity-provider",
    options: { identityProviderId: "myts/login", identityProviderLabel: "myts" } as never,
  };
  errorCode(() => parseSkinPluginDocument(invalidProvider), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");
});

test("schema v3 scopes local UI state only to approved public scalar context fields", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].permissions.push("session.status.read");
  document.components[0].stateScope = "session.status.channelId";
  assert.equal(parseSkinPluginDocument(document).components[0].stateScope, "session.status.channelId");

  const missingPermission = structuredClone(document);
  missingPermission.components[0].permissions = missingPermission.components[0].permissions.filter((permission) => permission !== "session.status.read");
  errorCode(() => parseSkinPluginDocument(missingPermission), "SKIN_PLUGIN_PERMISSION_MISSING");

  const privateContext = structuredClone(document);
  privateContext.components[0].stateScope = "session.credentials.privateKey";
  errorCode(() => parseSkinPluginDocument(privateContext), "SKIN_PLUGIN_STATE_SCOPE_INVALID");

  const collection = structuredClone(document);
  collection.components[0].stateScope = "session.channels";
  errorCode(() => parseSkinPluginDocument(collection), "SKIN_PLUGIN_STATE_SCOPE_INVALID");

  const legacy = structuredClone(document);
  legacy.schemaVersion = 2;
  errorCode(() => parseSkinPluginDocument(legacy), "SKIN_PLUGIN_SCHEMA_UNSUPPORTED");
});

test("custom member screen-share fields require read permission and can bind a watch action", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].actions = {
    watch: { type: "voice.joinScreenShare", args: { streamId: "{{member.screenShareStreamId}}" } },
  };
  document.components[0].permissions = ["session.members.read", "voice.screenShare.read", "voice.screenShare.control"];
  document.components[0].root = {
    tag: "ul",
    children: [{
      tag: "li",
      repeat: { path: "session.members", as: "member" },
      children: [{
        tag: "button",
        when: { path: "member.screenSharing", equals: true },
        events: { click: "watch" },
      }],
    }],
  };
  const parsed = parseSkinPluginDocument(document);
  assert.equal(parsed.components[0].root.children?.[0].children?.[0].when?.path, "member.screenSharing");
  assert.equal(parsed.components[0].actions.watch.args.streamId, "{{member.screenShareStreamId}}");

  const missingRead = structuredClone(document);
  missingRead.components[0].permissions = missingRead.components[0].permissions.filter((permission) => permission !== "voice.screenShare.read");
  errorCode(() => parseSkinPluginDocument(missingRead), "SKIN_PLUGIN_PERMISSION_MISSING");

  const missingControl = structuredClone(document);
  missingControl.components[0].permissions = missingControl.components[0].permissions.filter((permission) => permission !== "voice.screenShare.control");
  errorCode(() => parseSkinPluginDocument(missingControl), "SKIN_PLUGIN_PERMISSION_MISSING");
});

test("schema v3 trusted widgets can omit screen-share UI and request only the permissions they use", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].actions = {};
  document.components[0].permissions = ["session.members.read", "session.memberAvatars.read"];
  document.components[0].root = { tag: "main", children: [{ widget: "voice.member-cards", options: { screenShare: false, memberActions: true } }] };
  assert.deepEqual(parseSkinPluginDocument(document).components[0].root.children?.[0]?.options, { screenShare: false, memberActions: true });

  const memberCardsDefault = structuredClone(document);
  memberCardsDefault.components[0].root.children![0] = { widget: "voice.member-cards" };
  errorCode(() => parseSkinPluginDocument(memberCardsDefault), "SKIN_PLUGIN_PERMISSION_MISSING");

  const performanceWithoutShare = structuredClone(document);
  performanceWithoutShare.components[0].permissions = [];
  performanceWithoutShare.components[0].root.children![0] = { widget: "voice.performance-panel", options: { screenShare: false } };
  assert.equal(parseSkinPluginDocument(performanceWithoutShare).components[0].root.children?.[0]?.widget, "voice.performance-panel");

  const performanceWithShare = structuredClone(performanceWithoutShare);
  performanceWithShare.components[0].root.children![0] = { widget: "voice.performance-panel", options: { screenShare: true } };
  errorCode(() => parseSkinPluginDocument(performanceWithShare), "SKIN_PLUGIN_PERMISSION_MISSING");
  performanceWithShare.components[0].permissions = ["voice.screenShare.read"];
  assert.equal(parseSkinPluginDocument(performanceWithShare).components[0].root.children?.[0]?.widget, "voice.performance-panel");

  const invalidOption = structuredClone(document);
  invalidOption.components[0].root.children![0] = { widget: "voice.member-cards", options: { screenShare: "false" } as never };
  errorCode(() => parseSkinPluginDocument(invalidOption), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");

  const memberActionsOnWrongWidget = structuredClone(document);
  memberActionsOnWrongWidget.components[0].root.children![0] = { widget: "voice.performance-panel", options: { memberActions: true } };
  errorCode(() => parseSkinPluginDocument(memberActionsOnWrongWidget), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");

  const invalidMemberActions = structuredClone(document);
  invalidMemberActions.components[0].root.children![0] = { widget: "voice.member-cards", options: { memberActions: "yes" } as never };
  errorCode(() => parseSkinPluginDocument(invalidMemberActions), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");

  const legacyOption = structuredClone(document);
  legacyOption.schemaVersion = 2;
  legacyOption.components[0].root.children![0] = { widget: "voice.member-cards", options: { screenShare: false } };
  errorCode(() => parseSkinPluginDocument(legacyOption), "SKIN_PLUGIN_SCHEMA_UNSUPPORTED");

  const misplacedOption = structuredClone(document);
  misplacedOption.components[0].root.children![0] = { tag: "div", options: { screenShare: false } } as never;
  errorCode(() => parseSkinPluginDocument(misplacedOption), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");
});

test("trusted channel tree and server switcher widgets require scoped read and control permissions", () => {
  const document = validDocument();
  document.schemaVersion = 3;
  document.components[0].actions = {};
  document.components[0].permissions = [
    "session.status.read",
    "session.channels.read",
    "session.members.read",
    "session.memberAvatars.read",
    "session.channel.join",
    "servers.quickList.read",
    "servers.quickList.switch",
  ];
  document.components[0].root = {
    tag: "header",
    children: [
      { widget: "voice.server-switcher", part: "server-switcher" },
      { widget: "voice.server-header", part: "server-header" },
      { widget: "voice.channel-tree", part: "channel-tree", options: { layout: "server-sidebar", memberActions: true, memberDragDrop: true } },
    ],
  };
  assert.deepEqual(parseSkinPluginDocument(document).components[0].root.children?.map(({ widget }) => widget), [
    "voice.server-switcher",
    "voice.server-header",
    "voice.channel-tree",
  ]);
  assert.deepEqual(parseSkinPluginDocument(document).components[0].root.children?.[2]?.options, { layout: "server-sidebar", memberActions: true, memberDragDrop: true });

  const invalidMemberDragDrop = structuredClone(document);
  invalidMemberDragDrop.components[0].root.children![2] = { widget: "voice.channel-tree", options: { memberDragDrop: "yes" } as never };
  errorCode(() => parseSkinPluginDocument(invalidMemberDragDrop), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");

  const memberDragDropOnWrongWidget = structuredClone(document);
  memberDragDropOnWrongWidget.components[0].root.children![2] = { widget: "voice.performance-panel", options: { memberDragDrop: true } };
  errorCode(() => parseSkinPluginDocument(memberDragDropOnWrongWidget), "SKIN_PLUGIN_WIDGET_OPTIONS_INVALID");

  for (const missingPermission of [
    "session.status.read",
    "session.channels.read",
    "session.members.read",
    "session.memberAvatars.read",
    "session.channel.join",
    "servers.quickList.read",
    "servers.quickList.switch",
  ] as const) {
    const missing = structuredClone(document);
    missing.components[0].permissions = missing.components[0].permissions.filter((permission) => permission !== missingPermission);
    errorCode(() => parseSkinPluginDocument(missing), "SKIN_PLUGIN_PERMISSION_MISSING");
  }
});

test("KAAK v3 example declares the connection home and complete voice workspace", async () => {
  const source = await readFile(new URL("../../docs/examples/kaak-voice/components.json", import.meta.url), "utf8");
  const parsed = parseSkinPluginJson(source);
  const home = parsed.components.find((component) => component.id === "kaak-home");
  const workspace = parsed.components.find((component) => component.id === "kaak-workspace");
  assert.ok(home);
  assert.ok(workspace);
  assert.equal(home.page, "home");
  assert.equal(home.mode, "surface");
  assert.deepEqual(home.permissions, ["ui.surface.replace", "session.status.read"]);
  const homeSocialLinks = home.root.children?.at(-2);
  assert.equal(homeSocialLinks?.part, "home-social-links");
  assert.equal(homeSocialLinks?.widget, "home.social-links");
  assert.equal(home.root.children?.at(-1)?.part, "home-language", "social icons appear immediately to the left of the language switcher");
  const connectionCard = home.root.children?.[1].children?.[0].children?.[1];
  assert.equal(connectionCard?.part, "connection-card");
  assert.equal(connectionCard?.children?.[0].part, "card-heading");
  assert.equal(connectionCard?.children?.[0].children?.[0].part, "connection-title");
  assert.equal(connectionCard?.children?.[0].children?.[1].widget, "home.identity-provider");
  assert.deepEqual(connectionCard?.children?.[0].children?.[1].options, { identityProviderId: "myts", identityProviderLabel: "myts" });
  assert.equal(connectionCard?.children?.[2].widget, "home.connection-form");
  assert.equal(connectionCard?.children?.[4].widget, "home.connection-status");
  const serverAnnouncement = home.root.children?.[0].children?.[2];
  assert.equal(serverAnnouncement?.part, "server-announcement");
  assert.equal(serverAnnouncement?.widget, "home.server-announcement");
  const heroMedia = home.root.children?.[0].children?.[3];
  assert.equal(heroMedia?.part, "hero-media");
  assert.equal(heroMedia?.children?.[0].tag, "svg");
  assert.equal(heroMedia?.children?.[1].widget, "home.visitor-count");

  assert.equal(workspace.page, "voice");
  assert.equal(workspace.mode, "surface");
  assert.ok(workspace.permissions.includes("session.channels.read"));
  assert.ok(workspace.permissions.includes("session.status.read"));
  assert.ok(workspace.permissions.includes("session.members.read"));
  assert.ok(workspace.permissions.includes("session.memberAvatars.read"));
  assert.ok(workspace.permissions.includes("session.channel.join"));
  assert.ok(workspace.permissions.includes("servers.quickList.read"));
  assert.ok(workspace.permissions.includes("servers.quickList.switch"));
  assert.ok(workspace.permissions.includes("chat.channel.read"));
  assert.ok(workspace.permissions.includes("chat.channel.send"));
  assert.ok(workspace.permissions.includes("audio.microphone.control"));
  assert.ok(workspace.permissions.includes("voice.screenShare.control"));
  assert.ok(workspace.permissions.includes("voice.screenShare.read"));
  assert.ok(workspace.permissions.includes("voice.screenShare.status.read"));
  assert.equal(workspace.actions["stop-screen-share"].type, "voice.stopScreenShare");
  assert.equal(workspace.actions["join-channel"], undefined, "channel joining is handled by the trusted tree widget");
  assert.equal(workspace.actions["toggle-chat-panel"].type, "chat.togglePanel");

  const nodes: SkinPluginNode[] = [];
  const visit = (node: SkinPluginNode): void => {
    nodes.push(node);
    node.children?.forEach(visit);
  };
  visit(workspace.root);
  assert.ok(nodes.some((node) => node.widget === "voice.member-cards"));
  assert.ok(nodes.some((node) => node.part === "desktop-room-controls" && node.tag === "div"), "the desktop audio dock is composed in the skin document");
  assert.ok(nodes.some((node) => node.part === "desktop-room-noise-suppression" && node.events?.click === "toggle-noise-suppression"));
  assert.ok(nodes.some((node) => node.part === "desktop-room-accompaniment" && node.events?.click === "toggle-accompaniment"));
  assert.ok(nodes.some((node) => node.part === "mobile-room-controls" && node.tag === "div"), "the mobile room toolbar is composed in the skin document");
  assert.ok(nodes.some((node) => node.part === "mobile-room-microphone" && node.events?.click === "toggle-microphone"));
  assert.ok(nodes.some((node) => node.part === "mobile-room-speaker" && node.events?.click === "open-audio-settings"));
  assert.ok(nodes.some((node) => node.part === "mobile-room-exit" && node.events?.click === "disconnect"));
  assert.ok(nodes.some((node) => node.widget === "voice.server-header"), "the server header exposes trusted search and quick switching");
  assert.ok(nodes.some((node) => node.widget === "voice.channel-tree" && node.options?.layout === "server-sidebar"), "the KAAK channel tree opts into its isolated sidebar layout");
  assert.equal(nodes.find((node) => node.part === "record-placeholder"), undefined, "the KAAK voice dock does not expose a recording control");
  assert.ok(nodes.some((node) => node.widget === "voice.screen-share-start"), "the voice dock exposes WebSpeak screen sharing");
  assert.ok(nodes.some((node) => node.widget === "voice.screen-share-player"), "the voice stage keeps WebSpeak's screen-share player");
  assert.ok(nodes.some((node) => node.widget === "voice.chat-panel"), "KAAK uses the unified host chat panel for channel, server, and private messages");
  assert.equal(nodes.find((node) => node.part === "screen-share-stop")?.events?.click, "stop-screen-share");
  assert.ok(!nodes.some((node) => node.repeat?.path === "session.members"), "member imagery stays inside the trusted host widget");
  assert.ok(!nodes.some((node) => node.tag === "input" && node.bindValue === "message"), "chat input state stays in the host-owned panel");
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

  const skinOwnedPopover = validDocument();
  skinOwnedPopover.components[0].root.children![0].attributes = { popover: "manual" };
  errorCode(() => parseSkinPluginDocument(skinOwnedPopover), "SKIN_PLUGIN_ATTRIBUTE_INVALID");

  const skinOwnedPopoverTrigger = validDocument();
  skinOwnedPopoverTrigger.components[0].root.children![0].attributes = { popovertarget: "host-editor" };
  errorCode(() => parseSkinPluginDocument(skinOwnedPopoverTrigger), "SKIN_PLUGIN_ATTRIBUTE_INVALID");
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
      children: [{ text: "{{channel.name}} — {{member.avatarInitial}} {{member.name}}" }],
    }],
  }];
  const parsed = parseSkinPluginDocument(document);
  const nestedMember = parsed.components[0].root.children?.[0].children?.[0];
  assert.deepEqual(nestedMember?.repeat, { path: "channel.members", as: "member" });
  assert.equal(nestedMember?.children?.[0]?.text, "{{channel.name}} — {{member.avatarInitial}} {{member.name}}");

  const membersOnly = structuredClone(document);
  membersOnly.components[0].root.children = [{
    tag: "ul",
    when: { path: "channel.members", empty: false },
    children: [{ tag: "li", repeat: { path: "channel.members", as: "member" } }],
  }];
  const parsedCondition = parseSkinPluginDocument(membersOnly).components[0].root.children?.[0];
  assert.deepEqual(parsedCondition?.when, { path: "channel.members", empty: false });

  const missingConditionPermission = structuredClone(membersOnly);
  missingConditionPermission.components[0].permissions = ["session.channels.read", "session.channel.join"];
  missingConditionPermission.components[0].root.children![0].children = [];
  errorCode(() => parseSkinPluginDocument(missingConditionPermission), "SKIN_PLUGIN_PERMISSION_MISSING");

  const invalidNestedCondition = structuredClone(membersOnly);
  invalidNestedCondition.components[0].root.children![0].when = { path: "channel.members" };
  errorCode(() => parseSkinPluginDocument(invalidNestedCondition), "SKIN_PLUGIN_CONDITION_INVALID");

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
    "audio.microphone.control", "audio.output.control", "audio.status.read", "audio.settings.open", "voice.disconnect", "voice.presence.write",
    "voice.whisper.control", "voice.whisper.status.read", "voice.screenShare.control", "voice.screenShare.read", "voice.screenShare.status.read",
  ];
  document.components[0].state = { menuopen: false, chatopen: true, volume: 0.5, awaymessage: "" };
  document.components[0].actions = {
    "toggle-menu": { type: "ui.toggleState", args: { key: "menuopen", resetKey: "chatopen" } },
    microphone: { type: "voice.toggleMicrophone", args: {} },
    speaker: { type: "voice.toggleOutputMute", args: {} },
    settings: { type: "audio.openSettings", args: {} },
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
      { tag: "button", events: { click: "settings" }, children: [{ text: "Audio settings" }] },
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
  assert.equal(parsed.components[0].actions.settings.type, "audio.openSettings");
  assert.equal(parsed.components[0].actions["toggle-menu"].args.resetKey, "chatopen");
  assert.equal(parsed.components[0].root.children?.[10].repeat?.path, "screenShare.streams");

  const invalidResetKey = structuredClone(document);
  invalidResetKey.components[0].actions["toggle-menu"].args.resetKey = "missing";
  errorCode(() => parseSkinPluginDocument(invalidResetKey), "SKIN_PLUGIN_ACTION_INVALID");

  const passiveVoiceControl = structuredClone(document);
  passiveVoiceControl.components[0].root.children![0].events = { pointerenter: "microphone" };
  errorCode(() => parseSkinPluginDocument(passiveVoiceControl), "SKIN_PLUGIN_EVENT_INVALID");

  const missingPermission = structuredClone(document);
  missingPermission.components[0].permissions = missingPermission.components[0].permissions.filter((item) => item !== "audio.microphone.control");
  errorCode(() => parseSkinPluginDocument(missingPermission), "SKIN_PLUGIN_PERMISSION_MISSING");

  const missingAudioSettingsPermission = structuredClone(document);
  missingAudioSettingsPermission.components[0].permissions = missingAudioSettingsPermission.components[0].permissions.filter((item) => item !== "audio.settings.open");
  errorCode(() => parseSkinPluginDocument(missingAudioSettingsPermission), "SKIN_PLUGIN_PERMISSION_MISSING");

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
