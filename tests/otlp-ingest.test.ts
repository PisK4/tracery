import { expect, test } from 'bun:test';
import { acceptOtlpTraces } from '../src/sources/otlp/ingest';
import { decodeTracesBody } from '../src/sources/otlp/decode';
import { localDay } from '../src/format';
import { SYNTH, tracesProtobuf } from './otlp-fixtures';
import { fixture } from './fixtures';

const NOW = 1_790_000_000_000;
/** 与真实 OMP chat span 同形状、不同值的合成 span。 */
const OMP_CHAT = {
  traceId: SYNTH.traceA,
  spanId: SYNTH.spanLLM,
  name: 'chat synth-model-lite',
  kind: 3,
  startNano: SYNTH.msToNano(1_792_945_426_098),
  endNano: SYNTH.msToNano(1_792_945_428_830),
  attrs: {
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': 'synth-model-lite',
    'gen_ai.response.model': 'synth-model-lite-served',
    'gen_ai.response.id': SYNTH.responseId,
    'gen_ai.conversation.id': SYNTH.session,
    'gen_ai.response.finish_reasons': { arr: ['stop'] },
    'gen_ai.usage.input_tokens': { int: 8233 },
    'gen_ai.usage.output_tokens': { int: 3 },
    'gen_ai.usage.cache_read.input_tokens': { int: 128 },
    'gen_ai.usage.cache_creation.input_tokens': { int: 256 },
  },
};

function ingestOmp(payload: { resource: { service: string }; spans: typeof OMP_CHAT[] }[],
  salt = new Uint8Array(32)) {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf(payload), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, salt);
    return { store, result };
  } catch (error) {
    store.close();
    throw error;
  }
}

/** 与 Codex turn span 同形状的合成 span：字段清单取自固定提交源码考察，值全自造。 */
const CODEX_TURN = {
  traceId: SYNTH.traceB,
  spanId: SYNTH.spanLLM,
  name: 'session_task.turn',
  startNano: SYNTH.msToNano(1_792_946_000_000),
  endNano: SYNTH.msToNano(1_792_946_003_200),
  attrs: {
    'thread.id': 'thread-synth-0001',
    'turn.id': 'turn-synth-0001',
    model: 'synth-codex-model',
    'codex.turn.token_usage.input_tokens': { int: 1200 },
    'codex.turn.token_usage.cached_input_tokens': { int: 3000 },
    'codex.turn.token_usage.cache_write_input_tokens': { int: 500 },
    'codex.turn.token_usage.non_cached_input_tokens': { int: 1100 },
    'codex.turn.token_usage.output_tokens': { int: 45 },
    'codex.turn.token_usage.reasoning_output_tokens': { int: 20 },
    'codex.turn.token_usage.total_tokens': { int: 4745 },
  },
};

