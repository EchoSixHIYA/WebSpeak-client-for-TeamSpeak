# WebSpeak 皮肤开发规范

本文说明如何制作、校验并发布 WebSpeak `.wskin` 皮肤包。皮肤可以彻底重做公开页面的视觉表现：背景图、字体、布局、头像框、滚动条、按钮、设置面板、语音成员、聊天和屏幕共享播放器都可以用 CSS 定制；首页文字和功能介绍也可以按语言替换。

皮肤不注入 HTML 或 JavaScript，也不改变语音、权限、连接、拖动和屏幕共享行为。页面结构和必要控件由应用提供，皮肤通过样式与有限的文案配置改变呈现。**管理后台 `/admin/**` 不属于皮肤范围，始终使用 WebSpeak 自己的固定样式。**

可直接查看 [Aurora Voice 示例源码](examples/aurora-voice/)，其中包含本地图片资源、多语言首页文案、演示页翻译、头像框、滚动条、播放器和动效的完整用法。

## 使用与发布

管理员在 `/admin/skins` 上传 `.wskin` 包，可查看预览、替换同 ID 版本或删除皮肤。皮肤发布到当前 WebSpeak 实例后，访客可在连接首页、语音工作区或 `/demo` 的“皮肤”选择器中切换；选择保存在该浏览器。皮肤包会缓存在浏览器本地；页面启动时会查询实例目录，目录可用且版本更新时拉取新包。若网络不可用，已缓存的版本仍可使用。

选择器提供“日间”“夜间”和实例发布的皮肤；没有“跟随系统”选项。自定义皮肤同时继承当前日间或夜间的基础令牌，再由自己的 CSS 覆盖。切换为日间或夜间时，会停用当前自定义包。

## 包结构

`.wskin` 是标准 ZIP 容器，推荐把下列文件直接放在 ZIP 根目录：

```text
manifest.json                 # 必需：身份、版本与入口
skin.css                      # 必需：皮肤样式
content.json                  # 可选：首页内容与多语言界面文案
assets/preview.jpg            # 可选：管理后台显示的预览图，也可在 CSS 中使用
assets/background.webp        # 可选：页面艺术素材
assets/brand.woff2            # 可选：自带字体
```

