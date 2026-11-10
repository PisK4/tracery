/** 元数据淘汰与按 agent 拆除：范围预览与带墓碑的单事务删除。 */

import type { Database } from 'bun:sqlite';
import { markGroupDirtyTx, positionKey } from '../derive/state';
import { HAVE_SESSION } from '../evidence';
import { purgeTargetsTx } from '../purge-core';
import type { PublishResult } from '../purge-core';
import { SESSION_ADAPTERS } from '../sources/session/registry';
import type { Store } from '../store';

export type { PublishResult } from '../purge-core';

export type PurgePreview = {
  requests: number;
  first_day: string | null;
  last_day: string | null;
  estimated_bytes: number;
};

/** 按 agent 拆除的范围预览：请求侧、证据与来源层的可删行数。 */
export type AgentPurgePreview = {
  agent: string;
  requests: number;
  conv_keys: number;
  shared_conv_keys: number;
  groups: number;
  groups_with_remaining: number;
  first_day: string | null;
  last_day: string | null;
  estimated_bytes: number;
  evidence: { ledger: number; route: number; hook: number };
  raw: {
    ledger: number;
    route: number;
    hook: number;
    pending_hook: number;
    route_summary: number;
  };
};

function requireApproval(approvalId: string): void {
  if (typeof approvalId !== 'string' || approvalId.trim().length === 0) {
    throw new Error('approval_id_required');
  }
}

/** 淘汰范围预览：默认路径不带副作用，先把要删的东西数清楚。 */
export function previewMetadataPurge(store: Store, beforeDay: string): PurgePreview {
  const row = store.read.query<{
    n: number; first_day: string | null; last_day: string | null; bytes: number | null;
  }, [string]>(`
    SELECT COUNT(*) AS n, MIN(day) AS first_day, MAX(day) AS last_day,
           IFNULL(SUM(IFNULL(body_bytes,0) + IFNULL(length(skeleton_z),0)),0) AS bytes
    FROM request WHERE day < ?`).get(beforeDay);
  return {
    requests: row?.n ?? 0,
    first_day: row?.first_day ?? null,
    last_day: row?.last_day ?? null,
    estimated_bytes: row?.bytes ?? 0,
  };
}

/**
 * 按 agent 拆除的范围预览。计数与实际删除用同一组守卫：
 * 被存活请求共享的证据键、路由与摘要保留；`shared_conv_keys` 是被别的 agent
 * 同时使用的会话桶数量，删完后这些组按剩余成员重算而不是整体消失。
 */
