# WebSpeak · 简体中文

[返回项目首页](../README.md) · [English](./README.en.md) · [Deutsch](./README.de.md) · [Русский](./README.ru.md) · [日本語](./README.ja.md)

WebSpeak 是一个可自行部署的 TeamSpeak 3 / TeamSpeak 6 网页客户端与语音网关。用户无需安装桌面客户端即可从浏览器加入频道，管理员可以在控制台管理目标服务器、访问方式和运行状态。

当前皮肤包的实现规则见[皮肤开发规范](./SKIN_DEVELOPMENT.md)。声明式布局已实现；扩展插件权限沙箱仍为默认关闭的开发原型，阶段状态和安全边界见[路线图](./OPEN_SKIN_SYSTEM_ROADMAP.zh-CN.md)与[规格](./OPEN_SKIN_SYSTEM_SPEC.zh-CN.md)。

## 在线 Demo

地址：<https://webspeak.example.invalid>

公共 Demo 位于香港，网络和负载可能不稳定。延迟、断线或暂时不可用不代表自行部署后的实际表现。

## ✨ 特性

| 能力 | 说明 |
| --- | --- |
| TeamSpeak 兼容 | 支持 TeamSpeak 3 与 TeamSpeak 6，并自动探测目标服务器协议。 |
| 跨端 P2P 屏幕共享 | 支持浏览器用户与 TeamSpeak 6 原生客户端互相发起和观看屏幕共享；媒体优先通过 WebRTC/ICE 直连，WebSpeak 仅转发协商信令。 |
| IPv6 目标 | 默认支持 IPv6 TeamSpeak 目标和域名解析出的 IPv6 地址。 |
| 频道与成员 | 浏览频道树、查看实时成员状态并切换频道。 |
| 实时语音 | 使用 Opus，支持兼容传输和可选的内置 WebRTC 低延迟传输。 |
| 音频控制 | 选择麦克风与扬声器、调节音量、测试麦克风、闭麦、VOX 和成员独立音量。 |
| 浏览器端降噪 | 提供可开关的麦克风降噪，在浏览器采集端处理，不增加服务器端音频处理压力。 |
| 消息与互动 | 支持频道消息、服务器消息、私聊、戳一戳和耳语目标。 |
| 桌面端伴奏 | 在桌面浏览器选择带音频的窗口或标签页，将声音分享给当前频道。 |
| 身份与访问 | 支持身份保持、访客自定义目标、可撤销/可过期邀请链接，以及 TeamSpeak 3 身份导入、转换、校验与导出。 |
| 工程结构 | 0.2.6 将网关语音、会话事件、音频和屏幕共享拆分为独立模块；前端语音与管理页拆分为组件、composables 和服务，并补充生命周期与重连测试。 |
| 管理控制台 | 管理目标、访问策略、WebRTC、中继、邀请、会话、日志、诊断和备份。 |
| 皮肤 | 提供日间、夜间和 ILLUSIA 三款受保护皮肤，并支持实例自定义 `.wskin` 外观与管理员默认/启用管理。 |
| 界面体验 | 提供中文、English、Deutsch、Русский、日本語及响应式桌面/移动布局。 |
| 自托管 | 数据由部署者保存，支持 Docker amd64/arm64、Windows x64、Linux x64/ARM64 服务端包和 Android 客户端。 |

## 🖼️ 界面截图

以下截图展示中文界面的欢迎页、语音工作区、音量控制和成员操作菜单。

### 欢迎页

<p align="center"><img src="./screenshots/webspeak-zh-home.png" alt="WebSpeak 中文欢迎页" width="100%" /></p>

### 语音工作区

<p align="center"><img src="./screenshots/webspeak-zh.png" alt="WebSpeak 中文语音工作区" width="100%" /></p>

### 音量控制

<p align="center"><img src="./screenshots/webspeak-zh-audio.png" alt="WebSpeak 中文音量控制" width="100%" /></p>

### 成员菜单

<p align="center"><img src="./screenshots/webspeak-zh-menu.png" alt="WebSpeak 中文成员菜单" width="100%" /></p>

## 🧩 高级功能

高级功能均为可选项；关闭时仍可使用兼容语音传输。配置入口在管理员控制台的“服务器”页，保存后对新连接生效。

### 1. WebRTC 低延迟语音

WebRTC 将浏览器语音切换到实时媒体通道，也支持桌面端伴奏。媒体服务由当前 WebSpeak 网关直接提供，不需要另设媒体服务器。

