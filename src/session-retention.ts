/**
 * 整会话保留删除：候选、守卫、单事务级联与会话墓碑。
 *
 * 删除单位是 `request.conv_key` 对应的完整会话。会话年龄取该会话所有请求的
 * `MAX(started_ms)`；事务内重新校验年龄与守卫，避免候选选出后又有新请求落库。
 * 逐证据墓碑留给 `purge-metadata` / `purge-agent`，这里只写一条会话墓碑。
 */

import type { Database } from 'bun:sqlite';
import { RETENTION_DAY_MS } from './format';
import { purgeTargetsTx } from './purge-core';
import type { PublishResult } from './purge-core';
import { openSourceGapSql } from './session-retention-guards';
import { sessionRetentionCandidates } from './session-retention-candidates';
import { droidSessionAdapter } from './sources/session/adapters/droid';
import { SESSION_ADAPTERS } from './sources/session/registry';
import type { SessionAdapter } from './sources/session/types';
import type { Store } from './store';

export { RETENTION_DAY_MS };
/** 95% 磁盘兜底至少保护最近 7 天。 */
export const DISK_FALLBACK_PROTECT_MS = 7 * RETENTION_DAY_MS;

export type SessionRetentionReason = 'retention' | 'manual' | 'disk_cap';
export type SessionPurgeSkip =
  | 'not_expired' | 'in_flight' | 'purpose_pending' | 'derive_dirty' | 'source_gap';

export type SessionCursorReset = { reset: number; skipped_shared: number };

export type SessionPurgeOptions = {
  cutoffMs: number;
  now?: number;
  reason: SessionRetentionReason;
  approvalId?: string | null;
  inFlight?: (convKey: string) => boolean;
};

export type SessionPurgeResult = PublishResult & {
  conv_key: string;
  skipped: SessionPurgeSkip | null;
  cursor_reset: SessionCursorReset;
  raw_session_deleted: number;
  raw_session_kept_shared: number;
  raw_session_unmapped: number;
};

type RawGroup = { sourceKind: string; sessionId: string; generation: string };
type RawCollection = { groups: RawGroup[]; unmapped: number };

/** 事务内重查守卫失败时用这个错误整体回滚，不给已删一半的会话留中间态。 */
class SessionSkip extends Error {
  constructor(readonly reason: SessionPurgeSkip) {
    super(reason);
  }
}

const ADAPTERS: readonly SessionAdapter[] = [...SESSION_ADAPTERS, droidSessionAdapter];

function adapterFor(agent: string, evidenceKind: string | null): SessionAdapter | null {
  if (evidenceKind !== null) {
    const exact = ADAPTERS.find(a => a.evidenceKind === evidenceKind && a.agent === agent);
    if (exact !== undefined) return exact;
  }
  return ADAPTERS.find(a => a.agent === agent) ?? null;
}

function emptyResult(convKey: string, skipped: SessionPurgeSkip | null): SessionPurgeResult {
  return {
    conv_key: convKey, deleted: 0, event_id: 0, skipped,
    cursor_reset: { reset: 0, skipped_shared: 0 },
    raw_session_deleted: 0, raw_session_kept_shared: 0, raw_session_unmapped: 0,
  };
}

/**
 * 整会话是否可以删。只读与事务内共用同一份判据；事务内再查一次是为了挡住
 * 候选选出后新落库的请求与新变脏的派生组。
 */
function sessionSkipReason(
  db: Database, convKey: string, options: SessionPurgeOptions,
): SessionPurgeSkip | null {
  // 在途请求只在常驻进程里有内存态；离线维护命令传空，等价于没有在途。
  if (options.inFlight?.(convKey) === true) return 'in_flight';
  const last = db.query<{ last_ms: number | null }, [string]>(
    'SELECT MAX(started_ms) AS last_ms FROM request WHERE conv_key=?',
  ).get(convKey);
  if (last?.last_ms == null || last.last_ms >= options.cutoffMs) return 'not_expired';
  const pending = db.query<{ hit: number }, [string]>(
    'SELECT 1 AS hit FROM request WHERE conv_key=? AND purpose_pending=1 LIMIT 1',
  ).get(convKey);
  if (pending !== null) return 'purpose_pending';
  const dirty = db.query<{ hit: number }, [string]>(
    "SELECT 1 AS hit FROM derive_queue WHERE conv_key=? AND state='dirty' LIMIT 1",
  ).get(convKey);
  if (dirty !== null) return 'derive_dirty';
  if (openSourceGap(db, convKey)) return 'source_gap';
  return null;
}

