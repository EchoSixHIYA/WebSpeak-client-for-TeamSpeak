# Changelog

All notable changes to WebSpeak are documented here. Versions follow SemVer.

## [Unreleased]

### Added

- M009 admin operations dashboard for managed invites, active-session inspection, per-session termination, diagnostics, logs, audit access, diagnostic report download, and SQLite backup export.
- Persistent managed invites with expiry, optional maximum uses, revocation, hashed opaque tokens, and encrypted TeamSpeak credentials at rest.
- Mobile-aware invite joining through the `invite` URL parameter without placing a TeamSpeak password in the URL.
- M010 hardening for per-peer join-ticket rate limiting and bounded rotating runtime logs.

### Changed

- Database schema is now version 2 and migrates existing version 1 installations transactionally with a migration copy.
- Admin overview and diagnostics use the application package version instead of a hard-coded display value.

### Verification

- `npm test` — 47 tests passed.
- `npm run build` — backend TypeScript build passed.
- `npm run web:build` — frontend production build passed.
- `npm audit --omit=dev --audit-level=high` — no high or critical vulnerabilities reported.
- Local `/demo` browser checks passed at the documented narrow and desktop widths; `/demo` does not connect to TeamSpeak.

Real TS3/TS6 interoperability, Android microphone behavior, multi-client smoke, and the 24-hour long-run gate require their respective test environments and are not claimed by this local release check.
