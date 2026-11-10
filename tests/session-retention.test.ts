import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { verifyDatabase } from '../src/maintenance/verify';
import {
  purgeExpiredSessions, purgeSession, pruneOrphanSessionAttachments, RETENTION_DAY_MS,
  runSessionRetentionTick,
} from '../src/session-retention';
import { purgedConversationAt } from '../src/sources/raw';
import type { Store } from '../src/store';
import { fixture } from './fixtures';

const DAY = RETENTION_DAY_MS;
const convKey = (id: string): string => JSON.stringify(['session', id]);
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

type Seed = {
  convKey: string;
  sessionId: string;
  startedMs: number;
  generation: string;
  agent?: string;
  offset?: number;
  evidenceKind?: string | null;
  purposePending?: number;
  via?: string;
  bodyBytes?: number;
};

function seedRequest(store: Store, seed: Seed): number {
  const agent = seed.agent ?? 'claude';
  const evidenceKind = seed.evidenceKind === undefined ? 'claude_session_call' : seed.evidenceKind;
  const offset = seed.offset ?? 0;
  const sortKey = `${seed.generation}|${String(offset).padStart(20, '0')}`;
  const bodyBytes = seed.bodyBytes ?? 100;
  const reqId = store.write(db => Number(db.run(`
    INSERT INTO request(conv_key, actor, actor_state, agent, session, conv_source, via,
      started_ms, day, sort_key, sort_source, body_state, body_bytes, skeleton_z,
      derive_version, have, purpose_pending, created_at, updated_at)
    VALUES (?,?, 'known', ?, ?, ?, ?, ?, ?, ?, 'claude_session', 'available', ?, ?, 0, 16, ?, ?, ?)`,
  [
    seed.convKey, seed.sessionId, agent, seed.sessionId, `${agent}-session`, seed.via ?? 'session',
    seed.startedMs, dayOf(seed.startedMs), sortKey, bodyBytes, Buffer.from('x'.repeat(bodyBytes)),
    seed.purposePending ?? 0, seed.startedMs, seed.startedMs,
  ]).lastInsertRowid));
  if (evidenceKind !== null) {
    store.write(db => db.run(`
      INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,added_at)
      VALUES (?,?,?, 'merged', ?)`,
    [reqId, evidenceKind, `${seed.sessionId}/${offset}`, seed.startedMs]));
  }
  return reqId;
}

function seedRawSession(
  store: Store, sourceKind: string, generation: string, sessionId: string,
  offset: number, atMs: number,
): void {
  store.write(db => db.run(`
    INSERT INTO raw_session_event(source_kind,file_generation,byte_offset,session_id,
      line_type,event_at_ms,payload_json,privacy_version)
    VALUES (?,?,?,?, 'event', ?, ?, 1)`,
  [sourceKind, generation, offset, sessionId, atMs, 'y'.repeat(20)]));
}

function seedCursor(
  store: Store, sourceKind: string, name: string, generation: string, atMs: number,
): void {
  store.write(db => db.run(`
    INSERT INTO source_cursor(source_kind,source_name,file_generation,committed_off,
      seen_size,head_len,head_hash,fingerprint,last_ok_ms,observed_off)
    VALUES (?,?,?,100,100,10,'head','fp',?,100)`,
  [sourceKind, name, generation, atMs]));
}

function seedAttachments(store: Store, ck: string, sessionId: string, atMs: number): void {
  store.write(db => {
    db.run(`INSERT INTO session_title(conv_key,source,title,manual,observed_ms,evidence_json)
            VALUES (?, 'claude_session', 'title', 0, ?, '{}')`, [ck, atMs]);
    db.run(`INSERT INTO session_usage(agent,session,source_path,source_hash,observed_at)
            VALUES ('claude', ?, '/tmp/source', 'hash', ?)`, [sessionId, atMs]);
  });
}

function seedDerive(
  store: Store, ck: string, sessionId: string, reqId: number, atMs: number,
  queueState: 'clean' | 'dirty' = 'clean',
): string {
  const generation = `derive-${reqId}-${'0'.repeat(24)}`.slice(0, 40);
  store.write(db => {
    db.run(`INSERT INTO derive_queue(conv_key,actor,from_sort,state) VALUES (?,?,'',?)`,
      [ck, sessionId, queueState]);
    db.run(`INSERT INTO derive_generation(generation,conv_key,actor,group_epoch,input_revision,
              algorithm,state,stage,created_at)
            VALUES (?,?,?,'',1,1,'ready','done',?)`, [generation, ck, sessionId, atMs]);
    db.run(`INSERT INTO derive_request_result(generation,req_id,started_ms,purpose_revision,
              algorithm,retention_state)
            VALUES (?,?,?,1,1,'recomputed')`, [generation, reqId, atMs]);
  });
  return generation;
}

