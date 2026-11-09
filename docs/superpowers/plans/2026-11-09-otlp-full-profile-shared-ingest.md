# OTLP 全量接入 profile 与共享摄入编排核心 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户已授权 subagent 串行/并行编排。 spine（Task 1→2→4→5）在主 worktree 串行，每个 Task 派一个 fresh subagent、主 Agent 审查后再进下一个；Task 3 在独立 worktree 与 spine 并行。共享 note 与 Git 暂存、合并由主 Agent 串行处理。

**Goal:** 把 hook 与 OTLP 两份摄入编排收敛成一个通道参数化的共享核心，并在同一条 OTLP 道上交付对外全量 profile（完整正文 + 响应 id + 统一认领），原生方言层零改动。

**Architecture:** 从 `acceptHook` 抽出 `ingestRequestTx`（判重→认领→建行/复用→正文落块与降级→证据登记→派生标记），认领策略作为前端回调传入；hook 与 OTLP 各留校验与原始层。OTLP 全量行经核心获得 `response_id_norm` 落列、统一 owner 认领（删 `magpieTurnRequestTx`）、正文转 `available`；semconv 消息形状进 `protocol-shape` 查表。证据身份不混（OTLP 仍 `otlp_span`/have 第 4 位/`via='otlp'`）。

**Tech Stack:** TypeScript、Bun、bun:sqlite、node:zlib；无新依赖。

**Spec:** [OTLP 全量接入 profile 与共享摄入编排核心](../../../.agents/notes/proposed/feature/2026-11-09-otlp-full-profile-shared-ingest.md)。执行者同时读该 note 与[架构设计](../../architecture-design.md)、[OTLP 接入 profile](../../otlp-exporter-profile.md)。

## Global Constraints

- TypeScript + Bun 单进程；不引第三方依赖，SQLite 用 `bun:sqlite`，压缩用 `node:zlib`。
- 依赖方向单向：`config` ← `store` ← 引擎与读模型；`ingest-core` 是 hook 与 otlp 共同下层，不反向 import 前端运行时（`HookAdmission` 类型移进核心，hook re-export）。
- 测试只用合成数据；真实请求正文、账号、令牌与用户配置不进 fixture、日志或提交。
- 每个行为变更只跑能对该回归失败的最窄测试；提交前不重复已通过的检查；全量套件留给合并前显式动作。
- 正文与路由内容在页面一律转义；脱敏唯一入口 `src/privacy.ts` 的 `redact`，`persistBodyTx` 不自行脱敏，调用方先脱敏。
- 监听写死 `127.0.0.1`；生产起停走 `bun run service restart|stop|start`，不 `kill`、不手动起第二个。
- 实现走 worktree：仓库上级 `.codex-worktrees/atc-<topic>` 建 `feat/` 分支；新 worktree 软链主检出 `node_modules` 并补 `.git/info/exclude`；master 只 `--no-ff` 合并，合并后移除 worktree 目录、保留分支名。
- `OTLP_MAPPING_VERSION` 4→5 只在 Task 4 升一次（改表即升版）；`PURPOSE_VERSION`/`GROUP_VERSION`/`DERIVE_VERSION`/`ADAPTER_VERSION` 本批不动（新增协议与形状识别 widening 不改既有行的派生结论）。
- 不装本地 git hook；合并前显式跑 `bun run verify:notes`。note 先提交进 master 的 `proposed/`，Task 5 在分支上转 `implemented/`，使合并批次 range 内含 note 变更。
- 英文提交信息，结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## 范围与解释边界

- **span status**：`raw_otlp_span.status_code` 已落原始层（现状）。本批把「span status = harness 视角成败、不合成 HTTP 200」写进 profile 文档语义；不新增 request 列（那需要 schema 变更与 backfill，超出本批）。`request.status` 与费用仍只来自账本。
- **费用**：不进契约。无 magpie 的全量行 `cost_state='absent'`（核心建行默认值已是）。
- **UI 渲染**：semconv 适配器交付消息解析、工具配对、派生与 `messageText` 文本识别；parts 形状在正文页按既有「认不出原样保留」路径显示，专门的 parts 前端渲染另议。
- **存量双行**：不靠新流量自愈，走 `maintain dedupe-sessions` 显式并入，执行范围另行授权（Task 6 之外）。
- **reference harness**：Task 4 登记 `service.name='tracery-reference'`、`agent='reference'` 作为全量 profile 的第一个集成方与真实流量验收载体；`reference` 无 harness 专属用途指纹，走通用语义（静态登记数组不加空壳）。

## File Structure

| 文件 | 责任 | 任务 |
| --- | --- | --- |
| `src/ingest-core.ts`（新建） | 共享编排核心 + `HookAdmission`/`IngestChannel`/`IngestIdentity`/`ClaimOutcome`/`IngestResult` 类型 | 1 |
| `src/hook.ts` | 前端：校验、raw_hook、pending_hook、投影；认领回调 `claimHookTarget`；re-export `HookAdmission` | 1 |
| `src/sources/otlp/ingest.ts` | 前端：解码、raw、白名单、body_ref；`persistMappedSpanTx` 切核心；删 `magpieTurnRequestTx`；全量正文接线 | 2、4 |
| `src/maintenance/otlp-replay.ts` | preview/apply 切统一 owner + 核心判重 | 2 |
| `src/protocol-shape.ts` | semconv 查表：messagesKey、`semconvCalls`、`semconvResults` | 3 |
| `src/capabilities.ts` | `CAPABLE_PROTOCOLS` 加 `genai-semconv` | 3 |
| `src/input-interpretation.ts` | `textBlocks` 识别 semconv `parts[].content` | 3 |
| `src/sources/otlp/mapping.ts` | `AttrKeys`/`SpanMapping` 加 responseId/inputMessages/outputMessages；`fullProfileRule` 工厂；升版 5 | 4 |
| `scripts/otlp-full-profile-export.ts`（新建） | 全量 profile 参考导出脚本（真实流量验收载体） | 4 |
| `tests/ingest-core.test.ts`（新建） | 核心判重优先、认领复用、正文降级、派生标记 | 1 |
| `tests/otlp-ingest.test.ts` | 统一 owner 认领、双方向去重、全量正文、解析降级 | 2、4 |
| `tests/otlp-replay.test.ts` | 升版重放、判重不依赖 hook 证据 | 2、4 |
| `tests/protocol-shape.test.ts`、`tests/input-interpretation.test.ts` | semconv 工具配对与文本识别 | 3 |
| `docs/otlp-exporter-profile.md`、`docs/architecture-design.md`、`docs/acceptance.md` | 全量级章节、编排分工、验收记录 | 5、6 |
| `.agents/notes/proposed/feature/2026-11-09-otlp-full-profile-shared-ingest.md` → `implemented/` | note 转 implemented + 互链交付记录 | 5 |

---

## Task 1: 共享编排核心抽取（hook 行为锁定）

**Worktree:** `.codex-worktrees/atc-otlp-full-profile`，分支 `feat/otlp-full-profile-shared-ingest`（从 master 建）。

**Files:**
- Create: `src/ingest-core.ts`
- Modify: `src/hook.ts:59`（移 `HookAdmission`）、`src/hook.ts:121-343`（insertHookRequest/acceptHook 改包装）
- Test: `tests/ingest-core.test.ts`（新建）

**Interfaces:**
- Consumes: `persistBodyTx(db, reqId, body: BodyInput, prefix?)`、`insertEvidenceTx(db, reqId, sourceKind, refKey, mergeState, matchRule, now)`、`markRequestInputTx(db, reqId)`、`localDay`/`modelTimeTitle`、`findRequestOwnerTx(db, query: OwnerQuery): RequestOwner`、`UsageFingerprint`、`ConvRef`。
- Produces:
  - `HookAdmission = { mode: 'normal'|'metadata_only'|'paused'; reason: string|null }`（从 hook.ts 移入，hook re-export）。
  - `IngestChannel = { sourceKind: string; via: string; haveBit: number; sortSource: string; createdRule: string; createdMergeState: 'pending'|'merged'; emptyBodyState: string }`。
  - `IngestIdentity = { refKey: string; agent: string|null; session: string|null; conv: ConvRef|null; responseIdNorm: string|null; turnRef: string|null; model: string|null; startedMs: number; endMs: number|null; usage: UsageFingerprint|null; actorState: 'known'|'unknown'; modelRequested: string|null; modelServed: string|null; stop: string|null; inTok: number|null; outTok: number|null; cacheRead: number|null; cacheWrite: number|null; magpieVersion: string|null }`。
  - `ClaimOutcome = { target: number|null; rule: string|null; candidates: number[] }`。
  - `IngestResult = { reqId: number; created: boolean; duplicate: boolean; claim: ClaimOutcome }`。
  - `ingestRequestTx(db: Database, channel: IngestChannel, identity: IngestIdentity, body: BodyInput|null, omission: string|null, claim: (db: Database) => ClaimOutcome, now: number, admission: HookAdmission): IngestResult`。

