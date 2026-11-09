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
