# WebSpeak 皮肤与运行时核心耦合跟踪

## 目标与判定标准

持续检查 WebSpeak 运行时核心中是否存在“只是为了让 KAAK 正常运行，而不是皮肤系统普适能力”的代码。按用户给出的定义，这类皮肤专属行为若必须改动运行核心才能工作，就记为耦合。此文件用于逐次记录扫描范围、证据、结论、处理状态和下次检查位置。

皮肤 UI、布局和专属展示应由 `.wskin` 包及已发布的通用皮肤 API 表达。仅仅因为目前只有 KAAK 使用某项中性 API，并不足以认定它是 KAAK 专属；需要结合 API 的实现、用途和包内调用证据判断。

## 扫描边界

- 运行时核心：`src/**`、`web/src/**` 中会参与服务端或浏览器运行的代码。
- 皮肤声明与样式：`docs/examples/**`、`.wskin`、皮肤目录中的 CSS/组件 JSON。它们用于判断消费者和需求来源，不计为核心耦合点。
- 测试、目录清单和打包脚本不计为运行时行为；若其中只有 KAAK 的回归断言，作为证据记录即可。
- 扫描时同时检查显式 `KAAK/kaak` 分支、仅由 KAAK 消费的宿主组件/布局分支，以及由 KAAK 使用但可能具备普遍价值的新增 API。

## 当前扫描记录

日期：2026-10-12
分支：`dev`
检查点：第四轮从候选项续扫；已核对 KAAK 3.1.28—3.1.86 的运行时改动节点，确认当前 21 项宿主 widget 注册表与实现完全匹配，并逐一对比示例消费者。KAAK 密码文案 skin-ID 分支、MyTS 占位按钮、`room-panel` 宿主分支、音频设置私有结构和首页 `kaak-home-*` 运行时样式钩子为已确认的核心耦合；前四者为显式功能/结构适配，首页钩子是 KAAK 命名 DOM 依赖。聊天/音频动作、`stateScope` 与 resetKey 具有通用 schema/权限语义，不按单一消费者认定为专属。`server-password` 是适用于任意皮肤的通用语义状态，列为低风险文档/兼容性监视项；其余私有 Vue class 依赖集中于非交互结构，作为皮肤包兼容性风险和通用 API 覆盖缺口跟踪。runtime Wasm plugin host 未发现 KAAK 专用路径，KAAK 包当前也未声明 runtime plugins。

### 扫描耦合级别总表

本表汇总已确认耦合、宿主私有 DOM 兼容风险和经审阅的低级别候选；下方逐次扫描记录继续保留为证据日志。“高（已解除）”保留最初发现级别并标明当前已去耦；“低（监视）”表示目前证据倾向于通用皮肤能力或尚未确认是 KAAK 专属，不计入已确认的核心专属耦合；兼容性风险行描述的是 KAAK 样式依赖宿主私有 DOM，不等同于 KAAK 专属运行逻辑。重复出现的部件已合并，避免重复计数。

