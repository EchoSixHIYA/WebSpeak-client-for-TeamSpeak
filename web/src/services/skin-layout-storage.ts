import {
  getSkinLayoutComponent,
  parseSkinLayoutJson,
  validateSkinLayout,
  type SkinLayoutDocument,
  type SkinLayoutPage,
  type SkinLayoutPlacement,
  type SkinLayoutProfile,
} from "../../../src/shared/skin-layout.js";

export const SKIN_LAYOUT_STORAGE_KEY = "webspeak:skin-layouts:v2";
export const LEGACY_SKIN_LAYOUT_STORAGE_KEY = "webspeak:skin-layouts:v1";
const MAX_STORAGE_BYTES = 1024 * 1024;
const MAX_RECOVERY_BYTES = 128 * 1024;

interface SkinLayoutCollection {
  schemaVersion: 2;
  skins: Record<string, SkinLayoutDocument>;
  recoveries: Record<string, SkinLayoutMigrationRecovery>;
}

export interface SkinLayoutMigrationRecovery {
  sourceVersion: number;
  items: Array<{ page: string; profile: string; componentId: string; placement: unknown }>;
  omittedCount: number;
  backupKey: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function emptyDocument(): SkinLayoutDocument {
  return { schemaVersion: 1, pages: {} };
}

function emptyCollection(): SkinLayoutCollection {
  return { schemaVersion: 2, skins: {}, recoveries: {} };
}

function isSkinId(value: string): boolean {
  return value.length <= 80 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);
}

function getBrowserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function parseCollection(source: string | null): SkinLayoutCollection {
  if (!source) return emptyCollection();
  if (new TextEncoder().encode(source).byteLength > MAX_STORAGE_BYTES) throw new Error("Saved skin layouts exceed the local storage limit.");
  let raw: unknown;
  try { raw = JSON.parse(source); }
  catch { throw new Error("Saved skin layouts are not valid JSON."); }
  if (!isRecord(raw) || raw.schemaVersion !== 2 || !isRecord(raw.skins) || !isRecord(raw.recoveries)) {
    throw new Error("Saved skin layouts use an unsupported storage version.");
  }
  const skins: Record<string, SkinLayoutDocument> = {};
  for (const [id, layout] of Object.entries(raw.skins)) {
    if (!isSkinId(id)) throw new Error("Saved skin layouts contain an invalid skin ID.");
    skins[id] = validateSkinLayout(layout);
  }
  const recoveries: Record<string, SkinLayoutMigrationRecovery> = {};
  for (const [id, recovery] of Object.entries(raw.recoveries)) {
    if (!isSkinId(id) || !isRecord(recovery) || !Array.isArray(recovery.items)
      || typeof recovery.sourceVersion !== "number" || !Number.isInteger(recovery.sourceVersion)
      || typeof recovery.omittedCount !== "number" || !Number.isInteger(recovery.omittedCount)
      || recovery.items.length > 1024) throw new Error("Saved skin layout recovery data is invalid.");
    recoveries[id] = {
      sourceVersion: recovery.sourceVersion,
      items: recovery.items.filter(isRecord).map((item) => ({
        page: typeof item.page === "string" ? item.page.slice(0, 80) : "",
        profile: typeof item.profile === "string" ? item.profile.slice(0, 20) : "",
        componentId: typeof item.componentId === "string" ? item.componentId.slice(0, 320) : "",
        placement: item.placement,
      })),
      omittedCount: Math.max(0, recovery.omittedCount),
      backupKey: LEGACY_SKIN_LAYOUT_STORAGE_KEY,
    };
  }
  return { schemaVersion: 2, skins, recoveries };
}

