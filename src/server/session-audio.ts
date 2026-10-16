import { WebSocket } from "ws";
import type { Logger as LoggerType } from "../logger.js";
import type { ServerMessage } from "../shared/server-messages.js";
import type { AudioFlowStats } from "./audio-stats.js";
import type { TSClient, TSVoiceData } from "./ts-client.js";
import type { WebRtcAudioSession } from "./webrtc-audio.js";

const AUDIO_FRAME_BYTES = 1_920; // 20 ms of 48 kHz mono Int16 PCM.
// Keep the established byte guard; the browser also bounds playback by time.
const MAX_BUFFERED_BYTES = 4_096;
// A client that keeps sending bad audio must not turn into one JSON error per
// frame: the reply is roughly 100x the offending payload, and the browser only
// ever shows the first one because it writes the same error string.
const AUDIO_ISSUE_REPORT_MS = 5_000;

export interface VoiceEncoder {
  encode(frame: Buffer): Buffer;
  dispose(): void;
}

export interface SessionAudioOptions {
  audio: AudioFlowStats;
  socket: Pick<WebSocket, "readyState" | "bufferedAmount"> & { send(packet: Buffer): void };
  client: Pick<TSClient, "sendVoice" | "sendWhisper">;
  /** Optional: audio faults are also surfaced here so operators can see them. */
  logger?: LoggerType;
  isCurrent(): boolean;
  isReady(): boolean;
  selfId(): number;
  peer(): Pick<WebRtcAudioSession, "pushTeamSpeakVoice"> | null;
  whisperTargets(): readonly number[] | null;
  sendJson(message: ServerMessage): void;
}

/** A session owns one encoder and one active audio route in each direction. */
export class SessionAudioTransport {
  private encoder: VoiceEncoder | null;
  private closed = false;
  /** Last report time per audio fault code; see `shouldReportAudioIssue`. */
  private readonly reportedAt = new Map<string, number>();
  private readonly logger: LoggerType | null;

  constructor(private readonly options: SessionAudioOptions, encoder: VoiceEncoder, private readonly clock: () => number = Date.now) {
    this.encoder = encoder;
    this.logger = options.logger ?? null;
  }

  private isCurrent(): boolean {
    return !this.closed && this.options.isCurrent() && this.options.socket.readyState === WebSocket.OPEN;
  }

  private recordIngress(): void {
    const stats = this.options.audio;
    const now = this.clock();
    if (stats.ingressLastAt !== null) stats.ingressMaxGapMs = Math.max(stats.ingressMaxGapMs, now - stats.ingressLastAt);
    stats.ingressFirstAt ??= now;
    stats.ingressLastAt = now;
    stats.ingressFrames++;
  }

  private sendVoice(data: Buffer, codec: number): void {
    const stats = this.options.audio;
    try {
      const targets = this.options.whisperTargets();
      if (targets?.length) this.options.client.sendWhisper(data, [...targets], codec);
      else this.options.client.sendVoice(data, codec);
      const now = this.clock();
      if (stats.tsSendLastAt !== null) stats.tsSendMaxGapMs = Math.max(stats.tsSendMaxGapMs, now - stats.tsSendLastAt);
      stats.tsSendFirstAt ??= now;
      stats.tsSendLastAt = now;
      stats.tsSendFrames++;
    } catch {
      stats.tsSendErrors++;
    }
  }

  /**
   * Decide whether an audio fault is worth reporting right now. Repeated faults
   * of the same kind collapse into one report per window. Codes are tracked
   * separately so that one fault cannot hide a different one, which a single
   * shared window would do.
   *
   * The browser only renders the first error string of a run, so dropping the
   * repeats costs the user nothing; what it saves is the server-side cost, which
   * is proportional to however fast the client streams bad frames.
   */
  private shouldReportAudioIssue(code: string): boolean {
    const now = this.clock();
    const last = this.reportedAt.get(code);
    if (last !== undefined && now - last < AUDIO_ISSUE_REPORT_MS) return false;
    this.reportedAt.set(code, now);
    return true;
  }

  private reportEncoderFailure(): void {
    if (!this.shouldReportAudioIssue("AUDIO_ENCODER_UNAVAILABLE")) return;
    this.logger?.warn({ code: "AUDIO_ENCODER_UNAVAILABLE" }, "Opus encoder unavailable for the browser uplink");
    try {
      this.options.sendJson({ type: "audioError", code: "AUDIO_ENCODER_UNAVAILABLE", detail: "Opus encoder unavailable" });
    } catch { /* the socket may have closed while reporting the failure */ }
  }

