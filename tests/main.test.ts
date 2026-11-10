import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReadToken } from '../src/http';
import { DEFAULT_DERIVE_BUDGET, loadBoundSaltTx, loadConfig } from '../src/config';
import { saveSettings } from '../src/settings';
import { RAW_PRUNE_RETRY_MS, RAW_PRUNE_TICK_BUDGET, startCollector } from '../src/main';
import { claudeAdapter } from '../src/sources/session/adapters/claude';
import { fixture } from './fixtures';
import { persistBody } from '../src/body';

// 生产切片保持冻结；实验身份放行不代表读取完整性与容量已验收。
test('在线来源共用摄入入口，自定义账本路径仍沿用固定身份且半行不空转写', async () => {
  const f = fixture();
  const upstream = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch: () => Response.json({ version: '0.1.1294' }),
  });
  let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
  try {
    const ledger = JSON.stringify({
      t: '2026-10-24T00:00:00Z', route_id: 7, session: 'synthetic-session',
      agent: 'demo', model: 'm', in: 10, out: 5,
    });
    writeFileSync(`${f.dir}/custom-ledger.jsonl`, `${ledger}\npartial`);
    mkdirSync(`${f.dir}/routing`);
    const route = JSON.stringify({
      id: 7, time: '2026-10-24T00:00:00Z', session: 'synthetic-session',
      agent: 'demo', model: 'm', provider: 'synthetic', status: 200,
    });
    writeFileSync(`${f.dir}/routing/2026-10-24.jsonl`, `${route}\n`);
    collector = await startCollector({
      ...loadConfig({}), port: 0, dataDir: f.dir,
      ledgerPath: `${f.dir}/custom-ledger.jsonl`, routingDir: `${f.dir}/routing`,
      magpieUrl: `http://127.0.0.1:${upstream.port}`,
      intervals: { ledger: 5, route: 5 },
    }, { sessionAdapters: [] });
    const port = collector.port;
    const token = loadReadToken(f.dir);
    const snapshot = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/ingest-metrics`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        jobs: Record<string, { count: number }>;
        writer: { count: number; by_name: Record<string, { count: number }> };
      }>;
    };
    let before = await snapshot();
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((before.jobs.ledger?.count ?? 0) >= 3 && (before.jobs.probe?.count ?? 0) > 0) break;
      await Bun.sleep(5);
      before = await snapshot();
    }
    expect(before.jobs.ledger?.count).toBeGreaterThanOrEqual(3);
    expect(before.jobs.probe?.count).toBeGreaterThan(0);
    expect(f.store.read.query(`SELECT source_kind,source_name,committed_off
      FROM source_cursor ORDER BY source_kind`).all()).toEqual([
      { source_kind: 'ledger', source_name: 'usage.jsonl', committed_off: Buffer.byteLength(ledger) + 1 },
      { source_kind: 'route_file', source_name: '2026-10-24.jsonl', committed_off: Buffer.byteLength(route) + 1 },
    ]);
    expect(before.writer.by_name.ledger?.count).toBe(1);
    expect(before.writer.by_name.route?.count).toBe(1);
    expect(f.store.read.query('SELECT count(*) AS n FROM raw_ledger').get()).toEqual({ n: 1 });
    expect(f.store.read.query('SELECT count(*) AS n FROM raw_route').get()).toEqual({ n: 1 });

    let after = before;
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((after.jobs.ledger?.count ?? 0) >= before.jobs.ledger!.count + 3) break;
      await Bun.sleep(5);
      after = await snapshot();
    }
    expect(after.jobs.ledger!.count).toBeGreaterThanOrEqual(before.jobs.ledger!.count + 3);
    expect(after.writer.count).toBe(before.writer.count);
  } finally {
    await collector?.stop();
    await upstream.stop(true);
    f.close();
  }
});

describe('startCollector 切片模式启用路径', () => {
  test('设了派生预算且未声明实验身份时拒绝启动', async () => {
    const f = fixture();
    try {
      const config = {
        ...loadConfig({}),
        port: 0,
        dataDir: f.dir,
        ledgerPath: `${f.dir}/missing.jsonl`,
        routingDir: `${f.dir}/missing-routing`,
        deriveBudget: DEFAULT_DERIVE_BUDGET,
      };
      await expect(startCollector(config)).rejects.toThrow('slice_read_unmigrated');
    } finally {
      f.close();
    }
  });

  test('容量实验身份放行切片模式且能正常起停', async () => {
    const f = fixture();
    try {
      const config = {
        ...loadConfig({}),
        port: 0,
        dataDir: f.dir,
        ledgerPath: `${f.dir}/missing.jsonl`,
        routingDir: `${f.dir}/missing-routing`,
        deriveBudget: DEFAULT_DERIVE_BUDGET,
      };
      const collector = await startCollector(config, { capacityExperiment: true });
      const response = await fetch(`http://127.0.0.1:${collector.port}/api/stats`, {
        headers: { origin: `http://127.0.0.1:${collector.port}` },
      });
      expect(response.status).toBe(200);
      await collector.stop();
    } finally {
      f.close();
    }
  });
});

