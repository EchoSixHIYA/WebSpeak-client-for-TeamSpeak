# WebSpeak 皮肤开发规范

本文说明 v1 视觉皮肤、v2 声明式布局皮肤、v3 开放皮肤以及 v4 插件包格式。v1/v2 保持固定 CSS 几何边界；v3 可重排公开 UI、用自定义声明式节点构建界面，并用 components.json schema v2/v3 替换首页/语音工作区的整页可见界面。v4 有插件清单、文件校验和本地缓存；有界 Wasm 已接入 WebClient 授权、UI 生命周期、按清单过滤的只读数据投影、worker 资源治理和首版宿主动作桥，并在生产构建开放。作者 JavaScript 仍不执行；跨浏览器端到端验证和独立安全审查仍待完成。路线和安全边界见[路线图](./OPEN_SKIN_SYSTEM_ROADMAP.zh-CN.md)与[规格](./OPEN_SKIN_SYSTEM_SPEC.zh-CN.md)。

KOOK 语音界面参考仅覆盖用户授权的语音频道，语音区结构记录在[参考文档](./KOOK_VOICE_REFERENCE.zh-CN.md)；发现、陪玩、活动、广告、商城和管理后台不属于复刻范围。

可导入的 KOOK 风格完整语音工作区测试包见[Harbor Voice Workspace](./examples/harbor-voice/README.zh-CN.md)；它只复用 WebSpeak 的可信宿主控件和公开会话数据，不包含站点素材、运营页或后台。

v3 的 HTML 标签、属性、可绑定数据集合和宿主动作仍是固定白名单；作者自定义 UI 逻辑由 v4 的有界 Wasm 路径提供。生产构建中的 v4 Wasm 运行时已接入本地摘要授权、页面生命周期、动态 HTML/SVG 节点渲染、插件 CSS、权限化只读数据投影、宿主动作桥、语义挂载槽位和全局 worker 资源治理；目前支持 `session.status.read`、频道/成员/聊天、收藏/最近列表和音频/共享状态读取权限，以及 `ui.surface.replace`、`ui.input.read`。每份公开数据投影最多 48 KiB，只传清单准许的字段；Wasm 可生成自定义节点树、有限本地状态并响应命名 UI 事件。宿主动作只接受可信 UI 事件触发的同一轮输出中的单个请求，并重新检查插件权限、参数和当前会话；`dblclick` 可绑定到加入频道等已授权宿主动作。JavaScript 仍只校验和缓存，不执行。每个 v4 插件有独立布局根，用户可调整插件整体、组件根和 DOM 节点的位置、尺寸、显隐、安全外观及 Flex/Grid 同级显示顺序；`plugins.json` 可将 widget 放到公开页面的注册槽位，也可通过 surface 重做整页。这个边界能承载完整自定义客户端界面，但不等于已完成插件商城和作者管理平台；跨浏览器测试与独立安全审查尚未完成。

`.wskin` 包可为公开页面定制艺术表现。v1 提供 CSS 与美术资源；v2 另外携带受校验的布局 JSON；v3 可自由安排公开组件，并用 components.json 声明由宿主渲染的安全组件。所有版本均由 WebSpeak 保留基础组件的业务逻辑和 TeamSpeak 行为。

页面结构、必要控件和所有基础翻译均由 WebSpeak 提供。皮肤包不必携带文案；如果只包含样式与美术素材，所有界面文字仍由 WebSpeak 按当前语言显示。`content.json` 仅用于可选覆盖，缺少的语言或字段回退到 WebSpeak 的基础内容。皮肤不注入 HTML 或 JavaScript；授权后的交互只调用 WebSpeak 登记并校验过的 TeamSpeak 功能。**管理后台 `/admin/**` 不属于皮肤范围，始终使用 WebSpeak 自己的固定样式。**

可直接查看 [ILLUSIA 风示例源码](examples/illusia-voice/) 与 [示例说明](examples/ILLUSIA-VOICE.md)。它使用本地美术素材和 CSS 完整定制首页、语音房间、成员区、聊天空状态及播放器，同时沿用 WebSpeak 提供的基础翻译；也是管理控制台内置且不可移除的示例皮肤。

## 使用与发布

管理员在 `/admin/skins` 查看三款随 WebSpeak 提供的内置皮肤，并可导入、替换、启用/停用或删除实例自定义皮肤；还可指定访客首次访问时使用的默认皮肤。默认日间、默认夜间和 ILLUSIA 风为受保护内置项，不可替换、停用或移除。访客手动选择的皮肤保存在该浏览器，后续实例默认值变更不会覆盖该明确选择；仅自动套用过旧默认值的浏览器会采用最新实例默认值。皮肤包会缓存在浏览器本地；页面启动时会查询实例目录，目录可用且版本更新时拉取新包。若网络不可用，已缓存的版本仍可使用。

选择器提供默认日间、默认夜间、内置 ILLUSIA 风和已启用的实例皮肤；没有“跟随系统”选项。停用的实例皮肤不向访客展示，也不能从服务端下载；若它是当前默认皮肤，系统会安全回退到默认日间。管理员设置的默认值只影响未手动选择皮肤的访客。自定义皮肤是独立的外观选择，不继承之前的日间或夜间模式；皮肤未覆盖的部件回退到浅色基础外观，避免一套组件混入另一套模式。自定义皮肤可自行声明 `color-scheme` 并定义深色外观；切换为日间或夜间时，会停用当前自定义包。文档级 `data-theme` 仍由 WebSpeak 保留给管理后台使用。

## 包结构

`.wskin` 是标准 ZIP 容器，推荐把下列文件直接放在 ZIP 根目录：

