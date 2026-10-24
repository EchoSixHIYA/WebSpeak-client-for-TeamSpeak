import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { IncomingMessage } from "node:http";
import pino from "pino";
import { VoiceBridge, createTrustedProxies, resolveClientIp, resolveWebRtcPublicHost } from "./voice-bridge.js";
import { JoinTicketStore } from "./join-ticket.js";
import { createAudioFlowStats } from "./audio-stats.js";
import { SessionAudioTransport } from "./session-audio.js";
import type { WebRtcAudioSession, WebRtcAudioSessionOptions, WebRtcSessionDescription } from "./webrtc-audio.js";
import type { ServerMessage } from "../shared/server-messages.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class PeerStub {
  closed = false;
  closeResult = Promise.resolve();
  answerResult = Promise.resolve();
  constructor(readonly options: WebRtcAudioSessionOptions) {}
  async close() { this.closed = true; await this.closeResult; }
  getStats() { return { webrtcIngressRtpFrames: 10 }; }
  pushTeamSpeakVoice() {}
  async createAnswer(offer: WebRtcSessionDescription): Promise<WebRtcSessionDescription> {
    await this.answerResult;
    return { type: "answer", sdp: offer.sdp };
  }
}

function fixture(webRtc = { enabled: true } as import("./webrtc-audio.js").WebRtcAudioOptions) {
  const peers: PeerStub[] = [];
  const messages: ServerMessage[] = [];
  const entry = {
    id: "session", session: { state: "connected" }, ws: { readyState: 1 as 0 | 1 | 2 | 3, bufferedAmount: 0, send() {} },
    webrtc: null as PeerStub | null, webrtcGeneration: 0,
    tsClient: { isConnected: () => true, setInputMuted: async (_muted: boolean) => {}, setAccompanimentActive: async (_active: boolean) => {}, sendVoice: () => { forwarded++; }, sendWhisper: () => { forwarded++; } },
    whisperActive: false, whisperTargetIds: new Set<number>(), audio: createAudioFlowStats(),
    audioTransport: null as SessionAudioTransport | null,
  };
  let forwarded = 0;
  let configurePeer = (_peer: PeerStub): void => {};
  const instance = new VoiceBridge({ joinTickets: new JoinTicketStore(), webRtc }, pino({ enabled: false }), options => {
    const peer = new PeerStub(options);
    peers.push(peer);
    configurePeer(peer);
    return peer as unknown as WebRtcAudioSession;
  });
  // Exercise the bridge's orchestration itself, replacing only SDK/WebRTC I/O.
  type Entry = typeof entry;
  const bridge = instance as unknown as {
    entries: Map<string, Entry>;
    handleWebRtcOffer(entry: Entry, offer: WebRtcSessionDescription, send: (message: ServerMessage) => void): Promise<void>;
    stopWebRtc(entry: Entry): Promise<void>;
  };
  bridge.entries.set(entry.id, entry);
  entry.audioTransport = new SessionAudioTransport({
    audio: entry.audio, socket: entry.ws, client: entry.tsClient,
    isCurrent: () => bridge.entries.get(entry.id) === entry,
    isReady: () => entry.session.state === "connected", selfId: () => 1,
    peer: () => entry.webrtc, whisperTargets: () => null, sendJson: message => messages.push(message),
  }, { encode: frame => frame, dispose() {} });
  const offer = (sdp: string) => bridge.handleWebRtcOffer(entry, { type: "offer", sdp }, message => messages.push(message));
  return { bridge, entry, peers, messages, offer, forwarded: () => forwarded, configure: (callback: typeof configurePeer) => { configurePeer = callback; } };
}

test("an offer waiting on the SDK cannot create a peer after its session is removed", async () => {
  const f = fixture();
  const mute = deferred();
  f.entry.tsClient.setInputMuted = () => mute.promise;
  const pending = f.offer("old");
  // Allow the operation to reach the SDK boundary before teardown wins.
  await Promise.resolve();
  f.bridge.entries.delete(f.entry.id);
  f.entry.session.state = "disconnecting";
  f.entry.ws.readyState = 3;
  mute.resolve();
  await pending;
  assert.equal(f.peers.length, 0);
});