function seedBlock(store: Store, reqId: number, ord: number, tag: string): number {
  return store.write(db => {
    const id = Number(db.run(`INSERT INTO block(hash,fingerprint,z,raw_size) VALUES (?,?,?,100)`,
      [Buffer.from(tag), tag, Buffer.from('z')]).lastInsertRowid);
    db.run('INSERT INTO request_block(req_id,ord,role,block) VALUES (?,?,0,?)', [reqId, ord, id]);
    return id;
  });
}

function seedRoute(store: Store, reqIds: readonly number[], routeId: number, atMs: number): void {
  store.write(db => {
    db.run('INSERT INTO route_summary(route_id,time_ms,z) VALUES (?,?,?)',
      [routeId, atMs, Buffer.from('route')]);
    db.run('INSERT INTO raw_route(route_id,time_ms,day,payload_json) VALUES (?,?,?,\'{}\')',
      [routeId, atMs, dayOf(atMs)]);
    for (const reqId of reqIds) db.run('UPDATE request SET route_id=? WHERE req_id=?', [routeId, reqId]);
  });
}

function seedHook(store: Store, reqId: number, hookId: string, atMs: number): void {
  store.write(db => {
    db.run(`INSERT INTO raw_hook(hook_id,received_at,parse_state,request_z,response_z)
            VALUES (?,?, 'ok', ?, ?)`, [hookId, atMs, Buffer.from('req'), Buffer.from('res')]);
    db.run('INSERT INTO pending_hook(hook_id,first_seen) VALUES (?,?)', [hookId, atMs]);
    db.run(`INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,added_at)
            VALUES (?, 'hook', ?, 'merged', ?)`, [reqId, hookId, atMs]);
  });
}

function seedLedger(store: Store, reqId: number, generation: string, offset: number, atMs: number): void {
  store.write(db => {
    db.run(`INSERT INTO raw_ledger(source_kind,file_generation,byte_offset,t_text,t_ms,source,payload_json)
            VALUES ('file',?,?, 't', ?, 'source', '{}')`, [generation, offset, atMs]);
    db.run(`INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,added_at)
            VALUES (?, 'ledger', json_array('file', ?, ?), 'merged', ?)`,
    [reqId, generation, offset, atMs]);
  });
}

