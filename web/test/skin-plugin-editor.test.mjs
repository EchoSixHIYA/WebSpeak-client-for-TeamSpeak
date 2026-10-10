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
import { SKIN_PLUGIN_ALLOWED_ELEMENTS } from "../../src/shared/skin-plugin.js";

let vite;
let SkinPluginEditor;
let SkinPluginOutlet;
let authoring;
let approvals;
let focusedNode;
let supportsPopoverApi = true;
const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const hostNode = (tag, type = "element") => {
  const node = {
    tag, type, props: {}, text: "", children: [], parent: null, value: "", listeners: new Map(), popoverOpen: false,
    focus() { focusedNode = this; },
    setAttribute(name, value) { this.props[name] = value; },
    removeAttribute(name) { delete this.props[name]; },
    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    },
    removeEventListener(name, listener) {
      this.listeners.set(name, (this.listeners.get(name) ?? []).filter(candidate => candidate !== listener));
    },
    dispatchEvent(event) { for (const listener of this.listeners.get(event.type) ?? []) listener(event); },
  };
  if (supportsPopoverApi) node.showPopover = function () { this.popoverOpen = true; };
  return node;
};
const teleportRoot = hostNode("teleport-root");
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
  querySelector: selector => selector === "body" ? teleportRoot : null,
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
  ({ default: SkinPluginOutlet } = await vite.ssrLoadModule("/src/components/SkinPluginOutlet.ts"));
  approvals = await vite.ssrLoadModule("/src/services/skin-plugin-approval.ts");
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
  const ssrContext = {};
  const html = await renderToString(createSSRApp(SkinPluginEditor, props), ssrContext);
  assert.doesNotMatch(html, /组件结构/);
  assert.match(ssrContext.teleports.body, /组件结构/,
    "the editor controls are teleported outside the skin-rendered DOM tree");

  const root = hostNode("root");
  const hostView = Vue.defineComponent({
    setup() {
      return () => Vue.h("main", { class: "ws-skin-root", "data-ws-skin": props.skinId }, [
        Vue.h(SkinPluginEditor, props),
      ]);
    },
  });
  const app = renderer.createApp(hostView);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);

  try {
    assert.equal(visit(root, node => node.props["data-ws-plugin-editor"] !== undefined), null,
      "skin CSS cannot target the host-owned component editor");
    const teleportedEditor = visit(teleportRoot, node => node.props["data-ws-plugin-editor"] !== undefined);
    assert.ok(teleportedEditor);
    await nextTick();
    assert.equal(teleportedEditor.popoverOpen, true,
      "browsers with the Popover API keep the host editor above skin-authored stacking layers");
    clickButton(teleportRoot, "组件结构");
    await nextTick();
    await nextTick();
    assert.equal(focusedNode?.props["aria-label"], "关闭", "opening moves keyboard focus to the close control");
    assert.equal(visit(teleportRoot, node => node.tag === "button" && nodeText(node).trim() === "组件结构")?.props["aria-expanded"], true);
    clickButton(teleportRoot, "新增组件");
    await nextTick();
    const key = authoring.getSkinPluginAuthoringStorageKey("community.example", "1.0.0");
    let edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components.length, 2);
    assert.equal(edited.components[1].id, "custom-component-1");

    changeSelect(teleportRoot, 1, "root");
    await nextTick();
    assert.match(nodeText(teleportRoot), /节点定义/, "the root node has a distinct selectable entry in the tree");
    editTextarea(teleportRoot, JSON.stringify({ tag: "article", children: [{ text: "新建组件" }] }, null, 2));
    await nextTick();
    clickButton(teleportRoot, "应用定义");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[1].root.tag, "article",
      "selecting the root lets authors replace it through the ordinary node editor");

    changeSelect(teleportRoot, 2, "button");
    await nextTick();
    const nodeTypeOptions = visit(teleportRoot, node => node.tag === "select" && node.props["aria-label"] === "新增节点类型");
    assert.ok(nodeTypeOptions.children.some(option => option.props.value === "svg"),
      "the node type picker exposes the shared safe element set, including SVG");

    clickButton(teleportRoot, "组件上移");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["custom-component-1", "base-panel"]);

    clickButton(teleportRoot, "添加子节点");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children.length, 2);
    assert.equal(edited.components[0].root.children[1].tag, "button",
      "authors can add a selected safe element directly instead of hand-writing its node JSON");
    assert.ok(localStorage.getItem(key));

    clickButton(teleportRoot, "复制节点");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children.length, 3, "the editor duplicates the selected node as a sibling");
    clickButton(teleportRoot, "节点上移");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children[1].tag, "button", "the selected node moves within its parent");
    clickButton(teleportRoot, "节点下移");
    await nextTick();
    changeSelect(teleportRoot, 2, "text");
    await nextTick();
    clickButton(teleportRoot, "添加同级节点");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children.length, 4, "the editor adds a sibling beside the selected node");
    assert.equal(edited.components[0].root.children[3].text, "新建内容",
      "text nodes are available through the same authoring flow");
    clickButton(teleportRoot, "删除节点");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children.length, 3, "the editor deletes the selected node without deleting its parent");

    changeSelect(teleportRoot, 1, "0");
    await nextTick();
    editTextarea(teleportRoot, JSON.stringify({ text: "Edited in the component editor" }, null, 2));
    await nextTick();
    clickButton(teleportRoot, "应用定义");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children[0].text, "Edited in the component editor");

    clickButton(teleportRoot, "撤销");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children[0].text, "新建组件");
    clickButton(teleportRoot, "重做");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[0].root.children[0].text, "Edited in the component editor");

    clickButton(teleportRoot, "删除组件");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["base-panel"]);

    changeSelect(teleportRoot, 0, "base-panel");
    await nextTick();
    clickButton(teleportRoot, "复制组件");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["base-panel", "base-panel-2"]);

    changeSelect(teleportRoot, 0, "base-panel");
    await nextTick();
    changeSelect(teleportRoot, 1, "0");
    await nextTick();
    clickButton(teleportRoot, "删除组件");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.deepEqual(edited.components.map(component => component.id), ["base-panel-2"]);

    clickButton(teleportRoot, "新增组件");
    await nextTick();
    edited = authoring.loadSkinPluginAuthoringDocument("community.example", "1.0.0");
    assert.equal(edited.components[1].id, "custom-component-1");
    assert.match(nodeText(teleportRoot), /组件定义/, "creating after deleting a component from node mode selects the component definition");
    assert.match(visit(teleportRoot, node => node.tag === "textarea").value, /"id": "custom-component-1"/);

    changeSelect(teleportRoot, 1, "0");
    await nextTick();
    const importInput = visit(teleportRoot, node => node.tag === "input");
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
    assert.match(visit(teleportRoot, node => node.tag === "textarea").value, /"id": "imported-panel"/,
      "importing from node mode selects the imported component definition");

    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    let exportedBlob;
    let downloadedUrl;
    const downloadAnchor = { href: "", download: "", click() { downloadedUrl = this.href; } };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        document: { createElement: tag => { assert.equal(tag, "a"); return downloadAnchor; } },
        setTimeout: callback => { callback(); return 0; },
      },
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: blob => { exportedBlob = blob; return "blob:skin-export"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: url => { assert.equal(url, "blob:skin-export"); } });
    try {
      clickButton(teleportRoot, "导出 components.json");
      assert.equal(downloadAnchor.download, "community.example-components.json");
      assert.equal(downloadedUrl, "blob:skin-export", "the editor starts a local file download");
      assert.ok(exportedBlob instanceof Blob);
      assert.deepEqual(authoring.importSkinPluginAuthoringDocument(await exportedBlob.text()), edited,
        "the exported editor file round-trips through the same package validator");
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (previousCreateObjectURL) Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
      else Reflect.deleteProperty(URL, "createObjectURL");
      if (previousRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
      else Reflect.deleteProperty(URL, "revokeObjectURL");
    }

    const panel = visit(teleportRoot, node => node.tag === "section" && node.props.role === "dialog");
    assert.ok(panel);
    assert.equal(panel.props["aria-modal"], "false");
    panel.props.onKeydown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    await nextTick();
    await nextTick();
    assert.equal(visit(teleportRoot, node => node.tag === "section" && node.props.role === "dialog"), null,
      "Escape closes the editor dialog");
    assert.equal(nodeText(focusedNode), "组件结构", "closing returns keyboard focus to the trigger");
  } finally {
    app.unmount();
  }
});

