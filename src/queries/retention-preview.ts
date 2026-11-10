/**
 * 会话保留预览（M0）：只读统计，不开写连接、不跑迁移、不改库。
 * 候选查询单独导出，供 M2 的删除任务复用同一套会话年龄与顺序口径。
 */

import type { Database } from 'bun:sqlite';
import { RETENTION_DAY_MS } from '../format';
import { capacityLayers, capacityMeterStatus } from '../capacity-meter';
import type { CapacityLayers } from '../capacity-meter';
import { SESSION_RETENTION_CANDIDATE_SQL } from '../session-retention-candidates';
import { openSourceGapSql } from '../session-retention-guards';

/** 一天毫秒数在格式叶子定义；这里重新导出，读模型调用方不必另找。 */
export { RETENTION_DAY_MS };
export { sessionRetentionCandidates } from '../session-retention-candidates';
export type { RetentionCandidate } from '../session-retention-candidates';

/** 一次预览最多纳入的过期会话数，CLI --limit 的缺省值。 */
const DEFAULT_LIMIT = 100_000;

export type RetentionPreview = {
  keep_days: number;
  cutoff_ms: number;
  sessions: number;
  requests: number;
  first_ms: number | null;
  last_ms: number | null;
  oldest_ms: number | null;
  bytes: { readable_body: number; session_raw: number; raw_hook: number };
  skipped: { dirty: number; purpose_pending: number; source_gap: number; in_flight: number };
  /** 当前分层占用：可读正文 / 会话原文 / raw_hook；计数结构不可用时为 null。 */
  usage: CapacityLayers | null;
  /** 最近一次会话淘汰事件；从未执行过时为 null。 */
  last_cleanup: { at_ms: number; request_count: number; reason: string } | null;
};

type PreviewRow = {
  sessions: number; requests: number;
  oldest_ms: number | null; first_ms: number | null; last_ms: number | null;
  readable_body: number; session_raw: number; raw_hook: number;
  skip_dirty: number; skip_pending: number; skip_gap: number;
};

type LastCleanupRow = { at_ms: number; request_count: number; reason: string };

/** 与预览共用同一只读连接，不写库、不跑迁移。 */
const LAST_CLEANUP_SQL = `SELECT at_ms, request_count, reason FROM retention_event
  WHERE action='session_retention' ORDER BY at_ms DESC LIMIT 1`;

/**
 * 一条语句算完，避免把上万 conv_key 拼进 IN 参数。
 *
 * 口径：这份报告里的「目标会话」指本轮可删除的会话——过期且没有命中任何跳过守卫。
 * 过期但命中守卫的会话只进 skipped，不计入 sessions / requests / bytes / 首末日，
 * 这样「将删除多少」与 M2 事务内跳过后的结果一致。候选池总量 =
 * sessions + 命中过至少一条守卫的会话数（各原因可能重叠，不能直接相加）。
 *
 * bytes：readable_body = 目标会话引用的 block.z + request.skeleton_z + raw_hook 的
 *   request_z/response_z，物理字节，与 capacity_meter 的正文分层同口径。
 *   block 不扣除仍被存活请求共享的少量块：精确独占要扫 34M 行 request_block（实测
 *   11s），生产快照两者只差 2KB；这里按引用估算，避免预览拖住事件循环。
 *   内层 CROSS JOIN 是为了钉住驱动顺序：写成普通 JOIN 时优化器会从 request_block
 *   全表扫（34M 行），从候选会话出发只要 0.6s。
 * session_raw = raw_session_event.payload_json 的 UTF-8 字节，按 session_id IN
 *   (目标会话的 request.session) 估——共享同一 session_id 的存活会话原文会被一起算进来，
 *   这是估算（request.session 没有索引，不能逐行反查存活请求）；raw_hook = request_z/
 *   response_z 字节，按 request_evidence.source_kind='hook' 的 ref_key(=hook_id) 关联，
 *   关联不上的行贡献 0。
 * 时间：first_ms / last_ms = 目标会话请求的 MIN / MAX(started_ms)；
 *   oldest_ms = 目标会话里最老会话的 last_ms（最老的最后活动）。
 */
