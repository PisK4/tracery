import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fixture } from './fixtures';
import { runMaintenance } from '../src/maintenance/cli';
import { verifyDatabase } from '../src/maintenance/verify';
import {
  previewSessionRetention, sessionRetentionCandidates, RETENTION_DAY_MS,
} from '../src/queries/retention-preview';
import type { Store } from '../src/store';

const DAY = RETENTION_DAY_MS;
// 与 CLI 内部的 Date.now() 同基准：数据是「相对现在 40/20/100 天前」，
// 固定写死一个未来时间戳会让 CLI 用真实时间判定时把 40 天前看成未来。
const NOW = Date.now();
const convKey = (id: string): string => JSON.stringify(['session', id]);

type Seed = {
  id: number;
  convKey: string | null;
  sessionId: string | null;
  startedMs: number;
  bodyBytes?: number | null;
  skeleton?: Uint8Array | null;
  purposePending?: number;
};

/** 每个会话用一个独立的 req_id；正文/骨架字节按给定的合成串落库。 */
function seedRequest(store: Store, seed: Seed): void {
  store.write(db => db.run(`
    INSERT INTO request(req_id,conv_key,actor,actor_state,agent,session,conv_source,via,
      started_ms,day,body_state,body_bytes,skeleton_z,derive_version,have,purpose_pending,
      created_at,updated_at)
    VALUES (?,?, 'a','known','claude',?,'session','session', ?, '2026-01-01','available',?,?,0,1,?,1,1)`,
  [seed.id, seed.convKey, seed.sessionId, seed.startedMs,
    seed.bodyBytes ?? null, seed.skeleton ?? null, seed.purposePending ?? 0]));
}

function insertRawSession(
  store: Store, sourceKind: string, generation: string, offset: number,
  sessionId: string | null, payload: string,
): void {
  store.write(db => db.run(`
    INSERT INTO raw_session_event(source_kind,file_generation,byte_offset,session_id,
      line_type,event_at_ms,payload_json,privacy_version)
    VALUES (?,?,?,?,'event',?,?,1)`,
  [sourceKind, generation, offset, sessionId, 1, payload]));
}

function insertRawHook(store: Store, hookId: string, requestZ: Uint8Array, responseZ: Uint8Array): void {
  store.write(db => db.run(`
    INSERT INTO raw_hook(hook_id,received_at,request_z,response_z,parse_state)
    VALUES (?,1,?,?,'ok')`, [hookId, requestZ, responseZ]));
}

function insertHookEvidence(store: Store, reqId: number, refKey: string): void {
  store.write(db => db.run(`
    INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,added_at)
    VALUES (?,'hook',?,'merged',1)`, [reqId, refKey]));
}

function insertBlock(store: Store, hash: string, z: Uint8Array): number {
  return store.write(db => Number(db.run(
    'INSERT INTO block(hash,fingerprint,z,raw_size) VALUES (?,?,?,100)',
    [Buffer.from(hash), hash, z]).lastInsertRowid));
}

function attachBlock(store: Store, reqId: number, ord: number, block: number): void {
  store.write(db => db.run(
    'INSERT INTO request_block(req_id,ord,role,block) VALUES (?,?,0,?)', [reqId, ord, block]));
}

function insertDeriveQueue(store: Store, key: string, state: string): void {
  store.write(db => db.run(
    "INSERT INTO derive_queue(conv_key,actor,from_sort,state) VALUES (?,'a','',?)", [key, state]));
}

function insertSourceGap(
  store: Store, sourceKind: string, sourceName: string, generation: string,
): void {
  store.write(db => db.run(`
    INSERT INTO source_gap(source_kind,source_name,file_generation,from_off,to_off,
      reason,state,updated_at)
    VALUES (?,?,?,0,100,'disk_paused','open',1)`, [sourceKind, sourceName, generation]));
}

function readonlyDb(path: string): Database {
  return new Database(path, { readonly: true });
}

