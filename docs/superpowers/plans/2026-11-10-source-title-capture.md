# 来源标题采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地 Agent 会话自带的标题进入会话卡，标题只写 `session_title`，不合成 request 行。

**Architecture:** schema v17 新增窄表 `session_title(conv_key, source)`。共用摄入在批末调用同步 `adapter.sourceTitle(state, file)`，用 ingest 维护的 `lastSessionId` 生成 `conv_key`，脱敏后 upsert。读侧把来源标题放在原三级候选之前，并放在组当前性闸门之外。

**Tech Stack:** TypeScript、Bun、`bun:sqlite`、现有 `redact` 与 `recordIssue`。

**Spec:** [.agents/notes/implemented/feature/2026-11-09-source-title-synthesis.md](../../../.agents/notes/implemented/feature/2026-11-09-source-title-synthesis.md)

## Global Constraints

- 方案事实源只有 Spec；本文件只排执行顺序。
- 实现分支 `feat/source-title-capture`，worktree `repos/.codex-worktrees/atc-source-title`。
- `SCHEMA_VERSION`、`CODE_SCHEMA_VERSION`、`RESTORABLE_SCHEMA_VERSIONS` 同步到 17。
- 标题先 `redact(text, salt)`，空标题不写，超过 512 字符截断；`evidence_json` 不存标题原文。
- 自动标题不覆盖 `manual=1`；标题失败记 issue，不停游标。
- 不写 request、不写 request_evidence、不标脏 derive_queue、不改 purpose 列。
- 子代理、dsh seed 前缀、droid `callingSessionId`、workbuddy subagents 不产出根标题。
- 测试只用合成数据。每个检查点跑最窄测试；最终提交带 implemented note，满足 `verify:notes:staged`。
- 本轮不做存量回填，不部署生产。

---

### Task 1: schema v17 与版本事实

**Files:**
- Create: `src/schema-v17.sql`
- Modify: `src/schema.sql`, `src/store.ts:140-405`, `src/maintenance/verify.ts:16`, `src/maintenance/backup.ts:149-153`
- Test: `tests/store.test.ts`, `tests/maintenance.test.ts`, `tests/restore-migration.test.ts`

**Interfaces:**
- Produces: `session_title(conv_key TEXT, source TEXT, title TEXT, manual INTEGER, title_ms INTEGER, observed_ms INTEGER, evidence_json TEXT, PRIMARY KEY(conv_key, source)) WITHOUT ROWID`
- Produces: `execAdditiveV17(db)`，只执行 `CREATE TABLE IF NOT EXISTS`

- [ ] **Step 1: 写 v16→v17 失败测试**

在 `tests/store.test.ts` 增加：建当前库并写一行 request，`DROP TABLE IF EXISTS session_title; PRAGMA user_version=16`，重开后断言 `user_version=CODE_SCHEMA_VERSION`、request 仍 1 行、`session_title` 可查且 0 行。

- [ ] **Step 2: 跑测试确认红**

Run: `bun test tests/store.test.ts`
Expected: FAIL，`session_title` 不存在或版本未到 17。

- [ ] **Step 3: 写最小迁移**

`src/schema-v17.sql`：

```sql
CREATE TABLE IF NOT EXISTS session_title (
  conv_key      TEXT NOT NULL,
  source        TEXT NOT NULL,
  title         TEXT NOT NULL,
  manual        INTEGER NOT NULL DEFAULT 0,
  title_ms      INTEGER,
  observed_ms   INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (conv_key, source)
) WITHOUT ROWID;
```

`src/schema.sql` 放同形 DDL。`store.ts` 增加 `SCHEMA_V17` 与 `execAdditiveV17`，新装路径与 v6..v16 每个升级分支都串到 v17，新增 `version === 16` 分支。三处版本常量改 17。

- [ ] **Step 4: 跑窄测试确认绿**

Run: `bun test tests/store.test.ts tests/maintenance.test.ts tests/restore-migration.test.ts`
Expected: PASS。

### Task 2: 共用写路径与 Claude 标题

**Files:**
- Modify: `src/sources/session/types.ts:95-149`, `src/sources/session/ingest.ts:324-474`, `src/sources/session/adapters/claude.ts`
- Test: `tests/session-claude.test.ts`

**Interfaces:**
- Consumes: `session_title` 表、`redact`、`recordIssue`、`sessionConvKey`
- Produces: `SessionTitle = { text: string; atMs: number | null; manual?: boolean; ref: string; facts?: Record<string, unknown> }`
- Produces: `SessionAdapter.sourceTitle?(state: unknown, file: SessionFile): SessionTitle | null`

- [ ] **Step 1: 写 Claude 标题失败测试**

