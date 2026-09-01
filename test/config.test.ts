import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { migrateConfig, saveConfig } from "../src/config.js";

describe("legacy config migration", () => {
  it("drops deprecated runtime controls while preserving the TeamSpeak target", () => {
    assert.deepEqual(migrateConfig({
      port: 3999,
      tsHost: "TS.Example.COM",
      tsPort: "9988",
      tsServerPassword: "secret",
      tsServerProtocol: "ts6",
      maxClients: 3,
      trustProxy: true,
    }), {
      tsHost: "ts.example.com",
      tsPort: 9988,
      tsServerPassword: "secret",
    });
  });

  it("accepts a host with an embedded port during migration", () => {
    assert.deepEqual(migrateConfig({ tsHost: "[2001:db8::1]:9988" }), {
      tsHost: "2001:db8::1",
      tsPort: 9988,
      tsServerPassword: "",
    });
  });

  it("accepts the address#port form during migration", () => {
    assert.deepEqual(migrateConfig({ tsHost: "voice.example.com#9988" }), {
      tsHost: "voice.example.com",
      tsPort: 9988,
      tsServerPassword: "",
    });
  });

  it("falls back safely for malformed legacy targets", () => {
    assert.deepEqual(migrateConfig({ tsHost: "bad host", tsPort: 0 }), {
      tsHost: "127.0.0.1",
      tsPort: 9987,
      tsServerPassword: "",
    });
  });

  it("writes the migrated shape without deprecated runtime controls", () => {
    const directory = mkdtempSync(join(tmpdir(), "webspeak-m000-config-"));
    const path = join(directory, "config.json");
    try {
      writeFileSync(path, JSON.stringify({
        port: 3999,
        tsHost: "example.com",
        tsPort: 9988,
        tsServerProtocol: "ts3",
        maxClients: 2,
        trustProxy: true,
      }), "utf8");
      saveConfig(path, migrateConfig(JSON.parse(readFileSync(path, "utf8"))));
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
        tsHost: "example.com",
        tsPort: 9988,
        tsServerPassword: "",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