test("the node picker can create and delete every schema-safe element and text node", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  const skinId = "community.node-picker";
  const skinVersion = "1.0.0";
  const baseDocument = { schemaVersion: 3, components: [] };
  const revision = Vue.ref(0);
  const editorProps = {
    skinId,
    skinVersion,
    page: "voice",
    lang: "zh",
    baseDocument,
  };
  const view = Vue.defineComponent({
    setup() {
      const currentDocument = () => {
        revision.value;
        return authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion) ?? baseDocument;
      };
      return () => Vue.h("main", null, [
        Vue.h(SkinPluginOutlet, {
          skinId,
          skinVersion,
          document: currentDocument(),
          page: "voice",
          data: {},
          assets: {},
          actions: {},
        }),
        Vue.h(SkinPluginEditor, { ...editorProps, onUpdated: () => { revision.value += 1; } }),
      ]);
    },
  });
  const root = hostNode("root");
  const app = renderer.createApp(view);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);

  try {
    clickButton(teleportRoot, "组件结构");
    await nextTick();
    await nextTick();
    clickButton(teleportRoot, "新增组件");
    await nextTick();

    const picker = visit(teleportRoot, node => node.tag === "select" && node.props["aria-label"] === "新增节点类型");
    assert.ok(picker);
    const choices = picker.children.filter(option => option.tag === "option").map(option => option.props.value);
    assert.deepEqual(choices, ["text", ...SKIN_PLUGIN_ALLOWED_ELEMENTS],
      "the editor picker stays in sync with the single schema allowlist");
    const renderedComponent = () => visit(root, node => node.props["data-ws-plugin-component"] === "custom-component-1");
    const countRendered = (node, predicate) => (predicate(node) ? 1 : 0) + node.children.reduce((count, child) => count + countRendered(child, predicate), 0);

    for (const type of choices) {
      changeSelect(teleportRoot, 1, "root");
      await nextTick();
      changeSelect(teleportRoot, 2, type);
      await nextTick();
      const initialComponentView = renderedComponent();
      assert.ok(initialComponentView);
      const initialRoot = initialComponentView.children[0];
      const isNewText = node => node.type === "text" && node.text === "新建内容";
      const isSelectedTag = node => node.tag === type;
      const initialCount = countRendered(initialRoot, type === "text" ? isNewText : isSelectedTag);
      clickButton(teleportRoot, "添加子节点");
      await nextTick();

      let edited = authoring.loadSkinPluginAuthoringDocument(skinId, "1.0.0");
      const added = edited.components[0].root.children.at(-1);
      if (type === "text") assert.deepEqual(added, { text: "新建内容" });
      else assert.equal(added.tag, type, `the picker creates <${type}>`);
      if (type === "img") assert.equal(added.attributes.alt, "皮肤图片");

      const componentView = renderedComponent();
      assert.ok(componentView, "the edited component remains mounted in the page preview");
      const componentRoot = componentView.children[0];
      assert.equal(countRendered(componentRoot, type === "text" ? isNewText : isSelectedTag), initialCount + 1,
        `adding ${type} updates the live preview`);
      if (type === "text") {
        assert.ok(visit(componentRoot, isNewText), "the authored text node is visible in the live preview");
      } else {
        assert.ok(visit(componentRoot, node => node.tag === type && node.props["data-ws-part"]?.endsWith("node-root-1")),
          `<${type}> receives a stable host layout target in the live preview`);
      }

      clickButton(teleportRoot, "删除节点");
      await nextTick();
      edited = authoring.loadSkinPluginAuthoringDocument(skinId, "1.0.0");
      assert.equal(edited.components[0].root.children.length, 1, `the created ${type} node can be deleted`);
      const afterDelete = renderedComponent()?.children[0];
      assert.equal(countRendered(afterDelete, type === "text" ? isNewText : isSelectedTag), initialCount,
        `deleting ${type} restores the previous live preview`);
    }
  } finally {
    app.unmount();
  }
});

