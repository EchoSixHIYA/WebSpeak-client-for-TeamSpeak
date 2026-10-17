import assert from "node:assert/strict";
import test from "node:test";
import {
  isRestrictedAddress,
  isSafeOpenTargetForPrefill,
  resolveSafeOpenTarget,
  TeamSpeakTargetResolutionError,
} from "./open-target-policy.js";

const resolved = (...addresses: string[]) => async () => addresses.map((address) => ({
  address,
  family: address.includes(":") ? 6 : 4,
}));

test("Mihomo fake-IP DNS answers remain connectable without allowing literal or mixed fake-IP targets", async () => {
  const target = { host: "ts.twilightly.top", port: 9987 };

  assert.equal(isRestrictedAddress("198.18.0.32"), true);
  assert.deepEqual(await resolveSafeOpenTarget(target, { lookup: resolved("198.18.0.32"), resolveSrv: async () => [] }), {
    host: "198.18.0.32",
    port: 9987,
  });
  await assert.rejects(resolveSafeOpenTarget({ host: "198.18.0.32", port: 9987 }));
  await assert.rejects(resolveSafeOpenTarget(target, { lookup: resolved("198.19.0.32"), resolveSrv: async () => [] }));
  await assert.rejects(resolveSafeOpenTarget(target, { lookup: resolved("198.18.0.32", "192.168.1.10"), resolveSrv: async () => [] }));
  await assert.rejects(resolveSafeOpenTarget(target, { lookup: resolved("198.18.0.32", "8.8.8.8"), resolveSrv: async () => [] }));
});

test("TeamSpeak SRV records resolve before the input hostname and pin the advertised endpoint", async () => {
  const lookups: string[] = [];
  const target = await resolveSafeOpenTarget({ host: "ts.twilightly.top", port: 9987 }, {
    resolveSrv: async (service) => {
      assert.equal(service, "_ts3._udp.ts.twilightly.top");
      return [{ name: "routerstun.speedtest.twilightly.top.", port: 18967, priority: 0, weight: 5 }];
    },
    lookup: async (hostname) => {
      lookups.push(hostname);
      assert.equal(hostname, "routerstun.speedtest.twilightly.top");
      return [{ address: "183.200.23.34", family: 4 }];
    },
  });

  assert.deepEqual(target, { host: "183.200.23.34", port: 18967 });
  assert.deepEqual(lookups, ["routerstun.speedtest.twilightly.top"]);
});

test("all TeamSpeak SRV destinations are checked and failed hostname resolution is classified", async () => {
  await assert.rejects(resolveSafeOpenTarget({ host: "voice.example.com", port: 9987 }, {
    resolveSrv: async () => [
      { name: "public.example.net", port: 18967, priority: 0, weight: 5 },
      { name: "private.example.net", port: 18967, priority: 0, weight: 5 },
    ],
    lookup: async (hostname) => [{ address: hostname.startsWith("private") ? "10.0.0.8" : "8.8.8.8", family: 4 }],
  }));

  await assert.rejects(resolveSafeOpenTarget({ host: "missing.example.com", port: 9987 }, {
    resolveSrv: async () => [],
    lookup: async () => { throw Object.assign(new Error("no records"), { code: "ENOTFOUND" }); },
  }), TeamSpeakTargetResolutionError);
});

test("open-mode hostname checks still pin public DNS results and block ordinary private answers", async () => {
  assert.deepEqual(await resolveSafeOpenTarget({ host: "voice.example.com", port: 9987 }, {
    lookup: resolved("8.8.8.8", "1.1.1.1"),
    resolveSrv: async () => [],
  }), { host: "8.8.8.8", port: 9987 });
  await assert.rejects(resolveSafeOpenTarget({ host: "voice.example.com", port: 9987 }, {
    lookup: resolved("8.8.8.8", "10.0.0.5"),
    resolveSrv: async () => [],
  }));
});

test("open-mode target prefill follows the same allow/deny result as the join policy", async () => {
  assert.equal(await isSafeOpenTargetForPrefill({ host: "198.51.100.24", port: 9987 }, {
    resolveTarget: async (target) => target,
  }), true);
  assert.equal(await isSafeOpenTargetForPrefill({ host: "teamspeak", port: 9987 }, {
    resolveTarget: async () => { throw new Error("private or unresolved target"); },
  }), false);
});

test("open-mode target prefill fails closed when DNS validation stalls", async () => {
  const result = await isSafeOpenTargetForPrefill({ host: "internal.example", port: 9987 }, {
    timeoutMs: 10,
    resolveTarget: async () => new Promise(() => undefined),
  });
  assert.equal(result, false);
});

test("expanded IPv6 spellings of loopback and private addresses are rejected as open targets", async () => {
  for (const host of ["0:0:0:0:0:0:0:1", "0::1", "0:0:0:0:0:ffff:a00:1", "0:0:0:0:0:ffff:7f00:1", "64:ff9b::a00:1"]) {
    assert.equal(isRestrictedAddress(host), true, host);
    await assert.rejects(resolveSafeOpenTarget({ host, port: 9987 }), host);
  }
  assert.deepEqual(await resolveSafeOpenTarget({ host: "2001:4860:4860:0:0:0:0:8888", port: 9987 }), {
    host: "2001:4860:4860:0:0:0:0:8888",
    port: 9987,
  });
});