test("a newer offer wins while the old offer waits for its mute update", async () => {
  const f = fixture();
  const mute = deferred();
  f.entry.tsClient.setInputMuted = () => mute.promise;
  const old = f.offer("old");
  await Promise.resolve();
  f.entry.tsClient.setInputMuted = async () => {};
  await f.offer("new");
  const current = f.entry.webrtc;
  mute.resolve();
  await old;
  assert.equal(f.entry.webrtc, current);
  assert.equal(f.peers.length, 1);
  assert.deepEqual(f.messages.filter(message => message.type === "webrtcAnswer").map(message => message.payload.sdp.sdp), ["new"]);
});

test("closing an older peer cannot clear or overwrite a newer offer", async () => {
  const f = fixture();
  await f.offer("initial");
  const closing = deferred();
  f.peers[0]!.closeResult = closing.promise;
  const old = f.offer("old");
  await Promise.resolve();
  const newer = f.offer("new");
  closing.resolve();
  await Promise.all([old, newer]);
  assert.equal(f.peers.length, 2);
  assert.equal(f.entry.webrtc, f.peers[1]);
  assert.deepEqual(f.messages.filter(message => message.type === "webrtcAnswer").map(message => message.payload.sdp.sdp), ["initial", "new"]);
});

test("a superseded answer failure cannot send an error for the current offer", async () => {
  const f = fixture();
  const answer = deferred();
  f.configure(peer => { if (f.peers.length === 1) peer.answerResult = answer.promise; });
  const old = f.offer("old");
  await nextTurn();
  await f.offer("new");
  const current = f.entry.webrtc;
  answer.reject(new Error("old peer closed"));
  await old;
  assert.equal(f.entry.webrtc, current);
  assert.equal(current?.closed, false);
  assert.equal(f.messages.some(message => message.type === "webrtcError"), false);
});

test("a replaced peer cannot forward late audio or activity into the current session", async () => {
  const f = fixture();
  await f.offer("old");
  const old = f.peers[0]!;
  await f.offer("new");
  old.options.onVoiceFrame(Buffer.from([1, 2, 3]), 4);
  old.options.onVoiceActivity([7]);
  assert.equal(f.forwarded(), 0);
  assert.equal(f.entry.audio.ingressFrames, 0);
  assert.equal(f.messages.some(message => message.type === "voiceActivity"), false);
  f.peers[1]!.options.onVoiceFrame(Buffer.from([4, 5, 6]), 4);
  assert.equal(f.forwarded(), 1);
});

test("stop invalidates an offer before the first peer has been created", async () => {
  const f = fixture();
  const mute = deferred();
  f.entry.tsClient.setInputMuted = () => mute.promise;
  const pending = f.offer("pending");
  await Promise.resolve();
  await f.bridge.stopWebRtc(f.entry);
  mute.resolve();
  await pending;
  assert.equal(f.entry.webrtc, null);
  assert.equal(f.peers.length, 0);
  assert.deepEqual(f.messages, []);
});

test("a current peer construction failure reports a recoverable negotiation error", async () => {
  const f = fixture();
  f.configure(() => { throw new Error("codec unavailable"); });
  await f.offer("current");
  assert.equal(f.entry.webrtc, null);
  assert.deepEqual(f.messages, [{ type: "webrtcError", code: "WEBRTC_NEGOTIATION_FAILED" }]);
});

test("WebRTC candidates use the voice gateway host when the page Origin belongs to another gateway", () => {
  const request = {
    headers: {
      origin: "https://ingress.example.com",
      host: "voice-relay.example.com:3041",
    },
  } as IncomingMessage;
  assert.equal(resolveWebRtcPublicHost(request), "voice-relay.example.com");
});

test("initial accompaniment updates TeamSpeak before creating a muted mixer and resets on stop", async () => {
  const f = fixture();
  const inputs: Array<[string, boolean]> = [];
  f.entry.tsClient.setInputMuted = async muted => { inputs.push(["muted", muted]); };
  f.entry.tsClient.setAccompanimentActive = async active => { inputs.push(["music", active]); };
  await f.bridge.handleWebRtcOffer(f.entry, { type: "offer", sdp: "audio", muted: true, accompanimentActive: true }, message => f.messages.push(message));
  assert.deepEqual(inputs, [["music", false], ["muted", true], ["music", true]]);
  assert.equal(f.peers[0]?.options.microphoneMuted, true);
  assert.equal(f.peers[0]?.options.accompanimentActive, true);
  await f.bridge.stopWebRtc(f.entry);
  assert.deepEqual(inputs.at(-1), ["music", false]);
});

