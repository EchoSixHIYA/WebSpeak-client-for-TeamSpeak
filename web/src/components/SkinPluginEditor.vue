<template>
  <Teleport to="body">
    <div v-if="skinId" ref="editorRoot" class="skin-plugin-editor" data-ws-plugin-editor>
      <button ref="triggerButton" class="skin-plugin-trigger" type="button" aria-controls="skin-plugin-panel" :aria-expanded="open" @click="open = !open" @keydown.esc.stop.prevent="open = false">
        {{ english ? "Components" : "组件结构" }}
      </button>
      <section v-if="open" id="skin-plugin-panel" class="skin-plugin-panel" role="dialog" aria-modal="false" tabindex="-1" :aria-label="english ? 'Skin component editor' : '皮肤组件编辑器'" @keydown.esc.stop.prevent="open = false">
        <header class="skin-plugin-heading">
          <div>
            <h2>{{ english ? "Skin components" : "皮肤组件" }}</h2>
            <p>{{ english ? "Edits are local to this skin version and use the same permission and markup checks as packages." : "修改保存在本机当前皮肤版本中，并继续使用皮肤包相同的权限和标记校验。" }}</p>
          </div>
          <button ref="closeButton" type="button" class="skin-plugin-close" :aria-label="english ? 'Close' : '关闭'" @click="open = false">×</button>
        </header>

        <div class="skin-plugin-actions">
          <button type="button" :disabled="draftDirty || storageInvalid" @click="createComponent">{{ english ? "Add component" : "新增组件" }}</button>
          <button type="button" :disabled="!canUndo || draftDirty || storageInvalid" @click="undo">{{ english ? "Undo" : "撤销" }}</button>
          <button type="button" :disabled="!canRedo || draftDirty || storageInvalid" @click="redo">{{ english ? "Redo" : "重做" }}</button>
        </div>

        <label class="skin-plugin-label">
          <span>{{ english ? "Components" : "组件列表" }}</span>
          <select :value="selectedComponentId" :disabled="draftDirty || storageInvalid" @change="selectComponent(($event.target as HTMLSelectElement).value)">
            <option value="">{{ english ? "Select a component" : "选择组件" }}</option>
            <option v-for="component in document.components" :key="component.id" :value="component.id">{{ component.name }} · {{ component.page }} · {{ component.id }}</option>
          </select>
        </label>

        <p v-if="!selectedComponent" class="skin-plugin-empty">{{ english ? "No skin components yet. Add one to begin." : "当前皮肤还没有自定义组件，可以从新增组件开始。" }}</p>
        <template v-if="selectedComponent">
          <div class="skin-plugin-actions">
            <button type="button" :disabled="draftDirty || storageInvalid || !canMoveComponent(-1)" :aria-label="english ? 'Move component up' : '组件上移'" @click="moveComponent(-1)">↑</button>
            <button type="button" :disabled="draftDirty || storageInvalid || !canMoveComponent(1)" :aria-label="english ? 'Move component down' : '组件下移'" @click="moveComponent(1)">↓</button>
            <button type="button" :disabled="draftDirty || storageInvalid" @click="duplicateComponent">{{ english ? "Duplicate component" : "复制组件" }}</button>
            <button type="button" class="is-danger" :disabled="draftDirty || storageInvalid" @click="deleteComponent">{{ english ? "Delete component" : "删除组件" }}</button>
          </div>

          <label class="skin-plugin-label">
            <span>{{ english ? "Component tree" : "组件树" }}</span>
            <select :value="selectedPathKey" :disabled="draftDirty || storageInvalid" @change="selectPath(($event.target as HTMLSelectElement).value)">
              <option value="">{{ english ? "Select a node to edit" : "选择节点进行编辑" }}</option>
              <option v-for="row in nodeRows" :key="row.key" :value="row.key" :style="{ paddingInlineStart: (row.depth * 12) + 'px' }">{{ row.label }}</option>
            </select>
          </label>

          <label class="skin-plugin-label">
            <span>{{ english ? "New node type" : "新增节点类型" }}</span>
            <select :value="newNodeType" :disabled="draftDirty || storageInvalid" :aria-label="english ? 'New node type' : '新增节点类型'" @change="newNodeType = ($event.target as HTMLSelectElement).value">
              <option value="text">{{ english ? "Text node" : "文本节点" }}</option>
              <option v-for="tag in allowedElementTags" :key="tag" :value="tag">{{ "<" + tag + ">" }}</option>
            </select>
          </label>

          <div class="skin-plugin-actions">
            <button type="button" :disabled="!canAddChild || draftDirty || storageInvalid" @click="addChild">{{ english ? "Add child" : "添加子节点" }}</button>
            <button type="button" :disabled="!selectedPath.length || draftDirty || storageInvalid" @click="addSibling">{{ english ? "Add sibling" : "添加同级节点" }}</button>
            <button type="button" :disabled="!selectedPath.length || draftDirty || storageInvalid" @click="duplicateNode">{{ english ? "Duplicate node" : "复制节点" }}</button>
            <button type="button" :disabled="!selectedPath.length || !canMove(-1) || draftDirty || storageInvalid" :aria-label="english ? 'Move node up' : '节点上移'" @click="moveNode(-1)">↑</button>
            <button type="button" :disabled="!selectedPath.length || !canMove(1) || draftDirty || storageInvalid" :aria-label="english ? 'Move node down' : '节点下移'" @click="moveNode(1)">↓</button>
            <button type="button" class="is-danger" :disabled="!selectedPath.length || draftDirty || storageInvalid" @click="deleteNode">{{ english ? "Delete node" : "删除节点" }}</button>
          </div>

          <label class="skin-plugin-label skin-plugin-json-label">
            <span>{{ editorTarget === "component" ? (english ? "Component definition" : "组件定义") : (english ? "Node definition" : "节点定义") }}</span>
            <small>{{ english ? "JSON edits are validated before they are saved or rendered." : "JSON 修改会先经过 schema、权限和安全校验，再保存和渲染。" }}</small>
            <textarea v-model="draftJson" :disabled="storageInvalid" spellcheck="false" :aria-label="english ? 'Component or node JSON' : '组件或节点 JSON'"></textarea>
          </label>
          <div class="skin-plugin-actions">
            <button type="button" class="is-primary" :disabled="storageInvalid" @click="applyDraft">{{ english ? "Apply definition" : "应用定义" }}</button>
            <button type="button" @click="resetDraft">{{ english ? "Discard draft" : "放弃草稿" }}</button>
          </div>
        </template>

        <div class="skin-plugin-actions skin-plugin-file-actions">
          <button type="button" @click="exportDocument">{{ english ? "Export components.json" : "导出 components.json" }}</button>
          <button type="button" :disabled="draftDirty || storageInvalid" @click="importInput?.click()">{{ english ? "Import components.json" : "导入 components.json" }}</button>
          <button type="button" :disabled="!hasLocalEdits || draftDirty" @click="resetAll">{{ english ? "Reset local edits" : "清除本地修改" }}</button>
          <input ref="importInput" class="skin-plugin-file" type="file" accept="application/json,.json" @change="importDocument" />
        </div>
        <p v-if="errorMessage" class="skin-plugin-error" role="alert">{{ errorMessage }}</p>
        <p v-else-if="draftDirty" class="skin-plugin-status" role="status">{{ english ? "Unapplied draft. Apply it or discard it before other edits." : "有尚未应用的草稿；请先应用或放弃，再进行其他修改。" }}</p>
        <p v-else-if="statusMessage" class="skin-plugin-status" role="status">{{ statusMessage }}</p>
        <p class="skin-plugin-context">{{ skinId }}@{{ skinVersion }}</p>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  addSkinPluginComponent,
  addSkinPluginNode,
  addSkinPluginNodeSibling,
  editableSkinPluginDocument,
  getSkinPluginNode,
  moveSkinPluginComponent as movePluginComponent,
  moveSkinPluginNode as movePluginNode,
  duplicateSkinPluginNode,
  removeSkinPluginComponent,
  removeSkinPluginNode,
  replaceSkinPluginComponent,
  replaceSkinPluginNode,
} from "../../../src/shared/skin-plugin-editor.js";
import { SKIN_PLUGIN_ALLOWED_ELEMENTS, type SkinPluginComponent, type SkinPluginDocument, type SkinPluginNode } from "../../../src/shared/skin-plugin.js";
import {
  clearSkinPluginAuthoringDocument,
  exportSkinPluginAuthoringDocument,
  hasSkinPluginAuthoringDocument,
  importSkinPluginAuthoringDocument,
  loadSkinPluginAuthoringDocument,
  saveSkinPluginAuthoringDocument,
} from "../services/skin-plugin-authoring.js";
import { promoteHostEditorToTopLayer } from "../services/host-editor-top-layer.js";

