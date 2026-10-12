<template>
  <section
    :ref="setPlayerElementNode"
    class="screen-share-player"
    data-ws-part="voice.screen-player"
    role="region"
    :aria-label="t('screenShare')"
  >
    <div
      :ref="setStageElement"
      class="screen-share-player-stage"
      data-ws-part="voice.screen-player.stage"
    >
      <video
        v-if="screenShareRemoteStream"
        :ref="setScreenVideoElement"
        class="screen-share-player-video"
        data-ws-part="voice.screen-player.video"
        autoplay
        playsinline
        :muted="screenShareRemoteVolume === 0"
        @loadedmetadata="updateStageSize"
      ></video>
      <div
        v-else
        class="screen-share-player-placeholder"
        data-ws-part="voice.screen-player.placeholder"
        ><span class="screen-share-player-placeholder-icon"
          ><Icon
            name="monitor"
            :size="28" /></span
        ><strong>{{ t("screenShareConnecting") }}</strong
        ><span>{{ screenShareError ? screenShareErrorText : t("directP2POnly") }}</span></div
      >
      <button
        type="button"
        class="screen-share-player-exit"
        data-ws-part="voice.screen-player.exit"
        :aria-label="t('screenShareExit')"
        :title="t('screenShareExit')"
        @click="leaveScreenShare"
        ><Icon
          name="close"
          :size="22"
      /></button>
      <div
        class="screen-share-player-viewers"
        data-ws-part="voice.screen-player.viewers"
        :aria-label="t('screenShareViewers')"
      >
        <span class="screen-share-player-viewer-label"
          ><Icon
            name="users"
            :size="14"
          />
          {{ screenSharePlayerViewerCount }}</span
        >
        <span class="screen-share-player-viewer-avatars"
          ><span
            v-for="viewer in screenSharePlayerViewers"
            :key="viewer.peerId"
            class="screen-share-player-viewer-avatar"
            data-ws-part="voice.screen-player.viewer-avatar"
            :style="screenShareViewerStyle(viewer)"
            :title="viewer.nickname"
            >{{ viewer.avatar ? "" : avatarInitial(viewer.nickname) }}</span
          ></span
        >
      </div>
      <span
        class="screen-share-player-live"
        data-ws-part="voice.screen-player.live"
        ><i></i>{{ t("watchingScreenShare") }}</span
      >
      <span
        class="screen-share-player-source"
        data-ws-part="voice.screen-player.source"
        >{{ screenSharePlayerOwnerName }}</span
      >
      <div
        class="screen-share-player-controls"
        data-ws-part="voice.screen-player.controls"
      >
        <label
          data-ws-part="voice.screen-player.volume"
          :title="t('screenShareVolume')"
          ><Icon
            :name="screenShareRemoteVolume === 0 ? 'volume-off' : 'volume'"
            :size="18" /><input
            type="range"
            min="0"
            max="100"
            :value="screenShareRemoteVolume * 100"
            :aria-label="t('screenShareVolume')"
            @input="onScreenShareVolume"
        /></label>
        <button
          type="button"
          data-ws-part="voice.screen-player.fullscreen"
          :aria-label="
            screenShareFullscreen ? t('screenShareExitFullscreen') : t('screenShareFullscreen')
          "
          :title="
            screenShareFullscreen ? t('screenShareExitFullscreen') : t('screenShareFullscreen')
          "
          @click="toggleScreenShareFullscreen"
          ><Icon
            :name="screenShareFullscreen ? 'fullscreen-exit' : 'fullscreen'"
            :size="19"
        /></button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { useWebClientScreenShare } from "../../composables/useWebClientScreenShare.js";
const props = defineProps<{
  model: Pick<ReturnType<typeof useWebClientScreenShare>, "fullscreen" | "viewers" | "viewerCount" | "ownerName" | "errorText" | "setPlayerElement" | "setVideoElement" | "viewerStyle" | "setVolume" | "toggleFullscreen">;
  screenShareRemoteStream: MediaStream | null; screenShareRemoteVolume: number; screenShareError: string;
  leaveScreenShare: () => void; avatarInitial: (name: string) => string; t: (key: string) => string;
}>();
const { fullscreen: screenShareFullscreen, viewers: screenSharePlayerViewers, viewerCount: screenSharePlayerViewerCount, ownerName: screenSharePlayerOwnerName, errorText: screenShareErrorText, setPlayerElement, setVideoElement: setScreenVideoElement, viewerStyle: screenShareViewerStyle, setVolume: onScreenShareVolume, toggleFullscreen: toggleScreenShareFullscreen } = props.model;
const playerElement = ref<HTMLElement | null>(null);
const stageElement = ref<HTMLElement | null>(null);

function setInlineStyle(element: HTMLElement, property: string, value: string | null): void {
  if (value === null) {
    if (element.style.getPropertyValue(property)) element.style.removeProperty(property);
  } else if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
}

function updateStageSize(): void {
  const stage = stageElement.value;
  const player = playerElement.value ?? stage?.parentElement ?? null;
  if (!stage || !player) return;
  if (screenShareFullscreen.value) {
    setInlineStyle(player, "width", "100vw");
    setInlineStyle(player, "height", "100vh");
    setInlineStyle(stage, "width", "100%");
    setInlineStyle(stage, "height", "100%");
    setInlineStyle(stage, "aspect-ratio", "auto");
    return;
  }
  setInlineStyle(player, "width", null);
  setInlineStyle(player, "height", null);
  setInlineStyle(stage, "width", null);
  setInlineStyle(stage, "height", null);
  setInlineStyle(stage, "aspect-ratio", "16 / 9");
}

function setPlayerElementNode(element: unknown): void {
  const next = element instanceof HTMLElement ? element : null;
  if (playerElement.value === next) return;
  playerElement.value = next;
  setPlayerElement(next);
  updateStageSize();
}

function setStageElement(element: unknown): void {
  const next = element instanceof HTMLElement ? element : null;
  if (stageElement.value === next) return;
  stageElement.value = next;
  updateStageSize();
}

onMounted(() => window.addEventListener("resize", updateStageSize));
watch(screenShareFullscreen, updateStageSize);
onBeforeUnmount(() => {
  window.removeEventListener("resize", updateStageSize);
});
</script>
