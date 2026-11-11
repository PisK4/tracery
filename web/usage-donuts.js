// @ts-check
/**
 * 用量与上下文卡的双圆环、图例、时间轴与跨图选中映射。纯展示：只拼字符串，
 * 不读写 DOM、不发起读取；读数由调用方按轮次算好传入。
 *
 * 两条口径分开写清，不能都标「会话」：
 * - Token 圆环是轮次末笔请求的上下文构成（输入侧 prompt.parts + 输出侧分类）；
 * - 耗时圆环是整个轮次的活跃时长（Σ ms + Σ exec_ms）。
 *
 * 色阶只用 --cat-1..8 的蓝灰单色阶，两张图共用同一分类次序；
 * 跨图联动只在有真实对应的类别间成立（当前只有 工具结果 ↔ 工具执行）。
 */

import { esc } from './html.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { kk, partLabel, partRank } from './parts.js';

/** 圆环几何：半径 40、环宽 10、段间 0.8 单位缝隙；外径 100 与 viewBox 一致。 */
const R = 40;
const CIRC = 2 * Math.PI * R;

/**
 * @typedef {{key: string, label: string, value: number, color: number}} DonutSeg
 *   color 是 1..8 的色阶序号，不是色值：色值在 CSS 里按主题取。
 * @typedef {{token: DonutSeg[], time: DonutSeg[]}} DonutData
 */

/** 输入侧 8 类的固定次序（web/parts.js 的 PARTS），只取有正值的类。 */
const TOKEN_ORDER = ['system', 'tools', 'memory', 'files', 'results', 'chat', 'skills', 'harness'];
/** 耗时四段 + 其他开销；每段只在有字段时出现。 */
const TIME_ORDER = ['wait', 'reasoning', 'exec', 'reply', 'other'];
/** 跨图唯一真实对应：工具结果 token ↔ 工具执行时间。 */
const TOKEN_TIME_LINK = { results: 'exec' };

/** 色阶只有 8 档：按绘制位置取色，超过 8 段后共用最浅一档。 @param {DonutSeg[]} segs */
function colorize(segs) {
  return segs.map((seg, index) => ({ ...seg, color: Math.min(8, index + 1) }));
}

/** 段名：输入侧沿用 parts.js 的类别名，输出与耗时用本模块的固定叫法。 @param {string} key */
export function donutLabel(key) {
  if (TOKEN_ORDER.includes(key)) return partLabel(key);
  return t((/** @type {Record<string, string>} */ ({
    output_reasoning: '模型思考',
    output_text: '模型回复',
    wait: '模型等待',
    reasoning: '模型思考',
    exec: '工具执行',
    reply: '模型回复',
    other: '其他开销',
  }))[key] ?? key);
}

/**
 * 把有序分段铺成圆环。段间缝隙随段长收缩，短段不会被缝隙吃掉。
 * 圆环本身 aria-hidden：文字等价物由中心读数与图例行承担。
 * @param {DonutSeg[]} segs @param {string} centerValue @param {string} centerLabel @param {'token' | 'time'} side
 * @param {string | null} selected 选中的分类键；null 表示没有选中
 */