test('OMP chat span 落库：via=otlp、have=8、白名单列映射、conv 与 magpie 同组键', () => {
  const { store, result } = ingestOmp([{ resource: { service: 'oh-my-pi' }, spans: [OMP_CHAT] }]);
  try {
    expect(result).toEqual({ spans: 1, spanDuplicates: 0, requestsCreated: 1, unknownShape: 0, unknownServices: 0, skipped: 0, bodiesWired: 0 });
    const row = store.store.read.query(`
      SELECT via, have, body_state, agent, session, conv_key, conv_source, actor, actor_state,
        started_ms, stop, model_requested, model_served, in_tok, out_tok, cache_read, cache_write,
        response_id_norm, sort_source, sort_key, cost_state
      FROM request`).get() as Record<string, unknown>;
    expect(row.via).toBe('otlp');
    expect(row.have).toBe(8);
    expect(row.body_state).toBe('summary');
    expect(row.agent).toBe('omp');
    expect(row.session).toBe(SYNTH.session);
    // 组键与 sessionRef 逐字相同：同会话双通道并存落同一派生组。
    expect(row.conv_key).toBe(JSON.stringify(['session', SYNTH.session]));
    expect(row.conv_source).toBe('otlp-session');
    expect(row.actor).toBe(SYNTH.session);
    expect(row.actor_state).toBe('known');
    expect(row.started_ms).toBe(1_792_945_426_098);
    expect(row.stop).toBe('stop');
    expect(row.model_requested).toBe('synth-model-lite');
    expect(row.model_served).toBe('synth-model-lite-served');
    expect(row.in_tok).toBe(8233);
    expect(row.out_tok).toBe(3);
    expect(row.cache_read).toBe(128);
    expect(row.cache_write).toBe(256);
    // 原生方言不映射锚点；全量 profile 才写 response_id_norm
    expect(row.response_id_norm).toBeNull();
    expect(row.sort_source).toBe('otlp_span');
    expect(row.cost_state).toBe('absent');
    const evidence = store.store.read.query(
      'SELECT req_id, source_kind, ref_key, merge_state, match_rule FROM request_evidence').all();
    expect(evidence).toEqual([{
      req_id: 1, source_kind: 'otlp_span',
      ref_key: `${Buffer.from(SYNTH.traceA).toString('hex')}/${Buffer.from(SYNTH.spanLLM).toString('hex')}`,
      merge_state: 'merged', match_rule: 'trace_span.v1',
    }]);
    // 有会话 id 的行进派生队列。
    const queued = store.store.read.query(
      'SELECT COUNT(*) AS n FROM derive_queue WHERE conv_key=?').get(SYNTH.session ? JSON.stringify(['session', SYNTH.session]) : '');
    expect((queued as { n: number }).n).toBe(1);
    const raw = store.store.read.query(
      'SELECT service, name, start_ms, end_ms, mapping_version FROM raw_otlp_span').all();
    expect(raw).toHaveLength(1);
  } finally {
    store.close();
  }
});

test('同一批次重发两次：第二次全为重复，不产生新行', () => {
  const store = fixture();
  try {
    const payload = () => decodeTracesBody(
      tracesProtobuf([{ resource: { service: 'oh-my-pi' }, spans: [OMP_CHAT] }]), 'protobuf');
    const salt = new Uint8Array(32);
    const first = acceptOtlpTraces(store.store, payload(), NOW, salt);
    const second = acceptOtlpTraces(store.store, payload(), NOW + 1000, salt);
    expect(first.requestsCreated).toBe(1);
    expect(second).toEqual({ spans: 1, spanDuplicates: 1, requestsCreated: 0, unknownShape: 0, unknownServices: 0, skipped: 0, bodiesWired: 0 });
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(1);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM raw_otlp_span').get() as { n: number }).n).toBe(1);
  } finally {
    store.close();
  }
});

test('CC 一棵 span 树只建 llm_request 行：interaction 不出现在请求列表', () => {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([
      { resource: { service: 'claude-code' }, spans: [
        {
          traceId: SYNTH.traceB, spanId: SYNTH.spanInteraction, name: 'claude_code.interaction',
          startNano: SYNTH.msToNano(1000), endNano: SYNTH.msToNano(2500),
          attrs: { 'gen_ai.conversation.id': SYNTH.session, 'session.id': SYNTH.session, 'gen_ai.operation.name': 'invoke_agent' },
        },
        {
          traceId: SYNTH.traceB, spanId: SYNTH.spanLLM, name: 'claude_code.llm_request',
          startNano: SYNTH.msToNano(1100), endNano: SYNTH.msToNano(2400),
          attrs: {
            'gen_ai.conversation.id': SYNTH.session,
            'gen_ai.request.model': 'synth-cc-model',
            stop_reason: 'end_turn',
            input_tokens: { int: 4888 },
            output_tokens: { int: 3 },
            cache_read_tokens: { int: 8192 },
            cache_creation_tokens: { int: 0 },
          },
        },
        {
          traceId: SYNTH.traceB, spanId: SYNTH.spanTool, name: 'claude_code.tool_use',
          startNano: SYNTH.msToNano(1200), endNano: SYNTH.msToNano(1300),
          attrs: { 'gen_ai.tool.call.id': 'toolu_synthetic_1' },
        },
      ] },
    ]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result.spans).toBe(3);
    expect(result.requestsCreated).toBe(1);
    expect(result.unknownShape).toBe(0);
    // 白名单外的两份 span 留在原始层作元数据。
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM raw_otlp_span').get() as { n: number }).n).toBe(3);
    const row = store.store.read.query(
      'SELECT agent, stop, in_tok, cache_read, model_served FROM request').get() as Record<string, unknown>;
    expect(row.agent).toBe('claude');
    expect(row.stop).toBe('end_turn');
    expect(row.in_tok).toBe(4888);
    expect(row.cache_read).toBe(8192);
    // CC 抓样里没有 gen_ai.response.model：按缺失保持 NULL。
    expect(row.model_served).toBeNull();
  } finally {
    store.close();
  }
});

