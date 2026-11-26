# Cloudflare Tunnel 下的 WebSpeak 语音

本文说明“网页/信令走 Cloudflare Tunnel，媒体尽量直连 UDP”的部署方式。
核心原则：

- **WebRTC 优先直连**：浏览器直接向网关公网 IP 的 `40000–40099/UDP` 发包。
- **Tunnel 只承载 HTTPS/WSS**：Cloudflare Tunnel 不转发 UDP，不能把
  Cloudflare 代理域名当作 ICE 媒体地址。
- **TURN 只做后备**：手机流量、公司网络或 UDP 被拦时，才让媒体走
  `turn:`/`turns:`，不默认全程 `relay`。
- **CFT 是增量路径**：默认 `WEBSPEAK_VOICE_PROFILE=auto`，非可信 Cloudflare
  请求继续使用原有的 80ms 固定窗口、裸 1920 字节 PCM 和旧混音参数；只有
  经过可信 Cloudflare 代理的请求（或显式 `adaptive`）才启用自适应 buffer /
  pacer / 修正后的 RTP marker。不配置 CFT、TURN 或新变量时，直连部署保持原行为。

## 兼容性矩阵

| 部署 | 媒体路径 | 音频 profile | 需要 TURN |
| --- | --- | --- | --- |
| 直连，无 CFT | 浏览器 → 网关 UDP `40000–40099` | `legacy`（默认） | 否 |
| 直连，显式 `PROFILE=adaptive` | 同上，直连优先 | `adaptive` | 否 |
| CFT + 显式公网 IP | 浏览器 → 网关 UDP，CF 只走信令 | `adaptive` | 否 |
| CFT + 无公网媒体地址 | 无直连；兼容模式或 TURN | `adaptive` | 是（若需要 WebRTC） |
| 手机/UDP 被拦 | TURN relay 后备 | `adaptive` | 是 |

`legacy` 不是“禁用 WebRTC”，它只锁定旧音频时序和旧帧路径；WebRTC、STUN、
UDP 端口仍按原配置工作。

## 1. 管理控制台与部署检查

### 1.1 管理控制台（推荐）

管理台“服务器 → 语音”提供与部署相关的全部开关，不再需要仅为 CFT/TURN
修改环境变量：

- **语音模式**：`自动`（推荐，直连走 `legacy`、可信 Cloudflare 代理走
  `adaptive`）、`兼容模式`、`自适应`。
- **兼容模式 Opus**：仅 `adaptive` 生效，默认关闭；浏览器不支持时自动回退
  PCM。
- **自适应 jitter 上限**：80–500 ms，配置自适应缓冲目标的上限；它不是严格的
  播放前瞻上限，调低也不会恢复旧版超限 `clear()` 行为。
- **TURN 后备**：TURN REST URL、共享密钥和凭证有效期。TURN 只在直连 UDP
  失败后使用，不作为默认路径。

保存后对**新的语音连接**生效，不需要重启网关。配置持久化在数据库中：控制台
非空值覆盖对应环境变量，未配置的字段继续继承环境变量；清空 TURN URL 或在
控制台移除密钥会显式停用 TURN。TURN 共享密钥使用网关主密钥加密存储，管理
API 只返回“是否已配置”，不会把明文回传浏览器。

静态 `WEBSPEAK_VOICE_ICE_SERVERS` 以及浏览器/网关的 `transportPolicy` 仍由
环境变量控制，控制台刻意不提供“全程 relay”开关，避免误把直连优先改成中继
优先；需要排障时再临时设置环境变量并重启。

Cloudflare 判定只接受来自 `WEBSPEAK_TRUSTED_PROXIES` 中直接相邻代理的
`cf-ray`、`cf-connecting-ip` 或包含 `cloudflare` 的 `cdn-loop`。默认只信任
本机回环地址；cloudflared 若从其他地址连接，应把其来源 IP/CIDR 加入该变量。
直连客户端自行注入这些头不会被当作 Cloudflare，也不会切换到 `adaptive`。

### 1.2 部署检查清单

1. 管理台“服务器 → 语音”先选 `自动`，再在“高级参数 → 公网媒体地址”填写网关的**公网 IP**，例如 `192.0.2.10`，不要填 Cloudflare 的代理域名。保存后重新连接。
2. 主机防火墙/安全组放行 `40000–40099/UDP`，并确认云厂商安全组也放行。
3. 如果网关本身在 NAT 后面，需要把 UDP 端口映射到网关，或给网关一个
   可直连的公网地址；仅做 TCP 端口映射不够。
