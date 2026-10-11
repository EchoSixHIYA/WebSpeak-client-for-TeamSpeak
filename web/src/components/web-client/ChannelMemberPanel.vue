<template>
  <aside
    :class="['member-panel', { 'mobile-section-visible': mobileVisible }]"
    data-ws-part="voice.member-panel"
  >
    <div
      class="member-panel-heading"
      data-ws-part="voice.member-panel.heading"
      ><div
        ><h2>{{ t("people") }}</h2></div
      ><button
        type="button"
        class="status-button"
        :class="{ active: away }"
        @click="toggleAway"
        ><span class="status-dot"></span>{{ away ? t("away") : t("available") }}</button
      ></div
    >
    <div
      class="member-search"
      data-ws-part="voice.member-panel.search"
      ><Icon
        name="search"
        :size="15" /><input
        v-model="memberQuery"
        :placeholder="t('searchMembers')"
        :aria-label="t('searchMembers')"
    /></div>
    <div
      class="member-tree"
      data-ws-part="voice.member-panel.channels"
    >
      <section
        v-for="channelItem in filteredMemberChannels"
        :key="channelItem.id"
        :class="[
          'member-channel-group',
          {
            current: currentChannelId === channelItem.id,
            'drag-over': dragOverChannelId === channelItem.id,
          },
        ]"
        data-ws-part="voice.channel-group"
        :data-ws-state="
          currentChannelId === channelItem.id
            ? 'current'
            : dragOverChannelId === channelItem.id
              ? 'drag-over'
              : 'idle'
        "
        :data-member-channel-id="channelItem.id"
        :style="{ marginLeft: `${channelItem.depth * 10}px` }"
        @dragover="onChannelDragOver(channelItem, $event)"
        @dragleave="onChannelDragLeave(channelItem, $event)"
        @drop="onChannelDrop(channelItem, $event)"
        @pointermove="onMemberPointerMove($event)"
        @pointerup="onMemberPointerUp($event)"
        @pointercancel="onMemberPointerCancel($event)"
      >
        <button
          class="member-channel-heading"
          data-ws-part="voice.channel-group.heading"
          :data-ws-state="channelItem.id === currentChannelId ? 'current' : 'idle'"
          :title="t('switchChannel')"
          @click="emit('selectChannel', channelItem)"
        >
          <Icon
            name="volume"
            :size="16"
          />
          <span>{{ channelItem.name }}</span>
          <small>{{ channelItem.members.length }}</small>
        </button>
        <div
          v-if="channelItem.members.length"
          class="member-list"
          data-ws-part="voice.channel-group.members"
        >
          <div
            v-for="member in channelItem.members"
            :key="`${channelItem.id}-${member.id}`"
            :class="['member-row', { dragging: draggedMember?.id === member.id }]"
            data-ws-part="voice.member-row"
            :data-ws-state="
              draggedMember?.id === member.id
                ? 'dragging'
                : isSpeaking(member)
                  ? 'speaking'
                  : 'connected'
            "
            :draggable="!member.isSelf"
            @dragstart="onMemberDragStart(member, $event)"
            @dragend="onMemberDragEnd"
            @pointerdown="onMemberPointerDown(member, $event)"
            @pointermove="onMemberPointerMove($event)"
            @pointerup="onMemberPointerUp($event)"
            @pointercancel="onMemberPointerCancel($event)"
            @contextmenu.prevent="openMemberMenu(member, $event)"
          >
            <div
              :class="['member-avatar', { speaking: isSpeaking(member) }]"
              data-ws-part="voice.member-row.avatar"
              :style="avatarStyle(member.nickname, member.isSelf, member.avatar)"
              >{{ member.avatar ? "" : avatarInitial(member.nickname)
              }}<span class="member-presence"></span
            ></div>
            <div
              class="member-copy"
              data-ws-part="voice.member-row.copy"
              ><strong>{{ memberDisplayName(member) }}</strong
              ><span>{{
                member.away === true
                  ? t("away")
                  : isSpeaking(member)
                    ? t("speaking")
                    : member.away === false
                      ? member.isSelf ? t("yourDevice") : t("memberOnline")
                      : t("statusUnknown")
              }}</span></div
            >
            <div
              class="member-flags"
              data-ws-part="voice.member-row.flags"
              :aria-label="t('memberStates')"
              ><span
                v-if="member.away"
                :title="t('away')"
                :aria-label="t('away')"
                ><Icon
                  name="clock"
                  :size="13" /></span
              ><span
                v-if="member.inputMuted === undefined"
                class="unknown"
                :title="t('statusUnknown')"
                :aria-label="t('statusUnknown')"
                ><Icon name="info" :size="13" /></span
              ><span
                v-else-if="member.inputMuted"
                :title="t('inputMuted')"
                :aria-label="t('inputMuted')"
                ><Icon
                  name="mic-off"
                  :size="13" /></span
              ><span
                v-if="member.outputMuted"
                :title="t('outputMuted')"
                :aria-label="t('outputMuted')"
                ><Icon
                  name="volume-off"
                  :size="13" /></span
              ><span
                v-if="member.channelCommander"
                :title="t('channelCommander')"
                :aria-label="t('channelCommander')"
                ><Icon
                  name="shield"
                  :size="13" /></span
            ></div>
            <div
              class="member-volume"
              data-ws-part="voice.member-row.volume"
              ><Icon
                :name="(volumes[member.id] ?? 1) === 0 ? 'volume-off' : 'volume'"
                :size="14" /><input
                type="range"
                min="0"
                max="400"
                :value="(volumes[member.id] ?? 1) * 100"
                :style="rangeStyle((volumes[member.id] ?? 1) / 4, 1)"
                :aria-label="t('memberVolume')"
                @input="emit('volumeInput', member.id, $event)"
            /></div>
            <button
              v-if="isMobileViewport && !member.isSelf"
              type="button"
              class="member-action-button"
              :aria-label="t('moreMemberOptions')"
              @click.stop="openMemberActions(member, $event)"
              ><Icon
                name="more"
                :size="18"
            /></button>
          </div>
        </div>
        <div
          v-else
          class="channel-no-members"
          >{{ t("noMembersInChannel") }}</div
        >
      </section>
    </div>
    <div
      v-if="!filteredMemberChannels.length"
      class="member-empty"
      >{{ t("noMatchingMembers") }}</div
    >
    <slot />
  </aside>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import Icon from "../Icon.vue";
