<template>
  <Teleport to="#webspeak-plugin-toolbar">
    <div v-if="thirdPartyAllowed && connected && sessionToken" class="ws-plugin-toolbar">
      <button ref="launcher" class="header-action ws-plugin-toolbar-trigger" type="button" :title="tr('title')" :aria-label="tr('title')" :aria-expanded="visible" @click="toggle">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>
      </button>
      <button v-for="entry in pinnedApps" :key="entry.manifest.id" class="header-action ws-plugin-toolbar-shortcut" type="button" :title="entry.manifest.name" :aria-label="entry.manifest.name" :disabled="busy || entry.runtime.state === 'failed'" @click="launch(entry.manifest.id)">{{ entry.manifest.name.slice(0, 1).toUpperCase() }}</button>
    </div>
  </Teleport>
  <Teleport to="body">
    <div v-if="thirdPartyAllowed && connected && sessionToken" class="ws-plugin-overlay" :data-plugin-theme="theme">
      <section v-show="visible" ref="windowElement" class="ws-plugin-window" :class="{ 'is-maximized': maximized, 'is-dragging': dragging }" :style="position" role="dialog" :aria-label="current && appView ? current.manifest.name : tr('title')" tabindex="-1" @keydown.esc.stop="minimize">
        <header class="ws-plugin-titlebar" @pointerdown="startDrag" @lostpointercapture="endDrag" @dblclick="toggleMaximize">
          <span class="ws-plugin-mark" aria-hidden="true">◈</span>
          <div class="ws-plugin-window-title"><strong>{{ current && appView ? current.manifest.name : tr('title') }}</strong><small>WebSpeak</small></div>
          <div class="ws-plugin-window-controls" @pointerdown.stop @dblclick.stop>
            <button type="button" :title="ui.minimize" :aria-label="ui.minimize" @click="minimize"><svg viewBox="0 0 24 24"><path d="M5 17h14" /></svg></button>
            <button type="button" :title="maximized ? ui.restore : ui.maximize" :aria-label="maximized ? ui.restore : ui.maximize" @click="toggleMaximize"><svg viewBox="0 0 24 24"><path :d="maximized ? 'M8 4h12v12M4 8h12v12H4z' : 'M5 5h14v14H5z'" /></svg></button>
            <button class="ws-plugin-close" type="button" :title="tr('close')" :aria-label="tr('close')" @click="close"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
          </div>
        </header>
        <nav class="ws-plugin-navigation" :aria-label="tr('title')">
          <button type="button" :class="{ active: !appView }" @click="appView = false">{{ ui.workspace }}</button>
          <button v-if="current" type="button" :class="{ active: appView }" @click="appView = true">{{ current.manifest.name }}</button>
          <span v-if="current && appView" class="ws-plugin-version">v{{ current.manifest.version }}</span>
        </nav>
        <p v-if="error" role="alert" class="ws-plugin-error">{{ error }}</p>
        <div v-show="!appView" class="ws-plugin-library">
          <div class="ws-plugin-library-heading"><div><h2>{{ tr('title') }}</h2><span>{{ available.length }} {{ ui.count }}</span></div><button type="button" :disabled="busy" @click="refresh">{{ busy ? tr('loading') : tr('refresh') }}</button></div>
          <input v-model="search" class="ws-plugin-search" type="search" :placeholder="ui.search" :aria-label="ui.search" />
          <p v-if="!busy && !filtered.length" class="ws-plugin-empty">{{ available.length ? ui.noResults : tr('empty') }}</p>
          <div class="ws-plugin-grid">
            <article v-for="entry in filtered" :key="entry.manifest.id" class="ws-plugin-entry">
              <div class="ws-plugin-app-mark" aria-hidden="true">{{ entry.manifest.name.slice(0, 1).toUpperCase() }}</div>
              <div class="ws-plugin-entry-copy"><h3>{{ entry.manifest.name }}</h3><small>v{{ entry.manifest.version }} · {{ entry.scope === 'server' ? tr('server') : tr('instance') }}</small><p>{{ entry.manifest.description }}</p></div>
              <p v-if="entry.runtime.state === 'failed'" class="ws-plugin-entry-error">{{ entry.runtime.error }}</p>
              <button type="button" :disabled="busy || entry.runtime.state === 'failed'" @click="launch(entry.manifest.id)">{{ tr('open') }} <span aria-hidden="true">↗</span></button>
            </article>
          </div>
        </div>
        <div v-show="appView && current" class="ws-plugin-browser">
          <iframe v-if="current" ref="frame" :key="current.id" :title="current.manifest.name" :src="current.url" :allow="browserFeatures" referrerpolicy="no-referrer"></iframe>
        </div>
        <div v-if="dragging" class="ws-plugin-drag-shield" />
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { createPluginAppClient, type AvailablePluginApp, type PluginAppClient } from '../services/plugin-app-client.js';
import { type PluginAppLaunch, pluginRecord } from '../../../src/shared/plugins.js';
import { pluginTranslations, type PluginTextKey } from '../i18n/plugins.js';
import { pluginWindowTranslations } from '../i18n/plugin-window.js';
import type { SiteLanguage } from '../../../src/site-copy.js';
import { thirdPartyAllowed } from '../services/instance-authorization.js';
const props = defineProps<{ sessionToken: string; gatewayUrl: string; connected: boolean; language: SiteLanguage }>();
const tr = (key: PluginTextKey) => pluginTranslations[props.language][key];
const ui = computed(() => pluginWindowTranslations[props.language]);
const windowElement = ref<HTMLElement | null>(null), launcher = ref<HTMLButtonElement | null>(null), frame = ref<HTMLIFrameElement | null>(null);
const available = shallowRef<AvailablePluginApp[]>([]), current = shallowRef<PluginAppLaunch | null>(null);
const pinnedApps = computed(() => available.value.filter(entry => entry.toolbarPinned));
const busy = ref(false), error = ref(''), theme = ref<'light' | 'dark'>('light');
const visible = ref(false), maximized = ref(false), appView = ref(false), dragging = ref(false), search = ref('');
const position = ref<Record<string, string>>({});
const filtered = computed(() => available.value.filter(entry => `${entry.manifest.name} ${entry.manifest.description}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
let epoch = 0, pending: AbortController | undefined, opening: { client: PluginAppClient; key: string } | undefined, observer: MutationObserver | undefined;
let drag: { id: number; x: number; y: number; left: number; top: number; handle: HTMLElement; moved: boolean } | undefined;
let resizeObserver: ResizeObserver | undefined;
const browserFeatures = computed(() => {
  const policy = (document as Document & { featurePolicy?: { features(): string[] } }).featurePolicy;
  const features = policy?.features() ?? ['fullscreen', 'autoplay', 'camera', 'microphone', 'display-capture', 'clipboard-read', 'clipboard-write', 'geolocation', 'screen-wake-lock'];
  return features.filter(feature => /^[a-z0-9-]+$/.test(feature)).map(feature => feature + ' *').join('; ');
});
function detectTheme() {
  const root = document.querySelector('.ws-skin-root');
  const style = getComputedStyle(root ?? document.documentElement);
  if (style.colorScheme === 'dark' || style.colorScheme === 'light') { theme.value = style.colorScheme; return; }
  const color = root ? style.color.match(/[\d.]+/g)?.map(Number) : null;
  theme.value = color && color.length >= 3 ? (color[0] * .2126 + color[1] * .7152 + color[2] * .0722 > 140 ? 'dark' : 'light') : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function client() { return createPluginAppClient(props.gatewayUrl, props.sessionToken); }
async function refresh() {
  if (!thirdPartyAllowed.value) return;
  const owner = ++epoch; pending?.abort(); const controller = new AbortController(); pending = controller; busy.value = true; error.value = '';
  try { const entries = await client().list(controller.signal); if (owner === epoch) available.value = entries; }
  catch (e) { if (owner === epoch && !controller.signal.aborted) error.value = `${tr('error')}: ${e instanceof Error ? e.message : ''}`; }
  finally { if (owner === epoch) { busy.value = false; pending = undefined; } }
}
function toggle() {
  if (visible.value) { minimize(); return; }
  detectTheme(); visible.value = true;
  if (!current.value) { appView.value = false; void refresh(); }
  void nextTick(() => { fitWindow(); windowElement.value?.focus(); });
}
function minimize() { endDrag(); visible.value = false; launcher.value?.focus(); }
function close() { stop(); error.value = ''; available.value = []; search.value = ''; minimize(); }
function stop() {
  ++epoch; pending?.abort(); pending = undefined; const old = opening; opening = undefined; current.value = null; appView.value = false; busy.value = false;
  if (old) void old.client.cancelOpen(old.key).catch(() => undefined);
}
async function launch(id: string) {
  if (!thirdPartyAllowed.value) return;
  detectTheme(); visible.value = true;
  if (current.value?.manifest.id === id) { appView.value = true; return; }
  stop(); const owner = ++epoch, controller = new AbortController(), service = client(), key = crypto.randomUUID(); pending = controller; opening = { client: service, key }; busy.value = true; error.value = '';
  try {
    const app = await service.open(id, { openId: key, theme: theme.value, language: props.language }, controller.signal);
    if (owner !== epoch) return;
    if (new URL(app.url).origin === location.origin) throw new Error('PLUGIN_SEPARATE_ORIGIN_REQUIRED');
    current.value = app; appView.value = true;
  } catch (e) {
    if (owner === epoch) { const old = opening; opening = undefined; if (old) void old.client.cancelOpen(old.key).catch(() => undefined); if (!controller.signal.aborted) error.value = `${tr('error')}: ${e instanceof Error ? e.message : ''}`; }
  } finally { if (owner === epoch) { busy.value = false; pending = undefined; } }
}
function message(event: MessageEvent) {
  if (!current.value || event.source !== frame.value?.contentWindow || event.origin !== new URL(current.value.url).origin || !pluginRecord(event.data)) return;
  if (event.data.type === 'webspeak-app-closed' && event.data.id === current.value.id) { stop(); error.value = tr('context'); }
}
function appearance() { if (current.value && opening) void opening.client.appearance(current.value.id, theme.value, props.language).catch(() => undefined); }
function fitWindow() {
  if (!visible.value || maximized.value || !windowElement.value) return;
  const box = windowElement.value.getBoundingClientRect();
  position.value = { left: `${Math.max(8, Math.min(box.left, innerWidth - box.width - 8))}px`, top: `${Math.max(8, Math.min(box.top, innerHeight - box.height - 8))}px`, transform: 'none' };
}
function toggleMaximize() { endDrag(); maximized.value = !maximized.value; if (!maximized.value) void nextTick(fitWindow); }
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || maximized.value || (event.target as HTMLElement).closest('button')) return;
  const box = windowElement.value?.getBoundingClientRect(); if (!box) return;
  event.preventDefault(); const handle = event.currentTarget as HTMLElement;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, handle, moved: false }; dragging.value = true;
  handle.setPointerCapture(event.pointerId);
}
function moveDrag(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  const target = windowElement.value; if (!target) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5 && !drag.moved) return;
  drag.moved = true; const box = target.getBoundingClientRect();
  const next = { left: `${Math.max(8, Math.min(drag.left + event.clientX - drag.x, innerWidth - box.width - 8))}px`, top: `${Math.max(8, Math.min(drag.top + event.clientY - drag.y, innerHeight - box.height - 8))}px`, transform: 'none' };
  position.value = next;
}
function endDrag() {
  const old = drag; drag = undefined; dragging.value = false;
  if (old?.handle.hasPointerCapture(old.id)) old.handle.releasePointerCapture(old.id);
}
watch(windowElement, element => { resizeObserver?.disconnect(); if (element) { resizeObserver = new ResizeObserver(fitWindow); resizeObserver.observe(element); } });
watch(() => [props.sessionToken, props.gatewayUrl, props.connected] as const, () => {
  close();
  if (props.connected && thirdPartyAllowed.value) void refresh();
});
watch(thirdPartyAllowed, allowed => {
  if (!allowed) close();
  else if (props.connected) void refresh();
}, { flush: 'sync' });
watch(() => props.language, appearance); watch(theme, appearance);
onMounted(() => {
  detectTheme(); window.addEventListener('message', message); window.addEventListener('resize', fitWindow); window.addEventListener('pointermove', moveDrag); window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag); window.addEventListener('blur', endDrag);
  if (props.connected && thirdPartyAllowed.value) void refresh();
  observer = new MutationObserver(detectTheme); observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-ws-skin', 'data-theme'] });
});
onBeforeUnmount(() => { stop(); endDrag(); observer?.disconnect(); resizeObserver?.disconnect(); window.removeEventListener('message', message); window.removeEventListener('resize', fitWindow); window.removeEventListener('pointermove', moveDrag); window.removeEventListener('pointerup', endDrag); window.removeEventListener('pointercancel', endDrag); window.removeEventListener('blur', endDrag); });
</script>
<style src="../styles/plugin-overlay.css"></style>