test('Codex turn span 落库：session 取 thread.id，四项用量取自有键族，未映射项留原始层', () => {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([
      { resource: { service: 'codex-app-server' }, spans: [CODEX_TURN] },
    ]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result.requestsCreated).toBe(1);
    const row = store.store.read.query(`
      SELECT via, have, agent, session, model_requested, model_served, stop,
        in_tok, out_tok, cache_read, cache_write, conv_source, turn_ref
      FROM request`).get() as Record<string, unknown>;
    expect(row.via).toBe('otlp');
    expect(row.have).toBe(8);
    expect(row.agent).toBe('codex');
    expect(row.session).toBe('thread-synth-0001');
    // turn.id 是两路共享的身份，落库供 magpie 侧去重。
    expect(row.turn_ref).toBe('turn-synth-0001');
    expect(row.model_requested).toBe('synth-codex-model');
    // Codex 无回复侧模型与终止原因字段：按缺失保持 NULL，不拿相邻字段顶替。
    expect(row.model_served).toBeNull();
    expect(row.stop).toBeNull();
    expect(row.in_tok).toBe(1200);
    expect(row.out_tok).toBe(45);
    expect(row.cache_read).toBe(3000);
    expect(row.cache_write).toBe(500);
    expect(row.conv_source).toBe('otlp-session');
    // 七项用量里不进既有列的三项留在原始层，不丢。
    const raw = JSON.parse((store.store.read.query<{ attributes_json: string }, []>(
      'SELECT attributes_json FROM raw_otlp_span').get()!).attributes_json);
    expect(raw['codex.turn.token_usage.non_cached_input_tokens']).toBe(1100);
    expect(raw['codex.turn.token_usage.reasoning_output_tokens']).toBe(20);
    expect(raw['codex.turn.token_usage.total_tokens']).toBe(4745);
  } finally {
    store.close();
  }
});

test('Codex 的 compact 与 user_shell 任务 span 不建行，也不进未知桶', () => {  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([
      { resource: { service: 'codex-app-server' }, spans: [
        { ...CODEX_TURN, name: 'session_task.compact', spanId: SYNTH.spanTool },
        { ...CODEX_TURN, name: 'session_task.user_shell', spanId: SYNTH.spanInteraction },
      ] },
    ]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result.spans).toBe(2);
    expect(result.requestsCreated).toBe(0);
    // 自有键族不在 LLM 形状判据里：旁路任务静默落原始层，不刷未知桶。
    expect(result.unknownShape).toBe(0);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(0);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM raw_otlp_span').get() as { n: number }).n).toBe(2);
  } finally {
    store.close();
  }
});

test('Codex originator 家族各取值都命中同一条规则；家族外的服务仍走门铃', () => {
  const family = ['codex-app-server', 'codex-exec-server', 'codex-cli-rs', 'codex-tui', 'codex-vscode', 'codex-mcp-server'];
  for (const service of family) {
    const store = fixture();
    try {
      const decoded = decodeTracesBody(tracesProtobuf([
        { resource: { service }, spans: [CODEX_TURN] },
      ]), 'protobuf');
      const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
      expect({ service, created: result.requestsCreated, unknownServices: result.unknownServices })
        .toEqual({ service, created: 1, unknownServices: 0 });
      expect((store.store.read.query('SELECT agent FROM request').get() as { agent: string }).agent).toBe('codex');
    } finally {
      store.close();
    }
  }
  // 家族外取值不因「看起来像 Codex」而被收：仍只落原始层并记门铃。
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([
      { resource: { service: 'codex_unknown_entry' }, spans: [CODEX_TURN] },
    ]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result.requestsCreated).toBe(0);
    expect(result.unknownServices).toBe(1);
  } finally {
    store.close();
  }
});

