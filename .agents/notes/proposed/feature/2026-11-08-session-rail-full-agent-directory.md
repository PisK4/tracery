# Agent Note: 会话栏全量 Agent 目录与旁路前置过滤

Status: proposed

## Problem

会话栏顶部的 Agent 目录只枚举已加载页里的会话，再按页内请求数 `>=50` 过滤、只取前 7 名（`renderFilters`，口径见[会话栏 Agent 分组列表](../../implemented/feature/2026-11-07-session-rail-agent-grouping.md)）。2026-11-08 只读快照里全库有 15 个带可见会话的 Agent，目录却只显示页内请求量凑够阈值的头部几个，Hermes、Codex、droid、zcode 长期不出现。目录点击只改本地筛选状态、不发请求，后端 `/api/sessions` 也不解析 `agent`，目录里没有的 Agent 无法选中。

旁路会话的折叠发生在渲染层：分页查询按全量返回，`renderSessions` 再把零参与链的组折起。同一快照里最近 100 个会话组约 91 个是旁路，加载 100 条只剩约 9 行可见；列表高约 665px、行高 44px，铺满需约 16 行。渲染层折叠无法让首屏铺满——旁路在分页之前就占满名额，折叠只是把已经占位的行藏起来。

三个诉求由此缠在一起：目录要列全量 Agent，旁路要直接忽略而非折叠计数，首屏要铺满可见会话。后两者都要求旁路在分页之前被排除，渲染层做不到。

## Proposal

目录与旁路分两条读取路径治理，聚合都不进渲染路径。

**全量 Agent 目录走具名读取并缓存。** 新增一个全库 facets 查询，按「有参与链的会话」枚举 Agent 与可见会话数，经读取契约、HTTP adapter、reader-store 接入（接入规则见[读取功能接入规则](../../../../docs/read-feature-rules.md)）。`renderFilters` 改为纯投影，只读 reader-store 的目录快照，不发网络请求。聚合只在启动与显式刷新列表时执行；加载更多、标题回填、选中 Agent、活跃沉降与任何重绘都不触发。目录快照归 page owner、单飞、切会话不误清。计数口径统一为可见会话数，删掉 `>=50` 阈值与前 7 上限，「全部 Agent」行同口径。

**旁路下推 SQL，用 HAVING 不用 WHERE。** `listSessions` 阶段一在 `GROUP BY conv_key` 后追加参与链存在性判定，只返回有参与链的会话，谓词与 `SESSION_FLAG_COLUMNS` 的 `has_participate` 用同一表达式。HAVING 只过滤组、不改聚合：`last_ms` 仍是整组 `MAX(started_ms)`，游标元组与排序不变，分页是可见集上的 keyset。Agent 过滤同样走 HAVING，避免 WHERE 把 `last_ms` 变成「该 Agent 的最近活动」。过滤作为读取契约的显式输入，接口仍可按请求返回全量存储事实。

**折叠按钮保留但做小。** bypass 下推后不再到达客户端，折叠条删掉 bypass 分支与文案；按钮留给 probe/background/tool_event，样式收窄为低存在感的文字链接。`renderSessions` 折起 background 但 `sessionsListFoldHtml` 不数它，保留按钮就把 background 计入，消除「折起却无展开入口」的行。

**单次聚合成本用覆盖索引压。** 阶段一与 facets 要读 `purpose_chain`/`agent`，现有 `i_req_session_time` 不含这两列，会回表。加法式 schema 迁移补覆盖索引，用 EXPLAIN 与实测确认计划选中；索引不够再评估服务端按写版本或 TTL 缓存，作为第二道闸而非首版。

## 与既有记录的关系

本提案部分取代三条活跃记录，保留它们各自仍成立的决策，互链。

[OMP harness 集成](../../implemented/feature/2026-10-25-omp-harness-integration.md)曾否决「旁路折叠走 SQL 层过滤」，理由是改动大、动游标、折叠计数需另开全量查询，渲染层改动小；[无正文探针记录默认折叠](../../implemented/feature/2026-11-01-probe-records-default-fold.md)重申了这条否决。本提案反转它，因为目标变了：当时要「降噪但保留可展开痕迹」，接受计数随翻页增长；现在要「旁路直接忽略 + 首屏铺满」，渲染层折叠在分页前挡不住旁路占位，稳健路径只有分页前过滤。两条技术顾虑重新核过都不成立：HAVING 不改游标元组与整组 `last_ms`，分页仍是 keyset；bypass 不再到达客户端，折叠计数无需为它另开全量查询。存储证据不动，bypass 判定、probe 等的可展开痕迹与派生口径都不变。

