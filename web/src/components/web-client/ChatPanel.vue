<template>
  <section
    :class="['chat-panel', { 'mobile-section-hidden': mobileHidden }]"
    :data-ws-chat-tab="chatTab"
    :data-ws-chat-panel-open="panelOpen"
    data-ws-part="voice.chat"
  >
    <div
      class="chat-tabs"
      data-ws-part="voice.chat.tabs"
      role="tablist"
      :aria-label="t('chatTabs')"
    >
      <button
        type="button"
        data-ws-part="voice.chat.tab"
        data-ws-chat-kind="channel"
        :data-ws-state="chatTab === 'channel' ? 'active' : 'idle'"
        :class="{ active: chatTab === 'channel' }"
        @click="chatTab = 'channel'"
        ><Icon
          name="hash"
          :size="15"
        />
        {{ currentChannelName }}</button
      >
      <button
        type="button"
        data-ws-part="voice.chat.tab"
        data-ws-chat-kind="server"
        :data-ws-state="chatTab === 'server' ? 'active' : 'idle'"
        :class="{ active: chatTab === 'server' }"
        @click="chatTab = 'server'"
        ><Icon
          name="server"
          :size="15"
        />
        {{ t("serverChat") }}</button
      >
      <button
        v-for="conversation in privateConversations"
        :key="conversation.key"
        type="button"
        data-ws-part="voice.chat.tab"
        data-ws-chat-kind="private"
        :data-ws-state="
          chatTab === 'private' && privateConversationKey === conversation.key ? 'active' : 'idle'
        "
        :class="{ active: chatTab === 'private' && privateConversationKey === conversation.key }"
        @click="openConversation(conversation)"
        ><Icon
          name="message"
          :size="15"
        />
        {{ conversation.name }}</button
      >
      <button
        type="button"
        data-ws-part="voice.chat.tab"
        data-ws-chat-kind="events"
        :data-ws-state="chatTab === 'events' ? 'active' : 'idle'"
        :class="{ active: chatTab === 'events' }"
        @click="chatTab = 'events'"
        ><Icon
          name="bell"
          :size="15"
        />
        {{ t("eventLog") }}</button
      >
    </div>
    <div
      class="section-heading chat-heading"
      data-ws-part="voice.chat.heading"
      ><div
        ><span class="section-kicker">{{ chatTabLabel }}</span
        ><h2
          ><Icon
            :name="
              chatTab === 'server'
                ? 'server'
                : chatTab === 'events'
                  ? 'bell'
                  : chatTab === 'private'
                    ? 'message'
                    : 'hash'
            "
            :size="20"
          />
          {{ chatTitle }}</h2
        ></div
      ><span class="section-counter">{{
        chatTab === "events"
          ? t("eventCount", { count: serverEvents.length })
          : t("messageCount", { count: visibleChatMessages.length })
      }}</span></div
    >
    <div
      ref="chatListEl"
      class="message-list"
      data-ws-part="voice.chat.messages"
      @scroll.passive="onScroll"
    >
      <div v-if="chatTab === 'events'">
        <article
          v-for="event in serverEvents"
          :key="event.id"
          class="event-row"
          data-ws-part="voice.chat.event"
          ><time>{{ formatTime(event.timestamp) }}</time
          ><span>{{ event.message }}</span></article
        >
        <div
          v-if="!serverEvents.length"
          class="chat-empty"
          data-ws-part="voice.chat.empty"
          data-ws-state="events-empty"
          ><div class="chat-empty-icon"
            ><Icon
              name="bell"
              :size="24" /></div
          ><strong>{{ t("noEvents") }}</strong
          ><span>{{ t("noEventsLead") }}</span></div
        >
      </div>
      <div
        v-else-if="!visibleChatMessages.length"
        class="chat-empty"
        data-ws-part="voice.chat.empty"
        data-ws-state="messages-empty"
        ><strong>{{ chatTab === "private" ? t("privateChatStart") : t("chatStart") }}</strong
        ><span>{{
          chatTab === "private" ? t("privateChatStartLead") : t("chatStartLead")
        }}</span></div
      >
      <template
        v-for="message in visibleChatMessages"
        :key="message.id"
      >
        <article
          v-if="chatTab !== 'events'"
          :class="['message-row', { mine: message.isSelf }]"
          data-ws-part="voice.chat.message"
          :data-ws-state="message.isSelf ? 'mine' : 'other'"
        >
          <div
            class="message-avatar"
            data-ws-part="voice.chat.message-avatar"
            :style="avatarStyle(message.invokerName, message.isSelf, messageAvatar(message))"
            >{{ messageAvatar(message) ? "" : avatarInitial(message.invokerName) }}</div
          >
          <div
            class="message-body"
            data-ws-part="voice.chat.message-body"
            ><div class="message-meta"
              ><strong>{{ message.isSelf ? t("you") : message.invokerName }}</strong
              ><time>{{ formatTime(message.timestamp) }}</time></div
            ><div
              class="message-bubble"
              data-ws-part="voice.chat.message-bubble"
              >{{ message.message }}</div
            ></div
          >
        </article>
      </template>
    </div>
    <form
      v-if="chatTab !== 'events'"
      class="message-composer"
      data-ws-part="voice.chat.composer"
      @submit.prevent="!composing && submitMessage()"
    >
      <input
        v-model="messageDraft"
        maxlength="500"
        enterkeyhint="send"
        autocomplete="off"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @keydown.enter="guardComposition"
        :placeholder="chatPlaceholder"
        :aria-label="t('send')"
      />
      <button
        class="send-button"
        type="submit"
        :disabled="!canSendChat || !messageDraft.trim()"
        :title="t('send')"
        :aria-label="t('send')"
        ><Icon
          name="send"
          :size="18"
      /></button>
    </form>
    <p
      v-if="chatStatus"
      class="chat-status"
      data-ws-part="voice.chat.status"
      role="status"
      >{{ chatStatus }}</p
    >
  </section>
