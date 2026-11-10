import { expect, test } from 'bun:test';
import { fixture } from './fixtures';
import { ingestRequestTx } from '../src/ingest-core';
import type { IngestChannel, IngestIdentity } from '../src/ingest-core';
import { HAVE_BODY, MATCH_BY_RESPONSE_ID, hookConv } from '../src/evidence';

const NOW = 1_790_000_000_000;
const CH: IngestChannel = {
  sourceKind: 'hook', via: 'hook', haveBit: HAVE_BODY, sortSource: 'hook',
  createdRule: MATCH_BY_RESPONSE_ID, createdMergeState: 'pending', emptyBodyState: 'pending',
};
const NORMAL = { mode: 'normal', reason: null } as const;

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
  const f = fixture();
  try {
    f.store.write(db => {
      const first = ingestRequestTx(db, CH, identity('h-1'), BODY, null, NO_CLAIM, NOW, NORMAL);
      expect(first.created).toBe(true);
      expect(first.duplicate).toBe(false);
      let called = false;
      const second = ingestRequestTx(db, CH, identity('h-1'), BODY, null,
        () => { called = true; return { target: null, rule: null, candidates: [] }; }, NOW, NORMAL);
      expect(second.duplicate).toBe(true);
      expect(second.reqId).toBe(first.reqId);
      expect(called).toBe(false); // 判重命中即返回，不进认领
    }, 'test');
    expect((f.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(1);
  } finally { f.close(); }
});

test('认领既有行：不新建，have 置位，证据 merged', () => {
  const f = fixture();
  try {
    f.store.write(db => {
      const target = ingestRequestTx(db, CH, identity('h-target'), null, null, NO_CLAIM, NOW, NORMAL);
      const claimed = ingestRequestTx(db, CH, identity('h-claim'), BODY, null,
        () => ({ target: target.reqId, rule: MATCH_BY_RESPONSE_ID, candidates: [target.reqId] }), NOW, NORMAL);
      expect(claimed.created).toBe(false);
      expect(claimed.reqId).toBe(target.reqId);
      // 写在同一个事务、同一条 writer 连接上读：store.read 是独立只读连接，
      // 看不到本事务未提交的写入。
      const row = db.query<{ have: number; body_state: string }, [number]>(
        'SELECT have, body_state FROM request WHERE req_id=?').get(target.reqId)!;
      expect(row.have & HAVE_BODY).toBe(HAVE_BODY);
      expect(row.body_state).toBe('available');
      const ev = db.query<{ merge_state: string }, [string]>(
        'SELECT merge_state FROM request_evidence WHERE ref_key=?').get('h-claim')!;
      expect(ev.merge_state).toBe('merged');
    }, 'test');
  } finally { f.close(); }
});

test('metadata_only 无骨架降级 partial；已有正文不抹掉', () => {
  const f = fixture();
  try {
    f.store.write(db => {
      const r = ingestRequestTx(db, CH, identity('h-meta'), BODY, null, NO_CLAIM, NOW,
        { mode: 'metadata_only', reason: 'disk_80' });
      const row = db.query<{ body_state: string; miss_reason: string }, [number]>(
        'SELECT body_state, miss_reason FROM request WHERE req_id=?').get(r.reqId)!;
      expect(row.body_state).toBe('partial');
      expect(row.miss_reason).toBe('disk_body_paused');
      // 第二次 normal 带正文：补回 available 并清原因
      ingestRequestTx(db, CH, identity('h-meta-2'), BODY, null,
        () => ({ target: r.reqId, rule: null, candidates: [] }), NOW, NORMAL);
    }, 'test');
    const row = f.store.read.query<{ body_state: string; miss_reason: string | null }, []>(
      'SELECT body_state, miss_reason FROM request WHERE req_id=1').get()!;
    expect(row.body_state).toBe('available');
    expect(row.miss_reason).toBeNull();
  } finally { f.close(); }
});

test('整会话墓碑：早于删除时刻的迟到证据不建行，晚于的按新片段入库', () => {
  const f = fixture();
  try {
    const conv = hookConv('sess-core-0001', 'h-x');
    f.store.write(db => db.run(`
      INSERT INTO purged_conversation(conv_key,purged_at,first_ms,last_ms,request_count,reason,source_kinds)
      VALUES (?,?,?,NULL,1,'retention','["hook"]')`, [conv.key, NOW + 50, NOW]));
    f.store.write(db => {
      let claimed = false;
      const old = ingestRequestTx(db, CH, identity('h-old'), BODY, null,
        () => { claimed = true; return { target: null, rule: null, candidates: [] }; }, NOW, NORMAL);
      expect(old.purged_skip).toBe(true);
      expect(old.reqId).toBe(0);
      expect(claimed).toBe(false);
      const fresh = ingestRequestTx(db, CH, { ...identity('h-new'), startedMs: NOW + 100 },
        BODY, null, NO_CLAIM, NOW + 100, NORMAL);
      expect(fresh.purged_skip).toBe(false);
      expect(fresh.created).toBe(true);
    }, 'test');
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request').get()).toEqual({ n: 1 });
    expect(f.store.read.query('SELECT COUNT(*) AS n FROM request_evidence').get()).toEqual({ n: 1 });
  } finally { f.close(); }
});
