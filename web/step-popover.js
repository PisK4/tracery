// @ts-check
/**
 * 悬停浮层：单例现取现渲染。
 *
 * 锚点只落 `data-pop-key`，内容闭包在渲染时登记，悬停或聚焦时现拼 HTML。
 * 生命周期按「停住才弹」设计：轻量读数 400ms、工具参数/结果 600ms 延迟，
 * 关闭后 300ms 冷却，扫过锚点不会连锁弹出；离开锚点立即取消待弹出的计时，
 * 鼠标已经离开后不再补弹。浮层以指针为基点偏移出现，永不盖住指针。
 * 纯展示浮层（组头读数、路径、轮次输入、子代理短标）与交互浮层
 * （工具参数、结果正文）共用同一外壳；后者多出形态切换与复制两个控件。
 */

import { esc } from './html.js';
import { t } from './i18n.js';
import { compact } from './duration.js';
import { byteSize, editDiff } from './tool-summary.js';

/* ---------- 注册表：key → 内容闭包 ---------- */

/** @typedef {string | {html: string, copy: string}} PopBuild 返回 {html, copy} 时 copy 是复制按钮的原文来源 */
/** @typedef {{build: () => PopBuild, heavy: boolean}} PopEntry heavy 是工具参数/结果这类重内容 */
/** @type {Map<string, PopEntry>} */
const builds = new Map();

/**
 * @param {string} key
 * @param {() => PopBuild} build
 * @param {boolean} [heavy] 重内容用更长延迟，避免扫读时整块正文弹出
 */
export function rememberPop(key, build, heavy = false) { builds.set(key, { build, heavy }); }

/** 换会话与显式刷新调用；随后的渲染会重新登记。 */
export function resetPops() { builds.clear(); }

/* ---------- 单例浮层 ---------- */

const HOVER_DELAY = 400;
const HEAVY_DELAY = 600;
const FOCUS_DELAY = 700;
const HIDE_DELAY = 200;
const SUPPRESS_MS = 300;
const SETTLE_MS = 120;

/** @type {HTMLElement | null} */
let pop = null;
/** @type {Element | null} */
let anchor = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let showTimer;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let hideTimer;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let settleTimer;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let clearTimer;
/** 冷却截止时间：关闭后的短暂窗口内不再启动新的悬停计时。 */
let suppressUntil = 0;
/** 最近一次指针位置，浮层以此偏移出现；键盘触发回退到锚点。 */
let pointer = { x: 0, y: 0 };
/** 当前浮层的复制源；形态切换不替换它，复制始终给原文。 */
let copyText = '';

function popEl() {
  if (pop !== null) return pop;
  const el = document.createElement('div');
  el.className = 'step-pop';
  el.setAttribute('role', 'dialog');
  el.addEventListener('pointerover', () => { clearTimeout(hideTimer); });
  el.addEventListener('pointerout', scheduleHide);
  el.addEventListener('click', onPopClick);
  document.body.append(el);
  pop = el;
  return el;
}

/**
 * 浮层内点击：形态切换只换 pane 的 hidden 与按钮 aria-pressed，不重渲染
 * 整个浮层，滚动位置与未折叠状态得以保留；复制始终给登记时的原文。
 * @param {MouseEvent} e
 */
function onPopClick(e) {
  if (!(e.target instanceof Element) || pop === null) return;
  const view = /** @type {HTMLElement | null} */ (e.target.closest('[data-view]'));
  if (view !== null) {
    const name = view.getAttribute('data-view');
    for (const btn of pop.querySelectorAll('[data-view]')) {
      btn.setAttribute('aria-pressed', String(btn === view));
    }
    for (const pane of /** @type {NodeListOf<HTMLElement>} */ (pop.querySelectorAll('[data-pane]'))) {
      pane.hidden = pane.getAttribute('data-pane') !== name;
    }
    return;
  }
  if (e.target.closest('[data-copy]') !== null && copyText !== '') {
    void navigator.clipboard?.writeText(copyText);
  }
}

function hidePop() {
  clearTimeout(showTimer);
  clearTimeout(settleTimer);
  if (pop !== null) {
    pop.classList.remove('show', 'settling');
    // 内容留到淡出结束再清，消失瞬间不只剩一个空壳。
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      if (pop !== null && !pop.classList.contains('show')) pop.replaceChildren();
    }, 180);
  }
  anchor = null;
  copyText = '';
  suppressUntil = Date.now() + SUPPRESS_MS;
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hidePop, HIDE_DELAY);
}

