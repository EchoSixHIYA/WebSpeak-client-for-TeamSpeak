# 锁屏通话实验 / Experimental lock-screen calls

此功能目前只用于 dev 分支实验，默认关闭。它改善浏览器的音频路径，不能保证浏览器或操作系统允许锁屏后一直录音、联网或播放。尚未完成 Android/iOS 真机锁屏验收。

## 使用

在音频配置中开启“锁屏通话（实验性）”，然后断开并重新进入语音房间。设置只在下次连接生效，通话中修改不会突然更换麦克风路径。需要网关及浏览器支持 WebRTC。没有 WebRTC 或协商失败时，回退到原有兼容传输，音频配置中的原生模式提示会消失。

原生模式直接发送系统麦克风音轨，并用浏览器原生 `<audio srcObject>` 接收。浏览器的回声消除、标准降噪仍可使用；RNNoise 强降噪、软件输入增益、客户端音量计、语音阈值和伴奏不参与这条路径。非零输入增益不会缩放声音，0% 仍禁止发送。此模式持续发送未静音的麦克风，请在不需要说话时静音。静音同时控制音轨与网关的麦克风状态。关闭实验选项并重新连接可恢复普通处理。

支持的浏览器会显示系统媒体控制。Pause 同时静音麦克风及接收声音；Play 只恢复接收，不解除麦克风静音。麦克风切换需要明确操作，Stop/Hang up 会结束连接并释放采集。在支持 Audio Session API 的平台上声明 `play-and-record`，离开时恢复之前的类型。系统暂停或结束音轨时，音频配置会显示中断提示。

## 实现与边界

- 普通模式保留现有 Web Audio、WebRTC 与 PCM 回退。原生模式不创建麦克风的 AudioContext、AudioWorklet、分析器或混音节点。
- 远端原生音频的 `play()` 不再等待采集 AudioContext 的 `resume()`；未完成的恢复请求不会连带阻塞收听。
- 返回前台和系统 Play 只重试当前会话的播放。它们不会重新申请麦克风、取消静音或重新建立已结束的通话。
- Media Session 是系统控制接口，不是后台保活权限。PWA、Service Worker、屏幕常亮都不能绕过系统限制；不播放静音文件或伪造音乐来保活。
- WebSocket 兼容模式仍依赖 JavaScript 解码与 Web Audio，不作锁屏持续通话保证。真实语音需要持续网络连接，不能像音乐文件那样提前缓冲。
- Android APK 目前仍为 WebView 与嵌入式网关。这次未添加原生前台音频服务，也未完成 APK 后台双向语音验收。

## 验证

自动化测试覆盖原始音轨发送、静音、权限请求取消、WebRTC 失败/缺失后的回退、系统 API 缺失/部分支持、旧系统动作隔离、采集恢复不阻塞播放，以及前台恢复不自动开麦。

2026-11-24 本地验证：`npm run verify` 的 1023 项测试全部通过，前后端构建成功。Windows Edge 使用模拟麦克风、两个真实浏览器 RTCPeerConnection 做回环，确认原生轨道收发 RTP、播放不等待采集恢复、静音切换及资源释放；1440px 与 390px 视口检查了全部五种语言的设置界面。该回环未连接 TeamSpeak，移动视口也不是手机系统锁屏测试。

真机验收应连接真实 TeamSpeak 房间，用第二个独立客户端双向监听，并分别记录：

1. Android Chrome、iPhone Safari、已安装 PWA 和 APK 的版本、系统版本、网络与省电设置。
2. 普通模式与实验模式下，前台、切应用、锁屏各 1/5/15 分钟的收听和发送；每次恢复说话前后都检查第二端实际听感及媒体收发计数。
3. 开麦/静音/输入音量 0%、系统 Play/Pause/麦克风控制、蓝牙切换、电话打断、网络切换和网关重连。
4. 断开或撤销权限后系统录音指示消失；旧权限请求或系统按钮不能重新启动采集。关闭实验并重连后强降噪、伴奏和普通音量控制恢复。

桌面模拟移动视口、无头浏览器和单元测试不代表通过真机锁屏验收。

## References

- HollyMusic [`useAudioPlayer.ts`](https://github.com/redcatH/HollyMusic/blob/abbae61d4ee7a7ac53a417c4da6802ff70b10717/hooks/useAudioPlayer.ts) and [`audio-analysis.ts`](https://github.com/redcatH/HollyMusic/blob/abbae61d4ee7a7ac53a417c4da6802ff70b10717/lib/client/audio-analysis.ts): native playback separated from optional Web Audio processing. This implementation uses the same architectural idea; no HollyMusic source was copied.
- [Media Session API](https://web.dev/articles/media-session) and [Audio Session draft](https://www.w3.org/TR/audio-session/).
- [Android foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types).

The experiment is off by default and applies on the next connection. It uses native WebRTC microphone tracks and native remote playback, while keeping mute, hangup and compatibility fallback. Optional Web Audio processing and accompaniment are unavailable in the native route. OS playback controls never unmute the microphone implicitly. Browser/OS restrictions still apply; physical-device background calling and native Android foreground audio services remain unverified/unimplemented respectively.
