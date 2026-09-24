import { computed, nextTick, ref, watch, type Ref } from "vue";
import type { ChannelInfo, ChannelMember, ChatMessage } from "./useVoiceWebSocket.js";

export type WebClientChatTab = "channel" | "server" | "private" | "events";

interface PrivateConversation {
  id: number;
  name: string;
  lastMessage: number;
}

interface UseWebClientChatOptions {
  messages: ChatMessage[];
  members: ChannelMember[];
  currentChannel: Readonly<Ref<ChannelInfo | undefined>>;
  currentChannelName: Readonly<Ref<string>>;
  selectedChannelId: Ref<string>;
  clientId: Readonly<Ref<number>>;
  isMobileViewport: Readonly<Ref<boolean>>;
  mobileSection: Ref<"channels" | "chat" | "voice" | "more">;
  closeMemberMenu: () => void;
  sendTextMessage: (text: string, targetId?: string) => void;
  sendServerMessage: (text: string) => void;
  sendPrivateMessage: (clientId: number, text: string, conversationId?: string) => void;
  notifyPrivateMessage: () => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
}

export function useWebClientChat({
  messages,
  members,
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
  const privateClientId = ref(0);
  const messageDraft = ref("");
  const listElement = ref<HTMLElement | null>(null);

  const conversations = computed<PrivateConversation[]>(() => {
    const byConversation = new Map<string, PrivateConversation>();
    for (const message of messages) {
      if (message.scope !== "private" || !message.conversationId) continue;
      const id = Number(message.conversationId);
      if (!id) continue;
      const member = members.find((candidate) => candidate.id === id);
      const existing = byConversation.get(message.conversationId);
      byConversation.set(message.conversationId, {
        id,
        name: member?.nickname ?? existing?.name ?? message.invokerName,
        lastMessage: Math.max(existing?.lastMessage ?? 0, message.timestamp),
      });
    }
    return [...byConversation.values()].sort((left, right) => right.lastMessage - left.lastMessage);
  });

  const visibleMessages = computed(() => {
    if (tab.value === "server") return messages.filter((message) => message.scope === "server");
    if (tab.value === "private") return messages.filter((message) => message.scope === "private" && message.conversationId === String(privateClientId.value));
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
        : conversations.value.find((conversation) => conversation.id === privateClientId.value)?.name ?? t("privateMessage"));
  const placeholder = computed(() => tab.value === "private" ? t("privateMessagePlaceholder") : tab.value === "server" ? t("serverMessagePlaceholder") : t("sendMessagePlaceholder"));

  function scrollToEnd(): void {
    const list = listElement.value;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }

  function openPrivateChat(targetClientId: number): void {
    if (!targetClientId || targetClientId === clientId.value) return;
    privateClientId.value = targetClientId;
    tab.value = "private";
    if (isMobileViewport.value) mobileSection.value = "chat";
    closeMemberMenu();
    void nextTick(scrollToEnd);
  }

  function submitMessage(): void {
    if (!messageDraft.value.trim()) return;
    if (tab.value === "channel") sendTextMessage(messageDraft.value, currentChannel.value?.id ?? selectedChannelId.value);
    else if (tab.value === "server") sendServerMessage(messageDraft.value);
    else if (tab.value === "private" && privateClientId.value) sendPrivateMessage(privateClientId.value, messageDraft.value, String(privateClientId.value));
    messageDraft.value = "";
  }

  watch([() => messages.length, tab, privateClientId], () => { void nextTick(scrollToEnd); });
  watch(() => messages.length, (length, previousLength) => {
    const latest = messages[length - 1];
    if (latest && length > previousLength && latest.scope === "private" && !latest.isSelf) notifyPrivateMessage();
  });

  return {
    tab,
    privateClientId,
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