const props = defineProps<{
  skinId: string;
  skinVersion: string;
  baseDocument?: SkinPluginDocument;
  page: "home" | "voice" | "demo";
  lang?: string;
}>();
const emit = defineEmits<{ updated: [] }>();

type NodeRow = { key: string; label: string; depth: number };
const emptyDocument: SkinPluginDocument = { schemaVersion: 3, components: [] };
const allowedElementTags = SKIN_PLUGIN_ALLOWED_ELEMENTS;
const voidNodeTags = new Set(["br", "circle", "hr", "img", "input", "line", "path", "polyline", "rect", "wbr"]);
const open = ref(false);
const document = ref<SkinPluginDocument>(emptyDocument);
const selectedComponentId = ref("");
const selectedPath = ref<number[]>([]);
const editorTarget = ref<"component" | "node">("component");
const newNodeType = ref("div");
const draftJson = ref("");
const errorMessage = ref("");
const statusMessage = ref("");
const importInput = ref<HTMLInputElement | null>(null);
const editorRoot = ref<HTMLElement | null>(null);
const triggerButton = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const history = ref<SkinPluginDocument[]>([]);
const historyIndex = ref(-1);
const editRevision = ref(0);
const storageInvalid = ref(false);
const english = computed(() => (props.lang ?? "").toLowerCase().startsWith("en"));
const selectedComponent = computed(() => document.value.components.find((component) => component.id === selectedComponentId.value) ?? null);
const selectedNode = computed(() => selectedComponent.value ? getSkinPluginNode(document.value, selectedComponentId.value, selectedPath.value) : null);
const canAddChild = computed(() => Boolean(selectedNode.value?.tag && !voidNodeTags.has(selectedNode.value.tag)));
const selectedPathKey = computed(() => editorTarget.value === "node"
  ? (selectedPath.value.length ? selectedPath.value.join(".") : "root")
  : "");
