import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

interface UseWebClientAudioControlsOptions {
  settingsOpen: Ref<boolean>;
  microphoneMuted: Readonly<Ref<boolean>>;
  noiseSuppressionEnabled: Readonly<Ref<boolean>>;
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
  noiseSuppressionEnabled,
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
  let settingsGeneration = 0;
  let settingsRequest = 0;
  let whisperPointer: { id: number; target: HTMLElement } | null = null;
  let whisperKey: string | null = null;

  function beginSettingsRequest(): () => boolean {
    settingsError.value = "";
    const generation = settingsGeneration;
    const request = ++settingsRequest;
    return () => settingsOpen.value && generation === settingsGeneration && request === settingsRequest;
  }

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

  function toggleNoiseSuppression(): void {
    void setNoiseSuppressionEnabled(!noiseSuppressionEnabled.value);
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

  async function onInputDeviceChange(selection: Event | string): Promise<void> {
    const isCurrent = beginSettingsRequest();
    try {
      const deviceId = typeof selection === "string" ? selection : (selection.target as HTMLSelectElement).value;
      await setInputDevice(deviceId);
    } catch (error: unknown) {
      if (isCurrent()) settingsError.value = microphoneErrorMessage(error, "无法切换麦克风");
    }
  }

  async function onOutputDeviceChange(selection: Event | string): Promise<void> {
    const isCurrent = beginSettingsRequest();
    try {
      const deviceId = typeof selection === "string" ? selection : (selection.target as HTMLSelectElement).value;
      await setOutputDevice(deviceId);
    } catch (error: unknown) {
      if (isCurrent()) settingsError.value = localizedMessage(error instanceof Error ? error.message : "无法切换扬声器");
    }
  }

  async function toggleMicTest(): Promise<void> {
    const isCurrent = beginSettingsRequest();
    try {
      if (microphoneTestActive.value) stopMicrophoneTest();
      else await startMicrophoneTest();
    } catch (error: unknown) {
      if (isCurrent()) settingsError.value = microphoneErrorMessage(error);
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
            : accompanimentErrorCode.value === "audio"
              ? "accompanimentAudioFailed"
              : "accompanimentPermissionDenied";
      showToast(t(messageKey));
    }
  }

  function onWhisperPttDown(event: PointerEvent): void {
    if (!whisperTargetIds.size || whisperPttActive.value || event.button !== 0 || !event.isPrimary) return;
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    target.focus();
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    whisperPointer = { id: event.pointerId, target };
    whisperPttActive.value = true;
    setWhisperActive(true);
  }

  function onWhisperPttUp(event: PointerEvent): void {
    if (event.pointerId !== whisperPointer?.id) return;
    stopWhisperTalk();
  }

  function onWhisperPttKeyDown(event: KeyboardEvent): void {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || !whisperTargetIds.size || whisperPttActive.value) return;
    whisperKey = event.key;
    whisperPttActive.value = true;
    setWhisperActive(true);
  }

  function onWhisperPttKeyUp(event: KeyboardEvent): void {
    if (event.key !== whisperKey) return;
    event.preventDefault();
    stopWhisperTalk();
  }

  function stopWhisperTalk(): void {
    const pointer = whisperPointer;
    whisperPointer = null;
    whisperKey = null;
    if (!whisperPttActive.value) return;
    whisperPttActive.value = false;
    setWhisperActive(false);
    // Clear ownership first: releasing capture can synchronously emit lostpointercapture.
    if (pointer?.target.hasPointerCapture(pointer.id)) pointer.target.releasePointerCapture(pointer.id);
  }

  watch(settingsOpen, (open) => {
    settingsGeneration++;
    if (open) {
      const isCurrent = beginSettingsRequest();
      prepareInputDevices().catch((error: unknown) => {
        if (isCurrent()) settingsError.value = microphoneErrorMessage(error);
      });
    } else {
      stopMicrophoneTest();
    }
  }, { flush: "sync" });
  onScopeDispose(() => {
    settingsGeneration++;
    stopMicrophoneTest();
    stopWhisperTalk();
  });

  return {
    settingsError,
    whisperPttActive,
    micMeterBars,
    onInputVolume,
    onNoiseSuppressionToggle,
    toggleNoiseSuppression,
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
    onWhisperPttKeyDown,
    onWhisperPttKeyUp,
    stopWhisperTalk,
  };
}
