const zh = {
  skinStore: "皮肤商店", skinInstalledTab: "实例皮肤", skinStoreLead: "从 GitHub 皮肤仓库安装到当前实例，再由管理员启用或设为默认。",
  skinStoreSource: "分发索引", skinStoreRefresh: "刷新商店", skinStoreRepository: "查看仓库", skinStoreInstall: "安装", skinStoreUpdate: "更新",
  skinStoreInstalling: "正在下载并校验…", skinStoreInstalled: "已安装", skinStoreNewer: "本地版本较新", skinStoreEmpty: "商店暂时没有皮肤。",
  skinStoreIncompatible: "需要更高版本的 WebSpeak", skinStoreUnavailable: "无法访问皮肤仓库，请稍后刷新重试；实例已有皮肤不受影响。",
  skinStoreInvalid: "仓库元数据或皮肤包校验失败，未安装此皮肤。", skinStoreChanged: "商店或实例皮肤已发生变化，请刷新后重试。",
  skinStoreConfirm: "要用商店版本替换当前实例中的这个皮肤吗？", skinStoreSuccess: "皮肤已安装，可在“实例皮肤”中管理。",
  skinStorePermissionNote: "安装不会更改默认皮肤，也不会代替访客批准皮肤组件权限。更新保留实例的启停状态。",
  skinStoreCurrentVersion: "实例版本", skinStoreAvailableVersion: "商店版本", skinStoreLoadedAt: "更新于",
} as const;
type Keys = keyof typeof zh;
const en = {
  skinStore: "Skin store", skinInstalledTab: "Instance skins", skinStoreLead: "Install from GitHub skin repositories, then enable a skin or make it the instance default.",
  skinStoreSource: "Distribution index", skinStoreRefresh: "Refresh store", skinStoreRepository: "View repository", skinStoreInstall: "Install", skinStoreUpdate: "Update",
  skinStoreInstalling: "Downloading and validating…", skinStoreInstalled: "Installed", skinStoreNewer: "Local version is newer", skinStoreEmpty: "No skins are available yet.",
  skinStoreIncompatible: "Requires a newer WebSpeak version", skinStoreUnavailable: "The skin repository is unavailable. Refresh to retry; installed skins are unaffected.",
  skinStoreInvalid: "Repository metadata or package validation failed. The skin was not installed.", skinStoreChanged: "The store or installed skin has changed. Refresh before retrying.",
  skinStoreConfirm: "Replace this instance's installed skin with the store version?", skinStoreSuccess: "Skin installed. Manage it under Instance skins.",
  skinStorePermissionNote: "Installing does not change the default skin or approve component permissions for visitors. Updates preserve the instance's enabled state.",
  skinStoreCurrentVersion: "Instance version", skinStoreAvailableVersion: "Store version", skinStoreLoadedAt: "Updated",
} satisfies Record<Keys, string>;
const de = {
  skinStore: "Skin-Store", skinInstalledTab: "Instanz-Skins", skinStoreLead: "Skins aus GitHub-Repositories installieren und anschließend aktivieren oder als Standard festlegen.",
  skinStoreSource: "Verteilungsindex", skinStoreRefresh: "Store aktualisieren", skinStoreRepository: "Repository öffnen", skinStoreInstall: "Installieren", skinStoreUpdate: "Aktualisieren",
  skinStoreInstalling: "Download und Prüfung…", skinStoreInstalled: "Installiert", skinStoreNewer: "Lokale Version ist neuer", skinStoreEmpty: "Noch keine Skins verfügbar.",
  skinStoreIncompatible: "Neuere WebSpeak-Version erforderlich", skinStoreUnavailable: "Skin-Repository nicht erreichbar. Bitte erneut laden; installierte Skins bleiben verfügbar.",
  skinStoreInvalid: "Repository-Metadaten oder Paketprüfung fehlgeschlagen. Der Skin wurde nicht installiert.", skinStoreChanged: "Store oder installierter Skin wurde geändert. Bitte zuerst aktualisieren.",
  skinStoreConfirm: "Den installierten Skin dieser Instanz durch die Store-Version ersetzen?", skinStoreSuccess: "Skin installiert. Verwaltung unter Instanz-Skins.",
  skinStorePermissionNote: "Die Installation ändert weder den Standard-Skin noch die Berechtigungen der Besucher. Updates behalten den Aktivierungszustand bei.",
  skinStoreCurrentVersion: "Instanzversion", skinStoreAvailableVersion: "Store-Version", skinStoreLoadedAt: "Aktualisiert",
} satisfies Record<Keys, string>;
const ru = {
  skinStore: "Магазин тем", skinInstalledTab: "Темы экземпляра", skinStoreLead: "Устанавливайте темы из репозиториев GitHub, включайте их или назначайте темой по умолчанию.",
  skinStoreSource: "Каталог распространения", skinStoreRefresh: "Обновить магазин", skinStoreRepository: "Открыть репозиторий", skinStoreInstall: "Установить", skinStoreUpdate: "Обновить",
  skinStoreInstalling: "Загрузка и проверка…", skinStoreInstalled: "Установлена", skinStoreNewer: "Локальная версия новее", skinStoreEmpty: "В магазине пока нет тем.",
  skinStoreIncompatible: "Нужна более новая версия WebSpeak", skinStoreUnavailable: "Репозиторий темы недоступен. Обновите каталог позже; установленные темы продолжат работать.",
  skinStoreInvalid: "Ошибка проверки метаданных или пакета. Тема не установлена.", skinStoreChanged: "Каталог или установленная тема изменились. Обновите данные и повторите попытку.",
  skinStoreConfirm: "Заменить установленную тему этого экземпляра версией из магазина?", skinStoreSuccess: "Тема установлена. Управление доступно в разделе «Темы экземпляра».",
  skinStorePermissionNote: "Установка не меняет тему по умолчанию и не выдаёт разрешения за посетителей. Обновления сохраняют состояние включения темы.",
  skinStoreCurrentVersion: "Версия экземпляра", skinStoreAvailableVersion: "Версия магазина", skinStoreLoadedAt: "Обновлено",
} satisfies Record<Keys, string>;
const ja = {
  skinStore: "スキンストア", skinInstalledTab: "インスタンスのスキン", skinStoreLead: "GitHub リポジトリからスキンをインストールし、有効化やデフォルト設定を行います。",
  skinStoreSource: "配布インデックス", skinStoreRefresh: "ストアを更新", skinStoreRepository: "リポジトリを開く", skinStoreInstall: "インストール", skinStoreUpdate: "更新",
  skinStoreInstalling: "ダウンロード・検証中…", skinStoreInstalled: "インストール済み", skinStoreNewer: "ローカルのバージョンが新しい", skinStoreEmpty: "公開されているスキンはまだありません。",
  skinStoreIncompatible: "新しい WebSpeak が必要です", skinStoreUnavailable: "リポジトリに接続できません。後で再読み込みしてください。既存のスキンには影響しません。",
  skinStoreInvalid: "メタデータまたはパッケージの検証に失敗しました。スキンはインストールされていません。", skinStoreChanged: "ストアまたは既存のスキンが変更されました。更新して再試行してください。",
  skinStoreConfirm: "このインスタンスの既存のスキンをストア版に置き換えますか？", skinStoreSuccess: "インストールしました。「インスタンスのスキン」で管理できます。",
  skinStorePermissionNote: "デフォルトスキンと訪問者の権限承認は変更しません。更新時も有効・無効の設定を維持します。",
  skinStoreCurrentVersion: "インスタンス版", skinStoreAvailableVersion: "ストア版", skinStoreLoadedAt: "更新日時",
} satisfies Record<Keys, string>;
export const skinStoreCopy = { zh, en, de, ru, ja };
