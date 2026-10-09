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
    const recent: RecentServer = {
      id: serverKey(address),
      address,
      ...(nickname.value.trim() ? { nickname: nickname.value.trim() } : {}),
      ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}),
      lastConnectedAt: Date.now(),
      ...(channel.value.trim() ? { lastChannelHint: { name: channel.value.trim() } } : {}),
    };
    void recordRecentServer(recent).then(() => listRecentServers().then((items) => { recentServers.value = items; }));
  }

  function selectLocalServer(address: string, savedNickname?: string): void {
    const target = splitTeamSpeakTarget(address);
    serverHost.value = target.address;
    serverPort.value = target.port;
    if (savedNickname && !nickname.value.trim()) nickname.value = savedNickname;
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
    const favorite: FavoriteServer = {
      id,
      label: label.trim() || normalizedAddress,
      address: normalizedAddress,
      ...(savedNickname ? { nickname: savedNickname } : {}),
      ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}),
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

  function clearServerHistory(): void {
    favoriteServers.value = [];
    recentServers.value = [];
  }

  return {
    favoriteServers,
    recentServers,
    isFavorite,
    loadSavedServers,
    recordCurrentServer,
    selectLocalServer,
    saveFavoriteServer,
    removeFavoriteServer,
    toggleFavorite,
    clearServerHistory,
  };
}

function serverKey(address: string): string {
  return address.trim().toLocaleLowerCase();
}