const canUndo = computed(() => historyIndex.value > 0);
const canRedo = computed(() => historyIndex.value >= 0 && historyIndex.value < history.value.length - 1);
const canMoveComponent = (direction: -1 | 1) => {
  const index = document.value.components.findIndex((component) => component.id === selectedComponentId.value);
  return index >= 0 && index + direction >= 0 && index + direction < document.value.components.length;
};
const hasLocalEdits = computed(() => { editRevision.value; return hasSkinPluginAuthoringDocument(props.skinId, props.skinVersion); });
const draftDirty = computed(() => {
  const current = editorTarget.value === "component" ? selectedComponent.value : selectedNode.value;
  return Boolean(current && draftJson.value !== JSON.stringify(current, null, 2));
});
const nodeRows = computed<NodeRow[]>(() => {
  const component = selectedComponent.value;
  if (!component) return [];
  const rows: NodeRow[] = [];
  const visit = (node: SkinPluginNode, path: number[], depth: number) => {
    const name = node.widget ? "widget: " + node.widget : node.tag ? "<" + node.tag + ">" : "text: " + (node.text ?? "").slice(0, 42);
    const label = (path.length ? path.map((index) => index + 1).join(".") : "root") + " · " + name;
    rows.push({ key: path.length ? path.join(".") : "root", label, depth });
    node.children?.forEach((child, index) => visit(child, [...path, index], depth + 1));
  };
  visit(component.root, [], 0);
  return rows;
});

