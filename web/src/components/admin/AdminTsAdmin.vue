<template>
  <section class="page-content ts-admin-page" data-admin-scope="teamspeak">
    <div class="page-heading"><div><h2>{{ tr('tsAdminTitle') }}</h2><p>{{ tr('tsAdminLead') }}</p></div><span class="admin-optional">{{ tr('adminOptional') }}</span></div>
    <div class="admin-scope-banner"><Icon name="shield" :size="20"/><div><strong>{{ tr('adminTsGroup') }}</strong><p>{{ tr('adminTsManageLead') }}</p></div></div>
    <div v-if="!settings.fixedMode" class="alert info admin-fixed-notice"><Icon name="info" :size="18"/><div><p>{{ tr('tsAdminFixedOnly') }}</p><RouterLink to="/admin/server">{{ tr('adminInstanceSettings') }}</RouterLink></div></div>
    <template v-else>
      <div v-if="noticeMessage" class="alert success" role="status">{{ noticeMessage }}</div>
      <div v-if="refreshWarning" class="alert info" role="status">{{ refreshWarning }}</div>
      <article v-if="!settings.enabled && !loading" class="operation-card admin-ts-setup">
        <Icon name="server" :size="26"/><div><h3>{{ tr('adminTsSetupTitle') }}</h3><p>{{ tr('adminTsSetupLead') }}</p></div>
        <button class="secondary-button" type="button" @click="configureConnection">{{ tr('adminTsConfigure') }}</button>
      </article>
      <details ref="connectionPanel" class="operation-card ts-admin-credentials" :open="connectionOpen" @toggle="connectionOpen = ($event.target as HTMLDetailsElement).open">
        <summary><Icon name="chevron-right" :size="18"/><div><strong>{{ tr('adminTsConnection') }}</strong><small>{{ settings.enabled ? tr('adminTsConfigured') : tr('adminTsNotEnabled') }}</small></div><span class="state-pill">{{ settings.enabled ? settings.transport === 'web' ? tr('tsAdminWeb') : settings.transport === 'ssh' ? tr('tsAdminSsh') : tr('tsAdminTcp') : tr('adminOptional') }}</span></summary>
        <div class="admin-connection-body"><p class="field-help">{{ tr('adminTsConnectionScope') }}</p>
        <form class="ts-admin-form" @submit.prevent="saveSettings">
          <fieldset :disabled="loading || saving || acting || connecting">
            <label class="choice ts-admin-enable" :class="{ selected: form.enabled }"><input v-model="form.enabled" type="checkbox" />
              <span><strong>{{ tr('tsAdminEnable') }}</strong><small>{{ tr('tsAdminEnableLead') }}</small></span></label>
            <div class="ts-admin-fields">
              <label><span>{{ tr('adminTsSavedTarget') }}</span><input :value="`${targetAddress} · ${targetPort}`" readonly /></label>
              <label><span>{{ tr('tsAdminTransport') }}</span><select v-model="form.transport"><option value="web">{{ tr('tsAdminWeb') }}</option><option value="ssh">{{ tr('tsAdminSsh') }}</option><option value="tcp">{{ tr('tsAdminTcp') }}</option></select></label>
              <label v-if="form.transport === 'web'" class="ts-admin-wide"><span>{{ tr('tsAdminUrl') }}</span><input v-model.trim="form.webQueryUrl" type="url" maxlength="2048" placeholder="https://ts.example.com:10443" :required="form.enabled" /></label>
              <template v-else>
                <label><span>{{ tr('tsAdminHost') }}</span><input v-model.trim="form.queryHost" maxlength="253" :placeholder="targetAddress" /></label>
                <label><span>{{ tr('tsAdminQueryPort') }}</span><input v-model.trim="form.queryPort" type="number" min="1" max="65535" required /></label>
                <label><span>{{ tr('tsAdminUsername') }}</span><input v-model.trim="form.username" autocomplete="username" maxlength="128" :required="form.enabled" /></label>
                <label v-if="form.transport === 'ssh'"><span>{{ tr('tsAdminHostKey') }}</span><input v-model.trim="form.hostKeyFingerprint" maxlength="128" placeholder="SHA256:…" :required="form.enabled" /></label>
              </template>
              <label><span>{{ tr('tsAdminServerId') }}</span><input v-model.number="form.serverId" type="number" min="0" max="4294967295" required /></label>
            </div>
            <p class="field-help">{{ tr('tsAdminServerIdHelp') }}</p>
            <template v-if="form.transport === 'web'">
              <div class="ts-admin-password-row"><label><span>{{ tr('tsAdminApiKey') }}</span><input v-model="form.apiKey" type="password" autocomplete="new-password" maxlength="4096" :disabled="form.apiKeyAction !== 'replace'" :placeholder="settings.hasApiKey ? tr('tsAdminApiKeyConfigured') : ''" :required="form.enabled && form.apiKeyAction === 'replace'" /></label>
                <button type="button" :class="{active: form.apiKeyAction === 'replace'}" @click="form.apiKeyAction = 'replace'">{{ tr('tsAdminSetKey') }}</button>
                <button v-if="settings.hasApiKey" type="button" :class="{danger: form.apiKeyAction === 'remove'}" @click="form.apiKeyAction = form.apiKeyAction === 'remove' ? 'keep' : 'remove'">{{ form.apiKeyAction === 'remove' ? tr('tsAdminKeepKey') : tr('tsAdminRemoveKey') }}</button></div>
              <p class="field-help">{{ tr('tsAdminWebHelp') }}</p><p class="field-help">{{ tr('tsAdminKeyHelp') }}</p>
            </template>
            <template v-else>
              <div class="ts-admin-password-row"><label><span>{{ tr('tsAdminPassword') }}</span><input v-model="form.password" type="password" autocomplete="new-password" maxlength="1024" :disabled="form.passwordAction !== 'replace'" :placeholder="settings.hasPassword ? tr('tsAdminPasswordConfigured') : tr('tsAdminPasswordPlaceholder')" /></label>
                <button type="button" :class="{active: form.passwordAction === 'replace'}" @click="form.passwordAction = 'replace'">{{ settings.hasPassword ? tr('change') : tr('tsAdminSetPassword') }}</button>
                <button v-if="settings.hasPassword" type="button" :class="{danger: form.passwordAction === 'remove'}" @click="form.passwordAction = form.passwordAction === 'remove' ? 'keep' : 'remove'">{{ form.passwordAction === 'remove' ? tr('tsAdminKeepPassword') : tr('remove') }}</button></div>
              <p class="field-help">{{ tr('tsAdminHostHelp') }}</p><p v-if="form.transport === 'ssh'" class="field-help">{{ tr('tsAdminFingerprintHint') }}</p>
            </template>
            <div class="ts-admin-actions"><button class="primary-button" type="submit"><span v-if="saving" class="spinner small"></span>{{ saving ? tr('saving') : tr('saveChanges') }}</button></div>
          </fieldset>
        </form>
        </div>
      </details>
      <div v-if="settingsDirty" class="alert info" role="status"><Icon name="info" :size="18"/><span>{{ tr('adminTsConfigPending') }}</span></div>
      <article v-if="settings.enabled" class="operation-card ts-admin-live">
        <header><div><h3>{{ tr('tsAdminLiveTitle') }}</h3><p>{{ overview ? tr('tsAdminUpdatedAt', {time: formatDate(overview.observedAt)}) : tr('adminTsConfigurationSaved') }}</p></div>
          <button class="secondary-button" type="button" :disabled="loading || connecting || saving || acting || settingsDirty" @click="connectAndRefresh"><span v-if="connecting" class="spinner small"></span>{{ connecting ? tr('tsAdminConnecting') : overview ? tr('refresh') : tr('tsAdminConnect') }}</button></header>
        <div v-if="!overview" class="operation-empty"><Icon name="server" :size="22"/><span>{{ tr('tsAdminEmpty') }}</span></div>
        <template v-if="overview">
          <nav class="admin-section-nav" :aria-label="tr('tsAdminTitle')"><button v-for="section in sections" :key="section.id" type="button" :aria-current="activeSection === section.id ? 'page' : undefined" @click="activeSection = section.id">{{ section.label }}<span v-if="section.count !== undefined" class="admin-tab-count">{{ section.count }}</span></button></nav>
          <article v-if="editor.action" ref="editorPanel" class="operation-card ts-admin-editor" :aria-label="actionTitle">
          <header><div><h3>{{ actionTitle }}</h3><p>{{ tr('tsAdminActionHelp') }}</p></div></header>
          <form class="ts-admin-form" @submit.prevent="runAction"><fieldset :disabled="acting || saving || settingsDirty || loading">
            <p v-if="editor.targetName" class="ts-admin-selected-target">{{ editor.targetName }} <small>#{{ editor.id }}</small></p>
            <div class="ts-admin-fields">
              <label v-if="['server.update','channel.create','channel.update'].includes(editor.action)"><span>{{ editor.action === 'server.update' ? tr('tsAdminServer') : tr('tsAdminChannelName') }}</span><input v-model="editor.name" :maxlength="editor.action === 'server.update' ? 64 : 40" required /></label>
              <template v-if="editor.action === 'server.update'"><label><span>{{ tr('tsAdminSlots') }}</span><input v-model.number="editor.maxClients" type="number" min="1" max="65535" required /></label><label class="ts-admin-wide"><span>{{ tr('tsAdminWelcome') }}</span><textarea v-model="editor.welcomeMessage" maxlength="4096" rows="3"></textarea></label></template>
              <template v-if="editor.action === 'channel.create'">
                <label><span>{{ tr('tsAdminParent') }}</span><select v-model="editor.parentId"><option value="0">{{ tr('tsAdminRoot') }}</option><option v-for="channel in overview?.channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select></label>
                <label class="ts-admin-wide"><span>{{ tr('tsAdminDescription') }}</span><textarea v-model="editor.description" maxlength="8192" rows="3"></textarea></label>
                <label><span>{{ tr('tsAdminChannelPassword') }}</span><input v-model="editor.password" type="password" autocomplete="new-password" maxlength="512" /></label><label class="choice"><input v-model="editor.permanent" type="checkbox" /><span>{{ tr('tsAdminPermanent') }}</span></label>
              </template>
              <label v-if="editor.action === 'client.move'"><span>{{ tr('tsAdminChannel') }}</span><select v-model="editor.channelId" required><option v-for="channel in overview?.channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select></label>
              <template v-if="editor.action === 'client.group'"><label><span>{{ tr('tsAdminGroup') }}</span><select v-model="editor.groupId" required><option v-for="group in overview?.groups" :key="group.id" :value="group.id">{{ group.name }} (#{{ group.id }})</option></select></label><label class="choice"><input v-model="editor.remove" type="checkbox" /><span>{{ tr('tsAdminRemoveGroup') }}</span></label></template>
              <label v-if="editor.action === 'client.kick' || editor.action === 'client.ban'"><span>{{ tr('tsAdminReason') }}</span><input v-model="editor.reason" maxlength="200" /></label>
              <label v-if="editor.action === 'client.ban'"><span>{{ tr('tsAdminBanDuration') }}</span><input v-model.number="editor.durationSeconds" type="number" min="0" max="31536000" required /></label>
            </div>
            <p v-if="editor.action === 'channel.delete'" class="field-help">{{ tr('tsAdminDeleteHelp') }}</p><p v-if="editor.action === 'client.ban'" class="field-help">{{ tr('tsAdminBanHelp') }}</p>
            <div class="ts-admin-toolbar"><button class="primary-button" type="submit"><span v-if="acting" class="spinner small"></span>{{ tr('tsAdminConfirm') }}</button><button class="secondary-button" type="button" @click="closeAction">{{ tr('tsAdminCancel') }}</button></div>
          </fieldset></form>
        </article>
          <section v-show="activeSection === 'overview'" data-admin-section="overview" class="admin-ts-section">
                      <div class="metric-grid ts-admin-metrics"><article><small>{{ tr('tsAdminServer') }}</small><strong>{{ overview.serverName || '—' }}</strong><em>{{ overview.serverVersion || overview.serverFamily }}</em></article>
            <article><small>{{ tr('tsAdminChannels') }}</small><strong>{{ overview.channelCount }}</strong></article><article><small>{{ tr('tsAdminClients') }}</small><strong>{{ overview.clientCount }} / {{ overview.maxClients || '—' }}</strong></article></div>

            <div class="ts-admin-toolbar"><button type="button" class="secondary-button" :disabled="loading || saving || acting || settingsDirty" @click="beginAction('server.update')">{{ tr('tsAdminServerSettings') }}</button></div>
          </section>
          <div v-show="activeSection === 'channels'" data-admin-section="channels" class="admin-ts-section">
            <div class="ts-admin-toolbar"><button type="button" class="primary-button" :disabled="loading || saving || acting || settingsDirty" @click="beginAction('channel.create')"><Icon name="plus" :size="16"/>{{ tr('tsAdminCreateChannel') }}</button></div>
            <section class="operation-card"><header><h3>{{ tr('tsAdminChannels') }}</h3><strong>{{ overview.channels.length }}</strong></header><div class="table-wrap" role="region" tabindex="0" :aria-label="tr('tsAdminChannels')"><table><thead><tr><th>{{ tr('tsAdminChannelName') }}</th><th>{{ tr('tsAdminMembers') }}</th><th>{{ tr('tsAdminChannelType') }}</th><th>{{ tr('tsAdminTitle') }}</th></tr></thead><tbody>
              <tr v-for="channel in overview.channels" :key="channel.id"><td><strong>{{ channel.name }}</strong><small>#{{ channel.id }}</small></td><td>{{ channel.totalClients }}</td><td>{{ channel.hasPassword ? tr('tsAdminProtected') : tr('tsAdminPublic') }}</td><td><div class="ts-admin-row-actions"><button type="button" :disabled="settingsDirty || loading || saving || acting" @click="beginAction('channel.update', channel)">{{ tr('tsAdminRenameChannel') }}</button><button class="danger" type="button" :disabled="settingsDirty || loading || saving || acting" @click="beginAction('channel.delete', channel)">{{ tr('tsAdminDeleteChannel') }}</button></div></td></tr>
              <tr v-if="!overview.channels.length"><td colspan="4">{{ tr('tsAdminNoChannels') }}</td></tr></tbody></table></div></section>
          </div>
          <div v-show="activeSection === 'clients'" data-admin-section="clients" class="admin-ts-section">
            <p v-if="!overview.groupsAvailable" class="field-help">{{ tr('tsAdminGroup') }}: {{ listErrorText(overview.groupsErrorCode) }}</p>
            <section class="operation-card"><header><h3>{{ tr('tsAdminClients') }}</h3><strong>{{ overview.clients.length }}</strong></header><div class="table-wrap" role="region" tabindex="0" :aria-label="tr('tsAdminClients')"><table><thead><tr><th>{{ tr('nickname') }}</th><th>{{ tr('tsAdminChannel') }}</th><th>{{ tr('tsAdminGroup') }}</th><th>{{ tr('tsAdminTitle') }}</th></tr></thead><tbody>
              <tr v-for="client in overview.clients" :key="client.id"><td><strong>{{ client.nickname }}</strong><small>#{{ client.id }}</small></td><td>{{ channelNames.get(client.channelID) || client.channelID }}</td><td>{{ client.serverGroups.map(id => groupNames.get(id) || id).join(', ') || '—' }}</td><td><div class="ts-admin-row-actions"><button type="button" :disabled="settingsDirty || loading || saving || acting || !client.uid" @click="beginAction('client.move', client)">{{ tr('tsAdminMove') }}</button><button type="button" :disabled="settingsDirty || loading || saving || acting || !client.uid || !overview.groupsAvailable" @click="beginAction('client.group', client)">{{ tr('tsAdminGroupAction') }}</button><button class="danger" type="button" :disabled="settingsDirty || loading || saving || acting || !client.uid" @click="beginAction('client.kick', client)">{{ tr('tsAdminKick') }}</button><button class="danger" type="button" :disabled="settingsDirty || loading || saving || acting || !client.uid" @click="beginAction('client.ban', client)">{{ tr('tsAdminBan') }}</button></div></td></tr>
              <tr v-if="!overview.clients.length"><td colspan="4">{{ tr('tsAdminNoClients') }}</td></tr></tbody></table></div></section>
          </div>
          <div v-show="activeSection === 'bans'" data-admin-section="bans" class="admin-ts-section"><section class="operation-card"><header><h3>{{ tr('tsAdminBans') }}</h3><strong>{{ overview.bans.length }}</strong></header><p v-if="!overview.bansAvailable" class="field-help">{{ listErrorText(overview.bansErrorCode) }}</p><div v-else class="table-wrap"><table><thead><tr><th>{{ tr('nickname') }} / UID</th><th>{{ tr('tsAdminReason') }}</th><th>{{ tr('tsAdminBanDuration') }}</th><th>{{ tr('tsAdminTitle') }}</th></tr></thead><tbody><tr v-for="ban in overview.bans" :key="ban.id"><td>{{ ban.name || ban.uid || `#${ban.id}` }}</td><td>{{ ban.reason || '—' }}</td><td>{{ ban.durationSeconds }}</td><td><button type="button" class="secondary-button" :disabled="settingsDirty || loading || saving || acting" @click="beginAction('ban.delete', ban)">{{ tr('remove') }}</button></td></tr><tr v-if="!overview.bans.length"><td colspan="4">{{ tr('tsAdminNoBans') }}</td></tr></tbody></table></div></section></div>
        </template>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import type { useAdminTsAdmin } from '../../composables/useAdminTsAdmin.js';
import type { useAdminI18n } from '../../composables/useAdminI18n.js';
import type { TsAdminAction } from '../../../../src/shared/admin-inputs.js';
import type { AdminTranslationKey } from '../../i18n/admin.js';
import Icon from '../Icon.vue';
const props = defineProps<{ model: ReturnType<typeof useAdminTsAdmin>; i18n: Pick<ReturnType<typeof useAdminI18n>, 'tr' | 'formatDate'>; targetAddress: string; targetPort: string }>();
const {tr, formatDate} = props.i18n;
const {settings, form, editor, overview, settingsDirty, noticeMessage, refreshWarning, listErrorText, loading, saving, connecting, acting, saveSettings, connectAndRefresh, beginAction, closeAction, runAction} = props.model;
const connectionOpen = ref(false);
const connectionPanel = ref<HTMLDetailsElement | null>(null);
async function configureConnection() {
  connectionOpen.value = true;
  await nextTick();
  connectionPanel.value?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
}
type TsSection = 'overview' | 'channels' | 'clients' | 'bans';
const activeSection = ref<TsSection>('overview');
const sections = computed(() => [
  { id: 'overview' as const, label: tr('adminTsOverviewSection'), count: undefined },
  { id: 'channels' as const, label: tr('tsAdminChannels'), count: overview.value?.channelCount },
  { id: 'clients' as const, label: tr('tsAdminClients'), count: overview.value?.clientCount },
  { id: 'bans' as const, label: tr('tsAdminBans'), count: overview.value?.bansAvailable ? overview.value.bans.length : undefined },
]);
const channelNames = computed(() => new Map((overview.value?.channels ?? []).map(channel => [channel.id, channel.name])));
const groupNames = computed(() => new Map((overview.value?.groups ?? []).map(group => [group.id, group.name])));
const titles: Record<TsAdminAction['action'], AdminTranslationKey> = { 'server.update': 'tsAdminServerSettings', 'channel.create': 'tsAdminCreateChannel', 'channel.update': 'tsAdminRenameChannel', 'channel.delete': 'tsAdminDeleteChannel', 'client.move': 'tsAdminMove', 'client.kick': 'tsAdminKick', 'client.ban': 'tsAdminBan', 'client.group': 'tsAdminGroupAction', 'ban.delete': 'remove' };
const actionTitle = computed(() => editor.action ? tr(titles[editor.action]) : '');
const editorPanel = ref<HTMLElement | null>(null);
watch(() => editor.action, async action => { if (!action) return; await nextTick(); editorPanel.value?.scrollIntoView?.({block: 'nearest'}); editorPanel.value?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(); });
</script>
