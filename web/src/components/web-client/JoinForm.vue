<template>
  <form
    class="join-form"
    data-ws-part="home.form"
    @submit.prevent="emit('connect')"
  >
    <div
      v-if="accessMode === 'open'"
      class="field-grid target-fields"
      data-ws-part="home.server-target"
    >
      <label
        class="field-label"
        data-ws-part="home.field-label"
        for="server-address"
        ><span>{{ t("serverAddress") }}</span
        ><div
          class="field-wrap"
          data-ws-part="home.field"
          ><Icon
            name="server"
            :size="17" /><input
            id="server-address"
            v-model="serverHost"
            autocomplete="url"
            inputmode="url"
            autocapitalize="none"
            autocorrect="off"
            :spellcheck="false"
            enterkeyhint="next"
            :placeholder="t('serverAddressPlaceholder')" /></div
      ></label>
      <label
        class="field-label"
        data-ws-part="home.field-label"
        for="server-port"
        ><span>{{ t("serverPort") }}</span
        ><div
          class="field-wrap"
          data-ws-part="home.field"
          ><Icon
            name="hash"
            :size="17" /><input
            id="server-port"
            v-model="serverPort"
            inputmode="numeric"
            enterkeyhint="next"
            type="text"
            maxlength="5"
            :placeholder="t('serverPortPlaceholder')" /></div
      ></label>
    </div>
    <div
      v-if="openTargetPrefillBlocked"
      class="notice warning-notice"
      data-ws-part="home.notice"
      data-ws-state="target-prefill-blocked"
      ><span class="notice-symbol">i</span
      ><span>{{ t("openTargetDefaultNotPrefilled") }}</span></div
    >
    <div
      v-if="accelerationRelays.length"
      class="acceleration-choice"
      data-ws-part="home.relay-choice"
      ><div
        class="acceleration-copy"
        data-ws-part="home.relay-choice.copy"
        ><strong>{{ t("relayAcceleration") }}</strong
        ><small>{{ t("relayAccelerationHint") }}</small></div
      ><select
        v-model="accelerationRelayId"
        :aria-label="t('relayAcceleration')"
        ><option value="">{{ t("directConnection") }}</option
        ><option
          v-for="relay in accelerationRelays"
          :key="relay.id"
          :value="relay.id"
          >{{ relay.name }}</option
        ></select
      ></div
    >
    <div
      v-if="accessMode === 'open' && quickServers.length"
      class="local-servers"
      data-ws-part="home.server-history"
    >
      <div
        class="local-server-group"
        data-ws-part="home.server-history.group"
        ><span>{{ t("quickServers") }}</span
        ><div
          v-for="server in quickServers"
          :key="server.id"
          class="local-server-item"
          data-ws-part="home.server-history.item"
          :data-ws-state="server.isFavorite ? 'favorite' : 'recent'"
        ><button
          type="button"
          class="local-server-select"
          data-ws-part="home.server-history.select"
          :title="server.label + '\n' + server.address"
          :aria-label="t('switchToServer', { server: server.label })"
          @click="emit('selectServer', server.address, server.nickname, server.lastChannelHint?.name)"
          >{{ server.label }}</button
          ><button
            type="button"
            :class="['local-server-favorite', { active: server.isFavorite }]"
            data-ws-part="home.server-history.favorite-toggle"
            :data-ws-state="server.isFavorite ? 'saved' : 'unsaved'"
            :aria-label="server.isFavorite ? t('removeFavoriteForServer', { server: server.label }) : t('saveFavoriteForServer', { server: server.label })"
            :aria-pressed="server.isFavorite"
            @click.stop="emit('toggleQuickFavorite', server)"
          ><Icon name="star" :size="13" /></button
        ></div
        ></div
      >
    </div>
    <button
      v-if="accessMode === 'open' && serverHost.trim()"
      type="button"
      class="favorite-toggle"
      data-ws-part="home.favorite-toggle"
      @click="emit('toggleFavorite')"
      >{{ isFavorite ? t("removeFavorite") : t("saveFavorite") }}</button
    >

    <template v-if="accessMode === 'open'">
      <label
        class="field-label"
        data-ws-part="home.field-label"
        for="server-password"
        >{{ t("serverPassword") }} <span>{{ t("optional") }}</span></label
      >
      <div
        class="field-wrap"
        data-ws-part="home.field"
        ><Icon
          name="lock"
          :size="17" /><input
          id="server-password"
          v-model="serverPassword"
          type="password"
          autocomplete="off"
          :placeholder="t('optionalPassword')"
      /></div>
    </template>

    <label
      class="field-label"
      data-ws-part="home.field-label"
      for="nickname"
      >{{ t("nickname") }}</label
    >
    <div
      class="field-wrap"
      data-ws-part="home.field"
    >
      <Icon
        name="users"
        :size="17"
      />
      <input
        id="nickname"
        v-model="nickname"
        autocomplete="nickname"
        maxlength="30"
        :placeholder="t('nicknamePlaceholder')"
        :autofocus="autofocusNickname"
      />
    </div>

    <details
      class="identity-options"
      data-ws-part="home.identity"
      ><summary>{{ t("identityOptions") }}</summary
      ><label
        class="field-label"
        data-ws-part="home.field-label"
        for="channel"
        >{{ t("targetChannel") }} <span>{{ t("optional") }}</span></label
      ><div class="field-wrap" data-ws-part="home.field"><Icon name="hash" :size="17" /><input
        id="channel"
        v-model="channel"
        :placeholder="t('emptyDefault')"
        @keyup.enter="emit('connect')"
      /></div
      ><div class="identity-controls"
        ><label class="remember-identity"
          ><input
            v-model="rememberIdentity"
            type="checkbox"
          /><span
            ><strong>{{ t("rememberIdentity") }}</strong
            ><small>{{ t("rememberIdentityHint") }}</small></span
          ></label
        ><div
          class="identity-actions"
          data-ws-part="home.identity-actions"
          ><button
            type="button"
            class="identity-action-button"
            data-ws-part="home.identity-import.open"
            @click="emit('importIdentity')"
            >{{ t("identityImport") }}</button
          ><button
            type="button"
            class="identity-action-button"
            data-ws-part="home.identity-export.button"
            :disabled="identityExportBusy || !rememberIdentity || !hasIdentity"
            @click="emit('exportIdentity')"
            >{{ t("identityExport") }}</button
          ></div
        ></div
      ></details
    ><p
      v-if="rememberIdentity"
      class="identity-warning"
      >{{ t("rememberIdentityConcurrentWarning") }}</p
    >

    <button
      class="primary-button connect-button"
      data-ws-part="home.connect"
      :disabled="joinDisabled"
      type="submit"
    >
      <span
        v-if="connecting"
        class="button-spinner"
      ></span>
      <span>{{ connecting ? t("connecting") : t("enterVoice") }}</span>
      <Icon
        v-if="!connecting"
        name="chevron-right"
        :size="17"
      />
    </button>
    <button
      v-if="connecting"
      type="button"
      class="cancel-connect-button"
      @click="emit('disconnect')"
      >{{ t("cancel") }}</button
    >
  </form>
