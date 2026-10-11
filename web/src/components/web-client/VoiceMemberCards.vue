<template>
  <TransitionGroup
    v-if="currentMembers.length"
    name="ws-voice-member"
    tag="div"
    appear
    class="voice-grid"
    data-ws-part="voice.members"
  >
    <article
      v-for="member in currentMembers"
      :key="member.id"
      :class="['voice-card', { speaking: isSpeaking(member), self: member.isSelf }]"
      data-ws-part="voice.member"
      :data-ws-state="member.isSelf ? 'self' : isSpeaking(member) ? 'speaking' : 'connected'"
      :data-ws-member-id="member.id"
      :data-ws-speaking="isSpeaking(member) ? 'true' : 'false'"
      :data-ws-self="member.isSelf ? 'true' : 'false'"
      @contextmenu="handleMemberContextMenu(member, $event)"
    >
      <button
        v-if="!member.isSelf && (isMobileViewport || showMemberActions)"
        type="button"
        class="voice-member-action"
        data-ws-part="voice.member.action-trigger"
        :data-ws-member-actions="showMemberActions ? 'enabled' : undefined"
        :aria-label="t('moreMemberOptions')"
        :title="t('moreMemberOptions')"
        @click.stop="emit('memberActions', member, $event)"
        ><Icon
          name="more"
          :size="17"
      /></button>
      <div
        :class="[
          'voice-avatar-wrap',
          { 'screen-share-avatar-wrap': screenShareStreamForMember(member) },
        ]"
        data-ws-part="voice.member.avatar-wrap"
      >
        <div
          :class="['voice-avatar', { speaking: isSpeaking(member) }]"
          data-ws-part="voice.member.avatar"
          :style="avatarStyle(member.nickname, member.isSelf, member.avatar)"
          >{{ member.avatar ? "" : avatarInitial(member.nickname) }}</div
        >
        <span
          v-if="member.inputMuted"
          class="voice-muted-indicator"
          data-ws-part="voice.member.mic-status"
          data-ws-state="muted"
          role="img"
          :aria-label="t('inputMuted')"
          :title="t('inputMuted')"
          ><Icon name="mic-off" :size="14" /></span
        >
        <span
          v-if="shareEnabled && screenShareStreamForMember(member)"
          class="screen-share-live-indicator"
          data-ws-part="voice.member.live-indicator"
          ><span
            class="screen-share-wave"
            aria-hidden="true"
            ><i
              v-for="bar in screenShareIndicatorBars"
              :key="bar"
              :style="{ height: `${bar}px` }"
            ></i></span
          ><span>{{ t("sharingScreen") }}</span></span
        >
        <button
          v-if="shareEnabled && member.isSelf && (screenShareActive || screenShareStarting)"
          type="button"
          class="screen-share-stop-button"
          data-ws-part="voice.member.stop-share"
          :aria-label="t('stopScreenShare')"
          :title="t('stopScreenShare')"
          @click.stop="emit('stopShare')"
          ><Icon
            name="close"
            :size="14"
        /></button>
      </div>
      <strong data-ws-part="voice.member.name">{{
        member.isSelf ? t("you") : member.nickname
      }}</strong
      ><span data-ws-part="voice.member.status">{{
        isSpeaking(member) ? t("speaking") : member.isSelf ? t("connectedYou") : t("connected")
      }}</span>
      <div
        v-if="shareEnabled && (member.isSelf || screenShareStreamForMember(member))"
        class="screen-share-card-actions"
        data-ws-part="voice.member.share-actions"
      >
        <template v-if="member.isSelf && !screenShareActive && !screenShareStarting">
          <div class="screen-share-start-actions">
            <button
              type="button"
              class="screen-share-card-button"
              @click.stop="startScreenShareWithSettings"
              ><Icon
                name="monitor"
                :size="13"
              />
              {{ t("startScreenShare") }}</button
            >
            <button
              type="button"
              class="screen-share-settings-button"
              :aria-label="t('screenShareSettings')"
              :aria-expanded="screenShareSettingsOpen"
              :title="t('screenShareSettings')"
              @click.stop="toggleScreenShareSettings"
              ><Icon
                name="settings"
                :size="13"
            /></button>
          </div>
        </template>
        <button
          v-else-if="!member.isSelf"
          type="button"
          :class="[
            'screen-share-card-button',
            {
              viewing: screenShareViewingStreamId === screenShareStreamForMember(member)?.streamId,
            },
          ]"
          :data-ws-state="
            screenShareViewingStreamId === screenShareStreamForMember(member)?.streamId
              ? 'viewing'
              : 'idle'
          "
          @click.stop="toggleScreenShareForMember(member)"
          ><Icon
            name="monitor"
            :size="13"
          />
          {{
            screenShareViewingStreamId === screenShareStreamForMember(member)?.streamId
              ? t("watching")
              : t("watchScreenShare")
          }}</button
        >
      </div>
    </article>
  </TransitionGroup>
  <div
    v-else
    class="voice-empty"
    data-ws-part="voice.members.empty"
    ><span class="empty-icon"
      ><Icon
        name="users"
        :size="20" /></span
    ><strong>{{ t("waitingForMembers") }}</strong
    ><span>{{ t("prepareMicrophone") }}</span></div
  >
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";
import { computed } from "vue";
import type { ChannelMember, useVoiceWebSocket } from "../../composables/useVoiceWebSocket.js";
import type { useWebClientScreenShare } from "../../composables/useWebClientScreenShare.js";
const props = defineProps<{
  currentMembers: ChannelMember[]; isMobileViewport: boolean; showMemberActions?: boolean;
  showScreenShare?: boolean;
  sharing?: Pick<ReturnType<typeof useVoiceWebSocket>, "screenShareActive" | "screenShareStarting" | "screenShareViewingStreamId"> & Pick<ReturnType<typeof useWebClientScreenShare>, "settingsOpen">;
  controls?: Pick<ReturnType<typeof useWebClientScreenShare>, "streamForMember" | "toggleForMember" | "startWithSettings">;
  isSpeaking: (member: ChannelMember) => boolean;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => Record<string, string>;
  avatarInitial: (name: string) => string; t: (key: string) => string;
}>();
const shareEnabled = computed(() => props.showScreenShare !== false && Boolean(props.sharing && props.controls));
const screenShareActive = computed(() => shareEnabled.value && Boolean(props.sharing?.screenShareActive.value));
const screenShareStarting = computed(() => shareEnabled.value && Boolean(props.sharing?.screenShareStarting.value));
const screenShareViewingStreamId = computed(() => shareEnabled.value ? props.sharing?.screenShareViewingStreamId.value ?? null : null);
const screenShareSettingsOpen = computed(() => shareEnabled.value && Boolean(props.sharing?.settingsOpen.value));
const screenShareStreamForMember = (member: ChannelMember) => shareEnabled.value ? props.controls?.streamForMember(member) ?? null : null;
const toggleScreenShareForMember = (member: ChannelMember) => { if (shareEnabled.value) props.controls?.toggleForMember(member); };
const startScreenShareWithSettings = () => { if (shareEnabled.value) void props.controls?.startWithSettings(); };
function toggleScreenShareSettings() {
  if (!shareEnabled.value || !props.sharing) return;
  props.sharing.settingsOpen.value = !props.sharing.settingsOpen.value;
}
const emit = defineEmits<{ memberActions: [member: ChannelMember, event: MouseEvent]; stopShare: [] }>();
const screenShareIndicatorBars = [5, 10, 7, 12, 8, 10];

function handleMemberContextMenu(member: ChannelMember, event: MouseEvent): void {
  if (!props.showMemberActions || member.isSelf) return;
  event.preventDefault();
  event.stopPropagation();
  emit("memberActions", member, event);
}
</script>

<style scoped>
.voice-muted-indicator {
  position: absolute;
  z-index: 4;
  top: 8px;
  right: 8px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid #ffffff18;
  border-radius: 5px;
  color: #f0f0f2;
  background: #17181bd9;
  pointer-events: none;
}

.voice-card:has(.voice-member-action) .voice-muted-indicator {
  right: 50px;
}
</style>