| 位置 | 证据与判定 | 级别 |
|---|---|---|
| `web/src/views/WebClient.vue`；历史 `c6eeb49` | 原分支按 `BUILTIN_KAAK_SKIN_ID` 覆写密码弹窗按钮。现改为通用消息键 `passwordDialogConfirm`，KAAK 在自己的 `content.json` 提供多语言文案，其他皮肤回退宿主默认翻译；无皮肤 ID 判断。 | 高（已解除） |
| `src/shared/skin-plugin.ts`；`web/src/views/WebClient.vue`；历史 `458f95c`；`web/src/services/identity-provider.ts` | 原 `home.myts-login` 升级为需要 provider ID/名称的通用 `home.identity-provider`。宿主统一分发登录请求，应用代码可注册适配器；KAAK 只声明 `myts`，当前仍诚实提示开发中，没有声称已实现认证。 | 高（已解除） |
| `web/src/views/WebClient.vue`；`docs/examples/kaak-voice/skin.css` | 首页宿主 widget 现在只输出通用语义部件（公告标题/正文、社交链接、连接状态和身份入口）。KAAK 的专属定位、颜色和样式选择器留在皮肤包，核心不再输出 `kaak-home-*` 或 `kaak-myts-*` DOM 类。 | 高（已解除） |
| `src/shared/skin-plugin.ts`；`web/src/views/WebClient.vue`；`web/src/components/web-client/AudioDock.vue`；历史 `21c008d`；`docs/examples/kaak-voice/components.json` | 移除 `room-panel` 布局值和宿主桌面/移动专用分支。KAAK 在声明树中绘制自己的桌面控制条，噪声抑制、伴奏状态与动作通过通用权限化音频 API 提供；通用 `voice.audio-controls` 保留原生默认表现，不再接受 KAAK 布局选项。 | 高（已解除） |
| `web/src/components/web-client/AudioSettingsDialog.vue:27,35,80,89,91,105,107,164,184,186,200,202`；`docs/examples/kaak-voice/skin.css:2895,2962,2973,3031,3039,3319,3322`；历史 `2a80ade`；`docs/KAAK-CLONE-WORKLOG.zh-CN.md:302-307` | KAAK 视觉需求驱动核心弹窗加入 `.settings-audio-card`、`.settings-form-row`、`.settings-form-control` 等分组结构；KAAK 样式依赖这些未公开的内部类，默认样式和其他示例没有消费者。工作日志的通用复用意图尚未形成公开部件合同。 | 中 |
| `web/src/components/web-client/VoiceServerHeader.vue`、`VoiceChannelTree.vue` / `VoiceChannelTreeItem.vue`、`MemberActionsMenu.vue`、`ChatPanel.vue`、`AudioDock.vue`（默认布局）、性能面板；`docs/examples/kaak-voice/skin.css`；`web/src/services/skin-runtime.ts:170-190` | KAAK 当前样式仍依赖这些通用宿主控件的私有 DOM 类/层级，例如头部标题与搜索、频道成员标记、菜单细节、聊天作者/时间、默认音频坞细节和性能次级文字；其中部分非交互节点没有稳定 `data-ws-part`。静态交叉扫描统计到 54 个当前命中的非交互无专属 part class；该总数包含上一行已单独指出的音频设置结构选择器，不能与上一行相加；排除了已单列的 `kaak-home-*` 专属钩子。这是皮肤包对核心模板的兼容性/API 覆盖风险，不是 KAAK 专属运行分支。可由父/子公开 part 表达的横幅 copy、共享波形颜色、频道分支样式不计入此项。 | 中（兼容性风险） |
| `src/shared/skin-plugin.ts:76,481-482`；`web/src/views/WebClient.vue:1918`；`web/src/components/web-client/VoiceChannelTree.vue:58`、`VoiceChannelTreeItem.vue:52,242,272`；`docs/SKIN_DEVELOPMENT.md:167`；历史 `96d2eba` | `server-sidebar` 目前由 KAAK 首先/唯一消费，但它作为任意频道树可选布局写入通用文档，控制成员展示和折叠，没有 KAAK ID 或专属数据路径；先列为低级别监视，不认定为专属耦合。`96d2eba` 引入服务器头部/侧栏，不是 `room-panel` 的来源。 | 低（监视） |
| `src/shared/skin-plugin.ts:40-65`；`web/src/views/WebClient.vue:1784-1936,2031`；`docs/OPEN_SKIN_SYSTEM_SPEC.zh-CN.md:27`、`docs/SKIN_DEVELOPMENT.md:165` | `home.connection-status`、`home.server-announcement`、`home.social-links`、`voice.server-header`、`voice.server-banner`、`voice.channel-tree`、`voice.member-cards`、`voice.performance-panel` 目前只在 KAAK 示例找到消费者，但功能语义由通用连接状态、管理端公告、全站链接及服务器/频道/成员/性能数据驱动，控件 ID 已公开且无 KAAK 分支；公告/社交的 KAAK 类名耦合已单独列为高风险。`voice.server-switcher` 没有示例消费者，故不列入。 | 低（监视） |
| `src/shared/skin-plugin.ts:69-77,480-489`；`web/src/views/WebClient.vue:1918`；`docs/SKIN_DEVELOPMENT.md:165`；`docs/KAAK-CLONE-WORKLOG.zh-CN.md:351,511,521` | `memberActions` 与 `memberDragDrop` 当前只有 KAAK 包启用，但公开文档将其定义为通用可选能力，菜单和移动操作复用宿主既有流程；没有 KAAK 专属分支。保留监视，不能只凭唯一消费者升级为专属耦合。 | 低（监视） |
| `web/src/components/web-client/ServerPasswordDialog.vue:5,11`；`docs/examples/kaak-voice/skin.css:4078-4305`；`docs/SKIN_DEVELOPMENT.md:271`；历史 `458f95c` | `data-ws-state="server-password"` 目前只被 KAAK 用来区分浅色服务器密码弹窗，但它表达服务器/频道凭据的通用语义，机制适用于任意皮肤且无 KAAK ID 判断。精确状态值文档覆盖较少，作为低级别兼容/文档监视项，不算已确认的 KAAK 专属逻辑。 | 低（监视） |

### 本次续扫（2026-10-12）