/**
 * 以指针为基点放浮层：右下 14/18px，越界翻到另一侧并 clamp 视口；
 * 指针永远不在浮层覆盖范围内。键盘触发用锚点 rect 的下缘作基点。
 * @param {{x: number, y: number}} at
 * @param {number} w @param {number} h @param {number} vw @param {number} vh
 * @returns {{left: number, top: number}}
 */
export function placePop(at, w, h, vw, vh) {
  let left = at.x + 14;
  if (left + w > vw - 8) left = at.x - w - 14;
  let top = at.y + 18;
  if (top + h > vh - 8) top = at.y - h - 18;
  // 高度由 max-height 兜底，这里只保证不越左上边界。
  return {
    left: Math.max(8, Math.min(left, vw - w - 8)),
    top: Math.max(8, Math.min(top, vh - h - 8)),
  };
}

/**
 * @param {Element} target
 * @param {boolean} viaKeyboard 键盘触发时没有有效指针位置，贴锚点放置
 */
function showPop(target, viaKeyboard) {
  if (!target.isConnected) return;
  const key = target.getAttribute('data-pop-key');
  const entry = key !== null ? builds.get(key) : undefined;
  if (key === null || entry === undefined) return;
  if (Date.now() < suppressUntil) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  clearTimeout(settleTimer);
  clearTimeout(clearTimer);
  const el = popEl();
  const built = entry.build();
  if (typeof built === 'string') {
    copyText = '';
    el.innerHTML = built;
  } else {
    copyText = built.copy;
    el.innerHTML = built.html;
  }
  const r = target.getBoundingClientRect();
  const at = viaKeyboard ? { x: r.left, y: r.bottom } : pointer;
  // 出现初期短暂不拦截指针：正在进行的点击不会落在刚弹出的浮层上。
  el.classList.add('show', 'settling');
  const pos = placePop(at, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  settleTimer = setTimeout(() => el.classList.remove('settling'), SETTLE_MS);
  anchor = target;
}

/** 装配一次：文档级 pointerover / pointerout / focusin / focusout / pointerdown / keydown 委托。 */
export function initPop() {
  document.addEventListener('pointerover', (e) => {
    if (!(e.target instanceof Element)) return;
    pointer = { x: e.clientX, y: e.clientY };
    // `+N` 的目标清单归 more-pop，重叠时不启动 step-pop。
    if (e.target.closest('[data-more-key]') !== null) { hidePop(); return; }
    const target = e.target.closest('[data-pop-key]');
    if (target === null) return;
    // 同一锚点内移动也重置计时：停住才弹。
    clearTimeout(showTimer);
    if (target === anchor) return;
    const key = target.getAttribute('data-pop-key');
    const entry = key !== null ? builds.get(key) : undefined;
    if (entry === undefined) return;
    // 冷却期内进入的锚点不丢弃：等冷却结束再开始计时，停住仍会弹出；
    // 中途离开由 pointerout 清掉这个计时。
    const wait = Math.max(0, suppressUntil - Date.now());
    showTimer = setTimeout(() => showPop(target, false), wait + (entry.heavy ? HEAVY_DELAY : HOVER_DELAY));
  });
  document.addEventListener('pointerout', (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('[data-pop-key]') === null) return;
    const to = e.relatedTarget;
    if (to instanceof Element
      && (to.closest('[data-pop-key]') !== null || to.closest('.step-pop') !== null)) return;
    // 离开锚点就取消尚未触发的弹出，鼠标离开后不再补弹。
    clearTimeout(showTimer);
    if (anchor !== null) scheduleHide();
  });
  document.addEventListener('focusin', (e) => {
    if (!(e.target instanceof Element)) return;
    const target = e.target.closest('[data-pop-key]')
      ?? e.target.closest('.compact-select')?.querySelector('[data-pop-key]') ?? null;
    if (target === null) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => showPop(target, true), FOCUS_DELAY);
  });
  document.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to instanceof Element && to.closest('.step-pop') !== null) return;
    if (anchor !== null) scheduleHide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (anchor === null || !(e.target instanceof Element)) return;
    if (e.target.closest('.step-pop') !== null) return;
    hidePop();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && anchor !== null) hidePop();
  });
  // 浮层位置是视口坐标：滚动或改变视口后立即收起，不在错位处停留。
  document.addEventListener('scroll', () => { if (anchor !== null) hidePop(); }, true);
  window.addEventListener('resize', () => { if (anchor !== null) hidePop(); });
}

