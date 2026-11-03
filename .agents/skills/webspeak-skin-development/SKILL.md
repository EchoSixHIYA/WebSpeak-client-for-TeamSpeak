---
name: webspeak-skin-development
description: Develop, review, package, or validate portable WebSpeak .wskin skins, and automatically submit completed releases to the official catalog by pull request. Keep implementation inside the package and use released runtime APIs.
metadata:
  short-description: Develop portable WebSpeak skins
---

# WebSpeak Skin Development

Develop the skin as a portable `.wskin` package. A skin task should not require a skin-specific edit to WebSpeak's client, server, shared protocol, or host-widget implementation. The package owns its page/component markup, styling, copy, layout, assets, and supported plugin logic. The host owns TeamSpeak transport, credentials, trusted actions, and the versioned public data/API contract.

## Workflow

When a WebSpeak checkout is unavailable, read the [published skin guide](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/blob/master/docs/SKIN_DEVELOPMENT.md) and its examples.

1. Locate the `webspeak-webclient` repository root, then read the single current contract and workflow in `docs/SKIN_DEVELOPMENT.md`. It covers package schemas, runtime data, permissions, actions, security boundaries, and validation. If a request needs an undocumented capability, identify the missing public contract before editing and treat that work as a separate platform change. Inspect the closest example under `docs/examples/`; do not copy unrelated product-specific content.
2. Choose the least complex supported package format that can express the request: CSS/assets for appearance, `content.json` for localized copy, `layout.json` for author defaults, `components.json` for declarative structure and supported interactions, and the documented v4 Wasm plugin path only when local logic is required. JavaScript files in a package are not executed by the current runtime.
3. Keep all skin-authored implementation in the package. Use stable public skin parts, component schema, published context fields, existing host widgets, and permission-gated actions. Do not add a widget, data field, action, CSS hook, or branch to core code for one skin. If a reusable platform capability is missing, identify the exact contract gap and treat it as separate platform work: define a generic, versioned API and compatibility behavior first; only then use that released API from the package.
4. Set a unique skin ID, increment its package version for changed output, and set `minAppVersion` to the lowest compatible WebSpeak runtime. Keep component schema and plugin `apiVersion` aligned with the APIs actually used. Package every referenced image, font, stylesheet, component, and plugin asset. Use only safe package-relative paths; do not depend on local machine files, remote assets, private endpoints, or instance-specific frontend code.
5. Build the `.wskin` from its source directory while including only files declared by the manifest. Validate the finished archive with the repository importer and keep any distributable built-in archive synchronized with its example source. An example README or other undeclared file belongs beside the package, not inside it.
6. Verify the package at the scope of the change: run the skin package and component-schema tests; run the relevant type/build checks; import the exact archive in a compatible WebSpeak runtime. Check desktop and narrow layouts, all supported interface languages, long text, keyboard focus, reduced motion, contrast, and every interaction the skin replaces. For a portability claim, install the same archive (compare its SHA-256) in two instances with the same compatible runtime/API version; do not treat a successful build alone as proof.

## Automatic distribution PR

After completing a skin development or update task and its verification, automatically finish the contribution workflow below; do not wait for another instruction to submit the validated contribution. Honor explicit local-only/no-push instructions. Review-only, inspection and planning tasks do not trigger publishing. This workflow does not authorize deployment or automatic merging.

1. Read the current [skin catalog](https://github.com/Huddle-Up-Forge/webspeak-skins), its default branch, `index.json`, contribution rules, and any PR template or checks that exist. Follow the actual catalog contract rather than inventing fields.
2. Keep source, license, build instructions and the validated `.wskin` in an independent public skin repository. Use the destination selected for the task; ask only for a genuinely missing owner/name when it cannot be discovered. Commit and push the package first. Then publish default-branch `skin.json` pointing to its existing full package commit SHA/path with the SHA-256 of the exact archive bytes. Keep ID, version, license and `minAppVersion` consistent. Do not move a published package tag or make metadata reference its own not-yet-created commit.
3. Fetch public metadata and the pinned package as the store would; verify hash, identity, version, compatibility and actual import, and run catalog checks when supplied. The catalog contains an index, not skin source or archives. Exclude credentials, captures, diagnostic reports and unrelated development documents.
4. For a new listing, add exactly one `{ "id": "<skin-id>", "repository": "https://github.com/<owner>/<repo>" }` under `skins` in schema 1 `index.json`. Update an existing ID rather than duplicating it. Under the catalog's current policy, a version-only update is discovered through the skin repository's metadata; if there is no real catalog diff, report the published update and existing listing instead of creating an empty PR.
5. Create a focused branch against the catalog's actual default branch, using a fork if necessary, and open the PR automatically. Reuse an existing open PR for the same contribution. Titles: `feat(skins): add <skin-id> v<version>` or `chore(skins): update <skin-id> v<version>`. Follow the repository's PR template when present.

Use the catalog's PR template, or `Summary`, `Package`, `Validation` and `Preview` sections when none exists. Include purpose and skin ID/version; source, author/license and minimum WebSpeak version; a published screenshot/preview; immutable package commit/path/raw URL and SHA-256; validation commands and actual results, including runtime/browser, desktop/narrow layouts and languages checked. Confirm independent installation and no duplicate ID. State material gaps without claiming unperformed tests.

Return the actual PR URL and validation outcome, and attach the PR to the chat when supported. If authentication or repository policy blocks submission, preserve the reviewable branch/diff, identify the concrete blocker and request only the missing destination or access. Do not claim a PR was submitted when it exists only locally, and do not auto-merge.

## Compatibility and truthfulness

- `minAppVersion` is a lower compatibility bound, not a guarantee that an older or unrelated runtime implements every API. Read the current schema and runtime documentation before using a capability.
- Dynamic values such as public connection state or administrator-configured copy are runtime inputs. The package contains how those values are rendered; it must not bundle secrets or assume a particular server's private configuration.
- An existing host widget is a stable capability the package may declare. Its presence does not authorize changing that widget's implementation for a skin-specific design; use package CSS/components around it where supported.
- Do not describe an unimplemented API as portable, mark a feature complete from schema validation alone, or claim that different runtime versions render identically. Report the tested package hash, compatible runtime/API versions, and any platform gap.

## References

- `docs/SKIN_DEVELOPMENT.md` — the single current reference for skin formats, runtime APIs, permissions, data, actions, CSS hooks, security, and QA.
- `docs/examples/ILLUSIA-VOICE.md` and `docs/examples/OPEN-VOICE-SURFACE.md` — full skin and surface examples.

## Instance authorization

WebSpeak v0.3.0 replaces per-skin consent dialogs with one origin-scoped user decision covering third-party skins and functional apps. Without consent only the fixed official Day, Night and ILLUSIA skins are available; bundled KAAK also requires consent. The host skin switcher owns the final authorization item. Packages must not duplicate or bypass it. Revocation must cancel pending activation, remove third-party CSS/components and stop workers. Continue enforcing manifest permissions, credential redaction, trusted action validation and package digests internally; one-time consent does not extend the public API. See the current guide for release compatibility.
