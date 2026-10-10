<template>
  <div
    class="modal-backdrop"
    @click.self="emit('close')"
  >
    <section
      class="settings-modal"
      data-ws-part="voice.audio-settings"
      ref="dialog"
      tabindex="-1"
      @keydown="onDialogKeydown"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'settings-title'"
    >
      <div class="settings-main"
        ><header class="settings-header"
          ><h2 id="settings-title">{{ t("audioConfiguration") }}</h2
          ><button
            class="round-icon"
            :title="t('close')"
            @click="emit('close')"
            ><Icon
              name="close"
              :size="19" /></button></header
        ><div class="settings-content">
          <div class="settings-audio-card">
          <section class="settings-section"
            ><h3
              ><Icon
                name="mic"
                :size="20"
              />
              {{ t("inputDevice") }}</h3
            ><div class="settings-form-row"
              ><label
                class="settings-label"
                for="input-device"
                >{{ t("microphone") }}</label
              ><AudioDeviceSelect
                id="input-device"
                :model-value="selectedInputDeviceId"
                :options="inputDeviceOptions"
                :label="t('microphone')"
                :disabled="!inputDevices.length"
                @change="onInputDeviceChange"
              /></div
            ><p
              v-if="audioSettingsError"
              class="settings-error"
              >{{ localizedMessage(audioSettingsError) }}</p
            ><p class="audio-diagnostic"
              ><span>{{ t("permission") }}</span
              ><strong :class="`permission-${audioPermission}`">{{
                audioPermission === "granted"
                  ? t("permissionGranted")
                  : audioPermission === "denied"
                    ? t("permissionDenied")
                    : t("permissionUnknown")
              }}</strong></p
            ><div class="microphone-control"
              ><div
                ><label class="settings-label">{{ t("microphoneState") }}</label
                ><p class="settings-hint">{{
                  microphoneMuted ? t("microphoneMutedHint") : t("microphoneActiveHint")
                }}</p></div
              ><button
                type="button"
                class="microphone-toggle"
                :class="{ muted: microphoneMuted }"
                :aria-pressed="!microphoneMuted"
                @click="toggleMicrophone"
                ><Icon
                  :name="microphoneMuted ? 'mic-off' : 'mic'"
                  :size="16"
                />
                {{ microphoneMuted ? t("unmuteMic") : t("muteMic") }}</button
              ></div
            ><label
              v-if="isMobileViewport"
              class="mobile-noise-toggle"
              ><span
                ><strong>{{ t("noiseSuppression") }}</strong
                ><small>{{ t("noiseSuppressionHint") }}</small></span
              ><input
                type="checkbox"
                :checked="noiseSuppressionEnabled"
                :aria-label="t('noiseSuppression')"
                @change="onNoiseSuppressionToggle" /></label
              ><div class="settings-form-row settings-range-form-row"
                ><label class="settings-label">{{ t("inputVolume") }}</label
                ><div class="settings-form-control"
                  ><div class="settings-range-row"
                    ><strong>{{ Math.round(inputVolume * 100) }}%</strong></div
                  ><input
                    class="settings-range"
                    type="range"
                    min="0"
                    max="100"
                    :value="inputVolume * 100"
                    :style="rangeStyle(inputVolume, 1)"
                    :aria-label="t('inputVolume')"
                    @input="onInputVolume"
                  /></div
              ></div
            ><div class="settings-form-row settings-range-form-row"
              ><label class="settings-label">{{ t("voxThreshold") }}</label
              ><div class="settings-form-control"
                ><div class="settings-range-row"
                  ><strong>{{ (voxThreshold * 100).toFixed(1) }}%</strong></div
                ><input
                  class="settings-range"
                  type="range"
                  min="1"
                  max="80"
                  :value="voxThreshold * 1000"
                  :style="rangeStyle(voxThreshold, 0.08)"
                  :aria-label="t('voxThreshold')"
                  @input="onVoxThreshold"
                /></div
            ></div
            ><div class="audio-level-row"
              ><span>{{ t("micLevel") }}</span
              ><strong>{{ Math.round(micLevel * 100) }}%</strong></div
            ><div class="audio-level-track"
              ><i :style="{ width: `${Math.round(micLevel * 100)}%` }"></i></div
            ><div class="mic-test"
              ><div class="mic-test-header"
                ><strong>{{ t("microphoneTest") }}</strong
                ><button
                  type="button"
                  @click="toggleMicTest"
                  >{{ microphoneTestActive ? t("stopTest") : t("startTest") }}</button
                ></div
              ><div class="meter"
                ><i
                  v-for="index in 24"
                  :key="index"
                  :class="{ active: microphoneTestActive && index <= micMeterBars }"
                  :style="{ height: `${meterBarHeight(index)}px` }"
                ></i></div
              ><div class="meter-labels"
                ><span>{{ t("silence") }}</span
                ><span>{{ t("optimal") }}</span
                ><span>{{ t("loud") }}</span></div
              ><p class="settings-hint">{{ t("localMicTestHint") }}</p
              ><audio
                v-if="testAudioUrl"
                class="test-audio"
                :src="testAudioUrl"
                controls
                :aria-label="t('microphoneTest')"
              ></audio></div
          ></section>
          <div class="settings-separator"></div
          ><section class="settings-section"
            ><h3
              ><Icon
                name="volume"
                :size="20"
              />
              {{ t("outputVolume") }}</h3
              ><div
              v-if="outputDeviceSupported"
              class="settings-form-row"
              ><label
                class="settings-label"
                for="output-device"
                >{{ t("outputDevice") }}</label
              ><AudioDeviceSelect
                id="output-device"
                :model-value="selectedOutputDeviceId"
                :options="outputDeviceOptions"
                :label="t('outputDevice')"
                :disabled="!outputDevices.length"
                @change="onOutputDeviceChange"
              /></div
            ><p
              v-else
              class="mode-note"
              ><Icon
                name="info"
                :size="16"
              /><span>{{ t("outputDeviceUnsupported") }}</span></p
            ><div class="settings-form-row settings-range-form-row"
              ><label class="settings-label">{{ t("speakers") }}</label
              ><div class="settings-form-control"
                ><div class="settings-range-row"
                  ><strong>{{ Math.round(outputVolume * 100) }}%</strong></div
                ><input
                  class="settings-range"
                  type="range"
                  min="0"
                  max="100"
                  :value="outputVolume * 100"
                  :style="rangeStyle(outputVolume, 1)"
                  :aria-label="t('outputVolume')"
                  @input="onOutputVolume"
                /></div
            ></div
          ><div class="settings-form-row settings-range-form-row"
            ><label class="settings-label">{{ t("notificationVolume") }}</label
            ><div class="settings-form-control"
              ><div class="settings-range-row"
                ><strong>{{ Math.round(notificationVolume * 100) }}%</strong></div
              ><input
                class="settings-range"
                type="range"
                min="0"
                max="100"
                :value="notificationVolume * 100"
                :style="rangeStyle(notificationVolume, 1)"
                :aria-label="t('notificationVolume')"
                @input="onNotificationVolume"
              /></div
          ></div
            ><div class="audio-diagnostic"
              ><span>{{ t("audioStatus") }}</span
              ><strong>{{
                audioContextState === "running"
                  ? microphoneError
                    ? t("audioUnavailable")
                    : t("audioReady")
                  : audioContextState === "suspended"
                    ? t("audioSuspended")
                    : t("audioUnknown")
              }}</strong></div
            ><p
              v-if="microphoneError"
              class="settings-error"
              >{{ localizedMessage(microphoneError) }}</p
            ><div class="mode-note"
              ><Icon
                name="shield"
                :size="16"
              /><span>{{ t("audioPrivacy") }}</span></div
            ></section
          ></div
        ></div
        ><footer class="settings-footer"
          ><button
            class="primary-button save-button"
            @click="emit('close')"
            >{{ t("done") }}</button
          ></footer
        ></div
      >
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type CSSProperties } from "vue";
import Icon from "../Icon.vue";
import AudioDeviceSelect from "./AudioDeviceSelect.vue";
import { useDialogFocus } from "../../composables/useDialogFocus.js";
import type { useVoiceWebSocket } from "../../composables/useVoiceWebSocket.js";
import type { useWebClientAudioControls } from "../../composables/useWebClientAudioControls.js";

