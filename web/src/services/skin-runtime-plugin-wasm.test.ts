import assert from "node:assert/strict";
import test from "node:test";
import "./skin-runtime-plugin-session.test.js";
import "./skin-runtime-plugin-wasm-governor.test.js";
import {
  computeSkinRuntimePluginDigest,
  createSkinRuntimePluginApproval,
} from "../../../src/shared/skin-runtime-plugin-approval.js";
import { parseSkinRuntimePluginDocument } from "../../../src/shared/skin-runtime-plugins.js";
import { createSkinExtensionWasmPrefixByteImmediateProbe } from "../../test/skin-extension-wasm-fixture.js";
import {
  createSkinRuntimePluginWasmSandbox,
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
  await assert.rejects(createSkinRuntimePluginWasmSandbox({
    skinId: "community.sample",
    skinVersion: "2.0.0",
    plugin,
    approval: staleApproval,
    files,
    readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
  }), (error: unknown) => error instanceof SkinRuntimePluginWasmError && error.code === "SKIN_EXTENSION_WASM_APPROVAL_INVALID");
});

test("Wasm prototype accepts a host-mediated channel join permission", async () => {
  const writePlugin = parseSkinRuntimePluginDocument({
    schemaVersion: 1,
    plugins: [{ ...plugin, permissions: ["session.channel.join"] }],
  }).plugins[0];
  const files = { [writePlugin.entry]: new Blob([createSkinExtensionWasmPrefixByteImmediateProbe()]) };
  const digest = await computeSkinRuntimePluginDigest(writePlugin, files);
  const approval = createSkinRuntimePluginApproval("community.sample", "2.0.0", writePlugin, digest);
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  class FakeWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(): void {
      queueMicrotask(() => {
        this.onmessage?.({ data: { type: "running" } } as MessageEvent<unknown>);
        this.onmessage?.({ data: {
          type: "complete", result: 1, linearMemoryBytes: 65_536, statusReadCount: 0, uiInputReadCount: 0, uiOutput: null,
        } } as MessageEvent<unknown>);
      });
    }
    terminate(): void { /* The test worker has no external resources. */ }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  try {
    const handle = await createSkinRuntimePluginWasmSandbox({
      skinId: "community.sample",
      skinVersion: "2.0.0",
      plugin: writePlugin,
      approval,
      files,
      readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
    });
    assert.equal((await handle.result).uiOutput, null);
  } finally {
    if (previousWorker) Object.defineProperty(globalThis, "Worker", previousWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("approved read permissions project only their public fields into each Wasm job", async () => {
  const readPlugin = parseSkinRuntimePluginDocument({
    schemaVersion: 1,
    plugins: [{ ...plugin, permissions: ["session.channels.read"] }],
  }).plugins[0];
  const files = { [readPlugin.entry]: new Blob([createSkinExtensionWasmPrefixByteImmediateProbe()]) };
  const digest = await computeSkinRuntimePluginDigest(readPlugin, files);
  const approval = createSkinRuntimePluginApproval("community.sample", "2.0.0", readPlugin, digest);
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let inputJson = "";
  class FakeWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: unknown): void {
      if (message && typeof message === "object" && "input" in message && typeof message.input === "string") inputJson = message.input;
      queueMicrotask(() => {
        this.onmessage?.({ data: { type: "running" } } as MessageEvent<unknown>);
        this.onmessage?.({ data: {
          type: "complete", result: 1, linearMemoryBytes: 65_536, statusReadCount: 0, uiInputReadCount: 0, uiOutput: null,
        } } as MessageEvent<unknown>);
      });
    }
    terminate(): void { /* The test worker has no external resources. */ }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  try {
    const handle = await createSkinRuntimePluginWasmSandbox({
      skinId: "community.sample",
      skinVersion: "2.0.0",
      plugin: readPlugin,
      approval,
      files,
      context: {
        session: {
          status: { connected: true, serverLabel: "private.example:9987" },
          channels: [{ id: "lobby", name: "Lobby", depth: 0, memberCount: 1, current: true, address: "voice.internal.example:9987" }],
        },
        favorites: { items: [{ id: "favorite-1", label: "Saved", address: "another-private.example:9987" }] },
      },
      readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
    });
    await handle.result;
    const parsedInput = JSON.parse(inputJson) as { data: unknown };
    assert.deepEqual(JSON.parse(JSON.stringify(parsedInput.data)), {
      session: { channels: [{ id: "lobby", name: "Lobby", depth: 0, memberCount: 1, current: true }] },
    });
    assert.equal(inputJson.includes("private.example"), false);
    assert.equal(inputJson.includes("voice.internal.example"), false);
    assert.equal(inputJson.includes("favorite-1"), false);
  } finally {
    if (previousWorker) Object.defineProperty(globalThis, "Worker", previousWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
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
    const handle = await createSkinRuntimePluginWasmSandbox({
      skinId: "community.sample",
      skinVersion: "2.0.0",
      plugin,
      approval,
      files,
      readSessionStatus: () => ({ connected: false, channelName: null, memberCount: 0 }),
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
