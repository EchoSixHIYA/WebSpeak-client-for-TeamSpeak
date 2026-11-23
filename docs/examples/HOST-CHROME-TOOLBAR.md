# Host chrome toolbar example

A minimal schema v3 open skin that docks the trusted recovery entry into the page header as host-owned buttons instead of the floating capsule shell. It is the smallest reference for `chrome.json` `mode: "toolbar"`, page-specific anchor candidates, toolbar style tokens, application-library de-duplication and the floating-capsule fallback.

- Source: [host-chrome-toolbar](./host-chrome-toolbar/)
- Importable package: [host-chrome-toolbar.wskin](./host-chrome-toolbar.wskin)
- Shared component and permission rules: [skin development guide](../SKIN_DEVELOPMENT.md)
- Host chrome and toolbar contract: [skin development guide](../SKIN_DEVELOPMENT.md) (see the `chrome.json#slots` and toolbar-mode sections)

## Package layout

```text
host-chrome-toolbar/
  manifest.json   # schema v3, author WebSpeak Community
  chrome.json     # one grouped toolbar slot with a home/voice anchor list
  skin.css        # page theme, toolbar tokens and header space reservation
```

`skin.css` uses only public `data-ws-part` hooks and sets `--skin-host-toolbar-*` / `--skin-recovery-toolbar-*` variables. It never targets the host toolbar DOM, the recovery capsule, the authorization dialog or the load-failure banner.

## What the declaration does

```json
{
  "schemaVersion": 1,
  "slots": {
    "host.recovery": {
      "mode": "toolbar",
      "anchor": ["home.header", "voice.header"],
      "align": "end"
    }
  }
}
```

- `mode: "toolbar"` asks the host to render two plain host buttons (use built-in skin, application library) without the capsule shell.
- The anchor list covers both pages; the host picks the first visible one and re-resolves it after a page switch. A missing or hidden anchor returns the complete, visible floating capsule.
- While the library is available, the host hides the ordinary application-library launcher so the page keeps exactly one library entry. The fallback capsule keeps that entry when the anchor fails.
- The host owns the labels, click handlers, focus behaviour, minimum hit target and shortcut handling. The skin only supplies anchor and token values.
- Old slots without `mode` keep the capsule presentation; this example opts in explicitly.

## Trying it

1. Build or import [host-chrome-toolbar.wskin](./host-chrome-toolbar.wskin) in a local WebSpeak instance.
2. Allow the third-party skin when the host asks.
3. Connect to **Demo Server**, join **Demo Lobby**, and check the header as **Demo User**.
4. Confirm the two host buttons appear at the end of the home and voice headers, use the dark toolbar palette, and open the built-in-skin and application-library actions.
5. Remove or hide the anchor in the page inspector; the complete floating capsule should appear at a corner. Restore the anchor; the toolbar should re-dock after the anti-flap check.
6. Press `Ctrl+Alt+Shift+R` (`⌘+⌥+⇧+R` on macOS); the toolbar hides, the complete capsule appears and focuses its first button. Press Escape to return to the toolbar.

The example contains no server addresses, member names, chat contents or other real instance data. Public descriptions use only the Demo Server / Demo Lobby / Demo User placeholders.
