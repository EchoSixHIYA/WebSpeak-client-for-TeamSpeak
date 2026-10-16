import assert from "node:assert/strict";
import test from "node:test";
import { createSocket } from "node:dgram";
import pino from "pino";
import { RTCPeerConnection, useOPUS, usePCMU, type RtpPacket } from "werift";
import { OpusEncoder } from "./opus-codec.js";
import { WebRtcAudioSession } from "./webrtc-audio.js";

test("configured STUN is actually queried and contributes srflx candidates", async t => {
  const stun = createSocket("udp4");
  await new Promise<void>(resolve => stun.bind(0, "127.0.0.1", resolve));
  t.after(() => stun.close());
  let requests = 0;
  stun.on("message", (request, remote) => {
    if (request.length < 20 || request.readUInt16BE(0) !== 1) return;
    requests++;
    const response = Buffer.alloc(32);
    response.writeUInt16BE(0x0101, 0);
    response.writeUInt16BE(12, 2);
    request.copy(response, 4, 4, 20);
    response.writeUInt16BE(0x0020, 20); // XOR-MAPPED-ADDRESS
    response.writeUInt16BE(8, 22);
    response[25] = 1;
    response.writeUInt16BE(remote.port ^ 0x2112, 26);
    remote.address.split(".").map(Number).forEach((octet, index) => { response[28 + index] = octet ^ request[4 + index]!; });
    stun.send(response, remote.port, remote.address);
  });
  const session = new WebRtcAudioSession({ connectionId: "configured-ice", logger: pino({ enabled: false }),
    stunServer: `stun:127.0.0.1:${stun.address().port}`, ipv6Enabled: true, publicAddresses: ["127.0.0.1"],
    onVoiceFrame() {}, onVoiceActivity() {} });
  const source = new RTCPeerConnection({ iceServers: [], codecs: { audio: [useOPUS()] } });
  t.after(async () => { await session.close(); await source.close(); });
  source.addTransceiver("audio", { direction: "sendrecv" });
  const offer = await source.createOffer();
  const answer = await session.createAnswer({ type: "offer", sdp: offer.sdp });
  assert.ok(requests > 0);
  assert.match(answer.sdp, / typ srflx /);
  assert.equal(session.peer.iceTransports[0]!.connection.options.useIpv6, true);
});

test("WebRTC rejects an offer without negotiated audio instead of returning an empty answer", async t => {
  const session = new WebRtcAudioSession({ connectionId: "invalid-offer", logger: pino({ enabled: false }), onVoiceFrame() {}, onVoiceActivity() {} });
  t.after(() => session.close());
  await assert.rejects(session.createAnswer({ type: "offer", sdp: "invalid sdp" }), /did not negotiate Opus audio/);
});

for (const scenario of ["PCMU only", "Opus only", "PCMU before Opus"] as const) {
  test(`WebRTC negotiates only supported audio with ${scenario}`, async t => {
    const codecs = scenario === "PCMU only" ? [usePCMU()]
      : scenario === "Opus only" ? [useOPUS({ payloadType: 109 })]
      : [usePCMU(), useOPUS({ payloadType: 109 })];
    const source = new RTCPeerConnection({ iceServers: [], codecs: { audio: codecs } });
    const session = new WebRtcAudioSession({ connectionId: scenario, logger: pino({ enabled: false }), onVoiceFrame() {}, onVoiceActivity() {} });
    t.after(async () => { await session.close(); await source.close(); });
    source.addTransceiver("audio", { direction: "sendrecv" });
    const offer = await source.createOffer();
    if (scenario === "PCMU only") {
      await assert.rejects(session.createAnswer({ type: "offer", sdp: offer.sdp }));
      return;
    }
    const answer = await session.createAnswer({ type: "offer", sdp: offer.sdp });
    assert.equal(answer.type, "answer");
    assert.match(answer.sdp, /a=rtpmap:109 opus\/48000\/2/i);
    assert.doesNotMatch(answer.sdp, /PCMU/i);
    const audio = session.peer.getTransceivers().find(transceiver => transceiver.kind === "audio")!;
    assert.deepEqual(audio.codecs.map(codec => codec.payloadType), [109]);
  });
}

function rms(pcm: Buffer): number {
  let energy = 0;
  for (let index = 0; index < pcm.length; index += 2) energy += pcm.readInt16LE(index) ** 2;
  return Math.sqrt(energy / (pcm.length / 2));
}

