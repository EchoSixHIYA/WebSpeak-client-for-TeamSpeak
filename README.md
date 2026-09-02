<div align="center">

# WebSpeak

**让 TeamSpeak 真正进入浏览器。**

自托管的 TeamSpeak 3 / TeamSpeak 6 网页客户端与语音接入网关。无需安装桌面客户端，打开浏览器即可进入你的语音空间。

A self-hosted TeamSpeak 3 / TeamSpeak 6 web client and voice gateway. Join your voice space from a modern browser without installing a desktop client.

[![License](https://img.shields.io/badge/License-AGPL--3.0--only-0f766e?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.3-0f766e?style=flat-square)](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/tag/v0.1.3)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5.0-0f766e?style=flat-square)](https://nodejs.org/)
[![TeamSpeak](https://img.shields.io/badge/TeamSpeak-3%20%7C%206-0f766e?style=flat-square)](https://www.teamspeak.com/)

**在线 Demo：** [https://webspeak.online](https://webspeak.online)

**[中文](#中文)**<br />
[更新日志](#更新日志) · [为什么是 WebSpeak](#为什么是-webspeak) · [核心能力](#核心能力) · [架构](#架构) · [快速开始](#快速开始) · [首次登录与默认目标](#首次登录与默认目标) · [访问模式与邀请](#访问模式与邀请) · [音频与设备](#音频与设备) · [数据与安全边界](#数据与安全边界) · [旧版本升级](#旧版本升级) · [健康检查](#健康检查开发与验证) · [项目结构](#项目结构) · [已知边界](#已知边界) · [社区](#社区)

**[English](#english)**<br />
[Changelog](#changelog) · [Why WebSpeak](#why-webspeak) · [Core capabilities](#core-capabilities) · [Architecture](#architecture) · [Quick Start](#quick-start) · [First login](#first-login-and-default-target) · [Access modes](#access-modes-and-invites) · [Audio](#audio-and-devices) · [Security](#data-and-security-boundary) · [Upgrade](#upgrading-from-a-legacy-version) · [Health](#health-development-and-verification) · [Project layout](#project-layout) · [Known boundaries](#known-boundaries) · [License](#license) · [Community](#community)

</div>

> WebSpeak 是一个面向浏览器的 TeamSpeak 客户端，让频道、成员、文字与语音协作在网页中自然完成。

> WebSpeak is a browser-based TeamSpeak client that brings channels, members, text chat, and voice collaboration into one web experience.

## 中文

### 更新日志

#### 2026-09-03 · v0.1.3

- 新增可选的 WebRTC 语音传输，为需要更低、更稳定实时语音延迟的部署提供实验性通道。
- 增加 WebRTC 环境配置，可设置公网地址和受限的 UDP 端口范围；默认部署方式和默认语音链路保持不变。
- WebRTC 语音按协商得到的 Opus 参数传输，并且每位发言者只保留最新音频帧，避免网络抖动时旧语音持续堆积。
- 修复 WebRTC 与兼容性语音链路切换时的重复播放、残留会话和回退不完整问题。
- 修复原生 Opus 解码调用和浏览器端协商负载类型处理，并整理连接关闭时的资源清理。

#### 2026-09-02 · v0.1.2

- 优化移动端浏览器体验：频道、成员、聊天和语音操作适配窄屏；移动端成员操作提供三个点菜单，桌面端继续使用右键菜单。
- 将首页 GitHub 入口改为显眼按钮，并增加当前版本标识和更新日志入口；窄屏时自动收敛为图标，避免按钮文字互相挤占。
- 修复设置齿轮图标和相关操作按钮的对齐问题，统一设置、退出、麦克风等控制的触控尺寸与视觉反馈。
- 将上一个版本之后的移动端语音控制、闭麦替代按键说话、目标协议自动探测、Docker Compose 简化启动和在线 Demo 文档整理为本次版本内容。

#### 2026-09-02 · v0.1.1

- 汇总并正式发布浏览器客户端、管理员控制台、受控邀请、Session 运维、审计记录、诊断报告和 SQLite 备份能力。
- 修复晚进入 WebSpeak 的浏览器会话无法看到先进入成员的问题；连接建立后会完成目录同步，并合并分阶段成员事件。
- 修复私聊消息到达后网页端断开连接的问题，完善成员右键菜单、悬停高亮和语音活动状态展示。
- 完成中英文界面、默认 TeamSpeak 目标、旧版配置迁移和首次登录强制改密流程。
- 移除依赖页面焦点的普通空格键按键说话模式；改为桌面端和移动端均可用的一键闭麦/开麦，静音状态会保存在当前浏览器中。
- 闭麦会在上行音频发送前直接阻断声音，同时保留 VOX 语音激活、输入设备选择、音量与阈值调节能力。
- 发布流程稳定生成 Windows/Linux 部署包并同步发布 Docker 镜像；Docker 构建会正确处理依赖安装脚本。
- 简化 Docker Compose 部署：默认使用已发布镜像，自动创建并持久化数据卷，支持通过 `WEBSPEAK_PORT` 修改宿主机端口。

#### 2026-08-31 · v0.1.0

- 首个规范化版本，提供浏览器客户端、TeamSpeak 3 / 6 网关、浏览器音频控制、访问模式、管理员运维能力和 AGPL-3.0-only 许可证。

### 为什么是 WebSpeak

| 体验 | WebSpeak 的答案 |
| --- | --- |
| 加入方式 | 浏览器打开链接即可加入，不安装桌面客户端 |
| 兼容性 | 支持 TeamSpeak 3 / TeamSpeak 6，并自动识别协议 |
| 连接模型 | HTTPS / WSS 连接 WebSpeak，WebSpeak 连接目标 TeamSpeak |
| 入口控制 | 固定目标、开放目标、一次性受控邀请三种路径 |
| 语言与主题 | 访客端和管理控制台均支持中英文与主题切换 |

### 核心能力

| 领域 | 已提供 |
| --- | --- |
| 语音 | Opus / PCM 桥接、可选 WebRTC 低延迟通道、VOX 语音激活、一键闭麦/开麦、连接状态与重连提示 |
| 设备 | 浏览器麦克风与扬声器选择、音量调节、实时输入电平、本地麦克风测试 |
| 频道 | 频道树、频道切换、成员移动、频道文字聊天、服务器事件与状态展示 |
| 成员 | 在线成员、发言绿色头像边框、Away 状态、私聊、Poke、昵称复制、成员音量 |
| 管理 | 默认账号首次登录强制改密、默认 TeamSpeak 目标、站点信息、真实连接测试 |
| 运维 | 活动 Session、邀请创建与撤销、审计事件、结构化日志、诊断报告、SQLite 备份 |
| 浏览器体验 | 响应式布局、桌面与移动端语音控制、紧凑滚动布局、浏览器本地收藏与最近连接 |

### 架构

| 层级 | 职责 | 连接 |
| --- | --- | --- |
| 浏览器会话 | 昵称、设备、频道、成员、文字和语音交互 | HTTPS / WSS → WebSpeak；可选 WebRTC 音频 |
| WebSpeak 网关 | 会话管理、访问控制、语音桥接、目录同步、管理控制台 | TeamSpeak 客户端协议 |
| TeamSpeak 3 / 6 | 提供频道、成员、文字和语音服务 | 目标地址与语音端口 |

### 快速开始

#### 方式 A：Docker Compose（推荐）

Docker Compose 默认从 GitHub Container Registry 拉取已经发布的 WebSpeak 镜像，自动创建数据卷并启动服务。普通部署不需要本地 Node.js、编译工具或 Dockerfile 构建环境。

```bash
git clone https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
docker compose pull
docker compose up -d
```

查看状态和日志：

```bash
docker compose ps
docker compose logs -f webspeak
curl http://127.0.0.1:3040/health
```

启动完成后打开 [http://127.0.0.1:3040/](http://127.0.0.1:3040/)。首次进入管理后台 `/admin` 使用 `admin / admin`，并按提示修改密码。

默认数据保存在 Docker volume `webspeak-data` 中。升级时先拉取新镜像，再重新创建应用容器；停止服务使用 `docker compose down`，不要添加 `-v`，否则会删除数据库、密钥和管理员配置。

```bash
docker compose pull
docker compose up -d
```

如需固定到某个发布版本，可在启动前指定 GHCR 镜像标签；发布标签与 GitHub Release 一致：

```bash
export WEBSPEAK_IMAGE=ghcr.io/echosixhiya/webspeak:v0.1.3
docker compose pull
docker compose up -d
```

WebSpeak 默认对外提供 `3040` 端口。如需修改宿主机端口，只需设置 `WEBSPEAK_PORT`，容器内部端口无需修改：

```bash
WEBSPEAK_PORT=3041 docker compose up -d
```

容器内部监听 `3040`，SQLite 数据库、安装级主密钥和日志保存在 `/data`。Dockerfile 仅用于项目 CI、发布资产和开发者本地构建，不是普通用户的默认部署入口。

#### 方式 B：源码运行（开发者）

环境要求：

- Node.js `22.5.0` 或更高版本。
- `@discordjs/opus` 所需的原生编译工具；Linux 通常需要 `python3`、`make`、`g++`。
- 一台可访问的 TeamSpeak 3 或 TeamSpeak 6 服务端。
- 较新的 Chrome 或 Edge；生产环境建议使用 HTTPS。

```bash
npm ci
npm --prefix web ci
npm --prefix web run build
npm run build
node dist/index.js
```

随后打开：

```text
http://127.0.0.1:3040/
```

### 首次登录与默认目标

1. 打开 `/admin`。
2. 使用默认账户 `admin / admin` 登录。
3. 按页面要求设置一个至少 12 个字符的新管理员密码。
4. 在“服务器”页面的“默认 TeamSpeak 目标”中填写服务器地址与语音端口。
5. 执行连接测试并保存。

欢迎页没有邀请链接目标参数时，会使用管理员设置的默认 TeamSpeak 目标进行预填写。邀请链接参数优先；固定模式下访客只能进入管理员配置的目标，开放模式下访客可以输入经过安全校验的公网目标。

WebSpeak 的 HTTP 端口固定为 `3040`，TeamSpeak 默认语音端口为 `9987`。目标地址在界面中拆分为“地址”和“语音端口”两个字段；旧版 `地址:端口` 与 `地址#端口` 文本仍可兼容解析。

### 访问模式与邀请

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| `fixed` | 访客不改变目标，服务端管理目标与服务器密码 | 私有社区、固定服务器 |
| `open` | 访客可输入公网目标与本次会话密码 | 临时接入、多服务器入口 |
| 受控邀请 | 管理员生成一次性、可过期、可限次、可撤销链接 | 活动、临时房间、定向分享 |

开放模式会在 DNS 解析后阻止 loopback、私网、链路本地、组播、广播和保留地址，并使用已验证的 IP 进行实际连接。服务器密码不会写入分享链接、浏览器本地存储或 WebSocket URL。

### 音频与设备

进入语音空间后，在设置中可以：

- 选择浏览器检测到的麦克风与扬声器；
- 一键闭麦或开麦；
- 调整输入、输出、通知音量与 VOX 阈值；
- 查看麦克风权限、实时输入电平和音频上下文状态；
- 使用最多 5 秒的本地麦克风测试，录音只在浏览器本地播放，不发送到 TeamSpeak。

设备标签由浏览器权限模型决定。首次选择设备前，浏览器可能要求授予麦克风权限；输出设备选择依赖浏览器支持，不支持时会明确回退到默认扬声器。

#### 可选 WebRTC 语音传输

`v0.1.3` 提供实验性的 WebRTC 语音通道，默认关闭。它适合已经能够为 WebSpeak 发布一段 UDP 端口范围的部署；普通 Docker 部署无需额外配置，继续使用默认语音链路即可。

启用时设置：

```bash
WEBSPEAK_WEBRTC=true
WEBSPEAK_WEBRTC_PUBLIC_HOST=<公网 IP 或可解析的公网主机名>
WEBSPEAK_WEBRTC_UDP_START=40000
WEBSPEAK_WEBRTC_UDP_END=40099
```

同时需要将 `40000-40099/udp` 发布到 WebSpeak 容器。若网络或浏览器不支持 WebRTC，客户端会自动回退到兼容性语音链路。

### 数据与安全边界

运行数据默认位于 `data/`，Docker 环境默认位于 `/data`：

```text
data/
├── webspeak.db   SQLite 配置、管理员凭据、邀请与有限审计事件
├── master.key    32 字节安装级主密钥
└── logs/         本地轮转日志
```

- 管理员密码使用 Node.js `crypto.scrypt`、随机 salt 与 constant-time compare。
- TeamSpeak 服务器密码使用 AES-256-GCM 加密保存，管理 API 不返回明文。
- 管理 Session 使用服务端会话、HttpOnly / SameSite Strict Cookie、同源校验与 CSRF token。
- 管理登录具有固定窗口限速与失败延迟。
- 普通用户 identity 只在当前 Join Ticket / Session 中使用；启用“记住此设备”后，私钥只保存在浏览器 IndexedDB，不上传到网关，也不会进入日志、诊断或数据库。
- WebSpeak 不提供身份文件导入/导出界面；清除浏览器本地数据会移除本机记住的身份与偏好。
- 日志、诊断报告与 Overview 不返回服务器密码、管理员密码或身份私钥。
- 请同时备份 `webspeak.db` 与 `master.key`；只有数据库而没有主密钥时，加密的服务器密码无法恢复。

### 旧版本升级

如果升级启动时项目根目录仍有旧 `config.json`，WebSpeak 只做一次性导入：

- `tsHost`
- `tsPort`
- `tsServerPassword`

导入后 `data/webspeak.db` 成为唯一实时配置源；旧文件不会被删除或改写。旧版的 `port`、`tsServerProtocol`、`maxClients` 和 `trustProxy` 不再作为运行配置。

### 健康检查、开发与验证

无需认证的健康检查：

```text
GET /health
GET /api/health
```

开发命令：

```bash
# 后端：固定监听 3040
npm run dev

# 前端：Vite 监听 5173，并将 /api 与 /ws 代理到 3040
npm run web:dev

# 前端生产构建
npm --prefix web run build

# 后端类型检查与构建
npm run build

# 自动化测试
npm test

# 依赖审计
npm audit
```

`/demo` 是不连接真实 TeamSpeak 的交互式演示页面，仅用于界面预览、录屏和前端回归，不能替代真实 TS3 / TS6 验证。

### 项目结构

```text
src/
├── admin/                   管理服务、登录、Session、邀请与运维接口
├── persistence/             SQLite schema、repository 与迁移边界
├── security/                主密钥、秘密加密、密码与开放目标策略
├── domain/                  TeamSpeak 目标地址与端口解析
└── server/                  TeamSpeak 适配器、Session、票据与语音桥

web/src/
├── views/WebClient.vue      访客端、语音空间、聊天与音频设置
├── views/AdminView.vue      管理登录、服务器、概览与运维控制台
├── composables/             WebSocket 与语音状态
└── services/                主题、本地持久化与目标解析
```

### 已知边界

- 服务端固定限制最多 100 个活动连接。
- 管理员模型目前是单管理员，不提供用户列表、角色或权限管理后台。
- 浏览器麦克风权限、HTTPS 与浏览器对音频输出设备的支持会影响最终体验。
- TeamSpeak 服务端自身的版本、协议兼容性和网络可达性不由 WebSpeak 代替管理。

### 社区

QQ群：`869500475`

加入 QQ 群获取使用帮助、版本更新和交流支持：

![WebSpeak 群聊二维码](group-chat.png)

## English

WebSpeak brings TeamSpeak voice spaces to the browser. It is a self-hosted gateway and web client for TeamSpeak 3 and TeamSpeak 6: open a link, choose a nickname, and join from a modern browser without installing a desktop client.

**Live demo:** [https://webspeak.online](https://webspeak.online)

### Changelog

#### 2026-09-03 · v0.1.3

- Added an optional WebRTC audio transport for deployments that need lower and more stable realtime voice latency.
- Added WebRTC environment configuration for the public host and a bounded UDP port range; the default deployment and default voice path remain unchanged.
- WebRTC audio now uses negotiated Opus parameters and keeps only the newest frame per speaker, preventing stale voice from accumulating during network jitter.
- Fixed duplicate playback, incomplete fallback, and leftover server-side media sessions when switching between WebRTC and the compatibility voice path.
- Fixed native Opus decoder usage and browser-side negotiated payload handling, and tightened cleanup when a connection closes.

#### 2026-09-02 · v0.1.2

- Improved the mobile browser experience across channel, member, chat, and voice surfaces; mobile member actions now use a three-dot menu while desktop keeps the context menu.
- Promoted the GitHub entry on the welcome page and added a current-version badge plus a changelog link; narrow layouts collapse text controls into icons to prevent crowding.
- Fixed alignment for the settings gear and related controls, with consistent touch sizing and visual treatment for settings, exit, and microphone actions.
- Consolidated the post-0.1.1 mobile voice controls, microphone mute replacement for focus-dependent PTT, automatic protocol detection, simplified Docker Compose startup, and live-demo documentation into this release.
- Migrated TeamSpeak directory tracking and whisper packet support into the maintained WebSpeak SDK, removing the install-time compiled SDK patch step.

#### 2026-09-02 · v0.1.1

- Consolidated and officially released the browser client, administrator console, managed invites, session operations, audit records, diagnostics, and SQLite backup support.
- Fixed late WebSpeak browser sessions missing members who joined earlier by reconciling the directory after connect and merging staged member events.
- Fixed browser sessions disconnecting after receiving a private message, and improved member context menus, hover highlighting, and speaking-state presentation.
- Added the bilingual interface, default TeamSpeak target, legacy configuration migration, and mandatory first-login password rotation.
- Removed the focus-dependent normal Space-key PTT mode and replaced it with a one-click microphone mute/unmute control on desktop and mobile; the mute state is persisted in the current browser.
- Mute now suppresses upstream microphone audio before it is sent, while VOX activation, input-device selection, volume controls, and threshold tuning remain available.
- Stabilized release publishing for Windows/Linux packages and the matching Docker image; Docker builds now build the pinned SDK dependency during installation.
- Simplified Docker Compose deployment: it uses the published image by default, creates and persists the data volume automatically, and supports changing the host port with `WEBSPEAK_PORT`.

#### 2026-08-31 · v0.1.0

- First normalized release with the browser client, TeamSpeak 3 / 6 gateway, browser audio controls, access modes, administrator operations, and AGPL-3.0-only licensing.

### Why WebSpeak

| Experience | WebSpeak's answer |
| --- | --- |
| Joining | Open a browser link and join without installing the desktop client |
| Compatibility | Supports TeamSpeak 3 and TeamSpeak 6 with automatic protocol detection |
| Connection model | The browser connects to WebSpeak over HTTPS / WSS, and WebSpeak connects to TeamSpeak |
| Access control | Fixed targets, open targets, and one-time managed invites |
| Language and theme | Chinese and English interfaces with theme switching for guests and administrators |

### Core capabilities

| Area | Included |
| --- | --- |
| Voice | Opus / PCM bridging, optional WebRTC low-latency transport, VOX activation, one-click microphone mute/unmute, connection state, reconnect feedback, and speaking indicators |
| Devices | Browser microphone and speaker selection, volume controls, live input level, and a local microphone test |
| Channels | Channel tree, channel switching, member movement, channel text chat, server events, and status display |
| Members | Online members, green speaking borders, Away state, private messages, Poke, nickname copy, and per-member volume |
| Administration | Mandatory first-login password rotation, default TeamSpeak target, site information, and real connection tests |
| Operations | Active sessions, invite creation and revocation, audit events, structured logs, diagnostics, and SQLite backup |
| Browser experience | Responsive layouts, desktop and mobile voice controls, compact scrolling regions, local favorites, and recent connections |

### Architecture

| Layer | Responsibility | Connection |
| --- | --- | --- |
| Browser session | Nickname, device, channel, member, text, and voice interactions | HTTPS / WSS → WebSpeak; optional WebRTC audio |
| WebSpeak gateway | Session management, access control, voice bridging, directory synchronization, and admin console | TeamSpeak client protocol |
| TeamSpeak 3 / 6 | Channel, member, text, and voice services | Configured host and voice port |

### Quick Start

#### Option A: Docker Compose (recommended)

Docker Compose pulls the published WebSpeak image from GitHub Container Registry by default, creates the persistent data volume automatically, and starts the service. A normal deployment does not require Node.js, native build tools, or a local Dockerfile build.

```bash
git clone https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak.git
cd WebSpeak-client-for-TeamSpeak
docker compose pull
docker compose up -d
```

Check the service and health endpoint:

```bash
docker compose ps
docker compose logs -f webspeak
curl http://127.0.0.1:3040/health
```

Then open [http://127.0.0.1:3040/](http://127.0.0.1:3040/). On the first admin login, use `admin / admin` and follow the prompt to change the password.

Runtime data is kept in the `webspeak-data` Docker volume. To upgrade, pull the new image and recreate the application container. Stop the service with `docker compose down`; do not add `-v`, because that removes the database, master key, and administrator settings.

```bash
docker compose pull
docker compose up -d
```

To pin a specific release, set the GHCR image tag to match the GitHub Release tag:

```bash
export WEBSPEAK_IMAGE=ghcr.io/echosixhiya/webspeak:v0.1.3
docker compose pull
docker compose up -d
```

The default host port is `3040`. To use another host port, set `WEBSPEAK_PORT`; the container port stays unchanged:

```bash
WEBSPEAK_PORT=3041 docker compose up -d
```

The container listens on `3040` internally. SQLite data, the installation master key, and logs are stored in `/data`. The Dockerfile is used by project CI, release assets, and developer builds; it is not the default deployment path for users.

#### Option B: Run from source (developers)

Requirements:

- Node.js `22.5.0` or newer.
- Native build tools required by `@discordjs/opus`; Linux installations typically need `python3`, `make`, and `g++`.
- An accessible TeamSpeak 3 or TeamSpeak 6 server.
- A recent Chrome or Edge release; HTTPS is recommended for production.

```bash
npm ci
npm --prefix web ci
npm --prefix web run build
npm run build
node dist/index.js
```

Then open:

```text
http://127.0.0.1:3040/
```

Use `https://127.0.0.1:3040/` when direct certificates are enabled. On first run, WebSpeak creates its SQLite database and installation master key in the data directory.

### First login and default target

1. Open `/admin`.
2. Sign in with the default account `admin / admin`.
3. Follow the prompt to set a new administrator password of at least 12 characters.
4. In **Servers**, configure the **Default TeamSpeak target** with a host and voice port.
5. Run the connection test and save the settings.

When a welcome link has no target parameters, the welcome page pre-fills the administrator's default TeamSpeak target. Invite parameters take precedence. In fixed mode, guests stay on the administrator-configured target; in open mode, guests may enter a public target that passes the network policy.

WebSpeak's web port is fixed at `3040`, and TeamSpeak's default voice port is `9987`. The web fields use separate host and voice-port inputs; legacy `host:port` and `host#port` text remains accepted by the parser.

### Access modes and invites

| Mode | Behavior | Typical use |
| --- | --- | --- |
| `fixed` | Guests cannot change the target; the server and password are managed by the administrator | Private communities and a single permanent server |
| `open` | Guests may enter a public target and a password for that session | Temporary access and multi-server entry points |
| Managed invite | An administrator creates a one-time, expiring, usage-limited, revocable link | Events, temporary rooms, and targeted sharing |

In open mode, DNS resolution is followed by blocking loopback, private, link-local, multicast, broadcast, and reserved addresses. The verified IP is used for the actual connection. Server passwords never appear in share links, browser storage, or WebSocket URLs.

### Audio and devices

Inside a voice space, the settings panel lets users:

- Choose a microphone and speaker detected by the browser.
- Mute or unmute the microphone with one click.
- Adjust input, output, notification, and VOX-threshold volumes.
- Inspect microphone permission, live input level, and audio-context state.
- Run a local microphone test of up to five seconds; the recording is played in the browser and is not sent to TeamSpeak.

Device labels are controlled by the browser permission model. The first device selection may request microphone permission. Output-device selection depends on browser support; unsupported browsers clearly fall back to the default speaker.

#### Optional WebRTC audio transport

`v0.1.3` includes an experimental WebRTC audio path that is disabled by default. It is intended for deployments that can publish a UDP port range for WebSpeak; a normal Docker deployment needs no extra configuration and continues to use the default voice path.

Set these variables when enabling it:

```bash
WEBSPEAK_WEBRTC=true
WEBSPEAK_WEBRTC_PUBLIC_HOST=<public IP or resolvable public hostname>
WEBSPEAK_WEBRTC_UDP_START=40000
WEBSPEAK_WEBRTC_UDP_END=40099
```

Publish `40000-40099/udp` to the WebSpeak container as well. If WebRTC is unavailable because of the network or browser, the client automatically falls back to the compatibility voice path.

### Data and Security Boundary

Runtime data is stored in `data/` by default and in `/data` in Docker:

```text
data/
├── webspeak.db   SQLite settings, admin credentials, invites, and bounded audit events
├── master.key    32-byte installation master key
└── logs/         Locally rotated logs
```

- Administrator passwords use Node.js `crypto.scrypt`, a random salt, and constant-time comparison.
- TeamSpeak server passwords are encrypted with AES-256-GCM; admin APIs never return them in plaintext.
- Admin sessions use server-side sessions, HttpOnly / SameSite Strict cookies, same-origin checks, and CSRF tokens.
- Admin login applies bounded-window rate limiting and failure delays.
- A user identity is used only by the current join ticket and session. When “remember this device” is enabled, the private key stays in browser IndexedDB and is not uploaded to the gateway or written to logs, diagnostics, or the database.
- WebSpeak has no identity-file import/export controls; clearing browser data removes the remembered identity and local preferences.
- Logs, diagnostic reports, and the overview do not return server passwords, admin passwords, or private identity keys.
- Back up `webspeak.db` together with `master.key`; an encrypted TeamSpeak password cannot be recovered from the database alone.

### Upgrading from a legacy version

If an old `config.json` is still present in the project root at startup, WebSpeak imports these fields once:

- `tsHost`
- `tsPort`
- `tsServerPassword`

After the import, `data/webspeak.db` is the only live configuration source. The legacy file is not deleted or rewritten. Legacy `port`, `tsServerProtocol`, `maxClients`, and `trustProxy` values are no longer runtime controls.

### Health, development, and verification

Unauthenticated health endpoints:

```text
GET /health
GET /api/health
```

Development commands:

```bash
# Backend: fixed port 3040
npm run dev

# Frontend: Vite on 5173, proxying /api and /ws to 3040
npm run web:dev

# Frontend production build
npm --prefix web run build

# Backend type check and build
npm run build

# Automated tests
npm test

# Dependency audit
npm audit
```

`/demo` is an interactive simulated page that never connects to a real TeamSpeak server. It is useful for UI previews, recordings, and frontend regression checks, but does not replace real TS3 / TS6 verification.

### Project layout

```text
src/
├── admin/                   Admin service, login, sessions, invites, and operations APIs
├── persistence/             SQLite schema, repositories, and migration boundaries
├── security/                Master key, secret encryption, passwords, and target policy
├── domain/                  TeamSpeak target and port parsing
└── server/                  TeamSpeak adapter, sessions, tickets, and voice bridge

web/src/
├── views/WebClient.vue      Guest client, voice space, chat, and audio settings
├── views/AdminView.vue      Admin login, server, overview, and operations console
├── composables/             WebSocket and voice state
└── services/                Theme, local persistence, and target parsing
```

### Known boundaries

- The server has a fixed limit of 100 active connections.
- The current administrator model is single-admin; there is no user, role, or permission-management panel.
- Browser microphone permissions, HTTPS, and browser support for output-device selection affect the final experience.
- WebSpeak does not replace TeamSpeak server version, protocol-compatibility, or network-reachability management.

### License

WebSpeak is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). If you run a modified version as a network service, provide the corresponding source under the terms of the license.

### Community

QQ group: `869500475`

![WebSpeak group QR code](group-chat.png)
