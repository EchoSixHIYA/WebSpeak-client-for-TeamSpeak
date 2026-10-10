# KAAK voice skin

KAAK is a schema v3 open-skin package with full connection and voice-workspace surfaces. Its voice page uses a narrow server rail, hierarchical TeamSpeak channels with inline participants under every occupied channel, a central text chat, an online-member column, and a lower-left voice dock. The dock includes WebSpeak's host-owned voice-quality panel. The roster labels connected clients as online; it does not fabricate an offline list because TeamSpeak only supplies connected members. Channel selection is single-click; joining is double-click. The narrow layout keeps the host's mobile controls available.

The design target is the voice-client portion of KOOK, as requested by the project owner. It does not include discovery, companion/party, event, store, advertising, administrator, or other service-operator pages. It does not add a KOOK account flow, direct messages, server administration, or channels absent from the connected TeamSpeak server.

## Reference access note

The owner authorized inspection of the first two voice rooms in the KOOK server. Both rooms were entered and viewed; the microphone remained off. The reference confirmed a narrow server rail, grouped channel list with inline voice participants, a central text chat workspace, a right-side online/offline member column, and a compact voice-control dock near the lower left. This is a layout and styling reference, not a claim of pixel-for-pixel reproduction. Server/room identifiers, member names, and chat contents were not recorded.

## Components and permissions

The connection page and voice workspace are full-page declarative surfaces in [components.json](./kaak-voice/components.json). The voice surface requests only the capabilities it uses: visible server shortcuts, channel and member data, channel joining, channel chat, voice status, microphone/output controls, whisper controls, disconnect, and screen sharing. The host renders trusted connection, language, skin, audio, and screen-share controls. It rechecks permissions and connection state when each action runs; approval is local to this skin version and can be revoked from the host access control.

Member avatar circles use the first character derived from the visible nickname; KAAK does not read profile image files. The skin does not receive server addresses, passwords, identity keys, raw audio, private messages, or arbitrary network/storage APIs. Its markup is data-only; it contains no executable JavaScript or Wasm. The `/demo` page uses synthetic data and does not connect to TeamSpeak.

## Files

- Source package: [kaak-voice](./kaak-voice/)
- Component schema: [components.json](./kaak-voice/components.json)
- Distributable archive: [kaak-voice.wskin](./kaak-voice.wskin)
- Shared format and safety rules: [SKIN_DEVELOPMENT.md](../SKIN_DEVELOPMENT.md)

KAAK is included in the public skin selector and its `.wskin` archive is also available as a standalone package. After changing the source, run `npm run skin:kaak:build` to rebuild both copies, then run the package tests and verify the connection page, approval, denial, revoke, desktop, and narrow-screen paths in the local browser. The connected voice surface can be verified when a TeamSpeak session is available.