test("corrupt local component edits can be cleared from the editor to restore package CRUD", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  const skinId = "community.corrupt-edits";
  const skinVersion = "1.0.0";
  const key = authoring.getSkinPluginAuthoringStorageKey(skinId, skinVersion);
  localStorage.setItem(key, "{not valid JSON");
  const props = {
    skinId,
    skinVersion,
    page: "voice",
    lang: "zh",
    baseDocument: {
      schemaVersion: 3,
      components: [{
        id: "package-component",
        name: "Package component",
        page: "voice",
        accessibleName: "Package component",
        permissions: [],
        actions: {},
        root: { tag: "section", children: [{ text: "Package content" }] },
      }],
    },
  };
  const root = hostNode("root");
  const app = renderer.createApp(SkinPluginEditor, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);

  try {
    clickButton(teleportRoot, "组件结构");
    await nextTick();
    await nextTick();
    assert.match(nodeText(teleportRoot), /本地修改无法通过校验/,
      "the editor explains that this skin version has invalid saved edits");
    const resetButton = visit(teleportRoot, node => node.tag === "button" && nodeText(node).trim() === "清除本地修改");
    assert.ok(resetButton);
    assert.equal(resetButton.props.disabled, false, "recovery remains enabled for corrupt saved edits");

    clickButton(teleportRoot, "清除本地修改");
    await nextTick();
    assert.equal(localStorage.getItem(key), null, "recovery clears only this skin version's saved edits");
    assert.match(nodeText(teleportRoot), /本地修改已清除/);

    clickButton(teleportRoot, "新增组件");
    await nextTick();
    const recovered = authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion);
    assert.deepEqual(recovered.components.map(component => component.id), ["package-component", "custom-component-1"],
      "the package document is restored and normal component editing works again");
  } finally {
    app.unmount();
  }
});

