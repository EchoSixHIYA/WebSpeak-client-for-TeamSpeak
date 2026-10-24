import { createRemotePlayback } from "../voice/remote-playback.js";
import { createMicrophoneTest } from "../voice/microphone-test.js";
import { createMicrophoneCaptureFactory, type MicrophoneCapture, type MicrophoneProcessingSettings } from "../voice/microphone-capture.js";
export type { MicrophoneProcessingSettings } from "../voice/microphone-capture.js";
import { createAudioSinkRouter } from "../voice/audio-sink.js";
import { createAccompaniment, type AccompanimentErrorCode } from "../voice/accompaniment.js";
import { createWebRtcTransport } from "../voice/webrtc-transport.js";
import { createVoiceConnection } from "../voice/connection.js";
import { createVoiceCommands } from "../voice/commands.js";
import { createPluginTransport } from "../services/plugin-transport.js";
import { createVoiceSessionState } from "../voice/session-state.js";
import { applySavedMemberVolumes } from "../voice/member-volume-preferences.js";
import { createAudioDiagnostics, type AudioPermission, type VoiceAudioStatusSample } from "../voice/audio-diagnostics.js";
export type { AudioPermission, BrowserVoiceAudioStats, VoiceAudioStatusSample } from "../voice/audio-diagnostics.js";
import type { SinkAudioElement } from "../voice/webrtc-playback.js";
import { createScreenShareController } from "../voice/screen-share.js";
import { requestMediaBeforeAudioResume } from "../services/microphone-start.js";
export type { ScreenShareOutputSettings, ScreenShareCaptureStats, ScreenSharePeerStats, ScreenShareWebRtcStats } from "../voice/screen-share.js";
import { parseServerMessage } from "../../../src/shared/server-messages.js";
import type { ChatMessage } from "../../../src/shared/voice-models.js";
import type { ClientCommandPayloads, ClientCommandType } from "../../../src/shared/client-commands.js";
export type { ScreenShareStreamDescription as ScreenShareStream, ScreenShareViewerDescription as ScreenShareViewer, ScreenSharePeerSignal as ScreenShareSignal } from "../../../src/shared/screen-share.js";
export type { ChannelMember, ChannelInfo, ChatMessage, ServerEvent, VoiceAudioBridgeStats } from "../../../src/shared/voice-models.js";
import { reactive, ref, shallowRef } from "vue";
import { loadLocalPreferences, saveLocalPreferences } from "../services/local-persistence.js";

export interface VoiceState {
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  reconnectFailed: boolean;
  tsClientId: number;
  error: string;
  errorCode: string;
  /**
   * Non-fatal audio diagnostics. Unlike error/errorCode these never take over
   * the connect form: they explain a degraded microphone or playback path while
   * the voice room itself stays joined and usable.
   */
  microphoneError: string;
  microphoneErrorCode: string;
  audioNotice: string;
  audioNoticeCode: string;
  channelSwitchedChannelId: string;
}

export interface VoiceServerInfo {
  name: string;
  icon?: string | null;
  bannerUrl?: string | null;
  welcomeMessage?: string;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

type SinkAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const MAX_VISIBLE_ERROR_CODE_LENGTH = 64;
const CLIENT_ERROR_CODE_ALIASES: Record<string, string> = {
  PASSWORD_REQUIRED: "SERVER_PASSWORD_REQUIRED",
  INVALID_PASSWORD: "INVALID_SERVER_PASSWORD",
  AUTHENTICATION_FAILED: "INVALID_SERVER_PASSWORD",
  GATEWAY_FULL: "SERVER_REJECTED",
  TS_CONNECT_FAILED: "CONNECTION_FAILED",
  TEAM_SPEAK_CONNECT_FAILED: "CONNECTION_FAILED",
};

/** Keep codes useful to the user without allowing an unbounded server value into the UI. */
function safeClientErrorCode(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, MAX_VISIBLE_ERROR_CODE_LENGTH);
}

function normalizedClientErrorCode(value: unknown, fallback = "CONNECTION_FAILED"): string {
  const safe = safeClientErrorCode(value);
  return CLIENT_ERROR_CODE_ALIASES[safe] ?? (safe || fallback);
}