test('span 不带会话 id：行可查但没有 conv_key，也不进派生队列', () => {  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'oh-my-pi' }, spans: [{
      traceId: SYNTH.traceA, spanId: SYNTH.spanLLM, name: 'chat synth-model-lite',
      startNano: SYNTH.msToNano(1), attrs: { 'gen_ai.operation.name': 'chat' },
    }] }]), 'protobuf');
    acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    const row = store.store.read.query(
      'SELECT conv_key, conv_source, actor, actor_state FROM request').get() as Record<string, unknown>;
    expect(row.conv_key).toBeNull();
    expect(row.conv_source).toBeNull();
    expect(row.actor).toBeNull();
    expect(row.actor_state).toBe('unknown');
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM derive_queue').get() as { n: number }).n).toBe(0);
  } finally {
    store.close();
  }
});

test('登记服务的非 LLM 内部 span 计数为 skipped：落原始层、不建行、不记 issue', () => {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'claude-code' }, spans: [{
      traceId: SYNTH.traceA,
      spanId: SYNTH.spanTool,
      name: 'fs.read_file',
      startNano: SYNTH.msToNano(1),
      attrs: { 'fs.path': 'synthetic/path' },
    }] }]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result).toEqual({
      spans: 1, spanDuplicates: 0, requestsCreated: 0, unknownShape: 0,
      unknownServices: 0, skipped: 1, bodiesWired: 0,
    });
    // 原始层照旧保留，事后仍能判断是规则漏识别还是上游没发。
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM raw_otlp_span').get() as { n: number }).n).toBe(1);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(0);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM ingest_issue').get() as { n: number }).n).toBe(0);
  } finally {
    store.close();
  }
});

test('LLM 形状但选取规则没认的 span 进未知桶，不按形状兜底建行', () => {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'oh-my-pi' }, spans: [{
      traceId: SYNTH.traceA, spanId: SYNTH.spanLLM, name: 'chat-stream synth-model',
      startNano: SYNTH.msToNano(1),
      attrs: {
        'gen_ai.operation.name': 'chat_stream',
        'gen_ai.usage.input_tokens': { int: 10 },
      },
    }] }]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result).toEqual({ spans: 1, spanDuplicates: 0, requestsCreated: 0, unknownShape: 1, unknownServices: 0, skipped: 0, bodiesWired: 0 });
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(0);
    const issues = store.store.read.query<{ reason: string }, [string]>(
      'SELECT reason FROM ingest_issue WHERE source_kind=?').all('otlp_span');
    expect(issues).toEqual([{ reason: 'span_shape_unknown' }]);
  } finally {
    store.close();
  }
});

test('白名单外的服务不建行：span 落原始层，按服务与日聚合记 service_not_registered', () => {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'some-other-harness' }, spans: [
      { ...OMP_CHAT, name: 'chat whatever' },
      { ...OMP_CHAT, spanId: SYNTH.spanTool, name: 'chat another' },
    ] }]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result).toEqual({ spans: 2, spanDuplicates: 0, requestsCreated: 0, unknownShape: 0, unknownServices: 2, skipped: 0, bodiesWired: 0 });
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(0);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM raw_otlp_span').get() as { n: number }).n).toBe(2);
    // 同服务同日只记一行门铃 issue，ref_key 聚合到服务与日，不逐 span 刷表。
    const issues = store.store.read.query<{ ref_key: string; reason: string }, [string]>(
      'SELECT ref_key, reason FROM ingest_issue WHERE source_kind=?').all('otlp_span');
    expect(issues).toEqual([
      { ref_key: `service/some-other-harness/${localDay(NOW)}`, reason: 'service_not_registered' },
    ]);
  } finally {
    store.close();
  }
});

