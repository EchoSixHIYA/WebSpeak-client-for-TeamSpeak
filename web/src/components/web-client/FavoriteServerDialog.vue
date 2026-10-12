<template>
  <div
    v-if="open"
    class="modal-backdrop favorite-server-dialog-backdrop"
    data-ws-part="voice.favorite-servers.dialog-backdrop"
    @click.self="$emit('close')"
  >
    <section
      class="favorite-server-dialog"
      data-ws-part="voice.favorite-servers.dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @keydown.esc.prevent="$emit('close')"
    >
      <header class="favorite-server-dialog-header" data-ws-part="voice.favorite-servers.dialog.header">
        <div>
          <span>{{ t("favoriteServers") }}</span>
          <h2 :id="titleId">{{ t("quickConnectTitle") }}</h2>
        </div>
        <button
          type="button"
          class="favorite-server-dialog-close"
          data-ws-part="voice.favorite-servers.dialog.close"
          :aria-label="t('close')"
          @click="$emit('close')"
        >
          <Icon name="close" :size="18" />
        </button>
      </header>

      <form class="favorite-server-dialog-form" data-ws-part="voice.favorite-servers.dialog.form" @submit.prevent="submit">
        <label class="favorite-server-dialog-field" data-ws-part="voice.favorite-servers.dialog.field">
          <span>{{ t("favoriteDisplayName") }}</span>
          <input
            v-model="label"
            data-ws-part="voice.favorite-servers.dialog.input"
            maxlength="48"
            :placeholder="t('favoriteDisplayNamePlaceholder')"
            autocomplete="off"
          />
        </label>

        <div class="favorite-server-dialog-target" data-ws-part="voice.favorite-servers.dialog.target">
          <label class="favorite-server-dialog-field" data-ws-part="voice.favorite-servers.dialog.field">
            <span>{{ t("serverAddress") }}</span>
            <input
              ref="addressInput"
              v-model="address"
              data-ws-part="voice.favorite-servers.dialog.input"
              required
              maxlength="253"
              :placeholder="t('serverAddressPlaceholder')"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </label>
          <label class="favorite-server-dialog-field favorite-server-dialog-port" data-ws-part="voice.favorite-servers.dialog.field">
            <span>{{ t("serverPort") }}</span>
            <input
              v-model="port"
              data-ws-part="voice.favorite-servers.dialog.input"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              :placeholder="t('serverPortPlaceholder')"
            />
          </label>
        </div>

        <p class="favorite-server-dialog-hint" data-ws-part="voice.favorite-servers.dialog.hint">{{ t("serverAddressHint") }}</p>

        <label class="favorite-server-dialog-field" data-ws-part="voice.favorite-servers.dialog.field">
          <span>{{ t("nickname") }}</span>
          <input
            v-model="nickname"
            data-ws-part="voice.favorite-servers.dialog.input"
            required
            maxlength="64"
            :placeholder="t('nicknamePlaceholder')"
            autocomplete="nickname"
          />
        </label>

        <label class="favorite-server-dialog-field" data-ws-part="voice.favorite-servers.dialog.field">
          <span>{{ t("targetChannel") }} <small>{{ t("optional") }}</small></span>
          <input
            v-model="channel"
            data-ws-part="voice.favorite-servers.dialog.input"
            maxlength="128"
            :placeholder="t('emptyDefault')"
            autocomplete="off"
          />
        </label>

        <footer class="favorite-server-dialog-actions" data-ws-part="voice.favorite-servers.dialog.actions">
          <button type="button" class="favorite-server-dialog-cancel" data-ws-part="voice.favorite-servers.dialog.cancel" @click="$emit('close')">
            {{ t("cancel") }}
          </button>
          <button type="submit" class="favorite-server-dialog-submit" data-ws-part="voice.favorite-servers.dialog.submit" :disabled="busy">
            <Icon name="plus" :size="17" />
            {{ t("quickConnectAndSave") }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import Icon from "../Icon.vue";

export interface FavoriteServerDraft {
  label: string;
  address: string;
  port: string;
  nickname: string;
  channel: string;
}

const props = defineProps<{
  open: boolean;
  busy: boolean;
  defaultNickname: string;
  t: (key: string) => string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [draft: FavoriteServerDraft];
}>();

const titleId = "favorite-server-dialog-title";
const label = ref("");
const address = ref("");
const port = ref("9987");
const nickname = ref("");
const channel = ref("");
const addressInput = ref<HTMLInputElement | null>(null);

watch(() => props.open, (open) => {
  if (!open) return;
  label.value = "";
  address.value = "";
  port.value = "9987";
  nickname.value = props.defaultNickname;
  channel.value = "";
  void nextTick(() => addressInput.value?.focus());
});

function submit(): void {
  emit("submit", {
    label: label.value.trim(),
    address: address.value.trim(),
    port: port.value.trim(),
    nickname: nickname.value.trim(),
    channel: channel.value.trim(),
  });
}
</script>

<style scoped>
.favorite-server-dialog-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 60;
  padding: 24px;
  background: rgba(15, 25, 23, .48);
  backdrop-filter: blur(5px);
}