export function previewAgentPurge(store: Store, agent: string): AgentPurgePreview {
  const targets = store.read.query<{
    n: number; keys: number; first_day: string | null; last_day: string | null;
  }, [string]>(`
    SELECT COUNT(*) AS n, COUNT(DISTINCT conv_key) AS keys,
           MIN(day) AS first_day, MAX(day) AS last_day
    FROM request WHERE agent = ?`).get(agent);
  const shared = store.read.query<{ n: number }, [string]>(`
    SELECT COUNT(*) AS n FROM (
      SELECT conv_key FROM request WHERE conv_key IS NOT NULL GROUP BY conv_key
      HAVING SUM(agent = ?1) > 0 AND SUM(IFNULL(agent,'') <> ?1) > 0)`).get(agent);
  const groups = store.read.query<{ n: number }, [string]>(`
    SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM request
      WHERE agent = ? AND conv_key IS NOT NULL AND actor IS NOT NULL AND actor_state='known'
      GROUP BY conv_key, actor)`).get(agent);
  const remaining = store.read.query<{ n: number }, [string]>(`
    SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM request
      WHERE conv_key IS NOT NULL AND actor IS NOT NULL AND actor_state='known'
      GROUP BY conv_key, actor
      HAVING SUM(agent = ?1) > 0 AND SUM(IFNULL(agent,'') <> ?1) > 0)`).get(agent);
  const evidence = store.read.query<{ kind: string; n: number }, [string]>(`
    SELECT source_kind AS kind, COUNT(*) AS n FROM request_evidence
    WHERE req_id IN (SELECT req_id FROM request WHERE agent = ?)
    GROUP BY source_kind`).all(agent);
  const rawLedger = store.read.query<{ n: number }, [string]>(`
    SELECT COUNT(*) AS n FROM raw_ledger l WHERE l.agent = ?1
      AND NOT EXISTS (SELECT 1 FROM request_evidence e
        WHERE e.source_kind='ledger'
          AND e.ref_key = json_array('file', l.file_generation, l.byte_offset)
          AND e.req_id NOT IN (SELECT req_id FROM request WHERE agent = ?1))`).get(agent);
  const rawRoute = store.read.query<{ n: number }, [string]>(`
    SELECT COUNT(*) AS n FROM raw_route rt WHERE rt.route_id IN (
      SELECT route_id FROM request WHERE agent = ?1 AND route_id IS NOT NULL
      UNION SELECT route_id FROM raw_ledger WHERE agent = ?1 AND route_id IS NOT NULL
      UNION SELECT route_id FROM raw_route WHERE agent = ?1)
      AND NOT EXISTS (SELECT 1 FROM raw_ledger l WHERE l.route_id = rt.route_id
        AND IFNULL(l.agent,'') <> ?1)
      AND NOT EXISTS (SELECT 1 FROM request r WHERE r.route_id = rt.route_id
        AND IFNULL(r.agent,'') <> ?1)`).get(agent);
  const rawHook = store.read.query<{ n: number }, [string]>(`
    SELECT COUNT(*) AS n FROM raw_hook h WHERE h.agent = ?1
      AND NOT EXISTS (SELECT 1 FROM request_evidence e
        WHERE e.source_kind='hook' AND e.ref_key = h.hook_id
          AND e.req_id NOT IN (SELECT req_id FROM request WHERE agent = ?1))`).get(agent);
  const pendingHook = store.read.query<{ n: number }, [string]>(`
    SELECT COUNT(*) AS n FROM pending_hook WHERE hook_id IN (
      SELECT hook_id FROM raw_hook WHERE agent = ?1
      UNION SELECT ref_key FROM request_evidence WHERE source_kind='hook'
        AND req_id IN (SELECT req_id FROM request WHERE agent = ?1))`).get(agent);
  const summaries = store.read.query<{ n: number }, [string]>(`
    SELECT COUNT(*) AS n FROM route_summary s WHERE s.route_id IN (
      SELECT route_id FROM request WHERE agent = ?1 AND route_id IS NOT NULL
      UNION SELECT route_id FROM raw_ledger WHERE agent = ?1 AND route_id IS NOT NULL
      UNION SELECT route_id FROM raw_route WHERE agent = ?1)
      AND NOT EXISTS (SELECT 1 FROM request r WHERE r.route_id = s.route_id
        AND IFNULL(r.agent,'') <> ?1)
      AND NOT EXISTS (SELECT 1 FROM raw_ledger l WHERE l.route_id = s.route_id
        AND IFNULL(l.agent,'') <> ?1)`).get(agent);
  const bytes = store.read.query<{ n: number }, [string]>(`
    SELECT
      (SELECT IFNULL(SUM(IFNULL(body_bytes,0) + IFNULL(length(skeleton_z),0)),0)
         FROM request WHERE agent = ?1)
    + (SELECT IFNULL(SUM(length(CAST(payload_json AS BLOB))),0)
         FROM raw_ledger WHERE agent = ?1)
    + (SELECT IFNULL(SUM(length(CAST(payload_json AS BLOB))),0)
         FROM raw_route WHERE agent = ?1)
    + (SELECT IFNULL(SUM(IFNULL(length(request_z),0) + IFNULL(length(response_z),0)),0)
         FROM raw_hook WHERE agent = ?1)
    + (SELECT IFNULL(SUM(length(z)),0) FROM route_summary s WHERE s.route_id IN (
         SELECT route_id FROM request WHERE agent = ?1 AND route_id IS NOT NULL
         UNION SELECT route_id FROM raw_ledger WHERE agent = ?1 AND route_id IS NOT NULL
         UNION SELECT route_id FROM raw_route WHERE agent = ?1)
       AND NOT EXISTS (SELECT 1 FROM request r WHERE r.route_id = s.route_id
         AND IFNULL(r.agent,'') <> ?1)
       AND NOT EXISTS (SELECT 1 FROM raw_ledger l WHERE l.route_id = s.route_id
         AND IFNULL(l.agent,'') <> ?1)) AS n`).get(agent);
  const byKind = new Map(evidence.map(row => [row.kind, row.n]));
  return {
    agent,
    requests: targets?.n ?? 0,
    conv_keys: targets?.keys ?? 0,
    shared_conv_keys: shared?.n ?? 0,
    groups: groups?.n ?? 0,
    groups_with_remaining: remaining?.n ?? 0,
    first_day: targets?.first_day ?? null,
    last_day: targets?.last_day ?? null,
    estimated_bytes: bytes?.n ?? 0,
    evidence: {
      ledger: byKind.get('ledger') ?? 0,
      route: byKind.get('route') ?? 0,
      hook: byKind.get('hook') ?? 0,
    },
    raw: {
      ledger: rawLedger?.n ?? 0,
      route: rawRoute?.n ?? 0,
      hook: rawHook?.n ?? 0,
      pending_hook: pendingHook?.n ?? 0,
      route_summary: summaries?.n ?? 0,
    },
  };
}