1. 登录 `/admin`，打开“服务器”页的“高级参数”。
2. 关闭 WebRTC 时设置 UDP 起止端口，默认范围为 `40000–40099`。
3. 在 WebSpeak 主机的安全组和防火墙中放行整个 UDP 范围。
4. 勾选“启用 WebRTC”并保存，用户重新进入后即可协商；不支持时会回退到兼容传输。

WebRTC 启用后端口范围会锁定。要修改端口，先关闭 WebRTC 并保存，再修改端口并同步防火墙规则。公网使用还需要 HTTPS。

### 反向代理 / TCP 隧道下的语音 WebRTC

在管理后台的 WebRTC 高级参数中可设置：

- **公网媒体地址**：WebSpeak 网关可被 UDP 访问的 IP 或域名，不含协议、路径或端口。优先于网页入口推断；留空时按 `Origin`、`X-Forwarded-Host`、`Host` 推断。域名会解析为 IP 候选。反代域名不一定是媒体地址。
- **启用 IPv6 候选**：默认关闭；开启后保留 IPv4，同时收集 IPv6。需确保 IPv6 路由及 UDP 防火墙放行。
- **语音 STUN 服务**：可设置 `stun:turn.teamspeak.com:3478`，浏览器和网关使用同一服务发现公网映射。留空保留旧行为：werift 网关仍使用库内置 STUN，浏览器不配置 STUN。当前字段仅支持可通过 IPv4 访问的 UDP STUN 域名或 IPv4 地址，不接受 IPv6 字面量、TURN 或凭据；IPv6 媒体候选独立于 STUN 开关。

保存后重新连接。网页和 WebSocket 经反代可达，不代表媒体 UDP 可达；STUN 仅发现地址，不中继音频，也不保证穿透所有 NAT。只有 TCP 隧道而无可用 UDP/IPv6 路径时，仍会回退兼容传输。应开放配置的整个 UDP 端口范围；静态端口转发需保持相同端口映射。

### 屏幕共享的 ICE 候选

屏幕共享媒体仍优先走浏览器之间的直连，WebSpeak 只转发协商信令。默认使用 TeamSpeak 官方 STUN 服务发现公网候选地址；STUN 不承载媒体。若部署者有合规的外部 TURN 服务，可在启动 WebSpeak 前设置 `WEBSPEAK_SCREEN_SHARE_ICE_SERVERS`，值为 JSON 数组，例如：

```json
[{"urls":"stun:turn.teamspeak.com:3478"},{"urls":"turns:turn.example.com:5349","username":"<username>","credential":"<credential>"}]
```

配置 TURN 后，媒体可能经过该外部 TURN 服务，但不会经过 WebSpeak 网关；未配置时只使用直连和 STUN。

### 跨端 P2P 屏幕共享

浏览器用户与 TeamSpeak 6 原生客户端可以互相发现、发起和观看屏幕共享。浏览器之间以及浏览器与原生客户端之间的屏幕媒体优先通过 WebRTC/ICE 端到端传输；WebSpeak 负责会话鉴权、共享状态和 SDP/ICE 信令转发，不承载屏幕媒体流量。页面提供直播状态、观众人数、播放器音量、全屏和退出控制，也可在共享设置窗口中选择最高 1080p 与 60 FPS，并查看 WebRTC 统计。

### 2. 中继模式

中继适用于 TeamSpeak 拒绝境外连接或直连不稳定的情况。它不是 VPN，只转发当前 WebSpeak 会话的 TeamSpeak 数据；目标服务器仍由用户在网页中选择。

中继实例是专用转发服务，不提供前台和管理员后台，只接受带匹配令牌的 WebSpeak 网关会话。令牌至少使用 16 个字符的随机值。

#### 源码启动

```bash
git clone --depth 1 https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
npm ci --ignore-scripts
npm run prepare:sdk
npm run build
WEBSPEAK_MODE=relay \
WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token' \
WEBSPEAK_RELAY_HOST='0.0.0.0' \
WEBSPEAK_RELAY_PORT='39087' \
node dist/index.js
```

Windows PowerShell：

```powershell
$env:WEBSPEAK_MODE = "relay"
$env:WEBSPEAK_RELAY_TOKEN = "replace-with-a-long-random-token"
$env:WEBSPEAK_RELAY_HOST = "0.0.0.0"
$env:WEBSPEAK_RELAY_PORT = "39087"
node .\dist\index.js
```

#### 发布包启动

从 [Releases](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest) 下载并解压对应平台的包：

```bash
# Linux
export WEBSPEAK_MODE=relay
export WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token'
export WEBSPEAK_RELAY_HOST='0.0.0.0'
export WEBSPEAK_RELAY_PORT='39087'
./runtime/node ./dist/index.js
```

