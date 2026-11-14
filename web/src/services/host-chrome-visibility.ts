/**
 * Pure visibility decisions used by the host chrome recovery entry.
 *
 * The actual DOM reads live in `host-chrome.ts`; keeping the predicates here
 * makes them testable without a browser and keeps the preview page and the Vue
 * client on the same rules.
 */

export interface HostPartRect {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HostPartVisibilitySnapshot {
  display: string;
  visibility: string;
  opacity: string;
  pointerEvents: string;
  /** Optional: computed `clip-path`; strong clipping makes a control unusable. */
  clipPath?: string;
  /** Optional: legacy computed `clip` (for example `rect(0 0 0 0)`). */
  clip?: string;
  rect: HostPartRect;
  viewport: { width: number; height: number };
}

function isClippedAway(clipPath: string, clip: string): boolean {
  const path = clipPath.toLowerCase();
  // `inset(50%)` collapses both axes; a three-digit/100 percentage does too.
  if (/inset\(\s*(?:[5-9]\d|100)%/.test(path)) return true;
  // Large pixel insets are the unit-based variant of the same escape.
  if (/inset\(\s*\d{3,}px/.test(path)) return true;
  if (/(?:circle|ellipse)\(\s*0(?:px)?\s*[,)]/.test(path)) return true;
  const legacy = clip.toLowerCase();
  return /rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)/.test(legacy);
}

/**
 * A host part is reachable when it is rendered, visible, interactive and at
 * least partially inside the viewport. CSS-only hiding (display, visibility,
 * opacity, pointer-events, clipping, off-screen margins/transforms) therefore
 * counts as unavailable even when no chrome.json declared the part hidden.
 */
export function isHostPartReachable(snapshot: HostPartVisibilitySnapshot): boolean {
  if (snapshot.display === "none") return false;
  if (snapshot.visibility === "hidden" || snapshot.visibility === "collapse") return false;
  const opacity = Number.parseFloat(snapshot.opacity);
  if (Number.isFinite(opacity) && opacity <= 0.01) return false;
  if (snapshot.pointerEvents === "none") return false;
  if (isClippedAway(snapshot.clipPath ?? "none", snapshot.clip ?? "auto")) return false;
  const { rect, viewport } = snapshot;
  if (!(rect.width > 0) || !(rect.height > 0)) return false;
  if (rect.right <= 0 || rect.bottom <= 0) return false;
  if (rect.left >= viewport.width || rect.top >= viewport.height) return false;
  return true;
}

export interface RecoveryVisibilityInput {
  connected: boolean;
  thirdPartyAllowed: boolean;
  /** A non-bundled skin is applied, so the recovery affordance is persistent. */
  thirdPartySkinActive: boolean;
  /** The part is hidden declaratively (chrome.json hiddenParts / instance setting). */
  launcherHiddenByConfig: boolean;
  /** The launcher element is currently rendered and reachable in the DOM. */
  launcherReachable: boolean;
}

/**
 * The recovery entry is a small, persistent host-owned affordance while a
 * third-party skin is active, so a hostile skin can never remove the only way
 * back. Official/built-in skins (Day, Night, ILLUSIA, KAAK) never grow it
 * automatically: for them it remains a fallback that only appears when the
 * normal launcher is declared or observed unavailable while connected.
 */
export function shouldShowRecovery(input: RecoveryVisibilityInput): boolean {
  if (!input.thirdPartyAllowed) return false;
  if (input.thirdPartySkinActive) return true;
  return input.connected && (input.launcherHiddenByConfig || !input.launcherReachable);
}