test('未登记服务的门铃按日聚合：同日重发不新增，跨日新记一行', () => {
  const store = fixture();
  try {
    const payloadAt = () => decodeTracesBody(tracesProtobuf([{ resource: { service: 'another-one' }, spans: [
      { ...OMP_CHAT, name: 'chat x' },
    ] }]), 'protobuf');
    // 未登记服务的 span 不建行、不写证据，重发时每个 span 都会再见到。
    acceptOtlpTraces(store.store, payloadAt(), NOW, new Uint8Array(32));
    acceptOtlpTraces(store.store, payloadAt(), NOW + 1000, new Uint8Array(32));
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM ingest_issue').get() as { n: number }).n).toBe(1);
    acceptOtlpTraces(store.store, payloadAt(), NOW + 3 * 86_400_000, new Uint8Array(32));
    const rows = store.store.read.query<{ ref_key: string }, []>(
      'SELECT ref_key FROM ingest_issue ORDER BY ref_key').all();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.ref_key).toBe(`service/another-one/${localDay(NOW + 3 * 86_400_000)}`);
  } finally {
    store.close();
  }
});

test('凭证形态属性脱敏后才进原始层；映射列不受影响', () => {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'oh-my-pi' }, spans: [{
      ...OMP_CHAT,
      attrs: {
        ...OMP_CHAT.attrs,
        'gen_ai.input.messages': {
          arr: [
            { kv: { role: 'user' } },
            { kv: { content: 'token sk-synthcredential000000 Abbott' } },
          ],
        },
      },
    }] }]), 'protobuf');
    acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    const raw = store.store.read.query<{ attributes_json: string }, []>(
      'SELECT attributes_json FROM raw_otlp_span').get()!;
    expect(raw.attributes_json).not.toContain('sk-synthcredential000000');
    expect(raw.attributes_json).toContain('[redacted:api_key:');
    // 白名单映射列取自解码值，不含凭证。
    const row = store.store.read.query('SELECT in_tok, model_requested FROM request').get() as Record<string, unknown>;
    expect(row.in_tok).toBe(8233);
  } finally {
    store.close();
  }
});

test('同一 turn 已有 magpie 行：OTLP 只写证据，不重复建行', () => {
  const store = fixture();
  try {
    store.store.write(db => db.run(`
      INSERT INTO request(agent,session,conv_key,conv_source,actor,actor_state,
        started_ms,day,via,model_requested,body_state,derive_version,have,created_at,updated_at,turn_ref)
      VALUES ('codex','thread-synth-0001',?,'session','thread-synth-0001','known',
        ?, '2026-10-26','hook','synth-codex-model','missing',0,1,?,?, 'turn-synth-0001')`,
      [JSON.stringify(['session', 'thread-synth-0001']), NOW + 1_000, NOW, NOW]));
    const decoded = decodeTracesBody(tracesProtobuf([
      { resource: { service: 'codex-app-server' }, spans: [CODEX_TURN] },
    ]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));

    expect(result.requestsCreated).toBe(0);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(1);
    const evidence = store.store.read.query(
      `SELECT merge_state, match_rule FROM request_evidence WHERE source_kind='otlp_span'`,
    ).get() as { merge_state: string; match_rule: string };
    expect(evidence.merge_state).toBe('merged');
    // 统一 owner 认领：证据记下命中的线索（turn_ref），与 hook 侧 claimed 证据同口径。
    expect(evidence.match_rule).toBe('turn_ref.v1');
    // 原始 span 仍然落库，证据不因为去重而丢。
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM raw_otlp_span').get() as { n: number }).n).toBe(1);
  } finally {
    store.close();
  }
});

