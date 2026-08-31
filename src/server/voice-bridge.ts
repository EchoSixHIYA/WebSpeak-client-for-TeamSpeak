import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import { TSClient, type TSDirectorySnapshot, type TSVoiceData } from "./ts-client.js";
import type { Logger as LoggerType } from "../logger.js";

const require = createRequire(import.meta.url);
const { OpusEncoder } = require("@discordjs/opus") as {
  OpusEncoder: new (sampleRate: number, channels: number) => { encode(pcm: Buffer): Buffer };
};

export interface VoiceBridgeOptions {
  tsHost: string;
  tsPort: number;
  tsServerPassword: string;
  tsServerProtocol?: "ts3" | "ts6";
  maxClients: number;
}

interface ChannelMember {
  id: number;
  nickname: string;
}

interface WebClientEntry {
  id: string;
  tsClient: TSClient;
  ws: WebSocket;
  nickname: string;
  tsHost: string;
  tsPort: number;
  channelTree: unknown[];
  members: Map<number, ChannelMember>;
  opusEncoder: { encode(pcm: Buffer): Buffer };
}

export class VoiceBridge {
  // Connecting sessions are tracked immediately so a dropped browser socket
  // cannot leave a half-open TeamSpeak client behind.
  private clients = new Map<string, WebClientEntry>();
  private wss: WebSocketServer | null = null;
  private logger: LoggerType;

  constructor(
    private options: VoiceBridgeOptions,
    logger: LoggerType,
  ) {
    this.logger = logger.child({ component: "voice-bridge" });
  }

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws/voice" });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
      const channelName = url.searchParams.get("channel") ?? undefined;
      const nickname = (url.searchParams.get("nickname") ?? "WebUser").trim().slice(0, 30) || "WebUser";
      const tsHost = normalizeHost(url.searchParams.get("tsHost") ?? this.options.tsHost);
      const parsedPort = Number.parseInt(url.searchParams.get("tsPort") ?? String(this.options.tsPort), 10);
      const tsPort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
        ? parsedPort
        : this.options.tsPort;

      if (!tsHost) {
        this.logger.warn({ nickname }, "Invalid TeamSpeak host");
        ws.close(4002, "Invalid TeamSpeak host");
        return;
      }

      if (this.clients.size >= this.options.maxClients) {
        this.logger.warn({ max: this.options.maxClients }, "Max clients reached");
        ws.close(4004, "Server full");
        return;
      }

      const entryId = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      this.logger.info({ entryId, nickname, channel: channelName, tsHost, tsPort }, "WebClient connecting");

      const tsClient = new TSClient({
        host: tsHost,
        port: tsPort,
        nickname,
        serverPassword: this.options.tsServerPassword,
        serverProtocol: this.options.tsServerProtocol,
        defaultChannel: channelName,
      }, this.logger);

      const entry: WebClientEntry = {
        id: entryId,
        tsClient,
        ws,
        nickname,
        tsHost,
        tsPort,
        channelTree: [],
        members: new Map(),
        opusEncoder: new OpusEncoder(48000, 1),
      };
      this.clients.set(entryId, entry);

      let tsReady = false;
      let selfId = 0;
      let selfChannelId = 0n;
      let directoryReady = false;
      let initialStateSent = false;
      let latestDirectorySnapshot: TSDirectorySnapshot | null = null;
      const sendJson = (message: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      };
      const refreshDirectory = () => {
        if (!latestDirectorySnapshot) return;
        const effectiveSelfId = selfId || tsClient.getClientId();
        const sdkChannelId = tsClient.getChannelId();
        if (selfChannelId === 0n && sdkChannelId !== 0n) selfChannelId = sdkChannelId;
        const normalizedSnapshot = normalizeDirectorySnapshot(latestDirectorySnapshot, effectiveSelfId, selfChannelId, nickname, channelName);
        entry.channelTree = mapChannelTree(normalizedSnapshot);
        entry.members.clear();
        for (const client of normalizedSnapshot.clients) {
          entry.members.set(client.id, { id: client.id, nickname: client.nickname });
        }
      };
      const sendInitialState = () => {
        if (!tsReady || !directoryReady || initialStateSent) return;
        initialStateSent = true;
        sendJson({
          type: "connected",
          tsClientId: selfId,
          members: Array.from(entry.members.values()),
        });
        sendJson({ type: "channelList", channels: entry.channelTree });
      };