// 启动生命周期：端口、信号与启动任务接线（自 queries.test 迁入，按被测入口归位）。
test('启动拒绝端口冲突且端口由配置决定', async () => {
  const f = fixture();
  const held = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('held') });
  try {
    const config = { ...loadConfig({}), port: held.port ?? 0, dataDir: f.dir };
    await expect(startCollector(config)).rejects.toThrow();
  } finally {
    await held.stop(true);
    f.close();
  }
});

test('SIGTERM停止后不再响应请求', async () => {
  const f = fixture();
  try {
    const config = {
      ...loadConfig({}),
      port: 0,
      dataDir: f.dir,
      ledgerPath: `${f.dir}/missing.jsonl`,
      routingDir: `${f.dir}/missing-routing`,
    };
    const collector = await startCollector(config, { sessionAdapters: [] });
    const response = await fetch(`http://127.0.0.1:${collector.port}/api/stats`, {
      headers: { origin: `http://127.0.0.1:${collector.port}` },
    });
    expect(response.status).toBe(200);
    await collector.stop();
    await expect(fetch(`http://127.0.0.1:${collector.port}/api/stats`, {
      headers: { origin: `http://127.0.0.1:${collector.port}` },
    })).rejects.toThrow();
  } finally {
    f.close();
  }
});

