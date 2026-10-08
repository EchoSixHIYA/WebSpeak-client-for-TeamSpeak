import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "./useVoiceWebSocket.js";
import { privateConversationKey, privateConversationKeyForTarget } from "./useWebClientChat.js";

function privateMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message-1",
    scope: "private",
    conversationId: "17",
    conversationName: "Avery",
    invokerName: "Avery",
    message: "hello",
    timestamp: 1,
    ...overrides,
  };
}

test("private chat opened from a member uses the message's stable UID key", () => {
  const targetKey = privateConversationKeyForTarget(17, "peer-uid", "Avery");
  const messageKey = privateConversationKey(privateMessage({ conversationUid: "peer-uid" }));
  assert.equal(targetKey, messageKey);
});

test("private chat opened from a member uses the name-aware fallback key", () => {
  const targetKey = privateConversationKeyForTarget(17, undefined, "Avery");
  const messageKey = privateConversationKey(privateMessage());
  assert.equal(targetKey, messageKey);
  assert.notEqual(targetKey, privateConversationKeyForTarget(17, undefined, "Morgan"));
});
