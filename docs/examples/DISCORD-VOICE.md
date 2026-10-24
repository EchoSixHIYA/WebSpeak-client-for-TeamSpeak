# Discord Voice skin

This example turns the Discord-inspired voice interface into a portable WebSpeak `open-skin` v3 package. Its page structure is declared in `components.json`; its palette and layout are in `skin.css`; localized skin copy lives in `content.json`.

The independent distribution repository is [Huddle-Up-Forge/webspeak-skin-discord-voice](https://github.com/Huddle-Up-Forge/webspeak-skin-discord-voice). It is the first entry in the [WebSpeak skin store index](https://github.com/Huddle-Up-Forge/webspeak-skins). Administrators can install it from **Skins → Skin store**, then manage availability and the instance default under **Instance skins**. Version 1.0.5 requires WebSpeak 0.2.8 with the current public skin API.

The package uses WebSpeak's public TeamSpeak widgets for channel navigation, member cards, chat, audio controls, screen sharing, performance status, server switching and invite links. That keeps connection logic and trusted actions in WebSpeak while the skin controls the visible layout. The Discord visual language and color palette are retained, while host-owned controls keep their supported behavior and accessibility.

The skin requires explicit approval to replace the home and voice pages. It does not include JavaScript, depend on Vue internals, or change WebSpeak runtime code. It can be imported from `/admin/skins` as an ordinary `.wskin` package.

- Source: [discord-voice](./discord-voice/)
- Package: [discord-voice.wskin](./discord-voice.wskin)
- Format and runtime contract: [skin development guide](../SKIN_DEVELOPMENT.md)

Build the package from the repository root with:

```powershell
node web/scripts/build-discord-voice-skin.mjs
```

Native fullscreen and the bespoke screen-share settings shortcut from the built-in Vue version are not part of the current public skin API. The standard package keeps screen sharing reachable through WebSpeak's trusted screen-share controls and uses the standard audio settings panel.