for (const scenario of ["silence gaps", "alternating speakers", "volume changes"] as const) {
  test(`WebRTC output preserves audible Opus across ${scenario}`, async t => {
    const session = new WebRtcAudioSession({ connectionId: scenario, logger: pino({ enabled: false }), onVoiceFrame() {}, onVoiceActivity() {} });
    const source = [new OpusEncoder(48000, 1), new OpusEncoder(48000, 1)];
    const receiver = new OpusEncoder(48000, 1);
    t.after(async () => { source.forEach(codec => codec.dispose()); receiver.dispose(); await session.close(); });
    // Advance the real mixer explicitly so network/timer jitter cannot hide
    // codec-state discontinuities. Encoding and decoding remain native Opus.
    const mixer = session as unknown as {
      audioTimer: ReturnType<typeof setTimeout>; activityTimer: ReturnType<typeof setInterval>;
      outgoingTrack: { writeRtp(packet: RtpPacket): void }; mixAndSendAudio(): void;
    };
    clearTimeout(mixer.audioTimer);
    clearInterval(mixer.activityTimer);
    let level = 0;
    mixer.outgoingTrack.writeRtp = packet => { level = rms(receiver.decode(packet.payload)); };
    for (let tick = 0; tick < 50; tick++) mixer.mixAndSendAudio();
    for (let frame = 0; frame < 50; frame++) {
      const speaker = scenario === "alternating speakers" ? frame % 2 : 0;
      const gain = scenario === "volume changes" && frame % 2 === 1 ? 0.5 : 1;
      session.setMemberVolume(speaker + 2, gain);
      const pcm = Buffer.alloc(1920);
      const frequency = speaker === 0 ? 660 : 440;
      for (let sample = 0; sample < 960; sample++) pcm.writeInt16LE(Math.round(1800 * Math.sin(2 * Math.PI * frequency * (frame * 960 + sample) / 48000)), sample * 2);
      session.pushTeamSpeakVoice({ clientId: speaker + 2, codec: 4, data: source[speaker]!.encode(pcm) });
      mixer.mixAndSendAudio();
      assert.ok(level > 500 * gain, `${scenario}, frame ${frame}: unexpectedly quiet RMS ${level}`);
      if (scenario === "silence gaps") mixer.mixAndSendAudio();
    }
    const stats = session.getStats();
    assert.equal(stats.webrtcDownlinkDecodedFrames, 50);
    assert.equal(stats.webrtcDownlinkDecodeErrors, 0);
    assert.equal(stats.webrtcQueueDroppedFrames, 0);
  });
}

function fixture() {
  const released: string[] = [];
  // Exercise the real close path with failures at codec/track/peer boundaries.
  const resources = {
    closed: false, closePromise: null, audioTimer: null, activityTimer: undefined,
    pendingFrames: new Map([[1, []]]), memberVolumes: new Map([[1, 1]]),
    partialPcmByClient: new Map([[1, Buffer.alloc(2)]]), activeSpeakerIds: new Set([1]),
    decoderByClient: new Map([
      [1, { dispose() { released.push("decoder-1"); throw new Error("Decoder failed"); } }],
      [2, { dispose() { released.push("decoder-2"); } }],
    ]),
    encoder: { dispose(): void { released.push("encoder"); throw new Error("Encoder failed"); } },
    outgoingTrack: { stop(): void { released.push("track"); throw new Error("Track failed"); } },
    peer: { async close() { released.push("peer"); } },
  };
  const session = Object.assign(Object.create(WebRtcAudioSession.prototype), resources) as WebRtcAudioSession;
  return { session, resources, released };
}

test("WebRTC close releases remaining codecs, track and peer after disposal failures", async () => {
  const f = fixture();
  await f.session.close();
  await f.session.close();
  assert.deepEqual(f.released, ["decoder-1", "decoder-2", "encoder", "track", "peer"]);
  assert.equal(f.resources.decoderByClient.size, 0);
  assert.equal(f.resources.pendingFrames.size, 0);
  assert.equal(f.resources.memberVolumes.size, 0);
  assert.equal(f.resources.partialPcmByClient.size, 0);
  assert.equal(f.resources.activeSpeakerIds.size, 0);
});

test("concurrent WebRTC close callers await the same pending peer shutdown", async () => {
  const f = fixture();
  f.resources.decoderByClient.clear();
  f.resources.encoder.dispose = () => {};
  f.resources.outgoingTrack.stop = () => {};
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let closes = 0;
  f.resources.peer.close = async () => { closes++; await pending; };
  const first = f.session.close();
  let secondCompleted = false;
  const second = f.session.close().then(() => { secondCompleted = true; });
  await Promise.resolve();
  const completedEarly = secondCompleted;
  release();
  await Promise.all([first, second]);
  assert.equal(completedEarly, false);
  assert.equal(closes, 1);
});

test("a rejected peer shutdown is shared without repeating partial cleanup", async () => {
  const f = fixture();
  const failure = new Error("Peer shutdown failed");
  f.resources.peer.close = async () => { f.released.push("peer"); throw failure; };
  const first = f.session.close();
  const second = f.session.close();
  assert.equal(first, second);
  await assert.rejects(first, error => error === failure);
  await assert.rejects(second, error => error === failure);
  await assert.rejects(f.session.close(), error => error === failure);
  assert.deepEqual(f.released, ["decoder-1", "decoder-2", "encoder", "track", "peer"]);
  assert.equal(f.resources.decoderByClient.size, 0);
});

test("an unavailable mixer encoder closes the half-built peer before the constructor throws", () => {
  // The constructor never returns when the codec is missing, so the caller's
  // `peer?.close()` is a no-op. Instrument the prototype to observe that the
  // rollback happens inside the constructor instead. Count distinct peers:
  // werift re-enters close() on the same instance while tearing ICE down.
  const originalClose = RTCPeerConnection.prototype.close;
  const closedPeers = new Set<RTCPeerConnection>();
  RTCPeerConnection.prototype.close = function patchedClose(this: RTCPeerConnection): Promise<void> {
    closedPeers.add(this);
    return originalClose.call(this);
  };
  try {
    assert.throws(
      () => new WebRtcAudioSession({
        connectionId: "encoder-unavailable",
        logger: pino({ enabled: false }),
        createEncoder: () => { throw new Error("Opus codec is unavailable"); },
        onVoiceFrame() {},
        onVoiceActivity() {},
      }),
      /WebRTC Opus codec is unavailable/,
    );
  } finally {
    RTCPeerConnection.prototype.close = originalClose;
  }
  assert.equal(closedPeers.size, 1, "the constructor must roll back the peer it already created");
});
