import type { VoiceAudioBridgeStats } from "../../../src/shared/voice-models.js";
import type { FallbackPlaybackStats } from "./remote-playback.js";

export type AudioPermission = "unknown" | "granted" | "denied";

export interface BrowserVoiceAudioStats {
  outboundBytes: number | null;
  outboundPackets: number | null;
  outboundPacketsLost: number | null;
  outboundLossPercent: number | null;
  outboundRttMs: number | null;
  inboundBytes: number | null;
  inboundPackets: number | null;
  inboundPacketsLost: number | null;
  inboundLossPercent: number | null;
  inboundJitterMs: number | null;
  concealedSamples: number | null;
}

export interface VoiceAudioStatusSample {
  /** Browser-local counter scope; changes when the connection or transport does. */
  scopeId: number;
  sampledAt: number;
  transport: "webrtc" | "websocket" | "negotiating" | "disconnected";
  connectionState: string | null;
  microphoneMuted: boolean;
  microphoneReady: boolean;
  microphonePermission: AudioPermission;
  playbackState: "playing" | "paused" | "unavailable" | null;
  bridge: VoiceAudioBridgeStats;
  browser: BrowserVoiceAudioStats | null;
  fallbackPlayback: { framesReceived: number; framesDropped: number; decodeErrors: number } & FallbackPlaybackStats;
}

interface DiagnosticSource {
  socket: WebSocket;
  connection: number;
  transportGeneration: number;
  peer: RTCPeerConnection | null;
  transport: VoiceAudioStatusSample["transport"];
}

interface DiagnosticOptions {
  source(): DiagnosticSource | null;
  presentation(source: DiagnosticSource): Pick<VoiceAudioStatusSample,
    "microphoneMuted" | "microphoneReady" | "microphonePermission" | "playbackState">;
  send(source: DiagnosticSource, sequence: string): void;
  bufferStats?(): FallbackPlaybackStats;
}

async function browserStats(peer: RTCPeerConnection | null): Promise<BrowserVoiceAudioStats | null> {
  if (!peer) return null;
  try {
    const report = await peer.getStats();
    let outbound: Record<string, unknown> | undefined;
    let remoteInbound: Record<string, unknown> | undefined;
    let inbound: Record<string, unknown> | undefined;
    let candidatePair: Record<string, unknown> | undefined;
    report.forEach(raw => {
      const stats = raw as unknown as Record<string, unknown>;
      const kind = stats.kind ?? stats.mediaType;
      if (kind === "audio") {
        if (stats.type === "outbound-rtp") outbound = stats;
        else if (stats.type === "remote-inbound-rtp") remoteInbound = stats;
        else if (stats.type === "inbound-rtp") inbound = stats;
      }
      if (stats.type === "candidate-pair" && (stats.selected === true || stats.nominated === true) && stats.state === "succeeded") candidatePair = stats;
    });
    const number = (stats: Record<string, unknown> | undefined, key: string): number | null => {
      const value = stats?.[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    const outboundLost = number(remoteInbound, "packetsLost");
    const outboundPackets = number(outbound, "packetsSent");
    const fractionLost = number(remoteInbound, "fractionLost");
    // packetsSent already counts all sent packets; adding lost packets again
    // underestimates loss. Prefer the remote RTCP report when supplied.
    // https://www.w3.org/TR/webrtc-stats/#dom-rtcsentrtpstreamstats-packetssent
    const outboundLossPercent = fractionLost !== null
      ? Math.min(100, Math.max(0, fractionLost * 100))
      : outboundLost !== null && outboundPackets !== null && outboundPackets > 0
        ? Math.min(100, (Math.max(0, outboundLost) / outboundPackets) * 100)
        : null;
    const inboundPackets = number(inbound, "packetsReceived");
    const inboundPacketsLost = number(inbound, "packetsLost");
    const inboundTotal = inboundPackets !== null && inboundPacketsLost !== null
      ? inboundPackets + Math.max(0, inboundPacketsLost) : null;
    const rtt = number(remoteInbound, "roundTripTime") ?? number(candidatePair, "currentRoundTripTime");
    const jitter = number(inbound, "jitter");
    return {
      outboundBytes: number(outbound, "bytesSent"), outboundPackets, outboundPacketsLost: outboundLost,
      outboundLossPercent, outboundRttMs: rtt === null ? null : rtt * 1_000,
      inboundBytes: number(inbound, "bytesReceived"), inboundPackets, inboundPacketsLost,
      inboundLossPercent: inboundTotal && inboundTotal > 0 && inboundPacketsLost !== null
        ? (Math.max(0, inboundPacketsLost) / inboundTotal) * 100 : null,
      inboundJitterMs: jitter === null ? null : jitter * 1_000,
      concealedSamples: number(inbound, "concealedSamples"),
    };
  } catch { return null; }
}

function sameSource(left: DiagnosticSource | null, right: DiagnosticSource | null): boolean {
  return Boolean(left && right && left.socket === right.socket && left.connection === right.connection
    && left.transportGeneration === right.transportGeneration && left.peer === right.peer && left.transport === right.transport);
}

export function createAudioDiagnostics(options: DiagnosticOptions) {
  const pending = new Map<string, { receive(bridge: VoiceAudioBridgeStats): void; finish(sample: VoiceAudioStatusSample | null): void }>();
  const fallback = { framesReceived: 0, framesDropped: 0, decodeErrors: 0 };
  const emptyBuffer: FallbackPlaybackStats = { bufferTargetMs: 0, bufferResets: 0, maxBufferAheadMs: 0 };
  let sequence = 0;
  let scopeId = 0;
  let previousSource: DiagnosticSource | null = null;

  function measure(timeoutMs = 1_800): Promise<VoiceAudioStatusSample | null> {
    const source = options.source();
    if (!source) return Promise.resolve(null);
    if (!sameSource(previousSource, source)) {
      previousSource = source;
      scopeId++;
    }
    const scope = scopeId;
    const requestId = `audio-${Date.now().toString(36)}-${(sequence++).toString(36)}`;
    const browser = browserStats(source.peer);
    return new Promise(resolve => {
      let settled = false;
      let receivedBridge = false;
      const finish = (sample: VoiceAudioStatusSample | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(sample);
      };
      // Keep cancellation and the deadline until both sources finish.
      const timer = setTimeout(() => finish(null), timeoutMs);
      pending.set(requestId, {
        finish,
        receive(bridge) {
          if (settled || receivedBridge) return;
          receivedBridge = true;
          void browser.then(stats => {
            if (settled) return;
            if (scope !== scopeId || !sameSource(source, options.source())) { finish(null); return; }
            finish({
              scopeId: scope, sampledAt: performance.now(), transport: source.transport,
              connectionState: source.peer?.connectionState ?? null,
              ...options.presentation(source), bridge, browser: stats,
              fallbackPlayback: { ...fallback, ...(options.bufferStats?.() ?? emptyBuffer) },
            });
          });
        },
      });
      try { options.send(source, requestId); }
      catch { finish(null); }
    });
  }

  return {
    measure,
    receive(sequence: string, bridge: VoiceAudioBridgeStats): void { pending.get(sequence)?.receive(bridge); },
    count(counter: keyof typeof fallback): void { fallback[counter]++; },
    reset(): void {
      scopeId++;
      previousSource = null;
      for (const probe of pending.values()) probe.finish(null);
      fallback.framesReceived = 0;
      fallback.framesDropped = 0;
      fallback.decodeErrors = 0;
    },
  };
}