test('删除过期完整会话，保留未过期会话与共享数据', () => {
  const f = fixture();
  try {
    const now = Date.now();
    const cutoff = now - 30 * DAY;
    const aKey = convKey('sess-a');
    const bKey = convKey('sess-b');
    const a1 = seedRequest(f.store, {
      convKey: aKey, sessionId: 'sess-a', startedMs: now - 100 * DAY, generation: 'gen-a', offset: 1,
    });
    const a2 = seedRequest(f.store, {
      convKey: aKey, sessionId: 'sess-a', startedMs: now - 40 * DAY, generation: 'gen-a', offset: 2,
    });
    const b1 = seedRequest(f.store, {
      convKey: bKey, sessionId: 'sess-b', startedMs: now - 20 * DAY, generation: 'gen-b', offset: 1,
    });
    seedRawSession(f.store, 'claude_session', 'gen-a', 'sess-a', 1, now - 100 * DAY);
    seedRawSession(f.store, 'claude_session', 'gen-a', 'sess-a', 2, now - 40 * DAY);
    seedRawSession(f.store, 'claude_session', 'gen-b', 'sess-b', 1, now - 20 * DAY);
    seedCursor(f.store, 'claude_session', '/tmp/a.jsonl', 'gen-a', now);
    seedCursor(f.store, 'claude_session', '/tmp/b.jsonl', 'gen-b', now);
    seedAttachments(f.store, aKey, 'sess-a', now - 40 * DAY);
    seedAttachments(f.store, bKey, 'sess-b', now - 20 * DAY);
    const deriveGeneration = seedDerive(f.store, aKey, 'sess-a', a1, now - 40 * DAY);
    const sharedBlock = seedBlock(f.store, a2, 0, 'shared-block');
    seedBlock(f.store, b1, 0, 'b-block');
    f.store.write(db => db.run(
      'INSERT INTO request_block(req_id,ord,role,block) VALUES (?,1,0,?)', [b1, sharedBlock]));
    seedRoute(f.store, [a1, b1], 42, now - 40 * DAY);
    seedHook(f.store, a1, 'hook-a', now - 100 * DAY);
    seedLedger(f.store, a2, 'ledger-gen', 7, now - 40 * DAY);
    f.store.write(db => {
      db.run(`INSERT INTO bg_job(job_id,conv_key,spawn_req,state)
              VALUES ('job-a',?,?,'pending')`, [aKey, a1]);
      db.run(`INSERT INTO otlp_body_ref(request_body_id,trace_id,req_id,state,updated_at)
              VALUES ('body-a',?,?,'pending_span',?)`, [Buffer.from('trace-a'), a1, now]);
      db.run(`INSERT INTO cost_observation(ref_key,observed_at,projection_hash,payload_json)
              VALUES ('sess-a/1',?,'hash','{}')`, [now]);
    });

    const result = purgeSession(f.store, aKey, {
      cutoffMs: cutoff, reason: 'manual', approvalId: 'test-approval', now,
    });
    expect(result.skipped).toBeNull();
    expect(result.deleted).toBe(2);
    expect(result.cursor_reset).toEqual({ reset: 1, skipped_shared: 0 });
    expect(result.raw_session_deleted).toBe(2);

    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(aKey))
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(bKey))
      .toEqual({ n: 1 });
    expect(f.store.read.query(
      'SELECT conv_key,request_count,reason FROM purged_conversation WHERE conv_key=?').get(aKey))
      .toEqual({ conv_key: aKey, request_count: 2, reason: 'manual' });
    expect(f.store.read.query(
      'SELECT action,reason,approval_id FROM retention_event').get())
      .toEqual({ action: 'session_retention', reason: 'manual:30d', approval_id: 'test-approval' });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM raw_session_event WHERE session_id=?')
      .get('sess-a')).toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM raw_session_event WHERE session_id=?')
      .get('sess-b')).toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM block WHERE id=?').get(sharedBlock))
      .toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request_block WHERE block=?').get(sharedBlock))
      .toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM route_summary WHERE route_id=42').get())
      .toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM raw_route WHERE route_id=42').get())
      .toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM session_title WHERE conv_key=?').get(aKey))
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM session_title WHERE conv_key=?').get(bKey))
      .toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM session_usage WHERE session=?').get('sess-a'))
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM session_usage WHERE session=?').get('sess-b'))
      .toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM derive_queue WHERE conv_key=?').get(aKey))
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM derive_generation WHERE conv_key=?').get(aKey))
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM derive_request_result WHERE generation=?')
      .get(deriveGeneration)).toEqual({ n: 0 });
    expect(f.store.read.query("SELECT COUNT(*) AS n FROM raw_hook WHERE hook_id='hook-a'").get())
      .toEqual({ n: 0 });
    expect(f.store.read.query("SELECT COUNT(*) AS n FROM pending_hook WHERE hook_id='hook-a'").get())
      .toEqual({ n: 0 });
    expect(f.store.read.query("SELECT COUNT(*) AS n FROM raw_ledger WHERE file_generation='ledger-gen'").get())
      .toEqual({ n: 0 });
    expect(f.store.read.query("SELECT COUNT(*) AS n FROM bg_job WHERE job_id='job-a'").get())
      .toEqual({ n: 0 });
    expect(f.store.read.query("SELECT COUNT(*) AS n FROM otlp_body_ref WHERE request_body_id='body-a'").get())
      .toEqual({ n: 0 });
    expect(f.store.read.query("SELECT COUNT(*) AS n FROM cost_observation WHERE ref_key='sess-a/1'").get())
      .toEqual({ n: 0 });
    expect(f.store.read.query(
      'SELECT committed_off,observed_off,fingerprint,head_hash FROM source_cursor WHERE source_name=?')
      .get('/tmp/a.jsonl'))
      .toEqual({ committed_off: 0, observed_off: 0, fingerprint: null, head_hash: null });
    expect(verifyDatabase(join(f.dir, 'trace.db')).purged_conversation_residue).toBe(0);
  } finally {
    f.close();
  }
});

