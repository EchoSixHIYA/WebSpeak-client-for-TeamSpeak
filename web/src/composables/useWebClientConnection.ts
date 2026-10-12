import { computed, nextTick, watch, type Ref } from "vue";
import type { WebClientChatTab } from "./useWebClientChat.js";
import type { TreeChannel } from "./useWebClientChannels.js";
import { combineTeamSpeakTarget, isValidTeamSpeakPort, suggestedTeamSpeakPort } from "../services/teamspeak-target.js";
import {
  loadStoredChannelPassword,
  loadStoredServerPassword,
  removeStoredChannelPassword,
  removeStoredServerPassword,
  saveStoredChannelPassword,
  saveStoredServerPassword,
} from "../services/local-persistence.js";

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
  isConnected: Readonly<Ref<boolean>>;
  errorCode: Readonly<Ref<string>>;
  errorMessage: Readonly<Ref<string>>;
  channelSwitchedChannelId: Readonly<Ref<string>>;
  nickname: Ref<string>;
  channelName: Ref<string>;
  serverHost: Ref<string>;
  serverPort: Ref<string>;
  serverPassword: Ref<string>;
  rememberIdentity: Readonly<Ref<boolean>>;
  identityMaterial: Ref<string>;
  accelerationRelayId: Ref<string>;
  inviteToken: Ref<string>;
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
  beforeConnect?: () => void;
}

