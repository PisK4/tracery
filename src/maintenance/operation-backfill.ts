/**
 * 显式 operation 回填：给原始账本仍带显式 operation 的历史行补齐长期来源
 * 事实，并按输入变化标脏重判。只处理判定可能改变的行：raw 没有 operation
 * 的行保持旧事实，用途走原协议路径，不被这次升版波及。
 *
 * 触发权只在显式命令手里；逐笔独立事务，单行失败不影响其它行。重投影读 raw
 * 走与在线摄入同一份映射，重复执行时事实已带 operation 键的行不再命中候选。
 */

import type { Store } from '../store';
import { markRequestInputTx } from '../derive/state';
import { readSourceFacts } from '../sources/facts';
import { SOURCE_PROJECTION_VERSION, projectRequestTx } from '../sources/projection';

export type OperationBackfillPreview = {
  candidates: number;
  /** 候选行按 operation 值的分布（只取元数据，不读正文）。 */
  operations: Record<string, number>;
  /** 受影响会话键：供操作员预览后决定是否整链 rebuild。 */
  conv_keys: string[];
};

export type OperationBackfillReport = {
  rewritten: number;
  skipped: number;
  failed: { req_id: number; reason: string }[];
  remaining: number;
};

type CandidateRow = { req_id: number; conv_key: string | null; operation: string };

/**
 * 事实缺 operation 键（含事实列缺失与损坏）且 raw 账本仍有显式文本 operation
 * 的行。json_valid 守住损坏事实列：json_extract 对非法 JSON 会直接抛错。
 */
const CANDIDATE_SQL = `
  SELECT r.req_id AS req_id, r.conv_key AS conv_key,
    json_extract(l.payload_json, '$.operation') AS operation
  FROM request r
  JOIN request_evidence e ON e.req_id=r.req_id AND e.source_kind='ledger'
  JOIN raw_ledger l ON l.source_kind='file'
    AND l.file_generation=json_extract(e.ref_key, '$[1]')
    AND l.byte_offset=json_extract(e.ref_key, '$[2]')
  WHERE (r.source_facts_json IS NULL OR NOT json_valid(r.source_facts_json)
      OR json_extract(r.source_facts_json, '$.operation') IS NULL)
    AND json_type(l.payload_json, '$.operation')='text'
    AND length(json_extract(l.payload_json, '$.operation')) > 0
  ORDER BY r.req_id, e.ref_key`;

/** 同一请求的多条账本证据只算一个候选；operation 取首条，重投影会读全量。 */
function candidates(store: Store): CandidateRow[] {
  const rows = store.read.query<CandidateRow, []>(CANDIDATE_SQL).all();
  const seen = new Map<number, CandidateRow>();
  for (const row of rows) {
    if (!seen.has(row.req_id)) seen.set(row.req_id, row);
  }
  return [...seen.values()];
}

export function previewOperationBackfill(store: Store): OperationBackfillPreview {
  const rows = candidates(store);
  const operations: Record<string, number> = {};
  const keys = new Set<string>();
  for (const row of rows) {
    operations[row.operation] = (operations[row.operation] ?? 0) + 1;
    if (row.conv_key !== null) keys.add(row.conv_key);
  }
  return { candidates: rows.length, operations, conv_keys: [...keys].sort() };
}

/** 事务内重读事实：候选扫描之后别的写入可能已补齐， already_current 不重写。 */
function backfillRow(store: Store, reqId: number, now: number): boolean {
  return store.write(db => {
    const row = db.query<{ source_facts_json: string | null }, [number]>(
      'SELECT source_facts_json FROM request WHERE req_id=?').get(reqId);
    if (row === null) return false;
    const facts = readSourceFacts(row.source_facts_json);
    if (facts !== null && facts.operation !== undefined) return false;
    projectRequestTx(db, reqId, { now, mappingVersion: SOURCE_PROJECTION_VERSION });
    // 事实补齐是真实的派生输入变化：与在线摄入同口径标脏，用途随正常重判升级，
    // 不需要逐会话 rebuild；整链重建仍可选走 maintain rebuild。
    markRequestInputTx(db, reqId);
    return true;
  });
}

export function backfillOperations(store: Store, now: number): OperationBackfillReport {
  const rows = candidates(store);
  let rewritten = 0;
  let skipped = 0;
  const failed: { req_id: number; reason: string }[] = [];
  for (const row of rows) {
    try {
      if (backfillRow(store, row.req_id, now)) rewritten += 1;
      else skipped += 1;
    } catch (error) {
      failed.push({ req_id: row.req_id, reason: error instanceof Error ? error.message : 'unknown' });
    }
  }
  return { rewritten, skipped, failed, remaining: candidates(store).length };
}