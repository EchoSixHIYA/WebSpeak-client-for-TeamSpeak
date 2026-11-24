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
       `data-ws-part`: there is intentionally no skin hook for this control.

       With an explicit `chrome.json` `mode: "toolbar"` the host paints plain
       host buttons instead of the capsule shell. The buttons are still owned,
       labelled, focusable and clickable by the host; the skin only supplies
       an anchor and style tokens. -->
  <Teleport v-if="layer" :to="layer.container">
    <!-- One grouped toolbar entry: both actions share an anchor. -->
    <div
      v-if="groupToolbarConfig"
      ref="groupToolbarElement"
      popover="manual"
      class="ws-host-toolbar"
      data-ws-host-recovery-toolbar
      role="group"
      :aria-label="copy.recovery"
    >
      <button
        type="button"
        class="ws-host-toolbar-action"
        :class="{ 'ws-host-toolbar-action-icon': groupToolbarConfig.appearance === 'icon' }"
        data-ws-recovery-action="built-in"
        :aria-label="copy.useBuiltIn"
        :title="copy.shortcut"
        @click="useBuiltInSkin"
      >
        <span v-if="groupToolbarConfig.appearance !== 'label'" class="ws-host-toolbar-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6h.9a1.5 1.5 0 0 0 .7-2.83 1.2 1.2 0 0 1 .6-2.25H12A2 2 0 0 0 14 6.8C14 4.1 11.3 2.2 8 2.2Z"/>
            <circle cx="5" cy="6" r=".7" fill="currentColor" stroke="none"/>
            <circle cx="7.2" cy="4.6" r=".7" fill="currentColor" stroke="none"/>
            <circle cx="10" cy="4.9" r=".7" fill="currentColor" stroke="none"/>
          </svg>
        </span>
        <span v-if="groupToolbarConfig.appearance !== 'icon'" class="ws-host-toolbar-label">{{ copy.useBuiltIn }}</span>
      </button>
      <button
        v-if="pluginLibraryAvailable"
        type="button"
        class="ws-host-toolbar-action"
        :class="{ 'ws-host-toolbar-action-icon': groupToolbarConfig.appearance === 'icon' }"
        data-ws-recovery-action="library"
        :aria-label="copy.library"
        :title="copy.library"
        @click="openLibrary"
      >
        <span v-if="groupToolbarConfig.appearance !== 'label'" class="ws-host-toolbar-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <rect x="2.2" y="2.2" width="4.6" height="4.6" rx=".8"/>
            <rect x="9.2" y="2.2" width="4.6" height="4.6" rx=".8"/>
            <rect x="2.2" y="9.2" width="4.6" height="4.6" rx=".8"/>
            <rect x="9.2" y="9.2" width="4.6" height="4.6" rx=".8"/>
          </svg>
        </span>
        <span v-if="groupToolbarConfig.appearance !== 'icon'" class="ws-host-toolbar-label">{{ copy.library }}</span>
      </button>
    </div>

    <!-- Per-action toolbar entries: each action has its own anchor. -->
    <div
      v-if="builtInToolbarConfig"
      ref="builtInToolbarElement"
      popover="manual"
      class="ws-host-toolbar"
      data-ws-host-recovery-toolbar
      role="group"
      :aria-label="copy.recovery"
    >
      <button
        type="button"
        class="ws-host-toolbar-action"
        :class="{ 'ws-host-toolbar-action-icon': builtInToolbarConfig.appearance === 'icon' }"
        data-ws-recovery-action="built-in"
        :aria-label="copy.useBuiltIn"
        :title="copy.shortcut"
        @click="useBuiltInSkin"
      >
        <span v-if="builtInToolbarConfig.appearance !== 'label'" class="ws-host-toolbar-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6h.9a1.5 1.5 0 0 0 .7-2.83 1.2 1.2 0 0 1 .6-2.25H12A2 2 0 0 0 14 6.8C14 4.1 11.3 2.2 8 2.2Z"/>
            <circle cx="5" cy="6" r=".7" fill="currentColor" stroke="none"/>
            <circle cx="7.2" cy="4.6" r=".7" fill="currentColor" stroke="none"/>
            <circle cx="10" cy="4.9" r=".7" fill="currentColor" stroke="none"/>
          </svg>
        </span>
        <span v-if="builtInToolbarConfig.appearance !== 'icon'" class="ws-host-toolbar-label">{{ copy.useBuiltIn }}</span>
      </button>
    </div>

    <div
      v-if="libraryToolbarConfig"
      ref="libraryToolbarElement"
      popover="manual"
      class="ws-host-toolbar"
      data-ws-host-recovery-toolbar
      role="group"
      :aria-label="copy.recovery"
    >
      <button
        type="button"
        class="ws-host-toolbar-action"
        :class="{ 'ws-host-toolbar-action-icon': libraryToolbarConfig.appearance === 'icon' }"
        data-ws-recovery-action="library"
        :aria-label="copy.library"
        :title="copy.library"
        @click="openLibrary"
      >
        <span v-if="libraryToolbarConfig.appearance !== 'label'" class="ws-host-toolbar-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <rect x="2.2" y="2.2" width="4.6" height="4.6" rx=".8"/>
            <rect x="9.2" y="2.2" width="4.6" height="4.6" rx=".8"/>
            <rect x="2.2" y="9.2" width="4.6" height="4.6" rx=".8"/>
            <rect x="9.2" y="9.2" width="4.6" height="4.6" rx=".8"/>
          </svg>
        </span>
        <span v-if="libraryToolbarConfig.appearance !== 'icon'" class="ws-host-toolbar-label">{{ copy.library }}</span>
      </button>
    </div>

    <div
      ref="recoveryPopover"
      popover="manual"
      @keydown.escape="onRecoveryEscape"
      @click="compactPinned = compact || compactPinned"
      @focusout="onRecoveryFocusOut"
      class="ws-host-recovery"
      :class="{ 'ws-host-recovery-compact': compact }"
      :data-ws-float="capsuleSlotConfig && slotMode === 'slotted' ? undefined : floatPosition"
      :tabindex="compact || compactPinned ? 0 : undefined"
      data-ws-host-recovery
      role="region"
      :aria-label="copy.recovery"
    >
      <span class="ws-host-recovery-mark" aria-hidden="true">◈</span>
      <button
        v-if="capsuleActions.includes('built-in')"
        type="button"
        class="ws-host-recovery-action"
        data-ws-recovery-action="built-in"
        :title="copy.shortcut"
        @click="useBuiltInSkin"
      >{{ copy.useBuiltIn }}</button>
      <button
        v-if="capsuleActions.includes('library') && pluginLibraryAvailable"
        type="button"
        class="ws-host-recovery-action"
        data-ws-recovery-action="library"
        :title="copy.library"
        @click="openLibrary"
      >{{ copy.library }}</button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect, type Ref } from "vue";
