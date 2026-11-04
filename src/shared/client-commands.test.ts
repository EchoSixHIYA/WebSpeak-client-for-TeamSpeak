import assert from "node:assert/strict";
import test from "node:test";
import { parseClientCommand, type ClientCommand, type ClientCommandPayloads } from "./client-commands.js";
import { normalizeScreenShareIceServers, parseScreenShareMessage } from "./screen-share.js";

test("all command payloads preserve request IDs through the shared parser", () => {
  const payloads: ClientCommandPayloads = {
    createInvite: { expiresInMinutes: 60 },
    switchChannel: { channelId: "18446744073709551615", password: "secret" },
    moveClient: { clientId: 2, channelId: "1" }, sendTextMessage: { message: "hello" },
    sendServerMessage: { message: "hello" }, sendPrivateMessage: { clientId: 2, message: "hello" },
    poke: { clientId: 2, message: "hello" }, setAway: { away: true, message: "away" },
    setWhisperTargets: { targetIds: [2, 3] }, setWhisperActive: { active: true },
    setMicrophoneMuted: { muted: false }, setAccompanimentActive: { active: true },
    setMemberVolume: { clientId: 2, volume: 0 }, latencyProbe: { sequence: "old" }, audioStatsProbe: { sequence: "new" },
  };
  for (const [type, payload] of Object.entries(payloads)) {
    const command = { type, payload, requestId: "request-1" };
    assert.deepEqual(parseClientCommand(JSON.stringify(command)), command);
  }
});

test("optional chat destination guards reject malformed values and preserve legacy payloads", () => {
  for (const clientUid of ["", 7, "x".repeat(129)]) {
    assert.ok("error" in parseClientCommand(JSON.stringify({ type: "sendPrivateMessage", payload: { clientId: 2, message: "Hello", clientUid } })));
  }
  for (const channelId of ["", "-1", 1, "x".repeat(21)]) {
    assert.ok("error" in parseClientCommand(JSON.stringify({ type: "sendTextMessage", payload: { message: "Hello", channelId } })));
  }
  for (const payload of [{ clientId: 2, message: "Hello" }, { clientId: 2, clientUid: "user", message: "Hello" }]) {
    assert.deepEqual(parseClientCommand(JSON.stringify({ type: "sendPrivateMessage", payload })), { type: "sendPrivateMessage", payload });
  }
});

test("malformed commands keep existing public error codes", () => {
  const cases = [
    [{ type: "moveClient", payload: { clientId: 0, channelId: "1" } }, "INVALID_CLIENT_ID"],
    [{ type: "switchChannel", payload: { channelId: "1", password: "x".repeat(513) } }, "INVALID_CHANNEL_PASSWORD"],
    [{ type: "sendPrivateMessage", payload: { clientId: 1, message: "x".repeat(501) } }, "INVALID_TEXT_MESSAGE"],
    [{ type: "setWhisperTargets", payload: { targetIds: [2, 2] } }, "INVALID_WHISPER_TARGETS"],
    [{ type: "setMemberVolume", payload: { clientId: 1, volume: 4.1 } }, "INVALID_MEMBER_VOLUME"],
    [{ type: "setMicrophoneMuted", payload: { muted: "false" } }, "INVALID_MICROPHONE_STATE"],
    [{ type: "setAway", payload: { away: 1 } }, "INVALID_AWAY_STATUS"],
    [{ type: "future", payload: {} }, "UNKNOWN_MESSAGE_TYPE"],
  ] as const;
  for (const [value, code] of cases) {
    const parsed = parseClientCommand(JSON.stringify(value));
    assert.ok("error" in parsed);
    assert.equal(parsed.error.code, code);
  }
  assert.deepEqual(parseClientCommand("{"), { error: { code: "INVALID_JSON", message: "消息不是有效的 JSON" } });
});

test("screen signal bounds and ICE filtering are identical in both environments", () => {
  const message = { type: "screenShareSignal", streamId: "s", targetPeerId: "p", signal: { kind: "iceCandidate", candidate: "", sdpMid: null, sdpMLineIndex: 0 } };
  assert.deepEqual(parseScreenShareMessage(JSON.stringify(message)), message);
  const rejected = parseScreenShareMessage(JSON.stringify({ ...message, signal: { ...message.signal, sdpMLineIndex: 256 } }));
  assert.ok(rejected && "error" in rejected);
  assert.equal(rejected.error.code, "INVALID_SCREEN_SHARE_SIGNAL");
  assert.deepEqual(normalizeScreenShareIceServers([{ urls: ["https://invalid", " turn:relay.example.com ", "turn:relay.example.com"], username: "visitor", credential: "test" }]), [
    { urls: "turn:relay.example.com", username: "visitor", credential: "test" },
  ]);
});

// Checked by the backend TypeScript build as well as the runtime tests above.
// @ts-expect-error A microphone payload must never type-check as a move request.
const invalidCommand: ClientCommand = { type: "moveClient", payload: { muted: true } };
void invalidCommand;


test("invitation commands bound both expiry and optional creator credentials", () => {
 for(const payload of [{expiresInMinutes:0},{expiresInMinutes:43201},{expiresInMinutes:1.5},{expiresInMinutes:60,serverPassword:1},{expiresInMinutes:60,serverPassword:"x".repeat(513)},{expiresInMinutes:60,channelPassword:"x".repeat(513)}]) {
  assert.ok("error" in parseClientCommand(JSON.stringify({type:"createInvite",payload})));
 }
});