4. `webrtc_public_host` 为空时，直连部署仍可按请求入口推断；但通过
   Cloudflare 的请求不会再拿 CF 边缘 `Host` 当 ICE 地址，避免“看起来
   配置好了、实际没有媒体路径”。Cloudflare 场景请显式填写公网媒体地址。

## 2. 服务端环境变量

在启动 WebSpeak 的环境里设置；修改后重启进程，并对新连接生效。控制台已保存
的非空语音配置优先于这里的环境变量；控制台留空的字段才继承环境变量。日常
CFT/TURN 调整建议直接用控制台，避免同时维护两套配置。

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `WEBSPEAK_VOICE_PROFILE` | `auto` | `auto`：非可信 Cloudflare 请求用 `legacy`，可信 Cloudflare 代理请求用 `adaptive`；也可显式 `legacy`/`adaptive`。非 CFT 不配置时保持原行为。 |
| `WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY` | `all` | 浏览器 ICE 策略。直连优先保持 `all`；只有确认 UDP 完全不可用才设 `relay`。 |
| `WEBSPEAK_VOICE_GATEWAY_ICE_TRANSPORT_POLICY` | `all` | werift 网关侧策略。网关自身在 NAT 后才考虑 `relay`。 |
| `WEBSPEAK_VOICE_ICE_SERVERS` | 空 | 静态 ICE 列表，JSON 数组或逗号分隔的 STUN URL；最多 8 个。 |
| `WEBSPEAK_TURN_REST_URLS` | 空 | coturn REST 的 `turn:`/`turns:` URL，逗号分隔；最多 8 个。 |
| `WEBSPEAK_TURN_REST_SECRET` | 空 | 与 coturn `static-auth-secret` 相同的密钥，至少 16 字符才启用。 |
| `WEBSPEAK_TURN_REST_TTL_SECONDS` | `21600` | TURN 临时凭证有效期，范围 300–86400。 |
| `WEBSPEAK_VOICE_OPUS_WS` | `0` | 兼容模式是否允许浏览器用 WebCodecs 发 Opus；仅 `adaptive` 且环境变量或控制台显式启用时生效，不支持时自动回退 PCM。 |
| `WEBSPEAK_VOICE_JITTER_MAX_MS` | `300` | 自适应 jitter buffer 的上限，范围 80–500；仅 `adaptive` 生效。 |

示例（直连优先 + TURN 后备）：

```bash
WEBSPEAK_VOICE_PROFILE=auto
WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY=all
WEBSPEAK_VOICE_GATEWAY_ICE_TRANSPORT_POLICY=all
WEBSPEAK_TURN_REST_URLS='turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp'
WEBSPEAK_TURN_REST_SECRET='<与 coturn 相同的密钥>'
WEBSPEAK_TURN_REST_TTL_SECONDS=21600
```

直连部署若也想启用自适应 buffer / pacer，显式设置
`WEBSPEAK_VOICE_PROFILE=adaptive`；这会改变非 CFT 的音频时序，但不是开通
CFT 的必选项。

`turn:` 的 UDP/TCP 3478 适合大多数场景；如已给 coturn 配好证书，可再加
`turns:turn.example.com:5349?transport=tcp`。TURN 的 relay 端口默认
`49160–49200/UDP`，与 WebRTC 的 `40000–40099/UDP` 分开，见
`deploy/coturn/`。

### 关于 werift 与 `turns:`

已核对 `werift` 源码：`parseIceServers` 会把 `turns:` 解析为
`turnTransport: "tls"`，`createTurnClient` 走 `TlsTransport`；
`iceUseTcp: false` 只影响 ICE-TCP host candidate 的收集，不会阻止 TURN 的
TLS 控制连接。因此 `turns:` 在 `iceUseTcp: false` 下仍可用。该结论是源码
级核实，未在真实 coturn 上做端到端联调。

## 3. 兼容模式（PCM/Opus over WebSocket）

兼容模式不依赖 UDP，任何部署都可用。以下自适应/Opus/pacer 只在
`voiceProfile=adaptive` 时生效；`legacy` 直连保留原来的 80ms 固定窗口，
超过窗口会 `clear()` 解码器并重建，和旧版一致。

自适应分支：

- jitter buffer：目标超前量按到达 jitter 估算，初始 80ms，上限默认
  300ms；溢出时只重排播放头、保留 `AudioDecoder`，不再每次超过 80ms
  就销毁解码器。
- 解码队列硬上限 12；只有极深积压才丢最新帧。
- 上行 20ms pacer；新帧格式 `0x01 + PCM` 和 `0x02 + Opus`，旧 1920 字节
  PCM 仍兼容。
- 仅当 `adaptive` 且环境变量或控制台显式启用 Opus，同时浏览器支持
  WebCodecs 时才发 Opus，否则自动回退 PCM。

legacy 分支：

