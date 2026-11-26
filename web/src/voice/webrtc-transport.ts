import { isSessionDescription, type WebRtcClientMessage } from "../../../src/shared/webrtc.js";
import { hasVoiceTurnServer, type VoiceIceServer } from "../../../src/shared/voice-ice.js";
import { createWebRtcInput, type WebRtcInput } from "./webrtc-input.js";
import { createMicrophoneMeter, type MicrophoneMeter } from "./microphone-meter.js";
import { createWebRtcPlayback, type WebRtcPlaybackOptions } from "./webrtc-playback.js";
import { addOpusFmtpParameters } from "../../../src/shared/opus-sdp.js";

interface Microphone {
  context: AudioContext;
  stream: MediaStream;
  processedStream: MediaStream;
}

interface Connection {
  isCurrent(): boolean;
  send(message: WebRtcClientMessage): void;
}

interface TransportOptions {
  prepareMicrophone(): Promise<Microphone | null>;
  stunServer?(): string;
  iceServers?(): VoiceIceServer[];
  iceTransportPolicy?(): RTCIceTransportPolicy;
  muted(): boolean;
  inputVolume(): number;
  accompanimentActive(): boolean;
  releaseAccompaniment(): void;
  onLevel(rms: number | null, track: MediaStreamTrack): void;
  onReady(): void;
  onConnectionState?(state: RTCPeerConnectionState): void;
  onIceCandidateError?(errorCode: number, url?: string): void;
  onFailure(reason: string, isCurrent: () => boolean): Promise<void>;
  playback: WebRtcPlaybackOptions;
}

interface Attempt {
  connection: Connection;
  peer: RTCPeerConnection | null;
  input: WebRtcInput | null;
  meter: MicrophoneMeter | null;
  active: boolean;
  closed: boolean;
  answerTimer: number | null;
  cancelIce: (() => void) | null;
}

