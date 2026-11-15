<template>
  <!-- The authorization dialog is host-owned trusted UI: it is rendered in a
       closed shadow root and promoted with showModal(), so compiled skin CSS
       cannot select, restyle, cover or disable it. It deliberately carries no
       `data-ws-part`; there is no skin hook for this dialog. -->
  <Teleport v-if="layer" :to="layer.container">
    <dialog ref="dialog" class="ws-instance-authorization" @cancel.prevent="cancel" @close="authorizationRequested = false">
      <form @submit.prevent="save">
        <div class="ws-authorization-mark" aria-hidden="true">◈</div>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.description }}</p>
        <p>{{ copy.alternative }}</p>
        <label><input v-model="checked" type="checkbox" /><span>{{ copy.choice }}</span></label>
        <footer>
          <button type="button" @click="decline">{{ copy.decline }}</button>
          <button class="ws-authorization-primary" type="submit" :disabled="firstVisit && !checked">{{ firstVisit ? copy.accept : copy.save }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { SiteLanguage } from '../../../src/site-copy.js';
import { authorizationDecision, authorizationLanguage, authorizationRequested, setInstanceAuthorization } from '../services/instance-authorization.js';
import { instanceAuthorizationCopy } from '../i18n/instance-authorization.js';
import { createHostOwnedLayer, type HostOwnedLayer } from '../services/host-owned-layer.js';
import { hostChromeActiveSkinId } from '../services/host-chrome.js';
import {
  PERMISSION_CONTROL_DEFAULTS,
  bindHostControlTheme,
  findSkinRoot,
} from '../services/host-control-tokens.js';

const AUTHORIZATION_LAYER_CSS = `
:host { font: 14px/1.75 system-ui, -apple-system, "Segoe UI", sans-serif; }
.ws-instance-authorization{box-sizing:border-box;width:min(570px,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:30px;border:1px solid var(--ws-control-border,#dbe3f1);border-radius:var(--ws-control-radius,20px);background:var(--ws-control-background,#fff);color:var(--ws-control-foreground,#25324b);font-family:var(--ws-control-font,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:var(--ws-control-font-size,14px);line-height:1.75;box-shadow:0 24px 90px #101c4140;color-scheme:light;overflow:auto;pointer-events:auto}
.ws-instance-authorization::backdrop{background:#10182d8c;backdrop-filter:blur(5px)}
.ws-instance-authorization form{margin:0}.ws-instance-authorization h2{margin:12px 0 16px;font-size:23px;line-height:1.4;color:var(--ws-control-foreground,#202e49)}.ws-instance-authorization p{margin:12px 0;color:color-mix(in srgb,var(--ws-control-foreground,#25324b) 76%,transparent)}.ws-authorization-mark{display:grid;place-items:center;width:43px;height:43px;border-radius:13px;background:color-mix(in srgb,var(--ws-control-accent,#5265df) 14%,var(--ws-control-background,#fff));color:var(--ws-control-accent,#5265df);font-size:28px}
.ws-instance-authorization label{display:flex;align-items:flex-start;gap:12px;margin:22px 0;padding:15px;background:color-mix(in srgb,var(--ws-control-foreground,#25324b) 6%,var(--ws-control-background,#fff));border:1px solid var(--ws-control-border,#dce3f3);border-radius:12px;cursor:pointer}.ws-instance-authorization input{appearance:auto;flex:none;width:18px;height:18px;margin:4px 0 0;accent-color:var(--ws-control-accent,#5265df)}.ws-instance-authorization footer{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:24px}.ws-instance-authorization button{appearance:none;min-height:var(--ws-control-hit,42px);padding:9px 16px;border:1px solid var(--ws-control-border,#d9e1ef);border-radius:var(--ws-control-radius,10px);background:color-mix(in srgb,var(--ws-control-foreground,#25324b) 6%,var(--ws-control-background,#fff));color:var(--ws-control-foreground,#43516d);font:600 var(--ws-control-font-size,14px)/1.5 var(--ws-control-font,system-ui);cursor:pointer}.ws-instance-authorization .ws-authorization-primary{background:var(--ws-control-accent,#5265df);color:var(--ws-control-on-accent,#fff);border-color:var(--ws-control-accent,#5265df)}.ws-instance-authorization button:disabled{opacity:.45;cursor:not-allowed}.ws-instance-authorization button:focus-visible,.ws-instance-authorization input:focus-visible{outline:2px solid var(--ws-control-accent,#5265df);outline-offset:3px}
@media(max-width:600px){.ws-instance-authorization{padding:22px}.ws-instance-authorization footer button{flex:1}}
`;

const layer: HostOwnedLayer | null = createHostOwnedLayer('authorization', AUTHORIZATION_LAYER_CSS);
const props = defineProps<{ language: SiteLanguage }>();
const dialog = ref<HTMLDialogElement | null>(null), checked = ref(false), firstVisit = ref(false);
const copy = computed(() => instanceAuthorizationCopy[props.language]);

/** The authorization dialog is host-owned; only sanitized tokens can theme it. */
const theme = layer ? bindHostControlTheme({
  layer,
  control: () => dialog.value,
  part: 'host.permission',
  defaults: PERMISSION_CONTROL_DEFAULTS,
  source: () => findSkinRoot(hostChromeActiveSkinId.value),
}) : null;

watch([dialog, hostChromeActiveSkinId], () => { theme?.apply(); }, { flush: 'post', immediate: true });
watch(() => props.language, value => { authorizationLanguage.value = value; }, { immediate: true });
watch([dialog, authorizationRequested, authorizationDecision], () => {
  if (!dialog.value || dialog.value.open || (authorizationDecision.value !== null && !authorizationRequested.value)) return;
  firstVisit.value = authorizationDecision.value === null;
  checked.value = authorizationDecision.value === true;
  dialog.value.showModal();
}, { flush: 'post' });
function finish() { authorizationRequested.value = false; dialog.value?.close(); }
function save() { if (firstVisit.value && !checked.value) return; setInstanceAuthorization(checked.value); finish(); }
function decline() { setInstanceAuthorization(false); finish(); }
function cancel() { if (firstVisit.value) decline(); else finish(); }
onBeforeUnmount(() => { dialog.value?.close(); theme?.dispose(); layer?.dispose(); });
</script>