</template>

<script setup lang="ts">
import Icon from "../Icon.vue";
import type { QuickServer } from "../../services/quick-servers.js";

const serverHost = defineModel<string>("serverHost", { required: true });
const serverPort = defineModel<string>("serverPort", { required: true });
const serverPassword = defineModel<string>("serverPassword", { required: true });
const nickname = defineModel<string>("nickname", { required: true });
const channel = defineModel<string>("channel", { required: true });
const rememberIdentity = defineModel<boolean>("rememberIdentity", { required: true });
const accelerationRelayId = defineModel<string>("accelerationRelayId", { required: true });

defineProps<{
  autofocusNickname?: boolean;
  accessMode: "fixed" | "open";
  openTargetPrefillBlocked: boolean;
  accelerationRelays: ReadonlyArray<{ id: string; name: string }>;
  quickServers: readonly QuickServer[];
  isFavorite: boolean;
  identityExportBusy: boolean;
  hasIdentity: boolean;
  connecting: boolean;
  joinDisabled: boolean;
  t: (key: string, variables?: Record<string, string | number>) => string;
}>();

const emit = defineEmits<{
  connect: [];
  disconnect: [];
  importIdentity: [];
  exportIdentity: [];
  toggleFavorite: [];
  toggleQuickFavorite: [server: QuickServer];
  selectServer: [address: string, nickname?: string, channel?: string];
}>();
</script>