// One attempt owns peer negotiation, input, metering and remote playback. The
// caller continues to own microphone acquisition, PCM and the control socket.
export function createWebRtcTransport(options: TransportOptions) {
  let current: Attempt | null = null;
  let generation = 0;
  const playback = createWebRtcPlayback(options.playback);
  const isCurrent = (record: Attempt): boolean => current === record && !record.closed && record.connection.isCurrent();
  const clean = (operation: () => void): void => { try { operation(); } catch { /* release remaining resources */ } };

  function releaseInput(record = current): void {
    clean(options.releaseAccompaniment);
    if (!record) return;
    const input = record.input;
    const meter = record.meter;
    record.input = null;
    record.meter = null;
    if (input) clean(() => input.dispose());
    if (meter) clean(() => meter.dispose());
  }

  function stop(): void {
    generation++;
    const previous = current;
    current = null;
    if (previous) {
      previous.closed = true;
      previous.active = false;
      if (previous.answerTimer !== null) window.clearTimeout(previous.answerTimer);
      previous.answerTimer = null;
      const cancelIce = previous.cancelIce;
      previous.cancelIce = null;
      if (cancelIce) clean(cancelIce);
      releaseInput(previous);
    }
    clean(() => playback.stop());
    const peer = previous?.peer;
    if (previous) previous.peer = null;
    if (peer) {
      clean(() => { peer.ontrack = null; });
      clean(() => { peer.onconnectionstatechange = null; });
      clean(() => peer.close());
    }
  }

  async function failAttempt(record: Attempt, reason: string): Promise<void> {
    if (!isCurrent(record)) return;
    // Signaling is best-effort once the transport fails. It cannot prevent local teardown when the socket send throws.
    clean(() => record.connection.send({ type: "webrtcStop" }));
    stop();
    const failureGeneration = generation;
    const isFailureCurrent = (): boolean => generation === failureGeneration && record.connection.isCurrent();
    if (isFailureCurrent()) await options.onFailure(reason, isFailureCurrent);
  }

  async function waitForIce(record: Attempt, peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return;
    await new Promise<void>(resolve => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        clean(() => peer.removeEventListener("icegatheringstatechange", onStateChange));
        record.cancelIce = null;
        resolve();
      };
      const onStateChange = (): void => { if (peer.iceGatheringState === "complete") finish(); };
      const timer = window.setTimeout(finish, 6_000);
      record.cancelIce = finish;
      peer.addEventListener("icegatheringstatechange", onStateChange);
    });
  }

  async function start(connection: Connection): Promise<void> {
    stop();
    const record: Attempt = { connection, peer: null, input: null, meter: null,
      active: false, closed: false, answerTimer: null, cancelIce: null };
    current = record;
    let microphone: Microphone | null;
    try { microphone = await options.prepareMicrophone(); }
    catch (error) { if (isCurrent(record)) throw error; return; }
    if (!isCurrent(record) || !microphone) return;
    const { context, stream, processedStream } = microphone;
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") throw new Error("没有可用的麦克风音轨");

    try {
      const stunServer = options.stunServer?.();
      const configuredIceServers = options.iceServers?.() ?? [];
      const iceServers = configuredIceServers.length ? configuredIceServers : (stunServer ? [{ urls: stunServer }] : []);
      const iceTransportPolicy = options.iceTransportPolicy?.() ?? "all";
      if (iceTransportPolicy === "relay" && !hasVoiceTurnServer(iceServers)) {
        await failAttempt(record, "WEBRTC_NO_RELAY");
        return;
      }
      const peer = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy,
        bundlePolicy: "max-bundle",
      });
      record.peer = peer;
      peer.onicecandidateerror = event => {
        options.onIceCandidateError?.(event.errorCode, event.url);
      };
      track.enabled = !options.muted();
      const input = createWebRtcInput(context, processedStream, options.muted() ? 0 : options.inputVolume());
      record.input = input;
      peer.addTrack(input.stream.getAudioTracks()[0]!, input.stream);
      peer.ontrack = event => {
        if (!isCurrent(record)) return;
        try { playback.attach(event.streams[0] ?? new MediaStream([event.track])); }
        catch { void failAttempt(record, "WEBRTC_PLAYBACK_FAILED"); }
      };
      record.meter = createMicrophoneMeter(context, stream, rms => options.onLevel(rms, track));
      peer.onconnectionstatechange = () => {
        options.onConnectionState?.(peer.connectionState);
        if (isCurrent(record) && peer.connectionState === "failed") void failAttempt(record, "WEBRTC_CONNECTION_FAILED");
      };
      options.onConnectionState?.(peer.connectionState);

      record.active = true;
      const offer = await peer.createOffer();
      if (!isCurrent(record)) return;
      await peer.setLocalDescription({ ...offer, sdp: addOpusFmtpParameters(offer.sdp ?? "", ["stereo=1"]) });
      if (!isCurrent(record)) return;
      await waitForIce(record, peer);
      if (!isCurrent(record)) return;
      const description = peer.localDescription;
      if (!description || description.type !== "offer") throw new Error("WebRTC offer was not created");
      connection.send({ type: "webrtcOffer", payload: {
        sdp: { type: "offer", sdp: addOpusFmtpParameters(description.sdp, ["stereo=1"]) },
        muted: options.muted(), accompanimentActive: options.accompanimentActive(),
      } });
      record.answerTimer = window.setTimeout(() => {
        if (!isCurrent(record)) return;
        record.answerTimer = null;
        if (!peer.remoteDescription) void failAttempt(record, "WEBRTC_ANSWER_TIMEOUT");
      }, 8_000);
    } catch {
      await failAttempt(record, "WEBRTC_NEGOTIATION_FAILED");
    }
  }

  async function applyAnswer(description: unknown): Promise<void> {
    const record = current;
    const peer = record?.peer;
    if (!record || !peer || !isCurrent(record) || !isSessionDescription(description, "answer")) return;
    try {
      await peer.setRemoteDescription(description);
      if (!isCurrent(record)) return;
      if (record.answerTimer !== null) window.clearTimeout(record.answerTimer);
      record.answerTimer = null;
      record.active = true;
      options.onReady();
    } catch { await failAttempt(record, "WEBRTC_ANSWER_REJECTED"); }
  }

  return {
    start, stop, applyAnswer,
    get generation(): number { return generation; },
    releaseInput(): void { releaseInput(); },
    async fail(reason: string): Promise<void> { if (current) await failAttempt(current, reason); },
    get peer(): RTCPeerConnection | null { return current?.peer ?? null; },
    get input(): WebRtcInput | null { return current?.input ?? null; },
    get active(): boolean { return current?.active ?? false; },
    get output() { return playback.output; },
    setOutputVolume: playback.setVolume,
  };
}
