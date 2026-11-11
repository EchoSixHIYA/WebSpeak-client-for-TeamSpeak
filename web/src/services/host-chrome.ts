import { computed, readonly, ref, shallowRef } from "vue";
import { DECORATIVE_PART_IDS } from "../../../src/shared/skin-visual-parts.js";
import { resolveHiddenHostParts, type SkinChromeDocument } from "../../../src/shared/skin-chrome.js";
import { isHostPartReachable } from "./host-chrome-visibility.js";

/**
 * Host-owned state shared by Teleported host chrome components. Skin CSS can
 * never mutate this state: it is only written by the host from a validated
 * instance setting or a validated chrome.json document.
 */

const instanceHiddenParts = ref<ReadonlySet<string>>(new Set());
const skinChrome = shallowRef<SkinChromeDocument | undefined>(undefined);
const activeSkin = ref<string | undefined>(undefined);

/**
 * Skins bundled with WebSpeak. They are never treated as "third-party" for the
 * recovery affordance, so official Day/Night/ILLUSIA/KAAK stay decoration-free
 * and gain no extra host chrome.
 */
const BUNDLED_SKIN_IDS: ReadonlySet<string> = new Set([
  "builtin.light",
  "builtin.dark",
  "community.illusia-voice",
  "community.kaak-voice",
]);

/** The id of the skin currently applied by `usePublicSkin`. */
export function setHostChromeActiveSkin(id: string | undefined): void {
  activeSkin.value = id;
}

export function isBundledSkin(id: string | undefined): boolean {
  return !id || id.startsWith("builtin.") || BUNDLED_SKIN_IDS.has(id);
}

/** True while a non-bundled (open / third-party) skin is applied. */
export function isThirdPartySkinActive(): boolean {
  return !isBundledSkin(activeSkin.value);
}

/**
 * Decorations (`host.watermark`, `host.hint`, `host.voice-status-decoration`)
 * are hidden unless the active skin opts in with `chrome.json#visibleParts`,
 * so official and built-in skins stay identical to production.
 */
const hiddenParts = computed(() => resolveHiddenHostParts(skinChrome.value, [...instanceHiddenParts.value]));

/** Instance-level default, supplied by /api/public-config. */
export function setInstanceHiddenParts(parts: readonly string[]): void {
  instanceHiddenParts.value = new Set(parts.filter((part) => DECORATIVE_PART_IDS.has(part)));
}

/** The active skin's validated chrome.json (or undefined for built-in skins). */
export function setSkinHostChromeParts(document: SkinChromeDocument | undefined): void {
  skinChrome.value = document;
}

export function isHostPartHidden(part: string): boolean {
  return hiddenParts.value.has(part);
}

/**
 * Read the live DOM to find out whether a host part can actually be used.
 * Declarative hiding (`v-if`) removes the element entirely; CSS-only hiding
 * leaves it in place, so this also checks computed style and on-screen bounds.
 */
export function isHostPartVisuallyReachable(part: string): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return true;
  const element = document.querySelector(`[data-ws-part="${part}"]`);
  if (!element) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return isHostPartReachable({
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    pointerEvents: style.pointerEvents,
    clipPath: style.clipPath,
    clip: style.clip,
    rect: { width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
}

/** A monotonically increasing request counter; PluginPanel watches it. */
const libraryRequests = ref(0);
export const pluginLibraryRequests = readonly(libraryRequests);

export function openPluginLibrary(): void {
  libraryRequests.value += 1;
}

/**
 * Recovery's guaranteed escape hatch: reset to the built-in Day/Night skin.
 * `usePublicSkin` watches this counter, so it works even when the skinnable
 * plugin overlay is `display: none`.
 */
const builtInSkinRequests = ref(0);
export const hostBuiltInSkinRequests = readonly(builtInSkinRequests);

export function requestBuiltInSkin(): void {
  builtInSkinRequests.value += 1;
}

type RecoveryShortcutEvent = Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key">;

/**
 * The documented recovery shortcut: Ctrl+Alt+Shift+R, or ⌘+⌥+⇧+R on macOS.
 * The letter is matched case-insensitively, but every modifier is required so
 * ordinary app shortcuts (Ctrl+R, Alt+R, Ctrl+Shift+R) keep their meaning.
 */
export function isRecoveryShortcut(event: RecoveryShortcutEvent): boolean {
  return (event.ctrlKey || event.metaKey)
    && event.altKey
    && event.shiftKey
    && event.key.toLowerCase() === "r";
}
