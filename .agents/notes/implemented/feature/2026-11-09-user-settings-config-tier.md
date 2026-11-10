# Agent Note: 用户设置层与配置目录

Status: implemented

用户设置现在有唯一的存放位置与生效边界，桌面 App 的宿主框架还没有选定。本文记录这层为什么独立于宿主、已经交付的范围、否决了什么，以及留到后续模块接线的部分。设置面板设计稿在仓库外，不作为事实源。

**取代检查。** 活动树里没有记录持有用户设置放哪里、哪些选择交给用户这个决策。[隐私边界与本地接口防护](../../implemented/architecture/2026-10-20-privacy-and-local-access-boundary.md)持有脱敏顺序、监听地址与令牌边界；[容量三门槛与正文回收](../../implemented/architecture/2026-10-20-retention-three-gates.md)持有正文预算与回收水位；[读取架构与多客户端演进](../../implemented/architecture/2026-11-02-read-architecture-and-client-seams.md)持有页面读取的统一入口；[界面中英双语](../../implemented/feature/2026-11-04-i18n-bilingual-ui.md)持有语言偏好的存放与切换；[前端降噪原则进入常备指令](../../implemented/process/2026-10-24-frontend-denoise-standing-rule.md)与[前端设计规则立唯一权威 UIUX-DESIGN.md](../../implemented/process/2026-11-08-uiux-design-rulebook.md)持有界面表达规则。本文消费这些边界，不改写它们，也不移动或删除任何记录。[后台性能监控](../../implemented/process/2026-11-03-background-monitoring-rollout.md)持有告警链，[后台性能监控提案](../../proposed/process/2026-11-03-background-monitoring.md)持有阈值与提醒规则；异常提醒设置只控是否发通知，不复制阈值。

## Problem

项目里能调的东西很多，能由用户决定的选择没有家。`src/config.ts` 读 7 个 `ATC_` 环境变量，生产权威在 launchd plist 的 `EnvironmentVariables`，见 [service-support](../../../../scripts/service-support.ts)；`intervals` 与 `deriveBudget` 只给容量实验注入，`gatewayTimeoutMs` 在 `src/` 内没有消费点。一百多个模块级常量散在 `src/main.ts`、`src/retention.ts`、`src/owner.ts`、`src/http.ts` 与 `web/app.css`，其中定时周期、容量水位、身份匹配窗口、派生版本和脱敏盐改了会让历史读数换了解释。用户偏好则是另一套：`tc.theme` 存 `web/layout.js`，`tc.lang` 存 `web/i18n.js`，都在浏览器 `localStorage` 里，采集器读不到，换一个浏览器或换一个宿主就丢。

上游接入又散在仓库外：magpie 的 `plugins.json`、`~/.codex/config.toml`、OTLP exporter 环境变量，都要用户照 [运维手册](../../../../docs/operations.md) 手抄片段和令牌。桌面端重构要收拢这些入口，但宿主框架还没选，IPC 与窗口生命周期都没定。等框架定了再整理配置，等于让每个新宿主各自发明一套偏好存放方式，回头再迁一次。

这次评估反复改过口径。Pis 先要求配置开放包容，连前端样式也开放出去；随后否掉一栏全是技术词汇的只读展示，又要求再审其余设置项是否会增加心智负担。定下来的判据是：每条设置都要能回答选了之后会有什么不同；看一眼就知道该选哪个；需要先解释原理才能选的，产品替用户定。按代码里有什么来分类是错的判据，会把上百个内部策略常量搬进设置页。

