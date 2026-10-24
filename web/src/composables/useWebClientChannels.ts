import { computed, watch, type Ref } from "vue";
import type { ChannelInfo, ChannelMember } from "./useVoiceWebSocket.js";
import { channelDisplayName } from "../../../src/shared/channel-spacer.js";

export interface TreeChannel extends ChannelInfo {
  depth: number;
  members: ChannelMember[];
}

interface UseWebClientChannelsOptions {
  channels: ChannelInfo[];
  members: ChannelMember[];
  clientId: Readonly<Ref<number>>;
  selectedChannelId: Ref<string>;
  channelName: Ref<string>;
  memberQuery: Ref<string>;
  whisperTargetIds: Set<number>;
  t: (key: string) => string;
}

export function useWebClientChannels({
  channels,
  members,
  clientId,
  selectedChannelId,
  channelName,
  memberQuery,
  whisperTargetIds,
  t,
}: UseWebClientChannelsOptions) {
  const channelTree = computed<TreeChannel[]>(() => {
    const unique = new Map<string, ChannelInfo>();
    for (const channel of channels) if (!unique.has(channel.id)) unique.set(channel.id, channel);
    const source = [...unique.values()];
    const sourceIndex = new Map(source.map((item, index) => [item.id, index]));
    const enriched = source.map((item) => ({
      ...item,
      members: (item.members ?? []).map((member) => ({ ...member, isSelf: member.id === clientId.value })),
    }));
    type ListedChannel = (typeof enriched)[number];
    const childrenByParent = new Map<string, ListedChannel[]>();
    for (const item of enriched) {
      const siblings = childrenByParent.get(item.parentID) ?? [];
      siblings.push(item);
      childrenByParent.set(item.parentID, siblings);
    }

    function orderSiblings(siblings: ListedChannel[]): ListedChannel[] {
      const bySiblingId = new Map(siblings.map((item) => [item.id, item]));
      const successors = new Map<string, ListedChannel[]>();
      const roots: ListedChannel[] = [];
      const sourceOrder = (left: ListedChannel, right: ListedChannel) =>
        (sourceIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (sourceIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER);

      for (const item of siblings) {
        const predecessor = item.order && item.order !== "0" && bySiblingId.has(item.order) ? item.order : "";
        if (!predecessor) roots.push(item);
        else successors.set(predecessor, [...(successors.get(predecessor) ?? []), item]);
      }

      roots.sort(sourceOrder);
      for (const items of successors.values()) items.sort(sourceOrder);

      const ordered: ListedChannel[] = [];
      const visited = new Set<string>();
      const append = (item: ListedChannel) => {
        const pending = [item];
        while (pending.length) {
          const next = pending.pop()!;
          if (visited.has(next.id)) continue;
          visited.add(next.id);
          ordered.push(next);
          const following = successors.get(next.id) ?? [];
          for (let index = following.length - 1; index >= 0; index--) pending.push(following[index]);
        }
      };
      for (const root of roots) append(root);
      for (const item of [...siblings].sort(sourceOrder)) append(item);
      return ordered;
    }

    const orderedTree: TreeChannel[] = [];
    const visited = new Set<string>();
    const visit = (roots: ListedChannel[]) => {
      const pending = orderSiblings(roots).reverse().map(channel => ({ channel, depth: 0 }));
      while (pending.length) {
        const { channel, depth } = pending.pop()!;
        if (visited.has(channel.id)) continue;
        visited.add(channel.id);
        orderedTree.push({ ...channel, depth });
        const children = orderSiblings(childrenByParent.get(channel.id) ?? []);
        for (let index = children.length - 1; index >= 0; index--) pending.push({ channel: children[index], depth: depth + 1 });
      }
    };
    visit(childrenByParent.get("0") ?? []);
    // Missing parents become roots; disconnected cycles start at their first
    // source entry. Both traversals are iterative and emit each ID at most once.
    visit(enriched.filter(channel => !unique.has(channel.parentID) && channel.parentID !== "0"));
    for (const item of enriched) {
      if (!visited.has(item.id)) visit([item]);
    }
    return orderedTree;
  });

  const currentChannel = computed<TreeChannel | undefined>(() => {
    const explicitlySelected = channelTree.value.find((item) => item.id === selectedChannelId.value);
    if (explicitlySelected) return explicitlySelected;
    const fromSelf = channelTree.value.find((item) => item.members.some((member) => member.id === clientId.value));
    if (fromSelf) return fromSelf;
    return channelTree.value.find((item) => item.name === channelName.value) ?? channelTree.value[0];
  });
  const currentChannelName = computed(() => (currentChannel.value ? channelDisplayName(currentChannel.value) : channelName.value) || t("voiceLobby"));
  const currentChannelDescription = computed(() => currentChannel.value?.description ?? "");
  const currentMembers = computed<ChannelMember[]>(() => {
    const source = currentChannel.value ? currentChannel.value.members : members;
    return source.map((member) => ({ ...member, isSelf: member.isSelf || member.id === clientId.value }));
  });
  const memberChannels = computed<TreeChannel[]>(() => {
    if (channelTree.value.length) return channelTree.value;
    return [{
      id: "__current__",
      parentID: "0",
      name: currentChannelName.value,
      description: currentChannelDescription.value,
      members: currentMembers.value,
      depth: 0,
    }];
  });
  const filteredMemberChannels = computed(() => {
    const search = memberQuery.value.trim().toLowerCase();
    if (!search) return memberChannels.value;
    return memberChannels.value.filter((item) => item.name.toLowerCase().includes(search)
      || item.members.some((member) => member.nickname.toLowerCase().includes(search)));
  });
  const whisperTargets = computed(() => [...whisperTargetIds]
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is ChannelMember => Boolean(member)));

  watch(channelTree, (list) => {
    if (!selectedChannelId.value && list[0]) {
      selectedChannelId.value = list.find((item) => item.name === channelName.value)?.id
        ?? list.find((item) => item.members.some((member) => member.id === clientId.value))?.id
        ?? "";
    }
  }, { deep: true });

  return {
    channelTree,
    currentChannel,
    currentChannelName,
    currentChannelDescription,
    currentMembers,
    memberChannels,
    filteredMemberChannels,
    whisperTargets,
  };
}