const PREVIEW_SQL = `
WITH target AS MATERIALIZED (${SESSION_RETENTION_CANDIDATE_SQL}),
flagged AS MATERIALIZED (
  SELECT t.conv_key, t.last_ms, t.request_count,
    CASE WHEN EXISTS (
      SELECT 1 FROM derive_queue q WHERE q.conv_key=t.conv_key AND q.state='dirty'
    ) THEN 1 ELSE 0 END AS dirty,
    CASE WHEN EXISTS (
      SELECT 1 FROM request r WHERE r.conv_key=t.conv_key AND r.purpose_pending=1
    ) THEN 1 ELSE 0 END AS purpose_pending,
    -- 与删除侧共用同一片段：预览说命中的会话，事务内也确实会跳过。
    CASE WHEN ${openSourceGapSql('r.conv_key=t.conv_key')} THEN 1 ELSE 0 END AS source_gap
  FROM target t
),
deletable AS MATERIALIZED (
  SELECT conv_key, last_ms, request_count FROM flagged
  WHERE dirty=0 AND purpose_pending=0 AND source_gap=0
)
SELECT
  (SELECT COUNT(*) FROM deletable) AS sessions,
  (SELECT IFNULL(SUM(request_count),0) FROM deletable) AS requests,
  (SELECT MIN(last_ms) FROM deletable) AS oldest_ms,
  (SELECT MIN(r.started_ms) FROM request r
    WHERE r.conv_key IN (SELECT conv_key FROM deletable)) AS first_ms,
  (SELECT MAX(r.started_ms) FROM request r
    WHERE r.conv_key IN (SELECT conv_key FROM deletable)) AS last_ms,
  (SELECT IFNULL(SUM(length(b.z)),0)
    FROM (SELECT DISTINCT rb.block AS id FROM deletable d
          CROSS JOIN request r ON r.conv_key=d.conv_key
          CROSS JOIN request_block rb ON rb.req_id=r.req_id) c
    JOIN block b ON b.id=c.id)
    + (SELECT IFNULL(SUM(IFNULL(length(r.skeleton_z),0)),0)
      FROM request r WHERE r.conv_key IN (SELECT conv_key FROM deletable)) AS readable_body,
  (SELECT IFNULL(SUM(length(CAST(s.payload_json AS BLOB))),0)
    FROM raw_session_event s
    WHERE s.session_id IN (
      SELECT DISTINCT r.session FROM request r
      WHERE r.conv_key IN (SELECT conv_key FROM deletable) AND r.session IS NOT NULL
    )) AS session_raw,
  (SELECT IFNULL(SUM(IFNULL(length(h.request_z),0)+IFNULL(length(h.response_z),0)),0)
    FROM raw_hook h
    WHERE h.hook_id IN (
      SELECT e.ref_key FROM request_evidence e
      JOIN request r ON r.req_id=e.req_id
      WHERE e.source_kind='hook'
        AND r.conv_key IN (SELECT conv_key FROM deletable)
    )) AS raw_hook,
  (SELECT IFNULL(SUM(dirty),0) FROM flagged) AS skip_dirty,
  (SELECT IFNULL(SUM(purpose_pending),0) FROM flagged) AS skip_pending,
  (SELECT IFNULL(SUM(source_gap),0) FROM flagged) AS skip_gap`;

export function previewSessionRetention(
  db: Database, keepDays: number, now?: number, limit: number = DEFAULT_LIMIT,
): RetentionPreview {
  // 负数或非整数会把截止时间推到未来，预览会误报「删掉全部历史」。
  if (!Number.isInteger(keepDays) || keepDays < 1) throw new Error('invalid_keep_days');
  const at = now ?? Date.now();
  const cutoffMs = at - keepDays * RETENTION_DAY_MS;
  const row = db.query<PreviewRow, [number, number]>(PREVIEW_SQL).get(cutoffMs, limit)!;
  const lastCleanup = db.query<LastCleanupRow, []>(LAST_CLEANUP_SQL).get();
  return {
    keep_days: keepDays,
    cutoff_ms: cutoffMs,
    sessions: row.sessions,
    requests: row.requests,
    first_ms: row.first_ms,
    last_ms: row.last_ms,
    oldest_ms: row.oldest_ms,
    bytes: {
      readable_body: row.readable_body,
      session_raw: row.session_raw,
      raw_hook: row.raw_hook,
    },
    // 离线预览没有内存态，in_flight 由常驻进程的守卫补；这里恒 0。
    skipped: {
      dirty: row.skip_dirty,
      purpose_pending: row.skip_pending,
      source_gap: row.skip_gap,
      in_flight: 0,
    },
    usage: capacityLayers(capacityMeterStatus(db)),
    last_cleanup: lastCleanup ?? null,
  };
}
