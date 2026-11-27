# Cloudflare Tunnel for WebSpeak

Cloudflare Tunnel publishes the WebSpeak **HTTPS/WSS** entry without opening a
public inbound port. It does **not** carry WebRTC media UDP, and it does not
make the gateway's `40000–40099/UDP` range reachable.

## Setup

1. Create a tunnel in the Cloudflare dashboard and copy its UUID and
   credentials JSON.
2. Copy `config.yml.example` to `config.yml` and replace the UUID and
   hostname. Rename the downloaded credentials file to
   `REPLACE_WITH_TUNNEL_UUID.json`, or update the credentials path and Compose
   mount to match its actual name. Point `service` at the WebSpeak HTTP listener
   (`3040` by default).
3. Run cloudflared on the host (recommended on Windows/macOS):

   ```bash
   cloudflared tunnel --config config.yml run
   ```

   On Linux, `docker compose up -d` in this directory can run it in host mode.
4. In WebSpeak administration, set **Public media address** to the gateway's
   public IP (for example `192.0.2.10`), not the Cloudflare hostname.
   Allow `40000–40099/UDP` on the host firewall and security group.
5. Keep `WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY=all` so browsers try direct UDP
   first. `WEBSPEAK_VOICE_PROFILE=auto` is the default: requests from a trusted
   Cloudflare hop use the adaptive audio path, while other requests keep the
   legacy path. The default trusted proxy list contains loopback only; if
   cloudflared connects from another address, add that IP/CIDR to
   `WEBSPEAK_TRUSTED_PROXIES`. Headers injected by a direct untrusted client are
   ignored. Configure TURN only as the fallback for mobile networks or
   UDP-blocked clients; see `deploy/coturn`.
6. Opus over WebSocket is opt-in. It requires an adaptive profile and either
   the Admin → Voice setting or `WEBSPEAK_VOICE_OPUS_WS=1`; without it the
   browser uses PCM.

## Why not use the Cloudflare hostname as the media address?

A Cloudflare-proxied hostname resolves to Cloudflare edge addresses. Those
edges do not forward the gateway's UDP media ports, so using them as ICE
candidates produces a path that looks configured but cannot carry audio.
WebSpeak therefore no longer infers the request `Host` as an ICE address when
the request arrives through a trusted Cloudflare hop and no media host was
configured. Without a public media address or TURN, the server reports
`NO_MEDIA_PATH` and, because WebRTC was not advertised, the browser uses the
compatibility transport. If an advertised WebRTC connection later fails, the
browser stays in the session with `WEBRTC_FAILED` and offers WebRTC reconnect;
it does not silently switch to compatibility transport.

## Verify

- `curl -I https://voice.example.com` succeeds through the tunnel.
- `chrome://webrtc-internals` shows host/srflx candidates to the public IP and,
  when UDP is available, a direct selected pair.
- If the selected pair is `relay`, confirm TURN is reachable and that direct
  UDP is actually blocked; do not switch the global policy to `relay` just
  because the page is behind a Tunnel.

For the full voice rollout and rollback notes, see
[`docs/CLOUDFLARE_TUNNEL_VOICE.md`](../../docs/CLOUDFLARE_TUNNEL_VOICE.md).

This template has not been exercised end-to-end with a live coturn/Tunnel
deployment. Browser Opus fallback, especially on Safari and Firefox, also
requires device testing.
