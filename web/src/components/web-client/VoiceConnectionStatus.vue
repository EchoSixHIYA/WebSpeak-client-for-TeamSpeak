<template>
  <section
    v-if="!connected"
    class="voice-connection-status"
    data-ws-part="voice.connection-status"
    :data-ws-state="connecting ? 'connecting' : error ? 'failed' : 'disconnected'"
  >
    <p role="status" aria-live="polite" data-ws-part="voice.connection-status.message">
      {{ connecting ? t('connecting') : error || t('voiceHealthDisconnected') }}
    </p>
    <label data-ws-part="voice.connection-status.nickname">
      <span>{{ t('nickname') }}</span>
      <input
        :value="nickname"
        :disabled="connecting"
        maxlength="30"
        autocomplete="nickname"
        data-ws-part="voice.connection-status.nickname.input"
        @input="$emit('update:nickname', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <button
      type="button"
      :disabled="!canConnect || connecting"
      data-ws-part="voice.connection-status.reconnect"
      @click="$emit('connect')"
    ><Icon v-if="connecting" name="refresh" :size="16" />{{ t('reconnectNow') }}</button>
  </section>
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";

defineProps<{
  connected: boolean;
  connecting: boolean;
  nickname: string;
  error: string;
  canConnect: boolean;
  t: (key: string) => string;
}>();
defineEmits<{ connect: []; 'update:nickname': [value: string] }>();
</script>
