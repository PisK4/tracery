/**
 * 用户设置：发布默认值、类型校验与数据目录下的覆盖文件。
 *
 * 进程装配继续由 config.ts 持有环境变量与 plist。这里只管用户能决定的选择：
 * 默认值随代码发布，settings.json 只存与默认值不同的项。文件是外部输入，
 * 未知键、类型不符与越界取值都回退到默认值并留一条可查 issue，不改写或删除
 * 原文件，也不让坏文件拦住采集器启动。
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiagnosticLog } from './monitoring';

/** 加载路径只需要错误出口；装配处传完整 DiagnosticLog 也满足这个形状。 */
export type DiagnosticLogLike = Pick<DiagnosticLog, 'error'>;

/** 外观预设：一组受控配色值，不执行用户提供的 CSS 或脚本。 */
export type Preset = 'paper' | 'sea' | 'moss';
export type Appearance = 'system' | 'light' | 'dark';
export type FontSize = 'compact' | 'regular' | 'relaxed';
export type Lang = 'zh' | 'en';
export type RetentionDays = 7 | 30 | 90 | 180 | 365;
export type RunMode = 'always' | 'app';

/** 第一阶段的可见设置，含已接线的历史保留；采集来源与隐藏词等未接线的开关不进这里。 */
export type Settings = {
  preset: Preset;
  appearance: Appearance;
  accent: string;
  accentSoft: string;
  fontSize: FontSize;
  reduceMotion: boolean;
  lang: Lang;
  retentionDays: RetentionDays;
  retentionConfigured: boolean;
  runMode: RunMode;
};

/** 一条可查 issue：键名与固定原因码，不写入原始取值或任意路径。 */
export type SettingsIssue = { key: string; code: string };

const PRESETS: readonly Preset[] = ['paper', 'sea', 'moss'];
const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];
const FONT_SIZES: readonly FontSize[] = ['compact', 'regular', 'relaxed'];
const LANGS: readonly Lang[] = ['zh', 'en'];
const RETENTION_DAYS: readonly RetentionDays[] = [7, 30, 90, 180, 365];
const RUN_MODES: readonly RunMode[] = ['always', 'app'];

/** 强调色预设：选一项就换一组受控令牌，页面不接收任意 CSS。 */
export const ACCENTS: Record<Preset, { accent: string; accentSoft: string }> = {
  paper: { accent: '#007AFF', accentSoft: 'rgba(0,122,255,.07)' },
  sea: { accent: '#0E8A8A', accentSoft: 'rgba(14,138,138,.10)' },
  moss: { accent: '#4C7A3F', accentSoft: 'rgba(76,122,63,.10)' },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\(\d{1,3},\d{1,3},\d{1,3},0?\.\d{1,2}\)$/;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  ...ACCENTS.paper, preset: 'paper' as Preset, appearance: 'system' as Appearance,
  fontSize: 'regular' as FontSize, reduceMotion: false, lang: 'zh' as Lang,
  retentionDays: 30 as RetentionDays, retentionConfigured: false, runMode: 'always' as RunMode,
});

const VALIDATORS: {
  [K in keyof Settings]: (value: unknown) => value is Settings[K];
} = {
  preset: (v): v is Preset => typeof v === 'string' && PRESETS.includes(v as Preset),
  appearance: (v): v is Appearance => typeof v === 'string' && APPEARANCES.includes(v as Appearance),
  accent: (v): v is string => typeof v === 'string' && HEX.test(v),
  accentSoft: (v): v is string => typeof v === 'string' && RGBA.test(v),
  fontSize: (v): v is FontSize => typeof v === 'string' && FONT_SIZES.includes(v as FontSize),
  reduceMotion: (v): v is boolean => typeof v === 'boolean',
  lang: (v): v is Lang => typeof v === 'string' && LANGS.includes(v as Lang),
  retentionDays: (v): v is RetentionDays => typeof v === 'number' && RETENTION_DAYS.includes(v as RetentionDays),
  retentionConfigured: (v): v is boolean => typeof v === 'boolean',
  runMode: (v): v is RunMode => typeof v === 'string' && RUN_MODES.includes(v as RunMode),
};

export const SETTINGS_KEYS: readonly (keyof Settings)[] = Object.keys(VALIDATORS) as (keyof Settings)[];

