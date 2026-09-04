import assert from "node:assert/strict";
import test from "node:test";
import { IdentityLeaseStore } from "../src/server/identity-lease.js";

test("an identity lease rejects a second live owner and ignores a release from another owner", () => {
  const store = new IdentityLeaseStore();
  assert.equal(store.acquire("target:identity", "first"), true);
  assert.equal(store.acquire("target:identity", "second"), false);
  store.release("target:identity", "second");
  assert.equal(store.acquire("target:identity", "second"), false);
  store.release("target:identity", "first");
  assert.equal(store.acquire("target:identity", "second"), true);
});
