import assert from "node:assert/strict";
import test from "node:test";
import {
  addSkinPluginComponent,
  addSkinPluginNode,
  addSkinPluginNodeSibling,
  duplicateSkinPluginNode,
  editableSkinPluginDocument,
  getSkinPluginNode,
  moveSkinPluginComponent,
  moveSkinPluginNode,
  removeSkinPluginComponent,
  removeSkinPluginNode,
  replaceSkinPluginNode,
} from "../../../src/shared/skin-plugin-editor.js";
import type { SkinPluginDocument } from "../../../src/shared/skin-plugin.js";
import {
  clearSkinPluginAuthoringDocument,
  exportSkinPluginAuthoringDocument,
  getSkinPluginAuthoringStorageKey,
  hasSkinPluginAuthoringDocument,
  importSkinPluginAuthoringDocument,
  loadSkinPluginAuthoringDocument,
  saveSkinPluginAuthoringDocument,
  SKIN_PLUGIN_AUTHORING_STORAGE_KEY,
} from "./skin-plugin-authoring.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
}

function withLocalStorage<T>(run: (storage: MemoryStorage) => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try { return run(storage); }
  finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function document(): SkinPluginDocument {
  return {
    schemaVersion: 3,
    components: [{
      id: "voice-panel",
      name: "Voice panel",
      page: "voice",
      accessibleName: "Voice panel",
      permissions: [],
      actions: {},
      root: { tag: "section", children: [{ tag: "p", children: [{ text: "Original" }] }, { tag: "button", attributes: { type: "button" } }] },
    }],
  };
}

test("component document editor supports add, update, reorder, delete, and an empty v3 document", () => {
  const source = document();
  const first = addSkinPluginNode(source, "voice-panel", [], { tag: "div", children: [{ text: "Added" }] });
  assert.equal(getSkinPluginNode(first, "voice-panel", [2]).tag, "div");
  assert.equal(source.components[0].root.children?.length, 2, "editing leaves the source tree unchanged");

  const second = addSkinPluginNodeSibling(first, "voice-panel", [2], { tag: "small", children: [{ text: "Sibling" }] });
  assert.equal(getSkinPluginNode(second, "voice-panel", [3]).tag, "small");
  const reordered = moveSkinPluginNode(second, "voice-panel", [3], -1);
  assert.equal(getSkinPluginNode(reordered, "voice-panel", [2]).tag, "small");

  const updated = replaceSkinPluginNode(reordered, "voice-panel", [2, 0], { text: "Changed" });
  assert.equal(getSkinPluginNode(updated, "voice-panel", [2, 0]).text, "Changed");
  const withoutNode = removeSkinPluginNode(updated, "voice-panel", [2]);
  assert.equal(withoutNode.components[0].root.children?.length, 3);
  const withSecondComponent = addSkinPluginComponent(withoutNode, {
    id: "extra-panel", name: "Extra panel", page: "voice", accessibleName: "Extra panel",
    permissions: [], actions: {}, root: { tag: "aside" },
  });
  assert.equal(withSecondComponent.components.length, 2);
  assert.equal(removeSkinPluginComponent(withSecondComponent, "voice-panel").components.length, 1);
  assert.deepEqual(removeSkinPluginComponent(withSecondComponent, "voice-panel").components.map(({ id }) => id), ["extra-panel"]);
  assert.deepEqual(removeSkinPluginComponent(document(), "voice-panel"), { schemaVersion: 3, components: [] });
});

test("component order is editable and stays within the selected skin document", () => {
  const source = addSkinPluginComponent(document(), {
    id: "second-panel", name: "Second panel", page: "voice", accessibleName: "Second panel",
    permissions: [], actions: {}, root: { tag: "aside" },
  });
  const moved = moveSkinPluginComponent(source, "voice-panel", 1);
  assert.deepEqual(moved.components.map((component) => component.id), ["second-panel", "voice-panel"]);
  assert.deepEqual(moveSkinPluginComponent(moved, "voice-panel", 1), moved, "moving past the end is a no-op");
  assert.deepEqual(source.components.map((component) => component.id), ["voice-panel", "second-panel"]);
});

test("duplicating a nested component node gives copied layout parts unique stable IDs", () => {
  const source = document();
  source.components[0].root.children![0] = {
    tag: "div", part: "message", children: [{ tag: "span", part: "author", text: "Author" }],
  };
  const copy = duplicateSkinPluginNode(source, "voice-panel", [0]);
  assert.equal(copy.part, "message-copy");
  assert.equal(copy.children?.[0].part, "author-copy");
  assert.throws(() => duplicateSkinPluginNode(source, "voice-panel", []), /root cannot be duplicated/i);
});

test("component editor rejects unsafe markup and invalid permission/action combinations", () => {
  assert.throws(() => addSkinPluginNode(document(), "voice-panel", [], { tag: "script" }), /unsupported HTML element/i);
  assert.throws(() => replaceSkinPluginNode(document(), "voice-panel", [0], {
    tag: "button", events: { click: "disconnect" },
  }), /refer to a declared host action/i);
  assert.throws(() => addSkinPluginComponent(document(), {
    id: "unsafe", name: "Unsafe", page: "voice", accessibleName: "Unsafe",
    permissions: [], actions: { disconnect: { type: "voice.disconnect", args: {} } },
    root: { tag: "button", events: { click: "disconnect" } },
  }), /requires voice.disconnect/i);
  assert.throws(() => removeSkinPluginNode(document(), "voice-panel", []), /root cannot be removed/i);
  assert.throws(() => moveSkinPluginNode(document(), "voice-panel", [1.5], -1), /no longer exists/i);
});

test("older package trees upgrade to editable schema v3 without losing their component", () => {
  const legacy = { ...document(), schemaVersion: 2 } as unknown as SkinPluginDocument;
  const editable = editableSkinPluginDocument(legacy);
  assert.equal(editable.schemaVersion, 3);
  assert.equal(editable.components[0].root.tag, "section");

  const legacyWithWidget = structuredClone(legacy);
  legacyWithWidget.components[0].permissions = [];
  legacyWithWidget.components[0].root = { tag: "section", children: [{ widget: "voice.audio-controls" }] };
  const migratedWidget = editableSkinPluginDocument(legacyWithWidget);
  assert.deepEqual(migratedWidget.components[0].permissions, ["audio.status.read", "audio.microphone.control", "audio.output.control"]);
});

test("component authoring saves are isolated by skin version and round-trip through export/import", () => {
  withLocalStorage((storage) => {
    const source = addSkinPluginNode(document(), "voice-panel", [], { tag: "strong", children: [{ text: "Local edit" }] });
    saveSkinPluginAuthoringDocument("community.example", "1.2.3", source);
    assert.notEqual(storage.getItem(getSkinPluginAuthoringStorageKey("community.example", "1.2.3")), null);
    assert.equal(storage.getItem(SKIN_PLUGIN_AUTHORING_STORAGE_KEY), null);
    assert.equal(hasSkinPluginAuthoringDocument("community.example", "1.2.3"), true);
    assert.equal(loadSkinPluginAuthoringDocument("community.example", "1.2.3")?.components[0].root.children?.length, 3);
    assert.equal(loadSkinPluginAuthoringDocument("community.example", "1.2.4"), null);
    const exported = exportSkinPluginAuthoringDocument(source);
    assert.deepEqual(importSkinPluginAuthoringDocument(exported), source);
    clearSkinPluginAuthoringDocument("community.example", "1.2.3");
    assert.equal(loadSkinPluginAuthoringDocument("community.example", "1.2.3"), null);
    assert.equal(hasSkinPluginAuthoringDocument("community.example", "1.2.3"), false);
    const empty = removeSkinPluginComponent(source, "voice-panel");
    saveSkinPluginAuthoringDocument("community.example", "1.2.3", empty);
    assert.deepEqual(loadSkinPluginAuthoringDocument("community.example", "1.2.3"), { schemaVersion: 3, components: [] });
    assert.deepEqual(importSkinPluginAuthoringDocument(exportSkinPluginAuthoringDocument(empty)), empty);

    const legacy = { ...document(), schemaVersion: 2 } as unknown as SkinPluginDocument;
    saveSkinPluginAuthoringDocument("community.example", "1.2.4", legacy);
    assert.equal(loadSkinPluginAuthoringDocument("community.example", "1.2.4")?.schemaVersion, 3);
  });
});

test("invalid component files and unsafe local edits are rejected before persistence", () => {
  withLocalStorage((storage) => {
    assert.throws(() => importSkinPluginAuthoringDocument(JSON.stringify({
      schemaVersion: 3,
      components: [{
        id: "broken", name: "Broken", page: "voice", accessibleName: "Broken",
        permissions: [], actions: {}, root: { tag: "iframe" },
      }],
    })));
    assert.throws(() => saveSkinPluginAuthoringDocument("community.example", "1", {
      schemaVersion: 3, components: [{ ...document().components[0], root: { tag: "script" } }],
    }));
    const reservedHook = document();
    reservedHook.components[0].root.children![0].attributes = { "data-ws-page": "admin" };
    assert.throws(() => saveSkinPluginAuthoringDocument("community.example", "1", reservedHook), /owned by WebSpeak/i);
    assert.equal(storage.getItem(getSkinPluginAuthoringStorageKey("community.example", "1")), null);
  });
});

test("a local-storage write failure preserves the last saved component document", () => {
  withLocalStorage((storage) => {
    const saved = document();
    saveSkinPluginAuthoringDocument("community.example", "1.2.3", saved);
    const key = getSkinPluginAuthoringStorageKey("community.example", "1.2.3");
    const rawBeforeFailure = storage.getItem(key);
    const changed = addSkinPluginNode(saved, "voice-panel", [], { text: "not committed" });
    storage.failWrites = true;
    assert.throws(() => saveSkinPluginAuthoringDocument("community.example", "1.2.3", changed), /could not save/i);
    assert.equal(storage.getItem(key), rawBeforeFailure);
    assert.deepEqual(loadSkinPluginAuthoringDocument("community.example", "1.2.3"), editableSkinPluginDocument(saved));
  });
});

test("corrupt authoring data stays isolated and can be cleared without touching another skin", () => {
  withLocalStorage((storage) => {
    const corruptKey = getSkinPluginAuthoringStorageKey("community.example", "1.0.0");
    saveSkinPluginAuthoringDocument("community.other", "1.0.0", document());
    storage.setItem(corruptKey, "not json");
    assert.equal(hasSkinPluginAuthoringDocument("community.example", "1.0.0"), true);
    assert.equal(loadSkinPluginAuthoringDocument("community.example", "1.0.0"), null);
    clearSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(hasSkinPluginAuthoringDocument("community.example", "1.0.0"), false);
    assert.equal(loadSkinPluginAuthoringDocument("community.other", "1.0.0")?.components[0].id, "voice-panel");
  });
});