Windows PowerShell 使用同名环境变量后运行 `.\runtime\node.exe .\dist\index.js`。

#### Docker 启动

```bash
docker run -d --name webspeak-relay --restart unless-stopped --network host \
  -e WEBSPEAK_MODE=relay \
  -e WEBSPEAK_RELAY_TOKEN='replace-with-a-long-random-token' \
  -e WEBSPEAK_RELAY_PORT='39087' \
  ghcr.io/echosixhiya/webspeak:latest
```

放行中继主机的 UDP 监听端口，默认是 `39087`。

#### 在网关中启用

1. 管理员控制台 → “服务器” → “中继服务器”，添加一个或多个节点。
2. 为每个节点填写自定义名称、地址（例如 `relay.example.com#39087`）和匹配令牌并保存。
3. 访客欢迎页即可选择直连或其中一个中继。

关闭并保存中继配置后，访客页面不会显示中继选项。

### 3. 依赖与归属

- 中继服务是 WebSpeak 自带实现，使用 Node.js 标准库，不依赖 GOST、sing-box 或其他代理框架。
- WebRTC 使用 [werift](https://github.com/shinyoshiaki/werift-webrtc) `0.24.4`，上游采用 MIT 许可证。
- TeamSpeak 协议使用项目维护的 [EchoSixHIYA/teamspeak-js](https://github.com/EchoSixHIYA/teamspeak-js) SDK fork。

## 🧾 更新日志

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| [v0.2.6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.6) | 2026-10-08 | 相对 0.2.5 大范围重构语音网关、共享协议、前端语音工作区与管理模块；修复 #6/#7/#10，完成 #9/#12 配置，并修复 PR #13 报告的既有 TS6 屏幕共享漏发现问题；改善 Opus/重连生命周期和移动端控制。提供 Windows x64、Linux x64/ARM64、Docker amd64/arm64，以及 Android arm64-v8a、armeabi-v7a、x86_64 APK。 |
| [v0.2.5](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.5) | 2026-09-27 | 新增 `.wskin` 皮肤系统、管理员启用/默认管理和受保护的日间/夜间/ILLUSIA 内置皮肤；移除未完成 Aurora Voice 样例，修复皮肤加载闪烁、暗色控件可读性与语音界面美术层级，并加入官方皮肤开发 Agent Skill。 |
| [v0.2.4](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.4) | 2026-09-22 | 新增浏览器与 TeamSpeak 6 原生客户端之间的跨端 P2P 屏幕共享；提供 STUN/外部 TURN 配置、直播播放器、观众状态、1080p/60 FPS 采集设置和 WebRTC 统计；优化屏幕共享交互并新增访客编号。 |
| [v0.2.3](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.3) | 2026-09-19 | 新增频道成员调度与按权限直接移动；支持头像、静音状态同步和身份恢复；更新五种语言的功能截图与文档。 |
| [v0.2.2](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.2) | 2026-09-17 | 提供浏览器端麦克风降噪、俄语和日语支持及按语言欢迎词配置；优化音量交互和 PR #2 基础上的错误提示与错误代码。 |
| [v0.2.1](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.1) | 2026-09-13 | 优化首页连接错误显示，保留并安全截断错误代码；默认支持 IPv6 TeamSpeak 目标。 |
| [v0.2.0](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.2.0) | 2026-09-10 | 增加服务器密码提示、正式中继部署模式、多中继选择和管理员日志原因显示。 |
| [v0.1.8](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.8) | 2026-09-08 | 简化 Docker 部署，支持同机 TeamSpeak，增加 15 秒连接超时和持续网络监测。 |
| [v0.1.7](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.7) | 2026-09-06 | 增加德语、Telegram、网络性能面板和整体音量；修复伴奏音量波动。 |
| [v0.1.6](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.6) | 2026-09-04 | 增加桌面端伴奏、身份保持提醒和网站图标；修复 WebRTC 成员独立音量。 |
| [v0.1.5](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.5) | 2026-09-04 | 修复身份保存逻辑并优化主题切换。 |
| [v0.1.4](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.4) | 2026-09-03 | 修复 WebRTC、频道聊天并优化管理页、日志和移动端布局。 |
| [v0.1.3](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.3) | 2026-09-03 | 引入内置 WebRTC、迁移 TeamSpeak SDK 并改善成员同步和语音缓冲。 |

完整记录见 [CHANGELOG.md](../CHANGELOG.md)。

## 🚀 部署方案

| 方案 | 适用场景 | 环境 |
| --- | --- | --- |
| Docker Compose（推荐） | 长期运行、升级简单、数据持久化 | Docker Engine + Docker Compose |
| 发布包 | 不安装 Node.js 和构建依赖 | Windows x64 或 Linux x64/ARM64 |
| 源码运行 | 开发、调试和二次开发 | Node.js 22.5+、Git 和本地编译工具 |

### Docker Compose（推荐）

```bash
git clone --depth 1 https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
docker compose pull
docker compose up -d
```

启动后访问 `http://<你的主机>:3040`。使用反向代理时将上游指向该地址；启用 WebRTC 时放行控制台显示的 UDP 端口范围。数据保存在 `webspeak-data` volume 中。

```bash
docker compose ps
docker compose logs -f webspeak
```

升级：

```bash
git pull --ff-only
docker compose pull
docker compose up -d
```

不要执行 `docker compose down -v`，否则会删除数据库和管理员设置。

### 发布包

从 [GitHub Releases](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest) 下载与系统和架构匹配的 `windows-x64.zip`、`linux-x64.tar.gz` 或 `linux-arm64.tar.gz`，解压后运行对应启动脚本。发布包自带 Node.js 运行时和生产依赖。Docker 镜像支持 amd64/arm64。

Release 同时提供 Android `arm64-v8a`、`armeabi-v7a` 和 `x86_64` APK。它们使用 debug 签名，可手动侧载测试；不是 Google Play 发布包，Android 真机语音仍需验收。

### 源码运行

```bash
git clone https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
npm ci --ignore-scripts
npm run prepare:sdk
npm rebuild @discordjs/opus --foreground-scripts
npm --prefix web ci
npm --prefix web run build
npm run build
npm start
```

构建 `@discordjs/opus` 需要 Python、Make 和 C/C++ 编译工具。

### 首次配置

1. 打开 `http://<你的主机>:3040/admin`。
2. 使用默认账号 `admin` / `admin` 登录，并立即设置至少 12 位的新密码。
3. 在“服务器”页配置 TeamSpeak 目标和访问方式，例如 `voice.example.com#9987`。
4. 公网使用时配置 HTTPS；启用 WebRTC 时放行控制台显示的 UDP 范围。

## ⚠️ 要求和注意事项

| 项目 | 要求或注意事项 |
| --- | --- |
| 浏览器 | 建议使用最新版 Chrome、Edge 或其他支持 WebRTC 的现代浏览器。麦克风和窗口音频通常要求 HTTPS。 |
| TeamSpeak 网络 | WebSpeak 主机必须能够访问目标 TeamSpeak；默认语音端口为 `9987`。 |
| Web 服务网络 | 服务使用 `3040/TCP`，公网建议通过 HTTPS 反向代理提供网页和 WebSocket。 |
| IPv6 | IPv6 字面量写为 `[2001:db8::1]#9987`。主机/容器需要可路由 IPv6、启用 IPv6 的操作系统和 Node.js，以及相应防火墙放行。 |
| WebRTC | 默认使用 `40000–40099/UDP`，启用后需放行整个范围；修改范围前先关闭 WebRTC。 |
| 身份保持 | 同一浏览器身份同时只能保持一条活动连接；并行连接请关闭第二条的身份保持或使用其他浏览器配置文件。 |
| 伴奏 | 仅桌面端提供且要求 WebRTC；选择窗口或标签页时还要勾选共享音频。 |
| 数据 | Docker 数据在 `webspeak-data` volume；发布包和源码运行数据在 `data/`。升级前建议备份。 |
| 会话上限 | 单实例最多允许 100 个活动网页会话。 |

## 近期合并贡献者

- 以下依据 GitHub 合并记录列出；上方版本摘要只描述对应版本实际纳入的改动。
- [LainHE](https://github.com/LainHE) — [PR #2](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/2) 改进浏览器端报错翻译；[PR #8](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/8) 修正缩放、浮动布局和首页脚注。
- [TimmySheep](https://github.com/TimmySheep) — [已合并 PR #13、#15–#24](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pulls?q=is%3Apr+is%3Amerged+author%3ATimmySheep)，涉及 TS6 既有屏幕共享发现、屏幕比例、移动端语音/常亮/皮肤菜单、身份频道选项、PWA/主题、聊天历史、成员音频状态和麦克风权限等改进。
- [yichen11818](https://github.com/yichen11818) — [PR #25](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/25) 支持通过 TeamSpeak 注册昵称连接，并在设置、收藏和邀请中保留昵称目标。