test('过期但派生脏、待判定、来源缺口或在途的会话都跳过', () => {
  const f = fixture();
  try {
    const now = Date.now();
    const cutoff = now - 30 * DAY;
    const dirtyKey = convKey('sess-dirty');
    const dirtyReq = seedRequest(f.store, {
      convKey: dirtyKey, sessionId: 'sess-dirty', startedMs: now - 40 * DAY, generation: 'gen-dirty',
    });
    seedDerive(f.store, dirtyKey, 'sess-dirty', dirtyReq, now - 40 * DAY, 'dirty');
    const pendingKey = convKey('sess-pending');
    seedRequest(f.store, {
      convKey: pendingKey, sessionId: 'sess-pending', startedMs: now - 40 * DAY,
      generation: 'gen-pending', purposePending: 1,
    });
    const gapKey = convKey('sess-gap');
    seedRequest(f.store, {
      convKey: gapKey, sessionId: 'sess-gap', startedMs: now - 40 * DAY, generation: 'gen-gap',
    });
    f.store.write(db => db.run(`
      INSERT INTO source_gap(source_kind,source_name,file_generation,from_off,to_off,reason,state,updated_at)
      VALUES ('claude_session','/tmp/gap.jsonl','gen-gap',0,10,'paused','open',?)`, [now]));
    const routeGapKey = convKey('sess-route-gap');
    const routeGapReq = seedRequest(f.store, {
      convKey: routeGapKey, sessionId: 'sess-route-gap', startedMs: now - 40 * DAY,
      generation: 'gen-route-gap', evidenceKind: null,
    });
    f.store.write(db => {
      db.run(`INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,added_at)
              VALUES (?, 'route', '42', 'merged', ?)`, [routeGapReq, now]);
      db.run(`INSERT INTO source_gap(source_kind,source_name,file_generation,from_off,to_off,
                reason,state,updated_at)
              VALUES ('route','/tmp/route.jsonl','route-gen',0,10,'paused','open',?)`, [now]);
    });
    const inflightKey = convKey('sess-inflight');
    seedRequest(f.store, {
      convKey: inflightKey, sessionId: 'sess-inflight', startedMs: now - 40 * DAY,
      generation: 'gen-inflight',
    });
    const freshKey = convKey('sess-fresh');
    seedRequest(f.store, {
      convKey: freshKey, sessionId: 'sess-fresh', startedMs: now - 20 * DAY, generation: 'gen-fresh',
    });

    expect(purgeSession(f.store, dirtyKey, { cutoffMs: cutoff, reason: 'manual', now }).skipped)
      .toBe('derive_dirty');
    expect(purgeSession(f.store, pendingKey, { cutoffMs: cutoff, reason: 'manual', now }).skipped)
      .toBe('purpose_pending');
    expect(purgeSession(f.store, gapKey, { cutoffMs: cutoff, reason: 'manual', now }).skipped)
      .toBe('source_gap');
    expect(purgeSession(f.store, routeGapKey, { cutoffMs: cutoff, reason: 'manual', now }).skipped)
      .toBe('source_gap');
    expect(purgeSession(f.store, inflightKey, {
      cutoffMs: cutoff, reason: 'manual', now, inFlight: () => true,
    }).skipped).toBe('in_flight');
    expect(purgeSession(f.store, freshKey, { cutoffMs: cutoff, reason: 'manual', now }).skipped)
      .toBe('not_expired');

    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request').get()).toEqual({ n: 6 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM purged_conversation').get())
      .toEqual({ n: 0 });
  } finally {
    f.close();
  }
});

test('事务内重查：候选后出现在途请求时整会话回滚', () => {
  const f = fixture();
  try {
    const now = Date.now();
    const cutoff = now - 30 * DAY;
    const key = convKey('sess-recheck');
    seedRequest(f.store, {
      convKey: key, sessionId: 'sess-recheck', startedMs: now - 40 * DAY, generation: 'gen-recheck',
    });
    let calls = 0;
    const result = purgeSession(f.store, key, {
      cutoffMs: cutoff, reason: 'manual', now,
      inFlight: () => { calls += 1; return calls >= 2; },
    });
    expect(result.skipped).toBe('in_flight');
    expect(result.deleted).toBe(0);
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(key))
      .toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM purged_conversation').get())
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM retention_event').get()).toEqual({ n: 0 });
  } finally {
    f.close();
  }
});

