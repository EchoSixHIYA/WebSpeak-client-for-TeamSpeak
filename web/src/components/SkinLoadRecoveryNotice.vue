<template>
  <Teleport v-if="layer" :to="layer.container">
    <section v-if="error" ref="banner" class="skin-load-recovery" data-ws-part="app.skin-load-recovery" role="alert">
      <p>{{ labels.skinLoadError(error.skinId) }}</p>
      <button type="button" @click="$emit('use-built-in')">{{ labels.skinUseBuiltIn }}</button>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { Language } from "../i18n/web-client.js";
import { resolveSkinLayoutLanguage, skinLayoutLabels } from "../i18n/skin-layout.js";
import { createHostOwnedLayer, type HostOwnedLayer } from "../services/host-owned-layer.js";
import { hostChromeActiveSkinId } from "../services/host-chrome.js";
import {
  SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS,
  bindHostControlTheme,
  findSkinRoot,
} from "../services/host-control-tokens.js";

defineEmits<{ "use-built-in": [] }>();

const props = defineProps<{
  error: { skinId: string } | null;
  language: Language;
}>();
const labels = computed(() => skinLayoutLabels[resolveSkinLayoutLanguage(props.language)]);

// The banner is trusted host UI: render it in a closed shadow root so compiled
// skin CSS cannot restyle it (or hide it) from the document. The layer's fixed
// wrapper is pointer-transparent, so the banner re-enables pointer events.
const SKIN_LOAD_LAYER_CSS = `
.skin-load-recovery {
  position: fixed;
  z-index: 2147482500;
  top: max(12px, env(safe-area-inset-top));
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: min(720px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 10px 12px;
  transform: translateX(-50%);
  border: 1px solid var(--ws-control-border, #f59e0b);
  border-radius: var(--ws-control-radius, 12px);
  color: var(--ws-control-foreground, #78350f);
  background: var(--ws-control-background, #fffbeb);
  box-shadow: 0 8px 28px #0f172a33;
  font-family: var(--ws-control-font, ui-sans-serif, system-ui, sans-serif);
  font-size: var(--ws-control-font-size, 14px);
  line-height: 1.45;
  pointer-events: auto;
}
.skin-load-recovery p { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
.skin-load-recovery button { flex: 0 0 auto; min-height: var(--ws-control-hit, 44px); max-width: 100%; padding: 7px 10px; border: 1px solid var(--ws-control-accent, #b45309); border-radius: var(--ws-control-radius, 8px); color: var(--ws-control-foreground, #78350f); background: var(--ws-control-background, #fff); font: inherit; cursor: pointer; white-space: normal; }
.skin-load-recovery button:focus-visible { outline: 3px solid var(--ws-control-accent, #1d4ed8); outline-offset: 2px; }
@media (max-width: 520px) {
  .skin-load-recovery { align-items: stretch; flex-direction: column; gap: 7px; }
  .skin-load-recovery button { width: 100%; }
}
`;

const layer: HostOwnedLayer | null = createHostOwnedLayer("skin-load", SKIN_LOAD_LAYER_CSS);
const banner = ref<HTMLElement | null>(null);

/**
 * Tokens come from the active skin root, never from the document. The banner
 * appears when a skin failed to load, so a missing root simply keeps the
 * built-in amber surface; an unreadable palette reverts the same way.
 */
const theme = layer ? bindHostControlTheme({
  layer,
  control: () => banner.value,
  part: "app.skin-load-recovery",
  defaults: SKIN_LOAD_RECOVERY_CONTROL_DEFAULTS,
  source: () => findSkinRoot(hostChromeActiveSkinId.value),
}) : null;

watch([() => props.error, banner, hostChromeActiveSkinId], () => {
  void nextTick(() => theme?.apply());
}, { flush: "post", immediate: true });

onBeforeUnmount(() => {
  theme?.dispose();
  layer?.dispose();
});
</script>
