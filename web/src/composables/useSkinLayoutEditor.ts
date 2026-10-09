import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from "vue";
import {
  canEditSkinLayoutComponent,
  getSkinLayoutComponentId,
  getSkinLayoutComponent,
  getSkinLayoutComponents,
  type SkinLayoutDocument,
  type SkinLayoutPlacement,
} from "../../../src/shared/skin-layout.js";
import { analyzeSkinLayoutGeometry, clampSkinLayoutOffset, getSkinLayoutOffsetBounds } from "../services/skin-layout-geometry.js";
import type { SkinLayoutOffsetBounds } from "../services/skin-layout-geometry.js";
import { orderSequentialFocusTargets } from "../services/skin-layout-focus.js";
import { resolveSkinLayoutLanguage, skinLayoutLabels } from "../i18n/skin-layout.js";
import {
  clearActiveSkinLayoutOverrides,
  getActiveSkinLayoutContext,
  getActiveSkinLayoutOverride,
  getActiveSkinLayoutOverrides,
  getEffectiveSkinLayoutPlacement,
  initializeSkinLayoutRuntime,
  previewActiveSkinLayoutPlacement,
  refreshSkinLayout,
  replaceActiveSkinLayoutOverrides,
  saveActiveSkinLayoutPlacement,
  setSkinLayoutEditorState,
  type ActiveSkinLayoutContext,
} from "../services/skin-layout-runtime.js";
import {
  exportSkinLayout,
  exportSkinLayoutMigrationRecovery,
  getSkinLayoutMigrationRecovery,
  importSkinLayout,
} from "../services/skin-layout-storage.js";

interface DragState {
  pointerId: number;
  componentId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  placement: SkinLayoutPlacement;
  changed: boolean;
}

interface FocusPreviewTarget {
  key: string;
  tabIndex: number;
  componentName: string;
  accessibleName: string;
  left: number;
  top: number;
  width: number;
  height: number;
  meetsTouchTarget: boolean;
  order?: number;
}

function componentIdForElement(element: HTMLElement): string | null {
  return getSkinLayoutComponentId(element.dataset.wsPart, element.dataset.wsControlKind);
}

function dynamicPartsInRoot(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>("[data-ws-part^='skin.']")]
    .map((element) => element.dataset.wsPart ?? "");
}

