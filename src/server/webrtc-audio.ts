import { randomInt } from "node:crypto";
import { createRequire } from "node:module";
import {
  MediaStreamTrack,
  RtpHeader,
  RtpPacket,
  RTCPeerConnection,
} from "werift";
import type { Logger as LoggerType } from "../logger.js";
import type { TSVoiceData } from "./ts-client.js";

const require = createRequire(import.meta.url);
const { OpusEncoder } = require("@discordjs/opus") as {
  OpusEncoder: new (sampleRate: number, channels: number) => {
    decode(data: Buffer): Buffer;
    encode(data: Buffer): Buffer;
  };
};

const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_FRAME_SAMPLES = 960;
const AUDIO_FRAME_BYTES = AUDIO_FRAME_SAMPLES * 2;
const DEFAULT_WEBRTC_OPUS_PAYLOAD_TYPE = 111;
const AUDIO_CLOCK_INTERVAL_MS = 20;
const SPEAKER_ACTIVITY_INTERVAL_MS = 100;
// TeamSpeak and browsers can emit valid Opus comfort-noise/silence packets
// while a client is muted. Do not turn those packets into a false "speaking"
// indicator or forward them to TeamSpeak as if they were voice.
const MIN_SPEAKER_RMS = 160;

// WebRTC is served by the WebSpeak process itself. Docker publishes this
// fixed range so the administrator only needs to enable the transport; the
// advertised host is derived from the browser's current WebSpeak address.
export const WEBRTC_UDP_PORT_RANGE: [number, number] = [40000, 40099];

export interface WebRtcAudioOptions {
  enabled: boolean;
}

export interface WebRtcSessionDescription {
  type: "offer" | "answer";
  sdp: string;
  muted?: boolean;
}

export interface WebRtcAudioSessionOptions {
  connectionId: string;
  publicHost?: string;
  logger: LoggerType;
  microphoneMuted?: boolean;
  onVoiceFrame: (data: Buffer) => void;
  onVoiceActivity: (clientIds: number[]) => void;
}

/**
 * One low-latency WebRTC audio session for one browser connection.
 *
 * TeamSpeak provides one Opus payload per speaker. WebRTC has one negotiated
 * audio track in this first transport, so this class mixes only the newest
 * 20 ms frame from each active speaker and packetizes the result as RTP. The
 * map is deliberately bounded to one frame per speaker; an old frame is
 * replaced instead of becoming a playback queue.
 */
export class WebRtcAudioSession {
  readonly peer: RTCPeerConnection;
  private readonly logger: LoggerType;
  private readonly onVoiceFrame: (data: Buffer) => void;
  private readonly onVoiceActivity: (clientIds: number[]) => void;
  private readonly outgoingTrack: MediaStreamTrack;
  private ingressDecoder: { decode(data: Buffer): Buffer } | null = null;
  private readonly decoderByClient = new Map<number, { decode(data: Buffer): Buffer }>();
  private readonly pendingFrames = new Map<number, Buffer>();
  private readonly activeSpeakerIds = new Set<number>();
  private readonly opusPayloadTypes = new Set<number>();
  private readonly audioTimer: ReturnType<typeof setInterval>;
  private readonly activityTimer: ReturnType<typeof setInterval>;
  private encoder: { encode(data: Buffer): Buffer } | null;
  private microphoneMuted: boolean;
  private sequenceNumber = randomInt(0, 65_536);
  private timestamp = randomInt(0, 0x1_0000_0000) >>> 0;
  private readonly ssrc = randomInt(1, 0x1_0000_0000) >>> 0;
  private outgoingPayloadType = DEFAULT_WEBRTC_OPUS_PAYLOAD_TYPE;
  private closed = false;

