import { expect, test } from 'bun:test';
import { fixture } from './fixtures';
import { drainRequestPurposesTx } from '../src/request-purpose';
import { readSourceFacts } from '../src/sources/facts';
import {
  backfillOperations, previewOperationBackfill,
} from '../src/maintenance/operation-backfill';

type TestStore = ReturnType<typeof fixture>['store'];
const GENERATION = '1:2:3:0';

function seedRequest(store: TestStore, reqId: number, convKey: string): void {
  store.write(db => db.run(
    `INSERT INTO request(req_id,conv_key,actor,actor_state,started_ms,day,via,body_state,
       derive_version,have,created_at,updated_at,req_kind)
     VALUES (?,?,NULL,'unknown',?,?, 'through','pending',0,0,1,1,'chat')`,
    [reqId, convKey, 1000 + reqId, '2026-10-22'],
  ));
}

function addLedger(store: TestStore, reqId: number, row: Record<string, unknown>): void {
  store.write(db => {
    db.run(
      `INSERT INTO raw_ledger(source_kind,file_generation,byte_offset,t_text,t_ms,source,payload_json)
       VALUES ('file',?,?,?,?,'through',?)`,
      [GENERATION, reqId * 10, '2026-10-22T00:00:00Z', Date.parse('2026-10-22T00:00:00Z'), JSON.stringify(row)],
    );
    db.run(
      `INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,added_at) VALUES (?,?,?,?,1)`,
      [reqId, 'ledger', JSON.stringify(['file', GENERATION, reqId * 10]), 'merged'],
    );
  });
}

function operationOf(store: TestStore, reqId: number) {
  return readSourceFacts(store.read.query<{ source_facts_json: string | null }, [number]>(
    'SELECT source_facts_json FROM request WHERE req_id=?').get(reqId)!.source_facts_json)?.operation;
}

test('预览只计事实缺operation且raw带显式值的行，给出分布与会话键', () => {
  const f = fixture();
  try {
    seedRequest(f.store, 1, 'conv-a');
    seedRequest(f.store, 2, 'conv-b');
    seedRequest(f.store, 3, 'conv-a');
    addLedger(f.store, 1, { t: '2026-10-22T00:00:00Z', operation: 'embeddings' });
    addLedger(f.store, 2, { t: '2026-10-22T00:00:00Z', operation: 'generate_content' });
    // raw 无 operation：不是候选，用途走原协议路径。
    addLedger(f.store, 3, { t: '2026-10-22T00:00:00Z' });
    expect(previewOperationBackfill(f.store)).toEqual({
      candidates: 2,
      operations: { embeddings: 1, generate_content: 1 },
      conv_keys: ['conv-a', 'conv-b'],
    });
  } finally { f.close(); }
});

test('回填补齐事实并标脏重判，重复执行幂等', () => {
  const f = fixture();
  try {
    seedRequest(f.store, 1, 'conv-a');
    addLedger(f.store, 1, { t: '2026-10-22T00:00:00Z', operation: 'embeddings', status: 200 });
    const before = f.store.read.query<{ input_revision: number }, [number]>(
      'SELECT input_revision FROM request WHERE req_id=1').get(1)!;
    const report = backfillOperations(f.store, 10);
    expect(report).toMatchObject({ rewritten: 1, skipped: 0, failed: [], remaining: 0 });
    expect(operationOf(f.store, 1)?.values).toEqual(['embeddings']);
    const after = f.store.read.query<{ input_revision: number; purpose_pending: number }, [number]>(
      'SELECT input_revision,purpose_pending FROM request WHERE req_id=1').get(1)!;
    expect(after.input_revision).toBe(before.input_revision + 1);
    expect(after.purpose_pending).toBe(1);
    // 正常重判即升级用途，不需要逐会话 rebuild。
    const drained = f.store.write(db => drainRequestPurposesTx(db, 10));
    expect(drained.applied).toBe(1);
    expect(f.store.read.query<{ purpose_chain: string; req_kind: string }, [number]>(
      'SELECT purpose_chain,req_kind FROM request WHERE req_id=1').get(1))
      .toEqual({ purpose_chain: 'exclude', req_kind: 'embeddings' });
    expect(backfillOperations(f.store, 20)).toMatchObject({ rewritten: 0, remaining: 0 });
  } finally { f.close(); }
});

test('事实已带operation键或损坏的行分别跳过与修复', () => {
  const f = fixture();
  try {
    seedRequest(f.store, 1, 'conv-a');
    seedRequest(f.store, 2, 'conv-a');
    addLedger(f.store, 1, { t: '2026-10-22T00:00:00Z', operation: 'embeddings' });
    addLedger(f.store, 2, { t: '2026-10-22T00:00:00Z', operation: 'rerank' });
    // 行 1 事实已是新格式（即使值为空集合）：不再命中候选。
    f.store.write(db => db.run('UPDATE request SET source_facts_json=? WHERE req_id=1', [
      JSON.stringify({
        format: 1,
        kinds: {
          ledger: { values: [], overflow: false, missing: true, invalid: false },
          route: { values: [], overflow: false, missing: true, invalid: false },
          state: 'missing', value: null,
        },
        operation: { values: [], overflow: false, missing: true, invalid: false },
        hook: { models: { values: [], overflow: false, missing: true, invalid: false }, successes: [] },
        selected: null,
      }),
    ]));
    // 行 2 事实损坏：json_valid 守住候选查询，重投影按缺失重建。
    f.store.write(db => db.run("UPDATE request SET source_facts_json='{' WHERE req_id=2"));
    expect(previewOperationBackfill(f.store).candidates).toBe(1);
    expect(backfillOperations(f.store, 10)).toMatchObject({ rewritten: 1, remaining: 0 });
    expect(operationOf(f.store, 2)?.values).toEqual(['rerank']);
  } finally { f.close(); }
});