import type { SiteLanguage } from "../../../src/site-copy.js";
import type { SkinChromeSlot } from "../../../src/shared/skin-chrome.js";
import { hostChromeCopy } from "../i18n/host-chrome.js";
import {
  activeHostSlot,
  hostChromeActiveSkinId,
  isHostPartHidden,
  isHostPartVisuallyReachable,
  isRecoveryShortcut,
  isThirdPartySkinActive,
  openPluginLibrary,
  requestBuiltInSkin,
  setInlineLibraryEntryVisible,
} from "../services/host-chrome.js";
import {
  createHostOwnedLayer,
  syncRecoveryPopover,
  type HostOwnedLayer,
} from "../services/host-owned-layer.js";
import { bindHostSlot, type HostSlotBinding } from "../services/host-slot-placement.js";
import {
  bindFloatingAvoidance,
  type FloatingAvoidance,
  type FloatingPosition,
} from "../services/host-floating-placement.js";
import { shouldShowRecovery, type HostPartRect } from "../services/host-chrome-visibility.js";
import { thirdPartyAllowed } from "../services/instance-authorization.js";
import {
  RECOVERY_CONTROL_DEFAULTS,
  bindHostControlTheme,
  findSkinRoot,
} from "../services/host-control-tokens.js";
import {
  resolveHostRecoveryPresentation,
} from "../services/host-recovery-presentation.js";

