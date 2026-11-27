# Host chrome toolbar example

A minimal schema v3 open skin that docks the trusted recovery entry into the page header as Classic-aligned, host-owned icon buttons instead of the floating capsule shell. It is the smallest reference for `chrome.json` `mode: "toolbar"`, `appearance`, page-specific anchor candidates, transparent toolbar tokens, application-library de-duplication and the floating-capsule fallback.

- Source: [host-chrome-toolbar](./host-chrome-toolbar/)
- Importable package: [host-chrome-toolbar.wskin](./host-chrome-toolbar.wskin)
- Author: WebSpeak Community
- Shared component and permission rules: [skin development guide](../SKIN_DEVELOPMENT.md)
- Host chrome and toolbar contract: [skin development guide](../SKIN_DEVELOPMENT.md) (see the `chrome.json#slots` and toolbar-mode sections)

## Package layout

```text
host-chrome-toolbar/
  manifest.json   # schema v3, version 1.1.2, minAppVersion 0.3.4-dev.0, author WebSpeak Community
  chrome.json     # one grouped toolbar slot with a home/voice anchor list
  skin.css        # light page theme, Classic toolbar tokens and header space
```

This package requires WebSpeak 0.3.4-dev.0 or later. Released WebSpeak 0.3.3 and earlier do not accept `mode`, `appearance`, or anchor candidate arrays, so importing it there cannot provide toolbar-mode behavior. Older slots without those fields remain valid and keep their capsule presentation.

`skin.css` uses only public `data-ws-part` hooks and sets `--skin-host-toolbar-*` / `--skin-recovery-toolbar-*` variables. It never targets the host toolbar DOM, the recovery capsule, the authorization dialog or the load-failure banner.

## Grouped declaration

```json
{
  "schemaVersion": 1,
  "slots": {
    "host.recovery": {
      "mode": "toolbar",
      "appearance": "icon",
      "anchor": ["home.header", "voice.header"],
      "align": "end"
    }
  }
}
```

- `mode: "toolbar"` asks the host to render two real host buttons without the capsule shell.
- `appearance: "icon"` selects the host-owned 16px built-in-skin and application-library SVGs. Each button is 24px wide, has zero padding and keeps its localized `aria-label` and `title`.
- The anchor list covers both pages; the host picks the first visible one and re-resolves it after a page switch. A missing or hidden anchor returns the complete, visible floating capsule.
- While the library is available, the host hides the ordinary application-library launcher so the page keeps exactly one library entry. The fallback capsule keeps that entry when the anchor fails.
- The host owns the icons, labels, click handlers, focus behaviour, shortcut handling and fallback. The skin only supplies the anchor, appearance and token values.
- Old slots without `mode` keep the capsule presentation; this example opts in explicitly.

## Classic tokens

```css
:root {
  --skin-host-toolbar-background: transparent;
  --skin-host-toolbar-foreground: #1a1a1a;
  --skin-host-toolbar-border: transparent;
  --skin-host-toolbar-hover-background: #eaf2fd;
  --skin-host-toolbar-hover-border: #b8cfe8;
  --skin-host-toolbar-surface: #f4f7fb;
  --skin-host-toolbar-radius: 2px;
  --skin-host-toolbar-font-size: 11px;
  --skin-host-toolbar-padding: 0 4px;
  --skin-host-toolbar-height: 22px;
  --skin-host-toolbar-gap: 1px;
  --skin-host-toolbar-icon-size: 16px;
}
```

This produces 22px-high buttons, a transparent normal surface, a 1px transparent border, 2px corners, 11px type, 16px icons and a 1px gap. Hover uses `#eaf2fd` with a `#b8cfe8` edge. `surface` is not painted; it tells the host which opaque colour to use for contrast checks. Set it to the real header colour when adapting the example.

The package also declares an opaque `--skin-recovery-*` capsule palette. Capsule mode keeps its historical 28/32/36px size floors, full text labels and fixed `#fff7ed` built-in action; toolbar tokens never shrink or restyle that escape hatch.

## Independent declaration

Use the per-action keys when the two actions need different anchors or appearances. Do not declare them together with `host.recovery`.

```json
{
  "schemaVersion": 1,
  "slots": {
    "host.recovery.built-in": {
      "mode": "toolbar",
      "appearance": "icon-and-label",
      "anchor": ["home.header-tools", "voice.header-actions"],
      "align": "end"
    },
    "host.recovery.library": {
      "mode": "toolbar",
      "appearance": "icon",
      "anchor": ["home.header-tools", "voice.header-actions"],
      "align": "start"
    }
  }
}
```

`appearance` defaults to `"label"` for backward compatibility. The accepted toolbar values are `"label"`, `"icon"` and `"icon-and-label"`; unknown values and icon appearances in capsule mode are rejected with `SKIN_CHROME_SLOT_INVALID`.

## Trying it

1. Build or import [host-chrome-toolbar.wskin](./host-chrome-toolbar.wskin) in a local WebSpeak instance.
2. Allow the third-party skin when the host asks.
3. Connect to **Demo Server**, join **Demo Lobby**, and check the header as **Demo User**.
4. Confirm the two 24px host icons appear at the end of the home and voice headers, remain transparent at rest, use the Classic hover colours, and open the built-in-skin and application-library actions.
5. Remove or hide the anchor in the page inspector; the complete floating capsule should appear at a free corner. Restore the anchor; the toolbar should re-dock after the anti-flap check.
6. Press `Ctrl+Alt+Shift+R` (`⌘+⌥+⇧+R` on macOS); the toolbar hides, the complete full-text capsule appears and focuses its first button. Press Escape to return to the toolbar.
7. Check a narrow viewport and all five interface languages. Icon-only names must remain available to assistive technology, and the fallback capsule must keep readable localized labels.

The example contains no server addresses, member names, chat contents or other real instance data. Public descriptions use only the Demo Server / Demo Lobby / Demo User placeholders.