test('magpie 行无 turn_ref：统一 owner 不启用弱开始窗，OTLP 独立建行', () => {
  const store = fixture();
  try {
    store.store.write(db => db.run(`
      INSERT INTO request(agent,session,conv_key,conv_source,actor,actor_state,
        started_ms,day,via,model_requested,body_state,derive_version,have,created_at,updated_at)
      VALUES ('codex','thread-synth-0001',?,'session','thread-synth-0001','known',
        ?, '2026-10-26','hook','synth-codex-model','missing',0,1,?,?)`,
      [JSON.stringify(['session', 'thread-synth-0001']), 1_792_946_000_000, NOW, NOW]));
    const decoded = decodeTracesBody(tracesProtobuf([
      { resource: { service: 'codex-app-server' }, spans: [CODEX_TURN] },
    ]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    // span 带完成时间，owner 关掉 ±60 秒弱开始窗；账本行又无 turn_ref/用量指纹，
    // 没有强身份可认领，宁可多一行也不错并（见 owner.ts 的完成时间基准守卫）。
    expect(result.requestsCreated).toBe(1);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(2);
  } finally {
    store.close();
  }
});

test('OMP span 认领既有 magpie 行：用量指纹命中，一行两证据，用量不相加', () => {
  const store = fixture();
  try {
    store.store.write(db => {
      // 账本先到：同会话同 agent、四段用量与 OMP_CHAT 相等、started 在 ±2s 内。
      db.run(`
        INSERT INTO request(agent,session,conv_key,conv_source,actor,actor_state,
          started_ms,day,via,model_requested,model_served,in_tok,out_tok,cache_read,cache_write,
          body_state,derive_version,have,created_at,updated_at,cost_state,attempt_state,sort_source,sort_key)
        VALUES ('omp',?,?,'session',?,'known',?, '2026-10-26','through','synth-model-lite','synth-model-lite-served',
          8233,3,128,256,'available',0,7,?,?,'absent','known','ledger','ledger-synth-1')`,
        [SYNTH.session, JSON.stringify(['session', SYNTH.session]), SYNTH.session,
          1_792_945_426_098, NOW, NOW]);
      db.run(`INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,match_rule,added_at)
        VALUES (1,'ledger','ledger-synth-1','merged','response_id_norm.v1',?)`, [NOW]);
    }, 'test');
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'oh-my-pi' }, spans: [OMP_CHAT] }]), 'protobuf');
    const result = acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32));
    expect(result.requestsCreated).toBe(0);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(1);
    const row = store.store.read.query('SELECT have, in_tok, out_tok FROM request').get() as { have: number; in_tok: number; out_tok: number };
    expect(row.have & 8).toBe(8);          // OTLP 位补上
    expect(row.in_tok).toBe(8233);          // 用量仍是账本值，不相加
    const kinds = store.store.read.query('SELECT source_kind FROM request_evidence ORDER BY source_kind').all() as { source_kind: string }[];
    expect(kinds.map(k => k.source_kind)).toEqual(['ledger', 'otlp_span']);
  } finally { store.close(); }
});

const FULL_MESSAGES_IN = JSON.stringify([
  { role: 'user', parts: [{ type: 'text', content: 'synth question' }] },
]);
const FULL_MESSAGES_OUT = JSON.stringify([
  { role: 'assistant', parts: [
    { type: 'text', content: 'synth answer' },
    { type: 'tool_call', id: 'call_synth_full', name: 'synth_tool', arguments: { q: 1 } },
  ] },
]);
const FULL_SPAN = {
  traceId: SYNTH.traceA, spanId: SYNTH.spanLLM, name: 'chat synth-model-lite', kind: 3,
  startNano: SYNTH.msToNano(1_792_945_426_098), endNano: SYNTH.msToNano(1_792_945_428_830),
  attrs: {
    'gen_ai.operation.name': 'chat',
    'gen_ai.conversation.id': SYNTH.session,
    'gen_ai.request.model': 'synth-model-lite',
    'gen_ai.response.model': 'synth-model-lite-served',
    'gen_ai.response.id': SYNTH.responseId,
    'gen_ai.response.finish_reasons': { arr: ['stop'] },
    'gen_ai.usage.input_tokens': { int: 100 }, 'gen_ai.usage.output_tokens': { int: 20 },
    'gen_ai.usage.cache_read.input_tokens': { int: 0 }, 'gen_ai.usage.cache_creation.input_tokens': { int: 0 },
    'gen_ai.input.messages': FULL_MESSAGES_IN,
    'gen_ai.output.messages': FULL_MESSAGES_OUT,
  },
};