/**
 * 场景：30 天保留期。
 * A：首笔 100 天前、最后活动 40 天前 → 过期可删（整条计入）。
 * B：首笔 100 天前、最后活动 20 天前 → 不过期，整条保留。
 * C：最后活动 40 天前但 derive_queue dirty → 过期，计入 skipped.dirty。
 * D：最后活动 40 天前、挂 open source_gap → 过期，计入 skipped.source_gap。
 */
function seedScenario(store: Store): void {
  const first = NOW - 100 * DAY;
  const old = NOW - 40 * DAY;
  const fresh = NOW - 20 * DAY;
  seedRequest(store, { id: 1, convKey: convKey('A'), sessionId: 'sess-A',
    startedMs: first, bodyBytes: 10, skeleton: Buffer.from('xx') });           // 2B 骨架
  seedRequest(store, { id: 2, convKey: convKey('A'), sessionId: 'sess-A',
    startedMs: old, bodyBytes: 5 });                                            // 5B
  seedRequest(store, { id: 3, convKey: convKey('B'), sessionId: 'sess-B',
    startedMs: first, bodyBytes: 1000 });
  seedRequest(store, { id: 4, convKey: convKey('B'), sessionId: 'sess-B',
    startedMs: fresh, bodyBytes: 1000 });
  seedRequest(store, { id: 5, convKey: convKey('C'), sessionId: 'sess-C',
    startedMs: old, bodyBytes: 7, purposePending: 0 });
  seedRequest(store, { id: 6, convKey: convKey('D'), sessionId: 'sess-D',
    startedMs: old, bodyBytes: 8 });
  // B 的 purpose_pending=1 与 derive clean；保留会话不参与 skipped 统计（只看过期候选）。
  insertDeriveQueue(store, convKey('C'), 'dirty');
  // D 的请求带上与缺口同一代际的 sort_key；关联不上的缺口按「没有缺口」处理，
  // 所以只有真实代际关联才会让预览与删除同时跳过 D。
  store.write(db => db.run(
    "UPDATE request SET sort_key='gen-D|00000000000000000001' WHERE req_id=6"));
  insertSourceGap(store, 'claude_session', 'sess-D', 'gen-D');
  // E：无 conv_key 的孤立请求，100 天前，不构成会话，不进任何计数。
  seedRequest(store, { id: 7, convKey: null, sessionId: null, startedMs: first, bodyBytes: 9999 });

  // 原始会话层：A 两行（含多字节字符），B 一行，C 一行，D 一行，外加一行无人引用。
  const utf8 = 'é';  // 2 字节 UTF-8
  insertRawSession(store, 'claude_session', 'gen-A', 1, 'sess-A', 'aaaa');
  insertRawSession(store, 'claude_session', 'gen-A', 2, 'sess-A', utf8);
  insertRawSession(store, 'claude_session', 'gen-B', 1, 'sess-B', 'bbbbbbbb');
  insertRawSession(store, 'claude_session', 'gen-C', 1, 'sess-C', 'cccc');
  insertRawSession(store, 'claude_session', 'gen-D', 1, 'sess-D', 'dddd');
  insertRawSession(store, 'claude_session', 'gen-Orphan', 1, null, 'zzzzzz');

  // raw_hook：A 的两笔请求各关联一个 hook；C 一笔关联；另有一行无人引用。
  // request_z + response_z 字节数：A=3+4=7、A2=2+5=7 ...
  insertRawHook(store, 'hook-A1', Buffer.from([1, 2, 3]), Buffer.from([1, 2, 3, 4])); // 7
  insertRawHook(store, 'hook-A2', Buffer.from([1, 2]), Buffer.from([1, 2, 3, 4, 5]));  // 7
  insertHookEvidence(store, 1, 'hook-A1');
  insertHookEvidence(store, 2, 'hook-A2');
  insertRawHook(store, 'hook-C', Buffer.from([1]), Buffer.from([1, 2]));               // 3
  insertHookEvidence(store, 5, 'hook-C');
  insertRawHook(store, 'hook-Orphan', Buffer.from([1, 2, 3, 4]), Buffer.from([1]));    // 5

  // block：A 独占 3B，A 与 B 共享 5B。共享块在 B 存活时不会随 A 释放。
  const aOnly = insertBlock(store, 'blk-A', Buffer.from([1, 2, 3]));
  const shared = insertBlock(store, 'blk-AB', Buffer.from([1, 2, 3, 4, 5]));
  attachBlock(store, 1, 0, aOnly);
  attachBlock(store, 1, 1, shared);
  attachBlock(store, 3, 0, shared);
}

