# Agent Note: 来源标题采集与忽略行型分级

Status: proposed

本文解决两件相关的事：本地会话来源自带的标题进不了会话卡，以及各适配器对元数据行的忽略没有分级原则。前者是后者的第一批落地——标题族是唯一有明确消费方的元数据。

**取代检查。** 活动树里没有记录持有「来源标题」这一决策。[会话适配器第一版](2026-11-04-agent-session-adapters.md)规定了忽略策略的初始形态（只留进状态的行），本文对它做分级修订，不移动或推翻其余结论；[会话列表骨架与异步标题](../../implemented/feature/2026-11-07-session-list-skeleton-and-async-title.md)建立的三级标题候选保持不变，本文在模型标题之前插一级来源标题，原三级顺延。

2026-11-09 对生产库与本机全部会话文件做过只读核对；2026-11-10 复核了几处会改变判断的数字，表中标出两次口径。

## Problem

### 会话卡标题是首句碎片，原生标题被丢弃

生产库 61 个 claude 会话卡的标题全部落在 `user_delta`（取首条用户句），实际拿到的多是 `<task-notification>`、"This session is being continued from a p..." 这类碎片。同一批会话的 jsonl 里，180/214 个文件有 `ai-title` 行，内容是上游 UI 实际显示的标题。适配器在 `parse()` 里把非 assistant/user 行全部返回 `ignore`（`src/sources/session/adapters/claude.ts:209-223`），标题到不了库。

这不是 claude 一家的问题。逐家核对（本机真实数据）：

| Agent | 标题位置 | 覆盖率 | 当前下场 |
| --- | --- | --- | --- |
| claude | `ai-title` 行，去重后每文件一个标题 | 180/214 文件（11-09）；182/217（11-10） | parse 层 ignore |
| droid | `session_start.title` | 216/216（raw 层全有） | 已解析进 `DroidSessionStart.title`，摄入层只拿它刷新 settings，标题本身未消费 |
| omp | `title` / `title_change` 行，带 `source`、`updatedAt`/`timestamp` | 148/473 文件（11-10；473 条 `title` + 224 条 `title_change`） | parse 只认 session/message，ignore |
| pi | 与 omp 共用适配器 | 本机 46 个文件未观测到 title 行 | 同上 |
| zcode | SQLite `session.title` 列 | 345/345（11-09，本次未复核） | 适配器读该表但 `SessionRow` 不含 title |
| dsh | `session/title` 行，`data.source.kind` 有 fallback→provider 升级序列 | 80/82 文件（11-10；100 条事件） | parse 只认 user/assistant/end-seed，ignore |
| grok | 会话目录 `summary.json` 的 `generated_title`（与 `session_summary` 同值） | 6/6 有字段，4/6 非空 | `summaryOf` 只取 startedMs/cwd/model |
| workbuddy | `ai-title` / `custom-title` 行 | 存在（本机 2 条 `ai-title`） | 在 `IGNORED` 集合明确丢弃 |
| codex | 网关 `thread_title` 请求 | 已可用 | `harness/codex.ts` 已结算成 model_title，不动 |
| hermes | 网关 session-title 请求 | 已可用 | 同上，不动 |

10 个会话 Agent 里，7 个在本机数据中能看到来源标题；pi 走同一解析器但没有观测到 title 行；codex/hermes 的标题来自网关，不属于这一批。所有本地标题都免费可得，不需要新增请求或模型调用。

补充细节，都会影响接线：

- claude 的 `ai-title` 没有 timestamp，而且会每回合重复写同一行；182 个有标题的主会话文件里，176 个有多条 `ai-title` 行，合计 25,883 行，去重后每个文件只有 1 个标题。标题值稳定，行数不稀。
- omp 的 `title` 行没有 timestamp、没有 sessionId；`title_change` 有 `timestamp`，但它的 `id` 是事件 id，不是会话 id（本机样本核对）。`parse` 现在用 `value.id` 当 `sessionId`（`src/sources/session/adapters/pi-jsonl.ts:275`），直接放行标题行会把 raw 的 session_id 写错。
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

忽略不造成磁盘数据丢失——本地文件本身就是原始层（[适配器提案](2026-11-04-agent-session-adapters.md)第 4 节），只造成库内不可见。所以修正方向是按行型分级，不是取消忽略。

## Proposal

### 1. 忽略行型分级原则

按「有没有消费方 + 体积代价」分三档，写进各适配器注释作为常备约束：

