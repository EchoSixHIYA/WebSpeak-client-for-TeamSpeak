import { computed, onMounted, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { ChannelMember, ScreenShareOutputSettings, ScreenShareStream } from "./useVoiceWebSocket.js";

export type ScreenShareResolutionPreset = "source" | "720p" | "1080p";

export type ScreenShareBitratePreset = "auto" | "1.5" | "3" | "5" | "8" | "12";

interface ScreenShareResolutionOption {
  value: ScreenShareResolutionPreset;
  width?: number;
  height?: number;
  label: string;
}

interface ScreenShareBitrateOption {
  value: ScreenShareBitratePreset;
  bitrate?: number;
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
  const bitrateOptions: ScreenShareBitrateOption[] = [
    { value: "auto", label: "screenShareBitrateAuto" },
    { value: "1.5", bitrate: 1_500_000, label: "screenShareBitrate1_5M" },
    { value: "3", bitrate: 3_000_000, label: "screenShareBitrate3M" },
    { value: "5", bitrate: 5_000_000, label: "screenShareBitrate5M" },
    { value: "8", bitrate: 8_000_000, label: "screenShareBitrate8M" },
    { value: "12", bitrate: 12_000_000, label: "screenShareBitrate12M" },
  ];
  const storedResolution = localStorage.getItem("webspeak:screen-share-resolution") as ScreenShareResolutionPreset | null;
  const resolutionPreset = ref<ScreenShareResolutionPreset>(resolutionOptions.some((option) => option.value === storedResolution) ? storedResolution! : "1080p");
  const storedFrameRate = Number(localStorage.getItem("webspeak:screen-share-framerate"));
  const frameRate = ref(frameRateOptions.includes(storedFrameRate) ? storedFrameRate : 15);
  const storedBitrate = localStorage.getItem("webspeak:screen-share-bitrate") as ScreenShareBitratePreset | null;
  const bitratePreset = ref<ScreenShareBitratePreset>(bitrateOptions.some((option) => option.value === storedBitrate) ? storedBitrate! : "auto");
  const settingsOpen = ref(false);
  const activeStream = computed<ScreenShareStream | null>(() => streams.find((stream) => stream.streamId === viewingStreamId.value) ?? null);
  const viewers = computed(() => activeStream.value?.viewers.slice(-5) ?? []);
  const viewerCount = computed(() => activeStream.value?.viewerCount ?? activeStream.value?.viewers.length ?? 0);
  const ownerName = computed(() => activeStream.value?.ownerNickname ?? t("screenShare"));
  const errorText = computed(() => errorCode.value === "SCREEN_SHARE_NATIVE_BRIDGE_REQUIRED" ? t("screenShareNativeUnavailable") : error.value);

  function setVideoElement(element: unknown): void {
    if (videoElement.value && videoElement.value !== element) videoElement.value.srcObject = null;
    videoElement.value = element instanceof HTMLVideoElement ? element : null;
  }

  function setPlayerElement(element: unknown): void {
    const previous = playerElement.value;
    if (previous && previous !== element && document.fullscreenElement === previous) {
      void document.exitFullscreen().catch(() => undefined);
    }
    playerElement.value = element instanceof HTMLElement ? element : null;
    syncFullscreen();
  }

  function streamForMember(member: ChannelMember): ScreenShareStream | null {
    return streams.find((stream) => {
      if (typeof stream.ownerClientId === "number") return stream.ownerClientId === member.id;
      if (stream.source === "teamspeak" && /^ts-\d+$/.test(stream.ownerPeerId)) return stream.ownerPeerId === `ts-${member.id}`;
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
    fullscreen.value = Boolean(playerElement.value && document.fullscreenElement === playerElement.value);
  }

  async function toggleFullscreen(): Promise<void> {
    const player = playerElement.value;
    if (!player) return;
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else if (player.requestFullscreen) await player.requestFullscreen();
    } catch {
      syncFullscreen();
    }
  }

  async function startWithSettings(): Promise<void> {
    const preset = resolutionOptions.find((option) => option.value === resolutionPreset.value);
    const bitrateOption = bitrateOptions.find((option) => option.value === bitratePreset.value);
    const settings: ScreenShareOutputSettings = {
      ...(preset?.width && preset.height ? { maxWidth: preset.width, maxHeight: preset.height } : {}),
      maxFrameRate: frameRate.value,
      ...(bitrateOption?.bitrate ? { maxBitrate: bitrateOption.bitrate } : {}),
    };
    localStorage.setItem("webspeak:screen-share-resolution", resolutionPreset.value);
    localStorage.setItem("webspeak:screen-share-framerate", String(frameRate.value));
    localStorage.setItem("webspeak:screen-share-bitrate", bitratePreset.value);
    settingsOpen.value = false;
    await startScreenShare(true, settings);
  }

  watch([videoElement, remoteStream, remoteVolume], ([video, stream, volume]) => {
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.volume = Math.max(0, Math.min(1, volume ?? 1));
    if (stream) void video.play().catch(() => undefined);
  }, { flush: "post", immediate: true });
  watch(viewing, (isViewing) => {
    if (!isViewing && playerElement.value && document.fullscreenElement === playerElement.value) void document.exitFullscreen().catch(() => undefined);
  });

  onMounted(() => document.addEventListener("fullscreenchange", syncFullscreen));
  onBeforeUnmount(() => {
    document.removeEventListener("fullscreenchange", syncFullscreen);
    setVideoElement(null);
    setPlayerElement(null);
  });

  return {
    videoElement,
    playerElement,
    fullscreen,
    resolutionOptions,
    frameRateOptions,
    bitrateOptions,
    resolutionPreset,
    frameRate,
    bitratePreset,
    settingsOpen,
    activeStream,
    viewers,
    viewerCount,
    ownerName,
    errorText,
    setVideoElement,
    setPlayerElement,
    streamForMember,
    toggleForMember,
    viewerStyle,
    setVolume,
    syncFullscreen,
    toggleFullscreen,
    startWithSettings,
  };
}
