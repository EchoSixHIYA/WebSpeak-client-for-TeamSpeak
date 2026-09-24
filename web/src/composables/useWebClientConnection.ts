import { computed, nextTick, watch, type Ref } from "vue";
import type { WebClientChatTab } from "./useWebClientChat.js";
import type { TreeChannel } from "./useWebClientChannels.js";
import { combineTeamSpeakTarget, isValidTeamSpeakPort } from "../services/teamspeak-target.js";

interface ChannelPasswordDialogState {
  open: boolean;
  channelId: string;
  password: string;
  error: string;
  submitting: boolean;
}

interface ServerPasswordDialogState {
  open: boolean;
  password: string;
  errorCode: string;
}

interface UseWebClientConnectionOptions {
  initialized: Readonly<Ref<boolean>>;
  accessMode: Readonly<Ref<string>>;
  isConnecting: Readonly<Ref<boolean>>;
  errorCode: Readonly<Ref<string>>;
  channelSwitchedChannelId: Readonly<Ref<string>>;
  nickname: Ref<string>;
  channelName: Ref<string>;
  serverHost: Ref<string>;
  serverPort: Ref<string>;
  serverPassword: Ref<string>;
  rememberIdentity: Readonly<Ref<boolean>>;
  identityMaterial: Ref<string>;
  accelerationRelayId: Ref<string>;
  inviteToken: string;
  selectedChannelId: Ref<string>;
  channels: Readonly<Ref<TreeChannel[]>>;
  clientId: Readonly<Ref<number>>;
  channelPasswordDialog: ChannelPasswordDialogState;
  serverPasswordDialog: ServerPasswordDialogState;
  chatTab: Ref<WebClientChatTab>;
  connect: (target: string, channel: string, nickname: string, password: string, identity: string, remember: boolean, invite: string, useRelay: boolean, relayId: string) => void;
  disconnect: () => void;
  switchChannel: (channelId: string, password?: string) => void;
  clearError: () => void;
  saveNickname: (nickname: string) => void;
  showToast: (message: string) => void;
  t: (key: string) => string;
}

export function useWebClientConnection({
  initialized,
  accessMode,
  isConnecting,
  errorCode,
  channelSwitchedChannelId,
  nickname,
  channelName,
  serverHost,
  serverPort,
  serverPassword,
  rememberIdentity,
  identityMaterial,
  accelerationRelayId,
  inviteToken,
  selectedChannelId,
  channels,
  clientId,
  channelPasswordDialog,
  serverPasswordDialog,
  chatTab,
  connect,
  disconnect,
  switchChannel,
  clearError,
  saveNickname,
  showToast,
  t,
}: UseWebClientConnectionOptions) {
  const canJoin = computed(() => Boolean(
    initialized.value
    && nickname.value.trim()
    && (accessMode.value === "fixed" || (serverHost.value.trim() && isValidTeamSpeakPort(serverPort.value))),
  ));

  function currentServerTarget(): string {
    return combineTeamSpeakTarget(serverHost.value, serverPort.value);
  }

  function doConnect(): void {
    if (!canJoin.value || isConnecting.value) return;
    clearError();
    nickname.value = nickname.value.trim();
    saveNickname(nickname.value);
    if (accessMode.value === "open") {
      serverHost.value = serverHost.value.trim();
      serverPort.value = serverPort.value.trim();
    }
    selectedChannelId.value = "";
    // Keep the password available for retry even if the target is administrator-managed.
    connect(
      currentServerTarget(),
      channelName.value.trim(),
      nickname.value,
      serverPassword.value,
      rememberIdentity.value ? identityMaterial.value : "",
      rememberIdentity.value,
      inviteToken,
      Boolean(accelerationRelayId.value),
      accelerationRelayId.value,
    );
  }

  function doDisconnect(): void {
    disconnect();
    selectedChannelId.value = "";
    showToast(t("leftToast"));
  }

  function submitServerPassword(): void {
    if (!serverPasswordDialog.open || !serverPasswordDialog.password) return;
    serverPassword.value = serverPasswordDialog.password;
    serverPasswordDialog.open = false;
    serverPasswordDialog.password = "";
    serverPasswordDialog.errorCode = "";
    doConnect();
  }

  function cancelServerPassword(): void {
    serverPasswordDialog.open = false;
    serverPasswordDialog.password = "";
    serverPasswordDialog.errorCode = "";
    clearError();
  }

  function selectChannel(channel: TreeChannel): void {
    selectedChannelId.value = channel.id;
    channelName.value = channel.name;
    chatTab.value = "channel";
    switchChannel(channel.id);
  }

  function submitChannelPassword(): void {
    if (!channelPasswordDialog.open || !channelPasswordDialog.channelId || !channelPasswordDialog.password) return;
    channelPasswordDialog.error = "";
    channelPasswordDialog.submitting = true;
    switchChannel(channelPasswordDialog.channelId, channelPasswordDialog.password);
  }

  function cancelChannelPassword(): void {
    const ownChannel = channels.value.find((item) => item.members.some((member) => member.id === clientId.value));
    if (ownChannel) selectedChannelId.value = ownChannel.id;
    channelPasswordDialog.open = false;
    channelPasswordDialog.channelId = "";
    channelPasswordDialog.password = "";
    channelPasswordDialog.error = "";
    channelPasswordDialog.submitting = false;
    clearError();
  }

  function selectChannelById(): void {
    const channel = channels.value.find((item) => item.id === selectedChannelId.value);
    if (channel) selectChannel(channel);
  }

  watch(errorCode, (code) => {
    if (code !== "CHANNEL_PASSWORD_REQUIRED" || !selectedChannelId.value) return;
    channelPasswordDialog.open = true;
    channelPasswordDialog.channelId = selectedChannelId.value;
    channelPasswordDialog.password = "";
    channelPasswordDialog.error = t("channelPasswordRetry");
    channelPasswordDialog.submitting = false;
    clearError();
    void nextTick(() => document.getElementById("channel-password-input")?.focus());
  });
  watch(errorCode, (code) => {
    if (code !== "SERVER_PASSWORD_REQUIRED" && code !== "INVALID_SERVER_PASSWORD") return;
    serverPasswordDialog.open = true;
    serverPasswordDialog.password = "";
    serverPasswordDialog.errorCode = code;
    clearError();
    void nextTick(() => document.getElementById("retry-server-password-input")?.focus());
  });
  watch(channelSwitchedChannelId, (channelId) => {
    if (!channelPasswordDialog.open || !channelId || channelId !== channelPasswordDialog.channelId) return;
    channelPasswordDialog.open = false;
    channelPasswordDialog.channelId = "";
    channelPasswordDialog.password = "";
    channelPasswordDialog.error = "";
    channelPasswordDialog.submitting = false;
  });

  return {
    canJoin,
    currentServerTarget,
    doConnect,
    doDisconnect,
    submitServerPassword,
    cancelServerPassword,
    selectChannel,
    submitChannelPassword,
    cancelChannelPassword,
    selectChannelById,
  };
}
