import assert from "node:assert/strict";
import test from "node:test";
import {
  projectSkinRuntimePluginContext,
  SKIN_RUNTIME_PLUGIN_CONTEXT_LIMIT_BYTES,
} from "./skin-runtime-plugin-context.js";

test("runtime context exposes only fields covered by declared read permissions", () => {
  const projected = projectSkinRuntimePluginContext(["session.channels.read"], {
    session: {
      status: { connected: true, serverLabel: "voice.internal.example:9987" },
      channels: [{ id: "channel-1", name: "Lobby", parentId: null, depth: 0, memberCount: 2, current: true, address: "voice.internal.example:9987", members: [{ name: "private nested member" }] }],
      members: [{ id: "member-1", name: "private member" }],
    },
    favorites: { items: [{ id: "opaque-1", label: "Saved", address: "secret.example:9987" }] },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(projected)), {
    session: {
      channels: [{ id: "channel-1", name: "Lobby", parentId: null, depth: 0, memberCount: 2, current: true }],
    },
  });
  assert.equal(JSON.stringify(projected).includes("voice.internal.example"), false);
  assert.equal(JSON.stringify(projected).includes("secret.example"), false);
});

test("runtime context redacts connection targets from quick-list labels and drops server labels", () => {
  const projected = projectSkinRuntimePluginContext(
    ["session.status.read", "favorites.read", "servers.quickList.read"],
    {
      session: { status: { connected: true, serverLabel: "192.0.2.55:9987", channelName: "Lobby" } },
      favorites: { items: [{ id: "opaque-favorite", label: "Saved voice.internal.example:9987", kind: "favorite" }] },
      servers: { quickList: [
        { id: "opaque-favorite", label: "Saved [2001:db8::1]:9987", favorite: true, kind: "favorite" },
        { id: "opaque-recent", label: "Quick connect 192.0.2.55", favorite: false, kind: "recent" },
      ] },
    },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(projected)), {
    session: { status: { connected: true, channelName: "Lobby" } },
    favorites: { items: [{ id: "opaque-favorite", label: "Favorite 1", kind: "favorite" }] },
    servers: { quickList: [
      { id: "opaque-favorite", label: "Favorite 1", favorite: true, kind: "favorite" },
      { id: "opaque-recent", label: "Recent 2", favorite: false, kind: "recent" },
    ] },
  });
  assert.equal(JSON.stringify(projected).includes("192.0.2.55"), false);
  assert.equal(JSON.stringify(projected).includes("internal.example"), false);
  assert.equal(JSON.stringify(projected).includes("2001:db8::1"), false);
});

test("profile-picture display permission does not expose image data to declarative or Wasm contexts", () => {
  const context = {
    session: {
      members: [{ id: "member-1", name: "Visible member", channelId: "channel-1", status: "online", speaking: false, self: false, avatar: "data:image/png;base64,cHJpdmF0ZQ==" }],
    },
  };
  const displayOnly = projectSkinRuntimePluginContext(["session.memberAvatars.read"], context);
  assert.deepEqual(JSON.parse(JSON.stringify(displayOnly)), {});

  const readableMembers = projectSkinRuntimePluginContext(["session.members.read", "session.memberAvatars.read"], context);
  assert.deepEqual(JSON.parse(JSON.stringify(readableMembers)), {
    session: {
      members: [{ id: "member-1", name: "Visible member", channelId: "channel-1", status: "online", speaking: false, self: false }],
    },
  });
  assert.equal(JSON.stringify(readableMembers).includes("data:image"), false);
});

test("large runtime context is capped across separately bounded collections", () => {
  const projected = projectSkinRuntimePluginContext(["session.channels.read", "chat.channel.read"], {
    session: {
      channels: Array.from({ length: 1_000 }, (_, index) => ({
        id: `channel-${index}`,
        name: `Channel ${index} ${"x".repeat(150)}`,
        depth: index % 4,
        memberCount: index,
        current: index === 0,
      })),
    },
    chat: {
      messages: Array.from({ length: 50 }, (_, index) => ({
        id: `message-${index}`,
        text: "x".repeat(1_024),
        kind: "message",
      })),
    },
  });
  const channels = (projected.session as { channels: unknown[] }).channels;
  const messages = (projected.chat as { messages: unknown[] }).messages;

  assert.ok(channels.length <= 128, "the channel count remains bounded");
  assert.ok(messages.length < 50, "the global byte cap trims a large collection");
  assert.ok(new TextEncoder().encode(JSON.stringify(projected)).byteLength <= SKIN_RUNTIME_PLUGIN_CONTEXT_LIMIT_BYTES);
});