test('30 天保留期：A 计入删除候选，B 保留，C/D 计入 skipped', () => {
  const f = fixture();
  try {
    seedScenario(f.store);
    const db = readonlyDb(join(f.dir, 'trace.db'));
    try {
      const cutoffMs = NOW - 30 * DAY;
      // 候选池 = 所有过期的完整会话（含被守卫跳过的），最旧优先。
      const candidates = sessionRetentionCandidates(db, cutoffMs, 100000);
      expect(candidates).toEqual([
        { conv_key: convKey('A'), last_ms: NOW - 40 * DAY, request_count: 2 },
        { conv_key: convKey('C'), last_ms: NOW - 40 * DAY, request_count: 1 },
        { conv_key: convKey('D'), last_ms: NOW - 40 * DAY, request_count: 1 },
      ]);

      const preview = previewSessionRetention(db, 30, NOW);
      expect(preview).toMatchObject({
        keep_days: 30, cutoff_ms: cutoffMs,
        sessions: 1, requests: 2,
        first_ms: NOW - 100 * DAY, last_ms: NOW - 40 * DAY, oldest_ms: NOW - 40 * DAY,
      });
      expect(preview.skipped).toEqual({
        dirty: 1, purpose_pending: 0, source_gap: 1, in_flight: 0,
      });
    } finally { db.close(); }
  } finally { f.close(); }
});

test('bytes 口径与手写 SQL 一致，且只算可删的目标会话', () => {
  const f = fixture();
  try {
    seedScenario(f.store);
    const db = readonlyDb(join(f.dir, 'trace.db'));
    try {
      const p = previewSessionRetention(db, 30, NOW);
      // 手写 SQL 按「本轮可删的会话」字面范围（只有 A）独立计算，不复用被测查询。
      const a = convKey('A');

      // readable_body：物理正文估算——A 引用的 block 3+5B + 骨架 2B = 10B；
      // 共享块按引用计入（精确扣除要扫 34M 行，生产差额只有 2KB）。
      const readable = db.query<{ n: number }, [string, string]>(`
        SELECT IFNULL(SUM(length(b.z)),0)
          + (SELECT IFNULL(SUM(length(skeleton_z)),0) FROM request WHERE conv_key=?) AS n
        FROM block b
        WHERE b.id IN (
          SELECT rb.block FROM request_block rb
          JOIN request r ON r.req_id=rb.req_id
          WHERE r.conv_key=?
        )`).get(a, a)!.n;
      // session_raw：A 的 session_id='sess-A' 两行 = 4 + 2（UTF-8 'é'）。
      const sessionRaw = db.query<{ n: number }, [string]>(`
        SELECT IFNULL(SUM(length(CAST(payload_json AS BLOB))),0) AS n
        FROM raw_session_event WHERE session_id IN (
          SELECT DISTINCT session FROM request WHERE conv_key=? AND session IS NOT NULL
        )`).get(a)!.n;
      // raw_hook：A 两个 hook 证据 = 7+7=14；C 的 hook 属于被跳过会话，不计。
      const hook = db.query<{ n: number }, [string]>(`
        SELECT IFNULL(SUM(IFNULL(length(h.request_z),0)+IFNULL(length(h.response_z),0)),0) AS n
        FROM raw_hook h WHERE h.hook_id IN (
          SELECT e.ref_key FROM request_evidence e JOIN request r ON r.req_id=e.req_id
          WHERE e.source_kind='hook' AND r.conv_key=?
        )`).get(a)!.n;

      expect(p.bytes).toEqual({ readable_body: 10, session_raw: 6, raw_hook: 14 });
      expect(p.bytes.readable_body).toBe(readable);
      expect(p.bytes.session_raw).toBe(sessionRaw);
      expect(p.bytes.raw_hook).toBe(hook);
    } finally { db.close(); }
  } finally { f.close(); }
});

