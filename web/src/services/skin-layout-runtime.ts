import layoutRuntimeCss from "../skins/layout-runtime.css?inline";
import {
  canEditSkinLayoutComponent,
  getSkinLayoutComponentId,
  getSkinLayoutComponent,
  type SkinLayoutDocument,
  type SkinLayoutPage,
  type SkinLayoutPlacement,
  type SkinLayoutProfile,
} from "../../../src/shared/skin-layout.js";
import {
  clearSkinLayoutOverrides,
  loadSkinLayoutOverrides,
  saveSkinLayoutOverrides,
  updateSkinLayoutOverride,
} from "./skin-layout-storage.js";

const STYLE_ID = "webspeak-layout-runtime";
const MOBILE_QUERY = "(max-width: 740px)";
const TABLET_QUERY = "(min-width: 741px) and (max-width: 1100px)";

export interface ActiveSkinLayoutContext {
  root: HTMLElement;
  skinId: string;
  page: SkinLayoutPage;
  profile: SkinLayoutProfile;
}

let activePackageSkinId: string | null = null;
let activePackageLayout: SkinLayoutDocument | null = null;
let observer: MutationObserver | null = null;
let refreshFrame = 0;
let editorEnabled = false;
let selectedComponentId: string | null = null;
let previewComponentId: string | null = null;
let previewPlacement: SkinLayoutPlacement | null = null;
let previewScope = "";

function isLayoutPage(value: string | undefined): value is SkinLayoutPage {
  return value === "home" || value === "voice" || value === "demo";
}

function currentProfile(): SkinLayoutProfile {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(MOBILE_QUERY).matches) return "mobile";
  return window.matchMedia(TABLET_QUERY).matches ? "tablet" : "desktop";
}

function activeRoots(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  return [...document.querySelectorAll<HTMLElement>(".ws-skin-root[data-ws-page]")];
}

export function getActiveSkinLayoutContext(): ActiveSkinLayoutContext | null {
  const root = activeRoots()[0];
  if (!root || !isLayoutPage(root.dataset.wsPage)) return null;
  return {
    root,
    skinId: root.dataset.wsSkin || activePackageSkinId || "builtin.light",
    page: root.dataset.wsPage,
    profile: currentProfile(),
  };
}

function effectivePlacements(context: ActiveSkinLayoutContext): Record<string, SkinLayoutPlacement> {
  const packageEntries = activePackageSkinId === context.skinId
    ? activePackageLayout?.pages[context.page]?.[context.profile] ?? {}
    : {};
  const userEntries = loadSkinLayoutOverrides(context.skinId).pages[context.page]?.[context.profile] ?? {};
  const result: Record<string, SkinLayoutPlacement> = {};
  for (const [id, placement] of Object.entries(packageEntries)) result[id] = { ...placement };
  for (const [id, placement] of Object.entries(userEntries)) result[id] = { ...result[id], ...placement };
  const scope = context.skinId + ":" + context.page + ":" + context.profile;
  if (previewComponentId && previewPlacement && previewScope === scope) {
    result[previewComponentId] = { ...result[previewComponentId], ...previewPlacement };
  }
  return result;
}

function setVariable(element: HTMLElement, dataFlag: string, variable: string, value: string | undefined): void {
  if (value === undefined) {
    delete element.dataset[dataFlag];
    element.style.removeProperty(variable);
  } else {
    element.dataset[dataFlag] = "true";
    element.style.setProperty(variable, value);
  }
}

function clearLayoutAttributes(element: HTMLElement): void {
  for (const key of ["wsLayoutActive", "wsLayoutHidden", "wsLayoutSelected", "wsLayoutForeground", "wsLayoutBackground", "wsLayoutBorder", "wsLayoutRadius", "wsLayoutWidth", "wsLayoutHeight", "wsLayoutTouchTarget"]) {
    delete element.dataset[key];
  }
  for (const key of ["--ws-layout-x", "--ws-layout-y", "--ws-layout-scale", "--ws-layout-width", "--ws-layout-height", "--ws-layout-foreground", "--ws-layout-background", "--ws-layout-border", "--ws-layout-radius"]) {
    element.style.removeProperty(key);
  }
}

function componentId(element: HTMLElement): string | null {
  return getSkinLayoutComponentId(element.dataset.wsPart, element.dataset.wsControlKind);
}

function trustedAncestorIds(element: HTMLElement, root: HTMLElement): string[] {
  const ids: string[] = [];
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== root) {
    const id = componentId(ancestor);
    if (id) ids.push(id);
    ancestor = ancestor.parentElement;
  }
  return ids;
}

