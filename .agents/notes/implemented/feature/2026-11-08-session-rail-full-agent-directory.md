# Agent Note: 会话栏全量 Agent 目录与旁路前置过滤

Status: implemented

## Problem

会话栏顶部的 Agent 目录只枚举已加载页里的会话，再按页内请求数 `>=50` 过滤、只取前 7 名（`renderFilters`，口径见[会话栏 Agent 分组列表](../../implemented/feature/2026-11-07-session-rail-agent-grouping.md)）。2026-11-08 只读快照里全库有 15 个带可见会话的 Agent，目录却只显示页内请求量凑够阈值的头部几个，Hermes、Codex、droid、zcode 长期不出现。目录点击只改本地筛选状态、不发请求，后端 `/api/sessions` 也不解析 `agent`，目录里没有的 Agent 无法选中。

旁路会话的折叠发生在渲染层：分页查询按全量返回，`renderSessions` 再把零参与链的组折起。同一快照里最近 100 个会话组约 91 个是旁路，加载 100 条只剩约 9 行可见；列表高约 665px、行高 44px，铺满需约 16 行。渲染层折叠无法让首屏铺满——旁路在分页之前就占满名额，折叠只是把已经占位的行藏起来。

三个诉求由此缠在一起：目录要列全量 Agent，旁路要直接忽略而非折叠计数，首屏要铺满可见会话。后两者都要求旁路在分页之前被排除，渲染层做不到。

## Decision

目录与旁路分两条读取路径治理，聚合都不进渲染路径。

**全量 Agent 目录走具名读取并缓存。** `listSessionAgents`（`src/queries/sessions.ts`）按「有参与链的会话」枚举 Agent 与可见会话数，经读取契约 `sessionAgents`、HTTP `/api/agents`、reader-store 的 page-owned 单飞缓存接入（接入规则见[读取功能接入规则](../../../../docs/read-feature-rules.md)）。`renderFilters` 是纯投影，只读 `peekSessionAgents()` 快照，不发网络。聚合只在启动与显式刷新（`#refresh-sessions`）执行；加载更多、标题回填、选中 Agent、活跃沉降与任何重绘都不触发。目录用 `pageScope`，切会话只换 `sessionScope`，不误清。计数口径统一为可见会话数，`>=50` 阈值与前 7 上限删除，「全部 Agent」行用同一 `total`。

**旁路下推 SQL，用 HAVING 不用 WHERE。** `listSessions` 阶段一在 `GROUP BY conv_key` 后追加参与链存在性判定（`visibleOnly`），只返回有参与链的会话，谓词与 `SESSION_FLAG_COLUMNS` 的 `has_participate` 用同一表达式。HAVING 只过滤组、不改聚合：`last_ms` 仍是整组 `MAX(started_ms)`，游标元组与排序不变，分页是可见集上的 keyset。Agent 过滤（`agent`）同样走 HAVING，避免 WHERE 把 `last_ms` 变成「该 Agent 的最近活动」。两者是读取契约的显式可选输入，缺省仍返回全量存储事实。reader-store 的会话列表恒带 `visibleOnly:true`；筛选代次 `sessionsGen` 让切 Agent 后旧筛选的迟到响应不写回，单飞不复用旧筛选的在途。

**折叠按钮保留但做小。** bypass 下推后不再到达客户端，`sessionsListFoldHtml` 删掉 bypass 分支与文案，改计 background（与 `renderSessions` 折叠口径一致，消除「折起却无展开入口」）；按钮收窄为低存在感文字链接（`.sess-fold .chip-btn`）。`.agent-list` 改 `overflow:auto`，全部 Agent 可滚动到达而非被 420px 裁剪。

**单次聚合成本用覆盖索引压。** schema v15 加 `i_req_session_visible(conv_key, purpose_chain, agent, started_ms DESC)`，阶段一与 facets 免回表。EXPLAIN 钉住计划器选中覆盖索引（`tests/queries.test.ts`）；索引不够再评估服务端按写版本或 TTL 缓存，作为第二道闸而非首版。

## 与既有记录的关系

本提案部分取代三条活跃记录，保留它们各自仍成立的决策，互链。

[OMP harness 集成](../../implemented/feature/2026-10-25-omp-harness-integration.md)曾否决「旁路折叠走 SQL 层过滤」，理由是改动大、动游标、折叠计数需另开全量查询，渲染层改动小；[无正文探针记录默认折叠](../../implemented/feature/2026-11-01-probe-records-default-fold.md)重申了这条否决。本记录反转它，因为目标变了：当时要「降噪但保留可展开痕迹」，接受计数随翻页增长；现在要「旁路直接忽略 + 首屏铺满」，渲染层折叠在分页前挡不住旁路占位，稳健路径只有分页前过滤。两条技术顾虑重新核过都不成立：HAVING 不改游标元组与整组 `last_ms`，分页仍是 keyset；bypass 不再到达客户端，折叠计数无需为它另开全量查询。存储证据不动，bypass 判定、probe 等的可展开痕迹与派生口径都不变。

