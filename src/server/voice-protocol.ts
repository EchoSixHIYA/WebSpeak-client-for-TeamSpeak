export interface ClientCommand {
  type: "switchChannel" | "sendTextMessage";
  requestId?: string;
  payload: Record<string, unknown>;
}

export type ClientCommandResult = ClientCommand | { error: { code: string; message: string } };

export function parseClientCommand(raw: string): ClientCommandResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: { code: "INVALID_JSON", message: "消息不是有效的 JSON" } };
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return { error: { code: "INVALID_MESSAGE", message: "消息类型不能为空" } };
  }
  if (value.requestId !== undefined && (typeof value.requestId !== "string" || value.requestId.length > 64)) {
    return { error: { code: "INVALID_REQUEST_ID", message: "请求标识无效" } };
  }
  if (value.type !== "switchChannel" && value.type !== "sendTextMessage") {
    return { error: { code: "UNKNOWN_MESSAGE_TYPE", message: "不支持的消息类型" } };
  }
  if (!isRecord(value.payload)) {
    return { error: { code: "INVALID_PAYLOAD", message: "消息参数无效" } };
  }
  if (value.type === "switchChannel" && (typeof value.payload.channelId !== "string" || !/^\d{1,20}$/.test(value.payload.channelId))) {
    return { error: { code: "INVALID_CHANNEL_ID", message: "频道标识无效" } };
  }
  if (value.type === "sendTextMessage" && (typeof value.payload.message !== "string" || value.payload.message.length > 500)) {
    return { error: { code: "INVALID_TEXT_MESSAGE", message: "文字消息无效" } };
  }
  return {
    type: value.type,
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    payload: value.payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