</template>

<script setup lang="ts">
import { ref, type CSSProperties } from "vue";
import Icon from "../Icon.vue";
import type { useWebClientChat } from "../../composables/useWebClientChat.js";
import type { ChatMessage, ServerEvent } from "../../composables/useVoiceWebSocket.js";

type ChatPanelModel = Pick<ReturnType<typeof useWebClientChat>,
  | "tab" | "privateConversationKey" | "canSend" | "status" | "messageDraft"
  | "panelOpen"
  | "listElement" | "conversations" | "visibleMessages" | "tabLabel" | "title"
  | "placeholder" | "openConversation" | "submitMessage" | "onScroll"
>;

const props = defineProps<{
  model: ChatPanelModel;
  t: (key: string, variables?: Record<string, string | number>) => string;
  currentChannelName: string;
  mobileHidden: boolean;
  serverEvents: readonly ServerEvent[];
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => CSSProperties;
  avatarInitial: (name: string) => string;
  messageAvatar: (message: ChatMessage) => string;
  formatTime: (timestamp: number) => string;
}>();

// The page owns one stable controller across room and mobile view changes.
// Keep its list ref attached to the rendered scroller, including unmount cleanup.
const {
  tab: chatTab,
  panelOpen,
  privateConversationKey,
  canSend: canSendChat,
  status: chatStatus,
  messageDraft,
  listElement: chatListEl,
  conversations: privateConversations,
  visibleMessages: visibleChatMessages,
  tabLabel: chatTabLabel,
  title: chatTitle,
  placeholder: chatPlaceholder,
  openConversation,
  submitMessage,
  onScroll,
} = props.model;

const composing = ref(false);
function guardComposition(event: KeyboardEvent): void {
  // Android IME and Safari can confirm a candidate with Enter; that is not Send.
  if (composing.value || event.isComposing || event.keyCode === 229) event.preventDefault();
}
</script>
