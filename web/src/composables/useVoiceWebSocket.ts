import { reactive, ref } from "vue";

export interface VoiceState {
  connected: boolean;
  connecting: boolean;
  tsClientId: number;
  error: string;
}

export interface ChannelMember {
  id: number;
  nickname: string;
  isSelf?: boolean;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface ChannelInfo {
  id: string;
  parentID: string;
  name: string;
  description?: string;
  members?: { id: number; nickname: string }[];
}

export interface ChatMessage {
  id: string;
  invokerName: string;
  message: string;
  timestamp: number;
  isSelf?: boolean;
}

export function useVoiceWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const state = reactive<VoiceState>({ connected: false, connecting: false, tsClientId: 0, error: "" });
  const members = reactive<ChannelMember[]>([]);
  const channels = reactive<ChannelInfo[]>([]);
  const chatMessages = reactive<ChatMessage[]>([]);
  let connectionSequence = 0;

  // Audio capture. The ScriptProcessor path remains the most compatible option
  // for the current browser support matrix, but the graph now has an explicit
  // input gain and a silent output to avoid monitoring the microphone locally.
  let audioCtx: AudioContext | null = null;
  let micStream: MediaStream | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let micGain: GainNode | null = null;
  let silentGain: GainNode | null = null;
  const inputDevices = reactive<AudioInputDevice[]>([]);
  const selectedInputDeviceId = ref(typeof localStorage !== "undefined" ? localStorage.getItem("webspeak:input-device") ?? "" : "");
  const micLevel = ref(0);
  const microphoneTestActive = ref(false);
  let pttPressed = false;
  const micMode = ref<"vox" | "ptt">("vox");
  const inputVolume = ref(1);
  const outputVolume = ref(1);
  let voxHold = 0;
  const VOX_HOLD = 15;
  const VOX_THRESHOLD = 0.008;
  let convBuf = new Int16Array(1024);
  let accumBuf = new Int16Array(2048);
  let accumLen = 0;

  // Playback is kept per client so frames from multiple speakers cannot
  // interleave into one decoder or one scheduling queue.
  const remoteDecoders = new Map<number, AudioDecoder>();
  const remotePlayTimes = new Map<number, number>();
  const remoteGains = new Map<number, GainNode>();
  const remoteDecodeTimestamps = new Map<number, number>();
  const volumes = reactive<Record<number, number>>({});
  const speakingIds = reactive(new Set<number>());
  const speakingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const SPEAKING_HOLD_MS = 360;

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

