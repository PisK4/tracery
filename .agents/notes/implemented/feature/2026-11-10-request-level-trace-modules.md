# Agent Note: 请求级 Trace 模块与会话时间线视图

Status: implemented

## Problem

中栏按请求分组，组之间只有一条很轻的边界。读者看到的是一片连续的单行步骤：同一笔请求的 System、用户消息、工具调用、结果与记录挨在一起，和前后请求的界限要靠编号与缩进去猜。2026-11-10 的生产截图里三行 `11 Bash` 平铺在列表里，既没有框也没有组头；读者先得判断这三行是不是同一笔请求，才能决定右栏该看什么。

会话时间轴上还有两种断裂。辅助请求与压缩请求被 `viewMatches` 在主链视图里过滤，`chain_role` 判成 `branch` 或 `unknown` 的请求也不在默认阅读集里。压缩明明发生在 #3 与 #5 之间，默认视图看不到 #4；门禁检查同样消失。Pis 给出的口径是从第一句 System 加第一条 User 开始，按时间一直不断，压缩和门禁检查都算在内。现行「全部」视图虽然收下所有行，却把辅助请求压成占位行，还把子代理行按毫秒交错混进来，读起来与一条连续的时间线差很远。

右栏以选中步骤为唯一依据，读数、正文、工具、路由、待办五个页签都围绕这一行展开。请求级的事实散在各处：`req_kind` 在右栏事实卡，耗时在行尾，`chain_role` 在汇总页。模块一旦成为中栏的主要识别单位，右栏需要先回答这一笔请求是什么，再回答点中的这一行是什么。

样张 `.archify/session-timeline-demo-v2-20261110.html` 把请求级模块卡、时间线视图、右栏三段并在一起验证过，Pis 已确认方案，包括模块卡回到疏朗间距、组头不画分隔线、中栏不显示展示行号。样张是合成数据，只定形态，不定生产事实。

## Decision

分六处落地，全部在 `web/` 与文档，不改 schema、不改摄入、不改用途判定、不升算法号、不逐会话 rebuild。

### 一、时间线取代全部

[`viewMatches`、`viewOfRow`、`effectiveView`](../../../../web/trace-view.js) 与 [`app.js`](../../../../web/app.js) 的 `state.view`、`revealViewOf`、`viewOptionsOf` 把内部取值 `all` 统一改成 `timeline`，不留 `all` 别名。`state.view` 不写 URL，但直达链接的空视图回退、辅助请求的归属视图与测试断言里都有这个名字；留两套叫法比多改几处更费解释。

时间线按 `(conv_key, actor)` 的 `traversal_ord` 从首笔起连续铺到末笔，辅助请求、压缩请求、门禁检查都以完整模块出现；子代理请求留在各自的 S 编号视图，不混进主代理时间线。`main` 视图继续按 `chain_role` 过滤，作为上下文续写证据的读数。S 编号视图沿用 `jumpToSubagent`、`spawnFrom` 与返回启动点。

### 二、请求级模块卡

沿用 [`trace-dom.js`](../../../../web/trace-dom.js) 的 `req:{id}` 组身份与 `projectSteps` 的内容归属，只把组的边界从轻微分隔升级成卡片：浅底细边框、12px 卡间距、组头写窗口序号、`req_kind`，右端是推理时间（icon 加数值，按行内读数同一组时长档位换色）与提示 token（icon 加数值），组头与框内行之间不画横线。整笔耗时不落组头，提升到会话头「会话指标」详情按会话级口径给（Pis 复审意见）。框内每行保持自然行高与胶囊角色标，选中只留 2px 左缘。中栏不显示展示行号。

组头字段从 [`RequestRow`](../../../../src/queries/projection.ts) 与现有详情读数取，不新增具名读取、不扩 HTTP 路由，按[读取功能接入规则](../../../../docs/read-feature-rules.md)复用原 Interface。

### 三、特殊块与子代理

压缩记录复用 `web/trace-view.js` 的 `record('compaction', ...)` 事件位。工具调用所在模块里加一条「启动子代理 S1」记录块，点击走 `web/app.js` 的 `jumpToSubagent`；同一处的工具名 chip 回到纯展示，不再兼任跳转入口。子代理 S 编号、独立视图与返回启动点沿用[子代理阅读视图](../../implemented/feature/2026-11-08-subagent-actor-views.md)，`agent_ref` 与 `spawnFrom` 数据链路不变，见[工具调用标出它启动的子代理](../../implemented/feature/2026-11-08-tool-call-spawn-link.md)。