- [ ] **Step 1: 建 worktree 并锁定现状基线**

```bash
cd /Users/pis/workspace_intelligence/creator-intelligence/repos
mkdir -p .codex-worktrees
git -C agent-trace-collector worktree add .codex-worktrees/atc-otlp-full-profile -b feat/otlp-full-profile-shared-ingest master
cd .codex-worktrees/atc-otlp-full-profile
ln -s ../../agent-trace-collector/node_modules node_modules
printf 'node_modules\n' >> .git/info/exclude
bun test tests/hook.test.ts tests/hook-identity.test.ts tests/reconcile.test.ts tests/merge-body-metadata.test.ts
```

Expected: 全绿（基线）。记录通过数，抽取后对照同一组。

- [ ] **Step 2: 写核心判重与降级回归测试（先失败）**

`tests/ingest-core.test.ts`：

```typescript
import { expect, test } from 'bun:test';
import { fixture } from './fixtures';
import { ingestRequestTx } from '../src/ingest-core';
import type { IngestChannel, IngestIdentity } from '../src/ingest-core';
import { HAVE_BODY, MATCH_BY_RESPONSE_ID, hookConv, insertEvidenceTx } from '../src/evidence';

const NOW = 1_790_000_000_000;
const CH: IngestChannel = {
  sourceKind: 'hook', via: 'hook', haveBit: HAVE_BODY, sortSource: 'hook',
  createdRule: MATCH_BY_RESPONSE_ID, createdMergeState: 'pending', emptyBodyState: 'pending',
};
function identity(refKey: string): IngestIdentity {
  return {
    refKey, agent: 'claude', session: 'sess-core-0001',
    conv: hookConv('sess-core-0001', refKey),
    responseIdNorm: null, turnRef: null, model: 'synth-model', startedMs: NOW, endMs: NOW + 100,
    usage: null, actorState: 'unknown', modelRequested: null, modelServed: null, stop: null,
    inTok: null, outTok: null, cacheRead: null, cacheWrite: null, magpieVersion: null,
  };
}
const NO_CLAIM = () => ({ target: null, rule: null, candidates: [] });
const BODY = { protocol: 'anthropic', request: { messages: [] }, reply: null, redact_version: 1 };

test('同 ref_key 重发：判重优先于认领，零新行零副作用', () => {
  const { store } = fixture();
  try {
    store.write(db => {
      const first = ingestRequestTx(db, CH, identity('h-1'), BODY, null, NO_CLAIM, NOW, { mode: 'normal', reason: null });
      expect(first.created).toBe(true);
      expect(first.duplicate).toBe(false);
      let called = false;
      const second = ingestRequestTx(db, CH, identity('h-1'), BODY, null,
        () => { called = true; return { target: null, rule: null, candidates: [] }; }, NOW, { mode: 'normal', reason: null });
      expect(second.duplicate).toBe(true);
      expect(second.reqId).toBe(first.reqId);
      expect(called).toBe(false); // 判重命中即返回，不进认领
    }, 'test');
    expect((store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(1);
  } finally { store.close(); }
});

test('认领既有行：不新建，have 置位，证据 merged', () => {
  const { store } = fixture();
  try {
    store.write(db => {
      const target = ingestRequestTx(db, CH, identity('h-target'), null, null, NO_CLAIM, NOW, { mode: 'normal', reason: null });
      const claimed = ingestRequestTx(db, CH, identity('h-claim'), BODY, null,
        () => ({ target: target.reqId, rule: MATCH_BY_RESPONSE_ID, candidates: [target.reqId] }), NOW, { mode: 'normal', reason: null });
      expect(claimed.created).toBe(false);
      expect(claimed.reqId).toBe(target.reqId);
      const row = store.read.query('SELECT have, body_state FROM request WHERE req_id=?').get(target.reqId) as { have: number; body_state: string };
      expect(row.have & HAVE_BODY).toBe(HAVE_BODY);
      expect(row.body_state).toBe('available');
      const ev = store.read.query('SELECT merge_state FROM request_evidence WHERE ref_key=?').get('h-claim') as { merge_state: string };
      expect(ev.merge_state).toBe('merged');
    }, 'test');
  } finally { store.close(); }
});

test('metadata_only 无骨架降级 partial；已有正文不抹掉', () => {
  const { store } = fixture();
  try {
    store.write(db => {
      const r = ingestRequestTx(db, CH, identity('h-meta'), BODY, null, NO_CLAIM, NOW, { mode: 'metadata_only', reason: 'disk_80' });
      const row = store.read.query('SELECT body_state, miss_reason FROM request WHERE req_id=?').get(r.reqId) as { body_state: string; miss_reason: string };
      expect(row.body_state).toBe('partial');
      expect(row.miss_reason).toBe('disk_body_paused');
      // 第二次 normal 带正文：补回 available 并清原因
      ingestRequestTx(db, CH, identity('h-meta-2'), BODY, null,
        () => ({ target: r.reqId, rule: null, candidates: [] }), NOW, { mode: 'normal', reason: null });
    }, 'test');
    const row = store.read.query('SELECT body_state, miss_reason FROM request WHERE req_id=1').get() as { body_state: string; miss_reason: string | null };
    expect(row.body_state).toBe('available');
    expect(row.miss_reason).toBeNull();
  } finally { store.close(); }
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `bun test tests/ingest-core.test.ts`
Expected: FAIL（`ingestRequestTx` 不存在）。

- [ ] **Step 4: 实现 `src/ingest-core.ts`**

```typescript
/**
 * 共享摄入编排核心：判重 → 关联认领 → 建行/复用 → 正文落块与降级 →
 * 证据登记 → 派生标记。hook 与 OTLP 两个前端各留校验与原始层；通道差异
 * （source_kind、have 位、via、建行列值）由参数传入。认领策略是前端回调：
 * hook 走路由候选→turn 占位→统一 owner，OTLP 只走统一 owner，核心不持有
 * 通道专属的认领知识。证据身份不混：OTLP 行仍挂 otlp_span、have 第 4 位。
 */
import type { Database } from 'bun:sqlite';
import { persistBodyTx } from './body';
import type { BodyInput } from './body';
import type { ConvRef } from './evidence';
import { insertEvidenceTx } from './evidence';
import { localDay, modelTimeTitle } from './format';
import { markRequestInputTx } from './derive/state';
import type { UsageFingerprint } from './owner';

export type HookAdmission = { mode: 'normal' | 'metadata_only' | 'paused'; reason: string | null };

export type IngestChannel = {
  sourceKind: string;
  via: string;
  haveBit: number;
  sortSource: string;
  createdRule: string;
  createdMergeState: 'pending' | 'merged';
  emptyBodyState: string;
};

export type IngestIdentity = {
  refKey: string;
  agent: string | null;
  session: string | null;
  conv: ConvRef | null;
  responseIdNorm: string | null;
  turnRef: string | null;
  model: string | null;
  startedMs: number;
  endMs: number | null;
  usage: UsageFingerprint | null;
  actorState: 'known' | 'unknown';
  modelRequested: string | null;
  modelServed: string | null;
  stop: string | null;
  inTok: number | null;
  outTok: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  magpieVersion: string | null;
};

export type ClaimOutcome = { target: number | null; rule: string | null; candidates: number[] };
export type IngestResult = { reqId: number; created: boolean; duplicate: boolean; claim: ClaimOutcome };

const NO_CLAIM: ClaimOutcome = { target: null, rule: null, candidates: [] };

