import assert from "node:assert/strict";
import test from "node:test";
import { isRestrictedAddress } from "../../src/security/open-target-policy.js";
import { isRestrictedAddress as isPocRestrictedAddress } from "./relay-server.mjs";

/**
 * The acceleration PoC relay keeps its own copy of the restricted-address
 * predicate because it is a standalone `.mjs` file that the README documents
 * copying to a remote host without a build step, so it cannot import the
 * gateway's TypeScript module. Duplication is only safe while the two stay
 * identical: these cases pin both classifications to the same answer, so a
 * change to either side without the other fails here instead of silently
 * widening the PoC's SSRF boundary.
 *
 * This test lives beside the PoC because `.dockerignore` excludes
 * `scripts/acceleration-poc` from the Docker build context while the Dockerfile
 * runs `tsc` over `src/**`; a copy under `src/` would make the image build fail
 * with TS2307.
 */
const CASES = [
  // Public addresses that must stay reachable.
  ["8.8.8.8", false],
  ["1.1.1.1", false],
  ["172.32.0.1", false],
  ["100.128.0.1", false],
  ["2001:4860:4860::8888", false],
  ["2606:4700:4700::1111", false],
  // Private, loopback and link-local.
  ["10.0.0.1", true],
  ["172.16.0.1", true],
  ["172.31.255.255", true],
  ["192.168.1.1", true],
  ["127.0.0.1", true],
  ["169.254.169.254", true],
  ["0.0.0.0", true],
  ["0.1.2.3", true],
  // Carrier-grade NAT.
  ["100.64.0.1", true],
  ["100.127.255.255", true],
  // Special-use ranges: the PoC's first implementation missed every one of these.
  ["192.0.0.1", true],
  ["192.0.2.5", true],
  ["198.18.0.1", true],
  ["198.19.5.5", true],
  ["198.51.100.7", true],
  ["203.0.113.9", true],
  ["224.0.0.1", true],
  ["239.1.1.1", true],
  ["255.255.255.255", true],
  // IPv6 loopback, unspecified, unique-local, link-local, site-local, multicast.
  ["::1", true],
  ["::", true],
  ["fc00::1", true],
  ["fd12::1", true],
  ["fe80::1", true],
  ["fec0::1", true],
  ["ff02::1", true],
  ["2001:db8::1", true],
  // IPv4-mapped forms must unwrap before the IPv4 rules apply.
  ["::ffff:127.0.0.1", true],
  ["::ffff:10.0.0.1", true],
  ["::ffff:8.8.8.8", false],
  ["0:0:0:0:0:ffff:808:808", false],
  ["2001:4860:4860:0:0:0:0:8888", false],
  // Expanded and partially compressed spellings must classify like their canonical form.
  ["0:0:0:0:0:0:0:1", true],
  ["0::1", true],
  ["0:0:0:0:0:0:0:0", true],
  ["0:0:0:0:0:ffff:7f00:1", true],
  ["0:0:0:0:0:ffff:a00:1", true],
  ["0::ffff:10.0.0.1", true],
  ["::127.0.0.1", true],
  ["fe80::1%1", true],
  // Translation prefixes that embed an arbitrary IPv4 destination.
  ["64:ff9b::7f00:1", true],
  ["64:ff9b::808:808", true],
  ["2002:7f00:1::", true],
  ["2001:0:4136:e378::1", true],
  ["100::1", true],
  // Anything that is not a literal address fails closed.
  ["localhost", true],
  ["public.example.invalid", true],
  ["", true],
];

test("the acceleration PoC relay classifies restricted addresses exactly like the gateway policy", () => {
  const mismatches = [];
  for (const [address, expected] of CASES) {
    const policy = isRestrictedAddress(address);
    const poc = isPocRestrictedAddress(address);
    assert.equal(policy, expected, `gateway policy disagrees with the pinned expectation for ${address}`);
    if (poc !== policy) {
      mismatches.push(`${address}: policy=${policy} poc=${poc}`);
    }
  }
  assert.deepEqual(mismatches, [], "the PoC relay's restricted-address guard drifted from the gateway policy");
});

test("the acceleration PoC relay fails closed on a non-literal address", () => {
  // `isIP()` returns 0 for a hostname, so the guard must not treat an
  // unresolved name as public just because it is not a literal address.
  for (const hostname of ["localhost", "internal.example.invalid", "attacker.example.invalid", ""]) {
    assert.equal(isPocRestrictedAddress(hostname), true, `${hostname} must fail closed`);
  }
});
