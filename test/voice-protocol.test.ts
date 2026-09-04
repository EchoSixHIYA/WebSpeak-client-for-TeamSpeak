import assert from "node:assert/strict";
import test from "node:test";
import { parseClientCommand } from "../src/server/voice-protocol.js";

test("voice protocol accepts the versioned command payload", () => {
  const command = parseClientCommand(JSON.stringify({
    type: "switchChannel",
    requestId: "switch-1",
    payload: { channelId: "42" },
  }));
  assert.deepEqual(command, {
    type: "switchChannel",
    requestId: "switch-1",
    payload: { channelId: "42" },
  });
});

test("voice protocol rejects malformed and unsupported commands", () => {
  assert.deepEqual(parseClientCommand("not-json"), {
    error: { code: "INVALID_JSON", message: "消息不是有效的 JSON" },
  });
  assert.equal("error" in parseClientCommand(JSON.stringify({ type: "unknown", payload: {} })), true);
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "sendTextMessage" })), {
    error: { code: "INVALID_PAYLOAD", message: "消息参数无效" },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "sendTextMessage", payload: { message: "x".repeat(501) } })), {
    error: { code: "INVALID_TEXT_MESSAGE", message: "文字消息无效" },
  });
});

test("voice protocol keeps chat scopes and status actions explicit", () => {
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "sendPrivateMessage", requestId: "pm-1", payload: { clientId: 7, message: "hello" } })), {
    type: "sendPrivateMessage",
    requestId: "pm-1",
    payload: { clientId: 7, message: "hello" },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setAway", payload: { away: true, message: "back soon" } })), {
    type: "setAway",
    payload: { away: true, message: "back soon" },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "switchChannel", payload: { channelId: "42", password: "secret" } })), {
    type: "switchChannel",
    payload: { channelId: "42", password: "secret" },
  });
});

test("voice protocol rejects unsafe client and away payloads", () => {
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "poke", payload: { clientId: 0, message: "hi" } })), {
    error: { code: "INVALID_CLIENT_ID", message: "成员标识无效" },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setAway", payload: { away: "yes" } })), {
    error: { code: "INVALID_AWAY_STATUS", message: "离开状态无效" },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "switchChannel", payload: { channelId: "42", password: "x".repeat(513) } })), {
    error: { code: "INVALID_CHANNEL_PASSWORD", message: "频道密码无效" },
  });
});

test("voice protocol validates whisper targets and its independent push state", () => {
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setWhisperTargets", requestId: "whisper-1", payload: { targetIds: [7, 9] } })), {
    type: "setWhisperTargets",
    requestId: "whisper-1",
    payload: { targetIds: [7, 9] },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setWhisperActive", payload: { active: true } })), {
    type: "setWhisperActive",
    payload: { active: true },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setWhisperTargets", payload: { targetIds: [7, 7] } })), {
    error: { code: "INVALID_WHISPER_TARGETS", message: "私语目标无效" },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setWhisperActive", payload: { active: "yes" } })), {
    error: { code: "INVALID_WHISPER_STATE", message: "私语状态无效" },
  });
});

test("voice protocol accepts and validates the microphone mute state", () => {
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setMicrophoneMuted", payload: { muted: true } })), {
    type: "setMicrophoneMuted",
    payload: { muted: true },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setMicrophoneMuted", payload: { muted: "yes" } })), {
    error: { code: "INVALID_MICROPHONE_STATE", message: "麦克风状态无效" },
  });
});

test("voice protocol accepts and validates the accompaniment state", () => {
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setAccompanimentActive", payload: { active: true } })), {
    type: "setAccompanimentActive",
    payload: { active: true },
  });
  assert.deepEqual(parseClientCommand(JSON.stringify({ type: "setAccompanimentActive", payload: { active: "yes" } })), {
    error: { code: "INVALID_ACCOMPANIMENT_STATE", message: "伴奏状态无效" },
  });
});
