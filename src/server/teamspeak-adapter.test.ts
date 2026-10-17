import assert from "node:assert/strict";
import test from "node:test";
import { detectTeamSpeakProtocol } from "./teamspeak-adapter.js";

test("detects TeamSpeak 3 from the leading version number", () => {
  assert.equal(detectTeamSpeakProtocol("3.13.7 build=1645123456 platform=Linux"), "ts3");
  assert.equal(detectTeamSpeakProtocol("3.0.0"), "ts3");
});

test("does not misclassify a TeamSpeak 3 minor as TeamSpeak 6", () => {
  assert.equal(detectTeamSpeakProtocol("3.6.7 build=1645123456 platform=Linux"), "ts3");
  assert.equal(detectTeamSpeakProtocol("3.6.0"), "ts3");
  assert.equal(detectTeamSpeakProtocol("3.16.0"), "ts3");
});

test("detects TeamSpeak 6 from the leading version number or product name", () => {
  assert.equal(detectTeamSpeakProtocol("6.0.0-beta.1"), "ts6");
  assert.equal(detectTeamSpeakProtocol("6.2.0"), "ts6");
  assert.equal(detectTeamSpeakProtocol("TeamSpeak 6.0.0"), "ts6");
  assert.equal(detectTeamSpeakProtocol("TeamSpeak 3 Server 3.13.7"), "ts3");
});

test("returns null when the protocol cannot be determined", () => {
  assert.equal(detectTeamSpeakProtocol(""), null);
  assert.equal(detectTeamSpeakProtocol("build=1645123456 platform=Linux"), null);
  assert.equal(detectTeamSpeakProtocol("5.0.0-beta"), null);
});
