import assert from "node:assert/strict";
import test from "node:test";
import { computed, ref } from "vue";
import type { ChannelMember } from "../composables/useVoiceWebSocket.js";
import { useWebClientMembers } from "../composables/useWebClientMembers.js";
import { buildVoiceChannelTree, filterVoiceChannelTree } from "./voice-channel-tree.js";
import { memberPresenceKey } from "./member-presence.js";

test("channel search keeps matching nested channels and only their ancestors", () => {
  const tree = buildVoiceChannelTree([
    { id: "root", depth: 0, name: "大厅" },
    { id: "lobby", depth: 1, name: "聊天大厅" },
    { id: "games", depth: 1, name: "游戏区" },
    { id: "afk", depth: 2, name: "AFK" },
    { id: "music", depth: 2, name: "音乐" },
    { id: "other", depth: 0, name: "其他" },
  ]);

  const results = filterVoiceChannelTree(tree, "  afk ");
  assert.deepEqual(results.map(({ channel }) => channel.id), ["root"]);
  assert.deepEqual(results[0].children.map(({ channel }) => channel.id), ["games"]);
  assert.deepEqual(results[0].children[0].children.map(({ channel }) => channel.id), ["afk"]);
  assert.deepEqual(filterVoiceChannelTree(tree, "大厅").map(({ channel }) => channel.id), ["root"]);
  assert.deepEqual(filterVoiceChannelTree(tree, "missing"), []);
  assert.deepEqual(filterVoiceChannelTree(tree, " "), tree);
});

test("member volume controls do not begin native drag while member rows remain draggable", () => {
  class TestElement {
    constructor(private readonly control: boolean) {}
    closest(): TestElement | null { return this.control ? this : null; }
    setPointerCapture(): void {}
    releasePointerCapture(): void {}
  }

  const previousElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  Object.defineProperty(globalThis, "Element", { configurable: true, value: TestElement });
  try {
    const member = { id: 12, nickname: "Member", isSelf: false } as ChannelMember;
    const channel = { id: "voice", parentID: "0", name: "Voice", depth: 0, members: [member] };
    const controller = useWebClientMembers({
      channels: ref([channel]),
      currentChannel: computed(() => channel),
      members: [member],
      speakingIds: new Set<number>(),
      whisperTargetIds: new Set<number>(),
      moveClient: async () => {},
      setWhisperTargets: () => {},
      sendPoke: () => {},
      setAway: () => {},
      stopWhisperTalk: () => {},
      localizedMessage: (message) => message,
      showToast: () => {},
      t: (key) => key,
    });
    const row = new TestElement(false);
    let pointerPrevented = false;
    controller.onMemberPointerDown(member, {
      target: new TestElement(true), currentTarget: row, button: 0, pointerId: 1, clientX: 10, clientY: 10,
      preventDefault: () => { pointerPrevented = true; },
    } as unknown as PointerEvent);
    assert.equal(pointerPrevented, false, "the slider keeps its pointer interaction");

    let dragPrevented = false;
    controller.onMemberDragStart(member, {
      preventDefault: () => { dragPrevented = true; },
      dataTransfer: null,
    } as unknown as DragEvent);
    assert.equal(dragPrevented, true, "a slider drag cannot start the enclosing member drag");
    assert.equal(controller.draggedMember.value, null);

    controller.onMemberPointerUp({ pointerId: 1 } as PointerEvent);
    controller.onMemberPointerDown(member, {
      target: row, currentTarget: row, button: 0, pointerId: 2, clientX: 10, clientY: 10,
      preventDefault: () => {},
    } as unknown as PointerEvent);
    dragPrevented = false;
    controller.onMemberDragStart(member, {
      preventDefault: () => { dragPrevented = true; },
      dataTransfer: null,
    } as unknown as DragEvent);
    assert.equal(dragPrevented, false, "dragging the member row itself remains available");
  } finally {
    if (previousElement) Object.defineProperty(globalThis, "Element", previousElement);
    else Reflect.deleteProperty(globalThis, "Element");
  }
});

test("channel members without an away flag are presented as online, never as an unknown state", () => {
  assert.equal(memberPresenceKey({ away: undefined, isSelf: false }, false), "memberOnline");
  assert.equal(memberPresenceKey({ away: undefined, isSelf: true }, false), "yourDevice");
  assert.equal(memberPresenceKey({ away: undefined, isSelf: false }, true), "speaking");
  assert.equal(memberPresenceKey({ away: true, isSelf: false }, false), "away");
});
