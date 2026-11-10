/** 淘汰删除主干：维护命令与常驻任务共用，不依赖 CLI。 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { markGroupDirtyTx, positionKey } from './derive/state';
import type { Store } from './store';

export type PublishResult = { deleted: number; event_id: number };
export type PurgeEvent = { action: string; reason: string; approvalId: string | null };
export type PurgeOptions = {
  /** 来源重置要重新摄入，不能留逐证据墓碑。 */
  tombstones?: boolean;
  /** 在 fill 之前执行，供整库范围之外的同一事务清理（如来源重置删会话墓碑）。 */
  beforeFill?: (db: Database) => void;
  /** 请求行删除之后、路由清理之前执行；供整会话删除清 raw_route 与重置游标。 */
  afterDelete?: (db: Database) => void;
  /** 整会话删除时跳过「受影响组重算」，避免为已删会话重建 derive_queue 行。 */
  skipDeriveRepair?: boolean;
};

/**
 * 目标集合固定后的删除主干，按 purge_requests 与 purge_routes 两张临时表工作。
 * `fill` 填目标集合，可以另建自己的临时表；`beforeDelete` 在行级级联之前执行，
 * 供按 agent 拆除清理来源层。整个批次在一个事务里完成，任何一步失败整体回滚。
 *
 * 顺序有约束：费用观测按证据键定位，证据行删掉就再也找不回来；别名是
 * NO ACTION 外键，必须按 new_id 先删；route_summary 只在请求与账本引用都摘掉后才清。
 */
