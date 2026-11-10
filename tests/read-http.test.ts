import { expect, test } from 'bun:test';
import { createHttpReadTransport } from '../web/read-http.js';

/** 一份形状完整的合成预览响应，供编码与顶层校验两处共用。 */
const RETENTION_PREVIEW_BODY = {
  keep_days: 30, cutoff_ms: 1000,
  sessions: 0, requests: 0,
  first_ms: null, last_ms: null, oldest_ms: null,
  bytes: { readable_body: 0, session_raw: 0, raw_hook: 0 },
  skipped: { dirty: 0, purpose_pending: 0, source_gap: 0, in_flight: 0 },
  usage: { readable_body_bytes: 0, session_raw_bytes: 0, raw_hook_bytes: 0 },
  last_cleanup: null,
  limits: { disk_limit_bytes: 1000, body_budget_bytes: 500 },
};

/** 注入式 fetcher：记录 URL 与 signal，按队列回放响应或异常。 */
function scriptedFetch(
  script: Array<{ url?: string; status?: number; body?: unknown; raw?: string; throw?: Error }>,
): { fetcher: typeof fetch; calls: { url: string; signal: AbortSignal | null; headers: Record<string, string> }[] } {
  const calls: { url: string; signal: AbortSignal | null; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: unknown, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
    const step = script[calls.length] ?? {};
    calls.push({
      url: String(url),
      signal: init?.signal ?? null,
      headers: init?.headers ?? {},
    });
    if (step.throw !== undefined) throw step.throw;
    if (step.url !== undefined) expect(String(url)).toBe(step.url);
    const text = step.raw
      ?? JSON.stringify(step.body === undefined ? { items: [], next_cursor: null } : step.body);
    return new Response(text, { status: step.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

test('编码会话键并把取消传到 fetcher', async () => {
  const controller = new AbortController();
  const { fetcher, calls } = scriptedFetch([{}]);
  const transport = createHttpReadTransport({ fetcher });
  await transport.execute('requests', { key: 'a/b', limit: 30,
    direction: 'forward', cursor: null }, { signal: controller.signal });
  expect(calls[0]!.url).toBe('/api/sessions/a%2Fb/requests?direction=forward&limit=30');
  expect(calls[0]!.signal).toBe(controller.signal);
});

test('游标与会话键一起编码，null 参数不进 URL', async () => {
  const { fetcher, calls } = scriptedFetch([{}]);
  const transport = createHttpReadTransport({ fetcher });
  await transport.execute('sessions', { limit: 20, cursor: 'x+y/z', title: 'light' }, { signal: new AbortController().signal });
  expect(calls[0]!.url).toBe('/api/sessions?limit=20&cursor=x%2By%2Fz&title=light');
  await transport.execute('turns', { key: 'k', from: null }, { signal: new AbortController().signal });
  expect(calls[1]!.url).toBe('/api/sessions/k/turns');
  await transport.execute('turns', { key: 'k', from: 7 }, { signal: new AbortController().signal });
  expect(calls[2]!.url).toBe('/api/sessions/k/turns?from=7');
});

test('Agent 筛选与可见性编码进会话 URL，目录走独立路由', async () => {
  const { fetcher, calls } = scriptedFetch([{}, {}, { body: { agents: [], total: 0 } }]);
  const transport = createHttpReadTransport({ fetcher });
  const signal = new AbortController().signal;
  await transport.execute('sessions', { limit: 20, cursor: null, title: 'light', agent: 'hermes', visibleOnly: true }, { signal });
  expect(calls[0]!.url).toBe('/api/sessions?limit=20&title=light&agent=hermes&visibleOnly=1');
  // 无筛选不进 URL：接口默认仍报全量存储事实。
  await transport.execute('sessions', { limit: 20, cursor: null, title: 'full' }, { signal });
  expect(calls[1]!.url).toBe('/api/sessions?limit=20');
  await transport.execute('sessionAgents', {}, { signal });
  expect(calls[2]!.url).toBe('/api/agents');
});

test('批次输入编码为 JSON 查询参数', async () => {
  const token = 'r1-' + 'a'.repeat(64);
  const bundle = (id: number) => ({
    detail: { req_id: id, reading_token: token },
    meta: { req_id: id, reading_token: token },
  });
  const { fetcher, calls } = scriptedFetch([
    { body: { items: [
      { index: 0, requested_id: 1, state: 'ok', value: bundle(1) },
      { index: 1, requested_id: 2, state: 'ok', value: bundle(2) },
    ], next_index: null } },
    { body: { items: [{ index: 0, requested_id: 3, state: 'ok',
      value: { req_id: 3, reading_token: token } }], next_index: null } },
  ]);
  const transport = createHttpReadTransport({ fetcher });
  await transport.execute('readings', { key: 'k', ids: [1, 2] }, { signal: new AbortController().signal });
  await transport.execute('bodyRanges', { key: 'k',
    ranges: [{ id: 3, token, from: 0, to: 40 }] },
  { signal: new AbortController().signal });
  expect(calls[0]!.url).toBe(`/api/sessions/k/readings?ids=${encodeURIComponent('[1,2]')}`);
  expect(calls[1]!.url).toBe(`/api/sessions/k/reading-ranges?items=${
    encodeURIComponent(JSON.stringify([{ id: 3, token, from: 0, to: 40 }]))}`);
});

test('todoByTurn 编码会话、actor 与轮号，校验顶层形状', async () => {
  const ready = { key: 'k', actor: '', turn: 2, state: 'ready',
    snapshot: { seq: 0, items: [{ content: 'ship', status: 'pending' }] } };
  const { fetcher, calls } = scriptedFetch([{ body: ready }, { body: { ...ready, state: 'bogus' } }]);
  const transport = createHttpReadTransport({ fetcher });
  await transport.execute('todoByTurn', { key: 'a/b', actor: '', turn: 2 },
    { signal: new AbortController().signal });
  expect(calls[0]!.url).toBe('/api/sessions/a%2Fb/todo?actor=&turn=2');
  await expect(transport.execute('todoByTurn', { key: 'k', actor: '', turn: 2 },
    { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'invalid_response' });
});

test('汇总条目按判别 kind 编码', async () => {
  const { fetcher, calls } = scriptedFetch([{
    body: { items: [{ req_id: 1, ord: 0, tool_name: 'Bash', state: 'resolved',
      exec_ms: 25, summary: null }], truncated: false },
  }, {}, {}]);
  const transport = createHttpReadTransport({ fetcher });
  await transport.execute('summaryEntries', { key: 'k', query: { kind: 'tool', name: 'Bash' } },
    { signal: new AbortController().signal });
  await transport.execute('summaryEntries', { key: 'k', query: { kind: 'read', path: '/a/b' } },
    { signal: new AbortController().signal });
  await transport.execute('summaryEntries', { key: 'k', query: { kind: 'interrupts' } },
    { signal: new AbortController().signal });
  expect(calls[0]!.url).toBe('/api/sessions/k/summary/entries?kind=tool&name=Bash');
  expect(calls[1]!.url).toBe('/api/sessions/k/summary/entries?kind=read&path=%2Fa%2Fb');
  expect(calls[2]!.url).toBe('/api/sessions/k/summary/entries?kind=interrupts');
});

test('正文与工具结果携带阅读 token，上下文目录带 kind 查询', async () => {
  const token = 'r1-' + 'a'.repeat(64);
  const { fetcher, calls } = scriptedFetch([
    { body: { req_id: 9, reading_token: token } },
    { body: { owner_req: 9, call_ord: 2, reading_token: token, state: 'available' } },
    { body: { req_id: 9, reading_token: token, entries: [] } },
  ]);
  const transport = createHttpReadTransport({ fetcher });
  await transport.execute('body', { id: 9, token, from: 0, to: 40 }, { signal: new AbortController().signal });
  await transport.execute('toolResult', { id: 9, ord: 2, token }, { signal: new AbortController().signal });
  await transport.execute('contextItem', { id: 9, token, query: { kind: 'files', name: '/x', tag: null, cursor: null } },
    { signal: new AbortController().signal });
  expect(calls[0]!.url).toBe(`/api/requests/9/body?from=0&to=40&if_reading=${token}`);
  expect(calls[1]!.url).toBe(`/api/requests/9/tools/2/result?if_reading=${token}`);
  expect(calls[2]!.url).toBe(`/api/requests/9/context-item?kind=files&name=%2Fx&if_reading=${token}`);
});

test('headers 提供函数每次调用注入凭证', async () => {
  let round = 0;
  const { fetcher, calls } = scriptedFetch([{}, {}]);
  const transport = createHttpReadTransport({
    fetcher,
    baseUrl: 'http://127.0.0.1:8320',
    headers: () => ({ authorization: `Bearer t${round += 1}` }),
  });
  const signal = new AbortController().signal;
  await transport.execute('stats', {}, { signal });
  await transport.execute('stats', {}, { signal });
  expect(calls[0]!.url).toBe('http://127.0.0.1:8320/api/stats');
  expect(calls[0]!.headers).toEqual({ authorization: 'Bearer t1' });
  expect(calls[1]!.headers).toEqual({ authorization: 'Bearer t2' });
});

test('HTTP 状态映射为稳定错误码并保留 status', async () => {
  const cases: Array<{ status: number; code: string }> = [
    { status: 400, code: 'invalid_input' },
    { status: 401, code: 'unauthorized' },
    { status: 403, code: 'forbidden' },
    { status: 404, code: 'not_found' },
    { status: 409, code: 'reading_changed' },
    { status: 500, code: 'unavailable' },
    { status: 503, code: 'unavailable' },
  ];
  for (const { status, code } of cases) {
    const { fetcher } = scriptedFetch([{ body: { error: 'x' }, status }]);
    const transport = createHttpReadTransport({ fetcher });
    try {
      await transport.execute('detail', { id: 1 }, { signal: new AbortController().signal });
      throw new Error(`status ${status} 应当拒绝`);
    } catch (error) {
      expect((error as { code?: string }).code).toBe(code);
      expect((error as { status?: number }).status).toBe(status);
      expect((error as Error).message).not.toContain('x');
    }
  }
});

test('网络失败映射 unavailable，畸形 JSON 映射 invalid_response', async () => {
  const network = scriptedFetch([{ throw: new TypeError('load failed') }]);
  const transport = createHttpReadTransport({ fetcher: network.fetcher });
  try {
    await transport.execute('stats', {}, { signal: new AbortController().signal });
    throw new Error('网络失败应当拒绝');
  } catch (error) {
    expect((error as { code?: string }).code).toBe('unavailable');
  }

  const broken = scriptedFetch([{ raw: '{not json' }]);
  const brokenTransport = createHttpReadTransport({ fetcher: broken.fetcher });
  try {
    await brokenTransport.execute('stats', {}, { signal: new AbortController().signal });
    throw new Error('畸形 JSON 应当拒绝');
  } catch (error) {
    expect((error as { code?: string }).code).toBe('invalid_response');
  }
});

test('fetcher 返回但信号已取消时拒绝 cancelled', async () => {
  const controller = new AbortController();
  const { fetcher } = scriptedFetch([{ body: { items: [] } }]);
  const transport = createHttpReadTransport({ fetcher });
  const pending = transport.execute('sessions', { limit: 1, cursor: null, title: 'light' }, { signal: controller.signal });
  controller.abort();
  try {
    await pending;
    throw new Error('取消后应当拒绝');
  } catch (error) {
    expect((error as { code?: string }).code).toBe('cancelled');
  }
});

test('批次响应校验 index 对应、身份一致与覆盖完整性', async () => {
  const token = 'r1-' + 'a'.repeat(64);
  const okBundle = {
    detail: { req_id: 1, reading_token: token },
    meta: { req_id: 1, reading_token: token },
  };
  const cases: unknown[] = [
    // index 越界
    { items: [{ index: 5, requested_id: 1, state: 'ok', value: okBundle }], next_index: null },
    // requested_id 与输入不对应
    { items: [{ index: 0, requested_id: 9, state: 'ok', value: okBundle }], next_index: null },
    // index 重复
    { items: [
      { index: 0, requested_id: 1, state: 'ok', value: okBundle },
      { index: 0, requested_id: 2, state: 'ok', value: okBundle },
    ], next_index: null },
    // 成功项 detail/meta 身份不一致
    { items: [{ index: 0, requested_id: 1, state: 'ok', value: {
      detail: { req_id: 1, reading_token: token },
      meta: { req_id: 2, reading_token: token },
    } }], next_index: null },
    // 失败项缺 reason
    { items: [{ index: 0, requested_id: 1, state: 'not_found' }], next_index: null },
    // next_index=null 但缺项
    { items: [{ index: 0, requested_id: 1, state: 'ok', value: okBundle }], next_index: null },
    // next_index 覆盖范围之外出现项
    { items: [
      { index: 0, requested_id: 1, state: 'ok', value: okBundle },
      { index: 1, requested_id: 2, state: 'ok', value: okBundle },
    ], next_index: 1 },
  ];
  for (const body of cases) {
    const { fetcher } = scriptedFetch([{ body }]);
    const transport = createHttpReadTransport({ fetcher });
    try {
      await transport.execute('readings', { key: 'k', ids: [1, 2] },
        { signal: new AbortController().signal });
      throw new Error(`批次响应 ${JSON.stringify(body)} 应当拒绝`);
    } catch (error) {
      expect((error as { code?: string }).code).toBe('invalid_response');
    }
  }
});

test('合法批次与区间批次通过校验原样返回', async () => {
  const token = 'r1-' + 'a'.repeat(64);
  const bundle = {
    detail: { req_id: 1, reading_token: token },
    meta: { req_id: 1, reading_token: token },
  };
  const readings = {
    items: [
      { index: 0, requested_id: 1, state: 'ok', value: bundle },
      { index: 1, requested_id: 2, state: 'not_found', reason: 'missing' },
    ],
    next_index: null,
  };
  const { fetcher, calls } = scriptedFetch([{ body: readings }, {
    body: { items: [{ index: 0, requested_id: 3, state: 'ok',
      value: { req_id: 3, reading_token: token } }], next_index: null },
  }]);
  const transport = createHttpReadTransport({ fetcher });
  const page = await transport.execute('readings', { key: 'k', ids: [1, 2] },
    { signal: new AbortController().signal });
  expect(page as object).toEqual(readings);
  const ranges = await transport.execute('bodyRanges', { key: 'k',
    ranges: [{ id: 3, token, from: 0, to: 40 }] }, { signal: new AbortController().signal });
  expect(ranges.items[0]!.state === 'ok' && ranges.items[0]!.value.reading_token).toBe(token);
  expect(calls).toHaveLength(2);
});

test('页面与目录响应的顶层形状校验', async () => {
  const token = 'r1-' + 'a'.repeat(64);
  const signal = () => new AbortController().signal;
  type HttpTransport = ReturnType<typeof createHttpReadTransport>;
  const cases: Array<{ run: (t: HttpTransport) => Promise<unknown>; body: unknown }> = [
    { body: { items: 'no' },
      run: t => t.execute('sessions', { limit: 1, cursor: null, title: 'light' }, { signal: signal() }) },
    { body: { length: 0 },
      run: t => t.execute('bgJobs', { key: 'k' }, { signal: signal() }) },
    { body: null,
      run: t => t.execute('detail', { id: 1 }, { signal: signal() }) },
    { body: { req_id: 1 },
      run: t => t.execute('body', { id: 1, token, from: 0, to: 40 }, { signal: signal() }) },
    { body: { state: 'available' },
      run: t => t.execute('toolResult', { id: 1, ord: 0, token }, { signal: signal() }) },
    { body: [],
      run: t => t.execute('route', { id: 1 }, { signal: signal() }) },
    { body: { req_id: 1, reading_token: token, entries: null },
      run: t => t.execute('contextItem', { id: 1, token,
        query: { kind: 'files', name: null, tag: null, cursor: null } }, { signal: signal() }) },
    // 汇总条目旧形状（缺 exec_ms/summary）不能当成功结果。
    { body: { items: [{ req_id: 1, ord: 0, tool_name: 'Bash', state: 'resolved' }], truncated: false },
      run: t => t.execute('summaryEntries', { key: 'k', query: { kind: 'tool', name: 'Bash' } },
        { signal: signal() }) },
    // 服务端把负窗口折成 null；负值属于畸形响应。
    { body: { items: [{ req_id: 1, ord: 0, tool_name: 'Bash', state: 'resolved',
      exec_ms: -1, summary: null }], truncated: false },
      run: t => t.execute('summaryEntries', { key: 'k', query: { kind: 'tool', name: 'Bash' } },
        { signal: signal() }) },
  ];
  for (const { run, body } of cases) {
    const { fetcher } = scriptedFetch([{ body }]);
    const transport = createHttpReadTransport({ fetcher });
    try {
      await run(transport);
      throw new Error(`畸形响应 ${JSON.stringify(body)} 应当拒绝`);
    } catch (error) {
      expect((error as { code?: string }).code).toBe('invalid_response');
    }
  }
});

test('会话保留预览编码 keep-days 并校验顶层形状', async () => {
  const signal = () => new AbortController().signal;
  const clean = { ...RETENTION_PREVIEW_BODY,
    last_cleanup: { at_ms: 900, request_count: 2, reason: 'manual:30d' } };
  const { fetcher, calls } = scriptedFetch([{ body: clean }, { body: RETENTION_PREVIEW_BODY }]);
  const transport = createHttpReadTransport({ fetcher });
  const page = await transport.execute('retentionPreview', { keepDays: 30 }, { signal: signal() });
  expect(calls[0]!.url).toBe('/api/retention/preview?keep-days=30');
  expect(page.last_cleanup).toEqual({ at_ms: 900, request_count: 2, reason: 'manual:30d' });
  await transport.execute('retentionPreview', { keepDays: 7 }, { signal: signal() });
  expect(calls[1]!.url).toBe('/api/retention/preview?keep-days=7');

  // 顶层字段、bytes/skipped、last_cleanup 与 limits 任一处畸形都按 invalid_response 拒绝。
  const cases: unknown[] = [
    { ...RETENTION_PREVIEW_BODY, keep_days: 0 },
    { ...RETENTION_PREVIEW_BODY, cutoff_ms: 'x' },
    { ...RETENTION_PREVIEW_BODY, sessions: -1 },
    { ...RETENTION_PREVIEW_BODY, requests: 1.5 },
    { ...RETENTION_PREVIEW_BODY, bytes: { readable_body: -1, session_raw: 0, raw_hook: 0 } },
    { ...RETENTION_PREVIEW_BODY, skipped: { dirty: 0, purpose_pending: 0, source_gap: 0 } },
    { ...RETENTION_PREVIEW_BODY, usage: { readable_body_bytes: -1, session_raw_bytes: 0, raw_hook_bytes: 0 } },
    { ...RETENTION_PREVIEW_BODY, last_cleanup: { at_ms: 1, request_count: 1 } },
    { ...RETENTION_PREVIEW_BODY, limits: { disk_limit_bytes: 1 } },
    null,
  ];
  for (const body of cases) {
    const scripted = scriptedFetch([{ body }]);
    const t = createHttpReadTransport({ fetcher: scripted.fetcher });
    await expect(t.execute('retentionPreview', { keepDays: 30 }, { signal: signal() }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  }
});

test('合法页面与读取结果原样返回', async () => {
  const { fetcher } = scriptedFetch([{
    body: {
      items: [{ conv_key: 'k', title: 't', last_ms: 1, request_count: 1, agents: [], flags: [] }],
      next_cursor: null,
    },
  }]);
  const transport = createHttpReadTransport({ fetcher });
  const page = await transport.execute('sessions', { limit: 1, cursor: null, title: 'light' },
    { signal: new AbortController().signal });
  expect(page.items).toHaveLength(1);
});
