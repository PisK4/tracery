// @ts-check
/**
 * 动效统一入口：页面所有 JS 驱动的动画都经这里，reduced-motion 或浏览器
 * 缺 WAAPI 时短路返回 null，调用方按 null 跳过等待。CSS 侧的 transition 与
 * keyframes 由 app.css 动效区的 media blanket 统一关闭，两边口径一致。
 * 时长单位是秒；easing 默认取 app.css --ease-out 同一条 bezier。
 * 模块可在 bun test 无 DOM 环境导入（与 app.js 的 spider 守卫同口径）。
 *
 * 「减少动效」的判定只在这一处：系统偏好与设置面板的开关取或。web/ 里其余
 * 模块一律调用 prefersReducedMotion()，不各自读 matchMedia。
 */
import { animate } from './motion.vendor.js';

const SYSTEM_REDUCE = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const EASE = [0, 0, 0.2, 1];
/** 设置面板写入的用户开关；启动时由 initSettings 注入一次。 */
let userReduce = false;

/**
 * 唯一的 reduced-motion 判定：系统偏好或用户主动选择减少动效。
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return userReduce || (SYSTEM_REDUCE !== null && SYSTEM_REDUCE.matches);
}

/**
 * 设置面板写入开关；同步把状态挂到 documentElement 供 CSS blanket 读取，
 * 让 CSS 与 JS 两条路径共用一个口径。
 * @param {boolean} value
 */
export function setReduceMotion(value) {
  userReduce = value === true;
  if (typeof document !== 'undefined') {
    if (prefersReducedMotion()) document.documentElement.dataset.reduceMotion = 'true';
    else delete document.documentElement.dataset.reduceMotion;
    // 开关与系统偏好共用一条通知：蜘蛛等需要换成品的模块订阅这一个事件。
    document.dispatchEvent(new CustomEvent('motionchange'));
  }
}
if (SYSTEM_REDUCE !== null && typeof document !== 'undefined') {
  SYSTEM_REDUCE.addEventListener('change', () => {
    if (prefersReducedMotion()) document.documentElement.dataset.reduceMotion = 'true';
    else if (!userReduce) delete document.documentElement.dataset.reduceMotion;
    document.dispatchEvent(new CustomEvent('motionchange'));
  });
}

/**
 * @param {Element} el
 * @param {Record<string, (string | number)[]>} keyframes 属性 → 关键帧数组（Motion 原生形状）
 * @param {number} [duration] 秒，默认 0.15
 * @param {{ clean?: boolean }} [options] clean 为真时播完清掉末帧固化的 inline 属性
 * @returns {{ finished: Promise<unknown>, cancel: () => void } | null}
 */
export function motion(el, keyframes, duration = 0.15, options = {}) {
  if (prefersReducedMotion()) return null;
  if (typeof el.animate !== 'function') return null;
  const run = /** @type {(target: Element, frames: Record<string, (string | number)[]>, options: {duration: number, easing: number[]}) => {finished: Promise<unknown>, cancel: () => void}} */ (animate);
  const controls = run(el, keyframes, { duration, easing: EASE });
  // vendor 的 onfinish 用 fill:"both" 把末帧写成 inline style 再 cancel。入场动画
  // 的末帧通常等于 CSS 正常值，留着会压住后续样式变化；离场动画仍需保留末帧
  // 到元素隐藏或移除，所以只在调用方要清理时清。
  if (options.clean === true) {
    const props = Object.keys(keyframes);
    const style = /** @type {HTMLElement} */ (el).style;
    void settled(controls, duration * 1000 + 120).then(() => {
      for (const prop of props) style.removeProperty(prop);
    });
  }
  return controls;
}

/**
 * finished 的兜底等待：个别环境（如嵌入式 WebKit）动画时钟不前进，finished
 * 永不 settle，调用方按「动画或超时先到者」继续，界面不等地。返回值永不拒绝。
 * @param {{ finished: Promise<unknown> } | null} controls
 * @param {number} ms 毫秒上限，取动画时长加一档余量
 * @returns {Promise<void>}
 */
export function settled(controls, ms) {
  if (controls === null) return Promise.resolve();
  return Promise.race([
    controls.finished,
    new Promise(resolve => setTimeout(resolve, ms)),
  ]).then(() => {}, () => {});
}
