export interface ConnectionFailure {
  code: unknown;
  detail?: unknown;
  cause?: unknown;
}

interface ConnectionOptions {
  onSocket(socket: WebSocket | null): void;
  onMessage(message: unknown): void;
  onAudio(frame: Uint8Array): void;
  onClose(event: CloseEvent): void;
  onFailure(failure: ConnectionFailure): void;
}

interface Attempt {
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  socket: WebSocket | null;
}

// A connection owns its ticket request and socket. UI/media stay with the
// caller; invalidate callbacks before letting that caller release its media.
export function createVoiceConnection(options: ConnectionOptions) {
  let current: Attempt | null = null;
  let generation = 0;
  const isCurrent = (record: Attempt): boolean => current === record;
  const clean = (operation: () => void): void => { try { operation(); } catch { /* continue cleanup */ } };

  function clearDeadline(record: Attempt): void {
    if (record.timer !== null) clearTimeout(record.timer);
    record.timer = null;
  }

  function stop(beforeClose?: () => void): void {
    generation++;
    const previous = current;
    current = null;
    if (previous) {
      clearDeadline(previous);
      const controller = previous.controller;
      previous.controller = null;
      if (controller) clean(() => controller.abort());
    }
    try { beforeClose?.(); }
    finally {
      options.onSocket(null);
      const socket = previous?.socket;
      if (previous) previous.socket = null;
      if (socket) {
        clean(() => { socket.onopen = null; });
        clean(() => { socket.onmessage = null; });
        clean(() => { socket.onclose = null; });
        clean(() => { socket.onerror = null; });
        if (socket.readyState < WebSocket.CLOSING) clean(() => socket.close(1000));
      }
    }
  }

  function fail(record: Attempt, failure: ConnectionFailure): void {
    if (!isCurrent(record)) return;
    stop();
    options.onFailure(failure);
  }

  function openSocket(record: Attempt, ticket: string, voiceEndpoint?: string): void {
    let socketUrl: string;
    try { socketUrl = buildVoiceSocketUrl(ticket, voiceEndpoint); }
    catch (cause) { fail(record, { code: "VOICE_GATEWAY_UNAVAILABLE", cause }); return; }
    const socket = new WebSocket(socketUrl);
    record.socket = socket;
    socket.binaryType = "arraybuffer";
    options.onSocket(socket);
    socket.onopen = () => {
      if (!isCurrent(record)) clean(() => socket.close(1000));
    };
    socket.onmessage = event => {
      if (!isCurrent(record) || record.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      if (typeof event.data === "string") {
        try { options.onMessage(JSON.parse(event.data)); }
        catch { /* ignore malformed control frames */ }
      } else {
        options.onAudio(new Uint8Array(event.data));
      }
    };
    socket.onclose = event => {
      if (!isCurrent(record) || record.socket !== socket) return;
      stop();
      options.onClose(event);
    };
    // The close event carries the gateway's actionable code. A generic error
    // must not replace it, particularly for identity conflicts and rejections.
    socket.onerror = () => {};
  }

  async function requestTicket(record: Attempt, body: string, ready: Promise<void>): Promise<void> {
    try {
      await ready;
      if (!isCurrent(record)) return;
      const response = await fetch("/api/join-ticket", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        signal: record.controller!.signal,
      });
      if (!isCurrent(record)) return;
      const raw: unknown = await response.json().catch(() => null);
      if (!isCurrent(record)) return;
      const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      if (!response.ok || typeof result.ticket !== "string" || !result.ticket) {
        fail(record, { code: result.code ?? "CONNECTION_FAILED", detail: result.detail });
        return;
      }
      // The deadline includes reading the body, but not the subsequent
      // TeamSpeak handshake, which has its own gateway connection policy.
      clearDeadline(record);
      record.controller = null;
      openSocket(record, result.ticket, typeof result.voiceEndpoint === "string" ? result.voiceEndpoint : undefined);
    } catch (cause) {
      fail(record, { code: "REQUEST_FAILED", cause });
    }
  }

  return {
    stop,
    get generation(): number { return generation; },
    start(body: string, ready: Promise<void>): void {
      stop();
      const record: Attempt = { controller: new AbortController(), timer: null, socket: null };
      current = record;
      record.timer = setTimeout(() => fail(record, { code: "REQUEST_TIMEOUT" }), 15_000);
      void requestTicket(record, body, ready);
    },
  };
}

function buildVoiceSocketUrl(ticket: string, endpoint?: string): string {
  const securePage = location.protocol === "https:";
  const base = endpoint ? new URL(endpoint) : new URL(`${securePage ? "https:" : "http:"}//${location.host}`);
  if ((base.protocol !== "https:" && base.protocol !== "http:") || base.username || base.password
    || base.pathname !== "/" || base.search || base.hash || securePage && base.protocol !== "https:") {
    throw new Error("Invalid voice gateway endpoint");
  }
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws/voice";
  base.search = `?ticket=${encodeURIComponent(ticket)}`;
  return base.toString();
}