      tsClient.on("directorySnapshot", (snapshot: TSDirectorySnapshot) => {
        latestDirectorySnapshot = snapshot;
        directoryReady = true;
        refreshDirectory();
        if (tsReady && !initialStateSent) sendInitialState();
        else if (tsReady) sendJson({ type: "channelList", channels: entry.channelTree });
      });

      // These listeners must be attached before connect(): TeamSpeak emits the
      // initial clientEnter events during the handshake.
      tsClient.on("clientEnter", (info) => {
        const candidateSelfId = tsClient.getClientId();
        if (candidateSelfId > 0 && info.id === candidateSelfId) {
          selfId = candidateSelfId;
          if (info.channelID !== undefined && info.channelID !== 0n) selfChannelId = info.channelID;
          refreshDirectory();
          if (tsReady && directoryReady && initialStateSent) {
            sendJson({ type: "channelList", channels: entry.channelTree });
          }
        }
        entry.members.set(info.id, { id: info.id, nickname: info.nickname });
        if (tsReady) sendJson({ type: "memberEnter", id: info.id, nickname: info.nickname, isSelf: info.id === selfId });
      });

      tsClient.on("clientLeave", (info) => {
        entry.members.delete(info.id);
        if (tsReady) sendJson({ type: "memberLeave", id: info.id });
      });

      tsClient.on("clientMoved", (info) => {
        if (info.id === selfId && info.targetChannelID !== undefined && info.targetChannelID !== 0n) {
          selfChannelId = info.targetChannelID;
          refreshDirectory();
        }
      });

      tsClient.on("voiceData", (data: TSVoiceData) => {
        if (ws.readyState !== WebSocket.OPEN || data.clientId === selfId) return;
        const packet = Buffer.allocUnsafe(3 + data.data.length);
        packet[0] = data.codec;
        packet.writeUInt16BE(data.clientId, 1);
        data.data.copy(packet, 3);
        ws.send(packet);
      });

      tsClient.on("textMessage", (message) => {
        sendJson({
          type: "chatMessage",
          invokerName: message.invokerName,
          invokerId: message.invokerId,
          message: message.message,
        });
      });

      tsClient.on("disconnected", () => {
        if (ws.readyState === WebSocket.OPEN) sendJson({ type: "disconnected" });
        this.cleanup(entryId);
      });

      ws.on("message", (data: Buffer | string) => {
        if (typeof data === "string" || (data.length > 0 && data[0] === 0x7b)) {
          try {
            const command = JSON.parse(typeof data === "string" ? data : data.toString("utf-8"));
            if (command && typeof command.type === "string") {
              if (tsReady && ["switchChannel", "sendTextMessage"].includes(command.type)) {
                handleCommand(entry, command).catch((error: unknown) => {
                  this.logger.error({ err: error instanceof Error ? error.message : String(error) }, "Command failed");
                });
              }
              return;
            }
          } catch {
            // Not JSON; let the binary audio path handle it below.
          }
        }

        // Browser sends exactly 1920 bytes: 960 samples at 48 kHz, one 20 ms frame.
        if (Buffer.isBuffer(data) && tsReady && data.length >= 1920) {
          const pcm = data.length === 1920 ? data : data.subarray(0, 1920);
          try {
            tsClient.sendVoice(entry.opusEncoder.encode(pcm), 4);
          } catch {
            // A frame arriving during shutdown is safe to discard.
          }
        }
      });

      ws.on("close", () => {
        this.logger.info({ entryId }, "WebSocket closed");
        this.cleanup(entryId);
      });

      ws.on("error", (error) => {
        this.logger.error({ err: error, entryId }, "WebSocket error");
        this.cleanup(entryId);
      });

