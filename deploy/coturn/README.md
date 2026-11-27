# WebSpeak TURN (coturn) deployment

TURN is a **fallback** for voice media when a browser cannot reach the WebSpeak
gateway over UDP, for example on mobile networks or networks that block UDP.
It is not required for the normal direct UDP path.

## 1. Configure

```bash
cp .env.example .env
# Generate a secret and put the same value in WEBSPEAK_TURN_REST_SECRET:
openssl rand -hex 32
```

Set `TURN_EXTERNAL_IP` to the host's public IPv4. If the host is behind 1:1
NAT, use `PUBLIC/PRIVATE` (for example `203.0.113.10/10.0.0.5`). The relay
range `49160–49200/UDP` is separate from WebSpeak's WebRTC range
`40000–40099/UDP`; do not reuse the WebRTC range.

## 2. Start and expose

```bash
docker compose --env-file .env up -d
docker compose logs -f coturn
```

Allow inbound:

- `3478/UDP` and `3478/TCP` for `turn:`
- `49160–49200/UDP` for relayed media
- `5349/TCP` only if you add TLS certificates for `turns:`

Do **not** put the TURN relay range behind Cloudflare Tunnel; Cloudflare Tunnel
does not carry this UDP traffic.

## 3. Connect WebSpeak

Use the same secret as coturn's `static-auth-secret`:

```bash
WEBSPEAK_TURN_REST_URLS='turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp'
WEBSPEAK_TURN_REST_SECRET='<same value as TURN_SECRET>'
WEBSPEAK_TURN_REST_TTL_SECONDS=21600
# Keep direct UDP first. Use "relay" only where UDP is known to be blocked.
WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY=all
# Auto keeps direct and untrusted-proxy traffic on the legacy audio path.
WEBSPEAK_VOICE_PROFILE=auto
```

TURN does not require Opus; `WEBSPEAK_VOICE_OPUS_WS` remains off by default.

`WEBSPEAK_TURN_REST_URLS` accepts only `turn:`/`turns:` URL tokens. For static
ICE credentials, use `WEBSPEAK_VOICE_ICE_SERVERS` with a JSON array of ICE
server objects instead. WebSpeak generates short-lived `username`/`credential`
pairs with HMAC-SHA1, compatible with coturn's `use-auth-secret`.

## 4. Verify

From a network that blocks direct UDP, open the voice page and check:

- `chrome://webrtc-internals` (Chrome/Edge) or `about:webrtc` (Firefox)
- The selected candidate pair should become `relay` only when direct UDP fails.
- `WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY=all` must not be changed to `relay`
  merely because a Tunnel is in front of HTTPS.

If TURN succeeds but audio still stutters, check whether the connection's
`voiceProfile` is `adaptive`; on a direct or legacy profile the old 80 ms
compatibility window is expected. TURN reachability alone does not enable the
adaptive jitter buffer.

## Security notes

- Keep the secret out of shell history, process listings where possible, and
  git. Prefer an `.env` file with restrictive permissions.
- The compose file denies private, loopback and link-local peer ranges to
  reduce abuse. If the WebSpeak gateway itself is on a private address, add a
  narrowly scoped `--allowed-peer-ip` for that address and review the risk.
- This template has no TLS listener. Add certificates and a `turns:` URL only
  when you need TURN over TLS on `5349/TCP`; test certificate renewal.
- This template has not been exercised end-to-end with a live Tunnel and
  browser deployment; validate TURN reachability and credentials in the target
  network before relying on it.