function insertRequest(
  db: Database, channel: IngestChannel, id: IngestIdentity,
  body: BodyInput | null, omission: string | null, now: number,
): number {
  const bodyState = omission !== null ? 'partial' : body !== null ? 'pending' : channel.emptyBodyState;
  const result = db.run(
    `INSERT INTO request(
       response_id_norm,agent,session,conv_key,conv_source,actor,actor_state,
       started_ms,day,via,status,model_requested,model_served,stop,in_tok,out_tok,cache_read,cache_write,
       body_state,derive_version,have,created_at,updated_at,title,title_source,
       cost_state,attempt_state,sort_source,sort_key,turn_ref,magpie_version,parse_state,reply_state
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id.responseIdNorm, id.agent, id.session, id.conv?.key ?? null, id.conv?.source ?? null,
      id.session, id.actorState,
      id.startedMs, localDay(id.startedMs), channel.via, null,
      id.modelRequested, id.modelServed, id.stop, id.inTok, id.outTok, id.cacheRead, id.cacheWrite,
      bodyState, 0, channel.haveBit, now, now, modelTimeTitle(id.model, id.startedMs), 'model_time',
      'absent', 'known', channel.sortSource, id.refKey, id.turnRef, id.magpieVersion, null, null,
    ],
  );
  return Number(result.lastInsertRowid);
}

export function ingestRequestTx(
  db: Database,
  channel: IngestChannel,
  identity: IngestIdentity,
  body: BodyInput | null,
  omission: string | null,
  claim: (db: Database) => ClaimOutcome,
  now: number,
  admission: HookAdmission,
): IngestResult {
  // 判重先于认领：重放与重发不产生新行，也不触发认领副作用。
  const dup = db.query<{ req_id: number }, [string, string]>(
    'SELECT req_id FROM request_evidence WHERE source_kind=? AND ref_key=?',
  ).get(channel.sourceKind, identity.refKey);
  if (dup != null) return { reqId: dup.req_id, created: false, duplicate: true, claim: NO_CLAIM };

  const claimed = claim(db);
  const created = claimed.target === null;
  const reqId = created ? insertRequest(db, channel, identity, body, omission, now) : claimed.target!;

  // 只补空：既有身份不被后到证据覆盖。
  if (identity.turnRef !== null) {
    db.run('UPDATE request SET turn_ref=COALESCE(turn_ref,?) WHERE req_id=?', [identity.turnRef, reqId]);
  }
  if (identity.responseIdNorm !== null) {
    db.run('UPDATE request SET response_id_norm=COALESCE(response_id_norm,?) WHERE req_id=?', [identity.responseIdNorm, reqId]);
  }

  const current = db.query<{ skeleton_z: Uint8Array | null; conv_key: string | null }, [number]>(
    'SELECT skeleton_z, conv_key FROM request WHERE req_id=?',
  ).get(reqId);
  const hasBody = current?.skeleton_z != null;
  if (body !== null && omission === null && admission.mode === 'metadata_only') {
    if (!hasBody) {
      db.run(`UPDATE request SET body_state='partial', miss_reason='disk_body_paused', updated_at=? WHERE req_id=?`, [now, reqId]);
    }
  } else if (body !== null && omission === null) {
    persistBodyTx(db, reqId, body);
    db.run('UPDATE request SET miss_reason=NULL WHERE req_id=?', [reqId]);
  } else if (omission !== null && !hasBody) {
    // 已有正文不因一次超限回调被抹掉。
    db.run(`UPDATE request SET body_state='partial', miss_reason=?, updated_at=? WHERE req_id=?`, [omission, now, reqId]);
  }

  insertEvidenceTx(db, reqId, channel.sourceKind, identity.refKey,
    created ? channel.createdMergeState : 'merged', claimed.rule ?? channel.createdRule, now);
  db.run(`UPDATE request SET have=have|${channel.haveBit}, updated_at=? WHERE req_id=?`, [now, reqId]);
  // 有归属才推进派生：hook 的 conv 永不为 null（hookConv 兜底）；OTLP 无会话的
  // 新建行保持独立记录；认领到带归属的行时照常推进。
  if (identity.conv !== null || current?.conv_key != null) markRequestInputTx(db, reqId);
  return { reqId, created, duplicate: false, claim: claimed };
}
```

- [ ] **Step 5: hook.ts 改包装**

把 `HookAdmission` 定义（`src/hook.ts:59`）替换为 re-export：

```typescript
export type { HookAdmission } from './ingest-core';
import type { HookAdmission } from './ingest-core';
```

新增通道常量与认领回调（保留 `findCandidates`、`replyIdOf`、`savePending`、`insertHookRequest` 删除）：

```typescript
import { ingestRequestTx } from './ingest-core';
import type { ClaimOutcome, IngestChannel } from './ingest-core';

const HOOK_CHANNEL: IngestChannel = {
  sourceKind: 'hook', via: 'hook', haveBit: HAVE_BODY, sortSource: 'hook',
  createdRule: MATCH_BY_RESPONSE_ID, createdMergeState: 'pending', emptyBodyState: 'pending',
};

/** hook 认领：路由候选 → OTLP turn 占位 → 统一 owner 回落（弱窗显式关闭）。 */
function claimHookTarget(
  db: Database, envelope: HookEnvelope, responseIdNorm: string | null,
  turnRef: string | null, conv: ConvRef, now: number,
): ClaimOutcome {
  const candidates = responseIdNorm === null ? [] : findCandidates(db, responseIdNorm);
  let target: number | null = candidates.length === 1 ? candidates[0]! : null;
  let joinedByTurn = false;
  if (target === null && turnRef !== null) {
    const rows = db.query<{ req_id: number }, [string]>(`
      SELECT req_id FROM request WHERE turn_ref=? AND via='otlp' ORDER BY req_id LIMIT 2`,
    ).all(turnRef);
    if (rows.length === 1) { target = rows[0]!.req_id; joinedByTurn = true; }
  }
  let joinedRule: string | null = null;
  if (target === null) {
    const owner = findRequestOwnerTx(db, {
      responseIdNorm, turnRef, convKey: conv.key, agent: envelope.agent,
      startedMs: Number.isFinite(envelope.observed_start_ms) ? envelope.observed_start_ms : now,
      endMs: Number.isFinite(envelope.observed_finish_ms) ? envelope.observed_finish_ms : null,
      model: envelope.model, usage: null, excludeSourceKind: 'hook', disallowWeakWindow: true,
    });
    if (owner.reqId !== null) { target = owner.reqId; joinedRule = owner.rule; }
  }
  return { target, rule: joinedRule ?? (joinedByTurn ? MATCH_BY_TURN : null), candidates };
}
```

`acceptHook` 的 `store.write` 体改为（校验、脱敏、conv 计算保留原样；落库段交核心）：

```typescript
return store.write(db => {
  if (typeof envelope.hook_id !== 'string' || envelope.hook_id.length === 0) throw new Error('hook_id_missing');
  if (envelope.origin !== 'local') throw new Error('hook_origin_rejected');

  const responseIdNorm = normalizeResponseId(replyIdOf(envelope.reply));
  const bodyBytes = { request_bytes: utf8Bytes(envelope.request), reply_bytes: utf8Bytes(envelope.reply) };
  const omission = envelope.body_omitted ? (envelope.omit_reason ?? 'collector_object_limit') : bodyOmission(bodyBytes);
  const redactedRequest = envelope.request === null ? null : redact(envelope.request, salt);
  const redactedReply = envelope.reply === null ? null : redact(envelope.reply, salt);
  const turnRef = envelope.request === null ? null : (codexTurnFactsOf(envelope.request)?.turnRef ?? null);
  const conv = digestConv ?? hookConv(sessionIdentity(envelope.session), envelope.hook_id);
  const started = Number.isFinite(envelope.observed_start_ms) ? envelope.observed_start_ms : now;

  const body: BodyInput = { protocol: envelope.protocol, request: redactedRequest, reply: redactedReply, redact_version: 1 };
  const result = ingestRequestTx(db, HOOK_CHANNEL, {
    refKey: envelope.hook_id, agent: envelope.agent, session: sessionIdentity(envelope.session),
    conv, responseIdNorm, turnRef, model: envelope.model, startedMs: started,
    endMs: Number.isFinite(envelope.observed_finish_ms) ? envelope.observed_finish_ms : null,
    usage: null, actorState: 'unknown', modelRequested: null, modelServed: null, stop: null,
    inTok: null, outTok: null, cacheRead: null, cacheWrite: null, magpieVersion: envelope.magpie_version ?? null,
  }, body, omission, db2 => claimHookTarget(db2, envelope, responseIdNorm, turnRef, conv, now), now, admission);
  if (result.duplicate) return { req_id: result.reqId, duplicate: true };

  // raw_hook 插入语句原样保留（src/hook.ts:317-333），omission/bodyBytes 变量仍在作用域。
  db.run(`INSERT INTO raw_hook(...) VALUES (...)`, [/* 原参数列表逐字保留 */]);
  if (result.created) savePending(db, envelope, responseIdNorm, result.claim.candidates, now);
  projectRequestTx(db, result.reqId, { now, mappingVersion: SOURCE_PROJECTION_VERSION });
  return { req_id: result.reqId, duplicate: false };
}, 'hook');
```

删除 `insertHookRequest`、`duplicateResult`、`hookRequest` 中仅服务于旧落库段的部分（`hookRequest` 仍被 `mergeHookInto` 使用，保留）。`have` 更新、`markRequestInputTx`、证据插入已进核心，从 acceptHook 删除。raw_hook 的 INSERT 列与参数逐字搬运，不改值。

- [ ] **Step 6: 跑核心测试与 hook 基线组**

Run: `bun test tests/ingest-core.test.ts tests/hook.test.ts tests/hook-identity.test.ts tests/reconcile.test.ts tests/merge-body-metadata.test.ts`
Expected: 全绿，hook 组通过数与 Step 1 基线一致。

- [ ] **Step 7: typecheck + 提交**

```bash
bun run typecheck
git add src/ingest-core.ts src/hook.ts tests/ingest-core.test.ts
ATC_NOTE_EXEMPT="otlp-full-profile 批次 note 随 Task 5 转 implemented 落地" bun run verify:notes:staged
git commit -m "refactor(ingest): extract channel-parameterized ingest core from acceptHook

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

提交信息正文补 `Agent-Note: none — otlp-full-profile batch note lands at Task 5`（与豁免理由一致，供 range 核对）。

---

## Task 2: OTLP 切核心 + 统一 owner 认领（spine，依赖 Task 1）

**Files:**
- Modify: `src/sources/otlp/ingest.ts:57-157`（删 `magpieTurnRequestTx`/`TURN_DEDUPE_WINDOW_MS`，`persistMappedSpanTx` 切核心）、`src/maintenance/otlp-replay.ts:23,103,134`
- Test: `tests/otlp-ingest.test.ts`、`tests/otlp-replay.test.ts`

**Interfaces:**
- Consumes: `ingestRequestTx`/`IngestChannel`/`IngestIdentity`/`ClaimOutcome`（Task 1）、`findRequestOwnerTx(db, query: OwnerQuery): RequestOwner`、`UsageFingerprint = { input; output; cacheRead; cacheWrite }`、`otlpConv(session)`、`HAVE_OTLP`、`MATCH_BY_SPAN_IDENTITY`。
- Produces: `PersistMappedSpanResult = { created: boolean; bodiesWired: number; duplicate: boolean }`（加 `duplicate`）；`persistMappedSpanTx(db, mapping, span, refKey, now, salt, admission)` 签名不变。`magpieTurnRequestTx` 删除（无外部调用方残留）。

- [ ] **Step 1: 写双方向去重回归测试（先失败）**

追加到 `tests/otlp-ingest.test.ts`：

```typescript
test('OMP span 认领既有 magpie 行：用量指纹命中，一行两证据，用量不相加', () => {
  const store = fixture();
  try {
    store.write(db => {
      // 账本先到：同会话同 agent、四段用量与 OMP_CHAT 相等、started 在 ±2s 内。
      db.run(`
        INSERT INTO request(agent,session,conv_key,conv_source,actor,actor_state,
          started_ms,day,via,model_requested,model_served,in_tok,out_tok,cache_read,cache_write,
          body_state,derive_version,have,created_at,updated_at,cost_state,attempt_state,sort_source,sort_key)
        VALUES ('omp',?,?,'session',?,'known',?, '2026-10-26','through','synth-model-lite','synth-model-lite-served',
          8233,3,128,256,'available',0,7,?,?,'absent','known','ledger','ledger-synth-1')`,
        [SYNTH.session, JSON.stringify(['session', SYNTH.session]), SYNTH.session,
          1_792_945_426_098, NOW, NOW]);
      db.run(`INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,match_rule,added_at)
        VALUES (1,'ledger','ledger-synth-1','merged','response_id_norm.v1',?)`, [NOW]);
    }, 'test');
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'oh-my-pi' }, spans: [OMP_CHAT] }]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result.requestsCreated).toBe(0);
    expect((store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(1);
    const row = store.read.query('SELECT have, in_tok, out_tok FROM request').get() as { have: number; in_tok: number; out_tok: number };
    expect(row.have & 8).toBe(8);          // OTLP 位补上
    expect(row.in_tok).toBe(8233);          // 用量仍是账本值，不相加
    const kinds = store.read.query('SELECT source_kind FROM request_evidence ORDER BY source_kind').all() as { source_kind: string }[];
    expect(kinds.map(k => k.source_kind)).toEqual(['ledger', 'otlp_span']);
  } finally { store.close(); }
});
```

「OTLP 先到、magpie 后到」方向不在本 Task 新写用例：原生方言里只有 Codex 的 OTLP 行带 `turn_ref`，hook 迟到靠 `claimHookTarget` 的 turn 占位查询（`WHERE turn_ref=? AND via='otlp'`）认领，这条路径已由 `tests/hook-identity.test.ts` 的 Codex 迟到合并用例锁定。OMP/CC 的 OTLP 行无 turn_ref 也无 response_id_norm（原生规则不映射锚点），magpie 迟到无法认领——这是原生方言的既有边界，不是本批要修的缺口；全量 profile 行写 response_id_norm 后该方向才通，由 Task 4 Step 2 用例 3 的反向（账本迟到认领全量 OTLP 行，hook owner byResponseId 命中）覆盖。本 Step 跑 `bun test tests/hook-identity.test.ts` 确认 Codex 反向回归绿即可。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/otlp-ingest.test.ts`
Expected: 新用例 FAIL（现状 OMP 独立建行，requestsCreated=1）。

