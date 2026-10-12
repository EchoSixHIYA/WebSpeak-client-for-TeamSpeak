<template>
  <Teleport to="body">
    <div v-if="editor.available.value" ref="editorRoot" class="skin-layout-editor" data-ws-layout-editor @keydown.esc.stop.prevent="editor.setOpen(false)">
      <button
        v-if="editorMode.isAdmin.value"
        class="skin-editor-mode-trigger"
        type="button"
        :aria-pressed="editorMode.isEnabled.value"
        @click="toggleEditorMode"
      >
        <span aria-hidden="true">⚙</span>
        {{ editorMode.isEnabled.value ? "退出编辑器 / Exit editor" : "编辑器模式 / Editor mode" }}
      </button>
      <button
        v-if="editorMode.isEnabled.value"
        ref="triggerButton"
        class="skin-layout-trigger"
        type="button"
        :aria-expanded="editor.isOpen.value"
        aria-controls="skin-layout-panel"
        @click="editor.setOpen(!editor.isOpen.value)"
      >
        <span aria-hidden="true">⠿</span>
        {{ editor.labels.value.editButton }}
      </button>

      <section
        v-if="editorMode.isEnabled.value && editor.isOpen.value"
        id="skin-layout-panel"
        class="skin-layout-panel"
        role="dialog"
        aria-modal="false"
        :aria-label="editor.labels.value.title"
      >
        <header class="skin-layout-heading">
          <div>
            <h2>{{ editor.labels.value.title }}</h2>
            <p>{{ editor.labels.value.hint }}</p>
          </div>
          <button ref="closeButton" type="button" class="skin-layout-close" :aria-label="editor.labels.value.close" @click="editor.setOpen(false)">×</button>
        </header>

        <label class="skin-layout-toggle">
          <input type="checkbox" :checked="editor.isEditing.value" @change="editor.setEditing(($event.target as HTMLInputElement).checked)" />
          <span>{{ editor.labels.value.editMode }}</span>
        </label>

        <label class="skin-layout-toggle">
          <input type="checkbox" :checked="editor.focusPreviewEnabled.value" @change="editor.setFocusPreview(($event.target as HTMLInputElement).checked)" />
          <span>{{ editor.labels.value.focusPreview }}</span>
        </label>
        <ol v-if="editor.focusPreviewEnabled.value" class="skin-layout-focus-list" :aria-label="editor.labels.value.focusPreview">
          <li v-if="!editor.focusPreviewTargets.value.length" class="skin-layout-focus-empty">
            {{ editor.labels.value.focusPreviewEmpty }}
          </li>
          <li v-for="target in editor.focusPreviewTargets.value" :key="target.key" :class="{ 'is-small': !target.meetsTouchTarget }">
            <span class="skin-layout-focus-number" aria-hidden="true">{{ target.order }}</span>
            <span class="skin-layout-focus-name"><strong>{{ target.componentName }}</strong><small>{{ target.accessibleName || editor.labels.value.focusPreviewUnnamed }}</small></span>
            <span class="skin-layout-focus-size">{{ editor.labels.value.focusPreviewTargetSize.replace("{width}", String(Math.round(target.width))).replace("{height}", String(Math.round(target.height))) }}<small>{{ target.meetsTouchTarget ? editor.labels.value.focusPreviewTargetAdequate : editor.labels.value.focusPreviewTargetSmall }}</small></span>
          </li>
        </ol>

        <label class="skin-layout-field">
          <span>{{ editor.labels.value.component }}</span>
          <input v-model="editor.filter.value" type="search" :placeholder="editor.labels.value.filter" />
          <select :value="editor.selectedComponentId.value" @change="editor.selectComponent(($event.target as HTMLSelectElement).value)">
            <option v-for="component in editor.filteredComponents.value" :key="component.id" :value="component.id">{{ component.name }} ({{ component.id }})</option>
          </select>
        </label>

        <label class="skin-layout-toggle">
          <input type="checkbox" :checked="editor.selectedVisible.value" @change="editor.setVisible(($event.target as HTMLInputElement).checked)" />
          <span>{{ editor.labels.value.visible }}</span>
        </label>

        <div class="skin-layout-range">
          <label><span>{{ editor.labels.value.positionX }}</span><output>{{ Math.round(editor.selectedX.value) }} px</output></label>
          <input type="range" :min="editor.positionBoundsX.value.minimum" :max="editor.positionBoundsX.value.maximum" step="1" :value="editor.selectedX.value" @input="editor.setX(Number(($event.target as HTMLInputElement).value))" />
        </div>
        <div class="skin-layout-range">
          <label><span>{{ editor.labels.value.positionY }}</span><output>{{ Math.round(editor.selectedY.value) }} px</output></label>
          <input type="range" :min="editor.positionBoundsY.value.minimum" :max="editor.positionBoundsY.value.maximum" step="1" :value="editor.selectedY.value" @input="editor.setY(Number(($event.target as HTMLInputElement).value))" />
        </div>
        <div class="skin-layout-range">
          <label><span>{{ editor.labels.value.size }}</span><output>{{ Math.round(editor.selectedScale.value * 100) }}%</output></label>
          <input type="range" :min="editor.selectedSizeBounds.value.minScale" :max="editor.selectedSizeBounds.value.maxScale" step="0.05" :value="editor.selectedScale.value" @input="editor.setScale(Number(($event.target as HTMLInputElement).value))" />
        </div>
        <div class="skin-layout-range">
          <label><span>{{ editor.labels.value.width }}</span><output>{{ Math.round(editor.selectedWidth.value) }} px</output></label>
          <input type="range" :min="editor.selectedSizeBounds.value.minWidth" :max="editor.selectedSizeBounds.value.maxWidth" step="4" :value="editor.selectedWidth.value" @input="editor.setWidth(Number(($event.target as HTMLInputElement).value))" />
        </div>
        <div class="skin-layout-range">
          <label><span>{{ editor.labels.value.height }}</span><output>{{ Math.round(editor.selectedHeight.value) }} px</output></label>
          <input type="range" :min="editor.selectedSizeBounds.value.minHeight" :max="editor.selectedSizeBounds.value.maxHeight" step="4" :value="editor.selectedHeight.value" @input="editor.setHeight(Number(($event.target as HTMLInputElement).value))" />
        </div>
        <div class="skin-layout-range" :title="editor.labels.value.orderHint">
          <label><span>{{ editor.labels.value.order }}</span><output>{{ editor.selectedOrder.value }}</output></label>
          <input type="range" min="-100" max="100" step="1" :value="editor.selectedOrder.value" @input="editor.setOrder(Number(($event.target as HTMLInputElement).value))" />
        </div>

        <div class="skin-layout-colors">
          <label><span>{{ editor.labels.value.foreground }}</span><input type="color" :value="editor.selectedForeground.value" @input="editor.setForeground(($event.target as HTMLInputElement).value)" /></label>
          <label><span>{{ editor.labels.value.background }}</span><input type="color" :value="editor.selectedBackground.value" @input="editor.setBackground(($event.target as HTMLInputElement).value)" /></label>
          <label><span>{{ editor.labels.value.border }}</span><input type="color" :value="editor.selectedBorder.value" @input="editor.setBorder(($event.target as HTMLInputElement).value)" /></label>
        </div>

        <div class="skin-layout-range">
          <label><span>{{ editor.labels.value.radius }}</span><output>{{ Math.round(editor.selectedRadius.value) }} px</output></label>
          <input type="range" min="0" max="64" step="1" :value="editor.selectedRadius.value" @input="editor.setRadius(Number(($event.target as HTMLInputElement).value))" />
        </div>

        <div class="skin-layout-actions">
          <button type="button" :disabled="!editor.canUndo.value" @click="editor.undo">{{ editor.labels.value.undo }}</button>
          <button type="button" :disabled="!editor.canRedo.value" @click="editor.redo">{{ editor.labels.value.redo }}</button>
        </div>
        <div class="skin-layout-actions">
          <button type="button" @click="editor.resetComponent">{{ editor.labels.value.resetItem }}</button>
          <button type="button" @click="editor.resetAll">{{ editor.labels.value.resetAll }}</button>
        </div>
        <div class="skin-layout-actions">
          <button type="button" @click="editor.exportCurrent">{{ editor.labels.value.export }}</button>
          <button type="button" @click="importInput?.click()">{{ editor.labels.value.import }}</button>
          <input ref="importInput" class="skin-layout-file" type="file" accept="application/json,.json" @change="onImport" />
        </div>
        <p v-if="editor.statusMessage.value" class="skin-layout-status" role="status">{{ editor.statusMessage.value }}</p>
        <div v-if="editor.layoutWarnings.value.length" class="skin-layout-warning" role="status">
          <p v-for="warning in editor.layoutWarnings.value" :key="warning">{{ warning }}</p>
          <button type="button" @click="editor.ignoreLayoutWarnings">{{ editor.labels.value.ignoreWarnings }}</button>
        </div>
        <div v-if="editor.migrationRecovery.value" class="skin-layout-warning" role="status">
          <span>{{ editor.labels.value.migrationWarning(editor.migrationRecoveryCount.value) }}</span>
          <button type="button" @click="editor.exportRecovery">{{ editor.labels.value.exportRecovery }}</button>
        </div>
        <p class="skin-layout-context">{{ editor.context.value?.skinId }} · {{ editor.context.value?.page }} · {{ editor.context.value?.profile }}</p>
      </section>
    </div>
    <div v-if="editorMode.isEnabled.value && editor.focusPreviewEnabled.value" class="skin-layout-focus-overlay" aria-hidden="true">
      <span
        v-for="target in editor.focusPreviewTargets.value"
        :key="target.key"
        class="skin-layout-focus-marker"
        :class="{ 'is-small': !target.meetsTouchTarget }"
        :style="{ left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px` }"
      >{{ target.order }}</span>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useSkinLayoutEditor } from "../composables/useSkinLayoutEditor.js";
