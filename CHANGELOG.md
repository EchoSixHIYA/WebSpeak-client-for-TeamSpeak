# Changelog

## [0.2.7] — 2026-10-13

### 中文

- **KAAK 皮肤：** 完成独立的宽屏/窄屏语音工作区、频道树与聊天入口，补齐服务器横幅、成员操作、语音控制、邀请链接及密码对话框；统一频道密码状态显示并支持在浏览器本地记住服务器和频道密码。
- **连接与频道：** 支持从昵称目标连接、取消卡住的连接并切换服务器；服务器固定模式会明确提示管理员限制。修复频道树、成员列表和屏幕共享播放器在窄屏及皮肤切换时的布局问题。
- **屏幕共享与皮肤接口：** 新增共享码率选择，按浏览器能力选择编码器并保留 AV1 回退；为皮肤开放生成邀请链接的受权限控制动作。
- **发布架构：** 提供 Windows x64、Linux x64/ARM64、Docker amd64/arm64，以及 Android arm64-v8a、armeabi-v7a、x86_64 构建。
- **管理后台：** 修复将内置 KAAK 皮肤设为实例默认皮肤时失败的问题。

### English

- **KAAK skin:** Added dedicated desktop and narrow-screen voice workspaces, a channel tree and chat entry, server banners, member actions, voice controls, invite links, and consistent password dialogs. Channel password state is shown correctly, and server/channel passwords can be remembered in the browser.
- **Connections and channels:** Added nickname-based server targets, cancellation of stalled joins, and server switching, with clear administrator-restriction feedback in fixed-server mode. Fixed channel tree, member list, and screen-share player layout across narrow screens and skin changes.
- **Screen sharing and skin API:** Added a share bitrate selector, browser-capability-based codec selection with AV1 fallback, and a permission-gated invite-link action for skins.
- **Release architectures:** Windows x64, Linux x64/ARM64, Docker amd64/arm64, and Android arm64-v8a, armeabi-v7a, and x86_64 builds.
- **Admin console:** Fixed selecting the bundled KAAK skin as the instance default.

### Deutsch

- **KAAK-Skin:** Eigenständige Sprachbereiche für Desktop und schmale Bildschirme, Kanalliste und Chat-Einstieg sowie Serverbanner, Mitgliederaktionen, Sprachsteuerung, Einladungslinks und einheitliche Passwortdialoge. Der Passwortstatus von Kanälen wird korrekt angezeigt; Server- und Kanalpasswörter können im Browser gespeichert werden.
- **Verbindungen und Kanäle:** Serverziele über TeamSpeak-Nicknames, Abbruch hängender Verbindungsversuche und Serverwechsel; im festgelegten Servermodus werden Administratoreinschränkungen verständlich angezeigt. Layoutfehler in Kanalliste, Mitgliederbereich und Bildschirmfreigabe auf schmalen Displays und beim Skinwechsel wurden behoben.
- **Bildschirmfreigabe und Skin-API:** Auswahl der Freigabe-Bitrate, Codec-Auswahl nach Browserfähigkeiten mit AV1-Rückfall sowie eine berechtigungsgeschützte Aktion für Einladungslinks.
- **Build-Architekturen:** Windows x64, Linux x64/ARM64, Docker amd64/arm64 und Android arm64-v8a, armeabi-v7a sowie x86_64.
- **Adminbereich:** Die Auswahl des mitgelieferten KAAK-Skins als Instanzstandard wurde repariert.

### Русский

- **Скин KAAK:** Добавлены отдельные голосовые интерфейсы для широких и узких экранов, дерево каналов и переход к чату, баннер сервера, действия с участниками, голосовые элементы управления, ссылки-приглашения и единые диалоги паролей. Состояние защищённых каналов отображается правильно; пароли сервера и каналов можно запомнить в браузере.
- **Подключения и каналы:** Подключение по псевдониму сервера TeamSpeak, отмена зависшего подключения и переключение серверов; в режиме фиксированного сервера показывается понятное сообщение об ограничениях администратора. Исправлена компоновка дерева каналов, списка участников и плеера демонстрации экрана на узких экранах и при смене скина.
- **Демонстрация экрана и API скинов:** Добавлен выбор битрейта, выбор кодека с учётом возможностей браузера и сохранением AV1 как запасного варианта, а также действие создания приглашения с проверкой разрешений.
- **Архитектуры сборок:** Windows x64, Linux x64/ARM64, Docker amd64/arm64 и Android arm64-v8a, armeabi-v7a, x86_64.
- **Панель администратора:** Исправлен выбор встроенного скина KAAK в качестве скина по умолчанию.

### 日本語

- **KAAK スキン：** デスクトップと狭い画面で別々の音声ワークスペースを追加し、チャンネルツリー、チャット入口、サーバーバナー、メンバー操作、音声コントロール、招待リンク、統一されたパスワードダイアログを整えました。保護チャンネルの状態を正しく表示し、サーバーとチャンネルのパスワードをブラウザーに保存できます。
- **接続とチャンネル：** TeamSpeak のニックネーム指定、停止した接続の中断、サーバー切り替えに対応しました。固定サーバーモードでは管理者による制限を明示します。狭い画面やスキン切り替え時のチャンネルツリー、メンバー一覧、画面共有プレーヤーのレイアウトを修正しました。
- **画面共有とスキン API：** 共有ビットレート選択、ブラウザー機能に応じたコーデック選択と AV1 フォールバック、権限で保護された招待リンク生成アクションを追加しました。
- **ビルド対象：** Windows x64、Linux x64/ARM64、Docker amd64/arm64、Android arm64-v8a、armeabi-v7a、x86_64。
- **管理画面：** 同梱の KAAK スキンをインスタンスの既定に設定できない問題を修正しました。

## [0.2.6] — 2026-10-08（相对 0.2.5 正式版）

### 中文

