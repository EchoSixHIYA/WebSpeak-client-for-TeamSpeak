import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Vue from "vue";
import { createRenderer, nextTick, ssrContextKey, createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createServer } from "vite";
import vuePlugin from "@vitejs/plugin-vue";

let vite;
let SkinPluginEditor;
let authoring;
let focusedNode;
const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const hostNode = (tag, type = "element") => ({
  tag, type, props: {}, text: "", children: [], parent: null, value: "", listeners: new Map(), focus() { focusedNode = this; },
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  },
  removeEventListener(name, listener) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter(candidate => candidate !== listener));
  },
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) ?? []) listener(event); },
});
function insert(child, parent, anchor = null) {
  if (child.parent) {
    const previous = child.parent.children.indexOf(child);
    if (previous >= 0) child.parent.children.splice(previous, 1);
  }
  const index = anchor ? parent.children.indexOf(anchor) : -1;
  child.parent = parent;
  if (index < 0) parent.children.push(child);
  else parent.children.splice(index, 0, child);
}

const renderer = createRenderer({
  createElement: tag => hostNode(tag),
  createText: text => Object.assign(hostNode("#text", "text"), { text }),
  createComment: text => Object.assign(hostNode("#comment", "comment"), { text }),
  setText(node, text) { node.text = text; },
  setElementText(node, text) { node.children.forEach(child => { child.parent = null; }); node.children = []; node.text = text; },
  patchProp(node, key, _previous, value) { node.props[key] = value; },
  insert,
  remove(node) {
    if (!node.parent) return;
    const index = node.parent.children.indexOf(node);
    if (index >= 0) node.parent.children.splice(index, 1);
    node.parent = null;
  },
  parentNode: node => node.parent,
  nextSibling(node) {
    if (!node.parent) return null;
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null;
  },
  insertStaticContent(content, parent, anchor) {
    const node = Object.assign(hostNode("#static", "static"), { text: content });
    insert(node, parent, anchor);
    return [node, node];
  },
});
const testVueRuntime = {
  ...Vue,
  vModelText: {
    created(element, binding, vnode) {
      element.value = binding.value ?? "";
      const assign = vnode.props?.["onUpdate:modelValue"];
      if (assign) element.addEventListener("input", event => assign(event.target.value));
    },
    beforeUpdate(element, binding) { element.value = binding.value ?? ""; },
  },
};

function visit(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = visit(child, predicate);
    if (found) return found;
  }
  return null;
}

function nodeText(node) {
  return node.text + node.children.map(nodeText).join("");
}

function clickButton(root, label) {
  const button = visit(root, node => node.tag === "button"
    && (node.props["aria-label"] === label || nodeText(node).trim() === label));
  assert.ok(button, `button ${label} exists in the rendered editor; rendered text: ${nodeText(root)}`);
  assert.equal(typeof button.props.onClick, "function", `button ${label} has a click handler`);
  button.props.onClick({ type: "click", target: button });
}

function changeSelect(root, index, value) {
  const selects = [];
  const collect = node => {
    if (node.tag === "select") selects.push(node);
    node.children.forEach(collect);
  };
  collect(root);
  const select = selects[index];
  assert.ok(select, `select ${index} exists in the rendered editor`);
  assert.equal(typeof select.props.onChange, "function");
  select.props.onChange({ type: "change", target: { value } });
}

function editTextarea(root, value) {
  const textarea = visit(root, node => node.tag === "textarea");
  assert.ok(textarea, "JSON editor is rendered");
  textarea.value = value;
  textarea.dispatchEvent({ type: "input", target: textarea });
}