  private reportInvalidFrame(length: number): void {
    if (!this.shouldReportAudioIssue("INVALID_AUDIO_FRAME")) return;
    // Log the faults that the browser is told about: the outbound error is not
    // logged anywhere, so without this an operator has no way to notice a client
    // that keeps sending malformed audio until the session is torn down.
    this.logger?.warn(
      { code: "INVALID_AUDIO_FRAME", frameBytes: length, expectedBytes: AUDIO_FRAME_BYTES, droppedFrames: this.options.audio.ingressDroppedFrames },
      "Discarded malformed browser audio frame",
    );
    try {
      this.options.sendJson({ type: "error", error: { code: "INVALID_AUDIO_FRAME", message: "音频帧格式无效", recoverable: false } });
    } catch { /* the socket may have closed while reporting the failure */ }
  }

  receivePcm(frame: Buffer): void {
    if (!this.isCurrent()) return;
    const stats = this.options.audio;
    // Resolve the route before judging the frame. A frame that arrives while the
    // route is down is discarded whatever its size, so calling it malformed would
    // misattribute the drop and raise a spurious client error in the browser.
    // Late TCP frames from before a WebRTC switch must not duplicate RTP audio.
    if (!this.options.isReady() || this.options.peer()) { stats.ingressDroppedFrames++; return; }
    if (frame.length !== AUDIO_FRAME_BYTES) {
      stats.ingressDroppedFrames++;
      this.reportInvalidFrame(frame.length);
      return;
    }
    this.recordIngress();
    const startedAt = this.clock();
    let encoded: Buffer;
    try {
      if (!this.encoder) throw new Error("Encoder unavailable");
      encoded = this.encoder.encode(frame);
      stats.tsEncodeMaxMs = Math.max(stats.tsEncodeMaxMs, this.clock() - startedAt);
    } catch {
      stats.tsSendErrors++;
      stats.ingressDroppedFrames++;
      this.reportEncoderFailure();
      return;
    }
    this.sendVoice(encoded, 4);
  }

  receiveWebRtc(data: Buffer, codec: number): void {
    if (!this.isCurrent() || !this.options.isReady()) return;
    this.recordIngress();
    this.sendVoice(data, codec);
  }

  receiveTeamSpeak(data: TSVoiceData): void {
    if (!this.isCurrent() || !this.options.isReady()) return;
    const stats = this.options.audio;
    const now = this.clock();
    if (stats.tsReceiveLastAt !== null) stats.tsReceiveMaxGapMs = Math.max(stats.tsReceiveMaxGapMs, now - stats.tsReceiveLastAt);
    stats.tsReceiveFirstAt ??= now;
    stats.tsReceiveLastAt = now;
    stats.tsReceiveFrames++;
    if (data.clientId === this.options.selfId()) return;
    if (!Number.isInteger(data.clientId) || data.clientId < 1 || data.clientId > 65_535
      || !Number.isInteger(data.codec) || data.codec < 0 || data.codec > 255 || !Buffer.isBuffer(data.data)) {
      stats.egressDroppedFrames++;
      return;
    }
    if (stats.egressLastAt !== null) stats.egressMaxGapMs = Math.max(stats.egressMaxGapMs, now - stats.egressLastAt);
    stats.egressFirstAt ??= now;
    stats.egressLastAt = now;
    const key = String(data.clientId);
    stats.egressFramesByClient[key] = (stats.egressFramesByClient[key] ?? 0) + 1;
    const peer = this.options.peer();
    if (peer) {
      try { peer.pushTeamSpeakVoice(data); stats.egressFrames++; }
      catch { stats.egressDroppedFrames++; }
      return;
    }
    const bufferedBytes = this.options.socket.bufferedAmount;
    stats.egressPeakBufferedBytes = Math.max(stats.egressPeakBufferedBytes, bufferedBytes);
    if (bufferedBytes > MAX_BUFFERED_BYTES) { stats.egressDroppedFrames++; return; }
    const packet = Buffer.allocUnsafe(3 + data.data.length);
    packet[0] = data.codec;
    packet.writeUInt16BE(data.clientId, 1);
    data.data.copy(packet, 3);
    try {
      this.options.socket.send(packet);
      stats.egressFrames++;
      const sentAt = this.clock();
      if (stats.egressSentLastAt !== null) stats.egressSentMaxGapMs = Math.max(stats.egressSentMaxGapMs, sentAt - stats.egressSentLastAt);
      stats.egressSentFirstAt ??= sentAt;
      stats.egressSentLastAt = sentAt;
    } catch { stats.egressDroppedFrames++; }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reportedAt.clear();
    const encoder = this.encoder;
    this.encoder = null;
    try { encoder?.dispose(); } catch { /* other session resources must still be released */ }
  }
}