export function useWebClientConnection({
  initialized,
  accessMode,
  isConnecting,
  isConnected,
  errorCode,
  errorMessage,
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
  beforeConnect,
}: UseWebClientConnectionOptions) {
  const canJoin = computed(() => Boolean(
    initialized.value
    && nickname.value.trim()
    && (accessMode.value === "fixed" || (serverHost.value.trim() && isValidTeamSpeakPort(serverPort.value))),
  ));

  watch(serverHost, (address, previousAddress) => {
    serverPort.value = suggestedTeamSpeakPort(previousAddress, address, serverPort.value);
  }, { flush: "sync" });

  let serverPasswordLookupAttempt = 0;
  let resolvingServerPassword = false;
  let attemptedServerCredential: { target: string; password: string } | null = null;
  let channelSelectionAttempt = 0;
  let attemptedChannelCredential: { target: string; channelId: string; password: string } | null = null;

  function currentServerTarget(): string {
    return combineTeamSpeakTarget(serverHost.value, serverPort.value);
  }

  watch(() => currentServerTarget(), (target, previousTarget) => {
    if (!previousTarget || target === previousTarget) return;
    serverPassword.value = "";
    resolvingServerPassword = false;
    serverPasswordLookupAttempt += 1;
    attemptedServerCredential = null;
    attemptedChannelCredential = null;
    channelSelectionAttempt += 1;
  }, { flush: "sync" });

  function doConnect(): void {
    if (!canJoin.value || isConnecting.value || resolvingServerPassword) return;
    beforeConnect?.();
    clearError();
    nickname.value = nickname.value.trim();
    saveNickname(nickname.value);
    if (accessMode.value === "open") {
      serverHost.value = serverHost.value.trim();
      serverPort.value = serverPort.value.trim();
    }
    selectedChannelId.value = "";
    const target = currentServerTarget();
    const attempt = ++serverPasswordLookupAttempt;
    resolvingServerPassword = true;
    void (async () => {
      try {
        const savedPassword = serverPassword.value ? "" : await loadStoredServerPassword(target);
        if (attempt !== serverPasswordLookupAttempt || target !== currentServerTarget()) return;
        // A password entered while IndexedDB was being read takes precedence.
        const password = serverPassword.value || savedPassword;
        attemptedServerCredential = { target, password };
        // Keep the in-memory value available for the existing reconnect flow.
        serverPassword.value = password;
        connect(
          target,
          channelName.value.trim(),
          nickname.value,
          password,
          rememberIdentity.value ? identityMaterial.value : "",
          rememberIdentity.value,
          inviteToken.value,
          Boolean(accelerationRelayId.value),
          accelerationRelayId.value,
        );
      } finally {
        if (attempt === serverPasswordLookupAttempt) resolvingServerPassword = false;
      }
    })();
  }

  function doDisconnect(notify = true): void {
    serverPasswordLookupAttempt += 1;
    resolvingServerPassword = false;
    attemptedServerCredential = null;
    channelSelectionAttempt += 1;
    attemptedChannelCredential = null;
    disconnect();
    selectedChannelId.value = "";
    if (notify) showToast(t("leftToast"));
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
    const target = currentServerTarget();
    const attempt = ++channelSelectionAttempt;
    attemptedChannelCredential = null;
    void loadStoredChannelPassword(target, channel.id).then((password) => {
      if (attempt !== channelSelectionAttempt || selectedChannelId.value !== channel.id || target !== currentServerTarget()) return;
      attemptedChannelCredential = password ? { target, channelId: channel.id, password } : null;
      switchChannel(channel.id, password);
    });
  }

  function submitChannelPassword(): void {
    if (!channelPasswordDialog.open || channelPasswordDialog.submitting || !channelPasswordDialog.channelId || !channelPasswordDialog.password) return;
    channelPasswordDialog.error = "";
    channelPasswordDialog.submitting = true;
    const target = currentServerTarget();
    const channelId = channelPasswordDialog.channelId;
    attemptedChannelCredential = { target, channelId, password: channelPasswordDialog.password };
    channelSelectionAttempt += 1;
    switchChannel(channelId, channelPasswordDialog.password);
  }

  function cancelChannelPassword(): void {
    channelSelectionAttempt += 1;
    attemptedChannelCredential = null;
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
    if (code === "CHANNEL_PASSWORD_REQUIRED" || code === "INVALID_CHANNEL_PASSWORD") {
      const channelId = selectedChannelId.value;
      if (!channelId) return;
      const target = currentServerTarget();
      if (attemptedChannelCredential?.channelId === channelId && attemptedChannelCredential.target === target) {
        void removeStoredChannelPassword(target, channelId);
        attemptedChannelCredential = null;
      }
      channelPasswordDialog.open = true;
      channelPasswordDialog.channelId = channelId;
      channelPasswordDialog.password = "";
      channelPasswordDialog.error = t("channelPasswordRetry");
      channelPasswordDialog.submitting = false;
      clearError();
      void nextTick(() => document.getElementById("channel-password-input")?.focus());
      return;
    }
    if (code && channelPasswordDialog.open && channelPasswordDialog.submitting) {
      channelPasswordDialog.error = errorMessage.value;
      channelPasswordDialog.submitting = false;
      attemptedChannelCredential = null;
      clearError();
    }
  });
  watch(errorCode, (code) => {
    if (code !== "SERVER_PASSWORD_REQUIRED" && code !== "INVALID_SERVER_PASSWORD") return;
    if (attemptedServerCredential) void removeStoredServerPassword(attemptedServerCredential.target);
    attemptedServerCredential = null;
    serverPassword.value = "";
    serverPasswordDialog.open = true;
    serverPasswordDialog.password = "";
    serverPasswordDialog.errorCode = code;
    clearError();
    void nextTick(() => document.getElementById("retry-server-password-input")?.focus());
  });
  watch(isConnected, (connected) => {
    if (!connected || !attemptedServerCredential) return;
    const credential = attemptedServerCredential;
    attemptedServerCredential = null;
    if (credential.password) void saveStoredServerPassword(credential.target, credential.password);
  });
  watch(channelSwitchedChannelId, (channelId) => {
    if (!channelId) return;
    const credential = attemptedChannelCredential;
    if (credential?.channelId === channelId && credential.target === currentServerTarget()) {
      attemptedChannelCredential = null;
      void saveStoredChannelPassword(credential.target, channelId, credential.password);
    }
    if (channelPasswordDialog.open && channelId === channelPasswordDialog.channelId) {
      channelPasswordDialog.open = false;
      channelPasswordDialog.channelId = "";
      channelPasswordDialog.password = "";
      channelPasswordDialog.error = "";
      channelPasswordDialog.submitting = false;
    }
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