/**
 * 主动淘汰长期元数据。只有在 CLI 显式 `--apply --approval-id` 时才会被调用，
 * 不挂后台定时器。
 */
export function purgeMetadata(store: Store, beforeDay: string, approvalId: string): PublishResult {
  requireApproval(approvalId);
  return purgeTargetsTx(
    store,
    { action: 'purge_metadata', reason: 'metadata_retention', approvalId },
    db => {
      db.run(
        'INSERT INTO purge_requests(req_id) SELECT req_id FROM request WHERE day < ?',
        [beforeDay],
      );
      db.run(`INSERT INTO purge_routes(route_id)
              SELECT DISTINCT route_id FROM request
              WHERE req_id IN (SELECT req_id FROM purge_requests) AND route_id IS NOT NULL`);
    },
  );
}

/**
 * 按 agent 拆除一次对话来源的全部落库痕迹。除了请求侧级联，还清来源层的
 * raw_ledger、raw_route、raw_hook、route_summary 与等待队列里的 hook：
 * 只删请求行会留下仍可读出会话归属的原始记录。
 *
 * 共享守卫：证据键、路由或摘要还被别的 agent 引用时保留。账本墓碑让同一代际的
 * 重放计 purged_skip；文件换代后的旧墓碑不匹配，这是既有淘汰路径共有的边界。
 */
export function purgeAgent(store: Store, agent: string, approvalId: string): PublishResult {
  requireApproval(approvalId);
  if (typeof agent !== 'string' || agent.trim().length === 0) throw new Error('agent_required');
  return purgeTargetsTx(
    store,
    { action: 'purge_agent', reason: `agent_removal:${agent}`, approvalId },
    db => {
      db.run('INSERT INTO purge_requests(req_id) SELECT req_id FROM request WHERE agent = ?', [agent]);
      db.run(`INSERT INTO purge_routes(route_id)
              SELECT route_id FROM request
              WHERE req_id IN (SELECT req_id FROM purge_requests) AND route_id IS NOT NULL
              UNION SELECT route_id FROM raw_ledger WHERE agent = ? AND route_id IS NOT NULL
              UNION SELECT route_id FROM raw_route WHERE agent = ?`, [agent, agent]);
    },
    db => purgeAgentRawLayer(db, agent),
  );
}

/** 来源重置的范围预览：整行删除、只摘证据与来源层各自的可删行数。 */
export type ResetSourcePreview = {
  source_kind: string;
  evidence_kind: string;
  evidence: number;
  local_only_requests: number;
  mixed_requests: number;
  cursors: number;
  raw_rows: number;
  first_day: string | null;
  last_day: string | null;
};

