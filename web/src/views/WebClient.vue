<template>
  <div :class="['web-client', `language-${language}`]">
    <!-- Connection / welcome screen -->
    <section v-if="!voiceState.connected && !voiceState.reconnecting && !voiceState.reconnectFailed" class="join-page">
      <header class="join-header">
        <div class="brand-lockup">
          <img class="brand-mark" src="/网站图标.jpg" alt="WebSpeak" />
          <div>
            <strong>{{ siteName }}</strong>
            <small>{{ t('browserWorkspace') }}</small>
          </div>
        </div>
        <div class="header-tools"><div class="header-note"><span class="tiny-dot"></span> {{ t('secureGateway') }}</div><a class="github-button" href="https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak" target="_blank" rel="noreferrer" :title="t('githubRepository')" :aria-label="t('githubRepository')"><Icon name="github" :size="18" /><span>{{ t('githubRepository') }}</span></a><button type="button" class="qq-button" :title="t('qqGroup')" :aria-label="t('qqGroup')" aria-haspopup="dialog" @click="qqModalOpen = true"><Icon name="qq" :size="18" /><span class="qq-label">{{ t('qqGroup') }}</span></button><a class="bilibili-button" href="https://space.bilibili.com/25414873" target="_blank" rel="noreferrer" :title="t('bilibiliProfile')" :aria-label="t('bilibiliProfile')"><span class="bilibili-glyph">B</span><span class="bilibili-label">{{ t('bilibiliProfile') }}</span></a><span class="version-badge" :title="`${t('currentVersion')}: v${appVersion}`" :aria-label="`${t('currentVersion')}: v${appVersion}`">v{{ appVersion }}</span><a class="changelog-button" href="https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/blob/master/CHANGELOG.md" target="_blank" rel="noreferrer" :title="t('viewChangelog')" :aria-label="t('viewChangelog')"><Icon name="clock" :size="16" /><span>{{ t('viewChangelog') }}</span></a><a class="guide-button" href="/admin" :title="t('adminConsole')" :aria-label="t('adminConsole')"><Icon name="settings" :size="15" /><span>{{ t('adminConsole') }}</span></a><button type="button" class="header-action theme-toggle" :title="themeLabel" :aria-label="themeLabel" @click="cycleTheme"><Icon :name="themeIcon" :size="17" /></button><LanguageSwitcher v-model="language" class="join-language-switcher" :menu-label="t('languageMenu')" @change="persistLanguage" /></div>
      </header>

      <main class="join-content">
        <div class="join-copy">
          <div class="eyebrow"><span class="eyebrow-dot"></span> {{ t('privateAudio') }}</div>
          <h1>{{ t('joinLine1') }}<br /><em>{{ t('joinLine2') }}</em></h1>
          <p class="join-description">{{ localizedWelcomeText }}</p>
          <div class="promise-list">
            <div class="promise-item"><span class="promise-icon"><Icon name="waveform" :size="16" /></span><span><b>{{ t('highQuality') }}</b><small>{{ t('opusAudio') }}</small></span></div>
            <div class="promise-item"><span class="promise-icon mint"><Icon name="shield" :size="16" /></span><span><b>{{ t('secureJoin') }}</b><small>{{ t('inviteProtected') }}</small></span></div>
            <div class="promise-item"><span class="promise-icon sand"><Icon name="users" :size="16" /></span><span><b>{{ t('realtime') }}</b><small>{{ t('membersSync') }}</small></span></div>
          </div>
          <div v-if="visitorNumber !== null" class="visitor-count" role="status" aria-live="polite">
            <span class="visitor-count-orbit" aria-hidden="true"></span>
            <span class="visitor-count-icon"><Icon name="users" :size="15" /></span>
            <span class="visitor-count-label">{{ t('visitorCount', { count: visitorNumber }) }}</span>
            <span v-if="visitorTotal !== null" class="visitor-count-divider" aria-hidden="true"></span>
            <span v-if="visitorTotal !== null" class="visitor-count-total">{{ t('visitorTotal', { count: visitorTotal }) }}</span>
            <span class="visitor-count-spark" aria-hidden="true">✦</span>
          </div>
        </div>

        <div class="join-card">
          <h2>{{ t('welcomeBack') }}</h2>
          <p class="card-lead">{{ t('joinLead') }}</p>

          <div v-if="voiceState.error" class="notice error-notice"><span class="notice-symbol">!</span><span class="notice-content"><span>{{ localizedMessage(voiceState.error) }}</span><code v-if="voiceState.errorCode">{{ t('errorCode') }}: {{ visibleErrorCode(voiceState.errorCode) }}</code></span></div>
          <div v-if="browserError" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ localizedMessage(browserError) }}</span></div>
          <div v-if="!serverConfigLoading && !initialized" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ t('notConfigured') }} <a href="/admin">{{ t('configureNow') }}</a></span></div>
          <div v-if="!localPersistenceAvailable" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ t('localPersistenceUnavailable') }}</span></div>

          <form v-if="initialized" class="join-form" @submit.prevent="doConnect">
            <div v-if="accessMode === 'open'" class="field-grid target-fields">
              <label class="field-label" for="server-address"><span>{{ t('serverAddress') }}</span><div class="field-wrap"><Icon name="server" :size="17" /><input id="server-address" v-model="serverHost" autocomplete="url" :placeholder="t('serverAddressPlaceholder')" /></div></label>
              <label class="field-label" for="server-port"><span>{{ t('serverPort') }}</span><div class="field-wrap"><Icon name="hash" :size="17" /><input id="server-port" v-model="serverPort" inputmode="numeric" type="text" maxlength="5" :placeholder="t('serverPortPlaceholder')" /></div></label>
            </div>
            <div v-if="accelerationAvailable" class="acceleration-choice"><div class="acceleration-copy"><strong>{{ t('relayAcceleration') }}</strong><small>{{ t('relayAccelerationHint') }}</small></div><select v-model="accelerationRelayId" :aria-label="t('relayAcceleration')"><option value="">{{ t('directConnection') }}</option><option v-for="relay in accelerationRelays" :key="relay.id" :value="relay.id">{{ relay.name }}</option></select></div>
            <div v-if="accessMode === 'open' && (favoriteServers.length || recentServers.length)" class="local-servers">
              <div v-if="favoriteServers.length" class="local-server-group"><span>{{ t('favoriteServers') }}</span><button v-for="favorite in favoriteServers" :key="favorite.id" type="button" @click="selectLocalServer(favorite.address, favorite.nickname)">{{ favorite.label }}</button></div>
              <div v-if="recentServers.length" class="local-server-group"><span>{{ t('recentServers') }}</span><button v-for="recent in recentServers" :key="recent.id" type="button" @click="selectLocalServer(recent.address, recent.nickname)">{{ recent.address }}</button></div>
            </div>
            <button v-if="accessMode === 'open' && serverHost.trim()" type="button" class="favorite-toggle" @click="toggleFavorite">{{ isFavorite ? t('removeFavorite') : t('saveFavorite') }}</button>

            <template v-if="accessMode === 'open'">
              <label class="field-label" for="server-password">{{ t('serverPassword') }} <span>{{ t('optional') }}</span></label>
              <div class="field-wrap"><Icon name="lock" :size="17" /><input id="server-password" v-model="serverPassword" type="password" autocomplete="off" :placeholder="t('optionalPassword')" /></div>
            </template>

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

            <details class="identity-options"><summary>{{ t('identityOptions') }}</summary><label class="remember-identity"><input v-model="rememberIdentity" type="checkbox" /><span><strong>{{ t('rememberIdentity') }}</strong><small>{{ t('rememberIdentityHint') }}</small></span></label></details><p v-if="rememberIdentity" class="identity-warning">{{ t('rememberIdentityConcurrentWarning') }}</p>

            <button class="primary-button connect-button" :disabled="!canJoin || serverConfigLoading || !identityReady || voiceState.connecting" type="submit">
              <span v-if="voiceState.connecting" class="button-spinner"></span>
              <span>{{ voiceState.connecting ? t('connecting') : t('enterVoice') }}</span>
              <Icon v-if="!voiceState.connecting" name="chevron-right" :size="17" />
            </button>
            <button v-if="voiceState.connecting" type="button" class="cancel-connect-button" @click="doDisconnect">{{ t('cancel') }}</button>
          </form>
          <div class="join-meta"><Icon name="lock" :size="14" /> {{ t('connectionAuthorized') }}</div>
        </div>
      </main>

      <footer class="join-footer">
        <span>WebSpeak</span><span class="footer-separator">·</span><span>{{ t('teamSpeakClient') }}</span><span class="footer-spacer"></span><button type="button" class="clear-local-button" @click="clearBrowserData">{{ t('clearLocalData') }}</button><span class="footer-separator">·</span><span>{{ t('browserSupport') }}</span>
      </footer>

      <!-- QQ community modal -->
      <div v-if="qqModalOpen" class="modal-backdrop qq-modal-backdrop" @click.self="qqModalOpen = false">
        <section class="qq-modal-card" role="dialog" aria-modal="true" :aria-labelledby="'qq-group-title'">
          <button type="button" class="qq-modal-close" :aria-label="t('close')" :title="t('close')" @click="qqModalOpen = false"><Icon name="close" :size="19" /></button>
          <div class="qq-modal-heading"><span class="card-kicker">{{ t('qqGroup') }}</span><h2 id="qq-group-title">{{ t('qqGroup') }}</h2></div>
          <img class="qq-qr-image" src="/qq-group-qr.jpg" :alt="t('qqGroupQrAlt')" />
          <p class="qq-direct-join">{{ t('qqJoinDirect') }}</p>
          <a class="qq-join-link" :href="qqJoinUrl" :aria-label="t('joinQqGroup')" target="_blank" rel="noreferrer">{{ qqJoinUrl }}</a>
        </section>
      </div>
    </section>

    <!-- Connected application shell -->
    <div v-else :class="['app-shell', `mobile-view-${mobileSection}`]" @click="memberMenu = null">
      <main class="workspace">
        <header class="workspace-header">
          <div class="breadcrumbs"><span class="mobile-brand">TeamSpeak <em>Web</em></span><span class="crumb-muted">{{ t('serverBreadcrumb') }}</span><Icon name="chevron-right" :size="14" /><strong>{{ currentChannelName }}</strong></div>
          <div class="workspace-actions">
            <div class="network-performance">
              <button type="button" class="performance-trigger" :title="t('networkPerformance')" :aria-label="t('networkPerformance')" :aria-expanded="performancePanelOpen" @click.stop="togglePerformancePanel"><Icon name="activity" :size="16" /><span class="performance-trigger-label">{{ t('networkPerformance') }}</span><small v-if="performanceStats.ready && performanceStats.gatewayLatencyMs != null">{{ performanceStats.gatewayLatencyMs }} ms</small><Icon name="chevron-down" :size="13" /></button>
              <section v-if="performancePanelOpen" class="performance-panel" role="dialog" :aria-label="t('networkPerformance')" @click.stop>
                <header><div><strong>{{ t('networkPerformance') }}</strong><small>{{ t('networkPerformanceHint') }}</small></div><button type="button" class="performance-refresh" :title="t('measureNow')" :disabled="performanceRunning" @click="refreshPerformanceProbe"><Icon name="refresh" :size="15" /></button></header>
                <div class="performance-route"><span>{{ t('browser') }}</span><i></i><span>{{ t('webSpeakGateway') }}</span><i></i><span>{{ t('teamSpeakServer') }}</span></div>
                <div class="performance-metrics"><article><small>{{ t('browserToGateway') }}</small><strong>{{ performanceStats.gatewayLatencyMs == null ? '—' : `${performanceStats.gatewayLatencyMs} ms` }}</strong><span>{{ t('packetLoss') }} {{ performanceStats.gatewayLossPercent == null ? '—' : `${performanceStats.gatewayLossPercent}%` }}</span></article><article><small>{{ t('gatewayToTeamSpeak') }}</small><strong>{{ performanceStats.teamSpeakLatencyMs == null ? '—' : `${performanceStats.teamSpeakLatencyMs} ms` }}</strong><span>{{ t('packetLoss') }} {{ performanceStats.teamSpeakLossPercent == null ? '—' : `${performanceStats.teamSpeakLossPercent}%` }}</span></article></div>
                <p class="performance-status">{{ performanceRunning ? t('measuring') : performanceStats.ready ? t('measureComplete') : t('measureUnavailable') }}</p>
                <section v-if="screenShareWebRtcStats.peers.length" class="webrtc-stats" aria-live="polite">
                  <header><div><strong>{{ t('webrtcStats') }}</strong><small>{{ t('webrtcStatsHint') }}</small></div></header>
                  <div v-if="screenShareWebRtcStats.capture" class="webrtc-stats-capture"><span>{{ t('screenShareCapture') }}</span><strong>{{ screenShareWebRtcStats.capture.width ?? '—' }} × {{ screenShareWebRtcStats.capture.height ?? '—' }}</strong><small>{{ screenShareWebRtcStats.capture.frameRate == null ? '—' : `${screenShareWebRtcStats.capture.frameRate.toFixed(1)} FPS` }}</small></div>
                  <div v-for="peer in screenShareWebRtcStats.peers" :key="peer.peerId" class="webrtc-stats-peer">
                    <div class="webrtc-stats-peer-heading"><strong>{{ peer.direction === 'outbound' ? t('screenShareSending') : t('screenShareReceiving') }}</strong><small>{{ peer.connectionState }} · {{ peer.candidateType ?? '—' }}</small></div>
                    <div class="webrtc-stats-values"><span>{{ peer.frameRate == null ? '—' : `${peer.frameRate.toFixed(1)} FPS` }}</span><span>{{ peer.bitrateKbps == null ? '—' : `${Math.round(peer.bitrateKbps)} kbps` }}</span><span>{{ peer.lossPercent == null ? '—' : `${peer.lossPercent.toFixed(2)}%` }} {{ t('packetLoss') }}</span><span>{{ peer.framesDropped == null ? '—' : peer.framesDropped }} {{ t('screenShareDroppedFrames') }}</span><span>{{ peer.jitterMs == null ? '—' : `${Math.round(peer.jitterMs)} ms` }} {{ t('screenShareJitter') }}</span><span>{{ peer.roundTripTimeMs == null ? '—' : `${Math.round(peer.roundTripTimeMs)} ms` }} {{ t('screenShareRtt') }}</span></div>
                    <small v-if="peer.codec || peer.qualityLimitationReason" class="webrtc-stats-detail">{{ peer.codec ?? '—' }}<template v-if="peer.qualityLimitationReason"> · {{ peer.qualityLimitationReason }}</template></small>
                  </div>
                </section>
              </section>
            </div>
            <button class="header-action" :title="t('copyInvite')" @click="doShare"><Icon name="share" :size="18" /></button>
            <button v-if="isMobileViewport" class="header-action microphone-header-toggle" :class="{ muted: microphoneMuted }" :title="microphoneMuted ? t('unmuteMic') : t('muteMic')" :aria-label="microphoneMuted ? t('microphoneMuted') : t('microphoneActive')" :aria-pressed="!microphoneMuted" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="18" /></button>
            <button v-if="isMobileViewport" class="header-action" :title="t('audioSettings')" :aria-label="t('audioSettings')" @click="settingsOpen = true"><Icon name="settings" :size="18" /></button>
            <button type="button" class="header-action theme-toggle" :title="themeLabel" :aria-label="themeLabel" @click="cycleTheme"><Icon :name="themeIcon" :size="17" /></button>
            <LanguageSwitcher v-model="language" class="workspace-language" :menu-label="t('languageMenu')" @change="persistLanguage" />
            <button class="disconnect-button" @click="doDisconnect"><Icon name="door" :size="17" /><span>{{ t('exit') }}</span></button>
          </div>
        </header>

        <div v-if="screenShareSettingsOpen" class="modal-backdrop screen-share-settings-backdrop" @click.self="screenShareSettingsOpen = false">
          <section class="screen-share-settings-modal" role="dialog" aria-modal="true" aria-labelledby="screen-share-settings-title" @click.stop>
            <button type="button" class="screen-share-settings-close" :aria-label="t('close')" :title="t('close')" @click="screenShareSettingsOpen = false"><Icon name="close" :size="17" /></button>
            <div class="screen-share-settings-heading"><span class="card-kicker">{{ t('screenShare') }}</span><h2 id="screen-share-settings-title">{{ t('screenShareSettings') }}</h2><p>{{ t('screenShareSettingsHint') }}</p></div>
            <div class="screen-share-settings-fields">
              <label><span>{{ t('screenShareResolution') }}</span><select v-model="screenShareResolutionPreset" :aria-label="t('screenShareResolution')"><option v-for="option in screenShareResolutionOptions" :key="option.value" :value="option.value">{{ t(option.label) }}</option></select></label>
              <label><span>{{ t('screenShareFrameRate') }}</span><select v-model.number="screenShareFrameRate" :aria-label="t('screenShareFrameRate')"><option v-for="fps in screenShareFrameRateOptions" :key="fps" :value="fps">{{ fps }} FPS</option></select></label>
            </div>
            <p class="screen-share-settings-note">{{ t('screenShareSettingsNote') }}</p>
            <footer class="screen-share-settings-footer"><button type="button" class="text-button" @click="screenShareSettingsOpen = false">{{ t('cancel') }}</button><button type="button" class="primary-button screen-share-settings-start" @click="startScreenShareWithSettings"><Icon name="monitor" :size="14" /> {{ t('startScreenShare') }}</button></footer>
          </section>
        </div>

        <div v-if="voiceState.reconnecting || voiceState.reconnectFailed" :class="['reconnect-banner', { failed: voiceState.reconnectFailed }]" role="status">
          <div class="reconnect-copy"><strong>{{ voiceState.reconnectFailed ? t('reconnectFailed') : t('connectionInterrupted') }}</strong><span v-if="voiceState.reconnecting">{{ t('reconnectingAttempt', { attempt: voiceState.reconnectAttempt }) }}</span><span v-else>{{ localizedMessage(voiceState.error) }}</span></div>
          <div class="reconnect-actions"><button v-if="voiceState.reconnectFailed" type="button" class="secondary-button" @click="reconnectNow">{{ t('reconnectNow') }}</button><button type="button" class="text-button" @click="doDisconnect">{{ t('back') }}</button></div>
        </div>
        <div v-if="voiceState.audioNotice" class="reconnect-banner degraded" role="status"><div class="reconnect-copy"><strong>{{ t('audioStatus') }}</strong><span>{{ localizedAudioNotice(voiceState.audioNoticeCode, voiceState.audioNotice) }}</span></div></div>
        <div v-for="poke in visiblePokes" :key="poke.id" class="poke-banner" role="status"><Icon name="bell" :size="17" /><span><strong>{{ poke.invokerName }}</strong> {{ t('pokedYou') }}<small v-if="poke.message">：{{ poke.message }}</small></span><button type="button" @click="dismissPoke(poke.id)"><Icon name="close" :size="15" /></button></div>

        <div class="workspace-scroll">
          <div class="workspace-content">
            <section :class="['voice-section', { 'mobile-section-hidden': mobileSection !== 'voice' }]">
              <div class="section-heading"><div><span class="section-kicker">{{ t('voiceActivity') }}</span><h2>{{ t('speakingNow') }}</h2></div><span class="section-counter">{{ t('onlineShort', { count: currentMembers.length }) }}</span></div>
              <div v-if="screenShareError" class="screen-share-inline-error" role="status"><Icon name="info" :size="15" /> <span>{{ screenShareErrorText }}</span></div>
              <section v-if="screenShareViewing" ref="screenSharePlayerEl" class="screen-share-player" role="region" :aria-label="t('screenShare')">
                <div class="screen-share-player-stage">
                  <video v-if="screenShareRemoteStream" :ref="setScreenVideoElement" class="screen-share-player-video" autoplay playsinline :muted="screenShareRemoteVolume === 0"></video>
                  <div v-else class="screen-share-player-placeholder"><span class="screen-share-player-placeholder-icon"><Icon name="monitor" :size="28" /></span><strong>{{ t('screenShareConnecting') }}</strong><span>{{ screenShareError ? screenShareErrorText : t('directP2POnly') }}</span></div>
                  <button type="button" class="screen-share-player-exit" :aria-label="t('screenShareExit')" :title="t('screenShareExit')" @click="leaveScreenShare"><Icon name="close" :size="22" /></button>
                  <div class="screen-share-player-viewers" :aria-label="t('screenShareViewers')">
                    <span class="screen-share-player-viewer-label"><Icon name="users" :size="14" /> {{ screenSharePlayerViewerCount }}</span>
                    <span class="screen-share-player-viewer-avatars"><span v-for="viewer in screenSharePlayerViewers" :key="viewer.peerId" class="screen-share-player-viewer-avatar" :style="screenShareViewerStyle(viewer)" :title="viewer.nickname">{{ viewer.avatar ? '' : avatarInitial(viewer.nickname) }}</span></span>
                  </div>
                  <span class="screen-share-player-live"><i></i>{{ t('watchingScreenShare') }}</span>
                  <span class="screen-share-player-source">{{ screenSharePlayerOwnerName }}</span>
                  <div class="screen-share-player-controls">
                    <label :title="t('screenShareVolume')"><Icon :name="screenShareRemoteVolume === 0 ? 'volume-off' : 'volume'" :size="18" /><input type="range" min="0" max="100" :value="screenShareRemoteVolume * 100" :aria-label="t('screenShareVolume')" @input="onScreenShareVolume" /></label>
                    <button type="button" :aria-label="screenShareFullscreen ? t('screenShareExitFullscreen') : t('screenShareFullscreen')" :title="screenShareFullscreen ? t('screenShareExitFullscreen') : t('screenShareFullscreen')" @click="toggleScreenShareFullscreen"><Icon :name="screenShareFullscreen ? 'fullscreen-exit' : 'fullscreen'" :size="19" /></button>
                  </div>
                </div>
              </section>
              <div v-if="currentMembers.length" class="voice-grid">
                <article v-for="member in roomMembers" :key="member.id" :class="['voice-card', { speaking: isSpeaking(member), self: member.isSelf }]">
                  <button v-if="isMobileViewport && !member.isSelf" type="button" class="voice-member-action" :aria-label="t('moreMemberOptions')" @click.stop="openMemberActions(member)"><Icon name="more" :size="17" /></button>
                  <div :class="['voice-avatar-wrap', { 'screen-share-avatar-wrap': screenShareStreamForMember(member) }]">
                    <div :class="['voice-avatar', { speaking: isSpeaking(member) }]" :style="avatarStyle(member.nickname, member.isSelf, member.avatar)">{{ member.avatar ? '' : avatarInitial(member.nickname) }}</div>
                    <span v-if="screenShareStreamForMember(member)" class="screen-share-live-indicator"><span class="screen-share-wave" aria-hidden="true"><i v-for="bar in screenShareIndicatorBars" :key="bar" :style="{ height: `${bar}px` }"></i></span><span>{{ t('sharingScreen') }}</span></span>
                    <button v-if="member.isSelf && (screenShareActive || screenShareStarting)" type="button" class="screen-share-stop-button" :aria-label="t('stopScreenShare')" :title="t('stopScreenShare')" @click.stop="stopScreenShare"><Icon name="close" :size="14" /></button>
                  </div>
                  <strong>{{ member.isSelf ? t('you') : member.nickname }}</strong><span>{{ isSpeaking(member) ? t('speaking') : member.isSelf ? t('connectedYou') : t('connected') }}</span>
                  <div v-if="member.isSelf || screenShareStreamForMember(member)" class="screen-share-card-actions">
                    <template v-if="member.isSelf && !screenShareActive && !screenShareStarting">
                      <div class="screen-share-start-actions">
                        <button type="button" class="screen-share-card-button" @click.stop="startScreenShareWithSettings"><Icon name="monitor" :size="13" /> {{ t('startScreenShare') }}</button>
                        <button type="button" class="screen-share-settings-button" :aria-label="t('screenShareSettings')" :aria-expanded="screenShareSettingsOpen" :title="t('screenShareSettings')" @click.stop="screenShareSettingsOpen = !screenShareSettingsOpen"><Icon name="settings" :size="13" /></button>
                      </div>
                    </template>
                    <button v-else-if="!member.isSelf" type="button" :class="['screen-share-card-button', { viewing: screenShareViewingStreamId === screenShareStreamForMember(member)?.streamId }]" @click.stop="toggleScreenShareForMember(member)"><Icon name="monitor" :size="13" /> {{ screenShareViewingStreamId === screenShareStreamForMember(member)?.streamId ? t('watching') : t('watchScreenShare') }}</button>
                  </div>
                </article>
                <article v-if="currentMembers.length > roomMembers.length" class="voice-card more-card"><div class="more-count">+{{ currentMembers.length - roomMembers.length }}</div><strong>{{ t('moreMembers') }}</strong><span>{{ t('viewLeft') }}</span></article>
              </div>
              <div v-else class="voice-empty"><span class="empty-icon"><Icon name="users" :size="20" /></span><strong>{{ t('waitingForMembers') }}</strong><span>{{ t('prepareMicrophone') }}</span></div>
              <div v-if="whisperTargetIds.size" class="whisper-strip">
                <div class="whisper-strip-copy"><strong><Icon name="users" :size="15" /> {{ t('whisperTargets') }}</strong><span>{{ whisperTargets.map((member) => member.nickname).join('、') }}</span></div>
                <button type="button" class="text-button" @click="clearWhisperTargets">{{ t('clearWhisperTargets') }}</button>
                <button type="button" class="whisper-ptt-button" :class="{ active: whisperPttActive || whisperActive }" :aria-pressed="whisperPttActive || whisperActive" @pointerdown.prevent="onWhisperPttDown" @pointerup.prevent="onWhisperPttUp" @pointercancel.prevent="onWhisperPttUp" @lostpointercapture="onWhisperPttUp"><Icon name="mic" :size="18" /> {{ whisperPttActive || whisperActive ? t('releaseWhisper') : t('whisperHoldToTalk') }}</button>
              </div>
              <div class="mobile-voice-controls">
                <button type="button" class="mobile-voice-toggle" :class="{ muted: microphoneMuted }" :aria-pressed="!microphoneMuted" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="18" /><span>{{ microphoneMuted ? t('unmuteMic') : t('muteMic') }}</span></button>
                <button type="button" class="mobile-voice-settings" @click="settingsOpen = true"><Icon name="settings" :size="17" /><span>{{ t('audioSettings') }}</span></button>
              </div>
            </section>

            <section :class="['chat-panel', { 'mobile-section-hidden': mobileSection !== 'chat' }]">
              <div class="chat-tabs" role="tablist" :aria-label="t('chatTabs')">
                <button type="button" :class="{ active: chatTab === 'channel' }" @click="chatTab = 'channel'"><Icon name="hash" :size="15" /> {{ currentChannelName }}</button>
                <button type="button" :class="{ active: chatTab === 'server' }" @click="chatTab = 'server'"><Icon name="server" :size="15" /> {{ t('serverChat') }}</button>
                <button v-for="conversation in privateConversations" :key="conversation.id" type="button" :class="{ active: chatTab === 'private' && privateClientId === conversation.id }" @click="openPrivateChat(conversation.id)"><Icon name="message" :size="15" /> {{ conversation.name }}</button>
                <button type="button" :class="{ active: chatTab === 'events' }" @click="chatTab = 'events'"><Icon name="bell" :size="15" /> {{ t('eventLog') }}</button>
              </div>
              <div class="section-heading chat-heading"><div><span class="section-kicker">{{ chatTabLabel }}</span><h2><Icon :name="chatTab === 'server' ? 'server' : chatTab === 'events' ? 'bell' : chatTab === 'private' ? 'message' : 'hash'" :size="20" /> {{ chatTitle }}</h2></div><span class="section-counter">{{ chatTab === 'events' ? t('eventCount', { count: serverEvents.length }) : t('messageCount', { count: visibleChatMessages.length }) }}</span></div>
              <div ref="chatListEl" class="message-list">
                <div v-if="chatTab === 'events'">
                  <article v-for="event in serverEvents" :key="event.id" class="event-row"><time>{{ formatTime(event.timestamp) }}</time><span>{{ event.message }}</span></article>
                  <div v-if="!serverEvents.length" class="chat-empty"><div class="chat-empty-icon"><Icon name="bell" :size="24" /></div><strong>{{ t('noEvents') }}</strong><span>{{ t('noEventsLead') }}</span></div>
                </div>
                <div v-else-if="!visibleChatMessages.length" class="chat-empty"><div class="chat-empty-icon"><Icon name="message" :size="24" /></div><strong>{{ chatTab === 'private' ? t('privateChatStart') : t('chatStart') }}</strong><span>{{ chatTab === 'private' ? t('privateChatStartLead') : t('chatStartLead') }}</span></div>
                <template v-for="message in visibleChatMessages" :key="message.id">
                  <article v-if="chatTab !== 'events'" :class="['message-row', { mine: message.isSelf }]">
                <div class="message-avatar" :style="avatarStyle(message.invokerName, message.isSelf, messageAvatar(message))">{{ messageAvatar(message) ? '' : avatarInitial(message.invokerName) }}</div>
                  <div class="message-body"><div class="message-meta"><strong>{{ message.isSelf ? t('you') : message.invokerName }}</strong><time>{{ formatTime(message.timestamp) }}</time></div><div class="message-bubble">{{ message.message }}</div></div>
                  </article>
                </template>
              </div>
               <form v-if="chatTab !== 'events'" class="message-composer" @submit.prevent="submitMessage">
                 <input v-model="messageDraft" maxlength="500" :placeholder="chatPlaceholder" :aria-label="t('send')" />
                 <button class="send-button" type="submit" :disabled="!messageDraft.trim()" :title="t('send')"><Icon name="send" :size="18" /></button>
               </form>
             </section>
          </div>
        </div>

      </main>

      <aside :class="['member-panel', { 'mobile-section-visible': mobileSection === 'channels' }]">
        <div class="member-panel-heading"><div><span class="section-kicker">{{ t('people') }}</span><h2>{{ t('people') }}</h2></div><button type="button" class="status-button" :class="{ active: away }" @click="toggleAway"><span class="status-dot"></span>{{ away ? t('away') : t('available') }}</button></div>
        <div class="member-search"><Icon name="search" :size="15" /><input v-model="memberQuery" :placeholder="t('searchMembers')" :aria-label="t('searchMembers')" /></div>
        <div class="member-tree">
          <section v-for="channelItem in filteredMemberChannels" :key="channelItem.id" :class="['member-channel-group', { current: currentChannel?.id === channelItem.id, 'drag-over': dragOverChannelId === channelItem.id }]" :data-member-channel-id="channelItem.id" :style="{ marginLeft: `${channelItem.depth * 10}px` }" @dragover="onChannelDragOver(channelItem, $event)" @dragleave="onChannelDragLeave(channelItem, $event)" @drop="onChannelDrop(channelItem, $event)" @pointermove="onMemberPointerMove($event)" @pointerup="onMemberPointerUp($event)" @pointercancel="onMemberPointerCancel($event)">
            <button class="member-channel-heading" :title="t('switchChannel')" @click="selectChannel(channelItem)">
              <Icon name="volume" :size="16" />
              <span>{{ channelItem.name }}</span>
              <small>{{ channelItem.members.length }}</small>
            </button>
            <div v-if="channelItem.members.length" class="member-list">
              <div v-for="member in channelItem.members" :key="`${channelItem.id}-${member.id}`" :class="['member-row', { dragging: draggedMember?.id === member.id }]" :draggable="!member.isSelf" @dragstart="onMemberDragStart(member, $event)" @dragend="onMemberDragEnd" @pointerdown="onMemberPointerDown(member, $event)" @pointermove="onMemberPointerMove($event)" @pointerup="onMemberPointerUp($event)" @pointercancel="onMemberPointerCancel($event)" @contextmenu.prevent="openMemberMenu(member, $event)">
                <div :class="['member-avatar', { speaking: isSpeaking(member) }]" :style="avatarStyle(member.nickname, member.isSelf, member.avatar)">{{ member.avatar ? '' : avatarInitial(member.nickname) }}<span class="member-presence"></span></div>
                <div class="member-copy"><strong>{{ memberDisplayName(member) }}</strong><span>{{ member.away ? t('away') : isSpeaking(member) ? t('speaking') : member.isSelf ? t('yourDevice') : t('memberOnline') }}</span></div>
                <div class="member-flags" :aria-label="t('memberStates')"><span v-if="member.away" :title="t('away')" :aria-label="t('away')"><Icon name="clock" :size="13" /></span><span v-if="member.inputMuted" :title="t('inputMuted')" :aria-label="t('inputMuted')"><Icon name="mic-off" :size="13" /></span><span v-if="member.outputMuted" :title="t('outputMuted')" :aria-label="t('outputMuted')"><Icon name="volume-off" :size="13" /></span><span v-if="member.channelCommander" :title="t('channelCommander')" :aria-label="t('channelCommander')"><Icon name="shield" :size="13" /></span></div>
                <div class="member-volume"><Icon :name="(volumes[member.id] ?? 1) === 0 ? 'volume-off' : 'volume'" :size="14" /><input type="range" min="0" max="400" :value="(volumes[member.id] ?? 1) * 100" :style="rangeStyle((volumes[member.id] ?? 1) / 4, 1)" :aria-label="t('memberVolume')" @input="onVolInput(member.id, $event)" /></div>
                <button v-if="isMobileViewport && !member.isSelf" type="button" class="member-action-button" :aria-label="t('moreMemberOptions')" @click.stop="openMemberActions(member)"><Icon name="more" :size="18" /></button>
              </div>
            </div>
            <div v-else class="channel-no-members">{{ t('noMembersInChannel') }}</div>
          </section>
        </div>
        <div v-if="!filteredMemberChannels.length" class="member-empty">{{ t('noMatchingMembers') }}</div>
        <div v-if="!isMobileViewport" class="desktop-audio-dock" role="toolbar" :aria-label="t('desktopAudioControls')">
          <div class="desktop-audio-dock-copy"><strong>{{ t('desktopAudioControls') }}</strong><span>{{ accompanimentActive ? t('accompanimentActive') : t('desktopAudioHint') }}</span></div>
          <div class="desktop-audio-dock-actions">
            <div class="dock-hover-control">
              <button type="button" class="dock-audio-button microphone-header-toggle" :class="{ muted: microphoneMuted }" :title="microphoneMuted ? t('unmuteMic') : t('muteMic')" :aria-label="microphoneMuted ? t('microphoneMuted') : t('microphoneActive')" :aria-pressed="!microphoneMuted" aria-haspopup="dialog" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="18" /></button>
              <div class="dock-hover-panel dock-microphone-panel" role="dialog" :aria-label="t('microphone')">
                <div class="dock-slider-heading"><span>{{ t('inputVolume') }}</span><strong>{{ Math.round(inputVolume * 100) }}%</strong></div>
                <input class="dock-slider" type="range" min="0" max="100" :value="inputVolume * 100" :style="rangeStyle(inputVolume, 1)" :aria-label="t('inputVolume')" @input="onInputVolume" />
                <div class="dock-panel-divider"></div>
                <label class="dock-switch-row"><span><strong>{{ t('noiseSuppression') }}</strong></span><input type="checkbox" :checked="noiseSuppressionEnabled" :aria-label="t('noiseSuppression')" @change="onNoiseSuppressionToggle" /></label>
              </div>
            </div>
            <div class="dock-hover-control">
              <button type="button" class="dock-audio-button" :class="{ muted: outputMuted }" :title="outputMuted ? t('unmuteOutput') : t('muteOutput')" :aria-label="outputMuted ? t('unmuteOutput') : t('muteOutput')" :aria-pressed="!outputMuted" aria-haspopup="dialog" @click="toggleOutputMute"><Icon :name="outputMuted ? 'volume-off' : 'volume'" :size="18" /></button>
              <div class="dock-hover-panel dock-output-panel" role="dialog" :aria-label="t('overallVolume')">
                <div class="dock-slider-heading"><span>{{ t('overallVolume') }}</span><strong>{{ Math.round(outputVolume * 100) }}%</strong></div>
                <input class="dock-slider" type="range" min="0" max="100" :value="outputVolume * 100" :style="rangeStyle(outputVolume, 1)" :aria-label="t('overallVolume')" @input="onOutputVolume" />
              </div>
            </div>
            <button type="button" class="dock-audio-button" :title="t('audioSettings')" :aria-label="t('audioSettings')" @click="settingsOpen = true"><Icon name="settings" :size="18" /></button>
            <button type="button" class="dock-audio-button accompaniment-toggle" :class="{ active: accompanimentActive }" :title="accompanimentActive ? t('stopAccompaniment') : t('startAccompaniment')" :aria-label="accompanimentActive ? t('stopAccompaniment') : t('startAccompaniment')" :aria-pressed="accompanimentActive" @click="toggleAccompaniment"><Icon name="music" :size="18" /></button>
          </div>
        </div>
      </aside>

      <section v-if="mobileSection === 'more'" class="mobile-more-panel">
        <span class="section-kicker">{{ t('mobileMore') }}</span>
        <h2>{{ t('mobileMore') }}</h2>
        <button type="button" :class="{ muted: microphoneMuted }" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="18" /> {{ microphoneMuted ? t('unmuteMic') : t('muteMic') }}</button>
        <button type="button" @click="settingsOpen = true"><Icon name="settings" :size="18" /> {{ t('audioSettings') }}</button>
        <button type="button" @click="cycleTheme"><Icon :name="themeIcon" :size="18" /> {{ themeLabel }}</button>
        <div class="language-menu-row"><Icon name="globe" :size="18" /><span>{{ t('languageMenu') }}</span><LanguageSwitcher v-model="language" :menu-label="t('languageMenu')" @change="persistLanguage" /></div>
        <button type="button" class="danger" @click="doDisconnect"><Icon name="door" :size="18" /> {{ t('exit') }}</button>
      </section>

      <nav class="mobile-nav" :aria-label="t('mobileNavigation')">
        <button type="button" :class="{ active: mobileSection === 'channels' }" @click="mobileSection = 'channels'"><Icon name="volume" :size="18" /><span>{{ t('mobileChannels') }}</span></button>
        <button type="button" :class="{ active: mobileSection === 'chat' }" @click="mobileSection = 'chat'"><Icon name="message" :size="18" /><span>{{ t('mobileChat') }}</span></button>
        <button type="button" :class="{ active: mobileSection === 'voice' }" @click="mobileSection = 'voice'"><Icon name="mic" :size="18" /><span>{{ t('mobileVoice') }}</span></button>
        <button type="button" :class="{ active: mobileSection === 'more' }" @click="mobileSection = 'more'"><Icon name="more" :size="18" /><span>{{ t('mobileMore') }}</span></button>
      </nav>
    </div>

    <div v-if="memberMenu && isMobileViewport" class="member-menu-backdrop" @click="memberMenu = null"></div>
    <div v-if="memberMenu" class="member-context-menu" :style="memberMenuStyle" @click.stop>
      <div class="member-menu-header"><strong>{{ memberMenu.member.nickname }}</strong><button type="button" class="member-menu-close" :aria-label="t('close')" @click="memberMenu = null"><Icon name="close" :size="17" /></button></div>
      <label class="menu-volume"><span>{{ t('memberVolume') }}</span><input type="range" min="0" max="400" :value="(volumes[memberMenu.member.id] ?? 1) * 100" :style="rangeStyle((volumes[memberMenu.member.id] ?? 1) / 4, 1)" :aria-label="t('memberVolume')" @input="onVolInput(memberMenu.member.id, $event)" /></label>
      <button type="button" @click="openPrivateChat(memberMenu.member.id); memberMenu = null"><Icon name="message" :size="15" /> {{ t('privateMessage') }}</button>
      <button type="button" @click="pokeMember(memberMenu.member); memberMenu = null"><Icon name="bell" :size="15" /> {{ t('poke') }}</button>
      <button type="button" @click="toggleWhisperTarget(memberMenu.member); memberMenu = null"><Icon name="mic" :size="15" /> {{ whisperTargetIds.has(memberMenu.member.id) ? t('removeWhisperTarget') : t('setWhisperTarget') }}</button>
      <button type="button" @click="copyMemberName(memberMenu.member); memberMenu = null"><Icon name="copy" :size="15" /> {{ t('copyNickname') }}</button>
      <div class="member-menu-submenu" @mouseenter="memberMoveMenuOpen = true">
        <button type="button" class="member-menu-submenu-trigger" :aria-expanded="memberMoveMenuOpen" @click="toggleMemberMoveMenu"><Icon name="chevron-right" :size="15" /> <span>{{ t('moveMemberMenu') }}</span><Icon name="chevron-right" :size="13" class="member-menu-submenu-arrow" /></button>
        <div v-if="memberMoveMenuOpen" class="member-submenu-panel" @click.stop>
          <button v-if="memberMoveMenuCurrentChannel" type="button" :disabled="memberMoveMenuCurrentSameChannel" @click="moveMemberDirect(memberMenu.member, memberMoveMenuCurrentChannel.id)"><Icon name="users" :size="15" /><span>{{ t('moveMemberMyChannel') }}</span><small>{{ memberMoveMenuCurrentChannel.name }}</small></button>
          <button v-for="targetChannel in memberMoveMenuOtherChannels" :key="targetChannel.id" type="button" @click="moveMemberDirect(memberMenu.member, targetChannel.id)"><Icon name="volume" :size="15" /><span>{{ targetChannel.name }}</span></button>
          <span v-if="!memberMoveMenuCurrentChannel && !memberMoveMenuOtherChannels.length" class="member-submenu-empty">{{ t('moveMemberNoChannels') }}</span>
        </div>
      </div>
    </div>

    <!-- Protected channel password modal -->
    <div v-if="channelPasswordDialog.open" class="modal-backdrop channel-password-backdrop" @click.self="cancelChannelPassword">
      <section class="channel-password-modal" role="dialog" aria-modal="true" :aria-labelledby="'channel-password-title'" @click.stop>
        <button type="button" class="qq-modal-close" :aria-label="t('close')" :title="t('close')" @click="cancelChannelPassword"><Icon name="close" :size="19" /></button>
        <div class="channel-password-icon"><Icon name="lock" :size="22" /></div>
        <span class="card-kicker">{{ t('channelPasswordPrompt') }}</span>
        <h2 id="channel-password-title">{{ t('channelPasswordTitle') }}</h2>
        <p>{{ t('channelPasswordLead') }}</p>
        <form class="channel-password-form" @submit.prevent="submitChannelPassword">
          <label class="field-label" for="channel-password-input">{{ t('channelPasswordPrompt') }}</label>
          <div class="field-wrap"><Icon name="lock" :size="17" /><input id="channel-password-input" v-model="channelPasswordDialog.password" type="password" autocomplete="current-password" :placeholder="t('channelPasswordPlaceholder')" :disabled="channelPasswordDialog.submitting" autofocus /></div>
          <div v-if="channelPasswordDialog.error" class="notice error-notice channel-password-error"><span class="notice-symbol">!</span><span>{{ channelPasswordDialog.error }}</span></div>
          <div class="channel-password-actions"><button type="button" class="text-button" :disabled="channelPasswordDialog.submitting" @click="cancelChannelPassword">{{ t('channelPasswordCancel') }}</button><button type="submit" class="primary-button channel-password-submit" :disabled="channelPasswordDialog.submitting || !channelPasswordDialog.password"><span v-if="channelPasswordDialog.submitting" class="button-spinner"></span><span>{{ t('channelPasswordSubmit') }}</span><Icon v-if="!channelPasswordDialog.submitting" name="chevron-right" :size="17" /></button></div>
        </form>
      </section>
    </div>

    <!-- TeamSpeak server password modal -->
    <div v-if="serverPasswordDialog.open" class="modal-backdrop channel-password-backdrop" @click.self="cancelServerPassword">
      <section class="channel-password-modal server-password-modal" role="dialog" aria-modal="true" :aria-labelledby="'server-password-title'" @click.stop>
        <button type="button" class="qq-modal-close" :aria-label="t('close')" :title="t('close')" @click="cancelServerPassword"><Icon name="close" :size="19" /></button>
        <div class="channel-password-icon"><Icon name="lock" :size="22" /></div>
        <span class="card-kicker">{{ t('serverPasswordPrompt') }}</span>
        <h2 id="server-password-title">{{ t('serverPasswordTitle') }}</h2>
        <p>{{ serverPasswordDialog.errorCode === 'INVALID_SERVER_PASSWORD' ? t('serverPasswordInvalidLead') : t('serverPasswordRequiredLead') }}</p>
        <form class="channel-password-form" @submit.prevent="submitServerPassword">
          <label class="field-label" for="retry-server-password-input">{{ t('serverPasswordPrompt') }}</label>
          <div class="field-wrap"><Icon name="lock" :size="17" /><input id="retry-server-password-input" v-model="serverPasswordDialog.password" type="password" autocomplete="current-password" :placeholder="t('serverPasswordRetryPlaceholder')" autofocus /></div>
          <div class="channel-password-actions"><button type="button" class="text-button" @click="cancelServerPassword">{{ t('channelPasswordCancel') }}</button><button type="submit" class="primary-button channel-password-submit" :disabled="!serverPasswordDialog.password"><span>{{ t('serverPasswordRetry') }}</span><Icon name="chevron-right" :size="17" /></button></div>
        </form>
      </section>
    </div>

    <!-- Audio settings modal -->
    <div v-if="settingsOpen" class="modal-backdrop" @click.self="settingsOpen = false">
      <section class="settings-modal" role="dialog" aria-modal="true" :aria-labelledby="'settings-title'">
        <div class="settings-main"><header class="settings-header"><h2 id="settings-title">{{ t('audioConfiguration') }}</h2><button class="round-icon" :title="t('close')" @click="settingsOpen = false"><Icon name="close" :size="19" /></button></header><div class="settings-content">
          <section class="settings-section"><h3><Icon name="mic" :size="20" /> {{ t('inputDevice') }}</h3><label class="settings-label" for="input-device">{{ t('microphone') }}</label><select id="input-device" class="settings-select" :value="selectedInputDeviceId" :disabled="!inputDevices.length" @change="onInputDeviceChange"><option value="">{{ t('defaultMicrophone') }}</option><option v-for="(device, index) in inputDevices" :key="device.deviceId || `microphone-${index}`" :value="device.deviceId">{{ device.label || t('microphoneNumber', { index: index + 1 }) }}</option></select><p v-if="audioSettingsError" class="settings-error">{{ localizedMessage(audioSettingsError) }}</p><p class="audio-diagnostic"><span>{{ t('permission') }}</span><strong :class="`permission-${audioPermission}`">{{ audioPermission === 'granted' ? t('permissionGranted') : audioPermission === 'denied' ? t('permissionDenied') : t('permissionUnknown') }}</strong></p><div class="microphone-control"><div><label class="settings-label">{{ t('microphoneState') }}</label><p class="settings-hint">{{ microphoneMuted ? t('microphoneMutedHint') : t('microphoneActiveHint') }}</p></div><button type="button" class="microphone-toggle" :class="{ muted: microphoneMuted }" :aria-pressed="!microphoneMuted" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="16" /> {{ microphoneMuted ? t('unmuteMic') : t('muteMic') }}</button></div><label v-if="isMobileViewport" class="mobile-noise-toggle"><span><strong>{{ t('noiseSuppression') }}</strong><small>{{ t('noiseSuppressionHint') }}</small></span><input type="checkbox" :checked="noiseSuppressionEnabled" :aria-label="t('noiseSuppression')" @change="onNoiseSuppressionToggle" /></label><template v-if="isMobileViewport"><div class="settings-range-row"><label class="settings-label">{{ t('inputVolume') }}</label><strong>{{ Math.round(inputVolume * 100) }}%</strong></div><input class="settings-range" type="range" min="0" max="100" :value="inputVolume * 100" :style="rangeStyle(inputVolume, 1)" :aria-label="t('inputVolume')" @input="onInputVolume" /></template><div class="settings-range-row"><label class="settings-label">{{ t('voxThreshold') }}</label><strong>{{ (voxThreshold * 100).toFixed(1) }}%</strong></div><input class="settings-range" type="range" min="1" max="80" :value="voxThreshold * 1000" :style="rangeStyle(voxThreshold, 0.08)" :aria-label="t('voxThreshold')" @input="onVoxThreshold" /><div class="audio-level-row"><span>{{ t('micLevel') }}</span><strong>{{ Math.round(micLevel * 100) }}%</strong></div><div class="audio-level-track"><i :style="{ width: `${Math.round(micLevel * 100)}%` }"></i></div><div class="mic-test"><div class="mic-test-header"><strong>{{ t('microphoneTest') }}</strong><button type="button" @click="toggleMicTest">{{ microphoneTestActive ? t('stopTest') : t('startTest') }}</button></div><div class="meter"><i v-for="index in 24" :key="index" :class="{ active: microphoneTestActive && index <= micMeterBars }" :style="{ height: `${meterBarHeight(index) }px` }"></i></div><div class="meter-labels"><span>{{ t('silence') }}</span><span>{{ t('optimal') }}</span><span>{{ t('loud') }}</span></div><p class="settings-hint">{{ t('localMicTestHint') }}</p><audio v-if="testAudioUrl" class="test-audio" :src="testAudioUrl" controls :aria-label="t('microphoneTest')"></audio></div></section>
          <div class="settings-separator"></div><section class="settings-section"><h3><Icon name="volume" :size="20" /> {{ t('outputVolume') }}</h3><label v-if="outputDeviceSupported" class="settings-label" for="output-device">{{ t('outputDevice') }}</label><select v-if="outputDeviceSupported" id="output-device" class="settings-select" :value="selectedOutputDeviceId" :disabled="!outputDevices.length" @change="onOutputDeviceChange"><option value="">{{ t('defaultOutput') }}</option><option v-for="(device, index) in outputDevices" :key="device.deviceId || `speaker-${index}`" :value="device.deviceId">{{ device.label || t('speakerNumber', { index: index + 1 }) }}</option></select><p v-else class="mode-note"><Icon name="info" :size="16" /><span>{{ t('outputDeviceUnsupported') }}</span></p><template v-if="isMobileViewport"><div class="settings-range-row"><label class="settings-label">{{ t('speakers') }}</label><strong>{{ Math.round(outputVolume * 100) }}%</strong></div><input class="settings-range" type="range" min="0" max="100" :value="outputVolume * 100" :style="rangeStyle(outputVolume, 1)" :aria-label="t('outputVolume')" @input="onOutputVolume" /></template><div class="settings-range-row"><label class="settings-label">{{ t('notificationVolume') }}</label><strong>{{ Math.round(notificationVolume * 100) }}%</strong></div><input class="settings-range" type="range" min="0" max="100" :value="notificationVolume * 100" :style="rangeStyle(notificationVolume, 1)" :aria-label="t('notificationVolume')" @input="onNotificationVolume" /><div class="audio-diagnostic"><span>{{ t('audioStatus') }}</span><strong>{{ audioContextState === 'running' ? (voiceState.microphoneError ? t('audioUnavailable') : t('audioReady')) : audioContextState === 'suspended' ? t('audioSuspended') : t('audioUnknown') }}</strong></div><p v-if="voiceState.microphoneError" class="settings-error">{{ localizedMessage(voiceState.microphoneError) }}</p><div class="mode-note"><Icon name="shield" :size="16" /><span>{{ t('audioPrivacy') }}</span></div></section>
        </div><footer class="settings-footer"><button class="primary-button save-button" @click="settingsOpen = false">{{ t('done') }}</button></footer></div>
      </section>
    </div>

    <div v-if="toast" class="toast"><Icon name="check" :size="16" /> {{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import Icon from "../components/Icon.vue";
import LanguageSwitcher from "../components/LanguageSwitcher.vue";
import { useWebClientChat } from "../composables/useWebClientChat.js";
import { useWebClientAudioControls } from "../composables/useWebClientAudioControls.js";
import { useWebClientChannels, type TreeChannel } from "../composables/useWebClientChannels.js";
import { useWebClientConnection } from "../composables/useWebClientConnection.js";
import { useWebClientMembers } from "../composables/useWebClientMembers.js";
import { useVoiceWebSocket, type ChannelMember, type ChatMessage } from "../composables/useVoiceWebSocket.js";
import { useWebClientScreenShare } from "../composables/useWebClientScreenShare.js";
import { useWebClientPerformance } from "../composables/useWebClientPerformance.js";
import { useWebClientI18n } from "../composables/useWebClientI18n.js";
import { useWebClientPublicConfig } from "../composables/useWebClientPublicConfig.js";
import { useWebClientServerHistory } from "../composables/useWebClientServerHistory.js";
import { getInitialLanguage, type Language } from "../i18n/web-client.js";
import { clearLocalData as clearStoredLocalData, isLocalPersistenceAvailable, loadLocalPreferences, loadStoredIdentity, removeStoredIdentity, saveLocalPreferences, saveStoredIdentity } from "../services/local-persistence.js";
import { applyTheme, getStoredTheme, isDarkTheme, nextTheme, saveTheme, type ThemeMode } from "../services/theme.js";
import { DEFAULT_TEAM_SPEAK_PORT, splitTeamSpeakTarget } from "../services/teamspeak-target.js";

const {
  state: voiceState,
  members,
  channels,
  chatMessages,
  serverEvents,
  pokeNotifications,
  microphoneMuted,
  noiseSuppressionEnabled,
  inputVolume,
  outputVolume,
  outputMuted,
  notificationVolume,
  voxThreshold,
  inputDevices,
  outputDevices,
  selectedInputDeviceId,
  selectedOutputDeviceId,
  outputDeviceSupported,
  audioPermission,
  audioContextState,
  identityMaterial,
  micLevel,
  microphoneTestActive,
  testAudioUrl,
  speakingIds,
  volumes,
  whisperTargetIds,
  whisperActive,
  setVolume,
  setInputVolume,
  setNoiseSuppressionEnabled,
  setOutputVolume,
  toggleOutputMute,
  setVoxThreshold,
  setNotificationVolume,
  prepareInputDevices,
  refreshAudioDevices,
  setInputDevice,
  setOutputDevice,
  startMicrophoneTest,
  stopMicrophoneTest,
  playNotification,
  connect,
  reconnectNow,
  disconnect,
  switchChannel,
  moveClient,
  sendTextMessage,
  sendServerMessage,
  sendPrivateMessage,
  sendPoke,
  setAway,
  setWhisperTargets,
  setWhisperActive,
  setMicrophoneMuted,
  accompanimentActive,
  accompanimentErrorCode,
  screenShareStreams,
  screenShareActive,
  screenShareStarting,
  screenShareViewing,
  screenShareViewingStreamId,
  screenShareRemoteStream,
  screenShareError,
  screenShareErrorCode,
  screenShareRemoteVolume,
  screenShareWebRtcStats,
  startAccompaniment,
  stopAccompaniment,
  startScreenShare,
  stopScreenShare,
  joinScreenShare,
  leaveScreenShare,
  checkSupport,
  clearError,
  measureLatency,
} = useVoiceWebSocket();
const {
  panelOpen: performancePanelOpen,
  running: performanceRunning,
  stats: performanceStats,
  togglePanel: togglePerformancePanel,
  refresh: refreshPerformanceProbe,
} = useWebClientPerformance(computed(() => voiceState.connected), measureLatency);

const query = new URLSearchParams(location.search);
const initialChannel = query.get("channel") ?? "";
const inviteToken = query.get("invite") ?? "";
const initialTarget = initialServerTarget();
const nickname = ref(localStorage.getItem("webspeak:nickname") ?? "");
const channel = ref(initialChannel);
const serverHost = ref(initialTarget.address);
const serverPort = ref(initialTarget.port);
const serverPassword = ref("");
const rememberIdentity = ref(localStorage.getItem("webspeak:remember-identity") !== "0");
const accelerationRelayId = ref("");
const browserError = ref("");
const memberQuery = ref("");
const selectedChannelId = ref("");
const settingsOpen = ref(false);
const channelPasswordDialog = reactive({ open: false, channelId: "", password: "", error: "", submitting: false });
const serverPasswordDialog = reactive({ open: false, password: "", errorCode: "" });
const qqModalOpen = ref(false);
const qqJoinUrl = "http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=yhumUMDD9PmyYFWdXWUb_x7hM5trFQY8&authKey=Pw3HBGT7GwMinTQnuFGfnpf0aRSzXOJKcAiujVP1%2BXMpjheAKrncTRivicBJxpjV&noverify=0&group_code=869500475";
const toast = ref("");
const localPersistenceAvailable = isLocalPersistenceAvailable();
const identityReady = ref(!localPersistenceAvailable);
const mobileSection = ref<"channels" | "chat" | "voice" | "more">("channels");
const isMobileViewport = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const language = ref<Language>(getInitialLanguage());
const { t, localizedMessage, localizedAudioNotice, visibleErrorCode } = useWebClientI18n(language);
const {
  favoriteServers,
  recentServers,
  isFavorite,
  loadSavedServers,
  recordCurrentServer,
  selectLocalServer,
  toggleFavorite,
  clearServerHistory,
} = useWebClientServerHistory({ serverHost, serverPort, nickname, channel, rememberIdentity, identityMaterial, t, showToast });
const {
  accessMode,
  initialized,
  siteName,
  appVersion,
  visitorNumber,
  visitorTotal,
  accelerationRelays,
  accelerationAvailable,
  serverConfigLoading,
  localizedWelcomeText,
  loadPublicConfig,
} = useWebClientPublicConfig({ serverHost, serverPort, accelerationRelayId, language, t });
const themeMode = ref<ThemeMode>(getStoredTheme());
const themeIcon = computed(() => isDarkTheme(themeMode.value) ? "sun" : "moon");
const themeLabel = computed(() => isDarkTheme(themeMode.value) ? t("switchToLightTheme") : t("switchToDarkTheme"));
applyTheme(themeMode.value);
const {
  settingsError: audioSettingsError,
  whisperPttActive,
  onInputVolume,
  onNoiseSuppressionToggle,
  onOutputVolume,
  onVoxThreshold,
  onNotificationVolume,
  onInputDeviceChange,
  onOutputDeviceChange,
  toggleMicTest,
  micMeterBars,
  meterBarHeight,
  toggleMicrophone,
  toggleAccompaniment,
  onWhisperPttDown,
  onWhisperPttUp,
  stopWhisperTalk,
} = useWebClientAudioControls({
  settingsOpen,
  microphoneMuted,
  inputVolume,
  voxThreshold,
  notificationVolume,
  micLevel,
  microphoneTestActive,
  accompanimentActive,
  accompanimentErrorCode,
  whisperTargetIds,
  prepareInputDevices,
  setInputVolume,
  setNoiseSuppressionEnabled,
  setOutputVolume,
  setVoxThreshold,
  setNotificationVolume,
  setInputDevice,
  setOutputDevice,
  setMicrophoneMuted,
  startMicrophoneTest,
  stopMicrophoneTest,
  startAccompaniment,
  stopAccompaniment,
  setWhisperActive,
  localizedMessage,
  showToast,
  t,
});


function initialServerTarget() {
  const explicit = query.get("server") ?? query.get("target");
  if (explicit?.trim()) return splitTeamSpeakTarget(explicit);
  const host = (query.get("tsHost") ?? location.hostname).trim();
  const port = (query.get("tsPort") ?? DEFAULT_TEAM_SPEAK_PORT).trim();
  return splitTeamSpeakTarget(host, port || DEFAULT_TEAM_SPEAK_PORT);
}

function persistLanguage() {
  localStorage.setItem("webspeak:language", language.value);
  void saveLocalPreferences({ schemaVersion: 1, language: language.value });
}

function cycleTheme() {
  themeMode.value = nextTheme(themeMode.value);
  saveTheme(themeMode.value);
  void saveLocalPreferences({ schemaVersion: 1, theme: themeMode.value });
}

const screenShareIndicatorBars = [5, 10, 7, 12, 8, 10];
const {
  playerElement: screenSharePlayerEl,
  fullscreen: screenShareFullscreen,
  resolutionOptions: screenShareResolutionOptions,
  frameRateOptions: screenShareFrameRateOptions,
  resolutionPreset: screenShareResolutionPreset,
  frameRate: screenShareFrameRate,
  settingsOpen: screenShareSettingsOpen,
  viewers: screenSharePlayerViewers,
  viewerCount: screenSharePlayerViewerCount,
  ownerName: screenSharePlayerOwnerName,
  errorText: screenShareErrorText,
  setVideoElement: setScreenVideoElement,
  streamForMember: screenShareStreamForMember,
  toggleForMember: toggleScreenShareForMember,
  viewerStyle: screenShareViewerStyle,
  setVolume: onScreenShareVolume,
  toggleFullscreen: toggleScreenShareFullscreen,
  startWithSettings: startScreenShareWithSettings,
} = useWebClientScreenShare({
  streams: screenShareStreams,
  viewing: screenShareViewing,
  viewingStreamId: screenShareViewingStreamId,
  remoteStream: screenShareRemoteStream,
  remoteVolume: screenShareRemoteVolume,
  error: screenShareError,
  errorCode: screenShareErrorCode,
  startScreenShare,
  joinScreenShare,
  leaveScreenShare,
  nickname,
  avatarStyle,
  t,
});
const {
  channelTree,
  currentChannel,
  currentChannelName,
  currentChannelDescription,
  currentMembers,
  roomMembers,
  memberChannels,
  filteredMemberChannels,
  whisperTargets,
} = useWebClientChannels({
  channels,
  members,
  clientId: computed(() => voiceState.tsClientId),
  selectedChannelId,
  channelName: channel,
  memberQuery,
  whisperTargetIds,
  t,
});
const {
  away,
  memberMenu,
  memberMoveMenuOpen,
  draggedMember,
  dragOverChannelId,
  memberMoveMenuCurrentChannel,
  memberMoveMenuCurrentSameChannel,
  memberMoveMenuOtherChannels,
  openMemberMenu,
  openMemberActions,
  toggleMemberMoveMenu,
  moveMemberDirect,
  onMemberDragStart,
  onMemberDragEnd,
  onMemberPointerDown,
  onMemberPointerMove,
  onMemberPointerUp,
  onMemberPointerCancel,
  onChannelDragOver,
  onChannelDragLeave,
  onChannelDrop,
  toggleWhisperTarget,
  clearWhisperTargets,
  pokeMember,
  copyMemberName,
  toggleAway,
  isSpeaking,
  memberDisplayName,
} = useWebClientMembers({
  channels: memberChannels,
  currentChannel,
  members,
  speakingIds,
  whisperTargetIds,
  moveClient,
  setWhisperTargets,
  sendPoke,
  setAway,
  stopWhisperTalk,
  localizedMessage,
  showToast,
  t,
});
const {
  tab: chatTab,
  privateClientId,
  messageDraft,
  listElement: chatListEl,
  conversations: privateConversations,
  visibleMessages: visibleChatMessages,
  tabLabel: chatTabLabel,
  title: chatTitle,
  placeholder: chatPlaceholder,
  openPrivateChat,
  submitMessage,
} = useWebClientChat({
  messages: chatMessages,
  members,
  currentChannel,
  currentChannelName,
  selectedChannelId,
  clientId: computed(() => voiceState.tsClientId),
  isMobileViewport,
  mobileSection,
  closeMemberMenu: () => { memberMenu.value = null; },
  sendTextMessage,
  sendServerMessage,
  sendPrivateMessage,
  notifyPrivateMessage: () => playNotification("private"),
  t,
});
const {
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
} = useWebClientConnection({
  initialized,
  accessMode,
  isConnecting: computed(() => voiceState.connecting),
  errorCode: computed(() => voiceState.errorCode),
  channelSwitchedChannelId: computed(() => voiceState.channelSwitchedChannelId),
  nickname,
  channelName: channel,
  serverHost,
  serverPort,
  serverPassword,
  rememberIdentity,
  identityMaterial,
  accelerationRelayId,
  inviteToken,
  selectedChannelId,
  channels: channelTree,
  clientId: computed(() => voiceState.tsClientId),
  channelPasswordDialog,
  serverPasswordDialog,
  chatTab,
  connect,
  disconnect,
  switchChannel,
  clearError,
  saveNickname: (value) => {
    localStorage.setItem("webspeak:nickname", value);
    void saveLocalPreferences({ schemaVersion: 1, lastNickname: value });
  },
  showToast,
  t,
});
const visiblePokes = computed(() => pokeNotifications.slice(-3));
const memberMenuStyle = computed(() => {
  if (!memberMenu.value) return {};
  // #app applies zoom:var(--ui-scale) which also scales fixed-element
  // coordinates against the viewport; divide the pointer position back to CSS
  // pixels so the context menu opens exactly where the user clicked on large
  // displays.
  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  return { left: `${memberMenu.value.x / scale}px`, top: `${memberMenu.value.y / scale}px` };
});
watch(() => pokeNotifications.length, (length, previousLength) => {
  const latest = pokeNotifications[length - 1];
  if (!latest || length <= previousLength) return;
  showToast(`${latest.invokerName} ${t("pokedYou")}${latest.message ? `：${latest.message}` : ""}`);
  playNotification("poke");
  if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(t("poke"), { body: `${latest.invokerName}: ${latest.message || t("pokedYou")}` });
});
watch(rememberIdentity, (remember) => {
  localStorage.setItem("webspeak:remember-identity", remember ? "1" : "0");
  if (!remember) {
    identityMaterial.value = "";
    void removeStoredIdentity();
  }
});
watch([rememberIdentity, identityMaterial], ([remember, material]) => {
  if (remember && material) void saveStoredIdentity(material);
  if (!remember && material) identityMaterial.value = "";
});
watch(() => voiceState.connected, (connected) => {
  if (!connected) return;
  playNotification("connected");
  recordCurrentServer();
});

watch(() => voiceState.reconnecting, (reconnecting, wasReconnecting) => {
  if (reconnecting && !wasReconnecting) {
    playNotification("disconnected");
  }
});
watch(() => voiceState.reconnectFailed, (failed, wasFailed) => {
  if (failed && !wasFailed) playNotification("reconnectFailed");
});

let deviceChangeHandler: (() => void) | undefined;
let viewportMediaQuery: MediaQueryList | undefined;
let viewportChangeHandler: (() => void) | undefined;

onMounted(() => {
  browserError.value = checkSupport() ?? "";
  void loadPublicConfig();
  void loadLocalPreferences().then((preferences) => {
    if (!localStorage.getItem("webspeak:language") && (preferences.language === "zh" || preferences.language === "en" || preferences.language === "de" || preferences.language === "ru" || preferences.language === "ja")) language.value = preferences.language;
    if (!localStorage.getItem("webspeak:theme") && (preferences.theme === "system" || preferences.theme === "light" || preferences.theme === "dark")) {
      themeMode.value = preferences.theme;
      applyTheme(themeMode.value);
    }
  });
  void loadStoredIdentity().then((stored) => {
    if (stored && localStorage.getItem("webspeak:remember-identity") === "1") {
      identityMaterial.value = stored.privateMaterial;
      rememberIdentity.value = true;
    }
  }).finally(() => {
    identityReady.value = true;
  });
  void loadSavedServers();
  deviceChangeHandler = () => { void refreshAudioDevices().catch(() => undefined); };
  navigator.mediaDevices?.addEventListener("devicechange", deviceChangeHandler);
  viewportMediaQuery = window.matchMedia("(max-width: 740px)");
  viewportChangeHandler = () => {
    isMobileViewport.value = viewportMediaQuery?.matches ?? false;
    if (!isMobileViewport.value) memberMenu.value = null;
    else if (accompanimentActive.value) void stopAccompaniment();
  };
  viewportChangeHandler();
  viewportMediaQuery.addEventListener?.("change", viewportChangeHandler);
});
onUnmounted(() => {
  disconnect();
  if (deviceChangeHandler) navigator.mediaDevices?.removeEventListener("devicechange", deviceChangeHandler);
  if (viewportMediaQuery && viewportChangeHandler) viewportMediaQuery.removeEventListener?.("change", viewportChangeHandler);
  if (toastTimer) clearTimeout(toastTimer);
});

function channelLabel(item: TreeChannel) {
  return `${"　".repeat(item.depth)}${item.name}`;
}

function doShare() {
  const invite = new URL(location.href);
  invite.searchParams.delete("token");
  invite.searchParams.delete("target");
  invite.searchParams.delete("tsHost");
  invite.searchParams.delete("tsPort");
  invite.searchParams.delete("server");
  if (accessMode.value === "open" && serverHost.value.trim()) invite.searchParams.set("server", currentServerTarget());
  if (channel.value) invite.searchParams.set("channel", channel.value);
  navigator.clipboard?.writeText(invite.toString()).then(() => showToast(t("copiedToast")), () => showToast(t("copyFailedToast")));
}

async function clearBrowserData(): Promise<void> {
  if (!window.confirm(t("clearLocalDataConfirm"))) return;
  await clearStoredLocalData();
  for (const key of ["webspeak:nickname", "webspeak:language", "webspeak:theme", "webspeak:input-device", "webspeak:output-device", "webspeak:remember-identity"]) localStorage.removeItem(key);
  themeMode.value = "system";
  applyTheme(themeMode.value);
  identityMaterial.value = "";
  rememberIdentity.value = false;
  clearServerHistory();
  showToast(t("localDataCleared"));
}

function dismissPoke(id: string): void {
  const index = pokeNotifications.findIndex((poke) => poke.id === id);
  if (index >= 0) pokeNotifications.splice(index, 1);
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
function avatarStyle(name: string, isSelf = false, avatar = "") {
  const fallback = isSelf ? "linear-gradient(135deg, #006a64, #2e9f96)" : "";
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = name.charCodeAt(index) + ((hash << 5) - hash);
  return {
    background: fallback || avatarColors[Math.abs(hash) % avatarColors.length],
    ...(avatar ? { backgroundImage: `url("${avatar}")`, backgroundPosition: "center", backgroundSize: "cover" } : {}),
  };
}

function messageAvatar(message: ChatMessage): string {
  const member = members.find((candidate) =>
    (typeof message.senderId === "number" && candidate.id === message.senderId) ||
    (Boolean(message.senderUid) && candidate.uid === message.senderUid),
  );
  return member?.avatar ?? "";
}

function formatTime(timestamp: number) {
  const locale = language.value === "zh" ? "zh-CN" : language.value === "de" ? "de-DE" : language.value === "ru" ? "ru-RU" : language.value === "ja" ? "ja-JP" : "en-US";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function rangeStyle(value: number, max: number) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return { background: `linear-gradient(to right, #006a64 0%, #006a64 ${percent}%, #e7eceb ${percent}%, #e7eceb 100%)` };
}

function onVolInput(clientId: number, event: Event) {
  setVolume(clientId, Number((event.target as HTMLInputElement).value) / 100);
}
</script>

<style scoped src="../styles/web-client.css"></style>
