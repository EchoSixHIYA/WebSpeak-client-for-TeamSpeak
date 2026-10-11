<template>
  <ul
    v-if="tree.length"
    class="ws-voice-channel-tree"
    data-ws-part="voice.channel-tree.list"
    role="tree"
    aria-label="语音频道 / Voice channels"
  >
    <VoiceChannelTreeItem
      v-for="node in tree"
      :key="node.channel.id"
      :node="node"
      :depth="0"
      :current-channel-id="currentChannelId"
      :selected-channel-id="selectedChannelId"
      :expanded-ids="expandedIds"
      :avatar-style="avatarStyle"
      :avatar-initial="avatarInitial"
      :is-speaking="isSpeaking"
      :t="t"
      @toggle="toggleExpanded"
      @select="selectedChannelId = $event"
      @join="joinChannel"
    />
  </ul>
  <div
    v-else
    class="ws-voice-channel-tree-empty"
    data-ws-part="voice.channel-tree.empty"
    role="status"
  >无可用语音频道 / No voice channels</div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type CSSProperties } from "vue";
import type { ChannelMember } from "../../composables/useVoiceWebSocket.js";
import type { TreeChannel } from "../../composables/useWebClientChannels.js";
import { buildVoiceChannelTree } from "../../services/voice-channel-tree.js";
import VoiceChannelTreeItem from "./VoiceChannelTreeItem.vue";

const props = defineProps<{
  channels: readonly TreeChannel[];
  currentChannelId?: string;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => CSSProperties;
  avatarInitial: (name: string) => string;
  isSpeaking: (member: ChannelMember) => boolean;
  t: (key: string) => string;
}>();

const tree = computed(() => buildVoiceChannelTree(props.channels));
const selectedChannelId = ref(props.currentChannelId ?? "");
const expandedIds = ref(new Set<string>());

watch(() => props.currentChannelId, (channelId) => {
  if (channelId) selectedChannelId.value = channelId;
}, { immediate: true });

watch(tree, (nodes) => {
  const availableIds = new Set<string>();
  const expanded = new Set(expandedIds.value);
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop()!;
    availableIds.add(node.channel.id);
    if (node.children.length || node.channel.members.length) expanded.add(node.channel.id);
    pending.push(...node.children);
  }
  for (const id of expanded) if (!availableIds.has(id)) expanded.delete(id);
  expandedIds.value = expanded;
}, { immediate: true });

function toggleExpanded(channelId: string): void {
  const next = new Set(expandedIds.value);
  if (next.has(channelId)) next.delete(channelId);
  else next.add(channelId);
  expandedIds.value = next;
}

function joinChannel(channel: TreeChannel): void {
  if (channel.id === props.currentChannelId) return;
  selectedChannelId.value = channel.id;
  emit("join", channel);
}

const emit = defineEmits<{
  join: [channel: TreeChannel];
}>();
</script>