- **工程结构重构：** 将集中在单体语音桥接中的职责拆分为 TeamSpeak 命令处理、会话事件、会话音频、语音协议和屏幕共享协调模块，并提取共享的客户端命令、服务端消息、音频与屏幕共享契约。前端把大型语音页面和管理页面拆成 Vue 组件、composables 与服务模块；管理操作、服务器设置和皮肤管理各自拥有状态与请求生命周期，客户端、管理页和移动端样式也分开维护。重连和页面切换时由所属会话/页面清理事件、媒体资源与未完成操作。
- **语音链路稳定性：** 将 SDK 事件、成员目录、头像下载、麦克风采集、远端播放、性能统计和屏幕共享状态绑定到对应连接或页面生命周期，避免旧连接的迟到事件污染新会话。重构 Opus 连续编码和 WebRTC 参数协商，只协商网关实际支持的音频参数；切换麦克风或伴奏设置时尽可能保留正在工作的采集链路，闭麦时伴奏仍可播放。
- **[#10](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/10)：** 修复 Docker/Compose 中短主机名的 DNS 回退，并让 HTTPS 部署的健康检查使用对应协议。
- **[#9](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/9)：** 支持导入 TeamSpeak 3 身份 INI 或身份字符串、转换并导出兼容身份；本地校验格式及公私钥一致性。
- **[#6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/6) / [#7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/7)：** 静音同步遇到服务端频率限制时有限重试，并阻止切换会话或重连前的旧请求覆盖当前状态；TS6 屏幕共享清理等待服务器确认、附带清理原因，并对频率限制有限重试。
- **[#12](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/12)：** 管理员可配置公网媒体地址、IPv6 候选和语音 STUN，以适配反向代理或 TCP 隧道后的 UDP 媒体路径。STUN 只发现候选地址，不中继媒体；直连仍要求客户端能访问配置的 UDP/IPv6 路径。
- 修复 [PR #13](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/13) 指出的新 WebSpeak 会话漏掉既有 TS6 原生屏幕共享的问题；由重构后的服务器级协调器实现发现与同步。改善移动端语音控制和窄屏布局，并在语音会话期间保持屏幕常亮。
- **发布与验证：** Windows x64、Linux x64/ARM64 发布包；Docker 镜像提供 amd64/arm64；Android 提供 arm64-v8a、armeabi-v7a 和 x86_64 APK，另附 SHA-256 校验文件。Windows ARM64 未发布，因为当前 Opus 原生依赖不支持该构建目标。Android APK 使用 debug 签名；自动化构建通过不等于 Android 真机 TeamSpeak 连接及双向语音已验收。

### English

- **Structural refactor:** Split the former concentrated voice bridge into TeamSpeak command handling, session events, session audio, voice protocol, and screen-share coordination modules, with shared contracts for client commands, server messages, audio, and screen sharing. Decomposed the large voice and admin views into Vue components, composables, and service modules. Admin operations, server settings, and skin management now own their request and state lifecycles; client, admin, and mobile styles are maintained separately. Sessions and pages clean up their own events, media resources, and pending work during reconnects or navigation.
- **Voice-path reliability:** Bound SDK events, member directories, avatar transfers, microphone capture, remote playback, performance statistics, and share state to the owning connection or page so late work from an old session cannot affect a new one. Kept Opus encoder continuity and negotiated only audio parameters supported by the gateway. Microphone or accompaniment changes preserve a working capture path where possible, and accompaniment remains audible while the microphone is muted.
- **[#10](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/10):** Fixed Docker/Compose DNS fallback for short hostnames and made health checks use HTTPS when the deployment is configured for TLS.
- **[#9](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/9):** Added import from TeamSpeak 3 identity INI files or identity strings, conversion and export of compatible identities, and local format/key-pair validation.
- **[#6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/6) / [#7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/7):** Added bounded retries after server flood responses and prevented requests from an old session from overwriting the current mute state. TS6 share cleanup now waits for server confirmation, carries a cleanup reason, and retries flood responses within limits.
- **[#12](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/12):** Added administrator settings for the public media address, IPv6 candidates, and voice STUN for deployments behind reverse proxies or TCP tunnels. STUN discovers candidates; it does not relay media. Direct media still needs a reachable configured UDP/IPv6 path.
- Fixed the missed-existing-TS6-share case reported in [PR #13](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/13) with the refactored per-server coordinator. Refined mobile voice controls and narrow layouts, and kept the screen awake during voice sessions.
- **Packages and validation:** Windows x64 and Linux x64/ARM64 packages; Docker images for amd64/arm64; Android APKs for arm64-v8a, armeabi-v7a, and x86_64, plus SHA-256 checksums. Windows ARM64 is not included because the current native Opus dependency does not support that build target. APKs use debug signing; a successful automated build does not confirm TeamSpeak connectivity or two-way voice on a physical Android device.

### Deutsch

- **Strukturelle Überarbeitung:** Die zuvor konzentrierte Sprachbrücke wurde in TeamSpeak-Befehle, Sitzungsereignisse, Sitzungsaudio, Sprachprotokoll und Bildschirmfreigabe-Koordination aufgeteilt. Gemeinsame Verträge für Client-Befehle, Servernachrichten, Audio und Freigaben wurden extrahiert. Große Sprach- und Admin-Ansichten wurden in Vue-Komponenten, Composables und Dienste zerlegt. Admin-Aktionen, Servereinstellungen und Skin-Verwaltung besitzen getrennte Zustands- und Anfragelebenszyklen; Client-, Admin- und Mobilstile werden separat gepflegt. Sitzungen und Seiten räumen eigene Ereignisse, Medienressourcen und laufende Vorgänge bei Wiederverbindung oder Navigation auf.
- **Stabilität der Sprachverbindung:** SDK-Ereignisse, Mitgliederverzeichnis, Avatarübertragungen, Mikrofonaufnahme, Wiedergabe, Leistungsstatistiken und Freigabestatus sind an die jeweilige Verbindung oder Seite gebunden. Verspätete Ergebnisse älterer Sitzungen wirken dadurch nicht auf eine neue Verbindung. Opus-Kodierkontinuität und Aushandlung wurden verbessert. Mikrofon- oder Begleittonänderungen erhalten möglichst die funktionierende Aufnahme; Begleitton bleibt bei stummgeschaltetem Mikrofon hörbar.
- **[#10](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/10):** DNS-Fallback für kurze Docker-/Compose-Hostnamen behoben; Gesundheitsprüfungen verwenden bei TLS-Konfiguration HTTPS.
- **[#9](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/9):** Import aus TeamSpeak-3-Identitätsdateien im INI-Format oder Identitätszeichenfolgen, Konvertierung und Export kompatibler Identitäten sowie lokale Prüfung von Format und Schlüsselpaar ergänzt.
- **[#6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/6) / [#7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/7):** Begrenzte Wiederholungen nach Server-Flood-Antworten ergänzt und verhindert, dass alte Sitzungsanfragen den aktuellen Stummschaltungsstatus überschreiben. Die TS6-Bereinigung wartet auf Serverbestätigung, übermittelt den Bereinigungsgrund und wiederholt Flood-Antworten begrenzt.
- **[#12](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/12):** Admin-Einstellungen für öffentliche Medienadresse, IPv6-Kandidaten und Sprach-STUN ergänzt. STUN ermittelt Kandidaten, leitet aber keine Medien weiter; direkte Medien benötigen weiterhin einen erreichbaren UDP-/IPv6-Pfad.
- Den in [PR #13](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/13) gemeldeten Fall bereits laufender, nach dem Beitritt nicht entdeckter TS6-Freigaben mit der überarbeiteten serverweiten Koordination behoben. Mobile Sprachsteuerung und schmale Layouts verbessert; der Bildschirm bleibt während Sprachsitzungen aktiv.
- **Pakete und Prüfung:** Windows x64, Linux x64/ARM64 und Docker amd64/arm64; Android-APKs für arm64-v8a, armeabi-v7a und x86_64 mit SHA-256-Datei. Windows ARM64 fehlt, weil die aktuelle native Opus-Abhängigkeit dieses Buildziel nicht unterstützt. APKs sind debug-signiert; ein erfolgreicher CI-Build bestätigt keine TeamSpeak-Verbindung und keinen Zweiwege-Sprachtest auf einem Android-Gerät.

### Русский

- **Перестройка архитектуры:** Монолитный голосовой шлюз разделён на обработку команд TeamSpeak, события сессий, аудио сессии, голосовой протокол и координацию демонстрации экрана; общие контракты клиента и сервера вынесены отдельно. Крупные голосовые и административные страницы разделены на Vue-компоненты, composables и сервисы. Операции администратора, настройки сервера и управление скинами получили собственные циклы состояния и запросов; стили клиента, админ-панели и мобильной версии разделены. Сессии и страницы очищают принадлежащие им события, медиа и незавершённые операции при переподключении или переходе.
- **Устойчивость голосовой связи:** События SDK, каталог участников, передача аватаров, захват микрофона, воспроизведение, статистика и состояние демонстрации привязаны к текущему подключению или странице. Поздние результаты старой сессии не затрагивают новую. Улучшены непрерывность кодирования Opus и согласование параметров; изменение микрофона или фоновой музыки по возможности сохраняет работающий захват, а музыка слышна при выключенном микрофоне.
- **[#10](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/10):** Исправлен DNS-fallback для коротких имён Docker/Compose; HTTPS-проверка состояния использует HTTPS при включённом TLS.
- **[#9](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/9):** Добавлен импорт идентификатора TeamSpeak 3 из INI-файла или строки, преобразование и экспорт совместимой идентичности, локальная проверка формата и пары ключей.
- **[#6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/6) / [#7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/7):** Добавлены ограниченные повторы после ограничения частоты сервером; старый запрос не может перезаписать состояние микрофона после смены сессии. Очистка трансляции TS6 ожидает подтверждения сервера, передаёт причину и ограниченно повторяет запросы после flood-ответа.
- **[#12](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/12):** Добавлены параметры публичного адреса медиа, IPv6-кандидатов и голосового STUN. STUN только обнаруживает адреса и не ретранслирует медиа; для прямой передачи нужен доступный UDP/IPv6-маршрут.
- Исправлен случай пропуска уже запущенной демонстрации TS6, описанный в [PR #13](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/13), с помощью переработанного координатора для каждого сервера. Улучшены мобильное управление голосом и узкие экраны; во время голосовой сессии экран не гаснет.
- **Пакеты и проверка:** Windows x64, Linux x64/ARM64, Docker amd64/arm64, Android APK для arm64-v8a, armeabi-v7a и x86_64, файл SHA-256. Windows ARM64 не включён, так как текущая нативная зависимость Opus не поддерживает эту цель. APK подписаны отладочным ключом; успешная сборка CI не подтверждает подключение TeamSpeak и двусторонний голос на реальном Android-устройстве.

### 日本語

- **構造の大規模リファクタリング：** 集中していた音声ゲートウェイを TeamSpeak コマンド、セッションイベント、セッション音声、音声プロトコル、画面共有コーディネーターに分割し、クライアントコマンド、サーバーメッセージ、音声、画面共有の共通契約を抽出しました。大規模な音声・管理画面を Vue コンポーネント、composable、サービスに分割しました。管理操作、サーバー設定、スキン管理は個別の状態・リクエストライフサイクルを持ち、クライアント、管理画面、モバイルのスタイルも分離しました。再接続や画面遷移時は、各セッション/画面が自身のイベント、メディア、未完了処理を破棄します。
- **音声経路の安定性：** SDK イベント、メンバー一覧、アバター転送、マイク取得、再生、統計、共有状態を接続または画面のライフサイクルに紐付け、古いセッションの遅延処理が新しい接続に影響しないようにしました。Opus の連続エンコードとネゴシエーションを改善し、ゲートウェイが対応する音声パラメーターだけを交渉します。マイクや伴奏の変更時は可能な限り正常な取得経路を維持し、ミュート中も伴奏を再生します。
- **[#10](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/10)：** Docker/Compose の短縮ホスト名に対する DNS フォールバックを修正し、TLS 設定時のヘルスチェックを HTTPS にしました。
- **[#9](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/9)：** TeamSpeak 3 の ID INI または文字列からのインポート、互換 ID の変換・エクスポート、形式と鍵ペアのローカル検証を追加しました。
- **[#6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/6) / [#7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/7)：** サーバーの flood 制限後に回数制限付きで再試行し、古いセッションの要求が現在のミュート状態を上書きしないようにしました。TS6 画面共有の終了処理はサーバー確認を待ち、理由を渡し、制限付きで再試行します。
- **[#12](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/issues/12)：** 公開メディアアドレス、IPv6 候補、音声 STUN の管理設定を追加しました。STUN は候補アドレスを検出するだけでメディアを中継しません。直接通信には到達可能な UDP/IPv6 経路が必要です。
- [PR #13](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/13) が報告した、接続前から開始済みの TS6 画面共有を見落とす問題を、再構成したサーバー単位のコーディネーターで修正しました。モバイル音声操作と狭い画面を改善し、音声セッション中は画面を点灯状態に保ちます。
- **パッケージと検証：** Windows x64、Linux x64/ARM64、Docker amd64/arm64、Android arm64-v8a・armeabi-v7a・x86_64 の APK と SHA-256 ファイルを提供します。現在の Opus ネイティブ依存が対象をサポートしないため Windows ARM64 は含みません。APK はデバッグ署名で、CI 成功は実機 TeamSpeak 接続や双方向音声の確認を意味しません。

## [0.2.5] — 2026-09-27（相对 0.2.4）

### 中文

- 新增 `.wskin` 视觉皮肤系统：用户可在首页、语音工作区和 `/demo` 选择外观；皮肤可更换背景、美术素材与组件视觉，但页面结构、排版空间、控件位置和交互仍由 WebSpeak 固定提供，管理后台不受皮肤影响。
- 管理员可在皮肤库启用/停用自定义皮肤并指定实例默认皮肤；访客手动选择会保留，未手动选择的访客采用实例默认。默认日间、默认夜间和 ILLUSIA 风是受保护内置皮肤，不能删除、停用或替换。
- 将完成度不足的 Aurora Voice 示例移除，以 ILLUSIA 风作为完整皮肤开发样例；细化首页装饰、语音区跨层级立绘、耳机场景、聊天空状态和屏幕播放器表现，并修复深色模式控件可读性、组件溢出和皮肤加载闪烁。
- 新增官方仓库皮肤开发 Agent Skill，配套更新开发规范与多语言功能说明；访客总数在统计暂不可用时也不会低于当前访客序号。
- 缩小 ILLUSIA 语音活动立绘并固定在容器右下角，避免遮挡成员名单和屏幕共享播放器。

### English

- Added the `.wskin` visual skin system. Visitors can choose appearances on the home page, voice workspace, and `/demo`; skins may customize artwork and component visuals while WebSpeak retains page structure, layout, control placement, and behavior. The administration console remains unskinned.
- Administrators can enable/disable custom skins and set an instance default. Deliberate visitor choices are preserved; visitors without an explicit choice receive the instance default. Default Day, Default Night, and ILLUSIA are protected built-ins that cannot be removed, disabled, or replaced.
- Removed the unfinished Aurora Voice sample and made ILLUSIA the complete reference skin. Refined homepage artwork, layered voice-room character art and headphone scene, the empty-chat backdrop, and the screen-share player; fixed dark-mode control contrast, overflow, and skin-load flashes.
- Added the repository's official skin-development Agent Skill and synchronized the guide and localized feature notes. The displayed visitor total also remains at least as high as the current visitor ordinal when the counter is unavailable.
- Reduced and anchored the ILLUSIA voice-activity artwork to the lower-right corner so it no longer obscures member cards or the screen-share player.

### Deutsch

- Das visuelle `.wskin`-System wurde ergänzt. Besucher können das Design auf der Startseite, im Sprachbereich und unter `/demo` wählen. Skins dürfen Grafiken und die visuelle Darstellung anpassen; Seitenstruktur, Layout, Positionen der Bedienelemente und Verhalten bleiben von WebSpeak vorgegeben. Die Administrationskonsole bleibt ungestaltet.
- Administratoren können eigene Skins aktivieren/deaktivieren und ein Standarddesign für die Instanz festlegen. Eine bewusst getroffene Besucherauswahl bleibt erhalten; ohne eigene Auswahl gilt der Instanzstandard. Tagesmodus, Nachtmodus und ILLUSIA sind geschützte integrierte Skins und können weder gelöscht noch deaktiviert oder ersetzt werden.
- Das unfertige Aurora-Voice-Beispiel wurde entfernt; ILLUSIA ist nun das vollständige Referenzdesign. Startseitenkunst, Ebenenillustration und Kopfhörerszene im Sprachbereich, leerer Chat-Hintergrund und Bildschirmfreigabe-Player wurden verfeinert. Außerdem wurden dunkle Bedienelemente, Überläufe und Skin-Ladeblitze korrigiert.
- Der offizielle Skin-Entwicklungs-Agent-Skill des Repositorys wurde ergänzt; Anleitung und lokalisierte Funktionsübersichten wurden aktualisiert. Die Besucher-Gesamtzahl fällt bei nicht verfügbarem Zähler nicht unter die aktuelle Besuchernummer.
- Die ILLUSIA-Illustration bei Sprachaktivität wurde verkleinert und unten rechts verankert, damit sie weder Mitgliederkarten noch den Bildschirmfreigabe-Player verdeckt.

### Русский

- Добавлена визуальная система скинов `.wskin`: посетители могут выбирать оформление на главной странице, в голосовом пространстве и в `/demo`. Скины меняют иллюстрации и внешний вид компонентов, а структуру, компоновку, расположение элементов управления и поведение задаёт WebSpeak. Панель администратора не оформляется скинами.
- Администраторы могут включать и отключать пользовательские скины и задавать оформление по умолчанию для экземпляра. Явный выбор посетителя сохраняется; без него используется настройка экземпляра. Дневная тема, ночная тема и ILLUSIA — защищённые встроенные скины, которые нельзя удалить, отключить или заменить.
- Удалён незавершённый пример Aurora Voice; полной эталонной темой стала ILLUSIA. Улучшены иллюстрации главной страницы, многослойный персонаж и сцена с наушниками в голосовой комнате, фон пустого чата и проигрыватель трансляции экрана. Исправлены контраст элементов в тёмном режиме, переполнение и вспышки при загрузке скина.
- В официальный репозиторий добавлен Agent Skill для разработки скинов, обновлены руководство и локализованные описания функций. При недоступности счётчика общее число посетителей не опускается ниже текущего номера посетителя.
- Иллюстрация ILLUSIA при голосовой активности уменьшена и закреплена внизу справа, чтобы не перекрывать список участников и проигрыватель трансляции экрана.

### 日本語

- `.wskin` ビジュアルスキン機能を追加しました。ホーム、音声ワークスペース、`/demo` で外観を選択できます。背景や素材、コンポーネントの見た目を変更できますが、ページ構造、レイアウト、操作部品の位置と動作は WebSpeak が管理します。管理コンソールには適用されません。
- 管理者はカスタムスキンの有効/無効と、インスタンスのデフォルトスキンを設定できます。訪問者が明示的に選んだスキンは維持され、未選択の場合はインスタンスのデフォルトを使用します。昼、夜、ILLUSIA の3種類は保護された内蔵スキンで、削除・無効化・置換できません。
- 未完成の Aurora Voice サンプルを削除し、ILLUSIA を完成版のリファレンスにしました。ホームのアート、音声画面の重ね合わせ立ち絵とヘッドホン背景、空のチャット背景、画面共有プレーヤーを調整し、ダークモードの視認性、はみ出し、読み込み時のちらつきを修正しました。
- 公式リポジトリにスキン開発 Agent Skill を追加し、ガイドと各言語の機能説明を更新しました。カウンターを取得できない場合も、訪問者総数が現在の訪問者番号を下回らないようにしました。
- 音声アクティビティの ILLUSIA 立ち絵を縮小して右下に固定し、メンバー一覧や画面共有プレーヤーを隠さないようにしました。

## [0.2.4] — 2026-09-22

### 中文

- 新增跨端 P2P 屏幕共享：浏览器用户可以与 TeamSpeak 6 原生客户端互相发现、发起和观看屏幕共享；浏览器之间以及浏览器与原生客户端之间的媒体流优先通过 WebRTC/ICE 直连，WebSpeak 仅负责会话鉴权、共享状态和 SDP/ICE 信令转发，不承载屏幕媒体流量。
- 默认使用 TeamSpeak 官方 STUN 服务发现直连候选，并支持管理员显式配置外部 TURN；即使使用 TURN，媒体也经过外部服务而不是 WebSpeak 网关。
- 新增屏幕共享直播状态、观众人数、播放器音量、全屏和退出控制，并提供发送端/接收端 WebRTC 实时统计。
- 提供浏览器屏幕采集分辨率和帧率设置，最高支持 1080p、60 FPS；设置改为独立弹窗，避免成员卡片被撑高。
- 新增首页访客编号，并优化屏幕共享成员卡片和观看交互。
- 修正输出限制的应用方式：保持所选桌面或窗口的原始采集尺寸，由发送端编码器按设置缩放和限帧；首页同时显示当前访客序号和累计访客数。
- 修复 TeamSpeak 握手期间服务器拒绝错误被误报为连接超时的问题；昵称长度不符合要求时会显示明确的修改提示。

### English

- Added cross-platform P2P screen sharing: browser users can discover, start, and watch screen shares with native TeamSpeak 6 clients. Media between browsers, and between a browser and a native client, prefers a direct WebRTC/ICE path; WebSpeak handles session authorization, share state, and SDP/ICE signaling only and does not carry screen media.
- Added TeamSpeak's public STUN services for direct-candidate discovery by default, with optional administrator-configured external TURN. Even with TURN, media uses the external service rather than the WebSpeak gateway.
- Added live screen-share status, viewer counts, player volume, fullscreen, and exit controls, plus live sender/receiver WebRTC statistics.
- Added browser capture-resolution and frame-rate controls up to 1080p and 60 FPS; moved the controls into a standalone modal so member cards no longer stretch.
- Added homepage visitor numbering and refined screen-share member-card and viewing interactions.
- Fixed output-limit handling so the selected desktop or window keeps its native capture size while the sender encoder applies the requested scale and frame-rate cap; the homepage now also shows the total visitor count.
- Fixed handshake refusals being reported as connection timeouts; invalid nickname lengths now show a clear prompt to change the nickname.

### Deutsch

- Plattformübergreifendes P2P-Bildschirmteilen ergänzt: Browsernutzer können Bildschirmfreigaben mit nativen TeamSpeak-6-Clients erkennen, starten und ansehen. Die Medienübertragung zwischen Browsern sowie zwischen Browser und nativem Client nutzt möglichst direkte WebRTC-/ICE-Verbindungen; WebSpeak übernimmt nur Sitzungsberechtigung, Freigabestatus und SDP-/ICE-Signalisierung und transportiert keine Bildschirmmedien.
- Öffentliche TeamSpeak-STUN-Dienste werden standardmäßig zur Ermittlung direkter Kandidaten verwendet; ein externes TURN kann ausdrücklich durch den Administrator konfiguriert werden. Auch mit TURN läuft die Medienübertragung über den externen Dienst und nicht über das WebSpeak-Gateway.
- Live-Status, Zuschauerzahl, Lautstärke, Vollbild- und Beenden-Steuerung für Bildschirmfreigaben sowie laufende WebRTC-Statistiken für Sender und Empfänger ergänzt.
- Aufnahmeauflösung und Bildrate im Browser bis 1080p und 60 FPS konfigurierbar; die Einstellungen wurden in ein eigenes Modal verschoben, damit Mitgliederkarten nicht mehr in die Höhe wachsen.
- Besucherzählung auf der Startseite ergänzt und die Interaktion von Bildschirmfreigabe-Karten und Player verbessert.
- Die Ausgabelimits werden nun am Sender-Encoder angewendet, während die native Aufnahmegröße des ausgewählten Desktops oder Fensters erhalten bleibt; auf der Startseite wird zusätzlich die Gesamtzahl der Besucher angezeigt.
- Behoben, dass Ablehnungen während des TeamSpeak-Handshakes als Zeitüberschreitung angezeigt wurden; bei ungültiger Nicknamenslänge erscheint nun ein klarer Änderungshinweis.

### Русский

- Добавлена кроссплатформенная P2P-трансляция экрана: пользователи браузера могут обнаруживать, запускать и смотреть трансляции вместе с нативными клиентами TeamSpeak 6. Медиа между браузерами, а также между браузером и нативным клиентом по возможности передаётся напрямую через WebRTC/ICE; WebSpeak отвечает только за авторизацию сессии, состояние трансляции и SDP/ICE-сигналы и не переносит медиаданные экрана.
- По умолчанию добавлено обнаружение прямых кандидатов через публичные STUN-сервисы TeamSpeak; администратор может явно настроить внешний TURN. Даже при использовании TURN медиа идёт через внешний сервис, а не через шлюз WebSpeak.
- Добавлены статус трансляции, число зрителей, громкость проигрывателя, полноэкранный режим и выход, а также текущая статистика WebRTC для отправителя и получателя.
- Добавлены настройки разрешения и частоты кадров захвата в браузере до 1080p и 60 FPS; настройки вынесены в отдельное окно, чтобы карточки участников не растягивались.
- Добавлен номер посетителя на главной странице и улучшено управление карточками и просмотром трансляций.
- Исправлено применение ограничений вывода: выбранный рабочий стол или окно сохраняет исходный размер захвата, а запрошенное масштабирование и ограничение частоты кадров применяются кодировщиком отправителя; на главной странице также показывается общее число посетителей.
- Исправлено ошибочное отображение отказов TeamSpeak во время рукопожатия как тайм-аута; при недопустимой длине имени показывается понятная просьба изменить его.

### 日本語

- クロスプラットフォーム P2P 画面共有を追加しました。ブラウザユーザーは TeamSpeak 6 ネイティブクライアントと互いに画面共有を検出・開始・視聴できます。ブラウザ間、およびブラウザとネイティブクライアント間のメディアは可能な限り WebRTC/ICE で直接送信され、WebSpeak はセッション認証、共有状態、SDP/ICE シグナリングだけを担当し、画面メディアは運びません。
- 初期設定で TeamSpeak 公開 STUN サービスによる直接候補の検出に対応し、管理者が外部 TURN を明示的に設定できるようにしました。TURN 使用時もメディアは外部サービスを経由し、WebSpeak ゲートウェイは経由しません。
- 配信状態、視聴者数、プレーヤー音量、全画面、終了操作と、送信側・受信側の WebRTC 統計を追加しました。
- ブラウザの画面取得設定で最大 1080p / 60 FPS を選択できます。設定を独立したモーダルに移し、メンバーカードが縦に伸びないようにしました。
- ホームページの訪問者番号を追加し、画面共有カードと視聴操作を改善しました。
- 出力制限を送信側エンコーダーで適用するよう修正し、選択したデスクトップやウィンドウの元の取得サイズを維持します。ホームページには訪問者番号に加えて累計訪問者数も表示します。
- TeamSpeak の接続ハンドシェイク中の拒否がタイムアウトとして表示される問題を修正しました。ニックネームの長さが不適切な場合は、変更を促すメッセージを表示します。

## [0.2.3] — 2026-09-19

### 中文

- 新增频道成员调度入口：保留拖放移动，并在右键菜单提供“调度到”二级菜单和“我所在的频道”快捷项。
- 支持按 TeamSpeak 权限直接移动成员；具备权限时无需重复输入频道密码，无权限时不提供该操作。
- 支持成员头像显示、麦克风静音状态同步和保存身份恢复，并增强指针拖动兼容性。
- 更新中文、English、Deutsch、Русский、日本語五种语言的功能截图和文档页面。
- 修复高分辨率桌面端管理员设置页面底部内容被裁切的问题，并收紧中继卡片的宽度约束。

### English

- Added member-management entry points: drag-and-drop remains available, while the context menu now provides a “Move to” submenu with a “My channel” shortcut.
- Added permission-aware direct member moves: authorized users can move clients without redundant channel-password prompts, while the action is unavailable without the required TeamSpeak permission.
- Added client-avatar display, microphone mute-state synchronization, and remembered-identity recovery, with improved pointer-drag compatibility.
- Refreshed feature screenshots and documentation pages for all five supported languages.
- Fixed clipped lower content in the high-resolution desktop admin settings page and tightened relay-card width constraints.

### Deutsch

- Neue Einstiege für die Mitgliederverwaltung: Ziehen und Ablegen bleibt verfügbar, zusätzlich bietet das Kontextmenü ein Untermenü „Verschieben nach“ mit dem Eintrag „Mein Kanal“.
- Direkte, berechtigungsabhängige Mitgliederverschiebung ergänzt: Benutzer mit den erforderlichen TeamSpeak-Rechten benötigen keine erneute Kanalpasswortabfrage; ohne diese Rechte steht die Aktion nicht zur Verfügung.
- Anzeige von Client-Avataren, Synchronisierung des Mikrofon-Stummschaltstatus und Wiederherstellung gespeicherter Identitäten ergänzt; Zeigerbedienung verbessert.
- Funktionsscreenshots und Dokumentationsseiten für alle fünf unterstützten Sprachen aktualisiert.
- Das Abschneiden unterer Inhalte in den Admin-Einstellungen bei hoher Desktop-Auflösung behoben und die Breitenbegrenzung der Relay-Karten verbessert.

### Русский

- Добавлены способы управления участниками: перетаскивание сохранено, а в контекстном меню появился пункт «Переместить в» с быстрым вариантом «Мой канал».
- Добавлено прямое перемещение с учётом прав TeamSpeak: пользователям с нужными правами не нужно повторно вводить пароль канала, а без этих прав действие недоступно.
- Добавлены отображение аватаров клиентов, синхронизация состояния микрофона и восстановление сохранённой идентичности; улучшено перетаскивание указателем.
- Обновлены функциональные скриншоты и страницы документации для всех пяти поддерживаемых языков.
- Исправлено обрезание нижнего содержимого настроек администратора на десктопах с высоким разрешением и ограничена ширина карточек ретрансляторов.

### 日本語

- メンバー操作を追加しました。ドラッグ＆ドロップに加えて、コンテキストメニューに「移動先」サブメニューと「自分のチャンネル」ショートカットを用意しました。
- TeamSpeak 権限に応じた直接移動を追加しました。必要な権限があればチャンネルパスワードを再入力せずに移動でき、権限がなければ操作は表示されません。
- クライアントアバターの表示、マイクミュート状態の同期、保存した ID の復元に対応し、ポインター操作も改善しました。
- 対応する 5 言語すべての機能スクリーンショットとドキュメントページを更新しました。
- 高解像度デスクトップで管理設定の下部が切れる問題を修正し、中継カードの幅制約を改善しました。

## [0.2.2] — 2026-09-17

### 中文

- 提供可开关的浏览器端麦克风降噪功能。
- 优化前端音量交互逻辑：桌面端悬停麦克风和整体音量按钮即可调整，降噪开关收纳在麦克风菜单中。
- 在 PR #2 基础上优化错误提示和错误代码显示。
- 提供俄语和日语界面支持，并支持按语言单独调整欢迎文字。

### English

- Added optional browser-side microphone noise suppression.
- Refined volume interaction: desktop microphone and master-volume controls open on hover, with noise suppression in the microphone menu.
- Improved error messages and error-code display on top of PR #2.
- Added Russian and Japanese UI support and per-language welcome text configuration.

### Deutsch

- Optionale browserseitige Mikrofon-Geräuschunterdrückung hinzugefügt.
- Lautstärkeinteraktion verbessert: Desktop-Mikrofon- und Gesamtlautstärkeregler öffnen sich beim Überfahren; die Geräuschunterdrückung befindet sich im Mikrofonmenü.
- Fehlertexte und Fehlercodes auf Basis von PR #2 verbessert.
- Russische und japanische Oberfläche sowie sprachabhängige Begrüßungstexte ergänzt.

### Русский

- Добавлено опциональное шумоподавление микрофона в браузере.
- Улучшено управление громкостью: на компьютере регуляторы открываются при наведении, а шумоподавление находится в меню микрофона.
- Улучшены сообщения и коды ошибок на основе PR #2.
- Добавлены русский и японский интерфейсы и отдельная настройка приветствия для каждого языка.

### 日本語

- ブラウザ側で任意に使えるマイクノイズ抑制を追加しました。
- 音量操作を改善し、デスクトップではマイクと全体音量のボタンにカーソルを合わせると調整画面を表示し、ノイズ抑制をマイクメニューにまとめました。
- PR #2 を基にエラー表示とエラーコードを改善しました。
- ロシア語・日本語 UI と言語別ウェルカム文の設定を追加しました。

## [0.2.1] — 2026-09-13

### 中文

- 统一首页连接错误显示：保留错误代码，未知错误安全截断，并显示可追溯的服务端原因。
- 默认支持 IPv6 TeamSpeak 目标，并补充主机、运行时和网络条件说明。

### English

- Unified connection-error display on the welcome page: preserve error codes, safely truncate unknown codes, and show traceable server reasons.
- Added default IPv6 TeamSpeak target support and documented the required host, runtime, and network conditions.

### Deutsch

- Verbindungsfehler auf der Willkommensseite vereinheitlicht: Fehlercodes bleiben erhalten, unbekannte Codes werden sicher gekürzt und nachvollziehbare Serverursachen angezeigt.
- IPv6-Ziele für TeamSpeak standardmäßig unterstützt und erforderliche Host-, Laufzeit- und Netzwerkbedingungen dokumentiert.

## [0.2.0] — 2026-09-10

### 中文

- 新增 README“高级功能”章节，补充 WebRTC 与中继服务器的配置和使用步骤。
- 明确 WebRTC 的 UDP 端口、安全组与防火墙要求，以及中继令牌和管理员控制台配置方式。
- 标注中继服务为 WebSpeak 自带实现；同时注明 WebRTC 使用 MIT 许可的 `werift` 依赖，TeamSpeak 连接使用项目维护的 SDK fork。
- 细分 TeamSpeak 连接失败原因，服务器需要密码时提示用户输入密码并重试。
- 优化管理员历史连接日志：能够追溯时显示具体原因，无法追溯时使用通用失败提示，不猜测历史原因。
- 新增正式中继部署模式：中继实例不提供前台和管理员后台，只接受带令牌的网关转发会话。
- 管理员可配置多个中继节点，访客可在欢迎页为当前连接选择直连或指定中继。
- 修复用户正常断开后被管理员运维日志误显示为“请求失败”的问题。

### English

- Added an “Advanced features” section to the README with WebRTC and relay configuration and usage steps.
- Documented WebRTC UDP, security-group, and firewall requirements, plus relay-token and administration-console setup.
- Clarified that the relay is built into WebSpeak, while WebRTC uses the MIT-licensed `werift` dependency and TeamSpeak connectivity uses the project-maintained SDK fork.
- Classified TeamSpeak connection failures and prompt users for a server password with a retry when authentication requires one.
- Improved administrator connection history: show a specific reason when available and use a generic failure message when older records cannot be traced, without guessing.
- Added a formal relay deployment mode: relay instances expose no visitor or admin UI and accept only token-authenticated gateway sessions.
- Administrators can configure multiple relay nodes, and visitors can choose direct access or a specific relay for each connection.
- Fixed normal user disconnects being shown as “request failed” in administrator connection history.

### Deutsch

- Einen Abschnitt „Erweiterte Funktionen“ mit Anleitungen für WebRTC und Relay-Server zur README hinzugefügt.
- UDP-, Sicherheitsgruppen- und Firewall-Anforderungen für WebRTC sowie Relay-Token und Administrationskonfiguration dokumentiert.
- Klargestellt, dass das Relay Bestandteil von WebSpeak ist; WebRTC verwendet die MIT-lizenzierte Abhängigkeit `werift`, die TeamSpeak-Verbindung den projektgepflegten SDK-Fork.
- TeamSpeak-Verbindungsfehler genauer klassifiziert und bei erforderlichem Serverpasswort eine Eingabe mit Wiederholung angeboten.
- Den Verlauf der Administrator-Verbindungen verbessert: verfügbare Ursachen werden angezeigt, ältere nicht nachvollziehbare Einträge erhalten eine allgemeine Fehlermeldung statt einer Vermutung.
- Einen dedizierten Relay-Bereitstellungsmodus ergänzt: Relay-Instanzen stellen keine Besucher- oder Admin-Oberfläche bereit und akzeptieren nur Gateway-Sitzungen mit Token.
- Administratoren können mehrere Relay-Knoten konfigurieren; Besucher wählen pro Verbindung Direktzugriff oder ein bestimmtes Relay.
- Behoben, dass normale Benutzertrennungen im Administrationsverlauf als „Anfrage fehlgeschlagen“ erschienen.

## [0.1.8] — 2026-09-08

### 中文

- Docker 默认使用 host 网络，支持网关访问同机 TeamSpeak 并直接暴露 WebRTC UDP 端口。
- 开放模式统一校验用户提交的目标地址，包括管理员默认目标，修复本机与内网目标绕过限制的问题。
- TeamSpeak SDK 连接握手增加 15 秒超时，失败连接会及时清理。
- 网络性能面板改为持续监测，打开后每 3 秒更新一次延迟与丢包率。

### English

- Docker now uses host networking by default, allowing the gateway to reach a local TeamSpeak server and expose the WebRTC UDP range directly.
- Open access now validates every submitted target, including the administrator default, closing loopback and private-network bypasses.
- Added a 15-second TeamSpeak SDK handshake timeout with prompt cleanup after failed connections.
- The network performance panel now measures continuously and refreshes latency and packet loss every 3 seconds while open.

### Deutsch

- Docker verwendet standardmäßig das Host-Netzwerk, damit das Gateway einen lokalen TeamSpeak-Server erreicht und den WebRTC-UDP-Bereich direkt bereitstellt.
- Der offene Zugriffsmodus prüft nun jedes Ziel einschließlich des Administrator-Standards und schließt Umgehungen für Loopback- und private Netze.
- Für den TeamSpeak-SDK-Handshake gilt jetzt ein Timeout von 15 Sekunden; fehlgeschlagene Verbindungen werden zeitnah bereinigt.
- Das Netzwerkleistungsfeld misst bei geöffneter Ansicht fortlaufend und aktualisiert Latenz und Paketverlust alle 3 Sekunden.

## [0.1.7] — 2026-09-06

### 中文

- 增加 Deutsch 界面支持和 Telegram 群组入口。
- 增加桌面端整体音量滑块，默认收起并在悬停时展开。
- 修复伴奏音量忽大忽小的问题。
- 增加可展开的网络性能面板，显示浏览器、WebSpeak 与 TeamSpeak 之间的延迟和丢包率。
- 管理员连接测试改用服务端多次主机 Ping 并显示丢包率，不再创建临时 TeamSpeak 客户端。
- 统一中文、English、Deutsch 的旗帜代码语言菜单。
- 修复 TeamSpeak 使用 TCP 探测导致的误报丢包，并修正语言菜单异常留白。
- 移除 WebRTC 桥接中的 RMS 静音帧过滤，安静帧仅用于发言状态指示，不再丢弃。
- 修复 Docker 运行环境缺少 ICMP Ping 工具导致管理员测试误报 100% 丢包。

### English

- Added German UI support and a Telegram community link.
- Added a compact desktop master-volume slider that expands on hover.
- Fixed accompaniment volume fluctuations.
- Added an expandable network performance panel with latency and packet loss across the browser, WebSpeak, and TeamSpeak path.
- Updated the administrator connection test to use repeated host pings, report packet loss, and avoid creating temporary TeamSpeak clients.
- Unified the Chinese, English, and German flag/code language menu.
- Fixed false packet-loss reports caused by probing the TeamSpeak UDP service with TCP, and corrected excess space in the language menu.
- Removed RMS-based silence filtering from the WebRTC bridge; quiet frames are now retained for the codec timeline.
- Fixed Docker admin diagnostics falsely reporting 100% packet loss when the runtime lacked the ICMP ping tool.

### Deutsch

- Deutsche Benutzeroberfläche und Telegram-Community-Link hinzugefügt.
- Kompakten Gesamtlautstärkeregler für den Desktop ergänzt, der sich beim Überfahren öffnet.
- Schwankende Lautstärke bei der Begleittonfreigabe behoben.
- Aufklappbares Netzwerkleistungsfeld mit Latenz und Paketverlust zwischen Browser, WebSpeak und TeamSpeak ergänzt.
- Verbindungstest in der Administration auf wiederholte Host-Pings mit Paketverlustanzeige umgestellt, ohne temporäre TeamSpeak-Clients zu erzeugen.
- Einheitliches Sprachmenü mit Flaggen und Sprachcodes für Chinesisch, Englisch und Deutsch ergänzt.
- Falsche Paketverlustmeldungen durch TCP-Prüfung des UDP-Dienstes behoben und übermäßigen Leerraum im Sprachmenü korrigiert.
- RMS-basierte Stillefilterung aus der WebRTC-Brücke entfernt; leise Frames bleiben nun im Codec-Zeitverlauf erhalten.
- Falsche 100-%-Paketverlustmeldungen behoben, wenn dem Docker-Laufzeitimage das ICMP-Ping-Tool fehlte.

## [0.1.6] — 2026-09-04

### 中文

- 新增保持身份并发连接提醒，避免同一浏览器复用身份造成连接卡住。
- 新增桌面端伴奏共享功能。
- 新增网站 favicon，并更新仓库 README 主视觉。

### English

- Added a warning for concurrent remembered-identity connections in the same browser.
- Added desktop accompaniment sharing.
- Added a site favicon and refreshed the repository README branding.

## [0.1.5] — 2026-09-04

### 中文

- 修复并优化主题切换按钮，首次点击即可切换，并使用太阳/月亮图标。
- 修复浏览器身份保存与退出后的保持逻辑。

### English

- Fixed and refined the theme toggle so the first click switches themes, with sun/moon icons.
- Fixed browser identity persistence across exit and return.

All notable changes to WebSpeak are documented here. Versions follow SemVer.

## [0.1.4] — 2026-09-03

### 中文

- 修复 WebRTC 语音收发与发言状态同步。
- 修复频道文字消息在 WebSpeak 客户端之间无法互收。
- 优化管理员页面、运行日志换行和移动端顶部布局。
- 首页新增 Bilibili 入口，管理员登录页新增返回首页。

### English

- Fixed WebRTC voice transport and speaking-state synchronization.
- Fixed channel text messages between WebSpeak clients.
- Refined admin pages, log wrapping, and narrow-screen header layout.
- Added the Bilibili profile link and the admin-login home link.

## [0.1.3] — 2026-09-03

### Added

- Optional WebRTC audio transport for deployments that need lower and more stable realtime voice latency.
- A self-contained WebRTC media service controlled by one administrator switch; the gateway derives the media host from the current WebSpeak address and owns a fixed UDP range.
- Migrated the TeamSpeak integration to the maintained `EchoSixHIYA/teamspeak-js` fork, including live directory snapshots and member/channel synchronization.

### Changed

- WebRTC audio uses negotiated Opus parameters and a bounded newest-frame mixer instead of allowing stale audio to accumulate.
- The browser keeps the WebSocket path available for signaling, control, and compatibility fallback; Docker Compose publishes the built-in `40000–40099/UDP` media range alongside the web port.

### Fixed

- Prevented duplicate playback when WebRTC and the WebSocket audio path overlap during negotiation or fallback.
- Made WebRTC teardown and fallback explicit so a failed negotiation does not leave a server-side media session behind.
- Corrected native Opus decoder usage and cleaned up negotiated payload handling for TeamSpeak-to-browser audio.

### Verification

- After allowing inbound `40000–40099/UDP` on the public WebSpeak host, two browser sessions were tested against the same TeamSpeak target with WebRTC enabled: audio frames flowed in both directions, packet drops remained at `0`, ingress frame gaps peaked at about `27 ms`, and egress gaps peaked at about `81–83 ms`.
- The measured WebRTC path stayed below the previous WebSocket jitter peaks of about `268–376 ms` in the same browser test setup; these figures describe the observed test path, not a universal latency guarantee.

## [0.1.2] — 2026-09-02

### Added

- Current-version badge and a direct changelog link on the welcome page, next to the prominent GitHub repository button.
- Mobile member actions through a three-dot menu, while desktop member actions remain available through the context menu.

### Changed

- Mobile and narrow-screen header controls now collapse longer labels into icons to preserve usable spacing.
- The welcome page and connected workspace now present the GitHub, version, changelog, admin, theme, language, exit, and microphone controls as a consistent responsive control group.
- The version shown on the welcome page is read from the gateway's public configuration so it stays aligned with the running backend.
- Consolidated the post-0.1.1 mobile voice controls, microphone mute replacement for focus-dependent PTT, automatic protocol detection, simplified Docker Compose startup, and live-demo documentation.

### Fixed

- Replaced the visually off-center settings glyph and normalized icon alignment for settings-related controls across the client.
- Fixed narrow-screen exit and microphone controls so their text-collapse rules apply correctly.
- Bounded browser and gateway voice buffering, reset stale browser playback queues, and exposed low-overhead in-memory audio counters for diagnosing jitter without per-frame log writes.
- Moved microphone frame assembly to an `AudioWorklet` with a compatibility fallback to `ScriptProcessorNode`; both paths emit fixed 960-sample frames.

## [0.1.1] — 2026-09-02

### Added

- M009 admin operations dashboard for managed invites, active-session inspection, per-session termination, diagnostics, logs, audit access, diagnostic report download, and SQLite backup export.
- Persistent managed invites with expiry, optional maximum uses, revocation, hashed opaque tokens, and encrypted TeamSpeak credentials at rest.
- Mobile-aware invite joining through the `invite` URL parameter without placing a TeamSpeak password in the URL.
- M010 hardening for per-peer join-ticket rate limiting and bounded rotating runtime logs.
- Bilingual README documentation with parallel Chinese and English feature, deployment, security, and operations sections.

### Changed

- Database schema is now version 2 and migrates existing version 1 installations transactionally with a migration copy.
- Admin overview and diagnostics use the application package version instead of a hard-coded display value.
- The README architecture section now uses GitHub-native Markdown instead of a Mermaid rich-display block.
- The README badge set now uses stable static Shields badges without a repository-metadata 404 dependency.
- Version tags publish Windows/Linux deployment packages to GitHub Releases and publish the matching Docker image.
- Removed the focus-dependent normal browser Space-key PTT mode and replaced it with a one-click microphone mute/unmute control on desktop and mobile.
- Persisted the microphone mute state in browser preferences and suppresses upstream audio before it is sent to TeamSpeak while muted.

### Fixed

- Late WebSpeak browser sessions now reconcile and merge the complete TeamSpeak directory, so members who joined earlier remain visible.
- Private-message delivery no longer disconnects the browser session.
- Member actions are presented through the right-click context menu with hover feedback.
- Docker release builds copy the root `postinstall` patch script before running `npm ci`.
- Release builds skip `npm version` when the project version already matches the requested version, preventing false `Version not changed` failures.

### Verification

- `npm test` — 51 tests passed.
- `npm run build` — backend TypeScript build passed.
- `npm run web:build` — frontend production build passed.
- `npm audit --omit=dev --audit-level=high` — no high or critical vulnerabilities reported.
- Local `/demo` browser checks passed at the documented narrow and desktop widths; `/demo` does not connect to TeamSpeak.

Real TS3/TS6 interoperability, Android microphone behavior, multi-client smoke, and the 24-hour long-run gate require their respective test environments and are not claimed by this local release check.

## [0.1.0] — 2026-08-31

- First normalized release with the browser client, TeamSpeak 3 / 6 gateway, browser audio controls, access modes, administrator operations, and AGPL-3.0-only licensing.