function recoverLegacyLayout(layout: unknown): { layout: SkinLayoutDocument; items: SkinLayoutMigrationRecovery["items"] } {
  const items: SkinLayoutMigrationRecovery["items"] = [];
  const pages: SkinLayoutDocument["pages"] = {};
  const remember = (page: string, profile: string, componentId: string, placement: unknown) => {
    if (items.length < 1024) items.push({ page: page.slice(0, 80), profile: profile.slice(0, 20), componentId: componentId.slice(0, 320), placement });
  };
  if (!isRecord(layout) || layout.schemaVersion !== 1 || !isRecord(layout.pages)) {
    remember("", "", "__document__", layout);
    return { layout: emptyDocument(), items };
  }
  for (const [pageKey, rawPage] of Object.entries(layout.pages)) {
    if (!(pageKey === "home" || pageKey === "voice" || pageKey === "demo") || !isRecord(rawPage)) {
      remember(pageKey, "", "__page__", rawPage);
      continue;
    }
    const profiles: NonNullable<SkinLayoutDocument["pages"][SkinLayoutPage]> = {};
    for (const [profileKey, rawProfile] of Object.entries(rawPage)) {
      if (!(profileKey === "desktop" || profileKey === "tablet" || profileKey === "mobile") || !isRecord(rawProfile)) {
        remember(pageKey, profileKey, "__profile__", rawProfile);
        continue;
      }
      const placements: Record<string, SkinLayoutPlacement> = {};
      for (const [id, placement] of Object.entries(rawProfile)) {
        const component = getSkinLayoutComponent(id, pageKey);
        try {
          if (!component?.editable) throw new Error("Component no longer exists or is not editable.");
          const verified = validateSkinLayout({ schemaVersion: 1, pages: { [pageKey]: { [profileKey]: { [id]: placement } } } });
          const normalized = verified.pages[pageKey]?.[profileKey]?.[id];
          if (!normalized) throw new Error("Placement could not be migrated.");
          placements[id] = normalized;
        } catch {
          remember(pageKey, profileKey, id, placement);
        }
      }
      if (Object.keys(placements).length) profiles[profileKey] = placements;
    }
    if (Object.keys(profiles).length) pages[pageKey] = profiles;
  }
  return { layout: validateSkinLayout({ schemaVersion: 1, pages }), items };
}

function migrateLegacyCollection(source: string): SkinLayoutCollection {
  if (new TextEncoder().encode(source).byteLength > MAX_STORAGE_BYTES) throw new Error("Legacy skin layouts exceed the local storage limit.");
  let raw: unknown;
  try { raw = JSON.parse(source); }
  catch { throw new Error("Legacy skin layouts are not valid JSON."); }
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.skins)) {
    throw new Error("Legacy skin layouts use an unsupported storage version.");
  }
  const collection = emptyCollection();
  for (const [id, storedLayout] of Object.entries(raw.skins)) {
    if (!isSkinId(id)) continue;
    const recovered = recoverLegacyLayout(storedLayout);
    collection.skins[id] = recovered.layout;
    if (recovered.items.length) {
      const recovery: SkinLayoutMigrationRecovery = {
        sourceVersion: 1,
        items: [],
        omittedCount: recovered.items.length,
        backupKey: LEGACY_SKIN_LAYOUT_STORAGE_KEY,
      };
      for (const item of recovered.items) {
        recovery.items.push(item);
        recovery.omittedCount -= 1;
        if (serializedBytes(recovery) > MAX_RECOVERY_BYTES) {
          recovery.items.pop();
          recovery.omittedCount += 1;
          break;
        }
      }
      collection.recoveries[id] = recovery;
    }
  }
  return collection;
}

function readCollection(storage: StorageLike): SkinLayoutCollection {
  const current = storage.getItem(SKIN_LAYOUT_STORAGE_KEY);
  if (current !== null) return parseCollection(current);
  const legacy = storage.getItem(LEGACY_SKIN_LAYOUT_STORAGE_KEY);
  if (legacy === null) return emptyCollection();
  const migrated = migrateLegacyCollection(legacy);
  try { storage.setItem(SKIN_LAYOUT_STORAGE_KEY, JSON.stringify(migrated)); }
  catch { /* Keep the legacy key untouched and allow this page to use the migrated copy in memory. */ }
  return migrated;
}