/**
 * 会话是否还挂着开放/可恢复的来源缺口。判据与预览共用
 * `session-retention-guards.ts`，避免两侧各写一份而漂移。
 */
function openSourceGap(db: Database, convKey: string): boolean {
  return db.query<{ hit: number }, [string, string, string]>(
    `SELECT 1 AS hit WHERE ${openSourceGapSql('r.conv_key=?')} LIMIT 1`,
  ).get(convKey, convKey, convKey) !== null;
}

function parseKinds(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** 会话墓碑先于删行写入；同一会话删除两次时合并时间范围、计数与来源类型。 */
function writePurgedConversationTx(
  db: Database, convKey: string, now: number, reason: SessionRetentionReason,
): void {
  const stats = db.query<{ first_ms: number | null; last_ms: number | null; n: number }, [string]>(`
    SELECT MIN(started_ms) AS first_ms, MAX(started_ms) AS last_ms, COUNT(*) AS n
    FROM request WHERE conv_key=?`).get(convKey);
  if (stats === null || stats.n === 0) return;
  const kinds = db.query<{ source_kind: string }, []>(`
    SELECT DISTINCT source_kind FROM request_evidence
    WHERE req_id IN (SELECT req_id FROM purge_requests)
    ORDER BY source_kind`).all().map(row => row.source_kind);
  const previous = db.query<{
    first_ms: number | null; last_ms: number | null; request_count: number; source_kinds: string;
  }, [string]>(
    'SELECT first_ms,last_ms,request_count,source_kinds FROM purged_conversation WHERE conv_key=?',
  ).get(convKey);
  const mergedKinds = [...new Set([...parseKinds(previous?.source_kinds), ...kinds])].sort();
  db.run(
    `INSERT INTO purged_conversation(conv_key,purged_at,first_ms,last_ms,request_count,reason,source_kinds)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(conv_key) DO UPDATE SET
       purged_at=excluded.purged_at, first_ms=excluded.first_ms, last_ms=excluded.last_ms,
       request_count=excluded.request_count, reason=excluded.reason, source_kinds=excluded.source_kinds`,
    [
      convKey, now,
      minNullable(previous?.first_ms ?? null, stats.first_ms),
      maxNullable(previous?.last_ms ?? null, stats.last_ms),
      (previous?.request_count ?? 0) + stats.n,
      reason, JSON.stringify(mergedKinds),
    ],
  );
}

/** 会话附属：标题、用量、后台作业、OTLP 正文引用。共享用量留给存活请求。 */
function deleteSessionAttachmentsTx(db: Database, convKey: string): void {
  db.run('DELETE FROM session_title WHERE conv_key=?', [convKey]);
  db.run(`DELETE FROM session_usage
          WHERE session IN (
            SELECT DISTINCT r.session FROM request r
            WHERE r.req_id IN (SELECT req_id FROM purge_requests) AND r.session IS NOT NULL)
            AND NOT EXISTS (
              SELECT 1 FROM request r2
              WHERE r2.session=session_usage.session
                AND r2.req_id NOT IN (SELECT req_id FROM purge_requests))`);
  db.run(`DELETE FROM bg_job
          WHERE conv_key=? OR spawn_req IN (SELECT req_id FROM purge_requests)
            OR notice_req IN (SELECT req_id FROM purge_requests)`, [convKey]);
  db.run('DELETE FROM otlp_body_ref WHERE req_id IN (SELECT req_id FROM purge_requests)');
}

/** 派生结果按会话与代际删，再按 req_id 兜一层；调用方会跳过受影响组重算。 */
function deleteDerivedTx(db: Database, convKey: string): void {
  const generations = db.query<{ generation: string }, [string]>(
    'SELECT generation FROM derive_generation WHERE conv_key=?',
  ).all(convKey).map(row => row.generation);
  for (const table of ['derive_request_result', 'derive_chain_work', 'derive_role_work',
    'derive_tool_result', 'derive_call_work', 'derive_result_work']) {
    db.run(`DELETE FROM ${table} WHERE req_id IN (SELECT req_id FROM purge_requests)`);
    for (const generation of generations) {
      db.run(`DELETE FROM ${table} WHERE generation=?`, [generation]);
    }
  }
  db.run('DELETE FROM derive_generation WHERE conv_key=?', [convKey]);
  db.run('DELETE FROM derive_queue WHERE conv_key=?', [convKey]);
}

/** 来源层证据：hook 与账本按证据键删，仍被存活证据引用时保留。 */
function deleteRawByEvidenceTx(db: Database): void {
  db.run(`DELETE FROM pending_hook WHERE hook_id IN (
            SELECT ref_key FROM request_evidence
            WHERE source_kind='hook' AND req_id IN (SELECT req_id FROM purge_requests))`);
  db.run(`DELETE FROM raw_hook WHERE hook_id IN (
            SELECT ref_key FROM request_evidence
            WHERE source_kind='hook' AND req_id IN (SELECT req_id FROM purge_requests))
          AND NOT EXISTS (
            SELECT 1 FROM request_evidence e
            WHERE e.source_kind='hook' AND e.ref_key=raw_hook.hook_id
              AND e.req_id NOT IN (SELECT req_id FROM purge_requests))`);
  db.run(`DELETE FROM raw_ledger WHERE EXISTS (
            SELECT 1 FROM request_evidence e
            WHERE e.source_kind='ledger'
              AND e.ref_key=json_array('file',raw_ledger.file_generation,raw_ledger.byte_offset)
              AND e.req_id IN (SELECT req_id FROM purge_requests))
          AND NOT EXISTS (
            SELECT 1 FROM request_evidence e
            WHERE e.source_kind='ledger'
              AND e.ref_key=json_array('file',raw_ledger.file_generation,raw_ledger.byte_offset)
              AND e.req_id NOT IN (SELECT req_id FROM purge_requests))`);
}

/**
 * 收集被删会话的原始会话组。只认能映射到已登记适配器的行；同一来源的
 * session/代际继续被存活请求使用时，整组保留，不在共享文件上挖洞。
 */
function collectRawGroups(db: Database, convKey: string): RawCollection {
  const rows = db.query<{
    agent: string; via: string; session: string | null; sort_key: string | null; evidence_kind: string | null;
  }, [string]>(`
    SELECT r.agent, r.via, r.session, r.sort_key, e.source_kind AS evidence_kind
    FROM request r
    LEFT JOIN request_evidence e ON e.req_id=r.req_id
    WHERE r.conv_key=? AND r.req_id IN (SELECT req_id FROM purge_requests)`,
  ).all(convKey);
  const groups = new Map<string, RawGroup>();
  let unmapped = 0;
  for (const row of rows) {
    if (row.session === null || row.sort_key === null || !row.sort_key.includes('|')) continue;
    const adapter = adapterFor(row.agent, row.evidence_kind);
    if (adapter === null) {
      if (row.via === 'session') unmapped += 1;
      continue;
    }
    // 纯 hook 行可能也有 session 与带竖线的 sort_key；只认会话来源或精确证据类型。
    if (row.via !== 'session' && row.evidence_kind !== adapter.evidenceKind) continue;
    const generation = row.sort_key.slice(0, row.sort_key.indexOf('|'));
    const key = `${adapter.sourceKind}\u0000${row.session}\u0000${generation}`;
    if (!groups.has(key)) {
      groups.set(key, { sourceKind: adapter.sourceKind, sessionId: row.session, generation });
    }
  }
  return { groups: [...groups.values()], unmapped };
}

/** 删除原始会话行：同 session 或同代际仍有存活请求时保留。 */
function deleteRawSessionTx(
  db: Database, groups: readonly RawGroup[],
  onDeleted: (n: number) => void, onKeptShared: (n: number) => void,
): void {
  for (const group of groups) {
    const sessionSurvivor = db.query<{ hit: number }, [string]>(`
      SELECT 1 AS hit FROM request
      WHERE session=? AND req_id NOT IN (SELECT req_id FROM purge_requests) LIMIT 1`,
    ).get(group.sessionId) !== null;
    const generationSurvivor = db.query<{ hit: number }, [string]>(`
      SELECT 1 AS hit FROM request
      WHERE sort_key IS NOT NULL AND instr(sort_key,'|')>0
        AND substr(sort_key,1,instr(sort_key,'|')-1)=?
        AND req_id NOT IN (SELECT req_id FROM purge_requests) LIMIT 1`,
    ).get(group.generation) !== null;
    const rawSurvivor = db.query<{ hit: number }, [string, string, string]>(`
      SELECT 1 AS hit FROM raw_session_event
      WHERE source_kind=? AND file_generation=? AND session_id IS NOT NULL AND session_id<>?
      LIMIT 1`).get(group.sourceKind, group.generation, group.sessionId) !== null;
    if (sessionSurvivor || generationSurvivor || rawSurvivor) {
      onKeptShared(1);
      continue;
    }
    const deleted = db.run(
      'DELETE FROM raw_session_event WHERE source_kind=? AND session_id=? AND file_generation=?',
      [group.sourceKind, group.sessionId, group.generation],
    ).changes;
    onDeleted(deleted);
  }
}

/**
 * 请求行删完后重置来源游标。只在代际与会话一一对应时执行；共享代际留原游标，
 * 靠会话墓碑跳过旧调用。清掉 fingerprint/head 基线，未变文件也会重新解析。
 */
function resetSessionCursorsTx(db: Database, groups: readonly RawGroup[]): SessionCursorReset {
  let reset = 0;
  let skippedShared = 0;
  for (const group of groups) {
    const cursors = db.query<{ source_name: string }, [string, string]>(`
      SELECT source_name FROM source_cursor
      WHERE source_kind=? AND file_generation=?`,
    ).all(group.sourceKind, group.generation);
    if (cursors.length === 0) continue;
    const surviving = db.query<{ n: number }, [string]>(`
      SELECT COUNT(*) AS n FROM request
      WHERE sort_key IS NOT NULL AND instr(sort_key,'|')>0
        AND substr(sort_key,1,instr(sort_key,'|')-1)=?`,
    ).get(group.generation)?.n ?? 0;
    const otherSessions = db.query<{ n: number }, [string, string, string]>(`
      SELECT COUNT(*) AS n FROM raw_session_event
      WHERE source_kind=? AND file_generation=? AND session_id IS NOT NULL AND session_id<>?`,
    ).get(group.sourceKind, group.generation, group.sessionId)?.n ?? 0;
    if (surviving > 0 || otherSessions > 0) {
      skippedShared += 1;
      continue;
    }
    for (const cursor of cursors) {
      db.run(`UPDATE source_cursor
              SET committed_off=0, observed_off=0, seen_size=0,
                  head_len=0, head_hash=NULL, fingerprint=NULL, last_ok_ms=?
              WHERE source_kind=? AND source_name=?`,
      [Date.now(), group.sourceKind, cursor.source_name]);
    }
    reset += 1;
  }
  return { reset, skipped_shared: skippedShared };
}

/**
 * 删除一条完整会话。返回 `skipped` 时说明事务内重查没通过，库没有变化。
 * 事务外先查一次是为了让调用方快速跳过；事务内再查一次才是可信判定。
 */
export function purgeSession(
  store: Store, convKey: string, options: SessionPurgeOptions,
): SessionPurgeResult {
  const now = options.now ?? Date.now();
  const pre = sessionSkipReason(store.read, convKey, options);
  if (pre !== null) return emptyResult(convKey, pre);

  const days = Math.max(1, Math.round((now - options.cutoffMs) / RETENTION_DAY_MS));
  const eventReason = options.reason === 'disk_cap' ? 'disk_cap' : `${options.reason}:${days}d`;
  let cursorReset: SessionCursorReset = { reset: 0, skipped_shared: 0 };
  let rawSessionDeleted = 0;
  let rawSessionKeptShared = 0;
  let rawSessionUnmapped = 0;
  let rawGroups: RawGroup[] = [];

  try {
    const result = purgeTargetsTx(
      store,
      {
        action: 'session_retention',
        reason: eventReason,
        approvalId: options.approvalId ?? null,
      },
      db => {
        db.run('INSERT INTO purge_requests(req_id) SELECT req_id FROM request WHERE conv_key=?', [convKey]);
        db.run(`INSERT INTO purge_routes(route_id)
                SELECT DISTINCT route_id FROM request
                WHERE conv_key=? AND route_id IS NOT NULL`, [convKey]);
      },
      db => {
        const skipped = sessionSkipReason(db, convKey, options);
        if (skipped !== null) throw new SessionSkip(skipped);
        const raw = collectRawGroups(db, convKey);
        rawSessionUnmapped = raw.unmapped;
        writePurgedConversationTx(db, convKey, now, options.reason);
        deleteSessionAttachmentsTx(db, convKey);
        deleteDerivedTx(db, convKey);
        deleteRawByEvidenceTx(db);
        deleteRawSessionTx(
          db, raw.groups,
          n => { rawSessionDeleted += n; },
          n => { rawSessionKeptShared += n; },
        );
        // 游标重置要等请求行删完，放在 afterDelete。
        rawGroups = raw.groups;
      },
      {
        tombstones: false,
        skipDeriveRepair: true,
        afterDelete: db => {
          db.run(`DELETE FROM raw_route WHERE route_id IN (SELECT route_id FROM purge_routes)
                    AND NOT EXISTS (SELECT 1 FROM raw_ledger l WHERE l.route_id=raw_route.route_id)
                    AND NOT EXISTS (SELECT 1 FROM request r WHERE r.route_id=raw_route.route_id)`);
          cursorReset = resetSessionCursorsTx(db, rawGroups);
        },
      },
    );
    return {
      ...result, conv_key: convKey, skipped: null, cursor_reset: cursorReset,
      raw_session_deleted: rawSessionDeleted,
      raw_session_kept_shared: rawSessionKeptShared,
      raw_session_unmapped: rawSessionUnmapped,
    };
  } catch (error) {
    if (error instanceof SessionSkip) return emptyResult(convKey, error.reason);
    throw error;
  }
}

/** 删除没有任何 request_block 引用的块。每个淘汰批次跑一次，而不是每个会话一次。 */
function sweepOrphanBlocks(store: Store): number {
  return Number(store.write(db => db.run(`DELETE FROM block WHERE NOT EXISTS (
    SELECT 1 FROM request_block rb WHERE rb.block=block.id)`).changes, 'block_sweep'));
}

/** 没有对应请求的会话标题与用量，按各自的观察时间用同一截止时间清理。 */
export function pruneOrphanSessionAttachments(
  store: Store, cutoffMs: number,
): { titles: number; usage: number } {
  return store.write(db => {
    const titles = db.run(`DELETE FROM session_title
      WHERE observed_ms < ?
        AND NOT EXISTS (SELECT 1 FROM request r WHERE r.conv_key=session_title.conv_key)`,
    [cutoffMs]).changes;
    const usage = db.run(`DELETE FROM session_usage
      WHERE observed_at < ?
        AND NOT EXISTS (SELECT 1 FROM request r WHERE r.session=session_usage.session)`,
    [cutoffMs]).changes;
    return { titles: Number(titles), usage: Number(usage) };
  }, 'session_retention_orphans');
}

/** 常驻 tick 的墙钟预算；没删完留给下一轮，不在一个同步段里清空历史。 */
export const RETENTION_TICK_WALL_MS = 2_000;
/** 一轮最多取多少过期会话；预览与删除共用同一候选上限。 */
export const RETENTION_CANDIDATE_LIMIT = 100_000;

export type SessionRetentionRunOptions = {
  cutoffMs: number;
  now?: number;
  reason: SessionRetentionReason;
  approvalId?: string | null;
  limit?: number;
  wallMs?: number;
  inFlight?: (convKey: string) => boolean;
};

export type SessionRetentionRun = {
  candidates: number;
  attempted: number;
  deleted_sessions: number;
  deleted_requests: number;
  skipped: Record<SessionPurgeSkip, number>;
  /** 过期但本轮没能删掉的会话数；`not_expired` 不计（新请求让它重新有效）。 */
  pending_skipped: number;
  /** 候选按最旧优先，第一个因守卫跳过的原因即最老跳过原因。 */
  oldest_skip_reason: SessionPurgeSkip | null;
  cursor_reset: SessionCursorReset;
  raw_session_deleted: number;
  raw_session_kept_shared: number;
  raw_session_unmapped: number;
  /** 单会话事务的最长耗时；大会话可能明显高于普通会话，先测再决定分块。 */
  purge_ms_max: number | null;
  /** 墙钟预算用完时提前停；下一轮从新的候选清单继续。 */
  timed_out: boolean;
  /** 候选取到了上限或提前停，可能还有未处理的过期会话。 */
  may_have_more: boolean;
};

/**
 * 按最旧会话逐个删除，直到候选跑完或墙钟预算用完。每个会话一个独立事务；
 * 会话之间让出事件循环，常驻进程的读取与写入不会被一轮淘汰长时间压住。
 * 跳过守卫命中的会话留在库里，下一轮重新判定，不在这里反复重试同一会话。
 */
export async function purgeExpiredSessions(
  store: Store, options: SessionRetentionRunOptions,
): Promise<SessionRetentionRun> {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? RETENTION_CANDIDATE_LIMIT;
  const wallMs = options.wallMs ?? RETENTION_TICK_WALL_MS;
  const candidates = sessionRetentionCandidates(store.read, options.cutoffMs, limit);
  const skipped: Record<SessionPurgeSkip, number> = {
    not_expired: 0, in_flight: 0, purpose_pending: 0, derive_dirty: 0, source_gap: 0,
  };
  const run: SessionRetentionRun = {
    candidates: candidates.length, attempted: 0, deleted_sessions: 0, deleted_requests: 0,
    skipped, pending_skipped: 0, oldest_skip_reason: null,
    cursor_reset: { reset: 0, skipped_shared: 0 },
    raw_session_deleted: 0, raw_session_kept_shared: 0, raw_session_unmapped: 0,
    purge_ms_max: null,
    timed_out: false, may_have_more: candidates.length >= limit,
  };
  const started = performance.now();
  for (const candidate of candidates) {
    if (run.attempted > 0 && performance.now() - started >= wallMs) {
      run.timed_out = true;
      run.may_have_more = true;
      break;
    }
    const purgeStarted = performance.now();
    const result = purgeSession(store, candidate.conv_key, {
      cutoffMs: options.cutoffMs, now, reason: options.reason,
      approvalId: options.approvalId ?? null, inFlight: options.inFlight,
    });
    const purgeMs = performance.now() - purgeStarted;
    run.purge_ms_max = run.purge_ms_max === null ? purgeMs : Math.max(run.purge_ms_max, purgeMs);
    run.attempted += 1;
    if (result.skipped !== null) {
      skipped[result.skipped] += 1;
      // 候选最旧优先：第一个守卫命中就是最老的未清会话。
      if (result.skipped !== 'not_expired') {
        run.pending_skipped += 1;
        run.oldest_skip_reason ??= result.skipped;
      }
    } else {
      run.deleted_sessions += 1;
      run.deleted_requests += result.deleted;
    }
    run.cursor_reset.reset += result.cursor_reset.reset;
    run.cursor_reset.skipped_shared += result.cursor_reset.skipped_shared;
    run.raw_session_deleted += result.raw_session_deleted;
    run.raw_session_kept_shared += result.raw_session_kept_shared;
    run.raw_session_unmapped += result.raw_session_unmapped;
    // 会话之间让出事件循环；大会话的单个同步事务仍不可拆，耗时会单独测。
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  // 逐会话只回收本会话失去引用的块；老库里可能已有无引用块，按批次兜一次，
  // 避免 `maintain verify` 的 dangling_blocks 长期非 0。一次全表扫描，不是每会话。
  if (run.deleted_sessions > 0) sweepOrphanBlocks(store);
  return run;
}

/** 常驻 tick 只依赖这两项策略；结构与用户设置解耦，设置层仍是值的持有者。 */
export type SessionRetentionPolicy = {
  retentionDays: number;
  retentionConfigured: boolean;
};

export type SessionRetentionTickResult = {
  cutoff_ms: number;
  run: SessionRetentionRun;
  orphans: { titles: number; usage: number };
};

/**
 * 一次自动清理：未启用时什么都不做（首次启用前不删存量）。启用后按会话最后
 * 活动时间淘汰整条会话，再清没有请求的孤儿标题与用量。是否回收空闲页、如何
 * 记指标由装配处决定，这里只返回事实。
 */
export async function runSessionRetentionTick(
  store: Store,
  policy: SessionRetentionPolicy,
  options: {
    now?: number;
    inFlight?: (convKey: string) => boolean;
    wallMs?: number;
  } = {},
): Promise<SessionRetentionTickResult | null> {
  if (!policy.retentionConfigured) return null;
  const now = options.now ?? Date.now();
  const cutoffMs = now - policy.retentionDays * RETENTION_DAY_MS;
  const run = await purgeExpiredSessions(store, {
    cutoffMs, now, reason: 'retention',
    inFlight: options.inFlight, wallMs: options.wallMs,
  });
  const orphans = pruneOrphanSessionAttachments(store, cutoffMs);
  return { cutoff_ms: cutoffMs, run, orphans };
}