- 公开规格检索区分了 CSS 部件 `voice.chat.status`（`docs/SKIN_DEVELOPMENT.md:288`）与运行时投影 `chat.status`：目前没有找到 `chat.status.panelOpen/tab/tabLabel`、`chat.togglePanel`、`audio.openSettings` / `audio.settings.open`、组件 `stateScope` 或 `room-panel` 的公开合同。当前 KAAK 包实际绑定 `chat.status.panelOpen` 与 `chat.status.tabLabel`；`chat.status.tab` 虽被通用上下文允许，但没有被此包引用。规格第 27 行只列出了宿主 widget ID，未描述这些字段、动作和布局值。
- `chat.status` 的字段由 `src/shared/skin-runtime-plugin-context.ts` 在 `chat.channel.read` 权限下白名单投影；`chat.togglePanel` 同样需要该权限，并调用普通聊天 composable 的开合状态；`audio.openSettings` 受 `audio.settings.open` 权限控制，宿主只打开可信音频设置对话框。实现没有 KAAK ID 判断，语义适用于自定义聊天/音频界面，因此不计为耦合；公开文档缺少这些字段和动作的说明，作为文档缺口记录。
- `stateScope` 只接受已公开的标量上下文路径，并通过同一路径权限检查；`ui.toggleState.resetKey` 只重置 schema 声明的布尔本地状态。两者由宿主通用机制实现，没有 KAAK ID 分支或 KAAK 专用数据路径，因此不计为耦合；公开文档对这些字段的说明仍不足。
- `home.social-links` 固定输出 WebSpeak 官方 GitHub、全站 QQ 群和 `/admin` 管理入口。QQ 地址在这次加入 KAAK widget 之前已用于默认首页社区弹窗；widget ID 也在公开宿主控件清单中，故其链接语义按通用站点导航排除。KAAK 的 `kaak-home-social-links` DOM 类和对应 CSS 仍属于上方记录的 KAAK 呈现耦合。
- `room-panel` 首次在 `21c008d` 以 KAAK 控制坞布局加入 schema 和宿主模板；当前唯一消费者、无公开合同且不能由已公开的皮肤动作重建其降噪按钮，现从候选提升为高风险耦合。后续若发现它已被定义为跨皮肤产品能力，再用正式合同证据复核。
- 重新按当前源码匹配宿主控件：注册表 21 项，`WebClient.vue` 实现 21 项，集合完全相同。内置示例中 KAAK 独占消费者包括首页状态/公告/社交/MyTS widget，以及语音服务器头部、服务器横幅、频道树、成员卡和性能面板；多个皮肤共用连接表单、皮肤/语言切换、聊天面板、音频控件、共享播放器等；`voice.server-switcher` 和 `voice.channel-panel` 暂无示例消费者。此计数只涵盖仓库内置示例。
- 对 `src/**` 与 `web/src/**` 再次检索字面量 `kaak`：运行路径仍集中在两个密码对话框的 KAAK ID 文案分支、KAAK 首页 widget 的 DOM 类名，以及内置皮肤目录元数据；首页 DOM 类名已列为确认耦合，其他候选仍结合消费者差异和结构分支判断。
- 逐项检查了 KAAK 独占的服务器头部、服务器横幅、频道树、成员卡和性能面板：宿主分别传入通用服务器标签/连接状态/收藏列表、公开 TeamSpeak 欢迎信息、公开频道树和加入频道动作、成员/共享状态、性能指标；实现没有按皮肤 ID 分支。它们仍是“目前只在内置 KAAK 示例使用”的监视项，而不是仅凭这一点升级为耦合。
- 历史提交 `458f95c feat: refine KAAK navigation and join experience` 首次把 `home.connection-status`、`home.myts-login` 和相应 KAAK 样式/翻译放入核心。工作日志明确要求 MyTS 只做入口外观并提示“开发中”，这支持将 MyTS 实现列为确认耦合；连接状态值来自通用错误/初始化状态，因此其功能语义按通用能力排除，KAAK DOM 钩子另列为确认耦合。`home.social-links` 使用产品全局链接，按通用导航排除；它在当前未提交差异中首次出现，未找到历史提交。
- 交叉核对未提交的运行时 diff（`src/**`、`web/src/**` 共 22 个改动文件）后，新增 KAAK 专属运行路径仍是本轮首页 widget/DOM 钩子；`WebClient.vue` 的 KAAK ID 分支继续只用于密码按钮文案。其余新增逻辑涉及 TeamSpeak 域名解析/安全校验、快速服务器匹配与中断切换、通用聊天状态/动作、成员显示/拖动及组件本地状态，没有发现 KAAK ID 条件或 KAAK 专用数据流。`skin-catalog.ts` 的 KAAK ID 只负责内置皮肤注册和包地址解析，作为目录机制排除。
- 在 `src/**`、`web/src/**` 重查运行时代码的 `KAAK/kaak` 标识后，除内置目录注册外，当前命中仍只有 `WebClient.vue` 的密码对话框 skin-ID 条件及 KAAK 首页 widget 类名/占位按钮；其他命中均位于 KAAK 包断言、目录测试或包验证中，不构成运行分支。通用 widget 的唯一 KAAK 消费仍只作为消费者差异记录。
- `git log -S'home.social-links'` 未找到历史提交，因为该 widget 仍处于当前未提交差异；`qqJoinUrl` 本身则早已服务于默认首页社区弹窗。此次归类依据当前运行语义与公开 widget ID，不把未提交差异伪称为已有提交历史。
- 版本缺口核对：`HEAD:docs/examples/kaak-voice/manifest.json` 是 `3.1.86`，工作树为 `3.1.106`，工作日志也止于 `3.1.86`；相关 KAAK 皮肤文件的 Git 历史在 `HEAD` 之后没有提交。因此 3.1.87—3.1.105 不是可逐提交追溯的已提交阶段，本轮以当前 `.wskin` 源文件与核心差异为依据，不推断缺失版本各自的修改内容。
- 当前 KAAK 组件文件差异增加了公告/社交通用 widget、声明式移动房间工具栏，并将聊天面板状态和开合动作接入公开 `chat.status` / `chat.togglePanel` API；这些移动布局仍在包内定义。它依赖的 `room-panel` 桌面控制坞分支仍是唯一已确认的相关专用布局耦合，其他 widget 的 KAAK DOM 类另列。
- 对照 `c6eeb49`、`458f95c` 与 `21c008d` 的提交补丁，三处高风险分支均能追溯到相应 KAAK 需求：skin-ID 密码按钮文案、无登录能力的 MyTS 首页占位，以及在 `room-panel` 桌面模板中加入语音设置入口和独立降噪切换按钮、在移动模板中加入对应设置/降噪入口。前两项是皮肤视觉专属；后一项把某一皮肤的控件组合直接加进核心。当前移动模板还在该布局分支中单独放置伴奏入口，详见本轮接口核验。
- 将历史筛选扩展为大小写无关的所有 `KAAK` 提交标题后，补核了先前过滤条件漏掉的 `17fb27b`、`53324ef`、`3476d47`、`a3bf476`、`83902e0` 及早期皮肤系统提交。服务器名称/图标被整理为受权限保护的 `servers.quickList` 公共投影；`auth.password.*` 钩子同时用于服务器与频道弹窗；频道成员操作复用同一个可选宿主菜单；频道容量源自 TeamSpeak 并进入公开 `session.channels`；权限差异随通用 widget 选项计算。这些改动由 KAAK 需求触发或首先消费，但当前实现均以通用权限、schema、数据投影或稳定部件形式供所有皮肤使用，未发现 KAAK ID 条件或专属数据路径。
- 历史提交 `2a80ade` 将音频设置中设备/音量字段重排为通用语义分组；工作日志明确为“通用音频设置控件”分组，功能本身不含 KAAK 分支。KAAK 样式当前依赖其中未公开的 Vue class，且示例目录中只有 KAAK 使用这些 class，因此仍记为结构兼容性风险，不把通用分组本身误升为 KAAK 专属运行行为。`8e580e7` 新增的设备选择器则提供了显式 `voice.audio-settings.device-select.*` 部件和通用键盘交互，属于可复用能力。
- `13f4dda` 历史上曾在皮肤布局编辑运行时强制 44px 触控尺寸；KAAK 工作日志记录该默认值随后已移除。当前 `skin-layout` 实现和布局 CSS 中均无 44px 强制规则，因此不属于现行耦合。
- 逐项核对完整 `skinPluginWidgets` 宿主映射后，核心选项分支只有 `room-panel`、`server-sidebar`、`screenShare`、`memberActions` 与 `memberDragDrop`，另有针对所有皮肤通用的视口分支。`server-sidebar`、屏幕共享隐藏选项、成员动作与拖动均有通用合同/文档；仅 `room-panel` 同时只由 KAAK 使用、无公开合同且附带专有控件组合，支持其高风险分类。
- 检查了完整 surface 渲染路径：`SkinPluginOutlet` 依据已授权组件的 `page` / `mode` 选择和抑制 surface，`WebClient.vue` 仅根据通用 `surface-change` 布尔值隐藏默认首页/语音壳；渲染器没有 KAAK ID 或专属组件名判断。KAAK、Harbor、Open Voice Surface 都声明了 `mode: "surface"`，因此整页替换路径属于跨皮肤能力。该 outlet 还在替换式语音表面通用注入服务器加号，不是 KAAK 专属行为。
- 续审剩余宿主模板与对话框状态后，没有发现新的 KAAK skin-ID 条件或其他隐藏布局分支；已存在的 `room-panel` 是唯一确认的 KAAK-only 选项分支。另确认 `ServerPasswordDialog.vue` 的 `data-ws-state="server-password"` 由 `458f95c` 加入，KAAK 3.1.83 样式据此区分浅色服务器密码弹窗和深色频道密码弹窗；这是没有 skin-ID 判断、适用于任意皮肤的语义状态，精确值只被 KAAK 使用且公开文档未列出，作为低风险文档/兼容性监视项。全仓搜索没有发现该状态值的其他运行时消费者。
- 扫描 KAAK CSS class 选择器并与 Vue 模板交叉核对：187 个不同选择器中，149 个与宿主 Vue class 相交；其中 73 个没有任何匹配宿主节点携带静态 `data-ws-part`，其余部分选择器有对应公开部件。由于运行时会给交互元素动态补通用 `control`，73 只是静态 class 统计，不代表缺失 API 数。开发规范明示 Vue class 不是稳定接口；将残留的私有 class 依赖作为包兼容性耦合风险，与核心是否含 KAAK 专用逻辑分开判定。
- 复查通用 `control` 的运行时覆盖：`skin-runtime.ts:170-190` 在所有 `.ws-skin-root` 下标记按钮、链接、输入、选择框、文本框、button/menuitem role 和可拖动元素，并通过 child-list observer 处理之后插入的节点。WebClient 页面根确实含 `.ws-skin-root`，KAAK 所用宿主控件位于其内，因此其按钮/输入可使用动态 `[data-ws-part="control"][data-ws-control-kind]`；非交互元素仍不会获得此部件。对当前 KAAK widget 命中的模板作标签分类，54 个 class 名仅出现在非交互且没有专属 part 的节点上，这是比“73 个静态缺 part”更准确的待审范围。
- 将内部 class 命中与当前 KAAK `components.json` 实际声明的 widget 交叉后，确认依赖落在当前使用的连接表单/语言与皮肤选择器、音频坞、频道树、聊天、成员卡、性能面板、共享播放器、服务器头部与横幅等宿主控件；并非全是旧默认壳的死选择器。缺少同节点公开部件的类集中在音频设置/坞细节、成员操作菜单、服务器头部细项、聊天元信息和少量状态图形。移动控制栏的旧类不据此算入当前 KAAK surface 依赖，避免误把默认壳隐藏时不渲染的选择器计为活依赖。
- 手工核对代表性缺口：`AudioSettingsDialog.vue` 仅在对话框根和设备选择器暴露公开 parts，KAAK 对其余约 30 个内部类做了细节样式；`VoiceServerHeader.vue` 的名称、状态标签、搜索和分隔区共 9 个 KAAK 命中都没有公开 part；`MemberActionsMenu.vue` 公开了菜单根、标题和移动子菜单，但关闭、个人音量、子菜单触发/箭头及空状态仍无单独 part。`AudioDock.vue` 的 KAAK 降噪/伴奏/控制组合依赖 `room-panel` 的专用实现，已计入高风险项，不重复列为单独候选。
- 继续逐项检查了频道树、聊天、共享/性能和横幅内部节点：频道树分支内容/成员列表、未静音麦克风图标、“你”标记没有直接 part；聊天 tab 标题附属文字、消息作者/时间元信息没有直接 part，但发送按钮有运行时通用 `control`；成员屏幕共享波形属于 live-indicator 子结构、性能面板的 `voice-audio-details` 和服务器横幅 copy wrapper 没有直接 part，标题/正文则各有公开 part。这些 class 被 KAAK 当前组件样式使用，属于非交互宿主结构的包到核心模板依赖；其中横幅文案自身已有 title/body 部件，不需要把这个既有展示再误判为专用横幅功能耦合。
- 逐类复核样式职责后，54 个候选并非都需要新部件：`.screen-share-wave` 只着色，可由现有 `voice.member.live-indicator` 继承颜色；`.ws-voice-server-banner-copy` 只设 `min-width: 0`，标题/正文已有独立公开部件；频道分支的边框/间距可主要放在现有 `voice.channel-tree.branch`。这些是可由已发布父/子部件表达的样式，不应被统计成必须新增 hook。仍有实质合同缺口的区域包括 `VoiceServerHeader.vue`（内部没有任何 `data-ws-part`）、`AudioSettingsDialog.vue` 多层布局/分组、聊天作者/时间元信息，以及频道树未静音麦克风和“你”标记；这些规则用类名或 DOM 层级才能区分。`memberActions` 菜单已有根/标题/移动面板部件，关闭、音量标签、子菜单行等细项需单独评估；控制按钮和输入本身已有动态 `control` 部件。
- 对上述剩余结构复核具体 CSS 用法：服务器头部整块的标题行、连接标签、搜索框与分隔线都靠私有 Vue class；音频设置的公开合同只有对话框根和设备选择器，KAAK 还依靠私有 class 排版分组、状态条和测试区域；聊天作者/时间虽可由消息体部件作为祖先限定，但当前皮肤需要区分作者、自身消息和时间，稳定子部件更直接；频道树“你”和活动麦克风缺少语义部件。成员菜单已有根、标题和移动子菜单，其它操作项按钮会动态获得通用 `control`，但体积/排列依赖类名，若需单项级主题则还缺通用菜单项语义。以上归类为皮肤包依赖宿主私有结构的兼容性风险/API 覆盖不足，不是新增的 KAAK 专用运行时分支；应优先补稳定的通用部件合同，避免把当前 Vue class 当兼容接口。
- 重新核对音频设置结构的起源：`2a80ade` 的确在 KAAK 专属布局提交中直接改了核心 DOM。新类在默认全局 CSS 和公开 part 表中都没有消费者，仓库示例也只有 KAAK 样式依赖；工作日志的“通用语义”说明复用意图，却没有形成系统合同。因此将其从待确认候选升级为中风险核心结构耦合，不把它误记为 skin-ID 条件分支。
- 重新审查 `96d2eba` 引入的 `voice.server-header` 与 `server-sidebar`：服务器头部组合通用连接状态、服务器快切列表和频道搜索；侧栏布局只改变通用频道树的成员展示与折叠方式。两者虽由 KAAK 首次提出且目前只有 KAAK 示例使用，但接口已公开、使用通用会话数据/现有连接操作，也没有 KAAK ID 分支；与 `room-panel` 将 KAAK 专属控制排布写入核心的情况不同，继续列为低风险通用能力。头部内部私有 class 的皮肤兼容风险仍按上方 API 覆盖缺口单独跟踪。
- 以当前 `dev` 工作树（`HEAD c994722`）重新检索生产运行代码的 `KAAK/kaak/MyTS/myts` 标识和布局条件：品牌标识命中仍只在内置目录注册、MyTS 占位 widget、首页 `kaak-home-*` DOM 类以及两个密码确认文案 skin-ID 条件；布局路径中 `room-panel` 仍是唯一含 KAAK 专属控件组合且无公开合同的分支，`server-sidebar` 则有通用文档合同。没有发现本次续审中新出现的 KAAK 专用运行分支；后续只在运行时文件出现新改动时重查，不重复当前完整字面搜索。
- 反查现有替代接口：`SkinPluginAction` / `ACTIONS` 仅提供麦克风、扬声器、音量和打开设置等动作，没有降噪切换动作；`21c008d` 与当前 `AudioDock.vue` 都证明 `room-panel` 会在宿主桌面/移动控件里注入专用降噪操作（移动布局还单独放置语音设置与伴奏入口）。密码弹窗虽有通用 `submitLabel` 组件属性，但它只由 `WebClient.vue` 按 KAAK ID 赋值；皮肤 schema/部件公开表没有提交文案配置。两者均缺少可由当前皮肤包独立表达的通用替代能力，支持现有高风险分类。
- 按用户关注点重新逐段审阅当前未提交的 `WebClient.vue` diff：服务器目标相等判断/连接中断、服务器显示名投影、`chat.status` 与 `chat.togglePanel`、`audio.openSettings` 都是与 skin ID 无关的通用连接或权限 API；新增的公告与社交 widget 功能也使用全站通用数据。该文件中确属 KAAK 呈现耦合的新增代码是 `kaak-home-*` 私有 DOM class，另有已单列的密码文案 skin-ID 条件和 MyTS 占位 widget；没有发现其他只为 KAAK 加入的隐藏分支。
- 按恢复点再次交叉搜索音频设置分组类：`settings-audio-card`、`settings-form-row`、`settings-form-control` 和 `settings-range-form-row` 仅命中 `AudioSettingsDialog.vue` 与 KAAK CSS；默认 `web-client.css` 和其它示例没有消费者，公开 part 文档只列 `voice.audio-settings` 根与设备选择器子部件。当前没有新的公开合同或跨皮肤证据替代它们，中风险结构耦合分类维持不变。
- 续审服务器头部内部结构：KAAK CSS 当前有 9 组选择器依赖 `VoiceServerHeader.vue` 的私有 class；默认全局样式和其它示例没有命中，组件内部也没有 `data-ws-part`。但整个 `voice.server-header` 控件作为通用宿主能力公开，行为只组合通用服务器状态、快切列表和频道过滤；因此其功能仍按低风险通用能力处理，内部 class 依赖计入皮肤兼容性/API 覆盖缺口，不另升为 KAAK 专用功能分支。
- 续审 `server-sidebar` 的频道成员模板：KAAK 样式使用的成员、头像、成员名、静音状态已有通用 parts；成员列表容器、本人标记、未静音麦克风图标和分支内容容器没有专属 part。`96d2eba` 把这些节点放在公开的 `voice.channel-tree` 通用 `server-sidebar` 布局分支中；功能不按 KAAK 专属分支统计，缺失的结构锚点继续归入私有 class 兼容/API 覆盖缺口。
- 校正聊天样式依赖的有效范围：当前 KAAK `components.json` 渲染 `voice.chat-panel`；旧 CSS 中 `kaak-workspace.chat-message-author`、`chat-message-time`、`chat-message-text` 等自定义消息部件在组件树里没有对应节点，不计为当前耦合。现行 ChatPanel 的作者/时间元信息由 KAAK 在公开 `voice.chat.message-body` 部件下通过 `.message-meta strong` 与 `time` 后代选择器样式化；这仍是非交互子结构的兼容性依赖，但可与已失效的旧选择器区分。
- 续审成员菜单：KAAK 通过公开可选 `memberActions` 启用通用音量、私聊、戳一戳、悄悄话、复制昵称和移动成员操作；`3476d47` 虽从 KAAK 需求起步，但不含 skin-ID 行为分支，菜单根、标题和移动面板都有公开 parts。关闭按钮、音量行、移动菜单触发器/箭头和空状态仍靠私有 class；可操作控件有通用 `control`，因此这是细节样式合同缺口，不认定为 KAAK 专属运行行为。
- 续审性能面板与成员共享细节：`.voice-audio-details` 在 `0a4fff6 feat: report live voice status...` 的通用性能组件中已存在，并非 KAAK 需求引入；KAAK 仅通过这个无专属 part 的 class 控制次级文字样式。性能面板根、面板、路由、指标、状态和 WebRTC 区域均有公开 parts。成员共享提示的 `.screen-share-live-indicator` 本身带 `voice.member.live-indicator` part；内部 `.screen-share-wave` 子节点只作装饰且 KAAK 只改颜色，可继承父部件的颜色。以上不升级为专属运行逻辑，分别保留私有结构兼容风险与可由父 part 表达的样式备注。
- 续审默认音频坞内部选择器：KAAK 会用 `.desktop-audio-dock-copy`、`.desktop-audio-dock-actions`、`.dock-slider-heading` 等内部 class 细调布局/文字；当前公开 parts 已覆盖音频坞、麦克风/扬声器区及各自弹出面板，滑杆也会获得通用 `control`。这些默认结构来自通用桌面音频控件和伴奏功能提交（`1c80791`、`0986c65`），不是 KAAK 专用改动；它们仍是内部 DOM 兼容风险。`.desktop-audio-dock-room-panel`、专用语音设置/降噪按钮则另按 `21c008d` 高风险分支记录，不与默认结构混算。
- 检查 Wasm runtime plugin host、manifest 校验、审批摘要和 action 转发：KAAK 3.1.106 清单没有 `plugins.json`/runtime plugin 声明；宿主以 `skinId` 隔离各皮肤的本地授权、按组件声明权限校验 action，并以通用 `page`/`mode` 控制生命周期与 surface，没有 KAAK 标识或 KAAK 专用路径，因此不列为耦合。
- 分发工件核验：当前清单版本为 `3.1.106`；示例与 `web/public/skins/kaak-voice.wskin` 两个 `.wskin` 的 SHA-256 相同。包内只有 `manifest.json`、`components.json`、`content.json`、`skin.css` 四项，且各项字节哈希都与 `docs/examples/kaak-voice/` 源文件匹配；本次审查所依据的 KAAK CSS/组件不是只存在于示例目录的未分发内容，包内也没有隐藏 JS/Wasm 插件资产。
- 首页公告卡片此前已按要求铺满左半栏并同步至 KAAK 包（`3.1.106`）；用户要求冻结横幅 UI，本轮续审期间未改动横幅或运行实现。

