// @ts-check
/**
 * 请求级用量浮层：接收 `RequestRow`，拼出组头 `in_tok` chip 的浮层 HTML。
 * 只做这一件事：不读写 DOM、不发起读取、不缓存状态；数据全部来自行上读数，
 * 不新增具名读取。四段固定类别按真实值降序铺 treemap，颜色按份额排名取
 * `--t1..--t4`（与右栏 partShade 的份额阈值取档是两套判据，这里按排名）。
 */

import { squarify } from './context-map.js';
import { esc } from './html.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { kk } from './parts.js';
import { cacheHitOf } from './rail-facts.js';

/** 四段固定类别：符号与类别一一绑定，形状互不相似；几何来自 R1 定稿样张。
 *  @type {{key: 'cache_read' | 'in_tok' | 'cache_write' | 'out_tok', name: string, label: string}[]} */
const SEGMENTS = [
  { key: 'cache_read', name: 'usage-read', label: '缓存读取' },
  { key: 'in_tok', name: 'usage-in', label: '新输入' },
  { key: 'cache_write', name: 'usage-write', label: '缓存写入' },
  { key: 'out_tok', name: 'usage-out', label: '输出' },
];

/** 费用读法与右栏同式：六位有效数字，不四舍五入掩盖小费用。 @param {number} v */
const fmtCost = (v) => String(Number(v.toPrecision(6)));

/** @param {number} v @param {number} total 占比文本：0–100 一位小数 */
const pctOf = (v, total) => (total > 0 ? `${(v / total * 100).toFixed(1)}%` : '—');

/**
 * 请求级用量浮层。`in_tok` 为 null 时调用方不渲染 chip，也不调用这里；
 * `cache_write = 0` 是有效读数，明细写 0、符号淡显、不占 treemap 面积。
 * @param {import('../src/queries/projection').RequestRow} row
 * @returns {string}
 */
export function usagePopHtml(row) {
  const values = Object.fromEntries(SEGMENTS.map(s => [s.key, row[s.key]]));
  const positive = SEGMENTS
    .map(s => ({ ...s, v: values[s.key] }))
    .filter(s => typeof s.v === 'number' && s.v > 0)
    .sort((a, b) => /** @type {number} */ (b.v) - /** @type {number} */ (a.v));
  const total = positive.reduce((a, s) => a + /** @type {number} */ (s.v), 0);
  const laid = total > 0
    ? squarify(positive.map(s => ({ v: /** @type {number} */ (s.v), seg: s })), 0, 0, 296, 140)
    : [];
  const tiles = laid.map((tile, rank) => {
    // squarify 只透传 vals 元素：seg 挂在传入的包装对象上，这里取回来。
    const wrapper = /** @type {{v: number, seg: {key: 'cache_read' | 'in_tok' | 'cache_write' | 'out_tok', name: string, label: string, v: number}}} */ (tile.a);
    const s = wrapper.seg;
    const pct = pctOf(tile.a.v, total);
    // 瓦片放得下才写字：窄条只留色块，名称与数值由下方四行明细承担。
    const roomy = tile.w >= 72 && tile.h >= 72;
    const label = `${s.label} ${kk(tile.a.v)} · ${pct}`;
    return `<div class="up-tile t${rank + 1}" style="left:${(tile.x / 296 * 100).toFixed(2)}%;top:${(tile.y / 140 * 100).toFixed(2)}%;width:${(tile.w / 296 * 100).toFixed(2)}%;height:${(tile.h / 140 * 100).toFixed(2)}%"`
      + ` role="img" aria-label="${esc(label)}" title="${esc(label)}">`
      + (roomy
        ? `<span class="up-glyph">${icon(s.name, 14)}</span><span class="up-name">${esc(s.label)}</span>`
          + `<span class="up-val">${esc(kk(tile.a.v))}</span><span class="up-pct">${esc(pct)}</span>`
        : '')
      + '</div>';
  }).join('');
  const hit = cacheHitOf(row).hit;
  const rows = SEGMENTS.map((s, rank) => {
    const v = values[s.key];
    const missing = typeof v !== 'number';
    const zero = v === 0;
    return `<div class="up-row${zero ? ' zero' : ''}">`
      + `<span class="up-swatch t${positive.findIndex(p => p.key === s.key) + 1}">${icon(s.name, 12)}</span>`
      + `<span class="up-name">${esc(t(s.label))}</span>`
      + `<b class="up-val">${esc(missing ? '—' : kk(v))}</b>`
      + `<span class="up-pct">${esc(missing ? '—' : pctOf(/** @type {number} */ (v), total))}</span></div>`;
  }).join('');
  const priced = row.cost_state === 'priced' || row.cost_state === 'zero';
  const cost = priced && row.cost !== null ? `$${fmtCost(row.cost)}` : '—';
  return `<div class="sp-head"><span class="sp-title">${t('用量 · 请求级')}</span></div>`
    + `<div class="up-hit"><b class="big">${esc(hit === null ? '—' : `${(hit * 100).toFixed(0)}%`)}</b><span class="cap">${t('缓存命中')}</span></div>`
    + `<div class="up-map" aria-label="${t('四段用量树图，面积按真实值')}">${tiles}</div>`
    + `<div class="up-rows">${rows}</div>`
    + footHtml2([[t('合计'), total > 0 ? kk(total) : '—'], [t('费用'), cost]]);
}

/** @param {[string, unknown][]} pairs */
function footHtml2(pairs) {
  return `<div class="sp-foot">${pairs.map(([k, v]) => `<span>${esc(k)}<b>${esc(String(v))}</b></span>`).join('')}</div>`;
}
