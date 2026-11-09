// @ts-check
/**
 * 第五页签：只拼 HTML 字符串，不读写 DOM、不发起读取；测试直接断言输出。
 * 状态词保留各家原词，归类只在展示层做（done / doing / 其余），不要求服务端归一。
 */
import { esc } from './html.js';
import { t } from './i18n.js';
import { icon } from './icons.js';

/**
 * 展示层状态归类：完成、进行中、其余。各家词表不同（pending / in_progress /
 * completed / done / cancelled…），只在展示层收敛，不写回 DTO。
 * @param {string} status
 * @returns {'done' | 'doing' | 'pending'}
 */
export function todoKindOf(status) {
  const word = status.toLowerCase();
  if (word === 'completed' || word === 'done' || word === 'complete') return 'done';
  if (word === 'in_progress' || word === 'in-progress' || word === 'doing' || word === 'active') return 'doing';
  return 'pending';
}

/**
 * 未完成项数量：页签徽标用它，读数未就绪时返回 0（不显示徽标）。
 * @param {{status: 'idle' | 'loading' | 'ready' | 'absent', data: import('../src/queries/todo-by-turn').TodoByTurn | null}} reading
 */
export function todoOpenCount(reading) {
  const snapshot = reading.status === 'ready' ? reading.data?.snapshot ?? null : null;
  if (snapshot === null) return 0;
  return snapshot.items.filter(item => todoKindOf(item.status) !== 'done').length;
}

/** @param {'done' | 'doing' | 'pending'} kind */
function markHtml(kind) {
  const art = kind === 'done' ? icon('check', 11) : kind === 'doing' ? '<i class="todo-dot"></i>' : '';
  return `<span class="todo-mark ${kind}" aria-hidden="true">${art}</span>`;
}

/**
 * @param {{status: 'idle' | 'loading' | 'ready' | 'absent', data: import('../src/queries/todo-by-turn').TodoByTurn | null}} reading
 * @param {boolean} hasTurn 请求态没有轮号，读取不会开始，不能停在「读取中」。
 * @returns {string}
 */
export function todoTabHtml(reading, hasTurn) {
  if (reading.status === 'loading') {
    return `<div class="rail-empty">${t('读取中')}</div>`;
  }
  if (reading.status === 'idle') {
    if (!hasTurn) return `<div class="rail-empty">${t('选择轮次后查看待办')}</div>`;
    return `<div class="rail-empty">${t('读取中')}</div>`;
  }
  if (reading.status === 'absent' || reading.data === null) {
    return `<div class="rail-empty">${t('读取失败')}</div>`;
  }
  const { state, snapshot } = reading.data;
  if (state === 'failed') {
    return `<div class="rail-empty">${t('读取失败')}</div>`;
  }
  if (state === 'unavailable') {
    return `<div class="rail-empty">${t('正文已回收，待办不可读')}</div>`;
  }
  if (state !== 'ready' || snapshot === null) {
    return `<div class="rail-empty">${t('本轮没有待办')}</div>`;
  }
  if (snapshot.items.length === 0) {
    return `<div class="rail-empty">${t('本轮没有待办')}</div>`;
  }
  const total = snapshot.items.length;
  const done = snapshot.items.filter(item => todoKindOf(item.status) === 'done').length;
  const pct = Math.round(done / total * 100);
  const rows = snapshot.items.map(item => {
    const kind = todoKindOf(item.status);
    return `<li class="todo-row ${kind}">${markHtml(kind)}<div class="todo-body"><div class="todo-title">${esc(item.content)}</div></div></li>`;
  }).join('');
  return `<section class="rail-section todo-card">
    <h3>${icon('list-todo', 13)}${t('待办')}<span class="grow"></span><span class="todo-count">${done} / ${total}</span></h3>
    <div class="todo-meter" role="img" aria-label="${t('已完成 {done} / {total}', { done, total })}"><i style="width:${pct}%"></i></div>
    <ul class="todo-list">${rows}</ul>
  </section>`;
}
