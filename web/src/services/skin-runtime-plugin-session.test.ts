import assert from "node:assert/strict";
import test from "node:test";
import { parseSkinRuntimePluginDocument } from "../../../src/shared/skin-runtime-plugins.js";
import { createSkinRuntimePluginSession, SkinRuntimePluginSessionError } from "./skin-runtime-plugin-session.js";

const plugin = parseSkinRuntimePluginDocument({
  schemaVersion: 1,
  plugins: [{
    id: "voice-surface",
    name: "Voice surface",
    version: "1.0.0",
    apiVersion: 1,
    runtime: "wasm",
    page: "voice",
    mode: "surface",
    entry: "plugins/voice-surface/index.wasm",
    assets: [],
    permissions: ["ui.surface.replace"],
  }],
}).plugins[0];

const joinPlugin = parseSkinRuntimePluginDocument({
  schemaVersion: 1,
  plugins: [{
    id: "voice-join",
    name: "Voice join",
    version: "1.0.0",
    apiVersion: 1,
    runtime: "wasm",
    page: "voice",
    mode: "surface",
    entry: "plugins/voice-join/index.wasm",
    assets: [],
    permissions: ["ui.surface.replace", "session.channel.join"],
  }],
}).plugins[0];

function output(page = "voice", count = 1): string {
  return JSON.stringify({
    schemaVersion: 5,
    components: Array.from({ length: count }, (_, index) => ({
      id: `surface-${index}`,
      name: "Voice surface",
      page,
      accessibleName: "Voice workspace",
      state: {},
      root: { tag: "main", children: [{ text: "custom voice UI" }] },
    })),
  });
}

function joinOutput(request = false, eventName: "dblclick" | "input" = "dblclick"): string {
  return JSON.stringify({
    schemaVersion: 6,
    components: [{
      id: "voice-ui",
      name: "Voice UI",
      page: "voice",
      accessibleName: "Voice workspace",
      state: {},
      root: { tag: "button", events: { [eventName]: "join" }, children: [{ text: "Join" }] },
    }],
    ...(request ? { request: { type: "voice.joinChannel", args: { channelId: "channel-1" } } } : {}),
  });
}

function sessionWithOutput(value: string, onError: (error: Error) => void = () => undefined) {
  return createSkinRuntimePluginSession({
    plugin,
    createRun: () => ({ result: Promise.resolve({ uiOutput: value }), close: () => undefined }),
    onError,
  });
}

test("runtime plugin session accepts one generated root for its declared surface", async () => {
  const session = sessionWithOutput(output());
  assert.equal(await session.start(), true);
  assert.equal(session.output, output());
  assert.equal(session.closed, false);
  session.close();
  assert.equal(session.closed, true);
});

test("runtime plugin session rejects output targeting a different page", async () => {
  const errors: Error[] = [];
  const session = sessionWithOutput(output("home"), (error) => errors.push(error));
  assert.equal(await session.start(), false);
  assert.equal(errors[0] instanceof SkinRuntimePluginSessionError, true);
  assert.equal((errors[0] as SkinRuntimePluginSessionError).code, "SKIN_RUNTIME_PLUGIN_PAGE_MISMATCH");
  assert.equal(session.output, null);
});

test("runtime surface plugins cannot emit competing roots", async () => {
  const errors: Error[] = [];
  const session = sessionWithOutput(output("voice", 2), (error) => errors.push(error));
  assert.equal(await session.start(), false);
  assert.ok(errors[0] instanceof SkinRuntimePluginSessionError);
  assert.equal((errors[0] as SkinRuntimePluginSessionError).code, "SKIN_RUNTIME_PLUGIN_SURFACE_OUTPUT_INVALID");
  assert.equal(session.output, null);
});

test("runtime host actions require an approved permission and a trusted explicit event", async () => {
  const actions: Array<{ type: string; args: Record<string, string | number | boolean> }> = [];
  const session = createSkinRuntimePluginSession({
    plugin: joinPlugin,
    createRun: (input) => ({ result: Promise.resolve({ uiOutput: joinOutput(Boolean(input.event)) }), close: () => undefined }),
    onAction: (action) => { actions.push({ type: action.type, args: { ...action.args } }); },
  });

  assert.equal(await session.start(), true);
  assert.equal(await session.dispatch({
    schemaVersion: 1,
    state: {},
    event: { componentId: "voice-ui", handlerId: "join", eventName: "dblclick" },
  }), true);
  assert.deepEqual(actions, [{ type: "voice.joinChannel", args: { channelId: "channel-1" } }]);
  session.close();
});

test("runtime host actions reject initial effects, typing events, and permissions absent from the manifest", async () => {
  const initialActions: unknown[] = [];
  const initial = createSkinRuntimePluginSession({
    plugin: joinPlugin,
    createRun: () => ({ result: Promise.resolve({ uiOutput: joinOutput(true) }), close: () => undefined }),
    onAction: (action) => { initialActions.push(action); },
  });
  assert.equal(await initial.start(), false);
  assert.deepEqual(initialActions, []);

  const noJoinPermission = parseSkinRuntimePluginDocument({
    schemaVersion: 1,
    plugins: [{ ...joinPlugin, id: "voice-readonly", entry: "plugins/voice-readonly/index.wasm", permissions: ["ui.surface.replace"] }],
  }).plugins[0];
  const deniedActions: unknown[] = [];
  const denied = createSkinRuntimePluginSession({
    plugin: noJoinPermission,
    createRun: (input) => ({ result: Promise.resolve({ uiOutput: joinOutput(Boolean(input.event), "dblclick") }), close: () => undefined }),
    onAction: (action) => { deniedActions.push(action); },
  });
  assert.equal(await denied.start(), true);
  assert.equal(await denied.dispatch({
    schemaVersion: 1,
    state: {},
    event: { componentId: "voice-ui", handlerId: "join", eventName: "dblclick" },
  }), false);
  assert.deepEqual(deniedActions, []);
  denied.close();
});
