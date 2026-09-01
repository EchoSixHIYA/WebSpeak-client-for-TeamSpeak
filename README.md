# WebSpeak

WebSpeak 是一个自托管的 TeamSpeak 浏览器客户端与访客接入网关。每个浏览器 Session 都拥有独立的普通 TeamSpeak Client 连接；频道、成员和权限来自该用户自己的可见数据，不依赖 ServerQuery、WebQuery 或维护机器人。

[中文](#中文) · [English](#english) · [AGPL-3.0 License](LICENSE)

## 中文

### 当前能力

- TeamSpeak 3 / TeamSpeak 6 自动探测，无需选择协议。
- 每个浏览器 Session 独立连接，硬上限固定为 100。
- 完整频道/成员树、频道切换、频道文字聊天和成员实时移动。
- PCM/Opus 语音桥接、自由麦、按键说话、麦克风选择与音量控制。
- 发言成员头像显示绿色动态边框。
- 中英文访客页面和中英文管理控制台。
- Web 管理闭环：首次配置、单管理员登录、概览、服务器设置和真实连接测试。
- `fixed` 与 `open` 两种访问模式。
- TeamSpeak 密码使用安装级主密钥加密保存，不向管理 API 返回明文。
- 旧 `config.json` 一次性导入，导入后不再作为实时配置源。

### 环境要求

- Node.js `22.5.0` 或更高版本。
- Linux 推荐；Windows 也可用于开发和运行。
- `@discordjs/opus` 所需的原生编译工具。
- 可访问的 TeamSpeak 3 或 TeamSpeak 6 服务器。
- 较新的 Chrome 或 Edge；生产环境应使用 HTTPS。

Ubuntu / Debian：

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

Windows 请安装 Visual Studio Build Tools，并勾选“使用 C++ 的桌面开发”。

### 本地安装与启动

```bash
npm install
npm --prefix web install
npm --prefix web run build
npm run build
node dist/index.js
```

WebSpeak 内部端口固定为 `3040`。首次启动会输出一次初始化提示：

```text
WebSpeak is not initialized.
Open /admin/setup and enter bootstrap code: XXXX-XXXX-...
```

然后打开：

```text
http://127.0.0.1:3040/admin/setup
```

三步完成配置：

1. 输入启动日志中的一次性初始化代码，创建至少 12 字符的管理员密码。
2. 输入 `host[:port]` 形式的 TeamSpeak 地址和可选密码，执行真实短连接测试。
3. 选择访问模式，并设置站点名称和欢迎文本。

配置完成后初始化代码立即失效并从数据目录删除。后续管理入口为：

```text
http://127.0.0.1:3040/admin
```

管理员只有密码，没有用户名、用户列表或角色系统。

### 访问模式

`fixed` 是默认模式。访客页只显示昵称和频道，TeamSpeak 目标与服务器密码由服务端管理。

`open` 模式允许访客输入其他公网 TeamSpeak 地址和本次 Session 使用的密码。WebSpeak 会解析 DNS，并阻止 loopback、私网、链路本地、组播、广播及保留地址；实际连接使用已经验证过的 IP，避免 DNS rebinding。

访客密码只存在于一次性 Join Ticket 中，不写入 URL、本地存储或数据库。普通分享链接也不会包含密码。

### 持久化与安全

运行数据位于项目的 `data/` 目录：

```text
data/
  webspeak.db   SQLite 配置、管理员凭据和有限审计事件
  master.key    32 字节安装级主密钥
  bootstrap     仅在首次初始化完成前存在
  logs/         本地日志
```

- 管理员密码使用 Node.js `crypto.scrypt`、随机 salt 和 constant-time compare。
- TeamSpeak 服务器密码使用 AES-256-GCM 加密。
- 管理 Session 是随机服务端 Session；Cookie 为 `HttpOnly`、`SameSite=Strict`，直接 HTTPS 下同时启用 `Secure`。
- 管理 mutation 检查同源请求、JSON Content-Type、服务端 Session 与 CSRF token。
- 管理登录具有固定窗口限速和连续失败延迟。
- 日志、管理 API 和 Overview 不返回服务器密码、管理员密码或身份私钥。

请备份整个 `data/` 目录。只有数据库而没有对应 `master.key` 时，已加密的 TeamSpeak 密码无法恢复。不要提交 `data/`、`config.json`、证书、私钥或日志。

### 从旧版本升级

首次使用新版启动时，如果项目根目录存在旧 `config.json`，WebSpeak 只导入：

- `tsHost`
- `tsPort`
- `tsServerPassword`

以下字段会被忽略并废弃：

- `port`
- `tsServerProtocol`
- `maxClients`
- `trustProxy`

原文件不会被删除或改写。导入成功后，`data/webspeak.db` 成为唯一实时配置源，管理控制台会显示一次迁移提示。`config.example.json` 仅用于说明旧版迁移格式，新部署不需要复制它。

### HTTPS 与反向代理

如果项目根目录存在 `certs/cert.pem` 与 `certs/key.pem`，WebSpeak 会直接提供 HTTPS。公网部署建议由 Caddy 或 Nginx 终止 TLS，再代理到固定的 `127.0.0.1:3040`。

Nginx 示例：

```nginx
server {
    listen 443 ssl;
    server_name ts.example.com;

    ssl_certificate /etc/letsencrypt/live/ts.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ts.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3040;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

WebSpeak 不使用 `X-Forwarded-*` 作为认证或授权边界。麦克风和 WebCodecs 在公网环境需要浏览器安全上下文。

### 健康检查与开发命令

无需认证的最小健康检查：

```text
GET /health
GET /api/health
```

开发命令：

```bash
# 后端开发服务（固定 3040）
npm run dev

# 前端开发服务；/api 和 /ws 代理到 3040
npm run web:dev

# M000/M001 自动测试
npm test

# 后端类型检查与构建
npm run build

# 前端类型检查与生产构建
npm --prefix web run build

# 依赖安全审计
npm audit
```

### 项目结构

```text
src/
  admin/                         管理服务、API、Session 与登录限速
  persistence/database.ts        SQLite schema、repository 和迁移边界
  security/                      主密钥、秘密加密、scrypt、Bootstrap 与网络策略
  domain/teamspeak-target.ts     host[:port] 规范化解析
  server/teamspeak-adapter.ts    TeamSpeak 协议边界与 endpoint 协议缓存
  server/teamspeak-probe.ts      可清理的短连接测试
  server/join-ticket.ts          一次性访客连接票据
  server/voice-bridge.ts         每用户语音 WebSocket 桥接
web/src/views/
  AdminView.vue                  双语 Setup/Login/Overview/Server UI
  WebClient.vue                  双语访客与语音工作台
```

## English

WebSpeak is a self-hosted TeamSpeak web client and guest gateway. Every browser session owns an independent normal TeamSpeak client connection, so its channel/member view comes from that identity rather than a Query or maintenance account.

### Features

- Automatic TeamSpeak 3 / TeamSpeak 6 detection.
- Independent browser sessions with a fixed hard limit of 100.
- Channel/member directory, channel switching, channel text chat, and live member movement.
- PCM/Opus voice bridge, VOX, push-to-talk, microphone selection, and volume controls.
- Bilingual guest UI and bilingual admin console.
- Browser-based first setup, single-admin login, Overview, server settings, and a real short-lived connection test.
- Fixed and open guest access modes.
- Encrypted TeamSpeak server password and one-time legacy config import.
- No ServerQuery, WebQuery, admin token, or maintenance bot.

### Requirements and startup

- Node.js `22.5.0` or newer.
- Native build tools for `@discordjs/opus`.
- A reachable TS3 or TS6 server.
- A recent Chrome or Edge browser; use HTTPS in production.

```bash
npm install
npm --prefix web install
npm --prefix web run build
npm run build
node dist/index.js
```

WebSpeak always listens on internal port `3040`. On first boot, read the one-time bootstrap code from startup output and open:

```text
http://127.0.0.1:3040/admin/setup
```

Create the admin password, test the TeamSpeak target, choose the access mode, and finish setup. Future administration is performed at `/admin`; no JSON editing or restart is needed for normal setting changes.

### Security and persistence

Local state is stored under `data/` in SQLite plus a 32-byte `master.key`. Admin passwords use `crypto.scrypt`. TeamSpeak secrets use AES-256-GCM. Admin sessions are server-side with HttpOnly/SameSite Strict cookies, same-origin and CSRF checks, and fixed login throttling.

In fixed mode, guests cannot override the configured target. In open mode, arbitrary public targets are validated after DNS resolution; private, loopback, link-local, multicast, broadcast, and reserved addresses are rejected. Session passwords travel through an opaque one-time Join Ticket and are never placed in share or WebSocket URLs.

If a legacy `config.json` exists on the first upgraded start, only `tsHost`, `tsPort`, and `tsServerPassword` are imported. The original file is preserved, and SQLite becomes the sole live settings source.

### Development

```bash
npm run dev
npm run web:dev
npm test
npm run build
npm --prefix web run build
npm audit
```

### License

WebSpeak is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). If you run a modified version as a network service, you must offer its users the corresponding source code as required by the license.

### 社区 / Community

群号 / Group ID: `869500475`

![WebSpeak 群聊二维码](group-chat.png)