### 历史改动交叉核对

本轮读取 `docs/KAAK-CLONE-WORKLOG.zh-CN.md` 中 3.1.28—3.1.86 的运行时相关节点，并用当前源代码和组件包核对其结论：

- `options.screenShare`、性能面板开合交互、音频设备选择与菜单定位、公开布局部件注册均描述为跨皮肤能力；它们没有 KAAK ID 分支，KAAK 只通过包配置或 CSS 消费，暂不列为耦合。
- 第一方 `docs/examples` 的宿主控件映射已逐项统计：`home.connection-form`、两个 app switcher、`voice.audio-controls` 和 `voice.screen-share-player` 被多个皮肤使用；`voice.screen-share-start` 由 KAAK/Harbor 使用，`voice.chat-panel` 由 KAAK/Open Voice Surface 使用。`home.connection-status`、`home.server-announcement`、`home.social-links`、`home.myts-login`、`voice.server-header`、`voice.server-banner`、`voice.channel-tree`、`voice.member-cards`、`voice.performance-panel` 当前只在 KAAK 示例使用；`voice.server-switcher` 当前没有示例消费者。这里的“只在 KAAK 使用”仅指仓库内置示例，不能推断外部皮肤包的使用情况。
- 服务器导航加号的记录明确要求任意皮肤、任意连接模式可用，宿主同时注入普通导航与替换式皮肤轨道；这是通用功能，不列为 KAAK 专属。
- 屏幕共享成员数据/标记已由 Open Voice Surface、Harbor 与 KAAK 共用；服务器横幅读取的是 TeamSpeak 握手公开数据，宿主控件和数据路径没有 KAAK skin-ID 条件，暂不列为耦合。
- 服务器头部、服务器横幅、频道树、成员卡、性能卡等 widget 虽然目前多由 KAAK 首先或唯一消费，但它们作为固定宿主能力写入公开皮肤 API；结合通用组件实现，本轮记录为低风险监视项，而非已确认专属分支。
- 工作日志中首页 myts 入口及密码按钮文案是当前可确认的 KAAK 专属需求；密码按钮分支、MyTS 占位控件和 KAAK 首页 DOM 钩子已列在“已确认的核心耦合”。聊天上下文/动作与频道状态作用域具备通用权限/schema 实现，按通用 API 排除；`room-panel` 根据最早提交和核心模板分支证据列为高风险耦合。
- 历史提交 `9f11d11` 为 KAAK 的逐频道聊天开合首次加入 `stateScope`；工作日志明确把它做成任意公开标量路径可用的通用作用域，因此不按当前单一消费者认定为耦合，但公开规格缺项仍需记录。`room-panel` 的首次实现实际在更早的 `21c008d`；`96d2eba` 随后引入的是 `voice.server-header` 与频道树 `server-sidebar`。两者已在开发文档中作为通用宿主能力公开；结合本轮对数据/操作来源和当前模板分支的复核，不列为高风险耦合，服务器头部内部 class 的兼容风险仍单独跟踪。
- `voice.server-header`、频道树的 `server-sidebar` 展示以及头像/成员行扩展分别出现在 KAAK 相关提交 `96d2eba`、`b13bdf1` 中；它们由显式 widget ID 或通用 `layout` 参数启用，没有发现按 KAAK 皮肤 ID 分支。按目前证据继续记为通用 API 的首个消费者，而非确认耦合。
- `chat.togglePanel`、`audio.openSettings` 的核心 action 枚举/权限映射和 `chat.status` 投影在当前工作树可见；提交历史搜索未定位到其引入提交。实现使用通用宿主动作和显式权限，无 KAAK 专属分支，因此归入通用 API；公开规格条目及非 KAAK 示例仍缺失。

