import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultDataDir,
  deriveCapacityLimits,
  freeBytesAt,
  loadConfig,
  BODY_BUDGET_RATIO,
  DISK_FREE_WARN_BYTES,
  MAX_BODY_BUDGET_BYTES,
  MAX_DISK_LIMIT_BYTES,
  MIN_DISK_LIMIT_BYTES,
  SYSTEM_DISK_MARGIN_BYTES,
} from '../src/config';

// 与配置层一致：十进制 1e9，与环境变量 parseSize 的 "GB" 同单位。
const GB = 1_000_000_000;

test('默认数据目录按平台惯例选根', () => {
  expect(defaultDataDir({}, 'darwin', '/home/u')).toBe('/home/u/Library/Application Support/tracery');
  expect(defaultDataDir({}, 'linux', '/home/u')).toBe('/home/u/.local/share/tracery');
  expect(defaultDataDir({}, 'freebsd', '/home/u')).toBe('/home/u/.local/share/tracery');
});

test('XDG_DATA_HOME 覆盖根目录，目录名不随平台变', () => {
  expect(defaultDataDir({ XDG_DATA_HOME: '/x/data' }, 'linux', '/home/u')).toBe('/x/data/tracery');
  expect(defaultDataDir({ XDG_DATA_HOME: '  ' }, 'linux', '/home/u')).toBe('/home/u/.local/share/tracery');
});

test('常量是 GB 且自洽，优先级：系统余量 → 正文预算 → 保留期', () => {
  expect(SYSTEM_DISK_MARGIN_BYTES).toBe(5 * GB);
  expect(MIN_DISK_LIMIT_BYTES).toBe(2 * GB);
  expect(MAX_DISK_LIMIT_BYTES).toBe(16 * GB);
  expect(MAX_BODY_BUDGET_BYTES).toBe(10 * GB);
  expect(DISK_FREE_WARN_BYTES).toBe(7 * GB);
  expect(BODY_BUDGET_RATIO).toBe(0.625);
  expect(MAX_DISK_LIMIT_BYTES * BODY_BUDGET_RATIO).toBe(MAX_BODY_BUDGET_BYTES);
});

test('100 GB 剩余：两条上限各自封顶，不告警', () => {
  expect(deriveCapacityLimits(100 * GB)).toEqual({
    diskLimit: 16 * GB, bodyBudget: 10 * GB, diskFreeLow: false,
  });
});

test('20 GB 剩余：扣 5 GB 余量得 15 GB，正文按 0.625 取 9.375 GB', () => {
  expect(deriveCapacityLimits(20 * GB)).toEqual({
    diskLimit: 15 * GB,
    bodyBudget: Math.floor(15 * GB * BODY_BUDGET_RATIO),
    diskFreeLow: false,
  });
  expect(deriveCapacityLimits(20 * GB).bodyBudget).toBeLessThan(MAX_BODY_BUDGET_BYTES);
});

test('5 GB 剩余：夹到 2 GB 下限，正文 1.25 GB，告警', () => {
  expect(deriveCapacityLimits(5 * GB)).toEqual({
    diskLimit: 2 * GB, bodyBudget: Math.floor(2 * GB * BODY_BUDGET_RATIO), diskFreeLow: true,
  });
});

test('6 GB 仍告警且夹到下限；7 GB 边界不再告警', () => {
  const six = deriveCapacityLimits(6 * GB);
  expect(six.diskLimit).toBe(2 * GB);
  expect(six.diskFreeLow).toBe(true);
  const seven = deriveCapacityLimits(7 * GB);
  expect(seven.diskLimit).toBe(2 * GB);
  expect(seven.diskFreeLow).toBe(false); // 严格小于才告警
});

test('非有限剩余空间按写死默认 16/10 GB 回退，不产 NaN', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    expect(deriveCapacityLimits(bad)).toEqual({
      diskLimit: MAX_DISK_LIMIT_BYTES, bodyBudget: MAX_BODY_BUDGET_BYTES, diskFreeLow: false,
    });
  }
});

test('loadConfig 无 freeBytes 时保持原默认，不破坏既有基线', () => {
  const c = loadConfig({});
  expect(c.diskLimit).toBe(16_000_000_000);
  expect(c.bodyBudget).toBe(10_000_000_000);
});

test('loadConfig 传 freeBytes 时采用推导值', () => {
  const c = loadConfig({}, { freeBytes: 20 * GB });
  expect(c.diskLimit).toBe(15 * GB);
  expect(c.bodyBudget).toBe(Math.floor(15 * GB * BODY_BUDGET_RATIO));
  expect(c.bodyBudget).toBeLessThan(c.diskLimit); // 保留 body_budget_not_below_disk_limit 校验
});

test('loadConfig：环境变量显式覆盖优先，未设的那一项仍用推导值', () => {
  const both = loadConfig(
    { ATC_DISK_LIMIT: '8GB', ATC_BODY_BUDGET: '3GB' },
    { freeBytes: 7 * GB },
  );
  expect(both.diskLimit).toBe(8_000_000_000);
  expect(both.bodyBudget).toBe(3_000_000_000);

  const onlyDisk = loadConfig({ ATC_DISK_LIMIT: '12GB' }, { freeBytes: 20 * GB });
  expect(onlyDisk.diskLimit).toBe(12_000_000_000);
  expect(onlyDisk.bodyBudget).toBe(Math.floor(15 * GB * BODY_BUDGET_RATIO)); // 正文仍按推导的 15 GB
});

test('loadConfig 仍拒绝正文预算不小于磁盘上限', () => {
  expect(() => loadConfig({ ATC_DISK_LIMIT: '1GB', ATC_BODY_BUDGET: '2GB' }))
    .toThrow('body_budget_not_below_disk_limit');
});

test('freeBytesAt：临时目录返回正数，不存在路径沿祖先上溯不抛错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atc-freebytes-'));
  try {
    expect(freeBytesAt(dir)).toBeGreaterThan(0);
    expect(freeBytesAt(join(dir, 'no', 'such', 'deep'))).toBeGreaterThan(0); // 上溯到临时目录所在卷
    expect(freeBytesAt(null as unknown as string)).toBeNull(); // 坏输入不抛错
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