.favorite-server-dialog {
  width: min(460px, 100%);
  max-height: min(760px, calc(100dvh - 48px));
  overflow-y: auto;
  padding: 24px;
  color: var(--text-primary, #182321);
  background: var(--surface-1, #fff);
  border: 1px solid var(--border, #dce5e2);
  border-radius: 18px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, .22);
}

.favorite-server-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.favorite-server-dialog-header > div > span {
  color: var(--accent, #08766c);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.favorite-server-dialog-header h2 {
  margin: 5px 0 0;
  font-size: 22px;
}

.favorite-server-dialog-close {
  display: grid;
  flex: 0 0 38px;
  place-items: center;
  width: 38px;
  height: 38px;
  color: var(--text-muted, #687773);
  background: var(--surface-2, #f2f6f4);
  border: 1px solid var(--border, #dce5e2);
  border-radius: 10px;
  cursor: pointer;
}

.favorite-server-dialog-form {
  display: grid;
  gap: 14px;
}

.favorite-server-dialog-field {
  display: grid;
  min-width: 0;
  gap: 7px;
  color: var(--text-secondary, #43534e);
  font-size: 12px;
  font-weight: 700;
}

.favorite-server-dialog-field > span {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.favorite-server-dialog-field small {
  color: var(--text-muted, #81908b);
  font-size: 10px;
  font-weight: 500;
}

.favorite-server-dialog-field input {
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 0 12px;
  color: var(--text-primary, #182321);
  background: var(--surface-2, #f7f9f8);
  border: 1px solid var(--border, #dce5e2);
  border-radius: 10px;
  outline: none;
  font: inherit;
  font-size: 14px;
}

.favorite-server-dialog-field input:focus {
  border-color: var(--accent, #08766c);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #08766c) 16%, transparent);
}

.favorite-server-dialog-target {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 10px;
}

.favorite-server-dialog-hint {
  margin: -7px 0 0;
  color: var(--text-muted, #75847f);
  font-size: 11px;
  line-height: 1.5;
}

.favorite-server-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 4px;
}

.favorite-server-dialog-actions button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.favorite-server-dialog-cancel {
  color: var(--text-secondary, #43534e);
  background: var(--surface-2, #f2f6f4);
  border: 1px solid var(--border, #dce5e2);
}

.favorite-server-dialog-submit {
  color: #fff;
  background: var(--accent, #08766c);
  border: 1px solid var(--accent, #08766c);
}

.favorite-server-dialog-submit:disabled {
  cursor: wait;
  opacity: .65;
}

@media (max-width: 740px) {
  .favorite-server-dialog-backdrop {
    align-items: flex-end;
    padding: 0;
  }

  .favorite-server-dialog {
    width: 100%;
    max-height: calc(var(--ws-viewport-height, 100dvh) - env(safe-area-inset-top, 0px));
    padding: 22px 18px calc(18px + env(safe-area-inset-bottom, 0px));
    border-radius: 22px 22px 0 0;
  }

  .favorite-server-dialog-actions button {
    min-height: 46px;
  }
}
</style>
