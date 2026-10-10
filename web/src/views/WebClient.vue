<template>
  <div
    :class="[
      'web-client',
      'ws-skin-root',
      `language-${language}`,
      { 'skin-initializing': !skinReady, 'keyboard-open': mobileViewport.keyboardOpen },
    ]"
    :style="{ '--ws-viewport-height': `${mobileViewport.height}px`, '--ws-viewport-top': `${mobileViewport.top}px` }"
    :lang="language"
    data-ws-part="app"
    :data-ws-page="showVoiceShell ? 'voice' : 'home'"
  >
    <SkinPluginOutlet
      v-if="activeSkin"
      :skin-id="activeSkin.id"
      :skin-version="activeSkin.version"
      :document="skinPluginDocument"
      :page="showVoiceShell ? 'voice' : 'home'"
      :data="skinPluginContext"
      :assets="activeSkin.assets"
      :actions="skinPluginActions"
      :widgets="skinPluginWidgets"
      @surface-change="skinPluginSurfaceActive = $event"
      @restore-skin="switchToBuiltIn"
    />
    <SkinPluginEditor
      v-if="activeSkin"
      :skin-id="activeSkin.id"
      :skin-version="activeSkin.version"
      :base-document="activeSkin.pluginData"
      :page="showVoiceShell ? 'voice' : 'home'"
      :lang="language"
      @updated="skinPluginDocumentRevision += 1"
    />
    <SkinRuntimePluginHost
      v-if="activeSkin?.runtimePlugins"
      :skin-id="activeSkin.id"
      :skin-version="activeSkin.version"
      :plugins="activeSkin.runtimePlugins"
      :files="activeSkin.runtimePluginFiles ?? {}"
      :styles="activeSkin.runtimePluginStyles ?? {}"
      :assets="activeSkin.assets"
      :page="showVoiceShell ? 'voice' : 'home'"
      :mount-revision="accessMode"
      :context="skinPluginContext"
      :actions="skinPluginActions"
      :widgets="skinPluginWidgets"
      :read-session-status="readSkinRuntimeSessionStatus"
      @surface-change="skinRuntimePluginSurfaceActive = $event"
      @restore-skin="switchToBuiltIn"
    />
    <!-- Connection / welcome screen -->
    <section
      v-if="!showVoiceShell && !skinPluginSurfaceActive && !skinRuntimePluginSurfaceActive"
      class="join-page"
      data-ws-part="home"
    >
      <WebClientHeader
        v-model:language="language"
        v-model:skin-id="activeSkinId"
        :brand-name="skinHomeCopy.brandName || siteName"
        :app-version="appVersion"
        :mobile="mobileMode"
        :skin-options="skinOptions"
        :t="t"
        @open-qq="qqModalOpen = true"
        @skin-change="onSkinChange"
        @language-change="persistLanguage"
      />
      <div class="ws-skin-mount-slot" data-ws-skin-mount="home.header.after"></div>

      <main
        class="join-content"
        data-ws-part="home.content"
      >
        <div class="ws-skin-mount-slot" data-ws-skin-mount="home.content.before"></div>
        <div
          class="join-copy"
          data-ws-part="home.hero"
        >
          <div
            class="eyebrow"
            data-ws-part="home.hero.eyebrow"
            ><span class="eyebrow-dot"></span> {{ skinHomeCopy.eyebrow || t("privateAudio") }}</div
          >
          <h1 data-ws-part="home.hero.title"
            >{{ skinHomeCopy.title || t("joinLine1") }}<br /><em>{{
              skinHomeCopy.titleAccent || t("joinLine2")
            }}</em></h1
          >
          <p
            class="join-description"
            data-ws-part="home.hero.description"
            >{{ skinHomeCopy.description || localizedWelcomeText }}</p
          >
          <div
            class="promise-list"
            data-ws-part="home.features"
          >
            <div
              v-for="feature in skinHomeFeatures"
              :key="feature.id"
              class="promise-item"
              data-ws-part="home.feature"
              :data-ws-feature-id="feature.id"
              ><span :class="['promise-icon', feature.tone]"
                ><Icon
                  :name="feature.icon"
                  :size="16" /></span
              ><span
                ><b>{{ feature.title }}</b
                ><small>{{ feature.description }}</small></span
              ></div
            >
          </div>
          <div
            v-if="visitorNumber !== null"
            class="visitor-count"
            data-ws-part="home.visitors"
            role="status"
            aria-live="polite"
          >
            <span
              class="visitor-count-orbit"
              aria-hidden="true"
            ></span>
            <span class="visitor-count-icon"
              ><Icon
                name="users"
                :size="15"
            /></span>
            <span class="visitor-count-label">{{
              t("visitorCount", { count: visitorNumber })
            }}</span>
            <span
              v-if="visitorTotal !== null"
              class="visitor-count-divider"
              aria-hidden="true"
            ></span>
            <span
              v-if="visitorTotal !== null"
              class="visitor-count-total"
              >{{ t("visitorTotal", { count: visitorTotal }) }}</span
            >
            <span
              class="visitor-count-spark"
              aria-hidden="true"
              >✦</span
            >
          </div>
        </div>

        <div
          class="join-card"
          data-ws-part="home.join-card"
        >
          <div
            class="join-card-effects"
            aria-hidden="true"
          >
            <span
              class="join-card-waveform"
              data-ws-part="home.join-card.waveform"
              ><i
                v-for="bar in 9"
                :key="bar"
              ></i
            ></span>
            <span
              class="join-card-sonar"
              data-ws-part="home.join-card.sonar"
              ><i
                v-for="ring in 3"
                :key="ring"
              ></i
            ></span>
          </div>
          <h2 data-ws-part="home.join-title">{{
            skinHomeCopy.welcomeTitle || t("welcomeBack")
          }}</h2>
          <p
            class="card-lead"
            data-ws-part="home.join-description"
            >{{ skinHomeCopy.welcomeDescription || t("joinLead") }}</p
          >

          <div
            v-if="voiceState.error"
            class="notice error-notice"
            data-ws-part="home.notice"
            data-ws-state="error"
            ><span class="notice-symbol">!</span
            ><span class="notice-content"
              ><span>{{ localizedMessage(voiceState.error) }}</span
              ><code v-if="voiceState.errorCode"
                >{{ t("errorCode") }}: {{ visibleErrorCode(voiceState.errorCode) }}</code
              ></span
            ></div
          >
          <div
            v-if="browserError"
            class="notice warning-notice"
            data-ws-part="home.notice"
            data-ws-state="warning"
            ><span class="notice-symbol">i</span
            ><span>{{ localizedMessage(browserError) }}</span></div
          >
          <div
            v-if="!serverConfigLoading && !initialized"
            class="notice warning-notice"
            data-ws-part="home.notice"
            data-ws-state="unconfigured"
            ><span class="notice-symbol">i</span
            ><span
              >{{ t("notConfigured") }} <a href="/admin">{{ t("configureNow") }}</a></span
            ></div
          >
          <div
            v-if="!localPersistenceAvailable"
            class="notice warning-notice"
            data-ws-part="home.notice"
            data-ws-state="storage-warning"
            ><span class="notice-symbol">i</span
            ><span>{{ t("localPersistenceUnavailable") }}</span></div
          >

          <JoinForm
            v-if="initialized"
            :autofocus-nickname="!isMobileViewport"
            v-model:server-host="serverHost"
            v-model:server-port="serverPort"
            v-model:server-password="serverPassword"
            v-model:nickname="nickname"
            v-model:channel="channel"
            v-model:remember-identity="rememberIdentity"
            v-model:acceleration-relay-id="accelerationRelayId"
            :access-mode="accessMode"
            :open-target-prefill-blocked="openTargetPrefillBlocked"
            :acceleration-relays="accelerationRelays"
            :quick-servers="quickServers"
            :is-favorite="isFavorite"
            :identity-export-busy="identityExportBusy"
            :has-identity="Boolean(identityMaterial)"
            :connecting="voiceState.connecting"
            :join-disabled="
              !canJoin || serverConfigLoading || !identityReady || voiceState.connecting
            "
            :t="t"
            @connect="doConnect"
            @disconnect="doDisconnect"
            @select-server="selectLocalServer"
            @toggle-favorite="toggleFavorite"
            @toggle-quick-favorite="toggleQuickFavorite"
            @import-identity="openIdentityImport"
            @export-identity="exportIdentity"
          />
          <div
            class="join-meta"
            data-ws-part="home.security-note"
            ><Icon
              name="lock"
              :size="14"
            />
            {{ t("connectionAuthorized") }}</div
          >
        </div>
        <div class="ws-skin-mount-slot" data-ws-skin-mount="home.content.after"></div>
      </main>

      <footer
        class="join-footer"
        data-ws-part="home.footer"
      >
        <div class="ws-skin-mount-slot" data-ws-skin-mount="home.footer.before"></div>
        <span>WebSpeak</span><span class="footer-separator">·</span
        ><span>{{ t("teamSpeakClient") }}</span
        ><span class="footer-spacer"></span
        ><button
          type="button"
          class="clear-local-button"
          @click="clearBrowserData"
          >{{ t("clearLocalData") }}</button
        ><span class="footer-separator">·</span><span>{{ t("browserSupport") }}</span>
      </footer>

      <!-- QQ community modal -->
      <div
        v-if="qqModalOpen"
        class="modal-backdrop qq-modal-backdrop"
        @click.self="qqModalOpen = false"
      >
        <section
          class="qq-modal-card"
          data-ws-part="home.community-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="'qq-group-title'"
        >
          <button
            type="button"
            class="qq-modal-close"
            :aria-label="t('close')"
            :title="t('close')"
            @click="qqModalOpen = false"
            ><Icon
              name="close"
              :size="19"
          /></button>
          <div class="qq-modal-heading"
            ><span class="card-kicker">{{ t("qqGroup") }}</span
            ><h2 id="qq-group-title">{{ t("qqGroup") }}</h2></div
          >
          <img
            class="qq-qr-image"
            src="/qq-group-qr.jpg"
            :alt="t('qqGroupQrAlt')"
          />
          <p class="qq-direct-join">{{ t("qqJoinDirect") }}</p>
          <a
            class="qq-join-link"
            :href="qqJoinUrl"
            :aria-label="t('joinQqGroup')"
            target="_blank"
            rel="noreferrer"
            >{{ qqJoinUrl }}</a
          >
        </section>
      </div>
    </section>

    <!-- Connected application shell -->
    <div
      v-else-if="showVoiceShell && !skinPluginSurfaceActive && !skinRuntimePluginSurfaceActive"
      :class="['app-shell', `mobile-view-${mobileSection}`]"
      :data-performance-open="performancePanelOpen ? 'true' : 'false'"
      :data-favorite-rail="accessMode === 'open' ? 'true' : 'false'"
      data-ws-part="voice.shell"
      @click="memberMenu = null"
    >
      <aside
        v-if="accessMode === 'open'"
        class="favorite-server-rail"
        data-ws-part="voice.favorite-servers.rail"
        :aria-label="t('quickServers')"
      >
        <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.server-rail.before"></div>
        <div class="favorite-server-rail-list" data-ws-part="voice.favorite-servers.rail.list">
          <div
            v-for="server in quickServers"
            :key="server.id"
            class="favorite-server-rail-item"
            data-ws-part="voice.favorite-servers.rail.item"
            :data-ws-state="server.isFavorite ? 'favorite' : 'recent'"
          >
            <button
              type="button"
              :class="['favorite-server-button', { active: isQuickServerTarget(server) }]"
              data-ws-part="voice.favorite-servers.server"
              :data-ws-state="isQuickServerTarget(server) ? 'current' : 'idle'"
              :data-ws-server-kind="server.isFavorite ? 'favorite' : 'recent'"
              :title="server.label + '\n' + server.address"
              :aria-label="t('switchToServer', { server: server.label })"
              :aria-pressed="isQuickServerTarget(server)"
              :disabled="voiceState.connecting"
              @click.stop="connectQuickServer(server)"
            >
              <span class="favorite-server-avatar" data-ws-part="voice.favorite-servers.avatar" :style="avatarStyle(server.label)">{{ avatarInitial(server.label) }}</span>
              <span class="favorite-server-tooltip" data-ws-part="voice.favorite-servers.tooltip"><strong>{{ server.label }}</strong><small>{{ server.address }}</small></span>
            </button>
            <button
              type="button"
              :class="['favorite-server-toggle', { active: server.isFavorite }]"
              data-ws-part="voice.favorite-servers.favorite-toggle"
              :data-ws-state="server.isFavorite ? 'saved' : 'unsaved'"
              :aria-label="server.isFavorite ? t('removeFavoriteForServer', { server: server.label }) : t('saveFavoriteForServer', { server: server.label })"
              :title="server.isFavorite ? t('removeFavorite') : t('saveFavorite')"
              :aria-pressed="server.isFavorite"
              @click.stop="toggleQuickFavorite(server)"
            >
              <Icon name="star" :size="11" />
            </button>
          </div>
        </div>
        <button
          type="button"
          class="favorite-server-add"
          data-ws-part="voice.favorite-servers.add"
          :aria-label="t('addFavoriteServer')"
          :title="t('addFavoriteServer')"
          @click.stop="favoriteServerDialogOpen = true"
        ><Icon name="plus" :size="20" /></button>
        <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.server-rail.after"></div>
      </aside>

      <nav
        v-if="accessMode === 'open'"
        class="favorite-server-strip"
        data-ws-part="voice.favorite-servers.strip"
        :aria-label="t('quickServers')"
      >
        <div
          v-for="server in quickServers"
          :key="server.id"
          class="favorite-server-strip-item"
          data-ws-part="voice.favorite-servers.strip.item"
          :data-ws-state="server.isFavorite ? 'favorite' : 'recent'"
        ><button
          type="button"
          :class="['favorite-server-strip-button', { active: isQuickServerTarget(server) }]"
          data-ws-part="voice.favorite-servers.strip.server"
          :data-ws-state="isQuickServerTarget(server) ? 'current' : 'idle'"
          :data-ws-server-kind="server.isFavorite ? 'favorite' : 'recent'"
          :aria-label="t('switchToServer', { server: server.label })"
          :aria-pressed="isQuickServerTarget(server)"
          :disabled="voiceState.connecting"
          @click="connectQuickServer(server)"
        ><span class="favorite-server-avatar" data-ws-part="voice.favorite-servers.avatar" :style="avatarStyle(server.label)">{{ avatarInitial(server.label) }}</span><span>{{ server.label }}</span></button
          ><button
            type="button"
            :class="['favorite-server-strip-toggle', { active: server.isFavorite }]"
            data-ws-part="voice.favorite-servers.strip.favorite-toggle"
            :data-ws-state="server.isFavorite ? 'saved' : 'unsaved'"
            :aria-label="server.isFavorite ? t('removeFavoriteForServer', { server: server.label }) : t('saveFavoriteForServer', { server: server.label })"
            :title="server.isFavorite ? t('removeFavorite') : t('saveFavorite')"
            :aria-pressed="server.isFavorite"
            @click.stop="toggleQuickFavorite(server)"
          ><Icon name="star" :size="11" /></button
        ></div>
        <button
          type="button"
          class="favorite-server-strip-add"
          data-ws-part="voice.favorite-servers.strip.add"
          :aria-label="t('addFavoriteServer')"
          :title="t('addFavoriteServer')"
          @click="favoriteServerDialogOpen = true"
        ><Icon name="plus" :size="18" /></button>
      </nav>

      <div
        v-if="isMobileViewport && (favoriteSwitchPending || favoriteSwitchFailed)"
        :class="['favorite-switch-banner', 'favorite-switch-mobile-banner', { failed: favoriteSwitchFailed }]"
        data-ws-part="voice.favorite-servers.switch-status"
        :data-ws-state="favoriteSwitchFailed ? 'failed' : 'connecting'"
        role="status"
        aria-live="polite"
      >
        <span class="favorite-switch-indicator"><Icon :name="favoriteSwitchFailed ? 'info' : 'server'" :size="17" /></span>
        <span class="favorite-switch-copy">
          <strong>{{ favoriteSwitchFailed ? t('favoriteConnectionFailed', { server: favoriteSwitchLabel }) : t('favoriteSwitching', { server: favoriteSwitchLabel }) }}</strong>
          <small v-if="favoriteSwitchPending">{{ t('connecting') }}</small>
          <small v-else>{{ favoriteSwitchError || t('quickConnectFailed') }}</small>
        </span>
        <button v-if="favoriteSwitchFailed" type="button" @click="leaveVoiceWorkspace">{{ t('back') }}</button>
      </div>

      <main
        class="workspace"
        data-ws-part="voice.workspace"
      >
        <header
          class="workspace-header"
          data-ws-part="voice.header"
        >
          <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.header.before"></div>
          <div
            class="breadcrumbs"
            data-ws-part="voice.breadcrumbs"
            ><span class="mobile-brand">TeamSpeak <em>Web</em></span
            ><span class="crumb-muted">{{ t("serverBreadcrumb") }}</span
            ><Icon
              name="chevron-right"
              :size="14"
            /><strong>{{ currentChannelName }}</strong></div
          >
          <div
            class="workspace-actions"
            data-ws-part="voice.header-actions"
          >
            <VoicePerformancePanel
              :model="performance"
              :screen-share-web-rtc-stats="screenShareWebRtcStats"
              :t="t"
            />
            <button
              class="header-action"
              :title="t('copyInvite')"
              @click="doShare"
              ><Icon
                name="share"
                :size="18"
            /></button>
            <button
              v-if="accessMode === 'open'"
              :class="['header-action', 'favorite-current-toggle', { active: isFavorite }]"
              data-ws-part="voice.favorite-servers.current-toggle"
              :data-ws-state="isFavorite ? 'saved' : 'unsaved'"
              :title="t(isFavorite ? 'removeFavorite' : 'saveFavorite')"
              :aria-label="t(isFavorite ? 'removeFavorite' : 'saveFavorite')"
              :aria-pressed="isFavorite"
              @click="toggleFavorite"
            ><Icon name="star" :size="18" /></button>
            <button
              v-if="isMobileViewport"
              class="header-action microphone-header-toggle"
              :class="{ muted: microphoneMuted }"
              :title="microphoneMuted ? t('unmuteMic') : t('muteMic')"
              :aria-label="microphoneMuted ? t('microphoneMuted') : t('microphoneActive')"
              :aria-pressed="!microphoneMuted"
              @click="toggleMicrophone"
              ><Icon
                :name="microphoneMuted ? 'mic-off' : 'mic'"
                :size="18"
            /></button>
            <button
              v-if="isMobileViewport"
              class="header-action"
              :title="t('audioSettings')"
              :aria-label="t('audioSettings')"
              @click="settingsOpen = true"
              ><Icon
                name="settings"
                :size="18"
            /></button>
            <SkinSwitcher
              v-model="activeSkinId"
              class="workspace-skin-switcher"
              :menu-label="t('skinSelector')"
              :options="skinOptions"
              @change="onSkinChange"
            />
            <LanguageSwitcher
              v-model="language"
              class="workspace-language"
              :menu-label="t('languageMenu')"
              @change="persistLanguage"
            />
            <button
              class="disconnect-button"
              :aria-label="t('exit')"
              @click="leaveVoiceWorkspace"
            ><Icon
                name="door"
                :size="17"
              /><span>{{ t("exit") }}</span></button
            >
          </div>
          <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.header.after"></div>
        </header>

        <div
          v-if="!isMobileViewport && (favoriteSwitchPending || favoriteSwitchFailed)"
          :class="['favorite-switch-banner', { failed: favoriteSwitchFailed }]"
          data-ws-part="voice.favorite-servers.switch-status"
          :data-ws-state="favoriteSwitchFailed ? 'failed' : 'connecting'"
          role="status"
          aria-live="polite"
        >
          <span class="favorite-switch-indicator"><Icon :name="favoriteSwitchFailed ? 'info' : 'server'" :size="17" /></span>
          <span class="favorite-switch-copy">
            <strong>{{ favoriteSwitchFailed ? t('favoriteConnectionFailed', { server: favoriteSwitchLabel }) : t('favoriteSwitching', { server: favoriteSwitchLabel }) }}</strong>
            <small v-if="favoriteSwitchPending">{{ t('connecting') }}</small>
            <small v-else>{{ favoriteSwitchError || t('quickConnectFailed') }}</small>
          </span>
          <button v-if="favoriteSwitchFailed" type="button" @click="leaveVoiceWorkspace">{{ t('back') }}</button>
        </div>

        <div
          v-if="voiceState.reconnecting || voiceState.reconnectFailed"
          :class="['reconnect-banner', { failed: voiceState.reconnectFailed }]"
          data-ws-part="voice.connection-status"
          role="status"
        >
          <div class="reconnect-copy"
            ><strong>{{
              voiceState.reconnectFailed ? t("reconnectFailed") : t("connectionInterrupted")
            }}</strong
            ><span v-if="voiceState.reconnecting">{{
              t("reconnectingAttempt", { attempt: voiceState.reconnectAttempt })
            }}</span
            ><span v-else>{{ localizedMessage(voiceState.error) }}</span></div
          >
          <div class="reconnect-actions"
            ><button
              v-if="voiceState.reconnectFailed"
              type="button"
              class="secondary-button"
              @click="reconnectMobile"
              >{{ t("reconnectNow") }}</button
            ><button
              type="button"
              class="text-button"
              @click="leaveVoiceWorkspace"
              >{{ t("back") }}</button
            ></div
          >
        </div>
        <div
          v-if="voiceState.audioNotice"
          class="reconnect-banner degraded"
          data-ws-part="voice.audio-status"
          role="status"
          ><div class="reconnect-copy"
            ><strong>{{ t("audioStatus") }}</strong
            ><span>{{
              localizedAudioNotice(voiceState.audioNoticeCode, voiceState.audioNotice)
            }}</span></div
          ></div
        >
        <div
          v-for="poke in visiblePokes"
          :key="poke.id"
          class="poke-banner"
          data-ws-part="voice.poke"
          role="status"
          ><Icon
            name="bell"
            :size="17" /><span
            ><strong>{{ poke.invokerName }}</strong> {{ t("pokedYou")
            }}<small v-if="poke.message">：{{ poke.message }}</small></span
          ><button
            type="button"
            @click="dismissPoke(poke.id)"
            ><Icon
              name="close"
              :size="15" /></button
        ></div>

        <div
          class="workspace-scroll"
          data-ws-part="voice.scroll"
        >
          <div
            class="workspace-content"
            data-ws-part="voice.content"
          >
            <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.activity.before"></div>
            <section
              :class="['voice-section', { 'mobile-section-hidden': mobileSection !== 'voice' }]"
              data-ws-part="voice.activity"
            >
              <div
                class="voice-activity-artwork"
                data-ws-part="voice.activity.artwork"
                aria-hidden="true"
              ></div>
              <div
                class="section-heading"
                data-ws-part="voice.activity-heading"
                ><div
                  ><span class="section-kicker">{{ t("voiceActivity") }}</span
                  ><h2>{{ t("speakingNow") }}</h2></div
                ><span class="section-counter">{{
                  t("onlineShort", { count: currentMembers.length })
                }}</span></div
              >
              <div
                v-if="screenShareError"
                class="screen-share-inline-error"
                data-ws-part="voice.screen-share-error"
                role="status"
                ><Icon
                  name="info"
                  :size="15"
                /> <span>{{ screenShareErrorText }}</span></div
              >
              <ScreenSharePlayer
                v-if="screenShareViewing"
                :model="screenShareControls"
                :screen-share-remote-stream="screenShareRemoteStream"
                :screen-share-remote-volume="screenShareRemoteVolume"
                :screen-share-error="screenShareError"
                :leave-screen-share="leaveScreenShare"
                :avatar-initial="avatarInitial"
                :t="t"
              />
              <VoiceMemberCards
                :current-members="currentMembers"
                :is-mobile-viewport="isMobileViewport"
                :sharing="memberSharingState"
                :controls="screenShareControls"
                :is-speaking="isSpeaking"
                :avatar-style="avatarStyle"
                :avatar-initial="avatarInitial"
                :t="t"
                @member-actions="openMemberActions"
                @stop-share="stopScreenShare"
              />
              <WhisperControls
                v-if="whisperTargetIds.size"
                :targets="whisperTargets"
                :active="whisperActive"
                :enabled="!isMobileViewport || mobileSection === 'voice'"
                :controls="audioControls"
                :t="t"
                @clear="clearWhisperTargets"
              />
              <div class="mobile-voice-controls">
                <button
                  type="button"
                  class="mobile-voice-toggle"
                  :class="{ muted: microphoneMuted }"
                  :aria-label="t('microphone')"
                  :title="microphoneMuted ? t('microphoneMuted') : t('microphoneActive')"
                  :aria-pressed="!microphoneMuted"
                  @click="toggleMicrophone"
                  ><Icon
                    :name="microphoneMuted ? 'mic-off' : 'mic'"
                    :size="18"
                  /><span>{{ t("microphone") }}</span></button
                >
                <button
                  type="button"
                  class="mobile-voice-toggle"
                  :class="{ muted: outputMuted }"
                  :aria-label="t('speaker')"
                  :title="outputMuted ? t('outputMuted') : t('speaker')"
                  :aria-pressed="!outputMuted"
                  @click="toggleOutputMute"
                  ><Icon :name="outputMuted ? 'volume-off' : 'volume'" :size="18" /><span>{{ t("speaker") }}</span></button
                >
                <button type="button" class="mobile-voice-leave" :aria-label="t('exit')" :title="t('exit')" @click="leaveVoiceWorkspace"><Icon name="door" :size="17" /></button
                >
              </div>
            </section>

            <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.activity.after"></div>
            <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.chat.before"></div>
            <ChatPanel
              :model="chat"
              :t="t"
              :current-channel-name="currentChannelName"
              :mobile-hidden="mobileSection !== 'chat'"
              :server-events="serverEvents"
              :avatar-style="avatarStyle"
              :avatar-initial="avatarInitial"
              :message-avatar="messageAvatar"
              :format-time="formatTime"
            />
            <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.chat.after"></div>
          </div>
        </div>
      </main>

      <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.channel-panel.before"></div>
      <ChannelMemberPanel
        v-model:query="memberQuery"
        :model="memberControls"
        :filtered-member-channels="filteredMemberChannels"
        :current-channel-id="currentChannel?.id"
        :mobile-visible="mobileSection === 'channels'"
        :is-mobile-viewport="isMobileViewport"
        :volumes="volumes"
        :avatar-style="avatarStyle"
        :avatar-initial="avatarInitial"
        :range-style="rangeStyle"
        :t="t"
        @select-channel="selectChannel"
        @volume-input="onVolInput"
      >
        <div v-if="isMobileViewport" class="mobile-member-controls" role="toolbar" :aria-label="t('desktopAudioControls')">
          <button type="button" class="mobile-voice-toggle" :class="{ muted: microphoneMuted }" :aria-label="t('microphone')" :title="microphoneMuted ? t('microphoneMuted') : t('microphoneActive')" :aria-pressed="!microphoneMuted" @click="toggleMicrophone"><Icon :name="microphoneMuted ? 'mic-off' : 'mic'" :size="20" /><span>{{ t('microphone') }}</span></button>
          <button type="button" class="mobile-voice-toggle" :class="{ muted: outputMuted }" :aria-label="t('speaker')" :title="outputMuted ? t('outputMuted') : t('speaker')" :aria-pressed="!outputMuted" @click="toggleOutputMute"><Icon :name="outputMuted ? 'volume-off' : 'volume'" :size="20" /><span>{{ t('speaker') }}</span></button>
          <button type="button" class="mobile-member-leave" :aria-label="t('exit')" :title="t('exit')" @click="leaveVoiceWorkspace"><Icon name="door" :size="18" /></button>
        </div>
        <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.audio-dock.before"></div>
        <AudioDock
          v-if="!isMobileViewport"
          :model="audioDockState"
          :controls="audioControls"
          :t="t"
          :range-style="rangeStyle"
          @settings="settingsOpen = true"
          @output-mute="toggleOutputMute"
        />
        <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.audio-dock.after"></div>
      </ChannelMemberPanel>
      <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.channel-panel.after"></div>

      <section
        v-if="mobileSection === 'more'"
        class="mobile-more-panel"
        data-ws-part="voice.mobile-more"
      >
        <span class="section-kicker">{{ t("mobileMore") }}</span>
        <h2>{{ t("mobileMore") }}</h2>
        <button
          type="button"
          :class="{ muted: microphoneMuted }"
          @click="toggleMicrophone"
          ><Icon
            :name="microphoneMuted ? 'mic-off' : 'mic'"
            :size="18"
          />
          {{ microphoneMuted ? t("unmuteMic") : t("muteMic") }}</button
        >
        <button
          type="button"
          @click="settingsOpen = true"
          ><Icon
            name="settings"
            :size="18"
          />
          {{ t("audioSettings") }}</button
        >
        <SkinSwitcher
          v-model="activeSkinId"
          class="mobile-skin-switcher"
          :menu-label="t('skinSelector')"
          :options="skinOptions"
          @change="onSkinChange"
        />
        <div class="language-menu-row"
          ><Icon
            name="globe"
            :size="18" /><span>{{ t("languageMenu") }}</span
          ><LanguageSwitcher
            v-model="language"
            :menu-label="t('languageMenu')"
            @change="persistLanguage"
        /></div>
        <button
          type="button"
          class="danger"
          @click="leaveVoiceWorkspace"
          ><Icon
            name="door"
            :size="18"
          />
          {{ t("exit") }}</button
        >
      </section>

      <nav
        class="mobile-nav"
        data-ws-part="voice.mobile-nav"
        :aria-label="t('mobileNavigation')"
      >
        <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.mobile-nav.before"></div>
        <button
          type="button"
          :class="{ active: mobileSection === 'channels' }"
          :aria-current="mobileSection === 'channels' ? 'page' : undefined"
          @click="selectMobileSection('channels')"
          ><Icon
            name="volume"
            :size="18"
          /><span>{{ t("mobileChannels") }}</span></button
        >
        <button
          type="button"
          :class="{ active: mobileSection === 'chat' }"
          :aria-current="mobileSection === 'chat' ? 'page' : undefined"
          @click="selectMobileSection('chat')"
          ><Icon
            name="message"
            :size="18"
          /><span>{{ t("mobileChat") }}</span></button
        >
        <button
          type="button"
          :class="{ active: mobileSection === 'voice' }"
          :aria-current="mobileSection === 'voice' ? 'page' : undefined"
          @click="selectMobileSection('voice')"
          ><Icon
            name="mic"
            :size="18"
          /><span>{{ t("mobileVoice") }}</span></button
        >
        <button
          type="button"
          :class="{ active: mobileSection === 'more' }"
          :aria-current="mobileSection === 'more' ? 'page' : undefined"
          @click="selectMobileSection('more')"
        ><Icon
            name="more"
            :size="18"
          /><span>{{ t("mobileMore") }}</span></button
        >
        <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.mobile-nav.after"></div>
      </nav>
      <div class="ws-skin-mount-slot" data-ws-skin-mount="voice.workspace.overlay"></div>
    </div>

    <IdentityImportDialog
      v-if="identityImportOpen"
      v-model="identityImportText"
      :busy="identityImportBusy"
      :reading="identityFileReading"
      :error="identityImportError"
      :t="t"
      @close="closeIdentityImport"
      @submit="importIdentity"
      @file="readIdentityFile"
    />

    <ScreenShareSettingsDialog
      v-if="screenShareSettingsOpen"
      :model="screenShareControls"
      :t="t"
      @close="screenShareSettingsOpen = false"
    />

    <MemberActionsMenu
      :model="memberControls"
      :is-mobile-viewport="isMobileViewport"
      :volumes="volumes"
      :whisper-target-ids="whisperTargetIds"
      :range-style="rangeStyle"
      :t="t"
      @private-chat="openPrivateChat"
      @volume-input="onVolInput"
    />

    <!-- Protected channel password modal -->
    <ChannelPasswordDialog
      v-if="channelPasswordDialog.open"
      v-model="channelPasswordDialog.password"
      :busy="channelPasswordDialog.submitting"
      :error="channelPasswordDialog.error"
      :t="t"
      @cancel="cancelChannelPassword"
      @submit="submitChannelPassword"
    />

    <!-- TeamSpeak server password modal -->
    <ServerPasswordDialog
      v-if="serverPasswordDialog.open"
      v-model="serverPasswordDialog.password"
      :error-code="serverPasswordDialog.errorCode"
      :t="t"
      @cancel="cancelFavoriteServerPassword"
      @submit="submitServerPassword"
    />

    <FavoriteServerDialog
          :open="favoriteServerDialogOpen"
          :busy="favoriteDialogBusy"
          :default-nickname="nickname"
          :t="t"
          @close="favoriteServerDialogOpen = false"
      @submit="submitFavoriteServerDraft"
    />

    <!-- Audio settings modal -->
    <AudioSettingsDialog
      v-if="settingsOpen"
      :model="audioSettingsState"
      :controls="audioControls"
      :microphone-error="voiceState.microphoneError"
      :t="t"
      :localized-message="localizedMessage"
      :range-style="rangeStyle"
      @close="settingsOpen = false"
    />

    <div
      v-if="toast"
      class="toast"
      data-ws-part="app.toast"
      role="status"
      ><Icon
        name="check"
        :size="16"
      />
      {{ toast }}</div
    >
  </div>
  <SkinLoadRecoveryNotice :error="skinLoadError" :language="language" @use-built-in="switchToBuiltInAfterLoadError" />
