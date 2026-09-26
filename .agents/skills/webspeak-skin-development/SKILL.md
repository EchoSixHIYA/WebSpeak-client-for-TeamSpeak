---
name: webspeak-skin-development
description: Create, refine, package, and verify WebSpeak visual skins while preserving the product's translated content, fixed component geometry, and interactions.
---

# WebSpeak skin development

Use this skill when editing or authoring a WebSpeak `.wskin` package, the ILLUSIA built-in skin, or skin-facing UI hooks. A skin changes artwork and visual treatment; WebSpeak owns page structure, text, and behavior. The administrator console is deliberately outside the skin scope.

## Before editing

- Read [`docs/SKIN_DEVELOPMENT.md`](../../../docs/SKIN_DEVELOPMENT.md) for the current package validator and public hooks.
- Use [`docs/examples/illusia-voice/`](../../../docs/examples/illusia-voice/) and [`docs/examples/ILLUSIA-VOICE.md`](../../../docs/examples/ILLUSIA-VOICE.md) as the reference implementation. Do not restore the removed Aurora Voice sample.
- Inspect the actual component markup for `data-ws-page`, `data-ws-part`, and `data-ws-state` hooks. Treat Vue classes and incidental DOM structure as private.

## Preserve the interface

- Keep WebSpeak's translations and semantic content as the baseline. Add `content.json` only when a text override is an explicit part of the request; never use it to implement visual artwork.
- Skin only with supported visual CSS and package-local images/fonts. The upload validator rejects layout, positioning, sizing, spacing, clipping, text-flow, and interaction-geometry changes. Do not work around it with selectors, pseudo-elements, or animation.
- Never hide or obstruct critical controls, make a card or player move/resize, change a floating menu into a modal, or make artwork intercept pointer input. Keep `/admin/**` unskinned.
- Use the host's reserved artwork hooks for layered character art and the headphone scene. Prefer transparent assets and `background-size: contain` where the reference requires the full character or chibi to remain visible; arrange the artwork around the fixed hook rather than changing its geometry.
- Build visual depth with separate background, surface, and foreground artwork already exposed by the hooks. Avoid duplicate static decorations when an animated replacement exists. For motion, keep waveforms/sonar smooth and restrained, honor reduced-motion preferences, and retain readable focus, error, mute, and speaking states.
- Keep skin-specific CSS variables under `--skin-*`. Use only package-local assets and confirm their redistribution rights.

## Verify and package

1. Compare the implementation with its visual reference at desktop and narrow widths. Check the homepage, voice workspace, empty chat, member list, screen-share player, selectors, and `/demo`; verify no crop, overflow, text collision, or control overlap.
2. Check all five interface languages, day/night modes, keyboard focus, and reduced-motion behavior. Confirm the admin console is unchanged.
3. Run `npm test` and `npm --prefix web run build`. Fix validator or build failures rather than weakening the layout guardrails.
4. Package the contents of the skin directory so `manifest.json` is at the archive root, then import it through `/admin/skins` and retest the installed `.wskin` in a visitor session.

The three shipped skins—default day, default night, and ILLUSIA—are protected built-ins. Do not change their IDs or introduce upload/update flows that can disable, replace, or remove them.
