import { shallowRef } from "vue";

export interface VoiceTraceEvent {
  at: string;
  event: string;
  data: Record<string, string | number | boolean | null>;
}

const TRACE_WINDOW_MS = 120_000;
const TRACE_MAX_EVENTS = 240;

/** Keeps a short, local-only trace. Callers must pass state and counters, never user content. */
export function createVoiceSessionTrace() {
  const events = shallowRef<VoiceTraceEvent[]>([]);
  function record(event: string, data: Record<string, string | number | boolean | null> = {}): void {
    const safeEvent = event.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
    if (!safeEvent) return;
    const safeData: VoiceTraceEvent["data"] = {};
    for (const [key, value] of Object.entries(data)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue;
      if (value === null) safeData[key] = null;
      else if (typeof value === "boolean") safeData[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) safeData[key] = Math.round(value * 100) / 100;
      else if (typeof value === "string") safeData[key] = value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
    }
    const now = Date.now();
    events.value = [...events.value.filter(item => now - Date.parse(item.at) <= TRACE_WINDOW_MS), {
      at: new Date(now).toISOString(), event: safeEvent, data: safeData,
    }].slice(-TRACE_MAX_EVENTS);
  }

  const visibility = () => record("page.visibility", { state: document.visibilityState });
  const pageHide = () => record("page.lifecycle", { state: "pagehide" });
  const pageShow = () => record("page.lifecycle", { state: "pageshow" });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pageHide);
  window.addEventListener("pageshow", pageShow);
  record("page.lifecycle", { state: "loaded" });
  visibility();

  return {
    events,
    record,
    snapshot: () => events.value
      .filter(item => Date.now() - Date.parse(item.at) <= TRACE_WINDOW_MS)
      .map(item => ({ ...item, data: { ...item.data } })),
    dispose() {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
    },
  };
}

export type VoiceSessionTrace = ReturnType<typeof createVoiceSessionTrace>;