function resetAdapter(sourceKind: string) {
  const adapter = SESSION_ADAPTERS.find(entry => entry.sourceKind === sourceKind);
  if (adapter === undefined) throw new Error('source_kind_unknown');
  return adapter;
}

/** 重置范围预览；默认只读，不删任何东西。 */
export function previewSourceReset(store: Store, sourceKind: string): ResetSourcePreview {
  const adapter = resetAdapter(sourceKind);
  const kind = adapter.evidenceKind;
  const row = store.read.query<{
    evidence: number; local_only_requests: number; mixed_requests: number;
    cursors: number; raw_rows: number; first_day: string | null; last_day: string | null;
  }, [string, string, string, string, string, string, string]>(`
    SELECT
      (SELECT COUNT(*) FROM request_evidence WHERE source_kind=?) AS evidence,
      (SELECT COUNT(*) FROM request r
        WHERE EXISTS (SELECT 1 FROM request_evidence e WHERE e.req_id=r.req_id AND e.source_kind=?)
          AND (SELECT COUNT(*) FROM request_evidence x WHERE x.req_id=r.req_id)=1) AS local_only_requests,
      (SELECT COUNT(*) FROM request r
        WHERE EXISTS (SELECT 1 FROM request_evidence e WHERE e.req_id=r.req_id AND e.source_kind=?)
          AND (SELECT COUNT(*) FROM request_evidence x WHERE x.req_id=r.req_id) > 1) AS mixed_requests,
      (SELECT COUNT(*) FROM source_cursor WHERE source_kind=?) AS cursors,
      (SELECT COUNT(*) FROM raw_session_event WHERE source_kind=?) AS raw_rows,
      (SELECT MIN(r.day) FROM request r
        WHERE EXISTS (SELECT 1 FROM request_evidence e WHERE e.req_id=r.req_id AND e.source_kind=?)) AS first_day,
      (SELECT MAX(r.day) FROM request r
        WHERE EXISTS (SELECT 1 FROM request_evidence e WHERE e.req_id=r.req_id AND e.source_kind=?)) AS last_day`,
  ).get(kind, kind, kind, adapter.sourceKind, adapter.sourceKind, kind, kind)!;
  return {
    source_kind: sourceKind, evidence_kind: kind,
    evidence: row.evidence, local_only_requests: row.local_only_requests,
    mixed_requests: row.mixed_requests, cursors: row.cursors, raw_rows: row.raw_rows,
    first_day: row.first_day, last_day: row.last_day,
  };
}

/**
 * 重置一个本地会话来源，让它从游标零重新摄入。
 *
 * 只带这一来源证据的请求整行删除（沿用淘汰级联）；与网关证据混在一起的行
 * 只摘这一来源的证据并清会话位，请求本身与其它证据保留。游标与原始行一并
 * 删除，下一轮发现从头读。与淘汰不同，这里不写 `purged_evidence` 墓碑：
 * 重置的目的就是让同一批调用重新落库。
 */
