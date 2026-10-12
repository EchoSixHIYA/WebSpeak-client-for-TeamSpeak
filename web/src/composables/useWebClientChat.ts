import { computed, nextTick, onScopeDispose, ref, watch, type Ref } from "vue";
import type { ChannelInfo, ChannelMember, ChatMessage } from "./useVoiceWebSocket.js";
import { loadChatHistory, normalizeChatHistoryServerKey, saveChatHistoryMessage } from "../services/local-persistence.js";

export type WebClientChatTab = "channel" | "server" | "private" | "events";

interface PrivateConversation {
  id: number;
  key: string;
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
  connected: Readonly<Ref<boolean>>;
  sessionEpoch: Readonly<Ref<number>>;
  serverKey: Readonly<Ref<string>>;
  isMobileViewport: Readonly<Ref<boolean>>;
  mobileSection: Ref<"channels" | "chat" | "voice" | "more">;
  closeMemberMenu: () => void;
  sendTextMessage: (text: string, targetId?: string) => Promise<void>;
  sendServerMessage: (text: string) => Promise<void>;
  sendPrivateMessage: (clientId: number, text: string, conversationId?: string, expectedKey?: string) => Promise<void>;
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
  connected,
  sessionEpoch,
  serverKey,
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
  const panelOpen = ref(!isMobileViewport.value);
  const privateClientId = ref(0);
  const privateConversationKey = ref("");
  const messageDraft = ref("");
  const listElement = ref<HTMLElement | null>(null);
  const sending = ref(false);
  const sendError = ref("");
  const drafts = new Map<string, string>();
  const pending = new Map<string, object>();
  const errors = new Map<string, string>();
  let disposed = false;
  let followingLatest = true;
  let scrollGeneration = 0;
  let historyGeneration = 0;
  const persistedMessageIds = new Set<string>();
  const memberKey = (member: ChannelMember) => member.uid ? `uid:${member.uid}` : `client:${JSON.stringify([member.id, member.nickname])}`;
  const recipient = computed(() => members.find(member => member.id === privateClientId.value && memberKey(member) === privateConversationKey.value));
  const destination = computed(() => `${sessionEpoch.value}:${tab.value}:${tab.value === "private" ? privateConversationKey.value : tab.value === "channel" ? currentChannel.value?.id ?? selectedChannelId.value : ""}`);
  const canSend = computed(() => connected.value && !sending.value && tab.value !== "events" && (tab.value !== "private" || Boolean(recipient.value)));
  const status = computed(() => sendError.value ? t(sendError.value) : sending.value ? t("chatSending")
    : !connected.value ? t("chatNotConnected") : tab.value === "private" && !recipient.value ? t("chatTargetUnavailable") : "");
  const messageKey = (message: ChatMessage) => {
    if (message.scope !== "private") return `legacy:${message.id}`;
    if (message.conversationKey?.startsWith("uid:")) return message.conversationKey;
    if (message.senderUid && !message.isSelf) return `uid:${message.senderUid}`;
    const id = Number(message.conversationId) || message.senderId || 0;
    const name = message.conversationName || (message.isSelf ? "" : message.invokerName);
    return id ? `client:${JSON.stringify([id, name])}` : `legacy:${message.id}`;
  };

  const conversations = computed<PrivateConversation[]>(() => {
    const byConversation = new Map<string, PrivateConversation>();
    for (const message of messages) {
      if (message.scope !== "private" || !message.conversationId) continue;
      const id = Number(message.conversationId);
      if (!id) continue;
      const key = messageKey(message);
      const member = members.find(candidate => memberKey(candidate) === key);
      const existing = byConversation.get(key);
      byConversation.set(key, {
        id: member?.id ?? id, key,
        name: member?.nickname ?? message.conversationName ?? existing?.name ?? (message.isSelf ? t("privateMessage") : message.invokerName),
        lastMessage: Math.max(existing?.lastMessage ?? 0, message.timestamp),
      });
    }
    // A newly opened private chat has no message from which to derive a tab.
    // Keep the selected recipient visible so the first message can be sent and
    // the empty state still has a named conversation.
    if (tab.value === "private" && privateConversationKey.value && privateClientId.value) {
      const selected = recipient.value;
      const existing = byConversation.get(privateConversationKey.value);
      byConversation.set(privateConversationKey.value, {
        id: selected?.id ?? existing?.id ?? privateClientId.value,
        key: privateConversationKey.value,
        name: selected?.nickname ?? existing?.name ?? t("privateMessage"),
        lastMessage: existing?.lastMessage ?? 0,
      });
    }
    return [...byConversation.values()].sort((left, right) => right.lastMessage - left.lastMessage);
  });