export function useSkinLayoutEditor() {
  const isOpen = ref(false);
  const isEditing = ref(false);
  const canUndo = ref(false);
  const canRedo = ref(false);
  const focusPreviewEnabled = ref(false);
  const filter = ref("");
  const selectedComponentId = ref("");
  const statusMessage = ref("");
  const ignoredWarningKey = ref("");
  const context = shallowRef<ActiveSkinLayoutContext | null>(null);
  const revision = ref(0);
  let contextKey = "";
  let observer: MutationObserver | null = null;
  let drag: DragState | null = null;
  let viewportRefreshFrame = 0;
  let geometryRefreshFrame = 0;
  let geometryRefreshQueued = false;
  let history: SkinLayoutDocument[] = [];
  let historyIndex = -1;
  let lastHistoryChangeAt = 0;

  const labels = computed(() => skinLayoutLabels[context.value?.root.lang ? resolveSkinLayoutLanguage(context.value.root.lang) : "zh"]);
  const available = computed(() => Boolean(context.value));
  const components = computed(() => {
    revision.value;
    const active = context.value;
    return active ? getSkinLayoutComponents(active.page, dynamicPartsInRoot(active.root)).filter((component) => component.editable) : [];
  });
  const filteredComponents = computed(() => {
    const search = filter.value.trim().toLowerCase();
    return components.value.filter((component) => !search || component.id.toLowerCase().includes(search)
      || component.name.toLowerCase().includes(search));
  });
  const selectedPlacement = computed(() => {
    revision.value;
    return selectedComponentId.value ? getEffectiveSkinLayoutPlacement(selectedComponentId.value) ?? {} : {};
  });
  const selectedVisible = computed(() => selectedPlacement.value.visible !== false);
  const selectedScale = computed(() => selectedPlacement.value.scale ?? 1);
  const selectedWidth = computed(() => selectedPlacement.value.width ?? 320);
  const selectedHeight = computed(() => selectedPlacement.value.height ?? 160);
  const selectedX = computed(() => selectedPlacement.value.x ?? 0);
  const selectedY = computed(() => selectedPlacement.value.y ?? 0);
  const selectedForeground = computed(() => selectedPlacement.value.foreground ?? "#ffffff");
  const selectedBackground = computed(() => selectedPlacement.value.background ?? "#ffffff");
  const selectedBorder = computed(() => selectedPlacement.value.border ?? "#ffffff");
  const selectedRadius = computed(() => selectedPlacement.value.radius ?? 0);
  const selectedComponent = computed(() => context.value && selectedComponentId.value
    ? getSkinLayoutComponent(selectedComponentId.value, context.value.page) : undefined);
  const focusPreviewTargets = computed(() => {
    revision.value;
    const active = context.value;
    if (!active || !focusPreviewEnabled.value) return [];
    const candidates: FocusPreviewTarget[] = [];
    const selector = "a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]:not([contenteditable='false']), audio[controls], video[controls]";
    const focusable = [...active.root.querySelectorAll<HTMLElement>(selector)];
    const isVisibleFocusTarget = (element: HTMLElement) => {
      if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[hidden], [inert]")) return false;
      if (!element.getClientRects().length) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.visibility !== "collapse";
    };
    const radioGroups = new Map<object, Map<string, HTMLInputElement[]>>();
    for (const element of active.root.querySelectorAll<HTMLInputElement>('input[type="radio"][name]')) {
      const owner = element.form ?? element.getRootNode() as object;
      let groups = radioGroups.get(owner);
      if (!groups) radioGroups.set(owner, groups = new Map());
      const group = groups.get(element.name) ?? [];
      group.push(element);
      groups.set(element.name, group);
    }
    for (const element of focusable) {
      if (!isVisibleFocusTarget(element)) continue;
      if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
        const owner = element.form ?? element.getRootNode() as object;
        const group = radioGroups.get(owner)?.get(element.name) ?? [element];
        const activeRadio = group.find((radio) => radio.checked && isVisibleFocusTarget(radio))
          ?? group.find(isVisibleFocusTarget);
        if (activeRadio !== element) continue;
      }
      const owner = element.closest<HTMLElement>("[data-ws-part]");
      if (!owner || !active.root.contains(owner)) continue;
      const id = componentIdForElement(owner);
      const component = id ? getSkinLayoutComponent(id, active.page) : undefined;
      if (!id || !component || component.category === "trusted-chrome"
        || !canEditSkinLayoutComponent(id, active.page, ancestorComponentIds(owner, active.root))) continue;
      const rect = element.getBoundingClientRect();
      const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/)
        .map((labelId) => document.getElementById(labelId)?.textContent ?? "").filter(Boolean).join(" ");
      const nativeLabels = "labels" in element
        ? [...((element as HTMLInputElement).labels ?? [])].map((label) => label.textContent ?? "").join(" ") : "";
      const accessibleName = (labelledBy || element.getAttribute("aria-label") || nativeLabels
        || element.getAttribute("alt") || element.getAttribute("title") || element.getAttribute("placeholder")
        || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
      candidates.push({
        key: `${id}:${candidates.length}`,
        tabIndex: element.tabIndex,
        componentName: component.name,
        accessibleName,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        meetsTouchTarget: rect.width >= 44 && rect.height >= 44,
      });
    }
    return orderSequentialFocusTargets(candidates).map((target, index) => ({ ...target, order: index + 1 }));
  });
  const selectedSizeBounds = computed(() => selectedComponent.value ?? {
    minWidth: 44, maxWidth: 2400, minHeight: 44, maxHeight: 2400, minScale: 0.25, maxScale: 4,
  });
  const migrationRecovery = computed(() => {
    revision.value;
    return context.value ? getSkinLayoutMigrationRecovery(context.value.skinId) : null;
  });
  const migrationRecoveryCount = computed(() => migrationRecovery.value
    ? migrationRecovery.value.items.length + migrationRecovery.value.omittedCount : 0);
  function ancestorComponentIds(element: HTMLElement, root: HTMLElement): string[] {
    const ids: string[] = [];
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== root) {
      const id = componentIdForElement(ancestor);
      if (id) ids.push(id);
      ancestor = ancestor.parentElement;
    }
    return ids;
  }

  function componentTargets(active: ActiveSkinLayoutContext, id: string): HTMLElement[] {
    const component = getSkinLayoutComponent(id, active.page);
    if (!component) return [];
    return [...active.root.querySelectorAll<HTMLElement>(`[data-ws-part="${component.selectorPart}"]`)].filter((element) => {
      if (component.controlKind && element.dataset.wsControlKind !== component.controlKind) return false;
      if (!canEditSkinLayoutComponent(id, active.page, ancestorComponentIds(element, active.root))) return false;
      return Boolean(element.getClientRects().length) && element.dataset.wsLayoutHidden !== "true";
    });
  }

  function offsetBounds(axis: "x" | "y"): SkinLayoutOffsetBounds | null {
    const active = context.value;
    const id = selectedComponentId.value;
    if (!active || !id) return null;
    const targets = componentTargets(active, id).map((element) => element.getBoundingClientRect());
    if (!targets.length) return null;
    const currentOffset = selectedPlacement.value[axis] ?? 0;
    return getSkinLayoutOffsetBounds(targets, active.root.getBoundingClientRect(), currentOffset, axis)
      ?? { minimum: 0, maximum: 0 };
  }

  const positionBoundsX = computed(() => {
    revision.value;
    return offsetBounds("x") ?? { minimum: -2000, maximum: 2000 };
  });
  const positionBoundsY = computed(() => {
    revision.value;
    return offsetBounds("y") ?? { minimum: -2000, maximum: 2000 };
  });

  const detectedLayoutWarnings = computed(() => {
    revision.value;
    const active = context.value;
    const id = selectedComponentId.value;
    const placement = selectedPlacement.value;
    if (!active || !id || placement.visible === false
      || ![placement.x, placement.y, placement.width, placement.height, placement.scale].some((value) => value !== undefined)) return [];
    const targets = componentTargets(active, id);
    if (!targets.length) return [];
    const targetSet = new Set(targets);
    const peers = [...active.root.querySelectorAll<HTMLElement>("[data-ws-part]")].filter((peer) => {
      if (targetSet.has(peer) || !peer.getClientRects().length) return false;
      const peerId = componentIdForElement(peer);
      if (!peerId) return false;
      return targets.every((target) => !peer.contains(target) && !target.contains(peer));
    }).map((peer) => peer.getBoundingClientRect());
    const issues = analyzeSkinLayoutGeometry(
      targets.map((element) => element.getBoundingClientRect()),
      active.root.getBoundingClientRect(),
      peers,
    );
    const warnings: string[] = [];
    if (issues.overflow) warnings.push(labels.value.overflowWarning);
    if (issues.overlap) warnings.push(labels.value.overlapWarning);
    return warnings;
  });

  function currentWarningKey(): string {
    const active = context.value;
    return active ? [active.skinId, active.page, active.profile, selectedComponentId.value, JSON.stringify(selectedPlacement.value)].join(":") : "";
  }

  const layoutWarnings = computed(() => ignoredWarningKey.value === currentWarningKey() ? [] : detectedLayoutWarnings.value);

  function ignoreLayoutWarnings(): void {
    if (layoutWarnings.value.length) ignoredWarningKey.value = currentWarningKey();
  }

  function reviseLayout(): void {
    revision.value += 1;
    if (typeof window === "undefined" || geometryRefreshQueued) return;
    geometryRefreshQueued = true;
    void nextTick(() => {
      if (!geometryRefreshQueued) return;
      geometryRefreshFrame = window.requestAnimationFrame(() => {
        geometryRefreshFrame = 0;
        geometryRefreshQueued = false;
        revision.value += 1;
      });
    });
  }

  function syncContext(): void {
    const next = getActiveSkinLayoutContext();
    const key = next ? [next.skinId, next.page, next.profile, next.root.lang].join(":") : "";
    if (key === contextKey) return;
    contextKey = key;
    context.value = next;
    history = next ? [getActiveSkinLayoutOverrides()] : [];
    historyIndex = history.length ? 0 : -1;
    lastHistoryChangeAt = 0;
    updateHistoryControls();
    const first = next ? getSkinLayoutComponents(next.page, dynamicPartsInRoot(next.root)).find((component) => component.editable)?.id ?? "" : "";
    if (!next || !getSkinLayoutComponent(selectedComponentId.value, next.page)?.editable) selectedComponentId.value = first;
    reviseLayout();
    setSkinLayoutEditorState(isEditing.value, selectedComponentId.value || null);
  }

  function scheduleViewportRefresh(): void {
    if (viewportRefreshFrame) window.cancelAnimationFrame(viewportRefreshFrame);
    viewportRefreshFrame = window.requestAnimationFrame(() => {
      viewportRefreshFrame = 0;
      const previousRevision = revision.value;
      syncContext();
      if (revision.value === previousRevision) revision.value += 1;
    });
  }

  function selectComponent(id: string): void {
    if (!context.value || !getSkinLayoutComponent(id, context.value.page)?.editable) return;
    selectedComponentId.value = id;
    reviseLayout();
    setSkinLayoutEditorState(isEditing.value, id);
  }

  function setEditing(value: boolean): void {
    isEditing.value = value;
    setSkinLayoutEditorState(value, value ? selectedComponentId.value || null : null);
  }

  function setFocusPreview(value: boolean): void {
    focusPreviewEnabled.value = value;
    reviseLayout();
  }

  function setOpen(value: boolean): void {
    isOpen.value = value;
    statusMessage.value = "";
    if (!value) setEditing(false);
  }

  function updateSelected(field: keyof SkinLayoutPlacement, value: boolean | number | string): void {
    if (!selectedComponentId.value) return;
    ignoredWarningKey.value = "";
    const local = getActiveSkinLayoutOverride(selectedComponentId.value) ?? {};
    const next = { ...local, [field]: value } as SkinLayoutPlacement;
    try {
      saveActiveSkinLayoutPlacement(selectedComponentId.value, next);
      recordHistory();
      statusMessage.value = "";
    } catch {
      statusMessage.value = labels.value.saveFailed;
      return;
    }
    reviseLayout();
  }

  function setVisible(value: boolean): void { updateSelected("visible", value); }
  function setX(value: number): void { updateSelected("x", clampSkinLayoutOffset(value, offsetBounds("x") ?? { minimum: -2000, maximum: 2000 })); }
  function setY(value: number): void { updateSelected("y", clampSkinLayoutOffset(value, offsetBounds("y") ?? { minimum: -2000, maximum: 2000 })); }
  function setScale(value: number): void { updateSelected("scale", Math.max(selectedSizeBounds.value.minScale, Math.min(selectedSizeBounds.value.maxScale, value))); }
  function setWidth(value: number): void { updateSelected("width", Math.max(selectedSizeBounds.value.minWidth, Math.min(selectedSizeBounds.value.maxWidth, Math.round(value)))); }
  function setHeight(value: number): void { updateSelected("height", Math.max(selectedSizeBounds.value.minHeight, Math.min(selectedSizeBounds.value.maxHeight, Math.round(value)))); }
  function setForeground(value: string): void { updateSelected("foreground", value); }
  function setBackground(value: string): void { updateSelected("background", value); }
  function setBorder(value: string): void { updateSelected("border", value); }
  function setRadius(value: number): void { updateSelected("radius", Math.max(0, Math.min(64, value))); }

  function resetComponent(): void {
    if (!selectedComponentId.value) return;
    try {
      saveActiveSkinLayoutPlacement(selectedComponentId.value, null);
      recordHistory(true);
      statusMessage.value = "";
    } catch {
      statusMessage.value = labels.value.saveFailed;
      return;
    }
    reviseLayout();
  }

  function resetAll(): void {
    try {
      clearActiveSkinLayoutOverrides();
      statusMessage.value = "";
      recordHistory(true);
    } catch { statusMessage.value = labels.value.saveFailed; }
    reviseLayout();
  }

  function updateHistoryControls(): void {
    canUndo.value = historyIndex > 0;
    canRedo.value = historyIndex >= 0 && historyIndex < history.length - 1;
  }

  function copyLayout(layout: SkinLayoutDocument): SkinLayoutDocument {
    return JSON.parse(JSON.stringify(layout)) as SkinLayoutDocument;
  }

  function recordHistory(forceNew = false): void {
    if (!context.value) return;
    const next = copyLayout(getActiveSkinLayoutOverrides());
    const now = Date.now();
    if (historyIndex < 0) {
      history = [next];
      historyIndex = 0;
    } else {
      history = history.slice(0, historyIndex + 1);
      if (!forceNew && historyIndex > 0 && now - lastHistoryChangeAt < 500) history[historyIndex] = next;
      else {
        history.push(next);
        historyIndex += 1;
      }
      if (history.length > 50) {
        history.shift();
        historyIndex -= 1;
      }
    }
    lastHistoryChangeAt = now;
    updateHistoryControls();
  }

  function undo(): void {
    if (historyIndex <= 0) return;
    const targetIndex = historyIndex - 1;
    try {
      replaceActiveSkinLayoutOverrides(copyLayout(history[targetIndex]));
      historyIndex = targetIndex;
      lastHistoryChangeAt = 0;
      statusMessage.value = "";
      reviseLayout();
    } catch { statusMessage.value = labels.value.saveFailed; }
    updateHistoryControls();
  }

  function redo(): void {
    if (historyIndex < 0 || historyIndex >= history.length - 1) return;
    const targetIndex = historyIndex + 1;
    try {
      replaceActiveSkinLayoutOverrides(copyLayout(history[targetIndex]));
      historyIndex = targetIndex;
      lastHistoryChangeAt = 0;
      statusMessage.value = "";
      reviseLayout();
    } catch { statusMessage.value = labels.value.saveFailed; }
    updateHistoryControls();
  }

  function exportCurrent(): void {
    if (!context.value) return;
    const blob = new Blob([exportSkinLayout(getActiveSkinLayoutOverrides())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "webspeak-layout-" + context.value.skinId.replace(/[^a-z0-9.-]/g, "-") + ".json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function exportRecovery(): void {
    const skinId = context.value?.skinId;
    if (!skinId || !migrationRecovery.value) return;
    const blob = new Blob([exportSkinLayoutMigrationRecovery(skinId)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "webspeak-layout-recovery-" + skinId.replace(/[^a-z0-9.-]/g, "-") + ".json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > 128 * 1024) {
      statusMessage.value = labels.value.importFailed;
      return;
    }
    try {
      replaceActiveSkinLayoutOverrides(importSkinLayout(await file.text()));
      recordHistory(true);
      statusMessage.value = labels.value.imported;
      reviseLayout();
    } catch {
      statusMessage.value = labels.value.importFailed;
    }
  }

  function startDrag(event: PointerEvent): void {
    if (!isEditing.value || !context.value || !(event.target instanceof Element)) return;
    if (event.target.closest("[data-ws-layout-editor]")) return;
    const root = event.target.closest<HTMLElement>(".ws-skin-root[data-ws-page]");
    if (!root || root !== context.value.root) return;
    const element = event.target.closest<HTMLElement>("[data-ws-part]");
    if (!element || !root.contains(element)) return;
    const id = componentIdForElement(element);
    const ancestors: string[] = [];
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== root) {
      const ancestorId = componentIdForElement(ancestor);
      if (ancestorId) ancestors.push(ancestorId);
      ancestor = ancestor.parentElement;
    }
    if (!id || !canEditSkinLayoutComponent(id, context.value.page, ancestors)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    selectComponent(id);
    const placement = getEffectiveSkinLayoutPlacement(id) ?? {};
    drag = {
      pointerId: event.pointerId,
      componentId: id,
      startX: event.clientX,
      startY: event.clientY,
      originX: placement.x ?? 0,
      originY: placement.y ?? 0,
      placement,
      changed: false,
    };
  }

  function moveDrag(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    ignoredWarningKey.value = "";
    const xBounds = offsetBounds("x");
    const yBounds = offsetBounds("y");
    const x = clampSkinLayoutOffset(drag.originX + event.clientX - drag.startX, xBounds ?? { minimum: -2000, maximum: 2000 });
    const y = clampSkinLayoutOffset(drag.originY + event.clientY - drag.startY, yBounds ?? { minimum: -2000, maximum: 2000 });
    if (x === drag.originX && y === drag.originY) return;
    drag.changed = true;
    drag.placement = { ...drag.placement, x, y };
    previewActiveSkinLayoutPlacement(drag.componentId, drag.placement);
    reviseLayout();
  }

  function endDrag(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    drag = null;
    if (finished.changed) {
      const local = getActiveSkinLayoutOverride(finished.componentId) ?? {};
      try {
        saveActiveSkinLayoutPlacement(finished.componentId, {
          ...local,
          x: finished.placement.x,
          y: finished.placement.y,
        });
        recordHistory(true);
      } catch {
        statusMessage.value = labels.value.saveFailed;
        previewActiveSkinLayoutPlacement(finished.componentId, null);
      }
    } else {
      previewActiveSkinLayoutPlacement(finished.componentId, null);
    }
    reviseLayout();
  }

  function cancelDrag(): void {
    if (!drag) return;
    previewActiveSkinLayoutPlacement(drag.componentId, null);
    drag = null;
    refreshSkinLayout();
    reviseLayout();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!isOpen.value || !isEditing.value || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }

  onMounted(() => {
    initializeSkinLayoutRuntime();
    syncContext();
    observer = new MutationObserver((records) => {
      syncContext();
      const includesDynamicPart = (node: Node) => node instanceof Element
        && (node.matches("[data-ws-part^='skin.']") || Boolean(node.querySelector("[data-ws-part^='skin.']")));
      const dynamicPartsChanged = records.some((record) =>
        (record.type === "attributes" && record.attributeName === "data-ws-part"
          && record.target instanceof Element && record.target.matches("[data-ws-part^='skin.']"))
        || (record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some(includesDynamicPart)));
      if (dynamicPartsChanged || focusPreviewEnabled.value) revision.value += 1;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-ws-page", "data-ws-skin", "data-ws-part", "lang", "tabindex", "disabled", "href", "aria-label", "aria-labelledby", "title", "placeholder", "hidden", "inert", "aria-hidden", "class", "style"],
    });
    document.addEventListener("pointerdown", startDrag, true);
    document.addEventListener("pointermove", moveDrag, true);
    document.addEventListener("pointerup", endDrag, true);
    document.addEventListener("pointercancel", endDrag, true);
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("change", onFocusStateChange, true);
    document.addEventListener("input", onFocusStateChange, true);
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("resize", scheduleViewportRefresh, { passive: true });
    window.addEventListener("scroll", scheduleViewportRefresh, { capture: true, passive: true });
  });

  function onFocusStateChange(): void {
    if (focusPreviewEnabled.value) revision.value += 1;
  }

  onUnmounted(() => {
    observer?.disconnect();
    document.removeEventListener("pointerdown", startDrag, true);
    document.removeEventListener("pointermove", moveDrag, true);
    document.removeEventListener("pointerup", endDrag, true);
    document.removeEventListener("pointercancel", endDrag, true);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("change", onFocusStateChange, true);
    document.removeEventListener("input", onFocusStateChange, true);
    window.removeEventListener("blur", cancelDrag);
    window.removeEventListener("resize", scheduleViewportRefresh);
    window.removeEventListener("scroll", scheduleViewportRefresh, true);
    if (viewportRefreshFrame) window.cancelAnimationFrame(viewportRefreshFrame);
    if (geometryRefreshFrame) window.cancelAnimationFrame(geometryRefreshFrame);
    geometryRefreshQueued = false;
    setSkinLayoutEditorState(false, null);
  });

  return {
    isOpen,
    isEditing,
    available,
    context,
    labels,
    filter,
    filteredComponents,
    selectedComponentId,
    selectedPlacement,
    selectedVisible,
    selectedScale,
    selectedWidth,
    selectedHeight,
    canUndo,
    canRedo,
    focusPreviewEnabled,
    focusPreviewTargets,
    selectedX,
    selectedY,
    selectedForeground,
    selectedBackground,
    selectedBorder,
    selectedRadius,
    selectedSizeBounds,
    positionBoundsX,
    positionBoundsY,
    statusMessage,
    layoutWarnings,
    ignoreLayoutWarnings,
    migrationRecovery,
    migrationRecoveryCount,
    setOpen,
    setEditing,
    setFocusPreview,
    selectComponent,
    setVisible,
    setX,
    setY,
    setScale,
    setWidth,
    setHeight,
    setForeground,
    setBackground,
    setBorder,
    setRadius,
    resetComponent,
    resetAll,
    undo,
    redo,
    exportCurrent,
    exportRecovery,
    importFile,
  };
}
