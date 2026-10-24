<template>
  <section class="page-content server-page" data-admin-scope="webspeak">
    <div class="page-heading"><div><h2>{{ tr('adminInstanceSettings') }}</h2><p>{{ tr('adminInstanceLead') }}</p></div>
      <button class="primary-button" type="button" :disabled="serverSaving" @click="saveServerSettings">{{ serverSaving ? tr('saving') : tr('saveChanges') }}</button>
    </div>
    <div class="admin-scope-banner"><Icon name="waveform" :size="20"/><div><strong>{{ tr('adminWsGroup') }}</strong><p>{{ tr('adminWsScopeLead') }}</p></div></div>
    <nav class="admin-section-nav" :aria-label="tr('adminInstanceSettings')">
      <button v-for="section in sections" :key="section.id" type="button" :aria-current="activeSection === section.id ? 'page' : undefined" @click="activeSection = section.id">{{ section.label }}</button>
    </nav>
    <div v-show="activeSection === 'access'" class="settings-grid admin-settings-section" data-admin-section="access">
      <article class="settings-card admin-setting-card"><header class="admin-card-heading"><h3>{{ tr('accessMode') }}</h3></header><div class="access-settings-layout"><fieldset class="access-mode-fieldset"
              ><legend>{{ tr("accessMode") }}</legend
              ><label
                class="choice"
                :class="{ selected: serverForm.accessMode === 'fixed' }"
                ><input
                  v-model="serverForm.accessMode"
                  type="radio"
                  value="fixed"
                /><span
                  ><strong>{{ tr("fixedMode") }}</strong
                  ><small>{{ tr("fixedModeLead") }}</small></span
                ></label
              ><label
                class="choice"
                :class="{ selected: serverForm.accessMode === 'open' }"
                ><input
                  v-model="serverForm.accessMode"
                  type="radio"
                  value="open"
                /><span
                  ><strong>{{ tr("openMode") }}</strong
                  ><small>{{ tr("openModeLead") }}</small></span
                ></label
              ></fieldset
            ></div></article>
      <article class="settings-card admin-setting-card"><header class="admin-card-heading"><h3>{{ tr('teamSpeakTarget') }}</h3><p>{{ tr('adminTargetScope') }}</p></header><div class="target-settings-layout">
            <div class="target-fields">
              <label
                ><span>{{ tr("serverAddress") }}</span
                ><input
                  v-model.trim="serverForm.address"
                  :placeholder="tr('serverPlaceholder')"
              /></label>
              <label
                ><span>{{ tr("serverPort") }}</span
                ><input
                  v-model.trim="serverForm.port"
                  inputmode="numeric"
                  type="text"
                  maxlength="5"
                  :placeholder="tr('serverPortPlaceholder')"
              /></label>
            </div>
            <div class="password-row">
              <label
                ><span>{{ tr("serverPassword") }}</span
                ><input
                  v-model="serverForm.serverPassword"
                  type="password"
                  autocomplete="off"
                  :disabled="serverForm.passwordAction !== 'replace'"
                  :placeholder="
                    serverForm.hasPassword ? tr('passwordConfigured') : tr('optionalPassword')
                  "
              /></label>
              <div class="password-actions"
                ><button
                  type="button"
                  :class="{ active: serverForm.passwordAction === 'replace' }"
                  @click="serverForm.passwordAction = 'replace'"
                  >{{ tr("change") }}</button
                ><button
                  v-if="serverForm.hasPassword"
                  type="button"
                  :class="{ danger: serverForm.passwordAction === 'remove' }"
                  @click="serverForm.passwordAction = 'remove'"
                  >{{ tr("remove") }}</button
                ></div
              >
            </div>
            <button
              class="secondary-button target-test-button"
              type="button"
              :disabled="testing"
              @click="testServerConnection"
              ><span
                v-if="testing"
                class="spinner small"
              ></span
              ><Icon
                v-else
                name="activity"
                :size="17"
              />{{ testing ? tr("testing") : tr("testConnection") }}</button
            >
            <div
              v-if="testResult"
              :class="['test-result', 'target-test-result', testResult.ok ? 'success' : 'error']"
              ><Icon
                :name="testResult.ok ? 'check' : 'close'"
                :size="18"
              /><div
                ><strong>{{ testResultTitle }}</strong
                ><small>{{ testResultText }}</small></div
              ></div
            >
            <div class="target-runtime-block"
              ><h4>{{ tr("runtimeFacts") }}</h4
              ><dl class="target-runtime-facts"
                ><div
                  ><dt>{{ tr("lastTest") }}</dt
                  ><dd>{{ formatDate(serverForm.lastTestAt) }}</dd></div
                ><div
                  ><dt>{{ tr("latency") }}</dt
                  ><dd>{{
                    serverForm.lastTestLatencyMs == null
                      ? "—"
                      : `${serverForm.lastTestLatencyMs} ms`
                  }}</dd></div
                ><div
                  ><dt>{{ tr("internalPort") }}</dt
                  ><dd>3040</dd></div
                ></dl
              ></div
            >
          </div></article>
    </div>
    <article v-show="activeSection === 'site'" class="settings-card admin-setting-card admin-settings-section" data-admin-section="site"><header class="admin-card-heading"><h3>{{ tr('adminSiteSection') }}</h3><p>{{ tr('adminSiteScope') }}</p></header><div class="site-identity-fields">
              <label
                ><span>{{ tr("siteName") }}</span
                ><input
                  v-model.trim="serverForm.siteName"
                  maxlength="80"
              /></label>
              <div class="welcome-editor"
                ><div class="welcome-editor-heading"
                  ><label
                    ><span>{{ tr("adminAnnouncementLanguage") }}</span
                    ><select v-model="welcomeLanguage"
                      ><option
                        v-for="option in welcomeLanguageOptions"
                        :key="option.value"
                        :value="option.value"
                        >{{ option.label }}</option
                      ></select
                    ></label
                  ><small>{{ tr("welcomeLanguageHint") }}</small></div
                ><label
                  ><span>{{ tr("adminSiteAnnouncement") }} · {{ selectedWelcomeLanguageLabel }}</span
                  ><textarea
                    v-model="selectedWelcomeText"
                    maxlength="500"
                    rows="4"
                    :placeholder="selectedWelcomeDefault"
                  ></textarea></label
                ><small class="field-help">{{ tr("adminAnnouncementFallback") }}</small></div
              >
            </div></article>
    <article v-show="activeSection === 'network'" class="settings-card admin-setting-card admin-settings-section" data-admin-section="network"><header class="admin-card-heading"><h3>{{ tr('adminNetworkSection') }}</h3><p>{{ tr('advancedSettingsLead') }}</p></header><div class="advanced-settings-grid">
            <section class="settings-subsection webrtc-card"
              ><header class="settings-subsection-heading"
                ><div
                  ><h4>{{ tr("webrtcSettings") }}</h4
                  ><p class="card-help">{{ tr("webrtcLead") }}</p></div
                ></header
              ><label
                class="choice toggle-choice"
                :class="{ selected: serverForm.webRtcEnabled }"
                ><input
                  v-model="serverForm.webRtcEnabled"
                  type="checkbox"
                  @change="handleWebRtcToggle"
                /><span
                  ><strong>{{ tr("webrtcEnabled") }}</strong
                  ><small>{{ tr("webrtcEnabledLead") }}</small></span
                ></label
              ><div class="webrtc-port-fields"
                ><div class="port-fields-heading"
                  ><strong>{{ tr("webrtcPortRange") }}</strong
                  ><small>{{ tr("webrtcPortRangeLead") }}</small></div
                ><div class="port-inputs"
                  ><label
                    ><span>{{ tr("webrtcPortStart") }}</span
                    ><input
                      v-model.number="serverForm.webRtcUdpStart"
                      type="number"
                      inputmode="numeric"
                      min="1024"
                      max="65535"
                      :disabled="serverForm.webRtcEnabled" /></label
                  ><label
                    ><span>{{ tr("webrtcPortEnd") }}</span
                    ><input
                      v-model.number="serverForm.webRtcUdpEnd"
                      type="number"
                      inputmode="numeric"
                      min="1024"
                      max="65535"
                      :disabled="serverForm.webRtcEnabled" /></label></div></div
              ><label class="webrtc-network-field">
                <span>{{ tr("webrtcPublicHost") }}</span>
                <input v-model="serverForm.webRtcPublicHost" type="text" maxlength="253" autocomplete="off" :spellcheck="false" placeholder="media.example.com" />
                <small class="field-help">{{ tr("webrtcPublicHostLead") }}</small>
              </label>
              <label class="choice toggle-choice" :class="{ selected: serverForm.webRtcIpv6Enabled }">
                <input v-model="serverForm.webRtcIpv6Enabled" type="checkbox" />
                <span><strong>{{ tr("webrtcIpv6") }}</strong><small>{{ tr("webrtcIpv6Lead") }}</small></span>
              </label>
              <label class="webrtc-network-field">
                <span>{{ tr("webrtcStunServer") }}</span>
                <input v-model="serverForm.webRtcStunServer" type="text" maxlength="300" autocomplete="off" :spellcheck="false" placeholder="stun:turn.teamspeak.com:3478" />
                <small class="field-help">{{ tr("webrtcStunServerLead") }}</small>
              </label>
              <small class="field-help">{{ tr("webrtcApplyHint") }}</small></section
            >
            <section class="settings-subsection relay-card"
              ><header class="settings-subsection-heading"
                ><div
                  ><h4>{{ tr("relaySettings") }}</h4
                  ><p class="card-help">{{ tr("relaySettingsLead") }}</p></div
                ></header
              ><div
                v-if="!serverForm.relayNodes.length"
                class="relay-empty"
                >{{ tr("relayNodeEmpty") }}</div
              ><div class="relay-node-list"
                ><div
                  v-for="(relay, index) in serverForm.relayNodes"
                  :key="relay.id"
                  class="relay-node"
                  ><div class="relay-node-heading"
                    ><label class="relay-enabled"
                      ><input
                        v-model="relay.enabled"
                        type="checkbox"
                      /><strong>{{ relay.name || tr("relayUnnamed") }}</strong></label
                    ><button
                      class="text-danger"
                      type="button"
                      @click="removeRelayNode(index)"
                      >{{ tr("remove") }}</button
                    ></div
                  ><div class="relay-fields"
                    ><label
                      ><span>{{ tr("relayName") }}</span
                      ><input
                        v-model.trim="relay.name"
                        maxlength="80"
                        :placeholder="tr('relayNamePlaceholder')" /></label
                    ><label
                      ><span>{{ tr("relayTarget") }}</span
                      ><input
                        v-model.trim="relay.target"
                        maxlength="300"
                        :placeholder="tr('relayTargetPlaceholder')" /></label
                    ><label
                      ><span>{{ tr("relayVoiceEndpoint") }}</span
                      ><input
                        v-model.trim="relay.voiceEndpoint"
                        maxlength="300"
                        :placeholder="tr('relayVoiceEndpointPlaceholder')" /></label
                    ><div class="password-row"
                      ><label
                        ><span>{{ tr("relayToken") }}</span
                        ><input
                          v-model="relay.token"
                          type="password"
                          autocomplete="off"
                          :disabled="relay.tokenAction !== 'replace'"
                          :placeholder="
                            relay.hasToken
                              ? tr('relayTokenConfigured')
                              : tr('relayTokenPlaceholder')
                          " /></label
                      ><div class="password-actions"
                        ><button
                          type="button"
                          :class="{ active: relay.tokenAction === 'replace' }"
                          @click="relay.tokenAction = 'replace'"
                          >{{ tr("change") }}</button
                        ><button
                          v-if="relay.hasToken"
                          type="button"
                          :class="{ danger: relay.tokenAction === 'remove' }"
                          @click="relay.tokenAction = 'remove'"
                          >{{ tr("remove") }}</button
                        ></div
                      ></div
                    ></div
                  ></div
                ></div
              ><button
                class="secondary-button relay-add"
                type="button"
                @click="addRelayNode"
                >{{ tr("relayAdd") }}</button
              ><small class="field-help">{{ tr("relayVoiceEndpointLead") }}</small
              ><small class="field-help">{{ tr("relayManagedHint") }}</small></section
            >
          </div></article>
    <p class="admin-save-scope"><Icon name="info" :size="15"/>{{ tr('adminSaveScope') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "../Icon.vue";
import type { useAdminServerSettings } from "../../composables/useAdminServerSettings.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";
import type { AdminTranslationKey } from "../../i18n/admin.js";
import { DEFAULT_WELCOME_TEXTS, type SiteLanguage } from "../../../../src/site-copy.js";

type WelcomeLanguage = SiteLanguage;
type WelcomeTextField = "welcomeText" | "welcomeTextEn" | "welcomeTextDe" | "welcomeTextRu" | "welcomeTextJa";
const props = defineProps<{
  model: ReturnType<typeof useAdminServerSettings>;
  initialSection?: string;
  i18n: Pick<ReturnType<typeof useAdminI18n>, "tr" | "formatDate" | "connectionFailureText">;
}>();
const welcomeLanguage = defineModel<WelcomeLanguage>("welcomeLanguage", { required: true });
const emit = defineEmits<{ webrtcToggle: [] }>();
// The page owns one stable feature controller across route changes.
const { serverForm, serverSaving, testing, testResult, saveServerSettings, testServerConnection, addRelayNode, removeRelayNode } = props.model;
const { tr, formatDate, connectionFailureText } = props.i18n;
type SettingsSection = 'access' | 'site' | 'network';
const normalizeSection = (value?: string): SettingsSection => value === 'site' || value === 'network' ? value : 'access';
const activeSection = ref<SettingsSection>(normalizeSection(props.initialSection));
watch(() => props.initialSection, value => { activeSection.value = normalizeSection(value); });
const sections = computed(() => [
  { id: 'access' as const, label: tr('adminAccessSection') },
  { id: 'site' as const, label: tr('adminSiteSection') },
  { id: 'network' as const, label: tr('adminNetworkSection') },
]);

function handleWebRtcToggle() { emit("webrtcToggle"); }

const welcomeLanguageOptions: Array<{ value: WelcomeLanguage; label: string }> = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "ru", label: "Русский" },
  { value: "ja", label: "日本語" },
];

