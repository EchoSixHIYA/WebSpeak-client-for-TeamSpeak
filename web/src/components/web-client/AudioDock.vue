<template>
  <div
    class="desktop-audio-dock"
    data-ws-part="voice.audio-dock"
    role="toolbar"
    :aria-label="t('desktopAudioControls')"
  >
    <div class="desktop-audio-dock-copy"
      ><strong>{{ t("desktopAudioControls") }}</strong
      ><span>{{
        accompanimentActive ? t("accompanimentActive") : t("desktopAudioHint")
      }}</span></div
    >
    <div class="desktop-audio-dock-actions">
      <div
        class="dock-hover-control"
        data-ws-part="voice.audio-dock.microphone"
      >
        <button
          type="button"
          class="dock-audio-button microphone-header-toggle"
          :class="{ muted: microphoneMuted }"
          :title="microphoneMuted ? t('unmuteMic') : t('muteMic')"
          :aria-label="microphoneMuted ? t('microphoneMuted') : t('microphoneActive')"
          :aria-pressed="!microphoneMuted"
          aria-haspopup="dialog"
          @click="toggleMicrophone"
          ><Icon
            :name="microphoneMuted ? 'mic-off' : 'mic'"
            :size="18"
        /></button>
        <div
          class="dock-hover-panel dock-microphone-panel"
          data-ws-part="voice.audio-dock.microphone-panel"
          role="dialog"
          :aria-label="t('microphone')"
        >
          <div class="dock-slider-heading"
            ><span>{{ t("inputVolume") }}</span
            ><strong>{{ Math.round(inputVolume * 100) }}%</strong></div
          >
          <input
            class="dock-slider"
            type="range"
            min="0"
            max="100"
            :value="inputVolume * 100"
            :style="rangeStyle(inputVolume, 1)"
            :aria-label="t('inputVolume')"
            @input="onInputVolume"
          />
          <div class="dock-panel-divider"></div>
          <label class="dock-switch-row"
            ><span
              ><strong>{{ t("noiseSuppression") }}</strong></span
            ><input
              type="checkbox"
              :checked="noiseSuppressionEnabled"
              :aria-label="t('noiseSuppression')"
              @change="onNoiseSuppressionToggle"
          /></label>
        </div>
      </div>
      <div
        class="dock-hover-control"
        data-ws-part="voice.audio-dock.output"
      >
        <button
          type="button"
          class="dock-audio-button"
          :class="{ muted: outputMuted }"
          :title="outputMuted ? t('unmuteOutput') : t('muteOutput')"
          :aria-label="outputMuted ? t('unmuteOutput') : t('muteOutput')"
          :aria-pressed="!outputMuted"
          aria-haspopup="dialog"
          @click="emit('outputMute')"
          ><Icon
            :name="outputMuted ? 'volume-off' : 'volume'"
            :size="18"
        /></button>
        <div
          class="dock-hover-panel dock-output-panel"
          data-ws-part="voice.audio-dock.output-panel"
          role="dialog"
          :aria-label="t('overallVolume')"
        >
          <div class="dock-slider-heading"
            ><span>{{ t("overallVolume") }}</span
            ><strong>{{ Math.round(outputVolume * 100) }}%</strong></div
          >
          <input
            class="dock-slider"
            type="range"
            min="0"
            max="100"
            :value="outputVolume * 100"
            :style="rangeStyle(outputVolume, 1)"
            :aria-label="t('overallVolume')"
            @input="onOutputVolume"
          />
        </div>
      </div>
      <button
        type="button"
        class="dock-audio-button"
        :title="t('audioSettings')"
        :aria-label="t('audioSettings')"
        @click="emit('settings')"
        ><Icon
          name="settings"
          :size="18"
      /></button>
      <button
        type="button"
        class="dock-audio-button accompaniment-toggle"
        :class="{ active: accompanimentActive }"
        :title="accompanimentActive ? t('stopAccompaniment') : t('startAccompaniment')"
        :aria-label="accompanimentActive ? t('stopAccompaniment') : t('startAccompaniment')"
        :aria-pressed="accompanimentActive"
        @click="toggleAccompaniment"
        ><Icon
          name="music"
          :size="18"
      /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";
import type { useVoiceWebSocket } from "../../composables/useVoiceWebSocket.js";
import type { useWebClientAudioControls } from "../../composables/useWebClientAudioControls.js";

const props = defineProps<{
  model: Pick<ReturnType<typeof useVoiceWebSocket>, "microphoneMuted" | "inputVolume" | "outputVolume" | "outputMuted" | "noiseSuppressionEnabled" | "accompanimentActive">;
  controls: Pick<ReturnType<typeof useWebClientAudioControls>, "toggleMicrophone" | "toggleNoiseSuppression" | "onInputVolume" | "onOutputVolume" | "onNoiseSuppressionToggle" | "toggleAccompaniment">;
  t: (key: string) => string;
  rangeStyle: (value: number, max: number) => Record<string, string>;
}>();
const { microphoneMuted, inputVolume, outputVolume, outputMuted, noiseSuppressionEnabled, accompanimentActive } = props.model;
const { toggleMicrophone, onInputVolume, onOutputVolume, onNoiseSuppressionToggle, toggleAccompaniment } = props.controls;
const emit = defineEmits<{ settings: []; outputMute: [] }>();
</script>
