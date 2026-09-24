import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import type { ChannelMember, ScreenShareOutputSettings, ScreenShareStream } from "./useVoiceWebSocket.js";

export type ScreenShareResolutionPreset = "source" | "720p" | "1080p";

interface ScreenShareResolutionOption {
  value: ScreenShareResolutionPreset;
  width?: number;
  height?: number;
  label: string;
}

interface UseWebClientScreenShareOptions {
  streams: ScreenShareStream[];
  viewing: Ref<boolean>;
  viewingStreamId: Ref<string>;
  remoteStream: Ref<MediaStream | null>;
  remoteVolume: Ref<number>;
  error: Ref<string>;
  errorCode: Ref<string>;
  startScreenShare: (audio?: boolean, settings?: ScreenShareOutputSettings) => Promise<void>;
  joinScreenShare: (streamId: string) => void;
  leaveScreenShare: () => void;
  nickname: Ref<string>;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => Record<string, string>;
  t: (key: string) => string;
}

export function useWebClientScreenShare({
  streams,
  viewing,
  viewingStreamId,
  remoteStream,
  remoteVolume,
  error,
  errorCode,
  startScreenShare,
  joinScreenShare,
  leaveScreenShare,
  nickname,
  avatarStyle,
  t,
}: UseWebClientScreenShareOptions) {
  const videoElement = ref<HTMLVideoElement | null>(null);
  const playerElement = ref<HTMLElement | null>(null);
  const fullscreen = ref(false);
  const resolutionOptions: ScreenShareResolutionOption[] = [
    { value: "source", label: "screenShareResolutionSource" },
    { value: "720p", width: 1280, height: 720, label: "screenShareResolution720p" },
    { value: "1080p", width: 1920, height: 1080, label: "screenShareResolution1080p" },
  ];
  const frameRateOptions = [5, 10, 15, 24, 30, 60];
  const storedResolution = localStorage.getItem("webspeak:screen-share-resolution") as ScreenShareResolutionPreset | null;
  const resolutionPreset = ref<ScreenShareResolutionPreset>(resolutionOptions.some((option) => option.value === storedResolution) ? storedResolution! : "1080p");
  const storedFrameRate = Number(localStorage.getItem("webspeak:screen-share-framerate"));
  const frameRate = ref(frameRateOptions.includes(storedFrameRate) ? storedFrameRate : 15);
  const settingsOpen = ref(false);
  const activeStream = computed<ScreenShareStream | null>(() => streams.find((stream) => stream.streamId === viewingStreamId.value) ?? null);
  const viewers = computed(() => activeStream.value?.viewers.slice(-5) ?? []);
  const viewerCount = computed(() => activeStream.value?.viewerCount ?? activeStream.value?.viewers.length ?? 0);
  const ownerName = computed(() => activeStream.value?.ownerNickname ?? t("screenShare"));
  const errorText = computed(() => errorCode.value === "SCREEN_SHARE_NATIVE_BRIDGE_REQUIRED" ? t("screenShareNativeUnavailable") : error.value);

  function setVideoElement(element: unknown): void {
    videoElement.value = element instanceof HTMLVideoElement ? element : null;
  }

  function streamForMember(member: ChannelMember): ScreenShareStream | null {
    return streams.find((stream) => {
      if (typeof stream.ownerClientId === "number" && stream.ownerClientId === member.id) return true;
      if (stream.source === "teamspeak" && stream.ownerPeerId === `ts-${member.id}`) return true;
      return stream.ownerNickname === member.nickname;
    }) ?? null;
  }

  function toggleForMember(member: ChannelMember): void {
    const stream = streamForMember(member);
    if (!stream) return;
    if (viewingStreamId.value === stream.streamId) leaveScreenShare();
    else joinScreenShare(stream.streamId);
  }

  function viewerStyle(viewer: { nickname: string; avatar?: string }) {
    return avatarStyle(viewer.nickname, viewer.nickname === nickname.value, viewer.avatar ?? "");
  }

  function setVolume(event: Event): void {
    remoteVolume.value = Math.max(0, Math.min(1, Number((event.target as HTMLInputElement).value) / 100));
  }

  function syncFullscreen(): void {
    fullscreen.value = document.fullscreenElement === playerElement.value;
  }

  async function toggleFullscreen(): Promise<void> {
    const player = playerElement.value;
    if (!player) return;
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else if (player.requestFullscreen) await player.requestFullscreen();
    } catch {
      fullscreen.value = false;
    }
  }

  async function startWithSettings(): Promise<void> {
    const preset = resolutionOptions.find((option) => option.value === resolutionPreset.value);
    const settings: ScreenShareOutputSettings = {
      ...(preset?.width && preset.height ? { maxWidth: preset.width, maxHeight: preset.height } : {}),
      maxFrameRate: frameRate.value,
    };
    localStorage.setItem("webspeak:screen-share-resolution", resolutionPreset.value);
    localStorage.setItem("webspeak:screen-share-framerate", String(frameRate.value));
    settingsOpen.value = false;
    await startScreenShare(true, settings);
  }

  watch([remoteStream, remoteVolume], ([stream, volume]) => {
    void nextTick(() => {
      const video = videoElement.value;
      if (!video) return;
      if (video.srcObject !== stream) video.srcObject = stream;
      video.volume = Math.max(0, Math.min(1, volume ?? 1));
      if (stream) void video.play().catch(() => undefined);
    });
  });
  watch(viewing, (isViewing) => {
    if (!isViewing && document.fullscreenElement === playerElement.value) void document.exitFullscreen().catch(() => undefined);
  });

  onMounted(() => document.addEventListener("fullscreenchange", syncFullscreen));
  onUnmounted(() => document.removeEventListener("fullscreenchange", syncFullscreen));

  return {
    videoElement,
    playerElement,
    fullscreen,
    resolutionOptions,
    frameRateOptions,
    resolutionPreset,
    frameRate,
    settingsOpen,
    activeStream,
    viewers,
    viewerCount,
    ownerName,
    errorText,
    setVideoElement,
    streamForMember,
    toggleForMember,
    viewerStyle,
    setVolume,
    syncFullscreen,
    toggleFullscreen,
    startWithSettings,
  };
}