### 四、右栏当前 trace 段

提案时的「模块概要 + 当前 trace」两段，落地后经 Pis 复审撤掉模块概要：请求级事实（`req_kind`、`purpose_chain`、`chain_role`、`prev_relation`、`body_state`、耗时、用量）在读数页与既有读数卡里已经各就各位，固定段整段删除。右栏顶部只留当前 trace，跟着 `currentSelectedStep` 与 [`resolveSelectedSource`](../../../../web/rail-facts.js) 切换，写角色、来源、协议坐标与正文引用。五页签次序由 [`RAIL_TABS`](../../../../web/rail-tabs.js) 决定，本轮不改登记，只把各页内容按模块归位：四路证据、回复、结构、用量折叠区收进对应页，待办保持轮次作用域。

展示行号只在右栏出现，指模块内第几行，供导航用。`messageOrd`、`callOrd`、`blockIndex`、`path` 是 `resolveSelectedSource` 落出的协议坐标，两者分开写，框内序号不冒充协议坐标。

### 五、样式、文案与静态资源

[`app.css`](../../../../web/app.css) 落模块卡与胶囊角色标，色值走现有 `:root` 与两个暗色块，图标走 [`icons.js`](../../../../web/icons.js) 的 IconPark 注册表。[`i18n.js`](../../../../web/i18n.js) 与 [`i18n-en.js`](../../../../web/i18n-en.js) 同改「全部 → 时间线」与空视图提示。新增 web 模块登记 [`STATIC_FILES`](../../../../src/http.ts)。正文与路由内容继续转义。

### 六、文档与验收

[GLOSSARY.md](../../../../GLOSSARY.md) 的阅读视图取值改成「时间线」「主链」与 S 编号，并写清会话时间线与 `chain_role` 的分工。[架构设计](../../../../docs/architecture-design.md)写派生与阅读的关系，[UIUX-DESIGN.md](../../../../UIUX-DESIGN.md) 落模块卡规则。合成验收与真实流量只读验收分开写进[验收记录](../../../../docs/acceptance.md)。

## 取代检查

活动树里搜到的相关记录逐篇判定，全部是部分取代或纯引用，没有整篇归档的。

- [中栏按请求新增消息分组](../../implemented/feature/2026-10-28-request-delta-trace-groups.md)持有组的内容归属：可信 delta 投影、末尾回复组与三个反例。本轮沿用 `req:{id}` 组身份与 `projectSteps`，只改组的可见边界与组头，归属口径不变。部分取代，保持活跃。
- [子代理阅读视图](../../implemented/feature/2026-11-08-subagent-actor-views.md)持有三视图、默认主链与辅助请求只在全部视图可见。本轮改 `all` 的名字与内容形态，S 编号视图、`spawnFrom`、`isAuxRow` 不变。部分取代，保持活跃。
- [工具调用标出它启动的子代理](../../implemented/feature/2026-11-08-tool-call-spawn-link.md)持有工具名 chip 可跳与 `agent_ref` 数据链路。本轮把唯一跳转入口移到「启动子代理 S1」记录块，chip 回到纯展示；`agent_ref`、`jumpToSubagent`、返回启动点不变。部分取代，保持活跃。
- [单一轨迹生产阅读](../../implemented/architecture/2026-10-23-single-timeline-production-reader.md)持有请求身份、有界读取、选中步骤唯一与右栏按步骤来源定位。本轮改组呈现、行密度与右栏分段，定位逻辑不变。部分取代，保持活跃。
- [中栏只呈现内容，详情集中右栏](../../implemented/simplification/2026-10-24-trace-content-only-and-wide-rail.md)定中栏与右栏的职责。组头放请求级读数属于组身份行，不回到每行右侧附加信息。保持活跃。
- [前端降噪原则进入常备指令](../../implemented/process/2026-10-24-frontend-denoise-standing-rule.md)的现行规则在 [UIUX-DESIGN.md](../../../../UIUX-DESIGN.md)。本轮按它删掉展示行号、组头分隔线与常驻状态标签。保持活跃。
- [桌面 UI 重构](2026-11-09-desktop-ui-redesign.md)与[前端样式以桌面定稿样张为准：IconPark 与冷灰色板](../../implemented/feature/2026-11-10-demo-visual-parity.md)持有冷灰 token、五页签、KPI 概要板与 IconPark 几何。本轮沿用视觉契约，不改视觉基调。保持活跃。
- [跨 Harness 压缩判定与时间线可见性](2026-11-10-cross-harness-compaction.md)持有压缩请求的 `req_kind` 与 `purpose_chain` 判定。本轮只决定压缩模块在时间线上怎么显示，不碰判定、不升 `PURPOSE_VERSION`。保持活跃。