- [ ] **Step 3: persistMappedSpanTx 切核心**

`src/sources/otlp/ingest.ts`：删除 `TURN_DEDUPE_WINDOW_MS`（57-58）与 `magpieTurnRequestTx`（60-95）。新增：

```typescript
import { ingestRequestTx } from '../../ingest-core';
import type { ClaimOutcome, IngestChannel, IngestIdentity } from '../../ingest-core';
import { findRequestOwnerTx } from '../../owner';
import type { UsageFingerprint } from '../../owner';

const OTLP_CHANNEL: IngestChannel = {
  sourceKind: 'otlp_span', via: 'otlp', haveBit: HAVE_OTLP, sortSource: 'otlp_span',
  createdRule: MATCH_BY_SPAN_IDENTITY, createdMergeState: 'merged', emptyBodyState: 'summary',
};

/** 四段用量齐才成指纹；缺任一段不猜（owner 第 3 条线索的入场券）。 */
function fingerprintOf(mapping: SpanMapping): UsageFingerprint | null {
  if (mapping.inTok === null || mapping.outTok === null || mapping.cacheRead === null || mapping.cacheWrite === null) return null;
  return { input: mapping.inTok, output: mapping.outTok, cacheRead: mapping.cacheRead, cacheWrite: mapping.cacheWrite };
}

/** OTLP 认领：只走统一 owner（response id 在 Task 4 接入；原生方言靠 turn/指纹/完成时间）。 */
function claimOtlpTarget(
  db: Database, mapping: SpanMapping, convKey: string | null, started: number, endMs: number | null,
): ClaimOutcome {
  const owner = findRequestOwnerTx(db, {
    responseIdNorm: null, turnRef: mapping.turnRef, convKey, agent: mapping.agent,
    startedMs: started, endMs, model: mapping.modelRequested, usage: fingerprintOf(mapping),
    excludeSourceKind: 'otlp_span',
  });
  return { target: owner.reqId, rule: owner.reqId !== null ? owner.rule : null, candidates: [] };
}
```

`persistMappedSpanTx` 体改为：

```typescript
export type PersistMappedSpanResult = { created: boolean; bodiesWired: number; duplicate: boolean };

export function persistMappedSpanTx(
  db: Database, mapping: SpanMapping, span: OtlpSpan, refKey: string,
  now: number, salt: Uint8Array, admission: HookAdmission,
): PersistMappedSpanResult {
  const conv = otlpConv(mapping.session);
  const started = nanoToMs(span.startNano);
  const endMs = span.endNano === null ? null : nanoToMs(span.endNano);
  const identity: IngestIdentity = {
    refKey, agent: mapping.agent, session: mapping.session, conv,
    responseIdNorm: null, turnRef: mapping.turnRef, model: mapping.modelRequested,
    startedMs: started, endMs, usage: fingerprintOf(mapping),
    actorState: conv === null ? 'unknown' : 'known',
    modelRequested: mapping.modelRequested, modelServed: mapping.modelServed, stop: mapping.stop,
    inTok: mapping.inTok, outTok: mapping.outTok, cacheRead: mapping.cacheRead, cacheWrite: mapping.cacheWrite,
    magpieVersion: null,
  };
  const result = ingestRequestTx(db, OTLP_CHANNEL, identity, null, null,
    db2 => claimOtlpTarget(db2, mapping, conv?.key ?? null, started, endMs), now, admission);
  if (result.duplicate) return { created: false, bodiesWired: 0, duplicate: true };
  // logs 可能先到：span 证据一落（新建或认领），回头接等待中的 body_ref 指针。
  let bodiesWired = 0;
  for (const pending of db.query<{ request_body_id: string }, [Uint8Array]>(
    "SELECT request_body_id FROM otlp_body_ref WHERE trace_id=? AND state='pending_span'",
  ).all(span.traceId)) {
    if (attemptBodyWireTx(db, pending.request_body_id, now, salt, admission)) bodiesWired += 1;
  }
  return { created: result.created, bodiesWired, duplicate: false };
}
```