function applyRoot(root: HTMLElement): void {
  const pageValue = root.dataset.wsPage;
  if (!isLayoutPage(pageValue)) return;
  const skinId = root.dataset.wsSkin || activePackageSkinId || "builtin.light";
  const context: ActiveSkinLayoutContext = { root, skinId, page: pageValue, profile: currentProfile() };
  const placements = effectivePlacements(context);
  const nodes = [
    ...(root.matches("[data-ws-part]") ? [root] : []),
    ...root.querySelectorAll<HTMLElement>("[data-ws-part]"),
  ];
  for (const element of nodes) {
    const id = componentId(element);
    const component = id ? getSkinLayoutComponent(id, context.page) : undefined;
    if (!component || !canEditSkinLayoutComponent(id!, context.page, trustedAncestorIds(element, root))) {
      clearLayoutAttributes(element);
      continue;
    }
    const placement = placements[id!];
    if (!placement || !Object.keys(placement).length) {
      clearLayoutAttributes(element);
      // Registered touch controls keep their minimum hit area even before a
      // user applies a layout override; editing must never be required for safety.
      if (component.minTouchTarget) element.dataset.wsLayoutTouchTarget = String(component.minTouchTarget);
      continue;
    }
    element.dataset.wsLayoutActive = "true";
    if (component.minTouchTarget) element.dataset.wsLayoutTouchTarget = String(component.minTouchTarget);
    else delete element.dataset.wsLayoutTouchTarget;
    if (placement.visible === false) element.dataset.wsLayoutHidden = "true";
    else delete element.dataset.wsLayoutHidden;
    if (placement.x !== undefined) element.style.setProperty("--ws-layout-x", placement.x + "px");
    else element.style.removeProperty("--ws-layout-x");
    if (placement.y !== undefined) element.style.setProperty("--ws-layout-y", placement.y + "px");
    else element.style.removeProperty("--ws-layout-y");
    if (placement.scale !== undefined) element.style.setProperty("--ws-layout-scale", String(placement.scale));
    else element.style.removeProperty("--ws-layout-scale");
    setVariable(element, "wsLayoutWidth", "--ws-layout-width", placement.width === undefined ? undefined : placement.width + "px");
    setVariable(element, "wsLayoutHeight", "--ws-layout-height", placement.height === undefined ? undefined : placement.height + "px");
    setVariable(element, "wsLayoutForeground", "--ws-layout-foreground", placement.foreground);
    setVariable(element, "wsLayoutBackground", "--ws-layout-background", placement.background);
    setVariable(element, "wsLayoutBorder", "--ws-layout-border", placement.border);
    setVariable(element, "wsLayoutRadius", "--ws-layout-radius", placement.radius === undefined ? undefined : placement.radius + "px");
    if (editorEnabled && selectedComponentId === id) element.dataset.wsLayoutSelected = "true";
    else delete element.dataset.wsLayoutSelected;
  }
  root.dataset.wsLayoutEditing = editorEnabled ? "true" : "false";
}

export function refreshSkinLayout(): void {
  if (typeof document === "undefined") return;
  for (const root of activeRoots()) applyRoot(root);
}

function scheduleRefresh(): void {
  if (typeof window === "undefined" || refreshFrame) return;
  refreshFrame = window.requestAnimationFrame(() => {
    refreshFrame = 0;
    refreshSkinLayout();
  });
}

export function initializeSkinLayoutRuntime(): void {
  if (typeof document === "undefined") return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = layoutRuntimeCss;
    document.head.append(style);
  }
  if (!observer) {
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-ws-page", "data-ws-skin", "data-ws-part", "data-ws-control-kind"],
    });
    window.addEventListener("resize", scheduleRefresh, { passive: true });
  }
  scheduleRefresh();
}

export function setSkinLayoutPackage(skinId: string, layout: SkinLayoutDocument | null): void {
  activePackageSkinId = skinId;
  activePackageLayout = layout;
  previewComponentId = null;
  previewPlacement = null;
  previewScope = "";
  scheduleRefresh();
}

export function setSkinLayoutEditorState(enabled: boolean, selectedId: string | null = selectedComponentId): void {
  editorEnabled = enabled;
  selectedComponentId = enabled ? selectedId : null;
  scheduleRefresh();
}

export function getEffectiveSkinLayoutPlacement(componentIdValue: string): SkinLayoutPlacement | undefined {
  const context = getActiveSkinLayoutContext();
  if (!context || !getSkinLayoutComponent(componentIdValue, context.page)?.editable) return undefined;
  return effectivePlacements(context)[componentIdValue];
}

export function getActiveSkinLayoutOverride(componentIdValue: string): SkinLayoutPlacement | undefined {
  const context = getActiveSkinLayoutContext();
  if (!context || !getSkinLayoutComponent(componentIdValue, context.page)?.editable) return undefined;
  return loadSkinLayoutOverrides(context.skinId).pages[context.page]?.[context.profile]?.[componentIdValue];
}

export function previewActiveSkinLayoutPlacement(componentIdValue: string, placement: SkinLayoutPlacement | null): void {
  const context = getActiveSkinLayoutContext();
  previewComponentId = context && placement ? componentIdValue : null;
  previewPlacement = context ? placement : null;
  previewScope = context ? context.skinId + ":" + context.page + ":" + context.profile : "";
  scheduleRefresh();
}

export function saveActiveSkinLayoutPlacement(componentIdValue: string, placement: SkinLayoutPlacement | null): void {
  const context = getActiveSkinLayoutContext();
  if (!context) throw new Error("There is no active public skin layout.");
  previewComponentId = null;
  previewPlacement = null;
  previewScope = "";
  updateSkinLayoutOverride(context.skinId, context.page, context.profile, componentIdValue, placement);
  scheduleRefresh();
}

export function getActiveSkinLayoutOverrides(): SkinLayoutDocument {
  const context = getActiveSkinLayoutContext();
  return context ? loadSkinLayoutOverrides(context.skinId) : { schemaVersion: 1, pages: {} };
}

export function replaceActiveSkinLayoutOverrides(layout: SkinLayoutDocument): void {
  const context = getActiveSkinLayoutContext();
  if (!context) throw new Error("There is no active public skin layout.");
  saveSkinLayoutOverrides(context.skinId, layout);
  scheduleRefresh();
}

export function clearActiveSkinLayoutOverrides(): void {
  const context = getActiveSkinLayoutContext();
  if (!context) return;
  previewComponentId = null;
  previewPlacement = null;
  previewScope = "";
  clearSkinLayoutOverrides(context.skinId);
  scheduleRefresh();
}
