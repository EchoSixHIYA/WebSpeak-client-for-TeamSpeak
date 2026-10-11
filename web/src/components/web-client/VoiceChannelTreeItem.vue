<template>
  <li
    class="ws-voice-channel-node"
    data-ws-part="voice.channel-tree.node"
    role="treeitem"
    :aria-level="depth + 1"
    :aria-expanded="hasContents ? expanded : undefined"
    :aria-selected="selected"
    :aria-current="current ? 'location' : undefined"
    :data-current="current ? 'true' : 'false'"
    :data-selected="selected ? 'true' : 'false'"
  >
    <div class="ws-voice-channel-line" data-ws-part="voice.channel-tree.line">
      <button
        v-if="hasContents"
        type="button"
        class="ws-voice-channel-expander"
        data-ws-part="voice.channel-tree.expander"
        :aria-label="`${expanded ? '收起' : '展开'} ${node.channel.name} / ${expanded ? 'Collapse' : 'Expand'} channel`"
        :aria-expanded="expanded"
        @click.stop="emit('toggle', node.channel.id)"
      ><Icon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="13" /></button>
      <span v-else class="ws-voice-channel-expander-placeholder" aria-hidden="true"></span>
      <button
        type="button"
        class="ws-voice-channel-row"
        data-ws-part="voice.channel-tree.row"
        :title="`双击或按 Enter 加入 ${node.channel.name} / Double-click or press Enter to join`"
        @click="emit('select', node.channel.id)"
        @dblclick.stop.prevent="join"
        @keydown.enter.prevent.stop="join"
      >
        <Icon class="ws-voice-channel-type" data-ws-part="voice.channel-tree.icon" name="volume" :size="14" />
        <span class="ws-voice-channel-name" data-ws-part="voice.channel-tree.name">{{ node.channel.name }}</span>
        <span v-if="selected && !current" class="ws-voice-channel-join-hint" data-ws-part="voice.channel-tree.join-hint">双击加入</span>
        <span class="ws-voice-channel-count" data-ws-part="voice.channel-tree.count">
          {{ memberCount }}<template v-if="node.channel.maxClientsLimited && typeof node.channel.maxClients === 'number'">/{{ node.channel.maxClients }}</template>
        </span>
      </button>
    </div>

    <div
      v-if="hasContents"
      class="ws-voice-channel-branch"
      data-ws-part="voice.channel-tree.branch"
      :data-expanded="expanded ? 'true' : 'false'"
    >
      <ul class="ws-voice-channel-branch-content" role="group">
        <li
          v-for="member in node.channel.members"
          :key="member.id"
          class="ws-voice-channel-member"
          data-ws-part="voice.channel-tree.member"
          role="treeitem"
          :aria-level="depth + 2"
          :aria-label="`${member.nickname}${member.isSelf ? `, ${t('you')}` : ''}${member.inputMuted ? `, ${t('inputMuted')}` : ''}${member.away ? ', away' : ''}`"
          :data-speaking="isSpeaking(member) ? 'true' : 'false'"
          :data-away="member.away ? 'true' : 'false'"
        >
          <span
            class="ws-voice-channel-member-avatar"
            data-ws-part="voice.channel-tree.avatar"
            :class="{ 'is-speaking': isSpeaking(member) }"
            :style="avatarStyle(member.nickname, member.isSelf, member.avatar)"
            aria-hidden="true"
          >{{ member.avatar ? '' : avatarInitial(member.nickname) }}</span>
          <span class="ws-voice-channel-member-name" data-ws-part="voice.channel-tree.member-name">
            {{ member.isSelf ? t('you') : member.nickname }}
          </span>
          <Icon
            v-if="member.inputMuted"
            class="ws-voice-channel-member-muted"
            data-ws-part="voice.channel-tree.member-muted"
            name="mic-off"
            :size="12"
            :title="t('inputMuted')"
          />
          <span
            v-else-if="isSpeaking(member)"
            class="ws-voice-channel-member-speaking"
            data-ws-part="voice.channel-tree.member-speaking"
            aria-hidden="true"
          ></span>
          <span v-if="member.away" class="ws-voice-channel-member-away" data-ws-part="voice.channel-tree.member-away" aria-hidden="true">·</span>
        </li>
        <VoiceChannelTreeItem
          v-for="child in node.children"
          :key="child.channel.id"
          :node="child"
          :depth="depth + 1"
          :current-channel-id="currentChannelId"
          :selected-channel-id="selectedChannelId"
          :expanded-ids="expandedIds"
          :avatar-style="avatarStyle"
          :avatar-initial="avatarInitial"
          :is-speaking="isSpeaking"
          :t="t"
          @toggle="emit('toggle', $event)"
          @select="emit('select', $event)"
          @join="emit('join', $event)"
        />
      </ul>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import Icon from "../Icon.vue";
import type { ChannelMember } from "../../composables/useVoiceWebSocket.js";
import type { TreeChannel } from "../../composables/useWebClientChannels.js";
import type { VoiceChannelTreeNode } from "../../services/voice-channel-tree.js";

defineOptions({ name: "VoiceChannelTreeItem" });

const props = defineProps<{
  node: VoiceChannelTreeNode<TreeChannel>;
  depth: number;
  currentChannelId?: string;
  selectedChannelId: string;
  expandedIds: ReadonlySet<string>;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => CSSProperties;
  avatarInitial: (name: string) => string;
  isSpeaking: (member: ChannelMember) => boolean;
  t: (key: string) => string;
}>();

const emit = defineEmits<{
  toggle: [channelId: string];
  select: [channelId: string];
  join: [channel: TreeChannel];
}>();

const expanded = computed(() => props.expandedIds.has(props.node.channel.id));
const hasContents = computed(() => props.node.children.length > 0 || props.node.channel.members.length > 0);
const current = computed(() => props.node.channel.id === props.currentChannelId);
const selected = computed(() => props.node.channel.id === props.selectedChannelId);
const memberCount = computed(() => String(props.node.channel.members.length).padStart(2, "0"));

function join(): void {
  if (props.node.channel.id !== props.currentChannelId) emit("join", props.node.channel);
}
</script>
