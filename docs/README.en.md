# WebSpeak · English

[Project home](../README.md) · [简体中文](./README.zh-CN.md) · [Deutsch](./README.de.md) · [Русский](./README.ru.md) · [日本語](./README.ja.md)

WebSpeak is a self-hosted browser client and voice gateway for TeamSpeak 3 and TeamSpeak 6. Visitors can join channels without installing a desktop client, while administrators manage the target servers, access policy, and runtime state from the web console.

## Live demo

URL: <https://webspeak.online>

The public demo is hosted in Hong Kong and its network conditions and load may be unstable. Latency, disconnections, or temporary downtime do not represent every self-hosted deployment.

## ✨ Features

| Capability | Description |
| --- | --- |
| TeamSpeak compatibility | Supports TeamSpeak 3 and TeamSpeak 6 and automatically detects the target protocol. |
| IPv6 targets | IPv6 TeamSpeak targets and IPv6 addresses resolved from hostnames are supported by default. |
| Channels and members | Browse the channel tree, see live member states, and switch channels. |
| Realtime voice | Opus audio with a compatibility transport and optional bundled WebRTC low-latency transport. |
| Audio controls | Select microphones and speakers, adjust volume, test the microphone, mute, use VOX, and control member volume. |
| Browser-side noise suppression | Optional microphone noise suppression runs at the browser capture stage, without adding server-side audio processing. |
| Messaging and actions | Channel chat, server chat, private messages, poke actions, and whisper targets. |
| Desktop accompaniment | Select an audio-enabled window or browser tab and share its sound with the current channel. |
| Identity and access | Remembered identity, visitor-defined targets, and revocable expiring invite links. |
| Administration | Manage targets, access policy, WebRTC, relays, invites, sessions, logs, diagnostics, and backups. |
| User experience | Chinese, English, German, Russian, and Japanese UI, light/dark themes, and responsive desktop/mobile layouts. |
| Self-hosting | Data stays with the operator; Docker, Windows x64, and Linux x64 deployment options are provided. |

## 🖼️ Screenshots

The screenshots show the English welcome page, voice workspace, audio controls, and member menu.

### Welcome page

<p align="center"><img src="./screenshots/webspeak-en-home.png" alt="WebSpeak English welcome page" width="100%" /></p>

### Voice workspace

<p align="center"><img src="./screenshots/webspeak-en.png" alt="WebSpeak English voice workspace" width="100%" /></p>

### Audio controls

<p align="center"><img src="./screenshots/webspeak-en-audio.png" alt="WebSpeak English audio controls" width="100%" /></p>

### Member menu

<p align="center"><img src="./screenshots/webspeak-en-menu.png" alt="WebSpeak English member menu" width="100%" /></p>

## 🧩 Advanced features

These features are optional. WebSpeak continues to work with the compatibility voice transport when they are disabled. Configure them under **Administration → Servers**; saved changes apply to new connections.

### 1. WebRTC low-latency voice

WebRTC moves browser voice to a realtime media path and also enables desktop accompaniment. The current WebSpeak gateway provides it directly; no separate media server is required.

1. Sign in at `/admin` and open **Advanced settings** on the **Servers** page.
2. While WebRTC is disabled, choose the UDP start and end ports. The default range is `40000–40099`.
3. Allow the complete UDP range in the WebSpeak host's security group and firewall.
4. Enable **WebRTC** and save. New visitors will negotiate WebRTC; unsupported browsers and networks fall back to the compatibility transport.

The port range is locked while WebRTC is enabled. Disable and save WebRTC before changing it, then update the firewall rules. Public deployments also need HTTPS.

### 2. Relay mode

Use a relay when a TeamSpeak server rejects connections from another region or when the direct path is unstable. It is not a VPN: it forwards only the TeamSpeak traffic of the current WebSpeak session, while the visitor still chooses the target server in the web page.

A relay instance is a dedicated forwarding service with no visitor page or administration console. It accepts only gateway sessions with a matching token. Use a random token of at least 16 characters.

#### Run from source

```bash
git clone --depth 1 https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
npm ci --ignore-scripts
npm run prepare:sdk
npm run build
WEBSPEAK_MODE=relay \
WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token' \
WEBSPEAK_RELAY_HOST='0.0.0.0' \
WEBSPEAK_RELAY_PORT='39087' \
node dist/index.js
```

Windows PowerShell:

```powershell
$env:WEBSPEAK_MODE = "relay"
$env:WEBSPEAK_RELAY_TOKEN = "replace-with-a-long-random-token"
$env:WEBSPEAK_RELAY_HOST = "0.0.0.0"
$env:WEBSPEAK_RELAY_PORT = "39087"
node .\dist\index.js
```

#### Run from a release package

Download and extract the appropriate package from [Releases](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest):

```bash
# Linux
export WEBSPEAK_MODE=relay
export WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token'
export WEBSPEAK_RELAY_HOST='0.0.0.0'
export WEBSPEAK_RELAY_PORT='39087'
./runtime/node ./dist/index.js
```

On Windows PowerShell, set the same variables and run `.\runtime\node.exe .\dist\index.js`.

#### Run with Docker

```bash
docker run -d --name webspeak-relay --restart unless-stopped --network host \
  -e WEBSPEAK_MODE=relay \
  -e WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token' \
  -e WEBSPEAK_RELAY_PORT='39087' \
  ghcr.io/echosixhiya/webspeak:latest
```

Allow the relay host's UDP listen port, `39087` by default.

#### Enable it in the gateway