const props = withDefaults(defineProps<{ language: SiteLanguage; connected?: boolean; pluginLibraryAvailable?: boolean }>(), { connected: false });
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
  border: 1px solid var(--ws-control-border, #9db6b2);
  border-radius: var(--ws-control-radius, 999px);
  background: var(--ws-control-background, color-mix(in srgb, #ffffff 92%, transparent));
  color: var(--ws-control-foreground, #31524f);
  font-family: var(--ws-control-font, ui-sans-serif, system-ui, sans-serif);
  font-size: var(--ws-control-font-size, 11px);
  box-shadow: 0 6px 18px #0f2a2626;
  pointer-events: auto;
}
.ws-host-recovery:popover-open { display: flex; }
/* Runtime collision avoidance (host-floating-placement.ts): when the default
   corner would cover a skin control, the floating capsule moves. A docked
   (slotted) capsule carries no data-ws-float and uses inline placement. */
.ws-host-recovery[data-ws-float$="right"] { left: auto; right: max(12px, env(safe-area-inset-right)); }
.ws-host-recovery[data-ws-float^="top"] { bottom: auto; top: max(12px, env(safe-area-inset-top)); }
.ws-host-recovery[data-ws-float^="middle"] { bottom: auto; top: 50%; translate: 0 -50%; }
.ws-host-recovery[data-ws-float$="center"] { left: 50%; translate: -50% 0; }
.ws-host-recovery-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
}
.ws-host-recovery button {
  display: inline-flex;
  align-items: center;
  min-height: var(--ws-control-hit, 28px);
  padding: 4px 9px;
  border: 1px solid var(--ws-control-border, #9db6b2);
  border-radius: var(--ws-control-radius, 999px);
  background: var(--ws-control-background, #fff);
  color: var(--ws-control-foreground, #31524f);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.ws-host-recovery button[data-ws-recovery-action="built-in"] {
  border-color: var(--ws-control-builtin-border, #b45309);
  background: #fff7ed;
  color: #7c2d12;
}
.ws-host-recovery button:hover { filter: brightness(.96); }
.ws-host-recovery button:focus-visible { outline: 2px solid #4c8f88; outline-offset: 2px; }
.ws-host-recovery.ws-host-recovery-compact:not(:hover):not(:focus-within) { gap: 0; padding: 4px; }
.ws-host-recovery.ws-host-recovery-compact:not(:hover):not(:focus-within) .ws-host-recovery-action { display: none; }
.ws-host-recovery.ws-host-recovery-compact:not(:hover):not(:focus-within) .ws-host-recovery-mark {
  min-width: var(--ws-control-hit, 28px);
  min-height: var(--ws-control-hit, 28px);
}
.ws-host-recovery.ws-host-recovery-compact:focus-visible { outline: 2px solid var(--ws-control-accent, #4c8f88); outline-offset: 2px; }

/* Toolbar mode: no capsule shell, margin, border or fixed shadow. The wrapper
   only lays the host buttons out; every visible surface comes from the
   --ws-toolbar-* variables resolved from the skin's validated tokens. */
.ws-host-toolbar {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: var(--ws-toolbar-gap, 4px);
  max-width: calc(100vw - 8px);
  pointer-events: auto;
}
.ws-host-toolbar:popover-open { display: flex; }
.ws-host-toolbar-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  min-height: var(--ws-toolbar-min-height, var(--ws-control-hit, 28px));
  max-width: min(320px, calc(100vw - 8px));
  padding: var(--ws-toolbar-padding-y, 6px) var(--ws-toolbar-padding-x, 12px);
  border: 1px solid var(--ws-toolbar-border, #9db6b2);
  border-radius: var(--ws-toolbar-radius, 6px);
  background: var(--ws-toolbar-background, #fff);
  color: var(--ws-toolbar-foreground, #31524f);
  box-shadow: var(--ws-toolbar-shadow, none);
  font-family: var(--ws-toolbar-font, ui-sans-serif, system-ui, sans-serif);
  font-size: var(--ws-toolbar-font-size, 11px);
  line-height: 1.25;
  text-align: center;
  white-space: normal;
  overflow-wrap: anywhere;
  cursor: pointer;
  touch-action: manipulation;
}
.ws-host-toolbar-action:hover {
  border-color: var(--ws-toolbar-hover-border, var(--ws-toolbar-border, #9db6b2));
  background: var(--ws-toolbar-hover-background, var(--ws-toolbar-background, #fff));
}
.ws-host-toolbar-action:focus-visible {
  outline: 2px solid var(--ws-toolbar-focus, var(--ws-control-accent, #4c8f88));
  outline-offset: 2px;
}
.ws-host-toolbar-icon {
  display: block;
  flex: 0 0 auto;
  width: var(--ws-toolbar-icon-size, 16px);
  height: var(--ws-toolbar-icon-size, 16px);
}
.ws-host-toolbar-icon svg { display: block; width: 100%; height: 100%; }
.ws-host-toolbar-action-icon {
  width: max(24px, calc(var(--ws-toolbar-icon-size, 16px) + 8px));
  padding: 0;
}
@media (prefers-reduced-motion: reduce) {
  .ws-host-recovery, .ws-host-recovery button, .ws-host-toolbar-action { transition: none !important; }
}
`;

const layer: HostOwnedLayer | null = createHostOwnedLayer("recovery", RECOVERY_LAYER_CSS);

// CSS-only hiding is invisible to `isHostPartHidden`, so sample the launcher's
// live geometry. A one-second interval is enough for a recovery fallback and
// stays cheaper than a MutationObserver on the whole document. While a
// third-party skin is active the entry is persistent and this sample only
// matters for the official-skin fallback.
const launcherReachable = ref(true);
const showRecovery = computed(() => shouldShowRecovery({
  connected: props.connected && Boolean(props.pluginLibraryAvailable),
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
const groupToolbarElement = ref<HTMLElement | null>(null);
const builtInToolbarElement = ref<HTMLElement | null>(null);
const libraryToolbarElement = ref<HTMLElement | null>(null);

const recoveryVisible = computed(() => showRecovery.value || (shortcutOpen.value && thirdPartyAllowed.value));

/**
 * Optional anchor from the active skin's chrome.json. Only third-party skins
 * can declare it; the host still owns the controls and the module falls back
 * to the default corner whenever an anchor stops being usable.
 */
const slotConfig = computed(() => activeHostSlot("host.recovery"));
const builtInSlotConfig = computed(() => activeHostSlot("host.recovery.built-in"));
const librarySlotConfig = computed(() => activeHostSlot("host.recovery.library"));
const groupToolbarConfig = computed<SkinChromeSlot | undefined>(() => slotConfig.value?.mode === "toolbar" ? slotConfig.value : undefined);
const capsuleSlotConfig = computed<SkinChromeSlot | undefined>(() => slotConfig.value?.mode === "toolbar" ? undefined : slotConfig.value);
const builtInToolbarConfig = computed<SkinChromeSlot | undefined>(() => builtInSlotConfig.value?.mode === "toolbar" ? builtInSlotConfig.value : undefined);
const libraryToolbarConfig = computed<SkinChromeSlot | undefined>(() => librarySlotConfig.value?.mode === "toolbar" ? librarySlotConfig.value : undefined);

/**
 * Theme the capsule even when the skin does not declare a slot. While a
 * capsule slot binding exists it reads the anchor first and owns the tokens;
 * this root-level pass covers the slot-less capsule and refreshes itself when
 * the skin stylesheet arrives after the stored skin id. Toolbar bindings keep
 * their own `--ws-toolbar-*` variables and do not disable this pass, so the
 * floating fallback keeps the capsule palette.
 */
const recoveryTheme = layer ? bindHostControlTheme({
  layer,
  control: () => recoveryPopover.value,
  part: "host.recovery",
  defaults: RECOVERY_CONTROL_DEFAULTS,
  source: () => findSkinRoot(hostChromeActiveSkinId.value),
  active: () => !capsuleBinding,
}) : null;

const slotMode = ref<"floating" | "slotted">("floating");
const groupToolbarMode = ref<"floating" | "slotted">("floating");
const builtInToolbarMode = ref<"floating" | "slotted">("floating");
const libraryToolbarMode = ref<"floating" | "slotted">("floating");

const builtInActionState = computed(() => ({
  available: Boolean(groupToolbarConfig.value || builtInToolbarConfig.value),
  docked: groupToolbarConfig.value
    ? groupToolbarMode.value === "slotted"
    : builtInToolbarMode.value === "slotted",
}));
const libraryActionState = computed(() => ({
  available: Boolean(props.pluginLibraryAvailable) && Boolean(groupToolbarConfig.value || libraryToolbarConfig.value),
  docked: groupToolbarConfig.value
    ? groupToolbarMode.value === "slotted"
    : libraryToolbarMode.value === "slotted",
}));

const presentation = computed(() => resolveHostRecoveryPresentation({
  visible: recoveryVisible.value,
  shortcutOpen: shortcutOpen.value,
  libraryAvailable: Boolean(props.pluginLibraryAvailable),
  builtIn: builtInActionState.value,
  library: libraryActionState.value,
}));
const capsuleActions = computed(() => presentation.value.capsuleActions);

// Exactly one application-library entry per page: the host toolbar button is
// the library entry while a toolbar slot exists, so PluginPanel hides its
// ordinary launcher (including while the capsule fallback shows the button).
watchEffect(() => {
  setInlineLibraryEntryVisible(presentation.value.suppressLauncher);
});

const compactHold = ref(true);
let compactHoldTimer: ReturnType<typeof setTimeout> | undefined;

// Keep the full capsule visible for a moment after it first docks into a
// newly activated skin, so the entry stays discoverable before it folds into
// the skin's layout. The skin id is known from localStorage before the skin
// (and its anchor) has loaded, so the 5 s window starts on the first
// floating -> slotted transition for that skin, not on the id change.
let compactHoldStarted = false;
watch(hostChromeActiveSkinId, () => {
  compactHold.value = true;
  compactHoldStarted = false;
  if (compactHoldTimer) clearTimeout(compactHoldTimer);
  compactHoldTimer = undefined;
}, { immediate: true });
watch(slotMode, (mode) => {
  if (mode !== "slotted" || compactHoldStarted) return;
  compactHoldStarted = true;
  compactHoldTimer = setTimeout(() => { compactHold.value = false; }, 5000);
});

/** Set by the shortcut; cleared once focus leaves the capsule. */
const shortcutExpanded = ref(false);
/** A tap/click on the compact mark keeps it expanded (no hover on touch). */
const compactPinned = ref(false);

/**
 * Floating (not docked) capsule: corner chosen at runtime so it does not cover
 * skin controls, and folded to its mark when every corner collides.
 */
const floatPosition = ref<FloatingPosition>("bottom-left");
const floatCompact = ref(false);
let floatingAvoidance: FloatingAvoidance | undefined;
let floatingElement: HTMLElement | null = null;
/** Sticky `:hover` after a tap on touch screens must not pause avoidance. */
const canHover = () => typeof matchMedia === "function" && matchMedia("(hover: hover)").matches;

const compact = computed(() => {
  if (shortcutExpanded.value || compactPinned.value) return false;
  const config = capsuleSlotConfig.value;
  if (config) return Boolean(config.compact) && !compactHold.value;
  // A toolbar-mode capsule is the fallback entry, not the target look: never
  // fold it, otherwise a failed anchor could leave only a small mark.
  if (groupToolbarConfig.value || builtInToolbarConfig.value || libraryToolbarConfig.value) return false;
  return floatCompact.value;
});

function onRecoveryEscape() {
  shortcutOpen.value = false;
  shortcutExpanded.value = false;
  compactPinned.value = false;
}

/** Unpin when the pointer goes down anywhere outside the host layer. */
function onDocumentPointerDown(event: PointerEvent) {
  if (!compactPinned.value || !layer) return;
  // Events from inside the closed shadow root are retargeted to its host.
  if (event.composedPath().includes(layer.host)) return;
  compactPinned.value = false;
}

function onRecoveryFocusOut(event: FocusEvent) {
  const next = event.relatedTarget;
  if (next instanceof Node && recoveryPopover.value?.contains(next)) return;
  shortcutExpanded.value = false;
  compactPinned.value = false;
}

let capsuleBinding: HostSlotBinding | undefined;
let toolbarBindings: HostSlotBinding[] = [];

function syncPopover() {
  syncRecoveryPopover(recoveryPopover.value, presentation.value.capsuleVisible);
}

function syncToolbarPopovers() {
  const visible = presentation.value.toolbar.visible;
  syncRecoveryPopover(
    groupToolbarElement.value,
    Boolean(groupToolbarConfig.value) && visible && groupToolbarMode.value === "slotted",
  );
  syncRecoveryPopover(
    builtInToolbarElement.value,
    Boolean(builtInToolbarConfig.value) && visible && builtInToolbarMode.value === "slotted",
  );
  syncRecoveryPopover(
    libraryToolbarElement.value,
    Boolean(libraryToolbarConfig.value) && Boolean(props.pluginLibraryAvailable)
      && visible && libraryToolbarMode.value === "slotted",
  );
}

/** A toolbar that is currently displayed (top layer or display fallback). */
function isToolbarShown(control: HTMLElement | null): boolean {
  if (!control) return false;
  if (control.matches?.(":popover-open")) return true;
  const rect = control.getBoundingClientRect();
  return getComputedStyle(control).display !== "none" && rect.width > 0 && rect.height > 0;
}

function rectOf(control: HTMLElement): HostPartRect {
  const rect = control.getBoundingClientRect();
  return {
    left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    right: rect.right, bottom: rect.bottom,
  };
}

/** Every recovery toolbar currently docked in the top layer. */
function dockedToolbarRects(): HostPartRect[] {
  return [groupToolbarElement.value, builtInToolbarElement.value, libraryToolbarElement.value]
    .filter((element): element is HTMLElement => Boolean(element) && isToolbarShown(element))
    .map(rectOf);
}

/** Other docked recovery toolbars this entry must not cover on a narrow screen. */
function otherToolbarRects(control: HTMLElement): HostPartRect[] {
  return [groupToolbarElement.value, builtInToolbarElement.value, libraryToolbarElement.value]
    .filter((element): element is HTMLElement => Boolean(element)
      && element !== control && isToolbarShown(element))
    .map(rectOf);
}

function bindToolbarEntry(
  control: HTMLElement | null,
  config: SkinChromeSlot | undefined,
  mode: Ref<"floating" | "slotted">,
) {
  if (!layer || !control || !config) return;
  toolbarBindings.push(bindHostSlot({
    layer,
    control,
    anchor: config.anchor,
    skinId: hostChromeActiveSkinId.value,
    align: config.align,
    presentation: "toolbar",
    otherControls: () => otherToolbarRects(control),
    // A floating toolbar is a closed popover (display:none). Show it for the
    // synchronous measurement/hit test and hide it again unless it docked.
    prepare: () => syncRecoveryPopover(control, true),
    settle: slotted => {
      if (!slotted || !presentation.value.toolbar.visible) syncRecoveryPopover(control, false);
    },
    onModeChange: change => {
      mode.value = change.mode;
      syncPopover();
      syncToolbarPopovers();
    },
  }));
}

function syncSlotBindings() {
  capsuleBinding?.dispose();
  capsuleBinding = undefined;
  for (const binding of toolbarBindings) binding.dispose();
  toolbarBindings = [];
  // Disposing a slot clears its inline tokens; restore the root-level theme
  // before deciding whether a new anchor should override it.
  recoveryTheme?.apply();
  // A fresh binding starts floating and reports its first successful dock.
  slotMode.value = "floating";
  groupToolbarMode.value = "floating";
  builtInToolbarMode.value = "floating";
  libraryToolbarMode.value = "floating";
  const capsuleConfig = capsuleSlotConfig.value;
  if (recoveryPopover.value && capsuleConfig && layer) {
    capsuleBinding = bindHostSlot({
      layer,
      control: recoveryPopover.value,
      anchor: capsuleConfig.anchor,
      skinId: hostChromeActiveSkinId.value,
      align: capsuleConfig.align,
      // A slotted capsule must not cover a still-docked split toolbar either.
      otherControls: () => dockedToolbarRects(),
      onModeChange: change => { slotMode.value = change.mode; },
    });
  }
  bindToolbarEntry(groupToolbarElement.value, groupToolbarConfig.value, groupToolbarMode);
  bindToolbarEntry(builtInToolbarElement.value, builtInToolbarConfig.value, builtInToolbarMode);
  if (props.pluginLibraryAvailable) {
    bindToolbarEntry(libraryToolbarElement.value, libraryToolbarConfig.value, libraryToolbarMode);
  }
  syncPopover();
  syncToolbarPopovers();
}

function revalidateBindings() {
  capsuleBinding?.revalidate();
  for (const binding of toolbarBindings) binding.revalidate();
}

function bindFloating() {
  const control = recoveryPopover.value;
  // Idempotent: called on mount and whenever the popover element appears.
  if (floatingAvoidance && floatingElement === control) return;
  floatingAvoidance?.dispose();
  floatingAvoidance = undefined;
  floatingElement = null;
  if (!control || !layer) return;
  const host = layer.host;
  floatingElement = control;
  floatingAvoidance = bindFloatingAvoidance({
    element: control,
    isSelf: node => node === host || host.contains(node),
    // Same numbers as RECOVERY_LAYER_CSS, including env(safe-area-inset-*).
    margins: insets => ({
      top: Math.max(12, insets.top),
      right: Math.max(12, insets.right),
      bottom: 38 + insets.bottom,
      left: Math.max(12, insets.left),
    }),
    insetsParent: layer.shadow,
    defaultPosition: "bottom-left",
    apply: next => { floatPosition.value = next; },
    compactSize: () => {
      const hit = Number.parseFloat(getComputedStyle(control).getPropertyValue("--ws-control-hit")) || 28;
      return { width: hit + 10, height: hit + 10 };
    },
    onCompactChange: next => { floatCompact.value = next; },
    // Docked toolbars are inside the closed shadow root, so the light-DOM
    // obstacle scan cannot see them. In split mode the library toolbar falls
    // back to this capsule while the built-in toolbar stays docked; without
    // this exclusion the capsule could cover it (320px GUI failure).
    avoidRects: () => dockedToolbarRects(),
    // Never move the capsule under the user's pointer or focus, and leave a
    // docked capsule to the slot binding.
    paused: () => slotMode.value === "slotted"
      || shortcutExpanded.value
      || compactPinned.value
      || (canHover() && control.matches(":hover"))
      || Boolean(layer.shadow.activeElement),
  });
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
  if (event.repeat || !thirdPartyAllowed.value) return;
  // The recovery chord must survive a capture-phase preventDefault() from a
  // skin or plugin, so it is handled before anything else.
  if (isRecoveryShortcut(event)) {
    event.preventDefault();
    shortcutOpen.value = true;
    shortcutExpanded.value = true;
    void nextTick(() => {
      // The shortcut always brings back the complete capsule, even while a
      // toolbar anchor is healthy.
      syncPopover();
      syncToolbarPopovers();
      revalidateBindings();
      recoveryPopover.value?.querySelector("button")?.focus();
    });
  }
}

let reachabilityTimer: ReturnType<typeof setInterval> | undefined;
function refreshLauncherReachability() {
  launcherReachable.value = isHostPartVisuallyReachable("host.plugins.launcher");
}

watch(
  [recoveryVisible, recoveryPopover, groupToolbarElement, builtInToolbarElement, libraryToolbarElement],
  () => {
    void nextTick(() => {
      syncPopover();
      syncToolbarPopovers();
      revalidateBindings();
      bindFloating();
      floatingAvoidance?.revalidate();
    });
  },
  { flush: "post" },
);
watch([recoveryPopover, hostChromeActiveSkinId], () => {
  void nextTick(() => recoveryTheme?.apply());
}, { flush: "post", immediate: true });
watch(
  [
    slotConfig,
    builtInSlotConfig,
    librarySlotConfig,
    hostChromeActiveSkinId,
    groupToolbarElement,
    builtInToolbarElement,
    libraryToolbarElement,
    () => props.pluginLibraryAvailable,
  ],
  () => {
    void nextTick(() => {
      syncSlotBindings();
      bindFloating();
    });
  },
  { flush: "post" },
);
// Home <-> voice page and skin switches replace the controls the floating
// capsule was avoiding; re-place it promptly (and back to its default corner
// when that is free) instead of leaving it where the previous screen needed it.
watch([() => props.connected, hostChromeActiveSkinId], () => {
  void nextTick(() => {
    revalidateBindings();
    floatingAvoidance?.screenChanged();
  });
}, { flush: "post" });
watch(thirdPartyAllowed, allowed => { if (!allowed) shortcutOpen.value = false; });
// Opening or closing the shortcut changes which presentation is active; docked
// toolbar buttons must hide while the complete capsule is summoned, and come
// back (if their anchor is still valid) when it closes.
watch(shortcutOpen, () => {
  void nextTick(() => {
    syncPopover();
    syncToolbarPopovers();
    revalidateBindings();
  });
}, { flush: "post" });

// A page switch can mount a new `.ws-skin-root` with a different
// `data-ws-page` without changing the skin id. Re-resolve the declared anchor
// candidates promptly instead of waiting for the periodic safety check.
let pageObserver: MutationObserver | undefined;

onMounted(() => {
  refreshLauncherReachability();
  reachabilityTimer = setInterval(refreshLauncherReachability, 1000);
  window.addEventListener("resize", refreshLauncherReachability);
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("pointerdown", onDocumentPointerDown, true);
  if (typeof MutationObserver === "function") {
    pageObserver = new MutationObserver(() => {
      void nextTick(() => {
        syncPopover();
        syncToolbarPopovers();
        revalidateBindings();
        floatingAvoidance?.screenChanged();
      });
    });
    pageObserver.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-ws-page", "data-ws-skin"],
    });
  }
  void nextTick(() => {
    syncPopover();
    syncSlotBindings();
    bindFloating();
  });
});
onBeforeUnmount(() => {
  if (reachabilityTimer) clearInterval(reachabilityTimer);
  if (compactHoldTimer) clearTimeout(compactHoldTimer);
  pageObserver?.disconnect();
  pageObserver = undefined;
  capsuleBinding?.dispose();
  capsuleBinding = undefined;
  for (const binding of toolbarBindings) binding.dispose();
  toolbarBindings = [];
  setInlineLibraryEntryVisible(false);
  floatingAvoidance?.dispose();
  floatingAvoidance = undefined;
  floatingElement = null;
  recoveryTheme?.dispose();
  window.removeEventListener("resize", refreshLauncherReachability);
  window.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("pointerdown", onDocumentPointerDown, true);
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
