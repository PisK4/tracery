import { expect, test } from 'bun:test';
import {
  donutSvg, outputSegments, selectionOf, timeSegments, tokenSegments, turnUsageOf, usagePanelsHtml,
} from '../web/usage-donuts.js';

/** 圆环段：只数 <circle class="donut-seg">，段间缝隙不另计。 */
const segCount = (html: string) => (html.match(/class="donut-seg/g) ?? []).length;

test('输入侧按固定类别次序取色，未知 kind 缀后，零值不画', () => {
  const segs = tokenSegments([
    { kind: 'chat', tokens: 30 },
    { kind: 'system', tokens: 50 },
    { kind: 'files', tokens: 0 },
    { kind: 'custom', tokens: 20 },
  ]);
  // 次序是 PARTS 登记序而不是输入序：system 在 chat 之前，未知 kind 落最后。
  expect(segs.map(seg => seg.key)).toEqual(['system', 'chat', 'custom']);
  // 色阶序号按绘制位置递增，不按类别固定占位。
  expect(segs.map(seg => seg.color)).toEqual([1, 2, 3]);
});

test('输出侧两类只在 reasoning 与总量都在时成立，缺一个整块不画', () => {
  expect(outputSegments(null, 100)).toEqual([]);
  expect(outputSegments(40, null)).toEqual([]);
  const both = outputSegments(40, 100);
  expect(both.map(seg => [seg.key, seg.value])).toEqual([['output_reasoning', 40], ['output_text', 60]]);
  // 推理等于总量时没有回复段，不画 0 长段。
  expect(outputSegments(100, 100).map(seg => seg.key)).toEqual(['output_reasoning']);
});

test('耗时只画有字段的分段，缺字段不留空段也不补平均', () => {
  const segs = timeSegments({ wait: 500, reasoning: null, exec: 0, reply: 1500, other: null });
  expect(segs.map(seg => [seg.key, seg.value])).toEqual([['wait', 500], ['reply', 1500]]);
  // 全是 null（没有一笔有计时）时整块为空，调用方据此不画面板。
  expect(timeSegments({ wait: null, reasoning: null, exec: null, reply: null, other: null })).toEqual([]);
});

test('圆环段与图例一一对应，时间轴刻度由分段累加得出', () => {
  const segs = timeSegments({ wait: 2000, reasoning: null, exec: 1000, reply: 3000, other: null });
  const html = usagePanelsHtml({
    token: { segs: tokenSegments([{ kind: 'system', tokens: 10 }, { kind: 'chat', tokens: 30 }]), center: '40', centerLabel: '仅输入侧', side: '', title: '' },
    time: { segs, center: '6s', centerLabel: '轮次活跃', side: '', title: '' },
    selected: null,
  });
  // 两侧圆环段数与各自图例行数相等：没有多画也没有少画。
  const panels = html.split('<section class="stat-panel"');
  expect(segCount(panels[1]!)).toBe(2);
  expect((panels[1]!.match(/class="sp-row token"/g) ?? []).length).toBe(2);
  expect(segCount(panels[2]!)).toBe(3);
  expect((panels[2]!.match(/class="sp-row time"/g) ?? []).length).toBe(3);
  // 刻度是累计时长：2s、3s（+1s 工具）、6s，不是等分。
  expect(panels[2]).toContain('<span>0</span><span>2s</span><span>3s</span><span>6s</span>');
});

test('选中一行只压暗同侧的其他段，另一张图靠映射表点亮对应阶段', () => {
  const token = tokenSegments([{ kind: 'results', tokens: 10 }, { kind: 'chat', tokens: 30 }]);
  const time = timeSegments({ wait: 1, reasoning: null, exec: 2, reply: 3, other: null });
  const html = usagePanelsHtml({
    token: { segs: token, center: '40', centerLabel: '仅输入侧', side: '', title: '' },
    time: { segs: time, center: '6s', centerLabel: '轮次活跃', side: '', title: '' },
    selected: { side: 'token', key: 'results' },
  });
  // 工具结果 ↔ 工具执行是唯一真实对应：另一侧点亮 exec，不点亮别的段。
  expect(html).toContain('data-cat="exec" data-side="time"');
  // 压暗只落在图形上：同侧另一段圆环 1 处，另一张图的两段圆环与时间轴共 4 处。
  expect((html.match(/is-dim/g) ?? []).length).toBe(5);
});

test('选中态从 data-* 读出，缺字段返回 null', () => {
  const node = (attrs: Record<string, string>) => ({
    getAttribute: (name: string) => attrs[name] ?? null,
  }) as unknown as Element;
  expect(selectionOf(node({ 'data-side': 'token', 'data-cat': 'chat' }))).toEqual({ side: 'token', key: 'chat' });
  expect(selectionOf(node({ 'data-side': 'other', 'data-cat': 'chat' }))).toBeNull();
  expect(selectionOf(node({ 'data-side': 'token' }))).toBeNull();
  expect(selectionOf(null)).toBeNull();
});

test('轮次读数：Token 中心取轮末笔单笔口径，耗时按轮内求和', () => {
  const rows = [
    { req_id: 1, ms: 1000, ttft_ms: 200, reasoning_span_ms: 100, in_tok: 10, out_tok: 5, cache_read: 0 },
    { req_id: 2, ms: 2000, ttft_ms: 500, reasoning_span_ms: 200, in_tok: 100, out_tok: 50, cache_read: 50 },
  ];
  const details = new Map<number, unknown>([
    [1, { ms: 1000, ttft_ms: 200, reasoning_span_ms: 100, prompt: { tokens: 10, parts: [{ kind: 'system', tokens: 10 }] }, reasoning: null, tool_calls: [] }],
    [2, {
      ms: 2000, ttft_ms: 500, reasoning_span_ms: 200,
      prompt: { tokens: 100, parts: [{ kind: 'system', tokens: 60 }, { kind: 'chat', tokens: 40 }] },
      reasoning: 20, tool_calls: [{ exec_ms: 300 }],
    }],
  ]);
  const usage = turnUsageOf(rows as never, id => details.get(id) as never);
  // 输入侧取末笔有分类的请求，不把两笔提示相加（每笔都重发完整上下文）。
  expect(usage.token.inputSegs.map(seg => seg.value)).toEqual([60, 40]);
  expect(usage.token.segs.length).toBe(4);
  // 中心＝该笔 prompt.tokens + out_tok；缓存命中与输出速度跟着同一笔。
  expect(usage.token.center).toBe('150');
  expect(usage.token.reqId).toBe(2);
  expect(usage.token.cacheRead).toBe(50);
  // 耗时按轮内求和：等待 700、思考 300、回复 (1000-200-100)+(2000-500-200)=2000，工具执行在请求耗时之外。
  const time = Object.fromEntries(usage.time.segs.map(seg => [seg.key, seg.value]));
  expect(time).toEqual({ wait: 700, reasoning: 300, exec: 300, reply: 2000 });
  // 活跃时长＝Σ ms + Σ exec_ms；四段之和与之相等，没有「其他开销」。
  expect(usage.time.active).toBe(3300);
  // 输出速度＝Σ out ÷ Σ 生成时长：(5+50) ÷ ((1000-200)+(2000-500))/1000 = 24。
  expect(usage.time.speed).toBe(24);
});

test('轮内没有 prompt 分类时退回末笔输出，中心只写提示量并在标签说明', () => {
  const rows = [{ req_id: 3, ms: 1000, ttft_ms: 100, reasoning_span_ms: null, in_tok: 5, out_tok: 7, cache_read: null }];
  const usage = turnUsageOf(rows as never, () => null);
  expect(usage.token.inputSegs).toEqual([]);
  expect(usage.token.center).toBe('—');
  expect(usage.token.centerLabel).toBe('仅输入侧');
});

test('圆环段只画弧长，不在 SVG 里写死颜色或文字', () => {
  const svg = donutSvg([{ key: 'chat', label: '对话内容', value: 1, color: 3 }], '1', '仅输入侧', 'token', null);
  expect(svg).toContain('style="stroke:var(--cat-3)"');
  expect(svg).not.toContain('#');
  expect(svg).toContain('aria-hidden="true"');
});