[会话栏 Agent 分组列表](../../implemented/feature/2026-11-07-session-rail-agent-grouping.md)的布局、品牌 logo、活跃绿点保留；「已加载相对计数 + `>=50` + 前 7」被全库可见会话数取代，正是它列为推迟项的「后端精确聚合」。

[会话列表按页聚合](../../implemented/bug-fix/2026-11-01-session-list-query.md)的两阶段结构与 WAL 快照不变；阶段一新增 HAVING 属列表语义有意变更，冻结 oracle 要按可见集审视，不无脑跟随改写。

## Alternatives considered

**维持渲染层折叠，靠加大 limit 铺满。** limit 上限 100，旁路占 91% 时一页只剩约 9 行；即便放宽上限，也是传输几百条旁路再丢弃，浪费且随旁路比例波动不鲁棒。落选。

**目录每次渲染打全库聚合。** 用户明确否决。`onSessionsChanged` 在首页加载与标题回填后都触发，等于每加载一页、回填一次标题就扫一遍全库。落选，改为缓存加受控刷新。

**物化 Agent 目录表，写入时增量维护。** 读取永远只与 Agent 数相关，但要覆盖新增、迟到、合并、删除、派生翻转等失效路径，带 schema 与 backfill 成本。[会话列表按页聚合](../../implemented/bug-fix/2026-11-01-session-list-query.md)已否决过类似的物化汇总取向。目录刷新频率低，覆盖索引加缓存足够，物化留作索引仍不达标时的升级。落选。

**删除整个折叠机制，probe/background/tool_event 一并下推 SQL。** 这三类判定是多列保守条件（见[无正文探针记录默认折叠](../../implemented/feature/2026-11-01-probe-records-default-fold.md)），下推要复制宽聚合、回表更重，且用户选择保留按钮。落选，只下推 bypass 的单列判定。

**服务端 facets 缓存作为首版。** 客户端解耦加覆盖索引后聚合已低频且快，服务端缓存徒增失效路径。留作索引实测仍慢时的第二道闸。落选（首版）。

## Acceptance criteria

- 目录列出全库所有带可见会话的 Agent，点击任一项能加载该 Agent 的会话；`>=50` 与前 7 上限消失。
- 旁路不进入分页名额；默认首屏可见会话铺满列表高度，或游标已耗尽。
- 加载更多、标题回填、选中 Agent、重绘都不触发目录聚合；聚合只在启动与显式刷新执行，有固定操作名计时可证。
- 折叠按钮收窄，bypass 分支与文案消失，background 计入折叠条，无「折起却点不开」的行。
- 可见集上的游标分页正确：满页、末页、同毫秒并列、空结果；冻结 oracle 按可见集审视后仍等价或有意识更新。
- 阶段一与 facets 的 EXPLAIN 命中新覆盖索引，真实库耗时实测记录；合成与真实分开写。
- 读取契约、HTTP 与 direct 两侧 transport、reader-store 单飞含筛选键的回归通过；typecheck 与 notes 门禁通过。

## Risks

- **回表成本未实测**：HAVING 读 `purpose_chain`/`agent` 失去现有覆盖索引，新索引是否被计划器选中要 EXPLAIN 加真实耗时确认，不能凭加了索引就宣称达标。
- **反转决策的接口口径**：sessions 接口默认是否仍报全量存储事实要定清楚；过滤作为显式输入保留全量能力，避免悄悄改掉「接口报存储事实」的边界。
- **oracle 等价快照**：列表语义有意变更，`tests/session-list-oracle.ts` 的全量对照要么按可见集重写、要么明确标注不再适用，不能假绿。
- **schema 版本断言**：加索引升 user_version，牵动 store 与 maintenance 多处版本断言，需一并更新。
- **在途单飞复用**：会话列表单飞 key 不含筛选时，切 Agent 可能闪回旧筛选结果，筛选条件须并入 key。
- **目录空闲期 staleness**：无轮询现状下目录停在启动快照，新 Agent 入库要显式刷新才出现；是否加粗粒度可见性定时器是独立开关，默认不加。