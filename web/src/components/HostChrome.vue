<template>
  <!-- Host chrome is intentionally outside .ws-skin-root so a v3 surface
       replacement cannot delete the recovery path or the authorization UI. -->
  <Teleport to="body">
    <div class="ws-host-chrome" data-ws-host-chrome>
      <div
        v-if="!isHostPartHidden('host.watermark')"
        class="ws-host-watermark"
        data-ws-part="host.watermark"
        aria-hidden="true"
      >WebSpeak</div>

      <p
        v-if="!isHostPartHidden('host.hint')"
        class="ws-host-hint"
        data-ws-part="host.hint"
      >{{ copy.hint }}</p>

      <div
        v-if="!isHostPartHidden('host.voice-status-decoration')"
        class="ws-host-voice-status-decoration"
        data-ws-part="host.voice-status-decoration"
        aria-hidden="true"
      ><span></span><span></span></div>
    </div>
  </Teleport>

  <!-- Trusted recovery entry. It lives in a closed shadow root and a manual
       popover, so no compiled skin selector can target it (shadow boundary)
       and no normal stacking context can cover it (top layer). It carries no
       `data-ws-part`: there is intentionally no skin hook for this control. -->
  <Teleport v-if="layer" :to="layer.container">
    <div
      ref="recoveryPopover"
      popover="manual"
      class="ws-host-recovery"
      data-ws-host-recovery
      role="region"
      :aria-label="copy.recovery"
    >
      <span class="ws-host-recovery-mark" aria-hidden="true">◈</span>
      <button
        type="button"
        data-ws-recovery-action="built-in"
        :title="copy.shortcut"
        @click="useBuiltInSkin"
      >{{ copy.useBuiltIn }}</button>
      <button
        type="button"
        data-ws-recovery-action="library"
        :title="copy.library"
        @click="openLibrary"
      >{{ copy.library }}</button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SiteLanguage } from "../../../src/site-copy.js";
import { hostChromeCopy } from "../i18n/host-chrome.js";
import {
  isHostPartHidden,
  isHostPartVisuallyReachable,
  isRecoveryShortcut,
  isThirdPartySkinActive,
  openPluginLibrary,
  requestBuiltInSkin,
} from "../services/host-chrome.js";
import {
  createHostOwnedLayer,
  syncRecoveryPopover,
  type HostOwnedLayer,
} from "../services/host-owned-layer.js";
import { shouldShowRecovery } from "../services/host-chrome-visibility.js";
import { thirdPartyAllowed } from "../services/instance-authorization.js";

const props = withDefaults(defineProps<{ language: SiteLanguage; connected?: boolean }>(), { connected: false });
const copy = computed(() => hostChromeCopy[props.language] ?? hostChromeCopy.en);

// Styles live inside the closed shadow root: the component's scoped stylesheet
// in <head> cannot cross the shadow boundary.
const RECOVERY_LAYER_CSS = `
:host { font: 11px/1.2 ui-sans-serif, system-ui, sans-serif; }
.ws-host-recovery {
  position: fixed;
  inset: auto auto calc(38px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  margin: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  max-width: calc(100vw - 24px);
  padding: 4px 5px 4px 9px;
  border: 1px solid #9db6b2;
  border-radius: 999px;
  background: color-mix(in srgb, #ffffff 92%, transparent);
  color: #31524f;
  box-shadow: 0 6px 18px #0f2a2626;
  pointer-events: auto;
}
.ws-host-recovery:popover-open { display: flex; }
.ws-host-recovery-mark { font-size: 12px; line-height: 1; }
.ws-host-recovery button {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid #9db6b2;
  border-radius: 999px;
  background: #fff;
  color: #31524f;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.ws-host-recovery button[data-ws-recovery-action="built-in"] {
  border-color: #b45309;
  background: #fff7ed;
  color: #7c2d12;
}
.ws-host-recovery button:hover { filter: brightness(.96); }
.ws-host-recovery button:focus-visible { outline: 2px solid #4c8f88; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .ws-host-recovery button { transition: none; } }
`;

