import { computed, defineComponent, h, onUnmounted, ref, Teleport, watch, type PropType, type VNodeChild } from "vue";
import type { SkinExtensionSessionStatus } from "../../../src/shared/skin-extension.js";
import { computeSkinRuntimePluginDigest, createSkinRuntimePluginApproval, isSkinRuntimePluginApproved, type SkinRuntimePluginApproval } from "../../../src/shared/skin-runtime-plugin-approval.js";
import type { SkinRuntimePlugin, SkinRuntimePluginDocument, SkinRuntimePluginPage } from "../../../src/shared/skin-runtime-plugins.js";
import { parseSkinExtensionUiInput, type SkinExtensionUiInput } from "../../../src/shared/skin-extension-ui-input.js";
import { SKIN_PLUGIN_ACTION_PERMISSIONS, skinPluginActionPermission, type SkinPluginAction, type SkinPluginDocument } from "../../../src/shared/skin-plugin.js";
import { SKIN_RUNTIME_PLUGIN_DATA_PERMISSIONS } from "../../../src/shared/skin-runtime-plugin-context.js";
import SkinPluginOutlet from "./SkinPluginOutlet.js";
import { approveSkinRuntimePlugin, getSkinRuntimePluginApproval, revokeSkinRuntimePluginApprovals } from "../services/skin-runtime-plugin-approval.js";
import { createSkinRuntimePluginSession } from "../services/skin-runtime-plugin-session.js";
import { createSkinRuntimePluginWasmSandboxPrototype } from "../services/skin-runtime-plugin-wasm.js";
import type { SkinExtensionWasmSandboxHandle } from "../services/skin-extension-wasm-sandbox.js";
import { resolveSkinCssAssets } from "../services/skin-pack.js";

const EMPTY_DOCUMENT: SkinPluginDocument = { schemaVersion: 3, components: [] };
const SUPPORTED_PERMISSIONS = new Set([
  ...SKIN_RUNTIME_PLUGIN_DATA_PERMISSIONS,
  ...SKIN_PLUGIN_ACTION_PERMISSIONS,
  "ui.surface.replace",
]);
type HostActionHandler = (args: Record<string, string | number | boolean>) => void | Promise<void>;

type Session = ReturnType<typeof createSkinRuntimePluginSession>;
type RunHandle = { result: Promise<{ uiOutput: string | null }>; close(reason?: string): void };

function isSupported(plugin: SkinRuntimePlugin): boolean {
  return import.meta.env.DEV && plugin.runtime === "wasm"
    && plugin.permissions.every((permission) => SUPPORTED_PERMISSIONS.has(permission));
}

function pluginReason(plugin: SkinRuntimePlugin): string {
  if (!import.meta.env.DEV) return "The Wasm runtime prototype is disabled in production builds. / Wasm 运行时原型在生产构建中保持关闭。";
  if (plugin.runtime !== "wasm") return "JavaScript plugins are not enabled. / JavaScript 插件尚未启用。";
  const permission = plugin.permissions.find((candidate) => !SUPPORTED_PERMISSIONS.has(candidate));
  return permission
    ? `This prototype does not implement ${permission}. / 当前原型尚未实现 ${permission}。`
    : "";
}

function createRun(
  skinId: string,
  skinVersion: string,
  plugin: SkinRuntimePlugin,
  approval: SkinRuntimePluginApproval,
  files: Readonly<Record<string, Blob>>,
  context: unknown,
  readSessionStatus: (signal: AbortSignal) => SkinExtensionSessionStatus | Promise<SkinExtensionSessionStatus>,
  input: SkinExtensionUiInput,
): RunHandle {
  let sandbox: SkinExtensionWasmSandboxHandle | null = null;
  let cancelled = false;
  const result = (async () => {
    const nextSandbox = await createSkinRuntimePluginWasmSandboxPrototype({
      skinId,
      skinVersion,
      plugin,
      approval,
      files,
      uiInput: input,
      context,
      readSessionStatus,
      prototypeOnly: true,
    });
    if (cancelled) {
      nextSandbox.close("page-or-skin-changed");
      throw new Error("Plugin run was closed before startup.");
    }
    sandbox = nextSandbox;
    await nextSandbox.ready;
    const outcome = await nextSandbox.result;
    return { uiOutput: outcome.uiOutput };
  })();
  return {
    result,
    close(reason) {
      cancelled = true;
      sandbox?.close(reason);
    },
  };
}

