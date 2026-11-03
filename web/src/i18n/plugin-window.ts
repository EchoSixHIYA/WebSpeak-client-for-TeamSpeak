import type { SiteLanguage } from '../../../src/site-copy.js';

const en = { minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', search: 'Find a plugin…', resume: 'Return to app', workspace: 'Application library', count: 'available', move: 'Drag to move', noResults: 'No matching plugins' };
export const pluginWindowTranslations: Record<SiteLanguage, typeof en> = {
  en,
  zh: { minimize: '最小化', maximize: '最大化', restore: '还原', search: '搜索插件…', resume: '返回应用', workspace: '应用库', count: '个可用', move: '拖动窗口', noResults: '没有匹配的插件' },
  de: { minimize: 'Minimieren', maximize: 'Maximieren', restore: 'Wiederherstellen', search: 'Plugin suchen…', resume: 'Zur Anwendung', workspace: 'Anwendungen', count: 'verfügbar', move: 'Zum Verschieben ziehen', noResults: 'Keine passenden Plugins' },
  ru: { minimize: 'Свернуть', maximize: 'Развернуть', restore: 'Восстановить', search: 'Найти плагин…', resume: 'Вернуться к приложению', workspace: 'Библиотека приложений', count: 'доступно', move: 'Перетащите окно', noResults: 'Плагины не найдены' },
  ja: { minimize: '最小化', maximize: '最大化', restore: '元に戻す', search: 'プラグインを検索…', resume: 'アプリに戻る', workspace: 'アプリライブラリ', count: '件利用可能', move: 'ドラッグして移動', noResults: '一致するプラグインはありません' },
};
