# ILLUSIA风

ILLUSIA风 is a visual-only `.wskin` example built from the local artwork in `illusia-voice/assets/`. It styles the WebSpeak home page, voice workspace, screen-share player, and `/demo` with bright glass surfaces and cyan accents. The homepage skin follows the supplied reference art for the translucent navigation, matching glass skin and language selectors, an illustrated animated ILLUSIA skin option, a floating mascot with a visibly pulsing cyan waveform and expanding halo in the join card, a softly animated cyan aurora inspired by the visitor badge, three feature tiles, character visitor badge, mascot-accented join action, and full-width curved footer. The ambient waveform and halo slow down when reduced motion is enabled instead of disappearing. The voice-room skin uses the resting chibi illustration as the message-empty backdrop and places the main character illustration on the dedicated non-interactive artwork layer so it can rest over the edge of member cards or a live screen-share player without moving or blocking their controls.

This package intentionally omits `content.json`: the existing WebSpeak translations supply every label and message, including the current and total visitor counts. A skin may optionally add localized copy overrides, but missing locales and fields continue to use WebSpeak's base content. Its CSS is visual-only: WebSpeak retains its component positions, dimensions, text flow, and interactions. In the voice room, the main illustration and headset use separate, non-interactive foreground layers with restrained perspective and shadows; the chat's empty state includes a CSS-drawn speech-bubble ornament, while its translated copy remains visible. The footer wave is a pre-rendered transparent asset sampled from the example's original curve, so it decorates the existing footer instead of introducing another layout element.

The package source is in [`illusia-voice/`](illusia-voice/). To build it from the repository root:

```powershell
Compress-Archive -Path .\docs\examples\illusia-voice\* -DestinationPath .\docs\examples\illusia-voice.zip -Force
Rename-Item .\docs\examples\illusia-voice.zip illusia-voice.wskin -Force
```

Use only artwork you have permission to redistribute when publishing a skin to other WebSpeak instances.
