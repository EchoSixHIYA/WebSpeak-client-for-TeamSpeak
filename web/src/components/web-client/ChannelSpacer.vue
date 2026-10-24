<template>
  <span
    class="ws-channel-spacer"
    data-ws-part="voice.channel-spacer"
    :data-alignment="spacer.alignment"
    :data-spacer-style="spacer.style"
    :aria-label="spacer.text || undefined"
  ><span :aria-hidden="spacer.alignment === 'repeat' || spacer.style !== 'text' ? 'true' : undefined">{{ displayText }}</span></span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ChannelSpacer } from "../../../../src/shared/channel-spacer.js";

const props = defineProps<{ spacer: ChannelSpacer }>();
const displayText = computed(() => {
  if (props.spacer.style !== "text") return "";
  const text = props.spacer.text;
  // Clip a bounded run in CSS rather than measuring DOM or growing with viewport width.
  return props.spacer.alignment === "repeat" && text
    ? text.repeat(Math.max(1, Math.floor(1024 / text.length)))
    : text;
});
</script>

<style scoped>
.ws-channel-spacer {
  display: block;
  flex: 1 1 0;
  min-width: 0;
  width: 100%;
  min-height: 1.3em;
  overflow: hidden;
  color: inherit;
  font: inherit;
  line-height: 1.3;
  text-align: left;
}
.ws-channel-spacer > span { white-space: pre; }
.ws-channel-spacer[data-alignment="center"] { text-align: center; }
.ws-channel-spacer[data-alignment="right"] { text-align: right; }
.ws-channel-spacer:where(:not([data-spacer-style="text"]))::before {
  content: "";
  display: block;
  margin-block: .6em;
  border-top: 1px solid currentColor;
  opacity: .55;
}
.ws-channel-spacer[data-spacer-style="dashed"]::before { border-top-style: dashed; }
.ws-channel-spacer[data-spacer-style="dotted"]::before { border-top-style: dotted; }
.ws-channel-spacer[data-spacer-style="dash-dot"]::before,
.ws-channel-spacer[data-spacer-style="dash-dot-dot"]::before {
  height: 1px;
  border: 0;
  background: repeating-linear-gradient(to right, currentColor 0 6px, transparent 6px 9px, currentColor 9px 11px, transparent 11px 14px);
}
.ws-channel-spacer[data-spacer-style="dash-dot-dot"]::before {
  background: repeating-linear-gradient(to right, currentColor 0 6px, transparent 6px 9px, currentColor 9px 11px, transparent 11px 14px, currentColor 14px 16px, transparent 16px 19px);
}
</style>