test('派生永不落盘时 SIGTERM 在等待上限内退出', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atc-stop-hang-'));
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, 'stop-hang-child.ts')], {
    stdout: 'pipe',
    env: { ...process.env, ATC_STOP_HANG_DIR: dir },
  });
  try {
    // ready 由注入的派生计算发出：看到它才说明卡住的正是派生等待。
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = '';
    const startedAt = Date.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
      if (output.includes('ready')) break;
      if (Date.now() - startedAt > 10_000) throw new Error(`stop_hang_child_not_ready:${output}`);
    }
    proc.kill('SIGTERM');
    const code = await proc.exited;
    // 子进程注入的上限是 1 s；没有上限的旧实现永远不会走到断言。
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(code).toBe(0);
  } finally {
    proc.kill(9);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('启动时逐项运行各任务，回收不受其它任务占锁影响', async () => {
  const f = fixture();
  try {
    // 盐与库的绑定要在空库时建立：有数据之后再生成盐会被拒绝（无法证明历史占位符用的是它）。
    f.store.write(db => loadBoundSaltTx(db, f.dir));
    const config = {
      ...loadConfig({}),
      port: 0,
      dataDir: f.dir,
      ledgerPath: `${f.dir}/missing.jsonl`,
      routingDir: `${f.dir}/missing-routing`,
      // 预算压到 100 字节（这两段重复文本压缩后约 370 B）：启动时那一轮回收必须真的执行，
      // 而不是被前一个 tick 的锁挡住。
      bodyBudget: 100,
      diskLimit: 16_000_000_000,
    };
    for (const id of [1, 2]) {
      f.store.db.run(
        "INSERT INTO request(req_id,started_ms,day,via,body_state,derive_version,have,created_at,updated_at) VALUES (?,?,?,'hook','pending',0,1,1,1)",
        [id, id, '2026-10-20'],
      );
      persistBody(f.store, id, {
        protocol: 'anthropic',
        request: { messages: [{ role: 'user', content: [{ type: 'text', text: 'z'.repeat(4096) + id }] }] },
        reply: { id: `msg_${id}`, content: [] },
        redact_version: 1,
      });
    }
    const collector = await startCollector(config, { sessionAdapters: [] });
    try {
      // 启动那一轮是同步发起的；给事件循环一个机会跑完。
      await new Promise(resolve => setTimeout(resolve, 50));
      const states = f.store.read.query<{ body_state: string }, []>(
        'SELECT body_state FROM request ORDER BY req_id').all();
      expect(states).toEqual([{ body_state: 'evicted' }, { body_state: 'evicted' }]);
    } finally {
      await collector.stop();
    }
  } finally {
    f.close();
  }
});

test('droid 定时任务接入：按注入间隔读取合成转录', async () => {
  const f = fixture();
  const factory = `${f.dir}/factory`;
  const sessions = `${factory}/.factory/sessions`;
  mkdirSync(sessions, { recursive: true });
  const t0 = Date.parse('2026-08-24T10:00:00.000Z');
  const iso = (ms: number): string => new Date(ms).toISOString();
  writeFileSync(join(sessions, 's1.jsonl'), [
    JSON.stringify({ type: 'session_start', id: 's1', cwd: '/work/synth', version: 2 }),
    JSON.stringify({ type: 'message', id: 'm-u1', timestamp: iso(t0),
      message: { role: 'user', content: [{ type: 'text', text: 'prompt' }] } }),
    JSON.stringify({ type: 'message', id: 'm-a1', timestamp: iso(t0 + 1_000),
      message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }], modelId: 'synth-model' } }),
  ].join('\n') + '\n');
  const previous = process.env.FACTORY_HOME_OVERRIDE;
  process.env.FACTORY_HOME_OVERRIDE = factory;
  let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
  try {
    collector = await startCollector({
      ...loadConfig({}),
      port: 0,
      dataDir: f.dir,
      ledgerPath: `${f.dir}/missing.jsonl`,
      routingDir: `${f.dir}/missing-routing`,
      intervals: { droid: 5, ledger: 60_000, route: 60_000 },
    }, { sessionAdapters: [] });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((f.store.read.query('SELECT count(*) AS n FROM request').get() as { n: number }).n > 0) break;
      await Bun.sleep(5);
    }
    expect(f.store.read.query('SELECT via, agent, model_requested FROM request').get()).toEqual({
      via: 'session', agent: 'droid', model_requested: 'synth-model',
    });
  } finally {
    await collector?.stop();
    if (previous === undefined) delete process.env.FACTORY_HOME_OVERRIDE;
    else process.env.FACTORY_HOME_OVERRIDE = previous;
    f.close();
  }
});

