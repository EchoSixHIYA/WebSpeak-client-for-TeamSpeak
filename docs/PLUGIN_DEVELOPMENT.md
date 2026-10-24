# WebSpeak 功能插件开发 / Functional plugin development

本文描述 dev 分支的功能插件 API v1。实例需要包含插件商店；正式版 v0.2.9 尚无此接口。功能包 `.wplugin` 与外观包 `.wskin`、皮肤内部组件及其 API 独立。

## 使用与作用域

管理员进入 `/admin/plugins`，从 [GitHub 分发仓库](https://github.com/Huddle-Up-Forge/webspeak-plugin) 安装或导入本地 `.wplugin`。检查作者、许可证和权限后，选择作用域、保存公开配置并启用。安装、更新后默认禁用，不能静默获取新权限。管理写操作受管理员会话、同源和 CSRF 保护，并记录审计。

用户连接语音工作台后，通过独立的“插件功能”入口打开隔离面板，不依赖皮肤的挂载位置。关闭面板或返回列表会退出插件房间、销毁 iframe 并停止媒体；插件不修改原生工作台 DOM。

| 类型 | 配置和房间边界 |
| --- | --- |
| `server` 服务器插件 | 配置允许的 TS `host:port`，用户按实际 TS 目标及频道进入各自房间 |
| `instance` WebSpeak 实例插件 | 同一网关的已连接用户共享一个插件房间，跨 TS 服务器和频道 |

服务器绑定使用网关解析后的实际连接地址，不接受插件或浏览器自报的目标。使用 SRV、Nickname 或别名时，在实例连接列表核对实际目标。配置支持 `host:port`、`host#port`、`[IPv6]:port`，保存时规范化。服务器插件未配置目标时不能启用。切频道会退出旧服务器插件房间，实例插件保留房间。断线、重连、卸载、更新或管理员修改配置会关闭旧上下文，需重新打开。

“所有人”指打开插件的 WebSpeak 浏览器参与者，TS 原生客户端不会运行网页插件。不同 WebSpeak 网关目前不共享插件房间。使用浏览器直连中继网关时，插件目录和房间属于实际连接的语音网关，需要在那里安装配置；只使用 UDP 加速不会改变房间归属。

## 包格式

`.wplugin` 是 UTF-8 JSON，最多 512 KiB，不是 ZIP；不包含服务端可执行文件、原生模块或任意路径。

```json
{
  "manifest": {
    "apiVersion": 1, "id": "community.example", "name": "Example",
    "version": "1.0.0", "author": "Author", "license": "MIT",
    "description": "Collaborative panel",
    "scopes": ["server", "instance"],
    "permissions": ["room.read", "room.write"]
  },
  "html": "<main id='app'></main>",
  "script": "(async () => { const context = await webspeak.ready; })();",
  "styles": {
    "light": "body { background: #fff; color: #16332e; }",
    "dark": "body { background: #20242b; color: #edf5f2; }"
  }
}
```

两个基础样式都必须提供。宿主根据当前皮肤文字明暗推断基础配色，发送 `context.theme`，一次只启用一个样式表。iframe 不继承皮肤 CSS，无需适配每款皮肤的组件位置。语言为 `zh/en/de/ru/ja`，建议五种文案和英文回退。每段 HTML、脚本或样式最多 256 KiB，总包仍受 512 KiB 限制。ID 为小写字母、数字、点和连字符，最长 80 字符。

完整示例源文件在 [watch-together](examples/watch-together/manifest.json)：`manifest.json`、`panel.html`、`player.js`、`light.css`、`dark.css`。

```sh
node --import tsx scripts/build-plugin.mjs docs/examples/watch-together docs/examples/watch-together.wplugin
node --import tsx --test src/plugins/plugins.test.ts
```

构建器读取上述五个文件。其他工具链只需生成同格式 JSON。独立插件仓库不需要 WebSpeak 源码即可生成包；宿主导入时也会校验。

## 公共浏览器 API

脚本开始前，宿主提供只读 `window.webspeak`，不需要导入内部 Vue 组件。

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
interface Snapshot {
  roomId: string;
  revision: number;
  state: JsonValue; // 空房间初始为 null
  serverTime: number; // 网关 Unix 毫秒时间
  participants: { id: string; nickname: string }[];
}
interface Context {
  self: { id: string; nickname: string }; // 临时会话 ID，不是 TS 私钥或 UID
  config: JsonValue; // 管理员提供的公开配置
  scope: "server" | "instance";
  snapshot: Snapshot;
  theme: "light" | "dark";
  language: "zh" | "en" | "de" | "ru" | "ja";
}
interface WebSpeakPluginAPI {
  apiVersion: 1;
  ready: Promise<Context>;
  room: {
    snapshot(): Promise<Snapshot>;
    update(expectedRevision: number, state: JsonValue): Promise<Snapshot>;
    subscribe(listener: (snapshot: Snapshot) => void): () => void;
  };
}
```

`room.read` 允许读房间和订阅状态；`room.write` 允许替换共享状态，必须同时声明读权限。不需要共享数据的独立功能面板可声明空权限数组：仍可打开并获得公开配置，但上下文仅含空快照，不能读写或订阅其他参与者。当前所有已加入且拥有写权限的参与者都能操作，没有隐含主持人角色或 TS 管理权限。API 不提供 TS Query、宿主 DOM、系统文件、管理员凭据或任意宿主方法。需要新能力时另行提议接口，不能访问内部实现绕过。

更新使用比较并交换：读取 N 后提交 N，成功返回 N+1；冲突返回 `PLUGIN_REVISION_CONFLICT`。重新读取，让用户重试或基于新状态重算，不能盲目覆盖。

```js
const api = window.webspeak;
const context = await api.ready;
let snapshot = context.snapshot;
const unsubscribe = api.room.subscribe(next => {
  if (next.roomId !== snapshot.roomId || next.revision < snapshot.revision) return;
  snapshot = next;
  render(next.state);
});
async function update(next) {
  try { snapshot = await api.room.update(snapshot.revision, next); }
  catch (error) {
    if (error.message === "PLUGIN_REVISION_CONFLICT") snapshot = await api.room.snapshot();
    else throw error;
  }
}
addEventListener("pagehide", unsubscribe, { once: true });
```

共享状态上限 16 KiB、16 层嵌套、4096 个节点，只接受 JSON，不接受非有限数、原型键或二进制媒体。公开配置上限 8 KiB。每会话每秒最多 20 个插件请求，每个房间每秒最多 10 次共享写入，关闭操作不受频率限制。最多 8 个已打开插件（当前面板一次打开一个）；每网关最多 800 个非空房间、50 个已安装插件。读取快照不触发广播。不要通过高频写状态传视频帧。服务端只保存通用状态与成员，不执行插件代码。

最后一位参与者离开立即销毁房间，重启也会丢失临时房间。安装和配置持久化于数据目录 `plugins/*.json`，原子替换；实例备份应包含此目录。需要持久业务数据或外部适配器时，应定义额外能力协议。

主要错误：`PLUGIN_NOT_CONNECTED`、`PLUGIN_NOT_ALLOWED`、`PLUGIN_DISABLED`、`PLUGIN_NOT_OPEN`、`PLUGIN_PERMISSION_DENIED`、`PLUGIN_REVISION_CONFLICT`、`PLUGIN_RATE_LIMITED`、`PLUGIN_TOO_LARGE`、`PLUGIN_TIMEOUT`。配置或包变化会关闭旧上下文并提示重新打开。

为避免可选插件消息挤占语音连接的内存，出站队列超过 512 KiB 时跳过插件消息。恢复连接质量后可请求快照或重新打开插件；请求无响应会超时，不代表共享写入一定没有执行。

## 同步观影示例

状态为 `{ url, position, playing, updatedAt }`。加载、播放、暂停、跳转共享；音量、全屏与播放许可仅影响自己。使用快照 `serverTime` 估算网关时钟，推算播放 elapsed time，定时校正漂移，大偏移跳转、小偏移暂调速。后来加入读取同一快照追上进度，不依赖过去的操作事件。

视频由每个浏览器直接从 URL 加载，不经过 WebSpeak 中转。支持浏览器可解码的 MP4/WebM 等直链，不支持播放网页、DRM、登录后 URL 或嵌入式平台播放器。HTTPS 实例一般需要 HTTPS 视频。自动播放受浏览器策略限制，可能需要点击“允许播放”。源端带宽、网络和缓冲会影响误差，不承诺逐帧同步。

## 隔离与清理

使用 opaque-origin `sandbox="allow-scripts"` iframe，不授予 `allow-same-origin`、顶部导航、弹窗、表单、麦克风或摄像头。宿主 RPC 校验 `event.source`、随机通道和面板生命周期；插件不能选择另一个 ID 或房间。CSP 禁止 fetch/WebSocket、外部脚本、嵌套 iframe，仅允许直接媒体及 HTTPS 图片。媒体源仍会收到浏览器请求，配置、共享状态和视频 URL 都不能包含管理员密钥。

隔离不是恶意代码审核、CPU/内存配额的替代品。管理员应审查来源。插件在 `pagehide` 清理计时器、订阅和媒体；宿主关闭时销毁 iframe，后端移除房间成员，迟到响应不能重开已关闭面板。

## GitHub 分发协议

根仓库 `main/index.json`：

```json
{
  "schemaVersion": 1,
  "plugins": [{
    "id": "community.example",
    "repository": "https://github.com/OWNER/REPOSITORY",
    "metadataPath": "plugin.json"
  }]
}
```

`metadataPath` 默认 `plugin.json`，也支持子目录。同一个仓库可以分发多个插件。对应仓库默认分支的元数据：

```json
{
  "manifest": { "apiVersion": 1, "id": "community.example", "name": "Example", "version": "1.0.0", "author": "Author", "license": "MIT", "description": "Example", "scopes": ["server"], "permissions": ["room.read", "room.write"] },
  "package": { "ref": "IMMUTABLE_COMMIT_OR_TAG", "path": "example.wplugin", "sha256": "64_lowercase_hex_digits" }
}
```

使用真实 SHA-256，推荐固定提交或发布标签；不要上传占位值。只访问 `raw.githubusercontent.com`，拒绝重定向、非法地址/路径、超时和超限数据。安装时重读目录和元数据，核对管理员看到的 revision，再下载校验摘要及清单；installedRevision 也作并发保护。失败保留旧包。摘要是内容一致性校验，不是作者签名或安全认证。

## English quick start

Functional plugins are portable UTF-8 `.wplugin` JSON bundles, independent of skins. Install under `/admin/plugins`, review permissions, select `server` (target + channel) or `instance` (one room across connected users of this gateway), and explicitly enable. Open the common Plugins panel after joining voice. Native TS clients and separate WebSpeak gateways do not share this runtime.

Await `window.webspeak.ready`, subscribe with `webspeak.room.subscribe`, and write with revision-checked `room.update`. The API types, limits and distribution schemas above are normative. Both light/dark styles are required. The [Watch Together example](examples/watch-together/player.js) implements clock-based progress, late joining, conflict recovery, autoplay handling and cleanup without host-specific player code. Build using the command above and import into an isolated development instance. Develop plugins without modifying WebSpeak runtime files; propose missing capabilities separately.
