import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createScreenShareController } from "../src/voice/screen-share.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class Track extends EventTarget {
  kind = "video";
  readyState = "live";
  stop() { this.readyState = "ended"; }
  getSettings() { return { width: 1920, height: 1080, frameRate: 60 }; }
}
function stream() {
  const track = new Track();
  return { track, getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
}

class Peer {
  static instances: Peer[] = [];
  static offer = () => Promise.resolve({ type: "offer", sdp: "offer" });
  static stats = () => Promise.resolve(new Map());
  connectionState = "new";
  iceConnectionState = "new";
  localDescription: unknown;
  parameters: RTCRtpSendParameters | null = null;
  codecPreferences: RTCRtpCodecCapability[] = [];
  private readonly transceivers: Array<{
    sender: { track: { kind: string } | null };
    receiver: { track: { kind: string } | null };
    setCodecPreferences: (codecs: RTCRtpCodecCapability[]) => void;
  }> = [];
  closed = false;
  constructor(public configuration: RTCConfiguration) { Peer.instances.push(this); }
  createOffer() { return Peer.offer(); }
  createAnswer() { return Promise.resolve({ type: "answer", sdp: "answer" }); }
  setLocalDescription(description: unknown) { this.localDescription = description; return Promise.resolve(); }
  setRemoteDescription() { return Promise.resolve(); }
  addIceCandidate() { return Promise.resolve(); }
  addTransceiver(kind: string) {
    const transceiver = {
      sender: { track: null },
      receiver: { track: { kind } },
      setCodecPreferences: (codecs: RTCRtpCodecCapability[]) => { this.codecPreferences = codecs; },
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }
  addTrack(track: Track) {
    const sender = { track, getParameters: () => ({ encodings: [] }), setParameters: async (parameters: RTCRtpSendParameters) => { this.parameters = parameters; } };
    this.transceivers.push({
      sender,
      receiver: { track: null },
      setCodecPreferences: (codecs) => { this.codecPreferences = codecs; },
    });
    return sender;
  }
  getTransceivers() { return this.transceivers; }
  getStats() { return Peer.stats(); }
  close() { this.closed = true; this.connectionState = "closed"; }
}

let controller: ReturnType<typeof createScreenShareController>;
let sent: Array<{ type: string; requestId?: string }>;
const globals = new Map<string, PropertyDescriptor | undefined>();
function replaceGlobal(name: string, value: unknown) {
  globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
beforeEach(() => {
  Peer.instances = [];
  Peer.offer = () => Promise.resolve({ type: "offer", sdp: "offer" });
  Peer.stats = () => Promise.resolve(new Map());
  replaceGlobal("RTCPeerConnection", Peer);
  replaceGlobal("navigator", { mediaDevices: { getDisplayMedia: async () => stream() } });
  sent = [];
  controller = createScreenShareController({ isOpen: () => true, send: message => sent.push(message) });
});
afterEach(() => {
  controller.stopTransport(false);
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  globals.clear();
});

const remote = { streamId: "remote-1", ownerPeerId: "owner", ownerNickname: "Owner", name: "Screen", source: "browser" as const, audio: false, createdAt: 1, viewerCount: 0 };
function confirmStart(streamId: string, requestId = sent.findLast(message => message.type === "screenShareStart")?.requestId) {
  controller.handleMessage({ type: "screenShareStarted", owner: true, requestId, stream: { ...remote, streamId } });
}

test("cancelling a pending offer cannot send signaling or restore diagnostics after exit", async () => {
  const offer = deferred<{ type: string; sdp: string }>();
  const stats = deferred<Map<string, unknown>>();
  Peer.offer = () => offer.promise;
  Peer.stats = () => stats.promise;
  controller.handleMessage({ type: "screenShareJoined", stream: remote });
  controller.stopTransport(false);
  offer.resolve({ type: "offer", sdp: "obsolete" });
  stats.resolve(new Map());
  await nextTurn();
  assert.equal(Peer.instances[0]?.closed, true);
  assert.deepEqual(sent, []);
  assert.equal(controller.api.screenShareWebRtcStats.updatedAt, null);
  assert.deepEqual(controller.api.screenShareWebRtcStats.peers, []);
});

test("a late start acknowledgement cannot cancel a newer capture", async () => {
  await controller.api.startScreenShare();
  const oldRequest = sent.at(-1)?.requestId;
  controller.api.stopScreenShare();
  await controller.api.startScreenShare();
  const newRequest = sent.at(-1)?.requestId;
  confirmStart("old", oldRequest);
  assert.equal(controller.api.screenShareStarting.value, true);
  confirmStart("new", newRequest);
  assert.equal(controller.api.screenShareActive.value, true);
  assert.equal(controller.api.screenShareActiveStreamId.value, "new");
});

test("a superseded permission result preserves the newer capture's output settings", async () => {
  const oldCapture = deferred<ReturnType<typeof stream>>();
  Object.assign(navigator.mediaDevices, { getDisplayMedia: () => oldCapture.promise });
  const oldStart = controller.api.startScreenShare(true, { maxWidth: 960 });
  controller.api.stopScreenShare();
  Object.assign(navigator.mediaDevices, { getDisplayMedia: async () => stream() });
  await controller.api.startScreenShare(true, { maxWidth: 640 });
  confirmStart("new");
  const oldStream = stream();
  oldCapture.resolve(oldStream);
  await oldStart;
  controller.handleMessage({ type: "screenShareSignal", streamId: "new", fromPeerId: "viewer", signal: { kind: "offer", sdp: "offer" } });
  await nextTurn();
  assert.equal(oldStream.track.readyState, "ended");
  assert.equal(Peer.instances[0]?.parameters?.encodings[0]?.scaleResolutionDownBy, 3);
});

test("invalid capture without a video track still releases every returned track", async () => {
  const capture = stream();
  Object.assign(navigator.mediaDevices, { getDisplayMedia: async () => ({ ...capture, getVideoTracks: () => [] }) });
  await controller.api.startScreenShare();
  assert.equal(capture.track.readyState, "ended");
  assert.equal(controller.api.screenShareStarting.value, false);
});

test("ICE configuration belongs to each controller independently", async () => {
  const second = createScreenShareController({ isOpen: () => true, send() {} });
  controller.setIceServers([{ urls: "stun:first.example" }]);
  second.setIceServers([{ urls: "stun:second.example" }]);
  try {
    controller.handleMessage({ type: "screenShareJoined", stream: remote });
    second.handleMessage({ type: "screenShareJoined", stream: remote });
    await nextTurn();
    assert.deepEqual(Peer.instances.map(peer => peer.configuration.iceServers), [
      [{ urls: "stun:first.example" }], [{ urls: "stun:second.example" }],
    ]);
  } finally { second.stopTransport(false); }
});

test("screen share codecs are ordered H.264, AV1, then VP8 independent of browser order", async () => {
  const codecs = [
    { mimeType: "video/vp8", clockRate: 90_000 },
    { mimeType: "video/rtx", clockRate: 90_000, sdpFmtpLine: "apt=96" },
    { mimeType: "video/av1", clockRate: 90_000 },
    { mimeType: "video/h264", clockRate: 90_000, sdpFmtpLine: "packetization-mode=1;profile-level-id=42e01f" },
  ] satisfies RTCRtpCodecCapability[];
  replaceGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs }) });

  controller.handleMessage({ type: "screenShareJoined", stream: remote });
  await nextTurn();

  assert.deepEqual(Peer.instances[0]?.codecPreferences.map((codec) => codec.mimeType), [
    "video/h264",
    "video/av1",
    "video/vp8",
    "video/rtx",
  ]);
});

test("viewer visibility follows the selected stream so the player and card cannot disagree", async () => {
  assert.equal(controller.api.screenShareViewing.value, false);
  assert.equal(controller.api.screenShareViewingStreamId.value, "");

  controller.handleMessage({ type: "screenShareJoined", stream: remote });
  assert.equal(controller.api.screenShareViewing.value, true);
  assert.equal(controller.api.screenShareViewingStreamId.value, remote.streamId);

  controller.handleMessage({ type: "screenShareStopped", streamId: remote.streamId });
  assert.equal(controller.api.screenShareViewing.value, false);
  assert.equal(controller.api.screenShareViewingStreamId.value, "");
});