/* ---------- 共用片段 ---------- */

/** 浮层头：标题 + 右侧范围或状态。 @param {string} title @param {string} scope @param {string} [tone] */
function popHead(title, scope, tone = '') {
  return `<div class="sp-head"><span class="sp-title">${esc(title)}</span>`
    + `<span class="sp-scope${tone === '' ? '' : ` ${tone}`}">${esc(scope)}</span></div>`;
}

/** 配对状态行：点 + 短语，读法与右栏配对徽标一致。 @param {string | null} state */
function pairLine(state) {
  const map = {
    resolved: { cls: 'ok', label: t('已配对 · 结果已收到') },
    pending: { cls: 'wait', label: t('待配对') },
    ambiguous: { cls: 'warn', label: t('多候选') },
    unpaired: { cls: 'miss', label: t('未配对') },
  };
  const pair = state !== null && state in map
    ? map[/** @type {keyof typeof map} */ (state)] : map.unpaired;
  return `<div class="sp-pair"><span class="sp-dot ${pair.cls}"></span><span>${esc(pair.label)}</span></div>`;
}

/** 键值行网格：值超长折省略并带完整 title，类型列帮助读形状。 @param {[string, unknown][]} entries */
function kvHtml(entries) {
  const rows = entries.map(([k, v]) => {
    const val = Array.isArray(v) || (v !== null && typeof v === 'object')
      ? JSON.stringify(v) ?? '' : String(v);
    const long = val.length > 52;
    return `<div class="sp-kv-row"><span class="sp-k">${esc(k)}</span>`
      + `<span class="sp-v${long ? ' long' : ''}" title="${esc(val)}">${esc(val)}</span>`
      + `<span class="sp-ty">${esc(v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)}</span></div>`;
  });
  return `<div class="sp-kv">${rows.join('')}</div>`;
}

/** @param {Record<string, unknown>} args @param {string[]} [skip] */
function kvPane(args, skip = []) {
  const entries = Object.entries(args).filter(([k]) => !skip.includes(k));
  return entries.length > 0 ? kvHtml(entries) : `<div class="sp-note">${t('参数为空对象')}</div>`;
}

/** @param {Record<string, unknown>} args */
function rawPane(args) {
  return `<pre class="sp-pre">${esc(JSON.stringify(args, null, 2) ?? '')}</pre>`;
}

/** 形态切换与复制的操作条；按钮不带点击引导话。 */
function paneActions() {
  return `<div class="sp-actions"><div class="sp-tabs" role="group" aria-label="${t('展示形态')}">`
    + `<button type="button" data-view="kv" aria-pressed="true">${t('键值')}</button>`
    + `<button type="button" data-view="raw" aria-pressed="false">${t('原文')}</button></div>`
    + `<button type="button" class="sp-copy" data-copy aria-label="${t('复制原文')}">${t('复制')}</button></div>`;
}

/** @param {string} kv @param {string} raw */
function panesHtml(kv, raw) {
  return `<div data-pane="kv">${kv}</div><div data-pane="raw" hidden>${raw}</div>`;
}

/** @param {[string, unknown][]} pairs */
function footHtml(pairs) {
  return `<div class="sp-foot">${pairs.map(([k, v]) => `<span>${esc(k)}<b>${esc(String(v))}</b></span>`).join('')}</div>`;
}

/** 第一个对象数组值：对象数组族的公共形状。 @param {Record<string, unknown>} args @returns {Record<string, unknown>[] | null} */
function arrayItemsOf(args) {
  for (const value of Object.values(args)) {
    if (Array.isArray(value) && value.length > 0
      && value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))) {
      return /** @type {Record<string, unknown>[]} */ (value);
    }
  }
  return null;
}

/** 对象里第一个非空字符串值，作逐条条目的主文本。 @param {Record<string, unknown>} item */
function firstStringOf(item) {
  for (const v of Object.values(item)) {
    if (typeof v === 'string' && v !== '') return v;
  }
  return JSON.stringify(item) ?? '';
}

