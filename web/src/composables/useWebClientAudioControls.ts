import { computed, ref, watch, type Ref } from "vue";

interface UseWebClientAudioControlsOptions {
  settingsOpen: Ref<boolean>;
  microphoneMuted: Readonly<Ref<boolean>>;
  inputVolume: Readonly<Ref<number>>;
  voxThreshold: Readonly<Ref<number>>;
  notificationVolume: Readonly<Ref<number>>;
  micLevel: Readonly<Ref<number>>;
  microphoneTestActive: Readonly<Ref<boolean>>;
  accompanimentActive: Readonly<Ref<boolean>>;
  accompanimentErrorCode: Readonly<Ref<string>>;
  whisperTargetIds: Set<number>;
  prepareInputDevices: () => Promise<void>;
  setInputVolume: (value: number) => void;
  setNoiseSuppressionEnabled: (enabled: boolean) => Promise<void>;
  setOutputVolume: (value: number) => void;
  setVoxThreshold: (value: number) => void;
  setNotificationVolume: (value: number) => void;
  setInputDevice: (deviceId: string) => Promise<void>;
  setOutputDevice: (deviceId: string) => Promise<void>;
  setMicrophoneMuted: (muted: boolean) => void;
  startMicrophoneTest: () => Promise<void>;
  stopMicrophoneTest: () => void;
  startAccompaniment: () => Promise<void>;
  stopAccompaniment: () => Promise<void>;
  setWhisperActive: (active: boolean) => void;
  localizedMessage: (message: string) => string;
  showToast: (message: string) => void;
  t: (key: string) => string;
}

export function useWebClientAudioControls({
  settingsOpen,
  microphoneMuted,
  inputVolume,
  voxThreshold,
  notificationVolume,
  micLevel,
  microphoneTestActive,
  accompanimentActive,
  accompanimentErrorCode,
  whisperTargetIds,
  prepareInputDevices,
  setInputVolume,
  setNoiseSuppressionEnabled,
  setOutputVolume,
  setVoxThreshold,
  setNotificationVolume,
  setInputDevice,
  setOutputDevice,
  setMicrophoneMuted,
  startMicrophoneTest,
  stopMicrophoneTest,
  startAccompaniment,
  stopAccompaniment,
  setWhisperActive,
  localizedMessage,
  showToast,
  t,
}: UseWebClientAudioControlsOptions) {
  const settingsError = ref("");
  const whisperPttActive = ref(false);
  const micMeterBars = computed(() => Math.round(micLevel.value * 24));

  function microphoneErrorMessage(error: unknown, fallback = "请检查浏览器权限"): string {
    const name = error instanceof DOMException ? error.name : "";
    const reasons: Record<string, string> = {
      NotAllowedError: "浏览器未授予麦克风权限",
      NotFoundError: "未找到可用的麦克风",
      NotReadableError: "麦克风可能正被其他程序占用",
      OverconstrainedError: "所选麦克风当前不可用",
      SecurityError: "浏览器阻止了麦克风访问",
    };
    return `麦克风访问失败：${reasons[name] ?? fallback}`;
  }

  function onInputVolume(event: Event): void {
    setInputVolume(Number((event.target as HTMLInputElement).value) / 100);
  }

  function onNoiseSuppressionToggle(event: Event): void {
    void setNoiseSuppressionEnabled((event.target as HTMLInputElement).checked);
  }

  function onOutputVolume(event: Event): void {
    setOutputVolume(Number((event.target as HTMLInputElement).value) / 100);
  }

  function onVoxThreshold(event: Event): void {
    setVoxThreshold(Number((event.target as HTMLInputElement).value) / 1000);
  }

  function onNotificationVolume(event: Event): void {
    setNotificationVolume(Number((event.target as HTMLInputElement).value) / 100);
  }

  async function onInputDeviceChange(event: Event): Promise<void> {
    settingsError.value = "";
    try {
      await setInputDevice((event.target as HTMLSelectElement).value);
    } catch (error: unknown) {
      settingsError.value = microphoneErrorMessage(error, "无法切换麦克风");
    }
  }

  async function onOutputDeviceChange(event: Event): Promise<void> {
    settingsError.value = "";
    try {
      await setOutputDevice((event.target as HTMLSelectElement).value);
    } catch (error: unknown) {
      settingsError.value = localizedMessage(error instanceof Error ? error.message : "无法切换扬声器");
    }
  }

  async function toggleMicTest(): Promise<void> {
    settingsError.value = "";
    try {
      if (microphoneTestActive.value) stopMicrophoneTest();
      else await startMicrophoneTest();
    } catch (error: unknown) {
      settingsError.value = microphoneErrorMessage(error);
    }
  }

  function meterBarHeight(index: number): number {
    if (!microphoneTestActive.value) return 5;
    const intensity = Math.max(0, micLevel.value - (index / 24) * 0.65);
    return 5 + Math.round(intensity * 34);
  }

  function toggleMicrophone(): void {
    setMicrophoneMuted(!microphoneMuted.value);
    showToast(t(microphoneMuted.value ? "microphoneMuted" : "microphoneActive"));
  }

  async function toggleAccompaniment(): Promise<void> {
    try {
      if (accompanimentActive.value) {
        await stopAccompaniment();
        showToast(t("accompanimentStopped"));
        return;
      }
      await startAccompaniment();
      if (accompanimentActive.value) showToast(t("accompanimentStarted"));
    } catch {
      const messageKey = accompanimentErrorCode.value === "needsWebRtc"
        ? "accompanimentNeedsWebRtc"
        : accompanimentErrorCode.value === "noAudio"
          ? "accompanimentNoAudio"
          : accompanimentErrorCode.value === "unsupported"
            ? "accompanimentUnsupported"
            : "accompanimentPermissionDenied";
      showToast(t(messageKey));
    }
  }

  function onWhisperPttDown(event: PointerEvent): void {
    if (!whisperTargetIds.size) return;
    const target = event.currentTarget as HTMLElement | null;
    if (target?.setPointerCapture && !target.hasPointerCapture(event.pointerId)) target.setPointerCapture(event.pointerId);
    whisperPttActive.value = true;
    setWhisperActive(true);
  }

  function onWhisperPttUp(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (target?.releasePointerCapture && target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    stopWhisperTalk();
  }

  function stopWhisperTalk(): void {
    if (!whisperPttActive.value) return;
    whisperPttActive.value = false;
    setWhisperActive(false);
  }

  watch(settingsOpen, (open) => {
    if (open) {
      settingsError.value = "";
      prepareInputDevices().catch((error: unknown) => {
        settingsError.value = microphoneErrorMessage(error);
      });
    } else {
      stopMicrophoneTest();
    }
  });

  return {
    settingsError,
    whisperPttActive,
    micMeterBars,
    onInputVolume,
    onNoiseSuppressionToggle,
    onOutputVolume,
    onVoxThreshold,
    onNotificationVolume,
    onInputDeviceChange,
    onOutputDeviceChange,
    toggleMicTest,
    microphoneErrorMessage,
    meterBarHeight,
    toggleMicrophone,
    toggleAccompaniment,
    onWhisperPttDown,
    onWhisperPttUp,
    stopWhisperTalk,
  };
}
