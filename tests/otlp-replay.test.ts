import { expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { fixture } from './fixtures';
import { SYNTH } from './otlp-fixtures';
import { previewOtlpReplay, replayOtlpMapping } from '../src/maintenance/otlp-replay';
import { OTLP_MAPPING_VERSION } from '../src/sources/otlp/mapping';

const NOW = 1_790_000_000_000;
const SALT = new Uint8Array(32);
const TRACE = Buffer.from(SYNTH.traceA);
const SPAN_LLM = Buffer.from(SYNTH.spanLLM);
const SPAN_TOOL = Buffer.from(SYNTH.spanTool);

/** 直接插一行 v3 raw：重放的输入不是 HTTP 载荷，是历史版本落下的原始层。 */
function insertRawV3(db: Database, spanId: Buffer, name: string, attrs: Record<string, unknown>, receivedAt: number): void {
  db.run(
    `INSERT INTO raw_otlp_span(
       trace_id,span_id,received_at,service,scope_name,name,kind,start_ms,end_ms,status_code,
       attributes_json,mapping_version,privacy_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [new Uint8Array(TRACE), new Uint8Array(spanId), receivedAt, 'codex-app-server', 'synth-scope',
      name, 3, 1_792_946_000_000, 1_792_946_003_200, 0, JSON.stringify(attrs), 3, 1],
  );
}

const TURN_ATTRS = {
  'thread.id': 'thread-synth-0001',
  'turn.id': 'turn-synth-0001',
  model: 'synth-codex-model',
  'codex.turn.token_usage.input_tokens': 1200,
  'codex.turn.token_usage.output_tokens': 45,
  'codex.turn.token_usage.cached_input_tokens': 3000,
  'codex.turn.token_usage.cache_write_input_tokens': 500,
};

test('v3 turn span 重放：认领既有 magpie 行只写证据，版本回写 4，连跑幂等', () => {
  const { store } = fixture();
  try {
    store.write(db => {
      db.run(`
        INSERT INTO request(agent,session,conv_key,conv_source,actor,actor_state,
          started_ms,day,via,model_requested,body_state,derive_version,have,created_at,updated_at,turn_ref)
        VALUES ('codex','thread-synth-0001',?,'session','thread-synth-0001','known',
          ?, '2026-10-26','hook','synth-codex-model','missing',0,1,?,?, 'turn-synth-0001')`,
        [JSON.stringify(['session', 'thread-synth-0001']), 1_792_946_000_000, NOW, NOW]);
      insertRawV3(db, SPAN_LLM, 'session_task.turn', TURN_ATTRS, NOW - 1000);
    });

    const preview = previewOtlpReplay(store.read, NOW);
    expect(preview).toEqual({ scanned: 1, evidence: 1, wouldCreate: 0, unknownShape: 0, skipped: 0, expired: 0 });

    const report = replayOtlpMapping(store, NOW, SALT);
    expect(report).toEqual({ scanned: 1, evidenceAdded: 1, requestsCreated: 0, unknownShape: 0, skipped: 0, versionBumped: 1 });
    // 验收口径：新建行 0、证据 1、落在既有行上。
    expect((store.read.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM request').get()?.n ?? 0)).toBe(1);
    const evidence = store.read.query<{ req_id: number; match_rule: string }, []>(
      "SELECT req_id, match_rule FROM request_evidence WHERE source_kind='otlp_span'").all();
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.match_rule).toBe('trace_span.v1');
    expect(evidence[0]!.req_id).toBe(1);
    // raw 原样保留（received_at 不刷新），只有 mapping_version 前进。
    const raw = store.read.query<{ received_at: number; mapping_version: number }, []>(
      'SELECT received_at, mapping_version FROM raw_otlp_span').get()!;
    expect(raw.received_at).toBe(NOW - 1000);
    expect(raw.mapping_version).toBe(OTLP_MAPPING_VERSION);

    const second = replayOtlpMapping(store, NOW, SALT);
    expect(second.scanned).toBe(0);
  } finally {
    store.close();
  }
});

test('无承载行的 v3 turn span 重放新建请求行；skipped span 只升版本不建行', () => {
  const { store } = fixture();
  try {
    store.write(db => {
      insertRawV3(db, SPAN_LLM, 'session_task.turn', TURN_ATTRS, NOW - 1000);
      // 白名单服务、非 LLM 名称：重放判 skipped，也要回写版本。
      insertRawV3(db, SPAN_TOOL, 'session_task.compact', { 'thread.id': 'thread-synth-0001' }, NOW - 1000);
    });
    const preview = previewOtlpReplay(store.read, NOW);
    expect(preview).toEqual({ scanned: 2, evidence: 0, wouldCreate: 1, unknownShape: 0, skipped: 1, expired: 0 });

    const report = replayOtlpMapping(store, NOW, SALT);
    expect(report).toEqual({ scanned: 2, evidenceAdded: 0, requestsCreated: 1, unknownShape: 0, skipped: 1, versionBumped: 2 });
    const row = store.read.query<{ agent: string; turn_ref: string | null; via: string }, []>(
      'SELECT agent, turn_ref, via FROM request').get()!;
    expect(row).toEqual({ agent: 'codex', turn_ref: 'turn-synth-0001', via: 'otlp' });
    // 连跑两遍：第二次扫到 0（skipped 的版本也已回写）。
    expect(replayOtlpMapping(store, NOW, SALT).scanned).toBe(0);
  } finally {
    store.close();
  }
});

test('过保留期的 v3 行预览计 expired，重放不再产出（已被清理前的快照口径）', () => {
  const { store } = fixture();
  try {
    store.write(db => {
      // received_at 早于 now-7d：清理任务按这个时刻判过期。
      insertRawV3(db, SPAN_LLM, 'session_task.turn', TURN_ATTRS, NOW - 8 * 86_400_000);
    });
    const preview = previewOtlpReplay(store.read, NOW);
    expect(preview.expired).toBe(1);
    // 过期不改变分类结果：仍会被判 llm，只是清理任务随时可能把它删掉。
    expect(preview).toEqual({ scanned: 1, evidence: 0, wouldCreate: 1, unknownShape: 0, skipped: 0, expired: 1 });
  } finally {
    store.close();
  }
});
