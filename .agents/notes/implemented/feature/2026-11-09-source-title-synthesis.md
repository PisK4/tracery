# Agent Note: 来源标题采集与忽略行型分级

Status: implemented

已交付的改动：本地会话来源自带的标题进入会话卡，各适配器的元数据行按消费方分级。标题族是第一批采集的行型，其余有潜在用途的行留在 Deferred。

**取代检查。** 活动树里没有记录持有「来源标题」这一决策。[会话适配器第一版](../../proposed/feature/2026-11-04-agent-session-adapters.md)规定了忽略策略的初始形态（只留进状态的行），本文对它做分级修订，不移动或推翻其余结论；[会话列表骨架与异步标题](2026-11-07-session-list-skeleton-and-async-title.md)建立的三级标题候选保持不变，本文在模型标题之前插一级来源标题，原三级顺延。

2026-11-09 对生产库与本机全部会话文件做过只读核对；2026-11-10 复核了几处会改变判断的数字，表中标出两次口径。

## Problem

### 会话卡标题是首句碎片，原生标题被丢弃

生产库 61 个 claude 会话卡的标题全部落在 `user_delta`（取首条用户句），实际拿到的多是 `<task-notification>`、"This session is being continued from a p..." 这类碎片。同一批会话的 jsonl 里，180/214 个文件有 `ai-title` 行，内容是上游 UI 实际显示的标题。改动前适配器在 `parse()` 里把非 assistant/user 行全部返回 `ignore`，标题到不了库。

这不是 claude 一家的问题。逐家核对（本机真实数据）：

| Agent | 标题位置 | 覆盖率 | 改动前下场 |
| --- | --- | --- | --- |
| claude | `ai-title` 行，去重后每文件一个标题 | 180/214 文件（11-09）；182/217（11-10） | 当时 parse 层 ignore |
| droid | `session_start.title` | 216/216（raw 层全有） | 当时已解析进 `DroidSessionStart.title`，摄入层只拿它刷新 settings |
| omp | `title` / `title_change` 行，带 `source`、`updatedAt`/`timestamp` | 148/473 文件（11-10；473 条 `title` + 224 条 `title_change`） | 当时 parse 只认 session/message |
| pi | 与 omp 共用适配器 | 本机 46 个文件未观测到 title 行 | 同上 |
| zcode | SQLite `session.title` 列 | 345/345（11-09，本次未复核） | 当时适配器读该表但 `SessionRow` 不含 title |
| dsh | `session/title` 行，`data.source.kind` 有 fallback→provider 升级序列 | 80/82 文件（11-10；100 条事件） | 当时 parse 只认 user/assistant/end-seed |
| grok | 会话目录 `summary.json` 的 `generated_title`（与 `session_summary` 同值） | 6/6 有字段，4/6 非空 | 当时 `summaryOf` 只取 startedMs/cwd/model |
| workbuddy | `ai-title` / `custom-title` 行 | 存在（本机 2 条 `ai-title`） | 当时在 `IGNORED` 集合明确丢弃 |
| codex | 网关 `thread_title` 请求 | 已可用 | `harness/codex.ts` 已结算成 model_title，不动 |
| hermes | 网关 session-title 请求 | 已可用 | 同上，不动 |

核对时 10 个会话 Agent 里 7 个在本机数据中能看到来源标题；pi 走同一解析器但没有观测到 title 行；codex/hermes 的标题来自网关，不属于这一批。这些本地标题不需要新增请求或模型调用。

补充细节，都会影响接线：

- claude 的 `ai-title` 没有 timestamp，而且会每回合重复写同一行；182 个有标题的主会话文件里，176 个有多条 `ai-title` 行，合计 25,883 行，去重后每个文件只有 1 个标题。标题值稳定，行数不稀。
- omp 的 `title` 行没有 timestamp、没有 sessionId；`title_change` 有 `timestamp`，但它的 `id` 是事件 id，不是会话 id（本机样本核对）。改动前 `parse` 用 `value.id` 当 `sessionId`，直接放行标题行会把 raw 的 session_id 写错。
- dsh 的 `session/title` 带 `time`，`data.source.kind` 是 `fallback` 或 `provider`，一次升级会产生两条事件。
- workbuddy 的 `ai-title` 带 `sessionId` 与 `timestamp`；样例：`{"id":"d047fc28-…","type":"ai-title","aiTitle":"规划AI Agent技术提升方案","sessionId":"4367f738-…"}`。droid 还带 `isSessionTitleManuallySet`（216 个会话里 76 个手动改过）——这是用户亲手定的名字。

### 忽略策略是首版裁剪，没有分级原则

