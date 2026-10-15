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

const resolved = (...addresses: string[]) => async () => addresses.map((address) => ({
  address,
  family: address.includes(":") ? 6 : 4,
}));

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

async function startRelay(options: { allowPrivate?: boolean; lookupAddresses?: () => Promise<{ address: string; family: number }[]> }) {
  return await createAccelerationRelayServer({ host: "127.0.0.1", port: 0, token: TOKEN, ...options });
}

test("a hostname that resolves to loopback is blocked by the resolved-address check", async () => {
  const server = await startRelay({ lookupAddresses: resolved("127.0.0.1") });
  try {
    // Regression: the name itself is not an IP literal, so a string-only check
    // used to pass and the relay then connected to the resolved loopback address.
    const reply = await openTarget(server, "attacker.example.invalid");
    assert.equal(reply.type, FrameType.OPEN_ERR);
    assert.equal(reply.code, "PRIVATE_TARGET_BLOCKED");
  } finally {
    server.close();
  }
});

test("IPv4-mapped IPv6 literals cannot bypass the private-address check", async () => {
  for (const target of ["::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254"]) {
    const server = await startRelay({});
    try {
      const reply = await openTarget(server, target);
      assert.equal(reply.type, FrameType.OPEN_ERR, `${target} should be blocked`);
      assert.equal(reply.code, "PRIVATE_TARGET_BLOCKED", `${target} should be blocked`);
    } finally {
      server.close();
    }
  }
});

test("private and special-use literals stay blocked", async () => {
  for (const target of ["10.0.0.5", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1"]) {
    const server = await startRelay({});
    try {
      const reply = await openTarget(server, target);
      assert.equal(reply.code, "PRIVATE_TARGET_BLOCKED", `${target} should be blocked`);
    } finally {
      server.close();
    }
  }
});

test("a mixed public/private DNS answer is rejected instead of using the public record", async () => {
  const server = await startRelay({ lookupAddresses: resolved("8.8.8.8", "192.168.1.10") });
  try {
    const reply = await openTarget(server, "mixed.example.invalid");
    assert.equal(reply.type, FrameType.OPEN_ERR);
    assert.equal(reply.code, "PRIVATE_TARGET_BLOCKED");
  } finally {
    server.close();
  }
});

test("allowPrivate keeps the private-target escape hatch working", async () => {
  const listener = createSocket("udp4");
  await new Promise<void>((resolve) => listener.bind(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  const server = await startRelay({ allowPrivate: true });
  try {
    const reply = await openTarget(server, "127.0.0.1", port);
    assert.equal(reply.type, FrameType.OPEN_OK);
  } finally {
    server.close();
    listener.close();
  }
});

test("a public target still opens a relay session", async () => {
  // UDP connect() only sets the default destination, so a public address opens
  // the session without sending traffic or needing a real listener.
  const server = await startRelay({});
  try {
    const reply = await openTarget(server, "8.8.8.8");
    assert.equal(reply.type, FrameType.OPEN_OK);
  } finally {
    server.close();
  }
});
