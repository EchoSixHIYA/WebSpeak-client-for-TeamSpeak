<template>
  <section
    :ref="setPlayerElement"
    class="screen-share-player"
    data-ws-part="voice.screen-player"
    role="region"
    :aria-label="t('screenShare')"
  >
    <div
      :ref="setStageElement"
      class="screen-share-player-stage"
      data-ws-part="voice.screen-player.stage"
      :style="stageSizeStyle"
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
import { calculateScreenSharePlayerSize } from "../../composables/useWebClientScreenShare.js";
const props = defineProps<{
  model: Pick<ReturnType<typeof useWebClientScreenShare>, "fullscreen" | "viewers" | "viewerCount" | "ownerName" | "errorText" | "setPlayerElement" | "setVideoElement" | "viewerStyle" | "setVolume" | "toggleFullscreen">;
  screenShareRemoteStream: MediaStream | null; screenShareRemoteVolume: number; screenShareError: string;
  leaveScreenShare: () => void; avatarInitial: (name: string) => string; t: (key: string) => string;
}>();
const { fullscreen: screenShareFullscreen, viewers: screenSharePlayerViewers, viewerCount: screenSharePlayerViewerCount, ownerName: screenSharePlayerOwnerName, errorText: screenShareErrorText, setPlayerElement, setVideoElement: setScreenVideoElement, viewerStyle: screenShareViewerStyle, setVolume: onScreenShareVolume, toggleFullscreen: toggleScreenShareFullscreen } = props.model;
const stageElement = ref<HTMLElement | null>(null);
const stageSizeStyle = ref<Record<string, string>>({ aspectRatio: "16 / 9" });
let stageResizeObserver: ResizeObserver | null = null;

function updateStageSize(): void {
  const stage = stageElement.value;
  const video = stage?.querySelector("video");
  if (stage && screenShareFullscreen.value) {
    stageSizeStyle.value = { width: "100%", height: "100%", aspectRatio: "auto" };
    return;
  }
  if (!stage || !video?.videoWidth || !video.videoHeight) return;
  const parentWidth = stage.parentElement?.parentElement?.clientWidth || window.innerWidth;
  const size = calculateScreenSharePlayerSize(
    video.videoWidth,
    video.videoHeight,
    Math.min(parentWidth, 1100),
    Math.max(220, Math.min(window.innerHeight - 220, 720)),
  );
  if (!size) return;
  stageSizeStyle.value = {
    width: `${size.width}px`,
    height: `${size.height}px`,
    aspectRatio: `${video.videoWidth} / ${video.videoHeight}`,
  };
}

function setStageElement(element: unknown): void {
  stageResizeObserver?.disconnect();
  stageElement.value = element instanceof HTMLElement ? element : null;
  if (stageElement.value && typeof ResizeObserver !== "undefined") {
    stageResizeObserver = new ResizeObserver(updateStageSize);
    const parent = stageElement.value.parentElement?.parentElement ?? stageElement.value.parentElement;
    if (parent) stageResizeObserver.observe(parent);
    updateStageSize();
  }
}

onMounted(() => window.addEventListener("resize", updateStageSize));
watch(screenShareFullscreen, updateStageSize);
onBeforeUnmount(() => {
  window.removeEventListener("resize", updateStageSize);
  stageResizeObserver?.disconnect();
});
</script>