test('预览只读：调用前后 request/raw_session_event 行数与 user_version 不变', () => {
  const f = fixture();
  try {
    seedScenario(f.store);
    const path = join(f.dir, 'trace.db');
    const before = readonlyDb(path);
    const requestCount = before.query('SELECT COUNT(*) AS n FROM request').get() as { n: number };
    const rawCount = before.query('SELECT COUNT(*) AS n FROM raw_session_event').get() as { n: number };
    const version = before.query('PRAGMA user_version').get() as { user_version: number };
    before.close();

    const db = readonlyDb(path);
    try { previewSessionRetention(db, 30, NOW); } finally { db.close(); }

    const after = readonlyDb(path);
    try {
      expect(after.query('SELECT COUNT(*) AS n FROM request').get()).toEqual(requestCount);
      expect(after.query('SELECT COUNT(*) AS n FROM raw_session_event').get()).toEqual(rawCount);
      expect(after.query('PRAGMA user_version').get()).toEqual(version);
    } finally { after.close(); }
  } finally { f.close(); }
});

test('只读预览带出最近一次会话淘汰事件：无事件为 null，有事件返回该条', () => {
  const f = fixture();
  try {
    seedScenario(f.store);
    const db = readonlyDb(join(f.dir, 'trace.db'));
    try {
      expect(previewSessionRetention(db, 30, NOW).last_cleanup).toBeNull();
    } finally { db.close(); }

    // 合成一条较早与一条最近的事件，只认 action='session_retention' 且按 at_ms 取最新。
    f.store.write(writeDb => {
      writeDb.run(`INSERT INTO retention_event(at_ms,action,request_count,reason)
        VALUES (100,'session_retention',3,'manual:30d')`);
      writeDb.run(`INSERT INTO retention_event(at_ms,action,request_count,reason)
        VALUES (200,'session_retention',7,'manual:7d')`);
      writeDb.run(`INSERT INTO retention_event(at_ms,action,request_count,reason)
        VALUES (300,'other_action',99,'ignored')`);
    });
    const after = readonlyDb(join(f.dir, 'trace.db'));
    try {
      expect(previewSessionRetention(after, 30, NOW).last_cleanup)
        .toEqual({ at_ms: 200, request_count: 7, reason: 'manual:7d' });
    } finally { after.close(); }
  } finally { f.close(); }
});

test('maintain retention-preview 输出一行 JSON，flag 校验与只读一致', async () => {
  const f = fixture();
  try {
    seedScenario(f.store);
    const path = join(f.dir, 'trace.db');
    const lines: string[] = [];
    const errs: string[] = [];
    const io = { out: (line: string) => lines.push(line), err: (line: string) => errs.push(line) };
    expect(await runMaintenance(['retention-preview', '--db', path, '--keep-days', '30'], io)).toBe(0);
    expect(lines.length).toBe(1);
    const report = JSON.parse(lines[0]!);
    // CLI 用真实时间，30 天前的合成数据同样过期；结构字段与 preview 一致。
    expect(report).toMatchObject({
      keep_days: 30, sessions: 1, requests: 2,
      skipped: { dirty: 1, purpose_pending: 0, source_gap: 1, in_flight: 0 },
      bytes: { readable_body: 10, session_raw: 6, raw_hook: 14 },
    });
    expect(report.cutoff_ms).toBeGreaterThan(0);

    // --keep-days 必填且为正整数；--limit 非法按用法拒绝。
    lines.length = 0;
    expect(await runMaintenance(['retention-preview', '--db', path], io)).toBe(2);
    expect(await runMaintenance(['retention-preview', '--db', path, '--keep-days', '0'], io)).toBe(2);
    expect(await runMaintenance(['retention-preview', '--db', path, '--keep-days', 'abc'], io)).toBe(2);
    expect(await runMaintenance(['retention-preview', '--db', path, '--keep-days', '30',
      '--limit', '-1'], io)).toBe(2);
    expect(lines.length).toBe(0);

    // --limit 生效：最多只纳入 1 个过期会话。
    lines.length = 0;
    expect(await runMaintenance(['retention-preview', '--db', path, '--keep-days', '30',
      '--limit', '1'], io)).toBe(0);
    expect(JSON.parse(lines[0]!).sessions).toBe(1);  // 最旧的 A 可删
  } finally { f.close(); }
});

