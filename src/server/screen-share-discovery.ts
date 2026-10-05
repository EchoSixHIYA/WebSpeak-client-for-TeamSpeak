interface ScreenShareDirectorySource {
  targetKey: string;
  clientChannelIds: ReadonlyMap<number, bigint>;
}

/**
 * Coalesce overlapping discovery passes for one server, but never permanently
 * suppress a later pass. If another session asks while a pass is running, do
 * one trailing pass using that session's directory and connection.
 */
export class ScreenShareDiscoveryCoordinator {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly queued = new Map<string, () => Promise<void>>();

  run(targetKey: string, discover: () => Promise<void>): Promise<void> {
    const active = this.inFlight.get(targetKey);
    if (active) {
      this.queued.set(targetKey, discover);
      return active;
    }

    let scheduled: Promise<void>;
    scheduled = Promise.resolve().then(discover).finally(async () => {
      if (this.inFlight.get(targetKey) === scheduled) this.inFlight.delete(targetKey);
      const followUp = this.queued.get(targetKey);
      if (!followUp) return;
      this.queued.delete(targetKey);
      await this.run(targetKey, followUp);
    });
    this.inFlight.set(targetKey, scheduled);
    return scheduled;
  }
}

/** Resolve a native stream's channel from the directory of the same TS server. */
export function findScreenShareSourceChannelId(
  sources: Iterable<ScreenShareDirectorySource>,
  targetKey: string,
  clientId: number,
): bigint | undefined {
  for (const source of sources) {
    if (source.targetKey !== targetKey) continue;
    const channelId = source.clientChannelIds.get(clientId);
    if (channelId !== undefined && channelId !== 0n) return channelId;
  }
  return undefined;
}
