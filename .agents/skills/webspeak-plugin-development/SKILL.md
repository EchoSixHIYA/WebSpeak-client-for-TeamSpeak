---
name: webspeak-plugin-development
description: Develop, review, package, and validate portable WebSpeak functional .wplugin plugins through the public API. Use for server or instance plugins and GitHub plugin distribution, not .wskin appearance packages or their internal components.
---

# WebSpeak Plugin Development

Build a functional package without editing WebSpeak runtime, SDK, skins, or administration code. A missing host capability needs a separate API change authorized by the user; do not invent methods or reach into Vue instances.

Read the current [plugin development guide](../../../docs/PLUGIN_DEVELOPMENT.md) before implementing. In a standalone checkout, use the guide at `https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/blob/dev/docs/PLUGIN_DEVELOPMENT.md`. Confirm that the target instance supports API v1; released v0.2.9 does not.

Choose the scope that matches the user's intent: `server` uses actual TS target + channel rooms; `instance` shares a room across connected users of one gateway. Neither synchronizes separate gateways or TS native clients. Public plugin config is not secret storage. Do not repurpose TS administration credentials.

Keep UI/behavior in `.wplugin` JSON: validated manifest, HTML, script, complete light and dark styles. Use only `window.webspeak.ready` and the documented `room` API. Never assume a particular skin DOM or CSS selector. Use an independent panel, responsive layout, translated labels, and accessible controls. Media autoplay needs participant action when blocked.

Represent collaboration as small JSON state. Use revision CAS, recover conflicts from a fresh snapshot, reject old room IDs/versions, and derive playback progress from gateway time rather than sending frames or high-frequency ticks. Clean timers, subscriptions and media on pagehide. The example is `docs/examples/watch-together/` in the host repo and `examples/watch-together/` in the distribution repo.

Build with `node --import tsx scripts/build-plugin.mjs SOURCE_DIR OUTPUT.wplugin` in a host checkout (the provided template reads manifest.json, panel.html, player.js, light.css and dark.css), or use the standalone distribution repo builder. Validate the actual resulting package through host import. For GitHub distribution provide real package SHA-256 and a fixed commit/tag, then add the repository to the catalog. Publishing or deploying requires the user's task authorization; do not infer it from this skill.

Verify two independent participants: load/play/pause/seek, late join, concurrent writes, target/channel isolation, disconnect, close, administrator disable/update and re-open. Check both themes and narrow layout. Distinguish mocked gateway tests from a real browser playback test and real TS connectivity. Only claim capabilities the evidence demonstrates. Keep private credentials and diagnostic recordings outside published artifacts.
