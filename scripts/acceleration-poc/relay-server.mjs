import { createSocket } from "node:dgram";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { decodeFrame, encodeFrame, FrameType, jsonPayload, parseJsonPayload, verifyFrame } from "./protocol.mjs";

function endpointKey(address, port) {
  return `${address}/${port}`;
}

/**
 * Mirror of `isRestrictedAddress()` in `src/security/open-target-policy.ts`.
 *
 * The PoC ships as a plain `.mjs` file that the README documents copying to a
 * remote host without a build step, so it cannot import the TypeScript policy.
 * The logic is duplicated rather than shared, and
 * `scripts/acceleration-poc/target-guard-parity.test.mjs` fails the moment the two
 * classifications disagree, so drift is caught in CI instead of in production.
 *
 * Keep this an exact mirror: fail closed on anything that is not a literal
 * public address.
 */
export function isRestrictedAddress(host) {
  const version = isIP(host);
  if (version === 4) return isRestrictedIpv4(host);
  if (version !== 6) return true;

  const normalized = host.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped addresses must be unwrapped before the IPv4 rules apply:
    // ::ffff:10.0.0.1 is private traffic in IPv6 clothing.
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) !== 4 || isRestrictedIpv4(mapped);
  }
  if (normalized.startsWith("::")) return true; // IPv4-compatible and other special compressed forms
  const first = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // deprecated site-local fec0::/10
  if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (normalized.startsWith("2001:db8:")) return true; // documentation range
  return false;
}

function isRestrictedIpv4(host) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

async function resolveTarget(host) {
  const family = isIP(host);
  if (family) return { host, family, resolved: [host] };
  const records = await lookup(host, { all: true, verbatim: true });
  const record = records.find((item) => item.family === 4) ?? records[0];
  if (!record) throw new Error("TARGET_DNS_EMPTY");
  return { host: record.address, family: record.family, resolved: records.map((item) => item.address) };
}

export async function createRelayServer({
  host = "127.0.0.1",
  port = 0,
  token,
  allowPrivate = false,
  idleTimeoutMs = 30_000,
} = {}) {
  const serverFamily = isIP(host) === 6 ? "udp6" : "udp4";
  const socket = createSocket(serverFamily);
  const sessions = new Map();
  let closed = false;

  function sendToClient(session, type, payload = Buffer.alloc(0)) {
    if (closed) return;
    const packet = encodeFrame(type, session.id, session.outSequence++, payload, token);
    socket.send(packet, session.client.port, session.client.address);
  }

  function cleanup(session) {
    if (!session || session.closed) return;
    session.closed = true;
    sessions.delete(session.id);
    session.targetSocket?.close();
  }

  async function openSession(frame, client) {
    const request = parseJsonPayload(frame.payload);
    if (!request || typeof request.targetHost !== "string" || !Number.isInteger(request.targetPort)) {
      return;
    }

    const existing = sessions.get(frame.sessionId);
    if (existing) cleanup(existing);
    const session = {
      id: frame.sessionId,
      client,
      clientKey: endpointKey(client.address, client.port),
      outSequence: 1,
      lastActivity: Date.now(),
      targetSocket: null,
      closed: false,
    };
    sessions.set(session.id, session);

    try {
      const target = await resolveTarget(request.targetHost);
      // Validate the resolved addresses, not the caller-supplied name: a DNS
      // answer can point any hostname at loopback or an internal address.
      if (!allowPrivate && target.resolved.some((address) => isRestrictedAddress(address))) {
        const error = { code: "PRIVATE_TARGET_BLOCKED" };
        socket.send(encodeFrame(FrameType.OPEN_ERR, frame.sessionId, 0, jsonPayload(error), token), client.port, client.address);
        cleanup(session);
        return;
      }
      const targetSocket = createSocket(target.family === 6 ? "udp6" : "udp4");
      session.targetSocket = targetSocket;
      targetSocket.on("message", (payload) => {
        session.lastActivity = Date.now();
        sendToClient(session, FrameType.DATA, payload);
      });
      targetSocket.on("error", (error) => {
        if (!session.closed) sendToClient(session, FrameType.OPEN_ERR, jsonPayload({ code: "TARGET_SOCKET_ERROR", message: error.message }));
        cleanup(session);
      });
      targetSocket.connect(request.targetPort, target.host, () => {
        session.lastActivity = Date.now();
        sendToClient(session, FrameType.OPEN_OK, jsonPayload({ targetHost: target.host, targetPort: request.targetPort }));
      });
    } catch (error) {
      cleanup(session);
      socket.send(encodeFrame(FrameType.OPEN_ERR, frame.sessionId, 0, jsonPayload({ code: "TARGET_OPEN_FAILED", message: error.message }), token), client.port, client.address);
    }
  }

  socket.on("message", (packet, rinfo) => {
    const frame = decodeFrame(packet);
    if (!frame || !verifyFrame(frame, token)) return;
    const client = { address: rinfo.address, port: rinfo.port };
    if (frame.type === FrameType.OPEN) {
      void openSession(frame, client);
      return;
    }

    const session = sessions.get(frame.sessionId);
    if (!session || session.clientKey !== endpointKey(rinfo.address, rinfo.port)) return;
    session.lastActivity = Date.now();
    if (frame.type === FrameType.DATA && session.targetSocket) {
      session.targetSocket.send(frame.payload);
    } else if (frame.type === FrameType.CLOSE) {
      sendToClient(session, FrameType.CLOSE);
      cleanup(session);
    } else if (frame.type === FrameType.PING) {
      sendToClient(session, FrameType.PONG);
    }
  });

  socket.on("error", (error) => {
    for (const session of sessions.values()) cleanup(session);
    if (!closed) throw error;
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (now - session.lastActivity > idleTimeoutMs) cleanup(session);
    }
  }, Math.max(1000, Math.min(idleTimeoutMs, 5000)));
  sweep.unref();

  await new Promise((resolve, reject) => {
    const onError = (error) => { socket.off("listening", onListening); reject(error); };
    const onListening = () => { socket.off("error", onError); resolve(); };
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind({ address: host, port });
  });

  const address = socket.address();
  return {
    host,
    port: typeof address === "object" ? address.port : port,
    family: serverFamily,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(sweep);
      for (const session of sessions.values()) cleanup(session);
      socket.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const token = process.env.WEBSPEAK_ACCEL_TOKEN;
  if (!token) throw new Error("Set WEBSPEAK_ACCEL_TOKEN before starting the PoC relay");
  const host = process.env.WEBSPEAK_ACCEL_HOST ?? "0.0.0.0";
  const port = Number(process.env.WEBSPEAK_ACCEL_PORT ?? 39087);
  const server = await createRelayServer({ host, port, token });
  console.log(`ACCELERATION_RELAY_LISTEN ${server.host}:${server.port}`);
}
