// @ts-check
/**
 * 用户设置的服务端状态：唯一权威是 <dataDir>/config/settings.json。
 *
 * 页面只在启动时读一次，改动经具名 saveSettings 保存；保存失败时状态不翻转，
 * 界面用上一次成功的生效值继续渲染。localStorage 只作服务端不可写时的降级
 * 缓存：启动时清掉 tc.theme / tc.lang 旧键，只在设置文件全新时迁一次，
 * 之后不再把浏览器存储当权威。
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
/** @type {(() => void) | null} 启动时按服务端语言重画静态 chrome。 */
let onChromeRedraw = null;
/** @type {(() => void) | null} 用户切换语言时的全量重绘，动态区也要换文案。 */
let onLocaleRedraw = null;
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
    && ['zh', 'en'].includes(String(v.lang))
    && typeof v.retentionDays === 'number' && [7, 30, 90, 180, 365].includes(v.retentionDays)
    && typeof v.retentionConfigured === 'boolean'
    && ['always', 'app'].includes(String(v.runMode));
}

/** 把一份完整设置写到 CSS 变量与语言/主题状态，不触碰页面内容区。
 * redrawChrome 只给启动用：静态文案早于设置读取渲染过一次，需要按服务端语言重画。
 * @param {Settings} s
 * @param {boolean} [redrawChrome]
 */
function apply(s, redrawChrome = false) {
  const root = document.documentElement;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--accent-soft', s.accentSoft);
  root.style.setProperty('--fs-scale', String(SCALE[s.fontSize]));
  setThemePref(s.appearance);
  setReduceMotion(s.reduceMotion);
  if (s.lang !== currentLocale()) setLocale(s.lang);
  root.lang = s.lang === 'zh' ? 'zh-CN' : 'en';
  applyLangButton();
  applyTheme();
  // 启动时也要按服务端语言重画静态文案：applyStaticTexts 早于设置读取跑过一次。
  if (redrawChrome) onChromeRedraw?.();
}

/**
 * 读一次旧偏好并删键。是否采用这些值由 initSettings 按服务端是否全新决定：
 * 已有的服务端选择不能被浏览器残留值覆盖，旧键每次启动都清掉。
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
    localStorage.removeItem('tc.theme');
    localStorage.removeItem('tc.lang');
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
 * 启动时装配：注入读取 transport 与两种语言重绘回调，读服务端设置并应用。
 * 服务端不可用时退回降级缓存或默认值，页面照常渲染。
 * @param {ReadTransport} reader
 * @param {() => void} chromeRedraw 服务端语言就位时重画静态文案
 * @param {() => void} localeRedraw 用户切换语言时全量重绘
 * @param {(message: string) => void} [toast]
 */
export async function initSettings(reader, chromeRedraw, localeRedraw, toast) {
  transport = reader;
  onChromeRedraw = chromeRedraw;
  onLocaleRedraw = localeRedraw;
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
      retentionDays: 30, retentionConfigured: false, runMode: 'always',
    };
  }
  apply(current, true);
  // 旧键每次启动都清；只有全新的服务端文件才采用它们，之后浏览器存储不再有资格覆盖。
  const legacy = legacyOverrides();
  const freshServer = payload !== null && Object.keys(payload.overrides).length === 0;
  const needsMigration = freshServer && Object.keys(legacy).some(key =>
    current?.[/** @type {keyof Settings} */ (key)] !== legacy[/** @type {keyof Settings} */ (key)]);
  if (needsMigration && transport !== null) await set({ ...current, ...legacy });
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
    apply(current);
    if (langChanged) onLocaleRedraw?.();
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

/**
 * 会话保留预览：只读具名操作。面板打开历史与空间页时调用，失败返回 null，
 * 由调用方显示「统计失败」，不把失败写成一串 0。
 * @param {number} keepDays
 * @returns {Promise<import('../src/read-contract').ReadOutput<'retentionPreview'> | null>}
 */
export async function previewRetention(keepDays) {
  if (transport === null) return null;
  try {
    return await transport.execute('retentionPreview', { keepDays },
      { signal: new AbortController().signal });
  } catch {
    return null;
  }
}
