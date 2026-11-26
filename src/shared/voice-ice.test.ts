import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasVoiceTurnServer,
  normalizeVoiceIceServers,
  normalizeVoiceIceTransportPolicy,
  normalizeVoiceTurnRestUrls,
} from "./voice-ice.js";

test("voice ICE normalization accepts STUN and TURN URLs", () => {
  const servers = normalizeVoiceIceServers([
    { urls: "stun:stun.example.com:3478" },
    { urls: "stuns:stun.example.com:5349" },
    { urls: ["turns:turn.example.com:443?transport=tcp", "turn:turn.example.com:3478?transport=udp"], username: "u", credential: "c" },
  ]);
  assert.deepEqual(servers, [
    { urls: "stun:stun.example.com:3478" },
    { urls: "stuns:stun.example.com:5349" },
    { urls: ["turns:turn.example.com:443?transport=tcp", "turn:turn.example.com:3478?transport=udp"], username: "u", credential: "c" },
  ]);
  assert.equal(hasVoiceTurnServer(servers), true);
});

test("voice ICE normalization drops malformed, half-credentialed, and duplicate entries", () => {
  assert.deepEqual(normalizeVoiceIceServers([
    { urls: "http://turn.example.com" },
    { urls: "turns:turn.example.com:443?transport=udp" },
    { urls: "turn:turn.example.com:3478", username: "u" },
    { urls: "stun:stun.example.com:3478" },
    { urls: "stun:stun.example.com:3478" },
  ]), [{ urls: "stun:stun.example.com:3478" }]);
});

test("transport policy defaults to direct-first", () => {
  assert.equal(normalizeVoiceIceTransportPolicy(undefined), "all");
  assert.equal(normalizeVoiceIceTransportPolicy("relay"), "relay");
  assert.equal(normalizeVoiceIceTransportPolicy("invalid"), "all");
});

test("TURN REST URL input is strict and keeps direct-first configuration bounded", () => {
  assert.deepEqual(normalizeVoiceTurnRestUrls(" turn:turn.example.com:3478\nturns:turn.example.com:5349?transport=tcp "), [
    "turn:turn.example.com:3478",
    "turns:turn.example.com:5349?transport=tcp",
  ]);
  assert.deepEqual(normalizeVoiceTurnRestUrls(""), []);
  assert.equal(normalizeVoiceTurnRestUrls("stun:stun.example.com:3478"), null);
  assert.equal(normalizeVoiceTurnRestUrls("https://turn.example.com"), null);
  assert.equal(normalizeVoiceTurnRestUrls("turn:turn.example.com:3478\nbad"), null);
});
