# WebSpeak 功能应用开发 / Functional application development

WebSpeak **v0.3.0** 使用应用运行时 **API v2**。`.wplugin` 与 `.wskin` 完全独立；旧 API v1、共享房间协议及其两个示例已移除，不兼容旧包。

插件是作者自己的应用：标准 HTML/CSS/JavaScript 前端，加上可选的 Node 后端。可以使用框架、浏览器原生 API、自己的 HTTP/WebSocket 协议、网络客户端和数据模型。宿主不提供按音乐、文件、视频等功能划分的业务 API，也不提供 `room.read/write` 或下载权限表。浏览器原有的安全上下文、用户手势、权限许可、跨域及网络可达性要求仍然适用。

## 管理与部署

管理员在 `/admin/plugins` 从 GitHub 安装或导入包，审核代码和依赖，配置作用域，勾选信任后启用。每次安装、更新均撤销信任并禁用，需要重新审核。审核是人工准入流程，校验包哈希不等于审核代码。写操作继续使用管理员认证、同源检查、CSRF 和审计。

**信任边界：** 前端运行在独立源，和工作台 DOM 分离，使用真实浏览器环境。Node 后端运行于独立子进程，拥有 WebSpeak 服务账户的操作系统权限，能够访问该账户可访问的网络和文件。独立进程、目录和 JS 堆上限用于生命周期与故障控制，不是恶意代码安全沙箱。仅安装审核且信任的应用。

运行时默认监听 `0.0.0.0:3042`：

| 环境变量 | 用途 |
| --- | --- |
| `WEBSPEAK_PLUGIN_PORT` | 应用端口，默认 3042 |
| `WEBSPEAK_PLUGIN_HOST` | 监听地址，默认 0.0.0.0 |
| `WEBSPEAK_PLUGIN_PUBLIC_ORIGIN` | 初始公开源，例如 `https://apps.example.com` |

本地工作台为 `127.0.0.1` 时自动使用 `localhost:3042`，反向亦然，以保持源分离。公网部署必须给应用配置独立 HTTPS 源，在管理页“应用运行时”保存；该设置优先于环境变量。代理应将该源的全部路径转发至应用端口，支持 WebSocket 升级和 SSE 长连接，关闭 SSE 缓冲。不要让代理记录 `/apps/…` 中的访问凭证，也不要与主站共用域 Cookie。

```caddyfile
apps.example.com {
    reverse_proxy 127.0.0.1:3042
}
```

容器需映射应用端口，或让代理接入相同容器网络。端口/监听地址改变需重启；公开源可在后台更新，会撤销已有应用会话。主站直接使用 TLS 时，运行端口使用相同证书；TLS 在代理终止时，上游使用 HTTP。监听失败会保留主站和语音服务，后台显示不可用，修复后需重启。配置为主站自身源时拒绝打开应用。

## 作用域与身份

`server`：管理员配置允许的实际 TS `host:port`，用户按真实 TS 目标和频道获得作用域标识。`instance`：当前语音网关的已连接用户获得同一实例标识。作用域负责宿主准入和提供上下文，**不会替作者创建共享房间或自动同步数据**。应用后端应按 `request.webspeak.scope.key` 分组，并自行实现业务授权和同步。

TS 目标由实际语音连接解析，插件不能自报身份或频道。目标支持 `host:port`、`host#port`、`[IPv6]:port`，保存时规范化；SRV/Nickname 场景应核对实际目标。服务器范围切换频道后需重开；实例范围的频道变更通过上下文更新。断开、重连、更新、禁用、重启、配置修改或卸载会撤销旧凭证并关闭连接。服务端可以在没有打开面板时执行后台任务，直到禁用或停止。

入口属于实际语音网关；浏览器直连另一中继网关时，在那个网关安装配置。原生 TS 客户端不会执行网页应用，不同网关不会自动共享状态。作者可自行实现跨实例服务。

## 包格式与构建

复制 [通用起点](templates/plugin-app/manifest.json)，修改 ID、元数据和业务代码。它只展示上下文及自定义计数路由，不是商店预装插件。

```text
my-app/
  manifest.json
  client/index.html
  client/main.js
  client/style.css
  server/main.mjs       # 可选
  server/node_modules/  # 可选，已审核的运行依赖
```

```json
{
  "apiVersion": 2,
  "id": "community.my-app",
  "name": "My application",
  "version": "1.0.0",
  "author": "Author",
  "license": "MIT",
  "description": "An independently implemented application",
  "scopes": ["server", "instance"],
  "client": { "entry": "client/index.html" },
  "server": { "entry": "server/main.mjs" }
}
```