所有资源路径使用 `/`，区分大小写，并相对于包根目录。CSS 的 `url()` 使用同样的包根相对路径，例如 `url("assets/background.webp")`。不得使用机器本地路径、站点绝对路径或远程 URL。

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "id": "studio.aurora-voice",
  "name": "Aurora Voice",
  "version": "1.0.0",
  "author": "Your name",
  "license": "CC-BY-4.0",
  "description": "An aurora-inspired voice workspace.",
  "entry": "skin.css",
  "content": "content.json",
  "preview": "assets/preview.jpg",
  "minAppVersion": "0.2.4"
}
```

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 当前必须为数字 `1`。 |
| `id` | 必需，最多 80 个字符；只允许小写字母、数字、点和连字符；不能以 `builtin.` 开头。发布后不要更改。 |
| `name`、`author`、`license` | 必需，各最多 80 个字符。资源授权由作者负责确认。 |
| `version`、`minAppVersion` | 必需，使用语义化版本号，例如 `1.2.0`。 |
| `entry` | 必需，包内 CSS 文件路径，最多 120 个字符。 |
| `content` | 可选，包内 JSON 文件路径，最多 120 个字符。 |
| `preview` | 可选，包内 PNG、JPG/JPEG、WebP、AVIF 或 GIF 图片路径，最多 120 个字符。 |
| `description` | 可选，最多 400 个字符。 |

清单不得重复声明同一个文件为 CSS、内容或预览入口。

## 首页内容和文案

`content.json` 可按 locale 覆盖连接首页内容和公开界面文案；不提供的字段继续使用应用文案，不会显示空白。当前允许 1–20 个 locale，locale 写作 `en`、`zh-CN`、`ja-JP` 等形式。`defaultLocale` 必须指向一个已定义的 locale。示例：

```json
{
  "defaultLocale": "en",
  "locales": {
    "en": {
      "home": {
        "eyebrow": "A room of your own",
        "title": "Talk",
        "titleAccent": "together",
        "description": "Join a voice room from your browser.",
        "welcomeTitle": "Join the room",
        "welcomeDescription": "Choose a name and connect.",
        "features": [
          { "title": "Clear voice", "description": "Low-latency Opus audio." }
        ]
      },
      "messages": {
        "home.connect": "Enter the room",
        "voice.activity-heading": "Voice activity",
        "demo.heroLead": "A preview customized by this skin."
      }
    }
  }
}
```

`home` 支持 `brandName`、`eyebrow`、`title`、`titleAccent`、`description`、`welcomeTitle`、`welcomeDescription` 和 `features`。普通文字最多 500 个字符；`features` 最多 8 项，每项的 `title` 最多 80 个字符、`description` 最多 240 个字符。功能卡片图标和状态由应用提供，皮肤不能通过 JSON 注入节点。

`messages` 的键是公开页面中翻译调用使用的键；首页/语音页键可在 `web/src/i18n/web-client.ts` 查找，演示页键使用 `demo.` 前缀加字段名（例如 `demo.heroLead`、`demo.speakingNow`）。每个 locale 最多覆盖 200 条，每条文案最多 500 个字符。键只能由小写字母开头，并包含字母、数字或点。语言回退顺序为默认 locale、当前语言和更具体的 locale；之后回退到 WebSpeak 原文。

管理后台的文字不读取皮肤包，不能通过 `messages` 修改。

## CSS 皮肤接口

### 自动隔离

运行时把 `skin.css` 的每个选择器限定在皮肤自己的公开页面根节点内：

```css
/* 作者只写部件选择器；运行时自动加上皮肤和页面根作用域。 */
[data-ws-page="voice"] [data-ws-part="voice.member.avatar"] {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
```

实际规则会被限定在类似下面的根节点内，不会匹配 `/admin/**`：

```css
.ws-skin-root[data-ws-skin="studio.aurora-voice"] [data-ws-page="voice"] [data-ws-part="voice.member.avatar"]
```

也可以写 `:root { --accent: ... }` 设置皮肤根令牌；`:root` 会被转换成当前皮肤根。不要写 `:global()`、`html`、`body` 或 Vue 内部 class 作为公开接口。组件 class 可能随版本调整，`data-ws-part` 才是皮肤作者接口。

页面根节点使用 `data-ws-page` 区分 `home`、`voice` 和 `demo`。使用 `data-ws-state` 选择明确状态，如 `active`、`idle`、`current`、`drag-over`、`dragging`、`speaking`、`connected`、`self`、`mine` 或 `other`。语音成员还提供 `data-ws-speaking="true|false"` 和 `data-ws-self="true|false"`。交互元素会带有 `data-ws-critical="true"`；没有专属部件名称的按钮、链接、输入框、滑块和可拖动成员会使用通用部件 `data-ws-part="control"`，并以 `data-ws-control-kind` 标出 `button`、`link`、`input`、`checkbox`、`range`、`select`、`textarea`、`menuitem` 或 `draggable`。

### 已发布的部件名称

下列名称来自当前前端模板。对新功能，作者可以先用通用 `control` 部件；后续新增稳定部件会更新本目录。

| 页面区域 | `data-ws-part` |
| --- | --- |
| 通用 | `app`、`app.toast`、`control` |
| 首页 | `home`、`home.header`、`home.brand`、`home.header-tools`、`home.gateway-status`、`home.content`、`home.hero`、`home.hero.eyebrow`、`home.hero.title`、`home.hero.description`、`home.features`、`home.feature`、`home.visitors`、`home.join-card`、`home.join-title`、`home.join-description`、`home.notice`、`home.form`、`home.server-target`、`home.field-label`、`home.field`、`home.relay-choice`、`home.relay-choice.copy`、`home.server-history`、`home.server-history.group`、`home.favorite-toggle`、`home.identity`、`home.connect`、`home.security-note`、`home.footer`、`home.community-dialog` |
| 语音工作区 | `voice.shell`、`voice.workspace`、`voice.header`、`voice.header-actions`、`voice.breadcrumbs`、`voice.performance`、`voice.performance.panel`、`voice.performance.route`、`voice.performance.metrics`、`voice.performance.status`、`voice.performance.webrtc-stats`、`voice.connection-status`、`voice.audio-status`、`voice.poke`、`voice.scroll`、`voice.content`、`voice.activity`、`voice.activity-heading`、`voice.screen-share-error`、`voice.members`、`voice.members.empty`、`voice.member`、`voice.member.avatar-wrap`、`voice.member.avatar`、`voice.member.name`、`voice.member.status`、`voice.member.live-indicator`、`voice.member.stop-share`、`voice.member.share-actions`、`voice.member-panel`、`voice.member-panel.heading`、`voice.member-panel.search`、`voice.member-panel.channels`、`voice.channel-group`、`voice.channel-group.heading`、`voice.channel-group.members`、`voice.member-row`、`voice.member-row.avatar`、`voice.member-row.copy`、`voice.member-row.flags`、`voice.member-row.volume`、`voice.whisper-strip`、`voice.audio-dock`、`voice.audio-dock.microphone`、`voice.audio-dock.microphone-panel`、`voice.audio-dock.output`、`voice.audio-dock.output-panel`、`voice.audio-settings`、`voice.mobile-more`、`voice.mobile-nav` |
| 聊天与菜单 | `voice.chat`、`voice.chat.tabs`、`voice.chat.tab`、`voice.chat.heading`、`voice.chat.messages`、`voice.chat.event`、`voice.chat.message`、`voice.chat.message-avatar`、`voice.chat.message-body`、`voice.chat.empty`、`voice.chat.composer`、`voice.context-menu-backdrop`、`voice.context-menu`、`voice.context-menu.header`、`voice.context-menu.move-submenu` |
| 屏幕共享 | `voice.screen-share-settings`、`voice.screen-share-settings.heading`、`voice.screen-share-settings.fields`、`voice.screen-share-settings.note`、`voice.screen-share-settings.actions`、`voice.screen-player`、`voice.screen-player.stage`、`voice.screen-player.video`、`voice.screen-player.placeholder`、`voice.screen-player.exit`、`voice.screen-player.viewers`、`voice.screen-player.viewer-avatar`、`voice.screen-player.live`、`voice.screen-player.source`、`voice.screen-player.controls`、`voice.screen-player.volume`、`voice.screen-player.fullscreen` |
| `/demo` 演示页 | `demo.header`、`demo.brand`、`demo.header-tools`、`demo.badge`、`demo.skin-switcher`、`demo.language-switcher`、`demo.home-link`、`demo.reconnect`、`demo.reconnect.restore`、`demo.layout`、`demo.channels`、`demo.channels.heading`、`demo.channel`、`demo.channel.select`、`demo.channel.members`、`demo.main`、`demo.hero`、`demo.live`、`demo.hero.title`、`demo.hero.description`、`demo.hero.online`、`demo.wave`、`demo.voice-heading`、`demo.voice-grid`、`demo.voice-card`、`demo.avatar`、`demo.member-name`、`demo.member-status`、`demo.chat.heading`、`demo.chat.tabs`、`demo.chat.tab`、`demo.chat.messages`、`demo.chat.message`、`demo.chat.empty`、`demo.chat.composer`、`demo.chat.input`、`demo.chat.send`、`demo.actions`、`demo.actions.heading`、`demo.action.speaking`、`demo.action.poke`、`demo.action.reconnect`、`demo.note`、`demo.user`、`demo.poke-notification`、`demo.poke.dismiss` |

`voice.member.avatar` 是语音活动区头像；`voice.member-row.avatar` 是右侧成员树头像。状态属性还会使用 `current`、`drag-over`、`dragging` 和 `self`。当前根节点以及屏幕共享播放器、弹窗、菜单都属于同一皮肤作用域。

### 令牌、字体、动效和图片

皮肤可自定义任意作用域内的普通 CSS，不限于改色。推荐先定义自己的变量，再为公开部件编写布局：

```css
:root {
  --page-bg: #091317;
  --panel: #142329;
  --text: #edf8f5;
  --muted: #9db5af;
  --accent: #47dcc4;
  --card-radius: 20px;
}

[data-ws-part="voice.screen-player"] {
  border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
  border-radius: var(--card-radius);
  box-shadow: 0 18px 50px #0008;
}
```

`url()` 只允许引用包内图片或 WOFF2 字体。支持 PNG、JPG/JPEG、WebP、AVIF、GIF 和 WOFF2；SVG 不接受。自带字体示例：

```css
@font-face {
  font-family: "Aurora Sans";
  src: url("assets/aurora-sans.woff2") format("woff2");
  font-display: swap;
}

[data-ws-page="voice"] { font-family: "Aurora Sans", sans-serif; }
```

字体必须随包附带并拥有可再分发许可。字体族名和 `@keyframes` / `@layer` 名称会自动隔离，避免与其他皮肤冲突。请支持 `prefers-reduced-motion`，并确保焦点、错误、静音、正在说话等状态仍容易辨认。

## 安全边界和限制

校验在上传端和服务端执行；服务端只登记有效皮肤包，访客只能下载登记的包。当前限制如下：

| 项目 | 上限 |
| --- | ---: |
| ZIP `.wskin` | 20 MiB |
| 解压总大小 | 50 MiB |
| ZIP 条目数 | 128 |
| 单个 CSS 文件 | 512 KiB |
| `content.json` | 256 KiB |
| 单张图片（包括预览） | 16 MiB |
| 单个 WOFF2 字体 | 4 MiB |
| 每实例皮肤数 | 50 |
| 每实例皮肤包总存储 | 200 MiB |

压缩包路径穿越、重复/冲突路径、符号链接、异常 ZIP 元数据和本地文件头/目录不一致都会被拒绝。仅允许受支持的 CSS at-rule：`@media`、`@supports`、`@container`、具名 `@layer`、`@font-face` 和 keyframes。`@import`、脚本、HTML、外部网络资源会被拒绝；`!important` 可用于皮肤作用域内的样式。字体 `local()` 也会拒绝，避免绕过包内字体来源。

必要操作控件（加入/退出、麦克风、设置、菜单、屏幕共享退出、音量、全屏等）及其布局容器不能被隐藏或整体重置。校验器会拦截常见的 `display`、`visibility`、`opacity`、`pointer-events`、遮罩、裁切、变换、滤镜和 `all` 隐藏/重置方式。若确实需要移除纯装饰部分，只允许对以下独立元素使用这些写法：

```css
[data-ws-part="home.hero.eyebrow"]
[data-ws-part="home.gateway-status"]
[data-ws-part="home.features"]
[data-ws-part="home.feature"]
[data-ws-part="home.visitors"]
[data-ws-part="voice.activity-heading"]
[data-ws-part="voice.member.avatar"]
[data-ws-part="voice.member.live-indicator"]
[data-ws-part="voice.member-row.avatar"]
[data-ws-part="voice.screen-player.viewer-avatar"]
[data-ws-part="voice.screen-player.live"]
[data-ws-part="demo.badge"]
[data-ws-part="demo.wave"]
[data-ws-part="demo.avatar"]
[data-ws-part="demo.member-status"]
[data-ws-part="demo.note"]
```

上面必须使用单独的精确属性选择器；不能通过父容器、组合选择器或子元素间接隐藏/重置内容。关键帧只有在其动画仅被这些可隐藏部件引用时，才可使用隐藏写法；若关键帧也被必要控件引用或动画名通过变量指定，则会被拒绝。你仍可自由重排、装饰这些元素，并使用皮肤包自带的图片和字体。校验仅覆盖常见风险写法，不是对任意 CSS 的形式化安全证明；CSS 仍可能造成遮挡、不可读或破坏布局，皮肤作者需在预览中验证每个必要控件。

皮肤可重新布置甚至重画控制外观，但不得隐藏或阻断加入/退出、麦克风状态、设置、菜单、屏幕共享退出、音量、全屏等必要操作。校验器还会对固定定位或极端层级给出风险警告；校验成功不代表设计质量合格。提交前要逐页实测窄屏和桌面尺寸、深浅色、键盘焦点与减少动效设置。

CSS 被限定在 `.ws-skin-root` 内，管理员页面不会继承皮肤。删除实例里的包会停止从服务器提供该包；已经下载过的浏览器副本会保留在本地存储，因此仍可能在该浏览器的选择器中出现。清除该站点的浏览器数据可移除本地副本。

## 制作与验收

1. 复制 `docs/examples/aurora-voice/`，先修改 `manifest.json` 的唯一 `id`、名称、作者、版本和授权。
2. 只使用本目录公开的 `data-ws-part`、`data-ws-page`、状态属性和包内静态资源。不要依赖 Vue 内部 class。
3. 使用本地资源编写 `skin.css`；需要改首页文字或公开翻译时补充 `content.json`。
4. 在包根目录生成 ZIP，再改扩展名为 `.wskin`。PowerShell 示例：

   ```powershell
   Compress-Archive -Path .\docs\examples\aurora-voice\* -DestinationPath .\aurora-voice.zip -Force
   Rename-Item .\aurora-voice.zip aurora-voice.wskin
   ```

5. 在管理员后台 `/admin/skins` 上传。用访客浏览器分别检查连接首页、进入语音页和 `/demo`；测试自定义图片、所有交互控件、语音/静音状态、成员列表、聊天、屏幕共享播放器和设置。
6. 检查至少一个窄屏尺寸和桌面尺寸，并检查焦点可见、对比度、动效偏好；确认没有第三方素材授权问题。

当前自动化回归涵盖 ZIP/清单验证、资源路径、CSS 隔离与拒绝规则、文案结构和服务端皮肤目录读写。视觉排版、内容遮挡和浏览器间表现仍须人工预览。
