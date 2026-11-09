// @ts-check
/**
 * 宿主接缝：`?host=desktop` 只切换窗口外壳与顶栏样式，不换页面骨架，也不新增
 * 读取。浏览器路径铺满视口，桌面外壳才用固定初始窗口与原生交通灯。
 * 参数只认 `desktop`，其他值按浏览器处理；宿主是展示层事实，不落 URL 之外的存储。
 */

/** @param {string} search @returns {'desktop' | 'browser'} */
export function hostOf(search) {
  return new URLSearchParams(search).get('host') === 'desktop' ? 'desktop' : 'browser';
}

/** 宿主标记挂在根元素上，CSS 用它分岔顶栏；重复调用幂等。 @param {'desktop' | 'browser'} host */
export function applyHost(host) {
  if (host === 'desktop') document.documentElement.dataset.host = 'desktop';
  else delete document.documentElement.dataset.host;
}