</template>

<script setup lang="ts">
import { observeMobileViewport } from "../services/mobile-viewport.js";
import { computed, h, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import Icon from "../components/Icon.vue";
import SkinPluginOutlet from "../components/SkinPluginOutlet.js";
import SkinPluginEditor from "../components/SkinPluginEditor.vue";
import SkinRuntimePluginHost from "../components/SkinRuntimePluginHost.js";
import SkinLoadRecoveryNotice from "../components/SkinLoadRecoveryNotice.vue";
import VoiceMemberCards from "../components/web-client/VoiceMemberCards.vue";
import VoicePerformancePanel from "../components/web-client/VoicePerformancePanel.vue";
import ScreenShareSettingsDialog from "../components/web-client/ScreenShareSettingsDialog.vue";
import ScreenSharePlayer from "../components/web-client/ScreenSharePlayer.vue";
import AudioDock from "../components/web-client/AudioDock.vue";
import WhisperControls from "../components/web-client/WhisperControls.vue";
import AudioSettingsDialog from "../components/web-client/AudioSettingsDialog.vue";
import ChannelPasswordDialog from "../components/web-client/ChannelPasswordDialog.vue";
import ServerPasswordDialog from "../components/web-client/ServerPasswordDialog.vue";
import ChannelMemberPanel from "../components/web-client/ChannelMemberPanel.vue";
import MemberActionsMenu from "../components/web-client/MemberActionsMenu.vue";
import JoinForm from "../components/web-client/JoinForm.vue";
import ChatPanel from "../components/web-client/ChatPanel.vue";
import WebClientHeader from "../components/web-client/WebClientHeader.vue";
import IdentityImportDialog from "../components/web-client/IdentityImportDialog.vue";
import FavoriteServerDialog, { type FavoriteServerDraft } from "../components/web-client/FavoriteServerDialog.vue";
import { usePublicSkin } from "../composables/usePublicSkin.js";
import { useWebClientIdentity } from "../composables/useWebClientIdentity.js";
import LanguageSwitcher from "../components/LanguageSwitcher.vue";
import SkinSwitcher, { type SkinOption } from "../components/SkinSwitcher.vue";
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
import { clearLocalData as clearStoredLocalData, isLocalPersistenceAvailable, loadLocalPreferences, loadStoredIdentity, removeStoredIdentity, saveLocalPreferences, saveStoredIdentity, type FavoriteServer } from "../services/local-persistence.js";
import type { QuickServer } from "../services/quick-servers.js";
import type { InstalledSkin, SkinHomeCopy } from "../services/skin-pack.js";
import { isPublicSkinEnabled } from "../services/skin-catalog.js";
import { BUILTIN_DARK_SKIN, BUILTIN_LIGHT_SKIN } from "../services/skin-runtime.js";
import { applyTheme, getStoredTheme, type ThemeMode } from "../services/theme.js";
import { createScreenWakeLockController, getScreenWakeLockApi, type ScreenWakeLockController, type ScreenWakeLockSnapshot } from "../services/screen-wake-lock.js";
import { createMobileAwayController, type MobileAwayController } from "../services/mobile-away.js";
import { createSkinPluginQuickServerProjection } from "../services/skin-plugin-context.js";
import { loadSkinPluginAuthoringDocument } from "../services/skin-plugin-authoring.js";
import type { SkinPluginDocument, SkinPluginWidgetOptions } from "../../../src/shared/skin-plugin.js";
import { combineTeamSpeakTarget, DEFAULT_TEAM_SPEAK_PORT, isValidTeamSpeakPort, splitTeamSpeakTarget } from "../services/teamspeak-target.js";

const {
  state: voiceState,
  sessionEpoch,
  memberConversationKey,
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
  measureVoiceAudioStatus,
} = useVoiceWebSocket();
const performance = useWebClientPerformance(computed(() => voiceState.connected), measureVoiceAudioStatus);
const { panelOpen: performancePanelOpen } = performance;

const query = new URLSearchParams(location.search);
const initialChannel = query.get("channel") ?? "";
const inviteToken = ref(query.get("invite") ?? "");
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
const favoriteServerDialogOpen = ref(false);
const favoriteDialogBusy = ref(false);
const favoriteSwitchPending = ref(false);
const favoriteSwitchFailed = ref(false);
const favoriteSwitchError = ref("");
const channelPasswordDialog = reactive({ open: false, channelId: "", password: "", error: "", submitting: false });
const serverPasswordDialog = reactive({ open: false, password: "", errorCode: "" });
const qqModalOpen = ref(false);
const qqJoinUrl = "http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=yhumUMDD9PmyYFWdXWUb_x7hM5trFQY8&authKey=Pw3HBGT7GwMinTQnuFGfnpf0aRSzXOJKcAiujVP1%2BXMpjheAKrncTRivicBJxpjV&noverify=0&group_code=869500475";
const toast = ref("");
const localPersistenceAvailable = isLocalPersistenceAvailable();
const identityReady = ref(!localPersistenceAvailable);
const mobileSection = ref<"channels" | "chat" | "voice" | "more">("channels");
const isMobileViewport = ref(window.matchMedia("(max-width: 740px)").matches);
let mobileAwayController: MobileAwayController | undefined;
const shouldKeepScreenAwake = computed(() => isMobileViewport.value && (voiceState.connected || voiceState.connecting || voiceState.reconnecting));
const screenWakeLockState = ref<ScreenWakeLockSnapshot>({ supported: false, enabled: false, active: false, requesting: false, unavailable: false });
let screenWakeLockController: ScreenWakeLockController | undefined;
const mobileViewport = reactive({ height: window.innerHeight, top: 0, keyboardOpen: false });
let stopViewportObservation: (() => void) | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const language = ref<Language>(getInitialLanguage());
const activeSkin = shallowRef<InstalledSkin | null>(null);
const skinPluginDocumentRevision = ref(0);
const emptySkinPluginDocument: SkinPluginDocument = { schemaVersion: 3, components: [] };
const skinPluginDocument = computed<SkinPluginDocument>(() => {
  skinPluginDocumentRevision.value;
  const skin = activeSkin.value;
  if (!skin) return emptySkinPluginDocument;
  return loadSkinPluginAuthoringDocument(skin.id, skin.version) ?? skin.pluginData ?? emptySkinPluginDocument;
});
const skinPluginSurfaceActive = ref(false);
const skinRuntimePluginSurfaceActive = ref(false);
watch(activeSkin, () => {
  skinPluginSurfaceActive.value = false;
  skinRuntimePluginSurfaceActive.value = false;
}, { flush: "sync" });
const skinMessageOverrides = computed(() => resolveSkinMessages(activeSkin.value, language.value));
const { t: translate, localizedMessage, localizedAudioNotice, visibleErrorCode } = useWebClientI18n(language);
function t(key: string, variables: Record<string, string | number> = {}) {
  const template = skinMessageOverrides.value[key];
  // WebSpeak's own locale dictionaries are the complete baseline; a skin only
  // replaces non-empty strings it explicitly provides.
  if (template === undefined || !template.trim()) return translate(key, variables);
  return Object.entries(variables).reduce((value, [name, replacement]) => value.replaceAll(`{{${name}}}`, String(replacement)), template);
}
const {
  open: identityImportOpen, text: identityImportText, error: identityImportError,
  busy: identityImportBusy, reading: identityFileReading, exporting: identityExportBusy,
  show: openIdentityImport, close: closeIdentityImport, reset: resetIdentityOperations, restore: restoreIdentity,
  readFile: readIdentityFile, submit: importIdentity, exportIdentity,
} = useWebClientIdentity({ identityMaterial, rememberIdentity, t, showToast });
const {
  quickServers,
  isFavorite,
  loadSavedServers,
  recordCurrentServer,
  selectLocalServer,
  saveFavoriteServer,
  toggleFavorite,
  toggleQuickServerFavorite,
  clearServerHistory,
} = useWebClientServerHistory({ serverHost, serverPort, nickname, channel, rememberIdentity, identityMaterial, t, showToast });
const {
  accessMode,
  initialized,
  mobileMode,
  siteName,
  appVersion,
  visitorNumber,
  visitorTotal,
  accelerationRelays,
  openTargetPrefillBlocked,
  serverConfigLoading,
  localizedWelcomeText,
  loadPublicConfig,
} = useWebClientPublicConfig({ serverHost, serverPort, accelerationRelayId, language, t });
const themeMode = ref<ThemeMode>(getStoredTheme());
applyTheme(themeMode.value);
const publicSkin = usePublicSkin({ activeSkin, themeMode, appVersion: () => appVersion.value });
const { activeSkinId, skinReady, skinLoadError, installedSkins, catalogSkins,
  select: onSkinChange, initialize: initializeSkin, switchToBuiltIn, switchToBuiltInAfterLoadError } = publicSkin;
const skinOptions = computed<SkinOption[]>(() => [
  ...catalogSkins.value.map((skin) => ({
    value: skin.id,
    label: skin.id === BUILTIN_LIGHT_SKIN ? t("skinDay") : skin.id === BUILTIN_DARK_SKIN ? t("skinNight") : skin.id === "community.illusia-voice" ? t("skinIllusia") : skin.name,
    icon: skin.id === BUILTIN_LIGHT_SKIN ? "sun" : skin.id === BUILTIN_DARK_SKIN ? "moon" : "compass",
  })),
  ...installedSkins.value.filter((skin) => !catalogSkins.value.some((item) => item.id === skin.id) && isPublicSkinEnabled(skin.id)).map((skin) => ({ value: skin.id, label: skin.name, icon: "compass" })),
]);
const skinHomeCopy = computed<SkinHomeCopy>(() => resolveSkinHomeCopy(activeSkin.value, language.value));
const skinHomeFeatures = computed(() => {
  const defaults = [
    { id: "quality", title: t("highQuality"), description: t("opusAudio"), icon: "waveform", tone: "" },
    { id: "secure", title: t("secureJoin"), description: t("inviteProtected"), icon: "shield", tone: "mint" },
    { id: "realtime", title: t("realtime"), description: t("membersSync"), icon: "users", tone: "sand" },
  ];
  const features = [...defaults];
  const custom = skinHomeCopy.value.features ?? [];
  const icons = ["waveform", "shield", "users"];
  const tones = ["", "mint", "sand"];
  custom.forEach((feature, index) => {
    const base = defaults[index];
    const replacement = {
      id: base?.id ?? `custom-${index}`,
      title: feature.title.trim() || base?.title || "",
      description: feature.description.trim() || base?.description || "",
      icon: base?.icon ?? icons[index % icons.length],
      tone: base?.tone ?? tones[index % tones.length],
    };
    if (base) features[index] = replacement;
    else if (replacement.title && replacement.description) features.push(replacement);
  });
  return features;
});
const audioControls = useWebClientAudioControls({
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
function enableScreenWakeLockForSession(): void {
  if (isMobileViewport.value) screenWakeLockController?.enable();
}
function reconnectMobile(): void {
  enableScreenWakeLockForSession();
  reconnectNow();
}
const { toggleMicrophone, stopWhisperTalk } = audioControls;
const audioDockState = { microphoneMuted, inputVolume, outputVolume, outputMuted, noiseSuppressionEnabled, accompanimentActive };
const audioSettingsState = {
  inputDevices,
  outputDevices,
  selectedInputDeviceId,
  selectedOutputDeviceId,
  outputDeviceSupported,
  audioPermission,
  audioContextState,
  microphoneMuted,
  noiseSuppressionEnabled,
  inputVolume,
  outputVolume,
  voxThreshold,
  notificationVolume,
  micLevel,
  microphoneTestActive,
  testAudioUrl,
};


function initialServerTarget() {
  const explicit = query.get("server") ?? query.get("target");
  if (explicit?.trim()) return splitTeamSpeakTarget(explicit);
  const host = (query.get("tsHost") ?? location.hostname).trim();
  const port = (query.get("tsPort") ?? DEFAULT_TEAM_SPEAK_PORT).trim();
  const target = splitTeamSpeakTarget(host, port || DEFAULT_TEAM_SPEAK_PORT);
  if (query.has("tsPort")) target.port = port;
  return target;
}

function persistLanguage() {
  localStorage.setItem("webspeak:language", language.value);
  void saveLocalPreferences({ schemaVersion: 1, language: language.value });
}

const screenShareControls = useWebClientScreenShare({
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
const { settingsOpen: screenShareSettingsOpen, errorText: screenShareErrorText } = screenShareControls;
const memberSharingState = { screenShareActive, screenShareStarting, screenShareViewingStreamId, settingsOpen: screenShareSettingsOpen };
const {
  channelTree,
  currentChannel,
  currentChannelName,
  currentChannelDescription,
  currentMembers,
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
const memberControls = useWebClientMembers({
  channels: memberChannels,
  currentChannel,
  members,
  speakingIds,
  whisperTargetIds,
  moveClient,
  setWhisperTargets,
  sendPoke,
  setAway,
  onManualStatusChange: () => mobileAwayController?.preserveManualStatus(),
  stopWhisperTalk,
  localizedMessage,
  showToast,
  t,
});
const { away, memberMenu, clearWhisperTargets, isSpeaking, openMemberActions, setAutomaticAway } = memberControls;
const chat = useWebClientChat({
  messages: chatMessages,
  members,
  currentChannel,
  currentChannelName,
  selectedChannelId,
  clientId: computed(() => voiceState.tsClientId),
  connected: computed(() => voiceState.connected),
  sessionEpoch,
  serverKey: computed(() => combineTeamSpeakTarget(serverHost.value, serverPort.value)),
  isMobileViewport,
  mobileSection,
  closeMemberMenu: () => { memberMenu.value = null; },
  sendTextMessage,
  sendServerMessage,
  sendPrivateMessage,
  notifyPrivateMessage: () => playNotification("private"),
  t,
});
watch(() => mobileViewport.height, () => chat.scrollIfFollowing(), { flush: "post" });
const { tab: chatTab, openPrivateChat } = chat;
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
  errorMessage: computed(() => localizedMessage(voiceState.error)),
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
  beforeConnect: enableScreenWakeLockForSession,
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

const showVoiceShell = computed(() => Boolean(
  voiceState.connected || voiceState.reconnecting || voiceState.reconnectFailed
  || favoriteSwitchPending.value || favoriteSwitchFailed.value,
));
const favoriteSwitchLabel = computed(() => quickServers.value.find((server) =>
  server.id === currentServerTarget().toLocaleLowerCase(),
)?.label ?? currentServerTarget());

function isQuickServerTarget(server: QuickServer): boolean {
  return server.id === currentServerTarget().toLocaleLowerCase();
}

function connectQuickServer(server: QuickServer): void {
  if (accessMode.value !== "open" || voiceState.connecting || (voiceState.connected && isQuickServerTarget(server))) return;
  const target = splitTeamSpeakTarget(server.address);
  serverHost.value = target.address;
  serverPort.value = target.port || DEFAULT_TEAM_SPEAK_PORT;
  nickname.value = server.nickname?.trim() || nickname.value.trim();
  channel.value = server.lastChannelHint?.name ?? "";
  serverPassword.value = "";
  accelerationRelayId.value = "";
  inviteToken.value = "";
  selectedChannelId.value = "";
  serverPasswordDialog.open = false;
  serverPasswordDialog.password = "";
  serverPasswordDialog.errorCode = "";
  favoriteServerDialogOpen.value = false;
  beginFavoriteConnection();
}

function beginFavoriteConnection(): void {
  favoriteSwitchPending.value = true;
  favoriteSwitchFailed.value = false;
  favoriteSwitchError.value = "";
  doConnect();
  if (!voiceState.connecting && !voiceState.connected) failFavoriteConnection(t("quickConnectFailed"));
}

function failFavoriteConnection(message: string): void {
  favoriteSwitchPending.value = false;
  favoriteSwitchFailed.value = true;
  favoriteSwitchError.value = message;
}

function cancelFavoriteServerPassword(): void {
  cancelServerPassword();
  if (favoriteSwitchPending.value) failFavoriteConnection(t("quickConnectFailed"));
}

function leaveVoiceWorkspace(): void {
  favoriteSwitchPending.value = false;
  favoriteSwitchFailed.value = false;
  favoriteSwitchError.value = "";
  doDisconnect();
}

function toggleQuickFavorite(server: QuickServer): void {
  void toggleQuickServerFavorite(server);
}

async function submitFavoriteServerDraft(draft: FavoriteServerDraft): Promise<void> {
  if (favoriteDialogBusy.value || voiceState.connecting || accessMode.value !== "open") return;
  const port = draft.port || DEFAULT_TEAM_SPEAK_PORT;
  if (!draft.address || !draft.nickname || !isValidTeamSpeakPort(port)) {
    showToast(t("quickConnectFailed"));
    return;
  }

  const parsed = splitTeamSpeakTarget(draft.address, port);
  serverHost.value = parsed.address;
  serverPort.value = parsed.port || DEFAULT_TEAM_SPEAK_PORT;
  nickname.value = draft.nickname;
  channel.value = draft.channel;
  serverPassword.value = "";
  accelerationRelayId.value = "";
  inviteToken.value = "";
  selectedChannelId.value = "";
  serverPasswordDialog.open = false;
  serverPasswordDialog.password = "";
  serverPasswordDialog.errorCode = "";

  favoriteDialogBusy.value = true;
  try {
    const target = currentServerTarget();
    await saveFavoriteServer(target, draft.label || target, nickname.value, channel.value);
    favoriteServerDialogOpen.value = false;
    beginFavoriteConnection();
  } finally {
    favoriteDialogBusy.value = false;
  }
}

const visiblePokes = computed(() => pokeNotifications.slice(-3));

const skinPluginQuickServers = createSkinPluginQuickServerProjection();
const skinPluginQuickList = computed(() => skinPluginQuickServers.project(quickServers.value, isQuickServerTarget));
const skinPluginFavorites = computed(() => skinPluginQuickList.value
  .filter((server) => server.favorite)
  .map(({ favorite: _favorite, ...server }) => server));
const skinPluginMembers = computed(() => memberChannels.value.flatMap((item) => item.members.map((member) => ({
  id: String(member.id),
  name: member.nickname,
  avatarInitial: Array.from(member.nickname.trim())[0] ?? "?",
  channelId: item.id,
  status: member.away ? "away" : member.inputMuted ? "muted" : speakingIds.has(member.id) ? "speaking" : "online",
  speaking: speakingIds.has(member.id),
  self: member.id === voiceState.tsClientId,
}))));

const skinPluginContext = computed(() => ({
  session: {
    status: {
      connected: voiceState.connected,
      connecting: voiceState.connecting,
      channelId: currentChannel.value?.id ?? "",
      channelName: currentChannelName.value,
      userName: nickname.value,
    },
    channels: channelTree.value.map((item) => {
      const members = skinPluginMembers.value.filter((member) => member.channelId === item.id);
      return {
        id: item.id,
        name: item.name,
        parentId: item.parentID,
        depth: item.depth,
        memberCount: item.members.length,
        memberCountLabel: String(item.members.length).padStart(2, "0"),
        ...(typeof item.maxClients === "number" && typeof item.maxClientsLimited === "boolean"
          ? { maxClients: item.maxClients, maxClientsLimited: item.maxClientsLimited }
          : {}),
        current: item.id === currentChannel.value?.id,
        members,
      };
    }),
    members: skinPluginMembers.value,
  },
  favorites: { items: skinPluginFavorites.value },
  servers: { quickList: skinPluginQuickList.value },
  chat: {
    messages: chat.visibleMessages.value.filter((message) => message.scope === "channel").map((message) => ({
      id: message.id,
      author: message.invokerName,
      text: message.message,
      time: new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      kind: message.isSelf ? "self" : "message",
      channelId: message.targetId ?? currentChannel.value?.id ?? "",
    })),
  },
  audio: {
    status: {
      microphoneMuted: microphoneMuted.value,
      outputMuted: outputMuted.value,
    },
  },
  whisper: {
    status: {
      active: whisperActive.value,
      targetCount: whisperTargetIds.size,
    },
  },
  screenShare: {
    status: {
      active: screenShareActive.value,
      starting: screenShareStarting.value,
      viewing: screenShareViewing.value,
    },
    streams: screenShareStreams.map((stream) => ({
      streamId: stream.streamId,
      source: stream.source,
      ownerClientId: stream.ownerClientId ?? 0,
      ownerNickname: stream.ownerNickname,
      name: stream.name,
      audio: stream.audio,
      viewerCount: stream.viewerCount,
    })),
  },
}));

const readSkinRuntimeSessionStatus = (_signal: AbortSignal) => ({
  connected: voiceState.connected,
  channelName: voiceState.connected ? currentChannelName.value : null,
  memberCount: skinPluginMembers.value.length,
});

const skinPluginActions = {
  "voice.joinChannel": (args: Record<string, string | number | boolean>) => {
    if (!voiceState.connected || typeof args.channelId !== "string") return;
    const target = channelTree.value.find((item) => item.id === args.channelId);
    if (target && target.id !== currentChannel.value?.id) selectChannel(target);
  },
  "favorites.switch": (args: Record<string, string | number | boolean>) => {
    if (accessMode.value !== "open" || typeof args.favoriteId !== "string") return;
    const target = skinPluginQuickServers.resolve(args.favoriteId);
    if (target?.isFavorite && quickServers.value.some((server) => server.id === target.id && server.isFavorite)) connectQuickServer(target);
  },
  "quickServers.switch": (args: Record<string, string | number | boolean>) => {
    if (accessMode.value !== "open" || typeof args.quickServerId !== "string") return;
    const target = skinPluginQuickServers.resolve(args.quickServerId);
    if (target && quickServers.value.some((server) => server.id === target.id)) connectQuickServer(target);
  },
  "chat.sendMessage": (args: Record<string, string | number | boolean>) => {
    if (!voiceState.connected || typeof args.text !== "string" || !currentChannel.value?.id) return;
    const text = args.text.trim();
    if (!text || text.length > 1000 || text.includes("\u0000")) return;
    void sendTextMessage(text, currentChannel.value.id);
  },
  "voice.toggleMicrophone": () => { if (voiceState.connected) toggleMicrophone(); },
  "voice.toggleOutputMute": () => { if (voiceState.connected) toggleOutputMute(); },
  "voice.setOutputVolume": (args: Record<string, string | number | boolean>) => {
    if (!voiceState.connected) return;
    const volume = typeof args.volume === "number" ? args.volume
      : typeof args.volume === "string" && args.volume.trim() ? Number(args.volume) : Number.NaN;
    if (!Number.isFinite(volume)) return;
    setOutputVolume(Math.max(0, Math.min(1, volume)));
  },
  "voice.disconnect": () => { if (voiceState.connected || voiceState.connecting) doDisconnect(); },
  "voice.setAway": (args: Record<string, string | number | boolean>) => {
    if (!voiceState.connected || typeof args.away !== "boolean") return;
    const message = typeof args.message === "string" ? args.message.slice(0, 200) : "";
    setAway(args.away, message);
  },
  "voice.setWhisperActive": (args: Record<string, string | number | boolean>) => {
    if (!voiceState.connected || typeof args.active !== "boolean") return;
    setWhisperActive(args.active);
  },
  "voice.startScreenShare": () => {
    if (voiceState.connected && !screenShareActive.value && !screenShareStarting.value) void startScreenShare();
  },
  "voice.stopScreenShare": () => { if (screenShareActive.value) stopScreenShare(); },
  "voice.joinScreenShare": (args: Record<string, string | number | boolean>) => {
    if (!voiceState.connected || typeof args.streamId !== "string") return;
    if (screenShareStreams.some((stream) => stream.streamId === args.streamId)) joinScreenShare(args.streamId);
  },
  "voice.leaveScreenShare": () => { if (screenShareViewing.value) leaveScreenShare(); },
};

const skinPluginWidgets = {
  "voice.screen-share-start": () => h("button", {
    type: "button",
    class: "skin-runtime-screen-share-start",
    disabled: !voiceState.connected || screenShareActive.value || screenShareStarting.value,
    "aria-label": t("startScreenShare"),
    onClick: () => {
      if (voiceState.connected && !screenShareActive.value && !screenShareStarting.value) void startScreenShare();
    },
  }, [h(Icon, { name: "share", size: 16 }), h("span", null, t("startScreenShare"))]),
  "home.connection-form": () => h(JoinForm, {
    autofocusNickname: !isMobileViewport.value,
    serverHost: serverHost.value,
    "onUpdate:serverHost": (value: string) => { serverHost.value = value; },
    serverPort: serverPort.value,
    "onUpdate:serverPort": (value: string) => { serverPort.value = value; },
    serverPassword: serverPassword.value,
    "onUpdate:serverPassword": (value: string) => { serverPassword.value = value; },
    nickname: nickname.value,
    "onUpdate:nickname": (value: string) => { nickname.value = value; },
    channel: channel.value,
    "onUpdate:channel": (value: string) => { channel.value = value; },
    rememberIdentity: rememberIdentity.value,
    "onUpdate:rememberIdentity": (value: boolean) => { rememberIdentity.value = value; },
    accelerationRelayId: accelerationRelayId.value,
    "onUpdate:accelerationRelayId": (value: string) => { accelerationRelayId.value = value; },
    accessMode: accessMode.value,
    openTargetPrefillBlocked: openTargetPrefillBlocked.value,
    accelerationRelays: accelerationRelays.value,
    quickServers: quickServers.value,
    isFavorite: isFavorite.value,
    identityExportBusy: identityExportBusy.value,
    hasIdentity: Boolean(identityMaterial.value),
    connecting: voiceState.connecting,
    joinDisabled: !canJoin.value || serverConfigLoading.value || !identityReady.value || voiceState.connecting,
    t,
    onConnect: doConnect,
    onDisconnect: doDisconnect,
    onSelectServer: selectLocalServer,
    onToggleFavorite: toggleFavorite,
    onToggleQuickFavorite: toggleQuickFavorite,
    onImportIdentity: openIdentityImport,
    onExportIdentity: exportIdentity,
  }),
  "app.skin-switcher": () => h(SkinSwitcher, {
    modelValue: activeSkinId.value,
    "onUpdate:modelValue": (value: string) => { activeSkinId.value = value; },
    class: "skin-switcher",
    menuLabel: t("skinSelector"),
    options: skinOptions.value,
    onChange: onSkinChange,
  }),
  "app.language-switcher": () => h(LanguageSwitcher, {
    modelValue: language.value,
    "onUpdate:modelValue": (value: Language) => { language.value = value; },
    menuLabel: t("languageMenu"),
    onChange: persistLanguage,
  }),
  "voice.channel-panel": () => h(ChannelMemberPanel, {
    query: memberQuery.value,
    "onUpdate:query": (value: string) => { memberQuery.value = value; },
    model: memberControls,
    filteredMemberChannels: filteredMemberChannels.value,
    currentChannelId: currentChannel.value?.id,
    mobileVisible: true,
    isMobileViewport: isMobileViewport.value,
    volumes,
    avatarStyle,
    avatarInitial,
    rangeStyle,
    t,
    onSelectChannel: selectChannel,
    onVolumeInput: onVolInput,
  }),
  "voice.member-cards": (options?: SkinPluginWidgetOptions) => h(VoiceMemberCards, {
    currentMembers: currentMembers.value,
    isMobileViewport: isMobileViewport.value,
    showScreenShare: options?.screenShare !== false,
    sharing: options?.screenShare === false ? undefined : memberSharingState,
    controls: options?.screenShare === false ? undefined : screenShareControls,
    isSpeaking,
    avatarStyle,
    avatarInitial,
    t,
    onMemberActions: openMemberActions,
    onStopShare: stopScreenShare,
  }),
  "voice.chat-panel": () => h(ChatPanel, {
    model: chat,
    t,
    currentChannelName: currentChannelName.value,
    mobileHidden: false,
    serverEvents,
    avatarStyle,
    avatarInitial,
    messageAvatar,
    formatTime,
  }),
  "voice.audio-controls": () => isMobileViewport.value
    ? h("div", { class: "mobile-voice-controls", role: "toolbar", "aria-label": t("desktopAudioControls") }, [
      h("button", {
        type: "button",
        class: ["mobile-voice-toggle", microphoneMuted.value && "muted"],
        "aria-label": t("microphone"),
        "aria-pressed": !microphoneMuted.value,
        onClick: toggleMicrophone,
      }, [h(Icon, { name: microphoneMuted.value ? "mic-off" : "mic", size: 20 }), h("span", null, t("microphone"))]),
      h("button", {
        type: "button",
        class: ["mobile-voice-toggle", outputMuted.value && "muted"],
        "aria-label": t("speaker"),
        "aria-pressed": !outputMuted.value,
        onClick: toggleOutputMute,
      }, [h(Icon, { name: outputMuted.value ? "volume-off" : "volume", size: 20 }), h("span", null, t("speaker"))]),
    ])
    : h(AudioDock, {
      model: audioDockState,
      controls: audioControls,
      t,
      rangeStyle,
      onSettings: () => { settingsOpen.value = true; },
      onOutputMute: toggleOutputMute,
    }),
  "voice.screen-share-player": () => screenShareViewing.value ? h(ScreenSharePlayer, {
    model: screenShareControls,
    screenShareRemoteStream: screenShareRemoteStream.value,
    screenShareRemoteVolume: screenShareRemoteVolume.value,
    screenShareError: screenShareError.value,
    leaveScreenShare,
    avatarInitial,
    t,
  }) : null,
  "voice.whisper-controls": () => whisperTargetIds.size ? h(WhisperControls, {
    targets: whisperTargets.value,
    active: whisperActive.value,
    enabled: !isMobileViewport.value || mobileSection.value === "voice",
    controls: audioControls,
    t,
    onClear: clearWhisperTargets,
  }) : null,
  "voice.performance-panel": (options?: SkinPluginWidgetOptions) => h(VoicePerformancePanel, {
    model: performance,
    screenShareWebRtcStats,
    showScreenShare: options?.screenShare !== false,
    t,
  }),
  "voice.connection-controls": () => h("div", { class: "ws-plugin-connection-controls", role: "toolbar", "aria-label": t("desktopAudioControls") }, [
    h("button", { type: "button", "aria-label": t("copyInvite"), title: t("copyInvite"), onClick: doShare }, [h(Icon, { name: "share", size: 18 })]),
    ...(accessMode.value === "open" ? [h("button", {
      type: "button",
      "aria-label": t(isFavorite.value ? "removeFavorite" : "saveFavorite"),
      "aria-pressed": isFavorite.value,
      title: t(isFavorite.value ? "removeFavorite" : "saveFavorite"),
      onClick: toggleFavorite,
    }, [h(Icon, { name: "star", size: 18 })])] : []),
    h("button", { type: "button", "aria-label": t("exit"), title: t("exit"), onClick: leaveVoiceWorkspace }, [h(Icon, { name: "door", size: 18 }), h("span", null, t("exit"))]),
  ]),
  "voice.disconnect-control": () => h("button", {
    type: "button",
    class: "ws-plugin-disconnect-control",
    "aria-label": t("exit"),
    onClick: leaveVoiceWorkspace,
  }, [h(Icon, { name: "door", size: 18 }), h("span", null, t("exit"))]),
};

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
  favoriteSwitchPending.value = false;
  favoriteSwitchFailed.value = false;
  favoriteSwitchError.value = "";
  playNotification("connected");
  recordCurrentServer();
});
watch(() => voiceState.errorCode, (code) => {
  if (!favoriteSwitchPending.value || !code || code === "SERVER_PASSWORD_REQUIRED" || code === "INVALID_SERVER_PASSWORD") return;
  failFavoriteConnection(localizedMessage(voiceState.error) || t("quickConnectFailed"));
});
watch(() => showVoiceShell.value, (roomVisible) => {
  if (roomVisible) resetIdentityOperations();
}, { flush: "sync" });

watch(() => voiceState.reconnecting, (reconnecting, wasReconnecting) => {
  if (reconnecting && !wasReconnecting) {
    playNotification("disconnected");
  }
});
watch(() => voiceState.reconnectFailed, (failed, wasFailed) => {
  if (failed && !wasFailed) playNotification("reconnectFailed");
});
watch(shouldKeepScreenAwake, (keepAwake) => {
  if (!screenWakeLockController) return;
  if (keepAwake) screenWakeLockController.enable();
  else screenWakeLockController.disable();
});
watch([() => voiceState.connected, isMobileViewport], () => mobileAwayController?.sync());
watch(screenWakeLockState, (state, previous) => {
  if (!state.unavailable || previous.unavailable || !shouldKeepScreenAwake.value) return;
  showToast(t(state.supported ? "screenWakeLockUnavailable" : "screenWakeLockUnsupported"));
});

let deviceChangeHandler: (() => void) | undefined;
let viewportMediaQuery: MediaQueryList | undefined;
let viewportChangeHandler: (() => void) | undefined;

onMounted(() => {
  mobileAwayController = createMobileAwayController(document, window, {
    isMobileClient: () => isMobileViewport.value,
    isConnected: () => voiceState.connected,
    isAway: () => away.value,
    setAway: setAutomaticAway,
  });
  mobileAwayController.sync();
  screenWakeLockController = createScreenWakeLockController(getScreenWakeLockApi(), document, state => { screenWakeLockState.value = state; });
  if (shouldKeepScreenAwake.value) screenWakeLockController.enable();
  stopViewportObservation = observeMobileViewport(window, value => Object.assign(mobileViewport, value));
  // The selected skin is applied to this public root, never to the admin DOM.
  applyTheme(themeMode.value);
  browserError.value = checkSupport() ?? "";
  void loadPublicConfig();
  void initializeSkin();
  void loadLocalPreferences().then((preferences) => {
    if (!localStorage.getItem("webspeak:language") && (preferences.language === "zh" || preferences.language === "en" || preferences.language === "de" || preferences.language === "ru" || preferences.language === "ja")) language.value = preferences.language;
  });
  void restoreIdentity(async () => {
    const stored = await loadStoredIdentity();
    return stored && localStorage.getItem("webspeak:remember-identity") === "1" ? stored.privateMaterial : null;
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
  mobileAwayController?.dispose();
  screenWakeLockController?.dispose();
  stopViewportObservation?.();
  disconnect();
  if (deviceChangeHandler) navigator.mediaDevices?.removeEventListener("devicechange", deviceChangeHandler);
  if (viewportMediaQuery && viewportChangeHandler) viewportMediaQuery.removeEventListener?.("change", viewportChangeHandler);
  if (toastTimer) clearTimeout(toastTimer);
});

function selectMobileSection(section: typeof mobileSection.value): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  memberMenu.value = null;
  mobileSection.value = section;
}

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
  resetIdentityOperations();
  publicSkin.cancel();
  await clearStoredLocalData();
  for (const key of ["webspeak:nickname", "webspeak:language", "webspeak:theme", "webspeak:active-skin", "webspeak:skin-choice", "webspeak:input-device", "webspeak:output-device", "webspeak:remember-identity"]) localStorage.removeItem(key);
  await publicSkin.reset();
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
  return {
    "--ws-range-progress": `${percent}%`,
    background: `linear-gradient(to right, #006a64 0%, #006a64 ${percent}%, #e7eceb ${percent}%, #e7eceb 100%)`,
  };
}

function onVolInput(clientId: number, event: Event) {
  setVolume(clientId, Number((event.target as HTMLInputElement).value) / 100);
}

function resolveSkinHomeCopy(skin: InstalledSkin | null, locale: Language): SkinHomeCopy {
  const content = skin?.contentData;
  if (!content) return {};
  const fullLocale = locale === "zh" ? "zh-CN" : locale === "en" ? "en-US" : locale === "de" ? "de-DE" : locale === "ru" ? "ru-RU" : "ja-JP";
  const candidates = [...new Set([content.defaultLocale, locale, fullLocale])];
  const result: SkinHomeCopy = {};
  for (const candidate of candidates) Object.assign(result, content.locales[candidate]?.home ?? {});
  return result;
}

function resolveSkinMessages(skin: InstalledSkin | null, locale: Language): Record<string, string> {
  const content = skin?.contentData;
  if (!content) return {};
  const fullLocale = locale === "zh" ? "zh-CN" : locale === "en" ? "en-US" : locale === "de" ? "de-DE" : locale === "ru" ? "ru-RU" : "ja-JP";
  const candidates = [...new Set([content.defaultLocale, locale, fullLocale])];
  const result: Record<string, string> = {};
  for (const candidate of candidates) Object.assign(result, content.locales[candidate]?.messages ?? {});
  return result;
}
</script>

<style scoped src="../styles/web-client.css"></style>

<style scoped src="../styles/web-client-mobile.css"></style>

<style src="../styles/skin-plugin.css"></style>