test('全量 profile span 建行：正文 available、response_id_norm 落列、semconv 解析', () => {
  const fx = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'tracery-reference' }, spans: [FULL_SPAN] }]), 'protobuf');
    const result = acceptOtlpTraces(fx.store, decoded, NOW, new Uint8Array(32));
    expect(result.requestsCreated).toBe(1);
    const row = fx.store.read.query<{ body_state: string; response_id_norm: string | null; via: string;
      have: number; cost_state: string; parse_state: string | null }, []>(
      `SELECT body_state, response_id_norm, via, have, cost_state, parse_state FROM request`).get()!;
    expect(row.body_state).toBe('available');
    expect(row.response_id_norm).toBe('synth-0001abcdef0123456789'); // normalizeResponseId 去 chatcmpl- 前缀
    expect(row.via).toBe('otlp');
    expect(row.have & 8).toBe(8);
    expect(row.cost_state).toBe('absent');
    expect(row.parse_state).toBe('ok');
    const blocks = fx.store.read.query('SELECT COUNT(*) AS n FROM request_block').get() as { n: number };
    expect(blocks.n).toBeGreaterThan(0);
  } finally { fx.close(); }
});

test('全量 profile 正文 JSON 解析失败：降级 summary 加 issue，不标 available', () => {
  const fx = fixture();
  try {
    const bad = { ...FULL_SPAN, attrs: { ...FULL_SPAN.attrs, 'gen_ai.input.messages': '{"truncated":' } };
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'tracery-reference' }, spans: [bad] }]), 'protobuf');
    acceptOtlpTraces(fx.store, decoded, NOW, new Uint8Array(32));
    const row = fx.store.read.query('SELECT body_state FROM request').get() as { body_state: string };
    expect(row.body_state).toBe('summary');
    const issue = fx.store.read.query<{ reason: string }, [string]>(
      "SELECT reason FROM ingest_issue WHERE source_kind=?").all('otlp_span') as { reason: string }[];
    expect(issue.some(i => i.reason === 'body_parse_failed')).toBe(true);
  } finally { fx.close(); }
});

test('全量 span 按 response_id 认领账本行：双方向都只一行', () => {
  const fx = fixture();
  try {
    fx.store.write(db => {
      db.run(`INSERT INTO request(response_id_norm,agent,session,conv_key,conv_source,actor,actor_state,
        started_ms,day,via,body_state,derive_version,have,created_at,updated_at,cost_state,attempt_state,sort_source,sort_key)
        VALUES (?,'reference',?,?,'session',?,'known',?, '2026-10-26','through','available',0,7,?,?,'absent','known','ledger','ledger-full-1')`,
        ['synth-0001abcdef0123456789', SYNTH.session, JSON.stringify(['session', SYNTH.session]), SYNTH.session,
          1_792_945_426_098, NOW, NOW]);
      db.run(`INSERT INTO request_evidence(req_id,source_kind,ref_key,merge_state,match_rule,added_at)
        VALUES (1,'ledger','ledger-full-1','merged','response_id_norm.v1',?)`, [NOW]);
    }, 'test');
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'tracery-reference' }, spans: [FULL_SPAN] }]), 'protobuf');
    const result = acceptOtlpTraces(fx.store, decoded, NOW, new Uint8Array(32));
    expect(result.requestsCreated).toBe(0);
    expect((fx.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(1);
    const ev = fx.store.read.query<{ source_kind: string }, []>(
      'SELECT source_kind FROM request_evidence ORDER BY source_kind').all() as { source_kind: string }[];
    expect(ev.map(e => e.source_kind)).toEqual(['ledger', 'otlp_span']);
  } finally { fx.close(); }
});

test('暂停档整批拒绝：不写任何行', () => {
  const store = fixture();
  try {
    const decoded = decodeTracesBody(tracesProtobuf([{ resource: { service: 'oh-my-pi' }, spans: [OMP_CHAT] }]), 'protobuf');
    expect(() => acceptOtlpTraces(store.store, decoded, NOW, new Uint8Array(32), {
      admission: () => ({ mode: 'paused', reason: 'disk_95' }),
    })).toThrow('disk_full');
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM request').get() as { n: number }).n).toBe(0);
    expect((store.store.read.query('SELECT COUNT(*) AS n FROM raw_otlp_span').get() as { n: number }).n).toBe(0);
  } finally {
    store.close();
  }
});
