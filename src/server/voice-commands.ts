import type { ServerMessage } from "../shared/server-messages.js";
import type { ChannelInfo } from "../shared/voice-models.js";
import type { ClientCommand } from "../shared/client-commands.js";
import type { TSClient } from "./ts-client.js";
import type { WebRtcAudioSession } from "./webrtc-audio.js";
import { snapshotAudioStatus, type AudioStatsSource } from "./audio-stats.js";
import { pingTeamSpeakSession } from "./network-probe.js";
import { teamSpeakServerErrorCode } from "../errors.js";

/** Only the session capabilities used by control commands cross this boundary. */
export interface VoiceCommandContext extends AudioStatsSource {
  tsClient: Pick<TSClient, "execCommandWithResponse" | "switchChannel" | "getClientId" | "getChannelId" | "moveClient" | "sendTextMessage" | "poke" | "setAway" | "setInputMuted" | "setAccompanimentActive">;
  channelTree: ChannelInfo[];
  members: ReadonlyMap<number, { uid?: string }>;
  whisperTargetIds: Set<number>;
  whisperActive: boolean;
  lastLatencyProbeAt: number;
  lastAudioStatsProbeAt: number;
  webrtc: Pick<WebRtcAudioSession, "getStats" | "setMicrophoneMuted" | "setAccompanimentActive" | "setMemberVolume"> | null;
}

export async function handleCommand(
  entry: VoiceCommandContext,
  command: ClientCommand,
  sendJson: (message: ServerMessage) => void,
  clock: () => number = Date.now,
): Promise<void> {
  if (command.type === "latencyProbe") {
    // Keep the control-path probe for already-open older browser clients. The
    // current voice status panel exclusively requests actual audio counters.
    const sequence = command.payload.sequence;
    const now = clock();
    if (now - entry.lastLatencyProbeAt < 150) return;
    entry.lastLatencyProbeAt = now;
    const result = await pingTeamSpeakSession(
      (request, timeoutMs) => entry.tsClient.execCommandWithResponse(request, timeoutMs),
    );
    sendJson({
      type: "latencyPong",
      sequence,
      teamSpeakLatencyMs: result.latencyMs,
      teamSpeakReachable: result.ok,
      teamSpeakErrorCode: result.errorCode ?? null,
    });
    return;
  }

  if (command.type === "audioStatsProbe") {
    const sequence = command.payload.sequence;
    const now = clock();
    if (now - entry.lastAudioStatsProbeAt < 750) return;
    entry.lastAudioStatsProbeAt = now;
    sendJson({
      type: "audioStats",
      sequence,
      stats: snapshotAudioStatus(entry),
    });
    return;
  }

  if (command.type === "switchChannel") {
    const rawId = command.payload.channelId;
    const channelPassword = typeof command.payload.password === "string" ? command.payload.password : "";
    try {
      await entry.tsClient.switchChannel(BigInt(rawId), channelPassword || undefined);
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      if (/already member/i.test(rawMessage)) {
        sendJson({ type: "channelSwitched", requestId: command.requestId, channelId: rawId });
        return;
      }
      const operation = classifyOperationError(error, "CHANNEL_SWITCH_FAILED", "频道切换失败");
      sendJson({ type: "error", requestId: command.requestId, error: { code: operation.code, message: operation.message, recoverable: false } });
      return;
    }
    sendJson({ type: "channelSwitched", requestId: command.requestId, channelId: rawId });
    sendJson({ type: "channelList", channels: entry.channelTree });
    return;
  }

  try {
    if (command.type === "moveClient") {
      const clientId = command.payload.clientId;
      const channelId = command.payload.channelId;
      if (clientId === entry.tsClient.getClientId()) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CANNOT_MOVE_SELF", message: "不能移动自己的客户端", recoverable: false } });
        return;
      }
      if (!entry.members.has(clientId)) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "成员已离线或当前不可见", recoverable: false } });
        return;
      }
      const targetExists = entry.channelTree.some((channel) => channel.id === channelId);
      if (!targetExists) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CHANNEL_NOT_FOUND", message: "目标频道不可用", recoverable: false } });
        return;
      }
      // TeamSpeak evaluates i_client_move_power against the target's
      // i_client_needed_move_power inside clientmove. Do not duplicate that
      // policy in the gateway; forwarding the authoritative command keeps TS3
      // and TS6 permission behavior aligned.
      // Moving another visible client is an administrator operation. It must
      // not prompt for or depend on the target channel's join password.
      await entry.tsClient.moveClient(clientId, BigInt(channelId));
    } else if (command.type === "sendTextMessage") {
      const channelId = entry.tsClient.getChannelId();
      if (command.payload.channelId !== undefined && BigInt(command.payload.channelId) !== channelId) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CHANNEL_CHANGED", message: "所在频道已变化，请确认频道后重试", recoverable: false } });
        return;
      }
      const message = command.payload.message.trim();
      if (message) await entry.tsClient.sendTextMessage("channel", message, channelId);
    } else if (command.type === "sendServerMessage") {
      const message = command.payload.message.trim();
      if (message) await entry.tsClient.sendTextMessage("server", message);
    } else if (command.type === "sendPrivateMessage") {
      const clientId = command.payload.clientId;
      const recipient = entry.members.get(clientId);
      if (!recipient || (command.payload.clientUid !== undefined && recipient.uid !== command.payload.clientUid)) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "成员已离线", recoverable: false } });
        return;
      }
      const message = command.payload.message.trim();
      if (message) await entry.tsClient.sendTextMessage("private", message, BigInt(clientId));
    } else if (command.type === "poke") {
      const clientId = command.payload.clientId;
      if (!entry.members.has(clientId)) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "成员已离线", recoverable: false } });
        return;
      }
      await entry.tsClient.poke(clientId, command.payload.message.trim());
    } else if (command.type === "setAway") {
      await entry.tsClient.setAway(command.payload.away, typeof command.payload.message === "string" ? command.payload.message.trim() : "");
    } else if (command.type === "setWhisperTargets") {
      const targetIds = command.payload.targetIds;
      const selfId = entry.tsClient.getClientId();
      if (targetIds.some((clientId) => clientId === selfId || !entry.members.has(clientId))) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "CLIENT_NOT_FOUND", message: "私语目标已离线", recoverable: false } });
        return;
      }
      entry.whisperTargetIds = new Set(targetIds);
      if (!entry.whisperTargetIds.size) entry.whisperActive = false;
      sendJson({ type: "whisperTargets", targetIds: [...entry.whisperTargetIds], active: entry.whisperActive });
    } else if (command.type === "setWhisperActive") {
      const active = command.payload.active;
      if (active && !entry.whisperTargetIds.size) {
        sendJson({ type: "error", requestId: command.requestId, error: { code: "NO_WHISPER_TARGETS", message: "请先选择私语目标", recoverable: false } });
        return;
      }
      entry.whisperActive = active;
      sendJson({ type: "whisperTargets", targetIds: [...entry.whisperTargetIds], active: entry.whisperActive });
    } else if (command.type === "setMicrophoneMuted") {
      const muted = command.payload.muted;
      await entry.tsClient.setInputMuted(muted);
      entry.webrtc?.setMicrophoneMuted(muted);
    } else if (command.type === "setAccompanimentActive") {
      const peer = entry.webrtc;
      if (peer) {
        await entry.tsClient.setAccompanimentActive(command.payload.active);
        if (entry.webrtc === peer) peer.setAccompanimentActive(command.payload.active);
      }
    } else if (command.type === "setMemberVolume") {
      const clientId = command.payload.clientId;
      entry.webrtc?.setMemberVolume(clientId, command.payload.volume);
    }
    if (command.requestId) sendJson({ type: "commandCompleted", requestId: command.requestId });
  } catch (error: unknown) {
    const operation = classifyOperationError(error, "OPERATION_FAILED", "操作失败");
    sendJson({ type: "error", requestId: command.requestId, error: { code: operation.code, message: operation.message, recoverable: false } });
  }
}