合成主文件包含 user、assistant、两条相同 `ai-title`（字段 `aiTitle`，无 timestamp）。断言：request 数不变；`session_title` 一行；`title_ms` 取 `firstMessageMs`；raw 层保留两条标题行；第二次摄入同标题且 `now` 更晚时 `observed_ms` 不刷新。子代理路径与 `isSidechain` 标题不写。

- [ ] **Step 2: 跑测试确认红**

Run: `bun test tests/session-claude.test.ts`
Expected: FAIL，标题行被 ignore 或 `sourceTitle` 不存在。

- [ ] **Step 3: 写契约与 upsert**

`ingest.ts` 在 replay、逐行 apply、flush 结果里维护 `lastSessionId`。flush 后调用：

```ts
const title = adapter.sourceTitle?.(state, file) ?? null;
if (title !== null && lastSessionId !== null) {
  upsertSessionTitleTx(db, adapter, sessionConvKey(lastSessionId), title, salt, now);
}
```

`upsertSessionTitleTx` 先 `redact(title.text, salt)`，非字符串或 trim 后为空则返回；按 code point 截断 512；`evidence_json` 写 `{source_kind, ref, facts}`，不写 text。冲突更新只接受标题、manual、title_ms 或 evidence 变化，并保留手动优先：

```sql
ON CONFLICT(conv_key,source) DO UPDATE SET
  title=excluded.title, manual=excluded.manual, title_ms=excluded.title_ms,
  observed_ms=excluded.observed_ms, evidence_json=excluded.evidence_json
WHERE (session_title.manual=0 OR excluded.manual=1)
  AND (session_title.title<>excluded.title OR session_title.manual<>excluded.manual
    OR session_title.title_ms IS NOT excluded.title_ms
    OR session_title.evidence_json<>excluded.evidence_json)
```

钩子或写库抛错时 `recordIssue(db, adapter.issueKind, file.name, 'session_title_failed', now, null)`，不改 `result.blocked`。

- [ ] **Step 4: 接 Claude**

`ClaudeState` 增加 `title/titleMs/titleOffset/firstMessageMs`。parse 放行 `ai-title`；apply 读 `aiTitle`，sidechain 不存；`sourceTitle` 对 `subagents` 路径返回 null，ref 用 `file.name:offset`。

- [ ] **Step 5: 跑窄测试确认绿**

Run: `bun test tests/session-claude.test.ts`
Expected: PASS。

### Task 3: 其余行来源适配器