function safeClientErrorDetail(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

// TeamSpeak 对非法昵称没有独立错误码：长度违规统一报 invalid parameter size
// （服务器错误 id 1541），该特征串是网关能转发的唯一机器可读线索，因此把匹配器
// 与解释文案放在一起，保证两者同步演进。
/**
 * TeamSpeak has no dedicated error for a nickname it refuses: a nickname outside
 * its length rules is answered with "invalid parameter size" and server error id
 * 1541. That signature is the only machine-readable hint the gateway can forward,
 * so keep the matcher next to the message builder that explains it to the user.
 */
const NICKNAME_LENGTH_SIGNATURE = /invalid[\s_-]*parameter[\s_-]*size|\bid[\s=:]*1541\b|nickname.{0,30}(?:length|size)/i;

/** Shown whenever TeamSpeak refuses the nickname because of its length. */
const NICKNAME_LENGTH_MESSAGE = "昵称长度不符合 TeamSpeak 服务器要求，至少 3 个字符，请修改后重试";

/**
 * Browsers only hand out a DOMException name for getUserMedia failures (and an
 * often-English message that used to reach the UI verbatim). Map every name the
 * browsers actually raise to a sentence the user can act on, and keep the
 * DOMException name as the stable failure code.
 */
const MICROPHONE_FAILURE_REASONS: Record<string, string> = {
  NOTALLOWEDERROR: "浏览器未授予麦克风权限",
  PERMISSIONDENIEDERROR: "浏览器未授予麦克风权限",
  PERMISSION_DISMISSED: "浏览器未授予麦克风权限",
  SECURITYERROR: "浏览器阻止了麦克风访问",
  NOTFOUNDERROR: "未找到可用的麦克风",
  DEVICESNOTFOUNDERROR: "未找到可用的麦克风",
  OVERCONSTRAINEDERROR: "所选麦克风当前不可用",
  NOTREADABLEERROR: "麦克风可能正被其他程序占用",
  TRACKSTARTERROR: "麦克风可能正被其他程序占用",
  ABORTERROR: "麦克风启动被中断，请重试",
  INVALIDSTATEERROR: "麦克风启动被中断，请重试",
  TYPEFERROR: "麦克风访问参数被系统拒绝",
};

const MICROPHONE_FAILURE_FALLBACK = "麦克风不可用，请检查浏览器权限与音频设备";

const MICROPHONE_FAILURE_CODE_PREFIX = "MIC_";

/** Turn a getUserMedia / DOMException failure into a stable code plus a readable sentence. */
export function normalizeMicrophoneFailure(error: unknown): { code: string; message: string } {
  const rawName = error instanceof Error ? String(error.name || "") : "";
  const name = safeClientErrorCode(rawName).slice(0, 40);
  const reason = MICROPHONE_FAILURE_REASONS[name] ?? MICROPHONE_FAILURE_FALLBACK;
  return { code: `${MICROPHONE_FAILURE_CODE_PREFIX}${name || "UNAVAILABLE"}`, message: `麦克风访问失败：${reason}` };
}

/**
 * Every code this client can render for a failed connection. A code is regarded
 * as "explainable" only when it appears here, which is also what keeps the
 * gateway close codes from being replaced by an unknown close reason.
 */
const CONNECTION_FAILURE_MESSAGES: Record<string, string> = {
  ORIGIN_REJECTED: "请求来源不受信任，请从正确的网站入口重新打开",
  NOT_INITIALIZED: "WebSpeak 尚未完成配置，请联系管理员",
  RATE_LIMITED: "请求过于频繁，请稍后重试",
  INVALID_TARGET: "TeamSpeak 服务器地址无效",
  INVALID_NICKNAME: NICKNAME_LENGTH_MESSAGE,
  HOST_NOT_FOUND: "找不到 TeamSpeak 服务器主机名，请检查地址",
  UNREACHABLE: "无法到达 TeamSpeak 服务器，请检查网络或地址",
  CONNECTION_REFUSED: "TeamSpeak 服务器拒绝了连接，请检查端口和服务状态",
  CONNECTION_RESET: "TeamSpeak 连接被服务器或网络重置，请稍后重试",
  TIMEOUT: "连接 TeamSpeak 超时，请检查网络或服务器状态",
  SERVER_PASSWORD_REQUIRED: "该服务器需要密码，请输入密码后重试",
  INVALID_SERVER_PASSWORD: "服务器密码错误，请重新输入",
  PROTOCOL_NEGOTIATION_FAILED: "TeamSpeak 协议协商失败",
  SERVER_REJECTED: "TeamSpeak 服务器拒绝了连接",
  CHANNEL_PASSWORD_REQUIRED: "该频道需要密码",
  NICKNAME_IN_USE: "该昵称已被服务器上的其他用户占用，请更换昵称",
  IDENTITY_SECURITY_LEVEL_TOO_LOW: "你的身份安全等级低于该服务器要求，请提升后重试",
  IDENTITY_LIMIT_REACHED: "该身份建立的连接数已达上限，请关闭其他连接后重试",
  CLIENT_VERSION_OUTDATED: "客户端版本过旧，服务器拒绝连接，请升级后重试",
  FLOOD_PROTECTION: "操作过于频繁，已被服务器洪水防护暂时拒绝，请稍后重试",
  BANNED: "你已被该服务器封禁，无法连接",
  KICKED: "你已被服务器移出",
  SERVER_SHUTTING_DOWN: "TeamSpeak 服务器正在关闭，暂时无法连接",
  CONNECTION_INITIALISATION_FAILED: "TeamSpeak 服务器未能完成连接初始化，请检查地址、端口或稍后重试",
  SERVER_FULL: "服务器当前已满，请稍后重试",
  INVALID_PARAMETER: "TeamSpeak 服务器拒绝了参数，通常是昵称长度或格式不合规",
  IDENTITY_IN_USE: "此 TeamSpeak 身份已在另一个浏览器页面使用，请关闭另一条连接或取消“保持身份”后重试",
  CONNECTION_FAILED: "TeamSpeak 连接失败，请检查地址、网络或服务器状态",
  // Gateway close codes: these replace the generic "connection failed" when the
  // gateway drops the socket itself (see GATEWAY_CLOSE_CODE_CODES).
  JOIN_TICKET_REQUIRED: "语音会话票据缺失或已过期，请返回列表重新进入语音空间",
  IDENTITY_INVALID: "语音网关拒绝了本次连接：身份无效，请取消“保持身份”后重新进入",
  IDENTITY_REJECTED: "语音网关拒绝了本次连接：身份无效或无法在此页面使用，请取消“保持身份”后重新进入",
  ACCELERATION_UNAVAILABLE: "当前中继加速不可用，请关闭加速后重试或联系管理员",
  GATEWAY_NETWORK_LOST: "与语音网关的网络连接异常中断（掉线或代理断开），并非 TeamSpeak 服务器拒绝连接，请检查网络后重新进入",
  GATEWAY_SESSION_ENDED: "语音网关会话意外结束，请重新进入语音空间",
  TEAM_SPEAK_CLIENT_UNAVAILABLE: "语音网关未能创建 TeamSpeak 客户端（服务器可能已关闭或地址不可达），请确认服务器地址或稍后重试",
};

class CancelledMediaOperation extends Error {
  constructor() { super("媒体操作已取消"); this.name = "AbortError"; }
}

export function useVoiceWebSocket() {
  const ws = shallowRef<WebSocket | null>(null);
  const serverInfo = shallowRef<VoiceServerInfo | null>(null);
  const state = reactive<VoiceState>({ connected: false, connecting: false, reconnecting: false, reconnectAttempt: 0, reconnectFailed: false, tsClientId: 0, error: "", errorCode: "", microphoneError: "", microphoneErrorCode: "", audioNotice: "", audioNoticeCode: "", channelSwitchedChannelId: "" });
  const plugins = createPluginTransport(() => ws.value, () => state.connected);
  const sessionState = createVoiceSessionState({
    selfId: () => state.tsClientId,
    onMemberRemoved(id) {
      clearSpeaking(id);
      remotePlayback.clear(id);
      delete volumes[id];
      whisperTargetIds.delete(id);
      if (!whisperTargetIds.size) whisperActive.value = false;
    },
    onMembersChanged: syncKnownMemberVolumes,
  });
  const { members, channels, chatMessages, serverEvents, pokeNotifications } = sessionState;
  let chatGeneration = 0;
  const voiceConnection = createVoiceConnection({
    onSocket: socket => { ws.value = socket; },
    onMessage: handleMessage,
    onAudio: handleAudioFrame,
    onClose(event) {
      releaseSessionResources();
      state.connected = false;
      state.connecting = false;
      state.reconnecting = false;
      state.tsClientId = 0;
      if (!state.reconnectFailed) sessionState.reset();
      if (event.code !== 1000 && !state.reconnectFailed && !state.errorCode) {
        state.errorCode = closeErrorCode(event.code, event.reason);
        state.error = closeReason(event.code, event.reason);
      }
      clearMicrophoneError();
      clearAudioNotice();
    },
    onFailure({ code, detail, cause }) {
      state.connecting = false;
      state.errorCode = normalizedClientErrorCode(code, "REQUEST_FAILED");
      state.error = cause instanceof Error ? cause.message : joinTicketReason(state.errorCode, detail);
    },
  });
  const commands = createVoiceCommands({ socket: () => ws.value, generation: () => voiceConnection.generation });
  let lastConnection: { target: string; channel: string; nickname: string; serverPassword: string; identity?: string; rememberIdentity: boolean; accelerated: boolean; accelerationRelayId: string } | null = null;
  const identityMaterial = ref("");
  const storedVolumesByUid = reactive<Record<string, number>>({});
  let microphoneStartPromise: Promise<void> | null = null;
  let microphoneGeneration = 0;

  // WebRTC carries audio when the gateway advertises it. The bounded PCM
  // WebSocket path remains the compatibility fallback for older browsers and
  // for deployments where the gateway's built-in UDP media range is unavailable.
  let audioCtx: SinkAudioContext | null = null;
  let micStream: MediaStream | null = null;
  const microphoneCaptureFactory = createMicrophoneCaptureFactory();
  let microphoneCapture: MicrophoneCapture | null = null;
  let pendingMicrophoneCapture: AbortController | null = null;
  const accompanimentActive = ref(false);
  const accompanimentSupported = ref(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia));
  const accompanimentErrorCode = ref<AccompanimentErrorCode>("");
  const accompaniment = createAccompaniment({
    isSupported: () => accompanimentSupported.value,
    getTarget: () => webrtc.active && webrtc.peer && micStream ? webrtc.input : null,
    onActive(active) {
      const changed = accompanimentActive.value !== active;
      accompanimentActive.value = active;
      if (changed && webrtc.active) sendCmd("setAccompanimentActive", { active });
    },
    onError: code => { accompanimentErrorCode.value = code; },
  });
  const screenShare = createScreenShareController({
    isOpen: () => ws.value?.readyState === WebSocket.OPEN,
    send: message => ws.value?.send(JSON.stringify(message)),
  });
  const inputDevices = reactive<AudioInputDevice[]>([]);
  const outputDevices = reactive<AudioOutputDevice[]>([]);
  const selectedInputDeviceId = ref(typeof localStorage !== "undefined" ? localStorage.getItem("webspeak:input-device") ?? "" : "");
  const selectedOutputDeviceId = ref(typeof localStorage !== "undefined" ? localStorage.getItem("webspeak:output-device") ?? "" : "");
  let committedInputDeviceId = selectedInputDeviceId.value;
  let committedOutputDeviceId = selectedOutputDeviceId.value;
  let inputDeviceTouched = false;
  let outputDeviceTouched = false;
  let inputDeviceGeneration = 0;
  let outputDeviceGeneration = 0;
  let deviceListGeneration = 0;
  const audioSinkRouter = createAudioSinkRouter();
  const outputDeviceSupported = ref(false);
  const audioPermission = ref<AudioPermission>("unknown");
  const microphoneProcessing = reactive<MicrophoneProcessingSettings>({
    echoCancellation: null,
    noiseSuppression: null,
    autoGainControl: null,
    rnnoise: null,
  });
  const audioContextState = ref<AudioContextState | "unknown">("unknown");
  const micLevel = ref(0);
  const microphoneTestActive = ref(false);
  const testAudioUrl = ref("");
  const microphoneTest = createMicrophoneTest({
    prepare: async () => { await prepareInputDevices(); return micStream; },
    onActive: active => { microphoneTestActive.value = active; },
    onUrl: url => { testAudioUrl.value = url; },
    onStopped: () => { if (!state.connected) stopMicrophone(); },
    onError: error => { setMicrophoneError(error); },
  });
  const microphoneMuted = ref(false);
  const noiseSuppressionEnabled = ref(true);
  let noiseSuppressionTouched = false;
  let committedNoiseSuppressionEnabled = noiseSuppressionEnabled.value;
  const inputVolume = ref(1);
  const outputVolume = ref(1);
  const outputMuted = ref(false);
  const notificationVolume = ref(0.5);
  const voxThreshold = ref(0.008);
  let voxAttack = 0;
  let voxRelease = 0;
  const VOX_HOLD = 15;
  const VOX_ATTACK_FRAMES = 1;
  let convBuf = new Int16Array(1024);
  let accumBuf = new Int16Array(2048);
  let accumLen = 0;

  const volumes = reactive<Record<number, number>>({});
  const speakingIds = reactive(new Set<number>());
  const whisperTargetIds = reactive(new Set<number>());
  const whisperActive = ref(false);
  const speakingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const SPEAKING_HOLD_MS = 360;
  const AUDIO_FRAME_SAMPLES = 960;
  const AUDIO_FRAME_BYTES = AUDIO_FRAME_SAMPLES * 2;
  const MAX_AUDIO_BUFFERED_FRAMES = 10;
  const MAX_AUDIO_BUFFERED_BYTES = AUDIO_FRAME_BYTES * MAX_AUDIO_BUFFERED_FRAMES;
  const remotePlayback = createRemotePlayback({
    getContext: getAudioCtx,
    getVolume: clientId => (volumes[clientId] ?? 1) * effectiveOutputVolume(),
    onDecodeError: () => audioDiagnostics.count("decodeErrors"),
    onDrop: () => audioDiagnostics.count("framesDropped"),
  });
  let webRtcStunServer = "";
  const webrtc = createWebRtcTransport({
    stunServer: () => webRtcStunServer,
    prepareMicrophone: async () => {
      await ensureMicrophone();
      return micStream ? { context: getAudioCtx(), stream: micStream,
        processedStream: microphoneCapture?.processedStream ?? micStream } : null;
    },
    stopPcm: stopCaptureGraph,
    muted: () => microphoneMuted.value,
    inputVolume: () => inputVolume.value,
    accompanimentActive: () => accompanimentActive.value,
    releaseAccompaniment: () => accompaniment.stop(),
    onLevel(rms, track) {
      micLevel.value = rms === null ? 0 : Math.min(1, rms * 6);
      if (rms !== null && !microphoneMuted.value && track.enabled && rms >= voxThreshold.value) markSpeaking(state.tsClientId);
      else if (state.tsClientId) clearSpeaking(state.tsClientId);
    },
    onReady: syncWebRtcMemberVolumes,
    async onFallback(reason, isCurrent) {
      if (!isCurrent()) return;
      setAudioNotice("WEBRTC_FALLBACK", `实时语音（WebRTC）不可用（错误代码：${safeClientErrorCode(reason) || "WEBRTC_UNAVAILABLE"}），已切换为兼容传输：延迟与音质可能下降`);
      try { await startMicrophone(); }
      catch (error) { if (isCurrent()) setMicrophoneError(error); }
    },
    playback: {
      context: () => audioCtx,
      volume: effectiveOutputVolume,
      onEndpoint(output) {
        if (!selectedOutputDeviceId.value || !output.setSinkId) return;
        const deviceId = selectedOutputDeviceId.value;
        const generation = outputDeviceGeneration;
        void audioSinkRouter.set(output, deviceId, () => generation === outputDeviceGeneration
          && webrtc.output === output && selectedOutputDeviceId.value === deviceId).catch(() => undefined);
      },
      onBlocked(blocked) {
        if (blocked) setAudioNotice("PLAYBACK_BLOCKED", "浏览器阻止了音频自动播放，暂时听不到其他成员的声音：请点击页面任意位置，或在地址栏允许本站播放声音");
        else clearAudioNotice("PLAYBACK_BLOCKED");
      },
      onPlaying: syncAudioContextNotice,
    },
  });
  const audioDiagnostics = createAudioDiagnostics({
    source() {
      const socket = ws.value;
      if (!socket || socket.readyState !== WebSocket.OPEN || !state.connected) return null;
      const peer = webrtc.peer;
      return { socket, connection: voiceConnection.generation, transportGeneration: webrtc.generation, peer,
        transport: webrtc.active ? "webrtc" : peer ? "negotiating" : "websocket" };
    },
    presentation({ peer }) {
      return {
        microphoneMuted: microphoneMuted.value,
        microphoneReady: Boolean(micStream?.getAudioTracks().some(track => track.readyState === "live")),
        microphonePermission: audioPermission.value,
        playbackState: peer
          ? webrtc.output ? webrtc.output.paused ? "paused" : "playing" : "unavailable"
          : audioCtx ? audioCtx.state === "running" ? "playing" : "paused" : null,
      };
    },
    send: (source, sequence) => source.socket.send(JSON.stringify({ type: "audioStatsProbe", payload: { sequence } })),
  });

  async function saveAudioPreferences(): Promise<void> {
    await saveLocalPreferences({
      schemaVersion: 1,
      preferredInputDeviceId: committedInputDeviceId,
      inputDeviceId: committedInputDeviceId,
      microphoneMuted: microphoneMuted.value,
      noiseSuppressionEnabled: committedNoiseSuppressionEnabled,
      voxThreshold: voxThreshold.value,
      inputGain: inputVolume.value,
      outputVolume: outputVolume.value,
      notificationVolume: notificationVolume.value,
      preferredOutputDeviceId: committedOutputDeviceId,
      volumesByUid: { ...storedVolumesByUid },
    });
  }

  function syncKnownMemberVolumes(): void {
    const updatedIds = applySavedMemberVolumes(members, storedVolumesByUid, volumes);
    if (!updatedIds.length) return;
    for (const clientId of updatedIds) remotePlayback.updateVolume(clientId);
    syncWebRtcMemberVolumes();
  }

  const audioPreferencesReady = loadLocalPreferences().then((preferences) => {
    if (!inputDeviceTouched) {
      if (!selectedInputDeviceId.value) selectedInputDeviceId.value = preferences.preferredInputDeviceId ?? preferences.inputDeviceId ?? "";
      committedInputDeviceId = selectedInputDeviceId.value;
    }
    if (typeof preferences.microphoneMuted === "boolean") microphoneMuted.value = preferences.microphoneMuted;
    if (!noiseSuppressionTouched && typeof preferences.noiseSuppressionEnabled === "boolean") {
      noiseSuppressionEnabled.value = preferences.noiseSuppressionEnabled;
      committedNoiseSuppressionEnabled = preferences.noiseSuppressionEnabled;
    }
    if (typeof preferences.voxThreshold === "number") voxThreshold.value = clamp(preferences.voxThreshold, 0.001, 0.08);
    if (typeof preferences.inputGain === "number") inputVolume.value = Math.max(0, Math.min(1, preferences.inputGain));
    if (typeof preferences.outputVolume === "number") outputVolume.value = Math.max(0, Math.min(1, preferences.outputVolume));
    if (!outputDeviceTouched) {
      if (!selectedOutputDeviceId.value) selectedOutputDeviceId.value = preferences.preferredOutputDeviceId ?? "";
      committedOutputDeviceId = selectedOutputDeviceId.value;
    }
    if (typeof preferences.notificationVolume === "number") notificationVolume.value = clamp(preferences.notificationVolume, 0, 1);
    Object.assign(storedVolumesByUid, preferences.volumesByUid ?? {});
    syncKnownMemberVolumes();
  });

  function markSpeaking(clientId: number): void {
    if (!clientId) return;
    speakingIds.add(clientId);
    const previous = speakingTimers.get(clientId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      speakingIds.delete(clientId);
      speakingTimers.delete(clientId);
    }, SPEAKING_HOLD_MS);
    speakingTimers.set(clientId, timer);
  }

  function clearSpeaking(clientId: number): void {
    const timer = speakingTimers.get(clientId);
    if (timer) clearTimeout(timer);
    speakingTimers.delete(clientId);
    speakingIds.delete(clientId);
  }

  function clearSpeakingState(): void {
    for (const timer of speakingTimers.values()) clearTimeout(timer);
    speakingTimers.clear();
    speakingIds.clear();
  }

  function effectiveOutputVolume(): number {
    return outputMuted.value ? 0 : outputVolume.value;
  }

  function applyOutputVolume(): void {
    const level = effectiveOutputVolume();
    remotePlayback.updateVolumes();
    webrtc.setOutputVolume(level);
  }

  function getAudioCtx(): SinkAudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext({ sampleRate: 48000 }) as SinkAudioContext;
      audioContextState.value = audioCtx.state;
      audioCtx.addEventListener("statechange", () => {
        if (audioCtx) audioContextState.value = audioCtx.state;
      });
      outputDeviceSupported.value = typeof audioCtx.setSinkId === "function"
        || typeof (HTMLMediaElement.prototype as SinkAudioElement).setSinkId === "function";
      if (selectedOutputDeviceId.value && outputDeviceSupported.value) {
        void setAudioSink(audioCtx, selectedOutputDeviceId.value).catch(() => undefined);
      }
    }
    return audioCtx;
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  /**
   * Microphone failures are a degraded state, not a connection failure: the room
   * stays joined, so they get their own slot instead of taking over `error`.
   */
  function setMicrophoneError(error: unknown): string {
    if (error instanceof CancelledMediaOperation) return "";
    const failure = normalizeMicrophoneFailure(error);
    state.microphoneErrorCode = failure.code;
    state.microphoneError = failure.message;
    return failure.message;
  }

  function clearMicrophoneError(): void {
    state.microphoneError = "";
    state.microphoneErrorCode = "";
  }

  /** Non-fatal audio notice (WebRTC fallback, blocked autoplay, device list failure...). */
  function setAudioNotice(code: string, message: string): void {
    state.audioNoticeCode = safeClientErrorCode(code) || "AUDIO_NOTICE";
    state.audioNotice = message;
  }

  function clearAudioNotice(code?: string): void {
    if (code && state.audioNoticeCode !== safeClientErrorCode(code)) return;
    state.audioNotice = "";
    state.audioNoticeCode = "";
  }

  /** A suspended AudioContext silently swallows capture: say so instead of pretending. */
  function syncAudioContextNotice(): void {
    if (audioCtx && audioCtx.state === "suspended") {
      setAudioNotice("AUDIO_CONTEXT_SUSPENDED", "浏览器的音频处理被暂停（需要一次页面交互），麦克风与扬声器可能无声：请点击页面任意位置后重试");
    } else {
      clearAudioNotice("AUDIO_CONTEXT_SUSPENDED");
    }
  }

  function audioNoticeMessage(code: string, detail?: unknown): string {
    const detailText = safeClientErrorDetail(detail);
    if (code === "AUDIO_ENCODER_UNAVAILABLE") {
      return `麦克风声音未能发送：语音网关的音频编码器不可用（错误代码：${code}）${detailText ? `：${detailText}` : ""}，请联系管理员`;
    }
    return `音频链路异常（错误代码：${code}）${detailText ? `：${detailText}` : ""}，麦克风声音可能没有发送给其他成员`;
  }

  async function setAudioSink(ctx: SinkAudioContext, deviceId: string): Promise<void> {
    const generation = outputDeviceGeneration;
    const output = webrtc.output;
    const isCurrent = () => generation === outputDeviceGeneration && audioCtx === ctx
      && selectedOutputDeviceId.value === deviceId;
    const mediaSinkSupported = typeof (HTMLMediaElement.prototype as SinkAudioElement).setSinkId === "function";
    if (!ctx.setSinkId && !mediaSinkSupported) {
      outputDeviceSupported.value = false;
      if (deviceId) throw new Error("当前浏览器不支持扬声器设备选择，将使用默认输出设备");
      return;
    }
    outputDeviceSupported.value = true;
    if (ctx.setSinkId) await audioSinkRouter.set(ctx, deviceId, isCurrent);
    if (output?.setSinkId) await audioSinkRouter.set(output, deviceId, () => isCurrent() && output === webrtc.output);
  }

  function checkSupport(): string | null {
    if (typeof window === "undefined") return null;
    if (!window.isSecureContext) return "语音功能需要 HTTPS 安全连接";
    if (!navigator.mediaDevices?.getUserMedia) return "当前浏览器不支持麦克风访问";
    if (typeof AudioContext === "undefined") return "当前浏览器不支持 Web Audio 音频处理";
    if (typeof AudioDecoder === "undefined") return "当前浏览器不支持音频解码，请使用最新版 Chrome 或 Edge";
    return null;
  }

  function microphoneConstraints(): MediaTrackConstraints {
    const constraints: MediaTrackConstraints = {
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: noiseSuppressionEnabled.value,
      // Keep the microphone's natural dynamics. Browser AGC can make speech
      // pump in volume, especially while background noise changes.
      autoGainControl: false,
    };
    if (selectedInputDeviceId.value) constraints.deviceId = { exact: selectedInputDeviceId.value };
    return constraints;
  }

  async function refreshAudioDevices(): Promise<void> {
    const generation = ++deviceListGeneration;
    const sequence = voiceConnection.generation;
    const isCurrent = () => generation === deviceListGeneration && sequence === voiceConnection.generation;
    if (!navigator.mediaDevices?.enumerateDevices) {
      inputDevices.length = 0;
      outputDevices.length = 0;
      setAudioNotice("DEVICE_LIST_UNAVAILABLE", "无法读取音频设备列表，将使用浏览器默认音频设备：请在系统或浏览器隐私设置中允许读取设备信息");
      return;
    }
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
      if (!isCurrent()) return;
      clearAudioNotice("DEVICE_LIST_UNAVAILABLE");
    } catch {
      if (!isCurrent()) return;
      // enumerateDevices rejects when the device list is blocked (for example in a
      // locked-down iframe). Use the browser defaults and explain the limitation.
      inputDevices.length = 0;
      outputDevices.length = 0;
      setAudioNotice("DEVICE_LIST_UNAVAILABLE", "无法读取音频设备列表，将使用浏览器默认音频设备：请在系统或浏览器隐私设置中允许读取设备信息");
      return;
    }
    const microphones = devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }));
    const speakers = devices
      .filter((device) => device.kind === "audiooutput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }));
    inputDevices.splice(0, inputDevices.length, ...microphones);
    outputDevices.splice(0, outputDevices.length, ...speakers);
    const missingInput = selectedInputDeviceId.value && !microphones.some(device => device.deviceId === selectedInputDeviceId.value);
    const missingOutput = selectedOutputDeviceId.value && !speakers.some(device => device.deviceId === selectedOutputDeviceId.value);
    // Use the normal configuration transactions: a replacement input must also
    // restart WebRTC, and rejected fallbacks must not be saved as successful.
    const fallbackOperations: Promise<void>[] = [];
    if (missingInput) fallbackOperations.push(setInputDevice(""));
    if (missingOutput) fallbackOperations.push(setOutputDevice(""));
    await Promise.allSettled(fallbackOperations);
  }

  async function refreshInputDevices(): Promise<void> {
    await refreshAudioDevices();
  }

  function handleCaptureChunk(input: Float32Array, rms?: number): void {
    if (!input.length) return;
    micLevel.value = Math.min(1, (rms ?? Math.sqrt(input.reduce((sum, sample) => sum + sample * sample, 0) / input.length)) * 6);
    const socket = ws.value;
    const shouldSend = !microphoneMuted.value
      && !microphoneTestActive.value
      && !webrtc.active
      && socket?.readyState === WebSocket.OPEN
      && voxGate(input);
    if (!shouldSend) {
      accumLen = 0;
      if (microphoneMuted.value) {
        voxAttack = 0;
        voxRelease = 0;
      }
      return;
    }
    if (!socket) {
      accumLen = 0;
      return;
    }
    const bufferedBytes = socket.bufferedAmount;
    if (bufferedBytes > MAX_AUDIO_BUFFERED_BYTES) {
      accumLen = 0;
      return;
    }

    if (convBuf.length < input.length) convBuf = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]!));
      convBuf[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    const need = accumLen + input.length;
    if (accumBuf.length < need) accumBuf = new Int16Array(Math.max(need, accumBuf.length * 2));
    accumBuf.set(convBuf.subarray(0, input.length), accumLen);
    accumLen = need;

    let offset = 0;
    while (offset + AUDIO_FRAME_SAMPLES <= accumLen && socket.readyState === WebSocket.OPEN && socket.bufferedAmount <= MAX_AUDIO_BUFFERED_BYTES) {
      socket.send(accumBuf.slice(offset, offset + AUDIO_FRAME_SAMPLES).buffer);
      offset += AUDIO_FRAME_SAMPLES;
    }
    if (offset > 0) markSpeaking(state.tsClientId);
    accumLen -= offset;
    if (offset > 0) accumBuf.set(accumBuf.subarray(offset, offset + accumLen), 0);
  }

  async function startMicrophone(): Promise<void> {
    const generation = ++microphoneGeneration;
    pendingMicrophoneCapture?.abort();
    const controller = new AbortController();
    pendingMicrophoneCapture = controller;
    const ctx = getAudioCtx();
    const assertCurrent = (): void => {
      if (generation !== microphoneGeneration || audioCtx !== ctx || controller.signal.aborted) throw new CancelledMediaOperation();
    };
    let nextStream: MediaStream | null = null;
    let nextCapture: MicrophoneCapture | null = null;
    let factoryOwnsStream = false;
    try {
      nextStream = await requestMediaBeforeAudioResume(
        () => navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() }),
        () => ctx.state === "suspended" ? ctx.resume() : Promise.resolve(),
      );
      assertCurrent();
      audioPermission.value = "granted";
      factoryOwnsStream = true;
      nextCapture = await microphoneCaptureFactory.prepare({
        context: ctx, stream: nextStream, signal: controller.signal, assertCurrent,
        noiseSuppression: noiseSuppressionEnabled.value, volume: inputVolume.value, onSamples: handleCaptureChunk,
      });
      assertCurrent();
      // Commit only a complete graph. Permission and node failures leave the
      // previous stream, PCM route and WebRTC peer untouched.
      stopMicrophone(false);
      micStream = nextStream;
      microphoneCapture = nextCapture;
      Object.assign(microphoneProcessing, nextCapture.processing);
      nextCapture.setVolume(inputVolume.value);
      nextCapture.activate();
      // The fallback for a later failed change is this actual live graph, even
      // if device enumeration or WebRTC negotiation is still in progress.
      committedInputDeviceId = selectedInputDeviceId.value;
      committedNoiseSuppressionEnabled = noiseSuppressionEnabled.value;
      clearMicrophoneError();
    } catch (error) {
      nextCapture?.dispose();
      if (!factoryOwnsStream) nextStream?.getTracks().forEach(track => track.stop());
      if (generation === microphoneGeneration && !(error instanceof CancelledMediaOperation)) {
        if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) audioPermission.value = "denied";
        setMicrophoneError(error);
      }
      throw error;
    } finally {
      if (pendingMicrophoneCapture === controller) pendingMicrophoneCapture = null;
    }
    syncAudioContextNotice();
  }

  // 导出给 WebClient：开麦前先 await 此函数完成真实采集，避免出现“假成功”
  async function ensureMicrophone(): Promise<void> {
    if (microphoneStartPromise) return microphoneStartPromise;
    if (micStream) return;
    if (!microphoneStartPromise) {
      const generation = microphoneGeneration + 1;
      const pending = startMicrophone().then(async () => {
        await refreshAudioDevices();
        if (generation !== microphoneGeneration || !micStream) throw new CancelledMediaOperation();
      }).finally(() => {
        if (microphoneStartPromise === pending) microphoneStartPromise = null;
      });
      microphoneStartPromise = pending;
    }
    await microphoneStartPromise;
  }

  function voxGate(samples: Float32Array): boolean {
    let sum = 0;
    const count = Math.min(256, samples.length);
    for (let i = 0; i < count; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / count);
    if (rms >= voxThreshold.value) {
      voxAttack = Math.min(VOX_ATTACK_FRAMES, voxAttack + 1);
      voxRelease = VOX_HOLD;
      return voxAttack >= VOX_ATTACK_FRAMES;
    }
    voxAttack = 0;
    if (voxRelease > 0) {
      voxRelease--;
      return true;
    }
    return false;
  }

  async function startAccompaniment(): Promise<void> {
    await accompaniment.start();
  }

  async function stopAccompaniment(): Promise<void> {
    accompaniment.stop();
  }

  async function startWebRtcTransport(sequence: number, socket: WebSocket): Promise<void> {
    await webrtc.start({
      isCurrent: () => sequence === voiceConnection.generation && ws.value === socket
        && socket.readyState === WebSocket.OPEN && state.connected,
      send: message => socket.send(JSON.stringify(message)),
    });
  }

  function stopCaptureGraph(): void {
    accumLen = 0;
    voxAttack = 0;
    voxRelease = 0;
    micLevel.value = 0;
    microphoneCapture?.stopCapture();
  }

  function stopMicrophone(closeContext = true): void {
    if (closeContext) {
      microphoneGeneration++;
      microphoneStartPromise = null;
      pendingMicrophoneCapture?.abort();
      pendingMicrophoneCapture = null;
    }
    stopCaptureGraph();
    microphoneCapture?.dispose();
    microphoneCapture = null;
    webrtc.releaseInput();
    micStream = null;
    if (closeContext) {
      void audioCtx?.close().catch(() => undefined);
      audioCtx = null;
    }
  }

  async function prepareInputDevices(): Promise<void> {
    if (!micStream) await startMicrophone();
    const generation = microphoneGeneration;
    await refreshAudioDevices();
    if (generation !== microphoneGeneration || !micStream) throw new CancelledMediaOperation();
  }

  async function setInputDevice(deviceId: string): Promise<void> {
    inputDeviceTouched = true;
    selectedInputDeviceId.value = deviceId;
    await reconfigureMicrophone();
  }

  async function reconfigureMicrophone(): Promise<void> {
    const generation = ++inputDeviceGeneration;
    deviceListGeneration++;
    const sequence = voiceConnection.generation;
    const socket = ws.value;
    const isCurrent = () => generation === inputDeviceGeneration && sequence === voiceConnection.generation;
    const shouldRestartWebRtc = webrtc.active && Boolean(ws.value);
    try {
      // Keep the current peer alive until the replacement microphone is ready.
      if (micStream) await startMicrophone();
      if (!isCurrent()) return;
      if (shouldRestartWebRtc && socket) await startWebRtcTransport(sequence, socket);
      if (!isCurrent()) return;
      await refreshAudioDevices();
      if (!isCurrent()) return;
      committedInputDeviceId = selectedInputDeviceId.value;
      committedNoiseSuppressionEnabled = noiseSuppressionEnabled.value;
      localStorage.setItem("webspeak:input-device", committedInputDeviceId);
      await saveAudioPreferences();
    } catch (error) {
      if (!isCurrent() || error instanceof CancelledMediaOperation) return;
      selectedInputDeviceId.value = committedInputDeviceId;
      noiseSuppressionEnabled.value = committedNoiseSuppressionEnabled;
      localStorage.setItem("webspeak:input-device", committedInputDeviceId);
      throw error;
    }
  }

  async function startMicrophoneTest(): Promise<void> {
    await microphoneTest.start();
  }

  function stopMicrophoneTest(): void {
    microphoneTest.stop();
    // Closing settings also releases device-preview capture when no recorder
    // was started. Room capture remains owned by the connected session.
    if (!state.connected) stopMicrophone();
  }

  async function setOutputDevice(deviceId: string): Promise<void> {
    if (deviceId && !outputDevices.some((device) => device.deviceId === deviceId)) {
      throw new Error("所选扬声器当前不可用");
    }
    outputDeviceTouched = true;
    const generation = ++outputDeviceGeneration;
    deviceListGeneration++;
    const sequence = voiceConnection.generation;
    const isCurrent = () => generation === outputDeviceGeneration && sequence === voiceConnection.generation;
    const previousDeviceId = committedOutputDeviceId;
    selectedOutputDeviceId.value = deviceId;
    try {
      if (audioCtx || deviceId) await setAudioSink(audioCtx ?? getAudioCtx(), deviceId);
      if (!isCurrent()) return;
      committedOutputDeviceId = deviceId;
      localStorage.setItem("webspeak:output-device", deviceId);
      clearAudioNotice("OUTPUT_DEVICE_UNAVAILABLE");
      await saveAudioPreferences();
    } catch (error) {
      if (!isCurrent()) return;
      selectedOutputDeviceId.value = previousDeviceId;
      localStorage.setItem("webspeak:output-device", previousDeviceId);
      // One endpoint may have changed before the other rejected the request.
      if (audioCtx) await setAudioSink(audioCtx, previousDeviceId).catch(() => undefined);
      if (!isCurrent()) return;
      setAudioNotice("OUTPUT_DEVICE_UNAVAILABLE", "无法切换到所选音频输出设备，请检查设备连接或选择其他扬声器");
      throw error;
    }
  }

  function playNotification(kind: "connected" | "disconnected" | "poke" | "private" | "reconnectFailed"): void {
    if (notificationVolume.value <= 0 || outputMuted.value || effectiveOutputVolume() <= 0 || typeof window === "undefined") return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") return;
      const frequencies: Record<typeof kind, number[]> = {
        connected: [660, 880],
        disconnected: [440, 330],
        poke: [740, 980],
        private: [600, 760],
        reconnectFailed: [300, 220],
      };
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      oscillator.frequency.setValueAtTime(frequencies[kind][0], now);
      oscillator.frequency.setValueAtTime(frequencies[kind][1], now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, notificationVolume.value * effectiveOutputVolume() * 0.12), now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch {
      // Notification sounds are best effort and must never affect the session.
    }
  }

  function connect(target: string, channel: string, nickname: string, serverPassword = "", identity = "", rememberIdentity = false, inviteToken = "", accelerated = false, accelerationRelayId = ""): void {
    disconnect(true);
    lastConnection = { target, channel, nickname, serverPassword, ...(identity ? { identity } : {}), rememberIdentity, accelerated, accelerationRelayId };
    identityMaterial.value = identity;
    state.error = "";
    state.errorCode = "";
    // Audio diagnostics belong to the previous session, never to the new one.
    clearMicrophoneError();
    clearAudioNotice();
    state.connecting = true;
    state.reconnecting = false;
    state.reconnectAttempt = 0;
    state.reconnectFailed = false;
    voiceConnection.start(JSON.stringify({
      target, nickname, channel, serverPassword,
      ...(inviteToken ? { invite: inviteToken } : {}),
      ...(accelerated ? { accelerated: true, ...(accelerationRelayId ? { accelerationRelayId } : {}) } : {}),
      ...(rememberIdentity && identity ? { identity } : {}),
      ...(rememberIdentity ? { rememberIdentity: true } : {}),
    }), audioPreferencesReady);
  }

  function joinTicketReason(code: string, detail?: unknown): string {
    const messages: Record<string, string> = {
      ORIGIN_REJECTED: "请求来源不受信任，请从正确的网站入口重新打开",
      NOT_INITIALIZED: "WebSpeak 尚未完成配置，请联系管理员",
      RATE_LIMITED: "请求过于频繁，请稍后重试",
      TARGET_NOT_ALLOWED: "此 TeamSpeak 服务器地址不允许连接",
      ACCELERATION_UNAVAILABLE: "当前中继加速不可用，请关闭加速或联系管理员",
      VOICE_GATEWAY_UNAVAILABLE: "中继语音网关暂不可连接，请检查管理员配置与 HTTPS 证书",
      INVALID_NICKNAME: "请输入有效的昵称",
      INVITE_INVALID: "邀请链接已失效或已被撤销",
      REQUEST_TIMEOUT: "等待 WebSpeak 网关响应超时，请检查网络后重试",
    };
    const normalized = normalizedClientErrorCode(code);
    return messages[normalized] ?? connectionFailureMessage(normalized, detail);
  }

  // 网关关闭码 → 前端可解释错误码的映射：4000-4003 是网关/会话级，4004/4005 是
  // TeamSpeak 拒绝与身份冲突，4006 是中继加速，1006/1011 是传输级掉线，绝不能
  // 被误当成 TeamSpeak 服务器拒绝。
  /**
   * Gateway close codes. 4000-4003 are gateway/session level, 4004/4005 are a
   * TeamSpeak rejection and an identity conflict, 4006 is the acceleration relay,
   * and 1006 is a transport-level drop that must not be blamed on TeamSpeak.
   */
  const GATEWAY_CLOSE_CODE_CODES: Record<number, string> = {
    4000: "CONNECTION_FAILED",
    4001: "JOIN_TICKET_REQUIRED",
    4002: "INVALID_TARGET",
    4003: "IDENTITY_REJECTED",
    4004: "SERVER_REJECTED",
    4005: "IDENTITY_IN_USE",
    4006: "ACCELERATION_UNAVAILABLE",
    1006: "GATEWAY_NETWORK_LOST",
    1011: "GATEWAY_SESSION_ENDED",
  };

  function closeErrorCode(code: number, reason = ""): string {
    const closeCode = normalizedClientErrorCode(reason, "");
    // The gateway repeats the failure code in the close reason. Trust it when the
    // browser can explain that code, otherwise fall back to the numeric close code
    // so even a silent close maps to an actionable message.
    if (closeCode && CONNECTION_FAILURE_MESSAGES[closeCode]) return closeCode;
    return GATEWAY_CLOSE_CODE_CODES[code] ?? "CONNECTION_FAILED";
  }

  function connectionFailureMessage(code: string, detail?: unknown): string {
    const messages = CONNECTION_FAILURE_MESSAGES;
    const normalized = normalizedClientErrorCode(code);
    if (messages[normalized]) return messages[normalized];
    const safeCode = safeClientErrorCode(normalized);
    const safeDetail = safeClientErrorDetail(detail);
    // The gateway classifies a refused nickname before it reaches the browser,
    // but translate the raw TeamSpeak signature too: a nickname problem must
    // never end up as the generic "check your network" fallback.
    if (safeDetail && NICKNAME_LENGTH_SIGNATURE.test(safeDetail)) return NICKNAME_LENGTH_MESSAGE;
    return `TeamSpeak 连接失败（错误代码：${safeCode}）${safeDetail ? `：${safeDetail}` : ""}，请检查输入、网络或服务器状态`;
  }

  function closeReason(code: number, reason = ""): string {
    const failureCode = closeErrorCode(code, reason);
    if (code === 4004 && failureCode === "SERVER_REJECTED") return "服务器当前已满或拒绝了连接，请稍后重试";
    return connectionFailureMessage(failureCode);
  }

  function disconnect(preserveConnection = false): void {
    serverInfo.value = null;
    const keepRememberedIdentity = lastConnection?.rememberIdentity === true;
    if (!preserveConnection) lastConnection = null;
    voiceConnection.stop(() => releaseSessionResources(!preserveConnection));
    clearMicrophoneError();
    clearAudioNotice();
    state.connected = false;
    state.connecting = false;
    state.reconnecting = false;
    state.reconnectAttempt = 0;
    state.reconnectFailed = false;
    state.tsClientId = 0;
    state.errorCode = "";
    state.channelSwitchedChannelId = "";
    if (!keepRememberedIdentity) identityMaterial.value = "";
    sessionState.reset();
    for (const key of Object.keys(volumes)) delete volumes[Number(key)];
  }

  /** All ways a session ends release the same owned media and pending work. */
  function releaseSessionResources(sendScreenStop = false): void {
    plugins.reset();
    chatGeneration++;
    inputDeviceGeneration++;
    outputDeviceGeneration++;
    deviceListGeneration++;
    selectedInputDeviceId.value = committedInputDeviceId;
    selectedOutputDeviceId.value = committedOutputDeviceId;
    noiseSuppressionEnabled.value = committedNoiseSuppressionEnabled;
    microphoneTest.dispose();
    audioDiagnostics.reset();
    commands.clear(new Error("语音连接已关闭"));
    screenShare.stopTransport(sendScreenStop);
    webrtc.stop();
    remotePlayback.clearAll();
    stopMicrophone();
    clearSpeakingState();
    whisperTargetIds.clear();
    whisperActive.value = false;
  }

  function handleMessage(raw: unknown): void {
    if (plugins.receive(raw)) return;
    const msg = parseServerMessage(raw);
    if (!msg || screenShare.handleMessage(msg) || sessionState.receive(msg)) return;
    switch (msg.type) {
      case "serverInfo":
        serverInfo.value = {
          name: msg.name,
          icon: msg.icon ?? null,
          bannerUrl: msg.bannerUrl ?? null,
          welcomeMessage: msg.welcomeMessage ?? "",
        };
        break;
      case "connected":
        const wasReconnecting = state.reconnecting;
        state.connected = true;
        state.connecting = false;
        state.reconnecting = false;
        state.reconnectAttempt = 0;
        state.reconnectFailed = false;
        state.error = "";
        state.errorCode = "";
        state.channelSwitchedChannelId = "";
        state.tsClientId = Number(msg.tsClientId) || 0;
        // The mute preference is local to the browser, while TeamSpeak shows
        // the gateway's own client_input_muted flag to other clients. Send it
        // as soon as the session is ready so a muted reconnect is visible to
        // native TeamSpeak users even before WebRTC negotiation completes.
        sendCmd("setMicrophoneMuted", { muted: microphoneMuted.value });
        screenShare.setIceServers(msg.screenShareIceServers);
        webRtcStunServer = msg.webRtcStunServer ?? "";
        sessionState.connected(msg);
        applyWhisperState(msg.whisperTargetIds, msg.whisperActive);
        if (typeof msg.identity === "string" && msg.identity.length <= 8192) {
          identityMaterial.value = msg.identity;
          if (lastConnection) lastConnection.identity = msg.identity;
        }
        if (wasReconnecting) {
          const start = msg.webrtcAvailable === true && typeof RTCPeerConnection !== "undefined"
            ? (ws.value ? startWebRtcTransport(voiceConnection.generation, ws.value) : Promise.resolve())
            : ensureMicrophone();
          // A failed microphone must not look like a failed connection: record it
          // as an audio diagnostic so the room stays visible with a clear reason.
          start.catch((error: unknown) => { setMicrophoneError(error); });
        } else if (msg.webrtcAvailable === true && typeof RTCPeerConnection !== "undefined" && ws.value) {
          void startWebRtcTransport(voiceConnection.generation, ws.value).catch((error: unknown) => { setMicrophoneError(error); });
        } else {
          void ensureMicrophone().catch((error: unknown) => { setMicrophoneError(error); });
        }
        screenShare.refreshStreams();
        break;
      case "channelSwitched":
        state.channelSwitchedChannelId = typeof msg.channelId === "string" || typeof msg.channelId === "number" ? String(msg.channelId) : "";
        state.error = "";
        state.errorCode = "";
        break;
      case "audioStats": {
        const sequence = typeof msg.sequence === "string" ? msg.sequence : "";
        audioDiagnostics.receive(sequence, msg.stats);
        break;
      }
      case "disconnected":
        state.connected = false;
        state.connecting = false;
        state.reconnecting = Boolean(msg.recoverable !== false);
        state.reconnectFailed = false;
        if (!state.reconnecting) state.error = "TeamSpeak 连接已断开";
        releaseSessionResources();
        break;
      case "reconnecting":
        state.connected = false;
        state.connecting = false;
        state.reconnecting = true;
        state.reconnectFailed = false;
        state.reconnectAttempt = Number(msg.attempt) || state.reconnectAttempt + 1;
        releaseSessionResources();
        break;
      case "reconnected":
        state.reconnecting = false;
        state.reconnectFailed = false;
        break;
      case "reconnectFailed":
        state.connected = false;
        state.connecting = false;
        state.reconnecting = false;
        state.reconnectFailed = true;
        state.errorCode = normalizedClientErrorCode(msg.code);
        state.error = connectionFailureMessage(state.errorCode, msg.detail);
        releaseSessionResources();
        break;
      case "connectionFailed":
        state.connected = false;
        state.connecting = false;
        state.reconnecting = false;
        // This is the first connection attempt, not a failed reconnect. Keep
        // the user on the welcome form instead of showing an empty voice room.
        state.reconnectFailed = false;
        state.errorCode = normalizedClientErrorCode(msg.code);
        state.error = connectionFailureMessage(state.errorCode, msg.detail);
        releaseSessionResources();
        break;
      case "whisperTargets":
        applyWhisperState(msg.targetIds, msg.active);
        break;
      case "webrtcAnswer":
        void webrtc.applyAnswer(msg.payload?.sdp);
        break;
      case "webrtcError":
        if (ws.value) void webrtc.fallback(safeClientErrorCode(msg.code) || "WEBRTC_NEGOTIATION_FAILED");
        break;
      case "audioError": {
        // The gateway could not encode our microphone audio (for example its Opus
        // encoder is unavailable): say it instead of dropping frames silently.
        const audioCode = safeClientErrorCode(msg.code) || "AUDIO_ERROR";
        setAudioNotice(audioCode, audioNoticeMessage(audioCode, msg.detail));
        break;
      }
      case "voiceActivity":
        if (Array.isArray(msg.clientIds)) {
          for (const clientId of msg.clientIds) {
            if (typeof clientId === "number" && Number.isInteger(clientId) && clientId > 0) markSpeaking(clientId);
          }
        }
        break;
      case "commandCompleted": {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
        commands.settle(requestId);
        break;
      }
      case "error":
        state.errorCode = normalizedClientErrorCode(msg.error?.code, "OPERATION_FAILED");
        state.error = protocolErrorMessage(state.errorCode, String(msg.error?.message || msg.message || "操作失败"));
        {
          const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
          const error = Object.assign(new Error(state.error), { code: state.errorCode });
          commands.settle(requestId, error);
        }
        break;
    }
  }

  function handleAudioFrame(data: Uint8Array): void {
    // WebRTC carries the realtime downlink after negotiation. Ignore any
    // in-flight fallback WebSocket packets so a transport switch cannot
    // produce duplicate or delayed playback.
    if (webrtc.active) return;
    if (data.length < 4) {
      audioDiagnostics.count("framesDropped");
      return;
    }
    const clientId = (data[1] << 8) | data[2];
    if (clientId === state.tsClientId) return;
    audioDiagnostics.count("framesReceived");
    markSpeaking(clientId);
    remotePlayback.play(clientId, data.slice(3));
  }

  function sendCmd<K extends ClientCommandType>(type: K, payload: ClientCommandPayloads[K]): void {
    commands.send(type, payload);
  }

  function sendCommandAndWait<K extends ClientCommandType>(type: K, payload: ClientCommandPayloads[K], timeoutMs = 8_000): Promise<void> {
    return commands.sendAndWait(type, payload, timeoutMs);
  }

  function switchChannel(channelId: string, password = ""): void {
    state.error = "";
    state.errorCode = "";
    state.channelSwitchedChannelId = "";
    sendCmd("switchChannel", { channelId, ...(password ? { password } : {}) });
  }

  function moveClient(clientId: number, channelId: string, password = ""): Promise<void> {
    return sendCommandAndWait("moveClient", { clientId, channelId, ...(password ? { password } : {}) });
  }

  function measureVoiceAudioStatus(timeoutMs = 1_800): Promise<VoiceAudioStatusSample | null> {
    return audioDiagnostics.measure(timeoutMs);
  }

  function chatText(message: string): string {
    if (!state.connected || ws.value?.readyState !== WebSocket.OPEN) {
      throw Object.assign(new Error("TeamSpeak 会话尚未就绪"), { code: "SESSION_NOT_READY" });
    }
    const text = message.trim();
    if (!text || text.length > 500) throw Object.assign(new Error("文字消息无效"), { code: "INVALID_TEXT_MESSAGE" });
    return text;
  }

  async function sendChat<K extends "sendTextMessage" | "sendServerMessage" | "sendPrivateMessage">(
    type: K, payload: ClientCommandPayloads[K], local: Pick<ChatMessage, "scope" | "targetId" | "conversationId" | "conversationKey" | "conversationName">,
  ): Promise<void> {
    const generation = chatGeneration;
    const senderId = state.tsClientId;
    await sendCommandAndWait(type, payload);
    if (generation !== chatGeneration || !state.connected) throw new Error("语音连接已关闭");
    sessionState.appendLocal({ ...local, senderId, invokerName: "你", message: payload.message });
  }

  async function sendTextMessage(message: string, targetId = ""): Promise<void> {
    const text = chatText(message);
    await sendChat("sendTextMessage", { message: text, ...(targetId ? { channelId: targetId } : {}) },
      { scope: "channel", ...(targetId ? { targetId } : {}) });
  }

  async function sendServerMessage(message: string): Promise<void> {
    await sendChat("sendServerMessage", { message: chatText(message) }, { scope: "server" });
  }

  async function sendPrivateMessage(clientId: number, message: string, targetId = "", expectedKey?: string): Promise<void> {
    const text = chatText(message);
    const member = members.find(candidate => candidate.id === clientId);
    const key = sessionState.memberConversationKey(clientId);
    if (!member || clientId === state.tsClientId || (expectedKey !== undefined && key !== expectedKey)) {
      throw Object.assign(new Error("成员已离线或当前不可见"), { code: "CLIENT_NOT_FOUND" });
    }
    await sendChat("sendPrivateMessage", { clientId, message: text, ...(member.uid ? { clientUid: member.uid } : {}) },
      { scope: "private", targetId, conversationId: String(clientId), conversationKey: key, conversationName: member.nickname });
  }

  function sendPoke(clientId: number, message = ""): void {
    sendCmd("poke", { clientId, message: message.trim().slice(0, 200) });
  }

  function setAway(away: boolean, message = ""): void {
    sendCmd("setAway", { away, message: message.trim().slice(0, 200) });
  }

  function setWhisperTargets(clientIds: number[]): void {
    const targets = [...new Set(clientIds)].filter((clientId) => Number.isInteger(clientId) && clientId > 0 && clientId <= 65535 && clientId !== state.tsClientId).slice(0, 8);
    whisperTargetIds.clear();
    for (const clientId of targets) whisperTargetIds.add(clientId);
    if (!targets.length) whisperActive.value = false;
    sendCmd("setWhisperTargets", { targetIds: targets });
  }

  function setWhisperActive(active: boolean): void {
    if (active && !whisperTargetIds.size) return;
    whisperActive.value = active;
    sendCmd("setWhisperActive", { active });
  }

  function applyWhisperState(targetIds: unknown, active: unknown): void {
    whisperTargetIds.clear();
    if (Array.isArray(targetIds)) {
      for (const clientId of targetIds) {
        if (typeof clientId === "number" && Number.isInteger(clientId) && clientId > 0 && clientId <= 65535 && clientId !== state.tsClientId) whisperTargetIds.add(clientId);
      }
    }
    whisperActive.value = active === true && whisperTargetIds.size > 0;
  }

  function reconnectNow(): void {
    if (!lastConnection || state.connecting) return;
    connect(lastConnection.target, lastConnection.channel, lastConnection.nickname, lastConnection.serverPassword, lastConnection.rememberIdentity ? identityMaterial.value || lastConnection.identity : "", lastConnection.rememberIdentity, "", lastConnection.accelerated, lastConnection.accelerationRelayId);
  }

  function setMicrophoneMuted(muted: boolean): void {
    microphoneMuted.value = muted;
    voxAttack = 0;
    voxRelease = 0;
    accumLen = 0;
    if (webrtc.active) micStream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    webrtc.input?.setVolume(muted ? 0 : inputVolume.value);
    sendCmd("setMicrophoneMuted", { muted });
    if (muted && state.tsClientId) clearSpeaking(state.tsClientId);
    void saveAudioPreferences();
  }

  function clearError(): void {
    state.error = "";
    state.errorCode = "";
  }

  function protocolErrorMessage(code: string, fallback: string): string {
    const messages: Record<string, string> = {
      INVALID_JSON: "消息格式无效",
      INVALID_MESSAGE: "消息格式无效",
      INVALID_REQUEST_ID: "请求标识无效",
      UNKNOWN_MESSAGE_TYPE: "不支持的操作",
      INVALID_PAYLOAD: "操作参数无效",
      INVALID_CHANNEL_ID: "频道标识无效",
      INVALID_CHANNEL_PASSWORD: "频道密码无效",
      INVALID_CLIENT_ID: "成员标识无效",
      INVALID_TEXT_MESSAGE: "文字消息无效",
      INVALID_POKE_MESSAGE: "戳一戳消息无效",
      INVALID_AWAY_STATUS: "离开状态无效",
      INVALID_AUDIO_FRAME: "音频帧格式无效",
      INVALID_MEMBER_VOLUME: "成员音量无效",
      INVALID_WHISPER_TARGETS: "私语目标无效",
      INVALID_WHISPER_STATE: "私语状态无效",
      NO_WHISPER_TARGETS: "请先选择私语目标",
      SESSION_NOT_READY: "TeamSpeak 会话尚未就绪",
      CHANNEL_SWITCH_FAILED: "频道切换失败",
      CHANNEL_PASSWORD_REQUIRED: "该频道需要密码",
      CHANNEL_FULL: "该频道已满",
      CANNOT_MOVE_SELF: "不能移动自己的客户端",
      CHANNEL_NOT_FOUND: "目标频道不可用",
      NICKNAME_IN_USE: "该昵称已被占用，请更换昵称",
      CLIENT_VERSION_OUTDATED: "客户端版本过旧，服务器拒绝了该操作",
      FLOOD_PROTECTION: "操作过于频繁，请稍后重试",
      BANNED: "你已被该服务器封禁",
      KICKED: "你已被服务器移出",
      PERMISSION_DENIED: "你没有执行此操作的权限",
      CLIENT_NOT_FOUND: "成员已离线",
      OPERATION_FAILED: "操作失败",
    };
    const normalized = normalizedClientErrorCode(code, "OPERATION_FAILED");
    if (messages[normalized]) return messages[normalized];
    const safeCode = safeClientErrorCode(normalized);
    const safeFallback = safeClientErrorDetail(fallback);
    return `操作失败（错误代码：${safeCode}）${safeFallback ? `：${safeFallback}` : ""}`;
  }

  function setVolume(clientId: number, volume: number): void {
    const normalized = Math.max(0, Math.min(4, volume));
    volumes[clientId] = normalized;
    const member = members.find((candidate) => candidate.id === clientId);
    if (member?.uid) {
      storedVolumesByUid[member.uid] = normalized;
      void saveAudioPreferences();
    }
    remotePlayback.updateVolume(clientId);
    if (webrtc.peer || webrtc.active) sendCmd("setMemberVolume", { clientId, volume: normalized });
  }

  function syncWebRtcMemberVolumes(): void {
    if (!webrtc.active || ws.value?.readyState !== WebSocket.OPEN) return;
    for (const [rawClientId, volume] of Object.entries(volumes)) {
      const clientId = Number(rawClientId);
      if (!Number.isInteger(clientId) || clientId <= 0) continue;
      sendCmd("setMemberVolume", { clientId, volume });
    }
  }

  function setInputVolume(volume: number): void {
    inputVolume.value = Math.max(0, Math.min(1, volume));
    microphoneCapture?.setVolume(inputVolume.value);
    webrtc.input?.setVolume(microphoneMuted.value ? 0 : inputVolume.value);
    void saveAudioPreferences();
  }

  async function setNoiseSuppressionEnabled(enabled: boolean): Promise<void> {
    if (noiseSuppressionEnabled.value === enabled) return;
    noiseSuppressionTouched = true;
    noiseSuppressionEnabled.value = enabled;
    try {
      await reconfigureMicrophone();
    } catch (error) {
      setMicrophoneError(error);
    }
  }

  function setOutputVolume(volume: number): void {
    outputVolume.value = Math.max(0, Math.min(1, volume));
    applyOutputVolume();
    void saveAudioPreferences();
  }

  function toggleOutputMute(): void {
    outputMuted.value = !outputMuted.value;
    applyOutputVolume();
  }

  function setVoxThreshold(threshold: number): void {
    voxThreshold.value = clamp(threshold, 0.001, 0.08);
    void saveAudioPreferences();
  }

  function setNotificationVolume(volume: number): void {
    notificationVolume.value = clamp(volume, 0, 1);
    void saveAudioPreferences();
  }

  return {
    plugins,
    ...screenShare.api,
    ws,
    state,
    serverInfo,
    sessionEpoch: sessionState.epoch,
    memberConversationKey: sessionState.memberConversationKey,
    members,
    channels,
    chatMessages,
    serverEvents,
    pokeNotifications,
    microphoneMuted,
    noiseSuppressionEnabled,
    inputVolume,
    outputVolume,
    outputMuted,
    notificationVolume,
    voxThreshold,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    outputDeviceSupported,
    audioPermission,
    microphoneProcessing,
    audioContextState,
    identityMaterial,
    micLevel,
    microphoneTestActive,
    testAudioUrl,
    speakingIds,
    whisperTargetIds,
    whisperActive,
    volumes,
    accompanimentActive,
    accompanimentSupported,
    accompanimentErrorCode,
    setVolume,
    setInputVolume,
    setNoiseSuppressionEnabled,
    setOutputVolume,
    toggleOutputMute,
    setVoxThreshold,
    setNotificationVolume,
    prepareInputDevices,
    refreshAudioDevices,
    setInputDevice,
    setOutputDevice,
    startMicrophoneTest,
    stopMicrophoneTest,
    playNotification,
    connect,
    reconnectNow,
    disconnect,
    switchChannel,
    moveClient,
    sendTextMessage,
    sendServerMessage,
    sendPrivateMessage,
    sendPoke,
    setAway,
    setWhisperTargets,
    setWhisperActive,
    setMicrophoneMuted,
    ensureMicrophone,
    startAccompaniment,
    stopAccompaniment,
    checkSupport,
    clearError,
    measureVoiceAudioStatus,
  };
}