test('会话定时任务接入：按注入根轮转适配器并读合成会话', async () => {
  const f = fixture();
  const root = `${f.dir}/claude-projects/synthetic-project`;
  mkdirSync(root, { recursive: true });
  const t0 = Date.parse('2026-08-25T10:00:00.000Z');
  const iso = (ms: number): string => new Date(ms).toISOString();
  const sessionId = '22222222-3333-4444-5555-666666666666';
  const row = (type: string, message: unknown): string => JSON.stringify({
    type, sessionId, timestamp: iso(t0), cwd: '/work/synth', message,
  });
  writeFileSync(join(root, `${sessionId}.jsonl`), [
    row('user', { role: 'user', content: [{ type: 'text', text: 'prompt' }] }),
    row('assistant', {
      id: 'msg_synth-main', model: 'synth-model', role: 'assistant', content: [{ type: 'text', text: 'reply' }],
      usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
  ].join('\n') + '\n');
  let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
  try {
    collector = await startCollector({
      ...loadConfig({}),
      port: 0,
      dataDir: f.dir,
      ledgerPath: `${f.dir}/missing.jsonl`,
      routingDir: `${f.dir}/missing-routing`,
      intervals: { sessions: 5, droid: 60_000, ledger: 60_000, route: 60_000 },
    }, {
      sessionAdapters: [claudeAdapter],
      sessionRoots: () => [root],
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((f.store.read.query('SELECT count(*) AS n FROM request').get() as { n: number }).n > 0) break;
      await Bun.sleep(5);
    }
    expect(f.store.read.query('SELECT via, agent, session, model_requested FROM request').get()).toEqual({
      via: 'session', agent: 'claude', session: sessionId, model_requested: 'synth-model',
    });
  } finally {
    await collector?.stop();
    f.close();
  }
});

describe('rawPruneTick 启动追赶与 backlog 重试', () => {
  const configOf = (f: ReturnType<typeof fixture>) => ({
    ...loadConfig({}), port: 0, dataDir: f.dir,
    ledgerPath: `${f.dir}/missing.jsonl`, routingDir: `${f.dir}/missing-routing`,
  });

  test('启动时跑一次 rawPrune；存量没清完置 backlog 并排 5 分钟重试', async () => {
    const f = fixture();
    // 单轮 10 批 × 每批 100 行 = 1000 行上限，造 1200 行到期 span 让启动轮清不完。
    f.store.write(db => {
      const insert = db.prepare(
        `INSERT INTO raw_otlp_span(trace_id,span_id,received_at,service,name,start_ms,attributes_json,mapping_version,privacy_version)
         VALUES (?,?,10,'oh-my-pi','chat synth',10,'{}',1,1)`);
      for (let i = 0; i < 1200; i++) {
        const spanId = new Uint8Array(8);
        new DataView(spanId.buffer).setUint32(0, i);
        insert.run(new Uint8Array(16).fill(0xab), spanId);
      }
    });
    const scheduled: { ms: number; run: () => void }[] = [];
    let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
    try {
      collector = await startCollector(configOf(f), {
        sessionAdapters: [],
        rawPruneRetry: {
          now: () => Date.now(),
          set: (task, ms) => {
            scheduled.push({ ms, run: task });
            return { ms } as unknown as ReturnType<typeof setTimeout>;
          },
          clear: () => {},
        },
      });
      const token = loadReadToken(f.dir);
      const metrics = async () => {
        const response = await fetch(`http://127.0.0.1:${collector!.port}/api/metrics`, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        return response.json() as Promise<{ jobs: Record<string, { count: number }>; raw_prune_backlog: boolean }>;
      };
      // 启动那一轮是异步发起的：等它落地，jobs.raw_prune 至少跑过一次。
      let snapshot = await metrics();
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((snapshot.jobs.raw_prune?.count ?? 0) > 0 && snapshot.raw_prune_backlog) break;
        await Bun.sleep(5);
        snapshot = await metrics();
      }
      expect(snapshot.jobs.raw_prune?.count).toBeGreaterThan(0);
      // 预算常量生效：1200 行到期里首轮最多清 1000，库里还剩 200。
      expect(RAW_PRUNE_TICK_BUDGET).toEqual({ maxBatches: 10, wallMs: 1000 });
      expect((f.store.read.query<{ n: number }, []>(
        'SELECT COUNT(*) AS n FROM raw_otlp_span WHERE received_at<100').get()!).n).toBe(200);
      // 没清完：backlog 置位，并排了 5 分钟后的重试（不是睡 5 分钟）。
      expect(snapshot.raw_prune_backlog).toBe(true);
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]!.ms).toBe(RAW_PRUNE_RETRY_MS);

      // 手动触发重试：清掉剩余 200 行后 backlog 归位、重试 timer 被清掉。
      scheduled[0]!.run();
      for (let attempt = 0; attempt < 100; attempt++) {
        if (!((await metrics()).raw_prune_backlog)) break;
        await Bun.sleep(5);
      }
      expect((await metrics()).raw_prune_backlog).toBe(false);
      expect((f.store.read.query<{ n: number }, []>(
        'SELECT COUNT(*) AS n FROM raw_otlp_span WHERE received_at<100').get()!).n).toBe(0);
      // 重试回调先把自己的 handle 置空，清完后不再排新的重试（clear 留给 stop 与小时 tick）。
      expect(scheduled).toHaveLength(1);
    } finally {
      await collector?.stop();
      f.close();
    }
  });

  test('停止时清理未触发的重试 timer', async () => {
    const f = fixture();
    const cleared: number[] = [];
    const scheduled: number[] = [];
    let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
    try {
      f.store.write(db => {
        const insert = db.prepare(
          `INSERT INTO raw_otlp_span(trace_id,span_id,received_at,service,name,start_ms,attributes_json,mapping_version,privacy_version)
           VALUES (?,?,10,'oh-my-pi','chat synth',10,'{}',1,1)`);
        for (let i = 0; i < 1200; i++) {
          const spanId = new Uint8Array(8);
          new DataView(spanId.buffer).setUint32(0, i);
          insert.run(new Uint8Array(16).fill(0xab), spanId);
        }
      });
      collector = await startCollector(configOf(f), {
        sessionAdapters: [],
        rawPruneRetry: {
          now: () => Date.now(),
          set: (_task, ms) => { scheduled.push(ms); return { ms } as unknown as ReturnType<typeof setTimeout>; },
          clear: handle => { cleared.push((handle as unknown as { ms: number }).ms); },
        },
      });
      for (let attempt = 0; attempt < 100 && scheduled.length === 0; attempt++) await Bun.sleep(5);
      expect(scheduled).toEqual([RAW_PRUNE_RETRY_MS]);
      await collector.stop();
      collector = undefined;
      expect(cleared).toEqual([RAW_PRUNE_RETRY_MS]);
    } finally {
      await collector?.stop();
      f.close();
    }
  });
});

describe('会话保留自动清理', () => {
  const DAY = 86_400_000;
  const configOf = (f: ReturnType<typeof fixture>) => ({
    ...loadConfig({}), port: 0, dataDir: f.dir,
    ledgerPath: `${f.dir}/missing.jsonl`, routingDir: `${f.dir}/missing-routing`,
  });
  const save = (f: ReturnType<typeof fixture>) => saveSettings(f.dir, {
    preset: 'paper', appearance: 'system',
    accent: '#007AFF', accentSoft: 'rgba(0,122,255,.07)',
    fontSize: 'regular', reduceMotion: false, lang: 'zh',
    retentionDays: 30, retentionConfigured: true, runMode: 'always',
  });

  test('启动 tick 按已启用的设置整会话删除过期请求，保留期内的不动', async () => {
    const f = fixture();
    let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
    try {
      save(f);
      // 先落盐绑定：startCollector 的第二个连接要求有数据时盐文件必须存在。
      f.store.write(db => loadBoundSaltTx(db, f.dir));
      const now = Date.now();
      const oldKey = JSON.stringify(['session', 'sess-auto-old']);
      const freshKey = JSON.stringify(['session', 'sess-auto-fresh']);
      f.store.write(db => {
        const insert = db.prepare(`
          INSERT INTO request(req_id,conv_key,actor,actor_state,started_ms,day,via,body_state,
            derive_version,have,purpose_pending,created_at,updated_at)
          VALUES (?,?, 'a','known',?,'2026-01-01','session','available',0,1,0,?,?)`);
        insert.run(1, oldKey, now - 40 * DAY, now, now);
        insert.run(2, freshKey, now - 2 * DAY, now, now);
      });
      collector = await startCollector(configOf(f), {
        sessionAdapters: [],
        sessionRetention: { intervalMs: 60_000 },
      });
      const count = (key: string) => f.store.read.query<{ n: number }, [string]>(
        'SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(key)!.n;
      for (let attempt = 0; attempt < 200 && count(oldKey) > 0; attempt++) await Bun.sleep(5);
      expect(count(oldKey)).toBe(0);
      expect(count(freshKey)).toBe(1);
    } finally {
      await collector?.stop();
      f.close();
    }
  });

  test('未启用时启动 tick 不动存量', async () => {
    const f = fixture();
    let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
    try {
      // 用户还没在面板里启用保留：自动 tick 只预览、不删。
      saveSettings(f.dir, {
        preset: 'paper', appearance: 'system',
        accent: '#007AFF', accentSoft: 'rgba(0,122,255,.07)',
        fontSize: 'regular', reduceMotion: false, lang: 'zh',
        retentionDays: 30, retentionConfigured: false, runMode: 'always',
      });
      f.store.write(db => loadBoundSaltTx(db, f.dir));
      const now = Date.now();
      const oldKey = JSON.stringify(['session', 'sess-auto-disabled']);
      f.store.write(db => db.run(`
        INSERT INTO request(req_id,conv_key,actor,actor_state,started_ms,day,via,body_state,
          derive_version,have,purpose_pending,created_at,updated_at)
        VALUES (1,?, 'a','known',?,'2026-01-01','session','available',0,1,0,?,?)`,
      [oldKey, now - 40 * DAY, now, now]));
      collector = await startCollector(configOf(f), {
        sessionAdapters: [],
        sessionRetention: { intervalMs: 60_000 },
      });
      await Bun.sleep(50);
      expect(f.store.read.query('SELECT COUNT(*) AS n FROM request').get()).toEqual({ n: 1 });
    } finally {
      await collector?.stop();
      f.close();
    }
  });

  test('一轮没删完就继续追赶，删完清掉重试', async () => {
    const f = fixture();
    let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
    try {
      save(f);
      f.store.write(db => loadBoundSaltTx(db, f.dir));
      const now = Date.now();
      f.store.write(db => {
        const insert = db.prepare(`
          INSERT INTO request(req_id,conv_key,actor,actor_state,started_ms,day,via,body_state,
            derive_version,have,purpose_pending,created_at,updated_at)
          VALUES (?,?, 'a','known',?,'2026-01-01','session','available',0,1,0,?,?)`);
        for (let id = 1; id <= 40; id++) {
          insert.run(id, JSON.stringify(['session', `sess-backlog-${id}`]),
            now - 40 * DAY, now, now);
        }
      });
      let scheduled = 0;
      let task: (() => void) | null = null;
      const takeTask = (): (() => void) | null => {
        const next = task;
        task = null;
        return next;
      };
      collector = await startCollector(configOf(f), {
        sessionAdapters: [],
        sessionRetention: {
          intervalMs: 3_600_000,
          // 1 ms 墙钟保证首轮删一个就超时，把追赶交给重试。
          wallMs: 1,
          retryMs: 1,
          retry: {
            set: onDue => {
              scheduled += 1;
              task = onDue;
              return 0 as unknown as ReturnType<typeof setTimeout>;
            },
            clear: () => { task = null; },
          },
        },
      });
      const remaining = () => f.store.read.query<{ n: number }, []>(
        'SELECT COUNT(*) AS n FROM request').get()!.n;
      for (let attempt = 0; attempt < 500 && remaining() > 0; attempt++) {
        const due = takeTask();
        if (due === null) { await Bun.sleep(2); continue; }
        due();
        await Bun.sleep(2);
      }
      expect(remaining()).toBe(0);
      expect(scheduled).toBeGreaterThan(0);
      // 候选清空后那一轮不再排重试；多给一拍让收尾的 clear 落下。
      const last = takeTask();
      if (last !== null) {
        last();
        await Bun.sleep(5);
      }
      expect(task).toBeNull();
    } finally {
      await collector?.stop();
      f.close();
    }
  });
});

describe('95% 磁盘兜底', () => {
  test('准入暂停时只删超过 7 天的完整会话，事件写明 disk_cap', async () => {
    const f = fixture();
    const DAY = 86_400_000;
    let collector: Awaited<ReturnType<typeof startCollector>> | undefined;
    try {
      f.store.write(db => loadBoundSaltTx(db, f.dir));
      const now = Date.now();
      const ancient = JSON.stringify(['session', 'sess-cap-ancient']);
      const recent = JSON.stringify(['session', 'sess-cap-recent']);
      f.store.write(db => {
        const insert = db.prepare(`
          INSERT INTO request(req_id,conv_key,actor,actor_state,started_ms,day,via,body_state,
            derive_version,have,purpose_pending,created_at,updated_at)
          VALUES (?,?, 'a','known',?,'2026-01-01','session','available',0,1,0,?,?)`);
        insert.run(1, ancient, now - 8 * DAY, now, now);
        insert.run(2, recent, now - 6 * DAY, now, now);
      });
      collector = await startCollector({
        ...loadConfig({}), port: 0, dataDir: f.dir,
        ledgerPath: `${f.dir}/missing.jsonl`, routingDir: `${f.dir}/missing-routing`,
        // 1 字节上限让准入必然停在 disk_budget；正文预算压到 0，不影响删除路径。
        diskLimit: 1, bodyBudget: 0, intervals: { retention: 5 },
      }, { sessionAdapters: [] });
      const count = (key: string) => f.store.read.query<{ n: number }, [string]>(
        'SELECT COUNT(*) AS n FROM request WHERE conv_key=?').get(key)!.n;
      for (let attempt = 0; attempt < 200 && count(ancient) > 0; attempt++) await Bun.sleep(5);
      expect(count(ancient)).toBe(0);
      expect(count(recent)).toBe(1);
      expect(f.store.read.query(
        "SELECT reason FROM retention_event WHERE action='session_retention'").get())
        .toEqual({ reason: 'disk_cap' });
    } finally {
      await collector?.stop();
      f.close();
    }
  });
});