      tsClient.connect()
        .then(() => {
          tsReady = true;
          selfId = tsClient.getClientId();
          const sdkChannelId = tsClient.getChannelId();
          if (sdkChannelId !== 0n) selfChannelId = sdkChannelId;
          refreshDirectory();
          if (selfId > 0 && !entry.members.has(selfId)) {
            entry.members.set(selfId, { id: selfId, nickname });
          }
          sendInitialState();
        })
        .catch((error: Error) => {
          this.logger.error({ err: error, entryId }, "TS connect failed");
          if (ws.readyState === WebSocket.OPEN) ws.close(4003, `Connection failed: ${error.message}`);
          else this.cleanup(entryId);
        });
    });

    this.logger.info("Voice WebSocket endpoint ready at /ws/voice");
  }

  private cleanup(entryId: string): void {
    const entry = this.clients.get(entryId);
    if (!entry) return;
    this.clients.delete(entryId);
    entry.tsClient.disconnect().catch(() => {});
    this.logger.info({ entryId }, "Client cleaned up");
  }

  getActiveCount(): number {
    return this.clients.size;
  }

  shutdown(): void {
    for (const [id, entry] of this.clients) {
      this.clients.delete(id);
      entry.ws.terminate();
      entry.tsClient.disconnect().catch(() => {});
    }
    this.wss?.close();
  }
}

async function handleCommand(entry: WebClientEntry, command: { type: string; [key: string]: unknown }) {
  switch (command.type) {
    case "switchChannel": {
      const rawId = command.channelId;
      if (typeof rawId !== "string" || !/^\d+$/.test(rawId)) {
        if (entry.ws.readyState === WebSocket.OPEN) entry.ws.send(JSON.stringify({ type: "error", message: "无效的频道" }));
        break;
      }
      try {
        await entry.tsClient.switchChannel(BigInt(rawId));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // Double-clicking the current channel is harmless.
        if (!message.includes("already member")) {
          if (entry.ws.readyState === WebSocket.OPEN) entry.ws.send(JSON.stringify({ type: "error", message: `切换失败：${message}` }));
          break;
        }
      }
      if (entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(JSON.stringify({ type: "channelSwitched", channelId: rawId }));
        entry.ws.send(JSON.stringify({ type: "channelList", channels: entry.channelTree }));
      }
      break;
    }
    case "sendTextMessage": {
      if (typeof command.message !== "string") break;
      const message = command.message.trim().slice(0, 500);
      if (message) entry.tsClient.sendTextMessage(message);
      break;
    }
  }
}

function normalizeHost(value: string): string | null {
  const host = value.trim();
  if (!host || host.length > 255 || /[\s/\\]/.test(host)) return null;
  return host;
}

function mapChannelTree(snapshot: TSDirectorySnapshot): unknown[] {
  return snapshot.channels.map((channel) => ({
    id: String(channel.id),
    parentID: String(channel.parentID),
    name: channel.name || "未命名频道",
    description: channel.description || "",
    members: snapshot.clients
      .filter((client) => client.channelID === channel.id)
      .map((client) => ({
        id: client.id,
        nickname: client.nickname || "未知用户",
      })),
  }));
}

function normalizeDirectorySnapshot(
  snapshot: TSDirectorySnapshot,
  selfId: number,
  selfChannelId: bigint,
  nickname: string,
  requestedChannelName?: string,
): TSDirectorySnapshot {
  if (selfId <= 0) return snapshot;

  const clients = snapshot.clients.slice();
  const selfIndex = clients.findIndex((client) => client.id === selfId);
  const snapshotChannelId = selfIndex >= 0 ? clients[selfIndex]!.channelID : 0n;
  const requestedName = requestedChannelName?.trim().toLocaleLowerCase();
  const requestedChannel = requestedName
    ? snapshot.channels.find((channel) => channel.name.trim().toLocaleLowerCase() === requestedName)
    : undefined;
  // TS6 may report channelID=0 for the newly connected normal client even
  // though the server has already placed it. The requested channel is the
  // authoritative fallback; an empty request means the first welcome channel,
  // which is the server's default channel in the normal client snapshot.
  const resolvedChannelId = selfChannelId !== 0n
    ? selfChannelId
    : snapshotChannelId !== 0n
      ? snapshotChannelId
      : requestedChannel?.id ?? snapshot.channels[0]?.id ?? 0n;
  if (selfIndex >= 0) {
    const current = clients[selfIndex]!;
    if (resolvedChannelId !== 0n) clients[selfIndex] = { ...current, channelID: resolvedChannelId };
  } else if (resolvedChannelId !== 0n) {
    clients.push({
      id: selfId,
      nickname,
      uid: "",
      channelID: resolvedChannelId,
      type: 1,
      serverGroups: [],
    });
  }

  return { ...snapshot, clients };
}