- **继续忽略**：大块正文（claude `attachment` avg 3.8KB max 108KB、`api-request-shape` avg 83KB、`api-request-blob`、`file-history-snapshot`）、流式分片（dsh `*-chunk`/`*-delta`/`text-chunks`，整段已有 `assistant/message`）、与正文重复的行（claude `tools-used`、omp `custom` 里的 `tool_execution_start`）、正文重建不需要且无消费方的行（claude `atis-latch`、codex `world_state`）。这些维持现状。
- **第一批采集**：标题族——claude `ai-title`、workbuddy `ai-title`/`custom-title`、omp/pi `title`/`title_change`、dsh `session/title`，加上 grok `summary.json` 的 `generated_title`、zcode `session.title` 列、droid `session_start.title` 的透出。唯一的采集判据：立刻有消费方（会话卡标题）。标题值进 `session_title` 表；行来源的标题行照常落 `raw_session_event`，只作为状态重放的输入。
- **Deferred**：体积小、暂时没有消费方但有潜在用途的行，等页面用途立项再开。逐项见文末 Deferred。

### 2. 载体：`session_title` 表

标题是会话级事实，不是一次模型调用。把它塞进 `request` 表会同时进入会话标志、请求计数、owner 认领、派生队列与会话排序五条路径；这五条路径都要为一条假请求写例外。新增一张窄表，让标题只服务一个消费方，代价更低。

**Schema（v17，additive）**

```sql
CREATE TABLE session_title (
  conv_key      TEXT NOT NULL,
  source        TEXT NOT NULL,          -- 适配器 source_kind
  title         TEXT NOT NULL,
  manual        INTEGER NOT NULL DEFAULT 0,
  title_ms      INTEGER,                -- 来源事件时间；没有则 NULL
  observed_ms   INTEGER NOT NULL,       -- 最近一次观测时间
  evidence_json TEXT NOT NULL,          -- source_kind/ref/附加事实；不含标题原文
  PRIMARY KEY (conv_key, source)
) WITHOUT ROWID;
```

- `(conv_key, source)` 是身份；同一会话如果被两个来源看到，读侧按 `manual DESC, observed_ms DESC, source ASC` 取第一条。正常情况下一会话一行。
- `manual` 只由 droid 的手动标记写入；upsert 不允许自动标题覆盖手动标题。
- `title_ms` 与 `observed_ms` 分开：前者是来源事件时间，后者是采集观察时间。读侧排序用 `observed_ms`，不拿来改会话的 `last_ms`。
- 形状参照现有 `session_usage`（`src/schema.sql:296-313`）：同样 WITHOUT ROWID、一会话一行，不建第二套读索引。
- 新库走 `src/schema.sql`，旧库走 `src/schema-v17.sql`，两处同一份 DDL；`SCHEMA_VERSION` 16→17，`store.ts` 增加 v16→v17 分支。

**写路径**

在 `src/sources/session/types.ts` 增加 `SessionTitle` 与适配器的批次钩子：

```ts
export type SessionTitle = {
  text: string;
  atMs: number | null;
  manual?: boolean;
  ref: string;
  facts?: Record<string, unknown>;
};

// SessionAdapter
sourceTitle?(state: unknown, file: SessionFile): SessionTitle | null;
```

`ingestSessionFile` 在 replay、逐行 apply 与 `flush` 之后调用一次 `adapter.sourceTitle(state, file)`。返回非空且会话 id 已知时，按 `(conv_key, source)` upsert：

- 标题文本先过 `redact(text, salt)`；`storesRaw:false` 的来源（zcode）不能依赖 `sanitizedPayload`（`src/sources/session/ingest.ts:391-397`）。
- 空标题不写；超过 512 字符截断；`evidence_json` 只记来源身份与附加事实，不重复存标题。
- 标题、`manual` 或证据变化时写；`WHERE session_title.manual = 0 OR excluded.manual = 1` 防止自动标题覆盖手动标题。重复的 claude `ai-title` 行因此不会每回合刷一次库。
- 写失败按来源 issue 记，不阻断游标；标题是元数据，坏标题不能停会话。

**读路径**

`listSessions` 的标题列改成：

```sql
COALESCE(
  (SELECT st.title FROM session_title st
   WHERE st.conv_key = request.conv_key
   ORDER BY st.manual DESC, st.observed_ms DESC, st.source ASC LIMIT 1),
  CASE WHEN ${SESSION_TITLE_GUARD_SQL} THEN ${SESSION_TITLE_SQL} END
) AS title
```