test('purpose_pending 命中也计入 skipped 且该会话不计入删除量', () => {
  const f = fixture();
  try {
    f.store.write(db => db.run(`
      INSERT INTO request(req_id,conv_key,actor,actor_state,started_ms,day,via,body_state,
        derive_version,have,purpose_pending,created_at,updated_at)
      VALUES (1,?,'a','known',?,'2026-01-01','hook','available',0,1,1,1,1)`,
    [convKey('P'), NOW - 40 * DAY]));
    const db = readonlyDb(join(f.dir, 'trace.db'));
    try {
      const p = previewSessionRetention(db, 30, NOW);
      expect(p.sessions).toBe(0);
      expect(p.skipped.purpose_pending).toBe(1);
      expect(p.first_ms).toBeNull();
      expect(p.bytes).toEqual({ readable_body: 0, session_raw: 0, raw_hook: 0 });
    } finally { db.close(); }
  } finally { f.close(); }
});

test('maintain retention-apply 默认只预览，--apply 需审批并整会话删除', async () => {
  const f = fixture();
  try {
    seedScenario(f.store);
    const path = join(f.dir, 'trace.db');
    const lines: string[] = [];
    const errs: string[] = [];
    const io = { out: (line: string) => lines.push(line), err: (line: string) => errs.push(line) };

    expect(await runMaintenance(['retention-apply', '--db', path, '--keep-days', '30'], io)).toBe(0);
    const preview = JSON.parse(lines[0]!);
    expect(preview).toMatchObject({ ok: true, applied: false });
    expect(preview.preview.sessions).toBe(1);
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request').get()).toEqual({ n: 7 });

    lines.length = 0;
    expect(await runMaintenance([
      'retention-apply', '--db', path, '--keep-days', '30', '--apply',
    ], io)).toBe(1);
    expect(JSON.parse(lines[0]!).error).toBe('approval_id_required');
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request').get()).toEqual({ n: 7 });

    lines.length = 0;
    expect(await runMaintenance([
      'retention-apply', '--db', path, '--keep-days', '30', '--apply',
      '--approval-id', 'approval-synthetic-retention',
    ], io)).toBe(0);
    const applied = JSON.parse(lines[0]!);
    expect(applied).toMatchObject({
      ok: true, applied: true, deleted_sessions: 1, deleted_requests: 2,
    });
    expect(applied.skipped.derive_dirty).toBe(1);
    expect(applied.skipped.source_gap).toBe(1);
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request WHERE conv_key=?')
      .get(convKey('A'))).toEqual({ n: 0 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request').get()).toEqual({ n: 5 });
    expect(f.store.read.query(
      'SELECT action, reason FROM retention_event').get())
      .toEqual({ action: 'session_retention', reason: 'manual:30d' });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM purged_conversation').get())
      .toEqual({ n: 1 });
    expect(verifyDatabase(path).purged_conversation_residue).toBe(0);
  } finally { f.close(); }
});
