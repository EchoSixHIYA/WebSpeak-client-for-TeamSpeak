# WebSpeak — TeamSpeak Browser Gateway

Server-side bridge that lets users join TeamSpeak voice channels from a browser. No TS client install needed.

## Architecture

```
Browser (PCM capture) → WebSocket → Node.js server (PCM→Opus) → TeamSpeak server
Browser (playback)    ← WebSocket ← Node.js server (Opus relay) ← TeamSpeak server
```

- Each browser user = one independent TS3 virtual client via `@echosixhiya/teamspeak-client`
- Frontend captures PCM via `ScriptProcessorNode`, sends as Int16 binary over WebSocket
- Server encodes PCM → Opus using `@discordjs/opus` (CJS, loaded via `createRequire`)
- Server sends Opus to TS via `client.sendVoice(data, codec=4)`
- Incoming TS voice → Opus frames → binary WebSocket → browser `AudioDecoder` → playback
- Channel/member list fetched via TS6 WebQuery HTTP API (port 10080, requires API key)
- WebSocket text frames = JSON commands, binary frames = PCM audio / Opus relay

## Project Structure

```
web/                         # Vue 3 + Vite frontend (SPA)
  src/composables/useVoiceWebSocket.ts  # Mic capture, VOX/PTT, playback, WS client
  src/views/WebClient.vue               # Connect form + channel/member tree
src/
  index.ts                    # Entry point, config loading, server startup
  config.ts                   # AppConfig interface + load/save
  logger.ts                   # Pino wrapper
  server/
    server.ts                 # Express + HTTPS + WS setup
    voice-bridge.ts           # /ws/voice endpoint, PCM→Opus encoding, WebQuery API
    ts-client.ts              # TS3Client wrapper around @echosixhiya/teamspeak-client
```

## Key Technical Details

### Audio Pipeline
1. Browser mic → `getUserMedia` (48kHz mono) → `ScriptProcessorNode` (1024 samples)
2. Float32 → Int16 conversion → PTT/VOX gate → WebSocket binary send
3. Server accumulates PCM → every 1920 bytes (960 samples, 20ms) → `OpusEncoder.encode()` → `tsClient.sendVoice(opus, 4)`
4. Incoming: TS → `voiceData` event → 3-byte header `[codec][clientId BE]` → WS binary → browser `AudioDecoder` → playback
5. Browser uplink is capped at 10 PCM frames (about 200ms); gateway egress applies a bounded WebSocket byte guard; browser playback resets stale decoder/source queues above 120ms.

Audio flow counters are kept in memory and exposed in admin session summaries. Do not add per-frame persistent logging to the voice path.

### CJS Interop
`@discordjs/opus` is CommonJS, loaded via:
```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { OpusEncoder } = require("@discordjs/opus");
```

### WebSocket Message Routing
- Text frames → JSON commands (`listChannels`, `switchChannel`)
- Binary frames → PCM audio (browser→server) or Opus frames (server→browser)
- JSON detection: `typeof data === "string"` first, then fallback `data[0] === 0x7b` with try/catch

### Event Handlers
Must be registered BEFORE `tsClient.connect()` because `clientEnter`/`clientLeave` fire during handshake.

### Channel List
Uses TS6 WebQuery HTTP API (`http://tsHost:tsQueryPort/1/channellist`) with `x-api-key` header. Falls back empty if `tsApiKey` not configured. Regular TS3 voice clients lack permission for `listChannels`/`listClients`.

### Config (config.json)
```json
{
  "port": 3040, "tsHost": "127.0.0.1", "tsPort": 9987,
  "tsQueryPort": 10080, "tsServerProtocol": "ts6",
  "tsApiKey": "", "voiceToken": "change-me", "maxClients": 10
}
```

## Build & Deploy
```bash
npm install && cd web && npm install && npx vite build && cd .. && npx tsc
node dist/index.js
```

## Git
- Remote: `https://github.com/EchoSixHIYA/web-client-for-TeamSpeak`
- `webspeak-update.tar.gz` is in .gitignore (deployment artifact)
- No secrets in source; config.json is gitignored

## Known Limitations
- Browser must be Chrome/Edge 94+ (WebCodecs AudioDecoder)
- HTTPS required (self-signed cert OK, generated in `certs/`)
- Max 32 concurrent users (TS3 license limit)
- `tsApiKey` required for channel list; voice works without it
