// @ts-check
/**
 * 设置面板 DOM：从窗口右侧压入，四类页签按接线状态分工。
 *
 * 外观六项即时生效；采集来源、历史与空间、异常提醒这些未接线的开关不摆进
 * 界面，界面也不声称已经生效。接入页只读渲染运维手册里的片段，令牌由装配处
 * 注入，不进设置文件、日志或 fixture。所有文案走 t()，中英两份同改。
 */
import { esc } from './html.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { settings, set, presetAccents } from './settings.js';

/** @typedef {import('../src/settings').Settings} Settings */

const PRESET_NAMES = { paper: '纸白', sea: '海蓝', moss: '苔绿' };
const TOOL_NAMES = { claude: 'Claude Code', codex: 'Codex', magpie: 'magpie' };
const ACCENT_NAMES = { '#007AFF': '蓝', '#0E8A8A': '青', '#7C5CD6': '紫', '#B45309': '橙' };
const PRESETS = /** @type {const} */ (['paper', 'sea', 'moss']);
const APPEARANCES = /** @type {const} */ (['system', 'light', 'dark']);
const FONTS = /** @type {const} */ (['compact', 'regular', 'relaxed']);
const ACCENTS = /** @type {const} */ ([
  { color: '#007AFF', soft: 'rgba(0,122,255,.07)' },
  { color: '#0E8A8A', soft: 'rgba(14,138,138,.10)' },
  { color: '#7C5CD6', soft: 'rgba(124,92,214,.10)' },
  { color: '#B45309', soft: 'rgba(180,83,9,.10)' },
]);
/** 只读接入片段；与 docs/operations.md 的 OTLP 与 magpie 片段一致。 */
const SNIPPETS = {
  claude: 'export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:8320\n'
    + 'export OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer $ATC_TOKEN"\n'
    + 'export OTEL_LOG_RAW_API_BODIES=file',
  codex: '[otel.trace_exporter.otlp-http]\n'
    + 'endpoint = "http://127.0.0.1:8320/v1/traces"\n'
    + 'protocol = "binary"\n'
    + '[otel.trace_exporter.otlp-http.headers]\n'
    + 'authorization = "Bearer $ATC_TOKEN"',
  magpie: '{\n  "options": {\n'
    + '    "endpoint": "http://127.0.0.1:8320/hook/ingest",\n'
    + '    "token": "$ATC_HOOK_TOKEN"\n  }\n}',
};

const CATS = /** @type {const} */ (['appearance', 'sources', 'history', 'connect']);
let tab = 'appearance';
let tool = 'claude';
let open = false;
/** @type {(message: string) => void} */
let toast = () => {};

