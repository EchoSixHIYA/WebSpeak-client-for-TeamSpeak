<template>
  <Teleport to="body">
    <button v-if="connected" class="ws-plugin-launcher" type="button" @click="show">◈ {{ tr('title') }}</button>
    <dialog ref="dialog" class="ws-plugin-dialog" :data-plugin-theme="theme" @close="closed" @cancel="closed">
      <header><strong>{{ current?.manifest.name ?? tr('title') }}</strong><button type="button" @click="dialog?.close()">{{ tr('close') }}</button></header>
      <p v-if="error" role="alert" class="ws-plugin-error">{{ error }}</p>
      <template v-if="!current">
        <div class="ws-plugin-toolbar"><button type="button" :disabled="busy" @click="refresh">{{ busy ? tr('loading') : tr('refresh') }}</button></div>
        <p>{{ tr('enableNote') }}</p><p v-if="!busy && !available.length">{{ tr('empty') }}</p>
        <section v-for="entry in available" :key="entry.manifest.id" class="ws-plugin-entry">
          <div><strong>{{ entry.manifest.name }}</strong><small>{{ entry.scope === 'server' ? tr('server') : tr('instance') }} · {{ entry.manifest.version }}</small><p>{{ entry.manifest.description }}</p></div>
          <button type="button" :disabled="busy" @click="launch(entry.manifest.id)">{{ tr('open') }}</button>
        </section>
      </template>
      <template v-else>
        <div class="ws-plugin-toolbar"><button type="button" @click="stop">← {{ tr('back') }}</button><small>{{ tr('permission') }}: {{ current.manifest.permissions.join(', ') }}</small></div>
        <iframe ref="frame" :key="channel" :title="current.manifest.name" :srcdoc="documentSource" sandbox="allow-scripts" allow="fullscreen" referrerpolicy="no-referrer" @load="sendContext"></iframe>
      </template>
    </dialog>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { parsePluginPackage, pluginRecord, parsePluginJson, type PluginManifest, type PluginScope, type PluginRoomSnapshot } from '../../../src/shared/plugins.js';
