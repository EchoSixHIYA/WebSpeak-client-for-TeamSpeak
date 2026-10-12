# WebSpeak TeamSpeak Browser Gateway

WebSpeak connects browser users to TeamSpeak 3 and TeamSpeak 6 through a self-hosted Node.js gateway. Each connected browser session owns an independent TeamSpeak client. The repository also contains a standalone UDP acceleration relay and an Android preview with an embedded local gateway.

## Application boundaries

| Location | Responsibility |
| --- | --- |
| `src/index.ts` | Gateway startup, SQLite, master secret, admin service and shutdown; also supports relay mode |
| `src/server/server.ts` | HTTP or HTTPS, public configuration, skins, join tickets, admin routes and static frontend |
| `src/server/voice-bridge.ts` | `/ws/voice`, admission, connection/reconnection orchestration and voice transport assembly |
| `src/server/voice-commands.ts`, `directory-view.ts`, `audio-stats.ts` | Command execution, public directory projection and diagnostic snapshots |
| `src/server/member-avatars.ts` | Generation-bound optional avatar downloads, bounded sequential batches, cached images and timer cleanup |
| `src/server/session-events.ts` | Session-owned SDK subscriptions, directory projection, self/channel state, chat mapping and avatar coordination |
| `src/server/screen-share-coordinator.ts` | Server/channel-scoped sharing membership and browser/native signaling |
| `src/shared/` | Browser-safe wire types and runtime parsers shared by both endpoints |
| `src/shared/admin-inputs.ts`, `admin-responses.ts` | Shared admin request types and runtime-checked response projections |
| `src/server/ts-client.ts` and `teamspeak-adapter.ts` | SDK integration, TS3/TS6 negotiation, identity, chat, voice and client events |
| `src/server/session-manager.ts` and `directory-sync.ts` | Connection state, teardown, admission limits and directory reconciliation |
| `src/server/webrtc-audio.ts` and `opus-codec.ts` | WebRTC audio mixing and platform-specific Opus codecs |
| `src/server/session-audio.ts` | Per-session PCM encoding, exclusive WebRTC/WebSocket routing, whisper dispatch, bounded egress and audio counters |
| `src/admin/`, `src/security/`, `src/persistence/` | Administration, access policies, credentials and persistent settings |
| `src/relay.ts` and `src/server/acceleration-relay.ts` | Standalone relay and gateway-side relay transport |
| `web/src/views/` and `web/src/composables/` | Vue pages, connection state, audio controls, chat and screen sharing |
| `web/src/voice/screen-share.ts` | Per-session screen capture, peer negotiation, cleanup and diagnostics |
| `web/src/voice/remote-playback.ts` | Per-speaker compatibility decoding, bounded scheduling, volume and resource cleanup |
| `web/src/voice/microphone-test.ts` | Cancellable recording tests, recorder deadline and playback URL ownership |
| `web/src/voice/microphone-capture.ts` | Prepared microphone processing graphs, per-context worklet loading, optional RNNoise and independent PCM activation/cleanup |
| `web/src/voice/audio-sink.ts` | Serialized device routing per audio endpoint, with stale-operation guards |
| `web/src/voice/accompaniment.ts` | Generation-bound display-audio capture, immediate pending-capture cancellation, ended listeners and committed activity |
| `web/src/voice/webrtc-input.ts` | Stable WebRTC sender output, microphone gain and transactional accompaniment-source attachment |
| `web/src/voice/microphone-meter.ts` | Optional per-peer level sampling, owned analysis nodes and timer, partial-failure cleanup and stale-tick rejection |
| `web/src/voice/webrtc-transport.ts`, `webrtc-playback.ts` | Per-attempt peer negotiation, input/meter ownership, compatibility fallback and independently owned playback elements and retries |
| `web/src/voice/connection.ts`, `commands.ts` | Cancellable ticket acquisition, socket and connection generations, plus per-command acknowledgement deadlines and cleanup |
| `web/src/voice/session-state.ts` | Reactive directory, chat history, events and notifications; complete versus omitted directory data, session resets and private-conversation identity scopes |
| `web/src/composables/useWebClientChat.ts`, `useWebClientChannels.ts` | Destination-owned drafts and pending sends, identity-bound private history, and iterative channel-tree projection |
| `web/src/composables/useWebClientIdentity.ts`, `web/src/components/web-client/IdentityImportDialog.vue` | Page-owned identity reads, parsing, restoration and exports; a presentation dialog with explicit input and action events |
| `web/src/voice/audio-diagnostics.ts`, `web/src/composables/useWebClientPerformance.ts` | Session-owned diagnostic probes and compatibility counters, browser statistics, comparable sample scopes and cancellable UI polling |
| `web/src/platform/` | Browser mounting and cancellable Android gateway readiness handshake |
| `web/src/services/`, `web/src/i18n/`, `web/src/skins/` | Browser persistence, identity import, skin packages and translations |
| `web/src/composables/usePublicSkin.ts`, `web/src/services/skin-operation.ts` | Shared public-page skin initialization and selection, page ownership, cancellation and bounded loading |
| `web/src/services/admin-api.ts`, `admin-requests.ts` | Admin HTTP validation and cancellation, session-bound CSRF and per-feature request ownership, including skin uploads and backup downloads |
| `web/src/composables/useAdminServerSettings.ts`, `useAdminOperations.ts`, `useAdminSkins.ts` | Admin form merging, probes, operational actions and skin state; the page owns authentication, routing and overview |
| `web/src/components/admin/` | Server settings, operations and skin presentation; the parent page retains the feature controller instances across subroute changes |
| `web/src/composables/useAdminI18n.ts`, `web/src/i18n/admin.ts` | Admin formatting and error/status mappings; all five languages explicitly implement the same translation keys |
| `src/mobile/`, `mobile/`, `web/android/` | Android loopback gateway, asset packaging and Capacitor container |