type AudioSettingsState = Pick<ReturnType<typeof useVoiceWebSocket>,
  | "inputDevices"
  | "outputDevices"
  | "selectedInputDeviceId"
  | "selectedOutputDeviceId"
  | "outputDeviceSupported"
  | "audioPermission"
  | "audioContextState"
  | "microphoneMuted"
  | "noiseSuppressionEnabled"
  | "inputVolume"
  | "outputVolume"
  | "voxThreshold"
  | "notificationVolume"
  | "micLevel"
  | "microphoneTestActive"
  | "testAudioUrl"
>;
type AudioSettingsControls = Pick<ReturnType<typeof useWebClientAudioControls>,
  | "settingsError"
  | "onInputVolume"
  | "onNoiseSuppressionToggle"
  | "onOutputVolume"
  | "onVoxThreshold"
  | "onNotificationVolume"
  | "onInputDeviceChange"
  | "onOutputDeviceChange"
  | "toggleMicTest"
  | "micMeterBars"
  | "meterBarHeight"
  | "toggleMicrophone"
>;
const props = defineProps<{
  model: AudioSettingsState;
  controls: AudioSettingsControls;
  microphoneError: string;
  isMobileViewport: boolean;
  t: (key: string, variables?: Record<string, string | number>) => string;
  localizedMessage: (message: string) => string;
  rangeStyle: (value: number, max: number) => CSSProperties;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const { onDialogKeydown } = useDialogFocus(dialog, () => emit("close"));

// The page owns the stable voice refs and audio controller; this dialog only presents them.
const {
  inputDevices,
  outputDevices,
  selectedInputDeviceId,
  selectedOutputDeviceId,
  outputDeviceSupported,
  audioPermission,
  audioContextState,
  microphoneMuted,
  noiseSuppressionEnabled,
  inputVolume,
  outputVolume,
  voxThreshold,
  notificationVolume,
  micLevel,
  microphoneTestActive,
  testAudioUrl,
} = props.model;
const {
  settingsError: audioSettingsError,
  onInputVolume,
  onNoiseSuppressionToggle,
  onOutputVolume,
  onVoxThreshold,
  onNotificationVolume,
  onInputDeviceChange,
  onOutputDeviceChange,
  toggleMicTest,
  micMeterBars,
  meterBarHeight,
  toggleMicrophone,
} = props.controls;

const inputDeviceOptions = computed(() => [
  { value: "", label: props.t("defaultMicrophone") },
  ...inputDevices.map((device, index) => ({
    value: device.deviceId,
    label: device.label || props.t("microphoneNumber", { index: index + 1 }),
  })),
]);
const outputDeviceOptions = computed(() => [
  { value: "", label: props.t("defaultOutput") },
  ...outputDevices.map((device, index) => ({
    value: device.deviceId,
    label: device.label || props.t("speakerNumber", { index: index + 1 }),
  })),
]);
</script>