function activeBase(): SkinPluginDocument {
  return editableSkinPluginDocument(props.baseDocument ?? emptyDocument);
}

function loadDocument(): void {
  try {
    const hasStoredDocument = hasSkinPluginAuthoringDocument(props.skinId, props.skinVersion);
    const savedDocument = loadSkinPluginAuthoringDocument(props.skinId, props.skinVersion);
    storageInvalid.value = hasStoredDocument && !savedDocument;
    document.value = savedDocument ?? activeBase();
    selectedPath.value = [];
    editorTarget.value = "component";
    if (!document.value.components.some((component) => component.id === selectedComponentId.value)) {
      selectedComponentId.value = document.value.components[0]?.id ?? "";
    }
    history.value = [document.value];
    historyIndex.value = 0;
    resetDraft();
    errorMessage.value = storageInvalid.value
      ? (english.value ? "Saved edits are invalid. Clear this skin version's local edits to restore its package." : "本地修改无法通过校验。清除当前皮肤版本的本地修改即可恢复皮肤包。")
      : "";
  } catch (error) {
    document.value = activeBase();
    errorMessage.value = message(error);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createNodeDefinition(): SkinPluginNode {
  const type = newNodeType.value;
  if (type === "text") return { text: english.value ? "New content" : "新建内容" };
  if (!SKIN_PLUGIN_ALLOWED_ELEMENTS.some((tag) => tag === type)) throw new Error("Choose a supported safe node type.");
  const node: SkinPluginNode = { tag: type };
  if (type === "img") node.attributes = { alt: english.value ? "Skin image" : "皮肤图片" };
  if (type === "svg") node.children = [{ tag: "g" }];
  else if (type !== "g" && !voidNodeTags.has(type)) node.children = [{ text: english.value ? "New content" : "新建内容" }];
  return node;
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function save(next: unknown): boolean {
  try {
    if (storageInvalid.value) throw new Error(english.value ? "Clear the invalid local edits before saving." : "请先清除无效的本地修改，再保存。");
    const normalized = editableSkinPluginDocument(next);
    saveSkinPluginAuthoringDocument(props.skinId, props.skinVersion, normalized);
    const nextHistory = history.value.slice(0, historyIndex.value + 1);
    nextHistory.push(snapshot(normalized));
    history.value = nextHistory.slice(-50);
    historyIndex.value = history.value.length - 1;
    editRevision.value += 1;
    document.value = normalized;
    if (!normalized.components.some((component) => component.id === selectedComponentId.value)) {
      selectedComponentId.value = normalized.components[0]?.id ?? "";
      selectedPath.value = [];
    }
    if (editorTarget.value === "node" && selectedComponent.value) {
      try { getSkinPluginNode(normalized, selectedComponentId.value, selectedPath.value); }
      catch { selectedPath.value = []; editorTarget.value = "component"; }
    }
    statusMessage.value = english.value ? "Saved on this device." : "已保存到本机。";
    errorMessage.value = "";
    resetDraft();
    emit("updated");
    return true;
  } catch (error) {
    errorMessage.value = message(error);
    statusMessage.value = "";
    return false;
  }
}

function selectComponent(id: string): void {
  selectedComponentId.value = id;
  selectedPath.value = [];
  editorTarget.value = "component";
  resetDraft();
}

function selectPath(key: string): void {
  if (!key) {
    selectedPath.value = [];
    editorTarget.value = "component";
  } else {
    selectedPath.value = key === "root" ? [] : key.split(".").map(Number);
    editorTarget.value = "node";
  }
  resetDraft();
}

function resetDraft(): void {
  const component = selectedComponent.value;
  if (!component) { draftJson.value = ""; return; }
  const current = editorTarget.value === "component" ? component : selectedNode.value;
  draftJson.value = current ? JSON.stringify(current, null, 2) : "";
}

function applyDraft(): void {
  try {
    const parsed: unknown = JSON.parse(draftJson.value);
    if (editorTarget.value === "component") {
      const next = replaceSkinPluginComponent(document.value, selectedComponentId.value, parsed);
      const nextComponent = (parsed as SkinPluginComponent).id;
      if (save(next)) {
        selectedComponentId.value = nextComponent;
        selectedPath.value = [];
        resetDraft();
      }
    } else {
      const next = replaceSkinPluginNode(document.value, selectedComponentId.value, selectedPath.value, parsed);
      save(next);
    }
  } catch (error) { errorMessage.value = message(error); statusMessage.value = ""; }
}

function createComponent(): void {
  const baseId = "custom-component";
  const ids = new Set(document.value.components.map((component) => component.id));
  let suffix = 1;
  while (ids.has(baseId + "-" + suffix)) suffix += 1;
  const id = baseId + "-" + suffix;
  const component: SkinPluginComponent = {
    id,
    name: english.value ? "Custom component" : "自定义组件",
    page: props.page === "demo" ? "home" : props.page,
    accessibleName: english.value ? "Custom component" : "自定义组件",
    permissions: [],
    actions: {},
    root: { tag: "section", children: [{ text: english.value ? "New component" : "新建组件" }] },
  };
  try {
    if (!save(addSkinPluginComponent(document.value, component))) return;
    selectedComponentId.value = id;
    selectedPath.value = [];
    editorTarget.value = "component";
    resetDraft();
  } catch (error) { errorMessage.value = message(error); }
}

function duplicateComponent(): void {
  const source = selectedComponent.value;
  if (!source) return;
  const stem = source.id.slice(0, 56);
  let suffix = 2;
  let id = stem + "-" + suffix;
  const ids = new Set(document.value.components.map((component) => component.id));
  while (ids.has(id)) id = stem + "-" + (++suffix);
  const copy = { ...snapshot(source), id, name: source.name.slice(0, 72) + (english.value ? " copy" : " 副本"), accessibleName: source.accessibleName.slice(0, 108) + (english.value ? " copy" : " 副本") };
  try {
    if (!save(addSkinPluginComponent(document.value, copy))) return;
    selectedComponentId.value = id;
    selectedPath.value = [];
    editorTarget.value = "component";
    resetDraft();
  } catch (error) { errorMessage.value = message(error); }
}

function deleteComponent(): void {
  if (!selectedComponentId.value) return;
  try {
    if (!save(removeSkinPluginComponent(document.value, selectedComponentId.value))) return;
    selectedPath.value = [];
    editorTarget.value = "component";
    resetDraft();
  }
  catch (error) { errorMessage.value = message(error); }
}

function moveComponent(direction: -1 | 1): void {
  if (!selectedComponentId.value || !canMoveComponent(direction)) return;
  try { save(movePluginComponent(document.value, selectedComponentId.value, direction)); }
  catch (error) { errorMessage.value = message(error); }
}

function addChild(): void {
  if (!selectedNode.value?.tag || voidNodeTags.has(selectedNode.value.tag)) return;
  const parent = selectedPath.value;
  const childIndex = selectedNode.value.children?.length ?? 0;
  try {
    const next = addSkinPluginNode(document.value, selectedComponentId.value, parent, createNodeDefinition());
    if (!save(next)) return;
    selectedPath.value = [...parent, childIndex];
    editorTarget.value = "node";
    resetDraft();
  } catch (error) { errorMessage.value = message(error); }
}

function addSibling(): void {
  if (!selectedPath.value.length) return;
  const path = [...selectedPath.value];
  const parent = getSkinPluginNode(document.value, selectedComponentId.value, path.slice(0, -1));
  try {
    if (!parent.tag) throw new Error("Only element nodes can contain siblings.");
    const next = addSkinPluginNodeSibling(document.value, selectedComponentId.value, path, createNodeDefinition());
    if (!save(next)) return;
    path[path.length - 1] += 1;
    selectedPath.value = path;
    editorTarget.value = "node";
    resetDraft();
  } catch (error) { errorMessage.value = message(error); }
}

function duplicateNode(): void {
  if (!selectedPath.value.length || !selectedNode.value) return;
  const path = [...selectedPath.value];
  const copy = duplicateSkinPluginNode(document.value, selectedComponentId.value, path);
  try {
    const next = addSkinPluginNodeSibling(document.value, selectedComponentId.value, path, copy);
    if (!save(next)) return;
    path[path.length - 1] += 1;
    selectedPath.value = path;
    editorTarget.value = "node";
    resetDraft();
  } catch (error) { errorMessage.value = message(error); }
}

function deleteNode(): void {
  if (!selectedPath.value.length) return;
  try {
    const next = removeSkinPluginNode(document.value, selectedComponentId.value, selectedPath.value);
    if (!save(next)) return;
    selectedPath.value = selectedPath.value.slice(0, -1);
    editorTarget.value = "node";
    resetDraft();
  } catch (error) { errorMessage.value = message(error); }
}

function canMove(direction: -1 | 1): boolean {
  if (!selectedPath.value.length) return false;
  const index = selectedPath.value[selectedPath.value.length - 1];
  const parent = getSkinPluginNode(document.value, selectedComponentId.value, selectedPath.value.slice(0, -1));
  return index + direction >= 0 && index + direction < (parent.children?.length ?? 0);
}

function moveNode(direction: -1 | 1): void {
  try {
    const next = movePluginNode(document.value, selectedComponentId.value, selectedPath.value, direction);
    if (!save(next)) return;
    const path = [...selectedPath.value];
    path[path.length - 1] += direction;
    selectedPath.value = path;
    resetDraft();
  } catch (error) { errorMessage.value = message(error); }
}

function undo(): void {
  if (!canUndo.value) return;
  historyIndex.value -= 1;
  const value = history.value[historyIndex.value];
  try {
    document.value = saveSkinPluginAuthoringDocument(props.skinId, props.skinVersion, value);
    editRevision.value += 1;
    if (!document.value.components.some((component) => component.id === selectedComponentId.value)) selectedComponentId.value = document.value.components[0]?.id ?? "";
    selectedPath.value = [];
    editorTarget.value = "component";
    statusMessage.value = english.value ? "Change undone." : "已撤销。";
    resetDraft();
    emit("updated");
  } catch (error) { historyIndex.value += 1; errorMessage.value = message(error); }
}

function redo(): void {
  if (!canRedo.value) return;
  historyIndex.value += 1;
  const value = history.value[historyIndex.value];
  try {
    document.value = saveSkinPluginAuthoringDocument(props.skinId, props.skinVersion, value);
    editRevision.value += 1;
    if (!document.value.components.some((component) => component.id === selectedComponentId.value)) selectedComponentId.value = document.value.components[0]?.id ?? "";
    selectedPath.value = [];
    editorTarget.value = "component";
    statusMessage.value = english.value ? "Change redone." : "已重做。";
    resetDraft();
    emit("updated");
  } catch (error) { historyIndex.value -= 1; errorMessage.value = message(error); }
}

function resetAll(): void {
  try {
    clearSkinPluginAuthoringDocument(props.skinId, props.skinVersion);
    storageInvalid.value = false;
    editRevision.value += 1;
    document.value = activeBase();
    selectedComponentId.value = document.value.components[0]?.id ?? "";
    selectedPath.value = [];
    editorTarget.value = "component";
    history.value = [document.value];
    historyIndex.value = 0;
    resetDraft();
    errorMessage.value = "";
    statusMessage.value = english.value ? "Local edits cleared." : "本地修改已清除。";
    emit("updated");
  } catch (error) { errorMessage.value = message(error); }
}

function download(source: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportDocument(): void {
  try { download(exportSkinPluginAuthoringDocument(document.value), props.skinId + "-components.json"); }
  catch (error) { errorMessage.value = message(error); }
}

async function importDocument(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    if (file.size > 256 * 1024) throw new Error("components.json exceeds the 256 KiB limit.");
    const imported = importSkinPluginAuthoringDocument(await file.text());
    if (!save(imported)) return;
    selectedComponentId.value = imported.components[0]?.id ?? "";
    selectedPath.value = [];
    editorTarget.value = "component";
    resetDraft();
  } catch (error) { errorMessage.value = message(error); statusMessage.value = ""; }
}

watch(() => [props.skinId, props.skinVersion, props.baseDocument] as const, loadDocument, { immediate: true });
watch(() => [selectedComponentId.value, selectedPathKey.value, editorTarget.value] as const, resetDraft);
onMounted(() => {
  promoteHostEditorToTopLayer(editorRoot.value);
});
watch(open, async (isOpen) => {
  await nextTick();
  const target = isOpen ? closeButton.value : triggerButton.value;
  target?.focus?.();
});
</script>

<style scoped>
.skin-plugin-editor { position: fixed; inset: auto; z-index: 2147483647; top: auto; left: auto; right: 14px; bottom: 72px; width: auto; height: auto; max-width: none; max-height: none; overflow: visible; margin: 0; padding: 0; border: 0; color: #172033; background: transparent; font: 13px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; }
.skin-plugin-editor button, .skin-plugin-editor select, .skin-plugin-editor textarea { font: inherit; }
.skin-plugin-trigger { min-height: 44px; padding: 0 14px; border: 1px solid #cbd5e1; border-radius: 999px; color: #fff; background: #4f46e5; box-shadow: 0 5px 22px #0f172a55; cursor: pointer; }
.skin-plugin-panel { position: absolute; right: 0; bottom: 50px; display: grid; gap: 10px; width: min(460px, calc(100vw - 24px)); max-height: min(82vh, 820px); overflow: auto; padding: 14px; border: 1px solid #cbd5e1; border-radius: 15px; background: #fff; box-shadow: 0 18px 60px #0f172a44; }
.skin-plugin-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.skin-plugin-heading h2 { margin: 0; font-size: 16px; }
.skin-plugin-heading p { margin: 5px 0 0; color: #475569; font-size: 11px; }
.skin-plugin-close { width: 44px; height: 44px; border-radius: 8px; color: #334155; background: #f1f5f9; font-size: 21px !important; cursor: pointer; }
.skin-plugin-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.skin-plugin-actions button { min-height: 44px; padding: 0 9px; border: 1px solid #cbd5e1; border-radius: 7px; color: #172033; background: #f8fafc; cursor: pointer; }
.skin-plugin-actions button:disabled { opacity: .45; cursor: not-allowed; }
.skin-plugin-actions .is-primary { color: #fff; border-color: #4338ca; background: #4f46e5; }
.skin-plugin-actions .is-danger { color: #991b1b; border-color: #fecaca; background: #fef2f2; }
.skin-plugin-label { display: grid; gap: 5px; color: #475569; font-size: 12px; }
.skin-plugin-label select { width: 100%; min-height: 44px; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 7px; color: #172033; background: #fff; }
.skin-plugin-json-label small { color: #64748b; }
.skin-plugin-json-label textarea { width: 100%; min-height: 230px; resize: vertical; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; color: #172033; background: #f8fafc; font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; }
.skin-plugin-file { display: none; }
.skin-plugin-error, .skin-plugin-status, .skin-plugin-context { margin: 0; overflow-wrap: anywhere; }
.skin-plugin-error { color: #b91c1c; }
.skin-plugin-status { color: #4338ca; }
.skin-plugin-context { color: #64748b; font-size: 10px; }
.skin-plugin-editor :focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
@media (max-width: 520px) {
  .skin-plugin-editor { right: max(10px, env(safe-area-inset-right)); bottom: calc(10px + env(safe-area-inset-bottom)); }
  .skin-plugin-panel {
    box-sizing: border-box;
    width: min(460px, calc(100vw - 20px - env(safe-area-inset-left) - env(safe-area-inset-right)));
    max-height: min(76vh, 620px);
  }
}
@supports (height: 100dvh) {
  @media (max-width: 520px) {
    .skin-plugin-panel { max-height: min(620px, calc(100dvh - 76px - env(safe-area-inset-top) - env(safe-area-inset-bottom))); }
  }
}
</style>
