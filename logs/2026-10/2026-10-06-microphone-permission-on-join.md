# 加入语音时提前申请麦克风权限

- 日期：2026-10-06
- 对象：WebSpeak 浏览器音频启动流程

## 原因与修改

- 连接成功后原本会自动启动麦克风，但 `startMicrophone()` 先等待 `AudioContext.resume()`，再调用 `getUserMedia()`。浏览器可能因缺少用户手势而让恢复 Promise 挂起，导致麦克风权限请求迟迟没有发出；用户进入音频设置并交互后才看到权限提示。
- 将流程改为先发起 `getUserMedia()` 权限请求，再尝试恢复 AudioContext；恢复失败不丢弃已取得的麦克风流。
- 新增请求顺序与恢复失败测试；合并 `package.json` 中重复的 `test` 脚本定义，使新增测试和既有屏幕唤醒测试都由 `npm test` 执行。
- 在中、英、德、俄、日五种 README 中说明加入语音时会申请麦克风权限、被拒绝后需在站点设置中允许，以及 HTTPS 要求。

## 验证

- `npm test`：29 项通过。
- `npm --prefix web run build`：Vue 类型检查通过，Vite 构建 192 modules 成功。
- 为复用本机已有依赖，在本工作区使用指向现有 `node_modules` 的符号链接；未安装依赖。
- 未在实际手机/浏览器上触发系统麦克风权限弹窗，端到端设备验收待完成。

## 上游

- 分支：`fix/request-microphone-before-audio-resume`
- 提交：`52a7bee`（`fix: request microphone before resuming audio context`）
- PR #24：<https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/pull/24>

## 部署（2026-10-06）

- 按 Timmy 要求，将麦克风权限请求顺序修复部署到当前运行的 Intel NUC 静态前端；保留先前部署的成员侧栏隐藏本机音频状态及移除两处提示文案。
- 以服务器现有 `ts6-backstage-source.tar.gz` 定制源码为基线移植修复，保留 NUC 首页/PWA 图标元数据及 `screen-share-portrait-f54f514.css` 覆盖；部署 JS `assets/index-CqHFA_lr.js` 和同步更新的 AGPL 源码归档。现有 CSS 哈希不变。
- 部署前快照：`/home/timmy/webspeak/backups/20261006-142005-CST-mic-permission/`，包含原首页、原源码归档、候选首页/JS/源码归档及 `SHA256SUMS`。
- 公网首页、新 JS、CSS、源码归档均 HTTP 200；线上 JS 与候选 SHA-256 一致，首页继续引用竖屏共享覆盖。健康端点为 `ok`/版本 `0.2.5`；WebSpeak 容器 `StartedAt` 未变，重启次数为 0；未重启 WebSpeak 或 Caddy。
- 需要刷新或重新打开页面加载新 bundle。未能在真实手机语音会话中实测权限弹窗。
- PR #24 的 `verify` 与 `docker-smoke` 在代码提交 `2c193e1` 上均通过；后续日志提交触发的检查状态需另行回读。