function el(/** @type {string} */ id) {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing_element:${id}`);
  return node;
}

/** @param {string} text */
function tip(text) {
  return `<span class="set-tip" tabindex="0" role="note" data-tip="${esc(text)}">?</span>`;
}

/** @param {string} label @param {string} body @param {string} [withTip] */
function group(label, body, withTip) {
  return `<div class="set-group"><span class="set-glabel">${esc(label)}${withTip ? tip(withTip) : ''}</span>${body}</div>`;
}

/** @param {Settings['preset']} name */
function presetCard(name) {
  const p = presetAccents(name);
  return `<button class="set-preset" data-preset="${name}" aria-pressed="false">`
    + `<span class="set-swatches"><i style="background:var(--page)"></i><i style="background:var(--surface)"></i>`
    + `<i style="background:${esc(p.accent)}"></i><i style="background:var(--text)"></i></span>`
    + `<span class="set-preset-name">${esc(t(PRESET_NAMES[name]))}</span></button>`;
}

/** @param {string} attr @param {readonly string[]} values @param {readonly string[]} labels */
function segment(attr, values, labels) {
  return `<div class="set-seg">${values.map((v, i) =>
    `<button data-${attr}="${v}" aria-pressed="false">${esc(t(labels[i]))}</button>`).join('')}</div>`;
}

/** @param {string} label @param {string} field @param {boolean} checked @param {string} hint */
function switchRow(label, field, checked, hint) {
  return `<div class="set-switch-row"><span class="set-switch-label">${esc(t(label))}</span>`
    + (hint ? tip(hint) : '')
    + `<label class="set-switch"><input type="checkbox" data-field="${field}" ${checked ? 'checked' : ''} `
    + `aria-label="${esc(t(label))}"><i></i></label></div>`;
}

/** @param {Settings} s */
function appearancePanel(s) {
  return `<div class="set-panel" data-panel="appearance">`
    + group(t('主题'), `<div class="set-presets" id="set-presets">${PRESETS.map(presetCard).join('')}</div>`)
    + group(t('明暗'), segment('appearance', APPEARANCES, ['跟随系统', '浅色', '深色']), '')
    + group(t('强调色'), `<div class="set-accents" id="set-accents">${ACCENTS.map(a =>
      `<button data-color="${a.color}" data-soft="${esc(a.soft)}" style="--swatch:${a.color}" `
      + `aria-label="${esc(t(ACCENT_NAMES[/** @type {keyof typeof ACCENT_NAMES} */ (a.color)]))}" aria-pressed="false"></button>`).join('')}</div>`, '')
    + group(t('字号'), segment('font', FONTS, ['紧凑', '标准', '宽松']), t('只改变界面文字大小，读数与图形不受影响。'))
    + group(t('动效与语言'),
      switchRow('减少动效', 'reduceMotion', s.reduceMotion, t('关掉过渡与入场动画；正在进行的读取不受影响。'))
      + segment('lang', ['zh', 'en'], ['中文', 'English']))
    + `</div>`;
}

/** 未接线分类只给出事实与去处，不摆开关、不写「已生效」文案。 */
function sourcesPanel() {
  return `<div class="set-panel" data-panel="sources" hidden>`
    + group(t('采集来源'), `<p class="set-note">${esc(t('采集来源由本机自动发现。这里暂不提供开关。'))}</p>`)
    + `</div>`;
}

function historyPanel() {
  return `<div class="set-panel" data-panel="history" hidden>`
    + group(t('历史与空间'), `<p class="set-note">${esc(t('保留时长与额外隐藏词尚未接线，暂不提供开关。'))}</p>`)
    + `</div>`;
}

function connectPanel() {
  return `<div class="set-panel" data-panel="connect" hidden>`
    + group(t('接入方式'), `<div class="set-tool-tabs" id="set-tool-tabs">${Object.keys(SNIPPETS).map(name =>
      `<button data-tool="${name}" aria-pressed="false">${esc(TOOL_NAMES[/** @type {keyof typeof TOOL_NAMES} */ (name)])}</button>`).join('')}</div>`)
    + `<div class="set-codebox"><button class="set-copy" id="set-copy">${esc(t('复制'))}</button>`
      + `<pre id="set-snippet"></pre></div>`
    + `<p class="set-note">${esc(t('令牌从数据目录读取，不写进设置文件。'))}</p>`
    + `</div>`;
}

/** @param {string} cat @param {string} label */
function navButton(cat, label) {
  return `<button data-cat="${cat}" aria-selected="false">${esc(t(label))}</button>`;
}

export function settingsHtml() {
  return `<button class="set-scrim" id="set-scrim" aria-label="${esc(t('关闭设置'))}" hidden></button>`
    + `<section class="settings" id="settings" aria-label="${esc(t('设置'))}" hidden>`
    + `<div class="set-head"><h2>${esc(t('设置'))}</h2>`
      + `<button class="set-close" id="set-close" aria-label="${esc(t('关闭设置'))}">`
      + icon('close', 16) + `</button></div>`
    + `<nav class="set-nav" id="set-nav" aria-label="${esc(t('设置分类'))}">`
      + navButton('appearance', '外观') + navButton('sources', '采集来源')
      + navButton('history', '历史与空间') + navButton('connect', '接入') + `</nav>`
    + `<div class="set-body" id="set-body"></div>`
    + `<div class="set-foot"><span class="set-path">${esc(t('设置保存在本机数据目录'))}</span>`
      + `<button class="set-mini" id="set-export">${esc(t('复制主题'))}</button>`
      + `<button class="set-mini" id="set-import">${esc(t('导入主题'))}</button>`
      + `<div class="set-import" id="set-import-box" hidden><textarea id="set-import-text" `
      + `aria-label="${esc(t('粘贴主题 JSON'))}"></textarea><button class="set-mini" id="set-import-apply">`
      + `${esc(t('应用'))}</button><span class="set-import-msg" id="set-import-msg"></span></div></div>`
    + `</section>`;
}

/** @param {Settings} s */
function paint(s) {
  const body = el('set-body');
  body.innerHTML = appearancePanel(s) + sourcesPanel() + historyPanel() + connectPanel();
  for (const button of el('set-nav').querySelectorAll('button')) {
    button.setAttribute('aria-selected', String(button.getAttribute('data-cat') === tab));
  }
  for (const panel of body.querySelectorAll('[data-panel]')) {
    /** @type {HTMLElement} */ (panel).hidden = panel.getAttribute('data-panel') !== tab;
  }
  const presets = el('set-presets');
  // 自定义强调色不存 'custom' 这个非法预设值：按当前配色与预设色比对选中态。
  for (const button of presets.querySelectorAll('button')) {
    const name = /** @type {Settings['preset']} */ (button.getAttribute('data-preset') ?? 'paper');
    button.setAttribute('aria-pressed', String(presetAccents(name).accent === s.accent));
  }
  for (const button of body.querySelectorAll('[data-appearance]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-appearance') === s.appearance));
  }
  for (const button of body.querySelectorAll('[data-font]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-font') === s.fontSize));
  }
  for (const button of body.querySelectorAll('[data-lang]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-lang') === s.lang));
  }
  for (const button of el('set-accents').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-color') === s.accent));
  }
  const motion = body.querySelector('[data-field="reduceMotion"]');
  if (motion instanceof HTMLInputElement) motion.checked = s.reduceMotion;
  for (const button of el('set-tool-tabs').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-tool') === tool));
  }
  el('set-snippet').textContent = SNIPPETS[/** @type {keyof typeof SNIPPETS} */ (tool)] ?? SNIPPETS.claude;
  el('settings').hidden = !open;
  el('set-scrim').hidden = !open;
  el('set-settings-toggle')?.setAttribute('aria-pressed', String(open));
}

/** 保存一次并重绘：失败时 settings() 仍是旧值，paint 把控件拨回旧值。
 * @param {Settings} next */
async function commit(next) {
  await set(next);
  paint(settings());
}

/** @param {string} message */
/** @param {string} message */
function showToast(message) { toast(message); }

/**
 * 装配面板交互。toast 归调用方（页面已有 toast 实现），本模块不另建一套。
 * @param {(message: string) => void} toastFn
 */
export function initSettingsPanel(toastFn) {
  toast = toastFn;
  // 面板 DOM 由本模块注入：index.html 只留顶栏入口，不让静态骨架与渲染重复。
  const host = document.createElement('div');
  host.innerHTML = settingsHtml();
  document.body.append(...host.childNodes);
  paint(settings());

  el('set-settings-toggle').addEventListener('click', () => { open = !open; paint(settings()); });
  el('set-close').addEventListener('click', () => { open = false; paint(settings()); });
  el('set-scrim').addEventListener('click', () => { open = false; paint(settings()); });
  el('set-nav').addEventListener('click', e => {
    const button = /** @type {HTMLElement} */ (e.target).closest('[data-cat]');
    if (button === null) return;
    tab = button.getAttribute('data-cat') ?? 'appearance';
    paint(settings());
  });
  el('set-body').addEventListener('click', async e => {
    const button = /** @type {HTMLElement} */ (e.target).closest('button');
    if (button === null) return;
    const s = settings();
    const preset = button.getAttribute('data-preset');
    if (preset !== null && preset !== '') {
      await commit({ ...s, preset: /** @type {Settings['preset']} */ (preset), ...presetAccents(/** @type {Settings['preset']} */ (preset)) });
      return;
    }
    const appearance = button.getAttribute('data-appearance');
    if (appearance !== null) { await commit({ ...s, appearance: /** @type {Settings['appearance']} */ (appearance) }); return; }
    const font = button.getAttribute('data-font');
    if (font !== null) { await commit({ ...s, fontSize: /** @type {Settings['fontSize']} */ (font) }); return; }
    const lang = button.getAttribute('data-lang');
    if (lang !== null) { await commit({ ...s, lang: /** @type {Settings['lang']} */ (lang) }); return; }
    const color = button.getAttribute('data-color');
    if (color !== null) {
      await commit({ ...s, accent: color, accentSoft: button.getAttribute('data-soft') ?? s.accentSoft });
      return;
    }
    const toolTab = button.getAttribute('data-tool');
    if (toolTab !== null) { tool = toolTab; paint(settings()); return; }
    if (button.id === 'set-copy') {
      void navigator.clipboard?.writeText(el('set-snippet').textContent ?? '').then(
        () => showToast(t('已复制')), () => showToast(t('复制失败，请手动选中')));
      return;
    }
    if (button.id === 'set-export') {
      const s2 = settings();
      void navigator.clipboard?.writeText(JSON.stringify({
        preset: s2.preset, accent: s2.accent, accentSoft: s2.accentSoft,
        appearance: s2.appearance, font: s2.fontSize, reduceMotion: s2.reduceMotion,
      }, null, 2)).then(() => showToast(t('已复制')), () => showToast(t('复制失败，请手动选中')));
      return;
    }
    if (button.id === 'set-import') {
      const box = el('set-import-box');
      box.hidden = !box.hidden;
      return;
    }
    if (button.id === 'set-import-apply') {
      const msg = el('set-import-msg');
      try {
        const data = JSON.parse((/** @type {HTMLTextAreaElement} */ (el('set-import-text'))).value);
        if (data === null || typeof data !== 'object' || typeof data.accent !== 'string'
          || !/^#[0-9a-fA-F]{6}$/.test(data.accent)) throw new Error('shape');
        const s3 = settings();
        const next = { ...s3, accent: data.accent };
        if (typeof data.accentSoft === 'string' && /^rgba\(\d{1,3},\d{1,3},\d{1,3},0?\.\d{1,2}\)$/.test(data.accentSoft)) {
          next.accentSoft = data.accentSoft;
        }
        if (['system', 'light', 'dark'].includes(data.appearance)) next.appearance = data.appearance;
        if (['compact', 'regular', 'relaxed'].includes(data.font)) next.fontSize = data.font;
        if (typeof data.reduceMotion === 'boolean') next.reduceMotion = data.reduceMotion;
        msg.textContent = '';
        await commit(next);
        el('set-import-box').hidden = true;
      } catch {
        msg.textContent = t('这段 JSON 读不出来');
      }
    }
  });
  el('set-body').addEventListener('change', e => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.getAttribute('data-field') !== 'reduceMotion') return;
    void commit({ ...settings(), reduceMotion: input.checked });
  });
}

/** 语言切换后重绘面板文案，保持当前页签与开合状态。面板未装配时静默跳过。 */
export function refreshSettingsPanel() {
  if (document.getElementById('set-body') === null) return;
  paint(settings());
}
