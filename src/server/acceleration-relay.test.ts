import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { createAccelerationRelayServer } from "./acceleration-relay.js";

const TOKEN = "test-acceleration-relay-token";
const MAGIC = Buffer.from("WSAT");
const HEADER_SIZE = 34;
const enum FrameType { OPEN = 1, OPEN_OK = 2, OPEN_ERR = 3 }

function encodeFrame(type: FrameType, sessionId: number, payload: Buffer): Buffer {
  const frame = Buffer.alloc(HEADER_SIZE + payload.length);
  MAGIC.copy(frame, 0);
  frame[4] = 1;
  frame[5] = type;
  frame.writeUInt32BE(sessionId >>> 0, 8);
  frame.writeUInt32BE(1, 12);
  frame.writeUInt16BE(payload.length, 16);
  createHmac("sha256", Buffer.from(TOKEN, "utf8"))
    .update(frame.subarray(0, 18)).update(payload)
    .digest().subarray(0, 16).copy(frame, 18);
  payload.copy(frame, HEADER_SIZE);
  return frame;
}

function decodeFrame(packet: Buffer): { type: number; sessionId: number; payload: Buffer } | null {
  if (packet.length < HEADER_SIZE || !packet.subarray(0, 4).equals(MAGIC) || packet[4] !== 1) return null;
  const length = packet.readUInt16BE(16);
  if (packet.length !== HEADER_SIZE + length) return null;
  return { type: packet[5]!, sessionId: packet.readUInt32BE(8), payload: packet.subarray(HEADER_SIZE) };
}


/** Send one OPEN and resolve with the relay's first reply. */
function openTarget(server: { host: string; port: number }, targetHost: string, targetPort = 9987): Promise<{ type: number; code?: string }> {
  const client = createSocket("udp4");
  const sessionId = 0x5a5a0001;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.close();
      reject(new Error("The relay did not answer the OPEN frame"));
    }, 3_000);
    client.on("message", (packet) => {
      const frame = decodeFrame(packet);
      if (!frame || frame.sessionId !== sessionId) return;
      clearTimeout(timer);
      let code: string | undefined;
      try { code = (JSON.parse(frame.payload.toString("utf8")) as { code?: string }).code; } catch { code = undefined; }
      client.close();
      resolve({ type: frame.type, code });
    });
    const payload = Buffer.from(JSON.stringify({ targetHost, targetPort }), "utf8");
    client.send(encodeFrame(FrameType.OPEN, sessionId, payload), server.port, server.host);
  });
}

async function startRelay(options: { allowPrivate?: boolean } = {}) {
  return await createAccelerationRelayServer({ host: "127.0.0.1", port: 0, token: TOKEN, ...options });
}

test("a bind failure rejects startup instead of throwing out of the error listener", async () => {
  // Regression: the socket error listener ended with `throw error`, which escaped
  // EventEmitter.emit, became an uncaught exception, and killed the process. It
  // also aborted the remaining listeners, so this call never settled at all.
  const server = await startRelay({});
  try {
    await assert.rejects(
      () => createAccelerationRelayServer({ host: "127.0.0.1", port: server.port, token: TOKEN }),
      (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE",
    );
  } finally {
    server.close();
  }
});

test("a failed startup leaves the surviving relay serving traffic", async () => {
  // The thrown error used to take the whole process down with it; the relay that
  // did bind must stay usable.
  const server = await startRelay({});
  try {
    await assert.rejects(() => createAccelerationRelayServer({ host: "127.0.0.1", port: server.port, token: TOKEN }));
    const reply = await openTarget(server, "8.8.8.8");
    assert.equal(reply.type, FrameType.OPEN_OK);
  } finally {
    server.close();
  }
});

test("closing a relay is idempotent after a failed sibling startup", async () => {
  const server = await startRelay({});
  // A failed startup already tore its own socket down, so nothing leaks and the
  // surviving relay still closes cleanly when close() runs more than once.
  const failed = await createAccelerationRelayServer({ host: "127.0.0.1", port: server.port, token: TOKEN }).catch(() => null);
  assert.equal(failed, null);
  server.close();
  server.close();
});