  constructor(options: WebRtcAudioSessionOptions) {
    this.logger = options.logger.child({ component: "webrtc-audio", connectionId: options.connectionId });
    this.onVoiceFrame = options.onVoiceFrame;
    this.onVoiceActivity = options.onVoiceActivity;
    this.microphoneMuted = options.microphoneMuted === true;
    this.outgoingTrack = new MediaStreamTrack({ kind: "audio" });

    const iceAdditionalHostAddresses = options.publicHost ? [options.publicHost] : undefined;
    this.peer = new RTCPeerConnection({
      iceServers: [],
      iceUseIpv4: true,
      iceUseIpv6: false,
      iceUseTcp: false,
      icePortRange: [...WEBRTC_UDP_PORT_RANGE] as [number, number],
      ...(iceAdditionalHostAddresses ? { iceAdditionalHostAddresses } : {}),
    });

    const audio = this.peer.addTransceiver("audio", { direction: "sendrecv" });
    audio.onTrack.subscribe((track) => {
      track.onReceiveRtp.subscribe((rtp) => {
        if (this.closed || this.microphoneMuted || !this.opusPayloadTypes.has(rtp.header.payloadType)) return;
        const payload = Buffer.from(rtp.payload);
        // A disabled browser MediaStreamTrack normally still produces RTP
        // comfort-noise packets. TeamSpeak treats any received voice packet
        // as activity, so enforce mute/VAD at this gateway boundary instead
        // of relying on the browser's local speaking indicator.
        if (!this.hasVoiceEnergy(payload)) return;
        this.onVoiceFrame(payload);
      });
      void audio.sender.replaceTrack(this.outgoingTrack).catch((error: unknown) => {
        this.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Could not attach WebRTC output track");
      });
    });
    void audio.sender.replaceTrack(this.outgoingTrack).catch((error: unknown) => {
      this.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Could not prepare WebRTC output track");
    });

    try {
      this.encoder = new OpusEncoder(AUDIO_SAMPLE_RATE, 1);
      // Use a separate stateful decoder for browser ingress. RTP payloads do
      // not identify whether a packet contains microphone energy or DTX/CN
      // audio, so the gateway must decode it before forwarding to TS.
      this.ingressDecoder = new OpusEncoder(AUDIO_SAMPLE_RATE, 1);
    } catch (error: unknown) {
      this.encoder = null;
      this.ingressDecoder = null;
      this.logger.error({ err: error instanceof Error ? error.message : String(error) }, "Could not create WebRTC mixer encoder");
    }
    if (!this.encoder || !this.ingressDecoder) {
      this.outgoingTrack.stop();
      throw new Error("WebRTC Opus codec is unavailable");
    }

    this.audioTimer = setInterval(() => this.flushAudio(), AUDIO_CLOCK_INTERVAL_MS);
    this.audioTimer.unref?.();
    this.activityTimer = setInterval(() => this.flushSpeakerActivity(), SPEAKER_ACTIVITY_INTERVAL_MS);
    this.activityTimer.unref?.();
    this.peer.onconnectionstatechange = () => {
      this.logger.info({ state: this.peer.connectionState }, "WebRTC connection state changed");
    };
  }

  async createAnswer(offer: WebRtcSessionDescription): Promise<WebRtcSessionDescription> {
    if (this.closed) throw new Error("WebRTC session is closed");
    this.setOpusPayloadTypes(offer.sdp);
    await this.peer.setRemoteDescription(offer);
    const transceiver = this.peer.getTransceivers().find((candidate) => candidate.kind === "audio");
    if (transceiver) await transceiver.sender.replaceTrack(this.outgoingTrack);
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    const description = this.peer.localDescription;
    if (!description) throw new Error("WebRTC answer was not created");
    if (description.type !== "answer" && description.type !== "offer") throw new Error("Unexpected WebRTC answer type");
    return { type: description.type, sdp: description.sdp };
  }

  pushTeamSpeakVoice(data: TSVoiceData): void {
    if (this.closed || data.codec !== 4) return;
    let decoder = this.decoderByClient.get(data.clientId);
    if (!decoder) {
      try {
        // @discordjs/opus exposes decoding on OpusEncoder instances too;
        // there is no separate OpusDecoder constructor in that package.
        decoder = new OpusEncoder(AUDIO_SAMPLE_RATE, 1);
        this.decoderByClient.set(data.clientId, decoder);
      } catch (error: unknown) {
        this.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Could not create WebRTC mixer decoder");
        return;
      }
    }
    try {
      const pcm = decoder.decode(data.data);
      // Only advertise speaking after a valid TeamSpeak Opus frame has been
      // decoded. Otherwise the UI can show activity while the mixer has no
      // audio to send, which is especially confusing on the WebRTC path.
      if (pcm.length < AUDIO_FRAME_BYTES) return;
      let sum = 0;
      for (let index = 0; index + 1 < AUDIO_FRAME_BYTES; index += 2) {
        const sample = pcm.readInt16LE(index);
        sum += sample * sample;
      }
      if (Math.sqrt(sum / AUDIO_FRAME_SAMPLES) < MIN_SPEAKER_RMS) return;
      this.pendingFrames.set(data.clientId, pcm.subarray(0, AUDIO_FRAME_BYTES));
      this.activeSpeakerIds.add(data.clientId);
    } catch {
      // A malformed or codec-transition packet is discarded without touching
      // the peer connection. The next valid Opus frame can recover the stream.
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.audioTimer);
    clearInterval(this.activityTimer);
    this.pendingFrames.clear();
    this.activeSpeakerIds.clear();
    this.ingressDecoder = null;
    this.decoderByClient.clear();
    this.encoder = null;
    this.outgoingTrack.stop();
    await this.peer.close();
  }

