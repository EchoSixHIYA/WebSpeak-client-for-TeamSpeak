# ILLUSIA风

ILLUSIA 风格 is a schema v3 open-skin example built from the local artwork in [illusia-voice/assets](./illusia-voice/assets/). Version 2.0.0 keeps its existing light-glass CSS and adds a small declarative current-channel card to exercise the new component renderer. The package still uses WebSpeak's base translations and contains no executable skin code.

The new voice-page component is defined in [components.json](./illusia-voice/components.json). It reads only the current public channel name through session.status.read and uses a local mascot image for a compact, non-interactive glass badge. The component needs the user's local approval before it renders; that approval is scoped to this skin version and can be revoked from the host access control. It cannot switch channels, read favorites, access a server address, or control audio.

The CSS continues to style the WebSpeak home page, voice workspace, screen-share player and /demo with cyan accents and original art. The homepage includes translucent navigation and selectors, animated mascot details, feature tiles, a visitor badge, a join action and a curved footer. The voice workspace includes the shared quick-server list, channel/member views, chat empty state, screen-share art and audio controls. The mobile view keeps WebSpeak's responsive host navigation while applying ILLUSIA colors and artwork.

The distributable package and the copy served from web/public/skins are built from the source folder. After changing source files, recreate docs/examples/illusia-voice.wskin from that folder and copy the resulting package to web/public/skins/illusia-voice.wskin. Run the package import test to confirm both copies stay byte-identical and valid.

Use only artwork you have permission to redistribute when publishing a skin to other WebSpeak instances.