## Connection and control protocol

1. The browser requests `/api/join-ticket`. The gateway validates the request against its access policy and issues a short-lived, single-use ticket.
2. The browser presents the ticket to `/ws/voice`. The bridge admits a session, acquires any required identity lease and creates its TeamSpeak client.
3. WebSocket text messages carry JSON commands, events, WebRTC negotiation and screen-sharing signaling. The server uses the WebSocket `isBinary` flag to distinguish audio from control messages.
4. Register TeamSpeak event listeners before connecting: directory and membership events may arrive during the handshake.

Channel and member data come from SDK directory snapshots and client-protocol commands, followed by realtime notifications. WebQuery and its API key are not required. `DirectorySynchronizer` reconciles snapshots with membership events.

`SessionEventCoordinator` subscribes before SDK connection and closes before waiting for peer shutdown. Remove only its own listeners and guard captured callbacks as well as registered ones. Directory events are accepted during authentication, synchronization and the live connection, but not reconnect backoff. SDK adapter listeners must reject events from a replaced client before mutating state or forwarding them. A kick remains terminal if the disconnect notification already started recovery.

Avatar downloads belong to the connected directory generation. Reset them on SDK interruption and close them before awaiting session teardown. Old success or failure results cannot refill caches, publish images, start another download, or unlock newer work. `isAlive` is only the WebSocket heartbeat acknowledgement flag; it is not a lifecycle predicate. Keep avatar failure optional, the 50-member batch limit and 250 ms continuation delay.

The SDK avatar method captures its client and connection generation across metadata, transfer initialization and download. Recheck both after each await, including reconnects that reuse the same SDK object; never continue an old transfer through a replacement `this.client`. A retired SDK client's disconnect event must not clear the current connection.

Session teardown must remain safe when requested more than once or when sockets and codec resources are already closed. Reconnection is governed by `reconnect-policy.ts`; preserve terminal error handling, bounded retries and the previous-channel fallback.

Invalidate session audio before awaiting peer closure. Each codec and track must be released independently so one disposal failure cannot abandon the remaining resources. WebRTC close callers share one completion promise, including a peer-close rejection. Preserve WebSocketServer's close listener: it owns removal from the server's client set and allows shutdown to finish.

Late socket messages and media permission/negotiation results must not mutate a replacement session. Screen-sharing ownership is scoped to both the TeamSpeak target and channel; another member moving channels must not stop the current user's share. Preserve these invariants when extracting the remaining audio responsibilities.

WebRTC offers, answers, playback callbacks and accompaniment capture belong to the session and peer that started them. Invalidate pending negotiation on stop, reconnect or teardown before awaiting resource closure. A stale peer must not publish errors, counters or audio into its successor. Negotiation and track setup failures must restore compatibility capture without misreporting a microphone failure.

The WebRTC transport owns its peer, input mixer, meter, ICE wait and answer deadline. The capture layer retains ownership of the original microphone and PCM graph; releasing input during microphone preparation must not invalidate the preparing transport. Failed stop signaling cannot prevent local cleanup or compatibility fallback. A fallback permission failure must still belong to the connection and transport generation that initiated it.

