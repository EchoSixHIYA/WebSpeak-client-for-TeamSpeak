<template>
  <section
    v-if="hasContent"
    class="ws-voice-server-banner"
    role="group"
    :aria-label="t('serverWelcome')"
  >
    <img
      v-if="bannerUrl && !imageFailed"
      class="ws-voice-server-banner-image"
      data-ws-part="voice.server-banner.image"
      :src="bannerUrl"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="imageFailed = true"
    />
    <div
      v-if="welcomeBody"
      class="ws-voice-server-banner-welcome"
      data-ws-part="voice.server-banner.welcome"
    >
      <span
        class="ws-voice-server-banner-icon"
        data-ws-part="voice.server-banner.icon"
        aria-hidden="true"
      ><Icon name="message" :size="16" /></span>
      <div class="ws-voice-server-banner-copy">
        <strong data-ws-part="voice.server-banner.title">{{ welcomeTitle }}</strong>
        <p data-ws-part="voice.server-banner.body">{{ welcomeBody }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "../Icon.vue";

const props = defineProps<{
  bannerUrl: string | null;
  welcomeMessage: string;
  t: (key: string) => string;
}>();

const imageFailed = ref(false);
const bannerUrl = computed(() => {
  if (!props.bannerUrl || props.bannerUrl.length > 2_048) return null;
  try {
    const url = new URL(props.bannerUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
});

const plainWelcomeMessage = computed(() => props.welcomeMessage
  .replace(/\[[^\]\r\n]{1,160}\]/g, "")
  .replace(/\r\n?/g, "\n")
  .trim());
const welcomeLines = computed(() => plainWelcomeMessage.value.split("\n").map(line => line.trim()).filter(Boolean));
const welcomeTitle = computed(() => welcomeLines.value.length > 1 ? welcomeLines.value[0]! : props.t("serverWelcome"));
const welcomeBody = computed(() => welcomeLines.value.length > 1
  ? welcomeLines.value.slice(1).join("\n").trim()
  : welcomeLines.value[0] ?? "");
const hasContent = computed(() => Boolean((bannerUrl.value && !imageFailed.value) || welcomeBody.value));

watch(bannerUrl, () => { imageFailed.value = false; });
</script>
