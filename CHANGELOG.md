# Changelog

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