来源标题在 `SESSION_TITLE_GUARD_SQL` 之外：它是来源事实，不依赖派生组是否 current。组 dirty 时网关/跨组/用户标题照旧被闸门挡住，来源标题仍然可见。`getSessionTitles`（`src/queries/sessions.ts:219-232`）加同一个第一候选；它本来就没有组闸门。

`SESSION_TITLE_SQL` 原三级顺序不变：同会话网关标题 → 跨组绑定 → 用户标题。`TITLE_BIND_UNIQUE_SQL`、`CROSS_GROUP_TITLE_SQL` 与 `titleBindingOf` 不动；来源标题是同一 conv_key 的本地事实，不需要双向唯一校验，单源会话直接命中。

**证据与隐私**

`evidence_json` 记 `{source_kind, ref, facts}`。`ref` 是来源内的稳定位置：行来源用文件 + 行偏移或 seq，zcode 用库路径 + 会话 id，grok 用 `summary.json` 的字段名。它不参与唯一性，只为回放和排查。行来源的原始行仍在 `raw_session_event`；元数据来源（zcode/grok）没有 raw 行，靠 `ref` 指回原文件。标题是用户内容，落库前脱敏，`evidence_json` 不存标题原文。

### 3. 各家接线清单

| Agent | 改动 | 作用域 |
| --- | --- | --- |
| claude | parse 放行 `ai-title`；apply 存最后一条文本；`sourceTitle` 返回它；state 增加 `firstMessageMs` 作为无 timestamp 时的 `atMs` | 只认主会话文件；sidechain 与 subagents 文件不产出标题 |
| droid | `DroidSessionStart` 增加 `isSessionTitleManuallySet`；`sourceTitle` 返回 `title` 与 `manual` | `callingSessionId` 非空时为子代理，返回 null |
| omp / pi | parse 放行 `title`/`title_change`；`parse` 不再把 `value.id` 当标题事件的 `sessionId`；apply 存文本、`atMs` 与 `source`；`sourceTitle` 返回它 | 只认根会话；artifacts/子代理文件不产出 |
| zcode | `SessionRow` 加 `title`；`sourceTitle(file)` 打开只读连接读根会话的 `title` | `rootSessionOf` 取根；子会话自己的 title 不覆盖父会话 |
| dsh | parse 放行 `session/title`；apply 存 `data.title`、`data.source.kind` 与 `time`；seeding 期间跳过 | `state.subagentId !== null` 或 seed 前缀内不产出 |
| grok | `sourceTitle(file)` 读 `summary.json` 的 `generated_title`，退回 `session_summary`；只取非空值 | 根会话 |
| workbuddy | `IGNORED` 移除 `ai-title`/`custom-title`；apply 存标题（`aiTitle`/`customTitle`，缺字段按无标题）；`sourceTitle` 返回根标题 | 子代理文件不产出 |
| codex / hermes | 不改；网关标题继续落 request 行，读侧排在来源标题之后 | — |

批次钩子的共同约束：

- 只对根会话返回。子代理、dsh 的 seed 前缀、droid 的 `callingSessionId`、workbuddy 的 subagents 文件都不能改父会话的名字。
- 坏标题返回 null，不返回 `error`。标题行不能触发 `recordIssue` 的停游标路径。
- 钩子只在文件有新增字节、被调度摄入时调用。没有新行的存量会话不会刷新标题；这是本轮的边界，回填另行授权。
- 标题更新只依赖来源自己的事实，不打开另一家适配器的库。

### 4. 升级与回填

v17 是 additive migration：建表，不动 request。升级不回填，新会话即时生效；存量会话的标题在下次摄入该文件时出现（行来源要求有新字节，元数据来源要求有新的可摄入行）。重建或显式回填若做，单独处理 `session_title`；不碰 request，也不触发用途判定与组派生。

pi 本机没有 title 行，仍按同一适配器放行；出现新格式时不需要再改一次。`generated_title` 与 `session_summary` 在本机样本里同值，读取时优先 `generated_title`，字段缺失再退回 `session_summary`。

## Alternatives considered

