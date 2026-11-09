import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACCENTS, DEFAULT_SETTINGS, loadSettings, parseOverrides, resolveSettings, saveSettings,
  type DiagnosticLogLike,
} from '../src/settings';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'atc-settings-'));
}

/** 合成诊断出口：只收固定码与键名，不落任何真实路径或取值。 */
function log(): { diagnostics: DiagnosticLogLike; codes: string[] } {
  const codes: string[] = [];
  return {
    codes,
    diagnostics: { error: (_op, input) => { codes.push(`${input.phase}:${String(input.code)}`); } },
  };
}

function full(over: Partial<typeof DEFAULT_SETTINGS> = {}) {
  return { ...DEFAULT_SETTINGS, ...over };
}

describe('settings 加载与校验', () => {
  test('全新数据目录生成 0700 config/ 与空 overrides，默认值齐全', () => {
    const dir = tempDir();
    try {
      const payload = loadSettings(dir);
      expect(payload.settings).toEqual(DEFAULT_SETTINGS);
      expect(payload.overrides).toEqual({});
      expect(statSync(join(dir, 'config')).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, 'config', 'themes')).mode & 0o777).toBe(0o700);
      expect(JSON.parse(readFileSync(join(dir, 'config', 'settings.json'), 'utf8'))).toEqual({});
      expect(statSync(join(dir, 'config', 'settings.json')).mode & 0o777).toBe(0o600);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('坏文件：未知键、错误类型、越界取值都不崩、不改写文件，并留可查 issue', () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, 'config'), { recursive: true, mode: 0o700 });
      const file = join(dir, 'config', 'settings.json');
      const bad = { appearance: 'neon', fontSize: 42, reduceMotion: 'yes', lang: 'en', unknown_key: 'x' };
      writeFileSync(file, `${JSON.stringify(bad)}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
      const before = readFileSync(file, 'utf8');
      const { diagnostics, codes } = log();
      const payload = loadSettings(dir, diagnostics);
      expect(payload.settings).toEqual(resolveSettings({ lang: 'en' }));
      expect(payload.overrides).toEqual({ lang: 'en' });
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(codes).toContain('appearance:settings_invalid_value');
      expect(codes).toContain('fontSize:settings_invalid_value');
      expect(codes).toContain('reduceMotion:settings_invalid_value');
      expect(codes).toContain('unknown_key:settings_unknown_key');
      expect(codes).not.toContain('lang:settings_unknown_key');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('非法 JSON 回退默认值且不改写文件', () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, 'config'), { recursive: true, mode: 0o700 });
      const file = join(dir, 'config', 'settings.json');
      writeFileSync(file, '{not json', { mode: 0o600 });
      const { diagnostics, codes } = log();
      expect(loadSettings(dir, diagnostics).settings).toEqual(DEFAULT_SETTINGS);
      expect(readFileSync(file, 'utf8')).toBe('{not json');
      expect(codes).toEqual(['file:settings_invalid_json']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('parseOverrides 把与默认值相同的项丢掉，未知键单独记 issue', () => {
    const { overrides, issues } = parseOverrides({ ...full(), preset: 'sea', accent: ACCENTS.sea.accent, accentSoft: ACCENTS.sea.accentSoft, nope: 1 });
    expect(overrides).toEqual({ preset: 'sea', accent: ACCENTS.sea.accent, accentSoft: ACCENTS.sea.accentSoft });
    expect(issues).toEqual([{ key: 'nope', code: 'settings_unknown_key' }]);
  });
});

describe('settings 保存', () => {
  test('只接受固定字段：未知键、缺字段、坏值与非法形状全拒绝，文件不动', () => {
    const dir = tempDir();
    try {
      loadSettings(dir);
      const file = join(dir, 'config', 'settings.json');
      const before = readFileSync(file, 'utf8');
      expect(() => saveSettings(dir, { ...full(), extra: 1 })).toThrow('settings_unknown_key');
      expect(() => saveSettings(dir, { appearance: 'dark' })).toThrow('settings_missing_field');
      expect(() => saveSettings(dir, full({ appearance: 'neon' as never }))).toThrow('settings_invalid_value');
      expect(() => saveSettings(dir, null)).toThrow('settings_invalid_input');
      expect(() => saveSettings(dir, [1, 2])).toThrow('settings_invalid_input');
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('保存后只落改过的项，重新加载得到同一份生效值', () => {
    const dir = tempDir();
    try {
      const saved = saveSettings(dir, full({ preset: 'sea', accent: ACCENTS.sea.accent, accentSoft: ACCENTS.sea.accentSoft, fontSize: 'relaxed', lang: 'en' }));
      expect(saved.settings.lang).toBe('en');
      expect(JSON.parse(readFileSync(join(dir, 'config', 'settings.json'), 'utf8'))).toEqual({
        preset: 'sea', accent: ACCENTS.sea.accent, accentSoft: ACCENTS.sea.accentSoft, fontSize: 'relaxed', lang: 'en',
      });
      expect(loadSettings(dir).settings).toEqual(saved.settings);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
