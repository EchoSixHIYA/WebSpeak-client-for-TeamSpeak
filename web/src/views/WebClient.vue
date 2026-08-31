<template>
  <div class="web-client" @keydown="onKeyDown" @keyup="onKeyUp" tabindex="0">
    <!-- Connection / welcome screen -->
    <section v-if="!voiceState.connected" class="join-page">
      <header class="join-header">
        <div class="brand-lockup">
          <div class="brand-mark"><Icon name="waveform" :size="22" /></div>
          <div>
            <strong>TeamSpeak <span>Web</span></strong>
            <small>{{ t('browserWorkspace') }}</small>
          </div>
        </div>
        <div class="header-tools"><div class="header-note"><span class="tiny-dot"></span> {{ t('secureGateway') }}</div><button class="guide-button" type="button" :title="t('configGuide')" @click="configGuideOpen = true"><Icon name="help" :size="15" /> {{ t('configGuide') }}</button><button class="language-switch" :aria-label="t('langSwitch')" @click="toggleLanguage">{{ t('langSwitch') }}</button></div>
      </header>

      <main class="join-content">
        <div class="join-copy">
          <div class="eyebrow"><span class="eyebrow-dot"></span> {{ t('privateAudio') }}</div>
          <h1>{{ t('joinLine1') }}<br /><em>{{ t('joinLine2') }}</em></h1>
          <p class="join-description">{{ t('joinDescription') }}</p>
          <div class="promise-list">
            <div class="promise-item"><span class="promise-icon"><Icon name="waveform" :size="16" /></span><span><b>{{ t('highQuality') }}</b><small>{{ t('opusAudio') }}</small></span></div>
            <div class="promise-item"><span class="promise-icon mint"><Icon name="shield" :size="16" /></span><span><b>{{ t('secureJoin') }}</b><small>{{ t('inviteProtected') }}</small></span></div>
            <div class="promise-item"><span class="promise-icon sand"><Icon name="users" :size="16" /></span><span><b>{{ t('realtime') }}</b><small>{{ t('membersSync') }}</small></span></div>
          </div>
        </div>

        <div class="join-card">
          <div class="card-kicker">{{ t('joinServer') }}</div>
          <h2>{{ t('welcomeBack') }}</h2>
          <p class="card-lead">{{ t('joinLead') }}</p>

          <div v-if="voiceState.error" class="notice error-notice"><span class="notice-symbol">!</span><span>{{ localizedMessage(voiceState.error) }}</span></div>
          <div v-if="browserError" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ localizedMessage(browserError) }}</span></div>

          <form class="join-form" @submit.prevent="doConnect">
            <div class="field-grid">
              <div>
                <label class="field-label" for="server-host">{{ t('serverAddress') }}</label>
                <div class="field-wrap"><Icon name="server" :size="17" /><input id="server-host" v-model="serverHost" autocomplete="url" :placeholder="t('serverAddressPlaceholder')" /></div>
              </div>
              <div>
                <label class="field-label" for="server-port">{{ t('serverPort') }}</label>
                <div class="field-wrap"><Icon name="hash" :size="17" /><input id="server-port" v-model="serverPort" inputmode="numeric" type="number" min="1" max="65535" :placeholder="t('serverPortPlaceholder')" /></div>
              </div>
            </div>
            <p class="field-hint">{{ t('serverAddressHint') }}</p>

            <label class="field-label" for="nickname">{{ t('nickname') }}</label>
            <div class="field-wrap">
              <Icon name="users" :size="17" />
              <input id="nickname" v-model="nickname" autocomplete="nickname" maxlength="30" :placeholder="t('nicknamePlaceholder')" autofocus />
            </div>

            <label class="field-label" for="channel">{{ t('targetChannel') }} <span>{{ t('optional') }}</span></label>
            <div class="field-wrap">
              <Icon name="hash" :size="17" />
              <input id="channel" v-model="channel" :placeholder="t('emptyDefault')" @keyup.enter="doConnect" />
            </div>

            <button class="primary-button connect-button" :disabled="!nickname.trim() || !validServerPort || !serverHost.trim() || serverConfigLoading || voiceState.connecting" type="submit">
              <span v-if="voiceState.connecting" class="button-spinner"></span>
              <span>{{ voiceState.connecting ? t('connecting') : t('enterVoice') }}</span>
              <Icon v-if="!voiceState.connecting" name="chevron-right" :size="17" />
            </button>
          </form>
          <div class="join-meta"><Icon name="lock" :size="14" /> {{ t('connectionAuthorized') }}</div>
        </div>
      </main>

      <footer class="join-footer">
        <span>WebSpeak</span><span class="footer-separator">·</span><span>{{ t('teamSpeakClient') }}</span><span class="footer-spacer"></span><a href="https://github.com/EchoSixHIYA/web-gateway-for-TeamSpeak" target="_blank" rel="noreferrer">{{ t('sourceCode') }}</a><span class="footer-separator">·</span><span>{{ t('browserSupport') }}</span>
      </footer>
    </section>

    <!-- Connected application shell -->
    <div v-else class="app-shell">
      <main class="workspace">
        <header class="workspace-header">
          <div class="breadcrumbs"><span class="mobile-brand">TeamSpeak <em>Web</em></span><span class="crumb-muted">{{ t('serverBreadcrumb') }}</span><Icon name="chevron-right" :size="14" /><strong>{{ currentChannelName }}</strong></div>
          <div class="workspace-actions">
            <label v-if="channelTree.length" class="channel-switcher" :title="t('switchChannel')">
              <Icon name="volume" :size="15" />
              <select v-model="selectedChannelId" :aria-label="t('switchChannel')" @change="selectChannelById">
                <option v-for="channelItem in channelTree" :key="channelItem.id" :value="channelItem.id">{{ channelLabel(channelItem) }}</option>
              </select>
            </label>
            <button class="header-action" :title="t('copyInvite')" @click="doShare"><Icon name="share" :size="18" /></button>
            <button class="header-action" :title="t('audioSettings')" @click="settingsOpen = true"><Icon name="settings" :size="18" /></button>
            <button class="language-switch workspace-language" :aria-label="t('langSwitch')" @click="toggleLanguage">{{ t('langSwitch') }}</button>
            <button class="disconnect-button" @click="doDisconnect"><Icon name="door" :size="17" /> {{ t('exit') }}</button>
          </div>
        </header>

        <div class="workspace-scroll">
          <div class="workspace-content">
            <section class="room-hero">
              <div class="hero-decoration one"></div><div class="hero-decoration two"></div>
              <div class="room-hero-content">
                <div class="room-eyebrow"><span class="live-pill"><i></i> {{ t('live') }}</span><span>{{ t('voiceSpace') }}</span></div>
                <h1><Icon name="volume" :size="24" /> {{ currentChannelName }}</h1>
                <p>{{ currentChannelDescription || t('roomDescription') }}</p>
                <div class="room-stats"><span><Icon name="users" :size="15" /> {{ t('membersOnline', { count: currentMembers.length }) }}</span><span class="stat-divider"></span><span><Icon name="shield" :size="14" /> {{ t('encrypted') }}</span></div>
              </div>
              <div class="hero-visual" aria-hidden="true"><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div><div class="hero-wave"><i v-for="bar in heroBars" :key="bar" :style="{ height: `${bar}px` }"></i></div></div>
            </section>

            <section class="voice-section">
              <div class="section-heading"><div><span class="section-kicker">{{ t('voiceActivity') }}</span><h2>{{ t('speakingNow') }}</h2></div><span class="section-counter">{{ t('onlineShort', { count: currentMembers.length }) }}</span></div>
              <div v-if="currentMembers.length" class="voice-grid">
                <article v-for="member in roomMembers" :key="member.id" :class="['voice-card', { speaking: isSpeaking(member), self: member.isSelf }]">
                  <div class="voice-avatar-wrap"><div :class="['voice-avatar', { speaking: isSpeaking(member) }]" :style="avatarStyle(member.nickname, member.isSelf)">{{ avatarInitial(member.nickname) }}</div></div>
                  <strong>{{ member.isSelf ? (language === 'zh' ? '你' : 'You') : member.nickname }}</strong><span>{{ isSpeaking(member) ? t('speaking') : member.isSelf ? t('connectedYou') : t('connected') }}</span>
                </article>
                <article v-if="currentMembers.length > roomMembers.length" class="voice-card more-card"><div class="more-count">+{{ currentMembers.length - roomMembers.length }}</div><strong>{{ t('moreMembers') }}</strong><span>{{ t('viewLeft') }}</span></article>
              </div>
              <div v-else class="voice-empty"><span class="empty-icon"><Icon name="users" :size="20" /></span><strong>{{ language === 'zh' ? '等待成员加入语音' : 'Waiting for people to join' }}</strong><span>{{ language === 'zh' ? '你可以先在这里准备好麦克风。' : 'You can get your microphone ready.' }}</span></div>
            </section>

            <section class="chat-panel">
              <div class="section-heading chat-heading"><div><span class="section-kicker">{{ t('textChannel') }}</span><h2><Icon name="hash" :size="20" /> {{ t('channelChat', { channel: currentChannelName }) }}</h2></div><span class="section-counter">{{ t('messageCount', { count: chatMessages.length }) }}</span></div>
              <div ref="chatListEl" class="message-list">
                <div v-if="!chatMessages.length" class="chat-empty"><div class="chat-empty-icon"><Icon name="message" :size="24" /></div><strong>{{ t('chatStart') }}</strong><span>{{ t('chatStartLead') }}</span></div>
                <article v-for="message in chatMessages" :key="message.id" :class="['message-row', { mine: message.isSelf }]">
                  <div class="message-avatar" :style="avatarStyle(message.invokerName, message.isSelf)">{{ avatarInitial(message.invokerName) }}</div>
                  <div class="message-body"><div class="message-meta"><strong>{{ message.isSelf ? (language === 'zh' ? '你' : 'You') : message.invokerName }}</strong><time>{{ formatTime(message.timestamp) }}</time></div><div class="message-bubble">{{ message.message }}</div></div>
                </article>
              </div>
              <form class="message-composer" @submit.prevent="submitMessage">
                <input v-model="messageDraft" maxlength="500" :placeholder="t('sendMessagePlaceholder')" :aria-label="t('send')" />
                <button class="send-button" type="submit" :disabled="!messageDraft.trim()" :title="t('send')"><Icon name="send" :size="18" /></button>
              </form>
            </section>
          </div>
        </div>

      </main>

      <aside class="member-panel">
        <div class="member-panel-heading"><div><span class="section-kicker">{{ t('people') }}</span><h2>{{ t('people') }}</h2></div></div>
        <div class="member-search"><Icon name="search" :size="15" /><input v-model="memberQuery" :placeholder="t('searchMembers')" :aria-label="t('searchMembers')" /></div>
        <div class="member-tree">
          <section v-for="channelItem in filteredMemberChannels" :key="channelItem.id" :class="['member-channel-group', { current: currentChannel?.id === channelItem.id }]" :style="{ marginLeft: `${channelItem.depth * 10}px` }">
            <button class="member-channel-heading" :title="t('switchChannel')" @click="selectChannel(channelItem)">
              <Icon name="volume" :size="16" />
              <span>{{ channelItem.name }}</span>
              <small>{{ channelItem.members.length }}</small>
            </button>
            <div v-if="channelItem.members.length" class="member-list">
              <div v-for="member in channelItem.members" :key="`${channelItem.id}-${member.id}`" class="member-row">
                <div :class="['member-avatar', { speaking: isSpeaking(member) }]" :style="avatarStyle(member.nickname, member.isSelf)">{{ avatarInitial(member.nickname) }}<span class="member-presence"></span></div>
                <div class="member-copy"><strong>{{ member.isSelf ? `${member.nickname}${language === 'zh' ? '（你）' : ' (You)'}` : member.nickname }}</strong><span>{{ isSpeaking(member) ? t('speaking') : member.isSelf ? t('yourDevice') : t('memberOnline') }}</span></div>
                <div class="member-volume"><Icon :name="(volumes[member.id] ?? 1) === 0 ? 'volume-off' : 'volume'" :size="14" /><input type="range" min="0" max="400" :value="(volumes[member.id] ?? 1) * 100" :style="rangeStyle((volumes[member.id] ?? 1) / 4, 1)" :aria-label="t('memberVolume')" @input="onVolInput(member.id, $event)" /></div>
              </div>
            </div>
            <div v-else class="channel-no-members">{{ t('noMembersInChannel') }}</div>
          </section>
        </div>
        <div v-if="!filteredMemberChannels.length" class="member-empty">{{ t('noMatchingMembers') }}</div>
        <div class="member-panel-tip"><Icon name="volume" :size="16" /><span>{{ t('volumeTip') }}</span></div>
      </aside>
    </div>

    <!-- Configuration guide modal -->
    <div v-if="configGuideOpen" class="modal-backdrop config-guide-backdrop" @click.self="configGuideOpen = false">
      <section class="config-guide-modal" role="dialog" aria-modal="true" :aria-labelledby="'config-guide-title'">
        <header class="config-guide-header"><div><span class="card-kicker">{{ t('configGuideKicker') }}</span><h2 id="config-guide-title">{{ t('configGuideTitle') }}</h2><p>{{ t('configGuideLead') }}</p></div><button class="round-icon" type="button" :title="t('close')" @click="configGuideOpen = false"><Icon name="close" :size="19" /></button></header>
        <div class="config-guide-content">
          <div class="config-guide-steps">
            <article><span>1</span><div><strong>{{ t('configStepCopyTitle') }}</strong><p>{{ t('configStepCopyLead') }}</p><code>cp config.example.json config.json</code></div></article>
            <article><span>2</span><div><strong>{{ t('configStepEditTitle') }}</strong><p>{{ t('configStepEditLead') }}</p></div></article>
            <article><span>3</span><div><strong>{{ t('configStepRestartTitle') }}</strong><p>{{ t('configStepRestartLead') }}</p><code>node dist/index.js</code></div></article>
          </div>
          <section class="config-editor"><div class="config-editor-heading"><div><span class="section-kicker">{{ t('configPreview') }}</span><strong>{{ t('configPreviewLead') }}</strong></div><button class="copy-config-button" type="button" @click="copyConfigTemplate"><Icon name="copy" :size="15" /> {{ t('copyConfig') }}</button></div><div class="config-guide-fields"><label class="config-guide-wide"><span>{{ t('serverPassword') }}</span><input v-model="guideServerPassword" type="password" :placeholder="t('optionalPassword')" /></label></div><pre>{{ configTemplate }}</pre></section>
          <div class="config-guide-note"><Icon name="help" :size="16" /><span>{{ t('configGuideNote') }}</span></div>
        </div>
        <footer class="config-guide-footer"><button class="text-button" type="button" @click="configGuideOpen = false">{{ t('close') }}</button><button class="primary-button save-button" type="button" @click="copyConfigTemplate"><Icon name="copy" :size="16" /> {{ t('copyConfig') }}</button></footer>
      </section>
    </div>

    <!-- Audio settings modal -->
    <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false">
      <section class="settings-modal" role="dialog" aria-modal="true" :aria-labelledby="'settings-title'">
        <div class="settings-main"><header class="settings-header"><h2 id="settings-title">{{ t('audioConfiguration') }}</h2><button class="round-icon" :title="t('close')" @click="settingsOpen = false"><Icon name="close" :size="19" /></button></header><div class="settings-content">
          <section class="settings-section"><h3><Icon name="mic" :size="20" /> {{ t('inputDevice') }}</h3><label class="settings-label" for="input-device">{{ t('microphone') }}</label><select id="input-device" class="settings-select" :value="selectedInputDeviceId" :disabled="!inputDevices.length" @change="onInputDeviceChange"><option value="">{{ t('defaultMicrophone') }}</option><option v-for="(device, index) in inputDevices" :key="device.deviceId || `microphone-${index}`" :value="device.deviceId">{{ device.label || t('microphoneNumber', { index: index + 1 }) }}</option></select><p v-if="audioSettingsError" class="settings-error">{{ localizedMessage(audioSettingsError) }}</p><label class="settings-label">{{ t('microphoneMode') }}</label><div class="mic-mode-switch settings-mode-switch" role="group" :aria-label="t('microphoneMode')"><button type="button" :class="{ active: micMode === 'vox' }" @click="setMicMode('vox')"><Icon name="mic" :size="15" /> {{ t('freeMic') }}</button><button type="button" :class="{ active: micMode === 'ptt' }" @click="setMicMode('ptt')"><Icon name="lock" :size="14" /> {{ t('pushToTalk') }}</button></div><p class="settings-hint">{{ micMode === 'ptt' ? t('pushToTalkHint') : t('micReady') }}</p><div class="settings-range-row"><label class="settings-label">{{ t('inputVolume') }}</label><strong>{{ Math.round(inputVolume * 100) }}%</strong></div><input class="settings-range" type="range" min="0" max="100" :value="inputVolume * 100" :style="rangeStyle(inputVolume, 1)" :aria-label="t('inputVolume')" @input="onInputVolume" /><div class="mic-test"><div class="mic-test-header"><strong>{{ t('microphoneTest') }}</strong><button type="button" @click="toggleMicTest">{{ microphoneTestActive ? t('stopTest') : t('startTest') }}</button></div><div class="meter"><i v-for="index in 24" :key="index" :class="{ active: microphoneTestActive && index <= micMeterBars }" :style="{ height: `${meterBarHeight(index) }px` }"></i></div><div class="meter-labels"><span>{{ t('silence') }}</span><span>{{ t('optimal') }}</span><span>{{ t('loud') }}</span></div></div></section>
          <div class="settings-separator"></div><section class="settings-section"><h3><Icon name="volume" :size="20" /> {{ t('outputVolume') }}</h3><div class="settings-range-row"><label class="settings-label">{{ t('speakers') }}</label><strong>{{ Math.round(outputVolume * 100) }}%</strong></div><input class="settings-range" type="range" min="0" max="100" :value="outputVolume * 100" :style="rangeStyle(outputVolume, 1)" :aria-label="t('outputVolume')" @input="onOutputVolume" /><div class="mode-note"><Icon name="shield" :size="16" /><span>{{ t('audioPrivacy') }}</span></div></section>
        </div><footer class="settings-footer"><button class="primary-button save-button" @click="settingsOpen = false">{{ t('done') }}</button></footer></div>
      </section>
    </div>

    <div v-if="toast" class="toast"><Icon name="check" :size="16" /> {{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import Icon from "../components/Icon.vue";
import { useVoiceWebSocket, type ChannelInfo, type ChannelMember } from "../composables/useVoiceWebSocket.js";

interface TreeChannel extends ChannelInfo {
  depth: number;
  members: ChannelMember[];
}

const {
  state: voiceState,
  members,
  channels,
  chatMessages,
  micMode,
  inputVolume,
  outputVolume,
  inputDevices,
  selectedInputDeviceId,
  micLevel,
  microphoneTestActive,
  speakingIds,
  volumes,
  setVolume,
  setInputVolume,
  setOutputVolume,
  prepareInputDevices,
  setInputDevice,
  startMicrophoneTest,
  stopMicrophoneTest,
  connect,
  disconnect,
  switchChannel,
  sendTextMessage,
  setMicMode,
  setPTT,
  checkSupport,
  clearError,
} = useVoiceWebSocket();

const query = new URLSearchParams(location.search);
const initialChannel = query.get("channel") ?? "";
const nickname = ref(localStorage.getItem("webspeak:nickname") ?? "");
const channel = ref(initialChannel);
const serverHost = ref(query.get("tsHost") ?? localStorage.getItem("webspeak:ts-host") ?? location.hostname);
const serverPort = ref(query.get("tsPort") ?? localStorage.getItem("webspeak:ts-port") ?? "9987");
const browserError = ref("");
const serverConfigLoading = ref(true);
const memberQuery = ref("");
const messageDraft = ref("");
const selectedChannelId = ref("");
const settingsOpen = ref(false);
const configGuideOpen = ref(false);
const guideServerPassword = ref("");
const audioSettingsError = ref("");
const pttActive = ref(false);
const toast = ref("");
const chatListEl = ref<HTMLElement | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

type Language = "zh" | "en";
const language = ref<Language>(getInitialLanguage());
const translations: Record<Language, Record<string, string>> = {
  zh: {
    browserWorkspace: "浏览器语音工作台",
    secureGateway: "安全语音网关",
    privateAudio: "私密社区语音",
    joinLine1: "连接服务器，",
    joinLine2: "马上开始交流。",
    joinDescription: "无需安装 TeamSpeak 客户端，打开浏览器即可加入语音频道。低延迟、轻量、专注于每一次对话。",
    highQuality: "高质量语音",
    opusAudio: "Opus 低延迟传输",
    secureJoin: "安全加入",
    inviteProtected: "邀请链接保护你的服务器",
    realtime: "实时协作",
    membersSync: "频道成员状态即时同步",
    privateServer: "私密语音服务器",
    mainNav: "主导航",
    memberVolume: "成员音量",
    joinServer: "加入你的服务器",
    welcomeBack: "欢迎回来",
    joinLead: "输入一个昵称，选择进入的频道。",
    serverAddress: "TeamSpeak 服务器地址",
    serverAddressPlaceholder: "例如：ts.example.com 或 127.0.0.1",
    serverPort: "语音端口",
    serverPortPlaceholder: "9987",
    serverAddressHint: "这是网关服务器连接的 TeamSpeak 地址，不是浏览器直接连接地址。",
    nickname: "你的昵称",
    nicknamePlaceholder: "例如：Alex Rivera",
    targetChannel: "目标频道",
    optional: "可选",
    emptyDefault: "留空进入默认频道",
    connecting: "正在连接…",
    enterVoice: "进入语音空间",
    connectionAuthorized: "连接信息仅用于本次语音会话",
    sourceCode: "获取源代码",
    browserSupport: "Chrome / Edge 94+",
    teamSpeakClient: "TeamSpeak 浏览器客户端",
    home: "首页",
    activity: "动态",
    server: "服务器",
    discover: "发现",
    downloads: "下载",
    help: "帮助",
    needHelp: "需要帮助？请联系服务器管理员",
    serverOptions: "更多服务器选项",
    online: "在线",
    audioSettings: "音频设置",
    configGuide: "配置引导",
    configGuideKicker: "首次部署",
    configGuideTitle: "完成服务端配置",
    configGuideLead: "按下面三步准备 config.json，网页客户端就能连接你指定的 TeamSpeak 服务器。",
    configStepCopyTitle: "复制配置模板",
    configStepCopyLead: "在项目根目录执行命令，创建服务端配置文件。",
    configStepEditTitle: "确认连接参数",
    configStepEditLead: "在下方预览中确认 TeamSpeak 服务器地址、语音端口和密码；应用端口固定为 3040，协议会自动检测。",
    configStepRestartTitle: "保存并重启服务",
    configStepRestartLead: "保存 config.json 后重新启动 WebSpeak 服务，新的默认配置才会生效。",
    configPreview: "配置预览",
    configPreviewLead: "复制下面的 JSON 到项目根目录的 config.json",
    copyConfig: "复制配置",
    configGuideNote: "浏览器不能直接写入服务器文件；复制后请在运行 WebSpeak 的服务器上保存 config.json。",
    configCopiedToast: "配置 JSON 已复制",
    configCopyFailedToast: "复制失败，请手动复制配置内容",
    serverPassword: "服务器密码",
    optionalPassword: "没有密码可留空",
    switchChannel: "切换频道",
    searchChannels: "搜索频道",
    voiceChannels: "语音频道",
    peopleOnline: "{{count}} 人在线",
    channelPreparing: "频道列表准备中",
    channelPreparingLead: "服务器未提供频道目录时，仍可正常使用语音连接。",
    reload: "重新加载",
    quickActions: "快捷操作",
    inviteFriends: "邀请朋友加入",
    audioAndMic: "音频与麦克风",
    stableConnection: "连接稳定",
    websocket: "WebSocket",
    serverBreadcrumb: "服务器",
    copyInvite: "复制邀请链接",
    exit: "退出",
    live: "直播中",
    voiceSpace: "语音空间",
    roomDescription: "在这里和频道成员保持清晰、自然的交流。",
    membersOnline: "{{count}} 位成员在线",
    encrypted: "加密连接",
    voiceActivity: "语音活动",
    speakingNow: "正在语音中",
    onlineShort: "{{count}} 在线",
    connected: "已连接",
    speaking: "正在说话…",
    connectedYou: "已连接 · 你",
    moreMembers: "更多成员",
    viewLeft: "在左侧查看",
    textChannel: "文字频道",
    channelChat: "{{channel}} 聊天",
    messageCount: "{{count}} 条消息",
    chatStart: "这是聊天的开始",
    chatStartLead: "发送一条消息，和频道里的朋友打个招呼吧。",
    attachmentUnavailable: "附件暂不可用",
    emojiUnavailable: "表情暂不可用",
    sendMessagePlaceholder: "发送消息给频道成员…",
    send: "发送",
    freeMic: "自由麦",
    pushToTalk: "按键说话",
    pushToTalkHint: "按住空格说话",
    sending: "正在发送",
    micReady: "麦克风已就绪",
    exitVoice: "退出语音",
    people: "成员",
    searchMembers: "搜索成员",
    onlineGroup: "在线 — {{count}}",
    yourDevice: "你的设备",
    memberOnline: "在线",
    noMatchingMembers: "没有找到匹配的成员",
    noMembersInChannel: "此频道暂无成员",
    volumeTip: "拖动成员右侧滑杆，单独调整听到的音量。",
    moreMemberOptions: "更多成员选项",
    connectedToast: "当前已连接到此服务器",
    volumeToast: "成员音量可以在列表中单独调整",
    copiedToast: "邀请链接已复制",
    copyFailedToast: "复制失败，请手动复制浏览器地址",
    leftToast: "已安全退出语音空间",
    focusedToast: "当前版本聚焦于语音工作台",
    settings: "设置",
    profile: "个人资料",
    privacy: "隐私",
    notifications: "通知",
    browserClient: "浏览器客户端",
    audioConfiguration: "音频配置",
    inputDevice: "输入设备",
    microphone: "麦克风",
    microphoneMode: "麦克风模式",
    defaultMicrophone: "默认浏览器麦克风",
    microphoneNumber: "麦克风 {{index}}",
    inputVolume: "输入音量",
    microphoneTest: "麦克风测试",
    stopTest: "停止测试",
    startTest: "开始测试",
    silence: "安静",
    optimal: "最佳",
    loud: "较响",
    outputDevice: "输出设备",
    speakers: "扬声器 / 耳机",
    defaultOutput: "默认浏览器输出",
    outputVolume: "输出音量",
    audioPrivacy: "WebSpeak 会在浏览器安全上下文中处理音频，不会保存录音。",
    cancel: "取消",
    saveChanges: "保存更改",
    close: "关闭",
    done: "完成",
    voiceLobby: "语音大厅",
    langSwitch: "English",
  },
  en: {
    browserWorkspace: "Browser voice workspace",
    secureGateway: "Secure voice gateway",
    privateAudio: "Private community audio",
    joinLine1: "Connect to your server,",
    joinLine2: "start the conversation.",
    joinDescription: "No TeamSpeak client installation required. Open your browser and join a voice channel with low-latency audio built for conversation.",
    highQuality: "High quality audio",
    opusAudio: "Low-latency Opus transport",
    secureJoin: "Secure join",
    inviteProtected: "Invite link protects your server",
    realtime: "Real-time presence",
    membersSync: "Channel members stay in sync",
    privateServer: "Private voice server",
    mainNav: "Main navigation",
    memberVolume: "Member volume",
    joinServer: "JOIN YOUR SERVER",
    welcomeBack: "Welcome back",
    joinLead: "Choose a nickname and the channel to enter.",
    serverAddress: "TeamSpeak server address",
    serverAddressPlaceholder: "e.g. ts.example.com or 127.0.0.1",
    serverPort: "Voice port",
    serverPortPlaceholder: "9987",
    serverAddressHint: "This is the TeamSpeak address reached by the gateway, not a direct browser connection.",
    nickname: "Your nickname",
    nicknamePlaceholder: "e.g. Alex Rivera",
    targetChannel: "Target channel",
    optional: "Optional",
    emptyDefault: "Leave empty to use the default channel",
    connecting: "Connecting…",
    enterVoice: "Enter voice space",
    connectionAuthorized: "Connection details are used only for this voice session",
    sourceCode: "Source code",
    browserSupport: "Chrome / Edge 94+",
    teamSpeakClient: "TeamSpeak browser client",
    home: "Home",
    activity: "Activity",
    server: "Servers",
    discover: "Discover",
    downloads: "Downloads",
    help: "Help",
    needHelp: "Need help? Contact your server administrator",
    serverOptions: "More server options",
    online: "Online",
    audioSettings: "Audio settings",
    configGuide: "Setup guide",
    configGuideKicker: "FIRST DEPLOYMENT",
    configGuideTitle: "Finish server configuration",
    configGuideLead: "Follow these three steps to prepare config.json for the TeamSpeak server you want to use.",
    configStepCopyTitle: "Copy the template",
    configStepCopyLead: "Run the command in the project root to create the server configuration file.",
    configStepEditTitle: "Confirm connection settings",
    configStepEditLead: "Confirm the TeamSpeak address, voice port, and password below; WebSpeak listens on fixed port 3040 and detects the protocol automatically.",
    configStepRestartTitle: "Save and restart",
    configStepRestartLead: "Save config.json and restart WebSpeak for the new default settings to take effect.",
    configPreview: "CONFIG PREVIEW",
    configPreviewLead: "Copy this JSON into config.json in the project root",
    copyConfig: "Copy config",
    configGuideNote: "A browser cannot write files on the server. Copy this content, then save config.json on the machine running WebSpeak.",
    configCopiedToast: "Config JSON copied",
    configCopyFailedToast: "Copy failed. Copy the configuration manually",
    serverPassword: "Server password",
    optionalPassword: "Leave blank if not required",
    switchChannel: "Switch channel",
    searchChannels: "Search channels",
    voiceChannels: "Voice channels",
    peopleOnline: "{{count}} online",
    channelPreparing: "Channel list is preparing",
    channelPreparingLead: "Voice still works when the server does not expose a channel directory.",
    reload: "Reload",
    quickActions: "Quick actions",
    inviteFriends: "Invite friends",
    audioAndMic: "Audio & microphone",
    stableConnection: "Stable connection",
    websocket: "WebSocket",
    serverBreadcrumb: "Server",
    copyInvite: "Copy invite link",
    exit: "Exit",
    live: "LIVE",
    voiceSpace: "Voice space",
    roomDescription: "Stay in clear, natural conversation with everyone in this channel.",
    membersOnline: "{{count}} members online",
    encrypted: "Encrypted connection",
    voiceActivity: "VOICE ACTIVITY",
    speakingNow: "Speaking now",
    onlineShort: "{{count}} online",
    connected: "Connected",
    speaking: "Speaking…",
    connectedYou: "Connected · you",
    moreMembers: "More members",
    viewLeft: "See them on the left",
    textChannel: "TEXT CHANNEL",
    channelChat: "{{channel}} chat",
    messageCount: "{{count}} messages",
    chatStart: "This is the beginning of the chat",
    chatStartLead: "Send a message and say hello to your channel friends.",
    attachmentUnavailable: "Attachments unavailable",
    emojiUnavailable: "Emoji unavailable",
    sendMessagePlaceholder: "Message the channel…",
    send: "Send",
    freeMic: "Open mic",
    pushToTalk: "Push to talk",
    pushToTalkHint: "Hold Space to talk",
    sending: "Sending",
    micReady: "Microphone ready",
    exitVoice: "Leave voice",
    people: "People",
    searchMembers: "Search members",
    onlineGroup: "ONLINE — {{count}}",
    yourDevice: "Your device",
    memberOnline: "Online",
    noMatchingMembers: "No matching members",
    noMembersInChannel: "No members in this channel",
    volumeTip: "Drag a member slider to adjust their volume just for you.",
    moreMemberOptions: "More member options",
    connectedToast: "You are connected to this server",
    volumeToast: "Adjust each member's volume from the list",
    copiedToast: "Invite link copied",
    copyFailedToast: "Copy failed. Copy the browser address manually",
    leftToast: "You left the voice space",
    focusedToast: "This version is focused on the voice workspace",
    settings: "Settings",
    profile: "Profile",
    privacy: "Privacy",
    notifications: "Notifications",
    browserClient: "Browser client",
    audioConfiguration: "Audio configuration",
    inputDevice: "Input device",
    microphone: "Microphone",
    microphoneMode: "Microphone mode",
    defaultMicrophone: "Default browser microphone",
    microphoneNumber: "Microphone {{index}}",
    inputVolume: "Input volume",
    microphoneTest: "Microphone test",
    stopTest: "Stop test",
    startTest: "Start test",
    silence: "Silence",
    optimal: "Optimal",
    loud: "Loud",
    outputDevice: "Output device",
    speakers: "Speakers / headphones",
    defaultOutput: "Default browser output",
    outputVolume: "Output volume",
    audioPrivacy: "WebSpeak processes audio in the browser's secure context and does not save recordings.",
    cancel: "Cancel",
    saveChanges: "Save changes",
    close: "Close",
    done: "Done",
    voiceLobby: "Voice lobby",
    langSwitch: "中文",
  },
};

function getInitialLanguage(): Language {
  const stored = localStorage.getItem("webspeak:language");
  if (stored === "zh" || stored === "en") return stored;
  // Keep the existing Chinese-first experience; the choice is remembered
  // after the visitor uses the language switcher.
  return "zh";
}

function t(key: string, variables: Record<string, string | number> = {}) {
  let value = translations[language.value][key] ?? translations.zh[key] ?? key;
  for (const [name, replacement] of Object.entries(variables)) value = value.replaceAll(`{{${name}}}`, String(replacement));
  return value;
}

function localizedMessage(message: string) {
  if (language.value === "zh") return message;
  const exact: Record<string, string> = {
    "语音功能需要 HTTPS 安全连接": "Voice requires a secure HTTPS connection",
    "当前浏览器不支持麦克风访问": "This browser does not support microphone access",
    "当前浏览器不支持音频解码，请使用最新版 Chrome 或 Edge": "Audio decoding is unavailable. Use the latest Chrome or Edge",
    "连接服务器失败，请检查邀请链接或服务器状态": "Could not connect. Check the invite link or server status",
    "TeamSpeak 连接已断开": "The TeamSpeak connection was closed",
    "连接已断开": "The connection was closed",
    "TeamSpeak 服务器地址无效": "The TeamSpeak server address is invalid",
    "TeamSpeak 服务器连接失败": "Could not connect to the TeamSpeak server",
    "服务器当前已满，请稍后重试": "The server is full. Try again shortly",
  };
  if (exact[message]) return exact[message];
  if (message.startsWith("麦克风访问失败：")) return `Microphone access failed: ${message.slice(8)}`;
  if (message.startsWith("切换失败：")) return `Channel switch failed: ${message.slice(5)}`;
  return message;
}

function toggleLanguage() {
  language.value = language.value === "zh" ? "en" : "zh";
  localStorage.setItem("webspeak:language", language.value);
}

const heroBars = [12, 24, 18, 35, 18, 28, 42, 23, 50, 34, 19, 28, 39, 22, 46, 25, 17, 31, 14];

const channelTree = computed<TreeChannel[]>(() => {
  const source = [...channels];
  const byId = new Map(source.map((item) => [item.id, item]));
  const depthCache = new Map<string, number>();

  function depthOf(item: ChannelInfo, visiting = new Set<string>()): number {
    if (depthCache.has(item.id)) return depthCache.get(item.id)!;
    if (!item.parentID || item.parentID === "0" || visiting.has(item.id)) return 0;
    const parent = byId.get(item.parentID);
    const depth = parent ? depthOf(parent, new Set(visiting).add(item.id)) + 1 : 0;
    depthCache.set(item.id, depth);
    return depth;
  }

  return source
    .map((item) => ({
      ...item,
      depth: depthOf(item),
      members: (item.members ?? []).map((member) => ({ ...member, isSelf: member.id === voiceState.tsClientId })),
    }))
    .sort((a, b) => `${a.parentID}/${a.id}`.localeCompare(`${b.parentID}/${b.id}`));
});

const currentChannel = computed<TreeChannel | undefined>(() => {
  const explicitlySelected = channelTree.value.find((item) => item.id === selectedChannelId.value);
  if (explicitlySelected) return explicitlySelected;
  const fromSelf = channelTree.value.find((item) => item.members.some((member) => member.id === voiceState.tsClientId));
  if (fromSelf) return fromSelf;
  return channelTree.value.find((item) => item.name === channel.value) ?? channelTree.value[0];
});
const currentChannelName = computed(() => (currentChannel.value?.name ?? channel.value) || t("voiceLobby"));
const currentChannelDescription = computed(() => currentChannel.value?.description ?? "");
const currentMembers = computed<ChannelMember[]>(() => {
  const source = currentChannel.value ? currentChannel.value.members : members;
  return source.map((member) => ({ ...member, isSelf: member.isSelf || member.id === voiceState.tsClientId }));
});
const roomMembers = computed(() => currentMembers.value.slice(0, 4));
const memberChannels = computed<TreeChannel[]>(() => {
  if (channelTree.value.length) return channelTree.value;
  return [{ id: "__current__", parentID: "0", name: currentChannelName.value, description: currentChannelDescription.value, members: currentMembers.value, depth: 0 }];
});
const filteredMemberChannels = computed(() => {
  const search = memberQuery.value.trim().toLowerCase();
  if (!search) return memberChannels.value;
  return memberChannels.value.filter((item) => item.name.toLowerCase().includes(search) || item.members.some((member) => member.nickname.toLowerCase().includes(search)));
});

watch(channelTree, (list) => {
  if (!selectedChannelId.value && list[0]) {
    selectedChannelId.value = list.find((item) => item.name === channel.value)?.id
      ?? list.find((item) => item.members.some((member) => member.id === voiceState.tsClientId))?.id
      ?? "";
  }
}, { deep: true });
watch(() => chatMessages.length, () => nextTick(scrollChatToEnd));
watch(settingsOpen, (open) => {
  if (open) {
    audioSettingsError.value = "";
    prepareInputDevices().catch((error: unknown) => {
      audioSettingsError.value = microphoneErrorMessage(error);
    });
  } else {
    stopMicrophoneTest();
  }
});

let deviceChangeHandler: (() => void) | undefined;

onMounted(() => {
  browserError.value = checkSupport() ?? "";
  void loadPublicConfig();
  deviceChangeHandler = () => { void prepareInputDevices().catch(() => undefined); };
  navigator.mediaDevices?.addEventListener("devicechange", deviceChangeHandler);
});
onUnmounted(() => {
  disconnect();
  if (deviceChangeHandler) navigator.mediaDevices?.removeEventListener("devicechange", deviceChangeHandler);
  if (toastTimer) clearTimeout(toastTimer);
});

function doConnect() {
  const host = serverHost.value.trim();
  const port = Number.parseInt(serverPort.value, 10);
  if (!nickname.value.trim() || !host || !validServerPort.value || voiceState.connecting) return;
  clearError();
  nickname.value = nickname.value.trim();
  serverHost.value = host;
  serverPort.value = String(port);
  localStorage.setItem("webspeak:nickname", nickname.value);
  localStorage.setItem("webspeak:ts-host", host);
  localStorage.setItem("webspeak:ts-port", String(port));
  selectedChannelId.value = "";
  connect(host, port, channel.value.trim(), nickname.value);
}

function doDisconnect() {
  disconnect();
  selectedChannelId.value = "";
  showToast(t("leftToast"));
}

function selectChannel(item: TreeChannel) {
  selectedChannelId.value = item.id;
  channel.value = item.name;
  switchChannel(item.id);
}

function selectChannelById() {
  const item = channelTree.value.find((candidate) => candidate.id === selectedChannelId.value);
  if (item) selectChannel(item);
}

function channelLabel(item: TreeChannel) {
  return `${"　".repeat(item.depth)}${item.name}`;
}

function doShare() {
  const invite = new URL(location.href);
  invite.searchParams.delete("token");
  if (serverHost.value.trim()) invite.searchParams.set("tsHost", serverHost.value.trim());
  if (validServerPort.value) invite.searchParams.set("tsPort", String(Number.parseInt(serverPort.value, 10)));
  if (channel.value) invite.searchParams.set("channel", channel.value);
  navigator.clipboard?.writeText(invite.toString()).then(() => showToast(t("copiedToast")), () => showToast(t("copyFailedToast")));
}

const validServerPort = computed(() => {
  const port = Number.parseInt(serverPort.value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535;
});

const configTemplate = computed(() => {
  const tsPort = Number.parseInt(serverPort.value, 10);
  const config: Record<string, unknown> = {
    tsHost: serverHost.value.trim() || "127.0.0.1",
    tsPort: Number.isInteger(tsPort) && tsPort > 0 && tsPort <= 65535 ? tsPort : 9987,
    tsServerPassword: guideServerPassword.value,
  };
  return JSON.stringify(config, null, 2);
});

async function copyConfigTemplate() {
  try {
    if (!navigator.clipboard) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(configTemplate.value);
    showToast(t("configCopiedToast"));
  } catch {
    showToast(t("configCopyFailedToast"));
  }
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/public-config", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const config = await response.json() as { tsHost?: unknown; tsPort?: unknown };
    if (!query.has("tsHost") && !localStorage.getItem("webspeak:ts-host") && typeof config.tsHost === "string" && config.tsHost.trim()) {
      serverHost.value = config.tsHost.trim();
    }
    if (!query.has("tsPort") && !localStorage.getItem("webspeak:ts-port") && Number.isInteger(config.tsPort)) {
      serverPort.value = String(config.tsPort);
    }
  } catch {
    // The sensible browser-host/9987 defaults remain usable when the API is unavailable.
  } finally {
    serverConfigLoading.value = false;
  }
}

function submitMessage() {
  if (!messageDraft.value.trim()) return;
  sendTextMessage(messageDraft.value);
  messageDraft.value = "";
}

function scrollChatToEnd() {
  const list = chatListEl.value;
  if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
}

function showToast(message: string) {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2800);
}

function avatarInitial(name: string) {
  return (name.trim()[0] || "?").toUpperCase();
}

const avatarColors = ["#9edbd4", "#b9d4c5", "#e8c6a8", "#c5c7e8", "#edd2d4", "#c8d9e9", "#e4d3b8"];
function avatarStyle(name: string, isSelf = false) {
  if (isSelf) return { background: "linear-gradient(135deg, #006a64, #2e9f96)" };
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = name.charCodeAt(index) + ((hash << 5) - hash);
  return { background: avatarColors[Math.abs(hash) % avatarColors.length] };
}

function isSpeaking(member: ChannelMember) {
  return speakingIds.has(member.id) || Boolean(member.isSelf && pttActive.value);
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(language.value === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function rangeStyle(value: number, max: number) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return { background: `linear-gradient(to right, #006a64 0%, #006a64 ${percent}%, #e7eceb ${percent}%, #e7eceb 100%)` };
}

function onVolInput(clientId: number, event: Event) {
  setVolume(clientId, Number((event.target as HTMLInputElement).value) / 100);
}

function onInputVolume(event: Event) {
  setInputVolume(Number((event.target as HTMLInputElement).value) / 100);
}

function onOutputVolume(event: Event) {
  setOutputVolume(Number((event.target as HTMLInputElement).value) / 100);
}

async function onInputDeviceChange(event: Event) {
  audioSettingsError.value = "";
  try {
    await setInputDevice((event.target as HTMLSelectElement).value);
  } catch (error: unknown) {
    audioSettingsError.value = microphoneErrorMessage(error, "无法切换麦克风");
  }
}

async function toggleMicTest() {
  audioSettingsError.value = "";
  try {
    if (microphoneTestActive.value) stopMicrophoneTest();
    else await startMicrophoneTest();
  } catch (error: unknown) {
    audioSettingsError.value = microphoneErrorMessage(error);
  }
}

function microphoneErrorMessage(error: unknown, fallback = "请检查浏览器权限") {
  const name = error instanceof DOMException ? error.name : "";
  const reasons: Record<string, string> = {
    NotAllowedError: "浏览器未授予麦克风权限",
    NotFoundError: "未找到可用的麦克风",
    NotReadableError: "麦克风可能正被其他程序占用",
    OverconstrainedError: "所选麦克风当前不可用",
    SecurityError: "浏览器阻止了麦克风访问",
  };
  return `麦克风访问失败：${reasons[name] ?? fallback}`;
}

const micMeterBars = computed(() => Math.round(micLevel.value * 24));
function meterBarHeight(index: number) {
  if (!microphoneTestActive.value) return 5;
  const intensity = Math.max(0, micLevel.value - (index / 24) * 0.65);
  return 5 + Math.round(intensity * 34);
}

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
  if (event.code === "Space" && micMode.value === "ptt" && !pttActive.value) {
    event.preventDefault();
    startPointerTalk();
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === "Space" && micMode.value === "ptt") {
    event.preventDefault();
    stopPointerTalk();
  }
}

function startPointerTalk() {
  if (micMode.value !== "ptt") return;
  pttActive.value = true;
  setPTT(true);
}

function stopPointerTalk() {
  if (!pttActive.value) return;
  pttActive.value = false;
  setPTT(false);
}
</script>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(body) { margin: 0; background: #f7f9f8; color: #192120; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
:global(button), :global(input) { font: inherit; }
:global(button) { border: 0; }

.web-client { min-height: 100dvh; outline: none; background: #f7f9f8; color: #192120; }
.join-page { min-height: 100dvh; display: flex; flex-direction: column; background: radial-gradient(circle at 76% 30%, rgba(126, 213, 205, .16), transparent 27rem), #f7f9f8; }
.join-header, .join-content, .join-footer { width: min(1240px, calc(100% - 64px)); margin: 0 auto; }
.join-header { min-height: 84px; display: flex; align-items: center; justify-content: space-between; }
.brand-lockup { display: flex; align-items: center; gap: 12px; }
.brand-mark, .rail-logo { display: grid; place-items: center; color: #fff; background: #006a64; box-shadow: 0 8px 18px rgba(0, 106, 100, .15); }
.brand-mark { width: 40px; height: 40px; border-radius: 12px; }
.brand-lockup strong { display: block; color: #006a64; font-size: 18px; letter-spacing: -.04em; }
.brand-lockup strong span { color: #24312f; font-weight: 500; }
.brand-lockup small { display: block; margin-top: 2px; color: #7b8885; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.header-tools { display: flex; align-items: center; gap: 17px; }
.header-note { display: flex; align-items: center; gap: 8px; color: #71807c; font-size: 12px; }
.language-switch { min-width: 50px; min-height: 28px; padding: 0 9px; color: #006a64; background: #e2f2ef; border: 1px solid #c8e6e1; border-radius: 7px; font-size: 10px; font-weight: 700; cursor: pointer; transition: .18s; }
.language-switch:hover { color: #fff; background: #006a64; border-color: #006a64; }
.tiny-dot, .online-dot, .status-pulse { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #65d879; box-shadow: 0 0 0 4px rgba(101, 216, 121, .14); }
.join-content { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 430px; align-items: center; gap: clamp(60px, 10vw, 148px); padding: 58px 0 80px; }
.join-copy { max-width: 630px; }
.eyebrow, .room-eyebrow { display: flex; align-items: center; gap: 9px; color: #006a64; font-size: 11px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
.eyebrow-dot { width: 9px; height: 9px; border-radius: 50%; background: #90f691; }
.join-copy h1 { margin: 20px 0 18px; color: #192120; font-size: clamp(42px, 5.3vw, 72px); line-height: 1.04; letter-spacing: -.075em; }
.join-copy h1 em { color: #006a64; font-style: normal; }
.join-description { max-width: 500px; margin: 0; color: #65736f; font-size: 17px; line-height: 1.75; }
.promise-list { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 42px; }
.promise-item { display: flex; align-items: center; gap: 10px; min-width: 160px; }
.promise-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #006a64; background: #d8f3ef; }
.promise-icon.mint { color: #258844; background: #e0f6e1; }
.promise-icon.sand { color: #9c6739; background: #f7ebdc; }
.promise-item b, .promise-item small { display: block; }
.promise-item b { color: #283431; font-size: 12px; }
.promise-item small { margin-top: 3px; color: #87938f; font-size: 10px; }
.join-card { padding: 36px; border: 1px solid rgba(214, 226, 223, .8); border-radius: 20px; background: rgba(255, 255, 255, .86); box-shadow: 0 20px 52px rgba(35, 68, 63, .08); backdrop-filter: blur(12px); }
.card-kicker, .section-kicker { color: #79918c; font-size: 10px; font-weight: 700; letter-spacing: .16em; }
.join-card h2 { margin: 10px 0 7px; color: #1b2825; font-size: 27px; letter-spacing: -.045em; }
.card-lead { margin: 0 0 26px; color: #7b8885; font-size: 13px; }
.notice { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 14px; padding: 11px 12px; border-radius: 10px; font-size: 12px; line-height: 1.45; }
.error-notice { color: #a53c38; background: #fff0ef; border: 1px solid #f7d4d1; }
.warning-notice { color: #8a6537; background: #fff8e9; border: 1px solid #f2dfb3; }
.notice-symbol { display: grid; place-items: center; width: 16px; height: 16px; flex: 0 0 auto; border-radius: 50%; color: #fff; background: currentColor; color: #fff; font-size: 10px; font-weight: 800; }
.error-notice .notice-symbol { background: #d95d55; }
.warning-notice .notice-symbol { background: #c89143; }
.join-form { display: grid; gap: 8px; }
.field-grid { display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: 12px; }
.field-grid .field-label { display: block; }
.field-hint { margin: 1px 0 5px; color: #879590; font-size: 10px; line-height: 1.5; }
.field-label, .settings-label { color: #43514d; font-size: 11px; font-weight: 600; }
.field-label:not(:first-child) { margin-top: 10px; }
.field-label span { color: #a2aaa7; font-weight: 400; }
.field-wrap { display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 0 14px; color: #8b9b96; border-radius: 10px; background: #f3f6f5; transition: .2s ease; }
.field-wrap:focus-within { color: #006a64; background: #fff; box-shadow: 0 0 0 2px #81d8d0; }
.field-wrap input { width: 100%; min-width: 0; padding: 0; color: #24312f; outline: none; border: 0; background: transparent; font-size: 13px; }
.field-wrap input::placeholder { color: #a5b0ad; }
.primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 10px; color: #fff; background: #006a64; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform .18s, box-shadow .18s, background .18s; }
.primary-button:hover:not(:disabled) { background: #005650; box-shadow: 0 9px 20px rgba(0, 106, 100, .18); transform: translateY(-1px); }
.primary-button:active:not(:disabled) { transform: translateY(0); }
.primary-button:disabled { cursor: not-allowed; opacity: .45; }
.connect-button { width: 100%; min-height: 48px; margin-top: 17px; font-size: 13px; }
.button-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
.join-meta { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 20px; color: #96a29f; font-size: 10px; }
.join-footer { display: flex; align-items: center; min-height: 68px; color: #9ba6a3; border-top: 1px solid #e8edeb; font-size: 11px; }.join-footer a { color: #628e89; text-decoration: none; }.join-footer a:hover { color: #006a64; text-decoration: underline; }
.footer-separator { margin: 0 8px; color: #ccd5d1; }.footer-spacer { flex: 1; }

.app-shell { display: grid; grid-template-columns: 76px 292px minmax(0, 1fr) 246px; height: 100dvh; overflow: hidden; background: #fff; }
.nav-rail { display: flex; flex-direction: column; align-items: center; padding: 17px 0 14px; color: #52615d; background: #f1f4f3; border-right: 1px solid #e1e9e6; }
.rail-logo { width: 42px; height: 42px; border-radius: 13px; }
.rail-nav { display: flex; flex-direction: column; gap: 8px; margin-top: 40px; }
.rail-button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; width: 58px; padding: 8px 0; color: #7b8a85; background: transparent; border-radius: 10px; cursor: pointer; transition: .18s ease; }
.rail-button span { font-size: 9px; font-weight: 600; }
.rail-button:hover, .rail-button.active { color: #006a64; background: #dcefeb; }
.rail-button.active::before { position: absolute; left: -9px; top: 11px; width: 3px; height: 27px; border-radius: 0 3px 3px 0; background: #006a64; content: ""; }
.rail-bottom { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: auto; }
.rail-avatar { display: grid; place-items: center; width: 34px; height: 34px; color: #fff; background: #006a64; border: 3px solid #fff; border-radius: 50%; font-size: 11px; font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,.08); cursor: pointer; }
.channel-sidebar { display: flex; flex-direction: column; min-width: 0; color: #2b3935; background: #f8faf9; border-right: 1px solid #e6ecea; }
.sidebar-server { display: flex; align-items: center; gap: 10px; min-height: 73px; padding: 15px 15px 12px; border-bottom: 1px solid #e6ecea; }
.server-avatar { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; color: #006a64; background: #d8f0ed; border-radius: 10px; }
.server-heading { min-width: 0; flex: 1; }.server-heading strong, .server-heading span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.server-heading strong { color: #24312f; font-size: 12px; }.server-heading span { margin-top: 4px; color: #84918d; font-size: 10px; }.server-heading i { display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 50%; background: #65d879; }
.round-icon { display: grid; place-items: center; width: 31px; height: 31px; flex: 0 0 auto; color: #71817c; background: transparent; border-radius: 8px; cursor: pointer; transition: .18s; }.round-icon:hover { color: #006a64; background: #e4efec; }
.sidebar-profile { display: flex; align-items: center; gap: 10px; padding: 18px 17px 14px; }.profile-avatar, .dock-avatar { display: grid; place-items: center; flex: 0 0 auto; color: #fff; border-radius: 11px; font-weight: 700; }.profile-avatar { width: 38px; height: 38px; font-size: 12px; }.profile-copy { min-width: 0; flex: 1; }.profile-copy strong, .profile-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.profile-copy strong { color: #263530; font-size: 12px; }.profile-copy span { margin-top: 4px; color: #7d8e88; font-size: 10px; }.profile-settings { display: grid; place-items: center; color: #7d8e88; background: transparent; cursor: pointer; }.profile-settings:hover { color: #006a64; }
.channel-search, .member-search { display: flex; align-items: center; gap: 8px; color: #85928e; background: #eef3f1; border-radius: 8px; }.channel-search { margin: 0 14px 18px; padding: 0 10px; min-height: 34px; }.channel-search input, .member-search input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; color: #40504b; font-size: 11px; }.channel-search input::placeholder, .member-search input::placeholder { color: #9ba6a3; }.channel-search kbd { padding: 2px 5px; color: #9aa7a3; background: #fff; border: 1px solid #dbe4e0; border-radius: 4px; font-size: 9px; }
.sidebar-scroll { flex: 1; overflow-y: auto; padding-bottom: 14px; }.channel-section-title { display: flex; align-items: center; justify-content: space-between; padding: 0 14px 8px; color: #82908c; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }.channel-section-title button { display: grid; place-items: center; padding: 2px; color: #87958f; background: transparent; cursor: pointer; }.channel-section-title button:hover { color: #006a64; }
.channel-entry { display: flex; align-items: center; gap: 9px; min-height: 46px; padding-right: 12px; color: #56635f; cursor: pointer; transition: .16s; }.channel-entry:hover { background: #eef5f2; }.channel-entry.selected { color: #006a64; background: #dcefeb; }.channel-entry-copy { min-width: 0; flex: 1; }.channel-entry-copy strong, .channel-entry-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.channel-entry-copy strong { font-size: 12px; font-weight: 600; }.channel-entry-copy span { margin-top: 3px; color: #93a09c; font-size: 9px; }.channel-entry.selected .channel-entry-copy span { color: #4c9690; }.channel-selected-mark { margin-left: auto; color: #006a64; }.channel-member-preview { display: flex; flex-direction: column; gap: 6px; padding: 3px 12px 8px 0; color: #74827e; font-size: 10px; }.mini-member { display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.mini-avatar { display: grid; place-items: center; width: 18px; height: 18px; flex: 0 0 auto; color: #fff; border-radius: 6px; font-size: 8px; font-weight: 700; }.mini-member b { margin-left: auto; color: #006a64; font-size: 9px; }.more-members { color: #006a64; font-size: 9px; }.channel-empty { margin: 5px 14px 0; padding: 19px 14px; color: #8a9793; border: 1px dashed #d3dfdb; border-radius: 10px; text-align: center; }.empty-icon { display: grid; place-items: center; width: 34px; height: 34px; margin: 0 auto 9px; color: #6aa9a3; background: #e2f2ef; border-radius: 10px; }.channel-empty strong { display: block; color: #5a6964; font-size: 11px; }.channel-empty p { margin: 6px 0 12px; font-size: 10px; line-height: 1.5; }.channel-empty button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; color: #006a64; background: #e0f3f0; border-radius: 6px; font-size: 10px; cursor: pointer; }.sidebar-divider { height: 1px; margin: 18px 14px; background: #e2e9e6; }.quick-action { display: flex; align-items: center; gap: 10px; width: calc(100% - 28px); margin: 2px 14px; padding: 9px 5px; color: #6d7c77; background: transparent; text-align: left; cursor: pointer; }.quick-action:hover { color: #006a64; }.quick-action span { flex: 1; font-size: 11px; }.quick-action .ui-icon:last-child { color: #a6b2ae; }.sidebar-footer { display: flex; align-items: center; gap: 7px; min-height: 43px; padding: 0 16px; color: #75837e; border-top: 1px solid #e6ecea; font-size: 10px; }.footer-latency { margin-left: auto; color: #a0ada8; font-size: 9px; }

.workspace { display: flex; min-width: 0; flex-direction: column; background: #fff; }.workspace-header { display: flex; align-items: center; justify-content: space-between; min-height: 73px; padding: 0 29px; border-bottom: 1px solid #eef2f0; }.breadcrumbs { display: flex; align-items: center; gap: 9px; min-width: 0; color: #52605b; font-size: 12px; }.breadcrumbs strong { overflow: hidden; color: #26332f; text-overflow: ellipsis; white-space: nowrap; }.crumb-muted { color: #98a39f; }.mobile-brand { display: none; color: #006a64; font-size: 17px; font-weight: 800; letter-spacing: -.06em; }.mobile-brand em { color: #293632; font-style: normal; font-weight: 500; }.workspace-actions, .dock-actions { display: flex; align-items: center; gap: 8px; }.header-action, .dock-icon { display: grid; place-items: center; color: #75847f; background: transparent; border-radius: 8px; cursor: pointer; transition: .16s; }.header-action { width: 32px; height: 32px; }.header-action:hover, .dock-icon:hover { color: #006a64; background: #edf5f2; }.disconnect-button { display: inline-flex; align-items: center; gap: 6px; min-height: 33px; margin-left: 8px; padding: 0 13px; color: #a94d48; background: #fff2f1; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }.disconnect-button:hover { color: #fff; background: #c95a54; }
.workspace { display: flex; min-width: 0; flex-direction: column; background: #fff; }.workspace-header { display: flex; align-items: center; justify-content: space-between; min-height: 73px; padding: 0 29px; border-bottom: 1px solid #eef2f0; }.breadcrumbs { display: flex; align-items: center; gap: 9px; min-width: 0; color: #52605b; font-size: 12px; }.breadcrumbs strong { overflow: hidden; color: #26332f; text-overflow: ellipsis; white-space: nowrap; }.crumb-muted { color: #98a39f; }.mobile-brand { display: none; color: #006a64; font-size: 17px; font-weight: 800; letter-spacing: -.06em; }.mobile-brand em { color: #293632; font-style: normal; font-weight: 500; }.workspace-actions, .dock-actions { display: flex; align-items: center; gap: 8px; }.header-action, .dock-icon { display: grid; place-items: center; color: #75847f; background: transparent; border-radius: 8px; cursor: pointer; transition: .16s; }.header-action { width: 32px; height: 32px; }.header-action:hover, .dock-icon:hover { color: #006a64; background: #edf5f2; }.workspace-language { margin-left: 3px; }.disconnect-button { display: inline-flex; align-items: center; gap: 6px; min-height: 33px; margin-left: 8px; padding: 0 13px; color: #a94d48; background: #fff2f1; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }.disconnect-button:hover { color: #fff; background: #c95a54; }
.workspace-scroll { flex: 1; overflow-y: auto; }.workspace-content { width: min(950px, calc(100% - 64px)); margin: 0 auto; padding: 31px 0 27px; }.room-hero { position: relative; min-height: 190px; overflow: hidden; padding: 30px 34px; border-radius: 16px; background: linear-gradient(110deg, #e3f4f1, #f8fbfa 68%, #fff); }.room-hero-content { position: relative; z-index: 1; }.room-eyebrow { color: #4d817a; font-size: 10px; }.live-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; color: #2d7540; background: #d6f5d9; border-radius: 999px; font-size: 9px; letter-spacing: .08em; }.live-pill i { width: 5px; height: 5px; border-radius: 50%; background: #56cf69; }.room-hero h1 { display: flex; align-items: center; gap: 8px; margin: 16px 0 7px; color: #18302c; font-size: 26px; letter-spacing: -.05em; }.room-hero h1 .ui-icon { color: #006a64; }.room-hero p { max-width: 470px; margin: 0; color: #64817a; font-size: 12px; line-height: 1.6; }.room-stats { display: flex; align-items: center; gap: 11px; margin-top: 19px; color: #52716b; font-size: 10px; }.room-stats span { display: inline-flex; align-items: center; gap: 5px; }.stat-divider { width: 1px; height: 13px; background: #b8d9d4; }.hero-decoration { position: absolute; border: 1px solid rgba(0,106,100,.12); border-radius: 50%; }.hero-decoration.one { width: 250px; height: 250px; right: 48px; top: -116px; }.hero-decoration.two { width: 355px; height: 355px; right: -20px; top: -168px; }.hero-visual { position: absolute; right: 85px; bottom: 20px; width: 160px; height: 120px; opacity: .75; }.orbit { position: absolute; inset: 16px 4px; border: 1px solid rgba(0,106,100,.19); border-radius: 50%; transform: rotate(28deg); }.orbit-b { inset: 0 26px; transform: rotate(-49deg); }.hero-wave { position: absolute; right: 29px; bottom: 45px; display: flex; align-items: center; gap: 4px; height: 53px; }.hero-wave i { display: block; width: 3px; min-height: 8px; border-radius: 4px; background: #63c7bf; animation: wave 2.2s ease-in-out infinite alternate; }.hero-wave i:nth-child(3n) { background: #90f691; animation-delay: -.8s; }.hero-wave i:nth-child(4n) { animation-delay: -.4s; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }.voice-section { margin-top: 34px; }.section-heading h2 { display: flex; align-items: center; gap: 7px; margin: 6px 0 0; color: #1d2926; font-size: 20px; letter-spacing: -.04em; }.section-counter { color: #87928e; font-size: 10px; }.voice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(142px, 1fr)); gap: 12px; margin-top: 17px; }.voice-card { min-height: 152px; padding: 17px 11px 13px; border: 1px solid #edf1ef; border-radius: 13px; background: #fff; box-shadow: 0 7px 18px rgba(20,58,51,.04); text-align: center; transition: .18s; }.voice-card:hover { transform: translateY(-2px); box-shadow: 0 11px 24px rgba(20,58,51,.08); }.voice-card.speaking { border-color: #90f691; box-shadow: 0 0 14px rgba(144,246,145,.35); }.voice-avatar-wrap { position: relative; width: 68px; margin: 0 auto 11px; }.voice-avatar { display: grid; place-items: center; width: 68px; height: 68px; color: #fff; border-radius: 50%; font-size: 20px; font-weight: 700; }.voice-status { position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; width: 24px; height: 24px; color: #78908b; background: #fff; border: 1px solid #e0eae6; border-radius: 50%; }.voice-status.speaking { color: #278c3b; border-color: #90f691; }.voice-card > strong, .voice-card > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.voice-card > strong { color: #2c3935; font-size: 12px; }.voice-card > span { margin-top: 5px; color: #91a09a; font-size: 10px; }.voice-card.speaking > span { color: #278c3b; }.more-card { display: grid; place-items: center; align-content: center; }.more-count { display: grid; place-items: center; width: 54px; height: 54px; margin-bottom: 11px; color: #006a64; background: #e0f2ef; border-radius: 50%; font-size: 14px; font-weight: 700; }.voice-empty { display: flex; align-items: center; gap: 11px; margin-top: 17px; padding: 18px; color: #83908c; border: 1px dashed #dce6e2; border-radius: 12px; font-size: 11px; }.voice-empty .empty-icon { margin: 0; width: 34px; height: 34px; }.voice-empty strong { color: #4c5e58; }.voice-empty span:last-child { margin-left: auto; }
.chat-panel { margin-top: 34px; padding: 0 0 16px; border-top: 1px solid #eef2f0; }.chat-heading { padding-top: 25px; }.chat-heading h2 .ui-icon { color: #006a64; }.message-list { display: flex; flex-direction: column; gap: 18px; min-height: 170px; max-height: 360px; overflow-y: auto; padding: 22px 8px 10px 3px; }.chat-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 145px; color: #9aa6a2; text-align: center; }.chat-empty-icon { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 11px; color: #6fa8a2; background: #e5f3f1; border-radius: 14px; }.chat-empty strong { color: #556761; font-size: 12px; }.chat-empty span { margin-top: 5px; font-size: 10px; }.message-row { display: flex; align-items: flex-start; gap: 11px; max-width: 78%; }.message-row.mine { align-self: flex-end; flex-direction: row-reverse; }.message-avatar { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; color: #fff; border-radius: 10px; font-size: 11px; font-weight: 700; }.message-body { min-width: 0; }.message-meta { display: flex; align-items: baseline; gap: 8px; margin: 1px 0 6px; }.message-row.mine .message-meta { justify-content: flex-end; }.message-meta strong { color: #384843; font-size: 11px; }.message-meta time { color: #a1ada9; font-size: 9px; }.message-bubble { padding: 10px 13px; color: #43534e; background: #f1f5f3; border-radius: 4px 13px 13px 13px; font-size: 12px; line-height: 1.55; }.message-row.mine .message-bubble { color: #fff; background: #006a64; border-radius: 13px 4px 13px 13px; }.message-composer { display: flex; align-items: center; gap: 7px; min-height: 48px; padding: 6px 8px 6px 12px; background: #f3f6f5; border-radius: 11px; }.message-composer input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; color: #3a4944; font-size: 12px; }.message-composer input::placeholder { color: #9aa6a2; }.composer-tool { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 auto; color: #94a19d; background: transparent; border-radius: 7px; }.composer-tool:not(:disabled) { cursor: pointer; }.composer-tool:disabled { opacity: .6; }.send-button { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; color: #fff; background: #006a64; border-radius: 9px; cursor: pointer; }.send-button:disabled { cursor: not-allowed; opacity: .35; }
.control-dock { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 74px; padding: 10px 29px; border-top: 1px solid #e9efec; background: rgba(255,255,255,.94); box-shadow: 0 -5px 18px rgba(23,52,47,.03); }.dock-user { display: flex; align-items: center; gap: 9px; min-width: 140px; }.dock-avatar { width: 34px; height: 34px; border-radius: 10px; font-size: 11px; }.dock-user strong, .dock-user span { display: block; }.dock-user strong { max-width: 125px; overflow: hidden; color: #33423d; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }.dock-user span { display: flex; align-items: center; gap: 5px; margin-top: 4px; color: #7e8d87; font-size: 9px; }.dock-user span i { width: 5px; height: 5px; border-radius: 50%; background: #65d879; }.dock-center { display: flex; align-items: center; gap: 14px; }.mic-mode-switch { display: flex; padding: 3px; background: #eef3f1; border-radius: 8px; }.mic-mode-switch button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 9px; color: #8b9894; background: transparent; border-radius: 6px; font-size: 10px; cursor: pointer; }.mic-mode-switch button.active { color: #006a64; background: #fff; box-shadow: 0 2px 5px rgba(21,54,48,.08); font-weight: 700; }.ptt-indicator { display: inline-flex; align-items: center; gap: 7px; color: #7c8b86; font-size: 10px; }.ptt-indicator span { width: 7px; height: 7px; border-radius: 50%; background: #b2bfbb; }.ptt-indicator.active { color: #278c3b; }.ptt-indicator.active span { background: #65d879; box-shadow: 0 0 0 4px rgba(101,216,121,.15); }.dock-actions { min-width: 140px; justify-content: flex-end; }.dock-icon { width: 34px; height: 34px; }.dock-end { display: grid; place-items: center; width: 37px; height: 37px; color: #fff; background: #c95a54; border-radius: 10px; cursor: pointer; }.dock-end:hover { background: #b84c47; }

.member-panel { min-width: 0; padding: 26px 16px; color: #2c3935; background: #fbfcfc; border-left: 1px solid #eef2f0; }.member-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; }.member-panel-heading h2 { margin: 5px 0 0; color: #25322e; font-size: 19px; letter-spacing: -.04em; }.member-search { margin-top: 18px; padding: 0 10px; min-height: 33px; }.member-group { margin-top: 24px; }.member-group-title { display: flex; align-items: center; gap: 8px; color: #85928e; font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }.group-line { height: 1px; flex: 1; background: #e6edeb; }.member-list { display: flex; flex-direction: column; gap: 17px; margin-top: 17px; }.member-row { display: flex; align-items: center; gap: 8px; min-width: 0; }.member-avatar { position: relative; display: grid; place-items: center; width: 33px; height: 33px; flex: 0 0 auto; color: #fff; border-radius: 10px; font-size: 10px; font-weight: 700; }.member-avatar.speaking { box-shadow: 0 0 0 2px #90f691, 0 0 10px rgba(144,246,145,.35); }.member-presence { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; border: 2px solid #fbfcfc; border-radius: 50%; background: #65d879; }.member-copy { min-width: 0; flex: 1; }.member-copy strong, .member-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.member-copy strong { color: #34423d; font-size: 10px; }.member-copy span { margin-top: 4px; color: #96a29e; font-size: 9px; }.member-volume { display: flex; align-items: center; gap: 5px; color: #a1afaa; width: 64px; }.member-volume input { width: 45px; height: 4px; appearance: none; border-radius: 99px; outline: none; cursor: pointer; }.member-volume input::-webkit-slider-thumb, .settings-range::-webkit-slider-thumb { width: 14px; height: 14px; appearance: none; border: 2px solid #81d8d0; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.12); cursor: pointer; }.member-volume input::-moz-range-thumb, .settings-range::-moz-range-thumb { width: 14px; height: 14px; border: 2px solid #81d8d0; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.12); cursor: pointer; }.member-empty { margin-top: 22px; color: #98a49f; font-size: 10px; text-align: center; }.member-panel-tip { display: flex; gap: 8px; margin-top: 36px; padding: 12px; color: #72827c; background: #eef5f2; border-radius: 9px; font-size: 9px; line-height: 1.5; }.member-panel-tip .ui-icon { color: #5e9e96; }

.modal-backdrop { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 28px; background: rgba(25, 33, 31, .42); backdrop-filter: blur(5px); }.settings-modal { display: flex; width: min(920px, 100%); max-height: min(760px, calc(100dvh - 56px)); overflow: hidden; border-radius: 16px; background: #fff; box-shadow: 0 20px 60px rgba(16,40,35,.2); }.settings-nav { display: flex; flex-direction: column; width: 215px; flex: 0 0 auto; padding: 28px 12px 20px; background: #f8faf9; border-right: 1px solid #e6ecea; }.settings-title { padding: 0 13px 20px; color: #25322e; font-size: 19px; font-weight: 700; }.settings-nav-item { display: flex; align-items: center; gap: 12px; padding: 11px 13px; color: #65736f; background: transparent; border-left: 3px solid transparent; border-radius: 8px; font-size: 11px; text-align: left; cursor: pointer; }.settings-nav-item.active { color: #006a64; background: #e2efec; border-left-color: #006a64; font-weight: 700; }.settings-version { margin-top: auto; padding: 20px 13px 0; color: #98a5a0; border-top: 1px solid #e4ebe8; font-size: 10px; line-height: 1.7; }.settings-version span { color: #b0bbb7; }.settings-main { display: flex; min-width: 0; flex: 1; flex-direction: column; }.settings-header { display: flex; align-items: center; justify-content: space-between; min-height: 75px; padding: 0 28px; border-bottom: 1px solid #edf1ef; }.settings-header h2 { margin: 0; color: #202c29; font-size: 22px; letter-spacing: -.045em; }.settings-content { flex: 1; overflow-y: auto; padding: 28px 40px; }.settings-section { max-width: 620px; margin: 0 auto; }.settings-section h3 { display: flex; align-items: center; gap: 9px; margin: 0 0 21px; color: #293631; font-size: 16px; }.settings-section h3 .ui-icon { color: #006a64; }.settings-label { display: block; margin-bottom: 8px; color: #5e6d67; font-size: 10px; font-weight: 500; }.select-like { display: flex; align-items: center; justify-content: space-between; min-height: 39px; margin-bottom: 19px; padding: 0 13px; color: #394742; background: #f4f7f6; border-radius: 8px; font-size: 11px; }.select-like .ui-icon { color: #677671; }.settings-range-row { display: flex; align-items: center; justify-content: space-between; }.settings-range-row .settings-label { margin: 0; }.settings-range-row strong { color: #006a64; font-size: 10px; }.settings-range { width: 100%; height: 6px; margin: 11px 0 20px; appearance: none; border-radius: 999px; outline: none; cursor: pointer; }.settings-range::-webkit-slider-thumb { width: 19px; height: 19px; }.settings-range::-moz-range-thumb { width: 19px; height: 19px; }.mic-test { padding: 15px; border: 1px solid #e5ece9; border-radius: 11px; background: #fafcfb; }.mic-test-header { display: flex; align-items: center; justify-content: space-between; }.mic-test-header strong { color: #36453f; font-size: 11px; }.mic-test-header button { padding: 6px 9px; color: #006a64; background: #e0f1ee; border-radius: 5px; font-size: 10px; cursor: pointer; }.meter { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; height: 39px; margin-top: 12px; padding: 0 4px 4px; border-bottom: 1px solid #dce6e2; }.meter i { width: 5px; min-height: 4px; border-radius: 3px 3px 0 0; background: #dfe6e3; }.meter i.active { background: #81ed8b; box-shadow: 0 0 7px rgba(129,237,139,.45); animation: meter 1s ease-in-out infinite alternate; }.meter-labels { display: flex; justify-content: space-between; margin-top: 6px; color: #9ba6a2; font-size: 8px; }.settings-separator { max-width: 620px; margin: 32px auto; border-top: 1px solid #edf1ef; }.mode-note { display: flex; align-items: flex-start; gap: 8px; padding: 12px; color: #66817a; background: #eef7f4; border-radius: 8px; font-size: 10px; line-height: 1.5; }.mode-note .ui-icon { color: #4f9c91; }.settings-footer { display: flex; justify-content: flex-end; gap: 16px; min-height: 67px; padding: 15px 28px; border-top: 1px solid #edf1ef; }.text-button { padding: 0 6px; color: #63716c; background: transparent; font-size: 11px; font-weight: 600; cursor: pointer; }.save-button { padding: 0 23px; }.toast { position: fixed; z-index: 30; right: 24px; bottom: 24px; display: flex; align-items: center; gap: 8px; padding: 11px 15px; color: #fff; background: #263e39; border-radius: 9px; box-shadow: 0 10px 24px rgba(16,48,42,.2); font-size: 11px; animation: toast-in .25s ease-out; }

@keyframes spin { to { transform: rotate(360deg); } } @keyframes wave { from { transform: scaleY(.68); opacity: .65; } to { transform: scaleY(1.08); opacity: 1; } } @keyframes meter { from { transform: scaleY(.65); } to { transform: scaleY(1); } } @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 1200px) { .app-shell { grid-template-columns: 72px 255px minmax(0, 1fr) 218px; }.workspace-content { width: min(900px, calc(100% - 42px)); }.control-dock { padding-inline: 18px; }.dock-center { gap: 8px; }.mic-mode-switch button { padding-inline: 7px; }.member-panel { padding-inline: 12px; }.member-volume { display: none; } }
@media (max-width: 980px) { .app-shell { grid-template-columns: 70px 245px minmax(0, 1fr); }.member-panel { display: none; }.room-hero { min-height: 180px; }.hero-visual { right: 24px; opacity: .55; }.join-content { gap: 40px; }.join-card { padding: 28px; } }
@media (max-width: 740px) { .join-header, .join-content, .join-footer { width: min(100% - 32px, 560px); }.join-header { min-height: 70px; }.header-note { display: none; }.join-content { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 35px; padding: 36px 0 48px; }.join-copy h1 { margin-top: 15px; font-size: 45px; }.join-description { font-size: 14px; }.promise-list { gap: 13px; margin-top: 27px; }.promise-item { min-width: 0; flex: 1 1 30%; }.promise-item small { display: none; }.join-card { padding: 24px 20px; }.join-footer { min-height: 53px; }.join-footer .footer-spacer { display: none; }.join-footer span:last-child { margin-left: auto; }.field-grid { grid-template-columns: minmax(0, 1fr) 112px; gap: 8px; }.app-shell { display: block; height: 100dvh; }.nav-rail, .channel-sidebar, .member-panel { display: none; }.workspace { height: 100%; }.workspace-header { min-height: 61px; padding: 0 15px; }.mobile-brand { display: inline; }.crumb-muted, .breadcrumbs > .ui-icon, .breadcrumbs > strong { display: none; }.workspace-actions { gap: 3px; }.disconnect-button { margin-left: 2px; padding-inline: 9px; }.disconnect-button .ui-icon { display: none; }.workspace-content { width: calc(100% - 30px); padding-top: 18px; }.room-hero { min-height: 182px; padding: 23px 21px; }.room-hero h1 { font-size: 22px; }.room-hero p { max-width: 74%; font-size: 11px; }.hero-visual { right: -15px; bottom: 4px; transform: scale(.75); transform-origin: right bottom; }.voice-section, .chat-panel { margin-top: 25px; }.voice-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.voice-card { min-height: 143px; }.message-row { max-width: 92%; }.control-dock { min-height: 66px; padding: 8px 15px; }.dock-user { min-width: 0; }.dock-user > div:last-child { display: none; }.dock-center { flex: 1; justify-content: center; }.mic-mode-switch button { padding: 6px 7px; font-size: 9px; }.ptt-indicator { display: none; }.dock-actions { min-width: 75px; }.settings-modal { max-height: calc(100dvh - 28px); }.settings-nav { display: none; }.settings-content { padding: 24px 20px; }.settings-header { min-height: 62px; padding-inline: 20px; }.settings-header h2 { font-size: 19px; }.settings-footer { min-height: 61px; padding-inline: 20px; } }
@media (max-width: 420px) { .join-copy h1 { font-size: 38px; }.promise-list { display: grid; grid-template-columns: 1fr; }.promise-item small { display: block; }.join-card { border-radius: 15px; }.voice-grid { gap: 8px; }.voice-card { padding-inline: 6px; }.section-counter { display: none; }.workspace-actions .header-action:first-child { display: none; }.dock-icon { display: none; }.dock-actions { min-width: 37px; }.room-stats { gap: 6px; }.room-stats span:last-child, .stat-divider { display: none; } }

/* The connected view keeps only controls that have a working action. The
   channel tree lives with the member list so every channel remains visible
   even when the current user is elsewhere. */
.app-shell { grid-template-columns: minmax(0, 1fr) 318px; }
.nav-rail, .channel-sidebar { display: none; }
.workspace { min-width: 0; }
.channel-switcher { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 8px; color: #006a64; background: #edf7f4; border: 1px solid #d7ebe6; border-radius: 8px; }
.channel-switcher select { max-width: 165px; padding: 0 2px; color: #31514b; border: 0; outline: 0; background: transparent; font-size: 11px; cursor: pointer; }
.member-panel { display: flex; flex-direction: column; min-height: 0; padding: 26px 18px 18px; overflow: hidden; }
.member-tree { flex: 1; min-height: 0; margin-top: 18px; padding-right: 3px; overflow-y: auto; }
.member-channel-group { padding: 8px 0 14px; border-bottom: 1px solid #e7eeeb; }
.member-channel-group + .member-channel-group { margin-top: 8px; }
.member-channel-heading { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 4px; color: #52635d; background: transparent; border-radius: 7px; text-align: left; cursor: pointer; }
.member-channel-heading:hover, .member-channel-group.current .member-channel-heading { color: #006a64; background: #e5f3f0; }
.member-channel-heading span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; }
.member-channel-heading small { color: #94a29d; font-size: 10px; }
.member-channel-group.current .member-channel-heading small { color: #4d9a92; }
.member-channel-group .member-list { gap: 13px; margin: 9px 4px 0 14px; }
.member-volume { display: flex; }
.channel-no-members { margin: 7px 4px 0 31px; color: #a0ada8; font-size: 10px; }
.member-panel-tip { flex: 0 0 auto; margin-top: 15px; }
.settings-modal { width: min(760px, 100%); }
.settings-nav { display: none; }
.settings-content { padding: 30px 42px; }
.settings-select { display: block; width: 100%; min-height: 42px; margin-bottom: 19px; padding: 0 13px; color: #394742; border: 1px solid #e0eae6; border-radius: 8px; outline: none; background: #f4f7f6; font-size: 11px; cursor: pointer; }
.settings-select:focus { border-color: #81d8d0; box-shadow: 0 0 0 2px rgba(129,216,208,.2); }
.settings-select:disabled { cursor: wait; opacity: .65; }
.settings-error { margin: -9px 0 15px; color: #b14e47; font-size: 10px; line-height: 1.5; }
.settings-footer { justify-content: flex-end; }
.save-button { min-height: 38px; }

/* Increase connected-view typography by 25% while keeping the layout compact. */
.app-shell .breadcrumbs { font-size: 15px; }
.app-shell .channel-switcher select { font-size: 14px; }
.app-shell .disconnect-button { font-size: 14px; }
.app-shell .room-eyebrow { font-size: 12.5px; }
.app-shell .live-pill { font-size: 11.25px; }
.app-shell .room-hero h1 { font-size: 32.5px; }
.app-shell .room-hero p { font-size: 15px; }
.app-shell .room-stats { font-size: 12.5px; }
.app-shell .section-kicker, .app-shell .section-counter { font-size: 12.5px; }
.app-shell .section-heading h2 { font-size: 25px; }
.app-shell .voice-card > strong { font-size: 15px; }
.app-shell .voice-card > span { font-size: 12.5px; }
.app-shell .more-count { font-size: 17.5px; }
.app-shell .voice-empty { font-size: 13.75px; }
.app-shell .chat-empty strong { font-size: 15px; }
.app-shell .chat-empty span { font-size: 12.5px; }
.app-shell .message-meta strong { font-size: 13.75px; }
.app-shell .message-meta time { font-size: 11.25px; }
.app-shell .message-bubble, .app-shell .message-composer input { font-size: 15px; }
.app-shell .dock-user strong { font-size: 13.75px; }
.app-shell .dock-user span, .app-shell .mic-mode-switch button, .app-shell .ptt-indicator { font-size: 11.25px; }
.app-shell .member-panel-heading h2 { font-size: 23.75px; }
.app-shell .member-search input { font-size: 13.75px; }
.app-shell .member-channel-heading span { font-size: 15px; }
.app-shell .member-channel-heading small { font-size: 12.5px; }
.app-shell .member-copy strong { font-size: 12.5px; }
.app-shell .member-copy span, .app-shell .channel-no-members { font-size: 11.25px; }
.app-shell .member-empty, .app-shell .member-panel-tip { font-size: 12.5px; }
.settings-modal .settings-header h2 { font-size: 27.5px; }
.settings-modal .settings-section h3 { font-size: 20px; }
.settings-modal .settings-label, .settings-modal .settings-range-row strong, .settings-modal .settings-error { font-size: 12.5px; }
.settings-modal .settings-select { font-size: 13.75px; }
.settings-modal .mic-test-header strong { font-size: 13.75px; }
.settings-modal .mic-test-header button { font-size: 12.5px; }
.settings-modal .meter-labels { font-size: 10px; }
.settings-modal .mode-note { font-size: 12.5px; }
.join-page .brand-lockup strong { font-size: 22.5px; }
.join-page .brand-lockup small, .join-page .header-note { font-size: 12.5px; }
.join-page .language-switch { font-size: 12.5px; }
.join-page .eyebrow { font-size: 13.75px; }
.join-page .join-copy h1 { font-size: clamp(52px, 6.6vw, 90px); }
.join-page .join-description { font-size: 21.25px; }
.join-page .promise-item b { font-size: 15px; }
.join-page .promise-item small { font-size: 12.5px; }
.join-page .card-kicker { font-size: 12.5px; }
.join-page .join-card h2 { font-size: 33.75px; }
.join-page .card-lead { font-size: 16.25px; }
.join-page .notice { font-size: 15px; }
.join-page .field-label { font-size: 13.75px; }
.join-page .field-wrap input { font-size: 16.25px; }
.join-page .primary-button { font-size: 15px; }
.join-page .connect-button { font-size: 16.25px; }
.join-page .join-meta, .join-page .join-footer { font-size: 12.5px; }

@media (min-width: 741px) and (max-width: 980px) { .app-shell { grid-template-columns: minmax(0, 1fr); }.member-panel { display: none; } }
@media (max-width: 980px) { .app-shell { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(210px, 35dvh); }.workspace { height: auto; min-height: 0; }.member-panel { display: flex; border-top: 1px solid #eef2f0; border-left: 0; padding: 16px 18px; }.member-tree { margin-top: 10px; } }
@media (max-width: 740px) { .app-shell { display: grid; grid-template-rows: minmax(0, 1fr) 220px; }.channel-switcher { max-width: 150px; }.channel-switcher select { max-width: 112px; }.app-shell .room-hero h1 { font-size: 27.5px; }.app-shell .room-hero p { font-size: 13.75px; }.app-shell .section-heading h2 { font-size: 21.25px; }.app-shell .message-bubble, .app-shell .message-composer input { font-size: 13.75px; }.app-shell .mic-mode-switch button { font-size: 11.25px; }.settings-modal .settings-content { padding: 24px 20px; }.settings-modal .settings-header h2 { font-size: 23.75px; } }

/* Keep the connected workspace sized to the browser viewport and let the
   workspace and member tree own their scroll areas when the window shrinks. */
:global(html), :global(body), :global(#app) { width: 100%; height: 100dvh; min-height: 0; max-height: 100dvh; }
:global(body) { overflow: hidden; }
.web-client { height: 100dvh; min-height: 0; max-height: 100dvh; }
.join-page { height: 100dvh; min-height: 0; overflow-y: auto; }
.app-shell { grid-template-columns: 318px minmax(0, 1fr); height: 100dvh; min-height: 0; max-height: 100dvh; }
.workspace { grid-column: 2; grid-row: 1; min-height: 0; height: 100%; }
.workspace-scroll { min-height: 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
.member-panel { grid-column: 1; grid-row: 1; border-right: 1px solid #eef2f0; border-left: 0; }
.voice-avatar.speaking { box-shadow: 0 0 0 3px #90f691, 0 0 14px rgba(144,246,145,.48); }
.chat-panel { min-height: 0; }
.message-list { min-height: clamp(150px, 20dvh, 220px); max-height: min(360px, 42dvh); }
.workspace-content { padding-bottom: 64px; }

@media (max-width: 980px) {
  .app-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(210px, 35dvh); }
  .workspace { grid-column: 1; grid-row: 1; height: auto; }
  .member-panel { grid-column: 1; grid-row: 2; display: flex; border-top: 1px solid #eef2f0; border-right: 0; padding: 16px 18px; }
}

@media (max-width: 740px) {
  .app-shell { grid-template-rows: minmax(0, 1fr) 220px; }
}

/* Keep connected controls in the header; the old bottom dock consumed the
   chat viewport and made the settings action appear detached from its icon. */
.header-tools { align-items: center; }
.guide-button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; color: #006a64; background: #edf7f4; border: 1px solid #d7ebe6; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }
.guide-button:hover { color: #fff; background: #006a64; border-color: #006a64; }
.workspace-actions { align-items: center; flex-wrap: nowrap; }
.workspace-actions .header-action { flex: 0 0 34px; padding: 0; line-height: 0; }
.workspace-actions .header-action .ui-icon { margin: 0; }
.settings-mode-switch { width: fit-content; margin: 0 0 7px; }
.settings-hint { margin: -1px 0 19px; color: #8b9994; font-size: 11px; }
.config-guide-modal { display: flex; width: min(900px, 100%); max-height: min(820px, calc(100dvh - 40px)); flex-direction: column; overflow: hidden; border-radius: 18px; background: #fff; box-shadow: 0 24px 70px rgba(16,40,35,.24); }
.config-guide-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; padding: 28px 32px 23px; border-bottom: 1px solid #edf1ef; }
.config-guide-header h2 { margin: 8px 0 6px; color: #202c29; font-size: 27px; letter-spacing: -.045em; }
.config-guide-header p { max-width: 650px; margin: 0; color: #71817b; font-size: 13px; line-height: 1.6; }
.config-guide-content { display: grid; grid-template-columns: minmax(230px, .82fr) minmax(360px, 1.18fr); gap: 26px; min-height: 0; overflow-y: auto; padding: 27px 32px; }
.config-guide-steps { display: flex; flex-direction: column; gap: 14px; }
.config-guide-steps article { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border: 1px solid #e7efec; border-radius: 12px; background: #f9fbfa; }
.config-guide-steps article > span { display: grid; place-items: center; width: 25px; height: 25px; flex: 0 0 auto; color: #fff; background: #006a64; border-radius: 50%; font-size: 12px; font-weight: 800; }
.config-guide-steps strong { display: block; color: #32413c; font-size: 13px; }
.config-guide-steps p { margin: 5px 0 8px; color: #788882; font-size: 11px; line-height: 1.55; }
.config-guide-steps code { display: block; padding: 7px 8px; overflow-x: auto; color: #286a63; background: #eaf5f2; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; white-space: nowrap; }
.config-editor { min-width: 0; padding: 16px; border: 1px solid #e2ece8; border-radius: 13px; background: #fbfdfc; }
.config-editor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 13px; margin-bottom: 15px; }
.config-editor-heading strong { display: block; margin-top: 5px; color: #51615b; font-size: 12px; font-weight: 600; }
.copy-config-button { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 31px; padding: 0 9px; color: #006a64; background: #e2f2ef; border-radius: 7px; font-size: 11px; font-weight: 700; cursor: pointer; }
.copy-config-button:hover { color: #fff; background: #006a64; }
.config-guide-fields { display: grid; grid-template-columns: minmax(0, 1fr) 145px; gap: 11px; margin-bottom: 14px; }
.config-guide-fields label { display: flex; flex-direction: column; gap: 6px; color: #5a6b64; font-size: 10px; font-weight: 600; }
.config-guide-fields input, .config-guide-fields select { width: 100%; min-height: 36px; padding: 0 9px; color: #394742; border: 1px solid #dfebe6; border-radius: 7px; outline: none; background: #fff; font-size: 12px; }
.config-guide-fields input:focus, .config-guide-fields select:focus { border-color: #81d8d0; box-shadow: 0 0 0 2px rgba(129,216,208,.2); }
.config-guide-wide { grid-column: 1 / -1; }
.config-editor pre { max-height: 255px; margin: 0; overflow: auto; padding: 14px; color: #48615a; background: #eef6f3; border-radius: 9px; font: 11px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; }
.config-guide-note { grid-column: 1 / -1; display: flex; align-items: flex-start; gap: 8px; padding: 11px 13px; color: #66817a; background: #eef7f4; border-radius: 9px; font-size: 11px; line-height: 1.55; }
.config-guide-note .ui-icon { flex: 0 0 auto; color: #4f9c91; }
.config-guide-footer { display: flex; justify-content: flex-end; gap: 12px; min-height: 67px; padding: 14px 32px; border-top: 1px solid #edf1ef; }

@media (max-width: 740px) {
  .header-tools { gap: 7px; }
  .header-note, .guide-button span { display: none; }
  .guide-button { width: 32px; justify-content: center; padding: 0; }
  .config-guide-modal { max-height: calc(100dvh - 24px); }
  .config-guide-header { padding: 22px 20px 18px; }
  .config-guide-header h2 { font-size: 23px; }
  .config-guide-content { display: block; padding: 20px; }
  .config-editor { margin-top: 18px; }
  .config-guide-footer { padding-inline: 20px; }
}
</style>