export default defineComponent({
  name: "SkinRuntimePluginHost",
  props: {
    skinId: { type: String, required: true },
    skinVersion: { type: String, required: true },
    plugins: { type: Object as PropType<SkinRuntimePluginDocument | undefined>, default: undefined },
    files: { type: Object as PropType<Record<string, Blob>>, default: () => ({}) },
    styles: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
    assets: { type: Object as PropType<Record<string, Blob>>, default: () => ({}) },
    page: { type: String as PropType<SkinRuntimePluginPage>, required: true },
    context: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
    actions: { type: Object as PropType<Partial<Record<SkinPluginAction, HostActionHandler>>>, default: () => ({}) },
    readSessionStatus: { type: Function as PropType<(signal: AbortSignal) => SkinExtensionSessionStatus | Promise<SkinExtensionSessionStatus>>, required: true },
  },
  emits: {
    "surface-change": (_active: boolean) => typeof _active === "boolean",
    "restore-skin": () => true,
  },
  setup(props, { emit }) {
    const digests = ref<Record<string, string>>({});
    const digestErrors = ref<Record<string, string>>({});
    const revision = ref(0);
    const managerOpen = ref(false);
    const denied = ref(new Set<string>());
    const inMemoryApprovals = new Map<string, SkinRuntimePluginApproval>();
    const sessions = new Map<string, Session>();
    const stylesByPlugin = new Map<string, { element: HTMLStyleElement; objectUrls: string[] }>();
    const outputs = ref<Record<string, string | null>>({});
    const surfaces = ref(new Set<string>());
    const suppressedSurfaces = ref(new Set<string>());
    let digestRun = 0;
    let disposed = false;
    let contextRefreshTimer: number | undefined;

    const pagePlugins = computed(() => props.plugins?.plugins.filter((plugin) => plugin.page === props.page) ?? []);
    const approved = (plugin: SkinRuntimePlugin): SkinRuntimePluginApproval | null => {
      const digest = digests.value[plugin.id];
      if (!digest) return null;
      const memoryGrant = inMemoryApprovals.get(plugin.id);
      if (memoryGrant && isSkinRuntimePluginApproved(memoryGrant, props.skinId, props.skinVersion, plugin, digest)) return memoryGrant;
      return getSkinRuntimePluginApproval(props.skinId, props.skinVersion, plugin, digest);
    };
    const pending = computed(() => {
      revision.value;
      return pagePlugins.value.filter((plugin) => isSupported(plugin) && !approved(plugin) && !denied.value.has(plugin.id));
    });
    const activeSurface = computed(() => pagePlugins.value.some((plugin) => plugin.mode === "surface"
      && surfaces.value.has(plugin.id) && !suppressedSurfaces.value.has(plugin.id)));

    function publishSurfaceState(): void {
      emit("surface-change", activeSurface.value);
    }

    function removeStyle(pluginId: string): void {
      const style = stylesByPlugin.get(pluginId);
      if (!style) return;
      style.element.remove();
      style.objectUrls.forEach((url) => URL.revokeObjectURL(url));
      stylesByPlugin.delete(pluginId);
    }

    function stopPlugin(pluginId: string, reason: string): void {
      sessions.get(pluginId)?.close(reason);
      sessions.delete(pluginId);
      outputs.value = { ...outputs.value, [pluginId]: null };
      surfaces.value.delete(pluginId);
      suppressedSurfaces.value.delete(pluginId);
      removeStyle(pluginId);
      publishSurfaceState();
    }

    function stopAll(reason: string): void {
      if (contextRefreshTimer !== undefined) {
        window.clearTimeout(contextRefreshTimer);
        contextRefreshTimer = undefined;
      }
      for (const pluginId of [...sessions.keys()]) stopPlugin(pluginId, reason);
      for (const pluginId of [...stylesByPlugin.keys()]) removeStyle(pluginId);
      outputs.value = {};
      surfaces.value = new Set();
      suppressedSurfaces.value = new Set();
      publishSurfaceState();
    }

    function pluginStyleAssets(plugin: SkinRuntimePlugin): Record<string, Blob> {
      const ownPrefix = `plugins/${plugin.id}/assets/`;
      return Object.fromEntries(Object.entries(props.assets).filter(([path]) => path.startsWith("assets/") || path.startsWith(ownPrefix)));
    }

    function installStyle(plugin: SkinRuntimePlugin): void {
      removeStyle(plugin.id);
      const css = props.styles[plugin.id];
      if (!css) return;
      const resolved = resolveSkinCssAssets(css, pluginStyleAssets(plugin));
      const element = document.createElement("style");
      element.dataset.wsRuntimePluginStyle = plugin.id;
      element.textContent = resolved.css;
      document.head.append(element);
      stylesByPlugin.set(plugin.id, { element, objectUrls: resolved.objectUrls });
    }

    function outputAssets(plugin: SkinRuntimePlugin): Record<string, Blob> {
      const result: Record<string, Blob> = Object.create(null) as Record<string, Blob>;
      const prefix = `plugins/${plugin.id}/assets/`;
      for (const path of plugin.assets) {
        const relative = path.slice(prefix.length);
        const blob = props.assets[path];
        if (blob) result[`assets/${relative}`] = blob;
      }
      return result;
    }

    function onRuntimeError(pluginId: string): void {
      if (disposed) return;
      stopPlugin(pluginId, "runtime-error");
      digestErrors.value = { ...digestErrors.value, [pluginId]: "The plugin stopped safely. / 插件已安全停止。" };
    }

    function startPlugin(plugin: SkinRuntimePlugin, grant: SkinRuntimePluginApproval): void {
      if (sessions.has(plugin.id) || !isSupported(plugin)) return;
      const session = createSkinRuntimePluginSession({
        plugin,
        createRun: (input) => createRun(props.skinId, props.skinVersion, plugin, grant, props.files, props.context, props.readSessionStatus, input),
        onAction: async (action) => {
          const permission = skinPluginActionPermission(action.type);
          const currentGrant = approved(plugin);
          if (!permission || !plugin.permissions.includes(permission) || !currentGrant
            || sessions.get(plugin.id) !== session || disposed) {
            throw new Error("The plugin action is no longer approved.");
          }
          const handler = props.actions[action.type];
          if (!handler) throw new Error("The host does not provide this action.");
          await handler(action.args);
        },
        onOutput: () => {
          installStyle(plugin);
          outputs.value = { ...outputs.value, [plugin.id]: session.output };
          digestErrors.value = { ...digestErrors.value, [plugin.id]: "" };
        },
        onError: () => onRuntimeError(plugin.id),
      });
      sessions.set(plugin.id, session);
      void session.start().then((started) => {
        if (!started && sessions.get(plugin.id) === session) onRuntimeError(plugin.id);
      }).catch(() => onRuntimeError(plugin.id));
    }

    function reconcile(): void {
      if (disposed) return;
      const currentIds = new Set(pagePlugins.value.map((plugin) => plugin.id));
      for (const pluginId of [...sessions.keys()]) if (!currentIds.has(pluginId)) stopPlugin(pluginId, "page-changed");
      for (const plugin of pagePlugins.value) {
        const grant = approved(plugin);
        if (grant && isSupported(plugin)) startPlugin(plugin, grant);
      }
    }

    function approvePending(): void {
      for (const plugin of pending.value) {
        const digest = digests.value[plugin.id];
        if (!digest) continue;
        approveSkinRuntimePlugin(props.skinId, props.skinVersion, plugin, digest);
        const stored = getSkinRuntimePluginApproval(props.skinId, props.skinVersion, plugin, digest);
        inMemoryApprovals.set(plugin.id, stored ?? createSkinRuntimePluginApproval(props.skinId, props.skinVersion, plugin, digest));
      }
      denied.value = new Set([...denied.value].filter((id) => !pending.value.some((plugin) => plugin.id === id)));
      managerOpen.value = false;
      revision.value += 1;
      reconcile();
    }

    function keepDisabled(): void {
      denied.value = new Set([...denied.value, ...pending.value.map((plugin) => plugin.id)]);
      managerOpen.value = false;
    }

    function revokeAll(): void {
      revokeSkinRuntimePluginApprovals(props.skinId);
      for (const plugin of props.plugins?.plugins ?? []) inMemoryApprovals.delete(plugin.id);
      denied.value = new Set((props.plugins?.plugins ?? []).filter(isSupported).map((plugin) => plugin.id));
      stopAll("approval-revoked");
      managerOpen.value = false;
      revision.value += 1;
    }

    function openManager(): void {
      managerOpen.value = true;
    }

    function dispatch(pluginId: string, value: unknown): void {
      if (!value || typeof value !== "object") return;
      const input = (value as Record<string, unknown>).input;
      const session = sessions.get(pluginId);
      if (session && input) void session.dispatch(input);
    }

    function surfaceChanged(pluginId: string, active: boolean): void {
      if (active) surfaces.value.add(pluginId);
      else surfaces.value.delete(pluginId);
      publishSurfaceState();
    }

    function toggleSurface(pluginId: string): void {
      const next = new Set(suppressedSurfaces.value);
      if (next.has(pluginId)) next.delete(pluginId);
      else next.add(pluginId);
      suppressedSurfaces.value = next;
      publishSurfaceState();
    }

    watch(() => [props.skinId, props.skinVersion, props.plugins, props.files], async () => {
      const currentRun = ++digestRun;
      stopAll("skin-changed");
      inMemoryApprovals.clear();
      denied.value = new Set();
      managerOpen.value = false;
      digests.value = {};
      digestErrors.value = {};
      const plugins = props.plugins?.plugins ?? [];
      const nextDigests: Record<string, string> = Object.create(null) as Record<string, string>;
      const nextErrors: Record<string, string> = Object.create(null) as Record<string, string>;
      await Promise.all(plugins.map(async (plugin) => {
        try { nextDigests[plugin.id] = await computeSkinRuntimePluginDigest(plugin, props.files); }
        catch { nextErrors[plugin.id] = "The package files could not be verified. / 无法校验插件文件。"; }
      }));
      if (disposed || currentRun !== digestRun) return;
      digests.value = nextDigests;
      digestErrors.value = nextErrors;
      revision.value += 1;
      reconcile();
    }, { immediate: true });

    watch(() => [props.page, digests.value, revision.value], reconcile, { deep: true });
    watch(() => props.context, () => {
      if (disposed) return;
      if (contextRefreshTimer !== undefined) window.clearTimeout(contextRefreshTimer);
      contextRefreshTimer = window.setTimeout(() => {
        contextRefreshTimer = undefined;
        for (const session of sessions.values()) void session.refresh();
      }, 100);
    }, { deep: true });
    watch(activeSurface, publishSurfaceState, { flush: "sync" });
    onUnmounted(() => {
      disposed = true;
      digestRun += 1;
      stopAll("host-unmounted");
    });

    return () => {
      const currentPlugins = pagePlugins.value;
      const nodes: VNodeChild[] = [];
      for (const plugin of currentPlugins) {
        const generatedOutput = suppressedSurfaces.value.has(plugin.id) ? null : outputs.value[plugin.id] ?? null;
        const pluginAssets = outputAssets(plugin);
        nodes.push(h(SkinPluginOutlet, {
          key: `${props.skinId}:${plugin.id}:${props.page}`,
          skinId: props.skinId,
          skinVersion: props.skinVersion,
          document: EMPTY_DOCUMENT,
          extensionOutput: generatedOutput,
          extensionMode: plugin.mode,
          componentNamespace: plugin.id,
          manageSurfaceRecovery: false,
          page: props.page,
          data: {},
          assets: pluginAssets,
          actions: {},
          onExtensionEvent: (event: unknown) => dispatch(plugin.id, event),
          onSurfaceChange: (active: boolean) => surfaceChanged(plugin.id, active),
          onRestoreSkin: () => emit("restore-skin"),
        }));
      }

      const controls: VNodeChild[] = [];
      if (currentPlugins.length) {
        controls.push(h(Teleport, { to: "body" }, [h("button", {
          type: "button",
          class: "ws-plugin-access-toggle",
          "aria-label": "管理运行时插件权限 / Manage runtime plugin access",
          onClick: openManager,
        }, "插件权限 / Plugin access")]));
      }
      for (const plugin of currentPlugins) {
        if (plugin.mode !== "surface" || !outputs.value[plugin.id]) continue;
        const suppressed = suppressedSurfaces.value.has(plugin.id);
        controls.push(h(Teleport, { to: "body" }, [h("button", {
          type: "button",
          class: "ws-plugin-surface-recovery",
          "aria-label": suppressed ? "恢复自定义界面 / Restore custom interface" : "返回 WebSpeak 标准界面 / Return to built-in interface",
          onClick: () => toggleSurface(plugin.id),
        }, suppressed ? "恢复自定义界面 / Restore custom UI" : "标准界面 / Built-in UI")]));
        controls.push(h(Teleport, { to: "body" }, [h("button", {
          type: "button",
          class: "ws-plugin-surface-reset",
          "aria-label": "恢复内置皮肤 / Restore the built-in skin",
          onClick: () => emit("restore-skin"),
        }, "恢复内置皮肤 / Reset skin")]));
      }

      const showConsent = pending.value.length > 0 || managerOpen.value;
      if (!showConsent) return h("div", { class: "ws-runtime-plugin-host" }, [...nodes, ...controls]);

      const showApproval = pending.value.length > 0;
      const listed = showApproval ? pending.value : currentPlugins;
      const consent = h(Teleport, { to: "body" }, [h("div", { class: "ws-plugin-consent-backdrop", "data-ws-runtime-plugin-consent": "true" }, [
        h("section", { class: "ws-plugin-consent", role: "dialog", "aria-modal": "true", "aria-labelledby": "ws-runtime-plugin-consent-title" }, [
          h("h2", { id: "ws-runtime-plugin-consent-title" }, showApproval ? "运行时插件授权 / Runtime plugin approval" : "运行时插件权限 / Runtime plugin access"),
          h("p", null, "插件只在隔离的 Wasm Worker 中运行。每次执行均有时限和内存上限；插件不能访问网络、存储、连接地址、密码或身份材料。/ Plugins run in a bounded Wasm worker and cannot access network, storage, connection targets, passwords, or identity material."),
          ...listed.map((plugin) => {
            const grant = approved(plugin);
            const error = digestErrors.value[plugin.id];
            const unsupported = pluginReason(plugin);
            const status = error || unsupported || (grant ? "已授权 / Approved" : "等待授权 / Approval required");
            return h("div", { class: "ws-plugin-consent-item", key: plugin.id }, [
              h("strong", null, `${plugin.name} · ${plugin.mode === "surface" ? "整页界面 / surface" : "组件 / widget"}`),
              h("ul", null, [
                ...plugin.permissions.map((permission) => h("li", { key: permission }, permission)),
                h("li", { key: "status" }, status),
              ]),
            ]);
          }),
          h("p", { class: "ws-plugin-consent-note" }, "当前开发原型支持 Wasm、权限化公开数据和 ui.surface.replace；已批准的宿主动作只能由可信的明确用户操作触发，并仍由 WebSpeak 校验会话和参数。数据字段只按清单中的读取权限投影，授权绑定到此皮肤版本、插件清单和所有插件文件的 SHA-256。/ This development prototype supports Wasm, permission-filtered public data, and ui.surface.replace. Approved host actions require a trusted explicit user event and are still validated by WebSpeak against the current session and arguments. Data is projected by the read permissions in the descriptor, and approval is bound to this skin version, descriptor, and every plugin file by SHA-256."),
          h("div", { class: "ws-plugin-consent-actions" }, showApproval
            ? [
              h("button", { type: "button", class: "secondary", onClick: keepDisabled }, "暂不启用 / Keep disabled"),
              h("button", { type: "button", class: "primary", disabled: listed.some((plugin) => !digests.value[plugin.id] || Boolean(digestErrors.value[plugin.id])) || listed.some((plugin) => !isSupported(plugin)), onClick: approvePending }, "批准所列插件 / Approve listed plugins"),
            ]
            : [
              h("button", { type: "button", class: "secondary", onClick: revokeAll }, "撤销全部授权 / Revoke all access"),
              h("button", { type: "button", class: "primary", onClick: () => { managerOpen.value = false; } }, "关闭 / Close"),
            ]),
        ]),
      ])]);
      return h("div", { class: "ws-runtime-plugin-host" }, [...nodes, ...controls, consent]);
    };
  },
});