/* ---------- 形状族正文 ---------- */

/** @param {Record<string, unknown>} record */
function diffPane(record) {
  const oldS = /** @type {string} */ (record.old_string);
  const newS = /** @type {string} */ (record.new_string);
  const d = editDiff(oldS, newS);
  const stat = `<div class="sp-diff-stat"><span class="sp-delta"><b class="add">+${d.add}</b><b class="del">−${d.del}</b></span>`
    + `<span class="sp-lbl">${t('增删行')}</span>`
    + `<span class="sp-lbl">${t('总行数 {a}→{b}', { a: oldS.split('\n').length, b: newS.split('\n').length })}</span>`
    + (record.replace_all === true ? `<span class="sp-lbl">${t('全部替换')}</span>` : '')
    + '</div>';
  if (d.lines === null) {
    // 超长不跑逐行对照：两段原文各自成段，不把 O(n×m) 塞进悬停。
    return stat + `<div class="sp-note">${t('改动过长，不跑逐行对照，两段原文见下')}</div>`
      + `<pre class="sp-pre">${esc(oldS)}</pre><pre class="sp-pre">${esc(newS)}</pre>`;
  }
  const lines = d.lines.map(l =>
    `<div class="sp-diff-line ${l.sign}"><span class="sp-sign">${l.sign === 'add' ? '+' : l.sign === 'del' ? '−' : ' '}</span><span>${esc(l.text)}</span></div>`).join('');
  return stat + `<div class="sp-diff">${lines}</div>`;
}

/** @param {Record<string, unknown>} record */
function codePane(record) {
  const code = /** @type {string} */ (record.code);
  const meta = Object.entries(record).filter(([k]) => k !== 'code');
  return `<div class="sp-block-k">${t('代码 {n} 行', { n: code.split('\n').length })} · ${esc(byteSize(code))}</div>`
    + `<pre class="sp-pre">${esc(code)}</pre>`
    + (meta.length > 0 ? kvHtml(meta) : '');
}

/** @param {Record<string, unknown>[]} items */
function itemsPane(items) {
  const statuses = items.map(item => (typeof item.status === 'string' ? item.status : null));
  const known = statuses.filter(s => s !== null);
  const done = known.filter(s => s === 'completed' || s === 'done').length;
  const head = known.length > 0
    ? `<div class="sp-band"><b>${done}/${known.length}</b><span>${t('已完成 · 共 {n} 条', { n: items.length })}</span></div>`
    : '';
  const rows = items.slice(0, 40).map((item, i) => {
    const st = statuses[i];
    const cls = st === 'completed' || st === 'done' ? 'ok' : st !== null ? 'wait' : '';
    return `<div class="sp-item"><span class="sp-dot ${cls}"></span>`
      + `<span class="sp-item-k">${esc(st ?? String(i + 1))}</span>`
      + `<span class="sp-item-v" title="${esc(firstStringOf(item))}">${esc(firstStringOf(item))}</span></div>`;
  }).join('');
  return head + `<div class="sp-items">${rows}</div>`
    + (items.length > 40 ? `<div class="sp-note">${t('只列前 {n} 条', { n: 40 })}</div>` : '');
}

/** MCP 族：短字段进键值，长字符串成段，数组逐条。 @param {Record<string, unknown>} record */
function mcpPopBody(record) {
  /** @type {[string, unknown][]} */
  const short = [];
  const blocks = [];
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string' && (v.length > 80 || v.includes('\n'))) {
      blocks.push(`<div class="sp-block-k">${esc(k)}</div><pre class="sp-pre">${esc(v)}</pre>`);
    } else if (Array.isArray(v) && v.length > 0) {
      const items = v.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))
        ? /** @type {Record<string, unknown>[]} */ (v) : null;
      blocks.push(`<div class="sp-block-k">${esc(k)} · ${v.length}</div>`
        + (items !== null ? itemsPane(items) : `<pre class="sp-pre">${esc(JSON.stringify(v, null, 2) ?? '')}</pre>`));
    } else {
      short.push([k, v]);
    }
  }
  return (short.length > 0 ? kvHtml(short) : '') + blocks.join('');
}

