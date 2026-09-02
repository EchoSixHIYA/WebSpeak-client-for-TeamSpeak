# Changelog

All notable changes to WebSpeak are documented here. Versions follow SemVer.

## [0.1.3] — 2026-09-03

### Added

- Optional WebRTC audio transport for deployments that need lower and more stable realtime voice latency.
- WebRTC configuration through environment variables, including the public host and a bounded UDP port range.
- Migrated the TeamSpeak integration to the maintained `EchoSixHIYA/teamspeak-js` fork, including live directory snapshots and member/channel synchronization.

### Changed

- WebRTC audio uses negotiated Opus parameters and a bounded newest-frame mixer instead of allowing stale audio to accumulate.
- The browser keeps the WebSocket path available for signaling, control, and compatibility fallback; the default deployment remains unchanged.

### Fixed

- Prevented duplicate playback when WebRTC and the WebSocket audio path overlap during negotiation or fallback.
- Made WebRTC teardown and fallback explicit so a failed negotiation does not leave a server-side media session behind.
- Corrected native Opus decoder usage and cleaned up negotiated payload handling for TeamSpeak-to-browser audio.

## [0.1.2] — 2026-09-02

### Added

- Current-version badge and a direct changelog link on the welcome page, next to the prominent GitHub repository button.
- Mobile member actions through a three-dot menu, while desktop member actions remain available through the context menu.

### Changed

- Mobile and narrow-screen header controls now collapse longer labels into icons to preserve usable spacing.
- The welcome page and connected workspace now present the GitHub, version, changelog, admin, theme, language, exit, and microphone controls as a consistent responsive control group.
- The version shown on the welcome page is read from the gateway's public configuration so it stays aligned with the running backend.
- Consolidated the post-0.1.1 mobile voice controls, microphone mute replacement for focus-dependent PTT, automatic protocol detection, simplified Docker Compose startup, and live-demo documentation.

### Fixed

- Replaced the visually off-center settings glyph and normalized icon alignment for settings-related controls across the client.
- Fixed narrow-screen exit and microphone controls so their text-collapse rules apply correctly.
- Bounded browser and gateway voice buffering, reset stale browser playback queues, and exposed low-overhead in-memory audio counters for diagnosing jitter without per-frame log writes.
- Moved microphone frame assembly to an `AudioWorklet` with a compatibility fallback to `ScriptProcessorNode`; both paths emit fixed 960-sample frames.

## [0.1.1] — 2026-09-02

### Added

- M009 admin operations dashboard for managed invites, active-session inspection, per-session termination, diagnostics, logs, audit access, diagnostic report download, and SQLite backup export.
- Persistent managed invites with expiry, optional maximum uses, revocation, hashed opaque tokens, and encrypted TeamSpeak credentials at rest.
- Mobile-aware invite joining through the `invite` URL parameter without placing a TeamSpeak password in the URL.
- M010 hardening for per-peer join-ticket rate limiting and bounded rotating runtime logs.
- Bilingual README documentation with parallel Chinese and English feature, deployment, security, and operations sections.

### Changed

- Database schema is now version 2 and migrates existing version 1 installations transactionally with a migration copy.
- Admin overview and diagnostics use the application package version instead of a hard-coded display value.
- The README architecture section now uses GitHub-native Markdown instead of a Mermaid rich-display block.
- The README badge set now uses stable static Shields badges without a repository-metadata 404 dependency.
- Version tags publish Windows/Linux deployment packages to GitHub Releases and publish the matching Docker image.
- Removed the focus-dependent normal browser Space-key PTT mode and replaced it with a one-click microphone mute/unmute control on desktop and mobile.
- Persisted the microphone mute state in browser preferences and suppresses upstream audio before it is sent to TeamSpeak while muted.

### Fixed

- Late WebSpeak browser sessions now reconcile and merge the complete TeamSpeak directory, so members who joined earlier remain visible.
- Private-message delivery no longer disconnects the browser session.
- Member actions are presented through the right-click context menu with hover feedback.
- Docker release builds copy the root `postinstall` patch script before running `npm ci`.
- Release builds skip `npm version` when the project version already matches the requested version, preventing false `Version not changed` failures.

### Verification

- `npm test` — 51 tests passed.
- `npm run build` — backend TypeScript build passed.
- `npm run web:build` — frontend production build passed.
- `npm audit --omit=dev --audit-level=high` — no high or critical vulnerabilities reported.
- Local `/demo` browser checks passed at the documented narrow and desktop widths; `/demo` does not connect to TeamSpeak.

Real TS3/TS6 interoperability, Android microphone behavior, multi-client smoke, and the 24-hour long-run gate require their respective test environments and are not claimed by this local release check.

## [0.1.0] — 2026-08-31

- First normalized release with the browser client, TeamSpeak 3 / 6 gateway, browser audio controls, access modes, administrator operations, and AGPL-3.0-only licensing.
