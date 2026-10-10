import { computed, defineComponent, Fragment, h, onUnmounted, reactive, ref, Teleport, watch, type PropType, type VNodeChild } from "vue";
import {
  SKIN_PLUGIN_COMPONENT_LIMIT,
  SKIN_PLUGIN_PERMISSIONS,
  SKIN_PLUGIN_RENDER_NODE_LIMIT,
  SKIN_PLUGIN_REPEAT_LIMIT,
  listSkinPluginAssetPaths,
  parseSkinPluginDocument,
  type SkinPluginActionDefinition,
  type SkinPluginComponent,
  type SkinPluginComponentMode,
  type SkinPluginDocument,
  type SkinPluginHostWidget,
  type SkinPluginNode,
  type SkinPluginWidgetOptions,
  type SkinPluginPermission,
} from "../../../src/shared/skin-plugin.js";
import { parseSkinExtensionUiOutput } from "../../../src/shared/skin-extension-ui.js";
import { parseSkinExtensionUiInput } from "../../../src/shared/skin-extension-ui-input.js";
import { approveSkinPluginComponents, getMissingSkinPluginApprovals, isSkinPluginComponentApproved, revokeSkinPluginApprovals } from "../services/skin-plugin-approval.js";
import { createSkinPluginAssetUrlCache } from "../services/skin-plugin-asset-urls.js";

type Scalar = string | number | boolean;
type SafeContext = Record<string, unknown>;
type HostAction = (args: Record<string, Scalar>, component: SkinPluginComponent) => void | Promise<void>;
type HostWidget = (options?: SkinPluginWidgetOptions) => VNodeChild;

const eventProps: Record<string, string> = {
  click: "onClick", dblclick: "onDblclick", change: "onChange", input: "onInput", submit: "onSubmit", keydown: "onKeydown", keyup: "onKeyup",
  contextmenu: "onContextmenu", focus: "onFocus", blur: "onBlur", pointerdown: "onPointerdown", pointerup: "onPointerup",
  pointerenter: "onPointerenter", pointerleave: "onPointerleave", dragstart: "onDragstart", dragover: "onDragover", drop: "onDrop",
};

const svgAttributeNames: Record<string, string> = {
  basefrequency: "baseFrequency", clippathunits: "clipPathUnits", diffuseconstant: "diffuseConstant", edgemode: "edgeMode",
  filterunits: "filterUnits", gradienttransform: "gradientTransform", gradientunits: "gradientUnits", kernelmatrix: "kernelMatrix",
  kernelunitlength: "kernelUnitLength", lengthadjust: "lengthAdjust", markerheight: "markerHeight", markerunits: "markerUnits",
  markerwidth: "markerWidth", numoctaves: "numOctaves", pathlength: "pathLength", pointsatx: "pointsAtX", pointsaty: "pointsAtY",
  pointsatz: "pointsAtZ", preserveaspectratio: "preserveAspectRatio", primitiveunits: "primitiveUnits", refx: "refX", refy: "refY",
  specularconstant: "specularConstant", specularexponent: "specularExponent", spreadmethod: "spreadMethod", startoffset: "startOffset",
  textlength: "textLength", viewbox: "viewBox",
};

