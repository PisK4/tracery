# Agent Note: 用户设置层与配置目录

Status: proposed

本文把桌面端设置面板评估定成一份可落地的提案：在桌面 App 成型之前，先引入一层用户设置，让可视化选择有唯一的存放位置与生效边界。设置面板设计稿在仓库外，不作为事实源；本文只写为什么这样定、否决了什么、代价与验收。

**取代检查。** 活动树里没有记录持有「用户设置放哪里、哪些选择交给用户」这个决策。[隐私边界与本地接口防护](../../implemented/architecture/2026-10-20-privacy-and-local-access-boundary.md)持有脱敏顺序、监听地址与令牌边界；[容量三门槛与正文回收](../../implemented/architecture/2026-10-20-retention-three-gates.md)持有正文预算与回收水位；[读取架构与多客户端演进](../../implemented/architecture/2026-11-02-read-architecture-and-client-seams.md)持有页面读取的统一入口；[界面中英双语](../../implemented/feature/2026-11-04-i18n-bilingual-ui.md)持有语言偏好的存放与切换；[前端降噪原则进入常备指令](../../implemented/process/2026-10-24-frontend-denoise-standing-rule.md)与[前端设计规则立唯一权威 UIUX-DESIGN.md](../../implemented/process/2026-11-08-uiux-design-rulebook.md)持有界面表达规则。本文消费这些边界，不改写它们，也不移动或删除任何记录。[后台性能监控](../../implemented/process/2026-11-03-background-monitoring-rollout.md)持有告警链，[后台性能监控提案](../process/2026-11-03-background-monitoring.md)持有阈值与提醒规则；异常提醒设置只控是否发通知，不复制阈值。

## Problem

项目里能调的东西很多，能由用户决定的选择没有家。`src/config.ts` 读 7 个 `ATC_` 环境变量，生产权威在 launchd plist 的 `EnvironmentVariables`，见 [service-support](../../../../scripts/service-support.ts)；`intervals` 与 `deriveBudget` 只给容量实验注入，`gatewayTimeoutMs` 在 `src/` 内没有消费点。一百多个模块级常量散在 `src/main.ts`、`src/retention.ts`、`src/owner.ts`、`src/http.ts` 与 `web/app.css`，其中定时周期、容量水位、身份匹配窗口、派生版本和脱敏盐改了会让历史读数换了解释。用户偏好则是另一套：`tc.theme` 存 `web/layout.js`，`tc.lang` 存 `web/i18n.js`，都在浏览器 `localStorage` 里，采集器读不到，换一个浏览器或换一个宿主就丢。

上游接入又散在仓库外：magpie 的 `plugins.json`、`~/.codex/config.toml`、OTLP exporter 环境变量，都要用户照 [运维手册](../../../../docs/operations.md) 手抄片段和令牌。桌面端重构要收拢这些入口，但宿主框架还没选，IPC 与窗口生命周期都没定。等框架定了再整理配置，等于让每个新宿主各自发明一套偏好存放方式，回头再迁一次。

这次评估反复改过口径。Pis 先要求配置开放包容，连前端样式也开放出去；随后否掉一栏全是技术词汇的只读展示，又要求再审其余设置项是否会增加心智负担。定下来的判据是：每条设置都要能回答选了之后会有什么不同；看一眼就知道该选哪个；需要先解释原理才能选的，产品替用户定。按代码里有什么来分类是错的判据，会把上百个内部策略常量搬进设置页。

