/**
 * Browser ↔ browser screen-share signaling.
 *
 * Media never passes through this module. The gateway only authenticates the
 * connected TeamSpeak session and relays SDP/ICE messages. The browser peers
 * are deliberately created without STUN/TURN servers; a failed host-candidate
 * connection is reported to the user instead of silently becoming a relay.
 */

export type ScreenSharePeerSignal =
  | {
      kind: "offer" | "answer";
      sdp: string;
    }
  | {
      kind: "iceCandidate";
      candidate: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    }
  | {
      kind: "close";
  };

export interface ScreenShareViewerDescription {
  peerId: string;
  nickname: string;
  avatar?: string;
}

export interface ScreenShareStreamDescription {
  streamId: string;
  source: "browser" | "teamspeak";
  ownerPeerId: string;
  ownerNickname: string;
  name: string;
  audio: boolean;
  createdAt: number;
  viewerCount: number;
  viewers: ScreenShareViewerDescription[];
}

export type ScreenShareClientMessage =
  | {
      type: "screenShareList";
    }
  | {
      type: "screenShareStart";
      requestId?: string;
      name?: string;
      audio?: boolean;
    }
  | {
      type: "screenShareStop";
      requestId?: string;
      streamId: string;
    }
  | {
      type: "screenShareJoin";
      requestId?: string;
      streamId: string;
    }
  | {
      type: "screenShareLeave";
      requestId?: string;
      streamId: string;
    }
  | {
      type: "screenShareSignal";
      streamId: string;
      targetPeerId: string;
      signal: ScreenSharePeerSignal;
    };

export type ScreenShareMessageParseResult =
  | ScreenShareClientMessage
  | { error: { code: string; message: string } };

const MAX_STREAM_ID_LENGTH = 128;
const MAX_PEER_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 120;
const MAX_SDP_LENGTH = 256 * 1024;
const MAX_CANDIDATE_LENGTH = 8 * 1024;

export function parseScreenShareMessage(raw: string): ScreenShareMessageParseResult | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string" || !value.type.startsWith("screenShare")) return null;
  const requestId = parseRequestId(value.requestId);
  if (requestId === false) return invalid("INVALID_SCREEN_SHARE_REQUEST", "屏幕共享请求标识无效");

  switch (value.type) {
    case "screenShareList":
      return { type: "screenShareList" };
    case "screenShareStart": {
      const name = value.name === undefined ? undefined : parseName(value.name);
      if (name === false) return invalid("INVALID_SCREEN_SHARE_NAME", "屏幕共享名称无效");
      if (value.audio !== undefined && typeof value.audio !== "boolean") return invalid("INVALID_SCREEN_SHARE_AUDIO", "共享音频选项无效");
      return {
        type: "screenShareStart",
        ...(requestId ? { requestId } : {}),
        ...(name ? { name } : {}),
        ...(value.audio === true ? { audio: true } : {}),
      };
    }
    case "screenShareStop":
    case "screenShareJoin":
    case "screenShareLeave": {
      const streamId = parseIdentifier(value.streamId, MAX_STREAM_ID_LENGTH);
      if (!streamId) return invalid("INVALID_SCREEN_SHARE_STREAM", "屏幕共享标识无效");
      return {
        type: value.type,
        ...(requestId ? { requestId } : {}),
        streamId,
      };
    }
    case "screenShareSignal": {
      const streamId = parseIdentifier(value.streamId, MAX_STREAM_ID_LENGTH);
      const targetPeerId = parseIdentifier(value.targetPeerId, MAX_PEER_ID_LENGTH);
      const signal = parseSignal(value.signal);
      if (!streamId) return invalid("INVALID_SCREEN_SHARE_STREAM", "屏幕共享标识无效");
      if (!targetPeerId) return invalid("INVALID_SCREEN_SHARE_PEER", "屏幕共享对端无效");
      if (!signal) return invalid("INVALID_SCREEN_SHARE_SIGNAL", "屏幕共享信令无效");
      return { type: "screenShareSignal", streamId, targetPeerId, signal };
    }
    default:
      return invalid("UNKNOWN_SCREEN_SHARE_MESSAGE", "不支持的屏幕共享消息");
  }
}

function parseSignal(value: unknown): ScreenSharePeerSignal | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "close") return { kind: "close" };
  if (value.kind === "offer" || value.kind === "answer") {
    if (typeof value.sdp !== "string" || value.sdp.length === 0 || value.sdp.length > MAX_SDP_LENGTH) return null;
    return { kind: value.kind, sdp: value.sdp };
  }
  if (value.kind !== "iceCandidate" || typeof value.candidate !== "string" || value.candidate.length > MAX_CANDIDATE_LENGTH) return null;
  if (value.sdpMid !== undefined && value.sdpMid !== null && typeof value.sdpMid !== "string") return null;
  const sdpMLineIndex = value.sdpMLineIndex;
  if (sdpMLineIndex !== undefined && sdpMLineIndex !== null && (typeof sdpMLineIndex !== "number" || !Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0 || sdpMLineIndex > 255)) return null;
  return {
    kind: "iceCandidate",
    candidate: value.candidate,
    ...(value.sdpMid === null || typeof value.sdpMid === "string" ? { sdpMid: value.sdpMid } : {}),
    ...(sdpMLineIndex === null || typeof sdpMLineIndex === "number" ? { sdpMLineIndex } : {}),
  };
}

function parseRequestId(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : false;
}

function parseName(value: unknown): string | false {
  if (typeof value !== "string") return false;
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : false;
}

function parseIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  return value;
}

function invalid(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