test('删除后同一会话的新片段按新时间重开，墓碑合并', () => {
  const f = fixture();
  try {
    const now = Date.now();
    const key = convKey('sess-resume');
    seedRequest(f.store, {
      convKey: key, sessionId: 'sess-resume', startedMs: now - 40 * DAY, generation: 'gen-resume', offset: 1,
    });
    expect(purgeSession(f.store, key, {
      cutoffMs: now - 30 * DAY, reason: 'manual', now,
    }).deleted).toBe(1);
    const first = f.store.read.query(
      'SELECT purged_at,request_count FROM purged_conversation WHERE conv_key=?').get(key) as {
      purged_at: number; request_count: number;
    };
    expect(first.request_count).toBe(1);
    expect(purgedConversationAt(f.store.read, key, now - 40 * DAY)).toBe(first.purged_at);
    expect(purgedConversationAt(f.store.read, key, now + 1000)).toBeNull();

    seedRequest(f.store, {
      convKey: key, sessionId: 'sess-resume', startedMs: now + 1000, generation: 'gen-resume', offset: 2,
    });
    expect(purgedConversationAt(f.store.read, key, now + 1000)).toBeNull();
    expect(purgeSession(f.store, key, {
      cutoffMs: now + 2000, reason: 'manual', now: now + 5000,
    }).deleted).toBe(1);
    expect(f.store.read.query(
      'SELECT request_count FROM purged_conversation WHERE conv_key=?').get(key))
      .toEqual({ request_count: 2 });
  } finally {
    f.close();
  }
});

test('共享代际不删原文、不重置游标', () => {
  const f = fixture();
  try {
    const now = Date.now();
    const cutoff = now - 30 * DAY;
    const firstKey = convKey('sess-shared-1');
    const secondKey = convKey('sess-shared-2');
    seedRequest(f.store, {
      convKey: firstKey, sessionId: 'sess-shared-1', startedMs: now - 40 * DAY,
      generation: 'gen-shared', offset: 1,
    });
    seedRequest(f.store, {
      convKey: secondKey, sessionId: 'sess-shared-2', startedMs: now - 20 * DAY,
      generation: 'gen-shared', offset: 2,
    });
    seedRawSession(f.store, 'claude_session', 'gen-shared', 'sess-shared-1', 1, now - 40 * DAY);
    seedRawSession(f.store, 'claude_session', 'gen-shared', 'sess-shared-2', 2, now - 20 * DAY);
    seedCursor(f.store, 'claude_session', '/tmp/shared.jsonl', 'gen-shared', now);

    const result = purgeSession(f.store, firstKey, { cutoffMs: cutoff, reason: 'manual', now });
    expect(result.deleted).toBe(1);
    expect(result.raw_session_deleted).toBe(0);
    expect(result.raw_session_kept_shared).toBe(1);
    expect(result.cursor_reset).toEqual({ reset: 0, skipped_shared: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM raw_session_event WHERE session_id=?')
      .get('sess-shared-1')).toEqual({ n: 1 });
    expect(f.store.read.query('SELECT committed_off FROM source_cursor WHERE source_name=?')
      .get('/tmp/shared.jsonl')).toEqual({ committed_off: 100 });
  } finally {
    f.close();
  }
});

test('没有请求的标题与用量按观察时间清理', () => {
  const f = fixture();
  try {
    const now = Date.now();
    seedAttachments(f.store, convKey('orphan'), 'orphan-session', now - 40 * DAY);
    expect(pruneOrphanSessionAttachments(f.store, now - 30 * DAY))
      .toEqual({ titles: 1, usage: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM session_title').get()).toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM session_usage').get()).toEqual({ n: 0 });
  } finally {
    f.close();
  }
});

test('批量淘汰按最旧优先逐个删，限额、跳过与剩余标记正确', async () => {
  const f = fixture();
  try {
    const now = Date.now();
    const cutoff = now - 30 * DAY;
    const oldest = convKey('sess-oldest');
    const newer = convKey('sess-newer');
    const dirty = convKey('sess-dirty-batch');
    seedRequest(f.store, {
      convKey: oldest, sessionId: 'sess-oldest', startedMs: now - 60 * DAY, generation: 'gen-oldest',
    });
    seedRequest(f.store, {
      convKey: newer, sessionId: 'sess-newer', startedMs: now - 50 * DAY, generation: 'gen-newer',
    });
    const dirtyReq = seedRequest(f.store, {
      convKey: dirty, sessionId: 'sess-dirty-batch', startedMs: now - 40 * DAY,
      generation: 'gen-dirty-batch',
    });
    seedDerive(f.store, dirty, 'sess-dirty-batch', dirtyReq, now - 40 * DAY, 'dirty');
    seedRequest(f.store, {
      convKey: convKey('sess-fresh-batch'), sessionId: 'sess-fresh-batch',
      startedMs: now - 10 * DAY, generation: 'gen-fresh-batch',
    });

    const first = await purgeExpiredSessions(f.store, {
      cutoffMs: cutoff, reason: 'retention', now, limit: 1, wallMs: 60_000,
    });
    expect(first.candidates).toBe(1);
    expect(first.deleted_sessions).toBe(1);
    expect(first.may_have_more).toBe(true);
    // 最旧优先：先删的是 60 天前那条会话。
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(oldest))
      .toEqual({ n: 0 });

    const second = await purgeExpiredSessions(f.store, {
      cutoffMs: cutoff, reason: 'retention', now, wallMs: 60_000,
    });
    expect(second.candidates).toBe(2);
    expect(second.deleted_sessions).toBe(1);
    expect(second.skipped.derive_dirty).toBe(1);
    expect(second.pending_skipped).toBe(1);
    expect(second.oldest_skip_reason).toBe('derive_dirty');
    expect(second.may_have_more).toBe(false);
    expect(f.store.read.query(
      "SELECT COUNT(*) AS n FROM request WHERE conv_key IN (?,?)").get(oldest, newer))
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(dirty))
      .toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM purged_conversation').get())
      .toEqual({ n: 2 });
  } finally {
    f.close();
  }
});

