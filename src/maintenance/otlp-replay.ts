/**
 * OTLP raw 层重放：映射规则升级（OTLP_MAPPING_VERSION 前进）后，旧版本的
 * raw span 按当前规则重跑分类与映射。没有这条路径时，规则修复救不回已经
 * 落在原始层的 span——它们按 raw 保留期（7 天）过期删除。
 *
 * 边界：
 * - 只读 raw、不写 raw。raw 的 received_at 是保留期时钟，重放不得刷新；
 *   落库段与摄入共用 persistMappedSpanTx，分类判定共用 classifySpan，
 *   这里不复刻任何规则。
 * - skipped 与 unknown 也回写 mapping_version：不回写的话每次 --apply
 *   都把同一批行扫一遍，版本感知的巡查永远报"可重放 N 条"。
 * - 分批事务（节奏同 retention 的 PRUNE_BATCH）：15 万行逐行解析属性，
 *   单事务过长；批间不再让出事件循环——维护命令独占进程，没有并发任务。
 */

import type { Database } from 'bun:sqlite';
import { loadBoundSaltTx } from '../config';
import { RAW_TTL_MS } from '../retention';
import type { Store } from '../store';
import { otlpConv } from '../evidence';
import type { OtlpAttrs, OtlpSpan } from '../sources/otlp/decode';
import { OTLP_MAPPING_VERSION, classifySpan, mapSpan } from '../sources/otlp/mapping';
import { magpieTurnRequestTx, persistMappedSpanTx, spanRefKey } from '../sources/otlp/ingest';
import type { HookAdmission } from '../hook';

/** 离线重放没有真实磁盘预算：接线 body 时按 normal 档处理。 */
const NORMAL_ADMISSION: HookAdmission = { mode: 'normal', reason: null };

/** 每批独立事务的行数；与 retention 的 PRUNE_BATCH 同节奏。 */
const REPLAY_BATCH = 100;

type RawSpanRow = {
  service: string | null;
  name: string;
  kind: number | null;
  start_ms: number;
  end_ms: number | null;
  status_code: number | null;
  attributes_json: string;
};

export type OtlpReplayPreview = {
  scanned: number;
  /** 会认领既有请求行并登记证据的 span。 */
  evidence: number;
  /** 会新建请求行的 span（该 turn 没有承载行）。 */
  wouldCreate: number;
  unknownShape: number;
  skipped: number;
  /** received_at 已过保留期的行：清理任务随时代走，重放要赶在删除前。 */
  expired: number;
};

export type OtlpReplayReport = {
  scanned: number;
  /** 认领既有行时登记的证据数（INSERT OR IGNORE，幂等）。 */
  evidenceAdded: number;
  requestsCreated: number;
  unknownShape: number;
  skipped: number;
  /** 回写 mapping_version 的行数（三种分类都回写）。 */
  versionBumped: number;
};

function attrsOf(json: string): OtlpAttrs {
  try {
    return JSON.parse(json) as OtlpAttrs;
  } catch {
    // 属性损坏的行按无属性处理：分类落 skipped，版本照常升级，不卡批次。
    return {};
  }
}

/** 从 raw 行重建解码层形状：毫秒列左移回纳秒，整除可逆，毫秒值逐列相等。 */
function spanOfRaw(row: RawSpanRow, traceId: Uint8Array, spanId: Uint8Array): OtlpSpan {
  return {
    traceId, spanId,
    name: row.name, kind: row.kind ?? 0,
    startNano: BigInt(row.start_ms) * 1_000_000n,
    endNano: row.end_ms === null ? null : BigInt(row.end_ms) * 1_000_000n,
    attrs: attrsOf(row.attributes_json),
    statusCode: row.status_code,
  };
}

