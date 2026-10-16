import { randomUUID } from "node:crypto";
import type { Logger } from "../logger.js";
import type { TSClient, TSRawNotification } from "./ts-client.js";
import { formatTeamSpeakTarget, teamSpeakTargetKey, type TeamSpeakTarget } from "../domain/teamspeak-target.js";
import type { ServerMessage } from "../shared/server-messages.js";
import type { ChannelInfo } from "../shared/voice-models.js";
import type { ScreenShareClientMessage, ScreenSharePeerSignal, ScreenShareStreamDescription, ScreenShareViewerDescription } from "../shared/screen-share.js";

export interface ScreenShareParticipant {
  id: string;
  screenPeerId: string;
  nickname: string;
  target: TeamSpeakTarget;
  members: ReadonlyMap<number, { avatar?: string }>;
  channelTree: ChannelInfo[];
  tsClient: Pick<TSClient, "getClientId" | "getChannelId" | "isConnected" | "sendProtocolCommand">;
}

interface ScreenStreamRecord extends ScreenShareStreamDescription {
  targetKey: string;
  channelId: bigint;
  ownerEntryId: string;
  viewerEntryIds: Map<string, symbol>;
  sourceClientId?: number;
  /** The gateway TS client that publishes a browser-owned stream to TS6. */
  teamSpeakPublisherEntryId?: string;
  /** The TS6 stream id paired with a browser-owned WebSpeak stream. */
  teamSpeakStreamId?: string;
  /** Native TS6 viewer client ids paired with a browser-owned stream. */
  nativeViewerClids: Set<number>;
}

// Stream ids are scoped to a TeamSpeak server. Keep the target in the key so
// two unrelated servers cannot overwrite each other's native stream record.
function screenStreamKey(targetKey: string, streamId: string): string {
  return `${targetKey}\u0000${streamId}`;
}

/** Coordinates channel-scoped browser/native sharing; media stays peer-to-peer. */
export class ScreenShareCoordinator {
  private readonly screenStreams = new Map<string, ScreenStreamRecord>();
  private readonly discoveries = new Map<string, {
    pendingEntry: ScreenShareParticipant | undefined;
    completion: Promise<void>;
  }>();

  constructor(
    private readonly entries: ReadonlyMap<string, ScreenShareParticipant>,
    private readonly sendToEntry: (entryId: string, message: ServerMessage) => void,
    private readonly logger: Pick<Logger, "debug" | "warn">,
  ) {}

  handleMessage(
    entry: ScreenShareParticipant,
    message: ScreenShareClientMessage,
    sendJson: (message: ServerMessage) => void,
  ): void {
    if (message.type === "screenShareList") {
      sendJson({ type: "screenShareList", streams: this.listScreenStreamsFor(entry) });
      return;
    }

    if (message.type === "screenShareStart") {
      if ([...this.screenStreams.values()].some((stream) => stream.source === "browser" && stream.ownerEntryId === entry.id)) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_ALREADY_ACTIVE", message: "你已经在共享屏幕" });
        return;
      }
      const stream: ScreenStreamRecord = {
        streamId: `screen-${randomUUID()}`,
        source: "browser",
        ownerPeerId: entry.screenPeerId,
        ownerClientId: entry.tsClient.getClientId() || undefined,
        ownerNickname: entry.nickname,
        name: message.name?.trim() || `${entry.nickname} 的屏幕`,
        audio: message.audio === true,
        createdAt: Date.now(),
        viewerCount: 0,
        viewers: [],
        targetKey: teamSpeakTargetKey(entry.target),
        channelId: entry.tsClient.getChannelId(),
        ownerEntryId: entry.id,
        viewerEntryIds: new Map(),
        teamSpeakPublisherEntryId: entry.id,
        nativeViewerClids: new Set(),
      };
      this.screenStreams.set(screenStreamKey(stream.targetKey, stream.streamId), stream);
      sendJson({ type: "screenShareStarted", requestId: message.requestId, stream: this.describeScreenStream(stream), owner: true });
      this.broadcastScreenMessage(stream, {
        type: "screenShareStarted",
        stream: this.describeScreenStream(stream),
        owner: false,
      }, entry.id);
      void this.publishBrowserScreenStream(entry, stream);
      return;
    }