  const visibleMessages = computed(() => {
    if (tab.value === "server") return messages.filter((message) => message.scope === "server");
    if (tab.value === "private") return messages.filter(message => message.scope === "private" && messageKey(message) === privateConversationKey.value);
    if (tab.value !== "channel") return [];
    const channelId = currentChannel.value?.id || selectedChannelId.value;
    return messages.filter((message) => message.scope === "channel"
      && (!message.targetId || message.targetId === "0" || (channelId ? message.targetId === channelId : false)));
  });

  const tabLabel = computed(() => tab.value === "channel" ? t("textChannel") : tab.value === "server" ? t("serverChat") : tab.value === "private" ? t("privateMessage") : t("eventLog"));
  const title = computed(() => tab.value === "channel"
    ? t("channelChat", { channel: currentChannelName.value })
    : tab.value === "server"
      ? t("serverChat")
      : tab.value === "events"
        ? t("eventLog")
        : recipient.value?.nickname ?? conversations.value.find(conversation => conversation.key === privateConversationKey.value)?.name ?? t("privateMessage"));
  const placeholder = computed(() => tab.value === "private" ? t("privateMessagePlaceholder") : tab.value === "server" ? t("serverMessagePlaceholder") : t("sendMessagePlaceholder"));

  function scrollToEnd(): void {
    const list = listElement.value;
    if (!disposed && list && (!isMobileViewport.value || mobileSection.value === "chat")) {
      followingLatest = true;
      list.scrollTo({ top: list.scrollHeight, behavior: "auto" });
    }
  }

  function onScroll(): void {
    const list = listElement.value;
    if (list && list.clientHeight > 0) followingLatest = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  }

  function scrollIfFollowing(): void {
    if (!followingLatest) return;
    const generation = scrollGeneration;
    void nextTick(() => {
      if (generation === scrollGeneration && followingLatest) scrollToEnd();
    });
  }

  function openPrivateChat(targetClientId: number): void {
    const member = members.find(candidate => candidate.id === targetClientId);
    if (!member || targetClientId === clientId.value) return;
    const key = memberKey(member);
    openConversation({ id: targetClientId, key, name: member.nickname, lastMessage: 0 });
  }

  function openConversation(conversation: PrivateConversation): void {
    if (disposed) return;
    panelOpen.value = true;
    privateClientId.value = conversation.id;
    privateConversationKey.value = conversation.key;
    tab.value = "private";
    if (isMobileViewport.value) mobileSection.value = "chat";
    closeMemberMenu();
    followingLatest = true;
    scrollIfFollowing();
  }

  function togglePanel(): void {
    panelOpen.value = !panelOpen.value;
  }