before(async () => {
  vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../", import.meta.url)),
    plugins: [vuePlugin()],
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
  ({ default: SkinPluginEditor } = await vite.ssrLoadModule("/src/components/SkinPluginEditor.vue"));
  const require = createRequire(import.meta.url);
  const { parse, compileScript, compileTemplate } = require("../node_modules/@vue/compiler-sfc");
  const filename = fileURLToPath(new URL("../src/components/SkinPluginEditor.vue", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const { descriptor } = parse(source, { filename });
  const script = compileScript(descriptor, { id: "skin-plugin-editor-test" });
  const templateSource = descriptor.template.content.replaceAll("($event.target as HTMLSelectElement).value", "($event.target).value");
  const template = compileTemplate({ source: templateSource, filename, id: "skin-plugin-editor-test", compilerOptions: { expressionPlugins: ["typescript"], bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, [], "the editor template compiles for client rendering");
  const vueImport = /^import \{([\s\S]*?)\} from "vue"\s*/.exec(template.code);
  assert.ok(vueImport, "compiled template imports Vue runtime helpers");
  const vueBindings = vueImport[1].split(",").map(binding => binding.trim().replace(" as ", ": ")).join(", ");
  const clientRenderCode = `const { ${vueBindings} } = Vue;\n${template.code.slice(vueImport[0].length).replace("export function render", "return function render")}`;
  SkinPluginEditor.render = new Function("Vue", clientRenderCode)(testVueRuntime);
  authoring = await vite.ssrLoadModule("/src/services/skin-plugin-authoring.ts");
});

after(async () => {
  await vite?.close();
  if (localStorageDescriptor) Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("component editor creates, changes, and deletes a skin component tree through its UI", async () => {
  focusedNode = null;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  const baseDocument = {
    schemaVersion: 3,
    components: [{
      id: "base-panel",
      name: "Base panel",
      page: "voice",
      accessibleName: "Base panel",
      permissions: [],
      actions: {},
      root: { tag: "section", children: [{ text: "Base" }] },
    }],
  };
  const props = {
    skinId: "community.example",
    skinVersion: "1.0.0",
    baseDocument,
    page: "voice",
    lang: "zh",
  };
  const html = await renderToString(createSSRApp(SkinPluginEditor, props));
  assert.match(html, /组件结构/);

  const root = hostNode("root");
  const app = renderer.createApp(SkinPluginEditor, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);

  try {
    clickButton(root, "组件结构");
    await nextTick();
    await nextTick();
    assert.equal(app._instance.setupState.open, true, "the trigger opens the editor");
    assert.equal(focusedNode?.props["aria-label"], "关闭", "opening moves keyboard focus to the close control");
    assert.equal(visit(root, node => node.tag === "button" && nodeText(node).trim() === "组件结构")?.props["aria-expanded"], true);
    clickButton(root, "新增组件");
    await nextTick();
    const key = authoring.getSkinPluginAuthoringStorageKey("community.example", "1.0.0");
    let edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components.length, 2);
    assert.equal(edited.components[1].id, "custom-component-1");

    clickButton(root, "组件上移");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["custom-component-1", "base-panel"]);

    clickButton(root, "添加子节点");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children.length, 2);
    assert.ok(localStorage.getItem(key));

    changeSelect(root, 1, "0");
    await nextTick();
    editTextarea(root, JSON.stringify({ text: "Edited in the component editor" }, null, 2));
    await nextTick();
    clickButton(root, "应用定义");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children[0].text, "Edited in the component editor");

    clickButton(root, "撤销");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children[0].text, "新建组件");
    clickButton(root, "重做");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children[0].text, "Edited in the component editor");

    clickButton(root, "删除组件");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["base-panel"]);

    changeSelect(root, 0, "base-panel");
    await nextTick();
    clickButton(root, "复制组件");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["base-panel", "base-panel-2"]);

    changeSelect(root, 0, "base-panel");
    await nextTick();
    changeSelect(root, 1, "0");
    await nextTick();
    clickButton(root, "删除组件");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["base-panel-2"]);

    clickButton(root, "新增组件");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[1].id, "custom-component-1");
    assert.match(nodeText(root), /组件定义/, "creating after deleting a component from node mode selects the component definition");
    assert.match(visit(root, node => node.tag === "textarea").value, /"id": "custom-component-1"/);

    changeSelect(root, 1, "0");
    await nextTick();
    const importInput = visit(root, node => node.tag === "input");
    assert.ok(importInput);
    const importedDocument = {
      schemaVersion: 3,
      components: [{
        id: "imported-panel", name: "Imported panel", page: "voice", accessibleName: "Imported panel",
        permissions: [], actions: {}, root: { tag: "section", children: [{ text: "Imported" }] },
      }],
    };
    await importInput.props.onChange({ target: { files: [new File([JSON.stringify(importedDocument)], "components.json")], value: "components.json" } });
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["imported-panel"]);
    assert.match(visit(root, node => node.tag === "textarea").value, /"id": "imported-panel"/,
      "importing from node mode selects the imported component definition");

    const panel = visit(root, node => node.tag === "section" && node.props.role === "dialog");
    assert.ok(panel);
    assert.equal(panel.props["aria-modal"], "false");
    panel.props.onKeydown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    await nextTick();
    await nextTick();
    assert.equal(visit(root, node => node.tag === "section" && node.props.role === "dialog"), null,
      "Escape closes the editor dialog");
    assert.equal(nodeText(focusedNode), "组件结构", "closing returns keyboard focus to the trigger");
  } finally {
    app.unmount();
  }
});