/** 只读预览：分类计数加上按当前规则的 turn 认领归属，不做任何写。 */
export function previewOtlpReplay(db: Database, now: number): OtlpReplayPreview {
  const preview: OtlpReplayPreview = { scanned: 0, evidence: 0, wouldCreate: 0, unknownShape: 0, skipped: 0, expired: 0 };
  // 流式迭代：15 万行的 attributes_json 不整表进内存。
  const rows = db.query<RawSpanRow & { received_at: number }, [number]>(
    `SELECT service,name,kind,start_ms,end_ms,status_code,attributes_json,received_at
     FROM raw_otlp_span WHERE mapping_version < ?`,
  ).iterate(OTLP_MAPPING_VERSION);
  const emptyId = new Uint8Array(0);
  for (const row of rows) {
    preview.scanned += 1;
    if (row.received_at < now - RAW_TTL_MS) preview.expired += 1;
    const span = spanOfRaw(row, emptyId, emptyId);
    const verdict = classifySpan(row.service, span);
    if (verdict.kind === 'llm') {
      const mapping = mapSpan(verdict.rule, span);
      const conv = otlpConv(mapping.session);
      const owner = magpieTurnRequestTx(db, mapping, conv?.key ?? null, row.start_ms, row.end_ms);
      if (owner !== null) preview.evidence += 1;
      else preview.wouldCreate += 1;
    } else if (verdict.kind === 'unknown') {
      preview.unknownShape += 1;
    } else {
      preview.skipped += 1;
    }
  }
  return preview;
}

function replayOneTx(
  db: Database,
  traceId: Uint8Array,
  spanId: Uint8Array,
  now: number,
  salt: Uint8Array,
  report: OtlpReplayReport,
): void {
  const row = db.query<RawSpanRow & { mapping_version: number }, [Uint8Array, Uint8Array]>(
    `SELECT service,name,kind,start_ms,end_ms,status_code,attributes_json,mapping_version
     FROM raw_otlp_span WHERE trace_id=? AND span_id=?`,
  ).get(traceId, spanId);
  // 主键清单是执行前的快照：缺席（已被清理）或已被别的批次升级的行跳过。
  if (row === null || row.mapping_version >= OTLP_MAPPING_VERSION) return;
  const refKey = spanRefKey(traceId, spanId);
  const span = spanOfRaw(row, traceId, spanId);
  const verdict = classifySpan(row.service, span);
  if (verdict.kind === 'llm') {
    const mapping = mapSpan(verdict.rule, span);
    const persisted = persistMappedSpanTx(db, mapping, span, refKey, now, salt, NORMAL_ADMISSION);
    if (persisted.created) report.requestsCreated += 1;
    else report.evidenceAdded += 1;
  } else if (verdict.kind === 'unknown') {
    // 重放会改判 issue 理由（如 service_not_registered → span_shape_unknown）：
    // 旧行不删，主键 (source_kind, ref_key, reason) 不冲突，两类并存各自计数。
    db.run(
      'INSERT OR IGNORE INTO ingest_issue(source_kind,ref_key,reason,observed_at,byte_length) VALUES (?,?,?,?,NULL)',
      ['otlp_span', refKey, 'span_shape_unknown', now]);
    report.unknownShape += 1;
  } else {
    report.skipped += 1;
  }
  db.run('UPDATE raw_otlp_span SET mapping_version=? WHERE trace_id=? AND span_id=?',
    [OTLP_MAPPING_VERSION, traceId, spanId]);
  report.versionBumped += 1;
}

/** 应用重放：主键清单一次取齐，按批开事务处理，直到清单耗尽。 */
export function replayOtlpMapping(store: Store, now: number, salt: Uint8Array): OtlpReplayReport {
  const pending = store.read.query<{ trace_id: Uint8Array; span_id: Uint8Array }, [number]>(
    'SELECT trace_id, span_id FROM raw_otlp_span WHERE mapping_version < ?',
  ).all(OTLP_MAPPING_VERSION);
  const report: OtlpReplayReport = {
    scanned: pending.length, evidenceAdded: 0, requestsCreated: 0,
    unknownShape: 0, skipped: 0, versionBumped: 0,
  };
  for (let index = 0; index < pending.length; index += REPLAY_BATCH) {
    const batch = pending.slice(index, index + REPLAY_BATCH);
    store.write(db => {
      for (const key of batch) {
        replayOneTx(db, key.trace_id, key.span_id, now, salt, report);
      }
    }, 'otlp-replay');
  }
  return report;
}

/** CLI 的 apply 路径：salt 从数据目录的绑定读取，缺绑定时报错并失败。 */
export function replayOtlpBound(store: Store, dbPath: string, now: number): OtlpReplayReport {
  const salt = loadBoundSaltTx(store.read, dbPath);
  return replayOtlpMapping(store, now, salt);
}