test("the first edit upgrades legacy v1 and v2 component packages to v3", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });

  for (const schemaVersion of [1, 2]) {
    const skinId = `community.legacy-v${schemaVersion}`;
    const baseDocument = {
      schemaVersion,
      components: [{
        id: `legacy-component-v${schemaVersion}`,
        name: `Legacy v${schemaVersion} component`,
        page: "voice",
        accessibleName: `Legacy v${schemaVersion} component`,
        permissions: [],
        actions: {},
        root: { tag: "section", children: [{ text: `Original schema v${schemaVersion}` }] },
      }],
    };
    const app = renderer.createApp(SkinPluginEditor, {
      skinId,
      skinVersion: "1.0.0",
      page: "voice",
      baseDocument,
    });
    app.provide(ssrContextKey, { modules: new Set() });
    app.mount(hostNode("root"));

    try {
      clickButton(teleportRoot, "组件结构");
      await nextTick();
      await nextTick();
      clickButton(teleportRoot, "新增组件");
      await nextTick();

      const saved = authoring.loadSkinPluginAuthoringDocument(skinId, "1.0.0");
      assert.equal(saved.schemaVersion, 3, `the first v${schemaVersion} edit is persisted as schema v3`);
      assert.deepEqual(saved.components.map(component => component.id), [
        `legacy-component-v${schemaVersion}`,
        "custom-component-1",
      ]);
      assert.equal(saved.components[0].root.children[0].text, `Original schema v${schemaVersion}`);
      assert.equal(baseDocument.schemaVersion, schemaVersion, "the package object stays unchanged while local edits migrate");
    } finally {
      app.unmount();
    }
  }
});