/** 默认形状里的长字符串：kv 收短字段，长文本单独成段；没有长文本返回 null。 @param {Record<string, unknown>} record */
function textPane(record) {
  let longKey = null;
  let longVal = '';
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string' && v.length > longVal.length) { longVal = v; longKey = k; }
  }
  if (longKey === null || longVal.length <= 160) return null;
  const short = Object.entries(record)
    .filter(([k, v]) => k !== longKey && (typeof v !== 'string' || v.length <= 80));
  return `<div class="sp-block-k">${esc(longKey)} · ${t('{n} 行', { n: longVal.split('\n').length })} · ${esc(byteSize(longVal))}</div>`
    + `<pre class="sp-pre">${esc(longVal)}</pre>`
    + (short.length > 0 ? kvHtml(short) : '');
}

/* ---------- 调用行与结果行 ---------- */

/**
 * 调用行浮层：配对状态 + 按参数形状分派的正文。形状族与 tool-summary 的
 * 行内分派同源；解析失败给原文，不猜。
 * @param {{toolName?: string | null, toolInput?: string | null,
 *   result?: {state: string} | null}} step
 * @returns {{html: string, copy: string}}
 */
export function toolPopHtml(step) {
  const name = step.toolName ?? '';
  const input = step.toolInput ?? '';
  const head = popHead(name === '' ? t('未命名工具') : name, t('工具参数'));
  const body = [pairLine(step.result?.state ?? null)];
  let args = null;
  try { args = JSON.parse(input); } catch { /* 原文 */ }
  let html;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    html = `<pre class="sp-pre">${esc(input)}</pre>`;
  } else {
    const record = /** @type {Record<string, unknown>} */ (args);
    const oldS = typeof record.old_string === 'string' ? record.old_string : null;
    const newS = typeof record.new_string === 'string' ? record.new_string : null;
    const items = arrayItemsOf(record);
    const text = textPane(record);
    if (oldS !== null && newS !== null) html = diffPane(record);
    else if (typeof record.code === 'string' && record.code.length > 80) html = codePane(record);
    else if (name.startsWith('mcp__')) html = mcpPopBody(record);
    else if (items !== null && items.length > 0) html = itemsPane(items);
    else if (text !== null) html = text;
    else html = paneActions() + panesHtml(kvPane(record), rawPane(record));
    html += footHtml([[t('字段'), Object.keys(record).length], [t('原始'), byteSize(input)]]);
  }
  return { html: head + body.join('') + html, copy: input };
}

/** Skill 族结果按文档排版的工具名集合。 */
const SKILL_TOOLS = new Set(['Skill', 'skill', 'skill_view', 'skill_manage', 'skills_list']);

/**
 * Skill 结果整份 Markdown：frontmatter 键值、章节标题、列表与段落。
 * @param {string} text
 */
function skillDocHtml(text) {
  const lines = text.split('\n');
  const parts = [];
  let i = 0;
  if (lines[0] === '---') {
    /** @type {[string, unknown][]} */
    const meta = [];
    for (i = 1; i < lines.length && lines[i] !== '---'; i += 1) {
      const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]);
      if (m !== null) meta.push([m[1], m[2]]);
    }
    i += 1;
    if (meta.length > 0) parts.push(kvHtml(meta));
  }
  /** @type {string[]} */
  let para = [];
  const flush = () => {
    if (para.length > 0) { parts.push(`<div class="sp-p">${esc(para.join(' '))}</div>`); para = []; }
  };
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    const list = /^[-*]\s+(.*)$/.exec(line);
    if (head !== null) { flush(); parts.push(`<div class="sp-h">${esc(head[1])}</div>`); }
    else if (list !== null) { flush(); parts.push(`<div class="sp-li">${esc(list[1])}</div>`); }
    else if (line.trim() === '') flush();
    else para.push(line.trim());
  }
  flush();
  if (parts.length === 0) return plainPane(text);
  return `<div class="sp-doc">${parts.join('')}</div>`
    + footHtml([[t('行'), lines.length], [t('字节'), byteSize(text)]]);
}

/** 全文视图：等宽、可滚、可复制。 @param {string} text */
function plainPane(text) {
  return `<pre class="sp-pre sp-pre-main">${esc(text)}</pre>`
    + footHtml([[t('行'), text.split('\n').length], [t('字节'), byteSize(text)]]);
}

