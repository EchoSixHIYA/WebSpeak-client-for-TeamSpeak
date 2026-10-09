# KAAK voice skin

KAAK is a schema v3 open-skin package for WebSpeak's public connection page and voice workspace. It keeps TeamSpeak connection, channel, member, chat, favorite-server, audio, and screen-sharing behavior in the host. On desktop, its declarative channel/member sidebar replaces the host's channel tree; on narrow screens, WebSpeak's native responsive channel/member UI remains in use.

The design target is the voice-client portion of KOOK, as requested by the project owner. This skin does not include discovery, advertising, companion/party, event, store, administrator, or other service-operator pages. It does not add a KOOK account flow, direct messages, server administration, or channels absent from the connected TeamSpeak server.

## Reference access note

The owner authorized inspection of two specified voice rooms. The current browser bridge exposes the KOOK tab in its inventory but times out when reading its page, and direct page access is unavailable. Therefore this revision is a v3 architecture and styling migration based on the existing KAAK draft and the owner's voice-client scope; it is not a verified pixel-for-pixel reproduction of either live room. No room contents or member details are asserted here.

## Components and permissions

The voice sidebar is defined in [components.json](./kaak-voice/components.json). It reads the public channel tree and visible member names/speaking state. A real user double-click or Enter/Space key action can ask the host to join a listed channel; the host rechecks that the channel is visible and applies the existing TeamSpeak password and permission flow. Permission approval is local to this skin version and can be revoked from the host access control.

The favorite-server rail and main audio/chat controls remain WebSpeak components. The plugin does not receive server addresses, passwords, identity keys, microphone controls, raw audio, private messages, or arbitrary network/storage APIs. The /demo page uses synthetic data and does not connect to TeamSpeak.

## Files

- Source package: [kaak-voice](./kaak-voice/)
- Component schema: [components.json](./kaak-voice/components.json)
- Distributable archive: [kaak-voice.wskin](./kaak-voice.wskin)
- Shared format and safety rules: [SKIN_DEVELOPMENT.md](../SKIN_DEVELOPMENT.md)

The package is a ZIP archive with manifest.json at its root. Rebuild the archive from the contents of kaak-voice after any source change, then import the .wskin in a visitor browser and verify the consent, approval, denial, revoke, desktop, and narrow-screen paths.