  private flushAudio(): void {
    if (this.closed || !this.encoder || !this.pendingFrames.size) return;
    const mixed = new Int32Array(AUDIO_FRAME_SAMPLES);
    let sourceCount = 0;
    for (const pcm of this.pendingFrames.values()) {
      sourceCount++;
      for (let index = 0; index < AUDIO_FRAME_SAMPLES; index++) mixed[index] += pcm.readInt16LE(index * 2);
    }
    this.pendingFrames.clear();
    if (!sourceCount) return;

    const pcm = Buffer.allocUnsafe(AUDIO_FRAME_BYTES);
    const scale = 1 / Math.sqrt(sourceCount);
    for (let index = 0; index < AUDIO_FRAME_SAMPLES; index++) {
      const sample = Math.max(-32_768, Math.min(32_767, Math.round(mixed[index]! * scale)));
      pcm.writeInt16LE(sample, index * 2);
    }
    try {
      const encoded = this.encoder.encode(pcm);
      const packet = new RtpPacket(new RtpHeader({
        payloadType: this.outgoingPayloadType,
        sequenceNumber: this.sequenceNumber,
        timestamp: this.timestamp,
        ssrc: this.ssrc,
        marker: true,
      }), encoded);
      this.sequenceNumber = (this.sequenceNumber + 1) & 0xffff;
      this.timestamp = (this.timestamp + AUDIO_FRAME_SAMPLES) >>> 0;
      this.outgoingTrack.writeRtp(packet);
    } catch {
      // A peer closing concurrently may reject a packet; teardown owns the
      // session lifecycle and no per-frame error needs to reach the logs.
    }
  }

  private flushSpeakerActivity(): void {
    if (this.closed || !this.activeSpeakerIds.size) return;
    const ids = [...this.activeSpeakerIds];
    this.activeSpeakerIds.clear();
    this.onVoiceActivity(ids);
  }

  setMicrophoneMuted(muted: boolean): void {
    this.microphoneMuted = muted;
  }

  private hasVoiceEnergy(data: Buffer): boolean {
    const decoder = this.ingressDecoder;
    if (!decoder) return false;
    try {
      const pcm = decoder.decode(data);
      if (pcm.length < AUDIO_FRAME_BYTES) return false;
      let sum = 0;
      for (let index = 0; index + 1 < AUDIO_FRAME_BYTES; index += 2) {
        const sample = pcm.readInt16LE(index);
        sum += sample * sample;
      }
      return Math.sqrt(sum / AUDIO_FRAME_SAMPLES) >= MIN_SPEAKER_RMS;
    } catch {
      // Malformed/transition packets are discarded without interrupting the
      // rest of the peer. The next valid Opus packet can recover the decoder.
      return false;
    }
  }

  private setOpusPayloadTypes(sdp: string): void {
    this.opusPayloadTypes.clear();
    for (const match of sdp.matchAll(/^a=rtpmap:(\d+)\s+opus\/48000(?:\/\d+)?/gim)) {
      const payloadType = Number(match[1]);
      if (!Number.isInteger(payloadType) || payloadType < 0 || payloadType > 127) continue;
      this.opusPayloadTypes.add(payloadType);
      this.outgoingPayloadType = payloadType;
    }
    if (!this.opusPayloadTypes.size) this.opusPayloadTypes.add(DEFAULT_WEBRTC_OPUS_PAYLOAD_TYPE);
  }
}