import { pluginFrameDocument } from '../services/plugin-frame.js';
import type { PluginTransport } from '../services/plugin-transport.js';
import { pluginTranslations, type PluginTextKey } from '../i18n/plugins.js';
import type { SiteLanguage } from '../../../src/site-copy.js';
const props = defineProps<{ transport: PluginTransport; connected: boolean; language: SiteLanguage }>();
const tr = (key: PluginTextKey) => pluginTranslations[props.language][key];
const dialog = ref<HTMLDialogElement | null>(null), frame = ref<HTMLIFrameElement | null>(null);
const available = shallowRef<{ manifest: PluginManifest; scope: PluginScope }[]>([]);
const current = shallowRef<ReturnType<typeof parsePluginPackage> | null>(null);
const documentSource = ref(''), channel = ref(''), theme = ref<'light'|'dark'>('light');
const busy = ref(false), error = ref(''); let epoch = 0, openingId: string | undefined, context: Record<string,unknown> = {}, observer: MutationObserver | undefined;
const inFlight = new Set<number>();
const pluginId = computed(() => current.value?.manifest.id);
function detectTheme() {
  const root = document.querySelector('.ws-skin-root');
  const color = root ? getComputedStyle(root).color.match(/[\d.]+/g)?.map(Number) : null;
  theme.value = color && color.length >= 3 ? (color[0]*.2126+color[1]*.7152+color[2]*.0722 > 140 ? 'dark':'light') : matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
}
function send(value: object) { frame.value?.contentWindow?.postMessage({ channel: channel.value, ...value }, '*'); }
function sendContext() { send({ type: 'context', context: { ...context, language: props.language, theme: theme.value } }); }
async function refresh() {
  const owner = ++epoch; busy.value = true; error.value = '';
  try {
    const result = await props.transport.request('list');
    if (owner !== epoch) return;
    if (!Array.isArray(result) || result.length > 50) throw new Error('PLUGIN_INVALID_RESPONSE');
    available.value = result.map(v => { if (!pluginRecord(v)) throw new Error('PLUGIN_INVALID_RESPONSE');
      const manifest = v.manifest; if (!pluginRecord(manifest) || typeof manifest.id !== 'string' || typeof manifest.name !== 'string' || (v.scope !== 'server' && v.scope !== 'instance')) throw new Error('PLUGIN_INVALID_RESPONSE');
      return { manifest: manifest as unknown as PluginManifest, scope: v.scope }; });
  } catch (e) { if (owner === epoch) error.value = `${tr('error')}: ${e instanceof Error ? e.message : ''}`; }
  finally { if (owner === epoch) busy.value = false; }
}
function show() { detectTheme(); dialog.value?.showModal(); void refresh(); }
function stop() {
  const id = pluginId.value ?? openingId; ++epoch; openingId = undefined; inFlight.clear(); current.value = null; documentSource.value = ''; context = {}; channel.value = ''; busy.value = false;
  if (id) void props.transport.request('close', { pluginId: id }).catch(() => undefined);
}
function closed() { stop(); error.value = ''; available.value = []; }
async function launch(id: string) {
  const owner = ++epoch; openingId = id; busy.value = true; error.value = '';
  try {
    const result = await props.transport.request('open', { pluginId: id });
    // stop() queues the close after this open on the same ordered socket.
    // A late response must never close a newer opening of the same plugin.
    if (owner !== epoch) return;
    if (!pluginRecord(result) || !pluginRecord(result.snapshot)) throw new Error('PLUGIN_INVALID_RESPONSE');
    const pack = parsePluginPackage(result.package);
    if (pack.manifest.id !== id) throw new Error('PLUGIN_INVALID_RESPONSE');
    current.value = pack; context = { config: result.config, self: result.self, scope: result.scope, snapshot: result.snapshot };
    channel.value = crypto.randomUUID(); documentSource.value = pluginFrameDocument(pack, channel.value);
  } catch (e) { if (owner === epoch) error.value = `${tr('error')}: ${e instanceof Error ? e.message : ''}`; }
  finally { if (owner === epoch) { openingId = undefined; busy.value = false; } }
}
async function receive(event: MessageEvent) {
  if (!frame.value || event.source !== frame.value.contentWindow || !pluginRecord(event.data) || event.data.channel !== channel.value || !current.value) return;
  const value = event.data;
  if (value.type === 'ready') { sendContext(); return; }
  if (value.type !== 'request' || !Number.isSafeInteger(value.id) || inFlight.has(value.id as number) || inFlight.size >= 8) return;
  const id = value.id as number, owner = epoch, plugin = pluginId.value!; inFlight.add(id);
  try {
    let result: unknown;
    if (value.method === 'room.snapshot') result = await props.transport.request('snapshot', { pluginId: plugin });
    else if (value.method === 'room.update' && pluginRecord(value.args) && Number.isSafeInteger(value.args.revision)) {
      result = await props.transport.request('update', { pluginId: plugin, revision: value.args.revision as number, state: parsePluginJson(value.args.state) });
    } else throw new Error('PLUGIN_PERMISSION_DENIED');
    if (owner === epoch) send({ type: 'reply', id, result });
  } catch (e) { if (owner === epoch) send({ type: 'reply', id, error: e instanceof Error ? e.message : 'PLUGIN_FAILED' }); }
  finally { if (owner === epoch) inFlight.delete(id); }
}
const unsubscribe = props.transport.subscribe(message => {
  if (message.type === 'pluginReset') { stop(); available.value = []; dialog.value?.close(); return; }
  if (message.type !== 'pluginEvent' || message.pluginId !== pluginId.value) return;
  if (!message.snapshot) { stop(); error.value = tr('context'); return; }
  context.snapshot = message.snapshot as PluginRoomSnapshot; send({ type: 'snapshot', snapshot: message.snapshot });
});
watch(() => props.language, sendContext);
watch(theme, sendContext);
watch(() => props.connected, connected => { if (!connected) { closed(); dialog.value?.close(); } });
onMounted(() => { window.addEventListener('message', receive); observer = new MutationObserver(detectTheme); observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter:['data-ws-skin','data-theme'] }); });
onBeforeUnmount(() => { unsubscribe(); stop(); observer?.disconnect(); window.removeEventListener('message', receive); dialog.value?.close(); });
</script>
<style>
.ws-plugin-launcher{all:initial;position:fixed;right:16px;top:88px;z-index:10000;font:600 14px system-ui;cursor:pointer;background:#184b48;color:white;border:1px solid #4d827e;border-radius:24px;padding:10px 16px;box-shadow:0 4px 20px #0003}
.ws-plugin-dialog{box-sizing:border-box;width:min(960px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:20px;border:1px solid #b6c9c7;border-radius:16px;background:#fff;color:#182e2d;font:15px/1.5 system-ui;overflow:auto}
.ws-plugin-dialog[data-plugin-theme="dark"]{background:#20242b;color:#ecf2f1;border-color:#4a525d}.ws-plugin-dialog::backdrop{background:#0009}.ws-plugin-dialog header,.ws-plugin-toolbar,.ws-plugin-entry{display:flex;align-items:center;gap:12px;justify-content:space-between}.ws-plugin-dialog header strong{font-size:20px}.ws-plugin-dialog button{font:inherit;cursor:pointer;border:1px solid #779c98;border-radius:8px;padding:8px 12px;background:#e5f3f0;color:#153f3b}.ws-plugin-dialog button:disabled{opacity:.5;cursor:wait}.ws-plugin-dialog iframe{display:block;width:100%;height:min(620px,68dvh);border:1px solid #779c98;border-radius:8px;background:transparent}.ws-plugin-toolbar{margin:14px 0;flex-wrap:wrap}.ws-plugin-entry{border-top:1px solid #779c9866;padding:16px 0}.ws-plugin-entry small{display:block;opacity:.7}.ws-plugin-entry p{margin:6px 0}.ws-plugin-error{color:#c73131;overflow-wrap:anywhere}
@media(max-width:600px){.ws-plugin-launcher{top:72px;right:8px;padding:8px 12px}.ws-plugin-dialog{padding:14px}.ws-plugin-entry{align-items:start}.ws-plugin-dialog iframe{height:65dvh}}
</style>