`acceptOtlpTraces` 的计数不变（`requestsCreated += persisted.created ? 1 : 0`）。`HookAdmission` 改从 `../../ingest-core` import（hook re-export 仍可，但直接引核心更顺依赖方向）。

- [ ] **Step 4: replay 切统一 owner + 核心判重**

`src/maintenance/otlp-replay.ts`：import 去掉 `magpieTurnRequestTx`，加 `findRequestOwnerTx`、`otlpConv` 已有。`previewOtlpReplay` 的 llm 分支：

```typescript
if (verdict.kind === 'llm') {
  const mapping = mapSpan(verdict.rule, span);
  const conv = otlpConv(mapping.session);
  const refKey = spanRefKey(/* raw 行无 trace/span id 时用空占位 */ emptyId, emptyId);
  // 已有 otlp_span 证据：重放是判重，不新建（核心第一步同口径）。
  const ev = db.query<{ req_id: number }, [string]>(
    "SELECT req_id FROM request_evidence WHERE source_kind='otlp_span' AND ref_key=?").get(refKey);
  if (ev != null) { preview.evidence += 1; continue; }
  const owner = findRequestOwnerTx(db, {
    responseIdNorm: null, turnRef: mapping.turnRef, convKey: conv?.key ?? null, agent: mapping.agent,
    startedMs: row.start_ms, endMs: row.end_ms, model: mapping.modelRequested,
    usage: fingerprintOf(mapping), excludeSourceKind: 'otlp_span',
  });
  if (owner.reqId !== null) preview.evidence += 1; else preview.wouldCreate += 1;
}
```

注：preview 迭代 raw 行时 `spanOfRaw(row, emptyId, emptyId)` 的 trace/span 是空占位，refKey 需从 raw 行的真实 `trace_id`/`span_id` 取——把 SELECT 列表加上 `trace_id, span_id`，用 `spanRefKey(row.trace_id, row.span_id)`。`fingerprintOf` 从 ingest.ts export 供 replay 复用（或 replay 内联同逻辑；首选 export 一份）。

`replayOneTx` 的 llm 分支按 `duplicate` 分流：

```typescript
const persisted = persistMappedSpanTx(db, mapping, span, refKey, now, salt, NORMAL_ADMISSION);
if (persisted.duplicate) { /* 判重：不计 created/evidence，只升版本 */ }
else if (persisted.created) report.requestsCreated += 1;
else report.evidenceAdded += 1;
```

- [ ] **Step 5: 跑 OTLP 与 replay 套件**

Run: `bun test tests/otlp-ingest.test.ts tests/otlp-replay.test.ts tests/otlp-logs.test.ts`
Expected: 全绿。`tests/otlp-ingest.test.ts:93` 的 `response_id_norm` null 断言仍成立（原生 OMP 规则不映射锚点，本 Task 不动 mapping）。

- [ ] **Step 6: typecheck + 提交**

```bash
bun run typecheck
git add src/sources/otlp/ingest.ts src/maintenance/otlp-replay.ts tests/otlp-ingest.test.ts tests/otlp-replay.test.ts
ATC_NOTE_EXEMPT="otlp-full-profile 批次 note 随 Task 5 转 implemented 落地" bun run verify:notes:staged
git commit -m "feat(otlp): route span ingest through shared core and unified owner claim

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

正文补 `Agent-Note: none — otlp-full-profile batch note lands at Task 5`。

---

## Task 3: semconv 协议适配器（并行支线，独立 worktree）

**Worktree:** `.codex-worktrees/atc-genai-semconv`，分支 `feat/genai-semconv-protocol`（从 master 建，与 spine 并行；Task 4 前合并进 spine）。

**Files:**
- Modify: `src/protocol-shape.ts:13-19,207-212,269-274`、`src/capabilities.ts:49`、`src/input-interpretation.ts:178-195`
- Test: `tests/protocol-shape.test.ts`、`tests/input-interpretation.test.ts`

**Interfaces:**
- Consumes: `WireCall = { id; name; ord; path; input }`、`WireResult = { id; ord; path; value; isError: boolean|null }`、`isRecord`、`textOf`、`MessagesKey`。
- Produces: 协议名 `'genai-semconv'` 进 `CAPABLE_PROTOCOLS`/`MESSAGES_KEY`/`wireCallsOf`/`wireResultsIn`；`textBlocks` 识别 `parts[].content`。存储信封形状：`request = { messages: GenAiMessage[] }`、`reply = { id?: string, messages: GenAiMessage[] }`；`GenAiMessage = { role: string, parts: GenAiPart[] }`；`GenAiPart` 三型：`{ type:'text', content:string }`、`{ type:'tool_call', id:string, name:string, arguments:unknown }`、`{ type:'tool_call_response', id:string, response:unknown }`。

- [ ] **Step 1: 建 worktree（同 Task 1 Step 1 的软链与 exclude）**

```bash
cd /Users/pis/workspace_intelligence/creator-intelligence/repos
git -C agent-trace-collector worktree add .codex-worktrees/atc-genai-semconv -b feat/genai-semconv-protocol master
cd .codex-worktrees/atc-genai-semconv
ln -s ../../agent-trace-collector/node_modules node_modules
printf 'node_modules\n' >> .git/info/exclude
```

- [ ] **Step 2: 写工具配对与文本识别测试（先失败）**

追加到 `tests/protocol-shape.test.ts`：

```typescript
import { wireCallsOf, wireResultsIn, messageCountOf } from '../src/protocol-shape';

const SEMCONV_REPLY = { messages: [
  { role: 'assistant', parts: [
    { type: 'text', content: 'checking' },
    { type: 'tool_call', id: 'call_synth_1', name: 'get_weather', arguments: { city: 'Synthville' } },
    { type: 'tool_call', id: 'call_synth_2', name: 'get_time', arguments: {} },
  ] },
] };
const SEMCONV_ITEMS = [
  { role: 'user', parts: [{ type: 'text', content: 'weather?' }] },
  { role: 'tool', parts: [{ type: 'tool_call_response', id: 'call_synth_1', response: 'sunny' }] },
];

test('genai-semconv 工具调用：跨消息 flat ord 唯一，path 精确定位', () => {
  const calls = wireCallsOf('genai-semconv', SEMCONV_REPLY);
  expect(calls.map(c => c.id)).toEqual(['call_synth_1', 'call_synth_2']);
  expect(calls.map(c => c.ord)).toEqual([0, 1]);
  expect(calls[0]!.path).toBe('reply.messages[0].parts[1]');
  expect(calls[0]!.input).toEqual({ city: 'Synthville' });
});

test('genai-semconv 工具结果：按 message ord 定位，无失败通道', () => {
  const results = wireResultsIn('genai-semconv', SEMCONV_ITEMS);
  expect(results).toEqual([{ id: 'call_synth_1', ord: 1, path: 'request.messages[1].parts[0]', value: 'sunny', isError: null }]);
});

test('genai-semconv 消息计数', () => {
  expect(messageCountOf('genai-semconv', { messages: SEMCONV_ITEMS })).toBe(2);
});
```

追加到 `tests/input-interpretation.test.ts`：

```typescript
import { messageText } from '../src/input-interpretation';

test('semconv parts 文本识别：text part 的 content 拼接', () => {
  expect(messageText({ role: 'user', parts: [
    { type: 'text', content: 'hello' },
    { type: 'tool_call', id: 'x', name: 'n', arguments: {} },
    { type: 'text', content: 'world' },
  ] })).toBe('hello\nworld');
});