export default defineComponent({
  name: "SkinPluginOutlet",
  props: {
    skinId: { type: String, required: true },
    skinVersion: { type: String, required: true },
    document: { type: Object as PropType<SkinPluginDocument>, required: true },
    extensionOutput: { type: String as PropType<string | null>, default: null },
    extensionMode: { type: String as PropType<SkinPluginComponentMode | undefined>, default: undefined },
    extensionPermissions: { type: Array as PropType<readonly SkinPluginPermission[]>, default: () => [] },
    componentNamespace: { type: String, default: "" },
    manageSurfaceRecovery: { type: Boolean, default: true },
    page: { type: String as PropType<"home" | "voice" | "demo">, required: true },
    data: { type: Object as PropType<SafeContext>, required: true },
    assets: { type: Object as PropType<Record<string, Blob>>, required: true },
    actions: { type: Object as PropType<Record<string, HostAction>>, required: true },
    widgets: { type: Object as PropType<Partial<Record<SkinPluginHostWidget, HostWidget>>>, default: () => ({}) },
  },
  emits: {
    "surface-change": (_active: boolean) => typeof _active === "boolean",
    "restore-skin": () => true,
    "extension-event": (_payload: unknown) => true,
  },
  setup(props, { emit }) {
    const denied = ref(false);
    const surfaceSuppressed = ref(false);
    const manageOpen = ref(false);
    const refresh = ref(0);
    const stateByComponent = reactive<Record<string, Record<string, Scalar>>>({});
    const assetUrls = createSkinPluginAssetUrlCache();
    const validatedDocument = computed(() => {
      let document: SkinPluginDocument;
      const emptyRuntimeBase = Boolean(props.extensionOutput)
        && props.document.schemaVersion === 3
        && Array.isArray(props.document.components)
        && props.document.components.length === 0;
      try {
        // Runtime plugins use an empty v3 base document so their validated generated output
        // can flow through the same approval, layout, and rendering path as packaged components.
        document = emptyRuntimeBase
          ? { schemaVersion: 3, components: [] }
          : parseSkinPluginDocument(props.document);
      }
      catch { return { schemaVersion: 2 as const, components: [] }; }
      if (!props.extensionOutput || document.schemaVersion !== 3) return document;
      try {
        const parsedExtensionDocument = parseSkinExtensionUiOutput(props.extensionOutput, { permissions: props.extensionPermissions });
        const extensionDocument = props.extensionMode
          ? { ...parsedExtensionDocument, components: parsedExtensionDocument.components.map((component) => ({ ...component, mode: props.extensionMode })) }
          : parsedExtensionDocument;
        const ids = new Set(document.components.map((component) => component.id));
        if (document.components.length + extensionDocument.components.length > SKIN_PLUGIN_COMPONENT_LIMIT
          || extensionDocument.components.some((component) => ids.has(component.id))) return document;
        return { schemaVersion: 3 as const, components: [...document.components, ...extensionDocument.components] };
      } catch {
        // Dynamic output is optional; an invalid or colliding result leaves the package UI intact.
        return document;
      }
    });
    const matchingComponents = computed(() => validatedDocument.value.components.filter((component) => component.page === props.page));
    const pendingApproval = computed(() => {
      refresh.value;
      return denied.value ? [] : getMissingSkinPluginApprovals(props.skinId, props.skinVersion, { ...validatedDocument.value, components: matchingComponents.value });
    });
    const accessComponents = computed(() => pendingApproval.value.length
      ? pendingApproval.value
      : matchingComponents.value.filter((component) => component.permissions.length > 0));
    const activeComponents = computed(() => {
      refresh.value;
      return matchingComponents.value.filter((component) => isSkinPluginComponentApproved(props.skinId, props.skinVersion, component));
    });
    const surfaceCandidate = computed(() => activeComponents.value.find((component) => component.mode === "surface") ?? null);
    const activeSurface = computed(() => surfaceSuppressed.value ? null : surfaceCandidate.value);
    const renderedComponents = computed(() => activeComponents.value.filter((component) =>
      component.mode !== "surface" || component !== surfaceCandidate.value || !surfaceSuppressed.value));

    watch(() => [props.skinId, props.skinVersion, props.document, props.extensionOutput, props.extensionMode, props.componentNamespace, props.page], () => {
      denied.value = false;
      surfaceSuppressed.value = false;
      refresh.value += 1;
    }, { immediate: true });
    watch(() => [props.skinId, props.skinVersion, props.assets] as const, () => assetUrls.clear());
    watch(renderedComponents, (components) => {
      assetUrls.retain(listSkinPluginAssetPaths({ schemaVersion: 3, components }));
      const activeStateKeys = new Set(components.map(componentStateKey));
      for (const key of Object.keys(stateByComponent)) {
        if (!activeStateKeys.has(key)) delete stateByComponent[key];
      }
    }, { immediate: true });
    watch(activeSurface, (surface) => emit("surface-change", Boolean(surface)), { immediate: true, flush: "sync" });

    function componentStateKey(component: SkinPluginComponent): string {
      return JSON.stringify([props.skinId, props.skinVersion, props.componentNamespace, component.id]);
    }

    function localState(component: SkinPluginComponent): Record<string, Scalar> {
      const key = componentStateKey(component);
      const defaults = component.state ?? {};
      let state = stateByComponent[key];
      if (!state) {
        state = { ...defaults };
        stateByComponent[key] = state;
        return state;
      }
      for (const stateKey of Object.keys(state)) {
        if (!Object.hasOwn(defaults, stateKey)) delete state[stateKey];
      }
      for (const [stateKey, value] of Object.entries(defaults)) {
        if (!Object.hasOwn(state, stateKey) || typeof state[stateKey] !== typeof value) state[stateKey] = value;
      }
      return state;
    }

    function permissionLabel(permission: string): string {
      return SKIN_PLUGIN_PERMISSIONS[permission as keyof typeof SKIN_PLUGIN_PERMISSIONS]?.description ?? permission;
    }

    function resolvePath(path: string, context: SafeContext, state: Record<string, Scalar>): unknown {
      const normalized = path.replace(/^\{\{\s*|\s*\}\}$/g, "");
      const parts = normalized.split(".");
      let value: unknown = parts[0] === "state" ? state : context;
      const start = parts[0] === "state" ? 1 : 0;
      for (let index = start; index < parts.length; index += 1) {
        if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, parts[index])) return undefined;
        value = (value as Record<string, unknown>)[parts[index]];
      }
      return value;
    }

    function interpolate(value: string, context: SafeContext, state: Record<string, Scalar>): string {
      return value.replace(/\{\{\s*([a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,5})\s*\}\}/g, (_match, path: string) => {
        const resolved = resolvePath(path, context, state);
        return typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean" ? String(resolved) : "";
      });
    }

    function resolveActionArgs(definition: SkinPluginActionDefinition, context: SafeContext, state: Record<string, Scalar>): Record<string, Scalar> {
      const args: Record<string, Scalar> = {};
      for (const [key, value] of Object.entries(definition.args)) {
        if (typeof value !== "string") { args[key] = value; continue; }
        const exact = /^\{\{\s*([a-z][a-z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,5})\s*\}\}$/.exec(value);
        const resolved = exact ? resolvePath(exact[1], context, state) : interpolate(value, context, state);
        if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") args[key] = resolved;
      }
      return args;
    }

    function dispatch(component: SkinPluginComponent, actionId: string, context: SafeContext, state: Record<string, Scalar>): void {
      const definition = component.actions[actionId];
      if (!definition || !isSkinPluginComponentApproved(props.skinId, props.skinVersion, component)) return;
      const args = resolveActionArgs(definition, context, state);
      if (definition.type === "ui.setState") {
        if (typeof args.key === "string" && component.state && Object.hasOwn(component.state, args.key) && "value" in args) state[args.key] = args.value;
        return;
      }
      if (definition.type === "ui.toggleState") {
        if (typeof args.key === "string" && component.state && Object.hasOwn(component.state, args.key) && typeof state[args.key] === "boolean") {
          state[args.key] = !state[args.key];
        }
        return;
      }
      const handler = props.actions[definition.type];
      if (handler) void Promise.resolve(handler(args, component)).catch(() => undefined);
    }

    function dispatchRuntimeCallback(component: SkinPluginComponent, handlerId: string, eventName: string, event: Event, state: Record<string, Scalar>): void {
      if (!component.runtimeCallbacks) return;
      const callbackEvent: Record<string, unknown> = { componentId: component.id, handlerId, eventName };
      if (typeof KeyboardEvent !== "undefined" && event instanceof KeyboardEvent) callbackEvent.key = event.key;
      const mayReadUserInput = props.extensionPermissions.includes("ui.input.read");
      if (mayReadUserInput && (eventName === "input" || eventName === "change") && event.target instanceof HTMLInputElement) {
        if (["password", "file", "hidden"].includes(event.target.type)) return;
        if (event.target.type === "checkbox") callbackEvent.checked = event.target.checked;
        else if (event.target.value.length <= 2_048) callbackEvent.value = event.target.value;
      } else if (mayReadUserInput && (eventName === "input" || eventName === "change") && event.target instanceof HTMLTextAreaElement) {
        if (event.target.value.length <= 2_048) callbackEvent.value = event.target.value;
      } else if (mayReadUserInput && (eventName === "input" || eventName === "change") && event.target instanceof HTMLSelectElement
        && event.target.value.length <= 2_048) {
        callbackEvent.value = event.target.value;
      }
      try {
        const input = parseSkinExtensionUiInput({ schemaVersion: 1, state: { ...state }, event: callbackEvent });
        emit("extension-event", { skinId: props.skinId, componentId: component.id, input });
      } catch {
        // Overlarge or malformed local state stays local and is not passed to the extension guest.
      }
    }

    function assetUrl(path: string): string | undefined {
      return assetUrls.resolve(path, props.assets);
    }

    function layoutComponentPath(component: SkinPluginComponent): string {
      return props.componentNamespace ? `runtime_plugin_${props.componentNamespace}__${component.id}` : component.id;
    }

    function layoutPart(component: SkinPluginComponent, node: SkinPluginNode, nodePath: string): string {
      const interactive = ["a", "button", "input", "select", "summary", "textarea"].includes(node.tag ?? "")
        || node.widget === "voice.screen-share-start"
        || node.attributes?.role === "button"
        || ["click", "dblclick", "contextmenu", "keydown", "keyup", "pointerdown", "pointerup", "drop"]
          .some((eventName) => Boolean(node.events?.[eventName as keyof typeof node.events]));
      const part = node.part ? `part-${node.part}` : nodePath;
      const componentPath = layoutComponentPath(component);
      return `skin.${component.page}.${componentPath}.${interactive ? "control-" : ""}${part}`;
    }

    function renderNode(component: SkinPluginComponent, node: SkinPluginNode, context: SafeContext, state: Record<string, Scalar>, budget: { remaining: number }, skipRepeat = false, nodePath = "node-root"): VNodeChild {
      if (budget.remaining <= 0) return null;
      budget.remaining -= 1;
      if (node.widget) {
        if (node.when) {
          const value = resolvePath(node.when.path, context, state);
          const expected = typeof node.when.equals === "string" ? interpolate(node.when.equals, context, state) : node.when.equals;
          if (node.when.empty !== undefined) {
            if (!Array.isArray(value) || (value.length === 0) !== node.when.empty) return null;
          } else if (expected !== undefined ? value !== expected : !value) return null;
        }
        const widget = props.widgets[node.widget];
        if (!widget) return null;
        return h("div", {
          class: ["ws-plugin-host-widget", node.className],
          "data-ws-plugin-widget": node.widget,
          "data-ws-plugin-part": node.part ? `${component.id}.${node.part}` : component.id,
          "data-ws-part": layoutPart(component, node, nodePath),
          "aria-label": component.accessibleName,
        }, [widget(node.options)]);
      }
      if (!node.tag) {
        const text = interpolate(node.text ?? "", context, state);
        return node.part ? h("span", {
          class: "ws-plugin-node",
          "data-ws-plugin-part": `${component.id}.${node.part}`,
          "data-ws-part": layoutPart(component, node, nodePath),
        }, text) : text;
      }
      if (!skipRepeat && node.repeat) {
        const values = resolvePath(node.repeat.path, context, state);
        if (!Array.isArray(values)) return null;
        const repeatLimit = props.document.schemaVersion >= 3 ? SKIN_PLUGIN_REPEAT_LIMIT : 100;
        return h(Fragment, null, values.slice(0, repeatLimit).map((value) => renderNode(component, node, { ...context, [node.repeat!.as]: value }, state, budget, true, nodePath)));
      }
      if (node.when) {
        const value = resolvePath(node.when.path, context, state);
        const expected = typeof node.when.equals === "string" ? interpolate(node.when.equals, context, state) : node.when.equals;
        if (node.when.empty !== undefined) {
          if (!Array.isArray(value) || (value.length === 0) !== node.when.empty) return null;
        } else if (expected !== undefined ? value !== expected : !value) return null;
      }
      const attrs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node.attributes ?? {})) {
        // data-ws-* belongs to host layout, page, and recovery machinery. Older
        // packages remain loadable, but their nodes cannot impersonate host hooks.
        if (key.startsWith("data-ws-")) continue;
        attrs[svgAttributeNames[key] ?? key] = typeof value === "string" ? interpolate(value, context, state) : value;
      }
      if (node.asset) {
        const url = assetUrl(node.asset);
        if (url) attrs.src = url;
      }
      if (node.className || attrs.class) {
        attrs.class = ["ws-plugin-node", node.className, attrs.class].filter(Boolean).join(" ");
      } else attrs.class = "ws-plugin-node";
      const componentPath = props.componentNamespace ? `${props.componentNamespace}.${component.id}` : component.id;
      attrs["data-ws-plugin-part"] = node.part ? `${componentPath}.${node.part}` : componentPath;
      attrs["data-ws-part"] = layoutPart(component, node, nodePath);
      if (node.bindValue) attrs.value = state[node.bindValue];

      for (const [eventName, actionId] of Object.entries(node.events ?? {})) {
        const propName = eventProps[eventName];
        if (!propName) continue;
        attrs[propName] = (event: Event) => {
          if (!event.isTrusted) return;
          if (!component.runtimeCallbacks && (eventName === "keydown" || eventName === "keyup") && event instanceof KeyboardEvent
            && event.key !== "Enter" && event.key !== " " && event.key !== "Escape") return;
          if (eventName === "contextmenu" || eventName === "dragover") event.preventDefault();
          if (node.bindValue && eventName === "input" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
            state[node.bindValue] = event.target instanceof HTMLInputElement && event.target.type === "checkbox" ? event.target.checked : event.target.value;
          } else if (node.bindValue && eventName === "change" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement)) {
            state[node.bindValue] = event.target instanceof HTMLInputElement && event.target.type === "checkbox" ? event.target.checked : event.target.value;
          }
          if (eventName === "submit") event.preventDefault();
          if (component.runtimeCallbacks) dispatchRuntimeCallback(component, actionId, eventName, event, state);
          else dispatch(component, actionId, context, state);
        };
      }
      if (node.bindValue && !node.events?.input && !node.events?.change) {
        attrs[node.tag === "input" ? "onInput" : "onChange"] = (event: Event) => {
          if (!event.isTrusted) return;
          const target = event.target;
          if (target instanceof HTMLInputElement) state[node.bindValue!] = target.type === "checkbox" ? target.checked : target.value;
          else if (target instanceof HTMLTextAreaElement) state[node.bindValue!] = target.value;
          else if (target instanceof HTMLSelectElement) state[node.bindValue!] = target.value;
        };
      }
      if (node.tag === "form" && !node.events?.submit) attrs.onSubmit = (event: Event) => event.preventDefault();
      const children = (node.children ?? []).map((child, index) => renderNode(component, child, context, state, budget, false, `${nodePath}-${index}`));
      // Custom element names are inert host-rendered placeholders. Never instantiate a page-registered
      // custom element from generated output, since its connectedCallback would run with page privileges.
      const tag = node.tag.includes("-") ? "div" : node.tag;
      if (tag !== node.tag) attrs["data-ws-generated-element"] = node.tag;
      return h(tag, attrs, children);
    }

    function accept(): void {
      approveSkinPluginComponents(props.skinId, props.skinVersion, pendingApproval.value);
      denied.value = false;
      manageOpen.value = false;
      refresh.value += 1;
    }

    function openAccessManager(): void {
      denied.value = false;
      manageOpen.value = true;
    }

    function closeOrDisable(): void {
      if (pendingApproval.value.length) denied.value = true;
      manageOpen.value = false;
    }

    function revokeAll(): void {
      revokeSkinPluginApprovals(props.skinId);
      denied.value = true;
      manageOpen.value = false;
      refresh.value += 1;
    }

    onUnmounted(() => assetUrls.clear());

    return () => {
      const nodes: VNodeChild[] = renderedComponents.value.map((component) => h("div", {
        key: `${props.skinId}:${component.id}`,
        class: ["ws-plugin-component", component.mode === "surface" && "ws-plugin-surface"],
        "data-ws-plugin-component": props.componentNamespace ? `${props.componentNamespace}.${component.id}` : component.id,
        "data-ws-plugin-name": component.name,
        "data-ws-plugin-part": props.componentNamespace ? `${props.componentNamespace}.${component.id}` : component.id,
        "data-ws-part": `skin.${component.page}.${layoutComponentPath(component)}`,
        ...(props.componentNamespace ? { "data-ws-runtime-plugin": props.componentNamespace } : {}),
        ...(component.mode === "surface" ? { "data-ws-plugin-surface": component.page } : {}),
        "aria-label": component.accessibleName,
      }, [renderNode(component, component.root, props.data, localState(component), { remaining: SKIN_PLUGIN_RENDER_NODE_LIMIT })]));
      const hasPermissions = matchingComponents.value.some((component) => component.permissions.length > 0);
      const showConsent = pendingApproval.value.length > 0 || manageOpen.value;
      const accessToggle = hasPermissions ? h(Teleport, { to: "body" }, [h("button", {
        type: "button",
        class: "ws-plugin-access-toggle",
        "aria-label": "管理皮肤组件权限 / Manage skin component access",
        onClick: openAccessManager,
      }, "权限 / Access")]) : null;
      const surfaceRecovery = activeSurface.value && props.manageSurfaceRecovery ? h(Teleport, { to: "body" }, [h("button", {
        type: "button",
        class: "ws-plugin-surface-recovery",
        "aria-label": "返回 WebSpeak 标准界面 / Return to the built-in interface",
        onClick: () => { surfaceSuppressed.value = true; },
      }, "标准界面 / Built-in UI")]) : null;
      const skinRecovery = activeSurface.value && props.manageSurfaceRecovery ? h(Teleport, { to: "body" }, [h("button", {
        type: "button",
        class: "ws-plugin-surface-reset",
        "aria-label": "恢复内置皮肤 / Restore the built-in skin",
        onClick: () => emit("restore-skin"),
      }, "恢复内置皮肤 / Reset skin")]) : null;
      const recoveryControls = [
        ...(surfaceRecovery ? [surfaceRecovery] : []),
        ...(skinRecovery ? [skinRecovery] : []),
      ];
      if (!showConsent) return h(Fragment, null, [...nodes, ...(accessToggle ? [accessToggle] : []), ...recoveryControls]);

      const requested = accessComponents.value;
      const hasMissing = pendingApproval.value.length > 0;
      const consent = h(Teleport, { to: "body" }, [h("div", { class: "ws-plugin-consent-backdrop", "data-ws-plugin-consent": "true" }, [
        h("section", { class: "ws-plugin-consent", role: "dialog", "aria-modal": "true", "aria-labelledby": "ws-plugin-consent-title" }, [
          h("h2", { id: "ws-plugin-consent-title" }, "皮肤组件权限 / Skin component access"),
          h("p", null, "此皮肤包含会读取公开语音界面数据或请求宿主动作的组件。只有你批准的组件才会启用。/ This skin requests limited access for its components. Only approved components will run."),
          ...requested.map((component) => h("div", { class: "ws-plugin-consent-item", key: component.id }, [
            h("strong", null, component.name),
            h("ul", null, component.permissions.map((permission) => h("li", { key: permission }, permissionLabel(permission)))),
          ])),
          h("p", { class: "ws-plugin-consent-note" }, "页面可以替换公开客户端外观；内置控件仍由 WebSpeak 处理。皮肤不能运行脚本、访问网络或存储，也不能读取连接地址、密码和身份材料。/ A surface can replace the public client UI while built-in controls remain host-owned. Skins cannot run code, access network or storage, or read connection targets, passwords, or identity material."),
          h("div", { class: "ws-plugin-consent-actions" }, [
            ...(hasMissing ? [h("button", { type: "button", class: "secondary", onClick: closeOrDisable }, "暂不启用 / Keep disabled")]
              : [h("button", { type: "button", class: "secondary", onClick: revokeAll }, "撤销全部授权 / Revoke all access")]),
            h("button", { type: "button", class: "primary", onClick: hasMissing ? accept : () => { manageOpen.value = false; } }, hasMissing ? "批准所列权限 / Approve listed access" : "关闭 / Close"),
          ]),
        ]),
      ])]);
      return h(Fragment, null, [...nodes, ...(accessToggle ? [accessToggle] : []), ...recoveryControls, consent]);
    };
  },
});
