import { computed, reactive, ref, type Ref } from "vue";
import type { ChannelMember } from "./useVoiceWebSocket.js";
import type { TreeChannel } from "./useWebClientChannels.js";

export interface MemberMenuState {
  member: ChannelMember;
  x: number;
  y: number;
}

interface UseWebClientMembersOptions {
  channels: Readonly<Ref<TreeChannel[]>>;
  currentChannel: Readonly<Ref<TreeChannel | undefined>>;
  members: ChannelMember[];
  speakingIds: Set<number>;
  whisperTargetIds: Set<number>;
  moveClient: (clientId: number, targetChannelId: string) => Promise<void>;
  setWhisperTargets: (clientIds: number[]) => void;
  sendPoke: (clientId: number, message: string) => void;
  setAway: (away: boolean, message: string) => void;
  stopWhisperTalk: () => void;
  localizedMessage: (message: string) => string;
  showToast: (message: string) => void;
  t: (key: string) => string;
}

export function useWebClientMembers({
  channels,
  currentChannel,
  members,
  speakingIds,
  whisperTargetIds,
  moveClient,
  setWhisperTargets,
  sendPoke,
  setAway,
  stopWhisperTalk,
  localizedMessage,
  showToast,
  t,
}: UseWebClientMembersOptions) {
  const away = ref(false);
  const awayMessage = ref("");
  const memberMenu = ref<MemberMenuState | null>(null);
  const memberMoveMenuOpen = ref(false);
  const draggedMember = ref<ChannelMember | null>(null);
  const dragOverChannelId = ref("");
  const memberPointerDrag = reactive({
    member: null as ChannelMember | null,
    pointerId: null as number | null,
    startX: 0,
    startY: 0,
    active: false,
    targetChannelId: "",
  });

  const memberMoveMenuCurrentChannel = computed<TreeChannel | null>(() => {
    const member = memberMenu.value?.member;
    const selected = currentChannel.value;
    if (!member || !selected || selected.id === "__current__") return null;
    return selected;
  });
  const memberMoveMenuCurrentSameChannel = computed(() => {
    const member = memberMenu.value?.member;
    const currentId = memberMoveMenuCurrentChannel.value?.id;
    if (!member || !currentId) return false;
    return channels.value.find((item) => item.members.some((candidate) => candidate.id === member.id))?.id === currentId;
  });
  const memberMoveMenuOtherChannels = computed<TreeChannel[]>(() => {
    const member = memberMenu.value?.member;
    if (!member) return [];
    const sourceChannelId = channels.value.find((item) => item.members.some((candidate) => candidate.id === member.id))?.id ?? "";
    const currentChannelId = memberMoveMenuCurrentChannel.value?.id;
    return channels.value.filter((item) => item.id !== "__current__" && item.id !== sourceChannelId && item.id !== currentChannelId);
  });

  function openMemberMenu(member: ChannelMember, event: Event): void {
    if (member.isSelf) return;
    memberMoveMenuOpen.value = false;
    const point = event instanceof MouseEvent ? event : undefined;
    memberMenu.value = {
      member,
      x: Math.min(point?.clientX ?? 20, Math.max(12, window.innerWidth - 210)),
      y: Math.min(point?.clientY ?? 20, Math.max(12, window.innerHeight - 170)),
    };
  }

  function openMemberActions(member: ChannelMember): void {
    if (member.isSelf) return;
    memberMoveMenuOpen.value = false;
    memberMenu.value = { member, x: 0, y: 0 };
  }

  function toggleMemberMoveMenu(): void {
    memberMoveMenuOpen.value = true;
  }

  async function moveMemberDirect(member: ChannelMember, targetChannelId: string): Promise<void> {
    if (member.isSelf || !targetChannelId || targetChannelId === "__current__") return;
    const sourceChannel = channels.value.find((item) => item.members.some((candidate) => candidate.id === member.id));
    if (sourceChannel?.id === targetChannelId) {
      memberMenu.value = null;
      memberMoveMenuOpen.value = false;
      return;
    }
    memberMenu.value = null;
    memberMoveMenuOpen.value = false;
    try {
      // Member moves are server-admin operations; never request or forward a channel password.
      await moveClient(member.id, targetChannelId);
      showToast(t("moveMemberSuccess"));
    } catch (error: unknown) {
      showToast(localizedMessage(error instanceof Error ? error.message : "操作失败"));
    }
  }

  function onMemberDragStart(member: ChannelMember, event: DragEvent): void {
    if (member.isSelf) {
      event.preventDefault();
      return;
    }
    draggedMember.value = member;
    dragOverChannelId.value = "";
    event.dataTransfer?.setData("text/plain", String(member.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onMemberDragEnd(): void {
    draggedMember.value = null;
    dragOverChannelId.value = "";
  }

  function onMemberPointerDown(member: ChannelMember, event: PointerEvent): void {
    if (member.isSelf || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input,button")) return;
    event.preventDefault();
    memberPointerDrag.member = member;
    memberPointerDrag.pointerId = event.pointerId;
    memberPointerDrag.startX = event.clientX;
    memberPointerDrag.startY = event.clientY;
    memberPointerDrag.active = false;
    memberPointerDrag.targetChannelId = "";
    const currentTarget = event.currentTarget as HTMLElement | null;
    currentTarget?.setPointerCapture?.(event.pointerId);
  }

  function onMemberPointerMove(event: PointerEvent): void {
    if (!memberPointerDrag.member || memberPointerDrag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - memberPointerDrag.startX, event.clientY - memberPointerDrag.startY);
    if (!memberPointerDrag.active && distance < 6) return;
    event.preventDefault();
    memberPointerDrag.active = true;
    draggedMember.value = memberPointerDrag.member;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-member-channel-id]");
    const targetChannelId = target?.dataset.memberChannelId ?? "";
    const sourceChannel = channels.value.find((item) => item.members.some((candidate) => candidate.id === memberPointerDrag.member?.id));
    if (!sourceChannel || !targetChannelId || targetChannelId === sourceChannel.id) {
      memberPointerDrag.targetChannelId = "";
      dragOverChannelId.value = "";
      return;
    }
    memberPointerDrag.targetChannelId = targetChannelId;
    dragOverChannelId.value = targetChannelId;
  }

  function onMemberPointerUp(event: PointerEvent): void {
    if (!memberPointerDrag.member || memberPointerDrag.pointerId !== event.pointerId) return;
    const member = memberPointerDrag.member;
    const targetChannelId = memberPointerDrag.targetChannelId;
    const currentTarget = event.currentTarget as HTMLElement | null;
    currentTarget?.releasePointerCapture?.(event.pointerId);
    memberPointerDrag.member = null;
    memberPointerDrag.pointerId = null;
    memberPointerDrag.active = false;
    memberPointerDrag.targetChannelId = "";
    draggedMember.value = null;
    dragOverChannelId.value = "";
    if (targetChannelId) void moveMemberDirect(member, targetChannelId);
  }

  function onMemberPointerCancel(event: PointerEvent): void {
    if (!memberPointerDrag.member || memberPointerDrag.pointerId !== event.pointerId) return;
    const currentTarget = event.currentTarget as HTMLElement | null;
    currentTarget?.releasePointerCapture?.(event.pointerId);
    memberPointerDrag.member = null;
    memberPointerDrag.pointerId = null;
    memberPointerDrag.active = false;
    memberPointerDrag.targetChannelId = "";
    draggedMember.value = null;
    dragOverChannelId.value = "";
  }

  function onChannelDragOver(channel: TreeChannel, event: DragEvent): void {
    const member = draggedMember.value;
    if (!member || channel.id === "__current__") return;
    const sourceChannel = channels.value.find((item) => item.members.some((candidate) => candidate.id === member.id));
    if (!sourceChannel || sourceChannel.id === channel.id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOverChannelId.value = channel.id;
  }

  function onChannelDragLeave(channel: TreeChannel, event: DragEvent): void {
    const currentTarget = event.currentTarget;
    const relatedTarget = event.relatedTarget;
    if (currentTarget instanceof HTMLElement && relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) return;
    if (dragOverChannelId.value === channel.id) dragOverChannelId.value = "";
  }

  function onChannelDrop(channel: TreeChannel, event: DragEvent): void {
    event.preventDefault();
    const member = draggedMember.value;
    onMemberDragEnd();
    if (!member || channel.id === "__current__") return;
    void moveMemberDirect(member, channel.id);
  }

  function toggleWhisperTarget(member: ChannelMember): void {
    if (member.isSelf) return;
    const targets = new Set(whisperTargetIds);
    if (targets.has(member.id)) targets.delete(member.id);
    else if (targets.size < 8) targets.add(member.id);
    setWhisperTargets([...targets]);
    showToast(t(targets.has(member.id) ? "setWhisperTarget" : "removeWhisperTarget"));
  }

  function clearWhisperTargets(): void {
    stopWhisperTalk();
    setWhisperTargets([]);
  }

  function pokeMember(member: ChannelMember): void {
    sendPoke(member.id, window.prompt(t("pokeMessagePrompt"), "") ?? "");
    showToast(t("pokeSent"));
  }

  function copyMemberName(member: ChannelMember): void {
    navigator.clipboard?.writeText(member.nickname).then(
      () => showToast(t("copiedNickname")),
      () => showToast(t("copyFailedToast")),
    );
  }

  function toggleAway(): void {
    away.value = !away.value;
    awayMessage.value = away.value ? (window.prompt(t("awayPrompt"), awayMessage.value) ?? "") : "";
    setAway(away.value, awayMessage.value);
  }

  function isSpeaking(member: ChannelMember): boolean {
    return speakingIds.has(member.id);
  }

  function memberDisplayName(member: ChannelMember): string {
    return member.isSelf ? `${member.nickname}${t("selfSuffix")}` : member.nickname;
  }

  return {
    away,
    memberMenu,
    memberMoveMenuOpen,
    draggedMember,
    dragOverChannelId,
    memberPointerDrag,
    memberMoveMenuCurrentChannel,
    memberMoveMenuCurrentSameChannel,
    memberMoveMenuOtherChannels,
    openMemberMenu,
    openMemberActions,
    toggleMemberMoveMenu,
    moveMemberDirect,
    onMemberDragStart,
    onMemberDragEnd,
    onMemberPointerDown,
    onMemberPointerMove,
    onMemberPointerUp,
    onMemberPointerCancel,
    onChannelDragOver,
    onChannelDragLeave,
    onChannelDrop,
    toggleWhisperTarget,
    clearWhisperTargets,
    pokeMember,
    copyMemberName,
    toggleAway,
    isSpeaking,
    memberDisplayName,
  };
}