test('自动 tick 未启用时不动存量，启用后按最后活动时间整会话淘汰', async () => {
  const f = fixture();
  try {
    const now = Date.now();
    const old = convKey('sess-tick-old');
    const fresh = convKey('sess-tick-fresh');
    seedRequest(f.store, {
      convKey: old, sessionId: 'sess-tick-old', startedMs: now - 40 * DAY, generation: 'gen-tick-old',
    });
    seedRequest(f.store, {
      convKey: fresh, sessionId: 'sess-tick-fresh', startedMs: now - 2 * DAY, generation: 'gen-tick-fresh',
    });

    const disabled = await runSessionRetentionTick(f.store,
      { retentionDays: 30, retentionConfigured: false }, { now });
    expect(disabled).toBeNull();
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request').get()).toEqual({ n: 2 });

    const enabled = await runSessionRetentionTick(f.store,
      { retentionDays: 30, retentionConfigured: true }, { now });
    expect(enabled?.cutoff_ms).toBe(now - 30 * DAY);
    expect(enabled?.run.deleted_sessions).toBe(1);
    expect(enabled?.run.deleted_requests).toBe(1);
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(old))
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(fresh))
      .toEqual({ n: 1 });
  } finally {
    f.close();
  }
});

test('95% 磁盘兜底：只删超过 7 天保护线的会话，事件 reason 为 disk_cap', async () => {
  const f = fixture();
  try {
    const now = Date.now();
    const ancient = convKey('sess-cap-ancient');
    const protectedKey = convKey('sess-cap-protected');
    seedRequest(f.store, {
      convKey: ancient, sessionId: 'sess-cap-ancient',
      startedMs: now - 8 * DAY, generation: 'gen-cap-ancient',
    });
    seedRequest(f.store, {
      convKey: protectedKey, sessionId: 'sess-cap-protected',
      startedMs: now - 6 * DAY, generation: 'gen-cap-protected',
    });

    const run = await purgeExpiredSessions(f.store, {
      cutoffMs: now - 7 * DAY, now, reason: 'disk_cap', wallMs: 60_000,
    });
    expect(run.deleted_sessions).toBe(1);
    expect(run.candidates).toBe(1);
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(ancient))
      .toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(protectedKey))
      .toEqual({ n: 1 });
    expect(f.store.read.query(
      "SELECT reason FROM retention_event WHERE action='session_retention'").get())
      .toEqual({ reason: 'disk_cap' });
  } finally {
    f.close();
  }
});
