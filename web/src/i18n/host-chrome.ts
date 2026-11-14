import type { SiteLanguage } from "../../../src/site-copy.js";

/** All five public languages implement the same host chrome labels. */
const en = {
  hint: "Audio controls remain available in the toolbar and voice workspace.",
  library: "Application library",
  recovery: "Restore built-in skin",
  useBuiltIn: "Use built-in skin",
  shortcut: "Restore the built-in skin (Ctrl+Alt+Shift+R, or ⌘+⌥+⇧+R on macOS)",
};
export const hostChromeCopy: Record<SiteLanguage, typeof en> = {
  en,
  zh: {
    hint: "音频控制始终保留在工具栏和语音工作区中。",
    library: "应用库",
    recovery: "恢复内置皮肤",
    useBuiltIn: "使用内置皮肤",
    shortcut: "恢复内置皮肤（Ctrl+Alt+Shift+R，macOS 为 ⌘+⌥+⇧+R）",
  },
  de: {
    hint: "Audiosteuerung bleibt in der Werkzeugleiste und im Sprachbereich verfügbar.",
    library: "Anwendungsbibliothek",
    recovery: "Integrierten Skin wiederherstellen",
    useBuiltIn: "Integrierten Skin verwenden",
    shortcut: "Integrierten Skin wiederherstellen (Strg+Alt+Umschalt+R, unter macOS ⌘+⌥+⇧+R)",
  },
  ru: {
    hint: "Управление звуком остаётся доступным на панели инструментов и в голосовой области.",
    library: "Библиотека приложений",
    recovery: "Восстановить встроенную тему",
    useBuiltIn: "Использовать встроенную тему",
    shortcut: "Восстановить встроенную тему (Ctrl+Alt+Shift+R, в macOS ⌘+⌥+⇧+R)",
  },
  ja: {
    hint: "音声コントロールはツールバーと音声ワークスペースで常に利用できます。",
    library: "アプリライブラリ",
    recovery: "組み込みスキンを復元",
    useBuiltIn: "組み込みスキンを使用",
    shortcut: "組み込みスキンを復元（Ctrl+Alt+Shift+R、macOS は ⌘+⌥+⇧+R）",
  },
};
