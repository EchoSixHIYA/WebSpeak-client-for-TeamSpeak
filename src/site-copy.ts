export type SiteLanguage = "zh" | "en" | "de" | "ru" | "ja";

/**
 * Built-in welcome-page templates. An empty administrator value always falls
 * back to one of these strings, so adding a language never leaves the page
 * with a blank welcome message.
 */
export const DEFAULT_WELCOME_TEXTS: Record<SiteLanguage, string> = {
  zh: "无需安装 TeamSpeak 客户端，打开浏览器即可加入语音频道。低延迟、轻量、专注于每一次对话。",
  en: "No TeamSpeak client installation required. Open your browser and join a voice channel with low-latency audio built for conversation.",
  de: "Keine Installation des TeamSpeak-Clients nötig. Öffne den Browser und tritt einem Sprachkanal bei – leichtgewichtig und mit geringer Latenz.",
  ru: "Устанавливать клиент TeamSpeak не нужно: откройте браузер и присоединитесь к голосовому каналу. Низкая задержка и удобное общение в каждом разговоре.",
  ja: "TeamSpeak クライアントのインストールは不要です。ブラウザを開くだけで音声チャンネルに参加できます。低遅延で軽快な会話を楽しめます。",
};

export function resolveWelcomeTexts(values: Partial<Record<SiteLanguage, string>>): Record<SiteLanguage, string> {
  return {
    zh: values.zh?.trim() || DEFAULT_WELCOME_TEXTS.zh,
    en: values.en?.trim() || DEFAULT_WELCOME_TEXTS.en,
    de: values.de?.trim() || DEFAULT_WELCOME_TEXTS.de,
    ru: values.ru?.trim() || DEFAULT_WELCOME_TEXTS.ru,
    ja: values.ja?.trim() || DEFAULT_WELCOME_TEXTS.ja,
  };
}