proposed 阶段只出链。本记录转 implemented 时，在上面四篇部分取代的记录里补回链；提案未定之前给已交付决策加指向未定决策的链接，只会降低活跃树的信噪比。

## 时间线与链角色的分工

会话时间线是 `(conv_key, actor)` 按 `traversal_ord` 排列的展示顺序，从首笔 System 加第一条 User 起连续到末笔。辅助请求、压缩请求与门禁检查都在其中。`chain_role` 是 [`settleRelation` 与 `chainRolesOf`](../../../../src/derive/decision.ts) 按语义指纹共同前缀算出的续写证据，取 `main`、`branch`、`unknown`；`purpose_chain` 决定请求进不进祖先集合。

压缩后输入变成摘要加新消息，不再是压缩前序列的前缀，`settleRelation` 仍会落 `branch` 或 `unknown`。模块 #4 在时间线上排在 #3 与 #5 之间，`chain_role` 照旧给 `branch`。时间线管阅读顺序，链角色管上下文续写证据，页面不改派生结论，也不把 `branch` 画成断点。

框内每条 trace 单独可点。生产右栏的正文页、工具四页与结构列表都以 `messageOrd`、`callOrd`、`blockIndex` 定位，见 [Trace Pair 配对页与右栏就地阅读](../../implemented/feature/2026-10-24-trace-pair-rail-page.md)；模块整体作为一次点击会让这些入口失去落点。

## Alternatives considered

**模块整体作为一次点击，右栏围绕三条 trace 画。** 落选。行粒度选中是既有模型，配对页与结构高亮都挂在步骤坐标上。样张注入点击验证过：点 #2 第二行，模块概要文本不变，当前 trace 从 Assistant 切到对应行，协议坐标跟着变（落地后模块概要整段撤除，「不随点选变化」由读数页自身的稳定性承担）。三条合成一个整体要重新定义五个页签的选中单位。

**只把「全部」改名为「时间线」。** 落选。现行 `viewMatches('all')` 收下子代理行与辅助占位行；时间线要的是主代理按时间连续、辅助与压缩给完整模块、子代理留在 S 视图。同名不同实比多改几处更费解释。

**让时间线视图承诺 `chain_role=main`。** 落选。压缩后输入没有共同前缀，`settleRelation` 落 `branch` 是诚实读数。把展示顺序写成链角色的结论会让两个事实互相顶替，也让[跨 Harness 压缩判定与时间线可见性](2026-11-10-cross-harness-compaction.md)的验收标准失真。

**把压缩判定、算法号与逐会话 rebuild 并进这次改动。** 落选。判定归那篇 note，要升 `PURPOSE_VERSION`、`GROUP_ALGORITHM`、`DERIVE_ALGORITHM` 并逐会话重建。展示层读的是已有派生列，混进来会让纯前端改动背上全库重建。

**重做组的归属口径，让模块等于输入加回复。** 落选。[中栏按请求新增消息分组](../../implemented/feature/2026-10-28-request-delta-trace-groups.md)已用三个反例定过 delta 投影：调用与结果两端同组、回复归下一笔承载请求。样张里的模块是合成示意，落地沿用 `projectSteps` 的归属，只把容器画清楚。

**新增接口取模块概要字段。** 落选。`RequestRow` 已有 `req_kind`、`purpose_chain`、`chain_role`、`body_state`、耗时与用量，详情里有 `prev_relation`。按[读取功能接入规则](../../../../docs/read-feature-rules.md)复用现有读模型。

## Consequences

落地后成立的事实与代价：