Each remote WebRTC audio element owns its in-flight play attempt and retry listeners. Coalesce overlapping gestures, guard captured callbacks against replacement and release partial element setup. Pause, listener removal, source clearing or peer closure failures must not interrupt release of other resources.

Ticket acquisition has a 15-second browser deadline covering preference readiness, fetch and response-body reading. Disconnect and replacement abort the owning request immediately; stale success, rejection and deadline callbacks cannot open a socket or update a newer connection. This is separate from the gateway's TeamSpeak handshake policy. Browser cancellation does not undo a server-side invite consumption or ticket issuance. Preserve the gateway close code over generic WebSocket errors, detach retired handlers, and tolerate socket-close failures.

Every acknowledged command owns its original socket, connection generation and deadline. Success, server rejection, synchronous send failure, timeout and disconnect all use one idempotent completion path; release the registration and timer immediately. Fire-and-forget commands keep the existing shared wire contract.

Chat sends require a connected TeamSpeak session and append local history only after acknowledgement. A queued acknowledgement cannot append after session resource release. Recovery rejections retain the command request ID. Optional channelId and clientUid command fields let the gateway verify the actual channel and recipient before invoking the SDK; legacy payloads remain accepted without those additional guards. Confirmation is not a read receipt, and a timeout does not prove non-delivery.

Directory, chat, events and poke lists retain their reactive array identities. Complete channel snapshots replace the member directory, while omitted members remain unknown rather than empty. Channel projections share canonical members. Departure and UID replacement release the old member's playback, speaking state, temporary volume and whisper selection; persisted UID-based preferences remain. A recovered TeamSpeak connection replaces its directory even when the connected message omits members.

Explicit disconnect, target replacement and ordinary socket closure reset message state and advance the page's session epoch. Same-socket recovery may preserve chat history, but cannot send until connected; recovered directories and events replace old snapshots and clear old pokes. Failed recovery may retain its history for the failure panel until retry or exit.

Private history uses UID scopes when available and member-lifetime scopes for legacy clients without UIDs. Unknown senders must not become later members merely because a numeric ID matches. Preserve the recipient name in outgoing history. Drafts, pending submissions and errors belong to a destination within a session; switching tabs cannot duplicate an in-flight send. Confirmation clears only the unchanged submitted draft, including when its tab is inactive. Reset or disposal retires late feedback.

Channel projection uses iterative parent and sibling traversal, emits each ID at most once, keeps the first duplicate, promotes missing-parent channels to roots and starts isolated cycles at their first source entry. Do not reintroduce recursive traversal or silently discard the entire directory on a malformed topology.

Audio diagnostic probes retain their cancellation entry and deadline until both gateway and browser statistics finish. Bind the result to the original socket, connection generation and peer; disconnect settles pending consumers immediately, and a late browser getStats result cannot mix with a replacement peer. A probe send failure returns no sample.

Diagnostic samples also include the WebRTC transport generation, so a probe cannot survive a failed attempt that starts and ends without a peer. A browser-local scope ID changes with the source and session resets; compatibility counters reset at session teardown and snapshots stay independent. The scope ID is internal metadata, not part of the gateway protocol. Keep the exported diagnostic types available from the voice composable for existing callers.

The performance panel only subtracts counters from matching scopes, transports and downlink sources (PCM, RTP or gateway frames). Null or rejected probes clear stale activity and restart the baseline. Check the polling generation before starting work as well as after awaiting results; unmount retires callbacks and manual refresh. Preserve the 2-second polling interval. For loss estimates, packetsSent already includes all sent packets, while packetsReceived requires adding lost packets to form the denominator; keep percentages bounded and treat RTCP/local snapshots as estimates.

Accompaniment changes keep the WebRTC sender output alive. Prepare and connect the new source before replacing the old one; a failure preserves the current microphone and accompaniment. The input mixer owns its nodes and output track, never the externally owned capture streams. Release partial allocations and continue cleanup if an individual node fails. Application audio bypasses microphone gain/denoising and retains its source level.

The accompaniment controller owns both active and pending captures. Stop, disconnect and replacement immediately release candidates already returned by the browser, even while optional constraints are pending. Late permissions are stopped on arrival; ended or stale candidates cannot be published. Register ended listeners during preparation and publish activity only after attachment succeeds. Optional content hints and processing constraints may fail without losing capture; distinguish audio attachment errors from permission errors in all five languages.