```text
manifest.json                 # 必需：身份、版本与入口
skin.css                      # 必需：皮肤样式
content.json                  # 可选：首页内容与多语言界面文案
assets/preview.jpg            # 可选：管理后台显示的预览图，也可在 CSS 中使用
assets/background.webp        # 可选：页面艺术素材
assets/brand.woff2            # 可选：自带字体
components.json               # v3 可选：声明式组件或完整页面 surface
plugins.json                  # v4 必需：插件入口、页面、模式、权限与包内文件
plugins/<plugin-id>/index.js  # v4 插件代码，目前只校验和缓存
plugins/<plugin-id>/index.wasm # v4 有界 Wasm 插件入口
plugins/<plugin-id>/style.css # v4 可选：插件样式，目前只校验和缓存
plugins/<plugin-id>/assets/   # v4 插件专属的本地图片或字体素材
```

所有资源路径使用 `/`，区分大小写，并相对于包根目录。CSS 的 `url()` 使用同样的包根相对路径，例如 `url("assets/background.webp")`。不得使用机器本地路径、站点绝对路径或远程 URL。

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "id": "community.example-skin",
  "name": "Example skin",
  "version": "1.0.0",
  "author": "Example author",
  "license": "CC-BY-4.0",
  "description": "A visual-only art skin using the WebSpeak interface translations.",
  "entry": "skin.css",
  "preview": "assets/background-composite.webp",
  "minAppVersion": "0.2.7-preview"
}
```

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 当前必须为数字 `1`。 |
| `id` | 必需，最多 80 个字符；只允许小写字母、数字、点和连字符；不能以 `builtin.` 开头，也不能使用受保护 ID `builtin.light`、`builtin.dark` 或 `community.illusia-voice`。发布后不要更改。 |
| `name`、`author`、`license` | 必需，各最多 80 个字符。资源授权由作者负责确认。 |
| `version`、`minAppVersion` | 必需，使用语义化版本号，例如 `1.2.0`。 |
| `entry` | 必需，包内 CSS 文件路径，最多 120 个字符。 |
| `content` | 可选，包内 JSON 文件路径，最多 120 个字符。 |
| `preview` | 可选，包内 PNG、JPG/JPEG、WebP、AVIF 或 GIF 图片路径，最多 120 个字符。 |
| `description` | 可选，最多 400 个字符。 |

清单不得重复声明同一个文件为 CSS、内容或预览入口。

### schemaVersion 2：声明式布局皮肤

v2 为 v1 增加一个必需布局文件。清单和布局 JSON 会在导入端及服务端分别验证；未知清单字段、权限、组件、布局字段及越界数值都会导致包被拒绝。v2 不支持 HTML、JavaScript、WebAssembly、远程资源或扩展插件代码。皮肤 CSS 仍使用当前解析器规则，不能控制几何布局和交互区域。

```json
{
  "schemaVersion": 2,
  "packageType": "layout-skin",
  "id": "community.example-layout",
  "name": "Example layout",
  "version": "1.0.0",
  "author": "Example author",
  "license": "CC-BY-4.0",
  "entry": "skin.css",
  "layout": "layout.json",
  "permissions": [],
  "minAppVersion": "0.2.7"
}
```

布局只引用 WebSpeak 登记的稳定组件 ID。当前支持 `home`、`voice`、`demo` 页面及 `desktop`、`tablet`、`mobile` 三种设备配置。组件位置使用有界的水平/垂直偏移，尺寸使用缩放、宽、高，外观字段只接受六位十六进制颜色和受限圆角；`visible` 控制显示状态；`order` 在 -100 到 100 之间，仅当父容器使用 Flex 或 Grid 时改变同级显示顺序，不改变 DOM 和键盘焦点顺序。`home.security-note`、身份安全提示、连接状态与屏幕共享错误属于可信宿主 UI，不允许布局隐藏或改写。

示例 `layout.json`：

```json
{
  "schemaVersion": 1,
  "pages": {
    "home": {
      "desktop": {
        "home.feature": { "x": 12, "y": 8, "scale": 1.05, "order": -1 },
        "home.features": { "visible": false }
      },
      "tablet": { "home.join-card": { "width": 680 } },
      "mobile": { "home.header": { "x": 0, "y": 4 } }
    }
  }
}
```

作者包中的布局是初始默认值。用户编辑内容单独存放在本地浏览器，覆盖作者默认值；支持撤销/重做、单个组件重置、整套布局恢复、导入和导出。更换设备宽度会选择对应设备配置，不会删除其他设备的值。恢复入口由宿主在皮肤根节点之外绘制，即使用户隐藏了页面组件，也能再次打开编辑器并恢复默认值。

v1 和 v2 都只支持公开页面。`/admin/**` 不加载布局、用户覆盖和皮肤组件编辑器。布局包没有数据/API 权限；后续插件必须另行设计独立沙箱与授权协议，不能通过增加 v2 清单字段取得能力。

### schemaVersion 3：开放皮肤和完整声明式页面

v3 清单的 packageType 固定为 open-skin，entry 指向 CSS，components 指向 components.json；不含 v2 的 layout 或 permissions 字段。组件文件可以省略。仅 v3 开放公开页面的 CSS 排版能力，v1/v2 仍按旧 CSS 规则校验。客户端导入和服务端登记使用同一共享组件 schema 与权限白名单。

components.json 顶层接受 schemaVersion 1、2 或 3 和 components 数组。schema v1 维持旧兼容；schema v2 引入 `mode: "widget"`（默认）或 `mode: "surface"`，并提供可选宿主控件节点；schema v3 保持这些能力，扩大声明式 UI 的节点/状态/动作边界，并增加用户操作事件和语音功能动作。v3 仍使用固定元素/属性、公开数据集合和宿主动作白名单，不是任意 HTML 或任意脚本。每个组件需声明 id、name、page、accessibleName、permissions、actions 和 root，可选 state。page 接受 home、voice、demo；surface 仅可用于 home 和 voice，并且必须请求 `ui.surface.replace`。用户批准前不会显示 surface，撤销后宿主立即恢复普通页面。所有皮肤组件根节点及其中的每个可见元素都以动态布局项加入本地布局编辑器，可独立移动、缩放、改尺寸、改外观或隐藏。按钮、输入框及显式用户操作节点保留 44 px 最小触控区域。为让用户覆盖在树结构调整后仍能指向同一元素，请给重要节点设置稳定的 `part` 名称；未设置时按组件树位置生成标识。v4 包和插件运行时见[规格](./OPEN_SKIN_SYSTEM_SPEC.zh-CN.md)；Wasm 生产运行已开启，作者 JavaScript 仍关闭。

普通节点使用白名单 HTML/SVG 元素。节点可包含 text、part、className、受限 attributes、包内图片 asset、bindValue、本地 repeat/when、events 和 children。文本与属性支持简单的双大括号数据路径；不支持表达式、HTML 字符串或脚本。重复列表可使用注册的公开集合；频道重复项仅能再重复其 `channel.members`，并且需要额外批准 `session.members.read`。宿主每个组件的实际渲染节点最多 8192 个，防止嵌套集合放大界面。schema v2 另允许固定宿主控件节点，例如：

```json
{
  "schemaVersion": 2,
  "components": [{
    "id": "example-voice-surface",
    "name": "Example voice surface",
    "page": "voice",
    "mode": "surface",
    "accessibleName": "Example voice workspace",
    "permissions": ["ui.surface.replace"],
    "actions": {},
    "root": {
      "tag": "main",
      "children": [
        { "widget": "voice.channel-panel" },
        { "widget": "voice.member-cards" },
        { "widget": "voice.chat-panel" },
        { "widget": "voice.audio-controls" },
        { "widget": "voice.disconnect-control" }
      ]
    }
  }]
}
```

当前可选宿主控件 ID：`home.connection-form`、`app.skin-switcher`、`app.language-switcher`、`voice.channel-panel`、`voice.member-cards`、`voice.chat-panel`、`voice.audio-controls`、`voice.screen-share-player`、`voice.screen-share-start`、`voice.whisper-controls`、`voice.performance-panel`、`voice.connection-controls`、`voice.disconnect-control`。未知控件和同页重复控件会被拒绝；每个控件的状态和业务动作仍由 WebSpeak 内部处理。`voice.screen-share-start` 仅能放在语音页，并要求 `voice.screenShare.control`；宿主按钮在可信点击处理器内直接启动屏幕采集，避免异步 Wasm 回调丢失浏览器瞬时用户激活。自定义 UI 可以完全用普通声明式节点搭建，不需要采用这些控件。只显示收藏时可用 `favorites.items` 和 `favorites.switch`；若要将收藏与最近连接放在同一自定义栏，可用 `servers.quickList` 数据与 `quickServers.switch` 动作。服务器目标始终使用本机生成的不透明令牌，不把地址、密码或身份材料交给组件。频道行也可把 `voice.joinChannel` 绑定到双击事件，切房继续走 TeamSpeak 原有权限和密码流程。v3 还提供经独立权限保护的麦克风/扬声器、输出音量、离开状态、悄悄话、断开连接和屏幕共享动作；它们只调用 WebSpeak 已有操作，屏幕采集仍由浏览器或操作系统询问用户。

示例包见 [KAAK voice 示例](./examples/KAAK-VOICE.md)，其 components.json 展示了公开频道列表和在线成员侧栏；[Open Voice Surface](./examples/OPEN-VOICE-SURFACE.md) 展示了完整首页和语音工作区 surface，是格式验证脚手架。KAAK 的语音视觉参考来自用户授权进入的前两个语音房间；只记录布局，不保留服务器/房间标识、成员名或聊天内容。当前数据权限和宿主动作以[开放皮肤规格](./OPEN_SKIN_SYSTEM_SPEC.zh-CN.md)中的清单为准。组件按本地用户授权后才渲染；权限对每个皮肤版本、页面和组件分别保存，可在宿主权限入口撤销。页面替换时，宿主会额外显示“返回标准界面”和“恢复内置皮肤”入口；拒绝授权或离开 surface 后，普通页面可立即恢复。

组件树有硬上限：components.json 256 KiB。schema v1/v2 上限为 32 个组件、每组件 256 个模板节点、16 层深度和 100 条重复记录；schema v3 上限为 128 个组件、每组件 2048 个模板节点、32 层深度和 250 个重复行，并允许 64 个本地标量状态与 64 个动作。Wasm 动态 UI 输出的 schema v4/v5/v6 有 256 KiB 总输出上限、最多 64 个组件、每个节点最多 64 个属性和 256 个子节点，并沿用每组件节点/深度限制；渲染器接受标准 HTML/SVG 元素及普通属性，而不是由元素/属性展示白名单限制。脚本、嵌入式浏览器、网络/导航属性、事件属性和行内 style 仍拒绝；样式通过经过隔离校验的插件 CSS 提供。包内图片通过专用资源字段引用，自定义元素映射为惰性 `div`。宿主只通过 `isTrusted` 用户事件发出剥离 DOM/Event 对象后的 `extension-event`，Wasm 侧只能经 `env.ui_input_read` 一次读取最多 64 KiB 的 JSON，包含插件本地状态、安全事件和宿主按插件读取权限投影的数据。每份数据投影最多 48 KiB，只含公开字段；地址、凭据、SDK 对象和未声明字段不会进入 guest。输入字段限长；生成界面中的 password/file/hidden 类型输入会拒绝。UI 循环已经接入 WebClient 授权生命周期，可把可信事件或最新数据快照作为下一次独立 Wasm 调用输入，最多串行排队 8 项并验证回调/状态归属；动作桥复核清单权限和会话状态。单个页面实例最多并发运行 2 个 Wasm worker，并限制最多排队 64 项。

图片资源只能从包内引用，CSS 不能读取外部 URL、脚本或浏览器存储。宿主动作需显式权限，并只能绑定可信的用户事件；输入或 change 事件不能触发宿主动作。focus/blur、hover 和 drag-start/over 等被动事件只可改动组件本地状态，不能触发语音操作。

注意：v3 CSS 和 surface 可以隐藏或遮挡普通语音控件。权限和返回标准界面提示由宿主在皮肤根之外绘制；其他界面控件仍受皮肤排版影响。测试时务必确保麦克风、设置、退出语音、屏幕共享操作和移动端导航仍有可达路径。组件演示页 /demo 使用合成数据，加入频道和聊天动作只更新演示状态；它不支持宿主控件或整页替换。

### schemaVersion 4：插件包描述与有界 Wasm 运行时

v4 在 open-skin 包中增加必需的 `plugins` 路径。服务端登记和客户端导入共用 `plugins.json` schema v1 校验器；校验插件 ID、页面、模式、权限、文件归属、路径唯一性和包内文件大小，并将插件文件与普通皮肤素材分别缓存。客户端还会对 Wasm 入口执行固定导入/导出 ABI 预检。SHA-256 授权基础会绑定插件描述、入口、样式和全部素材；本机授权记录还会绑定皮肤/插件版本、API 版本和权限策略版本。摘要只能发现已授权内容被替换，不能证明发布者身份。WebClient 有本地授权对话框和 Wasm 运行生命周期；目前支持安全 UI 输出、可信 UI 事件回调、插件专属 CSS、按清单权限过滤的公开数据投影（单份最多 48 KiB）和首版单动作宿主桥。支持的数据读取权限包括 `session.status.read`、`session.channels.read`、`session.members.read`、`chat.channel.read`、`favorites.read`、`servers.quickList.read`、`audio.status.read`、`voice.whisper.status.read`、`voice.screenShare.status.read` 和 `voice.screenShare.read`，另支持 `ui.surface.replace`。`ui.input.read` 单独控制插件是否能收到用户在插件自有输入框中输入或被浏览器自动填入的值；未获授权时仍可收到事件类型，但不会收到文本或勾选值。密码、文件和隐藏输入始终拒绝。宿主动作仅可由可信 UI 事件触发，按清单权限、动作参数和会话状态再次校验；生产构建也有全局 worker 上限。跨浏览器验证和独立安全审查仍待完成。

```json
{
  "schemaVersion": 4,
  "packageType": "open-skin",
  "id": "community.example-plugin-skin",
  "name": "Example plugin skin",
  "version": "1.0.0",
  "author": "Example author",
  "license": "MIT",
  "entry": "skin.css",
  "plugins": "plugins.json",
  "minAppVersion": "0.2.7-preview"
}
```

`plugins.json` 顶层 `schemaVersion` 当前为 `1`，并包含 1–64 个插件。每个插件声明 `id`、`name`、`version`、`apiVersion: 1`、`page`（`home` 或 `voice`）、`mode`（`widget` 或 `surface`）、必需的 `entry`、可选的 `mount`、`runtime`、`style`、素材路径数组 `assets` 和 `permissions`。入口扩展名 `.js` 默认对应 `javascript`，`.wasm` 默认对应 `wasm`；显式 `runtime` 必须与入口扩展名一致。入口及样式必须位于 `plugins/<id>/`；素材必须位于该插件自己的 `assets/` 子目录，只能是本地图片或 woff2 字体。插件不能共享文件；同一公开页面最多有一个 `surface`，且必须申请 `ui.surface.replace`。surface 不能声明 `mount`；widget 可选声明一个与 page 相符的宿主槽位。未指定时放在页面级插件宿主中。`ui.input.read` 是单独的输入值读取权限，授权提示会说明浏览器自动填入的值也可能被读取；不得让用户在皮肤输入框中输入密码或其他秘密。其余权限只能从 `src/shared/skin-plugin.ts` 的现有权限表中选择。

`plugins.json` 不超过 256 KiB；每个入口 JS 或 Wasm 不超过 256 KiB，每个样式 CSS 不超过 512 KiB；每个插件最多声明 32 个素材。客户端导入会拒绝不符合固定内存、导入、导出和 Wasm 模块结构限制的入口。皮肤包整体仍受通用 ZIP 文件数、展开大小、图像和字体限额约束。v1–v3 不接受插件代码。v4 JavaScript 仍只校验、缓存，不执行。生产 Wasm 仅在用户显式授权、摘要匹配时通过有界解释器启动一次性任务；它已支持上述权限化只读投影、安全 UI 更新和首版宿主动作桥。动作由可信 UI 事件引发、由宿主按插件权限和会话状态复核；浏览器瞬时手势传递尚未验证。数据变化会触发一轮新的有界执行。不要将有 DOM 的 iframe 当作网络沙箱：sandbox 不阻止 iframe 自己导航，`navigate-to` 也不能作为跨浏览器安全保证。完整运行时还需补充作者工具、端到端验证和独立审查，不可退回固定原生控件目录。

widget 的可选 `mount` 只接受这些公开锚点：`home.header.after`、`home.content.before`、`home.content.after`、`home.footer.before`、`voice.server-rail.before`、`voice.server-rail.after`、`voice.header.before`、`voice.header.after`、`voice.activity.before`、`voice.activity.after`、`voice.chat.before`、`voice.chat.after`、`voice.channel-panel.before`、`voice.channel-panel.after`、`voice.audio-dock.before`、`voice.audio-dock.after`、`voice.mobile-nav.before`、`voice.mobile-nav.after` 和 `voice.workspace.overlay`。它们提供初始语义位置；作者仍可用插件 CSS 和本地布局编辑器自由调整位置、尺寸、显隐、安全外观及同级顺序。surface 替换内置页面时，如果声明的槽位不存在，插件会回退到页面级宿主，避免 UI 丢失。专用的插件挂载管理界面仍未实现。布局权限只覆盖当前皮肤中实际渲染的插件节点，不能越过自身节点调整其他插件或宿主恢复控件。生产 v4 宿主已按 descriptor 管理当前页 widget/surface、授权、输出、事件循环、样式和清理。

## 首页内容和文案

`content.json` 完全可选。WebSpeak 自带中文、英语、德语、俄语和日语的基础内容，因此纯美术皮肤无需复制翻译文件。若希望为皮肤定制部分文案，可按 locale 覆盖连接首页内容和公开界面文案；未定义的语言、字段或翻译键会回退到 WebSpeak 内容，不要求皮肤重复提供整套文字。当前允许 1–20 个 locale，locale 写作 `en`、`zh-CN`、`ja-JP` 等形式。`defaultLocale` 必须指向一个已定义的 locale。示例：

```json
{
  "defaultLocale": "en",
  "locales": {
    "en": {
      "home": {
        "eyebrow": "A room of your own",
        "title": "Talk",
        "titleAccent": "together",
        "description": "Join a voice room from your browser.",
        "welcomeTitle": "Join the room",
        "welcomeDescription": "Choose a name and connect.",
        "features": [
          { "title": "Clear voice", "description": "Low-latency Opus audio." }
        ]
      },
      "messages": {
        "home.connect": "Enter the room",
        "voice.activity-heading": "Voice activity",
        "demo.heroLead": "A preview customized by this skin."
      }
    }
  }
}
```

`home` 支持 `brandName`、`eyebrow`、`title`、`titleAccent`、`description`、`welcomeTitle`、`welcomeDescription` 和 `features`。普通文字最多 500 个字符；`features` 最多 8 项，每项的 `title` 最多 80 个字符、`description` 最多 240 个字符。功能卡片图标和状态由应用提供，皮肤不能通过 JSON 注入节点。

`messages` 的键是公开页面中翻译调用使用的键；首页/语音页键可在 `web/src/i18n/web-client.ts` 查找，演示页键使用 `demo.` 前缀加字段名（例如 `demo.heroLead`、`demo.speakingNow`）。每个 locale 最多覆盖 200 条，每条文案最多 500 个字符。键只能由小写字母开头，并包含字母、数字或点。语言回退顺序为默认 locale、当前语言和更具体的 locale；之后回退到 WebSpeak 原文。

管理后台的文字不读取皮肤包，不能通过 `messages` 修改。

## CSS 皮肤接口

### 自动隔离

运行时把 `skin.css` 的每个选择器限定在皮肤自己的公开页面根节点内：

```css
/* 选择器必须使用公开的页面/部件钩子；运行时再加上皮肤根作用域。 */
[data-ws-page="voice"] [data-ws-part="voice.member.avatar"] {
  outline: 2px solid var(--skin-accent);
  outline-offset: 4px;
}
```

实际规则会被限定在类似下面的根节点内，不会匹配 `/admin/**`：

```css
[data-ws-page="voice"] [data-ws-part="voice.member.avatar"]
```

也可以写 `:root { --skin-accent: ... }` 设置皮肤自己的变量；`:root` 会被转换成当前皮肤根。选择器必须包含 `:root`、`[data-ws-page]` 或 `[data-ws-part]`。不要写 `:global()`、`html`、`body` 或 Vue 内部 class 作为公开接口。组件 class 可能随版本调整，`data-ws-part` 才是皮肤作者接口。自定义变量名必须使用 `--skin-` 前缀，不能覆盖 WebSpeak 的内部令牌。

页面根节点使用 `data-ws-page` 区分 `home`、`voice` 和 `demo`。使用 `data-ws-state` 选择明确状态，如 `active`、`idle`、`current`、`open`、`closed`、`drag-over`、`dragging`、`speaking`、`connected`、`self`、`mine` 或 `other`。语音成员还提供 `data-ws-speaking="true|false"` 和 `data-ws-self="true|false"`。交互元素会带有 `data-ws-critical="true"`；没有专属部件名称的按钮、链接、输入框、滑块和可拖动成员会使用通用部件 `data-ws-part="control"`，并以 `data-ws-control-kind` 标出 `button`、`link`、`input`、`checkbox`、`range`、`select`、`textarea`、`menuitem` 或 `draggable`。

### 已发布的部件名称

下列名称来自当前前端模板。对新功能，作者可以先用通用 `control` 部件；后续新增稳定部件会更新本目录。

| 页面区域 | `data-ws-part` |
| --- | --- |
| 通用 | `app`、`app.toast`、`control`、`skin.trigger`、`skin.menu`、`skin.option`、`language.trigger`、`language.menu`、`language.option` |
| 首页 | `home`、`home.header`、`home.brand`、`home.header-tools`、`home.gateway-status`、`home.content`、`home.hero`、`home.hero.eyebrow`、`home.hero.title`、`home.hero.description`、`home.features`、`home.feature`、`home.visitors`、`home.join-card`、`home.join-card.waveform`、`home.join-card.sonar`、`home.join-title`、`home.join-description`、`home.notice`、`home.form`、`home.server-target`、`home.field-label`、`home.field`、`home.relay-choice`、`home.relay-choice.copy`、`home.server-history`、`home.server-history.group`、`home.server-history.item`、`home.server-history.select`、`home.server-history.favorite-toggle`、`home.favorite-toggle`、`home.identity`、`home.identity-actions`、`home.identity-import.open`、`home.identity-export.button`、`home.identity-import-dialog`、`home.identity-import.header`、`home.identity-import.close`、`home.identity-import.textarea`、`home.identity-import.drop-zone`、`home.identity-import.file-button`、`home.identity-import.error`、`home.identity-import.security`、`home.identity-import.footer`、`home.identity-import.cancel`、`home.identity-import.submit`、`home.connect`、`home.security-note`、`home.footer`、`home.community-dialog` |
| 语音工作区 | `voice.shell`、`voice.workspace`、`voice.header`、`voice.header-actions`、`voice.breadcrumbs`、`voice.performance`、`voice.performance.panel`、`voice.performance.route`、`voice.performance.metrics`、`voice.performance.status`、`voice.performance.webrtc-stats`、`voice.connection-status`、`voice.audio-status`、`voice.poke`、`voice.scroll`、`voice.content`、`voice.activity`、`voice.activity.artwork`、`voice.activity-heading`、`voice.screen-share-error`、`voice.members`、`voice.members.empty`、`voice.member`、`voice.member.avatar-wrap`、`voice.member.avatar`、`voice.member.name`、`voice.member.status`、`voice.member.live-indicator`、`voice.member.stop-share`、`voice.member.share-actions`、`voice.member-panel`、`voice.member-panel.heading`、`voice.member-panel.search`、`voice.member-panel.channels`、`voice.channel-group`、`voice.channel-group.heading`、`voice.channel-group.members`、`voice.member-row`、`voice.member-row.avatar`、`voice.member-row.copy`、`voice.member-row.flags`、`voice.member-row.volume`、`voice.whisper-strip`、`voice.audio-dock`、`voice.audio-dock.microphone`、`voice.audio-dock.microphone-panel`、`voice.audio-dock.output`、`voice.audio-dock.output-panel`、`voice.audio-settings`、`voice.mobile-more`、`voice.mobile-nav` |
| 快速服务器 | `voice.favorite-servers.rail`、`voice.favorite-servers.rail.list`、`voice.favorite-servers.rail.item`、`voice.favorite-servers.server`、`voice.favorite-servers.avatar`、`voice.favorite-servers.tooltip`、`voice.favorite-servers.favorite-toggle`、`voice.favorite-servers.add`、`voice.favorite-servers.strip`、`voice.favorite-servers.strip.item`、`voice.favorite-servers.strip.server`、`voice.favorite-servers.strip.favorite-toggle`、`voice.favorite-servers.strip.add`、`voice.favorite-servers.switch-status`、`voice.favorite-servers.current-toggle`、`voice.favorite-servers.dialog-backdrop`、`voice.favorite-servers.dialog`、`voice.favorite-servers.dialog.header`、`voice.favorite-servers.dialog.close`、`voice.favorite-servers.dialog.form`、`voice.favorite-servers.dialog.field`、`voice.favorite-servers.dialog.input`、`voice.favorite-servers.dialog.target`、`voice.favorite-servers.dialog.hint`、`voice.favorite-servers.dialog.actions`、`voice.favorite-servers.dialog.cancel`、`voice.favorite-servers.dialog.submit` |
| 聊天与菜单 | `voice.chat`、`voice.chat.tabs`、`voice.chat.tab`、`voice.chat.heading`、`voice.chat.messages`、`voice.chat.event`、`voice.chat.message`、`voice.chat.message-avatar`、`voice.chat.message-body`、`voice.chat.message-bubble`、`voice.chat.empty`、`voice.chat.composer`、`voice.chat.status`、`voice.context-menu-backdrop`、`voice.context-menu`、`voice.context-menu.header`、`voice.context-menu.move-submenu` |
| 屏幕共享 | `voice.screen-share-settings`、`voice.screen-share-settings.heading`、`voice.screen-share-settings.fields`、`voice.screen-share-settings.note`、`voice.screen-share-settings.actions`、`voice.screen-player`、`voice.screen-player.stage`、`voice.screen-player.video`、`voice.screen-player.placeholder`、`voice.screen-player.exit`、`voice.screen-player.viewers`、`voice.screen-player.viewer-avatar`、`voice.screen-player.live`、`voice.screen-player.source`、`voice.screen-player.controls`、`voice.screen-player.volume`、`voice.screen-player.fullscreen` |
| `/demo` 演示页 | `demo.header`、`demo.brand`、`demo.header-tools`、`demo.badge`、`demo.skin-switcher`、`demo.language-switcher`、`demo.home-link`、`demo.reconnect`、`demo.reconnect.restore`、`demo.layout`、`demo.channels`、`demo.channels.heading`、`demo.channel`、`demo.channel.select`、`demo.channel.members`、`demo.main`、`demo.hero`、`demo.live`、`demo.hero.title`、`demo.hero.description`、`demo.hero.online`、`demo.wave`、`demo.voice-heading`、`demo.voice-grid`、`demo.voice-card`、`demo.avatar`、`demo.member-name`、`demo.member-status`、`demo.chat.heading`、`demo.chat.tabs`、`demo.chat.tab`、`demo.chat.messages`、`demo.chat.message`、`demo.chat.empty`、`demo.chat.composer`、`demo.chat.input`、`demo.chat.send`、`demo.actions`、`demo.actions.heading`、`demo.action.speaking`、`demo.action.poke`、`demo.action.reconnect`、`demo.note`、`demo.user`、`demo.poke-notification`、`demo.poke.dismiss` |

`voice.member.avatar` 是语音活动区头像；`voice.member-row.avatar` 是右侧成员树头像。状态属性还会使用 `current`、`drag-over`、`dragging`、`self`、`events-empty` 和 `messages-empty`。当前根节点以及屏幕共享播放器、弹窗、菜单都属于同一皮肤作用域。

首页快速连接和语音工作区的服务器栏共用同一列表：收藏项排在前面，最近连接补在后面；地址相同的收藏与历史只显示一项。每项的星标按钮可在两个位置收藏或取消收藏，取消收藏后若该服务器仍在最近连接中，它会留在列表的最近连接位置。皮肤可通过 `data-ws-state="favorite|recent"` 区分首页条目，通过 `data-ws-server-kind="favorite|recent"` 区分语音栏条目。

首页身份选项支持导入 TeamSpeak `.ini` 或身份字段，并可导出为 TeamSpeak `.ini`；导入弹窗解析身份的过程在浏览器本地完成。自定义皮肤可以分别调整身份操作按钮、粘贴区、拖放区域、安全提示和弹窗按钮，但不得隐藏或弱化权限继承与私钥安全提示。

`voice.activity.artwork` 是位于语音活动区内容上方的固定装饰平面。皮肤可以在其上绘制带透明背景的立绘，让角色压住成员卡片或直播画面的边缘；平面本身不占布局空间、不拦截点击，成员和播放器控件仍保持可交互。只通过背景图及背景定位/缩放来适配素材，不改变其定位和层级。

`voice.member-panel` 的 `::before` 是成员栏耳机/场景插画层，宿主已固定它的尺寸、位置、透视和前后层级；皮肤只需提供透明背景素材并调整背景显示、滤镜或阴影，不能自行定位或改变尺寸。消息空状态的 `::before` / `::after` 预留给气泡等小型装饰，宿主负责形状位置；皮肤可以绘制边框、底色和点状背景，但标题和说明文字仍由 WebSpeak 翻译并保持可见。

皮肤与语言选择器的触发按钮、菜单和每个选项都提供上述通用部件钩子。`skin.option` 另带有 `data-ws-skin-id`（内置项为 `builtin.light`、`builtin.dark` 和 `community.illusia-voice`，实例皮肤项为其清单 ID）；`language.option` 带有 `data-ws-language`。皮肤可以据此只装饰自己的选择项，而不影响其他皮肤、语言选项或选择器交互。例如：

```css
[data-ws-part="skin.option"][data-ws-skin-id="community.illusia-voice"][role="option"] {
  background-image: linear-gradient(110deg, #efffff, #c8f3f2);
}
```

### 令牌、字体、动效和图片

皮肤只负责“画什么样”，不负责“放在哪里”。可用的视觉规则包括文字/背景颜色、背景图片及其裁切、圆角、轮廓、阴影、滤镜和动画；边框可用不占空间的内阴影绘制。推荐先定义皮肤变量，再为公开部件编写视觉规则：

```css
:root {
  --skin-page-bg: #091317;
  --skin-panel: #142329;
  --skin-text: #edf8f5;
  --skin-muted: #9db5af;
  --skin-accent: #47dcc4;
  --skin-card-radius: 20px;
}

[data-ws-part="voice.screen-player"] {
  border-radius: var(--skin-card-radius);
  box-shadow: 0 18px 50px #0008, inset 0 0 0 1px color-mix(in srgb, var(--skin-accent) 50%, transparent);
}
```

`url()` 只允许引用包内图片或 WOFF2 字体。支持 PNG、JPG/JPEG、WebP、AVIF、GIF 和 WOFF2；SVG 不接受。自带字体示例：

```css
@font-face {
  font-family: "ILLUSIA Sans";
  src: url("assets/illusia-sans.woff2") format("woff2");
  font-display: swap;
}

[data-ws-page="voice"] { font-family: "ILLUSIA Sans", sans-serif; }
```

字体必须随包附带并拥有可再分发许可。自定义字体可能改变不同语言的字宽，因此校验器会给出提示；发布前必须检查中文、英语、德语、俄语和日语下的标题、按钮和长文案是否仍完整可读。字体族名和 `@keyframes` / `@layer` 名称会自动隔离，避免与其他皮肤冲突。请支持 `prefers-reduced-motion`，并确保焦点、错误、静音、正在说话等状态仍容易辨认。

### 固定布局与交互边界

以下 CSS 限制适用于 v1 和 v2：校验器会拒绝改变布局、定位、尺寸、文字流向/换行或交互命中区域的声明，包括 display、position、inset、z-index、宽高、内外边距、网格/弹性布局、间距、溢出裁切、变换、指针事件和字号等。v2 的位置和尺寸只从经过 schema 校验的 layout.json 生效。v3 为支持自由布局而允许这些声明，但仍限制皮肤根作用域、公开钩子、危险值和外部资源；只通过 CSS 隔离不能阻止皮肤作者遮挡控件。

因此，v1/v2 CSS 可以更换艺术素材、颜色和表面风格，但不能重排组件。v3 可以用 CSS 重新安排界面和组件盒子，也能隐藏普通界面部分；基础组件由宿主继续创建，宿主的恢复和权限 UI 位于皮肤作用域外。所有版本都应确保焦点、文字、键盘和触屏操作可用。

v1/v2 外观可以因窄屏而更换图片裁切或装饰，但 @media 规则也受固定布局限制。v2 应在布局数据中分别设置桌面、平板和手机配置；v3 可用媒体查询构建响应式 CSS。上线前仍需预览各设备尺寸、所有五种语言、键盘焦点、减少动效偏好，并确认必要控件可用、文字未被裁切。

## 安全边界和限制

校验在上传端和服务端执行；服务端只登记有效皮肤包，访客只能下载登记的包。当前限制如下：

| 项目 | 上限 |
| --- | ---: |
| ZIP `.wskin` | 20 MiB |
| 解压总大小 | 50 MiB |
| ZIP 条目数 | 128 |
| 单个 CSS 文件 | 512 KiB |
| `content.json` / `components.json` | 256 KiB |
| 单张图片（包括预览） | 16 MiB |
| 单个 WOFF2 字体 | 4 MiB |
| 每实例皮肤数 | 50 |
| 每实例皮肤包总存储 | 200 MiB |

压缩包路径穿越、重复/冲突路径、符号链接、异常 ZIP 元数据和本地文件头/目录不一致都会被拒绝。仅允许受支持的 CSS at-rule：`@media`、`@supports`、`@container`、具名 `@layer`、`@font-face` 和 keyframes。`@import`、脚本、HTML、外部网络资源会被拒绝；`!important` 可用于皮肤作用域内的样式。字体 `local()` 也会拒绝，避免绕过包内字体来源。

v1/v2 校验器会阻止隐藏必要操作控件和其容器。v3 可改变显示状态，因此皮肤开发者必须保留语音操作路径；授权界面、皮肤选择和恢复入口由宿主在皮肤作用域之外提供。以下选择器是旧格式对可选装饰部件的透明度白名单：

```css
[data-ws-part="home.hero.eyebrow"]
[data-ws-part="home.gateway-status"]
[data-ws-part="home.features"]
[data-ws-part="home.feature"]
[data-ws-part="home.visitors"]
[data-ws-part="voice.activity-heading"]
[data-ws-part="voice.member.avatar"]
[data-ws-part="voice.member.live-indicator"]
[data-ws-part="voice.member-row.avatar"]
[data-ws-part="voice.screen-player.viewer-avatar"]
[data-ws-part="voice.screen-player.live"]
[data-ws-part="demo.badge"]
[data-ws-part="demo.wave"]
[data-ws-part="demo.avatar"]
[data-ws-part="demo.member-status"]
[data-ws-part="demo.note"]
```

上面必须使用单独的精确属性选择器；不能通过父容器、组合选择器或子元素间接隐藏/重置内容。关键帧只有在其动画仅被这些可选部件引用时，才可使用透明度归零；若关键帧也被必要控件引用或动画名通过变量指定，则会被拒绝。`clip`、`clip-path` 和 `mask` 一律不允许，避免视觉裁切误伤真实控件。校验器是防止布局回归的边界，不是视觉质量证明；自定义字体、复杂背景和高对比特效仍需人工检查文字可读性与控件辨识度。

皮肤可以重画控制外观。v1/v2 不能重新布置必要操作；v3 可以，因此须人工实测加入/退出、麦克风状态、设置、菜单、屏幕共享退出、音量、全屏等操作的可达性。校验成功不代表设计质量合格；提交前要逐页实测窄屏和桌面尺寸、所有界面语言、键盘焦点与减少动效设置。

CSS 被限定在 `.ws-skin-root` 内，管理员页面不会继承皮肤。删除实例里的包会停止从服务器提供该包；已经下载过的浏览器副本会保留在本地存储，因此仍可能在该浏览器的选择器中出现。清除该站点的浏览器数据可移除本地副本。

## 制作与验收

1. 复制 `docs/examples/illusia-voice/`，先修改 `manifest.json` 的唯一 `id`、名称、作者、版本和授权。ILLUSIA 是完整的美术参考，不是必须沿用的角色或配色。
2. 只使用本目录公开的 `data-ws-part`、`data-ws-page`、状态属性和包内静态资源。不要依赖 Vue 内部 class。
3. 使用本地资源编写 `skin.css`；需要改首页文字或公开翻译时补充 `content.json`；需要自定义安全组件时使用 v3 的 `components.json`。
4. 在包根目录生成 ZIP，再改扩展名为 `.wskin`。PowerShell 示例：

   ```powershell
   Compress-Archive -Path .\docs\examples\illusia-voice\* -DestinationPath .\illusia-voice.zip -Force
   Rename-Item .\illusia-voice.zip illusia-voice.wskin
   Copy-Item .\illusia-voice.wskin .\web\public\skins\illusia-voice.wskin -Force
   ```

5. 在管理员后台 `/admin/skins` 上传。用访客浏览器分别检查连接首页、进入语音页和 `/demo`；测试自定义图片、所有交互控件、语音/静音状态、成员列表、聊天、屏幕共享播放器和设置。v1/v2 检查固定布局无回归；v2 还要检查作者默认布局与用户本地覆盖；v3 检查授权拒绝与撤销、公开数据边界和自定义组件失效恢复。
6. 检查至少一个窄屏尺寸和桌面尺寸，并检查焦点可见、对比度、动效偏好；确认没有第三方素材授权问题。

当前自动化回归涵盖 ZIP/清单验证、资源路径、CSS 隔离与拒绝规则、文案结构和服务端皮肤目录读写。视觉排版、内容遮挡和浏览器间表现仍须人工预览。

## 本轮实现问题记录

- 整页替换必须是用户明确批准的能力；仅安装皮肤不能隐藏普通首页或语音页。schema v2 surface 应声明 `ui.surface.replace`，并验证拒绝授权和撤销后普通界面会恢复。
- surface 上的“恢复内置皮肤”操作必须调用无条件的内置皮肤切换路径；用于“皮肤加载失败”提示的回退函数会在正常情况下直接返回。
- 自定义服务器栏需要用 `servers.quickList` 同时显示收藏与最近连接；只能把标签、类型、当前标记和随机令牌交给组件，切换时再由宿主解析本地目标。
- 最近连接和默认收藏名可能直接是服务器地址；组件上下文会在投影阶段将这种标签改为通用名称，不能改为暴露原始地址。
- KOOK 登录后的前两个用户授权语音房间已在 IAB 中读取。记录的仅为语音界面布局关系；没有保存服务器/房间标识、成员名称或聊天内容。完整的发现、运营及管理页面不属于皮肤范围，也没有检查。