test("component editor stays visible in browsers without the Popover API", async () => {
  const previousSupport = supportsPopoverApi;
  supportsPopoverApi = false;
  const root = hostNode("root");
  const app = renderer.createApp(SkinPluginEditor, {
    skinId: "community.legacy-browser",
    skinVersion: "1.0.0",
    page: "voice",
    baseDocument: { schemaVersion: 3, components: [] },
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);

  try {
    await nextTick();
    const editor = visit(teleportRoot, node => node.props["data-ws-plugin-editor"] !== undefined);
    assert.ok(editor);
    assert.equal(editor.props.popover, undefined,
      "unsupported browsers use the ordinary fixed-position fallback instead of leaving an undisplayed popover");
  } finally {
    app.unmount();
    supportsPopoverApi = previousSupport;
  }
});

test("component runtime state is isolated by skin version and reset after deletion or schema changes", async () => {
  const skinId = "community.runtime-state-isolation";
  const component = {
    id: "stateful-panel",
    name: "Stateful panel",
    page: "voice",
    accessibleName: "Stateful panel",
    permissions: [],
    actions: { toggle: { type: "ui.toggleState", args: { key: "enabled" } } },
    state: { enabled: false },
    root: { tag: "section", children: [
      { tag: "button", events: { click: "toggle" }, children: [{ text: "Toggle" }] },
      { tag: "span", children: [{ text: "{{state.enabled}}" }] },
    ] },
  };
  const version = Vue.ref("1.0.0");
  const document = Vue.ref({ schemaVersion: 3, components: [component] });
  const hostView = Vue.defineComponent({
    setup() {
      return () => Vue.h(SkinPluginOutlet, {
        skinId,
        skinVersion: version.value,
        document: document.value,
        page: "voice",
        data: {},
        assets: {},
        actions: {},
      });
    },
  });
  const root = hostNode("root");
  const app = renderer.createApp(hostView);
  app.mount(root);

  const renderedComponent = () => visit(root, node => node.props["data-ws-plugin-component"] === component.id);
  const toggle = () => {
    const button = visit(renderedComponent(), node => node.tag === "button");
    assert.ok(button?.props.onClick, "the component's local toggle action is rendered");
    button.props.onClick({ type: "click", target: button, isTrusted: true });
  };

  try {
    await nextTick();
    assert.match(nodeText(renderedComponent()), /false/);
    toggle();
    await nextTick();
    assert.match(nodeText(renderedComponent()), /true/);

    version.value = "2.0.0";
    await nextTick();
    assert.match(nodeText(renderedComponent()), /false/,
      "a new skin version starts from its own declared component state");

    toggle();
    await nextTick();
    assert.match(nodeText(renderedComponent()), /true/);
    document.value = { schemaVersion: 3, components: [] };
    await nextTick();
    assert.equal(renderedComponent(), null, "deleting a component removes it from the active runtime");
    document.value = { schemaVersion: 3, components: [component] };
    await nextTick();
    assert.match(nodeText(renderedComponent()), /false/,
      "re-adding a deleted component does not revive its previous local state");

    document.value = { schemaVersion: 3, components: [{
      ...component,
      actions: {},
      state: { enabled: "closed" },
      root: { tag: "span", children: [{ text: "{{state.enabled}}" }] },
    }] };
    await nextTick();
    assert.match(nodeText(renderedComponent()), /closed/,
      "editing a state key's declared type applies the new default in the live preview");
  } finally {
    app.unmount();
  }
});

test("component create, update, and delete immediately change the rendered skin preview", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  const skinId = "community.preview";
  const skinVersion = "1.0.0";
  const baseDocument = { schemaVersion: 3, components: [] };
  const revision = Vue.ref(0);
  const props = { skinId, skinVersion, baseDocument, page: "voice", lang: "zh" };
  const preview = Vue.defineComponent({
    setup() {
      const currentDocument = () => {
        revision.value;
        return authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion) ?? baseDocument;
      };
      return () => Vue.h("main", null, [
        Vue.h(SkinPluginOutlet, {
          skinId,
          skinVersion,
          document: currentDocument(),
          page: "voice",
          data: {},
          assets: {},
          actions: {},
        }),
        Vue.h(SkinPluginEditor, { ...props, onUpdated: () => { revision.value += 1; } }),
      ]);
    },
  });
  const root = hostNode("root");
  const app = renderer.createApp(preview);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);

  try {
    clickButton(teleportRoot, "组件结构");
    await nextTick();
    await nextTick();
    clickButton(teleportRoot, "新增组件");
    await nextTick();

    let rendered = visit(root, node => node.props["data-ws-plugin-component"] === "custom-component-1");
    assert.ok(rendered, "the newly created component is rendered in the page preview");
    assert.match(nodeText(rendered), /新建组件/);

    changeSelect(teleportRoot, 1, "root");
    await nextTick();
    editTextarea(teleportRoot, JSON.stringify({ tag: "article", children: [{ text: "根节点已更新" }] }, null, 2));
    await nextTick();
    clickButton(teleportRoot, "应用定义");
    await nextTick();
    rendered = visit(root, node => node.props["data-ws-plugin-component"] === "custom-component-1");
    assert.equal(rendered.children[0].tag, "article", "editing the selected root replaces the live preview root");
    assert.match(nodeText(rendered), /根节点已更新/);

    const saved = authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion);
    const updated = {
      ...saved.components[0],
      name: "Preview component",
      accessibleName: "Preview component",
      root: { tag: "section", children: [{ text: "预览已更新" }, { tag: "span", children: [{ text: "尾部" }] }] },
    };
    changeSelect(teleportRoot, 1, "");
    await nextTick();
    editTextarea(teleportRoot, JSON.stringify(updated, null, 2));
    await nextTick();
    clickButton(teleportRoot, "应用定义");
    await nextTick();

    rendered = visit(root, node => node.props["data-ws-plugin-component"] === "custom-component-1");
    assert.ok(rendered);
    assert.match(nodeText(rendered), /预览已更新/, "applying a component definition updates the rendered preview immediately");

    changeSelect(teleportRoot, 1, "0");
    await nextTick();
    clickButton(teleportRoot, "节点下移");
    await nextTick();
    let reordered = authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion);
    assert.deepEqual(reordered.components[0].root.children.map(node => node.text ?? node.tag), ["span", "预览已更新"]);
    rendered = visit(root, node => node.props["data-ws-plugin-component"] === "custom-component-1");
    assert.ok(nodeText(rendered).indexOf("尾部") < nodeText(rendered).indexOf("预览已更新"),
      "reordering nodes also changes their actual preview order");

    clickButton(teleportRoot, "撤销");
    await nextTick();
    reordered = authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion);
    assert.deepEqual(reordered.components[0].root.children.map(node => node.text ?? node.tag), ["预览已更新", "span"]);
    rendered = visit(root, node => node.props["data-ws-plugin-component"] === "custom-component-1");
    assert.ok(nodeText(rendered).indexOf("预览已更新") < nodeText(rendered).indexOf("尾部"),
      "undo restores both the saved component tree and its preview");

    clickButton(teleportRoot, "重做");
    await nextTick();
    reordered = authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion);
    assert.deepEqual(reordered.components[0].root.children.map(node => node.text ?? node.tag), ["span", "预览已更新"]);
    rendered = visit(root, node => node.props["data-ws-plugin-component"] === "custom-component-1");
    assert.ok(nodeText(rendered).indexOf("尾部") < nodeText(rendered).indexOf("预览已更新"),
      "redo restores both the reordered tree and its preview");

    clickButton(teleportRoot, "删除组件");
    await nextTick();
    assert.equal(visit(root, node => node.props["data-ws-plugin-component"] === "custom-component-1"), null,
      "deleting the component removes it from the rendered page preview");
  } finally {
    app.unmount();
  }
});