- **合成 request 行**。初稿的选择。优点是不用新表，复用 `SESSION_TITLE_SQL` 与请求读取。代价是它要同时处理 `has_missing`（`via='session'` 无正文会把整会话标缺正文）、五条 owner 线索（合成行可能被账本/OTLP 认领成真实调用）、派生队列与发布代覆盖（行级跳过不存在，新行会让已发布代缺结果行）、`title_source` 被 `presentationDecision` 覆盖、`MAX(started_ms)` 与 live 判定（重命名会把会话顶到列表顶并亮 live）、请求计数与 `cost_absent`。这些都能修，但每一条都要在多个查询里写例外；一条假请求换来的复用不值得。
- **读时从 `raw_session_event` 现查标题**。会话列表是高频路径，raw 层 JSON 提取不可索引，成本回到 sessionsTitle 超时的老路（跨组标题在生产库单会话约 216ms 的实测先例）。
- **把来源标题写到既有 request 行的 `model_title`**。会污染一笔真实调用的标题语义，派生、投影与页面读取都要判断「这行的 model_title 是调用产物还是会话标题」，比新表更难收敛。

## Acceptance criteria

1. 合成 fixture：每家适配器的标题输入 → `(conv_key, source)` 恰好一行 `session_title`，title/manual/facts 正确；request 表不增行。
2. 更新语义：omp 两次 `title_change`、dsh fallback→provider 各 upsert 同一行，`title_ms` 取最新事件时间；重复的 claude `ai-title` 不产生重复写；raw 层两次事件都在（行来源）。
3. 手动优先：droid `manual=1` 的标题不被后续自动标题覆盖。
4. 会话卡换名：有标题数据的 claude/droid/omp/zcode/dsh/grok/workbuddy 会话卡显示来源标题，pi 用合成 fixture 覆盖同一适配器；有网关标题的会话显示来源标题（生产副本预演换名/变短/退兜底三项统计后再上线）。
5. 读侧一致：`listSessions` 与 `getSessionTitles` 都返回同一个来源标题；来源标题在组 dirty 时仍可见。
6. 无副作用：标题 upsert 不改变 `request_count`、`bypass`、`requests_total`、`cost_absent`、`MAX(started_ms)`、live 与 `missing_body`；不写 `request_evidence`；不标脏派生队列；不改 purpose 列。
7. 作用域：子代理文件、dsh seed 前缀、droid `callingSessionId`、workbuddy subagents 的标题不覆盖根会话。
8. 隐私：zcode/grok 的标题落库前经过 `redact`；`evidence_json` 不含标题原文。
9. 升级：v16→v17 additive；旧会话标题不变；无新行的存量会话不刷新；`bun run typecheck` 与相关 `bun test` 通过。
10. 性能：每个被摄入文件至多一次 upsert；标题读取是 `(conv_key, source)` 主键或前缀查找，无全表扫描。

## Risks

- **覆盖不完整**。omp 本机 473 个文件里 325 个没有 title 事件，pi 没有；这些会话继续落回现有三级候选。来源标题是增强，不是唯一来源。
- **标题更新依赖新行**。没有新字节的会话不会刷新标题；用户手动改名后如果没有新消息，会话卡不会更新，直到下一次摄入或显式回填。
- **上游字段变化**。标题行消失或改名时，`session_title` 静默缺失、会话卡退回旧候选。把标题行型列进[契约漂移检测](2026-11-04-source-contract-drift.md)的结构层 `eventTypes` 必含集合。
- **多来源同名**。同一 conv_key 被两个来源看到时，读侧按 `manual DESC, observed_ms DESC` 取一条；这是当前唯一可用的裁决，不保证与用户看到的一致。出现第二来源时再补来源优先级。
- **标题体积**。标题截断到 512 字符；`evidence_json` 不存标题原文，避免把用户内容复制两份。
- **claude 重复行**。`ai-title` 每回合重复，raw 增量按行计，不按会话计；按 100–200 字节/行、每会话约 142 行估算，约 14–28 KB/会话，由 raw TTL 照常回收。`session_title` 只写一次。
- **回填诱惑**。存量会话的碎片标题会很显眼，回填要显式授权，不混进上线提交。

## Deferred

- claude `cost-state`（`totalCostUSD`/`totalLinesAdded` 会话累计）：可做网关成本对账锚点，量小，等成本对账立项。
- dsh `approval/decided`（审批决定历史）：等权限/审批视图立项。
- claude `mode`/`permission-mode`/`last-prompt`/`system`/`queue-operation`、omp `model_change`/`thinking_level_change`：会话状态与模型切换时间线的原料，当前无消费方。
- claude `api-request` 族：2026-10-31 缺口恢复 note 已评估（条数低于库内请求数、逐笔覆盖率未知），维持暂缓。
- claude `attachment`/`api-request-blob`/`api-request-shape`/`file-history-snapshot`、dsh 流式分片：正文重复或大块，长期忽略。
