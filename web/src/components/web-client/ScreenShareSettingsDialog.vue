<template>
  <div
    class="modal-backdrop screen-share-settings-backdrop"
    @click.self="emit('close')"
  >
    <section
      ref="dialog"
      tabindex="-1"
      @keydown="onDialogKeydown"
      class="screen-share-settings-modal"
      data-ws-part="voice.screen-share-settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screen-share-settings-title"
      @click.stop
    >
      <button
        type="button"
        class="screen-share-settings-close"
        :aria-label="t('close')"
        :title="t('close')"
        @click="emit('close')"
        ><Icon
          name="close"
          :size="17"
      /></button>
      <div
        class="screen-share-settings-heading"
        data-ws-part="voice.screen-share-settings.heading"
        ><span class="card-kicker">{{ t("screenShare") }}</span
        ><h2 id="screen-share-settings-title">{{ t("screenShareSettings") }}</h2
        ><p>{{ t("screenShareSettingsHint") }}</p></div
      >
      <div
        class="screen-share-settings-fields"
        data-ws-part="voice.screen-share-settings.fields"
      >
        <label
          ><span>{{ t("screenShareResolution") }}</span
          ><select
            v-model="screenShareResolutionPreset"
            :aria-label="t('screenShareResolution')"
            ><option
              v-for="option in screenShareResolutionOptions"
              :key="option.value"
              :value="option.value"
              >{{ t(option.label) }}</option
            ></select
          ></label
        >
        <label
          ><span>{{ t("screenShareFrameRate") }}</span
          ><select
            v-model.number="screenShareFrameRate"
            :aria-label="t('screenShareFrameRate')"
            ><option
              v-for="fps in screenShareFrameRateOptions"
              :key="fps"
              :value="fps"
              >{{ fps }} FPS</option
            ></select
          ></label
        >
        <label
          ><span>{{ t("screenShareBitrate") }}</span
          ><select
            v-model="screenShareBitratePreset"
            :aria-label="t('screenShareBitrate')"
            ><option
              v-for="option in screenShareBitrateOptions"
              :key="option.value"
              :value="option.value"
              >{{ t(option.label) }}</option
            ></select
          ></label
        >
      </div>
      <p
        class="screen-share-settings-note"
        data-ws-part="voice.screen-share-settings.note"
        >{{ t("screenShareSettingsNote") }}</p
      >
      <footer
        class="screen-share-settings-footer"
        data-ws-part="voice.screen-share-settings.actions"
        ><button
          type="button"
          class="text-button"
          @click="emit('close')"
          >{{ t("cancel") }}</button
        ><button
          type="button"
          class="primary-button screen-share-settings-start"
          @click="startScreenShareWithSettings"
          ><Icon
            name="monitor"
            :size="14"
          />
          {{ t("startScreenShare") }}</button
        ></footer
      >
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Icon from "../Icon.vue";
import { useDialogFocus } from "../../composables/useDialogFocus.js";
import type { useWebClientScreenShare } from "../../composables/useWebClientScreenShare.js";
const props = defineProps<{ model: Pick<ReturnType<typeof useWebClientScreenShare>, "resolutionOptions" | "frameRateOptions" | "bitrateOptions" | "resolutionPreset" | "frameRate" | "bitratePreset" | "startWithSettings">; t: (key: string) => string }>();
const { resolutionOptions: screenShareResolutionOptions, frameRateOptions: screenShareFrameRateOptions, bitrateOptions: screenShareBitrateOptions, resolutionPreset: screenShareResolutionPreset, frameRate: screenShareFrameRate, bitratePreset: screenShareBitratePreset, startWithSettings: startScreenShareWithSettings } = props.model;
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const { onDialogKeydown } = useDialogFocus(dialog, () => emit("close"));
</script>