/**
 * 结果行浮层：失败位 + 按结果形状分派。Skill 族给文档排版，MCP 族尝试
 * 结构化（失败退全文），其余给可滚动的全文。正文来自 step.text，完整在内存。
 * @param {{toolName?: string | null, text?: string | null, isError?: boolean | null}} step
 * @returns {{html: string, copy: string}}
 */
export function resultPopHtml(step) {
  const name = step.toolName ?? '';
  const state = step.isError === true ? ['bad', t('失败')]
    : step.isError === false ? ['ok', t('成功')] : ['', t('未报告')];
  const text = step.text ?? '';
  const head = popHead(name === '' ? t('工具结果') : `${name} · ${t('结果')}`, state[1], state[0]);
  let body;
  if (SKILL_TOOLS.has(name)) body = skillDocHtml(text);
  else if (name.startsWith('mcp__')) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 退全文 */ }
    body = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? paneActions() + panesHtml(mcpPopBody(/** @type {Record<string, unknown>} */ (parsed)), rawPane(/** @type {Record<string, unknown>} */ (parsed)))
      : plainPane(text);
  } else body = plainPane(text);
  return { html: head + body, copy: text };
}

/**
 * 步骤浮层入口：按 kind 分派调用侧与结果侧。
 * @param {{kind: string, toolName?: string | null, toolInput?: string | null,
 *   text?: string, result?: {state: string} | null, isError?: boolean | null}} step
 */
export function stepPopHtml(step) {
  return step.kind === 'tool_result' ? resultPopHtml(step) : toolPopHtml(step);
}

/* ---------- 组头与列表的纯展示浮层 ---------- */

/**
 * 组头耗时浮层：分段与会话头耗时面板同一公式——等待（首 token）、
 * 思考（推理段）、回复（其余；缺 ttft 的整笔落回复）。缺读数的段不出行，不写 0。
 * @param {{ms: number | null, ttft_ms: number | null, reasoning_span_ms: number | null}} row
 */
export function headPopHtml(row) {
  const wait = row.ttft_ms;
  const span = row.reasoning_span_ms ?? 0;
  /** @type {[string, number][]} */
  const segs = [];
  let reply = null;
  if (row.ms !== null) {
    if (wait === null) reply = row.ms;
    else {
      segs.push([t('等待 · 首 token'), wait]);
      if (typeof row.reasoning_span_ms === 'number') segs.push([t('思考 · 推理段'), span]);
      reply = Math.max(0, row.ms - wait - span);
    }
    if (reply > 0) segs.push([t('回复'), reply]);
  }
  const bars = segs.map(([, v], i) => `<div class="sp-seg t${i + 1}" style="flex:${v}"></div>`).join('');
  const rows = segs.map(([k, v], i) =>
    `<div class="sp-row"><span class="sp-swatch t${i + 1}"></span><span>${esc(k)}</span><b class="sp-num">${esc(compact(v))}</b></div>`).join('');
  const foot = typeof row.ms === 'number' ? footHtml([[t('合计'), compact(row.ms)]]) : '';
  return popHead(t('本笔耗时'), t('请求级'))
    + (bars === '' ? '' : `<div class="sp-track">${bars}</div>`)
    + (rows === '' ? `<div class="sp-note">${t('没有计时读数')}</div>` : `<div class="sp-rows">${rows}</div>`)
    + foot;
}

/**
 * 子代理短标浮层：完整身份全文，短标行不承担 id 展示。
 * @param {{subagent: string | null, actor: string | null, actor_state: string,
 *   subagent_no: number | null}} row
 */
export function subPopHtml(row) {
  return popHead(t('子代理身份'), row.subagent_no !== null ? `S${row.subagent_no}` : '')
    + kvHtml([['subagent', row.subagent ?? ''], ['actor', row.actor ?? '—'], ['actor_state', row.actor_state]]);
}

/** 轮次带输入浮层：完整 input_preview 原文。 @param {string} preview */
export function turnPopHtml(preview) {
  return popHead(t('轮次输入'), '')
    + `<div class="sp-text">${esc(preview)}</div>`
    + footHtml([[t('字数'), [...preview].length]]);
}

/** 路径 chip 浮层：完整路径与次数。 @param {string} path @param {number} count @param {'w' | 'r'} side */
export function pathPopHtml(path, count, side) {
  return popHead(side === 'w' ? t('写入路径') : t('读取路径'), t('会话级'))
    + kvHtml([[t('路径'), path], [t('次数'), count]]);
}