/** 页面收到的值与服务端保存的 overrides 分开：响应不带路径、令牌或环境变量。 */
export type SettingsPayload = { settings: Settings; overrides: Partial<Settings> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 把一份外部 JSON 收敛成「有效 overrides + issues」。未知键、类型不符与越界
 * 取值逐项记 issue；缺字段不是错误，缺省走发布默认值。调用方决定怎么处理
 * issues，本函数不写日志也不碰文件系统。
 */
export function parseOverrides(raw: unknown): { overrides: Partial<Settings>; issues: SettingsIssue[] } {
  const overrides: Partial<Settings> = {};
  const issues: SettingsIssue[] = [];
  if (!isRecord(raw)) {
    if (raw !== undefined) issues.push({ key: 'file', code: 'settings_root_invalid' });
    return { overrides, issues };
  }
  for (const key of Object.keys(raw)) {
    if (!SETTINGS_KEYS.includes(key as keyof Settings)) {
      issues.push({ key, code: 'settings_unknown_key' });
      continue;
    }
    const typed = key as keyof Settings;
    const value = raw[key];
    if (!VALIDATORS[typed](value)) {
      issues.push({ key, code: 'settings_invalid_value' });
      continue;
    }
    // 与默认值相同的项不必存：文件只留用户真正改过的选择。
    if (value !== DEFAULT_SETTINGS[typed]) overrides[typed] = value as never;
  }
  return { overrides, issues };
}

/** 发布默认值与 overrides 合成一份完整值，供页面与采集器共用。 */
export function resolveSettings(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** 目录与文件的权限沿用数据目录的边界；原子替换避免写到一半被页面读到。 */
function persist(dataDir: string, overrides: Partial<Settings>): void {
  const dir = join(dataDir, 'config');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, 'settings.json');
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(overrides, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  // themes/ 是可分享主题的家；第一阶段还没有导入导出，目录先就位。
  const themes = join(dir, 'themes');
  mkdirSync(themes, { recursive: true, mode: 0o700 });
  chmodSync(themes, 0o700);
}

/**
 * 启动时读一次用户设置，并建好 config/ 与 themes/。坏文件不改写、不删除，
 * issues 逐条交给诊断日志；未知键的原内容继续留在文件里。
 */
export function loadSettings(dataDir: string, diagnostics?: DiagnosticLogLike): SettingsPayload {
  const dir = join(dataDir, 'config');
  const themes = join(dir, 'themes');
  mkdirSync(themes, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  chmodSync(themes, 0o700);
  const file = join(dir, 'settings.json');
  let raw: unknown = undefined;
  try {
    const text = readFileSync(file, 'utf8');
    try {
      raw = JSON.parse(text);
    } catch {
      raw = { __invalid_json: true };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // 首次启动：写一份空的 overrides，让文件与权限都成为可核对的事实。
    persist(dataDir, {});
  }
  if (isRecord(raw) && raw.__invalid_json === true) {
    const issues: SettingsIssue[] = [{ key: 'file', code: 'settings_invalid_json' }];
    for (const issue of issues) diagnostics?.error('settings.load', { code: issue.code, phase: issue.key });
    return { settings: DEFAULT_SETTINGS as Settings, overrides: {} };
  }
  const { overrides, issues } = parseOverrides(raw);
  for (const issue of issues) diagnostics?.error('settings.load', { code: issue.code, phase: issue.key });
  return { settings: resolveSettings(overrides), overrides };
}

/**
 * 保存一份完整设置：只接受固定字段，未知键明确拒绝。返回新的 overrides 与
 * 生效值；调用方按这份返回值刷新页面状态，不回读文件。
 */
export function saveSettings(dataDir: string, input: unknown): SettingsPayload {
  if (!isRecord(input)) throw new Error('settings_invalid_input');
  const clean: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    if (!Object.hasOwn(input, key)) throw new Error('settings_missing_field');
    clean[key] = input[key];
  }
  for (const key of Object.keys(input)) {
    if (!SETTINGS_KEYS.includes(key as keyof Settings)) throw new Error('settings_unknown_key');
  }
  const { overrides, issues } = parseOverrides(clean);
  if (issues.length > 0) throw new Error(issues[0]!.code);
  persist(dataDir, overrides);
  return { settings: resolveSettings(overrides), overrides };
}
