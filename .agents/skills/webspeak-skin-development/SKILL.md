---
name: webspeak-skin-development
description: Create, refine, package, and verify WebSpeak v1 visual, v2 layout, and v3 open skins, including custom declarative public interfaces, full-page surfaces, and permission-gated TeamSpeak interactions.
---

# WebSpeak skin development

Use this skill when editing or authoring a WebSpeak `.wskin` package, a built-in skin, or skin-facing UI hooks. v1/v2 packages are visual/layout data; v3 may freely compose bounded declarative UI from its own nodes, rearrange public UI, and replace the visible home/voice page with a validated surface. Optional host widgets are reusable trusted primitives, not the limit of custom UI. WebSpeak owns host behavior and the administrator console is outside the skin scope.

## Before editing

- Read [`docs/SKIN_DEVELOPMENT.md`](../../../docs/SKIN_DEVELOPMENT.md) for the current package validator and public hooks.
- Use [`docs/examples/illusia-voice/`](../../../docs/examples/illusia-voice/) and [`docs/examples/ILLUSIA-VOICE.md`](../../../docs/examples/ILLUSIA-VOICE.md) as the reference implementation. Do not restore the removed Aurora Voice sample.
- Inspect the actual component markup for `data-ws-page`, `data-ws-part`, and `data-ws-state` hooks. Treat Vue classes and incidental DOM structure as private.

## Preserve the interface

- Keep WebSpeak's translations and semantic content as the baseline. Add `content.json` only when a text override is an explicit part of the request; never use it to implement visual artwork.
- Follow the schema-specific CSS rules: v1/v2 reject layout changes; v3 allows layout, placement, size, typography, and visibility changes within the skin root. Keep CSS package-local, scoped to public hooks, and free of external resources or executable values.
- v3 can replace or obscure normal page controls. A surface must request `ui.surface.replace` and stays disabled until the user approves it. Custom interfaces can use their own declarative nodes and CSS; embed optional host widgets only when a trusted WebSpeak control is useful. Available widget IDs are registered in `src/shared/skin-plugin.ts`; each stateful host widget may appear once per page. Preserve usable microphone, disconnect, device-settings, screen-share and recovery paths at desktop and mobile sizes. Verify both the return-to-built-in-UI and restore-built-in-skin buttons. The host recovery and permission UI render outside the skin root. Keep `/admin/**` unskinned.
- components.json schema v1 is legacy; v2 adds `mode: "surface"` and optional allowlisted host-widget nodes; v3 expands bounded declarative composition, events and permission-gated voice actions. Keep script/Wasm execution disabled in production until sandbox review and host rendering/action validation are complete. The development Wasm prototype may return one untrusted `ui_emit_json` string up to 16 KiB; `parseSkinExtensionUiOutput` accepts only schema v3 display nodes, no widgets, surfaces, permissions, or non-local actions, then the outlet revalidates the combined component tree before rendering. Treat this as a validated development bridge, not production approval. Never execute HTML strings or expose direct network/storage or private host objects. Request only the component-level permissions needed; surfaces require `ui.surface.replace`. Bind voice actions only to explicit trusted activations; passive focus/blur/hover/drag-start/over events may update local UI state only, and input/change must not trigger host actions. Keep server-list labels and opaque identifiers separate from addresses and credentials. Use `servers.quickList` plus `quickServers.switch` when a custom UI should show favorites and recent servers together. Host widgets execute in WebSpeak and do not grant author code access to their private state.
- Use the host's reserved artwork hooks for layered character art and the headphone scene. Prefer transparent assets and `background-size: contain` where the reference requires the full character or chibi to remain visible; arrange the artwork around the fixed hook rather than changing its geometry.
- Build visual depth with separate background, surface, and foreground artwork already exposed by the hooks. Avoid duplicate static decorations when an animated replacement exists. For motion, keep waveforms/sonar smooth and restrained, honor reduced-motion preferences, and retain readable focus, error, mute, and speaking states.
- Keep skin-specific CSS variables under `--skin-*`. Use only package-local assets and confirm their redistribution rights.

## Verify and package

1. Compare the implementation with its accessible visual reference at desktop and narrow widths. Check the homepage, voice workspace, empty chat, member list, screen-share player, selectors, and `/demo`; verify no crop, overflow, text collision, or control overlap. Record exactly which reference pages and states were observed; do not imply that unvisited pages or states were verified.
2. Check all five interface languages, day/night modes, keyboard focus, and reduced-motion behavior. Confirm the admin console is unchanged.
3. Run the relevant skin-package tests and application build after a related batch of changes. Fix validation failures rather than weakening v1/v2 boundaries, v3 permission and event checks, surface limits, or the host-widget allowlist.
4. Package the contents of the skin directory so `manifest.json` is at the archive root, then import it through `/admin/skins` and retest the installed `.wskin` in a visitor session.

The shipped default day, default night, and ILLUSIA skins are protected built-ins. Do not change their IDs or introduce upload/update flows that can disable, replace, or remove them. A permission request is not a grant; verify the deny and revoke paths. Do not claim a skin was visually verified against an external reference unless that page was actually accessible.

## Integration findings

- A full-page surface is a separate user-approved capability (`ui.surface.replace`); package installation alone must leave the built-in page visible.
- The “restore built-in skin” control must use an unconditional selection function, not the skin-load-error-only recovery handler.
- Custom quick-server layouts should use the unified favorites/recent collection and opaque host tokens. Labels that match the underlying address are redacted before projection; never expose target addresses or credentials to skin data bindings.
- KOOK voice-only visual reference: the first two user-authorized rooms were accessible in the in-app browser. Observed the server rail, channel tree, voice membership rows, central chat area, right member list, and lower-left voice controls. Microphone remained off and the client was disconnected after inspection. No server/room identifiers, member names, or chat content were retained. Keep discovery, events, companion shop, ads, and operator/admin surfaces out of this skin.
