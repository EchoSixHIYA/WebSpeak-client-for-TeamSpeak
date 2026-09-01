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