test("stopping during accompaniment synchronization restores input even without a peer", async () => {
  const f = fixture();
  const waiting = deferred();
  const inputs: boolean[] = [];
  f.entry.tsClient.setAccompanimentActive = async active => { inputs.push(active); if (active) await waiting.promise; };
  const offer = f.bridge.handleWebRtcOffer(f.entry, { type: "offer", sdp: "audio", muted: true, accompanimentActive: true }, message => f.messages.push(message));
  await nextTurn();
  assert.deepEqual(inputs, [false, true]);
  await f.bridge.stopWebRtc(f.entry);
  waiting.resolve();
  await offer;
  assert.deepEqual(inputs, [false, true, false]);
  assert.equal(f.peers.length, 0);
  assert.deepEqual(f.messages, []);
});

test("old close statistics cannot overwrite a new peer's live snapshot", async () => {
  const f = fixture();
  await f.offer("old");
  const closing = deferred();
  f.peers[0]!.closeResult = closing.promise;
  const stopped = f.bridge.stopWebRtc(f.entry);
  await f.offer("new");
  f.entry.audio.webrtcIngressRtpFrames = 27;
  closing.resolve();
  await stopped;
  assert.equal(f.entry.audio.webrtcIngressRtpFrames, 27);
  assert.equal(f.entry.webrtc, f.peers[1]);
});


test("configured media address overrides the proxy host and passes IPv6/STUN to the session", async () => {
  const f = fixture({ enabled: true, publicHost: "2001:db8::42", ipv6Enabled: true, stunServer: "stun:stun.example.com:3478" });
  Object.assign(f.entry, { webrtcPublicHost: "proxy.example.invalid" });
  await f.offer("configured");
  assert.deepEqual(f.peers[0].options.publicAddresses, ["2001:db8::42"]);
  assert.equal(f.peers[0].options.ipv6Enabled, true);
  assert.equal(f.peers[0].options.stunServer, "stun:stun.example.com:3478");
});

test("an unset media override still uses a literal request host", async () => {
  const f = fixture();
  Object.assign(f.entry, { webrtcPublicHost: "192.0.2.10" });
  await f.offer("legacy");
  assert.deepEqual(f.peers[0].options.publicAddresses, ["192.0.2.10"]);
});

function ipRequest(remoteAddress: string | undefined, headers: Record<string, string> = {}): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

test("a direct client cannot choose the address recorded for it", () => {
  const trusted = createTrustedProxies(["127.0.0.1"]);
  assert.equal(resolveClientIp(ipRequest("192.0.2.7", { "x-forwarded-for": "203.0.113.9" }), trusted), "192.0.2.7");
  assert.equal(resolveClientIp(ipRequest("192.0.2.7", { "x-real-ip": "203.0.113.9" }), trusted), "192.0.2.7");
  assert.equal(
    resolveClientIp(ipRequest("::ffff:192.0.2.7", { "x-forwarded-for": "203.0.113.9" }), trusted),
    "192.0.2.7",
    "an IPv4 peer arrives in mapped form and is still the address we must record",
  );
});

test("a trusted proxy chain is read from our side towards the client", () => {
  const trusted = createTrustedProxies(["127.0.0.1", "::1", "10.0.0.0/8", "2001:db8::/32"]);
  // The proxy appended the peer it accepted, so a value the client injected to
  // its left is never the address we record.
  assert.equal(
    resolveClientIp(ipRequest("127.0.0.1", { "x-forwarded-for": "203.0.113.9, 198.51.100.4" }), trusted),
    "198.51.100.4",
  );
  // Both hops are trusted, so keep walking towards the client.
  assert.equal(
    resolveClientIp(ipRequest("127.0.0.1", { "x-forwarded-for": "203.0.113.9, 10.1.2.3" }), trusted),
    "203.0.113.9",
  );
  // The same walk over IPv6: a trusted hop, then the client.
  assert.equal(
    resolveClientIp(ipRequest("::1", { "x-forwarded-for": "2001:db9::9, 2001:db8::5" }), trusted),
    "2001:db9::9",
  );
});

