<template>
  <div
    class="modal-backdrop channel-password-backdrop"
    data-ws-part="auth.password.backdrop"
    @click.self="emit('cancel')"
  >
    <section
      class="channel-password-modal"
      data-ws-part="auth.password.dialog"
      ref="dialog"
      tabindex="-1"
      @keydown="onDialogKeydown"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'channel-password-title'"
      @click.stop
    >
      <button
        type="button"
        class="qq-modal-close"
        :aria-label="t('close')"
        :title="t('close')"
        @click="emit('cancel')"
        ><Icon
          name="close"
          :size="19"
      /></button>
      <div class="channel-password-icon"
        data-ws-part="auth.password.decoration"
        ><Icon
          name="lock"
          :size="22"
      /></div>
      <span class="card-kicker" data-ws-part="auth.password.eyebrow">{{ t("channelPasswordPrompt") }}</span>
      <h2 id="channel-password-title" data-ws-part="auth.password.title">{{ t("channelPasswordTitle") }}</h2>
      <p data-ws-part="auth.password.lead">{{ t("channelPasswordLead") }}</p>
      <form
        class="channel-password-form"
        data-ws-part="auth.password.form"
        @submit.prevent="emit('submit')"
      >
        <label
          class="field-label"
          data-ws-part="auth.password.label"
          for="channel-password-input"
          >{{ t("channelPasswordPrompt") }}</label
        >
        <div class="field-wrap"
          data-ws-part="auth.password.field"
          ><Icon
            name="lock"
            data-ws-part="auth.password.field-icon"
            :size="17" /><input
            id="channel-password-input"
            v-model="password"
            type="password"
            autocomplete="current-password"
            :placeholder="t('channelPasswordPlaceholder')"
            :disabled="busy"
            autofocus
        /></div>
        <div
          v-if="error"
          class="notice error-notice channel-password-error"
          data-ws-part="auth.password.error"
          ><span class="notice-symbol">!</span><span>{{ error }}</span></div
        >
        <div class="channel-password-actions"
          data-ws-part="auth.password.actions"
          ><button
            type="button"
            class="text-button"
            :disabled="busy"
            @click="emit('cancel')"
            >{{ t("channelPasswordCancel") }}</button
          ><button
            type="submit"
            class="primary-button channel-password-submit"
            :disabled="busy || !password"
            ><span
              v-if="busy"
              class="button-spinner"
            ></span
            ><span>{{ t("channelPasswordSubmit") }}</span
            ><Icon
              v-if="!busy"
              name="chevron-right"
              :size="17" /></button
        ></div>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Icon from "../Icon.vue";
import { useDialogFocus } from "../../composables/useDialogFocus.js";

defineProps<{ busy: boolean; error: string; t: (key: string) => string }>();
const password = defineModel<string>({ required: true });
const emit = defineEmits<{ cancel: []; submit: [] }>();
const dialog = ref<HTMLElement | null>(null);
const { onDialogKeydown } = useDialogFocus(dialog, () => emit("cancel"));
</script>