- 时间线放行辅助与压缩请求，默认首屏的行数上升：门禁检查、标题生成这类请求过去在主链视图不可见，现在以完整模块出现。副本探针的样本会话一屏放两三个模块，用密度换完整性的收益。
- 组头只放请求级身份一行，耗时与 token 不铺到每行右端，与[中栏只呈现内容，详情集中右栏](../../implemented/simplification/2026-10-24-trace-content-only-and-wide-rail.md)不冲突；行高从 36px 固定值改为自然行高后，翻页锚点残差实测 0px（见 Verification）。
- `state.view` 的 `all` 已全部改成 `timeline`，不留别名：直达链接、空视图回退、`viewOfRow` 归属与测试断言同步改；中英两份 i18n 无「全部 / All」的阅读视图文案。
- 样张数字（`7 模块 / 18 trace`、`96.2k` 提示峰值、耗时与编号）不进代码与 fixture；生产实现的唯一数据源是 [`src/read-contract.ts`](../../../../src/read-contract.ts) 与现有读模型，未新增接口、未扩 HTTP 路由、无新 web 模块（`STATIC_FILES` 无需登记）。
- 文档同步：[GLOSSARY.md](../../../../GLOSSARY.md) 阅读视图取值改「时间线 / 主链 / S 编号」；[架构设计](../../../../docs/architecture-design.md)的轨迹阅读布局改模块卡、记录块跳转入口与右栏三段；[UIUX-DESIGN.md](../../../../UIUX-DESIGN.md)布局节落模块卡与右栏三段规则；[验收记录](../../../../docs/acceptance.md)合成与真实流量副本分开记；四篇部分取代的旧记录已补回链。
- Pis 复审（2026-11-11）改两处：右栏固定模块概要撤除（当前 trace 卡保留）；单笔耗时从组头撤下、以会话级口径（总耗时、单笔平均、首字中位、速度）进会话头「会话指标」详情，组头右端改推理时间（icon + 档位色，阈值沿用 `TIER_LIMITS.reason`）与提示 token（icon + 数值）。代价：组头不再带整笔耗时，要读耗时得展开会话指标；模块概要卡的信息回到读数页各卡，少一张总览卡。
- **400px 窄屏仍未验证。** headless Chrome 把 CSS 视口夹到 500px，500 档无横向溢出不能外推到手机；真机或固定视口复核之前不声称窄屏通过。

## Verification

2026-11-11 落地。全部在 `web/` 与文档，未改 schema、摄入、用途判定，未升算法号。六处按 Proposal 落齐，落地时的具体取舍：

- **组头走行级计划，不新建机制。** 组头是 `rows` 首条 `{key:'head'}`，与框内行共用 [`trace-dom.js`](../../../../web/trace-dom.js) 的键控提交；内容变化（耗时与 token 补读后）自动走 replace，组头无 `data-step-key` 天然不参与选择。同请求的末尾组不加组头——它是同一请求的回复，加组头会重复同一个编号。
- **辅助请求保持单条记录行加卡片组壳，不投影 aux 正文。** `projectSteps` 对 aux 早退是有意决策（分类器输入不画成用户消息），本轮不动归属口径；aux 模块的组头照画，正文仍从右栏读取。
- **中栏序号槽删除。** 请求序号由组头 `#n` 承担后，行内 `compact-meta` 每行重复同一编号是冗余，`data-request-ordinal` 一并删除；展示行号只在右栏当前 trace 卡出现。
- **组头不画 branch、exclude 徽章。** branch 是压缩后的诚实读数，属正常态；降噪规则禁止正常态装饰性状态，链角色的解释由右栏概要的关系短语承担。
- **右栏两卡是纯函数。** `railModuleSummaryHtml` 与 `railCurrentTraceHtml` 落在 [`rail-facts.js`](../../../../web/rail-facts.js)，字段全部来自 `RequestRow` 与现有详情读数（关系短语沿用 `relationTextOf`），未新增接口；行数要求承载与末尾两组投影都新，陈旧时给占位破折号，不拿旧投影冒充。无选中、投影切换间隙或步骤不在模块行列时整卡省略当前 trace。路由页签在阅读版本陈旧时仍带概要（读数不依赖正文投影）；其余页签陈旧时整栏给重读态。
- **工具名 chip 回纯展示。** 跳转入口唯一落在「启动子代理 S1」记录块（`rec-line jump`），不可按步骤键寻址，点击走既有 `[data-agent-no]` 文档级委托；`spawn-arrow` 图标注册删除。

验收分两层，记录见[验收记录](../../../../docs/acceptance.md)：

