---
name: webspeak-skin-development
description: Develop, review, package, or validate portable WebSpeak .wskin skins. Keep skin UI and implementation inside the package and use only released runtime APIs.
metadata:
  short-description: Develop portable WebSpeak skins
---

# WebSpeak Skin Development

Develop the skin as a portable `.wskin` package. A skin task should not require a skin-specific edit to WebSpeak's client, server, shared protocol, or host-widget implementation. The package owns its page/component markup, styling, copy, layout, assets, and supported plugin logic. The host owns TeamSpeak transport, credentials, trusted actions, and the versioned public data/API contract.

## Workflow

1. Locate the `webspeak-webclient` repository root, then read `docs/SKIN_DEVELOPMENT.md` for authoring steps and `docs/OPEN_SKIN_SYSTEM_SPEC.zh-CN.md` for current schemas, data fields, permissions, and actions. If a request needs an undocumented capability, identify the missing public contract before editing and treat that work as a separate platform change. Inspect the closest example under `docs/examples/`; do not copy unrelated product-specific content.
2. Choose the least complex supported package format that can express the request: CSS/assets for appearance, `content.json` for localized copy, `layout.json` for author defaults, `components.json` for declarative structure and supported interactions, and the documented v4 Wasm plugin path only when local logic is required. JavaScript files in a package are not executed by the current runtime.
3. Keep all skin-authored implementation in the package. Use stable public skin parts, component schema, published context fields, existing host widgets, and permission-gated actions. Do not add a widget, data field, action, CSS hook, or branch to core code for one skin. If a reusable platform capability is missing, identify the exact contract gap and treat it as separate platform work: define a generic, versioned API and compatibility behavior first; only then use that released API from the package.
4. Set a unique skin ID, increment its package version for changed output, and set `minAppVersion` to the lowest compatible WebSpeak runtime. Keep component schema and plugin `apiVersion` aligned with the APIs actually used. Package every referenced image, font, stylesheet, component, and plugin asset. Use only safe package-relative paths; do not depend on local machine files, remote assets, private endpoints, or instance-specific frontend code.
5. Build the `.wskin` from its source directory while including only files declared by the manifest. Validate the finished archive with the repository importer and keep any distributable built-in archive synchronized with its example source. An example README or other undeclared file belongs beside the package, not inside it.
6. Verify the package at the scope of the change: run the skin package and component-schema tests; run the relevant type/build checks; import the exact archive in a compatible WebSpeak runtime. Check desktop and narrow layouts, all supported interface languages, long text, keyboard focus, reduced motion, contrast, and every interaction the skin replaces. For a portability claim, install the same archive (compare its SHA-256) in two instances with the same compatible runtime/API version; do not treat a successful build alone as proof.

## Compatibility and truthfulness

- `minAppVersion` is a lower compatibility bound, not a guarantee that an older or unrelated runtime implements every API. Read the current schema and runtime documentation before using a capability.
- Dynamic values such as public connection state or administrator-configured copy are runtime inputs. The package contains how those values are rendered; it must not bundle secrets or assume a particular server's private configuration.
- An existing host widget is a stable capability the package may declare. Its presence does not authorize changing that widget's implementation for a skin-specific design; use package CSS/components around it where supported.
- Do not describe an unimplemented API as portable, mark a feature complete from schema validation alone, or claim that different runtime versions render identically. Report the tested package hash, compatible runtime/API versions, and any platform gap.

## References

- `docs/SKIN_DEVELOPMENT.md` — skin formats, package structure, CSS hooks, and QA.
- `docs/OPEN_SKIN_SYSTEM_SPEC.zh-CN.md` — runtime/API contracts, schemas, data, permissions, and actions.
- `docs/examples/ILLUSIA-VOICE.md` and `docs/examples/OPEN-VOICE-SURFACE.md` — full skin and surface examples.