export function resetSource(store: Store, sourceKind: string, approvalId: string): PublishResult {
  requireApproval(approvalId);
  const adapter = resetAdapter(sourceKind);
  const kind = adapter.evidenceKind;
  return purgeTargetsTx(
    store,
    { action: 'reset_source', reason: `source_reset:${sourceKind}`, approvalId },
    db => {
      db.run(`INSERT INTO purge_requests(req_id)
              SELECT r.req_id FROM request r
              WHERE EXISTS (SELECT 1 FROM request_evidence e WHERE e.req_id=r.req_id AND e.source_kind=?)
                AND (SELECT COUNT(*) FROM request_evidence x WHERE x.req_id=r.req_id)=1`, [kind]);
      // 混合行：只摘这一来源的证据，请求行保留。先把组标脏，证据删掉后
      // 会话位与会话正文的缺失判定要重算。
      const mixed = db.query<{ conv_key: string; actor: string; earliest: number }, [string]>(`
        SELECT conv_key, actor, MIN(started_ms) AS earliest FROM request
        WHERE req_id IN (SELECT req_id FROM request_evidence WHERE source_kind=?
          AND req_id NOT IN (SELECT req_id FROM purge_requests))
          AND conv_key IS NOT NULL AND actor IS NOT NULL AND actor_state='known'
        GROUP BY conv_key, actor`).all(kind);
      db.run(`UPDATE request SET have = have & ~${HAVE_SESSION}
              WHERE req_id IN (SELECT req_id FROM request_evidence WHERE source_kind=?
                AND req_id NOT IN (SELECT req_id FROM purge_requests))`, [kind]);
      db.run(`DELETE FROM cost_observation WHERE ref_key IN (
                SELECT ref_key FROM request_evidence WHERE source_kind=?)`, [kind]);
      db.run('DELETE FROM request_evidence WHERE source_kind=?', [kind]);
      db.run('DELETE FROM source_cursor WHERE source_kind=?', [adapter.sourceKind]);
      db.run('DELETE FROM raw_session_event WHERE source_kind=?', [adapter.sourceKind]);
      // 显式反悔：本来源的会话墓碑一起清掉，否则从头重读仍会被墓碑挡回去。
      db.run(`DELETE FROM purged_conversation
              WHERE EXISTS (SELECT 1 FROM json_each(purged_conversation.source_kinds)
                            WHERE json_each.value=?)`, [kind]);
      for (const group of mixed) {
        markGroupDirtyTx(db, group.conv_key, group.actor, positionKey(group.earliest));
      }
    },
    undefined,
    { tombstones: false },
  );
}

/** 来源层清理：只删归属于目标、且没有被存活请求共享的原始行。 */
function purgeAgentRawLayer(db: Database, agent: string): void {
  db.run(`DELETE FROM pending_hook WHERE hook_id IN (
            SELECT hook_id FROM raw_hook WHERE agent = ?
            UNION SELECT ref_key FROM request_evidence
            WHERE source_kind='hook' AND req_id IN (SELECT req_id FROM purge_requests))`,
  [agent]);
  db.run(`DELETE FROM raw_ledger WHERE agent = ?
            AND NOT EXISTS (SELECT 1 FROM request_evidence e
              WHERE e.source_kind='ledger'
                AND e.ref_key = json_array('file', raw_ledger.file_generation, raw_ledger.byte_offset)
                AND e.req_id NOT IN (SELECT req_id FROM purge_requests))`, [agent]);
  db.run(`DELETE FROM raw_hook WHERE agent = ?
            AND NOT EXISTS (SELECT 1 FROM request_evidence e
              WHERE e.source_kind='hook' AND e.ref_key = raw_hook.hook_id
                AND e.req_id NOT IN (SELECT req_id FROM purge_requests))`, [agent]);
  db.run(`DELETE FROM raw_route WHERE route_id IN (SELECT route_id FROM purge_routes)
            AND NOT EXISTS (SELECT 1 FROM raw_ledger l WHERE l.route_id = raw_route.route_id)
            AND NOT EXISTS (SELECT 1 FROM request r WHERE r.route_id = raw_route.route_id
              AND r.req_id NOT IN (SELECT req_id FROM purge_requests))`);
  db.run(`DELETE FROM bg_job WHERE spawn_req IN (SELECT req_id FROM purge_requests)
            OR notice_req IN (SELECT req_id FROM purge_requests)`);
  db.run('DELETE FROM otlp_body_ref WHERE req_id IN (SELECT req_id FROM purge_requests)');
  // 派生快照里属于目标的逐行结果：被删请求的标题与预览不留在库里。
  for (const table of ['derive_request_result', 'derive_chain_work', 'derive_role_work',
    'derive_tool_result', 'derive_call_work', 'derive_result_work']) {
    db.run(`DELETE FROM ${table} WHERE req_id IN (SELECT req_id FROM purge_requests)`);
  }
}
