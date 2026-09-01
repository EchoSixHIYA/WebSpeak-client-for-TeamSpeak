<template>
  <div class="admin-root">
    <div v-if="loading" class="center-card compact"><span class="spinner"></span><p>{{ tr('loading') }}</p></div>

    <main v-else-if="screen === 'change-password'" class="login-page">
      <section class="login-card">
        <div class="admin-brand centered"><span><Icon name="waveform" :size="24" /></span><div><strong>WebSpeak</strong><small>{{ tr('adminConsole') }}</small></div></div>
        <header><h1>{{ tr('changePasswordTitle') }}</h1><p>{{ tr('changePasswordLead') }}</p></header>
        <form @submit.prevent="changePassword"><div v-if="errorMessage" class="alert error">{{ errorMessage }}</div><label><span>{{ tr('newPassword') }}</span><input v-model="newPassword" type="password" autocomplete="new-password" maxlength="1024" autofocus :placeholder="tr('passwordPlaceholder')" /></label><label><span>{{ tr('confirmPassword') }}</span><input v-model="confirmNewPassword" type="password" autocomplete="new-password" maxlength="1024" /></label><div class="strength"><i :style="{ width: `${passwordStrength}%` }"></i></div><button class="primary-button wide" :disabled="submitting" type="submit"><span v-if="submitting" class="spinner small"></span>{{ tr('savePassword') }}</button></form>
        <p class="security-note">{{ tr('defaultCredentialNotice') }}</p><button class="language-link" type="button" @click="toggleLanguage">{{ tr('languageSwitch') }}</button>
      </section>
    </main>

    <main v-else-if="screen === 'login'" class="login-page">
      <section class="login-card">
        <div class="admin-brand centered"><span><Icon name="waveform" :size="24" /></span><div><strong>WebSpeak</strong><small>{{ tr('adminConsole') }}</small></div></div>
        <header><h1>{{ tr('welcomeAdmin') }}</h1><p>{{ tr('loginLead') }}</p></header>
        <form @submit.prevent="login"><div v-if="errorMessage" class="alert error">{{ errorMessage }}</div><label><span>{{ tr('adminUsername') }}</span><input v-model.trim="loginUsername" autocomplete="username" autofocus /></label><label><span>{{ tr('adminPassword') }}</span><input v-model="loginPassword" type="password" autocomplete="current-password" /></label><button class="primary-button wide" :disabled="submitting" type="submit"><span v-if="submitting" class="spinner small"></span>{{ tr('login') }}</button></form>
        <button class="language-link" type="button" @click="toggleLanguage">{{ tr('languageSwitch') }}</button>
      </section>
    </main>

    <div v-else class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-brand"><span><Icon name="waveform" :size="22" /></span><div><strong>WebSpeak</strong><small>{{ tr('adminConsole') }}</small></div></div>
        <nav><RouterLink to="/admin" exact-active-class="active"><Icon name="activity" :size="18" />{{ tr('overview') }}</RouterLink><RouterLink to="/admin/server" active-class="active"><Icon name="server" :size="18" />{{ tr('server') }}</RouterLink></nav>
        <div class="sidebar-bottom"><a href="/" target="_blank"><Icon name="share" :size="16" />{{ tr('openGuest') }}</a><button type="button" @click="logout"><Icon name="door" :size="16" />{{ tr('logout') }}</button></div>
      </aside>

      <main class="admin-main">
        <header class="admin-topbar"><div><small>{{ tr('adminConsole') }}</small><h1>{{ currentPageTitle }}</h1></div><div><span class="running-dot"></span>{{ tr('gatewayRunning') }}<button type="button" @click="toggleLanguage">{{ tr('languageSwitch') }}</button></div></header>

        <div v-if="errorMessage" class="alert error page-alert">{{ errorMessage }}</div>
        <section v-if="route.path === '/admin/server'" class="page-content">
          <div class="page-heading"><div><h2>{{ tr('serverSettings') }}</h2><p>{{ tr('serverSettingsLead') }}</p></div><button class="primary-button" :disabled="submitting" @click="saveServerSettings">{{ submitting ? tr('saving') : tr('saveChanges') }}</button></div>
          <div class="settings-grid">
            <article class="settings-card"><h3>{{ tr('teamSpeakTarget') }}</h3><label><span>{{ tr('serverAddress') }}</span><input v-model.trim="serverForm.target" :placeholder="tr('serverPlaceholder')" /></label><div class="password-row"><label><span>{{ tr('serverPassword') }}</span><input v-model="serverForm.serverPassword" type="password" autocomplete="off" :disabled="serverForm.passwordAction !== 'replace'" :placeholder="serverForm.hasPassword ? tr('passwordConfigured') : tr('optionalPassword')" /></label><div class="password-actions"><button type="button" :class="{ active: serverForm.passwordAction === 'replace' }" @click="serverForm.passwordAction = 'replace'">{{ tr('change') }}</button><button v-if="serverForm.hasPassword" type="button" :class="{ danger: serverForm.passwordAction === 'remove' }" @click="serverForm.passwordAction = 'remove'">{{ tr('remove') }}</button></div></div><button class="secondary-button" type="button" :disabled="testing" @click="testServerConnection"><span v-if="testing" class="spinner small"></span><Icon v-else name="activity" :size="17" />{{ testing ? tr('testing') : tr('testConnection') }}</button><div v-if="testResult" :class="['test-result', testResult.ok ? 'success' : 'error']"><Icon :name="testResult.ok ? 'check' : 'close'" :size="18" /><div><strong>{{ testResult.ok ? tr('connectionReady') : tr('connectionFailed') }}</strong><small>{{ testResultText }}</small></div></div></article>
            <article class="settings-card"><h3>{{ tr('accessAndIdentity') }}</h3><fieldset><legend>{{ tr('accessMode') }}</legend><label class="choice"><input v-model="serverForm.accessMode" type="radio" value="fixed" /><span><strong>{{ tr('fixedMode') }}</strong><small>{{ tr('fixedModeLead') }}</small></span></label><label class="choice"><input v-model="serverForm.accessMode" type="radio" value="open" /><span><strong>{{ tr('openMode') }}</strong><small>{{ tr('openModeLead') }}</small></span></label></fieldset><label><span>{{ tr('siteName') }}</span><input v-model.trim="serverForm.siteName" maxlength="80" /></label><label><span>{{ tr('welcomeText') }}</span><textarea v-model="serverForm.welcomeText" maxlength="500" rows="4"></textarea></label></article>
          </div>
          <article class="readonly-card"><h3>{{ tr('runtimeFacts') }}</h3><dl><div><dt>{{ tr('detectedProtocol') }}</dt><dd>{{ serverForm.detectedProtocol?.toUpperCase() || tr('unknown') }}</dd></div><div><dt>{{ tr('lastTest') }}</dt><dd>{{ formatDate(serverForm.lastTestAt) }}</dd></div><div><dt>{{ tr('latency') }}</dt><dd>{{ serverForm.lastTestLatencyMs == null ? '—' : `${serverForm.lastTestLatencyMs} ms` }}</dd></div><div><dt>{{ tr('internalPort') }}</dt><dd>3040</dd></div></dl></article>
        </section>

        <section v-else class="page-content">
          <div v-if="overview.legacyConfigImported" class="alert info import-notice"><span>{{ tr('legacyImported') }}</span><button type="button" @click="dismissLegacyNotice">{{ tr('gotIt') }}</button></div>
          <div class="hero-status"><div><small>{{ tr('systemStatus') }}</small><h2>{{ tr('everythingRunning') }}</h2><p>{{ tr('overviewLead') }}</p></div><span class="status-badge"><i></i>{{ tr('running') }}</span></div>
          <div class="metric-grid"><article><span><Icon name="activity" :size="20" /></span><small>{{ tr('gateway') }}</small><strong>{{ overview.gateway.version || '—' }}</strong><em>{{ formatUptime(overview.gateway.uptimeSeconds) }}</em></article><article><span><Icon name="server" :size="20" /></span><small>{{ tr('teamSpeakTarget') }}</small><strong>{{ overview.teamSpeak.target || '—' }}</strong><em>{{ targetStatusText }}</em></article><article><span><Icon name="users" :size="20" /></span><small>{{ tr('activeSessions') }}</small><strong>{{ overview.sessions.active }} / {{ overview.sessions.limit }}</strong><em>{{ tr('peakSessions', { count: overview.sessions.peak }) }}</em></article></div>
          <div class="overview-columns"><article class="overview-card"><header><div><h3>{{ tr('targetHealth') }}</h3><p>{{ tr('targetHealthLead') }}</p></div><RouterLink to="/admin/server">{{ tr('manage') }}</RouterLink></header><dl><div><dt>{{ tr('status') }}</dt><dd><i :class="overview.teamSpeak.status"></i>{{ targetStatusText }}</dd></div><div><dt>{{ tr('detectedProtocol') }}</dt><dd>{{ overview.teamSpeak.protocol?.toUpperCase() || tr('unknown') }}</dd></div><div><dt>{{ tr('lastTest') }}</dt><dd>{{ formatDate(overview.teamSpeak.lastTestAt) }}</dd></div><div><dt>{{ tr('latency') }}</dt><dd>{{ overview.teamSpeak.latencyMs == null ? '—' : `${overview.teamSpeak.latencyMs} ms` }}</dd></div></dl></article><article class="overview-card"><header><div><h3>{{ tr('recentEvents') }}</h3><p>{{ tr('recentEventsLead') }}</p></div></header><ul class="event-list"><li v-for="event in overview.recentEvents" :key="`${event.event}-${event.createdAt}`"><span><Icon name="check" :size="14" /></span><div><strong>{{ eventName(event.event) }}</strong><small>{{ formatDate(event.createdAt) }}</small></div></li><li v-if="!overview.recentEvents.length" class="empty-event">{{ tr('noRecentEvents') }}</li></ul></article></div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import Icon from "../components/Icon.vue";

