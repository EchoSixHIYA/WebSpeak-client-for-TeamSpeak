import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "../composables/useVoiceWebSocket.js";
import { getChatHistoryConversationKey, normalizeChatHistoryServerKey } from "./local-persistence.js";

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "message-1",
    scope: "channel",
    invokerName: "Avery",
    message: "hello",
    timestamp: 1,
    ...overrides,
  };
}

test("normalizes server targets without merging different endpoints", () => {
  assert.equal(normalizeChatHistoryServerKey("  TS.Example.COM:9987  "), "ts.example.com:9987");
  assert.notEqual(normalizeChatHistoryServerKey("ts.example.com:9987"), normalizeChatHistoryServerKey("ts.example.com:9988"));
  assert.equal(normalizeChatHistoryServerKey(""), "__default__");
});

test("uses separate history partitions for channels and server chat", () => {
  assert.equal(getChatHistoryConversationKey(message({ scope: "channel", targetId: "42" })), "channel:42");
  assert.equal(getChatHistoryConversationKey(message({ scope: "channel", targetId: "43" })), "channel:43");
  assert.equal(getChatHistoryConversationKey(message({ scope: "server" })), "server");
});

test("uses a stable TeamSpeak UID for private history across client-ID changes", () => {
  const firstSession = message({ scope: "private", conversationId: "17", conversationUid: "peer-uid" });
  const nextSession = message({ scope: "private", conversationId: "29", conversationUid: "peer-uid" });
  assert.equal(getChatHistoryConversationKey(firstSession), "private:uid:peer-uid");
  assert.equal(getChatHistoryConversationKey(nextSession), getChatHistoryConversationKey(firstSession));
});

test("keeps fallback private conversations apart when client IDs are reused", () => {
  const firstPeer = message({ scope: "private", conversationId: "17", conversationName: "Avery" });
  const secondPeer = message({ scope: "private", conversationId: "17", conversationName: "Morgan" });
  assert.notEqual(getChatHistoryConversationKey(firstPeer), getChatHistoryConversationKey(secondPeer));
  assert.equal(getChatHistoryConversationKey(message({ scope: "system" })), null);
});
