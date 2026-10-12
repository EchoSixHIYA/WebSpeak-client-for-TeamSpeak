<template>
  <li
    class="ws-voice-channel-node"
    data-ws-part="voice.channel-tree.node"
    role="treeitem"
    :aria-level="depth + 1"
    :aria-expanded="isExpandable ? expanded : undefined"
    :aria-selected="selected"
    :aria-current="current ? 'location' : undefined"
    :data-current="current ? 'true' : 'false'"
    :data-selected="selected ? 'true' : 'false'"
  >
    <div class="ws-voice-channel-line" data-ws-part="voice.channel-tree.line" :style="{ '--channel-depth': depth }">
      <button
        v-if="isExpandable"
        type="button"
        class="ws-voice-channel-expander"
        data-ws-part="voice.channel-tree.expander"
        :aria-label="`${expanded ? '收起' : '展开'} ${node.channel.name} / ${expanded ? 'Collapse' : 'Expand'} channel`"
        :aria-expanded="expanded"
        @click.stop="emit('toggle', node.channel.id)"
      ><Icon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="13" /></button>
      <button
        type="button"
        class="ws-voice-channel-row"
        data-ws-part="voice.channel-tree.row"
        :data-drag-over="memberDragDrop && dragOverChannelId === node.channel.id ? 'true' : undefined"
        :title="`双击或按 Enter 加入 ${node.channel.name} / Double-click or press Enter to join${node.channel.passwordProtected ? ' · 需要频道密码 / Channel password required' : ''}`"
        :data-password-protected="node.channel.passwordProtected ? 'true' : undefined"
        @click="emit('select', node.channel.id)"
        @dblclick.stop.prevent="join"
        @keydown.enter.prevent.stop="join"
        @dragover="handleChannelDragOver($event)"
        @dragleave="handleChannelDragLeave($event)"
        @drop="handleChannelDrop($event)"
      >
        <Icon
          class="ws-voice-channel-type"
          data-ws-part="voice.channel-tree.icon"
          :name="node.channel.passwordProtected ? 'lock' : 'speaker'"
          :data-password-protected="node.channel.passwordProtected ? 'true' : 'false'"
          :size="14"
        />
        <span class="ws-voice-channel-name" data-ws-part="voice.channel-tree.name">{{ node.channel.name }}</span>
        <span v-if="selected && !current" class="ws-voice-channel-join-hint" data-ws-part="voice.channel-tree.join-hint">双击加入</span>
        <span class="ws-voice-channel-count" data-ws-part="voice.channel-tree.count">
          {{ memberCount }}<template v-if="node.channel.maxClientsLimited && typeof node.channel.maxClients === 'number'">/{{ node.channel.maxClients }}</template>
        </span>
      </button>
    </div>

    <template v-if="layout === 'server-sidebar'">
      <ul v-if="node.channel.members.length" class="ws-voice-channel-member-list" role="group" :style="{ '--channel-depth': depth }">
        <li
          v-for="member in node.channel.members"
          :key="member.id"
          class="ws-voice-channel-member"
          data-ws-part="voice.channel-tree.member"
          role="treeitem"
          :aria-level="depth + 2"
          :aria-label="`${member.nickname}${member.isSelf ? `, ${t('you')}` : ''}${member.inputMuted ? `, ${t('inputMuted')}` : ''}`"
          :data-self="member.isSelf ? 'true' : 'false'"
          :draggable="memberDragDrop && !member.isSelf"
          :data-dragging="memberDragDrop && draggedMemberId === member.id ? 'true' : undefined"
          @dragstart="handleMemberDragStart(member, $event)"
          @dragend="emit('memberDragEnd')"
          @contextmenu="handleMemberContextMenu(member, $event)"
        >
          <span
            class="ws-voice-channel-member-avatar"
            data-ws-part="voice.channel-tree.avatar"
            :style="avatarStyle(member.nickname, member.isSelf, member.avatar)"
            aria-hidden="true"
          >{{ member.avatar ? '' : avatarInitial(member.nickname) }}</span>
          <span class="ws-voice-channel-member-name" data-ws-part="voice.channel-tree.member-name">{{ member.nickname }}</span>
          <span v-if="member.isSelf" class="ws-voice-channel-member-self">你</span>
          <Icon
            v-if="member.inputMuted"
            class="ws-voice-channel-member-muted"
            data-ws-part="voice.channel-tree.member-muted"
            name="mic-off"
            :size="13"
            :title="t('inputMuted')"
          />
          <Icon
            v-else
            class="ws-voice-channel-member-mic"
            name="mic"
            :size="13"
            :title="t('microphoneActive')"
          />
          <span
            v-if="isScreenSharing?.(member)"
            class="ws-voice-channel-member-screen-share"
            data-ws-part="voice.channel-tree.member-screen-share"
            role="img"
            :aria-label="t('screenShare')"
            :title="t('screenShare')"
          ><Icon name="monitor" :size="12" /></span>
        </li>
      </ul>
      <div
        v-if="hasChildren"
        class="ws-voice-channel-branch"
        data-ws-part="voice.channel-tree.branch"
        :data-expanded="expanded ? 'true' : 'false'"
      >
        <ul class="ws-voice-channel-branch-content" role="group">
          <VoiceChannelTreeItem
            v-for="child in node.children"
            :key="child.channel.id"
            :node="child"
            :depth="depth + 1"
            :layout="layout"
            :current-channel-id="currentChannelId"
            :selected-channel-id="selectedChannelId"
            :expanded-ids="expandedIds"
            :avatar-style="avatarStyle"
            :avatar-initial="avatarInitial"
            :is-speaking="isSpeaking"
            :is-screen-sharing="isScreenSharing"
            :show-member-actions="showMemberActions"
            :member-drag-drop="memberDragDrop"
            :dragged-member-id="draggedMemberId"
            :drag-over-channel-id="dragOverChannelId"
            :t="t"
            @toggle="emit('toggle', $event)"
            @select="emit('select', $event)"
            @join="emit('join', $event)"
            @member-context-menu="emit('memberContextMenu', $event)"
            @member-drag-start="emit('memberDragStart', $event)"
            @member-drag-end="emit('memberDragEnd')"
            @channel-drag-over="emit('channelDragOver', $event)"
            @channel-drag-leave="emit('channelDragLeave', $event)"
            @channel-drop="emit('channelDrop', $event)"
          />
        </ul>
      </div>
    </template>
    <div
      v-else-if="hasContents"
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
          :draggable="memberDragDrop && !member.isSelf"
          :data-dragging="memberDragDrop && draggedMemberId === member.id ? 'true' : undefined"
          @dragstart="handleMemberDragStart(member, $event)"
          @dragend="emit('memberDragEnd')"
          @contextmenu="handleMemberContextMenu(member, $event)"
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
          <span
            v-if="isScreenSharing?.(member)"
            class="ws-voice-channel-member-screen-share"
            data-ws-part="voice.channel-tree.member-screen-share"
            role="img"
            :aria-label="t('screenShare')"
            :title="t('screenShare')"
          ><Icon name="monitor" :size="12" /></span>
        </li>
        <VoiceChannelTreeItem
          v-for="child in node.children"
          :key="child.channel.id"
          :node="child"
          :depth="depth + 1"
          :layout="layout"
          :current-channel-id="currentChannelId"
          :selected-channel-id="selectedChannelId"
          :expanded-ids="expandedIds"
          :avatar-style="avatarStyle"
          :avatar-initial="avatarInitial"
          :is-speaking="isSpeaking"
          :is-screen-sharing="isScreenSharing"
          :show-member-actions="showMemberActions"
          :member-drag-drop="memberDragDrop"
          :dragged-member-id="draggedMemberId"
          :drag-over-channel-id="dragOverChannelId"
          :t="t"
          @toggle="emit('toggle', $event)"
          @select="emit('select', $event)"
          @join="emit('join', $event)"
          @member-context-menu="emit('memberContextMenu', $event)"
          @member-drag-start="emit('memberDragStart', $event)"
          @member-drag-end="emit('memberDragEnd')"
          @channel-drag-over="emit('channelDragOver', $event)"
          @channel-drag-leave="emit('channelDragLeave', $event)"
          @channel-drop="emit('channelDrop', $event)"
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
  layout: "default" | "server-sidebar";
  currentChannelId?: string;
  selectedChannelId: string;
  expandedIds: ReadonlySet<string>;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => CSSProperties;
  avatarInitial: (name: string) => string;
  isSpeaking: (member: ChannelMember) => boolean;
  isScreenSharing?: (member: ChannelMember) => boolean;
  showMemberActions?: boolean;
  memberDragDrop?: boolean;
  draggedMemberId?: number | null;
  dragOverChannelId?: string;
  t: (key: string) => string;
}>();

