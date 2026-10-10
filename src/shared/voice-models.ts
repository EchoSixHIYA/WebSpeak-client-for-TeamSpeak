/** Browser-safe wire data shared by the gateway and web client. */

export interface ChannelMember {
  id: number;
  nickname: string;
  uid?: string;
  avatar?: string;
  isSelf?: boolean;
  away?: boolean;
  awayMessage?: string;
  inputMuted?: boolean;
  outputMuted?: boolean;
  channelCommander?: boolean;
}

export interface ChannelInfo {
  id: string;
  parentID: string;
  order?: string;
  name: string;
  description?: string;
  /** Maximum clients for this channel, when TeamSpeak reports a finite or unlimited setting. */
  maxClients?: number;
  /** False means the channel has no individual client limit. */
  maxClientsLimited?: boolean;
  members?: ChannelMember[];
}

export interface ChatMessage {
  id: string;
  scope: "channel" | "server" | "private" | "system";
  targetId?: string;
  conversationId?: string;
  /** Browser-local identity scope and display snapshot for private history. */
  conversationKey?: string;
  conversationName?: string;
  senderId?: number;
  senderUid?: string;
  invokerName: string;
  message: string;
  timestamp: number;
  isSelf?: boolean;
  /** Message came from browser-local history rather than the active session. */
  isHistory?: boolean;
}

export interface ServerEvent {
  id: string;
  kind: string;
  message: string;
  timestamp: number;
}

export interface VoiceAudioBridgeStats {
  transport: "webrtc" | "websocket";
  ingressFrames: number;
  ingressDroppedFrames: number;
  ingressMaxGapMs: number;
  tsSendFrames: number;
  tsSendErrors: number;
  tsSendMaxGapMs: number;
  tsReceiveFrames: number;
  tsReceiveMaxGapMs: number;
  egressFrames: number;
  egressDroppedFrames: number;
  egressMaxGapMs: number;
  webrtcIngressRtpFrames: number;
  webrtcIngressRtpMaxGapMs: number;
  webrtcEgressRtpFrames: number;
  webrtcEgressRtpMaxGapMs: number;
  webrtcQueueDroppedFrames: number;
  webrtcQueueUnderrunTicks: number;
  webrtcPacerLateTicks: number;
  webrtcIngressDecodeErrors: number;
  webrtcDownlinkDecodeErrors: number;
}

