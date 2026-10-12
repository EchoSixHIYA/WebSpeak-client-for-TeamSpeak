import { computed, ref, type Ref } from "vue";
import {
  listFavorites,
  listRecentServers,
  recordRecentServer,
  removeFavorite as deleteFavorite,
  saveFavorite,
  type FavoriteServer,
  type RecentServer,
} from "../services/local-persistence.js";
import { mergeQuickServers, type QuickServer } from "../services/quick-servers.js";
import { combineTeamSpeakTarget, splitTeamSpeakTarget } from "../services/teamspeak-target.js";

type Translator = (key: string, variables?: Record<string, string | number>) => string;

interface UseWebClientServerHistoryOptions {
  serverHost: Ref<string>;
  serverPort: Ref<string>;
  nickname: Ref<string>;
  channel: Ref<string>;
  rememberIdentity: Ref<boolean>;
  identityMaterial: Ref<string>;
  t: Translator;
  showToast: (message: string) => void;
}

export function useWebClientServerHistory({
  serverHost,
  serverPort,
  nickname,
  channel,
  rememberIdentity,
  identityMaterial,
  t,
  showToast,
}: UseWebClientServerHistoryOptions) {
  const favoriteServers = ref<FavoriteServer[]>([]);
  const recentServers = ref<RecentServer[]>([]);
  const quickServers = computed(() => mergeQuickServers(favoriteServers.value, recentServers.value));
  const currentTarget = computed(() => combineTeamSpeakTarget(serverHost.value, serverPort.value));
  const isFavorite = computed(() => favoriteServers.value.some((favorite) => favorite.id === serverKey(currentTarget.value)));

  async function loadSavedServers(): Promise<void> {
    const [favorites, recent] = await Promise.all([listFavorites(), listRecentServers()]);
    favoriteServers.value = favorites;
    recentServers.value = recent;
  }

  function recordCurrentServer(): void {
    const address = currentTarget.value;
    if (!address) return;
    const savedServer = quickServers.value.find((server) => server.id === serverKey(address));
    const recent: RecentServer = {
      id: serverKey(address),
      address,
      ...(nickname.value.trim() ? { nickname: nickname.value.trim() } : {}),
      ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}),
      lastConnectedAt: Date.now(),
      ...(savedServer?.serverName ? { serverName: savedServer.serverName } : {}),
      ...(savedServer?.serverIcon ? { serverIcon: savedServer.serverIcon } : {}),
      ...(channel.value.trim() ? { lastChannelHint: { name: channel.value.trim() } } : {}),
    };
    void recordRecentServer(recent).then(() => listRecentServers().then((items) => { recentServers.value = items; }));
  }

  function selectLocalServer(address: string, savedNickname?: string, savedChannel?: string): void {
    const target = splitTeamSpeakTarget(address);
    serverHost.value = target.address;
    serverPort.value = target.port;
    if (savedNickname && !nickname.value.trim()) nickname.value = savedNickname;
    if (savedChannel) channel.value = savedChannel;
  }

  async function saveFavoriteServer(
    address: string,
    label = address,
    savedNickname = nickname.value.trim(),
    channelHint = channel.value.trim(),
  ): Promise<void> {
    const normalizedAddress = address.trim();
    if (!normalizedAddress) return;
    const id = serverKey(normalizedAddress);
    const existing = quickServers.value.find((server) => server.id === id);
    const favorite: FavoriteServer = {
      id,
      label: label.trim() || normalizedAddress,
      address: normalizedAddress,
      ...(savedNickname ? { nickname: savedNickname } : {}),
      ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}),
      ...(existing?.serverName ? { serverName: existing.serverName } : {}),
      ...(existing?.serverIcon ? { serverIcon: existing.serverIcon } : {}),
      ...(channelHint ? { lastChannelHint: { name: channelHint } } : {}),
    };
    await saveFavorite(favorite);
    favoriteServers.value = [...favoriteServers.value.filter((item) => item.id !== id), favorite]
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  async function removeFavoriteServer(id: string): Promise<void> {
    await deleteFavorite(id);
    favoriteServers.value = favoriteServers.value.filter((favorite) => favorite.id !== id);
  }

  async function toggleFavorite(): Promise<void> {
    const address = currentTarget.value;
    if (!address) return;
    const id = serverKey(address);
    const existing = favoriteServers.value.find((favorite) => favorite.id === id);
    if (existing) {
      await removeFavoriteServer(id);
      showToast(t("removedFavoriteToast"));
      return;
    }
    await saveFavoriteServer(address, address);
    showToast(t("savedFavoriteToast"));
  }

  async function toggleQuickServerFavorite(server: QuickServer): Promise<void> {
    if (server.isFavorite) {
      await removeFavoriteServer(server.id);
      showToast(t("removedFavoriteToast"));
      return;
    }
    await saveFavoriteServer(
      server.address,
      server.label,
      server.nickname ?? "",
      server.lastChannelHint?.name ?? "",
    );
    showToast(t("savedFavoriteToast"));
  }

  async function updateCurrentServerIdentity(serverName: string, serverIcon: string | null): Promise<void> {
    const address = currentTarget.value;
    const name = serverName.trim().slice(0, 256);
    if (!address || !name) return;
    const id = serverKey(address);
    const existingRecent = recentServers.value.find((server) => server.id === id);
    const recent: RecentServer = {
      ...(existingRecent ?? {}),
      id,
      address,
      lastConnectedAt: existingRecent?.lastConnectedAt ?? Date.now(),
      serverName: name,
      ...(nickname.value.trim() ? { nickname: nickname.value.trim() } : {}),
      ...(channel.value.trim() ? { lastChannelHint: { name: channel.value.trim() } } : {}),
    };
    if (serverIcon) recent.serverIcon = serverIcon;
    else delete recent.serverIcon;
    recentServers.value = [recent, ...recentServers.value.filter((server) => server.id !== id)]
      .sort((left, right) => right.lastConnectedAt - left.lastConnectedAt).slice(0, 10);
    await recordRecentServer(recent);

    const favorite = favoriteServers.value.find((server) => server.id === id);
    if (favorite) {
      const updated: FavoriteServer = { ...favorite, serverName: name };
      if (serverIcon) updated.serverIcon = serverIcon;
      else delete updated.serverIcon;
      favoriteServers.value = favoriteServers.value.map((server) => server.id === id ? updated : server);
      await saveFavorite(updated);
    }
  }

  function clearServerHistory(): void {
    favoriteServers.value = [];
    recentServers.value = [];
  }

  return {
    favoriteServers,
    recentServers,
    quickServers,
    isFavorite,
    loadSavedServers,
    recordCurrentServer,
    updateCurrentServerIdentity,
    selectLocalServer,
    saveFavoriteServer,
    removeFavoriteServer,
    toggleFavorite,
    toggleQuickServerFavorite,
    clearServerHistory,
  };
}

function serverKey(address: string): string {
  return address.trim().toLocaleLowerCase();
}