- **单测（合成数据）**：246 项通过，含时间线视图语义、spawn 记录块渲染、当前 trace 卡字段、组头右端读数（推理档位色、token icon、无整笔耗时）；`bun run typecheck` 干净。
- **真实流量副本（隔离实例 8399）**：生产库 `.backup` 副本加独立 `ATC_DATA_DIR`/`ATC_PORT`，未碰 8320。无头 Chrome 四档宽度（500/860/1180/1440）加深色全部通过：无页面横向滚动、组头齐全、无行内序号、右栏无模块概要卡且当前 trace 卡跟选；行点击探针证实当前 trace 跟着换行；点「启动子代理 S1」记录块跳到子代理首笔且 S1 视图选中；行高改自然值后点「加载后续记录」翻页，首条可见行不变、锚点残差 0px。复审后复验（会话 `015e3f87`）：右栏无模块概要卡、21/21 组头带 token icon、推理数值落 `t-warn` 档位色、会话指标详情耗时组齐全。400px 真机复核仍未做（headless 视口夹到 500px），见 Consequences。
- **Pis 两轮复审的三处修正（2026-11-11）**：①组头只有 token 时读数贴在 `req_kind` 后——`sp` 推齐符原来只在推理分支输出，改为有任一读数就输出，探针量得 token 距组头右缘 8px、距 kind 514px；②耗时组原放在「全部明细」二级折叠里，第一层展开看不到——提到 hero 卡与「全部明细」之间独立横排（`.kpi-timing` 四格行，窄容器回两列），仍无计时行整组不出现；③「本次回复」折叠的正文与结果块一字一行竖排——`reply-block` 是固定两列网格（icon 列 14px），这两类块 icon 为空导致 `rb-body` 掉进 14px 列，空时补占位 `<span class="ico">`。三处都有探针与截图实证（`/tmp/atc-accept-modules-20261111/probe8.mjs`），单测补对应断言（组头 `sp` 位置、耗时组第一层与无计时不出现）。
- **耗时从文字行改成图（Pis 第三轮反馈，2026-11-11）**：文字版总耗时/单笔平均/首字中位仍不是 Pis 要的形态——「耗时统计是要图」。改为与右栏用量卡同语言的「耗时统计」面板（`usage-donuts.js` 新导出 `timingPanelHtml`：圆环 + 只读图例 + 时间轴），`timingSummary` 同时产出模型侧三段（等待＝Σ ttft、思考＝Σ 推理段、回复＝Σ 其余，缺 ttft 整笔落回复段，与 `turnUsageOf` 同一降级口径）。**有意不计工具执行**：`exec_ms` 在请求详情里，窗口内未必已读，会话级画它会随读取进度漂移，宁缺毋滥；也因此没有「其他开销」摊账，中心写窗口活跃总量（Σ 单笔 ms）而非分段和。图例只读（span 无 `data-cat`），不进 `sp-row` 选中委托。单测换断言（stat-panel/donut/图例标签/位置在 kpi-more 前、无计时不出现），探针 1440 实测分段 18.2%/3.3%/78.5%、中心 336.75 s、时间轴四刻度（`probe10.mjs`）。
- **当前 trace 卡撤三个泛化行（Pis 第四轮反馈，2026-11-11）**：「来源 / 展示行号 / messageOrd」三行撤除。判定：角色（User/Assistant/Tool/System）已表明侧别，`messageOrd` 单独成行与 `path=request.messages[0]` 重复同一个信息；展示行号与卡片标题的 `2 / 4` hint 也重复。保留 `callOrd`/`blockIndex`/`path` 三个坐标行——它们是不可从上下文推出的协议定位。记录行（source 为 null）本来无坐标，撤「来源」后只剩角色一行，不算空卡（还有标题 hint 与正文引用）。孤儿 i18n 键四个一并删（来源/展示行号/组级证据/请求级记录）。
- **结果行换回车形图标（Pis 第五轮反馈，2026-11-11）**：工具结果行原来走 `rolePill('Tool')`，与调用行共用扳手 `role-tool`，调用与回复分不出。按图标注册表规则新增 `role-tool-result`（corner-down-left 回车形，48 网格 stroke-width 4），`rolePill` 的映射加 `Tool result` 键，`KIND_LABEL.tool_result` 从 `'Tool'` 改为 `'Tool result'`——这个名字只影响 icon 选择与 aria-label/title，可见 chip 仍是工具名着色 chip；色类仍走 `KIND_CLASS.tool_result='tool'` 橙色系，不新增色彩档位。探针实测 53/53 结果行为回车形、0 扳手残留，调用行 53 行无回车形混入（`probe12.mjs`）。
- **load-more 箭头反向（Pis 第六轮反馈，2026-11-11）**：`load-more` 图标路径画的是向上箭头，但它的两个消费口（会话列表「加载更多会话」、中栏「加载后续记录」）都是向尾部/下方追加，方向语义反了。注册表里把 chevron 从 `M12 18L24 6L36 18`（朝上）改为 `M12 30L24 42L36 30`（朝下），一根路径两处消费口同修；探针确认 DOM 里只有向下路径（`probe13.mjs`）。