### 已排除项

- `web/src/services/skin-catalog.ts:6,47-60,77` 中 KAAK ID、目录名称和包 URL 是内置皮肤发现/打包注册，不会因 KAAK 的视觉或行为要求改变运行核心执行路径，当前不算耦合。
- `src/shared/skin-plugin.test.ts`、`web/src/services/skin-pack.test.ts` 中 KAAK 专属断言仅是测试证据，不会进入运行时。
- `voice.screenShare.*` 等已被 Harbor、Open Voice Surface 等皮肤共同使用的能力不属于 KAAK 专属；本轮搜索确认这些 widget 能力有多个皮肤消费者。
- `voice.screen-share-start` 与默认 `voice.audio-controls` 均由 Harbor、KAAK 的组件包使用；通用控件本身不算 KAAK 独占。嵌套在 `voice.audio-controls` 内的 `room-panel` 特殊分支仍单独计为高风险耦合。
- 工作日志记录的 `options.screenShare`、共享成员状态投影、通用服务器导航加号、服务器横幅数据读取及设备选择器交互，都有跨皮肤 API/消费者或明确的全局适用范围；本轮没有发现对应的 KAAK-only 运行时分支。
- `memberActions`、`memberDragDrop` 在公开开发文档中作为通用可选能力描述；目前 KAAK 是唯一消费者，但单一消费者本身不足以证明代码只服务 KAAK。
- `home.server-announcement` 提供本地化管理端欢迎语，`home.connection-status` 显示通用连接/初始化错误状态；两者语义适用于任意首页且作为通用 widget ID 写入公开规格，不单独计为 KAAK 行为耦合。它们当前使用的 KAAK 命名 DOM 钩子已在确认耦合项中单列。
- `home.social-links` 输出 WebSpeak 官方 GitHub、全站 QQ 群与管理员入口；`qqJoinUrl` 也用于默认首页的社区弹窗，且该 widget ID 在公开规格中注册，因此按通用站点导航排除其功能语义。其 KAAK 命名 DOM 类和皮肤 CSS 依赖仍计在上方确认耦合项中。
- `web/src/components/web-client/ChatPanel.vue` 新增的 `data-ws-chat-*` 属性在当前所有 `docs/examples` 皮肤样式/组件中都没有命中；本轮没有证据证明这些钩子是 KAAK 运行所需，暂不计为 KAAK 耦合。
- `chat.status`、`chat.togglePanel`、`audio.openSettings`、组件 `stateScope` 与 `ui.toggleState.resetKey` 均由通用白名单、权限或 schema 状态机制处理，未发现 KAAK ID 分支；作为通用运行时 API 排除出耦合项，单独保留公开文档缺项。
- 本次公告卡片宽度调整位于 `docs/examples/kaak-voice/skin.css` 并重新打包到 KAAK `.wskin`，没有增加运行时核心分支。
- 本次从 `c994722` 基线继续核查当前工作树的运行时代码差异：没有新提交；新增/变更的核心文件涉及服务器目标解析、skin plugin schema/context/outlet、WebClient、聊天/成员/连接 composable、快速服务器服务和成员状态工具。新增的 `chat.status`、`chat.togglePanel`、`audio.openSettings`、`ui.toggleState.resetKey` 由通用权限和 schema 白名单表达；`SkinPluginOutlet` 的状态刷新也对所有皮肤一致生效。没有发现新的皮肤 ID 分支。
- `WebClient.vue` 当前差异中的快速服务器目标比较、连接中断后切换、服务端名称回退、聊天状态投影和音频设置动作均适用于通用工作区；现存 `options.layout === "room-panel"` 仍是此前确认的 KAAK-only 核心分支，没有新增计数。首页公告/社交 widget 的语义可供任意首页使用，但核心输出 `kaak-home-*` 类名仍属于已登记的高风险项，不重复计数。
- 其他本轮检查的增量：`memberPresenceKey` 将已在频道内的成员统一显示为在线/离开/发言，避免不可能的“状态未知”；成员拖动对输入控件的保护、快速服务器按规范化 TeamSpeak 地址匹配，以及 SRV/DNS 安全解析均不检查皮肤 ID，行为适用于所有皮肤/连接用户，未发现 KAAK 专属数据路径。测试、翻译、目录版本和皮肤包更新不构成运行时分支。
- 对已确认的核心分支做精确定位回查：运行时代码中 `BUILTIN_KAAK_SKIN_ID` 只用于 `WebClient.vue` 两个密码对话框的按钮文案；`room-panel` 只出现在 schema 值校验、`AudioDock.vue` 布局和 WebClient 桌面/移动控件分支；MyTS 是单一占位 widget；KAAK 首页私有类集中在公告、社交链接、状态与 MyTS 节点。以上均与已登记的四项高风险耦合重合，没有发现额外的运行时命中。
- 本轮完成当前状态收尾核验：全量检索生产 `src/**`、`web/src/**` 后，KAAK/MyTS 字面量仅落在两个密码文案条件、首页私有类/MyTS 占位、内置目录注册/包 URL 和对应翻译；布局值命中仅有 KAAK-only `room-panel` 与已有通用合同的 `server-sidebar`。测试与包名不参与运行逻辑。此结果与已登记清单一致，作为当前审计基线；后续有新运行时差异时再增量续查。
- 逐项提取当前 KAAK `components.json` 的 widget、option、数据路径和 action：两个 surface 使用的宿主控件都在注册表内；`screenShare`、`memberActions`、`memberDragDrop`、`server-sidebar` 有通用文档，`room-panel` 是唯一未公开且在核心绑定专属控件组合的布局值。实际依赖的未充分公开合同是 `chat.status.panelOpen/tabLabel`、`chat.togglePanel`、`audio.openSettings` / `audio.settings.open`、`stateScope` 和 `ui.toggleState.resetKey`；其实现都是通用权限/schema/状态机制，没有 KAAK 判断。它们是文档覆盖不足，不另计核心专属代码。宿主控件清单在系统规格中完整，开发手册的简短清单遗漏部分首页 widget，但不影响实现是否通用的判定。
- 验证实际皮肤包而非只看源目录：`docs/examples/kaak-voice.wskin` 与 `web/public/skins/kaak-voice.wskin` 内的 `manifest.json`、`components.json`、`skin.css`、`content.json` 均与对应源文件一致；两包均没有 `.js`、`.mjs` 或 `.wasm` 可执行条目。KAAK 的自定义布局行为来自声明式组件/公开动作，未藏在额外脚本里；前述核心耦合仍是由宿主硬编码功能/类名产生。

