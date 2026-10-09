import { computed, defineComponent, Fragment, h, onUnmounted, reactive, ref, Teleport, watch, type PropType, type VNodeChild } from "vue";
import {
  SKIN_PLUGIN_PERMISSIONS,
  parseSkinPluginDocument,
  type SkinPluginActionDefinition,
  type SkinPluginComponent,
  type SkinPluginDocument,
  type SkinPluginNode,
} from "../../../src/shared/skin-plugin.js";
import { approveSkinPluginComponents, getMissingSkinPluginApprovals, isSkinPluginComponentApproved, revokeSkinPluginApprovals } from "../services/skin-plugin-approval.js";

type Scalar = string | number | boolean;
type SafeContext = Record<string, unknown>;
type HostAction = (args: Record<string, Scalar>, component: SkinPluginComponent) => void | Promise<void>;

const eventProps: Record<string, string> = {
  click: "onClick", dblclick: "onDblclick", change: "onChange", input: "onInput", submit: "onSubmit", keydown: "onKeydown",
};

export default defineComponent({
  name: "SkinPluginOutlet",
  props: {
    skinId: { type: String, required: true },
    skinVersion: { type: String, required: true },
    document: { type: Object as PropType<SkinPluginDocument>, required: true },
    page: { type: String as PropType<"home" | "voice" | "demo">, required: true },
    data: { type: Object as PropType<SafeContext>, required: true },
    assets: { type: Object as PropType<Record<string, Blob>>, required: true },
    actions: { type: Object as PropType<Record<string, HostAction>>, required: true },
  },
  setup(props) {
    const denied = ref(false);
    const manageOpen = ref(false);
    const refresh = ref(0);
    const stateByComponent = reactive<Record<string, Record<string, Scalar>>>({});
    const objectUrls = new Map<string, string>();
    const validatedDocument = computed(() => {
      try { return parseSkinPluginDocument(props.document); }
      catch { return { schemaVersion: 1 as const, components: [] }; }
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

    watch(() => [props.skinId, props.skinVersion, props.document, props.page], () => { denied.value = false; refresh.value += 1; }, { immediate: true });

    function localState(component: SkinPluginComponent): Record<string, Scalar> {
      const key = `${props.skinId}/${component.id}`;
      if (!stateByComponent[key]) stateByComponent[key] = { ...(component.state ?? {}) };
      return stateByComponent[key];
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
      const handler = props.actions[definition.type];
      if (handler) void Promise.resolve(handler(args, component)).catch(() => undefined);
    }

    function assetUrl(path: string): string | undefined {
      const current = props.assets[path];
      if (!(current instanceof Blob)) return undefined;
      let url = objectUrls.get(path);
      if (!url) { url = URL.createObjectURL(current); objectUrls.set(path, url); }
      return url;
    }

    function renderNode(component: SkinPluginComponent, node: SkinPluginNode, context: SafeContext, state: Record<string, Scalar>, skipRepeat = false): VNodeChild {
      if (!node.tag) return interpolate(node.text ?? "", context, state);
      if (!skipRepeat && node.repeat) {
        const values = resolvePath(node.repeat.path, context, state);
        if (!Array.isArray(values)) return null;
        return h(Fragment, null, values.slice(0, 100).map((value) => renderNode(component, node, { ...context, [node.repeat!.as]: value }, state, true)));
      }
      if (node.when) {
        const value = resolvePath(node.when.path, context, state);
        if (node.when.equals !== undefined ? value !== node.when.equals : !value) return null;
      }
      const attrs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node.attributes ?? {})) {
        attrs[key === "viewbox" ? "viewBox" : key] = typeof value === "string" ? interpolate(value, context, state) : value;
      }
      if (node.asset) {
        const url = assetUrl(node.asset);
        if (url) attrs.src = url;
      }
      if (node.className || attrs.class) {
        attrs.class = ["ws-plugin-node", node.className, attrs.class].filter(Boolean).join(" ");
      } else attrs.class = "ws-plugin-node";
      attrs["data-ws-plugin-part"] = node.part ? `${component.id}.${node.part}` : component.id;
      if (node.bindValue) attrs.value = state[node.bindValue];

      for (const [eventName, actionId] of Object.entries(node.events ?? {})) {
        const propName = eventProps[eventName];
        if (!propName) continue;
        attrs[propName] = (event: Event) => {
          if (!event.isTrusted) return;
          if (eventName === "keydown" && event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
          if (node.bindValue && eventName === "input" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
            state[node.bindValue] = event.target instanceof HTMLInputElement && event.target.type === "checkbox" ? event.target.checked : event.target.value;
          } else if (node.bindValue && eventName === "change" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement)) {
            state[node.bindValue] = event.target instanceof HTMLInputElement && event.target.type === "checkbox" ? event.target.checked : event.target.value;
          }
          if (eventName === "submit") event.preventDefault();
          dispatch(component, actionId, context, state);
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
      const children = (node.children ?? []).map((child) => renderNode(component, child, context, state));
      return h(node.tag, attrs, children);
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

    onUnmounted(() => { objectUrls.forEach((url) => URL.revokeObjectURL(url)); objectUrls.clear(); });

    return () => {
      const nodes: VNodeChild[] = activeComponents.value.map((component) => h("div", {
        key: `${props.skinId}:${component.id}`,
        class: "ws-plugin-component",
        "data-ws-plugin-component": component.id,
        "data-ws-plugin-name": component.name,
        "data-ws-plugin-part": component.id,
        "aria-label": component.accessibleName,
      }, [renderNode(component, component.root, props.data, localState(component))]));
      const hasPermissions = matchingComponents.value.some((component) => component.permissions.length > 0);
      const showConsent = pendingApproval.value.length > 0 || manageOpen.value;
      const accessToggle = hasPermissions ? h(Teleport, { to: "body" }, [h("button", {
        type: "button",
        class: "ws-plugin-access-toggle",
        "aria-label": "管理皮肤组件权限 / Manage skin component access",
        onClick: openAccessManager,
      }, "权限 / Access")]) : null;
      if (!showConsent) return h(Fragment, null, [...nodes, ...(accessToggle ? [accessToggle] : [])]);

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
          h("p", { class: "ws-plugin-consent-note" }, "组件不能运行脚本、访问浏览器存储、读取连接地址/密码或控制麦克风。/ Components cannot run code, access storage or credentials, or control the microphone."),
          h("div", { class: "ws-plugin-consent-actions" }, [
            ...(hasMissing ? [h("button", { type: "button", class: "secondary", onClick: closeOrDisable }, "暂不启用 / Keep disabled")]
              : [h("button", { type: "button", class: "secondary", onClick: revokeAll }, "撤销全部授权 / Revoke all access")]),
            h("button", { type: "button", class: "primary", onClick: hasMissing ? accept : () => { manageOpen.value = false; } }, hasMissing ? "批准所列权限 / Approve listed access" : "关闭 / Close"),
          ]),
        ]),
      ])]);
      return h(Fragment, null, [...nodes, ...(accessToggle ? [accessToggle] : []), consent]);
    };
  },
});