Microphone metering is optional and must not interrupt voice. Its nodes and timer belong to one meter instance; a queued old tick cannot read the next session's analyser or publish a level. Allocation, connection and read failures release all meter resources and clear level/speaking presentation, while preserving the capture stream and peer. Keep the 512-sample analyser and 50 ms cadence unless audio validation justifies changing them.

## Audio and screen sharing

The compatibility voice path captures 48 kHz mono PCM using an AudioWorklet, with a ScriptProcessor fallback. The browser assembles 960-sample, 20 ms frames and sends 1,920-byte Int16 payloads over WebSocket. The gateway encodes them as Opus for TeamSpeak. Incoming Opus uses a three-byte header containing codec and client ID, then browser WebCodecs decoding and playback.

When enabled by the administrator, WebRTC provides a separate voice transport between the browser and gateway. The gateway uses `werift` and mixes incoming TeamSpeak speakers for WebRTC playback. Negotiation failures can fall back to the compatibility path. Keep microphone mute, per-member volume and playback behavior consistent across both transports.

Screen sharing has its own peer connections. The gateway coordinates stream membership and SDP/ICE signaling between browsers and supported TeamSpeak 6 clients. Screen media travels directly or through an externally configured TURN server; the WebSpeak gateway does not carry screen media.

Preserve bounded audio buffering and stale-playback recovery. Audio counters stay in memory and are exposed in session diagnostics. Do not add per-frame persistent logging to the voice path.

Remote playback owns each speaker's decoder, gain and source nodes as one resource set. Member departure, decoder failure and session teardown release that set; queued callbacks must not touch its replacement. Preserve the 80 ms playback window and three-frame decoder queue threshold unless audio validation justifies changing them.

Microphone recording tests own their recorder, timeout and object URL, while the capture layer owns the microphone stream. A normal stop may publish its final recording; replacement and session teardown discard late results and revoke the old URL. Stopping a test while connected must preserve room capture. Test cancellation and stale permission failures must not change a newer test's state.

Device and noise-suppression changes share one configuration operation. Persist only the last successful settings; stale failures cannot roll back a newer choice. Acquiring a replacement microphone must preserve the current WebRTC peer and compatibility PCM capture until the replacement is ready. Capture callbacks are invalidated when their graph stops, separately from permission-request generations. Closing settings also releases standalone device-preview capture when no recording was started.

Prepare microphone nodes and streams before replacing the live graph. A failed allocation or delayed worklet load must leave the old capture usable. Aborting preparation releases its candidate resources immediately; only activation enables PCM callbacks. Worklet module caches belong to their AudioContext. Device removal uses the normal input/output configuration transactions, including WebRTC restart and rollback on failed default-device selection. A committed graph becomes the fallback preference before subsequent device enumeration completes.

Serialize `setSinkId` on each audio context or media element, since an in-flight browser sink change cannot be cancelled. Bind subsequent work to the original endpoint and current operation; session teardown invalidates queued changes and device enumeration results. If one output endpoint rejects after another changed, attempt to restore the last committed output.

`src/server/opus-codec.ts` loads the native `@discordjs/opus` implementation for server deployments and `opusscript` for the Android bundle. Dispose codec and media resources at the end of their owning session.

## Configuration and persistence

Identity file reads belong to the current selection, text revision and dialog lifetime. New files (including invalid selections), manual edits, closing, entering the room, clearing local data and page disposal retire old results. Parsing owns its submitted draft; only a current result may replace the identity or notify. Preserve the 128 KiB limit, UTF-8/UTF-16 BOM decoding and existing busy-close behavior. The dialog disables submission while a selected file is being read and disables edits while parsing.

Startup identity restoration must not overwrite a newer import or remember preference. Exports belong to the identity and page that started them; coalesce pending clicks, discard late serialization and release download anchors, URLs and timers independently. Keep codec parsing in the existing identity service and persistence in the page/storage layer.

Admin requests belong to the login session and feature that started them. Invalidate pending work on authentication changes and page disposal; cancel feature work on management subroute exit. A late 401 must not expire a newer session, and late login or backup results must not navigate or download after disposal. Aborted work is not a user-facing failure. Failed logout preserves the authenticated draft; successful logout or session expiry resets private page state.