纯前端应用删除 `server` 声明。前端框架产物放入 `client/`，静态引用使用相对路径，不能假设根路径为 `/`。后端入口支持 `.mjs/.cjs`，依赖放在 `server/` 内或打包为自包含文件。宿主不会执行 `npm install`、安装脚本或原生编译；原生依赖需匹配目标 Node ABI/操作系统，不一定跨平台。运行环境为宿主 Node，当前项目要求 Node 22 或更高。

```sh
node scripts/build-plugin.mjs docs/templates/plugin-app /tmp/application.wplugin
```

构建器是独立 Node 脚本，可复制到插件仓库，无需导入 WebSpeak 源码。`.wplugin` 是 UTF-8 JSON：`{manifest,files}`；`files` 是路径到 `{encoding:"utf8"|"base64",data:string}` 的映射。支持普通 `client/`、`server/` 文件；禁止越界路径、符号链接、Windows 设备名、大小写冲突及文件/目录别名。入口必须是 UTF-8。封装上限 48 MiB、解码内容 32 MiB、单文件 16 MiB、4096 个文件，安装上限 50 个。宿主导入时完整校验。

## 浏览器上下文

宿主在入口 HTML 注入外部脚本，在应用模块运行前提供：

```js
const context = await window.webspeak.ready;
const unsubscribe = webspeak.onContextChange(next => render(next));
const latest = webspeak.getContext();
const response = await fetch(context.serverUrl + '/my-route', {
  method: 'POST', body: JSON.stringify({anything: 'defined by the application'}),
  signal: webspeak.signal
});
const socket = new WebSocket(context.socketUrl + '/my-socket');
```

| 上下文字段 | 内容 |
| --- | --- |
| `apiVersion` | 2 |
| `plugin` | manifest |
| `self` | 当前公开 `id/nickname/uid?` |
| `connection` | 真实 `target/channelId` 和当前频道公开 `members`（`id/nickname/uid?`） |
| `scope` | `{type:"server"|"instance",key:string}`；分组标识不能直接当文件路径 |
| `config` | 管理员公开 JSON，所有参与者可读 |
| `theme/language` | `light/dark` 和 `zh/en/de/ru/ja`，同步到 `<html data-theme>` 与 `lang` |
| `appId` | 本次打开的公开标识，不是长期身份或认证凭据 |
| `serverUrl/socketUrl` | 此会话的后端 HTTP/WS 根；纯前端为 `null` |
| `contextUrl` | 此会话最新上下文地址 |

运行时 URL 含临时凭证，不应持久化、广播或记录。`webspeak.signal` 在撤销或退出时中止，仍需清理自己的定时器、网络、媒体和订阅。应用应提供两种基础配色及适合的语言回退。

用原生 `fetch`、`WebSocket`、`RTCPeerConnection`、文件选择/下载、IndexedDB、Canvas 等编写功能。独立源存储遵循原生规则；同一运行源的应用共享该源存储，请按插件 ID 命名，不能把此设计当作互不信任插件间的隔离。服务端持久化使用 `dataDir`。

关闭面板会销毁 iframe 并取消未完成的打开操作。宿主每秒检查会话有效性，撤销后终止 HTTP、SSE、WS 和旧页面。控制平面只传上下文与生命周期；业务数据使用独立应用服务，不经过语音 WebSocket。

## 可选 Node 后端

```js
export default async function activate({ dataDir, config, publicConfig, events, signal, log }) {
  return {
    handle(req, res) {
      // req.webspeak is verified by the host; req.url is your own route.
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({participant: req.webspeak.self.id}));
    },
    upgrade(req, socket, head) { /* your WebSocket protocol */ },
    async stop() { /* flush data and release resources */ }
  };
}
```

也可直接返回 `(req,res)=>…`。这是 Node 原生请求/响应，可适配 Express、WS 等库。`req.webspeak` 含 `apiVersion/appId/self/connection/scope`，不含临时 URL 或管理凭据；服务端 `connection` 只有目标和频道。代理剥离主站 Cookie、Authorization 和伪造的 `x-webspeak-*` 头；应用自行认证可使用自定义头或自己的外部服务。后端不会收到主站管理员/Query 密钥，除非管理员主动在插件配置中提供。

`dataDir` 为本插件持久目录，更新/重启/卸载保留。代码提取目录会清理，不可持久化。包文件没有可执行位；额外子程序需作者自行处理权限和平台。Node 网络、文件、子程序和第三方服务同样属于审核范围。

