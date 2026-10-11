<template>
  <header class="ws-voice-server-header">
    <div class="ws-voice-server-title-line">
      <strong class="ws-voice-server-name">{{ serverLabel || "TeamSpeak" }}</strong>
      <VoiceServerSwitcher :servers="servers" :on-switch-server="onSwitchServer" />
    </div>
    <div class="ws-voice-server-meta-line">
      <div class="ws-voice-server-tags">
        <span class="ws-voice-server-tag">TeamSpeak</span>
        <span class="ws-voice-server-tag" :class="`is-${connectionState}`">
          <i v-if="connectionState === 'connected'" aria-hidden="true"></i>
          {{ connectionLabel }}
        </span>
      </div>
      <button
        ref="searchButton"
        class="ws-voice-server-search-toggle"
        type="button"
        :aria-expanded="searchOpen"
        aria-label="搜索频道 / Search channels"
        title="搜索频道 / Search channels"
        @click="toggleSearch"
      ><Icon name="search" :size="18" /></button>
    </div>
    <label v-if="searchOpen" class="ws-voice-server-search-box">
      <span class="sr-only">搜索频道名称 / Search channel names</span>
      <Icon name="search" :size="16" />
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="搜索频道 / Search channels"
        @keydown.esc.prevent="closeSearch"
      />
      <button v-if="query" type="button" aria-label="清除搜索 / Clear search" @click="query = ''; searchInput?.focus()">
        <Icon name="close" :size="15" />
      </button>
    </label>
    <div class="ws-voice-server-divider" aria-hidden="true"></div>
  </header>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { SkinPluginQuickServer } from "../../services/skin-plugin-context.js";
import Icon from "../Icon.vue";
import VoiceServerSwitcher from "./VoiceServerSwitcher.vue";

const props = defineProps<{
  serverLabel: string;
  connectionState: "connected" | "connecting" | "disconnected";
  servers: readonly SkinPluginQuickServer[];
  onSwitchServer: (quickServerId: string) => void;
}>();

const emit = defineEmits<{ "update:query": [value: string] }>();
const searchOpen = ref(false);
const query = ref("");
const searchButton = ref<HTMLButtonElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const connectionLabel = computed(() => ({
  connected: "已连接",
  connecting: "连接中",
  disconnected: "未连接",
})[props.connectionState]);

watch(query, (value) => emit("update:query", value));

async function toggleSearch(): Promise<void> {
  if (searchOpen.value) {
    closeSearch();
    return;
  }
  searchOpen.value = true;
  await nextTick();
  searchInput.value?.focus();
}

function closeSearch(): void {
  searchOpen.value = false;
  query.value = "";
  void nextTick(() => searchButton.value?.focus());
}
</script>
