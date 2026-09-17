# WebSpeak · 简体中文

[返回项目首页](../README.md) · [English](./README.en.md) · [Deutsch](./README.de.md) · [Русский](./README.ru.md) · [日本語](./README.ja.md)

WebSpeak 是一个可自行部署的 TeamSpeak 3 / TeamSpeak 6 网页客户端与语音网关。用户无需安装桌面客户端即可从浏览器加入频道，管理员可以在控制台管理目标服务器、访问方式和运行状态。

## 在线 Demo

地址：<https://webspeak.online>

公共 Demo 位于香港，网络和负载可能不稳定。延迟、断线或暂时不可用不代表自行部署后的实际表现。

## ✨ 特性

| 能力 | 说明 |
| --- | --- |
| TeamSpeak 兼容 | 支持 TeamSpeak 3 与 TeamSpeak 6，并自动探测目标服务器协议。 |
| IPv6 目标 | 默认支持 IPv6 TeamSpeak 目标和域名解析出的 IPv6 地址。 |
| 频道与成员 | 浏览频道树、查看实时成员状态并切换频道。 |
| 实时语音 | 使用 Opus，支持兼容传输和可选的内置 WebRTC 低延迟传输。 |
| 音频控制 | 选择麦克风与扬声器、调节音量、测试麦克风、闭麦、VOX 和成员独立音量。 |
| 消息与互动 | 支持频道消息、服务器消息、私聊、戳一戳和耳语目标。 |
| 桌面端伴奏 | 在桌面浏览器选择带音频的窗口或标签页，将声音分享给当前频道。 |
| 身份与访问 | 支持身份保持、访客自定义目标和可撤销、可过期的邀请链接。 |
| 管理控制台 | 管理目标、访问策略、WebRTC、中继、邀请、会话、日志、诊断和备份。 |
| 界面体验 | 提供中文、English、Deutsch、Русский、日本語、浅色/深色主题及响应式桌面/移动布局。 |
| 自托管 | 数据由部署者保存，提供 Docker、Windows x64 和 Linux x64 方案。 |

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
| 发布包 | 不安装 Node.js 和构建依赖 | Windows x64 或 Linux x64 |
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

从 [GitHub Releases](https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/releases/latest) 下载对应的 `windows-x64.zip` 或 `linux-x64.tar.gz`，解压后运行 Windows 的 `start-webspeak.cmd` 或 Linux 的 `./start-webspeak.sh`。发布包自带 Node.js 运行时和生产依赖。

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
