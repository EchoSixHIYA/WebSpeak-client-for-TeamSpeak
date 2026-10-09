import assert from "node:assert/strict";
import test from "node:test";
import "./skin-runtime-plugin-session.test.js";
import {
  computeSkinRuntimePluginDigest,
  createSkinRuntimePluginApproval,
} from "../../../src/shared/skin-runtime-plugin-approval.js";
import { parseSkinRuntimePluginDocument } from "../../../src/shared/skin-runtime-plugins.js";
import { createSkinExtensionWasmPrefixByteImmediateProbe } from "../../test/skin-extension-wasm-fixture.js";
import {
  createSkinRuntimePluginWasmSandboxPrototype,
  SkinRuntimePluginWasmError,
} from "./skin-runtime-plugin-wasm.js";

const plugin = parseSkinRuntimePluginDocument({
  schemaVersion: 1,
  plugins: [{
    id: "bounded-widget",
    name: "Bounded widget",
    version: "1.0.0",
    apiVersion: 1,
    runtime: "wasm",
    page: "voice",
    mode: "widget",
    entry: "plugins/bounded-widget/index.wasm",
    assets: [],
    permissions: [],
  }],
}).plugins[0];

async function approvedFiles(source = createSkinExtensionWasmPrefixByteImmediateProbe()) {
  const files = { [plugin.entry]: new Blob([source]) };
  const digest = await computeSkinRuntimePluginDigest(plugin, files);
  return { files, digest, approval: createSkinRuntimePluginApproval("community.sample", "2.0.0", plugin, digest) };
}

test("Wasm plugin startup rechecks the exact digest approval before creating a Worker", async () => {
  const { files, approval } = await approvedFiles();
  const staleApproval = { ...approval, digest: "0".repeat(64) };
  await assert.rejects(createSkinRuntimePluginWasmSandboxPrototype({
    skinId: "community.sample",
    skinVersion: "2.0.0",
    plugin,
    approval: staleApproval,
    files,
    readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
    prototypeOnly: true,
  }), (error: unknown) => error instanceof SkinRuntimePluginWasmError && error.code === "SKIN_EXTENSION_WASM_APPROVAL_INVALID");
});

test("Wasm prototype refuses v4 capabilities it does not implement", async () => {
  const channelPlugin = parseSkinRuntimePluginDocument({
    schemaVersion: 1,
    plugins: [{ ...plugin, permissions: ["session.channels.read"] }],
  }).plugins[0];
  const files = { [channelPlugin.entry]: new Blob([createSkinExtensionWasmPrefixByteImmediateProbe()]) };
  const digest = await computeSkinRuntimePluginDigest(channelPlugin, files);
  const approval = createSkinRuntimePluginApproval("community.sample", "2.0.0", channelPlugin, digest);
  await assert.rejects(createSkinRuntimePluginWasmSandboxPrototype({
    skinId: "community.sample",
    skinVersion: "2.0.0",
    plugin: channelPlugin,
    approval,
    files,
    readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
    prototypeOnly: true,
  }), (error: unknown) => error instanceof SkinRuntimePluginWasmError
    && error.code === "SKIN_EXTENSION_WASM_PERMISSION_UNSUPPORTED");
});

test("approved Wasm entries run as disposable workers with bounded interpreter output", async () => {
  const { files, approval } = await approvedFiles();
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let terminated = 0;
  class FakeWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(): void {
      queueMicrotask(() => {
        this.onmessage?.({ data: { type: "running" } } as MessageEvent<unknown>);
        this.onmessage?.({ data: {
          type: "complete", result: 7, linearMemoryBytes: 65_536, statusReadCount: 0, uiInputReadCount: 0, uiOutput: null,
        } } as MessageEvent<unknown>);
      });
    }
    terminate(): void { terminated += 1; }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  try {
    const handle = await createSkinRuntimePluginWasmSandboxPrototype({
      skinId: "community.sample",
      skinVersion: "2.0.0",
      plugin,
      approval,
      files,
      readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
      prototypeOnly: true,
    });
    assert.deepEqual(await handle.result, {
      result: 7,
      linearMemoryBytes: 65_536,
      statusReadCount: 0,
      uiInputReadCount: 0,
      uiOutput: null,
    });
    assert.equal(handle.closeReason, "completed");
    assert.equal(terminated, 1);
  } finally {
    if (previousWorker) Object.defineProperty(globalThis, "Worker", previousWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
