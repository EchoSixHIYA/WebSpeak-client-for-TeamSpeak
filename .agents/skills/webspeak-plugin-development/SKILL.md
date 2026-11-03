---
name: webspeak-plugin-development
description: Build, review and package WebSpeak API v2 applications with standard browser code and optional Node services, and automatically submit completed releases to the official catalog by pull request. Use for .wplugin applications rather than .wskin skins.
---

# WebSpeak Application Development

Read the current [application runtime guide](../../../docs/PLUGIN_DEVELOPMENT.md). In a standalone checkout, use `https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/blob/master/docs/PLUGIN_DEVELOPMENT.md`. Require WebSpeak v0.3.0 or later for API v2. API v1 and its shared-room examples are removed.

Develop an independent application, not a list of host business RPC calls. Use ordinary HTML/CSS/JavaScript, browser APIs and optional Node services with author-defined routes, dependencies and state. The host provides authenticated context, configuration, package/lifecycle management and a separate origin. It supplies no room API or feature permission list. Keep application business logic in its package; a host defect or missing general runtime primitive is a separate host change.

Start with `docs/templates/plugin-app/` or the distribution repository's `template/`. Put frontend output under `client/` with relative assets and optional `.mjs/.cjs` activation code under `server/`. Include audited dependencies or bundle them; the host does not run package installers. Native dependencies must match target OS and Node ABI. Build with `node scripts/build-plugin.mjs SOURCE_DIR OUTPUT.wplugin`, or the standalone distribution builder, then import the actual output.

Use `webspeak.ready`, `getContext()`, `onContextChange()` and `signal` for generic context; implement functionality through native browser/Node code. Scope provides admission and a grouping key, not synchronization. Server logic must enforce scope and business access. Prefer host-verified `req.webspeak` over browser-supplied identities or channels. Temporary runtime URLs are credentials: do not persist, broadcast or log them. Backend private configuration is encrypted at rest and omitted from admin reads; public configuration is user-visible.

Treat applications as trusted code. Node services have the WebSpeak OS account's privileges; process separation and heap limits are not a hostile-code sandbox. Frontends use a separate origin with standard browser capabilities. Browser permission, secure-context, user-gesture, CORS and network requirements apply. The shared application origin does not isolate mutually hostile plugins. Explain these boundaries accurately and review dependencies rather than inventing host feature permissions.

Provide responsive light/dark styles and suitable language handling using context. Keep UI in the application panel without relying on skin DOM. Clean timers, subscriptions, media and sockets on exit/revocation. Persist backend state in `dataDir`, never extracted code directories. Implement concurrency and atomic writes appropriate to the application.

Verify import, trust, enable, update, failure/restart, custom routes, persistence and revocation. Collaborative apps need two real browser participants and late-join/concurrent-change/channel-boundary/disconnect tests. Distinguish mocked HTTP, actual processes, browser interactions and independent networks. Claim only demonstrated capabilities. Keep credentials and diagnostics out of artifacts.

After completing development and verification, automatically finish the distribution workflow below; do not stop at a local archive or ask the user to submit it later. Honor explicit local-only/no-push instructions. Review-only, inspection and planning tasks do not trigger publishing. This workflow does not authorize deployment or automatic merging.

## Automatic distribution PR

1. Read the current [application catalog](https://github.com/Huddle-Up-Forge/webspeak-plugin), its default branch, contribution rules, `index.json`, JSON schema, validators and any PR template. Follow the actual repository contract.
2. Maintain source, license, dependencies, build instructions, tests and `.wplugin` in an independent public application repository. Use the task's selected destination; ask only for a genuinely missing owner/name when it cannot be discovered. Commit and push the final package first, then generate and publish default-branch `plugin.json` with the complete API v2 `manifest` and `package.ref/path/sha256`. The catalog requires a full 40-character package commit SHA, not a branch, mutable label, future commit or self-reference. Hash the raw package bytes; metadata must match its manifest.
3. Fetch the public metadata and pinned package, check identity/manifest/hash and real import, then run the catalog's current checks (currently `npm run verify` and `npm run verify:remote`). Fix failures before marking the submission ready. Bundle audited dependencies in the application package. Never copy business code, archives, secrets or diagnostics into the catalog.
4. For a new listing, add one `{ "id": "<plugin-id>", "repository": "https://github.com/<owner>/<repo>", "metadataPath": "plugin.json" }` under `plugins` in schema 2 `index.json`. Update an existing ID when catalog fields change; never duplicate it or edit unrelated entries. Version-only releases already discoverable through the listed metadata need no empty index PR; report their published metadata and existing listing instead.
5. Open the PR automatically from a focused branch against the actual default branch, or from a fork if needed. Reuse an existing open PR for this contribution. Titles: `feat(plugins): add <plugin-id> v<version>` or `chore(plugins): update <plugin-id> v<version>`. Apply any existing PR template.

Use the catalog's PR template, or `Summary`, `Package`, `Validation` and `Preview` sections when none exists. Include purpose and ID/version; source, author/license, required WebSpeak/API version and scopes; a published UI preview; immutable package commit/path/raw URL and SHA-256; backend presence/dependencies and external configuration; and validation commands with actual results. Cover import/trust/enable/update, persistence, minimize/resume, disconnect/revocation and relevant two-participant tests. Distinguish real independent-network P2P/collaboration testing from same-host browser tests. Confirm that no credentials or temporary runtime URLs are included.

Return and attach the real PR URL when supported, with validation results. Do not auto-merge. If authentication or repository policy blocks submission, retain the reviewable branch/diff, identify the precise blocker and request only what is missing; do not substitute a generic permission question or claim success without a submitted PR.

## Floating host workspace

The host owns a skin-independent draggable launcher, application library and non-modal app window. Do not add launch controls to a particular skin or inspect its DOM. Apps render their responsive light/dark UI inside the supplied iframe; the host supplies dragging, minimize/maximize/restore and close controls. The host window uses the standard `color-scheme` for its light/dark fallback without inheriting skin component styles. Do not duplicate host window chrome or block the workspace with a page-wide modal backdrop.

Minimizing or switching to the library retains the same iframe and app session. Transfers and playback must survive those actions. Closing the window, replacing the active app or host context revocation ends that session; only one frontend app is currently hosted at a time. Do not equate a hidden iframe with app exit. Verify resize, narrow screens, theme changes, minimize/resume without reload and close/revocation cleanup. Keep the user-facing window focused on functionality and actionable status; omit repeated runtime/permission disclaimers. Administrator trust and security review remain part of enablement.

## Instance authorization

The public host asks once per browser origin for third-party skins and functional applications together. No decision or refusal allows only Day, Night and ILLUSIA; KAAK also requires consent. The last item in the skin menu reopens this setting. Revocation must close/revoke the active frontend application while preserving independently enabled backend services. Do not add per-app copies of the same host authorization prompt, bypass the host gate or confuse this user decision with administrator package trust or browser-native permission prompts.