test('content 形状优先：既有 anthropic 消息不受 parts 分支影响', () => {
  expect(messageText({ role: 'user', content: [{ type: 'text', text: 'hi' }] })).toBe('hi');
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `bun test tests/protocol-shape.test.ts tests/input-interpretation.test.ts`
Expected: 新用例 FAIL（semconv 返回空表 / messageText null）。

- [ ] **Step 4: protocol-shape 加 semconv 查表**

`MESSAGES_KEY` 加 `'genai-semconv': 'messages'`。新增两个提取函数并接进 dispatch：

```typescript
/** semconv 回复侧工具调用：parts 里的 tool_call。ord 跨消息 flat 计数，
 * 保证 (req_id, ord) 唯一（一条消息可含多个并行 tool_call）；path 仍精确定位。 */
function semconvCalls(reply: unknown): WireCall[] {
  if (!isRecord(reply) || !Array.isArray(reply.messages)) return [];
  const calls: WireCall[] = [];
  for (const [m, message] of reply.messages.entries()) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    for (const [p, part] of message.parts.entries()) {
      if (!isRecord(part) || part.type !== 'tool_call') continue;
      const id = textOf(part.id);
      if (id === null) continue;
      calls.push({ id, name: textOf(part.name) ?? '', ord: calls.length,
        path: `reply.messages[${m}].parts[${p}]`, input: part.arguments ?? null });
    }
  }
  return calls;
}

/** semconv 请求侧工具结果：parts 里的 tool_call_response。当前形状无独立失败位。 */
function semconvResults(items: readonly unknown[]): WireResult[] {
  const results: WireResult[] = [];
  for (const [ord, message] of items.entries()) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    for (const [p, part] of message.parts.entries()) {
      if (!isRecord(part) || part.type !== 'tool_call_response') continue;
      const id = textOf(part.id);
      if (id === null) continue;
      results.push({ id, ord, path: `request.messages[${ord}].parts[${p}]`, value: part.response ?? null, isError: null });
    }
  }
  return results;
}
```

`wireCallsOf` 加 `if (protocol === 'genai-semconv') return semconvCalls(reply);`；`wireResultsIn` 加 `if (protocol === 'genai-semconv') return semconvResults(items);`。`roleNameOfItem` 已按显式 `role` 取值，semconv 消息带 role，无需改。

- [ ] **Step 5: capabilities 与文本识别**

`src/capabilities.ts:49`：

```typescript
export const CAPABLE_PROTOCOLS = ['anthropic', 'chat', 'responses', 'droid-session', 'genai-semconv'] as const;
```

`src/input-interpretation.ts` 的 `textBlocks`：content 既非字符串也非数组时落 parts 分支（content 形状优先，既有协议零变化）：

```typescript
function textBlocks(message: unknown): string[] {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return [];
  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') return content.length > 0 ? [content] : [];
  if (!Array.isArray(content)) {
    // semconv 消息把文本放在 parts[].content；content 缺席时才认 parts，
    // 既有 anthropic/chat/responses 形状不受影响。
    const parts = (message as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) return [];
    const out: string[] = [];
    for (const part of parts) {
      if (part !== null && typeof part === 'object' && !Array.isArray(part)) {
        const record = part as Record<string, unknown>;
        if (record.type === 'text' && typeof record.content === 'string' && record.content.length > 0) out.push(record.content);
      }
    }
    return out;
  }
  const out: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
    const record = block as Record<string, unknown>;
    if (isTextBlockType(record.type) && typeof record.text === 'string' && record.text.length > 0) out.push(record.text);
  }
  return out;
}
```

- [ ] **Step 6: 跑适配器套件 + 协议回归**

Run: `bun test tests/protocol-shape.test.ts tests/input-interpretation.test.ts tests/protocols.test.ts tests/capabilities.test.ts tests/body.test.ts`
Expected: 全绿（新增协议不改既有协议解析；`ADAPTER_VERSION` 不升）。

- [ ] **Step 7: typecheck + 提交**

```bash
bun run typecheck
git add src/protocol-shape.ts src/capabilities.ts src/input-interpretation.ts tests/protocol-shape.test.ts tests/input-interpretation.test.ts
ATC_NOTE_EXEMPT="otlp-full-profile 批次 note 随 Task 5 转 implemented 落地" bun run verify:notes:staged
git commit -m "feat(protocol): add genai-semconv message shape adapter

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

正文补 `Agent-Note: none — otlp-full-profile batch note lands at Task 5`。

---

## Task 4: 全量 profile 规则 + 正文接线 + 升版（spine，依赖 Task 2 与 Task 3 合并）

**前置:** 把 `feat/genai-semconv-protocol` 以 `--no-ff` 合并进 spine 分支，移除 Task 3 worktree 目录、保留分支名。

**Files:**
- Modify: `src/sources/otlp/mapping.ts:18,21-31,55-117,162-193`、`src/sources/otlp/ingest.ts`（persistMappedSpanTx 接正文与 responseId）
- Create: `scripts/otlp-full-profile-export.ts`
- Test: `tests/otlp-ingest.test.ts`、`tests/otlp-replay.test.ts`

**Interfaces:**
- Consumes: `ingestRequestTx`（Task 1）、`normalizeResponseId(id: string|null): string|null`（`src/sources/magpie/mapping.ts`，纯函数，无环）、`redact`、协议名 `'genai-semconv'`（Task 3）。
- Produces:
  - `AttrKeys` 加 `responseId: readonly string[]; inputMessages: readonly string[]; outputMessages: readonly string[]`。
  - `SpanMapping` 加 `responseId: string|null; inputMessages: string|null; outputMessages: string|null`。
  - `fullProfileRule(service: string, agent: string): SpanRule`（ruleId `'gen_ai_full_profile'`，matches `gen_ai.operation.name==='chat'`）。
  - `OTLP_MAPPING_VERSION = 5`。
  - `SPAN_RULES` 追加 `fullProfileRule('tracery-reference', 'reference')`；三条原生规则各加 `responseId: [], inputMessages: [], outputMessages: []`（行为不变）。

- [ ] **Step 1: 合并 Task 3 进 spine**

```bash
cd /Users/pis/workspace_intelligence/creator-intelligence/repos/.codex-worktrees/atc-otlp-full-profile
git merge --no-ff feat/genai-semconv-protocol -m "merge: genai-semconv protocol adapter into full-profile spine

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git -C /Users/pis/workspace_intelligence/creator-intelligence/repos/agent-trace-collector worktree remove ../../.codex-worktrees/atc-genai-semconv
bun test tests/protocol-shape.test.ts tests/otlp-ingest.test.ts
```

- [ ] **Step 2: 写全量 profile 建行与降级测试（先失败）**

追加到 `tests/otlp-ingest.test.ts`（合成 full-profile span，service `tracery-reference`）：

```typescript
const FULL_MESSAGES_IN = JSON.stringify([
  { role: 'user', parts: [{ type: 'text', content: 'synth question' }] },
]);
const FULL_MESSAGES_OUT = JSON.stringify([
  { role: 'assistant', parts: [
    { type: 'text', content: 'synth answer' },
    { type: 'tool_call', id: 'call_synth_full', name: 'synth_tool', arguments: { q: 1 } },
  ] },
]);
const FULL_SPAN = {
  traceId: SYNTH.traceA, spanId: SYNTH.spanLLM, name: 'chat synth-model-lite', kind: 3,
  startNano: SYNTH.msToNano(1_792_945_426_098), endNano: SYNTH.msToNano(1_792_945_428_830),
  attrs: {
    'gen_ai.operation.name': 'chat',
    'gen_ai.conversation.id': SYNTH.session,
    'gen_ai.request.model': 'synth-model-lite',
    'gen_ai.response.model': 'synth-model-lite-served',
    'gen_ai.response.id': SYNTH.responseId,
    'gen_ai.response.finish_reasons': { arr: ['stop'] },
    'gen_ai.usage.input_tokens': { int: 100 }, 'gen_ai.usage.output_tokens': { int: 20 },
    'gen_ai.usage.cache_read.input_tokens': { int: 0 }, 'gen_ai.usage.cache_creation.input_tokens': { int: 0 },
    'gen_ai.input.messages': FULL_MESSAGES_IN,
    'gen_ai.output.messages': FULL_MESSAGES_OUT,
  },
};

test('全量 profile span 建行：正文 available、response_id_norm 落列、semconv 解析', () => {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'tracery-reference' }, spans: [FULL_SPAN] }]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result.requestsCreated).toBe(1);
    const row = store.read.query(`SELECT body_state, response_id_norm, via, have, cost_state, parse_state
      FROM request`).get() as Record<string, unknown>;
    expect(row.body_state).toBe('available');
    expect(row.response_id_norm).toBe('synth-0001abcdef0123456789'); // normalizeResponseId 去 chatcmpl- 前缀
    expect(row.via).toBe('otlp');
    expect(row.have & 8).toBe(8);
    expect(row.cost_state).toBe('absent');
    expect(row.parse_state).toBe('ok');
    const blocks = store.read.query('SELECT COUNT(*) AS n FROM request_block').get() as { n: number };
    expect(blocks.n).toBeGreaterThan(0);
  } finally { store.close(); }
});

