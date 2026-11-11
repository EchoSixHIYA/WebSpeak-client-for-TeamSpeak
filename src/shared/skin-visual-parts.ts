/**
 * Single source of truth for the public skin part policy.
 *
 * `skin-css.ts` (CSS hiding whitelist), `skin-layout.ts` (layout editor
 * metadata) and `skin-chrome.ts` (declarative host chrome document) all read
 * these sets so a part can never be "hideable" in one layer and protected in
 * another. Adding a part here is the only way to make it explicitly optional.
 */

/** Password dialog parts are trusted in both the CSS and layout layers. */
export const AUTH_PASSWORD_PART_IDS = [
  "auth.password.backdrop",
  "auth.password.dialog",
  "auth.password.decoration",
  "auth.password.eyebrow",
  "auth.password.title",
  "auth.password.lead",
  "auth.password.form",
  "auth.password.label",
  "auth.password.field",
  "auth.password.field-icon",
  "auth.password.error",
  "auth.password.actions",
] as const;

/**
 * Host chrome is drawn by WebSpeak outside `.ws-skin-root` (Teleport to body)
 * or is painted by the host with fixed artwork. A skin may theme these parts,
 * but only through the dedicated document-level host scope, never with a
 * global `html` / `body` selector.
 */
export const HOST_CHROME_PART_IDS: ReadonlySet<string> = new Set([
  "host.plugins.launcher",
  "host.plugins.overlay",
  "host.watermark",
  "host.hint",
  "host.voice-status-decoration",
]);

/** Host parts that must stay reachable and can never be hidden or themed. */
export const HOST_TRUSTED_PART_IDS: ReadonlySet<string> = new Set([
  "host.recovery",
  "host.permission",
]);

/** All host-owned parts (used by the part registry and documentation). */
export const HOST_PART_IDS: ReadonlySet<string> = new Set([
  ...HOST_CHROME_PART_IDS,
  ...HOST_TRUSTED_PART_IDS,
]);

/**
 * Explicitly optional (decorative) visual parts. Both `OPTIONAL_VISUAL_PARTS`
 * in the CSS compiler and `DECORATIVE_PART_IDS` in the layout registry are
 * aliases of this set.
 *
 * `home.footer` is deliberately absent: the footer contains the necessary
 * "clear local data" recovery link. The purely decorative text is split into
 * `home.footer.decoration`, which is the part that may be hidden.
 */
export const DECORATIVE_PART_IDS: ReadonlySet<string> = new Set([
  "demo.avatar", "demo.badge", "demo.note", "demo.poke-notification", "demo.wave",
  "demo.member-status",
  "home.feature", "home.features", "home.footer.decoration", "home.hero.eyebrow",
  "home.gateway-status", "home.join-card.sonar", "home.join-card.waveform", "home.visitors",
  "voice.activity.artwork", "voice.activity-heading", "voice.member.avatar",
  "voice.member.avatar-wrap", "voice.member.live-indicator", "voice.member-row.avatar",
  "voice.performance.metrics", "voice.performance.webrtc-stats",
  "voice.screen-player.viewer-avatar", "voice.screen-player.live",
  "host.watermark", "host.hint", "host.voice-status-decoration", "host.plugins.launcher",
]);

/** Trusted host UI: authorization, connection status, identity and recovery. */
export const TRUSTED_PART_IDS: ReadonlySet<string> = new Set([
  ...AUTH_PASSWORD_PART_IDS,
  ...HOST_TRUSTED_PART_IDS,
  "app",
  "app.toast",
  "app.skin-load-recovery",
  "home.security-note",
  "home.identity-import.security",
  "voice.connection-status",
  "voice.screen-share-error",
]);

/**
 * Parts that even an open (v3/v4) skin must never visually remove: the
 * permission/recovery entries and the essential audio operation path.
 *
 * This is deliberately narrower than `TRUSTED_PART_IDS`: trusted metadata also
 * covers decorative children of the password dialog (`auth.password.decoration`,
 * `auth.password.eyebrow`, `auth.password.lead`, `auth.password.label`,
 * `auth.password.field-icon`), which existing skins legitimately hide. Only the
 * dialog shell, form, field, error and action row are protected.
 */
export const PROTECTED_PART_IDS: ReadonlySet<string> = new Set([
  "app",
  "app.toast",
  "app.skin-load-recovery",
  "home.security-note",
  "home.identity-import.security",
  // The footer container holds the necessary "clear local data" recovery
  // link; only its decorative children may be hidden.
  "home.footer",
  "home.footer.clear",
  "voice.connection-status",
  "voice.connection-status.reconnect",
  "voice.connection-status.nickname.input",
  "voice.audio-status",
  "voice.audio-dock",
  "voice.audio-dock.microphone",
  "voice.audio-dock.output",
  "voice.audio-dock.microphone-panel",
  "voice.audio-dock.output-panel",
  "voice.audio-settings",
  "voice.screen-share-error",
  "voice.mobile-nav",
  "voice.mobile-more",
  "demo.reconnect.restore",
  "auth.password.dialog",
  "auth.password.form",
  "auth.password.field",
  "auth.password.error",
  "auth.password.actions",
  "host.recovery",
  "host.permission",
]);

/** Stable icon bitmap slots. `chrome.json` may only reference these names. */
export const SKIN_ICON_SLOT_IDS: ReadonlySet<string> = new Set([
  "host.plugins.launcher",
  "language.trigger",
  "skin.trigger",
  "voice.performance",
  "home.toolbar.settings",
]);

export function isHostChromePart(part: string): boolean {
  return HOST_CHROME_PART_IDS.has(part);
}

export function isHostPart(part: string): boolean {
  return HOST_PART_IDS.has(part) || part.startsWith("host.");
}

export function isDecorativePart(part: string): boolean {
  return DECORATIVE_PART_IDS.has(part);
}

export function isProtectedPart(part: string): boolean {
  return PROTECTED_PART_IDS.has(part);
}

/** Document-level marker set by the host while a custom skin is active. */
export const HOST_SKIN_ATTRIBUTE = "data-ws-host-skin";
