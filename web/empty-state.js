// @ts-check

import { prefersReducedMotion } from './motion.js';

/**
 * 空状态里的 B1 蜘蛛。几何来自重绘稿 `rail-fix/spider-rail.svg`（画布 261×424，剪影 IoU 0.958）；
 * 画布左移 -20.95 只为给 ±2° 摆动留边（θ=-2° 右侧越界 8.1px、θ=+2° 左侧越界 5.1px），几何点未动。
 * 只保留一份几何：动效版由 `spiderInner(true)` 在静态版骨架上补回 animateTransform，
 * 静态版（reduced-motion）走 `spiderInner(false)`，不靠冻住动效副本。
 *
 * 动效沿用重绘稿：钟摆 ±2°/3s（丝滞后 241ms、珠 182ms，靠 beginElementAt 的负偏移还原）、
 * 呼吸 3.02%/4.5s、眨眼每 9s 一次。全部 `begin="indefinite"`，未启动时渲染的是完整静态首帧，
 * 由 armSpider 在空状态持续 500ms 后统一启动。
 *
 * 颜色全部走主题变量（身体 --spider-body、眼 --spider-accent、丝 --spider-thread），
 * 重绘稿里的局部 <style> 色值已删除；没有腮红与瞳内高光，也没有背景。
 */

/** 身体剪影路径（原始坐标，与重绘稿逐点一致；viewBox 只平移了左边界，点未缩放）。 */
const SPIDER_BODY_PATH = 'M116 193Q121 192 127 195Q132 198 136 203Q140 207 143 211Q145 217 148 222Q152 226 156 229Q160 233 163 238Q166 243 169 248Q171 253 172 258Q174 264 174 270Q174 276 172 281Q171 286 169 291Q166 296 164 301Q165 308 169 310Q172 308 177 303Q182 301 188 301Q194 301 199 303Q204 306 206 311Q206 317 202 321Q198 324 192 324Q186 322 181 321Q178 324 179 329Q181 331 187 332Q192 333 198 334Q203 336 207 339Q211 344 212 349Q211 355 206 358Q201 360 195 358Q190 355 186 352Q182 352 180 355Q180 358 183 363Q187 366 192 370Q195 374 196 380Q197 386 196 391Q194 397 189 399Q184 400 179 397Q175 393 174 387Q174 379 174 376Q171 378 165 384Q161 387 156 390Q151 393 146 395Q141 397 136 399Q131 401 125 402Q120 403 114 404Q108 404 102 404Q96 404 90 404Q84 403 79 402Q73 401 68 400Q62 398 58 396Q54 395 53 398Q54 402 54 409Q52 415 48 419Q42 422 37 419Q34 415 33 409Q32 404 34 398Q36 393 39 388Q42 384 42 380Q40 375 35 374Q33 377 30 383Q26 388 20 389Q14 390 10 386Q8 381 9 375Q11 370 15 366Q20 362 25 360Q31 359 35 356Q38 350 37 345Q34 345 28 348Q23 351 18 352Q12 352 9 348Q6 343 7 337Q10 332 15 329Q20 326 25 326Q31 326 36 327Q41 328 45 326Q50 322 50 317Q48 312 43 308Q39 304 36 299Q33 294 32 289Q30 283 30 277Q30 271 31 266Q33 260 35 255Q37 250 39 245Q41 240 43 235Q45 230 47 225Q49 220 52 215Q55 210 59 207Q65 204 70 204Q73 207 74 212Q75 215 77 218Q81 222 82 227Q80 232 75 236Q70 239 65 241Q60 244 57 248Q54 252 53 258Q51 263 49 269Q48 274 48 280Q49 286 52 291Q55 298 59 300Q63 300 68 295Q72 291 77 288Q81 286 86 284Q91 282 97 280Q102 278 108 278Q114 278 119 279Q125 280 130 282Q135 284 140 287Q146 291 150 292Q154 290 155 284Q156 279 156 273Q156 267 155 261Q154 256 151 251Q149 246 145 242Q141 237 136 233Q132 230 127 228Q121 227 116 225Q110 222 109 217Q112 214 115 210Q113 206 111 201Q112 196 116 193Z';

/**
 * @param {boolean} animated 动效版补回 animateTransform；静态版保持同一骨架
 * @returns {string}
 */