Settings responses merge against the submitted snapshot instead of replacing newer edits. Password and action, and relay token and action, are atomic draft groups. Clear acknowledged secret inputs, retain edits made during the request, merge relay nodes by ID, and do not restore obsolete probe metadata. Serialize skin mutations and prevent duplicate invite actions; cancelling browser work does not undo a server mutation already executed.

| Source | Purpose |
| --- | --- |
| SQLite `webspeak.db` | Admin credentials, target and access settings, relay nodes, invitations, audit records and visitor metadata |
| `master.key` beside the database | Encryption key for persisted secrets; retain it with database backups |
| `/admin` | Normal configuration and operational controls |
| Legacy `config.json` | One-time import of `tsHost`, `tsPort` and `tsServerPassword`; later changes do not replace database settings |
| `WEBSPEAK_DATA_DIR` | Persistent data directory; defaults to project `data/`, while Docker uses `/data` |
| `WEBSPEAK_SCREEN_SHARE_ICE_SERVERS` | Screen-sharing ICE configuration read at startup |
| Relay environment variables | Standalone relay mode; public gateway relay choices come from saved admin settings |
| Browser IndexedDB and localStorage | Local identities, preferences, server history and skin state |

The current SQLite schema version is defined in `src/persistence/database.ts`. Keep schema migrations separate from structural refactors. Legacy fields such as `voiceToken`, `tsApiKey`, `tsQueryPort`, `port` and `maxClients` do not configure the current gateway.

The gateway HTTP port is `3040`. Its admission ceiling is `100` sessions, defined in `src/constants.ts`; this is an application limit, not a TeamSpeak license allowance or a measured performance guarantee. Target server capacity and permissions still apply.

The server uses HTTPS when `certs/cert.pem` and `certs/key.pem` are supplied; otherwise it starts HTTP. It does not generate certificates. Use an appropriate secure browser origin for microphone and screen capture, typically HTTPS in public deployments. Feature support depends on the browser and selected transport; do not infer a universal minimum browser version from WebCodecs alone.

## Development and verification

