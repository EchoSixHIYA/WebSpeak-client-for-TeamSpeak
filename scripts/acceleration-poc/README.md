# WebSpeak 加速通道 PoC

这是第一版隔离测试 Demo，不属于 WebSpeak 生产运行链路，也不会被复制到 Docker 镜像或发布包中。

它验证以下核心能力：

- 客户端向远端中继发起认证；
- 每个会话动态指定 TeamSpeak 目标地址；
- 双向 UDP 数据报转发，并保持数据包边界；
- 会话之间按随机 ID 隔离；
- 错误密钥不能建立会话；
- 未开启 `allowPrivate` 时，解析到非公网地址的目标一律被拒绝；
- 不修改系统路由，因此不是 VPN。

## 本地冒烟

在仓库根目录运行：

```bash
npm run acceleration:poc
```

成功时会输出 `ACCELERATION_POC_OK`，并显示数据包数量、丢包率和往返延迟。除吞吐与错误密钥外，该冒烟还会用一个独立的 `allowPrivate: false` 中继断言私网目标防护生效：

```text
ssrf_guard_ok=true blocked=5/5 public_target_allowed=true
```

任一被禁目标未被拦截、或公网目标被误拦，都会输出 `LEAK` / 失败。

IPv6 回环验证：

```bash
npm run acceleration:ipv6-smoke
```

## 私网目标防护与主程序保持一致

中继的 `isRestrictedAddress()` 是 `src/security/open-target-policy.ts` 中同名函数的镜像。PoC 必须是可直接拷贝到远端运行的 `.mjs` 文件，不能 import 主程序的 TypeScript 模块，因此这段判断是**有意重复**的。`scripts/acceleration-poc/target-guard-parity.test.mjs` 会逐条比对两边的分类结果，任何一侧改动而另一侧未同步都会让 CI 失败。

该测试放在 PoC 目录内而非 `src/` 下：`.dockerignore` 把 `scripts/acceleration-poc` 排除在 Docker 构建上下文之外，而 Dockerfile 会对 `src/**` 执行 `tsc`，因此 `src/` 下任何 import 该目录的文件都会让镜像构建以 TS2307 失败。

## 通过隧道连接指定 TeamSpeak

必须先将下方示例域名替换为你获准测试的 TeamSpeak 地址；脚本不内置真实服务器默认值。下面的命令会让 SDK 连接本地代理端口，再由 PoC 中继把 UDP 数据转发到指定 TeamSpeak。它不进入指定频道，只验证 TeamSpeak 握手和断开：

```bash
$env:WEBSPEAK_ACCEL_TS_TARGET="ts.example.invalid#9987"
npm run acceleration:sdk-smoke
```

跨机器验证时，需要在目标服务器启动 `relay-server.mjs`，再把 `WEBSPEAK_ACCEL_RELAY` 指向中继地址。当前项目不会自动部署或启动该远程进程。

## 手动启动中继

仅用于实验，不要直接暴露到公网：

```bash
WEBSPEAK_ACCEL_TOKEN="change-this-to-a-long-random-token" \
WEBSPEAK_ACCEL_HOST="0.0.0.0" \
WEBSPEAK_ACCEL_PORT="39087" \
node scripts/acceleration-poc/relay-server.mjs
```

当前 Demo 的 UDP 帧协议是实验协议，尚未接入 SDK，也没有替代 GOST 的生产安全审计。正式接入前仍需验证 TeamSpeak 长时间语音、并发会话、IPv6、断线重连和目标地址安全策略。
