import { computed, nextTick, ref, watch, type Ref } from "vue";
import type { ChannelInfo, ChannelMember, ChatMessage } from "./useVoiceWebSocket.js";

export type WebClientChatTab = "channel" | "server" | "private" | "events";

interface PrivateConversation {
  key: string;
  id: number;
  uid?: string;
  name: string;
  lastMessage: number;
  online: boolean;
}

function privateConversationKey(message: ChatMessage): string | null {
  if (message.scope !== "private") return null;
  if (message.conversationUid) return `uid:${message.conversationUid}`;
  const clientId = Number(message.conversationId) || message.senderId;
  const peerName = message.conversationName || (message.isSelf ? "" : message.invokerName);
  return clientId ? `client:${JSON.stringify([clientId, peerName])}` : null;
}

interface UseWebClientChatOptions {
  messages: ChatMessage[];
  members: ChannelMember[];
  channels: ChannelInfo[];
  currentChannel: Readonly<Ref<ChannelInfo | undefined>>;
  currentChannelName: Readonly<Ref<string>>;
  selectedChannelId: Ref<string>;
  clientId: Readonly<Ref<number>>;
  isMobileViewport: Readonly<Ref<boolean>>;
  mobileSection: Ref<"channels" | "chat" | "voice" | "more">;
  closeMemberMenu: () => void;
  sendTextMessage: (text: string, targetId?: string) => void;
  sendServerMessage: (text: string) => void;
  sendPrivateMessage: (clientId: number, text: string, conversationId?: string, conversationUid?: string, conversationName?: string) => void;
  notifyPrivateMessage: () => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
}

export function useWebClientChat({
  messages,
  members,
  channels,
  currentChannel,
  currentChannelName,
  selectedChannelId,
  clientId,
  isMobileViewport,
  mobileSection,
  closeMemberMenu,
  sendTextMessage,
  sendServerMessage,
  sendPrivateMessage,
  notifyPrivateMessage,
  t,
}: UseWebClientChatOptions) {
  const tab = ref<WebClientChatTab>("channel");
  const selectedPrivateConversationKey = ref("");
  const messageDraft = ref("");
  const listElement = ref<HTMLElement | null>(null);

  const conversations = computed<PrivateConversation[]>(() => {
    const byConversation = new Map<string, PrivateConversation>();
    const allMembers = [...members, ...channels.flatMap((channel) => channel.members ?? [])];
    const activeConversationKeys = new Set(messages
      .filter((message) => !message.isHistory)
      .map(privateConversationKey)
      .filter((key): key is string => key !== null));
    for (const message of messages) {
      const key = privateConversationKey(message);
      if (!key) continue;
      const id = Number(message.conversationId) || message.senderId || 0;
      const uid = message.conversationUid;
      const member = uid
        ? allMembers.find((candidate) => candidate.uid === uid)
        : activeConversationKeys.has(key) ? allMembers.find((candidate) => candidate.id === id) : undefined;
      const existing = byConversation.get(key);
      const messageName = message.conversationName || (message.isSelf ? "" : message.invokerName);
      byConversation.set(key, {
        key,
        id: member?.id ?? (uid ? 0 : id),
        ...(uid ? { uid } : {}),
        name: member?.nickname ?? (messageName || existing?.name || t("privateMessage")),
        lastMessage: Math.max(existing?.lastMessage ?? 0, message.timestamp),
        online: Boolean(member),
      });
    }
    return [...byConversation.values()].sort((left, right) => right.lastMessage - left.lastMessage);
  });

  const selectedPrivateConversation = computed(() => conversations.value.find((conversation) => conversation.key === selectedPrivateConversationKey.value));
  const privateConversationOnline = computed(() => selectedPrivateConversation.value?.online ?? false);

  const visibleMessages = computed(() => {
    if (tab.value === "server") return messages.filter((message) => message.scope === "server");
    if (tab.value === "private") return messages.filter((message) => privateConversationKey(message) === selectedPrivateConversationKey.value);
    if (tab.value !== "channel") return [];
    const channelId = currentChannel.value?.id;
    return messages.filter((message) => message.scope === "channel" && (!message.targetId || message.targetId === "0" || !channelId || message.targetId === channelId));
  });

  const tabLabel = computed(() => tab.value === "channel" ? t("textChannel") : tab.value === "server" ? t("serverChat") : tab.value === "private" ? t("privateMessage") : t("eventLog"));
  const title = computed(() => tab.value === "channel"
    ? t("channelChat", { channel: currentChannelName.value })
    : tab.value === "server"
      ? t("serverChat")
      : tab.value === "events"
        ? t("eventLog")
        : selectedPrivateConversation.value?.name ?? t("privateMessage"));
  const placeholder = computed(() => tab.value === "private"
    ? privateConversationOnline.value ? t("privateMessagePlaceholder") : t("privateChatOffline")
    : tab.value === "server" ? t("serverMessagePlaceholder") : t("sendMessagePlaceholder"));

  function scrollToEnd(): void {
    const list = listElement.value;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }

  function openPrivateChat(targetClientId: number, targetUid?: string): void {
    if ((!targetClientId && !targetUid) || (targetClientId > 0 && targetClientId === clientId.value)) return;
    selectedPrivateConversationKey.value = targetUid ? `uid:${targetUid}` : `client:${targetClientId}`;
    tab.value = "private";
    if (isMobileViewport.value) mobileSection.value = "chat";
    closeMemberMenu();
    void nextTick(scrollToEnd);
  }

  function submitMessage(): void {
    if (!messageDraft.value.trim()) return;
    if (tab.value === "channel") sendTextMessage(messageDraft.value, currentChannel.value?.id ?? selectedChannelId.value);
    else if (tab.value === "server") sendServerMessage(messageDraft.value);
    else if (tab.value === "private") {
      const conversation = selectedPrivateConversation.value;
      if (!conversation?.online || !conversation.id) return;
      sendPrivateMessage(conversation.id, messageDraft.value, String(conversation.id), conversation.uid, conversation.name);
    }
    messageDraft.value = "";
  }

  watch([() => messages.length, tab, selectedPrivateConversationKey], () => { void nextTick(scrollToEnd); });
  watch(() => messages.length, (length, previousLength) => {
    const latest = messages[length - 1];
    if (latest && length > previousLength && latest.scope === "private" && !latest.isSelf && !latest.isHistory) notifyPrivateMessage();
  });

  return {
    tab,
    privateConversationKey: selectedPrivateConversationKey,
    privateConversationOnline,
    messageDraft,
    listElement,
    conversations,
    visibleMessages,
    tabLabel,
    title,
    placeholder,
    openPrivateChat,
    submitMessage,
    scrollToEnd,
  };
}