`config` 是后端私密 JSON，`publicConfig` 是公开 JSON。私密配置在管理页仅显示是否已保存，支持保留/替换/删除，用实例主密钥加密存储；启用的 Node 代码获得明文。它不是针对恶意插件的秘密保险箱。不要把私密配置写入响应或日志。

`events` 为 Node `EventEmitter`：`participantJoined/contextChanged` 提供服务端公开上下文，`participantLeft` 为 `{appId,selfId,scopeKey}`。加入指打开应用面板，不是全体 TS 成员。`signal` 在停止时中止；`log(level,message)` 提供限流日志，宿主当前以 debug 级别记录。

每个后端一个进程，默认最多 8 个；启动超时 10 秒、停止宽限 2 秒、JS 堆上限 256 MiB（不是总 RSS 限额）。失败显示错误、撤销会话，可手动重启，无无限重试。每个语音连接最多 8 个打开会话，全局 800 个，每会话最多 32 条代理连接及 4 条上下文 SSE。普通 HTTP 空闲超时 120 秒，无上下文 SSE 且 90 秒无活动的会话回收。作者负责消息大小、业务授权、并发、存储一致性和依赖资源用量。

## 分发与验证

[分发仓库](https://github.com/Huddle-Up-Forge/webspeak-plugin) 目录为 `{"schemaVersion":2,"plugins":[{"id":"community.my-app","repository":"https://github.com/OWNER/REPO","metadataPath":"plugin.json"}]}`。插件仓库 `plugin.json` 包含 `manifest` 和 `package:{ref,path,sha256}`。`ref` 使用固定提交/不可变标签，`path` 指向已提交包，SHA-256 为包原始字节哈希。实例安装时校验包哈希、API 版本、插件 ID、版本、作用域集合与前后端入口。商店展示 `plugin.json` 里的名称、描述、作者和许可证，实例安装后展示包内清单里的值。目录或安装修订改变时需重新加载。空目录不默认安装插件。

需要后台配置的插件应在仓库 README 写明公开与私密字段的用途、必填项、凭据获取方式，并提供用占位符的 JSON 示例。管理员可从已安装插件的高级配置打开仓库说明。

验证实际构建包的导入、审核、启用、自定义 HTTP/WS、依赖加载、持久化和关闭/断线/禁用/更新撤销；检查明暗、语言、窄屏。协作另测两位真实参与者及并发/离开/重连。区分模拟身份、真实 TS、浏览器交互与跨网络证据。宿主回归：`npm run verify`。

## 悬浮应用窗口 / Floating application workspace

功能插件入口由宿主的独立悬浮层提供，不属于默认主题或任何皮肤插槽。入口可拖动，避免遮挡工作台控件。应用库和应用内容使用非模态窗口：打开后仍可操作工作台；标题栏可拖动，支持最小化、最大化、还原和关闭，小屏幕自动限制在可视区域内。宿主窗口优先读取标准 `color-scheme` 来选择日间/夜间配色，不继承皮肤组件样式。

最小化、切换到应用库、再返回当前应用均保留同一个 iframe 与会话，传输、播放等任务不会因收起窗口而重置。关闭窗口、切换至另一个应用或语音会话撤销时，宿主结束当前应用会话。当前同时承载一个前端应用；不要把窗口最小化当成退出事件。

应用只负责 iframe 内部内容，使用自身响应式日间/夜间样式和上下文中的主题、语言。不读取或改写皮肤 DOM，不绘制覆盖宿主的全屏遮罩，不自行重复宿主的标题栏、最小化和关闭按钮。需要自有导航时可在内容区实现。应用界面优先显示功能与实际状态，不重复运行环境、权限或免责说明；管理员启用时的信任与权限信息保留在管理流程中。

## 实例级用户授权

首次访问时，宿主统一征求第三方皮肤与功能应用的使用授权；决定按浏览器源保存，不迁移旧的逐皮肤授权。拒绝或未选择时，只显示日间、夜间、ILLUSIA 三款官方皮肤，KAAK 和功能应用入口均隐藏。皮肤菜单最后的“授权”可随时更改。撤回会关闭 iframe 并撤销当前打开操作/应用会话，不停止管理员启用的全实例后台服务。应用不得以入口以外的方式绕过宿主授权，也无需重复询问同一份宿主上下文授权；相机、麦克风等浏览器原生许可仍由浏览器处理。
