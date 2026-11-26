# Cloudflare Tunnel 语音兼容性说明

## 范围

本文件说明网页/信令通过 Cloudflare Tunnel、WebRTC 媒体尽量直连 UDP 的兼容性
改动。默认行为是 `WEBSPEAK_VOICE_PROFILE=auto`：

- 非 Cloudflare 请求保持 `legacy`：80ms 固定窗口、超限 `clear()`、裸
  1920-byte PCM、旧 WebRTC mixer。
- 只有来自受信任代理且带 Cloudflare 标记的请求才自动进入 `adaptive`。
- 显式 `legacy` 或 `adaptive` 覆盖自动判定。
- TURN 是可选后备，不默认强制 `relay`。

本文件是内部实现说明，不代表整体验收、发布或实际部署证明。

## 主要改动

### WebRTC、ICE 与回退

- `src/server/voice-ice-config.ts`：支持静态 ICE、TURN REST、浏览器/网关
  transport policy、语音 profile、Opus WebSocket 和 jitter 上限。
- `src/server/turn-credentials.ts`：按 coturn `use-auth-secret` 生成短期凭证。
- `src/server/voice-bridge.ts`：仅当直接相邻代理位于
  `WEBSPEAK_TRUSTED_PROXIES` 中时，才根据 `cf-ray`、`cf-connecting-ip` 或
  `cdn-loop` 判定 Cloudflare。直连客户端注入这些头不会改变 profile。
- Cloudflare 请求不再把 Tunnel `Host` 当作 ICE 媒体地址。未配置公网媒体
  地址且没有 TURN 时返回 `NO_MEDIA_PATH`，浏览器使用兼容传输。
- 已下发 WebRTC 后建连或传输失败会自动恢复 PCM/Opus over WebSocket 的
  上下行兼容音频，页面留在当前 TeamSpeak/WebSocket 会话；上行需要已有
  麦克风权限。横幅继续使用 `WEBRTC_FAILED`，并保留“重新连接 WebRTC”。
- “重新连接 WebRTC”只重试 WebRTC，不调用整段连接流程、不新建语音
  WebSocket。重连期间保持兼容收发，等 `onReady` 后才停止兼容音频并清除
  失败横幅和按钮，避免双路音频或切换静音。
- 重连再次失败时继续留在兼容模式保通话，横幅和按钮保留。网关未
  advertise WebRTC 的既有兼容路径不变，也不显示这块失败按钮。
- `src/server/webrtc-audio.ts` 与 `web/src/voice/webrtc-transport.ts`：浏览器
  和网关使用完整 ICE 列表；无 TURN 的 `relay` 策略快速失败。
- 已从 werift 源码确认 `turns:` 使用 TLS 控制连接；未做真实 coturn 端到端
  联调。

### 兼容模式音频

- `legacy` 保留旧播放窗口、解码器重建、裸 PCM、4 帧 mixer 队列和每包
  marker。
- `adaptive` 使用 `web/src/voice/jitter-buffer.ts`、可选服务端 pacer 和可选
  Opus-over-WebSocket；Opus 默认关闭。
- `web/src/voice/opus-uplink.ts` 使用 WebCodecs Opus；不支持或失败时回退 PCM。
- Safari/Firefox 的 Opus 行为未逐台真机验证。

### 管理台与持久化

- 管理台“服务器 → 语音”提供 profile、Opus、jitter 上限和 TURN REST 配置。
- 非空控制台值覆盖环境变量；未修改字段保持数据库 `NULL`，继续继承环境变量。
- 清空 TURN URL 或移除密钥会显式停用环境变量中的 TURN REST。
- TURN 密钥使用网关主密钥加密存储，API 只返回是否已配置。
- 无关设置保存不会把未修改的语音字段写成控制台覆盖值。

## 示例配置

```bash
WEBSPEAK_VOICE_PROFILE=auto
WEBSPEAK_VOICE_ICE_TRANSPORT_POLICY=all
WEBSPEAK_VOICE_GATEWAY_ICE_TRANSPORT_POLICY=all
WEBSPEAK_VOICE_JITTER_MAX_MS=300
WEBSPEAK_VOICE_OPUS_WS=0
WEBSPEAK_TURN_REST_URLS='turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp'
WEBSPEAK_TURN_REST_SECRET='<replace-with-demo-secret>'
WEBSPEAK_TURN_REST_TTL_SECONDS=21600
```

公网媒体地址示例使用 `192.0.2.10`；实际部署必须替换为可直接通过 UDP 到达的
地址。Cloudflare Tunnel 不转发 WebRTC UDP，也不能作为媒体地址。

## 数据库与回滚

- 本构建把数据库迁移到 schema 14。schema 13→14 只新增可空的语音覆盖列，
  现有行继续继承环境变量；新数据库仍从 schema 1 顺序迁移。
- 旧版本二进制会拒绝 schema 14。升级前应备份数据库及对应的 `master.key`；
  回退二进制时必须恢复匹配的备份。只回退代码而保留 schema 14 数据库会导致
  旧版本无法启动。
- 恢复非 Cloudflare 旧音频行为：选择 `legacy`，或确保没有控制台覆盖后设置
  `WEBSPEAK_VOICE_PROFILE=legacy`。
- 关闭 Opus：取消控制台选项或设置 `WEBSPEAK_VOICE_OPUS_WS=0`。
- 关闭 TURN：清空 TURN URL/移除密钥，或删除对应环境变量。

## 验证边界

- coturn/cloudflared 模板未在真实目标网络端到端联调。
- TURN 的 UDP/TCP/TLS、relay 端口和凭证一致性仍需在目标网络验证。
- Safari/Firefox WebCodecs Opus 与真实浏览器 jitter 表现仍需设备测试。
- 自动化测试和构建结果以本次审查的测试记录为准；历史报告中的通过数量
  不应被视为本次独立复跑结果。
