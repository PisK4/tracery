import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './fixtures';
import { loadConfig } from '../src/config';
import { createHandler } from '../src/http';
import { DEFAULT_SETTINGS, ACCENTS, type Settings } from '../src/settings';

const HOST = { host: '127.0.0.1:8320', origin: 'http://127.0.0.1:8320' };

function withDir(run: (dir: string, handler: (req: Request) => Promise<Response>) => Promise<void>) {
  const f = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'atc-settings-http-'));
  const handler = createHandler(f.store, { ...loadConfig({}), dataDir: dir }, 'synthetic-read-token');
  return run(dir, handler).finally(() => { f.close(); rmSync(dir, { recursive: true, force: true }); });
}

const get = (handler: (req: Request) => Promise<Response>, path = '/api/settings', headers = HOST) =>
  handler(new Request(`http://127.0.0.1:8320${path}`, { headers }));

const post = (handler: (req: Request) => Promise<Response>, body: unknown, headers = HOST) =>
  handler(new Request('http://127.0.0.1:8320/api/settings', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));

test('GET 设置走具名读取契约，响应只含设置值与 overrides', async () => {
  await withDir(async (_dir, handler) => {
    const response = await get(handler);
    expect(response.status).toBe(200);
    const parsed = await response.json() as { settings: Settings; overrides: unknown };
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
    expect(parsed.overrides).toEqual({});
    expect(parsed.settings.retentionDays).toBe(30);
    expect(parsed.settings.retentionConfigured).toBe(false);
    expect(parsed.settings.runMode).toBe('always');
    expect(JSON.stringify(parsed)).not.toContain('synthetic-read-token');
    expect(JSON.stringify(parsed)).not.toContain('ATC_');
  });
});

test('POST 保存固定字段并落盘，GET 随后读到同一份生效值', async () => {
  await withDir(async (dir, handler) => {
    const next = { ...DEFAULT_SETTINGS, preset: 'sea', accent: ACCENTS.sea.accent,
      accentSoft: ACCENTS.sea.accentSoft, fontSize: 'relaxed', lang: 'en' };
    const saved = await post(handler, next);
    expect(saved.status).toBe(200);
    expect((await saved.json() as { settings: { lang: string } }).settings.lang).toBe('en');
    const onDisk = JSON.parse(readFileSync(join(dir, 'config', 'settings.json'), 'utf8'));
    expect(onDisk).toEqual({ preset: 'sea', accent: ACCENTS.sea.accent,
      accentSoft: ACCENTS.sea.accentSoft, fontSize: 'relaxed', lang: 'en' });
    const after = await get(handler);
    expect((await after.json() as { settings: unknown }).settings).toEqual(next);
  });
});

test('POST 完整新字段返回生效值并落盘，GET 随后读到同一份', async () => {
  await withDir(async (dir, handler) => {
    const next: Settings = {
      ...DEFAULT_SETTINGS, preset: 'sea', accent: ACCENTS.sea.accent,
      accentSoft: ACCENTS.sea.accentSoft, fontSize: 'relaxed', lang: 'en',
      retentionDays: 90, retentionConfigured: true, runMode: 'app',
    };
    const saved = await post(handler, next);
    expect(saved.status).toBe(200);
    const body = await saved.json() as { settings: typeof DEFAULT_SETTINGS; overrides: Partial<typeof DEFAULT_SETTINGS> };
    expect(body.settings).toEqual(next);
    expect(body.settings.retentionDays).toBe(90);
    expect(body.settings.retentionConfigured).toBe(true);
    expect(body.settings.runMode).toBe('app');
    expect(body.overrides.retentionDays).toBe(90);
    expect(body.overrides.retentionConfigured).toBe(true);
    expect(body.overrides.runMode).toBe('app');
    const onDisk = JSON.parse(readFileSync(join(dir, 'config', 'settings.json'), 'utf8'));
    expect(onDisk).toEqual({
      preset: 'sea', accent: ACCENTS.sea.accent,
      accentSoft: ACCENTS.sea.accentSoft, fontSize: 'relaxed', lang: 'en',
      retentionDays: 90, retentionConfigured: true, runMode: 'app',
    });
    const after = await get(handler);
    expect((await after.json() as { settings: unknown }).settings).toEqual(next);
  });
});

test('POST 非法保留期与非法 runMode 走 400，文件不动', async () => {
  await withDir(async (dir, handler) => {
    expect((await get(handler)).status).toBe(200);
    const unchanged = readFileSync(join(dir, 'config', 'settings.json'), 'utf8');
    expect((await post(handler, { ...DEFAULT_SETTINGS, retentionDays: 45 })).status).toBe(400);
    expect((await post(handler, { ...DEFAULT_SETTINGS, runMode: 'weekly' })).status).toBe(400);
    expect((await post(handler, { ...DEFAULT_SETTINGS, retentionConfigured: 'yes' })).status).toBe(400);
    expect(readFileSync(join(dir, 'config', 'settings.json'), 'utf8')).toBe(unchanged);
  });
});

test('写入端点拒绝未知键、缺字段、非法 JSON、超限与跨站 Origin', async () => {
  await withDir(async (dir, handler) => {
    // 首次 GET 建好 config/ 与空文件，随后断言坏写入没有改到它。
    expect((await get(handler)).status).toBe(200);
    const unchanged = readFileSync(join(dir, 'config', 'settings.json'), 'utf8');
    expect((await post(handler, { ...DEFAULT_SETTINGS, extra: 1 })).status).toBe(400);
    expect((await post(handler, { appearance: 'dark' })).status).toBe(400);
    expect((await post(handler, { ...DEFAULT_SETTINGS, appearance: 'neon' })).status).toBe(400);
    expect((await post(handler, 'not json')).status).toBe(400);
    expect((await post(handler, { pad: 'x'.repeat(5000) })).status).toBe(413);
    const foreign = await post(handler, DEFAULT_SETTINGS, { host: '127.0.0.1:8320', origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    expect(readFileSync(join(dir, 'config', 'settings.json'), 'utf8')).toBe(unchanged);
  });
});

test('Host、Origin 与同源三道门对 GET 与 POST 同样生效', async () => {
  await withDir(async (_dir, handler) => {
    for (const method of ['GET', 'POST']) {
      const badHost = await handler(new Request('http://127.0.0.1:8320/api/settings', {
        method, headers: { host: 'evil.example', origin: 'http://evil.example', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }));
      expect(badHost.status).toBe(403);
      const nullOrigin = await handler(new Request('http://127.0.0.1:8320/api/settings', {
        method, headers: { host: '127.0.0.1:8320', origin: 'null', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }));
      expect(nullOrigin.status).toBe(403);
      const noAuth = await handler(new Request('http://127.0.0.1:8320/api/settings', {
        method, headers: { host: '127.0.0.1:8320', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }));
      expect(noAuth.status).toBe(401);
    }
    // Bearer 路径同样可用于设置读写，不另开认证分支。
    const bearer = await handler(new Request('http://127.0.0.1:8320/api/settings', {
      headers: { host: '127.0.0.1:8320', authorization: 'Bearer synthetic-read-token' },
    }));
    expect(bearer.status).toBe(200);
  });
});

test('非设置路径的 POST 仍按旧方法闸门拒绝，不扩大接口面', async () => {
  await withDir(async (_dir, handler) => {
    const response = await handler(new Request('http://127.0.0.1:8320/api/stats', {
      method: 'POST', headers: { ...HOST, 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(405);
  });
});