test("deleting the final image node releases its URL and outlet teardown releases remaining assets", async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created = [];
  const revoked = [];
  URL.createObjectURL = () => {
    const url = `blob:skin-outlet-${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => { revoked.push(url); };

  const skinId = "community.asset-cleanup";
  const skinVersion = "1.0.0";
  const image = {
    id: "image-panel",
    name: "Image panel",
    page: "voice",
    accessibleName: "Image panel",
    permissions: [],
    actions: {},
    root: { tag: "section", children: [{ tag: "img", asset: "assets/icon.png" }] },
  };
  const document = Vue.ref({ schemaVersion: 3, components: [image] });
  const assets = { "assets/icon.png": new Blob(["icon"]) };
  const view = Vue.defineComponent({
    setup() {
      return () => Vue.h(SkinPluginOutlet, {
        skinId,
        skinVersion,
        document: document.value,
        page: "voice",
        data: {},
        assets,
        actions: {},
      });
    },
  });
  const root = hostNode("root");
  const app = renderer.createApp(view);
  app.provide(ssrContextKey, { modules: new Set() });

  try {
    app.mount(root);
    await nextTick();
    const firstImage = visit(root, node => node.tag === "img");
    assert.equal(firstImage?.props.src, "blob:skin-outlet-1");

    document.value = { schemaVersion: 3, components: [{ ...image, root: { tag: "section" } }] };
    await nextTick();
    assert.deepEqual(revoked, ["blob:skin-outlet-1"],
      "removing the final node reference releases the asset URL while keeping its component mounted");
    assert.ok(visit(root, node => node.props["data-ws-plugin-component"] === "image-panel"));
    assert.equal(visit(root, node => node.tag === "img"), null);

    document.value = { schemaVersion: 3, components: [image] };
    await nextTick();
    assert.equal(visit(root, node => node.tag === "img")?.props.src, "blob:skin-outlet-2",
      "re-adding the component receives a fresh object URL");

    app.unmount();
    assert.deepEqual(revoked, ["blob:skin-outlet-1", "blob:skin-outlet-2"],
      "outlet teardown releases every remaining asset URL");
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("deleting the last surface component immediately restores the host page", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  const skinId = "community.surface";
  const skinVersion = "1.0.0";
  const baseDocument = {
    schemaVersion: 3,
    components: [{
      id: "full-surface",
      name: "Full surface",
      page: "voice",
      mode: "surface",
      accessibleName: "Full voice page",
      permissions: ["ui.surface.replace"],
      actions: {},
      root: { tag: "main", children: [{ text: "Custom voice surface" }] },
    }],
  };
  approvals.approveSkinPluginComponents(skinId, skinVersion, baseDocument.components);
  const revision = Vue.ref(0);
  const surfaceActive = Vue.ref(false);
  const props = { skinId, skinVersion, baseDocument, page: "voice", lang: "zh" };
  const preview = Vue.defineComponent({
    setup() {
      const currentDocument = () => {
        revision.value;
        return authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion) ?? baseDocument;
      };
      return () => Vue.h("main", null, [
        surfaceActive.value ? null : Vue.h("section", { "data-native-host": "true" }, "WebSpeak host page"),
        Vue.h(SkinPluginOutlet, {
          skinId,
          skinVersion,
          document: currentDocument(),
          page: "voice",
          data: {},
          assets: {},
          actions: {},
          manageSurfaceRecovery: false,
          onSurfaceChange: (active) => { surfaceActive.value = active; },
        }),
        Vue.h(SkinPluginEditor, { ...props, onUpdated: () => { revision.value += 1; } }),
      ]);
    },
  });
  const root = hostNode("root");
  const app = renderer.createApp(preview);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);

  try {
    await nextTick();
    assert.equal(surfaceActive.value, true, "the approved surface replaces the host page");
    assert.equal(visit(root, node => node.props["data-native-host"] === "true"), null);

    clickButton(teleportRoot, "组件结构");
    await nextTick();
    await nextTick();
    clickButton(teleportRoot, "删除组件");
    await nextTick();
    await nextTick();

    assert.equal(surfaceActive.value, false, "deleting the surface clears its active state");
    assert.equal(visit(root, node => node.props["data-ws-plugin-surface"] === "voice"), null);
    assert.match(nodeText(root), /WebSpeak host page/, "the host page is restored without requiring a skin reset");
  } finally {
    app.unmount();
  }
});

test("surface access can be refused, approved, and revoked from the host UI", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() });
  const skinId = "community.access-lifecycle";
  const skinVersion = "1.0.0";
  const surface = {
    id: "protected-surface",
    name: "Protected surface",
    page: "voice",
    mode: "surface",
    accessibleName: "Protected voice page",
    permissions: ["ui.surface.replace"],
    actions: { toggle: { type: "ui.toggleState", args: { key: "enabled" } } },
    state: { enabled: false },
    root: { tag: "main", children: [
      { text: "Protected custom page" },
      { tag: "button", events: { click: "toggle" }, children: [{ text: "Toggle state" }] },
      { tag: "span", children: [{ text: "{{state.enabled}}" }] },
    ] },
  };
  const baseDocument = { schemaVersion: 3, components: [surface] };
  const props = { skinId, skinVersion, baseDocument, page: "voice", lang: "zh" };
  const hostView = Vue.defineComponent({
    setup() {
      const surfaceActive = Vue.ref(false);
      const revision = Vue.ref(0);
      const currentDocument = () => {
        revision.value;
        return authoring.loadSkinPluginAuthoringDocument(skinId, skinVersion) ?? baseDocument;
      };
      return () => Vue.h("main", null, [
        surfaceActive.value ? null : Vue.h("section", { "data-native-host": "true" }, "WebSpeak host page"),
        Vue.h(SkinPluginOutlet, {
          skinId,
          skinVersion,
          document: currentDocument(),
          page: "voice",
          data: {},
          assets: {},
          actions: {},
          onSurfaceChange: (active) => { surfaceActive.value = active; },
        }),
        Vue.h(SkinPluginEditor, { ...props, onUpdated: () => { revision.value += 1; } }),
      ]);
    },
  });
  const root = hostNode("root");
  const app = renderer.createApp(hostView);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(root);

  try {
    await nextTick();
    assert.match(nodeText(teleportRoot), /Replace the built-in public page/,
      "the host asks for approval before showing the surface permission");
    assert.equal(visit(root, node => node.props["data-native-host"] === "true")?.text, "WebSpeak host page",
      "the built-in page remains visible before consent");
    assert.equal(visit(root, node => node.props["data-ws-plugin-surface"] === "voice"), null);

    clickButton(teleportRoot, "暂不启用 / Keep disabled");
    await nextTick();
    assert.equal(visit(teleportRoot, node => node.props["data-ws-plugin-consent"] === "true"), null,
      "refusal closes the consent prompt");
    assert.equal(visit(root, node => node.props["data-ws-plugin-surface"] === "voice"), null,
      "a refused surface does not render");
    assert.ok(visit(root, node => node.props["data-native-host"] === "true"),
      "refusal leaves the built-in page usable");

    clickButton(teleportRoot, "管理皮肤组件权限 / Manage skin component access");
    await nextTick();
    clickButton(teleportRoot, "批准所列权限 / Approve listed access");
    await nextTick();
    const activeSurface = visit(root, node => node.props["data-ws-plugin-surface"] === "voice");
    assert.ok(activeSurface, "the surface activates only after explicit approval");
    assert.match(nodeText(activeSurface), /Protected custom page/);
    assert.equal(visit(root, node => node.props["data-native-host"] === "true"), null);
    let stateToggle = visit(activeSurface, node => node.tag === "button");
    stateToggle.props.onClick({ type: "click", target: stateToggle, isTrusted: true });
    await nextTick();
    assert.match(nodeText(activeSurface), /true/, "approved UI interactions update component-local state");

    clickButton(teleportRoot, "组件结构");
    await nextTick();
    await nextTick();
    const original = baseDocument.components[0];
    const expanded = { ...original, permissions: [...original.permissions, "session.status.read"] };
    changeSelect(teleportRoot, 0, surface.id);
    await nextTick();
    editTextarea(teleportRoot, JSON.stringify(expanded, null, 2));
    await nextTick();
    clickButton(teleportRoot, "应用定义");
    await nextTick();
    await nextTick();
    assert.equal(visit(root, node => node.props["data-ws-plugin-surface"] === "voice"), null,
      "editing a component to request another permission disables its old approval");
    assert.ok(visit(root, node => node.props["data-native-host"] === "true"),
      "the host page returns while the changed permission request awaits consent");
    assert.equal(approvals.isSkinPluginComponentApproved(skinId, skinVersion, expanded), false);
    assert.ok(visit(teleportRoot, node => node.props["data-ws-plugin-consent"] === "true"),
      "the changed component is presented for renewed approval");
    clickButton(teleportRoot, "批准所列权限 / Approve listed access");
    await nextTick();
    let reapprovedSurface = visit(root, node => node.props["data-ws-plugin-surface"] === "voice");
    assert.ok(reapprovedSurface,
      "the updated surface activates after its expanded permission set is approved");
    assert.match(nodeText(reapprovedSurface), /false/, "a component awaiting new permissions does not retain its previous state");

    stateToggle = visit(reapprovedSurface, node => node.tag === "button");
    stateToggle.props.onClick({ type: "click", target: stateToggle, isTrusted: true });
    await nextTick();
    assert.match(nodeText(reapprovedSurface), /true/);
    clickButton(teleportRoot, "管理皮肤组件权限 / Manage skin component access");
    await nextTick();
    clickButton(teleportRoot, "撤销全部授权 / Revoke all access");
    await nextTick();
    assert.equal(visit(root, node => node.props["data-ws-plugin-surface"] === "voice"), null,
      "revocation removes the active surface immediately");
    assert.ok(visit(root, node => node.props["data-native-host"] === "true"),
      "revocation restores the built-in page");
    assert.equal(approvals.isSkinPluginComponentApproved(skinId, skinVersion, surface), false,
      "revocation also removes the persisted component grant");

    clickButton(teleportRoot, "管理皮肤组件权限 / Manage skin component access");
    await nextTick();
    clickButton(teleportRoot, "批准所列权限 / Approve listed access");
    await nextTick();
    reapprovedSurface = visit(root, node => node.props["data-ws-plugin-surface"] === "voice");
    assert.ok(reapprovedSurface);
    assert.match(nodeText(reapprovedSurface), /false/, "revocation clears component-local state before the next approval");
  } finally {
    app.unmount();
  }
});