export function loadSkinLayoutOverrides(skinId: string): SkinLayoutDocument {
  if (!isSkinId(skinId)) return emptyDocument();
  const storage = getBrowserStorage();
  if (!storage) return emptyDocument();
  try { return readCollection(storage).skins[skinId] ?? emptyDocument(); }
  catch { return emptyDocument(); }
}

export function getSkinLayoutMigrationRecovery(skinId: string): SkinLayoutMigrationRecovery | null {
  if (!isSkinId(skinId)) return null;
  const storage = getBrowserStorage();
  if (!storage) return null;
  try { return readCollection(storage).recoveries[skinId] ?? null; }
  catch { return null; }
}

export function exportSkinLayoutMigrationRecovery(skinId: string): string {
  const recovery = getSkinLayoutMigrationRecovery(skinId);
  if (!recovery) throw new Error("There is no recovered legacy layout data.");
  return JSON.stringify({ schemaVersion: 1, skinId, ...recovery }, null, 2);
}

export function saveSkinLayoutOverrides(skinId: string, layout: SkinLayoutDocument): void {
  if (!isSkinId(skinId)) throw new Error("Skin ID is invalid.");
  const validated = validateSkinLayout(layout);
  const storage = getBrowserStorage();
  if (!storage) throw new Error("Local browser storage is unavailable.");
  let collection: SkinLayoutCollection;
  try { collection = readCollection(storage); }
  catch { throw new Error("Local browser storage could not be read."); }
  collection.skins[skinId] = validated;
  const serialized = JSON.stringify(collection);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STORAGE_BYTES) throw new Error("Saved skin layouts exceed the local storage limit.");
  try { storage.setItem(SKIN_LAYOUT_STORAGE_KEY, serialized); }
  catch { throw new Error("Local browser storage could not be written."); }
}

export function updateSkinLayoutOverride(
  skinId: string,
  page: SkinLayoutPage,
  profile: SkinLayoutProfile,
  componentId: string,
  placement: SkinLayoutPlacement | null,
): SkinLayoutDocument {
  const component = getSkinLayoutComponent(componentId, page);
  if (!component?.editable) throw new Error("This skin component cannot be customized.");
  const layout = loadSkinLayoutOverrides(skinId);
  const pages = { ...layout.pages };
  const pageLayout = { ...(pages[page] ?? {}) };
  const profileLayout = { ...(pageLayout[profile] ?? {}) };
  if (placement === null || Object.keys(placement).length === 0) delete profileLayout[componentId];
  else profileLayout[componentId] = placement;
  if (Object.keys(profileLayout).length) pageLayout[profile] = profileLayout;
  else delete pageLayout[profile];
  if (Object.keys(pageLayout).length) pages[page] = pageLayout;
  else delete pages[page];
  const validated = validateSkinLayout({ schemaVersion: 1, pages });
  saveSkinLayoutOverrides(skinId, validated);
  return validated;
}

export function clearSkinLayoutOverrides(skinId: string): void {
  if (!isSkinId(skinId)) return;
  const storage = getBrowserStorage();
  if (!storage) throw new Error("Local browser storage is unavailable.");
  let collection: SkinLayoutCollection;
  try { collection = readCollection(storage); }
  catch { throw new Error("Local browser storage could not be read."); }
  delete collection.skins[skinId];
  delete collection.recoveries[skinId];
  const serialized = JSON.stringify(collection);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STORAGE_BYTES) throw new Error("Saved skin layouts exceed the local storage limit.");
  try { storage.setItem(SKIN_LAYOUT_STORAGE_KEY, serialized); }
  catch { throw new Error("Local browser storage could not be written."); }
}

export function exportSkinLayout(layout: SkinLayoutDocument): string {
  return JSON.stringify(validateSkinLayout(layout), null, 2);
}

export function importSkinLayout(source: string): SkinLayoutDocument {
  return parseSkinLayoutJson(source);
}