    const stream = this.screenStreams.get(screenStreamKey(teamSpeakTargetKey(entry.target), message.streamId));
    if (!stream) {
      sendJson({ type: "screenShareError", requestId: "requestId" in message ? message.requestId : undefined, code: "SCREEN_SHARE_NOT_FOUND", message: "屏幕共享已结束或不存在" });
      return;
    }
    if (stream.targetKey !== teamSpeakTargetKey(entry.target) || stream.channelId !== entry.tsClient.getChannelId()) {
      sendJson({ type: "screenShareError", requestId: "requestId" in message ? message.requestId : undefined, code: "SCREEN_SHARE_TARGET_MISMATCH", message: "屏幕共享不属于当前服务器或频道" });
      return;
    }

    if (message.type === "screenShareStop") {
      if (stream.ownerEntryId !== entry.id) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_NOT_OWNER", message: "只有共享者可以结束共享" });
        return;
      }
      this.stopScreenStream(stream, "owner-stopped");
      if (message.requestId) sendJson({ type: "screenShareCompleted", requestId: message.requestId });
      return;
    }

    if (message.type === "screenShareJoin") {
      if (stream.ownerEntryId === entry.id) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_OWNER_CANNOT_JOIN", message: "共享者不能作为观看者加入自己的共享" });
        return;
      }
      const alreadyJoined = stream.viewerEntryIds.has(entry.id);
      if (!alreadyJoined) stream.viewerEntryIds.set(entry.id, Symbol("screen-membership"));
      stream.viewerCount = this.screenShareViewerCount(stream);
      sendJson({
        type: "screenShareJoined",
        requestId: message.requestId,
        stream: this.describeScreenStream(stream),
        ownerPeerId: stream.ownerPeerId,
        mode: stream.source,
      });
      if (stream.source === "browser" && !alreadyJoined) {
        this.sendToEntry(stream.ownerEntryId, {
          type: "screenShareViewerJoined",
          streamId: stream.streamId,
          viewerPeerId: entry.screenPeerId,
          viewerNickname: entry.nickname,
        });
      } else if (stream.source === "teamspeak" && !alreadyJoined) {
        void this.joinNativeScreenStream(entry, stream, sendJson, message.requestId);
      }
      if (!alreadyJoined) {
        this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      }
      return;
    }

    if (message.type === "screenShareLeave") {
      this.leaveScreenStream(entry, stream);
      if (message.requestId) sendJson({ type: "screenShareCompleted", requestId: message.requestId });
      return;
    }

    if (message.type === "screenShareSignal") {
      this.relayScreenShareSignal(entry, stream, message.targetPeerId, message.signal, sendJson);
    }
  }

  private listScreenStreamsFor(entry: ScreenShareParticipant): ScreenShareStreamDescription[] {
    const targetKey = teamSpeakTargetKey(entry.target);
    return [...this.screenStreams.values()]
      .filter((stream) => stream.targetKey === targetKey && stream.channelId === entry.tsClient.getChannelId())
      .map((stream) => this.describeScreenStream(stream));
  }

  /**
   * A gateway session can connect after a native TeamSpeak stream has already
   * started. TS6 does not replay that stream in the normal welcome snapshot;
   * requeststreaminfo is the official client-protocol query for this case.
   * Rescan on each connection. Concurrent requests for the same server share
   * one running pass and one pending pass using the latest session directory.
   */
  discoverExistingStreams(entry: ScreenShareParticipant): Promise<void> {
    const targetKey = teamSpeakTargetKey(entry.target);
    const active = this.discoveries.get(targetKey);
    if (active) {
      active.pendingEntry = entry;
      return active.completion;
    }
    const discovery = {
      pendingEntry: entry as ScreenShareParticipant | undefined,
      completion: Promise.resolve(),
    };
    discovery.completion = Promise.resolve().then(async () => {
      try {
        while (discovery.pendingEntry) {
          const requestedEntry = discovery.pendingEntry;
          discovery.pendingEntry = undefined;
          const queryEntry = this.entries.get(requestedEntry.id) === requestedEntry && requestedEntry.tsClient.isConnected()
            ? requestedEntry
            : [...this.entries.values()].find(candidate => teamSpeakTargetKey(candidate.target) === targetKey && candidate.tsClient.isConnected());
          if (!queryEntry) continue;
          const clientIds = [...queryEntry.members.keys()].filter(clientId => Number.isInteger(clientId) && clientId > 0);
          for (const clientId of clientIds) {
            if (this.entries.get(queryEntry.id) !== queryEntry || !queryEntry.tsClient.isConnected()) break;
            try {
              await queryEntry.tsClient.sendProtocolCommand(`requeststreaminfo clid=${clientId}`);
            } catch (error: unknown) {
              this.logger.debug({
                target: formatTeamSpeakTarget(queryEntry.target),
                clientId,
                err: error instanceof Error ? error.message : String(error),
              }, "Could not query existing TeamSpeak screen stream");
            }
          }
        }
      } finally {
        this.discoveries.delete(targetKey);
      }
    });
    this.discoveries.set(targetKey, discovery);
    return discovery.completion;
  }

  private describeScreenStream(stream: ScreenStreamRecord): ScreenShareStreamDescription {
    return {
      streamId: stream.streamId,
      source: stream.source,
      ownerPeerId: stream.ownerPeerId,
      ...(typeof stream.ownerClientId === "number" ? { ownerClientId: stream.ownerClientId } : {}),
      ownerNickname: stream.ownerNickname,
      name: stream.name,
      audio: stream.audio,
      createdAt: stream.createdAt,
      viewerCount: stream.viewerCount,
      viewers: this.describeScreenViewers(stream),
    };
  }

  private describeScreenViewers(stream: ScreenStreamRecord): ScreenShareViewerDescription[] {
    return [...stream.viewerEntryIds.keys()]
      .map((entryId) => this.entries.get(entryId))
      .filter((entry): entry is ScreenShareParticipant => Boolean(entry))
      .slice(0, 64)
      .map((entry) => {
        // Send the client id, not the avatar: receivers already hold member
        // avatars from the directory, and this roster is rebroadcast to the
        // whole channel on every join and leave. Inlining avatars here scales
        // with (viewers x avatar size x channel members) per event.
        let clientId: number | undefined;
        try {
          clientId = entry.tsClient.getClientId();
        } catch {
          clientId = undefined;
        }
        return {
          peerId: entry.screenPeerId,
          nickname: entry.nickname,
          ...(typeof clientId === "number" && clientId > 0 ? { clientId } : {}),
        };
      });
  }

  private screenShareViewerCountMessage(stream: ScreenStreamRecord): ServerMessage {
    return {
      type: "screenShareViewerCount",
      streamId: stream.streamId,
      viewerCount: stream.viewerCount,
      viewers: this.describeScreenViewers(stream),
    };
  }

  private screenShareViewerCount(stream: ScreenStreamRecord): number {
    return stream.viewerEntryIds.size + stream.nativeViewerClids.size;
  }

  private broadcastScreenMessage(stream: ScreenStreamRecord, message: ServerMessage, excludeEntryId?: string): void {
    for (const candidate of this.entries.values()) {
      if (candidate.id === excludeEntryId || candidate.target && teamSpeakTargetKey(candidate.target) !== stream.targetKey) continue;
      // A stream is scoped to the source channel. Do not leak its card or
      // viewer roster to users who are connected to another channel on the
      // same TeamSpeak target.
      if (candidate.id !== stream.ownerEntryId) {
        try {
          if (candidate.tsClient.getChannelId() !== stream.channelId) continue;
        } catch {
          continue;
        }
      }
      this.sendToEntry(candidate.id, message);
    }
  }

  private stopScreenStream(stream: ScreenStreamRecord, reason: string): void {
    if (!this.screenStreams.delete(screenStreamKey(stream.targetKey, stream.streamId))) return;
    if (stream.source === "browser" && stream.teamSpeakStreamId && stream.teamSpeakPublisherEntryId) {
      const publisher = this.entries.get(stream.teamSpeakPublisherEntryId);
      if (publisher) {
        void publisher.tsClient.sendProtocolCommand(buildTeamSpeakCommand("stopstream", {
          id: stream.teamSpeakStreamId,
          reason: "1",
        })).catch((error: unknown) => {
          this.logger.warn({ streamId: stream.teamSpeakStreamId, err: error instanceof Error ? error.message : String(error) }, "Could not stop native screen publication");
        });
      }
    }
    const message: ServerMessage = { type: "screenShareStopped", streamId: stream.streamId, reason };
    this.broadcastScreenMessage(stream, message);
    stream.viewerEntryIds.clear();
    stream.nativeViewerClids.clear();
    stream.viewerCount = 0;
  }

  private leaveScreenStream(entry: ScreenShareParticipant, stream: ScreenStreamRecord): void {
    if (!stream.viewerEntryIds.delete(entry.id)) return;
    stream.viewerCount = this.screenShareViewerCount(stream);
    if (stream.source === "browser") this.sendToEntry(stream.ownerEntryId, { type: "screenShareViewerLeft", streamId: stream.streamId, viewerPeerId: entry.screenPeerId });
    else {
      void entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("removeclientfromstream", {
        id: stream.streamId,
        clid: String(entry.tsClient.getClientId()),
        reason: "1",
      })).catch(() => undefined);
    }
    this.sendToEntry(entry.id, { type: "screenShareLeft", streamId: stream.streamId });
    this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
  }

  private relayScreenShareSignal(
    entry: ScreenShareParticipant,
    stream: ScreenStreamRecord,
    targetPeerId: string,
    signal: ScreenSharePeerSignal,
    sendJson: (message: ServerMessage) => void,
  ): void {
    if (stream.source === "teamspeak") {
      if (!stream.viewerEntryIds.has(entry.id) || targetPeerId !== stream.ownerPeerId) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FORBIDDEN", message: "无权发送该屏幕共享信令" });
        return;
      }
      const sourceClientId = stream.sourceClientId;
      if (!sourceClientId) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SOURCE_UNAVAILABLE", message: "共享来源暂不可用" });
        return;
      }
      if (signal.kind === "close") {
        this.leaveScreenStream(entry, stream);
        return;
      }
      if (signal.kind === "offer") {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_INVALID_SIGNAL", message: "观看端不能向 TeamSpeak 来源发送 offer" });
        return;
      }
      const payload = signal.kind === "iceCandidate"
        ? { cmd: "iceCandidate", args: { sdp: signal.candidate, ...(signal.sdpMid !== undefined ? { mid: signal.sdpMid } : {}), ...(signal.sdpMLineIndex !== undefined ? { mLine: signal.sdpMLineIndex } : {}) } }
        : { cmd: "answer", args: { answer: signal.sdp } };
      void entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("streamsignaling", {
        id: stream.streamId,
        clid: String(sourceClientId),
        json: JSON.stringify(payload),
      })).catch((error: unknown) => {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FAILED", message: error instanceof Error ? error.message : "屏幕共享信令发送失败" });
      });
      return;
    }

    if (stream.source === "browser" && entry.id === stream.ownerEntryId && targetPeerId.startsWith("ts-viewer-")) {
      const viewerClid = parseNativeViewerPeerId(targetPeerId);
      const publisher = stream.teamSpeakPublisherEntryId ? this.entries.get(stream.teamSpeakPublisherEntryId) : undefined;
      if (!viewerClid || !publisher || !stream.teamSpeakStreamId || !stream.nativeViewerClids.has(viewerClid)) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_PEER_NOT_FOUND", message: "TeamSpeak 观看者已离开" });
        return;
      }
      if (signal.kind === "close") {
        void publisher.tsClient.sendProtocolCommand(buildTeamSpeakCommand("removeclientfromstream", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
          reason: "1",
        })).then(() => {
          if (this.entries.get(entry.id) !== entry
            || this.screenStreams.get(screenStreamKey(stream.targetKey, stream.streamId)) !== stream
            || !stream.nativeViewerClids.delete(viewerClid)) return;
          // The native notification may already have removed this viewer.
          stream.viewerCount = this.screenShareViewerCount(stream);
          this.sendToEntry(entry.id, { type: "screenShareViewerLeft", streamId: stream.streamId, viewerPeerId: targetPeerId });
          this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
        }).catch((error: unknown) => {
          if (this.entries.get(entry.id) !== entry
            || this.screenStreams.get(screenStreamKey(stream.targetKey, stream.streamId)) !== stream) return;
          sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FAILED", message: error instanceof Error ? error.message : "无法移除 TeamSpeak 观看者" });
        });
        return;
      }
      if (signal.kind === "answer") {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_INVALID_SIGNAL", message: "TeamSpeak 观看端不能先发送 answer" });
        return;
      }
      let command: string;
      if (signal.kind === "offer") {
        command = buildTeamSpeakCommand("respondjoinstreamrequest", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
          msg: "",
          offer: signal.sdp,
          decision: "1",
        });
      } else if (signal.kind === "iceCandidate") {
        command = buildTeamSpeakCommand("streamsignaling", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
          json: JSON.stringify({ cmd: "iceCandidate", args: { sdp: signal.candidate, ...(signal.sdpMid !== undefined ? { mid: signal.sdpMid } : {}), ...(signal.sdpMLineIndex !== undefined ? { mLine: signal.sdpMLineIndex } : {}) } }),
        });
      } else {
        return;
      }
      void publisher.tsClient.sendProtocolCommand(command).catch((error: unknown) => {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FAILED", message: error instanceof Error ? error.message : "屏幕共享信令发送失败" });
      });
      return;
    }

    const owner = this.entries.get(stream.ownerEntryId);
    const isOwner = entry.id === stream.ownerEntryId;
    const isViewer = stream.viewerEntryIds.has(entry.id);
    if (!owner || (!isOwner && !isViewer)) {
      sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FORBIDDEN", message: "无权发送该屏幕共享信令" });
      return;
    }
    // Keep the browser P2P graph bipartite: the owner may signal only an
    // active viewer, and a viewer may signal only the owner. Without this
    // check one viewer could inject SDP/ICE into another viewer's peer.
    const targetEntry = isOwner
      ? [...stream.viewerEntryIds.keys()]
        .map((id) => this.entries.get(id))
        .find((candidate) => candidate?.screenPeerId === targetPeerId)
      : targetPeerId === owner.screenPeerId ? owner : undefined;
    if (!targetEntry || targetEntry.id === entry.id) {
      sendJson({ type: "screenShareError", code: "SCREEN_SHARE_PEER_NOT_FOUND", message: "观看者已离开" });
      return;
    }
    this.sendToEntry(targetEntry.id, { type: "screenShareSignal", streamId: stream.streamId, fromPeerId: entry.screenPeerId, signal });
  }

  private async publishBrowserScreenStream(entry: ScreenShareParticipant, stream: ScreenStreamRecord): Promise<void> {
    try {
      await entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("setupstream", {
        name: stream.name,
        type: "3",
        bitrate: "4608",
        accessibility: "1",
        mode: "1",
        viewer_limit: "0",
        audio: stream.audio ? "1" : "0",
      }));
    } catch (error: unknown) {
      this.logger.warn({
        target: formatTeamSpeakTarget(entry.target),
        streamId: stream.streamId,
        err: error instanceof Error ? error.message : String(error),
      }, "Could not publish browser screen share to TeamSpeak");
    }
  }

  private async joinNativeScreenStream(
    entry: ScreenShareParticipant,
    stream: ScreenStreamRecord,
    sendJson: (message: ServerMessage) => void,
    requestId?: string,
  ): Promise<void> {
    const membership = stream.viewerEntryIds.get(entry.id);
    const sourceClientId = stream.sourceClientId;
    if (!entry.tsClient.getClientId() || !sourceClientId) {
      sendJson({ type: "screenShareError", requestId, code: "SCREEN_SHARE_SOURCE_UNAVAILABLE", message: "共享来源暂不可用" });
      return;
    }
    try {
      await entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("joinstreamrequest", {
        id: stream.streamId,
        // TS6 uses the source client id on joinstreamrequest. The requesting
        // gateway session is identified later by the response/signaling
        // notification delivered to this TS connection.
        clid: String(sourceClientId),
        msg: "",
        is_remove: "0",
        muted: "0",
        volume: "0",
        hidden: "0",
      }));
    } catch (error: unknown) {
      if (this.entries.get(entry.id) !== entry
        || this.screenStreams.get(screenStreamKey(stream.targetKey, stream.streamId)) !== stream
        || stream.viewerEntryIds.get(entry.id) !== membership) return;
      this.leaveScreenStream(entry, stream);
      sendJson({ type: "screenShareError", requestId, code: "SCREEN_SHARE_JOIN_FAILED", message: error instanceof Error ? error.message : "无法加入屏幕共享" });
    }
  }

  removePeer(entryId: string): void {
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.ownerEntryId === entryId) {
        this.stopScreenStream(stream, "owner-disconnected");
        continue;
      }
      const entry = this.entries.get(entryId);
      if (entry && stream.viewerEntryIds.has(entryId)) this.leaveScreenStream(entry, stream);
    }
    const departing = this.entries.get(entryId);
    if (!departing) return;
    const targetKey = teamSpeakTargetKey(departing.target);
    if (![...this.entries.values()].some(entry => entry.id !== entryId && teamSpeakTargetKey(entry.target) === targetKey)) {
      // Native notifications are not observed while no session is attached.
      // Rediscover on the next connection instead of retaining stale cards.
      for (const stream of [...this.screenStreams.values()]) {
        if (stream.targetKey === targetKey) this.stopScreenStream(stream, "target-disconnected");
      }
    }
  }

  onClientMove(entry: ScreenShareParticipant, movedClientId: number, targetChannelId: bigint): void {
    const targetKey = teamSpeakTargetKey(entry.target);
    const selfMoved = movedClientId === entry.tsClient.getClientId();
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.targetKey !== targetKey) continue;
      // A browser share belongs to the gateway user's current channel. Stop
      // it when that user moves so existing viewers cannot keep a cross-
      // channel peer alive.
      if (selfMoved && stream.source === "browser" && stream.ownerEntryId === entry.id && stream.channelId !== targetChannelId) {
        this.stopScreenStream(stream, "owner-moved-channel");
        continue;
      }
      // Native TS6 shares are channel-scoped as well. The notification is
      // observed by every gateway session, so stop the shared record once the
      // native source changes channels.
      if (stream.source === "teamspeak" && stream.sourceClientId === movedClientId && stream.channelId !== targetChannelId) {
        this.stopScreenStream(stream, "source-moved-channel");
        continue;
      }
      if (selfMoved && stream.viewerEntryIds.has(entry.id) && stream.channelId !== targetChannelId) {
        this.leaveScreenStream(entry, stream);
      }
    }
  }

  onClientLeave(entry: ScreenShareParticipant, clientId: number): void {
    const targetKey = teamSpeakTargetKey(entry.target);
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.targetKey === targetKey && stream.source === "teamspeak" && stream.sourceClientId === clientId) {
        this.stopScreenStream(stream, "source-left");
      }
    }
  }

  handleNotification(entry: ScreenShareParticipant, notification: TSRawNotification): void {
    if (this.entries.get(entry.id) !== entry) return;
    const params = notification.params;
    if (notification.name === "notifyjoinstreamrequest") {
      const streamId = params.id || params.stream_id;
      const viewerClientId = parseNumber(params.clid);
      if (!streamId || !viewerClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakPublisherEntryId === entry.id
        && candidate.teamSpeakStreamId === streamId);
      if (!stream) return;
      stream.nativeViewerClids.add(viewerClientId);
      stream.viewerCount = this.screenShareViewerCount(stream);
      this.sendToEntry(stream.ownerEntryId, {
        type: "screenShareNativeViewerJoined",
        streamId: stream.streamId,
        viewerPeerId: nativeViewerPeerId(viewerClientId),
        viewerClientId,
      });
      this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      return;
    }
    if (notification.name === "notifystreamstarted" || notification.name === "notifystreaminfo") {
      const streamId = params.id || params.stream_id;
      const sourceClientId = parseNumber(params.clid);
      if (!streamId || !sourceClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const publisherEntry = [...this.entries.values()].find((candidate) => candidate.target
        && teamSpeakTargetKey(candidate.target) === targetKey
        && candidate.tsClient.getClientId() === sourceClientId);
      const browserStream = publisherEntry
        ? [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
          && candidate.source === "browser"
          && candidate.teamSpeakPublisherEntryId === publisherEntry.id
          && (!candidate.teamSpeakStreamId || candidate.teamSpeakStreamId === streamId))
        : undefined;
      if (browserStream) {
        browserStream.teamSpeakStreamId = streamId;
        return;
      }
      if (publisherEntry) {
        // A delayed setup acknowledgement can arrive after the browser stopped.
        // A gateway-owned publication is never a second native source.
        void publisherEntry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("stopstream", { id: streamId, reason: "1" })).catch(() => undefined);
        return;
      }
      // Prefer the observer's directory; another connection can still be
      // processing an older snapshot of the same source.
      const sourceChannel = [entry, ...this.entries.values()]
        .filter(candidate => teamSpeakTargetKey(candidate.target) === targetKey && candidate.tsClient.isConnected())
        .map(candidate => candidate.channelTree.find(channel => channel.id !== "0" && channel.members?.some(member => member.id === sourceClientId)))
        .find(channel => channel !== undefined);
      // Do not guess a channel from the observer, or from a colliding client id
      // on another server. Discovery will retry after the directory is ready.
      if (!sourceChannel) return;
      const key = screenStreamKey(targetKey, streamId);
      let current = this.screenStreams.get(key);
      if (current && current.channelId !== BigInt(sourceChannel.id)) {
        // Retire the old channel's card and memberships before announcing the
        // corrected source. Never carry viewers across a channel boundary.
        for (const viewerId of current.viewerEntryIds.keys()) {
          const viewer = this.entries.get(viewerId);
          if (viewer) this.leaveScreenStream(viewer, current);
        }
        this.stopScreenStream(current, "source-moved-channel");
        current = undefined;
      }
      const stream: ScreenStreamRecord = current ?? {
        streamId,
        source: "teamspeak",
        ownerPeerId: `ts-${sourceClientId}`,
        ownerClientId: sourceClientId,
        ownerNickname: params.name || `TeamSpeak 用户 ${sourceClientId}`,
        name: params.name || "TeamSpeak 屏幕共享",
        audio: params.audio === "1",
        createdAt: Date.now(),
        viewerCount: 0,
        viewers: [],
        targetKey,
        channelId: BigInt(sourceChannel.id),
        ownerEntryId: "",
        viewerEntryIds: new Map(),
        nativeViewerClids: new Set(),
        sourceClientId,
      };
      stream.sourceClientId = sourceClientId;
      stream.ownerNickname = params.name || stream.ownerNickname;
      stream.name = params.name || stream.name;
      stream.audio = params.audio === "1";
      this.screenStreams.set(key, stream);
      // Every gateway session attached to the same TS target sees the same
      // raw notification. Only the first one should announce a new stream to
      // browsers; otherwise each connected user receives duplicate cards.
      if (!current) {
        this.broadcastScreenMessage(stream, { type: "screenShareStarted", stream: this.describeScreenStream(stream), owner: false });
      }
      return;
    }
    if (notification.name === "notifystreamstopped") {
      const streamId = params.id || params.stream_id;
      if (!streamId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = this.screenStreams.get(screenStreamKey(targetKey, streamId));
      if (stream) {
        this.stopScreenStream(stream, "source-stopped");
        return;
      }
      const browserStream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakStreamId === streamId);
      if (browserStream) {
        browserStream.teamSpeakStreamId = undefined;
        browserStream.nativeViewerClids.clear();
        browserStream.viewerCount = this.screenShareViewerCount(browserStream);
        this.sendToEntry(browserStream.ownerEntryId, {
          type: "screenShareError",
          code: "SCREEN_SHARE_NATIVE_PUBLISHER_STOPPED",
          message: "TeamSpeak 客户端屏幕共享通道已停止，网页共享仍可继续",
        });
        this.broadcastScreenMessage(browserStream, this.screenShareViewerCountMessage(browserStream));
      }
      return;
    }
    if (notification.name === "notifystreamclientleft") {
      const streamId = params.id || params.stream_id;
      const viewerClientId = parseNumber(params.clid);
      if (!streamId || !viewerClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakStreamId === streamId
        && candidate.nativeViewerClids.has(viewerClientId));
      if (!stream) return;
      stream.nativeViewerClids.delete(viewerClientId);
      stream.viewerCount = this.screenShareViewerCount(stream);
      this.sendToEntry(stream.ownerEntryId, {
        type: "screenShareViewerLeft",
        streamId: stream.streamId,
        viewerPeerId: nativeViewerPeerId(viewerClientId),
      });
      this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      return;
    }
    if (notification.name === "notifyrespondjoinstreamrequest" || notification.name === "notifystreamsignaling") {
      const streamId = params.id || params.stream_id;
      if (!streamId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const browserStream = notification.name === "notifystreamsignaling"
        ? [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
          && candidate.source === "browser"
          && candidate.teamSpeakPublisherEntryId === entry.id
          && candidate.teamSpeakStreamId === streamId)
        : undefined;
      if (browserStream) {
        const viewerClientId = parseNumber(params.clid);
        if (!viewerClientId || !browserStream.nativeViewerClids.has(viewerClientId)) return;
        const payload = parseStreamSignalPayload(params.json || params.data || "");
        if (!payload) return;
        const signal = toBrowserScreenSignal(payload);
        if (!signal) return;
        this.sendToEntry(browserStream.ownerEntryId, {
          type: "screenShareSignal",
          streamId: browserStream.streamId,
          fromPeerId: nativeViewerPeerId(viewerClientId),
          signal,
        });
        return;
      }
      const stream = this.screenStreams.get(screenStreamKey(targetKey, streamId));
      if (!stream || stream.source !== "teamspeak" || !stream.viewerEntryIds.has(entry.id)) return;
      const payload = notification.name === "notifyrespondjoinstreamrequest"
        ? { cmd: "offer", args: { offer: params.offer || "" } }
        : parseStreamSignalPayload(params.json || params.data || "");
      if (!payload) return;
      const signal = toBrowserScreenSignal(payload);
      if (!signal) return;
      this.sendToEntry(entry.id, { type: "screenShareSignal", streamId, fromPeerId: stream.ownerPeerId, signal });
    }
  }

}