### 高等级处理（2026-10-12）

- 密码确认文案：两个宿主密码对话框统一读取通用 `passwordDialogConfirm` 消息；KAAK 在包内多语言覆盖，其他皮肤使用宿主语言字典，不再按内置皮肤 ID 分支。
- MyTS 入口：通用 `home.identity-provider` 接收受校验的 provider ID 和显示名；宿主应用分发层提供注册/调用适配器接口。KAAK 包只请求 `myts`，尚无 MyTS 适配器，因而仍显示开发中提示。
- 首页呈现：核心只输出公告、社交链接、连接状态和身份入口的通用 `data-ws-part`；首页专属排版留在 KAAK CSS。
- 音频控制台：移除未公开的 `room-panel` 选项及宿主布局分支；KAAK 声明自己的桌面控制条，通过通用音频状态、降噪和伴奏动作调用宿主既有功能。
- KAAK 皮肤包升级至 `3.1.107`，示例归档与内置公开归档重新打包并保持一致。

## 下次恢复位置

恢复基线：分支 `dev`、`HEAD c994722`；工作树 KAAK 包为 `3.1.107`。原 4 项高等级问题均已处理：密码文案改为包级消息覆盖，MyTS 入口转为通用身份提供方分发接口，`room-panel` 控件排布由 KAAK 声明树拥有，KAAK 首页不再依赖核心输出的私有类名。仍有 1 项中等级音频设置对话框私有 DOM 结构耦合，低级别监视项继续保留。下一轮从未处理的中等级开始；只检查自此工作树状态之后新增或改变的运行时文件及其皮肤依赖，不重复已解除的高等级项和横幅 UI 审查。
