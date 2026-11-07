// @ts-check

/**
 * 重绘后把滚动位置放回去。内容变短时夹到新的可滚动上限内。
 * @param {{scrollHeight?: number, clientHeight?: number, scrollTop: number}} element
 * @param {number} previous
 * @returns {number}
 */
export function restoreScroll(element, previous) {
  const max = Math.max(0, (element.scrollHeight ?? 0) - (element.clientHeight ?? 0));
  element.scrollTop = Math.min(Math.max(0, previous), max);
  return element.scrollTop;
}