test("X-Real-IP is used only for a trusted single-hop proxy", () => {
  const trusted = createTrustedProxies(["127.0.0.1"]);
  assert.equal(resolveClientIp(ipRequest("127.0.0.1", { "x-real-ip": "203.0.113.9" }), trusted), "203.0.113.9");
  assert.equal(
    resolveClientIp(ipRequest("127.0.0.1", { "x-real-ip": "198.51.100.4", "x-forwarded-for": "203.0.113.9" }), trusted),
    "203.0.113.9",
    "the appended chain wins over the single-value header",
  );
});

test("an all-trusted chain reports the furthest address instead of inventing one", () => {
  const trusted = createTrustedProxies(["127.0.0.1"]);
  assert.equal(resolveClientIp(ipRequest("127.0.0.1", { "x-forwarded-for": "127.0.0.1" }), trusted), "127.0.0.1");
  assert.equal(resolveClientIp(ipRequest("127.0.0.1"), trusted), "127.0.0.1");
  assert.equal(resolveClientIp(ipRequest(undefined), trusted), "unknown");
});

test("unparseable forwarding values are dropped rather than recorded", () => {
  const trusted = createTrustedProxies(["127.0.0.1"]);
  assert.equal(resolveClientIp(ipRequest("127.0.0.1", { "x-forwarded-for": "not-an-ip" }), trusted), "127.0.0.1");
  assert.equal(
    resolveClientIp(ipRequest("127.0.0.1", { "x-forwarded-for": "not-an-ip, 203.0.113.9" }), trusted),
    "203.0.113.9",
  );
});

test("the default trust list is loopback only", () => {
  const trusted = createTrustedProxies(undefined);
  assert.equal(resolveClientIp(ipRequest("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }), trusted), "203.0.113.9");
  assert.equal(resolveClientIp(ipRequest("::1", { "x-forwarded-for": "203.0.113.9" }), trusted), "203.0.113.9");
  // A bridge address belongs to a proxy we have not been told about, so its
  // headers are ignored and the connection is logged from the proxy.
  assert.equal(resolveClientIp(ipRequest("172.17.0.1", { "x-forwarded-for": "203.0.113.9" }), trusted), "172.17.0.1");
});

test("a declared trusted proxy accepts CIDR and mapped forms", () => {
  const cidr = createTrustedProxies(["10.0.0.0/8", "fd00::/8"]);
  assert.equal(resolveClientIp(ipRequest("10.9.8.7", { "x-forwarded-for": "203.0.113.9" }), cidr), "203.0.113.9");
  assert.equal(resolveClientIp(ipRequest("fd00::7", { "x-forwarded-for": "2001:db8::9" }), cidr), "2001:db8::9");

  // Mapped entries are unwrapped, so they match both the plain and the
  // mapped form of the same peer address.
  const mapped = createTrustedProxies(["::ffff:192.0.2.1"]);
  assert.equal(resolveClientIp(ipRequest("192.0.2.1", { "x-forwarded-for": "203.0.113.9" }), mapped), "203.0.113.9");
  assert.equal(resolveClientIp(ipRequest("::ffff:192.0.2.1", { "x-forwarded-for": "203.0.113.9" }), mapped), "203.0.113.9");
});

test("an invalid trust list is rejected instead of silently ignored", () => {
  for (const entry of ["not-an-ip", "10.0.0.0/33", "fd00::/129", "10.0.0.0/x", "10.0.0.0/-1"]) {
    assert.throws(() => createTrustedProxies([entry]), /WEBSPEAK_TRUSTED_PROXIES/, entry);
  }
});

test("trusting every address has to be asked for explicitly", () => {
  const trusted = createTrustedProxies(["0.0.0.0/0", "::/0"]);
  assert.equal(resolveClientIp(ipRequest("192.0.2.7", { "x-forwarded-for": "203.0.113.9" }), trusted), "203.0.113.9");
});
