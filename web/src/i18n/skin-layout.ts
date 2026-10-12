import type { Language } from "./web-client.js";

type SkinLayoutLabels = {
  editButton: string;
  title: string;
  hint: string;
  component: string;
  filter: string;
  visible: string;
  positionX: string;
  positionY: string;
  size: string;
  width: string;
  height: string;
  order: string;
  orderHint: string;
  foreground: string;
  background: string;
  border: string;
  radius: string;
  resetItem: string;
  resetAll: string;
  export: string;
  import: string;
  close: string;
  editMode: string;
  focusPreview: string;
  focusPreviewEmpty: string;
  focusPreviewUnnamed: string;
  focusPreviewTargetSize: string;
  focusPreviewTargetAdequate: string;
  focusPreviewTargetSmall: string;
  skinLoadError: (skinId: string) => string;
  skinUseBuiltIn: string;
  undo: string;
  redo: string;
  saveFailed: string;
  overlapWarning: string;
  overflowWarning: string;
  ignoreWarnings: string;
  imported: string;
  importFailed: string;
  migrationWarning: (count: number) => string;
  exportRecovery: string;
};

export const skinLayoutLabels: Record<Language, SkinLayoutLabels> = {
  zh: {
    editButton: "布局",
    title: "自定义页面布局",
    hint: "打开编辑模式后，直接拖动页面组件调整位置。布局只保存在此浏览器。",
    component: "当前组件",
    filter: "搜索组件 ID",
    visible: "显示此组件",
    positionX: "水平偏移",
    positionY: "垂直偏移",
    size: "缩放",
    width: "宽度",
    height: "高度",
    order: "排列顺序",
    orderHint: "仅在父容器使用 Flex 或 Grid 时影响同级顺序；键盘焦点顺序保持不变。",
    foreground: "文字颜色",
    background: "背景颜色",
    border: "边框颜色",
    radius: "圆角",
    resetItem: "重置此组件",
    resetAll: "重置当前皮肤布局",
    export: "导出",
    import: "导入",
    close: "关闭",
    editMode: "拖动组件",
    focusPreview: "预览键盘顺序与触屏命中范围",
    focusPreviewEmpty: "当前页面没有可见的键盘焦点控件。",
    focusPreviewUnnamed: "未命名控件",
    focusPreviewTargetSize: "实际区域 {width} × {height} px",
    focusPreviewTargetAdequate: "触控范围符合 44 × 44 px",
    focusPreviewTargetSmall: "触控范围小于 44 × 44 px",
    skinLoadError: (skinId) => `皮肤“${skinId}”加载失败，已返回默认界面。你可以停用此选择并记住内置皮肤。`,
    skinUseBuiltIn: "停用此选择并记住内置皮肤",
    undo: "撤销",
    redo: "重做",
    saveFailed: "浏览器存储不可用，布局更改未保存",
    overlapWarning: "此位置可能与其他组件重叠。",
    overflowWarning: "此组件超出页面布局区域。",
    ignoreWarnings: "忽略当前提示",
    imported: "布局已导入",
    importFailed: "布局文件无效或与当前组件不兼容",
    migrationWarning: (count) => `已升级旧布局；${count} 项无法自动应用，旧数据已保留供恢复。`,
    exportRecovery: "导出旧布局数据",
  },
  en: {
    editButton: "Layout",
    title: "Customize page layout",
    hint: "Enable editing and drag page components to reposition them. Changes stay in this browser.",
    component: "Selected component",
    filter: "Search component ID",
    visible: "Show this component",
    positionX: "Horizontal offset",
    positionY: "Vertical offset",
    size: "Scale",
    width: "Width",
    height: "Height",
    order: "Display order",
    orderHint: "Affects sibling order only inside a flex or grid parent. Keyboard focus order stays unchanged.",
    foreground: "Text color",
    background: "Background",
    border: "Border color",
    radius: "Corner radius",
    resetItem: "Reset component",
    resetAll: "Reset this skin layout",
    export: "Export",
    import: "Import",
    close: "Close",
    editMode: "Move components",
    focusPreview: "Preview keyboard order and touch targets",
    focusPreviewEmpty: "No visible keyboard-focusable controls on this page.",
    focusPreviewUnnamed: "Unnamed control",
    focusPreviewTargetSize: "Actual area {width} × {height} px",
    focusPreviewTargetAdequate: "Touch target meets 44 × 44 px",
    focusPreviewTargetSmall: "Touch target is smaller than 44 × 44 px",
    skinLoadError: (skinId) => `Skin “${skinId}” failed to load and the built-in interface was restored. You can stop selecting it and remember a built-in skin.`,
    skinUseBuiltIn: "Stop selecting this skin and remember a built-in skin",
    undo: "Undo",
    redo: "Redo",
    saveFailed: "Browser storage is unavailable; the layout change was not saved",
    overlapWarning: "This position may overlap another component.",
    overflowWarning: "This component extends beyond the page layout area.",
    ignoreWarnings: "Ignore these hints for this layout",
    imported: "Layout imported",
    importFailed: "The layout file is invalid or incompatible with this client",
    migrationWarning: (count) => `The old layout was upgraded; ${count} item(s) could not be applied and were kept for recovery.`,
    exportRecovery: "Export old layout data",
  },
  de: {
    editButton: "Layout",
    title: "Seitenlayout anpassen",
    hint: "Aktiviere den Bearbeitungsmodus und ziehe Komponenten an ihre neue Position. Änderungen bleiben in diesem Browser.",
    component: "Ausgewählte Komponente",
    filter: "Komponenten-ID suchen",
    visible: "Komponente anzeigen",
    positionX: "Horizontaler Versatz",
    positionY: "Vertikaler Versatz",
    size: "Skalierung",
    width: "Breite",
    height: "Höhe",
    order: "Anzeigereihenfolge",
    orderHint: "Wirkt nur auf Geschwister in einem Flex- oder Grid-Container. Die Tastaturreihenfolge bleibt unverändert.",
    foreground: "Textfarbe",
    background: "Hintergrund",
    border: "Rahmenfarbe",
    radius: "Eckenradius",
    resetItem: "Komponente zurücksetzen",
    resetAll: "Skin-Layout zurücksetzen",
    export: "Exportieren",
    import: "Importieren",
    close: "Schließen",
    editMode: "Komponenten verschieben",
    focusPreview: "Tastaturreihenfolge und Touch-Ziele anzeigen",
    focusPreviewEmpty: "Auf dieser Seite sind keine sichtbaren Tastaturziele.",
    focusPreviewUnnamed: "Unbenanntes Steuerelement",
    focusPreviewTargetSize: "Tatsächliche Fläche {width} × {height} px",
    focusPreviewTargetAdequate: "Touch-Ziel erfüllt 44 × 44 px",
    focusPreviewTargetSmall: "Touch-Ziel kleiner als 44 × 44 px",
    skinLoadError: (skinId) => `Skin „${skinId}“ konnte nicht geladen werden; die integrierte Oberfläche wurde wiederhergestellt. Du kannst diese Auswahl beenden und einen integrierten Skin speichern.`,
    skinUseBuiltIn: "Diesen Skin nicht mehr auswählen",
    undo: "Rückgängig",
    redo: "Wiederholen",
    saveFailed: "Der Browserspeicher ist nicht verfügbar; die Änderung wurde nicht gespeichert",
    overlapWarning: "Diese Position kann eine andere Komponente überdecken.",
    overflowWarning: "Diese Komponente liegt außerhalb des Seitenlayouts.",
    ignoreWarnings: "Diese Hinweise für dieses Layout ausblenden",
    imported: "Layout importiert",
    importFailed: "Die Layoutdatei ist ungültig oder inkompatibel",
    migrationWarning: (count) => `Das alte Layout wurde aktualisiert; ${count} Einträge konnten nicht übernommen werden und bleiben zur Wiederherstellung erhalten.`,
    exportRecovery: "Alte Layoutdaten exportieren",
  },
  ru: {
    editButton: "Макет",
    title: "Настройка макета",
    hint: "Включите режим редактирования и перетаскивайте компоненты. Изменения сохраняются в этом браузере.",
    component: "Выбранный компонент",
    filter: "Поиск ID компонента",
    visible: "Показывать компонент",
    positionX: "Смещение по горизонтали",
    positionY: "Смещение по вертикали",
    size: "Масштаб",
    width: "Ширина",
    height: "Высота",
    order: "Порядок отображения",
    orderHint: "Меняет порядок соседей только внутри flex- или grid-контейнера. Порядок клавиатурного фокуса не меняется.",
    foreground: "Цвет текста",
    background: "Фон",
    border: "Цвет границы",
    radius: "Радиус угла",
    resetItem: "Сбросить компонент",
    resetAll: "Сбросить макет скина",
    export: "Экспорт",
    import: "Импорт",
    close: "Закрыть",
    editMode: "Перемещать компоненты",
    focusPreview: "Показать порядок клавиатуры и сенсорные цели",
    focusPreviewEmpty: "На странице нет видимых элементов клавиатурной навигации.",
    focusPreviewUnnamed: "Элемент без названия",
    focusPreviewTargetSize: "Фактическая область {width} × {height} px",
    focusPreviewTargetAdequate: "Сенсорная цель соответствует 44 × 44 px",
    focusPreviewTargetSmall: "Сенсорная цель меньше 44 × 44 px",
    skinLoadError: (skinId) => `Не удалось загрузить тему «${skinId}»; восстановлен встроенный интерфейс. Можно отказаться от неё и сохранить встроенную тему.`,
    skinUseBuiltIn: "Больше не выбирать эту тему",
    undo: "Отменить",
    redo: "Повторить",
    saveFailed: "Хранилище браузера недоступно; изменение не сохранено",
    overlapWarning: "Компонент может перекрывать другой компонент.",
    overflowWarning: "Компонент выходит за пределы области страницы.",
    ignoreWarnings: "Скрыть эти подсказки для этой раскладки",
    imported: "Макет импортирован",
    importFailed: "Файл макета недействителен или несовместим",
    migrationWarning: (count) => `Старая раскладка обновлена; ${count} элементов не применено, исходные данные сохранены для восстановления.`,
    exportRecovery: "Экспортировать старые данные",
  },
  ja: {
    editButton: "レイアウト",
    title: "ページレイアウトをカスタマイズ",
    hint: "編集を有効にして、コンポーネントをドラッグして配置します。設定はこのブラウザーに保存されます。",
    component: "選択中のコンポーネント",
    filter: "コンポーネント ID を検索",
    visible: "このコンポーネントを表示",
    positionX: "横方向の移動",
    positionY: "縦方向の移動",
    size: "拡大縮小",
    width: "幅",
    height: "高さ",
    order: "表示順序",
    orderHint: "Flex または Grid の親要素内の兄弟要素にのみ適用されます。キーボードのフォーカス順は変わりません。",
    foreground: "文字色",
    background: "背景色",
    border: "枠線の色",
    radius: "角丸",
    resetItem: "コンポーネントをリセット",
    resetAll: "このスキンのレイアウトをリセット",
    export: "エクスポート",
    import: "インポート",
    close: "閉じる",
    editMode: "コンポーネントを移動",
    focusPreview: "キーボード順序とタッチ領域を表示",
    focusPreviewEmpty: "このページに表示中のキーボード操作対象はありません。",
    focusPreviewUnnamed: "名前のないコントロール",
    focusPreviewTargetSize: "実際の領域 {width} × {height} px",
    focusPreviewTargetAdequate: "タッチ領域は 44 × 44 px 以上です",
    focusPreviewTargetSmall: "タッチ領域が 44 × 44 px 未満です",
    skinLoadError: (skinId) => `スキン「${skinId}」を読み込めず、標準の画面に戻しました。このスキンを使わず、標準スキンを保存できます。`,
    skinUseBuiltIn: "このスキンを使わず標準スキンを保存",
    undo: "元に戻す",
    redo: "やり直す",
    saveFailed: "ブラウザーのストレージを利用できないため、変更を保存できませんでした",
    overlapWarning: "この位置では、ほかのコンポーネントと重なる可能性があります。",
    overflowWarning: "コンポーネントがページ領域からはみ出しています。",
    ignoreWarnings: "このレイアウトのヒントを無視",
    imported: "レイアウトをインポートしました",
    importFailed: "レイアウトファイルが無効か、このクライアントと互換性がありません",
    migrationWarning: (count) => `旧レイアウトを更新しました。${count} 件は適用できず、復元用にデータを保存しました。`,
    exportRecovery: "旧レイアウトデータをエクスポート",
  },
};

export function resolveSkinLayoutLanguage(value: string | undefined): Language {
  return value === "en" || value === "de" || value === "ru" || value === "ja" ? value : "zh";
}
