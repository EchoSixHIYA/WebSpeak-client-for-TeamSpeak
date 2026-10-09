# KAAK voice skin

KAAK is a schema v3 open-skin package for WebSpeak's public connection page and voice workspace. It keeps TeamSpeak connection, channel, member, chat, favorite-server, audio, and screen-sharing behavior in the host. The desktop voice layout places the favorite-server rail, a declarative channel list, the active workspace, a member column, and the audio dock in separate regions. Narrow screens return to WebSpeak's responsive channel and member controls.

The design target is the voice-client portion of KOOK, as requested by the project owner. This skin does not include discovery, companion/party, event, store, advertising, administrator, or other service-operator pages. It does not add a KOOK account flow, direct messages, server administration, or channels absent from the connected TeamSpeak server.

## Reference access note

The owner authorized inspection of the first two voice rooms in the KOOK server. Both rooms were entered and viewed; the microphone remained off. The reference confirmed a narrow server rail, grouped channel list with inline voice participants, a central channel/chat workspace, a right-side member column, and a compact voice-control dock near the lower left. This is a layout and styling reference, not a claim of pixel-for-pixel reproduction. Server/room identifiers, member names, and chat contents were not recorded.

## Components and permissions

The channel list and member column are defined as separate components in [components.json](./kaak-voice/components.json). They read only the visible TeamSpeak channel tree and visible member names/speaking state. A user-activated channel control asks the host to join a listed channel; the host rechecks visibility and applies the existing TeamSpeak password and permission flow. Permission approval is local to this skin version and can be revoked from the host access control.

The favorite-server rail and main audio/chat controls remain WebSpeak components. The plugin does not receive server addresses, passwords, identity keys, microphone controls, raw audio, private messages, or arbitrary network/storage APIs. The /demo page uses synthetic data and does not connect to TeamSpeak.

## Files

- Source package: [kaak-voice](./kaak-voice/)
- Component schema: [components.json](./kaak-voice/components.json)
- Distributable archive: [kaak-voice.wskin](./kaak-voice.wskin)
- Shared format and safety rules: [SKIN_DEVELOPMENT.md](../SKIN_DEVELOPMENT.md)

The package is a ZIP archive with manifest.json at its root. Rebuild the archive from the contents of kaak-voice after any source change, then import the .wskin in a visitor browser and verify the consent, approval, denial, revoke, desktop, and narrow-screen paths.
