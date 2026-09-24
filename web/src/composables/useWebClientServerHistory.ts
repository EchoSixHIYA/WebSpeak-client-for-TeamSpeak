import { computed, ref, type Ref } from "vue";
import {
  listFavorites,
  listRecentServers,
  recordRecentServer,
  removeFavorite,
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

  async function toggleFavorite(): Promise<void> {
    const address = currentTarget.value;
    if (!address) return;
    const id = serverKey(address);
    const existing = favoriteServers.value.find((favorite) => favorite.id === id);
    if (existing) {
      await removeFavorite(id);
      favoriteServers.value = favoriteServers.value.filter((favorite) => favorite.id !== id);
      showToast(t("removedFavoriteToast"));
      return;
    }
    const favorite: FavoriteServer = {
      id,
      label: address,
      address,
      ...(nickname.value.trim() ? { nickname: nickname.value.trim() } : {}),
      ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}),
      ...(channel.value.trim() ? { lastChannelHint: { name: channel.value.trim() } } : {}),
    };
    await saveFavorite(favorite);
    favoriteServers.value = [...favoriteServers.value, favorite].sort((left, right) => left.label.localeCompare(right.label));
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
    toggleFavorite,
    clearServerHistory,
  };
}

function serverKey(address: string): string {
  return address.trim().toLocaleLowerCase();
}
