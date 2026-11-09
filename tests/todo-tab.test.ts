import { expect, test } from 'bun:test';
import { todoKindOf, todoOpenCount, todoTabHtml } from '../web/todo-tab.js';

const failed = {
  key: 'session', actor: 'acme', turn: 1, state: 'failed' as const, snapshot: null,
};

/** 三家原词混排：只验证展示层归类，不要求服务端归一。 */
const ready = {
  key: 'session', actor: 'acme', turn: 1, state: 'ready' as const,
  snapshot: {
    seq: 1,
    items: [
      { status: 'completed', content: '甲' },
      { status: 'in_progress', content: '乙' },
      { status: 'pending', content: '丙' },
      { status: 'cancelled', content: '丁' },
    ],
  },
};

test('请求态没有轮号时提示先选轮次，不显示读取中', () => {
  const html = todoTabHtml({ status: 'idle', data: null }, false);
  expect(html).toContain('选择轮次后查看待办');
  expect(html).not.toContain('读取中');
});

test('轮次态读取中与失败状态保持原样', () => {
  expect(todoTabHtml({ status: 'loading', data: null }, true)).toContain('读取中');
  expect(todoTabHtml({ status: 'ready', data: failed }, true)).toContain('读取失败');
});

test('状态只在展示层归类，完成与进行中分开，其余原样落 pending', () => {
  expect(todoKindOf('completed')).toBe('done');
  expect(todoKindOf('done')).toBe('done');
  expect(todoKindOf('in_progress')).toBe('doing');
  expect(todoKindOf('cancelled')).toBe('pending');
  expect(todoKindOf('whatever')).toBe('pending');
});

test('待办卡给完成数与进度，行按归类落状态标记', () => {
  const html = todoTabHtml({ status: 'ready', data: ready }, true);
  expect(html).toContain('class="rail-section todo-card"');
  expect(html).toContain('<span class="todo-count">1 / 4</span>');
  expect(html).toContain('aria-label="已完成 1 / 4"');
  expect(html).toContain('style="width:25%"');
  // 状态不再以原词平铺，而是落成三档标记；取消与未知都归 pending。
  expect(html).not.toContain('>completed<');
  expect(html).toContain('class="todo-row done"');
  expect(html).toContain('class="todo-row doing"');
  expect((html.match(/class="todo-row pending"/g) ?? []).length).toBe(2);
  // 正文照常转义。
  expect(html).toContain('<div class="todo-title">甲</div>');
});

test('页签徽标只数未完成项，读数未就绪时为零', () => {
  expect(todoOpenCount({ status: 'ready', data: ready })).toBe(3);
  expect(todoOpenCount({ status: 'loading', data: null })).toBe(0);
  expect(todoOpenCount({ status: 'ready', data: failed })).toBe(0);
});
