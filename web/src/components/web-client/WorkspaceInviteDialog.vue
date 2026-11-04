<template>
    <div class="modal-backdrop workspace-invite-backdrop" data-ws-part="voice.invite.backdrop" @click.self="emit('close')">
      <section ref="dialog" class="channel-password-modal workspace-invite-dialog" data-ws-part="voice.invite.dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="workspace-invite-title" @keydown="onDialogKeydown">
        <button class="qq-modal-close" type="button" :aria-label="t('close')" @click="emit('close')">×</button>
        <h2 id="workspace-invite-title">{{ t('workspaceInviteTitle') }}</h2>
        <p>{{ t('workspaceInviteLead') }}</p>
        <form class="channel-password-form" data-ws-part="voice.invite.form" @submit.prevent="generate">
          <label>{{ t('workspaceInviteExpiry') }}<input v-model.number="minutes" type="number" min="1" max="43200" required :disabled="busy" /></label>
          <label>{{ t('workspaceInviteServerPassword') }}<input v-model="serverPassword" type="password" maxlength="512" autocomplete="off" :disabled="busy" /></label>
          <label>{{ t('workspaceInvitePassword') }}<input v-model="password" type="password" maxlength="512" autocomplete="off" :disabled="busy" /></label>
          <p v-if="error" role="alert">{{ error }}</p>
          <button class="primary-button" data-ws-part="voice.invite.create" type="submit" :disabled="busy">{{ t('workspaceInviteCreate') }}</button>
        </form>
        <div v-if="link" class="workspace-invite-result" aria-live="polite">
          <input :value="link" readonly :aria-label="t('workspaceInviteCopy')" @focus="($event.target as HTMLInputElement).select()" />
          <small>{{ t('workspaceInviteExpiresAt') }} {{ new Date(expiresAt).toLocaleString() }}</small>
          <button class="primary-button" data-ws-part="voice.invite.copy" type="button" @click="copy">{{ copied ? t('copiedToast') : t('workspaceInviteCopy') }}</button>
        </div>
      </section>
    </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useDialogFocus } from "../../composables/useDialogFocus.js";
const props = defineProps<{ t: (key: string) => string; create: (minutes: number, password: string, serverPassword: string) => Promise<{ token: string; expiresAt: number }> }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const { onDialogKeydown } = useDialogFocus(dialog, () => emit("close"));
const minutes = ref(1440), password = ref(""), serverPassword = ref(""), busy = ref(false), error = ref(""), link = ref(""), expiresAt = ref(0), copied = ref(false);
async function generate() {
  if (busy.value) return;
  busy.value = true; error.value = ""; link.value = ""; copied.value = false;
  try {
    const result = await props.create(minutes.value, password.value, serverPassword.value);
    const url = new URL("/", location.origin); url.searchParams.set("invite", result.token);
    link.value = url.toString(); expiresAt.value = result.expiresAt; password.value = ""; serverPassword.value = "";
  } catch { error.value = props.t("workspaceInviteError"); }
  finally { busy.value = false; }
}
async function copy() {
  try { await navigator.clipboard.writeText(link.value); copied.value = true; }
  catch { error.value = props.t("copyFailedToast"); }
}
</script>
<style scoped>
.workspace-invite-backdrop { z-index: 2147483000 !important; }
.workspace-invite-dialog .primary-button { width: 100%; min-height: 44px; padding: 10px 16px; font: inherit; font-weight: 600; border-radius: 10px; }
.workspace-invite-dialog { max-width: min(520px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; }
.workspace-invite-dialog h2 { color: inherit !important; }
.workspace-invite-dialog p { line-height: 1.6; }
.workspace-invite-dialog label, .workspace-invite-result { display: grid; gap: 10px; margin-block: 14px; }
.workspace-invite-dialog input { box-sizing: border-box; width: 100%; min-width: 0; padding: 11px 12px; border: 1px solid currentColor; border-radius: 10px; background: transparent; color: inherit; font: inherit; }
.workspace-invite-result small { overflow-wrap: anywhere; }
</style>
