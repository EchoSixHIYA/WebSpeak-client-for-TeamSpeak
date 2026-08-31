# WebSpeak

TeamSpeak 浏览器客户端：在服务器上运行 Node.js 服务，用户无需安装 TeamSpeak 客户端，即可通过浏览器加入语音频道。

[English](#english) · [中文](#中文) · [AGPL-3.0 License](LICENSE)

## English

WebSpeak is a self-hosted browser client and gateway for TeamSpeak 3 and TeamSpeak 6. Each browser session receives an independent TeamSpeak client that maintains its own visible channel/member directory and relays voice through WebSocket.

### Highlights

- Low-latency PCM/Opus voice relay
- VOX open microphone and Space-key push-to-talk modes
- Browser microphone enumeration and device switching
- Channel switching with a complete channel/member tree, including empty channels
- Per-member playback volume controls
- Speaking members are highlighted with a live green avatar border
- Text chat, invite-link sharing, and persistent Chinese/English UI switching
- No WebQuery/SSH Query dependency and no invite token
- Editable TeamSpeak server address and voice port on the web join screen
- No browser plugin or desktop TeamSpeak client required

### Requirements

- Linux server recommended; Windows is also supported
- Node.js 22 or newer
- A reachable TeamSpeak 3 or TeamSpeak 6 server
- A recent Chrome or Edge browser
- HTTPS in production: microphone access and WebCodecs require a secure context

### How it works

```text
Browser                         WebSpeak                         TeamSpeak
┌────────────────────┐         ┌──────────────────────┐         ┌──────────┐
│ Microphone → PCM   │ ──────▶ │ Per-user voice client│ ──────▶ │          │
│ AudioDecoder       │ ◀────── │ PCM ↔ Opus bridge    │ ◀────── │ Server   │
│ Vue web client      │ ◀ JSON  │ Live directory      │ ◀────── │          │
└────────────────────┘         │ welcome snapshot +  │         └──────────┘
                               │ live events         │
                               └──────────────────────┘
```

### Quick start

#### 1. Install dependencies

```bash
# Native build tools are required by @discordjs/opus.
sudo apt-get update
sudo apt-get install -y build-essential python3

npm install
npm --prefix web install
```

On Windows, install Visual Studio Build Tools with **Desktop development with C++** before running `npm install`.

`npm install` runs the SDK patch automatically. It adds a `directorySnapshot` event to the installed protocol package so the gateway can use the same welcome data as a native client.

#### 2. Build

```bash
npm --prefix web run build
npm run build
```

The build output is written to `web/dist/` and `dist/`.

#### 3. Configure `config.json`

Copy `config.example.json` to `config.json` in the project root, then edit the values. Keep `config.json` private because it may contain TeamSpeak credentials.

```json
{
  "tsHost": "127.0.0.1",
  "tsPort": 9987,
  "tsServerPassword": ""
}
```

| Field | Description |
| --- | --- |
| `tsHost` | TeamSpeak server address. Use `127.0.0.1` when it runs on the same host. |
| `tsPort` | TeamSpeak voice port, commonly `9987`. |
| `tsServerPassword` | TeamSpeak server password, if required. |

WebSpeak listens on the fixed internal port `3040` and accepts at most `100` active browser sessions; change the external port in Docker or the reverse proxy. TS3/TS6 is detected automatically by the TeamSpeak adapter. The join page includes a **Setup guide** button and generates a copyable `config.json` preview from the TeamSpeak address, voice port, and optional password. A browser cannot write files on the server, so save the copied JSON as `config.json` in the project root and restart WebSpeak after changing it.

When an older `config.json` contains `port`, `tsServerProtocol`, `maxClients`, or `trustProxy`, WebSpeak reads the TeamSpeak target and password, ignores those implementation controls, and rewrites the file in the normalized three-field shape above.

WebSpeak uses each user's regular TeamSpeak client connection for both voice and directory data. TeamSpeak sends the initial channel/member snapshot during the normal client welcome sequence; WebSpeak then subscribes that regular client to the complete channel tree, just as a native client does, and applies channel/member notifications immediately afterward. A member moving out of the current channel is retained and reassigned to the target channel instead of being mistaken for a server disconnect. WebSpeak does not start a maintenance client and does not call the permission-restricted `channellist` or `clientlist` commands. The visible result is the same view available to that TeamSpeak identity.

The connected layout keeps the member/channel tree on the left. During the first connection, WebSpeak uses the current channel ID from TeamSpeak's welcome sequence to place the web client in the actual default channel instead of a placeholder group. The small speaking indicator is status-only: it is not a mute control. The avatar border turns green while a voice packet is active, then fades after the stream becomes quiet.

#### 4. Enable HTTPS

WebSpeak automatically serves HTTPS when `certs/cert.pem` and `certs/key.pem` exist:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=your-domain.example"
```

For public use, prefer a trusted certificate from Let's Encrypt or terminate TLS at Nginx. Do not commit private keys to Git.

#### 5. Start WebSpeak

```bash
node dist/index.js
```

Open:

```text
https://your-domain.example:3040/
```

Enter the TeamSpeak server address, voice port, and nickname on the page. The browser will request microphone permission. Open **Audio settings** to select a specific microphone, change input/output volume, or run the real microphone-level test.

The connected page keeps its controls in the header so the chat viewport remains unobstructed. Microphone mode selection (free microphone or push-to-talk) is available in **Audio settings**.

### Production deployment

Example systemd unit:

```ini
[Unit]
Description=WebSpeak TeamSpeak browser gateway
After=network.target

[Service]
Type=simple
User=teamspeak
WorkingDirectory=/opt/webspeak
ExecStart=/usr/bin/node /opt/webspeak/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable it with:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now webspeak.service
sudo systemctl status webspeak.service
```

If Nginx terminates HTTPS, leave `certs/` absent so WebSpeak listens over local HTTP, then proxy both normal traffic and WebSocket upgrades:

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

WebSpeak does not use forwarded headers as an authentication or authorization boundary. Keep the gateway behind a trusted reverse proxy and configure the proxy to forward WebSocket upgrades.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Microphone is unavailable | Use HTTPS, grant the browser microphone permission, and check the selected device in Audio settings. |
| Only the default microphone appears | Reload after granting permission; browser device labels are hidden until permission is granted. Disconnect/reconnect if the device was plugged in later. |
| Channel/member list is empty | Check the TeamSpeak address and voice port. The directory is populated from the normal client welcome sequence. |
| The channel directory is still loading | Keep the page connected briefly while the welcome snapshot arrives. Later member and channel changes are pushed to the page automatically in real time. |
| The current user is missing | Keep the connection open until the TeamSpeak welcome snapshot arrives. WebSpeak uses the current channel ID to place the user in the default channel, then updates the tree from realtime member notifications. |
| Page loads without audio | Use a recent Chrome/Edge build, verify HTTPS, and check browser output volume. |
| `Cannot find module '@discordjs/opus'` | Install the native build prerequisites and run `npm install` again. |
| `EADDRINUSE` | Stop the process already listening on fixed port `3040`, or change the external proxy/container port. |

### Project layout

```text
src/
  domain/teamspeak-target.ts  Normalized host[:port] parsing and endpoint keys
  server/teamspeak-adapter.ts TS3/TS6 negotiation boundary and protocol cache
  errors.ts                    Normalized connection error model
  server/voice-bridge.ts       WebSocket bridge and per-user voice clients
  server/ts-client.ts          TeamSpeak protocol adapter and live directory adapter
config.example.json            Safe starting configuration; copy to config.json
scripts/
  patch-teamspeak-sdk.mjs      Preserve TeamSpeak welcome directory data
web/
  src/views/WebClient.vue      Browser UI and bilingual presentation
  src/composables/useVoiceWebSocket.ts
                               Voice, chat, device and channel state
```

### Development

```bash
# Frontend hot reload
npm run web:dev

# Type-check and production-build frontend
npm --prefix web run build

# Type-check backend
npm run build

# Run M000 unit tests
npm test
```

Contributions and issue reports are welcome. Please do not include `config.json`, certificates, private keys, or server logs in issues or pull requests.

### License

WebSpeak is released under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). If you run a modified version as a network service, you must offer its users the corresponding source code as required by the license.

## 中文

WebSpeak 是一个自托管的 TeamSpeak 浏览器客户端。服务运行在服务器上，用户无需安装 TeamSpeak 客户端，打开网页即可加入语音频道。每个网页用户拥有独立的 TeamSpeak 连接，并使用自己的可见频道和成员信息。

### 主要功能

- 低延迟 PCM/Opus 语音转发
- 自由麦（VOX）与空格键按键说话
- 枚举并切换浏览器真实麦克风设备
- 频道切换与完整频道/成员树，空频道也会显示
- 为每个成员单独调整播放音量
- 正在发言的成员头像实时显示绿色边框
- 文字聊天、邀请链接分享、中英文界面切换
- 不依赖 WebQuery/SSH Query，不使用邀请 token
- 网页端直接设置 TeamSpeak 地址和语音端口
- 不需要浏览器插件或桌面版 TeamSpeak 客户端

### 环境要求

- 推荐 Linux 服务器，也支持 Windows
- Node.js 22 或更高版本
- 可访问的 TeamSpeak 3 或 TeamSpeak 6 服务器
- 较新的 Chrome 或 Edge 浏览器
- 生产环境使用 HTTPS；浏览器麦克风和 WebCodecs 都要求安全上下文

### 快速开始

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y build-essential python3

# 安装服务端和前端依赖
npm install
npm --prefix web install

# 构建前端和后端
npm --prefix web run build
npm run build
```

将项目根目录的 `config.example.json` 复制为 `config.json`，再按实际环境修改。`config.json` 可能包含服务器密码，请勿提交到 Git：

```json
{
  "tsHost": "127.0.0.1",
  "tsPort": 9987,
  "tsServerPassword": ""
}
```

关键配置：

- `tsHost`：TeamSpeak 地址；同机部署使用 `127.0.0.1`。
- `tsPort`：语音端口，通常为 `9987`。
- `tsServerPassword`：TeamSpeak 服务器密码，没有密码时留空。

WebSpeak 内部监听端口固定为 `3040`，最多接受 `100` 个活动网页 Session；外部端口请在 Docker 或反向代理层修改。TS3/TS6 由 TeamSpeak Adapter 自动检测，不需要在配置或网页中选择协议。加入页面提供“配置引导”按钮，可以根据页面中填写的服务器地址、语音端口和可选密码生成可复制的 `config.json` 预览。浏览器不能直接写入服务器文件，请将复制的内容保存到项目根目录的 `config.json`，再重启 WebSpeak。

如果旧版 `config.json` 中仍有 `port`、`tsServerProtocol`、`maxClients` 或 `trustProxy`，WebSpeak 会读取其中的 TeamSpeak 地址和密码，忽略这些实现细节，并在启动时将文件改写为上面的三项配置。
WebSpeak 使用每个网页用户自己的普通 TeamSpeak 客户端连接获取语音和目录数据，不连接 WebQuery/SSH Query，也不启动维护客户端。TeamSpeak 会在普通客户端登录握手阶段下发频道和成员快照；随后 WebSpeak 会像原生客户端一样订阅完整频道树，并实时应用频道/成员通知。成员切换到其他频道时会被移动到目标频道，不再被误判为退出服务器。不会主动调用受权限限制的 `channellist` 或 `clientlist` 命令，显示内容与该 TeamSpeak 身份实际可见的内容一致。

进入后的成员/频道树位于页面左侧。首次进入时，WebSpeak 会使用 TeamSpeak 欢迎握手中返回的当前频道 ID，把自己放入实际所在的默认频道；不会把已进入默认频道的用户显示到错误的占位分组。“正在语音中”旁边不再使用没有功能的禁麦图标；它只是状态提示，真正发言时头像边框会实时变绿，停止发声后自动恢复。

配置好证书后启动：

```bash
node dist/index.js
```

访问：

```text
https://你的域名或IP:3040/
```

在页面中填写 TeamSpeak 地址、语音端口和昵称。首次使用时允许浏览器访问麦克风。进入语音空间后，打开“音频设置”即可选择具体麦克风、调整输入/输出音量并进行真实麦克风电平测试。

连接后的控制项统一放在顶部，不再遮挡聊天区域；“自由麦”和“按键说话”可以在“音频设置”中切换。

### HTTPS 与反向代理

如果项目根目录存在 `certs/cert.pem` 和 `certs/key.pem`，WebSpeak 会直接提供 HTTPS。公网部署建议使用 Let's Encrypt，或让 Nginx 终止 HTTPS 后反向代理到 `http://127.0.0.1:3040`，并转发 WebSocket 升级请求。WebSpeak 不使用转发头作为认证或授权边界，请确保网关只位于可信反向代理之后。

### 常见问题

- **无法使用麦克风**：确认使用 HTTPS、已经允许浏览器访问麦克风，并在“音频设置”中检查设备。
- **只能看到默认麦克风**：授权前浏览器会隐藏设备名称；授权后刷新页面，或重新连接一次。
- **频道/成员列表为空**：检查网页中的 TeamSpeak 地址和语音端口；协议会自动检测，目录来自普通客户端登录握手数据。
- **频道/成员目录仍在加载**：保持页面连接，等待登录握手快照到达；之后成员和频道变化会自动实时推送到页面。
- **首次进入看不到自己**：保持连接直到 TeamSpeak 欢迎握手完成；WebSpeak 会根据当前频道 ID 将自己归入默认频道，并在频道成员变化时实时更新。
- **没有声音**：使用较新的 Chrome/Edge，通过 HTTPS 访问，并检查浏览器输出音量。
- **原生 Opus 模块安装失败**：安装 `build-essential python3` 后重新执行 `npm install`。

### 开发命令

```bash
# 前端热更新
npm run web:dev

# 前端类型检查并构建
npm --prefix web run build

# 后端 TypeScript 构建
npm run build

# 运行 M000 单元测试
npm test
```

请不要在 Issue 或 Pull Request 中提交 `config.json`、API 密钥、证书、私钥或服务器日志。

### 许可证

本项目仅按 [GNU Affero General Public License v3.0](LICENSE)（`AGPL-3.0-only`）授权。如果你将修改版作为网络服务运行，必须按照许可证要求向服务用户提供对应源代码。

如果 WebSpeak 对你有帮助，欢迎在 GitHub 点一个 Star。维护者：[EchoSixHIYA](https://github.com/EchoSixHIYA)。

### 加入交流群

扫描下方二维码加入群聊（群号：`869500475`）：

![WebSpeak 群聊二维码](group-chat.png)