type Language = "zh" | "en";
type Screen = "login" | "change-password" | "admin";
type AccessMode = "fixed" | "open";
interface ProbeState { ok: boolean; protocol?: string | null; latencyMs?: number; serverName?: string | null; code?: string }

const route = useRoute();
const router = useRouter();
const language = ref<Language>((localStorage.getItem("webspeak:language") as Language) || "zh");
const loading = ref(true);
const screen = ref<Screen>("login");
const csrfToken = ref("");
const submitting = ref(false);
const testing = ref(false);
const errorMessage = ref("");
const loginUsername = ref("admin");
const loginPassword = ref("");
const newPassword = ref("");
const confirmNewPassword = ref("");
const testResult = ref<ProbeState | null>(null);

const serverForm = reactive({ target: "", serverPassword: "", passwordAction: "keep" as "keep" | "replace" | "remove", hasPassword: false, accessMode: "fixed" as AccessMode, siteName: "WebSpeak", welcomeText: "", detectedProtocol: null as string | null, lastTestAt: null as string | null, lastTestLatencyMs: null as number | null });
const overview = reactive({ gateway: { version: "", uptimeSeconds: 0 }, teamSpeak: { target: "", status: "unknown", protocol: null as string | null, lastTestAt: null as string | null, latencyMs: null as number | null }, sessions: { active: 0, peak: 0, limit: 100 }, recentEvents: [] as Array<{ event: string; createdAt: string }>, legacyConfigImported: false });