function spiderInner(animated) {
  const swing = 'attributeName="transform" type="rotate" values="-2 93.5 0;2 93.5 0;-2 93.5 0"'
    + ' keyTimes="0;.5;1" keySplines=".42 0 .58 1;.42 0 .58 1" calcMode="spline" dur="3s"'
    + ' begin="indefinite" repeatCount="indefinite"';
  return '<g class="atc-spider">'
    + '<g class="atc-body">'
    + (animated ? `<animateTransform ${swing}/>` : '')
    + '<g transform="translate(109 340)"><g>'
    + (animated
      ? '<animateTransform attributeName="transform" type="scale" values="1 1;1.012 1.03;1 1"'
        + ' keyTimes="0;.5;1" keySplines=".42 0 .58 1;.42 0 .58 1" calcMode="spline" dur="4.5s"'
        + ' begin="indefinite" repeatCount="indefinite"/>'
      : '')
    + '<g transform="translate(-109 -340)">'
    + `<path fill="var(--spider-body)" d="${SPIDER_BODY_PATH}"/>`
    + '<g transform="translate(108 353)"><g class="atc-eyes">'
    + (animated
      ? '<animateTransform attributeName="transform" type="scale" values="1 1;1 .1;1 1"'
        + ' keyTimes="0;.7;.722" calcMode="discrete" dur="9s" begin="indefinite" repeatCount="indefinite"/>'
      : '')
    + '<g transform="translate(-108 -353)">'
    + '<ellipse cx="93.9" cy="355.7" rx="7.5" ry="7.5" fill="var(--spider-accent)"/>'
    + '<ellipse cx="123" cy="351" rx="7.5" ry="7.5" fill="var(--spider-accent)"/>'
    + '</g></g></g>'
    + '<path fill="none" stroke="var(--spider-accent)" stroke-width="3" stroke-linecap="round"'
    + ' d="M102.8 368.3 Q111.8 373 116.3 366.4"/>'
    + '</g></g></g></g>'
    + '<g class="atc-silk">'
    + (animated ? `<animateTransform ${swing} data-lag="-2.76"/>` : '')
    + '<line x1="93.5" y1="0" x2="94" y2="214" stroke="var(--spider-thread)" stroke-width="12" stroke-linecap="round"/>'
    + '</g>'
    + '<g class="atc-bead">'
    + (animated ? `<animateTransform ${swing} data-lag="-2.82"/>` : '')
    + '<ellipse cx="94.5" cy="214" rx="19.5" ry="18" fill="var(--spider-thread)"/>'
    + '</g></g>';
}

/**
 * @param {number} size 渲染边长（属性初值；实际尺寸由 CSS 决定，窄容器会降级）
 * @returns {string}
 */
export function spiderArt(size) {
  const animated = !prefersReducedMotion();
  return `<svg class="spider-art" width="${size}" height="${size}" viewBox="-20.9528 0 261 424"`
    + ` preserveAspectRatio="xMidYMid meet" data-motion="${animated ? 'idle' : 'static'}"`
    + ' aria-hidden="true" focusable="false">'
    + spiderInner(animated)
    + '</svg>';
}

/** 空状态插画不抢首屏：节点自己出现满 500ms 才启动 SMIL；后续重绘不重置这个计时。 */
let spiderTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
/** @type {WeakMap<SVGSVGElement, number>} */
const spiderArmedAt = new WeakMap();

/** @param {SVGSVGElement} art */
function startSpider(art) {
  for (const node of art.querySelectorAll('animate, animateTransform')) {
    const animation = /** @type {SVGAnimationElement} */ (node);
    // 丝与珠比身体慢 241ms / 182ms：负偏移把 start 点推回过去，还原重绘稿的相位差。
    const lag = Number(animation.dataset.lag ?? 0);
    animation.beginElementAt(lag < 0 ? lag : 0);
  }
  art.dataset.motion = 'running';
}

/**
 * 0.35s 淡入：隔一帧再加 `is-in`，让首帧的 opacity:0 先落一次，过渡才有起点。
 * @param {SVGSVGElement} art
 */
function fadeInSpider(art) {
  if (typeof requestAnimationFrame !== 'function') { art.classList.add('is-in'); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => art.classList.add('is-in')));
}

export function armSpider() {
  const idle = [...document.querySelectorAll('.spider-art[data-motion="idle"]')]
    .map(node => /** @type {SVGSVGElement} */ (node));
  if (idle.length === 0) {
    if (spiderTimer !== null) { clearTimeout(spiderTimer); spiderTimer = null; }
    return;
  }
  if (prefersReducedMotion()) {
    for (const art of idle) art.dataset.motion = 'static';
    if (spiderTimer !== null) { clearTimeout(spiderTimer); spiderTimer = null; }
    return;
  }
  const now = performance.now();
  for (const art of idle) {
    if (!spiderArmedAt.has(art)) {
      spiderArmedAt.set(art, now);
      fadeInSpider(art);
    }
    // 计时期间被选中：节点离开文档，计时随 WeakMap 一起失效，不必显式清理。
    if (now - (spiderArmedAt.get(art) ?? now) >= 500) {
      startSpider(art);
      spiderArmedAt.delete(art);
    }
  }
  const waiting = idle.filter(art => art.dataset.motion === 'idle');
  if (waiting.length === 0) {
    if (spiderTimer !== null) { clearTimeout(spiderTimer); spiderTimer = null; }
    return;
  }
  if (spiderTimer !== null) return;
  const due = Math.min(...waiting.map(art => (spiderArmedAt.get(art) ?? now) + 500 - now));
  spiderTimer = setTimeout(() => { spiderTimer = null; armSpider(); }, Math.max(0, due));
}

document.addEventListener('motionchange', () => {
  if (!prefersReducedMotion()) return;
  // 中途切到 reduce：直接换成品，不用 animation:none 去冻一个带动效的副本。
  for (const node of document.querySelectorAll('.spider-art')) {
    const art = /** @type {SVGSVGElement} */ (node);
    const size = Number(art.getAttribute('width')) || 160;
    const host = document.createElement('template');
    host.innerHTML = spiderArt(size);
    const next = /** @type {SVGSVGElement} */ (host.content.firstElementChild);
    art.replaceWith(next);
  }
});
