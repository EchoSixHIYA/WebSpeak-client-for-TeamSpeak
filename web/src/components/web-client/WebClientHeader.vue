<template>
  <header
    class="join-header"
    data-ws-part="home.header"
  >
    <div
      class="brand-lockup"
      data-ws-part="home.brand"
    >
      <img
        class="brand-mark"
        src="/网站图标.jpg"
        alt="WebSpeak"
      />
      <div>
        <strong :title="brandName">{{ brandName }}</strong>
        <small>{{ t("browserWorkspace") }}</small>
      </div>
    </div>
    <div
      class="header-tools"
      data-ws-part="home.header-tools"
    >
      <div
        class="header-note"
        data-ws-part="home.gateway-status"
        ><span class="tiny-dot"></span> {{ t("secureGateway") }}</div
      >
      <a
        class="github-button"
        href="https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak"
        target="_blank"
        rel="noreferrer"
        :title="t('githubRepository')"
        :aria-label="t('githubRepository')"
      >
        <Icon
          name="github"
          :size="18"
        /><span>{{ t("githubRepository") }}</span>
      </a>
      <button
        type="button"
        class="qq-button"
        :title="t('qqGroup')"
        :aria-label="t('qqGroup')"
        aria-haspopup="dialog"
        @click="emit('openQq')"
      >
        <Icon
          name="qq"
          :size="18"
        /><span class="qq-label">{{ t("qqGroup") }}</span>
      </button>
      <a
        class="bilibili-button"
        href="https://space.bilibili.com/25414873"
        target="_blank"
        rel="noreferrer"
        :title="t('bilibiliProfile')"
        :aria-label="t('bilibiliProfile')"
      >
        <span class="bilibili-glyph">B</span
        ><span class="bilibili-label">{{ t("bilibiliProfile") }}</span>
      </a>
      <span
        class="version-badge"
        :title="`${t('currentVersion')}: v${appVersion}`"
        :aria-label="`${t('currentVersion')}: v${appVersion}`"
        >v{{ appVersion }}</span
      >
      <a
        class="changelog-button"
        :href="changelogUrl"
        target="_blank"
        rel="noreferrer"
        :title="t('viewChangelog')"
        :aria-label="t('viewChangelog')"
      >
        <Icon
          name="clock"
          :size="16"
        /><span>{{ t("viewChangelog") }}</span>
      </a>
      <a
        v-if="!mobile"
        class="guide-button"
        href="/admin"
        :title="t('adminConsole')"
        :aria-label="t('adminConsole')"
      >
        <Icon
          name="settings"
          :size="15"
        /><span>{{ t("adminConsole") }}</span>
      </a>
      <SkinSwitcher
        v-model="skinId"
        class="join-skin-switcher"
        :menu-label="t('skinSelector')"
        :options="skinOptions"
        @change="emit('skinChange', $event)"
      />
      <LanguageSwitcher
        v-model="language"
        class="join-language-switcher"
        :menu-label="t('languageMenu')"
        @change="emit('languageChange')"
      />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Icon from "../Icon.vue";
import SkinSwitcher, { type SkinOption } from "../SkinSwitcher.vue";
import LanguageSwitcher from "../LanguageSwitcher.vue";
import type { Language } from "../../i18n/web-client.js";

const props = defineProps<{
  brandName: string;
  appVersion: string;
  mobile: boolean;
  skinOptions: SkinOption[];
  t: (key: string, variables?: Record<string, string | number>) => string;
}>();
const language = defineModel<Language>("language", { required: true });
const skinId = defineModel<string>("skinId", { required: true });
const changelogFile: Record<Language, string> = {
  zh: "README.zh-CN.md",
  en: "README.en.md",
  de: "README.de.md",
  ru: "README.ru.md",
  ja: "README.ja.md",
};
const changelogUrl = computed(() => {
  return `https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/blob/master/docs/${changelogFile[language.value]}#latest-release-notes`;
});
const emit = defineEmits<{
  openQq: [];
  skinChange: [value: string];
  languageChange: [];
}>();
</script>

<style scoped>
.brand-lockup { min-width: 0; max-width: 100%; }
.brand-lockup > div { min-width: 0; }
.brand-mark { flex: 0 0 auto; }
.brand-lockup strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-note .tiny-dot { display: inline-block; flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: #65d879; box-shadow: 0 0 0 4px rgba(101, 216, 121, .14); }
</style>