const copy = {
  zh: {
    loading: "正在载入管理控制台…",
    adminConsole: "管理控制台",
    changePasswordTitle: "首次登录需要修改密码",
    changePasswordLead: "默认密码仅用于首次登录。请设置一个至少 12 个字符的新管理员密码。",
    savePassword: "保存新密码",
    defaultCredentialNotice: "默认账号：admin，默认密码：admin。修改后旧密码将立即失效。",
    adminUsername: "管理员账号",
    newPassword: "新管理员密码",
    passwordPlaceholder: "至少 12 个字符",
    passwordHint: "建议使用长且唯一的密码。",
    confirmPassword: "确认管理员密码",
    languageSwitch: "English",
    welcomeAdmin: "欢迎回来",
    loginLead: "输入管理员账号和密码以管理此 WebSpeak 实例。",
    adminPassword: "管理员密码",
    login: "登录",
    overview: "概览",
    server: "服务器",
    openGuest: "打开访客页面",
    logout: "退出登录",
    gatewayRunning: "网关运行中",
    serverSettings: "服务器设置",
    serverSettingsLead: "管理默认 TeamSpeak 目标、访问策略和访客页面内容。",
    saving: "正在保存…",
    saveChanges: "保存更改",
    teamSpeakTarget: "默认 TeamSpeak 目标",
    serverAddress: "目标地址（服务器:端口）",
    serverPlaceholder: "例如 ts.example.com:9987",
    serverHint: "支持主机名、IPv4 与 [IPv6]:端口；不需要选择 TS3 或 TS6。",
    serverPassword: "服务器密码",
    optional: "可选",
    optionalPassword: "无密码则留空",
    passwordConfigured: "已配置密码（留空保持不变）",
    change: "修改",
    remove: "移除",
    testConnection: "测试连接",
    testing: "正在测试…",
    connectionReady: "连接成功",
    connectionFailed: "连接失败",
    accessAndIdentity: "访问与站点信息",
    accessMode: "访客访问模式",
    fixedMode: "仅限此 TeamSpeak 服务器",
    fixedModeLead: "访客只需填写昵称，目标和密码由 WebSpeak 管理。",
    openMode: "允许访客输入其他服务器",
    openModeLead: "访客可输入公网 TeamSpeak 地址；内网和保留地址会被阻止。",
    siteName: "站点显示名称",
    welcomeText: "欢迎文本",
    runtimeFacts: "运行时信息",
    detectedProtocol: "检测到的协议",
    lastTest: "最近测试",
    latency: "延迟",
    internalPort: "内部端口",
    unknown: "未知",
    legacyImported: "已导入旧 config.json。WebSpeak 现在由管理控制台管理，原文件不会再作为实时配置源。",
    gotIt: "知道了",
    systemStatus: "系统状态",
    everythingRunning: "WebSpeak 正常运行",
    overviewLead: "管理服务可用；TeamSpeak 可达性以最近一次连接测试为准。",
    running: "运行中",
    gateway: "网关",
    activeSessions: "活动会话",
    peakSessions: "本次启动峰值 {{count}}",
    targetHealth: "目标状态",
    targetHealthLead: "最近一次短连接测试的结果。",
    manage: "管理",
    status: "状态",
    recentEvents: "最近事件",
    recentEventsLead: "仅记录管理和系统事件，不包含聊天内容。",
    noRecentEvents: "暂无事件",
    reachable: "可连接",
    unreachable: "不可连接",
    notTested: "尚未测试",
    setupPasswordsMismatch: "两次输入的密码不一致。",
    setupPasswordShort: "管理员密码至少需要 12 个字符。",
    invalidPassword: "管理员密码错误。",
    rateLimited: "尝试次数过多，请稍后再试。",
    requestFailed: "请求失败，请检查输入后重试。",
    loginEvent: "管理员登录成功",
    logoutEvent: "管理员退出登录",
    settingsEvent: "服务器设置已更新",
    initializedEvent: "默认管理员账号已创建",
    importedEvent: "已导入旧配置",
    testEvent: "连接测试完成",
  },
  en: {
    loading: "Loading the admin console…",
    adminConsole: "Admin Console",
    changePasswordTitle: "Change the default password",
    changePasswordLead: "The default password is for first sign-in only. Set a new admin password with at least 12 characters.",
    savePassword: "Save new password",
    defaultCredentialNotice: "Default account: admin. Default password: admin. The old password expires immediately after you save.",
    adminUsername: "Admin username",
    newPassword: "New admin password",
    passwordPlaceholder: "At least 12 characters",
    passwordHint: "Use a long, unique password.",
    confirmPassword: "Confirm admin password",
    languageSwitch: "中文",
    welcomeAdmin: "Welcome back",
    loginLead: "Enter the admin account and password to manage this WebSpeak instance.",
    adminPassword: "Admin password",
    login: "Sign in",
    overview: "Overview",
    server: "Server",
    openGuest: "Open guest page",
    logout: "Log out",
    gatewayRunning: "Gateway running",
    serverSettings: "Server settings",
    serverSettingsLead: "Manage the default TeamSpeak target, access policy, and guest-facing content.",
    saving: "Saving…",
    saveChanges: "Save changes",
    teamSpeakTarget: "Default TeamSpeak target",
    serverAddress: "Target address (server:port)",
    serverPlaceholder: "e.g. ts.example.com:9987",
    serverHint: "Hostnames, IPv4 and [IPv6]:port are supported. TS3/TS6 is detected automatically.",
    serverPassword: "Server password",
    optional: "Optional",
    optionalPassword: "Leave blank when unused",
    passwordConfigured: "Password configured (leave blank to keep it)",
    change: "Change",
    remove: "Remove",
    testConnection: "Test connection",
    testing: "Testing…",
    connectionReady: "Connection ready",
    connectionFailed: "Connection failed",
    accessAndIdentity: "Access and site identity",
    accessMode: "Guest access mode",
    fixedMode: "Only this TeamSpeak server",
    fixedModeLead: "Guests enter only a nickname; WebSpeak manages the target and password.",
    openMode: "Allow other TeamSpeak servers",
    openModeLead: "Guests may enter public TeamSpeak addresses; private and reserved networks are blocked.",
    siteName: "Site display name",
    welcomeText: "Welcome text",
    runtimeFacts: "Runtime facts",
    detectedProtocol: "Detected protocol",
    lastTest: "Last test",
    latency: "Latency",
    internalPort: "Internal port",
    unknown: "Unknown",
    legacyImported: "Legacy config.json was imported. WebSpeak is now managed here and the old file is no longer a live configuration source.",
    gotIt: "Got it",
    systemStatus: "SYSTEM STATUS",
    everythingRunning: "WebSpeak is running",
    overviewLead: "The management service is available. TeamSpeak reachability reflects the latest connection test.",
    running: "Running",
    gateway: "Gateway",
    activeSessions: "Active sessions",
    peakSessions: "Peak this run: {{count}}",
    targetHealth: "Target health",
    targetHealthLead: "Result of the latest short-lived connection test.",
    manage: "Manage",
    status: "Status",
    recentEvents: "Recent events",
    recentEventsLead: "Only system and admin events are recorded; chat content is excluded.",
    noRecentEvents: "No recent events",
    reachable: "Reachable",
    unreachable: "Unreachable",
    notTested: "Not tested",
    setupPasswordsMismatch: "The two passwords do not match.",
    setupPasswordShort: "The admin password must be at least 12 characters.",
    invalidPassword: "The admin password is incorrect.",
    rateLimited: "Too many attempts. Try again later.",
    requestFailed: "The request failed. Check the fields and try again.",
    loginEvent: "Administrator signed in",
    logoutEvent: "Administrator signed out",
    settingsEvent: "Server settings changed",
    initializedEvent: "Default administrator account created",
    importedEvent: "Legacy configuration imported",
    testEvent: "Connection test completed",
  },
} as const;