import { promoteHostEditorToTopLayer } from "../services/host-editor-top-layer.js";
import { useSkinEditorMode } from "../services/skin-editor-mode.js";
import { useRoute } from "vue-router";

const editor = useSkinLayoutEditor();
const editorMode = useSkinEditorMode();
const route = useRoute();
const editorRoot = ref<HTMLElement | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const triggerButton = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let accessCheckTimer: number | undefined;

function refreshAdminAccess(): void {
  if (document.visibilityState !== "hidden") void editorMode.refreshAdminAccess();
}

async function toggleEditorMode(): Promise<void> {
  const enabled = await editorMode.setEnabled(!editorMode.isEnabled.value);
  if (!enabled) editor.setOpen(false);
}

onMounted(() => {
  refreshAdminAccess();
  window.addEventListener("focus", refreshAdminAccess);
  document.addEventListener("visibilitychange", refreshAdminAccess);
});
onUnmounted(() => {
  window.removeEventListener("focus", refreshAdminAccess);
  document.removeEventListener("visibilitychange", refreshAdminAccess);
  if (accessCheckTimer !== undefined) window.clearInterval(accessCheckTimer);
});

watch(editorRoot, promoteHostEditorToTopLayer, { flush: "post" });
watch(() => route.fullPath, refreshAdminAccess);
watch(editorMode.isEnabled, (enabled) => {
  if (accessCheckTimer !== undefined) window.clearInterval(accessCheckTimer);
  accessCheckTimer = enabled ? window.setInterval(refreshAdminAccess, 60_000) : undefined;
  if (!enabled) editor.setOpen(false);
});
watch(editor.isOpen, async (isOpen) => {
  await nextTick();
  (isOpen ? closeButton.value : triggerButton.value)?.focus();
});

