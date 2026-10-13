<script setup lang="ts">
import Icon from "../Icon.vue";

defineProps<{
  currentLabel: string;
  totalLabel?: string;
}>();
</script>

<template>
  <div
    class="visitor-count"
    data-ws-part="home.visitors"
    role="status"
    aria-live="polite"
  >
    <span class="visitor-count-orbit" data-ws-part="home.visitors.orbit" aria-hidden="true"></span>
    <span class="visitor-count-icon" data-ws-part="home.visitors.icon">
      <Icon name="users" :size="15" />
    </span>
    <span class="visitor-count-label" data-ws-part="home.visitors.label">{{ currentLabel }}</span>
    <span
      v-if="totalLabel"
      class="visitor-count-divider"
      data-ws-part="home.visitors.divider"
      aria-hidden="true"
    ></span>
    <span
      v-if="totalLabel"
      class="visitor-count-total"
      data-ws-part="home.visitors.total"
    >{{ totalLabel }}</span>
    <span class="visitor-count-spark" data-ws-part="home.visitors.spark" aria-hidden="true">✦</span>
  </div>
</template>