  function getAudioCtx(): AudioContext {
    if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 48000 });
    return audioCtx;
  }

  function checkSupport(): string | null {
    if (typeof window === "undefined") return null;
    if (!window.isSecureContext) return "语音功能需要 HTTPS 安全连接";
    if (!navigator.mediaDevices?.getUserMedia) return "当前浏览器不支持麦克风访问";
    if (typeof AudioDecoder === "undefined") return "当前浏览器不支持音频解码，请使用最新版 Chrome 或 Edge";
    return null;
  }

  function microphoneConstraints(): MediaTrackConstraints {
    const constraints: MediaTrackConstraints = {
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (selectedInputDeviceId.value) constraints.deviceId = { exact: selectedInputDeviceId.value };
    return constraints;
  }

  async function refreshInputDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      inputDevices.length = 0;
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }));
    inputDevices.splice(0, inputDevices.length, ...microphones);
    if (selectedInputDeviceId.value && !microphones.some((device) => device.deviceId === selectedInputDeviceId.value)) {
      selectedInputDeviceId.value = microphones[0]?.deviceId ?? "";
      localStorage.setItem("webspeak:input-device", selectedInputDeviceId.value);
    }
  }

  async function startMicrophone(): Promise<void> {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    // Acquire the replacement stream before tearing down the current graph so
    // changing devices does not interrupt an active microphone on failure.
    const nextStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() });
    stopMicrophone(false);
    micStream = nextStream;

    micSource = ctx.createMediaStreamSource(micStream);
    micGain = ctx.createGain();
    micGain.gain.value = inputVolume.value;
    scriptNode = ctx.createScriptProcessor(1024, 1, 1);
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    scriptNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      micLevel.value = Math.min(1, Math.sqrt(sum / Math.max(1, input.length)) * 6);
      const shouldSend = micMode.value === "ptt" ? pttPressed : voxGate(input);
      if (!shouldSend) {
        accumLen = 0;
        return;
      }
      if (ws.value?.readyState === WebSocket.OPEN) markSpeaking(state.tsClientId);

      if (convBuf.length < input.length) convBuf = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        convBuf[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      const need = accumLen + input.length;
      if (accumBuf.length < need) accumBuf = new Int16Array(Math.max(need, accumBuf.length * 2));
      accumBuf.set(convBuf.subarray(0, input.length), accumLen);
      accumLen = need;

      let offset = 0;
      while (offset + 960 <= accumLen && ws.value?.readyState === WebSocket.OPEN) {
        ws.value.send(accumBuf.slice(offset, offset + 960).buffer);
        offset += 960;
      }
      accumLen -= offset;
      if (offset > 0) accumBuf.set(accumBuf.subarray(offset, offset + accumLen), 0);
    };

    micSource.connect(micGain);
    micGain.connect(scriptNode);
    scriptNode.connect(silentGain);
    silentGain.connect(ctx.destination);
    await refreshInputDevices();
  }

  function voxGate(samples: Float32Array): boolean {
    let sum = 0;
    const count = Math.min(256, samples.length);
    for (let i = 0; i < count; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / count);
    if (rms > VOX_THRESHOLD) {
      voxHold = VOX_HOLD;
      return true;
    }
    if (voxHold > 0) {
      voxHold--;
      return true;
    }
    return false;
  }

  function stopMicrophone(closeContext = true): void {
    accumLen = 0;
    voxHold = 0;
    micLevel.value = 0;
    scriptNode?.disconnect();
    micGain?.disconnect();
    micSource?.disconnect();
    silentGain?.disconnect();
    scriptNode = null;
    micGain = null;
    micSource = null;
    silentGain = null;
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
    if (closeContext) {
      audioCtx?.close();
      audioCtx = null;
    }
  }

  async function prepareInputDevices(): Promise<void> {
    if (!micStream) await startMicrophone();
    else await refreshInputDevices();
  }

  async function setInputDevice(deviceId: string): Promise<void> {
    const previousDeviceId = selectedInputDeviceId.value;
    selectedInputDeviceId.value = deviceId;
    localStorage.setItem("webspeak:input-device", deviceId);
    try {
      if (micStream) await startMicrophone();
      await refreshInputDevices();
    } catch (error) {
      selectedInputDeviceId.value = previousDeviceId;
      localStorage.setItem("webspeak:input-device", previousDeviceId);
      throw error;
    }
  }

  async function startMicrophoneTest(): Promise<void> {
    await prepareInputDevices();
    microphoneTestActive.value = true;
  }

  function stopMicrophoneTest(): void {
    microphoneTestActive.value = false;
    if (!state.connected) stopMicrophone();
  }

  function playAudioFrame(clientId: number, opusData: Uint8Array): void {
    if (opusData.length < 3) return;
    let decoder = remoteDecoders.get(clientId);
    if (!decoder) {
      const ctx = getAudioCtx();
      const gainNode = ctx.createGain();
      gainNode.gain.value = (volumes[clientId] ?? 1) * outputVolume.value;
      gainNode.connect(ctx.destination);
      remoteGains.set(clientId, gainNode);
      decoder = new AudioDecoder({
        output: (chunk: AudioData) => {
          try {
            const { sampleRate, numberOfChannels, numberOfFrames } = chunk;
            const buffer = ctx.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
            for (let ch = 0; ch < numberOfChannels; ch++) {
              const data = new Float32Array(numberOfFrames);
              chunk.copyTo(data, { planeIndex: ch, format: "f32-planar" });
              buffer.copyToChannel(data, ch);
            }
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode);
            let playTime = remotePlayTimes.get(clientId) ?? ctx.currentTime;
            if (playTime < ctx.currentTime) playTime = ctx.currentTime;
            source.start(playTime);
            remotePlayTimes.set(clientId, playTime + numberOfFrames / sampleRate);
          } catch {
            // A decoder can finish while the audio context is being torn down.
          }
          chunk.close();
        },
        error: () => {
          remoteDecoders.delete(clientId);
        },
      });
      decoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 1 });
      remoteDecoders.set(clientId, decoder);
    }

    try {
      const timestamp = remoteDecodeTimestamps.get(clientId) ?? 0;
      decoder.decode(new EncodedAudioChunk({ type: "key", timestamp, duration: 20_000, data: opusData }));
      remoteDecodeTimestamps.set(clientId, timestamp + 20_000);
    } catch {
      // Ignore malformed frames; the next valid frame can still be decoded.
    }
  }

  function connect(target: string, channel: string, nickname: string, serverPassword = ""): void {
    disconnect();
    const sequence = ++connectionSequence;
    state.error = "";
    state.connecting = true;
    void openTicketedConnection(sequence, target, channel, nickname, serverPassword);
  }

  async function openTicketedConnection(sequence: number, target: string, channel: string, nickname: string, serverPassword: string): Promise<void> {
    try {
      const response = await fetch("/api/join-ticket", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ target, nickname, channel, serverPassword }),
      });
      const result = await response.json().catch(() => ({})) as { ticket?: unknown; code?: unknown };
      if (!response.ok || typeof result.ticket !== "string") {
        throw new Error(joinTicketReason(typeof result.code === "string" ? result.code : ""));
      }
      if (sequence !== connectionSequence) return;
      openVoiceSocket(sequence, result.ticket);
    } catch (error: unknown) {
      if (sequence !== connectionSequence) return;
      state.connecting = false;
      state.error = error instanceof Error ? error.message : "连接服务器失败，请检查邀请链接或服务器状态";
    }
  }

  function openVoiceSocket(sequence: number, ticket: string): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws/voice?ticket=${encodeURIComponent(ticket)}`);
    socket.binaryType = "arraybuffer";
    ws.value = socket;
    socket.onopen = () => {
      if (sequence !== connectionSequence) {
        socket.close(1000);
        return;
      }
      startMicrophone().catch((error: unknown) => {
        state.error = `麦克风访问失败：${error instanceof Error ? error.message : "请检查浏览器权限"}`;
      });
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          handleMessage(JSON.parse(event.data));
        } catch {
          // Ignore malformed control frames.
        }
      } else {
        handleAudioFrame(new Uint8Array(event.data));
      }
    };
    socket.onclose = (event) => {
      if (sequence !== connectionSequence) return;
      state.connected = false;
      state.connecting = false;
      if (event.code !== 1000 && !state.error) state.error = closeReason(event.code);
      stopMicrophone();
    };
    socket.onerror = () => {
      if (sequence !== connectionSequence) return;
      state.error = "连接服务器失败，请检查邀请链接或服务器状态";
    };
  }

  function joinTicketReason(code: string): string {
    if (code === "NOT_INITIALIZED") return "WebSpeak 尚未完成首次配置";
    if (code === "TARGET_NOT_ALLOWED") return "此 TeamSpeak 服务器地址不允许连接";
    if (code === "INVALID_NICKNAME") return "请输入有效的昵称";
    return "连接服务器失败，请检查邀请链接或服务器状态";
  }

  function closeReason(code: number): string {
    if (code === 4002) return "TeamSpeak 服务器地址无效";
    if (code === 4003) return "TeamSpeak 服务器连接失败";
    if (code === 4004) return "服务器当前已满，请稍后重试";
    return "连接已断开";
  }

  function disconnect(): void {
    connectionSequence++;
    stopMicrophone();
    const socket = ws.value;
    ws.value = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000);
    state.connected = false;
    state.connecting = false;
    state.tsClientId = 0;
    members.length = 0;
    channels.length = 0;
    chatMessages.length = 0;
    for (const decoder of remoteDecoders.values()) decoder.close();
    remoteDecoders.clear();
    remotePlayTimes.clear();
    remoteDecodeTimestamps.clear();
    for (const gain of remoteGains.values()) gain.disconnect();
    remoteGains.clear();
    clearSpeakingState();
    for (const key of Object.keys(volumes)) delete volumes[Number(key)];
  }

  function handleMessage(msg: any): void {
    switch (msg.type) {
      case "connected":
        state.connected = true;
        state.connecting = false;
        state.tsClientId = Number(msg.tsClientId) || 0;
        if (Array.isArray(msg.members)) {
          members.length = 0;
          for (const member of msg.members) {
            members.push({ ...member, isSelf: Number(member.id) === state.tsClientId });
          }
        }
        break;
      case "memberEnter":
        if (!members.some((member) => member.id === msg.id)) {
          members.push({ id: msg.id, nickname: msg.nickname, isSelf: Boolean(msg.isSelf) });
        }
        break;
      case "memberLeave": {
        clearSpeaking(Number(msg.id));
        const index = members.findIndex((member) => member.id === msg.id);
        if (index >= 0) members.splice(index, 1);
        break;
      }
      case "channelList":
        channels.length = 0;
        if (Array.isArray(msg.channels)) {
          for (const channel of msg.channels) channels.push(channel);
        }
        break;
      case "chatMessage":
        if (Number(msg.invokerId) === state.tsClientId) break;
        chatMessages.push({
          id: `remote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          invokerName: String(msg.invokerName || "Unknown"),
          message: String(msg.message || ""),
          timestamp: Date.now(),
        });
        break;
      case "channelSwitched":
        break;
      case "disconnected":
        state.connected = false;
        state.connecting = false;
        state.error = "TeamSpeak 连接已断开";
        break;
      case "error":
        state.error = String(msg.message || "操作失败");
        break;
    }
  }

  function handleAudioFrame(data: Uint8Array): void {
    if (data.length < 4) return;
    const clientId = (data[1] << 8) | data[2];
    if (clientId === state.tsClientId) return;
    markSpeaking(clientId);
    playAudioFrame(clientId, data.slice(3));
  }

  function sendCmd(command: Record<string, unknown>): void {
    if (ws.value?.readyState === WebSocket.OPEN) ws.value.send(JSON.stringify(command));
  }

  function switchChannel(channelId: string): void {
    sendCmd({ type: "switchChannel", channelId });
  }

  function sendTextMessage(message: string): void {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) return;
    sendCmd({ type: "sendTextMessage", message: trimmed });
    chatMessages.push({
      id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      invokerName: "你",
      message: trimmed,
      timestamp: Date.now(),
      isSelf: true,
    });
  }

  function setMicMode(mode: "vox" | "ptt"): void {
    micMode.value = mode;
    if (mode === "vox") pttPressed = false;
  }

  function setPTT(pressed: boolean): void {
    pttPressed = pressed;
  }

  function clearError(): void {
    state.error = "";
  }

  function setVolume(clientId: number, volume: number): void {
    const normalized = Math.max(0, Math.min(4, volume));
    volumes[clientId] = normalized;
    const gain = remoteGains.get(clientId);
    if (gain) gain.gain.value = normalized * outputVolume.value;
  }

  function setInputVolume(volume: number): void {
    inputVolume.value = Math.max(0, Math.min(1, volume));
    if (micGain) micGain.gain.value = inputVolume.value;
  }

  function setOutputVolume(volume: number): void {
    outputVolume.value = Math.max(0, Math.min(1, volume));
    for (const [clientId, gain] of remoteGains) gain.gain.value = (volumes[clientId] ?? 1) * outputVolume.value;
  }

  return {
    ws,
    state,
    members,
    channels,
    chatMessages,
    micMode,
    inputVolume,
    outputVolume,
    inputDevices,
    selectedInputDeviceId,
    micLevel,
    microphoneTestActive,
    speakingIds,
    volumes,
    setVolume,
    setInputVolume,
    setOutputVolume,
    prepareInputDevices,
    setInputDevice,
    startMicrophoneTest,
    stopMicrophoneTest,
    connect,
    disconnect,
    switchChannel,
    sendTextMessage,
    setMicMode,
    setPTT,
    checkSupport,
    clearError,
  };
}