  async function submitMessage(): Promise<void> {
    if (disposed || sending.value || !messageDraft.value.trim() || tab.value === "events") return;
    if (!connected.value) { sendError.value = "chatNotConnected"; return; }
    if (tab.value === "private" && !recipient.value) { sendError.value = "chatTargetUnavailable"; return; }
    const text = messageDraft.value;
    const key = destination.value;
    const operation = {};
    pending.set(key, operation);
    errors.delete(key);
    const isCurrent = () => !disposed && pending.get(key) === operation;
    sending.value = true;
    sendError.value = "";
    try {
      if (tab.value === "channel") await sendTextMessage(text, currentChannel.value?.id ?? selectedChannelId.value);
      else if (tab.value === "server") await sendServerMessage(text);
      else await sendPrivateMessage(privateClientId.value, text, String(privateClientId.value), privateConversationKey.value);
      if (isCurrent()) {
        if (destination.value === key && messageDraft.value === text) messageDraft.value = "";
        else if (drafts.get(key) === text) drafts.set(key, "");
      }
    } catch (error) {
      if (isCurrent()) {
        const code = (error as { code?: string } | null)?.code;
        const feedback = code === "CLIENT_NOT_FOUND" ? "chatTargetUnavailable" : code === "CHANNEL_CHANGED" ? "chatChannelChanged" : "chatSendFailed";
        errors.set(key, feedback);
        if (destination.value === key) sendError.value = feedback;
      }
    } finally {
      if (isCurrent()) {
        pending.delete(key);
        if (destination.value === key) sending.value = false;
      }
    }
  }

  watch(destination, (next, previous) => {
    scrollGeneration++;
    followingLatest = true;
    scrollIfFollowing();
    drafts.set(previous, messageDraft.value);
    messageDraft.value = drafts.get(next) ?? "";
    sending.value = pending.has(next);
    sendError.value = errors.get(next) ?? "";
  }, { flush: "sync" });
  watch(isMobileViewport, (mobile) => {
    panelOpen.value = !mobile;
  }, { flush: "sync" });
  watch(sessionEpoch, () => {
    historyGeneration++;
    persistedMessageIds.clear();
    drafts.clear();
    pending.clear();
    errors.clear();
    privateClientId.value = 0;
    privateConversationKey.value = "";
    tab.value = "channel";
    panelOpen.value = !isMobileViewport.value;
    messageDraft.value = "";
    drafts.clear();
    sending.value = false;
    sendError.value = "";
  }, { flush: "sync" });
  onScopeDispose(() => { disposed = true; drafts.clear(); pending.clear(); errors.clear(); sending.value = false; });

  watch([connected, sessionEpoch, serverKey], async ([isConnected, _epoch, target]) => {
    const generation = ++historyGeneration;
    persistedMessageIds.clear();
    if (!isConnected || !target) return;
    const normalizedKey = normalizeChatHistoryServerKey(target);
    const history = await loadChatHistory(normalizedKey);
    if (disposed || generation !== historyGeneration || !connected.value || normalizeChatHistoryServerKey(serverKey.value) !== normalizedKey) return;
    const existingIds = new Set(messages.map(message => message.id));
    const additions = history.filter(message => !existingIds.has(message.id));
    if (additions.length) messages.splice(0, messages.length, ...[...messages, ...additions].sort((left, right) => left.timestamp - right.timestamp));
    for (const message of messages) if (!message.isHistory) persistedMessageIds.add(message.id);
  }, { immediate: true });

  watch(() => messages.length, () => {
    if (!connected.value || !serverKey.value) return;
    const key = normalizeChatHistoryServerKey(serverKey.value);
    for (const message of messages) {
      if (message.isHistory || message.scope === "system" || persistedMessageIds.has(message.id)) continue;
      persistedMessageIds.add(message.id);
      void saveChatHistoryMessage(key, message);
    }
  }, { flush: "sync" });

  watch(() => visibleMessages.value.at(-1)?.id, () => {
    if (visibleMessages.value.at(-1)?.isSelf) followingLatest = true;
    scrollIfFollowing();
  });
  watch(mobileSection, (section) => { if (section === "chat") scrollIfFollowing(); });
  watch(() => messages.length, (length, previousLength) => {
    const latest = messages[length - 1];
    if (latest && length > previousLength && latest.scope === "private" && !latest.isSelf) notifyPrivateMessage();
  });

  return {
    tab,
    panelOpen,
    togglePanel,
    privateClientId,
    privateConversationKey,
    sending, sendError, canSend, status,
    messageDraft,
    listElement,
    conversations,
    visibleMessages,
    tabLabel,
    title,
    placeholder,
    openPrivateChat,
    openConversation,
    submitMessage,
    scrollToEnd,
    onScroll,
    scrollIfFollowing,
  };
}
