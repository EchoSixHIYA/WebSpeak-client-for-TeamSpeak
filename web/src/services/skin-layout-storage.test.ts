import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSkinLayoutOverrides,
  exportSkinLayoutMigrationRecovery,
  getSkinLayoutMigrationRecovery,
  LEGACY_SKIN_LAYOUT_STORAGE_KEY,
  loadSkinLayoutOverrides,
  saveSkinLayoutOverrides,
  SKIN_LAYOUT_STORAGE_KEY,
} from "./skin-layout-storage.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
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

test("legacy local layouts migrate matching entries and keep incompatible entries recoverable", () => {
  withLocalStorage((storage) => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      skins: {
        "community.illusia-voice": {
          schemaVersion: 1,
          pages: { home: { desktop: {
            "home.header": { x: 32 },
            "home.retired-component": { x: 80 },
            "home.security-note": { visible: false },
            "home.connect": { scale: 0.5 },
          } } },
        },
      },
    });
    storage.setItem(LEGACY_SKIN_LAYOUT_STORAGE_KEY, legacy);

    const migrated = loadSkinLayoutOverrides("community.illusia-voice");
    assert.deepEqual(migrated.pages.home?.desktop, { "home.header": { x: 32 } });
    assert.deepEqual(JSON.parse(storage.getItem(SKIN_LAYOUT_STORAGE_KEY) ?? "null").schemaVersion, 2);
    assert.equal(storage.getItem(LEGACY_SKIN_LAYOUT_STORAGE_KEY), legacy, "the source config remains intact as a backup");

    const recovery = getSkinLayoutMigrationRecovery("community.illusia-voice");
    assert.equal(recovery?.sourceVersion, 1);
    assert.equal(recovery?.items.length, 3);
    assert.equal(recovery?.omittedCount, 0);
    const exported = JSON.parse(exportSkinLayoutMigrationRecovery("community.illusia-voice"));
    assert.equal(exported.skinId, "community.illusia-voice");
    assert.equal(exported.items.length, 3);
  });
});

test("migration recovery preserves full runtime plugin layout identifiers", () => {
  withLocalStorage(() => {
    const componentId = `skin.voice.runtime_plugin_${"p".repeat(64)}__${"c".repeat(64)}.control-node-root-0`;
    const legacy = JSON.stringify({
      schemaVersion: 1,
      skins: {
        "community.illusia-voice": {
          schemaVersion: 1,
          pages: { voice: { desktop: { [componentId]: { width: 9000 } } } },
        },
      },
    });
    localStorage.setItem(LEGACY_SKIN_LAYOUT_STORAGE_KEY, legacy);

    loadSkinLayoutOverrides("community.illusia-voice");
    const recovery = getSkinLayoutMigrationRecovery("community.illusia-voice");
    assert.equal(recovery?.items[0]?.componentId, componentId);
  });
});

test("version 2 layout overrides can be saved, loaded, and cleared per skin", () => {
  withLocalStorage((storage) => {
    saveSkinLayoutOverrides("community.illusia-voice", {
      schemaVersion: 1,
      pages: { home: { mobile: { "home.header": { x: 8, visible: true, order: 2 } } } },
    });
    assert.equal(loadSkinLayoutOverrides("community.illusia-voice").pages.home?.mobile?.["home.header"]?.x, 8);
    assert.equal(loadSkinLayoutOverrides("community.illusia-voice").pages.home?.mobile?.["home.header"]?.order, 2);
    clearSkinLayoutOverrides("community.illusia-voice");
    assert.deepEqual(loadSkinLayoutOverrides("community.illusia-voice"), { schemaVersion: 1, pages: {} });
    assert.equal(JSON.parse(storage.getItem(SKIN_LAYOUT_STORAGE_KEY) ?? "null").schemaVersion, 2);
  });
});

test("an unknown newer local storage version is preserved instead of overwritten", () => {
  withLocalStorage((storage) => {
    const future = JSON.stringify({ schemaVersion: 99, skins: { "community.illusia-voice": { retained: true } } });
    storage.setItem(SKIN_LAYOUT_STORAGE_KEY, future);
    assert.throws(() => saveSkinLayoutOverrides("community.illusia-voice", { schemaVersion: 1, pages: {} }));
    assert.equal(storage.getItem(SKIN_LAYOUT_STORAGE_KEY), future);
  });
});