还有三个真实缺口。[架构设计](../../../../docs/architecture-design.md#容量与保留) 的未决问题 3 明说分级保留的切分点要先定一个偏好；`src/privacy.ts` 的 `redact()` 支持自定义规则，生产调用却全传空数组；`web/app.css` 有完整成套的 `:root` 令牌，字号仍是十几个绝对 px 档位，`prefers-reduced-motion` 的读取散在六个 web 文件里。这些缺口各自归所属模块，设置层只负责把它们变成用户能决定的选择，并守住不越界。

## Decision

### 两层配置，一个用户文件

进程装配继续由 `src/config.ts` 持有：`dataDir`、端口、上游路径、两个容量预算从环境与 plist 读，监听地址写死 `127.0.0.1`。用户设置放 `src/settings.ts`：默认值、类型与白名单校验都在这一层，只依赖 node 内置，`config.ts` 保持叶子位置，不反向 import 它。用户文件是 `<dataDir>/config/settings.json`，只存与默认值不同的项；`<dataDir>/config/themes/` 为自定义主题预留目录。目录 0700、文件 0600，沿用 `dataDir` 与密钥文件的权限。`src/main.ts` 在启动装配处加载一次，任务体不在 main 里展开。

`loadSettings()` 在启动时校验：未知键、类型不符、取值越界、非法 JSON 都回退到默认值，记一条固定码与键名的诊断 issue，不改写也不删除用户文件。`saveSettings()` 只接受完整且固定的字段形状，拒绝缺字段、未知键与越界值，写文件走临时文件 0600 加 rename。默认值随代码发布且只读，升级新增设置项时旧文件不需要动。令牌、脱敏盐、`read.token` 与三个认证令牌都不进用户文件，也不进备份 bundle；[运维手册](../../../../docs/operations.md) 的 restore 仍只认三个文件，`settings.json` 与 `themes/` 的备份另行交代，不改恢复契约。

### 已交付范围：第一阶段

四类页签按评估稿定：外观、采集来源、历史与空间、接入。第一阶段只接线外观六项与接入片段，其余分类只给事实说明，不摆开关：

- 外观：主题预设（纸白、海蓝、苔绿）、明暗三态、四个受控强调色、字号三档、减少动效、中英语言。都经具名 `saveSettings` 写服务端，成功后即时生效；主题与强调色落在 `--accent`、`--accent-soft`，字号落在 `--fs-scale`，减少动效由 `web/motion.js` 的单一来源同时驱动 CSS 与 JS。
- 接入：渲染 [运维手册](../../../../docs/operations.md) 里已有的 Claude Code、Codex、magpie 片段，令牌显示为占位符，从数据目录读取，不写进用户文件、日志或 fixture。
- 采集来源、历史与空间、异常提醒、记录完整正文、自定义隐藏词都还没有接线。对应页签只写当前事实，界面不出现声称已生效的文案。

不进设置的清单继续钉住：内部版本常量与代号、端口与监听地址、定时器与批次、超时、每页条数、容量水位与 raw TTL、19 家 Agent 勾选清单、默认页签与阅读视图、栏宽与折叠、窗口恢复状态、启动恢复、自定义快捷键、自动更新、匿名使用数据、逐 token 编辑器。版本号只留在代码和出问题时才导出的诊断包里，且用自然语言表达。

### 落地前置与读写边界

字号切换生效要先收敛 `web/app.css` 的绝对 px 档位：现有 `font-size` 与 `font:` 简写统一乘 `--fs-scale`，`font-size:0` 的骨架占位保持 0，三档取既有档位、不新增半像素档。减少动效先收拢六个 web 文件里的 `prefers-reduced-motion` 读取，`web/motion.js` 的 `prefersReducedMotion()` 与 `setReduceMotion()` 是 JS 侧唯一来源，`web/app.css` 同时保留系统媒体查询与 `:root[data-reduce-motion="true"]` 两条同等口径的降级规则。这两项属于落地前置，第一阶段已完成。

设置读取是新增用途，按[读取功能接入规则](../../../../docs/read-feature-rules.md#桌面客户端约束)先定用途、owner 与预算：`src/read-contract.ts` 有具名 `settings` 与 `saveSettings`，两者共用 `/api/settings` 一条传输 seam，`web/read-http.js` 仍是唯一的 HTTP fetch 调用点，`web/app.js` 用同一个 `createHttpReadTransport({ fetcher })` 工厂装配设置读写与会话读取。`src/http.ts` 为该路径单开一个固定路径的 POST 分支，只接受固定字段的 JSON，体积上限 4096 字节，拒绝未知键，响应体不含令牌、盐、任意路径内容或环境变量原文。Host、Origin 与同源校验由既有 `checkAccess` 承担，GET 与 POST 走同一套门，没有新增跨域白名单，也没有把文件系统访问暴露成通用 bridge。新增的 `web/settings.js`、`web/settings-panel.js` 登记在 `STATIC_FILES`，新文案中英两份同改。

`tc.theme` 与 `tc.lang` 从 `localStorage` 迁到服务端权威。迁移只在服务端 `settings.json` 还是空 overrides 时采用旧键一次，每次启动都清掉这两个旧键；服务端已有任何 overrides 时，浏览器残留值只清不采用，避免刷新后把用户刚保存的 dark/zh 覆盖回去。`tc.settings` 仅作服务端不可写时的降级缓存。语言切换分两种重绘：启动时按服务端语言只重画静态 chrome（读取 store 尚未加载），用户主动切换时走动态区也重画的完整路径；面板骨架只生成一次，静态文案用 `data-i18n` 标记在 `paint()` 里按当前语言更新。

### 界面表达

设置面板从窗口右侧压入，顶栏最右一个 20×20 的调节图标；主题三态快捷切换留在顶栏，语言收进面板。按 [UIUX-DESIGN.md](../../../../UIUX-DESIGN.md) 与[前端降噪常备约束](../../implemented/process/2026-10-24-frontend-denoise-standing-rule.md)：分组、间距、对齐与表面明度差解释结构；不加分类副标题与模块说明；正常态不带状态条；数据口径与生效范围收进 hover 与 focus-visible 都触发的气泡；全局口径只出现一次。导航选中用中性灰底，accent 只给内容区选中；动效共用一条 easing，时长落在既有令牌区间。

主题开放到受控配色令牌与预设 JSON 为止。导入主题只校验 `accent`、`accentSoft`、明暗、字号与动效字段的取值范围，不读任意路径，也不执行用户提供的 CSS 或脚本。

### 后续接线按依赖顺序排

采集来源、完整正文、分级保留、异常提醒与自定义隐藏词排在各自模块接线之后，本阶段不摆开关：

- 来源开关要落在发现与调度层，不能改适配器解析路径，[数据源彼此独立](../../proposed/feature/2026-11-04-agent-session-adapters.md) 是硬约束。
- 完整正文要动摄入层的 `body_ref` 读取；分级保留要回答 [架构设计](../../../../docs/architecture-design.md#容量与保留) 未决问题 3，把天数换算成预算并说明估算从哪来。
- 异常提醒要等监控告警链落地；自定义隐藏词会改变脱敏规则，得先定 `PRIVACY_TRANSFORM_VERSION` 的升级与存量重建路径，不混进设置层提交。
- 采集类设置由采集器启动时读一次，改动后由面板提示重启；起停走 `bun run service restart|stop|start`，窗口退出只释放窗口 owner，不隐式停采集。

分级保留的第一版只表达保留多久，不改 80% / 95% 水位、不改七天 raw TTL、不动 `PATROL_THRESHOLDS`。评估稿里的 2.1 / 6.4 / 11.8 GB 是合成示意，实现要按真实使用量算，并在界面给出估算口径。

## Alternatives considered

**等桌面 App 定了 Electron 还是 Tauri 再做。** 宿主框架决定 IPC、窗口与分发，settings.json 的形状、校验、生效边界和 WebView 用什么技术栈无关。先落这一层，桌面端接入时只需要换装配处，不必重做偏好语义与迁移。

**继续用环境变量和 plist 承担全部配置。** plist 是 launchd 的装配权威，改一次要懂 `ATC_` 变量名并重启服务，用户看不出选了之后界面会有什么不同。它继续管进程装配，用户选择交给设置层。

**全部放浏览器 localStorage。** 现有 `tc.theme` 与 `tc.lang` 就是这么做的。采集器读不到，多宿主不同步，清站点数据就丢，也没法备份或分享主题。浏览器存储只保留降级缓存这一用途。

**把一百多个内部常量搬进 settings.json，并加一栏只读展示。** 这是评估里被否掉的方案。内部版本号、水位、超时、批次都是工程事实，用户打不开也用不上；只读展示把技术债摆进设置页，增加心智负担。它们留在代码与诊断包。

**配置放 `~/.config/tracery`，数据放 Application Support。** 两端都在同一台机器上，备份、迁移与分享要各找一遍。用户文件放数据目录还天然继承 0700 权限。

**开放自定义 CSS、逐 token 编辑器或脚本。** 用户要先理解令牌与色彩预算才选得动，而且 [桌面客户端约束](../../../../docs/read-feature-rules.md#桌面客户端约束) 不允许把原始文件系统访问暴露成通用 bridge。外观开放到预设、调色与导入导出，能分享，也不越界。

**设置写进生产 SQLite。** UI 不直接写生产库，配置的生命周期与采集数据不同，备份恢复契约也不同。用户文件单独存，恢复 bundle 的三文件清单不动。

**给每个分类各写一份 proposed note。** 四类设置共享同一个问题、同一份取代检查与同一条读写边界，拆开会在四篇里重复基线。等某个分类长成独立决策，例如分级保留的切分点或监控通知，再另开记录。

**保存端点收任意键值对，图省事。** 那会把配置写成通用 bridge，也绕开校验。写入口只认固定字段，未知键明确拒绝。

**旧 localStorage 偏好每次启动都迁一次。** 浏览器里残留的 `tc.theme=light`、`tc.lang=en` 会在每次刷新时覆盖服务端保存的 dark/zh。改为只在空 overrides 时采用一次、每次启动清旧键，服务端已有选择时浏览器不再发言。

## Testing

合成数据验收，不写真实请求正文、账号、令牌或用户配置进 fixture、日志与提交。

- `tests/settings.test.ts`：全新目录生成 0700 `config/` 与 0600 `settings.json`；坏文件（未知键、错误类型、越界取值、非法 JSON）回退默认值、留可查 issue、原文件不变；保存只落改过的项，重新加载得到同一份生效值。
- `tests/settings-http.test.ts`：GET 响应只含 `settings` 与 `overrides`，不含令牌、盐、路径或环境变量原文；POST 拒绝未知键、缺字段、非法 JSON、超限与跨站 Origin 且文件不动；Host、Origin、同源三道门对 GET 与 POST 同样生效，Bearer 可读，非设置路径 POST 仍 405。
- `tests/web.test.ts`：reduced-motion 判定只有 `web/motion.js` 一个来源，CSS 两条降级同口径；设置层是外观与语言的唯一权威，旧键迁移只在空 overrides 时采用且每次清键，面板骨架带 `data-i18n` 可重绘，未接线开关不在界面。
- `tests/http.test.ts`、`tests/read-boundaries.test.ts`、`tests/i18n.test.ts`、`tests/i18n-coverage.test.ts`：静态白名单覆盖新增 web 模块、没有第二个 fetch 调用点、中英字典无缺项。`bun run typecheck` 干净；最窄测试集 112 项通过。
- 浏览器合成验收（隔离实例 8399：独立 `ATC_DATA_DIR` 与 `ATC_PORT`，会话适配器与社区插件注入为空，未碰 8320）：六项外观切换后服务端落盘正确；刷新后 `dark/zh` 不被旧键覆盖，`html lang`、`data-theme`、字号、强调色、减少动效与静态文案一致；全新服务端采用旧键一次并清键；已有 overrides 后旧键只清不采用；面板与顶栏切语言都写服务端，中英两套骨架文案与 aria 同步。

生产真实流量验收尚未做：这一阶段只改本机设置与页面，不改采集器摄入或读模型；部署后的真实只读复核另记 [验收记录](../../../../docs/acceptance.md)，不把合成数据说成真实流量验收。

## Consequences

用户选择第一次有了跨浏览器、跨宿主一致的存放位置，采集器与页面读同一份文件。写入口是页面第一次拿到写能力，Host、Origin、同源三道门由既有 `checkAccess` 承担，GET 与 POST 共用，响应体只回设置本身；POST 的体积上限、固定字段与未知键拒绝把这次扩大的接口面收在最小范围。

theme 与 lang 不再随清站点数据丢失，浏览器存储降级为不可写时的缓存。`settings.json` 只存 overrides，默认值随代码发布，坏文件不改写不删除，升级新增设置项不需要迁移旧文件。restore bundle 仍是三文件清单，用户文件与 `themes/` 的备份路径在[运维手册](../../../../docs/operations.md) 另行交代；恢复后外观不会自动回来，文档必须写清这一点。

字号与动效的前置收口让六项外观切换在整套页面生效，`--fs-scale` 乘既有档位，没有新增半像素档；CSS 媒体查询与用户开关走同一套降级规则。语言切换后面板骨架与动态区都按当前字典重画，英文界面里页签、页脚与 aria 不留中文。

第一阶段没有动采集来源、完整正文、分级保留、异常提醒与自定义隐藏词，界面也不摆这些开关。它们的接线顺序由各自模块的依赖决定：`PRIVACY_TRANSFORM_VERSION` 的升级与存量重建、监控告警链、[架构设计](../../../../docs/architecture-design.md#容量与保留) 未决问题 3 的切分点都还没有定，提前存值会变成点了没用的假承诺。桌面宿主未定，装配处以后换连接与凭证注入时，设置层不读宿主全局变量或任意环境变量。

## Related

[按完整会话的时间淘汰](../../implemented/feature/2026-11-10-session-retention.md)把「历史与空间」一类接到本层的 fixed-field 写入口上（保留天数、运行方式），并改变本文「第一阶段不动分级保留」的范围说明；设置文件的形状、校验与三道门仍由本文持有。