export function donutSvg(segs, centerValue, centerLabel, side, selected) {
  const total = segs.reduce((sum, seg) => sum + Math.max(0, seg.value), 0);
  let offset = 0;
  const circles = segs.map(seg => {
    const length = total > 0 ? (Math.max(0, seg.value) / total) * CIRC : 0;
    const gap = Math.min(0.8, length * 0.2);
    const dim = selected !== null && selected !== seg.key;
    const circle = `<circle class="donut-seg${dim ? ' is-dim' : ''}" data-cat="${esc(seg.key)}" data-side="${side}"`
      + ` cx="50" cy="50" r="${R}" style="stroke:var(--cat-${seg.color})"`
      + ` stroke-dasharray="${(length - gap).toFixed(2)} ${(CIRC - length + gap).toFixed(2)}"`
      + ` stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
    offset += length;
    return circle;
  }).join('');
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 100 100" aria-hidden="true">${circles}</svg>`
    + `<div class="donut-center"><b>${esc(centerValue)}</b><span>${esc(centerLabel)}</span></div></div>`;
}

/**
 * 输入侧 token 分段：prompt.parts 的正值类别，按 PARTS 固定次序（不按占比重排，
 * 这样同一位置在不同请求间指向同一类别）；未知 kind 按数据出现序缀后。
 * @param {{kind: string, tokens: number}[]} parts
 * @returns {DonutSeg[]}
 */
export function tokenSegments(parts) {
  const ordered = parts
    .filter(part => part.tokens > 0)
    .map((part, index) => ({ part, index }))
    .sort((a, b) => partRank(a.part.kind) - partRank(b.part.kind) || a.index - b.index)
    .map(({ part }) => ({ key: part.kind, label: donutLabel(part.kind), value: part.tokens, color: 1 }));
  return colorize(ordered);
}

/**
 * 输出侧分段。`reasoning` 是上游给的推理 token 读数，`out` 是输出总量；
 * 两者都在才拆成「模型思考 + 模型回复」，缺一个就整块不画（不按正文长度分摊）。
 * @param {number | null} reasoning @param {number | null} out
 * @returns {DonutSeg[]}
 */
export function outputSegments(reasoning, out) {
  if (reasoning === null || out === null || reasoning < 0) return [];
  const text = Math.max(0, out - reasoning);
  return colorize([
    { key: 'output_reasoning', label: donutLabel('output_reasoning'), value: reasoning, color: 1 },
    { key: 'output_text', label: donutLabel('output_text'), value: text, color: 1 },
  ].filter(seg => seg.value > 0));
}

/**
 * 耗时分段：轮次内求和，缺字段的段整段不出现（降级不是留白）。
 * 模型等待 = Σ ttft；模型思考 = Σ reasoning_span；工具执行 = Σ exec_ms；
 * 模型回复 = Σ(ms − ttft − reasoning_span)；其他开销 = 活跃时长减以上四段，为负不画。
 * @param {{wait: number | null, reasoning: number | null, exec: number | null, reply: number | null, other: number | null}} sums
 * @returns {DonutSeg[]}
 */
export function timeSegments(sums) {
  return colorize(TIME_ORDER
    .map(key => ({ key, label: donutLabel(key), value: /** @type {Record<string, number | null>} */ (sums)[key], color: 1 }))
    .filter(seg => seg.value !== null && seg.value > 0)
    .map(seg => ({ ...seg, value: /** @type {number} */ (seg.value) })));
}

/**
 * 图例行：可点按钮，选中态用 aria-pressed。数值列与占比列分开，
 * 占比放 title（212px 宽的图例放不下四列而不截断）。
 * @param {DonutSeg[]} segs @param {'token' | 'time'} side
 * @param {string | null} selected
 * @param {(seg: DonutSeg) => string} metaOf 第二列内容：token 侧是占比、耗时侧是时长
 */
function legendRows(segs, side, selected, metaOf) {
  const total = segs.reduce((sum, seg) => sum + Math.max(0, seg.value), 0) || 1;
  return segs.map(seg => {
    const pct = (seg.value / total * 100).toFixed(1);
    const linked = side === 'token' ? seg.key in TOKEN_TIME_LINK : Object.values(TOKEN_TIME_LINK).includes(seg.key);
    const title = `${seg.label} · ${pct}% · ${metaOf(seg)}${linked ? '' : ` · ${t('另一张图没有对应阶段')}`}`;
    return `<button type="button" class="sp-row ${side}" data-cat="${esc(seg.key)}" data-side="${side}"`
      + ` data-linked="${linked}" aria-pressed="${selected === seg.key}" title="${esc(title)}">`
      + `<i style="background:var(--cat-${seg.color})"></i><span class="nm">${esc(seg.label)}</span>`
      + `<span class="pct">${pct}%</span><span class="val">${esc(metaOf(seg))}</span></button>`;
  }).join('');
}

/** 6px 时间轴：段宽按同一批分段占比，刻度由各段时长累加得出，不写死等分。 @param {DonutSeg[]} segs @param {string | null} selected */
function timeline(segs, selected) {
  const total = segs.reduce((sum, seg) => sum + Math.max(0, seg.value), 0);
  if (total <= 0) return '';
  const bars = segs.map(seg => `<i data-cat="${esc(seg.key)}"${selected !== null && selected !== seg.key ? ' class="is-dim"' : ''}`
    + ` style="flex:${seg.value};background:var(--cat-${seg.color})"></i>`).join('');
  const ticks = ['0'];
  let acc = 0;
  for (const seg of segs.slice(0, -1)) {
    acc += seg.value;
    ticks.push(shortDur(acc));
  }
  ticks.push(shortDur(total));
  return `<div class="sp-timeline" aria-hidden="true"><div class="tl-bar">${bars}</div>`
    + `<div class="tl-ticks">${ticks.map(tick => `<span>${esc(tick)}</span>`).join('')}</div></div>`;
}

/** 时间轴刻度用的短时长：秒级写 s、分钟级写 m+s，不四舍五入到零。 @param {number} ms */
function shortDur(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

/**
 * 双圆环面板。两侧标题各自写明口径；右侧读数：Token 侧是缓存命中，耗时侧是输出速度。
 * 缺输入侧分类或输出侧分类时按降级形态只画有的段，中心读数写实际总量。
 * @param {{
 *   token: {segs: DonutSeg[], center: string, centerLabel: string, side: string, title: string},
 *   time: {segs: DonutSeg[], center: string, centerLabel: string, side: string, title: string},
 *   selected: {side: 'token' | 'time', key: string} | null,
 * }} input
 */
export function usagePanelsHtml(input) {
  const tokenSel = input.selected !== null && input.selected.side === 'token' ? input.selected.key
    : input.selected !== null ? /** @type {Record<string, string>} */ (TOKEN_TIME_LINK)[input.selected.key] ?? null : null;
  const timeSel = input.selected !== null && input.selected.side === 'time' ? input.selected.key
    : input.selected !== null ? linkedTimeOf(input.selected.key) : null;
  const tokenRows = legendRows(input.token.segs, 'token', tokenSel, seg => kk(seg.value));
  const timeRows = legendRows(input.time.segs, 'time', timeSel, seg => shortDur(seg.value));
  return `<div class="usage-panels">
    <section class="stat-panel" aria-label="${esc(t('Token 统计'))}">
      <header class="sp-head" title="${esc(input.token.title)}">${icon('ctx-cache', 12)}<span class="sp-title">${t('Token 统计')}</span><span class="sp-side">${esc(input.token.side)}</span></header>
      <div class="sp-body">${donutSvg(input.token.segs, input.token.center, input.token.centerLabel, 'token', tokenSel)}<div class="sp-legend">${tokenRows}</div></div>
    </section>
    <section class="stat-panel" aria-label="${esc(t('耗时统计'))}">
      <header class="sp-head" title="${esc(input.time.title)}">${icon('stopwatch', 12)}<span class="sp-title">${t('耗时统计')}</span><span class="sp-side">${esc(input.time.side)}</span></header>
      <div class="sp-body">${donutSvg(input.time.segs, input.time.center, input.time.centerLabel, 'time', timeSel)}<div class="sp-legend">${timeRows}</div></div>
      ${timeline(input.time.segs, timeSel)}
    </section>
  </div>`;
}

/** @param {string} tokenKey */
function linkedTimeOf(tokenKey) {
  const found = Object.entries(TOKEN_TIME_LINK).find(([token]) => token === tokenKey);
  return found === undefined ? null : found[1];
}

/**
 * 会话级耗时面板：与右栏「耗时统计」同语言的圆环加图例与时间轴，供中栏
 * 会话指标复用。图例是只读的（span，无 data-cat），不参与跨图选中委托；
 * 分段由调用方算好传入，中心写总量、右上角写速度。
 * @param {DonutSeg[]} segs
 * @param {{center: string, centerLabel: string, side: string, title: string}} meta
 */
export function timingPanelHtml(segs, meta) {
  const total = segs.reduce((sum, seg) => sum + Math.max(0, seg.value), 0) || 1;
  const rows = segs.map(seg => {
    const pct = (seg.value / total * 100).toFixed(1);
    return `<span class="sp-row time" title="${esc(`${seg.label} · ${pct}% · ${shortDur(seg.value)}`)}">`
      + `<i style="background:var(--cat-${seg.color})"></i><span class="nm">${esc(seg.label)}</span>`
      + `<span class="pct">${pct}%</span><span class="val">${esc(shortDur(seg.value))}</span></span>`;
  }).join('');
  return `<section class="stat-panel" aria-label="${esc(t('耗时统计'))}">
    <header class="sp-head" title="${esc(meta.title)}">${icon('stopwatch', 12)}<span class="sp-title">${t('耗时统计')}</span><span class="sp-side">${esc(meta.side)}</span></header>
    <div class="sp-body">${donutSvg(segs, meta.center, meta.centerLabel, 'time', null)}<div class="sp-legend">${rows}</div></div>
    ${timeline(segs, null)}
  </section>`;
}

/**
 * 轮次读数：Token 侧取该轮末笔有 prompt 分类的请求（单笔口径，不跨请求相加——
 * 每笔都重发完整上下文，相加会把系统提示重复计入几十次）；耗时侧按轮内请求
 * 与工具配对求和（Σ ms + Σ exec_ms 是轮次活跃时长）。
 *
 * 缺字段的段整段不画，不按请求数或平均补缺：
 * - 模型等待 = Σ ttft（缺 ttft 的请求不计入，其耗时留在模型回复里）；
 * - 模型思考 = Σ reasoning_span（缺一笔就不进这一段）；
 * - 工具执行 = Σ exec_ms；
 * - 模型回复 = Σ(ms − ttft − reasoning_span)，下限 0；
 * - 其他开销 = 活跃时长减以上四段，为负不画。
 * @param {{req_id: number, ms: number | null, ttft_ms: number | null, flow_ms?: number | null, reasoning_span_ms: number | null, in_tok: number | null, out_tok: number | null, cache_read: number | null}[]} rows 轮内请求（按开始时刻）
 * @param {(id: number) => import('../src/queries/requests').RequestDetail | null} detailOf 只读已缓存的详情，不发起读取
 */
export function turnUsageOf(rows, detailOf) {
  // Token 侧：轮内最后一笔有 prompt.parts 的请求；没有就退回最后一笔有输出 token 的请求。
  let promptParts = /** @type {{kind: string, tokens: number}[]} */ ([]);
  let promptTokens = /** @type {number | null} */ (null);
  let outTok = /** @type {number | null} */ (null);
  let reasoningTok = /** @type {number | null} */ (null);
  let cacheRead = /** @type {number | null} */ (null);
  /** @type {typeof rows[number] | null} */
  let tokenRow = null;
  for (const row of [...rows].reverse()) {
    const detail = detailOf(row.req_id);
    const parts = detail?.prompt?.parts ?? [];
    if (parts.some(part => part.tokens > 0)) {
      promptParts = parts;
      promptTokens = detail?.prompt?.tokens ?? null;
      outTok = row.out_tok;
      reasoningTok = detail?.reasoning ?? null;
      cacheRead = row.cache_read;
      tokenRow = row;
      break;
    }
  }
  if (promptParts.length === 0) {
    const last = rows[rows.length - 1];
    if (last !== undefined) {
      outTok = last.out_tok;
      cacheRead = last.cache_read;
      reasoningTok = detailOf(last.req_id)?.reasoning ?? null;
      tokenRow = last;
    }
  }
  const inputSegs = tokenSegments(promptParts);
  const outputSegs = outputSegments(reasoningTok, outTok);
  // 中心是单笔口径的「提示总量 + 输出总量」；输出侧没分类时只写提示量，
  // 不拿输入量冒充总量（title 说明输出未分类）。
  const inputTotal = promptTokens ?? (inputSegs.length > 0
    ? inputSegs.reduce((sum, seg) => sum + seg.value, 0) : null);
  const tokenSum = inputTotal === null ? null
    : inputTotal + (outputSegs.length > 0 && outTok !== null ? outTok : 0);

  let wait = 0, reasoning = 0, reply = 0, active = 0;
  let anyTiming = false;
  for (const row of rows) {
    const detail = detailOf(row.req_id);
    const ms = detail?.ms ?? row.ms;
    if (ms === null) continue;
    anyTiming = true;
    active += ms;
    const ttft = detail?.ttft_ms ?? row.ttft_ms;
    if (ttft === null) { reply += ms; continue; }
    wait += ttft;
    const span = detail?.reasoning_span_ms ?? row.reasoning_span_ms ?? 0;
    reasoning += span;
    reply += Math.max(0, ms - ttft - span);
  }
  let exec = 0;
  for (const row of rows) {
    const detail = detailOf(row.req_id);
    for (const call of detail?.tool_calls ?? []) {
      if (call.exec_ms !== null && call.exec_ms > 0) { exec += call.exec_ms; anyTiming = true; }
    }
  }
  active += exec;
  const other = active - (wait + reasoning + exec + reply);
  // 输出速度与 timingReadingsOf 同一公式：Σ out_tok ÷ Σ 生成时长（总 − 首 token），
  // 缺计时或缺输出的请求两边都不计。
  let genMs = 0, genOut = 0;
  for (const row of rows) {
    const detail = detailOf(row.req_id);
    const ms = detail?.ms ?? row.ms;
    const ttft = detail?.ttft_ms ?? row.ttft_ms;
    const flow = ms !== null && ttft !== null ? Math.max(0, ms - ttft) : (detail?.flow_ms ?? row.flow_ms ?? null);
    if (flow === null || row.out_tok === null) continue;
    genMs += flow;
    genOut += row.out_tok;
  }
  return {
    token: {
      // 输入与输出共用同一条色阶，按绘制位置取色；两侧各自分段后合起来再定色。
      segs: colorize([...inputSegs, ...outputSegs].map(seg => ({ ...seg, color: 1 }))),
      inputSegs, outputSegs,
      center: tokenSum === null ? '—' : kk(tokenSum),
      centerLabel: outputSegs.length > 0 ? t('输入 + 输出') : t('仅输入侧'),
      cacheRead,
      // 中心口径取哪一笔：调用方据此算该笔的缓存命中，不混入整轮。
      reqId: tokenRow?.req_id ?? null,
      inTok: tokenRow?.in_tok ?? null,
    },
    time: {
      segs: timeSegments({
        wait: anyTiming ? wait : null,
        reasoning: anyTiming ? reasoning : null,
        exec: anyTiming ? exec : null,
        reply: anyTiming ? reply : null,
        other: anyTiming ? (other > 0 ? other : null) : null,
      }),
      active,
      speed: genMs > 0 && genOut > 0 ? Math.round(genOut / (genMs / 1000)) : null,
    },
  };
}

/** 选中态从按钮的 data-* 读出；没有选中返回 null。 @param {Element | null} node */
export function selectionOf(node) {
  if (node === null) return null;
  const side = node.getAttribute('data-side');
  const key = node.getAttribute('data-cat');
  if ((side !== 'token' && side !== 'time') || key === null) return null;
  return /** @type {{side: 'token' | 'time', key: string}} */ ({ side, key });
}