export function purgeTargetsTx(
  store: Store,
  event: PurgeEvent,
  fill: (db: Database) => void,
  beforeDelete?: (db: Database) => void,
  options: PurgeOptions = {},
): PublishResult {
  return store.write(db => {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS purge_requests(req_id INTEGER PRIMARY KEY)');
    db.exec('CREATE TEMP TABLE IF NOT EXISTS purge_routes(route_id INTEGER PRIMARY KEY)');
    db.exec('CREATE TEMP TABLE IF NOT EXISTS purge_blocks(block INTEGER PRIMARY KEY)');
    db.run('DELETE FROM purge_requests');
    db.run('DELETE FROM purge_routes');
    db.run('DELETE FROM purge_blocks');
    options.beforeFill?.(db);
    fill(db);

    const targets = db.query<{ n: number; first_day: string | null; last_day: string | null }, []>(
      'SELECT COUNT(*) AS n, MIN(day) AS first_day, MAX(day) AS last_day FROM request WHERE req_id IN (SELECT req_id FROM purge_requests)',
    ).get();
    const count = targets?.n ?? 0;
    if (count === 0) {
      db.run('DELETE FROM purge_requests');
      db.run('DELETE FROM purge_routes');
      db.run('DELETE FROM purge_blocks');
      return { deleted: 0, event_id: 0 };
    }
    const now = Date.now();

    // 1) 费用观测按目标证据的 ref_key 精确删除。
    db.run(`DELETE FROM cost_observation WHERE ref_key IN (
              SELECT ref_key FROM request_evidence WHERE req_id IN (SELECT req_id FROM purge_requests))`);
    // 2) 墓碑：重放时按证据键跳过。来源重置要重新摄入，不能留墓碑。
    if (options.tombstones !== false) {
      db.run(`INSERT OR IGNORE INTO purged_evidence(source_kind,ref_key,purged_at)
              SELECT source_kind, ref_key, ? FROM request_evidence
              WHERE req_id IN (SELECT req_id FROM purge_requests)`, [now]);
    }
    const event_id = db.run(
      `INSERT INTO retention_event(at_ms,action,first_day,last_day,request_count,reason,approval_id)
       VALUES (?,?,?,?,?,?,?)`,
      [now, event.action, targets?.first_day ?? null, targets?.last_day ?? null, count,
        event.reason, event.approvalId],
    );
    // 3) 其他引用先清掉，再删别名与请求。
    //    删行前先记下受影响的组：这些请求消失后，同组剩下的成员要重算链与增量。
    //    边界取被删请求里最早的开始时刻：删行后它之前的行不受影响。
    const affected = db.query<{ conv_key: string; actor: string; earliest: number }, []>(`
      SELECT conv_key, actor, MIN(started_ms) AS earliest FROM request
      WHERE req_id IN (SELECT req_id FROM purge_requests)
        AND conv_key IS NOT NULL AND actor IS NOT NULL AND actor_state='known'
      GROUP BY conv_key, actor`).all();
    beforeDelete?.(db);
    db.run('DELETE FROM tool_call WHERE req_id IN (SELECT req_id FROM purge_requests)');
    db.run('DELETE FROM tool_call WHERE result_req IN (SELECT req_id FROM purge_requests)');
    // 只回收本次目标引用过的块。全库「无引用块」扫描在大会话上要遍历整张
    // request_block（生产 34M 行，约 0.25 s/会话），代价与单会话无关。
    db.run(`INSERT OR IGNORE INTO purge_blocks(block)
            SELECT rb.block FROM request_block rb
            WHERE rb.req_id IN (SELECT req_id FROM purge_requests)`);
    db.run('DELETE FROM request_block WHERE req_id IN (SELECT req_id FROM purge_requests)');
    db.run(`DELETE FROM block WHERE id IN (SELECT block FROM purge_blocks)
              AND NOT EXISTS (SELECT 1 FROM request_block rb WHERE rb.block=block.id)`);
    db.run('DELETE FROM purge_blocks');
    db.run('DELETE FROM request_evidence WHERE req_id IN (SELECT req_id FROM purge_requests)');
    db.run('UPDATE request SET prev_req_id=NULL WHERE prev_req_id IN (SELECT req_id FROM purge_requests)');
    db.run('DELETE FROM request_alias WHERE new_id IN (SELECT req_id FROM purge_requests)');
    db.run('DELETE FROM request WHERE req_id IN (SELECT req_id FROM purge_requests)');
    options.afterDelete?.(db);
    // 4) 只清没有其他请求引用的路由摘要与原始路由。
    db.run(`DELETE FROM route_summary WHERE route_id IN (
              SELECT route_id FROM purge_routes
              WHERE NOT EXISTS (SELECT 1 FROM request q WHERE q.route_id=route_summary.route_id)
                AND NOT EXISTS (SELECT 1 FROM raw_ledger l WHERE l.route_id=route_summary.route_id))`);
    db.run('DELETE FROM purge_requests');
    db.run('DELETE FROM purge_routes');
    db.run('DELETE FROM purge_blocks');
    // 5) 被删请求所在的组少成员，链与增量要重算；已经空掉的组没有产物可算，直接完成。
    if (options.skipDeriveRepair !== true) {
      for (const group of affected) {
        const remaining = db.query<{ n: number }, [string, string]>(
          `SELECT COUNT(*) AS n FROM request
           WHERE conv_key=? AND actor=? AND actor_state='known'`).get(group.conv_key, group.actor)?.n ?? 0;
        if (remaining === 0) {
          // 空组同步成 clean：保留完成记录，不把它算成积压。
          db.run(
            `INSERT INTO derive_queue(conv_key,actor,from_sort,group_epoch,input_revision,
               published_revision,target_algorithm,state,dirty_since_ms)
             VALUES (?,?,'',?,0,0,1,'clean',NULL)
             ON CONFLICT(conv_key,actor) DO UPDATE SET state='clean',dirty_since_ms=NULL,
               published_revision=input_revision,published_algorithm=target_algorithm`,
            [group.conv_key, group.actor, randomUUID()],
          );
        } else {
          markGroupDirtyTx(db, group.conv_key, group.actor, positionKey(group.earliest));
        }
      }
    }
    return { deleted: count, event_id: Number(event_id.lastInsertRowid) };
  }, event.action);
}
