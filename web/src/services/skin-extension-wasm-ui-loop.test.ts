import assert from "node:assert/strict";
import test from "node:test";
import {
  createSkinExtensionWasmUiLoopPrototype,
  SKIN_EXTENSION_WASM_UI_EVENT_QUEUE_LIMIT,
} from "./skin-extension-wasm-ui-loop.js";
import type { SkinExtensionUiInput } from "../../../src/shared/skin-extension-ui-input.js";

function uiOutput(count: number, handlerId = "increment"): string {
  return JSON.stringify({
    schemaVersion: 5,
    components: [{
      id: "counter",
      name: "Counter",
      page: "voice",
      accessibleName: "Local counter",
      state: { count },
      root: { tag: "button", events: { click: handlerId }, children: [{ text: String(count) }] },
    }],
  });
}

function clickInput(count: number, handlerId = "increment"): unknown {
  return {
    schemaVersion: 1,
    state: { count },
    event: { componentId: "counter", handlerId, eventName: "click" },
  };
}

test("Wasm UI callback reruns receive only declared component state and replace validated output", async () => {
  const jobs: SkinExtensionUiInput[] = [];
  const outputDocuments: string[] = [];
  const loop = createSkinExtensionWasmUiLoopPrototype({
    createRun(input) {
      jobs.push(input);
      const count = input.event ? Number(input.state.count) + 1 : 0;
      return { result: Promise.resolve({ uiOutput: uiOutput(count) }), close: () => undefined };
    },
    onOutput(output) { outputDocuments.push(output); },
  });

  assert.equal(await loop.start(), true);
  assert.equal(loop.output, uiOutput(0));
  assert.equal(await loop.dispatch(clickInput(0)), true);
  assert.equal(loop.output, uiOutput(1));
  assert.deepEqual(jobs.map((job) => job.event), [null, { componentId: "counter", handlerId: "increment", eventName: "click" }]);
  assert.deepEqual({ ...jobs[1].state }, { count: 0 });
  assert.equal(outputDocuments.length, 2);
  assert.equal(await loop.dispatch(clickInput(1, "not-a-real-handler")), false);
  assert.equal(await loop.dispatch({
    schemaVersion: 1,
    state: { count: 1, injected: "value" },
    event: { componentId: "counter", handlerId: "increment", eventName: "click" },
  }), false);
  assert.equal(jobs.length, 2, "invalid or stale callbacks must not start a Wasm job");
  loop.close();
});

test("runtime data refresh reruns the guest without fabricating a user event", async () => {
  const jobs: SkinExtensionUiInput[] = [];
  const loop = createSkinExtensionWasmUiLoopPrototype({
    createRun(input) {
      jobs.push(input);
      const count = input.event ? Number(input.state.count) + 1 : Number(input.state.count ?? 0);
      return { result: Promise.resolve({ uiOutput: uiOutput(count) }), close: () => undefined };
    },
  });

  assert.equal(await loop.start(), true);
  assert.equal(await loop.dispatch(clickInput(3)), true);
  assert.equal(await loop.refresh(), true);
  assert.equal(jobs.length, 3);
  assert.equal(jobs[2].event, null);
  assert.deepEqual({ ...jobs[2].state }, { count: 3 });
  loop.close();
});

test("host-rejected UI output does not replace the callback document", async () => {
  const jobs: SkinExtensionUiInput[] = [];
  const rejectedOutput = uiOutput(1, "unaccepted");
  const loop = createSkinExtensionWasmUiLoopPrototype({
    createRun(input) {
      jobs.push(input);
      return {
        result: Promise.resolve({ uiOutput: input.event ? rejectedOutput : uiOutput(0) }),
        close: () => undefined,
      };
    },
    onOutput(output) {
      if (output === rejectedOutput) throw new Error("Host rejected the generated document.");
    },
  });

  assert.equal(await loop.start(), true);
  assert.equal(await loop.dispatch(clickInput(0)), false);
  assert.equal(loop.output, uiOutput(0));
  assert.equal(await loop.dispatch(clickInput(1, "unaccepted")), false);
  assert.equal(jobs.length, 2, "callbacks from a host-rejected document must not be accepted");
  loop.close();
});

test("Wasm UI callback queue is bounded and close cancels active and waiting work", async () => {
  let rejectActive!: (error: Error) => void;
  let held = false;
  const loop = createSkinExtensionWasmUiLoopPrototype({
    createRun(input) {
      if (input.event && !held) {
        held = true;
        const result = new Promise<{ uiOutput: string | null }>((_resolve, reject) => { rejectActive = reject; });
        return { result, close: () => rejectActive(new Error("closed")) };
      }
      return { result: Promise.resolve({ uiOutput: uiOutput(0) }), close: () => undefined };
    },
  });

  assert.equal(await loop.start(), true);
  const active = loop.dispatch(clickInput(0));
  const pending = Array.from({ length: SKIN_EXTENSION_WASM_UI_EVENT_QUEUE_LIMIT }, () => loop.dispatch(clickInput(0)));
  assert.equal(loop.pendingEventCount, SKIN_EXTENSION_WASM_UI_EVENT_QUEUE_LIMIT);
  assert.equal(await loop.dispatch(clickInput(0)), false);

  loop.close("skin-unmounted");
  assert.equal(await active, false);
  assert.deepEqual(await Promise.all(pending), Array(SKIN_EXTENSION_WASM_UI_EVENT_QUEUE_LIMIT).fill(false));
  assert.equal(loop.pendingEventCount, 0);
  assert.equal(loop.closed, true);
});
