import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadOrCreateMasterSecret } from "../src/security/master-secret.js";
import { decryptSecret, encryptSecret } from "../src/security/secret-crypto.js";
import { hashAdminPassword, verifyAdminPassword } from "../src/security/admin-password.js";
import { BootstrapManager } from "../src/security/bootstrap.js";

test("master secret is stable and protects authenticated ciphertext", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-secret-"));
  const secretPath = path.join(directory, "master.key");
  const first = loadOrCreateMasterSecret(secretPath);
  const second = loadOrCreateMasterSecret(secretPath);
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);

  const encrypted = encryptSecret("never-store-this-password", first);
  assert.equal(encrypted.includes("never-store-this-password"), false);
  assert.equal(decryptSecret(encrypted, first), "never-store-this-password");
  const [version, nonce, tag, ciphertext] = encrypted.split(":") as [string, string, string, string];
  const tamperedTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
  assert.throws(() => decryptSecret([version, nonce, tamperedTag, ciphertext].join(":"), first));
});

test("admin password uses a salted scrypt credential", async () => {
  const first = await hashAdminPassword("a-long-admin-password");
  const second = await hashAdminPassword("a-long-admin-password");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyAdminPassword("a-long-admin-password", first), true);
  assert.equal(await verifyAdminPassword("wrong-password-value", first), false);
  assert.equal(JSON.stringify(first).includes("a-long-admin-password"), false);
});

test("bootstrap code persists until it is consumed", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "webspeak-bootstrap-"));
  const bootstrapPath = path.join(directory, "bootstrap");
  const firstManager = new BootstrapManager(bootstrapPath);
  const code = firstManager.ensure();
  assert.match(code, /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  assert.equal(new BootstrapManager(bootstrapPath).ensure(), code);
  assert.equal(firstManager.verify(code.toLocaleLowerCase()), true);
  assert.equal(firstManager.verify("0000-0000"), false);
  firstManager.consume();
  assert.throws(() => readFileSync(bootstrapPath));
});
