import assert from "node:assert/strict";
import test from "node:test";
import { formatTeamSpeakConnectionTarget, parseTeamSpeakConnectionTarget } from "../domain/teamspeak-connection-target.js";
import { parseTeamSpeakTarget } from "../domain/teamspeak-target.js";
import { resolveSafeOpenTarget } from "../security/open-target-policy.js";
import { resolveTeamSpeakTarget as resolveTarget, TeamSpeakAliasLookupError } from "./teamspeak-alias.js";

const publicTarget = "8.8.8.8:10000";
const lookup = (body = publicTarget, status = 200): typeof fetch => async () => new Response(body, { status });
const resolveTeamSpeakTarget = (value: string, fetchLookup: typeof fetch) => resolveTarget(value, fetchLookup, async () => undefined);

test("private service names retain local discovery while explicit lookup URLs use the registry", async () => {
  const noFetch: typeof fetch = async () => { throw new Error("Local services must not use cloud lookup"); };
  assert.deepEqual(await resolveTarget("teamspeak:9988", noFetch, async () => "172.18.0.6"), { host: "172.18.0.6", port: 9988 });
  const explicit = "https://named.myteamspeak.com/lookup?name=teamspeak";
  const stored = formatTeamSpeakConnectionTarget(parseTeamSpeakConnectionTarget(explicit));
  assert.equal(stored, explicit);
  assert.deepEqual(await resolveTarget(stored, lookup(), async () => {
    throw new Error("An explicit lookup URL must not use local discovery");
  }), { host: "8.8.8.8", port: 10000 });
});

test("unrelated plain nicknames are encoded as one query parameter", async () => {
  for (const name of ["team eco", "another guild", "Solo", "\u4e2d\u6587\u670d\u52a1\u5668", "A+B & 50%", "literal%20name"]) {
    const fetchLookup: typeof fetch = async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://named.myteamspeak.com");
      assert.equal(url.pathname, "/lookup");
      assert.deepEqual([...url.searchParams], [["name", name]]);
      assert.equal(options?.redirect, "error");
      assert.ok(options?.signal instanceof AbortSignal);
      return new Response(publicTarget);
    };
    assert.deepEqual(await resolveTeamSpeakTarget(name, fetchLookup), { host: "8.8.8.8", port: 10000 });
  }
});

test("lookup URLs decode name exactly once and preserve reserved characters", async () => {
  const examples = [
    ["team%20eco", "team eco"],
    ["A%2BB+%26+50%25", "A+B & 50%"],
    ["literal%2520name", "literal%20name"],
    ["%E4%B8%AD%E6%96%87", "\u4e2d\u6587"],
    ["dotted.name%3A12%23x%2Ftest", "dotted.name:12#x/test"],
  ];
  for (const [encoded, name] of examples) {
    const value = `https://named.myteamspeak.com/lookup?name=${encoded}`;
    const parsed = parseTeamSpeakConnectionTarget(value);
    assert.deepEqual(parsed, { kind: "nickname", name });
    assert.deepEqual(parseTeamSpeakConnectionTarget(formatTeamSpeakConnectionTarget(parsed)), parsed);
    await resolveTeamSpeakTarget(value, async (input) => {
      assert.equal(new URL(String(input)).searchParams.get("name"), name);
      return new Response(publicTarget);
    });
  }
});

test("lookup ports apply unless the user explicitly overrides them", async () => {
  assert.equal((await resolveTeamSpeakTarget("guild", lookup())).port, 10000);
  assert.equal((await resolveTeamSpeakTarget("guild:9987", lookup())).port, 9987);
  assert.equal((await resolveTeamSpeakTarget("guild#12345", lookup())).port, 12345);
  assert.equal((await resolveTeamSpeakTarget("https://named.myteamspeak.com/lookup?name=guild#9988", lookup())).port, 9988);
  assert.equal((await resolveTeamSpeakTarget("guild", lookup("8.8.8.8"))).port, 9987);
  assert.deepEqual(await resolveTeamSpeakTarget("guild", lookup("\n[2606:4700:4700::1111]:9988\r\n8.8.8.8")), { host: "2606:4700:4700::1111", port: 9988 });
});

test("ordinary targets retain their parser and do not call nickname lookup", async () => {
  const unexpectedFetch: typeof fetch = async () => { throw new Error("Lookup should not run"); };
  for (const value of ["8.8.8.8", "voice.example.com:9988", "voice.example.com#9988", "localhost", "[2606:4700:4700::1111]:9987"]) {
    assert.deepEqual(await resolveTeamSpeakTarget(value, unexpectedFetch), parseTeamSpeakTarget(value));
  }
  assert.throws(() => parseTeamSpeakTarget("team eco"));
});

test("invalid inputs and failed or malformed lookups reject the connection", async () => {
  for (const value of ["", "  ", "x:0", "x:65536", "x:abc", "x#123#456", "a\nb", "x".repeat(256),
    "https://example.com/lookup?name=guild", "http://named.myteamspeak.com/lookup?name=guild",
    "https://named.myteamspeak.com/wrong?name=guild", "https://named.myteamspeak.com/lookup?name=",
    "https://named.myteamspeak.com/lookup?name=a&name=b", "https://named.myteamspeak.com/lookup"]) {
    assert.throws(() => parseTeamSpeakConnectionTarget(value), value);
  }
  for (const body of ["", "\n", "not found", "another-nickname", "8.8.8.8:0", "https://example.com", "x".repeat(4097)]) {
    await assert.rejects(resolveTeamSpeakTarget("guild", lookup(body)), TeamSpeakAliasLookupError);
  }
  await assert.rejects(resolveTeamSpeakTarget("guild", lookup("error", 503)), TeamSpeakAliasLookupError);
  await assert.rejects(resolveTeamSpeakTarget("guild", async () => { throw new Error("Network failed"); }), TeamSpeakAliasLookupError);
  await assert.rejects(resolveTeamSpeakTarget("guild", async () => { throw new DOMException("Timed out", "TimeoutError"); }), TeamSpeakAliasLookupError);
});

test("open-target protection runs on the lookup result", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "[::1]", "[fd00::1]"]) {
    const target = await resolveTeamSpeakTarget("guild", lookup(address));
    await assert.rejects(resolveSafeOpenTarget(target));
  }
  assert.deepEqual(await resolveSafeOpenTarget(await resolveTeamSpeakTarget("guild", lookup())), { host: "8.8.8.8", port: 10000 });
});

test("TeamSpeak nickname results continue through SRV discovery before open-mode validation", async () => {
  const target = await resolveTarget("guild", lookup("ts.twilightly.top"), async () => undefined);
  const safeTarget = await resolveSafeOpenTarget(target, {
    resolveSrv: async (service) => {
      assert.equal(service, "_ts3._udp.ts.twilightly.top");
      return [{ name: "routerstun.speedtest.twilightly.top.", port: 18967, priority: 0, weight: 5 }];
    },
    lookup: async (hostname) => {
      assert.equal(hostname, "routerstun.speedtest.twilightly.top");
      return [{ address: "183.200.23.34", family: 4 }];
    },
  });

  assert.deepEqual(safeTarget, { host: "183.200.23.34", port: 18967 });
});