const layer: HostOwnedLayer | null = createHostOwnedLayer("recovery", RECOVERY_LAYER_CSS);

// CSS-only hiding is invisible to `isHostPartHidden`, so sample the launcher's
// live geometry. A one-second interval is enough for a recovery fallback and
// stays cheaper than a MutationObserver on the whole document. While a
// third-party skin is active the entry is persistent and this sample only
// matters for the official-skin fallback.
const launcherReachable = ref(true);
const showRecovery = computed(() => shouldShowRecovery({
  connected: props.connected,
  thirdPartyAllowed: thirdPartyAllowed.value,
  thirdPartySkinActive: isThirdPartySkinActive(),
  launcherHiddenByConfig: isHostPartHidden("host.plugins.launcher"),
  launcherReachable: launcherReachable.value,
}));

// The documented shortcut can summon the same host-owned entry even while a
// bundled skin is active (for example after a broken third-party skin was
// already reset). It never renders decoration on its own.
const shortcutOpen = ref(false);
const recoveryPopover = ref<HTMLElement | null>(null);
const recoveryVisible = computed(() => showRecovery.value || (shortcutOpen.value && thirdPartyAllowed.value));

function syncPopover() {
  syncRecoveryPopover(recoveryPopover.value, recoveryVisible.value);
}

function useBuiltInSkin() {
  shortcutOpen.value = false;
  requestBuiltInSkin();
}

function openLibrary() {
  shortcutOpen.value = false;
  openPluginLibrary();
}

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat || !thirdPartyAllowed.value) return;
  if (isRecoveryShortcut(event)) {
    event.preventDefault();
    shortcutOpen.value = true;
    void nextTick(() => recoveryPopover.value?.querySelector("button")?.focus());
    return;
  }
  if (event.key === "Escape" && shortcutOpen.value) shortcutOpen.value = false;
}

let reachabilityTimer: ReturnType<typeof setInterval> | undefined;
function refreshLauncherReachability() {
  launcherReachable.value = isHostPartVisuallyReachable("host.plugins.launcher");
}

watch([recoveryVisible, recoveryPopover], () => { void nextTick(syncPopover); }, { flush: "post" });
watch(thirdPartyAllowed, allowed => { if (!allowed) shortcutOpen.value = false; });

onMounted(() => {
  refreshLauncherReachability();
  reachabilityTimer = setInterval(refreshLauncherReachability, 1000);
  window.addEventListener("resize", refreshLauncherReachability);
  window.addEventListener("keydown", onKeydown);
  void nextTick(syncPopover);
});
onBeforeUnmount(() => {
  if (reachabilityTimer) clearInterval(reachabilityTimer);
  window.removeEventListener("resize", refreshLauncherReachability);
  window.removeEventListener("keydown", onKeydown);
  layer?.dispose();
});
</script>

<style scoped>
.ws-host-chrome {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
.ws-host-watermark {
  position: absolute;
  top: clamp(8px, 6vh, 64px);
  right: clamp(12px, 3vw, 64px);
  color: #8ab9cf;
  font: 800 clamp(40px, 7vw, 104px)/1 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: -.06em;
  opacity: .14;
  user-select: none;
  white-space: nowrap;
}
.ws-host-hint {
  position: absolute;
  bottom: calc(10px + env(safe-area-inset-bottom));
  left: 14px;
  max-width: min(46vw, 420px);
  margin: 0;
  color: #6d8b88;
  font: 11px/1.4 ui-sans-serif, system-ui, sans-serif;
  opacity: .8;
  user-select: none;
}
.ws-host-voice-status-decoration {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(28vw, 320px);
  height: 28px;
  padding: 0 12px;
  opacity: .28;
}
.ws-host-voice-status-decoration span {
  display: block;
  height: 6px;
  border-radius: 3px;
  background: #95b6b1;
}
.ws-host-voice-status-decoration span:first-child { width: 64px; }
.ws-host-voice-status-decoration span:last-child { flex: 1; opacity: .6; }
@media (max-width: 640px) {
  .ws-host-hint { max-width: 62vw; }
  .ws-host-voice-status-decoration { display: none; }
}
</style>