- 80ms 固定播放窗口；超限清空当前 speaker 的 source 和 decoder。
- 浏览器发送裸 1920 字节 PCM，不创建 Opus encoder。
- 服务端不启用 pacer；WebRTC 混音保持 4 帧队列和每包 marker。

验证：

1. 在 Chrome/Edge 打开 `chrome://webrtc-internals`：已下发 WebRTC offer 后
   若建连或传输失败，页面应留在当前 TeamSpeak/WebSocket 会话，自动恢复
   PCM/Opus over WebSocket 的上下行兼容音频（上行需要已有麦克风权限），
   同时显示 `WEBRTC_FAILED` 和“重新连接 WebRTC”。
2. 点击“重新连接 WebRTC”只重试 WebRTC，不重新连接 TeamSpeak，也不新建
   语音 WebSocket。重连协商期间保持兼容收发；只有 WebRTC 真正 ready 后才
   停止兼容传输、清除失败横幅和按钮。再次失败则继续兼容保通话，横幅和
   按钮保留。
3. 网关未 advertise WebRTC 的禁用、浏览器不支持或 `NO_MEDIA_PATH` 路径仍
   直接使用兼容模式，不显示这块 WebRTC 失败按钮。
4. 在管理台或日志看 `audio.opus` trace：`active` 表示 Opus 已启用，
   `pcm-fallback` 表示回退。
5. 连续说话 2–3 分钟，观察是否还有周期性“整段静音/重启”式卡顿；新
   逻辑不应再因 80ms 硬窗口反复 `clear()`。

## 4. 验收与回滚

**验收顺序**

1. 同一网络下先用直连 UDP：`chrome://webrtc-internals` 选中 pair 应为
   `host`/`srflx`，不是 `relay`。
2. 手机 4G/5G 或关 UDP 的 Wi-Fi 再测：没有直连时才会出现 `relay`，且
   音频可通。
3. 对未下发 WebRTC 的路径（关闭 WebRTC、无媒体路径或浏览器不支持）测
   2–3 分钟兼容模式。确认连接
   `connected` 消息中的 `voiceProfile` 为 `adaptive` 后，`bufferResets`
   不应持续增长、没有解码器反复重建；若为 `legacy`，看到旧 80ms 行为是
   预期的。

**回滚**

- 恢复非 CFT 旧行为：在管理台“语音模式”选 `兼容模式`，或设置
  `WEBSPEAK_VOICE_PROFILE=legacy`（没有控制台覆盖时）。legacy 会恢复
  80ms/`clear()`、裸 PCM、旧 WebRTC mixer；不需要回退前端构建。
- 关闭兼容模式 Opus：在管理台取消“兼容模式使用 Opus”，或设置
  `WEBSPEAK_VOICE_OPUS_WS=0`；注意只有 `adaptive` 会下发 Opus 能力。
- 限制 jitter 缓冲：管理台把“自适应 jitter 上限”调到 80，或设置
  `WEBSPEAK_VOICE_JITTER_MAX_MS=80`；这只是把上限压回 80ms，**不会恢复
  旧版“超过 80ms 就 `clear()` 解码器”的行为**。要完全回到旧行为，使用
  `兼容模式` / `legacy`。
- 关闭 TURN：在管理台清空 TURN URL（或移除密钥，会同时清空 URL），或删除
  `WEBSPEAK_TURN_REST_URLS` / `WEBSPEAK_TURN_REST_SECRET` 环境变量；浏览器
  只保留直连/STUN；不要为了“排障”把
  `WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY` 改成 `relay`，那会掩盖直连问题。
- 媒体地址配置错误时，先清空管理台“公网媒体地址”并确认非 Cloudflare
  直连入口，再检查防火墙；Cloudflare 请求下留空会禁用直连，需要 TURN。
- 数据库结构升级：本构建首次启动会把数据库迁移到 schema 14。旧版本二进制
  会拒绝 schema 14，因此回退二进制前必须先恢复升级前的数据库备份及对应的
  `master.key`；只回退代码、保留 schema 14 数据库会导致旧版本无法启动。

## 5. 已知限制

- 本文的 coturn/cloudflared 模板未做真实端到端联调；部署前必须在
  目标网络验证 `3478/UDP`、`3478/TCP`、relay 端口和凭证一致性。
- Safari/Firefox 的 WebCodecs Opus 支持差异未在真实设备上逐一验证；
  不支持时会回退 PCM，但兼容模式的 CPU/带宽开销会更高。
- Cloudflare Tunnel 不承载本文的 WebRTC UDP 媒体；即使 HTTPS/WSS 正常，
  仍需要独立可达的公网媒体地址，或配置 TURN/使用兼容模式。