查证：没有 LESSONS 条目或 bug-fix note 记录过忽略行型引发的事故。忽略不是踩坑的产物，是适配器首版（1ede15b）设计时的两个动机——防大行顶爆正文预算（`api-request-blob`、`attachment` 单条几十 KB），以及「只保留会进状态的行」（`claude.ts` 注释原文）。动机成立，但执行粒度六家六样：

| 适配器 | 忽略策略 | 丢掉的东西 |
| --- | --- | --- |
| claude | 只认 assistant/user | 标题、模式、成本累计、hook 摘要全丢 |
| workbuddy | `IGNORED` 集合 | 标题族与快照/重发通知一起丢弃 |
| omp / pi | 只认 session/message | 标题、模型切换历史 |
| codex | relevant 白名单 | 只有 world_state（2KB 单行），白名单本身合理 |
| dsh | 只认 user/assistant/end-seed | 标题、审批决定 |
| droid / grok / zcode | 全量或库表 | 无行级丢失 |

忽略不造成磁盘数据丢失——本地文件本身就是原始层（[适配器提案](../../proposed/feature/2026-11-04-agent-session-adapters.md)第 4 节），只造成库内不可见。所以修正方向是按行型分级，不是取消忽略。

## Decision

### 1. 忽略行型分级原则

按「有没有消费方 + 体积代价」分三档：

- **继续忽略**：大块正文、流式分片、与正文重复的行、正文重建不需要且无消费方的行。
- **第一批采集**：标题族——claude `ai-title`、workbuddy `ai-title`/`custom-title`、omp/pi `title`/`title_change`、dsh `session/title`，加上 grok `summary.json`、zcode `session.title` 列、droid `session_start.title`。标题值进 `session_title` 表；行来源的标题行照常落 `raw_session_event`。
- **Deferred**：体积小、暂时没有消费方的行，等消费端立项再开。逐项见文末 `## Deferred`。

### 2. 载体与写入

