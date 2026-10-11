<template>
  <ul
    v-if="visibleTree.length"
    class="ws-voice-channel-tree"
    data-ws-part="voice.channel-tree.list"
    :data-layout="layout"
    role="tree"
    aria-label="语音频道 / Voice channels"
  >
    <VoiceChannelTreeItem
      v-for="node in visibleTree"
      :key="node.channel.id"
      :node="node"
      :depth="0"
      :layout="layout"
      :current-channel-id="currentChannelId"
      :selected-channel-id="selectedChannelId"
      :expanded-ids="effectiveExpandedIds"
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
  >{{ query.trim() ? "没有匹配的频道 / No matching channels" : "无可用语音频道 / No voice channels" }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type CSSProperties } from "vue";
import type { ChannelMember } from "../../composables/useVoiceWebSocket.js";
import type { TreeChannel } from "../../composables/useWebClientChannels.js";
import { buildVoiceChannelTree, filterVoiceChannelTree } from "../../services/voice-channel-tree.js";
import VoiceChannelTreeItem from "./VoiceChannelTreeItem.vue";

const props = defineProps<{
  channels: readonly TreeChannel[];
  currentChannelId?: string;
  query?: string;
  layout?: "default" | "server-sidebar";
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => CSSProperties;
  avatarInitial: (name: string) => string;
  isSpeaking: (member: ChannelMember) => boolean;
  t: (key: string) => string;
}>();

const tree = computed(() => buildVoiceChannelTree(props.channels));
const layout = computed(() => props.layout ?? "default");
const query = computed(() => props.query ?? "");
const visibleTree = computed(() => filterVoiceChannelTree(tree.value, query.value));
const selectedChannelId = ref(props.currentChannelId ?? "");
const expandedIds = ref(new Set<string>());
const effectiveExpandedIds = computed(() => {
  const result = new Set(expandedIds.value);
  if (!query.value.trim()) return result;
  const pending = [...visibleTree.value];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.children.length) result.add(node.channel.id);
    pending.push(...node.children);
  }
  return result;
});

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
    if (node.children.length || (layout.value === "default" && node.channel.members.length)) expanded.add(node.channel.id);
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
