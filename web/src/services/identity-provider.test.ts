import assert from "node:assert/strict";
import test from "node:test";
import { registerIdentityProviderAdapter, requestIdentityProviderLogin } from "./identity-provider.js";

test("identity provider login dispatches stable provider metadata only to a host adapter", async () => {
  const requests: unknown[] = [];
  const unregister = registerIdentityProviderAdapter("example.account", (request) => requests.push(request));
  try {
    assert.equal(await requestIdentityProviderLogin({ providerId: "unregistered", providerLabel: "Unregistered" }), false);
    assert.equal(await requestIdentityProviderLogin({ providerId: "example.account", providerLabel: "Example" }), true);
    assert.deepEqual(requests, [{ providerId: "example.account", providerLabel: "Example" }]);
  } finally {
    unregister();
  }
  assert.equal(await requestIdentityProviderLogin({ providerId: "example.account", providerLabel: "Example" }), false);
});

test("identity provider adapters reject invalid or duplicate keys and unregister safely", async () => {
  const adapter = () => {};
  assert.throws(() => registerIdentityProviderAdapter("MyTS/login", adapter), /Invalid identity provider ID/);
  const unregister = registerIdentityProviderAdapter("example", adapter);
  assert.throws(() => registerIdentityProviderAdapter("example", adapter), /already registered/);
  unregister();
  const replacement = () => {};
  const unregisterReplacement = registerIdentityProviderAdapter("example", replacement);
  unregister();
  assert.equal(await requestIdentityProviderLogin({ providerId: "example", providerLabel: "Example" }), true);
  unregisterReplacement();
});
