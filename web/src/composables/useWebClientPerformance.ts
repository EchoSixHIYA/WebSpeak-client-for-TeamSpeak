import { computed, onUnmounted, ref, watch, type Ref } from "vue";
import type { LatencyProbeResult } from "./useVoiceWebSocket.js";

const SAMPLE_INTERVAL_MS = 3_000;
const SAMPLE_WINDOW_SIZE = 20;

export function useWebClientPerformance(
  connected: Readonly<Ref<boolean>>,
  measureLatency: () => Promise<LatencyProbeResult | null>,
) {
  const panelOpen = ref(false);
  const running = ref(false);
  const samples = ref<LatencyProbeResult[]>([]);
  const probeResults = ref<Array<LatencyProbeResult | null>>([]);
  const attempts = ref(0);
  let timer: number | null = null;
  let generation = 0;

  const median = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };

  const stats = computed(() => {
    const gatewaySamples = samples.value.map((sample) => sample.browserRttMs);
    const teamSpeakSamples = samples.value
      .filter((sample) => sample.teamSpeakReachable && sample.teamSpeakLatencyMs != null)
      .map((sample) => sample.teamSpeakLatencyMs as number);

    return {
      gatewayLatencyMs: median(gatewaySamples),
      gatewayLossPercent: attempts.value > 0 ? Math.round(((attempts.value - samples.value.length) / attempts.value) * 100) : null,
      teamSpeakLatencyMs: median(teamSpeakSamples),
      teamSpeakLossPercent: attempts.value > 0 ? Math.round(((attempts.value - teamSpeakSamples.length) / attempts.value) * 100) : null,
      ready: attempts.value > 0,
    };
  });

  function resetSamples(): void {
    probeResults.value = [];
    samples.value = [];
    attempts.value = 0;
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    generation += 1;
    running.value = false;
  }

  async function runProbe(expectedGeneration = generation): Promise<void> {
    if (running.value || !connected.value || !panelOpen.value) return;
    running.value = true;
    try {
      const sample = await measureLatency();
      if (expectedGeneration !== generation || !panelOpen.value) return;
      probeResults.value.push(sample);
      if (probeResults.value.length > SAMPLE_WINDOW_SIZE) probeResults.value.shift();
      attempts.value = probeResults.value.length;
      samples.value = probeResults.value.filter((result): result is LatencyProbeResult => result !== null);
    } finally {
      if (expectedGeneration === generation) running.value = false;
    }
  }

  function start(): void {
    if (timer !== null || !connected.value) return;
    resetSamples();
    const activeGeneration = ++generation;
    void runProbe(activeGeneration);
    timer = window.setInterval(() => {
      void runProbe(activeGeneration);
    }, SAMPLE_INTERVAL_MS);
  }

  function refresh(): void {
    void runProbe();
  }

  function togglePanel(): void {
    panelOpen.value = !panelOpen.value;
  }

  watch([connected, panelOpen], ([isConnected, isOpen]) => {
    if (isConnected && isOpen) start();
    else stop();
  }, { immediate: true });

  onUnmounted(stop);

  return {
    panelOpen,
    running,
    stats,
    togglePanel,
    refresh,
  };
}
