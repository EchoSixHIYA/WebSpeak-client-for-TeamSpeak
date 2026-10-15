import { createSocket } from "node:dgram";
import { createRelayServer } from "./relay-server.mjs";
import { createRelayClient } from "./relay-client.mjs";

const TOKEN = "local-acceleration-poc-token";
const PACKET_COUNT = 200;
const PACKET_SIZE = 1920;

function bind(socket, port = 0) {
  return new Promise((resolve) => socket.bind(port, "127.0.0.1", resolve));
}

function close(socket) {
  try { socket.close(); } catch {}
}

async function run() {
  const target = createSocket("udp4");
  target.on("message", (payload, rinfo) => {
    target.send(payload, rinfo.port, rinfo.address);
  });
  await bind(target);
  const targetAddress = target.address();

  const relay = await createRelayServer({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowPrivate: true,
  });
  const client = await createRelayClient({
    relayHost: "127.0.0.1",
    relayPort: relay.port,
    targetHost: "127.0.0.1",
    targetPort: targetAddress.port,
    token: TOKEN,
  });

  let rejectedBadToken = false;
  try {
    const badClient = await createRelayClient({
      relayHost: "127.0.0.1",
      relayPort: relay.port,
      targetHost: "127.0.0.1",
      targetPort: targetAddress.port,
      token: "wrong-token-that-is-long-enough",
      timeoutMs: 250,
    });
    badClient.close();
  } catch {
    rejectedBadToken = true;
  }

  // SSRF guard: a relay started without allowPrivate must refuse every request
  // that resolves to a non-public address, and must still serve public ones.
  // Asserting only the happy path would let the private-address guard regress
  // unnoticed, since the throughput relay above runs with allowPrivate: true.
  const guardedRelay = await createRelayServer({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowPrivate: false,
  });
  const blockedTargets = ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::ffff:127.0.0.1"];
  const blockedResults = [];
  for (const targetHost of blockedTargets) {
    let allowed = false;
    try {
      const tunnel = await createRelayClient({
        relayHost: "127.0.0.1",
        relayPort: guardedRelay.port,
        targetHost,
        targetPort: 9987,
        token: TOKEN,
        timeoutMs: 1_000,
      });
      tunnel.close();
      allowed = true;
    } catch (error) {
      // The relay answers OPEN_ERR(PRIVATE_TARGET_BLOCKED); any other failure
      // (timeout, bad token) would not prove the guard fired.
      allowed = !(error instanceof Error && error.message === "PRIVATE_TARGET_BLOCKED");
    }
    blockedResults.push({ targetHost, blocked: !allowed });
  }

  let publicTargetAllowed = false;
  try {
    const tunnel = await createRelayClient({
      relayHost: "127.0.0.1",
      relayPort: guardedRelay.port,
      targetHost: "8.8.8.8",
      targetPort: 9987,
      token: TOKEN,
      timeoutMs: 2_000,
    });
    publicTargetAllowed = true;
    tunnel.close();
  } catch {
    publicTargetAllowed = false;
  }
  guardedRelay.close();

  const guardFailures = blockedResults.filter((entry) => !entry.blocked);
  const ssrfGuardOk = guardFailures.length === 0 && publicTargetAllowed;

  const sender = createSocket("udp4");
  await bind(sender);
  const pending = new Map();
  const samples = [];
  sender.on("message", (payload) => {
    const id = payload.readUInt32BE(0);
    const sentAt = pending.get(id);
    if (sentAt !== undefined) {
      pending.delete(id);
      samples.push(Number(process.hrtime.bigint() - sentAt) / 1_000_000);
    }
  });

  for (let id = 0; id < PACKET_COUNT; id++) {
    const payload = Buffer.alloc(PACKET_SIZE, id & 0xff);
    payload.writeUInt32BE(id, 0);
    pending.set(id, process.hrtime.bigint());
    sender.send(payload, client.localPort, "127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  const deadline = Date.now() + 5_000;
  while (pending.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));

  const received = samples.length;
  const loss = ((PACKET_COUNT - received) / PACKET_COUNT) * 100;
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (ratio) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] : 0;
  const average = sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : 0;

  sender.close();
  client.close();
  relay.close();
  target.close();

  console.log(`relay=127.0.0.1:${relay.port}`);
  console.log(`packets=${PACKET_COUNT} received=${received} loss=${loss.toFixed(2)}%`);
  console.log(`rtt_ms_avg=${average.toFixed(3)} p95=${Number(percentile(0.95)).toFixed(3)} max=${Number(percentile(0.99)).toFixed(3)}`);
  console.log(`bad_token_rejected=${rejectedBadToken}`);
  console.log(`ssrf_guard_ok=${ssrfGuardOk} blocked=${blockedResults.filter((entry) => entry.blocked).length}/${blockedResults.length} public_target_allowed=${publicTargetAllowed}`);
  for (const entry of blockedResults) {
    if (!entry.blocked) console.log(`  LEAK: ${entry.targetHost} was not blocked by the private-target guard`);
  }
  if (received !== PACKET_COUNT || !rejectedBadToken || !ssrfGuardOk) throw new Error("ACCELERATION_POC_FAILED");
  console.log("ACCELERATION_POC_OK");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
