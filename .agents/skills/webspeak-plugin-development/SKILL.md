---
name: webspeak-plugin-development
description: Build, review and package WebSpeak API v2 functional applications with standard browser code and optional Node services, including GitHub distribution. Use for .wplugin applications rather than .wskin skins or their presentation components.
---

# WebSpeak Application Development

Read the current [application runtime guide](../../../docs/PLUGIN_DEVELOPMENT.md). In a standalone checkout, use `https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/blob/dev/docs/PLUGIN_DEVELOPMENT.md`. Confirm API v2 support on the target instance; stable v0.2.9 has none. API v1 and its shared-room examples are removed.

Develop an independent application, not a list of host business RPC calls. Use ordinary HTML/CSS/JavaScript, browser APIs and optional Node services with author-defined routes, dependencies and state. The host provides authenticated context, configuration, package/lifecycle management and a separate origin. It supplies no room API or feature permission list. Keep application business logic in its package; a host defect or missing general runtime primitive is a separate host change.

Start with `docs/templates/plugin-app/` or the distribution repository's `template/`. Put frontend output under `client/` with relative assets and optional `.mjs/.cjs` activation code under `server/`. Include audited dependencies or bundle them; the host does not run package installers. Native dependencies must match target OS and Node ABI. Build with `node scripts/build-plugin.mjs SOURCE_DIR OUTPUT.wplugin`, or the standalone distribution builder, then import the actual output.

Use `webspeak.ready`, `getContext()`, `onContextChange()` and `signal` for generic context; implement functionality through native browser/Node code. Scope provides admission and a grouping key, not synchronization. Server logic must enforce scope and business access. Prefer host-verified `req.webspeak` over browser-supplied identities or channels. Temporary runtime URLs are credentials: do not persist, broadcast or log them. Backend private configuration is encrypted at rest and omitted from admin reads; public configuration is user-visible.

Treat applications as trusted code. Node services have the WebSpeak OS account's privileges; process separation and heap limits are not a hostile-code sandbox. Frontends use a separate origin with standard browser capabilities. Browser permission, secure-context, user-gesture, CORS and network requirements apply. The shared application origin does not isolate mutually hostile plugins. Explain these boundaries accurately and review dependencies rather than inventing host feature permissions.

Provide responsive light/dark styles and suitable language handling using context. Keep UI in the application panel without relying on skin DOM. Clean timers, subscriptions, media and sockets on exit/revocation. Persist backend state in `dataDir`, never extracted code directories. Implement concurrency and atomic writes appropriate to the application.

Verify import, trust, enable, update, failure/restart, custom routes, persistence and revocation. Collaborative apps need two real browser participants and late-join/concurrent-change/channel-boundary/disconnect tests. Distinguish mocked HTTP, actual processes, browser interactions and independent networks. Claim only demonstrated capabilities. Keep credentials and diagnostics out of artifacts.

For distribution use schema v2 catalog entries, matching manifest, raw-package SHA-256 and fixed refs. Publishing and deployment follow the user's task authorization; this skill does not itself authorize either.

## Floating host workspace

The host owns a skin-independent draggable launcher, application library and non-modal app window. Do not add launch controls to a particular skin or inspect its DOM. Apps render their responsive light/dark UI inside the supplied iframe; the host supplies dragging, minimize/maximize/restore and close controls. The host window uses the standard `color-scheme` for its light/dark fallback without inheriting skin component styles. Do not duplicate host window chrome or block the workspace with a page-wide modal backdrop.

Minimizing or switching to the library retains the same iframe and app session. Transfers and playback must survive those actions. Closing the window, replacing the active app or host context revocation ends that session; only one frontend app is currently hosted at a time. Do not equate a hidden iframe with app exit. Verify resize, narrow screens, theme changes, minimize/resume without reload and close/revocation cleanup. Keep the user-facing window focused on functionality and actionable status; omit repeated runtime/permission disclaimers. Administrator trust and security review remain part of enablement.

## Instance authorization

The public host asks once per browser origin for third-party skins and functional applications together. No decision or refusal allows only Day, Night and ILLUSIA; KAAK also requires consent. The last item in the skin menu reopens this setting. Revocation must close/revoke the active frontend application while preserving independently enabled backend services. Do not add per-app copies of the same host authorization prompt, bypass the host gate or confuse this user decision with administrator package trust or browser-native permission prompts.