function classifyOperationError(error: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.toLowerCase();
  // A TeamSpeak server error id is authoritative when the SDK preserved it, so it
  // is consulted before the keyword rules: 781 (channel password), 2568
  // (permissions), 515/2817 (server or slot limit) and friends keep their exact
  // meaning instead of being guessed from prose.
  const rawId = isRecord(error) ? (error.id ?? error.code) : undefined;
  const inlineId = /\bid[\s=:]*(\d{3,5})\b/.exec(normalized)?.[1];
  // Operation permissions are distinct from connection/identity failures.
  // Preserve the existing 2568 mapping even when the SDK only exposes an id.
  if (["2568", "0x0a08", "0a08"].includes(String(rawId ?? inlineId).trim().toLowerCase())) {
    return { code: "PERMISSION_DENIED", message: "你没有执行此操作的权限" };
  }
  const serverCode = teamSpeakServerErrorCode(rawId) ?? teamSpeakServerErrorCode(inlineId);
  if (serverCode) {
    if (serverCode === "identity_security_level_too_low") return { code: "PERMISSION_DENIED", message: "你没有执行此操作的权限" };
    if (serverCode === "channel_password_required") return { code: "CHANNEL_PASSWORD_REQUIRED", message: "该频道需要密码" };
    if (serverCode === "server_full") return { code: "CHANNEL_FULL", message: "该频道已满" };
    if (serverCode === "client_version_outdated") return { code: "CLIENT_VERSION_OUTDATED", message: "客户端版本过旧，服务器拒绝了该操作" };
    if (serverCode === "flooding") return { code: "FLOOD_PROTECTION", message: "操作过于频繁，请稍后重试" };
    if (serverCode === "banned") return { code: "BANNED", message: "你已被该服务器封禁" };
    if (serverCode === "connection_initialisation_failed") return { code: "CONNECTION_INITIALISATION_FAILED", message: "TeamSpeak 服务器未能完成连接初始化，请稍后重试" };
  }
  if (/permission|not permitted|insufficient|i_permission|2568/.test(normalized)) return { code: "PERMISSION_DENIED", message: "你没有执行此操作的权限" };
  if (/channel.*(password|password.*required)|invalid.*(channel|password)|i_channel_password|781/.test(normalized)) return { code: "CHANNEL_PASSWORD_REQUIRED", message: "该频道需要密码" };
  if (/already member/.test(normalized)) return { code: "ALREADY_IN_CHANNEL", message: "你已经在该频道中" };
  if (/full|maximum.*clients/.test(normalized)) return { code: "CHANNEL_FULL", message: "该频道已满" };
  if (/not found|unknown client|invalid client/.test(normalized)) return { code: "CLIENT_NOT_FOUND", message: "成员已离线" };
  return { code: fallbackCode, message: fallbackMessage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