import type { TreeChannel } from "../../composables/useWebClientChannels.js";
import type { useWebClientMembers } from "../../composables/useWebClientMembers.js";

type MemberPanelModel = Pick<ReturnType<typeof useWebClientMembers>,
  | "away"
  | "draggedMember"
  | "dragOverChannelId"
  | "toggleAway"
  | "isSpeaking"
  | "memberDisplayName"
  | "openMemberMenu"
  | "openMemberActions"
  | "onMemberDragStart"
  | "onMemberDragEnd"
  | "onMemberPointerDown"
  | "onMemberPointerMove"
  | "onMemberPointerUp"
  | "onMemberPointerCancel"
  | "onChannelDragOver"
  | "onChannelDragLeave"
  | "onChannelDrop"
>;
const memberQuery = defineModel<string>("query", { required: true });
const props = defineProps<{
  model: MemberPanelModel;
  filteredMemberChannels: readonly TreeChannel[];
  currentChannelId?: string;
  mobileVisible: boolean;
  isMobileViewport: boolean;
  volumes: Record<number, number>;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => CSSProperties;
  avatarInitial: (name: string) => string;
  rangeStyle: (value: number, max: number) => CSSProperties;
  t: (key: string, variables?: Record<string, string | number>) => string;
}>();
const emit = defineEmits<{
  selectChannel: [channel: TreeChannel];
  volumeInput: [clientId: number, event: Event];
}>();

// The page retains the controller and slot content across mobile view changes.
const {
  away,
  draggedMember,
  dragOverChannelId,
  toggleAway,
  isSpeaking,
  memberDisplayName,
  openMemberMenu,
  openMemberActions,
  onMemberDragStart,
  onMemberDragEnd,
  onMemberPointerDown,
  onMemberPointerMove,
  onMemberPointerUp,
  onMemberPointerCancel,
  onChannelDragOver,
  onChannelDragLeave,
  onChannelDrop,
} = props.model;
</script>
