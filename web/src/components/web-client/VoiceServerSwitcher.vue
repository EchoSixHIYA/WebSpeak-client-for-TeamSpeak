<template>
  <div
    ref="rootElement"
    class="ws-voice-server-switcher"
    data-ws-part="voice.server-switcher"
    @keydown.esc.prevent.stop="closeMenu"
  >
    <button
      ref="triggerElement"
      type="button"
      class="ws-voice-server-switcher-trigger"
      data-ws-part="voice.server-switcher.trigger"
      aria-label="切换服务器 / Switch server"
      title="切换服务器 / Switch server"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="open = !open"
    ><Icon name="menu" :size="17" /></button>
    <div
      v-if="open"
      class="ws-voice-server-switcher-menu"
      data-ws-part="voice.server-switcher.menu"
      role="group"
      aria-label="快速切换服务器 / Quick server switch"
    >
      <button
        v-for="server in servers"
        :key="server.id"
        type="button"
        class="ws-voice-server-switcher-item"
        data-ws-part="voice.server-switcher.item"
        :class="{ 'is-current': server.current }"
        :aria-current="server.current ? 'true' : undefined"
        :disabled="server.current"
        @click="switchServer(server)"
      >
        <span class="ws-voice-server-switcher-icon" data-ws-part="voice.server-switcher.icon" :data-tone="server.tone">
          <img v-if="server.icon" :src="server.icon" alt="" />
          <span v-else>{{ server.monogram }}</span>
        </span>
          <span class="ws-voice-server-switcher-label" data-ws-part="voice.server-switcher.label">{{ server.label }}</span>
        <Icon v-if="server.current" class="ws-voice-server-switcher-current" data-ws-part="voice.server-switcher.current" name="check" :size="14" />
      </button>
      <p v-if="!otherServerCount" class="ws-voice-server-switcher-empty" data-ws-part="voice.server-switcher.empty">
        暂无其他收藏或最近连接的服务器。<br />Save or connect to another server to switch here.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { SkinPluginQuickServer } from "../../services/skin-plugin-context.js";
import Icon from "../Icon.vue";

const props = defineProps<{
  servers: readonly SkinPluginQuickServer[];
  onSwitchServer: (quickServerId: string) => void;
}>();

const open = ref(false);
const rootElement = ref<HTMLElement | null>(null);
const triggerElement = ref<HTMLButtonElement | null>(null);
const otherServerCount = computed(() => props.servers.filter((server) => !server.current).length);

function switchServer(server: SkinPluginQuickServer): void {
  if (server.current) return;
  props.onSwitchServer(server.id);
  closeMenu();
}

function closeMenu(): void {
  if (!open.value) return;
  open.value = false;
  triggerElement.value?.focus();
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (event.target instanceof Node && !rootElement.value?.contains(event.target)) closeMenu();
}

onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointerDown));
</script>