const welcomeTextFieldByLanguage: Record<WelcomeLanguage, WelcomeTextField> = {
  zh: "welcomeText",
  en: "welcomeTextEn",
  de: "welcomeTextDe",
  ru: "welcomeTextRu",
  ja: "welcomeTextJa",
};

const selectedWelcomeText = computed<string>({
  get: () => serverForm[welcomeTextFieldByLanguage[welcomeLanguage.value]],
  set: (value: string) => { serverForm[welcomeTextFieldByLanguage[welcomeLanguage.value]] = value; },
});
const selectedWelcomeLanguageLabel = computed(() => welcomeLanguageOptions.find((option) => option.value === welcomeLanguage.value)?.label ?? "");
const selectedWelcomeDefault = computed(() => serverForm.welcomeDefaults[welcomeLanguage.value] || DEFAULT_WELCOME_TEXTS[welcomeLanguage.value]);

const testResultTitle = computed(() => {
  const result = testResult.value;
  if (!result) return "";
  if (result.ok) return result.checkType === "network" ? tr("networkReachable") : tr("connectionReady");
  const names: Record<string, AdminTranslationKey> = {
    INVALID_TARGET: "serverAddress",
    INVALID_NICKNAME: "invalidNicknameError",
    HOST_NOT_FOUND: "hostNotFoundError",
    UNREACHABLE: "networkUnreachableError",
    CONNECTION_REFUSED: "connectionRefusedError",
    CONNECTION_RESET: "connectionResetError",
    TIMEOUT: "networkTimeoutError",
    PASSWORD_REQUIRED: "serverPasswordRequiredError",
    INVALID_PASSWORD: "invalidServerPasswordError",
    PROTOCOL_NEGOTIATION_FAILED: "protocolFailureError",
    SERVER_REJECTED: "serverRejectedError",
    PING_UNAVAILABLE: "pingUnavailableError",
  };
  return tr(names[result.code ?? result.errorCode ?? ""] ?? "connectionFailed");
});
const testResultText = computed(() => { if (!testResult.value) return ""; const result = testResult.value; const toolUnavailable = result.errorCode === "PING_UNAVAILABLE"; const loss = toolUnavailable || result.packetLossPercent == null ? null : `${tr('packetLoss')} ${result.packetLossPercent}%`; if (!result.ok) return [connectionFailureText(result.code ?? result.errorCode), loss].filter(Boolean).join(" · "); if (result.checkType === "network") return [tr("networkReachableHint"), result.latencyMs == null ? null : `${result.latencyMs} ms`, loss].filter(Boolean).join(" · "); return [result.serverName, result.latencyMs == null ? null : `${result.latencyMs} ms`, loss].filter(Boolean).join(" · "); });
</script>