const emit = defineEmits<{
  toggle: [channelId: string];
  select: [channelId: string];
  join: [channel: TreeChannel];
  memberContextMenu: [payload: { member: ChannelMember; event: MouseEvent }];
  memberDragStart: [payload: { member: ChannelMember; event: DragEvent }];
  memberDragEnd: [];
  channelDragOver: [payload: { channel: TreeChannel; event: DragEvent }];
  channelDragLeave: [payload: { channel: TreeChannel; event: DragEvent }];
  channelDrop: [payload: { channel: TreeChannel; event: DragEvent }];
}>();

const expanded = computed(() => props.expandedIds.has(props.node.channel.id));
const hasChildren = computed(() => props.node.children.length > 0);
const hasContents = computed(() => hasChildren.value || props.node.channel.members.length > 0);
const isExpandable = computed(() => props.layout === "server-sidebar" ? hasChildren.value : hasContents.value);
const current = computed(() => props.node.channel.id === props.currentChannelId);
const selected = computed(() => props.node.channel.id === props.selectedChannelId);
const memberCount = computed(() => String(props.node.channel.members.length).padStart(2, "0"));

function join(): void {
  if (props.node.channel.id !== props.currentChannelId) emit("join", props.node.channel);
}

function handleMemberContextMenu(member: ChannelMember, event: MouseEvent): void {
  if (!props.showMemberActions) return;
  event.preventDefault();
  event.stopPropagation();
  emit("memberContextMenu", { member, event });
}

function handleMemberDragStart(member: ChannelMember, event: DragEvent): void {
  if (props.memberDragDrop) emit("memberDragStart", { member, event });
}

function handleChannelDragOver(event: DragEvent): void {
  if (props.memberDragDrop) emit("channelDragOver", { channel: props.node.channel, event });
}

function handleChannelDragLeave(event: DragEvent): void {
  if (props.memberDragDrop) emit("channelDragLeave", { channel: props.node.channel, event });
}

function handleChannelDrop(event: DragEvent): void {
  if (props.memberDragDrop) emit("channelDrop", { channel: props.node.channel, event });
}
</script>

<style scoped>
.ws-voice-channel-member-screen-share {
  display: inline-grid;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  place-items: center;
  border-radius: 5px;
  color: #fff;
  background: #72c800;
  line-height: 0;
}
</style>
