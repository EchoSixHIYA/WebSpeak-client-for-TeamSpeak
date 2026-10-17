import type { Language } from "../i18n/web-client.js";
import type { SkinContent } from "./skin-pack.js";

/** Resolve package-defined localized strings with the package default as fallback. */
export function resolveSkinMessages(content: SkinContent | undefined, locale: Language): Record<string, string> {
  if (!content) return {};
  const fullLocale = locale === "zh" ? "zh-CN" : locale === "en" ? "en-US" : locale === "de" ? "de-DE" : locale === "ru" ? "ru-RU" : "ja-JP";
  const candidates = [...new Set([content.defaultLocale, locale, fullLocale])];
  const messages: Record<string, string> = {};
  for (const candidate of candidates) Object.assign(messages, content.locales[candidate]?.messages ?? {});
  return messages;
}