Server deployments require Node.js 22.5 or newer. CI uses Node.js 22.22.2. Root and frontend dependencies are installed separately. The pinned Git SDK and native Opus module require the preparation steps used by CI:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run prepare:sdk
npm rebuild @discordjs/opus --foreground-scripts --no-audit --no-fund
npm --prefix web ci --no-audit --no-fund
npm run verify
```

`npm run verify` runs unit tests, the backend build and `npm run web:build`. The latter delegates to the frontend build, including `vue-tsc --noEmit`. Use `npm run dev` and `npm run web:dev` for development, or `npm start` after building both applications.

Headless Vue tests use Vite middleware mode with both HMR and the WebSocket listener disabled (`hmr: false`, `ws: false`). Disabling HMR alone still reserves Vite's default socket port and causes parallel test processes to conflict.

CI verifies pushes to `dev` and `master`, pull requests and manual runs. Docker publication on `master` or release tags, and release packaging on tags or manual runs, call the same verification workflow before publishing or packaging. Verification includes the application checks and a Docker HTTP health smoke test; that smoke test does not prove voice or screen-sharing functionality.

Tests requiring a real TeamSpeak server, browser media devices or Android hardware must document their environment and outcome separately. Never substitute a mock codec or an HTTP health response for a successful audio test.

## Android preview

The Android app starts an embedded Node.js gateway on `127.0.0.1:3040` and opens it in the WebView. This preview disables gateway WebRTC voice and the admin console, while reusing the compatibility voice path. Its dependencies and runtime differ from server deployments.

See `mobile/README.md` for build steps and recorded limitations. The embedded Node.js version, SDK compatibility, real-device connections, background audio and native screen sharing require their own validation. Do not present these capabilities as production-ready based on desktop tests.

Platform startup owns its message listener, polling interval and deadline, including slow listener registration. Release them on success, failure, timeout and page exit. The retry button repeats the readiness handshake; it does not restart the embedded Node.js runtime.

## Repository maintenance

Routes load their page modules on demand. Document-level page styles must be gated by `html[data-ws-route]` because loaded CSS remains after navigation. The admin stylesheet is independent of public skins. Component extraction must retain `data-ws-part` hooks and account for Vue scoped styles across component boundaries.

The identity dialog retains page-owned CSS with narrowly targeted `:deep` selectors so the existing declaration order and specificity remain intact. Shared button rules target its dedicated classes across the component boundary. Its close button is positioned within the modal. Public skin-contract tests include Vue files recursively under `components/web-client`; keep new public parts documented.

The public join form uses explicit named field models and emits page actions. The chat panel receives a presentation subset of the single page-owned chat controller; keep its list ref bound to the rendered scroller so tab changes and new messages retain automatic scrolling. Form grid columns must allow shrinking, and narrow identity/relay controls must wrap without clipping translated text.

The member panel and actions menu also share one page-owned member controller. The panel exposes an audio-dock slot; menu placement uses measured viewport bounds, converts through the page CSS zoom, and releases its resize observer/listener on unmount. Only desktop may open the move submenu on hover: mobile bottom-anchored menus change position when expanded and must open on click to avoid moving a member accidentally. Constrain short-window menus and allow scrolling.

Voice member cards receive the current channel projection, speaking/avatar helpers and a narrow sharing interface. Keep the sharing refs stable; member menus and stop-sharing actions return to the page through events. Empty, self, speaking, starting, sharing and viewing states must retain their skin hooks and mobile behavior.

Voice diagnostics and screen-sharing presentation also reuse page-owned controllers. Bind the player and video with explicit element callbacks. Rebind an existing stream when its video element changes, clear the previous element, and never stop the media owner's tracks during presentation cleanup. Fullscreen requires a non-null owned player; removing it exits only its own fullscreen. Known screen owner IDs take precedence over nickname fallback, including duplicate nicknames. Sharing settings use the common dialog focus handling.

The audio dock and whisper strip share the page-owned audio controller. Push-to-talk belongs to one primary pointer or one Space/Enter press; unrelated releases and key repeats must not change it. Failed pointer capture must not enable whispering. Clear ownership before releasing capture, and stop on blur, hidden controls/pages and disposal. The whisper component owns and releases its window/document listeners; keep media state in the voice layer.

Audio settings and password dialogs retain one page-owned media/connection state. Dialog focus supports initial focus, Tab cycling, Escape and return to the opener, with a connect-button fallback after pending connections disable that opener. Settings error feedback belongs to the current opening and latest request; closing synchronously stops recording tests, and scope disposal retires pending feedback and stops tests too. A non-password channel error must release the password dialog's pending state and preserve its draft for retry; reject duplicate submissions while pending.

Admin presentation components receive stable feature controllers; do not instantiate duplicate controllers in children. The welcome-language model remains page-owned and the skin file input belongs to its presentation component. Feature CSS crosses these boundaries with `:deep`, while shell and language-control selectors retain their existing scope. On narrow screens the brand and logout occupy the first row and all four navigation links share a separate row with at least 44 px high targets.

Keep each repair batch tied to its current plan item. Combine related fixes before running the full verification command; use focused checks during diagnosis and repeat the full suite only when subsequent changes or failures warrant it.

Keep template/CSS formatting separate from behavior changes. Preserve inline whitespace text nodes when wrapping Vue tags; compare compiled render output when needed. CSS formatting must retain selector meaning, values and declaration/rule order. Layout assertions should tolerate formatting whitespace while still checking the intended rules and values.

Public skin activation is last-choice-owned across both public pages. Retire previous runtime work before preparing a replacement, and reject results after page disposal, a newer choice or local-data reset. Check ownership before modifying document styles, selected content, asset URLs or stored preferences. An already aborted caller must not cancel a newer page's activation. Release compiled candidate URLs on failed installation.

Skin initialization has an 8-second total deadline covering preference reads, directory fetch and body, package loading and activation. Network stages also have bounded standalone operations. A timeout reveals a usable built-in palette and retires late work; retain the explicit skin choice for a later retry. Normal initialization still respects the enabled instance default unless the visitor made a deliberate choice. Home and demo use the same controller; do not restore duplicate unguarded refresh paths.

Skin cache writes and preference persistence accept the owning AbortSignal, including while waiting for IndexedDB to open and during its write transaction. Report storage success at transaction completion. Merge preferences within one transaction so concurrent unrelated settings are preserved. Cancellation of optional persistence must never block page use.

Validate admin responses before applying them to page state. Network and protocol failures must preserve unsaved input; a failed logout must not be presented as a successful logout. Keep secret keep/replace/remove actions intact and do not persist credentials in UI error messages or diagnostic logs.

The repository remote is `https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak`. Preserve existing local work and keep private configuration, runtime data, local deployment archives, and machine-specific notes out of source commits. Preserve documented skin hooks and browser persistence formats during component refactors.