test('全量 profile 正文 JSON 解析失败：降级 summary 加 issue，不标 available', () => {
  const store = fixture();
  try {
    const bad = { ...FULL_SPAN, attrs: { ...FULL_SPAN.attrs, 'gen_ai.input.messages': '{"truncated":' } };
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'tracery-reference' }, spans: [bad] }]), 'protobuf');
    acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    const row = store.read.query('SELECT body_state FROM request').get() as { body_state: string };
    expect(row.body_state).toBe('summary');
    const issue = store.read.query("SELECT reason FROM ingest_issue WHERE source_kind='otlp_span'").all() as { reason: string }[];
    expect(issue.some(i => i.reason === 'body_parse_failed')).toBe(true);
  } finally { store.close(); }
});

test('全量 span 按 response_id 认领账本行：双方向都只一行', () => {
  const store = fixture();
  try {
    store.write(db => {
      db.run(`INSERT INTO request(response_id_norm,agent,session,conv_key,conv_source,actor,actor_state,
        started_ms,day,via,body_state,derive_version,have,created_at,updated_at,cost_state,attempt_state,sort_source,sort_key)
        VALUES (?,'reference',?,?,'session',?,'known',?, '2026-10-26','through','available',0,7,?,?,'absent','known','ledger','ledger-full-1')`,
        ['synth-0001abcdef0123456789', SYNTH.session, JSON.stringify(['session', SYNTH.session]), SYNTH.session,
          1_792_945_426_098, NOW, NOW]);
      db.run(`INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,match_rule,added_at)
        VALUES (1,'ledger','ledger-full-1','merged','response_id_norm.v1',?)`, [NOW]);
    }, 'test');
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'tracery-reference' }, spans: [FULL_SPAN] }]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result.requestsCreated).toBe(0);
    expect((store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(1);
    const ev = store.read.query('SELECT source_kind FROM request_evidence ORDER BY source_kind').all() as { source_kind: string }[];
    expect(ev.map(e => e.source_kind)).toEqual(['ledger', 'otlp_span']);
  } finally { store.close(); }
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `bun test tests/otlp-ingest.test.ts`
Expected: 新用例 FAIL（`tracery-reference` 未登记 → unknownServices）。

- [ ] **Step 4: mapping 升版 + 全量规则**

`src/sources/otlp/mapping.ts`：`OTLP_MAPPING_VERSION = 5`。`AttrKeys` 加三键；三条原生规则各加 `responseId: [], inputMessages: [], outputMessages: []`。`SpanMapping` 加三字段；`mapSpan` 加 `responseId: firstString(span.attrs, keys.responseId)`、`inputMessages: firstString(span.attrs, keys.inputMessages)`、`outputMessages: firstString(span.attrs, keys.outputMessages)`。新增工厂与登记：

```typescript
/** 全量 profile 集成方：一个稳定 service.name + 一行规则即接入。
 * 键集走 semconv 现有键，不发明私有键；正文键完整导出是发送端契约。 */
export function fullProfileRule(service: string, agent: string): SpanRule {
  return {
    service, agent, ruleId: 'gen_ai_full_profile',
    matches: span => span.attrs['gen_ai.operation.name'] === 'chat',
    keys: {
      session: ['gen_ai.conversation.id'], turn: [],
      responseId: ['gen_ai.response.id'],
      modelRequested: ['gen_ai.request.model'], modelServed: ['gen_ai.response.model'],
      stop: ['gen_ai.response.finish_reasons'],
      inTok: ['gen_ai.usage.input_tokens'], outTok: ['gen_ai.usage.output_tokens'],
      cacheRead: ['gen_ai.usage.cache_read.input_tokens'], cacheWrite: ['gen_ai.usage.cache_creation.input_tokens'],
      inputMessages: ['gen_ai.input.messages'], outputMessages: ['gen_ai.output.messages'],
    },
  };
}
```

`SPAN_RULES` 数组末尾追加 `fullProfileRule('tracery-reference', 'reference'),`。

- [ ] **Step 5: ingest 接正文与 responseId**

`src/sources/otlp/ingest.ts` 加 `import { normalizeResponseId } from '../magpie/mapping';`。新增正文构造（解析失败降级 + issue）：

```typescript
/** 全量正文：input/output.messages 解析成 semconv 信封；任一键解析失败或
 * messages 非数组，整段降级 summary 并记 issue，不冒充 available。
 * 原生方言 inputMessages/outputMessages 为 null，直接返回 null（零开销）。 */
function fullProfileBodyTx(
  db: Database, mapping: SpanMapping, refKey: string, salt: Uint8Array, now: number,
): BodyInput | null {
  if (mapping.inputMessages === null && mapping.outputMessages === null) return null;
  const degrade = (): null => {
    db.run('INSERT OR IGNORE INTO ingest_issue(source_kind,ref_key,reason,observed_at,byte_length) VALUES (?,?,?,?,NULL)',
      ['otlp_span', refKey, 'body_parse_failed', now]);
    return null;
  };
  let input: unknown; let output: unknown;
  try {
    input = mapping.inputMessages === null ? null : JSON.parse(mapping.inputMessages);
    output = mapping.outputMessages === null ? null : JSON.parse(mapping.outputMessages);
  } catch { return degrade(); }
  if (input !== null && !Array.isArray(input)) return degrade();
  if (output !== null && !Array.isArray(output)) return degrade();
  const request = input === null ? null : { messages: input };
  const reply = output === null ? null : { ...(mapping.responseId !== null ? { id: mapping.responseId } : {}), messages: output };
  return {
    protocol: 'genai-semconv',
    request: request === null ? null : redact(request, salt),
    reply: reply === null ? null : redact(reply, salt),
    redact_version: 1,
  };
}
```

`persistMappedSpanTx`：`identity.responseIdNorm` 改 `normalizeResponseId(mapping.responseId)`；`claimOtlpTarget` 的 `responseIdNorm` 同改（签名加 `responseIdNorm: string | null` 参数，或在回调内重算）；核心调用的 body 参数改 `fullProfileBodyTx(db, mapping, refKey, salt, now)`：

```typescript
const responseIdNorm = normalizeResponseId(mapping.responseId);
const body = fullProfileBodyTx(db, mapping, refKey, salt, now);
const identity: IngestIdentity = { /* ... */ responseIdNorm, /* ... */ };
const result = ingestRequestTx(db, OTLP_CHANNEL, identity, body, null,
  db2 => claimOtlpTarget(db2, mapping, conv?.key ?? null, started, endMs, responseIdNorm), now, admission);
```

`claimOtlpTarget` 把 `responseIdNorm: null` 改为传入的 `responseIdNorm`。

- [ ] **Step 6: 参考导出脚本**

`scripts/otlp-full-profile-export.ts`（自包含 OTLP/HTTP JSON 导出，验收载体；不引测试夹具）：

```typescript
/**
 * 全量 profile 参考导出：向本机 Tracery 发一段合成会话的 OTLP/HTTP JSON traces。
 * 用法：bun scripts/otlp-full-profile-export.ts --endpoint http://127.0.0.1:8320 --token <otlp.token>
 * 只产合成数据；service.name=tracery-reference 已在 SPAN_RULES 登记。
 */
const args = process.argv.slice(2);
function arg(name: string): string {
  const i = args.indexOf(name);
  if (i === -1 || args[i + 1] === undefined) throw new Error(`missing ${name}`);
  return args[i + 1]!;
}
const endpoint = arg('--endpoint');
const token = arg('--token');
const session = `ref-${Date.now()}`;
const now = Date.now();
const traceId = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
function spanId(): string { return [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const inputMessages = JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'synthetic reference question' }] }]);
const outputMessages = JSON.stringify([{ role: 'assistant', parts: [
  { type: 'text', content: 'synthetic reference answer' },
  { type: 'tool_call', id: 'call_ref_1', name: 'reference_tool', arguments: { q: 'synth' } },
] }]);
function kv(key: string, value: string | number): unknown {
  return typeof value === 'number' ? { key, value: { intValue: String(value) } } : { key, value: { stringValue: value } };
}
const payload = { resourceSpans: [{
  resource: { attributes: [kv('service.name', 'tracery-reference')] },
  scopeSpans: [{ scope: { name: 'tracery-reference-export' }, spans: [{
    traceId, spanId: spanId(), name: 'chat reference-model', kind: 3,
    startTimeUnixNano: String(now * 1_000_000), endTimeUnixNano: String((now + 1500) * 1_000_000),
    status: { code: 1 },
    attributes: [
      kv('gen_ai.operation.name', 'chat'), kv('gen_ai.conversation.id', session),
      kv('gen_ai.request.model', 'reference-model'), kv('gen_ai.response.model', 'reference-model'),
      kv('gen_ai.response.id', `chatcmpl-ref-${session}`),
      kv('gen_ai.usage.input_tokens', 100), kv('gen_ai.usage.output_tokens', 20),
      kv('gen_ai.usage.cache_read.input_tokens', 0), kv('gen_ai.usage.cache_creation.input_tokens', 0),
      kv('gen_ai.input.messages', inputMessages), kv('gen_ai.output.messages', outputMessages),
    ],
  }] }],
] };
const res = await fetch(`${endpoint}/v1/traces`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
```

执行者核对 `/v1/traces` 的 JSON 解码路径与认证头格式（`src/http.ts` 的 OTLP 路由），确保 `application/json` 与 Bearer 与接收端一致；`intValue` 字符串形态按 decode.ts 的 JSON 分支核对。

- [ ] **Step 7: 跑 OTLP 全套 + replay 升版回归**

Run: `bun test tests/otlp-ingest.test.ts tests/otlp-replay.test.ts tests/otlp-logs.test.ts tests/protocol-shape.test.ts`
Expected: 全绿。replay 测试的 `OTLP_MAPPING_VERSION` 断言按常量自动跟随 5；`tests/otlp-ingest.test.ts:93` 原生 OMP null 断言仍成立，把其注释「第一批不写锚点列：跨通道去重是 Deferred」改为「原生方言不映射锚点；全量 profile 才写 response_id_norm」。

- [ ] **Step 8: typecheck + 提交**

```bash
bun run typecheck
git add src/sources/otlp/mapping.ts src/sources/otlp/ingest.ts scripts/otlp-full-profile-export.ts tests/otlp-ingest.test.ts tests/otlp-replay.test.ts
ATC_NOTE_EXEMPT="otlp-full-profile 批次 note 随 Task 5 转 implemented 落地" bun run verify:notes:staged
git commit -m "feat(otlp): full-profile rule, semconv body wiring, mapping version 5

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

正文补 `Agent-Note: none — otlp-full-profile batch note lands at Task 5`。

---

## Task 5: 文档同步 + note 转 implemented + 合成验收 + 合并 master（spine）

**Files:**
- Modify: `docs/otlp-exporter-profile.md`、`docs/architecture-design.md`、`.agents/notes/proposed/feature/2026-11-04-multi-source-call-identity.md`（补 §7 交付记录）、`.agents/notes/implemented/feature/2026-10-25-otlp-receiver.md` 与 `2026-10-26-otlp-exporter-profile-and-codex.md`（事实层互链）
- Move: `.agents/notes/proposed/feature/2026-11-09-otlp-full-profile-shared-ingest.md` → `.agents/notes/implemented/feature/`
- Modify: `.agents/notes/LESSONS.md`（回写本次坑）

**Interfaces:**
- Consumes: 前四个 Task 的代码与测试结果。
- Produces: 可合并的 master 批次（range 内含 note 变更，过 `verify:notes`）。

- [ ] **Step 1: profile 文档加全量级章节**

`docs/otlp-exporter-profile.md` 加「全量级」章节，写明：端点/认证/错误码不变；键集在摘要级基础上加 `gen_ai.response.id`，`gen_ai.input/output.messages` 升为完整正文；完整性契约（正文键要么完整要么缺席，发送端关 `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT`，接收端只验可解析性，解析失败降级 summary + issue）；span status = harness 视角成败、不合成 HTTP 200；费用不进契约、无 magpie 行 `cost_state='absent'`；登记一个稳定 service.name + 一行 `fullProfileRule` 即接入；semconv 消息 role/parts 形状与三型 part；`OTLP_MAPPING_VERSION=5` 的版本承诺。原生方言层章节标注零改动。

- [ ] **Step 2: 架构设计更新编排分工**

`docs/architecture-design.md` 摄入层：加 `ingest-core` 为 hook/OTLP 共享编排核心，认领策略前端回调；OTLP 全量行经核心写 response_id_norm、统一 owner、正文 available；投影字段来源不扩到 OTLP（全量行模型/用量建行时写入）。

- [ ] **Step 3: note 转 implemented + 互链**

把 note 移到 `implemented/feature/`，`Status: implemented`，补交付记录：核心抽取、OTLP 统一 owner（删 magpieTurnRequestTx）、semconv 适配器、全量规则与升版 5、合成验收结果。在 multi-source-call-identity note §7 补「由 2026-11-09-otlp-full-profile-shared-ingest 交付」；在 receiver note 与两步走 note 补部分取代互链与事实层更新（正文权威来源约束在全量级解除）。

- [ ] **Step 4: LESSONS 回写**

追加本次踩到的坑（如：核心判重必须先于认领，否则跨版本重放对无 turn 的 OMP/CC span 会重复建行；semconv 工具调用 ord 必须跨消息 flat 计数否则撞 (req_id,ord) 主键）。稳定成测试的迁回家并删条。

- [ ] **Step 5: 全量套件 + verify:notes**

```bash
bun test
bun run typecheck
bun run verify:notes
```

Expected: 全绿；`verify:notes` 的 range 模式因 note 转 implemented 在批次内而通过。

- [ ] **Step 6: 合并 master + 清理 worktree**

```bash
cd /Users/pis/workspace_intelligence/creator-intelligence/repos/agent-trace-collector
git merge --no-ff feat/otlp-full-profile-shared-ingest -m "merge: OTLP full-profile shared ingest core and semconv adapter

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git worktree remove ../.codex-worktrees/atc-otlp-full-profile
bun run verify:notes
```

保留分支名 `feat/otlp-full-profile-shared-ingest` 与 `feat/genai-semconv-protocol`。

---

## Task 6: 生产部署 + 真实流量验收（主检出，需显式授权）

**前置:** 用户授权部署。生产由 launchd 托管，schema 无变更（本批不动 schema），无需 backfill；`OTLP_MAPPING_VERSION` 升 5 后由维护任务按既有 replay 路径处理旧 raw span。

**Files:**
- Modify: `docs/acceptance.md`（真实流量验收记录，合成与真实分开写）

- [ ] **Step 1: 部署**

```bash
bun run service restart
bun run service status
```

- [ ] **Step 2: 真实流量验收**

按 note 验收口径：reference 导出脚本跑一轮（`bun scripts/otlp-full-profile-export.ts --endpoint http://127.0.0.1:8320 --token <从配置读>`），Claude Code 原生导出跑一轮会话；只读核对建行、正文 available、response_id_norm 落列、双通道去重（一行两证据）、原生方言零回归。存量双行合并（`maintain dedupe-sessions`）范围另行授权，不在本步默认执行。

- [ ] **Step 3: 记录验收**

`docs/acceptance.md` 记真实流量结果，与合成验收分开；未覆盖项与残余风险（完整性接收端不可核验、body 预算压力）如实写。

- [ ] **Step 4: 提交验收记录**

```bash
git add docs/acceptance.md
git commit -m "docs(acceptance): record OTLP full-profile real-traffic verification

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** note 两部分（全量 profile / 共享核心）→ Task 1-2 核心、Task 3 适配器、Task 4 全量规则与正文。验收 7 条：(1) hook 行为锁定 Task 1 Step 6；(2) 全量建行 Task 4 Step 2 用例 1；(3) 双方向去重——账本先到 OTLP 后到 Task 2 Step 1（指纹）+ Task 4 Step 2 用例 3（response_id），OTLP 先到 magpie 后到由既有 Codex turn 认领回归（Task 2 Step 1 跑 hook-identity）与全量行 response_id 反向覆盖；(4) 解析降级 Task 4 Step 2 用例 2；(5) 重发幂等 + replay Task 2 Step 4+5、Task 4 Step 7；(6) 原生回归 Task 2 Step 5、Task 4 Step 7（null 断言保留）；(7) 无 magpie 独立建行 Task 4 Step 2 用例 1（cost_state='absent'）。真实流量单独一轮 Task 6。supersession 互链 Task 5 Step 3。span status 解释边界在「范围与解释边界」明示。

**Placeholder scan:** Task 1 Step 5 的 raw_hook INSERT 用「原参数列表逐字保留」指向 src/hook.ts:317-333 的确定代码（搬运而非新写）。Task 2 的反向去重不新写用例，明确指向既有 hook-identity Codex 回归并说明原生 OMP/CC 的既有边界。其余步骤均含完整代码，无 TBD/TODO。

**Type consistency:** `IngestChannel`/`IngestIdentity`/`ClaimOutcome`/`IngestResult` 在 Task 1 定义，Task 2/4 逐字消费；`PersistMappedSpanResult` Task 2 加 `duplicate`，Task 4 沿用；`SpanMapping` 三新字段 Task 4 定义并消费；`fullProfileBodyTx` 返回 `BodyInput|null` 与核心 body 参数一致；`fingerprintOf` Task 2 定义并 export 供 replay 复用。协议名 `'genai-semconv'` Task 3 定义，Task 4 正文信封与测试一致。