[会话栏 Agent 分组列表](../../implemented/feature/2026-11-07-session-rail-agent-grouping.md)的布局、品牌 logo、活跃绿点保留；「已加载相对计数 + `>=50` + 前 7」被全库可见会话数取代，正是它列为推迟项的「后端精确聚合」。

[会话列表按页聚合](../../implemented/bug-fix/2026-11-01-session-list-query.md)的两阶段结构与 WAL 快照不变；阶段一新增 HAVING 属列表语义有意变更，冻结 oracle 按可见集审视，不无脑跟随改写。

## Alternatives considered

**维持渲染层折叠，靠加大 limit 铺满。** limit 上限 100，旁路占 91% 时一页只剩约 9 行；即便放宽上限，也是传输几百条旁路再丢弃，浪费且随旁路比例波动不鲁棒。落选。

**目录每次渲染打全库聚合。** 用户明确否决。`onSessionsChanged` 在首页加载与标题回填后都触发，等于每加载一页、回填一次标题就扫一遍全库。落选，改为缓存加受控刷新。

**物化 Agent 目录表，写入时增量维护。** 读取永远只与 Agent 数相关，但要覆盖新增、迟到、合并、删除、派生翻转等失效路径，带 schema 与 backfill 成本。[会话列表按页聚合](../../implemented/bug-fix/2026-11-01-session-list-query.md)已否决过类似的物化汇总取向。目录刷新频率低，覆盖索引加缓存足够，物化留作索引仍不达标时的升级。落选。

**删除整个折叠机制，probe/background/tool_event 一并下推 SQL。** 这三类判定是多列保守条件（见[无正文探针记录默认折叠](../../implemented/feature/2026-11-01-probe-records-default-fold.md)），下推要复制宽聚合、回表更重，且用户选择保留按钮。落选，只下推 bypass 的单列判定。

**服务端 facets 缓存作为首版。** 客户端解耦加覆盖索引后聚合已低频且快，服务端缓存徒增失效路径。留作索引实测仍慢时的第二道闸。落选（首版）。

## Consequences

收益：目录列出全库所有带可见会话的 Agent，点击任一项以服务端筛选加载该 Agent 的会话；旁路不占分页名额，首屏由可见会话铺满（或游标耗尽）；聚合低频且走覆盖索引，渲染路径零网络。

代价与边界：

- **目录空闲期 staleness**：无轮询现状下目录停在启动或上次显式刷新的快照，新 Agent 入库要刷新才出现。粗粒度可见性定时器是独立开关，默认不加。
- **接口口径**：`sessions` 缺省仍报全量存储事实，`visibleOnly`/`agent` 是显式 opt-in 输入；rail 恒带 `visibleOnly:true`。过滤不悄悄改掉「接口报存储事实」的边界。
- **oracle 等价**：列表语义有意变更，`tests/session-list-oracle.ts` 的全量对照走缺省无过滤路径，仍等价；可见集分页由 `tests/queries.test.ts` 的满页/末页/游标推进断言锁定。
- **schema 版本**：v15 牵动 `store.ts` `SCHEMA_VERSION`、`maintenance/verify.ts` `CODE_SCHEMA_VERSION`、`maintenance/backup.ts` `RESTORABLE_SCHEMA_VERSIONS` 三处事实与多处测试断言，已同步；测试断言改用 `CODE_SCHEMA_VERSION` 常量，下次升版不再红。

验证（合成与真实分开）：

- **合成**：全量套件 1436 通过、typecheck 干净。EXPLAIN 钉子断言阶段一与目录命中 `COVERING INDEX i_req_session_visible`，索引列顺序钉住。8 万行合成库实测（全新只读连接对照）：目录 63.7→25.3ms、过滤列表 23.6→6.8ms（相对 `i_req_session_time` 回退）；首版对照因只读连接缓存被删索引的 schema 无效，已用关闭重开修正。reader-store 回归覆盖筛选下推、切换重置、旧筛选迟到响应被拦、目录单飞、投影不取数、切会话不清。
- **真实**：生产库耗时与页面走查记录见[验收记录](../../../../docs/acceptance.md)，部署后单独验收，不与合成混写。