function tr(key: keyof typeof copy.zh, vars: Record<string, string | number> = {}): string { let value: string = language.value === "zh" ? copy.zh[key] : copy.en[key] ?? copy.zh[key]; for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{{${name}}}`, String(replacement)); return value; }
const passwordStrength = computed(() => Math.min(100, Math.max(8, newPassword.value.length * 5 + (/[\s\W]/.test(newPassword.value) ? 15 : 0))));
const currentPageTitle = computed(() => route.path === "/admin/server" ? tr('server') : tr('overview'));
const testResultText = computed(() => { if (!testResult.value) return ""; if (!testResult.value.ok) return errorText(testResult.value.code); return [testResult.value.protocol?.toUpperCase(), testResult.value.serverName, testResult.value.latencyMs == null ? null : `${testResult.value.latencyMs} ms`].filter(Boolean).join(" · "); });
const targetStatusText = computed(() => overview.teamSpeak.status === "reachable" ? tr('reachable') : overview.teamSpeak.status === "unreachable" ? tr('unreachable') : tr('notTested'));

onMounted(loadAdminView);
watch(() => [serverForm.target, serverForm.serverPassword, serverForm.passwordAction], () => { if (!testing.value && screen.value === "admin") testResult.value = null; });

async function loadAdminView() { loading.value = true; try { const session = await getJson("/api/admin/session"); if (!session.authenticated) { screen.value = "login"; if (route.path !== "/admin/login") await router.replace("/admin/login"); } else if (session.mustChangePassword) { csrfToken.value = String(session.csrfToken || ""); screen.value = "change-password"; if (route.path !== "/admin/change-password") await router.replace("/admin/change-password"); } else { csrfToken.value = String(session.csrfToken || ""); screen.value = "admin"; if (route.path === "/admin/login" || route.path === "/admin/change-password") await router.replace("/admin"); await Promise.all([loadOverview(), loadServerSettings()]); } } catch { errorMessage.value = tr('requestFailed'); } finally { loading.value = false; } }
async function login() { submitting.value = true; errorMessage.value = ""; try { const result = await sendJson("/api/admin/login", "POST", { username: loginUsername.value, password: loginPassword.value }, false); csrfToken.value = String(result.csrfToken || ""); loginPassword.value = ""; if (result.mustChangePassword) { screen.value = "change-password"; await router.replace("/admin/change-password"); } else { screen.value = "admin"; await router.replace("/admin"); await Promise.all([loadOverview(), loadServerSettings()]); } } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { submitting.value = false; } }
async function changePassword() { errorMessage.value = ""; if (newPassword.value.length < 12) { errorMessage.value = tr('setupPasswordShort'); return; } if (newPassword.value !== confirmNewPassword.value) { errorMessage.value = tr('setupPasswordsMismatch'); return; } submitting.value = true; try { await sendJson("/api/admin/change-password", "POST", { newPassword: newPassword.value }); newPassword.value = ""; confirmNewPassword.value = ""; screen.value = "admin"; await router.replace("/admin"); await Promise.all([loadOverview(), loadServerSettings()]); } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { submitting.value = false; } }
async function logout() { try { await sendJson("/api/admin/logout", "POST", {}); } finally { csrfToken.value = ""; screen.value = "login"; await router.replace("/admin/login"); } }
async function loadOverview() { Object.assign(overview, await getJson("/api/admin/overview")); }
async function loadServerSettings() { const value = await getJson("/api/admin/server"); Object.assign(serverForm, value, { serverPassword: "", passwordAction: "keep" }); }
async function saveServerSettings() { submitting.value = true; errorMessage.value = ""; try { const result = await sendJson("/api/admin/server", "PUT", serverPayload()); Object.assign(serverForm, result.settings, { serverPassword: "", passwordAction: "keep" }); await loadOverview(); } catch (error) { errorMessage.value = errorText((error as ApiError).code); } finally { submitting.value = false; } }
async function testServerConnection() { await runTest("/api/admin/server/test", { target: serverForm.target, serverPassword: serverForm.passwordAction === "replace" ? serverForm.serverPassword : undefined, passwordAction: serverForm.passwordAction }); if (testResult.value?.ok) { await loadOverview(); serverForm.detectedProtocol = testResult.value.protocol ?? null; serverForm.lastTestAt = new Date().toISOString(); serverForm.lastTestLatencyMs = testResult.value.latencyMs ?? null; } }
function serverPayload() { return { target: serverForm.target, serverPassword: serverForm.passwordAction === "replace" ? serverForm.serverPassword : undefined, passwordAction: serverForm.passwordAction, accessMode: serverForm.accessMode, siteName: serverForm.siteName, welcomeText: serverForm.welcomeText }; }
async function runTest(url: string, body: Record<string, unknown>) { testing.value = true; errorMessage.value = ""; testResult.value = null; try { testResult.value = await sendJson(url, "POST", body, url.includes("/server/test")); } catch (error) { testResult.value = { ok: false, code: (error as ApiError).code }; } finally { testing.value = false; } }
async function dismissLegacyNotice() { await sendJson("/api/admin/legacy-import/dismiss", "POST", {}); overview.legacyConfigImported = false; }
function toggleLanguage() { language.value = language.value === "zh" ? "en" : "zh"; localStorage.setItem("webspeak:language", language.value); }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat(language.value === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function formatUptime(seconds: number) { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); return language.value === "zh" ? `已运行 ${hours} 小时 ${minutes} 分钟` : `Up ${hours}h ${minutes}m`; }
function eventName(event: string) { if (event === "ADMIN_LOGIN_FAILED") return language.value === "zh" ? "管理员登录失败" : "Administrator login failed"; if (event === "CONNECTION_TEST_SUCCEEDED") return language.value === "zh" ? "连接测试成功" : "Connection test succeeded"; if (event === "CONNECTION_TEST_FAILED") return language.value === "zh" ? "连接测试失败" : "Connection test failed"; const names: Record<string, keyof typeof copy.zh> = { ADMIN_LOGIN_SUCCEEDED: "loginEvent", ADMIN_LOGOUT: "logoutEvent", SETTINGS_CHANGED: "settingsEvent", ADMIN_INITIALIZED: "initializedEvent", LEGACY_CONFIG_IMPORTED: "importedEvent", CONNECTION_TEST: "testEvent" }; return names[event] ? tr(names[event]) : language.value === "zh" ? "系统事件" : event.replaceAll("_", " "); }
function errorText(code?: string) { if (code === "INVALID_PASSWORD") return tr('invalidPassword'); if (code === "INVALID_ADMIN_PASSWORD") return tr('setupPasswordShort'); if (code === "PASSWORD_CHANGE_REQUIRED") return tr('changePasswordLead'); if (code === "RATE_LIMITED") return tr('rateLimited'); const probe: Record<string, { zh: string; en: string }> = { INVALID_TARGET: { zh: "TeamSpeak 服务器地址格式无效。", en: "The TeamSpeak server address is invalid." }, HOST_NOT_FOUND: { zh: "找不到服务器主机名。", en: "The server hostname could not be resolved." }, UNREACHABLE: { zh: "无法连接 TeamSpeak 服务器。", en: "The TeamSpeak server is unreachable." }, TIMEOUT: { zh: "连接 TeamSpeak 超时。", en: "The TeamSpeak connection timed out." }, PROTOCOL_NEGOTIATION_FAILED: { zh: "无法识别 TeamSpeak 协议。", en: "TeamSpeak protocol negotiation failed." }, SERVER_REJECTED: { zh: "TeamSpeak 服务器拒绝了连接。", en: "The TeamSpeak server rejected the connection." }, TARGET_NOT_ALLOWED: { zh: "此地址不允许在开放模式中使用。", en: "This target is not allowed in open mode." } }; return probe[code || ""]?.[language.value] ?? tr('requestFailed'); }

interface ApiError extends Error { code?: string }
async function getJson(url: string): Promise<any> { const response = await fetch(url, { headers: { accept: "application/json" } }); return parseResponse(response); }
async function sendJson(url: string, method: string, body: unknown, authenticated = true): Promise<any> { const response = await fetch(url, { method, headers: { "content-type": "application/json", accept: "application/json", ...(authenticated && csrfToken.value ? { "x-csrf-token": csrfToken.value } : {}) }, body: JSON.stringify(body) }); return parseResponse(response); }
async function parseResponse(response: Response) { const value = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(String(value.code || response.statusText)) as ApiError; error.code = String(value.code || "REQUEST_FAILED"); if (response.status === 401 && screen.value === "admin") { screen.value = "login"; void router.replace("/admin/login"); } throw error; } return value; }
</script>

<style scoped>
.intro-copy h1{font-size:clamp(38px,4.2vw,56px)!important;line-height:1.05!important;letter-spacing:-.055em!important}
:global(*){box-sizing:border-box}:global(body){margin:0;font-family:Inter,"Segoe UI","PingFang SC",sans-serif;color:#20302c;background:#f4f8f6}.admin-root{min-height:100dvh}.auth-layout{display:grid;min-height:100dvh;grid-template-columns:minmax(360px,.82fr) minmax(520px,1.18fr)}.auth-intro{display:flex;flex-direction:column;padding:48px clamp(38px,6vw,92px);color:#e8fffa;background:radial-gradient(circle at 20% 0,rgba(90,211,191,.28),transparent 32rem),#063f3b}.admin-brand{display:flex;align-items:center;gap:12px}.admin-brand>span{display:grid;place-items:center;width:42px;height:42px;color:#fff;background:#07877d;border-radius:12px;box-shadow:0 8px 22px rgba(0,0,0,.15)}.admin-brand strong,.admin-brand small{display:block}.admin-brand strong{font-size:20px;letter-spacing:-.04em}.admin-brand small{margin-top:3px;color:#9bc9c2;font-size:11px}.intro-copy{margin:auto 0 48px}.intro-copy i{color:#75e3d2;font-size:12px;font-style:normal;font-weight:800;letter-spacing:.12em}.intro-copy h1{max-width:540px;margin:16px 0;font-size:clamp(40px,5vw,66px);line-height:1.03;letter-spacing:-.065em}.intro-copy p{max-width:530px;color:#a9d0ca;font-size:16px;line-height:1.75}.step-list{display:grid;gap:10px}.step-list button{display:flex;align-items:center;gap:13px;width:100%;padding:13px;color:#89bbb4;text-align:left;background:transparent;border:1px solid transparent;border-radius:12px}.step-list button.active{color:#fff;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.1)}.step-list button.done{color:#8ee4d7}.step-list button>span{display:grid;place-items:center;width:28px;height:28px;flex:none;border:1px solid currentColor;border-radius:50%;font-size:12px;font-weight:800}.step-list strong,.step-list small{display:block}.step-list strong{font-size:13px}.step-list small{margin-top:3px;font-size:10px;opacity:.75}.auth-panel{position:relative;display:grid;place-items:center;padding:80px 40px;background:radial-gradient(circle at 80% 10%,rgba(99,205,188,.15),transparent 25rem),#f5f9f7}.panel-tools{position:absolute;top:28px;right:34px}.panel-tools button,.language-link,.admin-topbar button{color:#08766e;background:#e4f3ef;border:1px solid #cae7e0;border-radius:8px;padding:8px 12px;font-size:11px;font-weight:700;cursor:pointer}.setup-card,.login-card{width:min(560px,100%);padding:36px;background:#fff;border:1px solid #dfeae6;border-radius:20px;box-shadow:0 20px 55px rgba(27,69,61,.09)}.setup-card header small{color:#07877d;font-size:11px;font-weight:800;letter-spacing:.08em}.setup-card header h2,.login-card h1{margin:10px 0 7px;font-size:29px;letter-spacing:-.045em}.setup-card header p,.login-card header p{margin:0;color:#71817c;font-size:13px;line-height:1.6}.form-stack,.login-card form{display:grid;gap:17px;margin-top:27px}label>span,fieldset legend{display:block;margin-bottom:7px;color:#40514c;font-size:12px;font-weight:700}label em{color:#91a09c;font-size:10px;font-style:normal;font-weight:500}label small{display:block;margin-top:6px;color:#899792;font-size:10px;line-height:1.5}input,textarea{width:100%;padding:11px 12px;color:#22332f;background:#fbfdfc;border:1px solid #dbe7e3;border-radius:9px;font:inherit;font-size:13px;outline:none}input{height:43px}input:focus,textarea:focus{border-color:#54bdb2;box-shadow:0 0 0 3px rgba(84,189,178,.13)}textarea{resize:vertical}.strength{height:4px;overflow:hidden;background:#e7eeeb;border-radius:4px}.strength i{display:block;height:100%;background:linear-gradient(90deg,#e7a452,#50c5a2);transition:.2s}fieldset{display:grid;gap:9px;margin:0;padding:0;border:0}.choice{display:flex;align-items:flex-start;gap:10px;padding:13px;border:1px solid #dfe9e6;border-radius:10px;cursor:pointer}.choice:has(input:checked){border-color:#62bfb5;background:#eff8f6}.choice input{width:16px;height:16px;flex:none;margin:2px 0}.choice strong,.choice small{display:block}.choice strong{font-size:12px}.choice small{margin-top:4px;color:#7b8985;font-size:10px;line-height:1.45}.setup-card footer{display:flex;align-items:center;justify-content:space-between;margin-top:28px;padding-top:20px;border-top:1px solid #edf1ef}.primary-button,.secondary-button,.text-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:0 18px;border:0;border-radius:9px;font-size:12px;font-weight:800;cursor:pointer}.primary-button{color:#fff;background:#087d74}.primary-button:hover{background:#056b63}.primary-button:disabled,.secondary-button:disabled{opacity:.55;cursor:not-allowed}.secondary-button{color:#08776e;background:#eaf6f3;border:1px solid #cfe9e3}.text-button{color:#687a74;background:transparent}.wide{width:100%}.spinner{display:inline-block;width:22px;height:22px;border:2px solid #cde6df;border-top-color:#087d74;border-radius:50%;animation:spin .7s linear infinite}.spinner.small{width:15px;height:15px;border-color:rgba(255,255,255,.35);border-top-color:currentColor}@keyframes spin{to{transform:rotate(360deg)}}.alert{padding:12px 14px;border-radius:9px;font-size:12px;line-height:1.5}.alert.error{color:#a3423d;background:#fff0ef;border:1px solid #f4cbc8}.alert.info{color:#23665f;background:#eaf7f3;border:1px solid #cde9e2}.test-result{display:flex;gap:10px;padding:12px;border-radius:9px}.test-result.success{color:#246c52;background:#eaf8f0}.test-result.error{color:#a3423d;background:#fff0ef}.test-result strong,.test-result small{display:block}.test-result strong{font-size:12px}.test-result small{margin-top:3px;font-size:10px}.login-page{display:grid;min-height:100dvh;place-items:center;padding:25px;background:radial-gradient(circle at 50% 10%,rgba(95,211,191,.2),transparent 30rem),#f4f8f6}.login-card{max-width:430px;text-align:center}.admin-brand.centered{justify-content:center}.login-card header{margin:30px 0 24px}.login-card label{text-align:left}.language-link{margin-top:20px}.center-card{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;color:#60746e}.admin-shell{display:grid;min-height:100dvh;grid-template-columns:236px minmax(0,1fr)}.admin-sidebar{position:sticky;top:0;display:flex;height:100dvh;flex-direction:column;padding:26px 18px;background:#073f3b;color:#eafffb}.admin-sidebar .admin-brand{padding:0 8px 28px}.admin-sidebar nav{display:grid;gap:6px}.admin-sidebar nav a,.sidebar-bottom a,.sidebar-bottom button{display:flex;align-items:center;gap:10px;padding:11px 12px;color:#9fc8c2;text-decoration:none;background:transparent;border:0;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer}.admin-sidebar nav a.active{color:#fff;background:#0b5b54}.sidebar-bottom{display:grid;gap:4px;margin-top:auto;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)}.admin-main{min-width:0}.admin-topbar{display:flex;align-items:center;justify-content:space-between;min-height:82px;padding:0 clamp(24px,4vw,58px);background:#fff;border-bottom:1px solid #e4ebe8}.admin-topbar small,.admin-topbar h1{display:block;margin:0}.admin-topbar small{color:#8b9995;font-size:10px;text-transform:uppercase}.admin-topbar h1{margin-top:4px;font-size:21px}.admin-topbar>div:last-child{display:flex;align-items:center;gap:8px;color:#66807a;font-size:11px}.running-dot{width:7px;height:7px;background:#55d17a;border-radius:50%;box-shadow:0 0 0 4px #e5f8ea}.page-content{width:min(1180px,calc(100% - 48px));margin:0 auto;padding:40px 0 70px}.page-alert{margin:20px 24px 0}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px}.page-heading h2{margin:0;font-size:25px}.page-heading p{margin:7px 0 0;color:#75857f;font-size:12px}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.settings-card,.readonly-card,.overview-card{padding:24px;background:#fff;border:1px solid #dfe8e5;border-radius:14px}.settings-card{display:grid;align-content:start;gap:18px}.settings-card h3,.readonly-card h3,.overview-card h3{margin:0;font-size:15px}.password-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:9px}.password-actions{display:flex;gap:5px;padding-bottom:1px}.password-actions button{height:42px;padding:0 10px;color:#55706a;background:#eef4f2;border:0;border-radius:8px;font-size:10px;font-weight:700;cursor:pointer}.password-actions button.active{color:#fff;background:#16877d}.password-actions button.danger{color:#a24640;background:#fff0ef}.readonly-card{margin-top:20px}.readonly-card dl,.overview-card dl{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0 0}.readonly-card dl div,.overview-card dl div{padding:13px;background:#f6f9f8;border-radius:9px}.readonly-card dt,.overview-card dt{color:#85948f;font-size:10px}.readonly-card dd,.overview-card dd{margin:5px 0 0;font-size:12px;font-weight:700}.import-notice{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.import-notice button{color:#08776e;background:transparent;border:0;font-weight:800;cursor:pointer}.hero-status{display:flex;align-items:center;justify-content:space-between;padding:30px;color:#eafffa;background:linear-gradient(135deg,#07524c,#087d74);border-radius:16px}.hero-status small{color:#80d8cc;font-size:10px;font-weight:800;letter-spacing:.1em}.hero-status h2{margin:9px 0 5px;font-size:27px}.hero-status p{margin:0;color:#a8d8d1;font-size:12px}.status-badge{display:flex;align-items:center;gap:7px;padding:8px 12px;background:rgba(255,255,255,.12);border-radius:99px;font-size:11px;font-weight:700}.status-badge i{width:7px;height:7px;background:#69e78b;border-radius:50%}.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:18px 0}.metric-grid article{position:relative;padding:21px;background:#fff;border:1px solid #dfe8e5;border-radius:13px}.metric-grid article>span{position:absolute;top:17px;right:17px;display:grid;place-items:center;width:35px;height:35px;color:#087d74;background:#e9f5f2;border-radius:9px}.metric-grid small,.metric-grid strong,.metric-grid em{display:block}.metric-grid small{color:#82908c;font-size:10px}.metric-grid strong{max-width:80%;margin-top:13px;overflow:hidden;font-size:20px;text-overflow:ellipsis;white-space:nowrap}.metric-grid em{margin-top:7px;color:#71817c;font-size:10px;font-style:normal}.overview-columns{display:grid;grid-template-columns:1.05fr .95fr;gap:18px}.overview-card header{display:flex;justify-content:space-between}.overview-card header p{margin:5px 0 0;color:#7e8c88;font-size:10px}.overview-card header a{color:#087d74;font-size:11px;font-weight:700;text-decoration:none}.overview-card dl{grid-template-columns:1fr 1fr}.overview-card dd{display:flex;align-items:center;gap:7px}.overview-card dd i{width:7px;height:7px;background:#aab5b2;border-radius:50%}.overview-card dd i.reachable{background:#55cb76}.overview-card dd i.unreachable{background:#d85f57}.event-list{display:grid;gap:10px;margin:18px 0 0;padding:0;list-style:none}.event-list li{display:flex;align-items:center;gap:10px;padding:10px;background:#f6f9f8;border-radius:9px}.event-list li>span{display:grid;place-items:center;width:27px;height:27px;color:#087d74;background:#dff1ed;border-radius:8px}.event-list strong,.event-list small{display:block}.event-list strong{font-size:11px}.event-list small{margin-top:3px;color:#879590;font-size:9px}.event-list .empty-event{display:block;color:#82908c;text-align:center}
@media(max-width:850px){.auth-layout{display:block}.auth-intro{min-height:auto;padding:28px 24px}.intro-copy{margin:55px 0 35px}.step-list{display:none}.auth-panel{padding:35px 18px 60px}.panel-tools{top:18px;right:18px}.admin-shell{display:block}.admin-sidebar{position:static;width:100%;height:auto;flex-direction:row;align-items:center;padding:12px 16px}.admin-sidebar .admin-brand{padding:0}.admin-sidebar .admin-brand small{display:none}.admin-sidebar nav{display:flex;margin-left:auto}.admin-sidebar nav a{font-size:0}.admin-sidebar nav a .ui-icon{width:20px;height:20px}.sidebar-bottom{display:flex;margin:0 0 0 8px;padding:0;border:0}.sidebar-bottom a{display:none}.sidebar-bottom button{font-size:0}.settings-grid,.overview-columns{grid-template-columns:1fr}.readonly-card dl{grid-template-columns:1fr 1fr}.admin-topbar{padding:0 18px}.page-content{width:min(100% - 28px,700px);padding-top:24px}.metric-grid{grid-template-columns:1fr}.hero-status{align-items:flex-start;gap:20px}.hero-status p{max-width:75%}}
@media(max-width:520px){.setup-card,.login-card{padding:25px 20px;border-radius:15px}.setup-card header h2{font-size:24px}.admin-topbar>div:last-child{font-size:0}.page-heading{gap:15px}.page-heading .primary-button{padding-inline:12px}.settings-card,.readonly-card,.overview-card{padding:18px}.readonly-card dl,.overview-card dl{grid-template-columns:1fr}.password-row{grid-template-columns:1fr}.password-actions{padding:0}.hero-status{padding:23px}.status-badge{display:none}}
.security-note{margin:18px 0 0;color:#879590;font-size:11px;line-height:1.5}
</style>
