export interface VoiceChannelTreeSource {
  id: string;
  depth: number;
}

export interface VoiceChannelTreeNode<T extends VoiceChannelTreeSource = VoiceChannelTreeSource> {
  channel: T;
  depth: number;
  children: VoiceChannelTreeNode<T>[];
}

const MAX_NESTED_CHANNEL_DEPTH = 12;

/** Rebuilds a nested view from the host's safe, preorder TeamSpeak channel list. */
export function buildVoiceChannelTree<T extends VoiceChannelTreeSource>(
  channels: readonly T[],
): VoiceChannelTreeNode<T>[] {
  const roots: VoiceChannelTreeNode<T>[] = [];
  const parentStack: VoiceChannelTreeNode<T>[] = [];
  const seen = new Set<string>();

  for (const channel of channels) {
    if (!channel.id || seen.has(channel.id)) continue;
    seen.add(channel.id);

    const requestedDepth = Number.isFinite(channel.depth) ? Math.max(0, Math.floor(channel.depth)) : 0;
    const depth = Math.min(requestedDepth, MAX_NESTED_CHANNEL_DEPTH, parentStack.length);
    const node: VoiceChannelTreeNode<T> = { channel, depth, children: [] };
    if (depth === 0) roots.push(node);
    else parentStack[depth - 1].children.push(node);

    parentStack.length = depth;
    parentStack.push(node);
  }

  return roots;
}