async function onImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  await editor.importFile(input.files?.[0]);
  input.value = "";
}
</script>

<style scoped>
.skin-layout-editor {
  position: fixed;
  inset: auto;
  z-index: 2147483647;
  top: auto;
  left: auto;
  right: 14px;
  bottom: 14px;
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  overflow: visible;
  margin: 0;
  padding: 0;
  border: 0;
  color: #172033;
  background: transparent;
  font: 13px/1.45 Inter, ui-sans-serif, system-ui, sans-serif;
}

.skin-layout-editor button,
.skin-layout-editor input,
.skin-layout-editor select {
  font: inherit;
}

.skin-layout-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #fff;
  background: #273449;
  box-shadow: 0 5px 22px #0f172a55;
  cursor: pointer;
}

.skin-editor-mode-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  margin-inline-end: 8px;
  padding: 0 14px;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  color: #fff;
  background: #334155;
  box-shadow: 0 5px 22px #0f172a55;
  cursor: pointer;
}
.skin-editor-mode-trigger span { font-size: 19px; line-height: 1; }
.skin-editor-mode-trigger:focus-visible { outline: 3px solid #fbbf24; outline-offset: 3px; }

.skin-layout-trigger span { font-size: 19px; line-height: 1; }

.skin-layout-panel {
  position: absolute;
  right: 0;
  bottom: 56px;
  display: grid;
  gap: 12px;
  width: min(360px, calc(100vw - 24px));
  max-height: min(78vh, 720px);
  overflow: auto;
  padding: 16px;
  border: 1px solid #cbd5e1;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 18px 60px #0f172a44;
}

.skin-layout-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.skin-layout-heading h2 { margin: 0; font-size: 16px; }
.skin-layout-heading p { margin: 5px 0 0; color: #475569; font-size: 12px; }
.skin-layout-close { width: 44px; height: 44px; border-radius: 8px; color: #334155; background: #f1f5f9; font-size: 22px !important; cursor: pointer; }
.skin-layout-toggle { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.skin-layout-field { display: grid; gap: 6px; }
.skin-layout-field > span,
.skin-layout-range label,
.skin-layout-colors span { color: #475569; font-size: 12px; }
.skin-layout-field input[type="search"],
.skin-layout-field select { width: 100%; min-height: 44px; padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 8px; color: #172033; background: #fff; }
.skin-layout-range { display: grid; gap: 3px; }
.skin-layout-range label { display: flex; justify-content: space-between; gap: 8px; }
.skin-layout-range output { color: #172033; font-variant-numeric: tabular-nums; }
.skin-layout-range input { width: 100%; min-height: 44px; accent-color: #4f46e5; }
.skin-layout-colors { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.skin-layout-colors label { display: grid; gap: 4px; }
.skin-layout-colors input { width: 100%; height: 44px; padding: 2px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; }
.skin-layout-actions { display: flex; flex-wrap: wrap; gap: 7px; }
.skin-layout-actions button { min-height: 44px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; color: #172033; background: #f8fafc; cursor: pointer; }
.skin-layout-actions button:disabled { opacity: .5; cursor: not-allowed; }
.skin-layout-file { display: none; }
.skin-layout-status { margin: 0; color: #4338ca; }
.skin-layout-warning { margin: 0; padding: 8px 10px; border: 1px solid #fcd34d; border-radius: 8px; color: #854d0e; background: #fffbeb; }
.skin-layout-warning button { min-height: 44px; margin-top: 6px; padding: 0 9px; border: 1px solid #d97706; border-radius: 7px; color: #78350f; background: #fff; cursor: pointer; }
.skin-layout-context { margin: 0; color: #64748b; font-size: 11px; overflow-wrap: anywhere; }
.skin-layout-editor :focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
.skin-layout-focus-list { display: grid; gap: 6px; max-height: 220px; overflow: auto; margin: 0; padding: 0; list-style: none; }
.skin-layout-focus-list > li { display: flex; align-items: flex-start; gap: 8px; min-width: 0; padding: 7px; border: 1px solid #86efac; border-radius: 8px; background: #f0fdf4; }
.skin-layout-focus-list > li.is-small { border-color: #fca5a5; background: #fef2f2; }
.skin-layout-focus-list .skin-layout-focus-empty { border-color: #cbd5e1; background: #f8fafc; color: #475569; }
.skin-layout-focus-number { display: grid; place-items: center; flex: 0 0 22px; width: 22px; height: 22px; border-radius: 50%; color: #fff; background: #15803d; font-weight: 700; }
.is-small .skin-layout-focus-number { background: #b91c1c; }
.skin-layout-focus-name, .skin-layout-focus-size { display: grid; min-width: 0; gap: 2px; overflow-wrap: anywhere; }
.skin-layout-focus-name { flex: 1; }
.skin-layout-focus-name small, .skin-layout-focus-size small { color: #475569; font-size: 10px; }
.skin-layout-focus-size { flex: 0 0 auto; text-align: right; }
.skin-layout-focus-overlay { position: fixed; z-index: 2147483647; inset: 0; pointer-events: none; }
.skin-layout-focus-marker { position: fixed; box-sizing: border-box; display: grid; place-items: start; padding: 0 2px; border: 2px solid #15803d; border-radius: 3px; color: #fff; background: #15803d40; font: 700 11px/16px ui-sans-serif, system-ui, sans-serif; }
.skin-layout-focus-marker.is-small { border-color: #b91c1c; background: #b91c1c40; }

@media (max-width: 520px) {
  .skin-layout-editor { right: 10px; bottom: 10px; }
  .skin-layout-panel { max-height: 72vh; }
}
</style>
