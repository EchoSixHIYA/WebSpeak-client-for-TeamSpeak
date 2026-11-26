import type { VoiceAudioBridgeStats } from "../shared/voice-models.js";
import type { WebRtcAudioSession, WebRtcAudioStats } from "./webrtc-audio.js";

export interface AudioFlowStats extends WebRtcAudioStats {
  ingressFrames: number;
  ingressPcmFrames: number;
  ingressOpusFrames: number;
  ingressDroppedFrames: number;
  ingressFirstAt: number | null;
  ingressLastAt: number | null;
  ingressMaxGapMs: number;
  tsSendFrames: number;
  tsSendErrors: number;
  tsSendFirstAt: number | null;
  tsSendLastAt: number | null;
  tsSendMaxGapMs: number;
  tsEncodeMaxMs: number;
  uplinkQueueCurrentFrames: number;
  uplinkQueuePeakFrames: number;
  uplinkQueueDroppedFrames: number;
  uplinkPacerLateTicks: number;
  tsReceiveFrames: number;
  tsReceiveFirstAt: number | null;
  tsReceiveLastAt: number | null;
  tsReceiveMaxGapMs: number;
  egressFrames: number;
  egressDroppedFrames: number;
  egressFirstAt: number | null;
  egressLastAt: number | null;
  egressMaxGapMs: number;
  egressSentFirstAt: number | null;
  egressSentLastAt: number | null;
  egressSentMaxGapMs: number;
  egressPeakBufferedBytes: number;
  egressFramesByClient: Record<string, number>;

}

export interface AudioStatsSource {
  audio: AudioFlowStats;
  webrtc: Pick<WebRtcAudioSession, "getStats"> | null;
}

export function createAudioFlowStats(): AudioFlowStats {
  return {
    ingressFrames: 0,
    ingressPcmFrames: 0,
    ingressOpusFrames: 0,
    ingressDroppedFrames: 0,
    ingressFirstAt: null,
    ingressLastAt: null,
    ingressMaxGapMs: 0,
    tsSendFrames: 0,
    tsSendErrors: 0,
    tsSendFirstAt: null,
    tsSendLastAt: null,
    tsSendMaxGapMs: 0,
    tsEncodeMaxMs: 0,
    uplinkQueueCurrentFrames: 0,
    uplinkQueuePeakFrames: 0,
    uplinkQueueDroppedFrames: 0,
    uplinkPacerLateTicks: 0,
    tsReceiveFrames: 0,
    tsReceiveFirstAt: null,
    tsReceiveLastAt: null,
    tsReceiveMaxGapMs: 0,
    egressFrames: 0,
    egressDroppedFrames: 0,
    egressFirstAt: null,
    egressLastAt: null,
    egressMaxGapMs: 0,
    egressSentFirstAt: null,
    egressSentLastAt: null,
    egressSentMaxGapMs: 0,
    egressPeakBufferedBytes: 0,
    egressFramesByClient: {},
    webrtcIngressRtpFrames: 0,
    webrtcIngressRtpFirstAt: null,
    webrtcIngressRtpLastAt: null,
    webrtcIngressRtpMaxGapMs: 0,
    webrtcEgressRtpFrames: 0,
    webrtcEgressRtpFirstAt: null,
    webrtcEgressRtpLastAt: null,
    webrtcEgressRtpMaxGapMs: 0,
    webrtcQueuePeakFrames: 0,
    webrtcQueueDroppedFrames: 0,
    webrtcQueueUnderrunTicks: 0,
    webrtcPacerLateTicks: 0,
    webrtcQueueCurrentFrames: 0,
    webrtcIngressQuietFrames: 0,
    webrtcIngressDecodeErrors: 0,
    webrtcDownlinkDecodedFrames: 0,
    webrtcDownlinkDecodeErrors: 0,
    webrtcDownlinkShortFrames: 0,
  };
}

export function snapshotAudioStats(entry: AudioStatsSource): AudioFlowStats {
  const stats = { ...entry.audio, egressFramesByClient: { ...entry.audio.egressFramesByClient } };
  const webRtcStats: WebRtcAudioStats | undefined = entry.webrtc?.getStats();
  if (webRtcStats) Object.assign(stats, webRtcStats);
  return stats;
}

export function snapshotAudioStatus(entry: AudioStatsSource): VoiceAudioBridgeStats {
  const stats = snapshotAudioStats(entry);
  return {
    transport: entry.webrtc ? "webrtc" : "websocket",
    ingressFrames: stats.ingressFrames,
    ingressPcmFrames: stats.ingressPcmFrames,
    ingressOpusFrames: stats.ingressOpusFrames,
    ingressDroppedFrames: stats.ingressDroppedFrames,
    ingressMaxGapMs: stats.ingressMaxGapMs,
    tsSendFrames: stats.tsSendFrames,
    tsSendErrors: stats.tsSendErrors,
    tsSendMaxGapMs: stats.tsSendMaxGapMs,
    uplinkQueuePeakFrames: stats.uplinkQueuePeakFrames,
    uplinkQueueDroppedFrames: stats.uplinkQueueDroppedFrames,
    uplinkPacerLateTicks: stats.uplinkPacerLateTicks,
    tsReceiveFrames: stats.tsReceiveFrames,
    tsReceiveMaxGapMs: stats.tsReceiveMaxGapMs,
    egressFrames: stats.egressFrames,
    egressDroppedFrames: stats.egressDroppedFrames,
    egressMaxGapMs: stats.egressMaxGapMs,
    webrtcIngressRtpFrames: stats.webrtcIngressRtpFrames,
    webrtcIngressRtpMaxGapMs: stats.webrtcIngressRtpMaxGapMs,
    webrtcEgressRtpFrames: stats.webrtcEgressRtpFrames,
    webrtcEgressRtpMaxGapMs: stats.webrtcEgressRtpMaxGapMs,
    webrtcQueueDroppedFrames: stats.webrtcQueueDroppedFrames,
    webrtcQueueUnderrunTicks: stats.webrtcQueueUnderrunTicks,
    webrtcPacerLateTicks: stats.webrtcPacerLateTicks,
    webrtcIngressDecodeErrors: stats.webrtcIngressDecodeErrors,
    webrtcDownlinkDecodeErrors: stats.webrtcDownlinkDecodeErrors,
  };
}