`session_title` 是 v17 的 additive 表，主键 `(conv_key, source)`，`WITHOUT ROWID`。`manual` 只由 droid 的手动标记写入；读侧按 `manual DESC, observed_ms DESC, source ASC` 取一条。标题与 `evidence_json` 落库前都过 `redact`，标题按 Unicode 码点截断到 512 字符，证据只记 `source_kind`、`ref` 与附加事实。结构形状见[架构设计](../../../../docs/architecture-design.md#版本与破坏式替换)，运维版本见[运维手册](../../../../docs/operations.md#schema-版本)。

`SessionAdapter.sourceTitle?(state, file)` 是批末同步钩子，返回的 `SessionTitle.sessionId` 由适配器按自己的作用域判定；ingest 用 `sessionConvKey()` 生成 `conv_key`，不从最后一步 apply 猜会话身份。钩子只在没有坏行阻断的批次里跑，位置在 `flush` 与 `afterFile` 之间。标题、手动标记或证据没变时不刷新 `observed_ms`；自动标题不能覆盖 `manual=1`。钩子或写库异常只记 `session_title_failed` issue，不停游标。

元数据来源不依赖 `sanitizedPayload`：zcode 的 `storesRaw:false` 在 `read()` 里连根会话 `title` 与根会话 id 一起交给批末状态，grok 同步读 `summary.json`，两者都不另开第二条连接在批末重算归属。标题不写 `request`、不写 `request_evidence`、不标脏 `derive_queue`，也不改 purpose 列。

### 3. 读路径

`listSessions` 的 full 路径与 `getSessionTitles` 都把来源标题放在 `COALESCE` 第一位，原三级候选顺延。`listSessions` 的来源标题放在组当前性闸门之外，组 dirty 时仍可见；`light` 路径继续由 `getSessionTitles` 异步回填。冻结 oracle 不读 `session_title`，来源标题优先级另写独立用例。

### 4. 各家接线与作用域

行来源适配器在 `parse` 放行标题族；claude 用 `aiTitle` 与首条消息时间，omp/pi 用 `title`/`title_change` 且不把 `title_change.id` 当会话 id，dsh 取 `data.title`、`data.source.kind` 与事件时间，workbuddy 从 `IGNORED` 移除两个标题行型，droid 解析 `isSessionTitleManuallySet`。元数据来源由 zcode 读根会话 title、grok 读 `generated_title` 并退回 `session_summary`。各家标题位置见[本地 Agent 覆盖矩阵](../../../../docs/agent-coverage.md#来源标题可得性)。

作用域判定留在适配器内部：claude sidechain 与 subagents、omp/pi artifacts 与 subagents、dsh seed 前缀与子代理、droid `callingSessionId`、workbuddy subagents、zcode 子会话都不改父会话标题。codex/hermes 的网关标题继续排在来源标题之后。

### 5. 升级边界

v17 建表不动 `request`，不回填存量标题。文件没有新增字节时不会被调度摄入，标题不刷新；显式回填是另一轮授权的动作。归档、删除与保留程序本轮不改 `session_title` 的生命周期：新增表没有接入容量计数触发器，也没有独立 TTL，后续按读侧使用量立项。

## Testing

2026-11-10 合成数据验收：12 个受影响窄测试文件 195 pass / 0 fail / 1003 expect，`bun run typecheck` 通过。覆盖 v16→v17 additive 迁移、七家标题写入、重复 claude `ai-title` 不刷新观察时间、omp 两次 `title_change` 与 dsh fallback→provider 各留一行且 `title_ms` 取最新、droid manual 优先、zcode/grok 脱敏、子代理与 seed 作用域、读侧 full/light/getSessionTitles 一致、dirty 组可见、删空来源标题后旧候选仍受原闸门约束、查询计划仍走 `i_req_session_time` 且不出现 `SCAN request`。本轮没有部署生产，没有真实流量验收，也没有存量回填；生产副本换名/变短/退兜底统计与上线另行授权。合成结果见[验收记录](../../../../docs/acceptance.md)。

## Alternatives considered

- **合成 request 行**。初稿的选择。优点是不用新表，复用 `SESSION_TITLE_SQL` 与请求读取。代价是它要同时处理 `has_missing`（`via='session'` 无正文会把整会话标缺正文）、五条 owner 线索（合成行可能被账本/OTLP 认领成真实调用）、派生队列与发布代覆盖（行级跳过不存在，新行会让已发布代缺结果行）、`title_source` 被 `presentationDecision` 覆盖、`MAX(started_ms)` 与 live 判定（重命名会把会话顶到列表顶并亮 live）、请求计数与 `cost_absent`。这些都能修，但每一条都要在多个查询里写例外；一条假请求换来的复用不值得。
- **读时从 `raw_session_event` 现查标题**。会话列表是高频路径，raw 层 JSON 提取不可索引，成本回到 sessionsTitle 超时的老路（跨组标题在生产库单会话约 216ms 的实测先例）。
- **把来源标题写到既有 request 行的 `model_title`**。会污染一笔真实调用的标题语义，派生、投影与页面读取都要判断「这行的 model_title 是调用产物还是会话标题」，比新表更难收敛。

## Consequences

收益：会话卡优先显示上游 UI 实际使用的标题，首句碎片退回兜底位置；标题作为会话级窄表不进请求计数、owner 认领、派生队列、排序与 live 判定；组 dirty 时旧候选照旧被闸门挡住，来源标题仍可读。`evidence_json` 不复制标题原文，标题落库前统一脱敏。

代价与边界：

1. 合成 fixture 锁定七家标题写入、手动优先、重复写抑制、读侧一致与查询计划；`session_title` 不参与 `MAX(started_ms)`、`request_count` 与 `cost_absent`。冻结 oracle 仍不读新表。
2. 上游字段变化会让 `session_title` 静默缺失；契约漂移检测的结构层需列入标题行型必含集合。
3. 没有新行的存量会话不刷新标题，用户手动改名后要等下一次摄入或显式回填。
4. 同一 `conv_key` 被多来源看到时只按 `manual`、最近观察时间与来源名裁决，不保证与用户所见一致。
5. claude 的重复 `ai-title` 仍按行落 `raw_session_event`，由 raw TTL 回收；`session_title` 只写一次。
6. v17 不回填，存量会话的碎片标题仍显眼，回填须显式授权，不混进上线提交。
7. 生产副本预演的换名、变短、退兜底统计与真实流量验收都留到部署前单轮执行。

## Deferred

- claude `cost-state`（`totalCostUSD`/`totalLinesAdded` 会话累计）：可做网关成本对账锚点，量小，等成本对账立项。
- dsh `approval/decided`（审批决定历史）：等权限/审批视图立项。
- claude `mode`/`permission-mode`/`last-prompt`/`system`/`queue-operation`、omp `model_change`/`thinking_level_change`：会话状态与模型切换时间线的原料，当前无消费方。
- claude `api-request` 族：2026-10-31 缺口恢复 note 已评估（条数低于库内请求数、逐笔覆盖率未知），维持暂缓。
- claude `attachment`/`api-request-blob`/`api-request-shape`/`file-history-snapshot`、dsh 流式分片：正文重复或大块，长期忽略。
