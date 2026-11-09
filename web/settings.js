// @ts-check
/**
 * 用户设置的服务端状态：唯一权威是 <dataDir>/config/settings.json。
 *
 * 页面只在启动时读一次，改动经具名 saveSettings 保存；保存失败时状态不翻转，
 * 界面用上一次成功的生效值继续渲染。localStorage 只作服务端不可写时的降级
 * 缓存：首次启动把 tc.theme / tc.lang 迁到服务端，之后不再把浏览器存储当权威。
 */
import { currentLocale, setLocale } from './i18n.js';
import { setReduceMotion } from './motion.js';
import { applyTheme, applyLangButton, setThemePref, setThemeChange, setLangChange } from './layout.js';

/** @typedef {import('../src/settings').Settings} Settings */
/** @typedef {import('../src/settings').SettingsPayload} SettingsPayload */
/** @typedef {import('../src/read-contract').ReadTransport} ReadTransport */

const SCALE = { compact: 0.92, regular: 1, relaxed: 1.06 };
const PRESET_ACCENTS = {
  paper: { accent: '#007AFF', accentSoft: 'rgba(0,122,255,.07)' },
  sea: { accent: '#0E8A8A', accentSoft: 'rgba(14,138,138,.10)' },
  moss: { accent: '#4C7A3F', accentSoft: 'rgba(76,122,63,.10)' },
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\(\d{1,3},\d{1,3},\d{1,3},0?\.\d{1,2}\)$/;

/** @type {Settings | null} */
let current = null;
/** @type {ReadTransport | null} */
let transport = null;
/** @type {(() => void) | null} */
let onLocaleChange = null;
/** @type {(message: string) => void} */
let notify = () => {};

/** @param {unknown} value @returns {value is Settings} */
function isSettings(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = /** @type {Record<string, unknown>} */ (value);
  return ['paper', 'sea', 'moss'].includes(String(v.preset))
    && ['system', 'light', 'dark'].includes(String(v.appearance))
    && typeof v.accent === 'string' && HEX.test(v.accent)
    && typeof v.accentSoft === 'string' && RGBA.test(v.accentSoft)
    && ['compact', 'regular', 'relaxed'].includes(String(v.fontSize))
    && typeof v.reduceMotion === 'boolean'
    && ['zh', 'en'].includes(String(v.lang));
}

/** 把一份完整设置写到 CSS 变量与语言/主题状态，不触碰页面内容区。 */
function apply(/** @type {Settings} */ s, redrawChrome = false) {
  const root = document.documentElement;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--accent-soft', s.accentSoft);
  root.style.setProperty('--fs-scale', String(SCALE[s.fontSize]));
  setThemePref(s.appearance);
  setReduceMotion(s.reduceMotion);
  if (s.lang !== currentLocale()) {
    setLocale(s.lang);
    if (redrawChrome) onLocaleChange?.();
  }
  applyLangButton();
  applyTheme();
}

/**
 * 首次迁移：tc.theme 与 tc.lang 只在服务端仍是默认值时才覆盖一次，避免把
 * 用户在别处改过的服务端选择拉回浏览器旧值。存储不可用时静默跳过。
 * @returns {Partial<Settings>}
 */
export function legacyOverrides() {
  /** @type {Partial<Settings>} */
  const out = {};
  try {
    const theme = localStorage.getItem('tc.theme');
    if (theme === 'system' || theme === 'light' || theme === 'dark') out.appearance = theme;
    const lang = localStorage.getItem('tc.lang');
    if (lang === 'zh' || lang === 'en') out.lang = lang;
  } catch { /* storage may be blocked */ }
  return out;
}

/** 降级缓存：只在服务端不可写时读，形状不合法就整份忽略。 */
function fallback() {
  try {
    const raw = localStorage.getItem('tc.settings');
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return isSettings(parsed) ? parsed : null;
  } catch { return null; }
}

function cache(/** @type {Settings} */ s) {
  try { localStorage.setItem('tc.settings', JSON.stringify(s)); } catch { /* storage may be blocked */ }
}

/** @returns {Settings} 当前生效值；只读，改动一律经 set()。 */
export function settings() {
  return /** @type {Settings} */ (current);
}

/**
 * 启动时装配：注入读取 transport 与语言重绘回调，读服务端设置并应用。
 * 服务端不可用时退回降级缓存或默认值，页面照常渲染。
 * @param {ReadTransport} reader
 * @param {() => void} redraw
 * @param {(message: string) => void} [toast]
 */
export async function initSettings(reader, redraw, toast) {
  transport = reader;
  onLocaleChange = redraw;
  notify = toast ?? (() => {});
  // 顶栏快捷切换也走保存端点：不写 localStorage，不与服务端权威分叉。
  setThemeChange(next => { if (current !== null) void set({ ...current, appearance: next }); });
  setLangChange(next => { if (current !== null) void set({ ...current, lang: next }); });
  let payload = /** @type {SettingsPayload | null} */ (null);
  try {
    payload = await reader.execute('settings', {}, { signal: new AbortController().signal });
  } catch { /* 服务端不可写或暂时不可用：走降级缓存 */ }
  if (payload !== null && isSettings(payload.settings)) {
    current = payload.settings;
    cache(current);
  } else {
    current = fallback() ?? {
      preset: 'paper', appearance: 'system', accent: PRESET_ACCENTS.paper.accent,
      accentSoft: PRESET_ACCENTS.paper.accentSoft, fontSize: 'regular',
      reduceMotion: false, lang: currentLocale(),
    };
  }
  apply(current);
  // 迁移只做一次：仅当服务端该字段仍是默认值且浏览器存过旧偏好时提交。
  const legacy = legacyOverrides();
  const needsMigration = Object.keys(legacy).some(key =>
    current?.[/** @type {keyof Settings} */ (key)] !== legacy[/** @type {keyof Settings} */ (key)]
    && payload?.overrides?.[/** @type {keyof Settings} */ (key)] === undefined);
  if (needsMigration && transport !== null) {
    await set({ ...current, ...legacy });
  }
}

/**
 * 保存一份完整设置：服务端成功才翻转当前值，失败保留旧值并回报一句。
 * @param {Settings} next
 * @returns {Promise<boolean>}
 */
export async function set(next) {
  if (!isSettings(next) || transport === null) return false;
  try {
    const payload = await transport.execute('saveSettings', next, { signal: new AbortController().signal });
    if (!isSettings(payload.settings)) return false;
    const langChanged = current !== null && current.lang !== payload.settings.lang;
    current = payload.settings;
    cache(current);
    apply(current, langChanged);
    return true;
  } catch {
    notify('设置没能保存，请重试');
    return false;
  }
}

/** 主题预设带一组受控强调色；单独点强调色时预设记为 custom 由面板表达。 */
export function presetAccents(/** @type {keyof typeof PRESET_ACCENTS} */ name) {
  return PRESET_ACCENTS[name];
}
