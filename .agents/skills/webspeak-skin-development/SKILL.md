---
name: webspeak-skin-development
description: Create, refine, package, and verify WebSpeak v1 visual, v2 layout, and v3 open skins while preserving host-owned behavior and access boundaries.
---

# WebSpeak skin development

Use this skill when editing or authoring a WebSpeak `.wskin` package, a built-in skin, or skin-facing UI hooks. v1/v2 packages are visual/layout data; v3 may rearrange public UI and add bounded declarative components. WebSpeak owns host behavior and the administrator console is outside the skin scope.

## Before editing

- Read [`docs/SKIN_DEVELOPMENT.md`](../../../docs/SKIN_DEVELOPMENT.md) for the current package validator and public hooks.
- Use [`docs/examples/illusia-voice/`](../../../docs/examples/illusia-voice/) and [`docs/examples/ILLUSIA-VOICE.md`](../../../docs/examples/ILLUSIA-VOICE.md) as the reference implementation. Do not restore the removed Aurora Voice sample.
- Inspect the actual component markup for `data-ws-page`, `data-ws-part`, and `data-ws-state` hooks. Treat Vue classes and incidental DOM structure as private.

## Preserve the interface

- Keep WebSpeak's translations and semantic content as the baseline. Add `content.json` only when a text override is an explicit part of the request; never use it to implement visual artwork.
- Follow the schema-specific CSS rules: v1/v2 reject layout changes; v3 allows layout, placement, size, typography, and visibility changes within the skin root. Keep CSS package-local, scoped to public hooks, and free of external resources or executable values.
- v3 can obscure normal page controls. Preserve usable microphone, disconnect, device-settings, screen-share and recovery paths at desktop and mobile sizes. Skin CSS cannot reach host permission and recovery chrome rendered outside the skin root. Keep `/admin/**` unskinned.
- v3 component trees are declarative JSON rendered by the host. Never add script, Wasm, HTML strings, direct network/storage, or private host objects. Request only the component-level permissions needed; keep labels and favorite identifiers opaque and never bind server addresses or credentials.
- Use the host's reserved artwork hooks for layered character art and the headphone scene. Prefer transparent assets and `background-size: contain` where the reference requires the full character or chibi to remain visible; arrange the artwork around the fixed hook rather than changing its geometry.
- Build visual depth with separate background, surface, and foreground artwork already exposed by the hooks. Avoid duplicate static decorations when an animated replacement exists. For motion, keep waveforms/sonar smooth and restrained, honor reduced-motion preferences, and retain readable focus, error, mute, and speaking states.
- Keep skin-specific CSS variables under `--skin-*`. Use only package-local assets and confirm their redistribution rights.

## Verify and package

1. Compare the implementation with its visual reference at desktop and narrow widths. Check the homepage, voice workspace, empty chat, member list, screen-share player, selectors, and `/demo`; verify no crop, overflow, text collision, or control overlap.
2. Check all five interface languages, day/night modes, keyboard focus, and reduced-motion behavior. Confirm the admin console is unchanged.
3. Run the relevant skin-package tests and application build after a related batch of changes. Fix validation failures rather than weakening the v1/v2 boundaries or v3 permission checks.
4. Package the contents of the skin directory so `manifest.json` is at the archive root, then import it through `/admin/skins` and retest the installed `.wskin` in a visitor session.

The shipped default day, default night, and ILLUSIA skins are protected built-ins. Do not change their IDs or introduce upload/update flows that can disable, replace, or remove them. A permission request is not a grant; verify the deny and revoke paths. Do not claim a skin was visually verified against an external reference unless that page was actually accessible.