**Files:**
- Modify: `src/sources/session/adapters/pi-jsonl.ts`, `src/sources/session/adapters/dsh.ts`, `src/sources/session/adapters/workbuddy.ts`, `src/sources/droid/parse.ts`, `src/sources/session/adapters/droid.ts`
- Test: `tests/session-omp.test.ts`, `tests/session-dsh.test.ts`, `tests/session-workbuddy.test.ts`, `tests/droid-parse.test.ts`, `tests/droid-ingest.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `SessionTitle` 与共用 upsert
- Produces: omp/pi、dsh、workbuddy、droid 的 `sourceTitle`

- [ ] **Step 1: 写各家失败测试**

omp/pi：`title` 读 `title` 与 `updatedAt`，`title_change` 读 `title` 与 `timestamp`；标题事件 parse 的 `sessionId` 为 null，raw 的 `session_id` 不写事件 id；两次 `title_change` 只一行且 `title_ms` 取最新。dsh：`session/title` 的 `data.title/data.source.kind/time`；fallback→provider 更新同一行；seed 前缀与子代理不写。workbuddy：`aiTitle/customTitle` 落 raw 与标题表，subagents 不写。droid：`isSessionTitleManuallySet=true` 写 `manual=1`，后续自动标题不覆盖；`callingSessionId` 不写。

- [ ] **Step 2: 跑测试确认红**

Run: `bun test tests/session-omp.test.ts tests/session-dsh.test.ts tests/session-workbuddy.test.ts tests/droid-parse.test.ts tests/droid-ingest.test.ts`
Expected: FAIL，标题未采集或手动优先未实现。

- [ ] **Step 3: 最小接线**

omp/pi parse 只放行 `session/message/title/title_change`，标题事件 `sessionId:null`；apply 存最新标题。dsh parse 放行 `session/title`，apply 在子代理与 seed 前缀跳过。workbuddy 从 `IGNORED` 删除两个标题行型，parse 提取 `aiTitle/customTitle`。droid `DroidSessionStart` 增加 `isSessionTitleManuallySet`，adapter `sourceTitle` 透出 title/manual。

- [ ] **Step 4: 跑窄测试确认绿**

Run: 同 Step 2。
Expected: PASS。

### Task 4: 元数据来源适配器

**Files:**
- Modify: `src/sources/session/adapters/zcode.ts`, `src/sources/session/adapters/grok.ts`
- Test: `tests/session-zcode.test.ts`, `tests/session-grok.test.ts`

**Interfaces:**
- Consumes: Task 2 的共用 upsert；`storesRaw:false` 不依赖 sanitizedPayload
- Produces: zcode/grok 的 `sourceTitle`

- [ ] **Step 1: 写失败测试**

zcode：根会话 `session.title` 写一行；子会话文件读根标题，不用子会话 title；标题含合成密钥时落库前脱敏。grok：`generated_title` 优先，缺失退 `session_summary`，空值不写；标题含合成密钥时脱敏；request 与 raw 行数不因此增加。

- [ ] **Step 2: 跑测试确认红**

Run: `bun test tests/session-zcode.test.ts tests/session-grok.test.ts`
Expected: FAIL。

- [ ] **Step 3: 最小接线**

zcode `SessionRow` 加 `title`，相关 SELECT 补列；`sourceTitle` 开只读连接，`rootSessionOf` 取根，ref 用库路径加会话 id。grok `summaryOf` 透出标题与字段名；`sourceTitle` 读当前 `summary.json`，ref 指向实际字段。

- [ ] **Step 4: 跑窄测试确认绿**

Run: 同 Step 2。
Expected: PASS。

### Task 5: 读侧优先级与计划

**Files:**
- Modify: `src/queries/sessions.ts:187-232,296-297`
- Test: `tests/queries.test.ts`

**Interfaces:**
- Consumes: `session_title`
- Produces: `listSessions` 与 `getSessionTitles` 同一第一候选

- [ ] **Step 1: 写读侧失败测试**

种子来源标题与网关/用户标题：来源标题优先；组 dirty 时来源标题仍可见；无来源标题退回原候选；`listSessions` full/light 回填与 `getSessionTitles` 一致。更新 `titleCostMs` 的标题列定位，使它在外层 COALESCE 下仍只去掉旧候选。

- [ ] **Step 2: 跑测试确认红**

Run: `bun test tests/queries.test.ts`
Expected: FAIL，来源标题未优先或标题列定位失败。

- [ ] **Step 3: 写读侧 SQL**

新增共用子查询：

```sql
(SELECT st.title FROM session_title st
 WHERE st.conv_key = request.conv_key
 ORDER BY st.manual DESC, st.observed_ms DESC, st.source ASC LIMIT 1)
```

`listSessions` full 分支用 `COALESCE(来源标题, CASE WHEN guard THEN 原候选 END)`；`getSessionTitles` 内联 SQL 加同一第一候选。冻结 oracle 不 seed `session_title`，不改 oracle。

- [ ] **Step 4: 跑窄测试与计划断言**

Run: `bun test tests/queries.test.ts`
Expected: PASS；`getSessionTitles` 计划仍含 `SEARCH request USING COVERING INDEX i_req_session_time`，不含 `SCAN request`。

### Task 6: 文档、note 与收尾检查

**Files:**
- Move: `.agents/notes/proposed/feature/2026-11-09-source-title-synthesis.md` → `.agents/notes/implemented/feature/2026-11-09-source-title-synthesis.md`
- Modify: `docs/architecture-design.md`, `docs/operations.md`, `docs/agent-coverage.md`, `docs/acceptance.md`, `GLOSSARY.md`, `.agents/notes/LESSONS.md`

**Interfaces:**
- Consumes: 已通过的合成测试与实测数字
- Produces: implemented note、v17 运维事实、合成验收记录

- [ ] **Step 1: 同步文档**

note 转 implemented，补 Decision/Consequences 与合成实测；架构与运维写 v17；覆盖矩阵写各家标题位置；验收记录只写合成结果，真实流量验收留待部署后。术语表只在新增术语时改。

- [ ] **Step 2: 跑最终窄检查**

Run: `bun run typecheck && bun test tests/session-claude.test.ts tests/session-omp.test.ts tests/session-dsh.test.ts tests/session-workbuddy.test.ts tests/session-zcode.test.ts tests/session-grok.test.ts tests/droid-parse.test.ts tests/droid-ingest.test.ts tests/queries.test.ts tests/store.test.ts tests/maintenance.test.ts tests/restore-migration.test.ts && bun run verify:notes:staged`
Expected: PASS。全量 `bun test` 与平台矩阵留给显式动作。

- [ ] **Step 3: 提交分支**

暂存本批代码、测试、文档与 implemented note，核对 `git diff --cached --stat` 后提交。提交信息用英文，说明 v17、写路径、读侧、隐私、作用域与验证。合并 master、生产副本预演、部署与回填另行授权。