function parseNumber(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nativeViewerPeerId(clientId: number): string {
  return `ts-viewer-${clientId}`;
}

function parseNativeViewerPeerId(peerId: string): number | undefined {
  const match = /^ts-viewer-(\d+)$/.exec(peerId);
  if (!match) return undefined;
  return parseNumber(match[1]);
}

function buildTeamSpeakCommand(command: string, params: Record<string, string>): string {
  return [command, ...Object.entries(params).map(([key, value]) => `${key}=${escapeTeamSpeakValue(value)}`)].join(" ");
}

function parseStreamSignalPayload(raw: string): { cmd: string; args: Record<string, unknown> } | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.cmd !== "string" || !isRecord(value.args)) return null;
    return { cmd: value.cmd, args: value.args };
  } catch {
    return null;
  }
}

function toBrowserScreenSignal(payload: { cmd: string; args: Record<string, unknown> }): ScreenSharePeerSignal | null {
  const args = payload.args;
  // TeamSpeak's native screen-share source wraps the initial SDP in a
  // `joinResponse` message after it accepts a viewer's join request. The
  // browser-side protocol uses the regular offer shape, so normalize it here
  // before forwarding it. Without this mapping the native source can accept a
  // viewer while the browser waits forever for its first SDP.
  if (payload.cmd === "joinResponse") {
    const decision = args.decision;
    if (decision === false || decision === 0 || decision === "0") return { kind: "close" };
    const sdp = typeof args.offer === "string" ? args.offer : typeof args.sdp === "string" ? args.sdp : "";
    return sdp ? { kind: "offer", sdp } : null;
  }
  if (payload.cmd === "offer" || payload.cmd === "reconnectOffer") {
    const sdp = typeof args.offer === "string" ? args.offer : typeof args.sdp === "string" ? args.sdp : "";
    return sdp ? { kind: "offer", sdp } : null;
  }
  if (payload.cmd === "answer") {
    const sdp = typeof args.answer === "string" ? args.answer : typeof args.sdp === "string" ? args.sdp : "";
    return sdp ? { kind: "answer", sdp } : null;
  }
  if (payload.cmd === "iceCandidate") {
    const candidate = typeof args.sdp === "string" ? args.sdp : typeof args.candidate === "string" ? args.candidate : "";
    if (!candidate) return null;
    return {
      kind: "iceCandidate",
      candidate,
      ...(typeof args.mid === "string" ? { sdpMid: args.mid } : {}),
      ...(typeof args.mLine === "number" ? { sdpMLineIndex: args.mLine } : {}),
    };
  }
  return null;
}

function escapeTeamSpeakValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "\\s")
    .replace(/\//g, "\\/")
    .replace(/\|/g, "\\p")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
