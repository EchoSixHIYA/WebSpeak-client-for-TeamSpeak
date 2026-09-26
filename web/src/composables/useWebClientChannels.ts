import { computed, watch, type Ref } from "vue";
import type { ChannelInfo, ChannelMember } from "./useVoiceWebSocket.js";

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
    const source = [...channels];
    const sourceIndex = new Map(source.map((item, index) => [item.id, index]));
    const enriched = source.map((item) => ({
      ...item,
      members: (item.members ?? []).map((member) => ({ ...member, isSelf: member.id === clientId.value })),
    }));
    const byId = new Map(enriched.map((item) => [item.id, item]));
    const depthCache = new Map<string, number>();

    function depthOf(item: ChannelInfo, visiting = new Set<string>()): number {
      if (depthCache.has(item.id)) return depthCache.get(item.id)!;
      if (!item.parentID || item.parentID === "0" || visiting.has(item.id)) return 0;
      const parent = byId.get(item.parentID);
      const depth = parent ? depthOf(parent, new Set(visiting).add(item.id)) + 1 : 0;
      depthCache.set(item.id, depth);
      return depth;
    }

    const childrenByParent = new Map<string, TreeChannel[]>();
    for (const item of enriched) {
      const treeChannel = { ...item, depth: depthOf(item) };
      const siblings = childrenByParent.get(treeChannel.parentID) ?? [];
      siblings.push(treeChannel);
      childrenByParent.set(treeChannel.parentID, siblings);
    }

    function orderSiblings(siblings: TreeChannel[]): TreeChannel[] {
      const bySiblingId = new Map(siblings.map((item) => [item.id, item]));
      const successors = new Map<string, TreeChannel[]>();
      const roots: TreeChannel[] = [];
      const sourceOrder = (left: TreeChannel, right: TreeChannel) =>
        (sourceIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (sourceIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER);

      for (const item of siblings) {
        const predecessor = item.order && item.order !== "0" && bySiblingId.has(item.order) ? item.order : "";
        if (!predecessor) roots.push(item);
        else successors.set(predecessor, [...(successors.get(predecessor) ?? []), item]);
      }

      roots.sort(sourceOrder);
      for (const items of successors.values()) items.sort(sourceOrder);

      const ordered: TreeChannel[] = [];
      const visited = new Set<string>();
      const append = (item: TreeChannel) => {
        if (visited.has(item.id)) return;
        visited.add(item.id);
        ordered.push(item);
        for (const successor of successors.get(item.id) ?? []) append(successor);
      };
      for (const root of roots) append(root);
      for (const item of [...siblings].sort(sourceOrder)) append(item);
      return ordered;
    }

    const orderedTree: TreeChannel[] = [];
    const visit = (parentID: string) => {
      for (const treeChannel of orderSiblings(childrenByParent.get(parentID) ?? [])) {
        orderedTree.push(treeChannel);
        visit(treeChannel.id);
      }
    };
    visit("0");
    for (const item of enriched) {
      if (!orderedTree.some((treeChannel) => treeChannel.id === item.id)) {
        orderedTree.push({ ...item, depth: depthOf(item) });
        visit(item.id);
      }
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
  const currentChannelName = computed(() => (currentChannel.value?.name ?? channelName.value) || t("voiceLobby"));
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
