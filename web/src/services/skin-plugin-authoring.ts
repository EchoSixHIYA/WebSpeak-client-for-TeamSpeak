import { parseSkinPluginJson, type SkinPluginDocument } from "../../../src/shared/skin-plugin.js";
import { assertSkinPluginAuthoringDocument, editableSkinPluginDocument } from "../../../src/shared/skin-plugin-editor.js";

export const SKIN_PLUGIN_AUTHORING_STORAGE_KEY = "webspeak:skin-plugin-authoring:v1";
const MAX_DOCUMENT_BYTES = 256 * 1024;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

export function getSkinPluginAuthoringStorageKey(skinId: string, skinVersion: string): string {
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,78}[a-z0-9])?$/.test(skinId)
    || !skinVersion || skinVersion.length > 32 || !/^[A-Za-z0-9.+_-]+$/.test(skinVersion)) {
    throw new Error("Skin identity is invalid.");
  }
  return SKIN_PLUGIN_AUTHORING_STORAGE_KEY + ":" + skinId + "@" + skinVersion;
}

export function hasSkinPluginAuthoringDocument(skinId: string, skinVersion: string): boolean {
  let key: string;
  try { key = getSkinPluginAuthoringStorageKey(skinId, skinVersion); } catch { return false; }
  const storage = browserStorage();
  if (!storage) return false;
  try { return storage.getItem(key) !== null; } catch { return false; }
}

export function loadSkinPluginAuthoringDocument(skinId: string, skinVersion: string): SkinPluginDocument | null {
  let key: string;
  try { key = getSkinPluginAuthoringStorageKey(skinId, skinVersion); } catch { return null; }
  const storage = browserStorage();
  if (!storage) return null;
  let source: string | null;
  try { source = storage.getItem(key); } catch { return null; }
  if (!source) return null;
  if (new TextEncoder().encode(source).byteLength > MAX_DOCUMENT_BYTES) return null;
  try { return editableSkinPluginDocument(parseSkinPluginJson(source)); }
  catch { return null; }
}

export function saveSkinPluginAuthoringDocument(skinId: string, skinVersion: string, document: unknown): SkinPluginDocument {
  const key = getSkinPluginAuthoringStorageKey(skinId, skinVersion);
  const validated = assertSkinPluginAuthoringDocument(document);
  const serialized = JSON.stringify(validated);
  if (new TextEncoder().encode(serialized).byteLength > MAX_DOCUMENT_BYTES) throw new Error("Saved component edits exceed the 256 KiB document limit.");
  const storage = browserStorage();
  if (!storage) throw new Error("Local browser storage is unavailable.");
  try { storage.setItem(key, serialized); }
  catch { throw new Error("Local browser storage could not save the component edits."); }
  return validated;
}

export function clearSkinPluginAuthoringDocument(skinId: string, skinVersion: string): void {
  const key = getSkinPluginAuthoringStorageKey(skinId, skinVersion);
  const storage = browserStorage();
  if (!storage) throw new Error("Local browser storage is unavailable.");
  try { storage.removeItem(key); }
  catch { throw new Error("Local browser storage could not clear the component edits."); }
}

export function importSkinPluginAuthoringDocument(source: string): SkinPluginDocument {
  return assertSkinPluginAuthoringDocument(parseSkinPluginJson(source));
}

export function exportSkinPluginAuthoringDocument(document: unknown): string {
  const validated = assertSkinPluginAuthoringDocument(document);
  const readable = JSON.stringify(validated, null, 2);
  if (new TextEncoder().encode(readable).byteLength <= MAX_DOCUMENT_BYTES) return readable;
  const compact = JSON.stringify(validated);
  if (new TextEncoder().encode(compact).byteLength > MAX_DOCUMENT_BYTES) throw new Error("components.json exceeds the 256 KiB document limit.");
  return compact;
}