1. Open **Administration → Servers → Relay server** and add one or more nodes.
2. Set a custom display name, endpoint such as `relay.example.com#39087`, and matching token for each node, then save.
3. Visitors can choose direct access or one of the configured relays on the welcome page.

Disable and save the relay configuration to remove the relay option from the welcome page.

### 3. Dependencies and attribution

- The relay service is built into WebSpeak with Node.js standard libraries; it does not use GOST, sing-box, or another proxy framework.
- WebRTC uses [werift](https://github.com/shinyoshiaki/werift-webrtc) `0.24.4`, whose upstream project is licensed under MIT.
- TeamSpeak protocol connectivity uses the project-maintained [EchoSixHIYA/teamspeak-js](https://github.com/EchoSixHIYA/teamspeak-js) SDK fork.

## 🧾 Changelog

| Version | Date | Summary |
| --- | --- | --- |
| [v0.2.3](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.3) | 2026-09-19 | Fixed member moves, permission checks, avatars, mute synchronization, and remembered-identity recovery; refreshed feature screenshots and documentation for all five languages. |
| [v0.2.2](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.2) | 2026-09-17 | Added browser-side microphone noise suppression, Russian and Japanese UI, and per-language welcome text; refined volume interaction and error messages/codes on top of PR #2. |
| [v0.2.1](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.1) | 2026-09-13 | Improved welcome-page connection errors, preserved and safely truncated error codes, and added default IPv6 target support. |
| [v0.2.0](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.0) | 2026-09-10 | Added server-password prompts, formal relay mode, multiple relay selection, and administrator connection-reason reporting. |
| [v0.1.8](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.8) | 2026-09-08 | Simplified Docker deployment, supported local TeamSpeak targets, added a 15-second connection timeout, and made network monitoring continuous. |
| [v0.1.7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.7) | 2026-09-06 | Added German, Telegram, network performance, and master-volume features; fixed accompaniment volume fluctuation. |
| [v0.1.6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.6) | 2026-09-04 | Added desktop accompaniment, remembered-identity guidance, and the site icon; fixed WebRTC member volume. |
| [v0.1.5](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.5) | 2026-09-04 | Fixed identity persistence and refined the theme toggle. |
| [v0.1.4](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.4) | 2026-09-03 | Fixed WebRTC and channel chat and refined administration, logs, and mobile layouts. |
| [v0.1.3](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.3) | 2026-09-03 | Added bundled WebRTC, migrated the TeamSpeak SDK, and improved member synchronization and voice buffering. |

See the complete history in [CHANGELOG.md](../CHANGELOG.md).

## 🚀 Deployment

| Method | Best for | Environment |
| --- | --- | --- |
| Docker Compose (recommended) | Long-running servers, simple upgrades, and persistent data | Docker Engine + Docker Compose |
| Release package | Running without Node.js or build dependencies | Windows x64 or Linux x64 |
| From source | Development, debugging, and customization | Node.js 22.5+, Git, and native build tools |

### Docker Compose (recommended)

```bash
git clone --depth 1 https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
docker compose pull
docker compose up -d
```

Open `http://<your-host>:3040` after startup. If using a reverse proxy, point it to that address. When WebRTC is enabled, allow the UDP range shown in the administration console. Data is stored in the `webspeak-data` volume.

```bash
docker compose ps
docker compose logs -f webspeak
```

Upgrade:

```bash
git pull --ff-only
docker compose pull
docker compose up -d
```

Do not run `docker compose down -v`; it removes the database and administrator settings.

### Release package

Download the matching `windows-x64.zip` or `linux-x64.tar.gz` from [GitHub Releases](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest), extract it into a dedicated directory, and run `start-webspeak.cmd` on Windows or `./start-webspeak.sh` on Linux. Packages include the Node.js runtime and production dependencies.

### From source

```bash
git clone https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
npm ci --ignore-scripts
npm run prepare:sdk
npm rebuild @discordjs/opus --foreground-scripts
npm --prefix web ci
npm --prefix web run build
npm run build
npm start
```

Building `@discordjs/opus` requires Python, Make, and a C/C++ toolchain.

### First-time setup

1. Open `http://<your-host>:3040/admin`.
2. Sign in with `admin` / `admin` and immediately set a new password of at least 12 characters.
3. Configure the TeamSpeak target and access mode under **Servers**, for example `voice.example.com#9987`.
4. Configure HTTPS for public access; when WebRTC is enabled, allow the UDP range shown in the console.

## ⚠️ Requirements and notes

| Area | Requirement or note |
| --- | --- |
| Browser | Use a current Chrome, Edge, or other modern browser with WebRTC support. Microphone and window audio normally require HTTPS. |
| TeamSpeak network | The WebSpeak host must reach the target TeamSpeak server; the default voice port is `9987`. |
| Web network | The service uses `3040/TCP`; public deployments should expose the page and WebSocket through an HTTPS reverse proxy. |
| IPv6 | Write literal targets as `[2001:db8::1]#9987`. The host/container needs routed IPv6, IPv6 enabled in the OS and Node.js, and the relevant firewall rules. |
| WebRTC | The default range is `40000–40099/UDP`; allow it and disable WebRTC before changing the range. |
| Remembered identity | One browser identity can hold one active remembered connection. Disable it for parallel connections or use another browser profile. |
| Accompaniment | Desktop only and requires WebRTC. Enable audio sharing when selecting a window or tab. |
| Data | Docker data is in `webspeak-data`; release packages and source installs use `data/`. Back up before upgrades. |
| Session limit | One instance accepts up to 100 active browser sessions. |