还有三个真实缺口。[架构设计](../../../../docs/architecture-design.md#容量与保留) 的未决问题 3 明说分级保留的切分点要先定一个偏好；`src/privacy.ts` 的 `redact()` 支持自定义规则，生产调用却全传空数组；`web/app.css` 有完整成套的 `:root` 令牌，字号仍是十几个绝对 px 档位，`prefers-reduced-motion` 的读取散在六个 web 文件里。这些缺口各自归所属模块，设置层只负责把它们变成用户能决定的选择，并守住不越界。

## Proposal

### 1. 两层配置，一个用户文件

进程装配继续由 `src/config.ts` 持有：`dataDir`、端口、上游路径、两个容量预算从环境与 plist 读，监听地址写死 `127.0.0.1`。用户设置另起一层：默认值、类型与校验放一个新的叶子模块，只依赖 node 内置；用户文件放 `<dataDir>/config/settings.json`，只存与默认值不同的项；主题预设放 `<dataDir>/config/themes/`，一套一个文件，供复制与导入。`dataDir` 本来就是 0700，密钥文件是 0600，用户文件沿用同一套权限。

`src/config.ts` 保持叶子位置，不反向 import 新模块；`src/main.ts` 只在配置装配处调用一次加载函数，任务体归持有该概念的模块。启动时校验：未知键、类型不符、取值越界都走明确拒绝路径，回退到默认值并记一条可查的 issue，不静默改写用户文件，也不删掉不认识的内容。默认值随代码发布且只读，升级新增设置项时旧文件不需要动。

令牌、脱敏盐、`read.token` 与三个认证令牌不进用户文件，也不进备份 bundle。[运维手册](../../../../docs/operations.md) 的 restore 只认三个文件，多一个少一个报 `restore_bundle_invalid`；`settings.json` 的备份与迁移另行交代，不改恢复契约。

### 2. 设置范围

四类页签按评估稿定：外观、采集来源、历史与空间、接入。外观含主题预设、明暗三态、强调色、字号、减少动效与语言；采集来源显示自动发现的结果，开关只作用于发现结果，不列 `src/sources/catalog.ts` 里 19 家 Agent 的名单；历史与空间给保留时长与效果预览，外加额外要隐藏的词；接入渲染 `docs/operations.md` 里已有的片段，令牌由装配处注入，不写进用户文件、日志或 fixture。

v2 补进来的两项也在范围内：采集异常提醒只控是否发通知，阈值与规则归[后台性能监控提案](../process/2026-11-03-background-monitoring.md)与 `scripts/patrol.ts`；记录完整请求正文只影响新摄入，不改已落库的历史。导出会话不进设置，它属于会话列表上的单次动作。

不进设置的清单同样要钉住：内部版本常量与代号、端口与监听地址、定时器与批次、超时、每页条数、容量水位与 raw TTL、19 家 Agent 勾选清单、默认页签与阅读视图、栏宽与折叠、窗口恢复状态、启动恢复、自定义快捷键、自动更新、匿名使用数据、逐 token 编辑器。版本号只留在代码和出问题时才导出的诊断包里，且用自然语言表达。

### 3. 交付顺序按接线依赖排

设置层与宿主框架无关，先落这一版。第一阶段交付目录、schema、读写端点、面板骨架与外观：外观改动纯在 CSS 变量数据上生效，零数据风险；接入片段是只读渲染；`tc.theme` 与 `tc.lang` 从 `localStorage` 迁到服务端权威，浏览器存储降级为不可写时的缓存。

采集来源、完整正文、分级保留、异常提醒与自定义隐藏词排在各自模块接线之后。理由很直接：来源开关要落在发现与调度层，不能改适配器解析路径，[数据源彼此独立](2026-11-04-agent-session-adapters.md) 是硬约束；完整正文要动摄入层的 `body_ref` 读取；分级保留要回答 [架构设计](../../../../docs/architecture-design.md#容量与保留) 未决问题 3，把天数换算成预算并说明估算从哪来；异常提醒要等监控告警链落地；自定义隐藏词会改变脱敏规则，得先定 `PRIVACY_TRANSFORM_VERSION` 的升级与存量重建路径。未接线的开关不摆到界面上，界面不声称已经生效。

分级保留的第一版只表达保留多久，不改 80% / 95% 水位、不改七天 raw TTL、不动 `PATROL_THRESHOLDS`。评估稿里的 2.1 / 6.4 / 11.8 GB 是合成示意，实现要按真实使用量算，并在界面给出估算口径。

### 4. 读写边界

设置读取属于新用途，按[读取功能接入规则](../../../../docs/read-feature-rules.md#桌面客户端约束)先定用途、owner 与预算：具名操作进 `src/read-contract.ts`，HTTP 调用仍只在 `web/read-http.js`，`tests/read-boundaries.test.ts` 继续守门。保存走同一文件里的一个具名 `saveSettings`，`src/http.ts` 为它单开一个固定路径的 POST 分支，只接受固定字段的 JSON，限制体积，拒绝未知键，不返回令牌、盐或任意路径内容。Host、Origin 与同源校验对写路径同样生效，不新增跨域白名单，不把文件系统访问暴露成通用 bridge。

采集类设置由采集器启动时读一次，改动后由面板提示重启；起停走 `bun run service restart|stop|start`，不 kill，也不另起一个实例。外观类改动即时生效，不重启进程。窗口退出只释放窗口 owner，不隐式停采集，这条来自[桌面客户端约束](../../../../docs/read-feature-rules.md#桌面客户端约束)。

新增 web 模块要登记 `src/http.ts` 的 `STATIC_FILES`；新增文案要中英两份同改，`tests/i18n-coverage.test.ts` 守门。

### 5. 界面表达

设置面板从窗口右侧压入，顶栏最右一个 20×20 的调节图标；主题三态快捷切换留在顶栏，语言收进面板。按 [UIUX-DESIGN.md](../../../../UIUX-DESIGN.md) 与[前端降噪常备约束](../../implemented/process/2026-10-24-frontend-denoise-standing-rule.md)：分组、间距、对齐与表面明度差解释结构；不加分类副标题与模块说明；正常态不带状态条；数据口径与生效范围收进 hover 与 focus-visible 都触发的气泡；全局口径只出现一次。导航选中用中性灰底，accent 只给内容区选中；动效共用一条 easing，时长落在既有令牌区间；`prefers-reduced-motion` 的完整降级要 CSS 与 JS 同口径。

主题开放到受控配色令牌与预设 JSON 为止，不执行用户提供的 CSS 或脚本。字号先收敛 `web/app.css` 的绝对 px 档位成一个可乘 scale，再从既有档位里取三档，不新增半像素档。动效开关先把六个文件里的 `prefers-reduced-motion` 读取收成一个来源，`web/motion.js` 已是 JS 侧统一入口。这几项属于落地前置，不是设置项本身。

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

## Acceptance criteria

合成数据验收，不写真实请求正文、账号、令牌或用户配置进 fixture、日志与提交。

1. 全新 `dataDir` 启动后生成 `<dataDir>/config/`，权限 0700；`settings.json` 只含用户改过的项，其余取发布默认值。
2. 手改 `settings.json` 为未知键、错误类型、越界取值：启动不崩，回退默认值并留下一条可查 issue，原文件不被改写或删除。
3. 写入端点只接受固定字段与有限体积；未知键、缺字段、超限、跨站 Origin 与无认证的非同源请求都拒绝；Host 与同源校验对 GET 与 POST 同样生效。
4. 响应体不含令牌、盐、任意路径内容或环境变量原文。
5. 外观六项在页面即时生效：主题预设、明暗、强调色、字号三档、减少动效、语言。浅色与深色两主题同查，选中态与 hover 可区分，可点元素过 hover、cursor、focus-visible 三件套。
6. 减少动效在 CSS 与 JS 两侧同口径；字号三档取自 `web/app.css` 既有档位；正常态不出现状态条，必要口径只在气泡里。
7. `tc.theme` 与 `tc.lang` 从 `localStorage` 迁移一次成功，服务端不可写时页面仍可渲染；中文与英文两份文案同步，`tests/i18n-coverage.test.ts` 通过。
8. 设置读取走 `src/read-contract.ts` 的具名操作与 `web/read-http.js`；`tests/read-boundaries.test.ts` 通过，web 目录下没有第二个 fetch 调用点；新增 web 模块已登记 `STATIC_FILES`。
9. 采集类设置提示重启，起停只经 `bun run service restart|stop|start`；窗口退出不停止 launchd 采集，服务仍由 KeepAlive 托管。
10. 未接线的开关不出现在界面，界面不出现声称已生效的文案；接入片段与 `docs/operations.md` 一致，令牌在装配处注入。
11. 恢复 bundle 仍只认三个文件；`redaction.salt` 与库的绑定、三个令牌的首次启动规则不变。
12. 最窄测试覆盖加载校验、迁移、写入端点与前端守门；`bun run typecheck` 与 `bun run verify:notes` 通过。合成验收与上线后的真实只读复核分开记录，不把合成数据说成真实流量验收。

## Risks

- **写入口扩大了本机接口面。** POST 是页面第一次拿到写能力，checkAccess 的 method 分支改动必须连带验收 Host、Origin 与同源三道门；任何放宽都会让浏览器里的第三方页面碰到本机配置。
- **自定义隐藏词会改变脱敏口径。** 规则一变，旧行的占位符按旧规则生成，读模型要能分辨。升级 `PRIVACY_TRANSFORM_VERSION` 与存量重建是显式动作，不混进设置层提交。
- **分级保留的换算容易失真。** 天数、正文预算与每笔实际字节不是线性关系，[架构设计](../../../../docs/architecture-design.md#容量与保留) 已写明不按固定天数推断触顶时间。界面给估算时要写清口径，且先解决未决问题 3。
- **异常提醒可能变成假承诺。** 监控告警链尚未交付，开关先存值等于点了没用。接线完成前不进界面。
- **主题文件是外部输入。** 导入要校验字段与取值范围，限制体积，不能把任意路径读成主题，也不能执行文件内容。
- **动效与字号的前置没收口。** 六个 reduced-motion 读取点与十几个 px 档位不先收敛，字号切换与减少动效会在个别组件上失效，看起来像设置没生效。
- **采集类设置只在启动时读一次。** 用户改完若不重启，面板显示的值与实际行为不一致。提示文案要写动作与后果，不做定时器热重载。
- **备份迁移没覆盖用户文件。** restore 契约不动意味着 `settings.json` 与 `themes/` 要另有备份路径；文档不写清，用户会以为恢复后外观还在。
- **桌面宿主未定。** 装配处注入连接、凭证与深链解析的规则来自[桌面客户端约束](../../../../docs/read-feature-rules.md#桌面客户端约束)。以后换宿主时，设置层不能顺势读宿主全局变量或任意环境变量。
- **界面容易重新堆解释文字。** 评估稿 v1 已被指出说明过多，落地时按 [UIUX-DESIGN.md](../../../../UIUX-DESIGN.md) 的降噪规则与验收清单走查，别把删掉的文字搬进设计批注。
