// @ts-check
/**
 * 工具动作摘要：按工具分派到一行可读的动作段，路径折算成末两段。
 *
 * 中栏调用行与右栏工具往返共用这一份分派与回退链，新增工具只改这里。
 * 叶子模块，不 import 仓库内其他 web 模块（i18n 例外：纯数据映射）。
 * 区间折算与字节读数只服务扫读，原始键值始终在悬停与配对页。
 */

import { t } from './i18n.js';

/** 悬停 title 属性的超长护栏：预览文本不按字符截断，属性仍要防大参数撑爆。 */
const TITLE_MAX = 2000;

/** @param {string} text @param {number} [max] */
export const clipChars = (text, max = TITLE_MAX) => {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
};

/**
 * 路径末两段：扫读锚点是「上层目录 + 文件名」，只有一段时原样返回。
 *
 * 读模型不带 cwd（`raw_hook.cwd` 有列但不在 `RequestDetail`，omp/zcode 侧实测全空），
 * 拿不到项目根，所以按纯后缀切：绝对路径的倒数第二段是直接父目录，
 * `/…/agent-trace-collector/src/harness/semantics.ts` 显示 `harness/semantics.ts`，
 * 仓库根文件显示 `agent-trace-collector/AGENTS.md`。完整路径进悬停与右栏。
 * @param {string} p
 */
const baseName = (p) => {
  const parts = p.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
};
export { baseName };

/** @param {unknown} v @returns {string | null} 非空字符串原样返回，其余 null。 */
const nonEmpty = (v) => (typeof v === 'string' && v !== '' ? v : null);

/** 文件类参数取末两段。 @param {unknown} v */
const fileBase = (v) => {
  const s = nonEmpty(v);
  return s === null ? null : baseName(s);
};

/** @param {unknown} v @returns {number | null} */
const asNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 行数按换行计；缺失或空串为 0 行。 @param {string | null} s */
const lineCount = (s) => (s === null || s === '' ? 0 : s.split('\n').length);

/** 第一个非空行（trim 后）。 @param {string} text */
const firstNonEmptyLine = (text) => {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return '';
};

/** 行内 diff 的行数上限：渲染路径逐行跑，超过退回总行数对比。 */
const INLINE_DIFF_LINES = 120;

/**
 * LCS 行级 diff：返回增删行数与带符号的行序列。纯函数，无库依赖。
 * 任一侧超过 300 行时不跑对照（guarded），调用方退回统计或全文；
 * 浮层只在打开时调用，行内摘要另有更低的门槛（INLINE_DIFF_LINES）。
 * @param {string} oldText @param {string} newText
 * @returns {{add: number, del: number, guarded: boolean,
 *   lines: {sign: 'ctx' | 'add' | 'del', text: string}[] | null}}
 */
export function editDiff(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  if (a.length > 300 || b.length > 300) return { add: 0, del: 0, guarded: true, lines: null };
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  /** @type {{sign: 'ctx' | 'add' | 'del', text: string}[]} */
  const lines = [];
  let i = 0, j = 0, add = 0, del = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push({ sign: 'ctx', text: a[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ sign: 'del', text: a[i] }); del += 1; i += 1; }
    else { lines.push({ sign: 'add', text: b[j] }); add += 1; j += 1; }
  }
  while (i < n) { lines.push({ sign: 'del', text: a[i] }); del += 1; i += 1; }
  while (j < m) { lines.push({ sign: 'add', text: b[j] }); add += 1; j += 1; }
  return { add, del, guarded: false, lines };
}

/** content 字节数读数：不足 1KB 显示 B，满 1MB 换 MB，其余 KB 一位小数。 @param {string} text */
export const byteSize = (text) => {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

/**
 * 逐工具参数段：核心键齐才分派，缺核心键返回 null 走通用回退链。
 * 区间折算与字节读数只服务扫读，原始键值始终在悬停与右栏。
 *
 * 文件目标键有两个来源：Claude Code 用 `file_path`，OMP（oh-my-pi）的同族
 * 小写工具 read/write/edit/grep/glob 用 `path`；两个键同权接受，缺的键走
 * 另一个。大小写变体共用同一分支：工具名只分派一次，别名不重复摘要逻辑。
 *
 * @param {string} name @param {Record<string, unknown>} args @returns {string | null}
 */
function dispatchSummary(name, args) {
  switch (name) {
    case 'Read':
    case 'read':
    case 'read_file': {
      const file = fileBase(args.file_path) ?? fileBase(args.path);
      if (file === null) return null;
      const offset = asNum(args.offset);
      const limit = asNum(args.limit);
      const range = offset !== null && limit !== null ? t('{from}–{to} 行', { from: offset, to: offset + limit })
        : limit !== null ? t('前 {n} 行', { n: limit })
          : offset !== null ? t('{n} 行起', { n: offset }) : '';
      return range === '' ? file : `${file} · ${range}`;
    }
    case 'Edit':
    case 'edit':
    case 'patch': {
      const file = fileBase(args.file_path) ?? fileBase(args.path);
      if (file === null) return null;
      const oldS = typeof args.old_string === 'string' ? args.old_string : null;
      const newS = typeof args.new_string === 'string' ? args.new_string : null;
      const parts = [file];
      if (oldS !== null && newS !== null
        && lineCount(oldS) <= INLINE_DIFF_LINES && lineCount(newS) <= INLINE_DIFF_LINES) {
        // 行内增删计数由同一份 diff 数据算出，与浮层里的逐行对照同源，不写死。
        const d = editDiff(oldS, newS);
        parts.push(t('+{a} −{b} 行', { a: d.add, b: d.del }));
      } else if (oldS !== null || newS !== null) {
        parts.push(t('{a}→{b} 行', { a: lineCount(oldS), b: lineCount(newS) }));
      }
      if (args.replace_all === true) parts.push(t('全部替换'));
      return parts.join(' · ');
    }
    case 'Write':
    case 'write':
    case 'write_file': {
      const file = fileBase(args.file_path) ?? fileBase(args.path);
      if (file === null) return null;
      const content = typeof args.content === 'string' ? args.content : null;
      return content !== null ? `${file} · ${byteSize(content)}` : file;
    }
    case 'eval':
    case 'execute_code':
    case 'browser_exec': {
      // 代码块族：code(长文本) + 短元数据。行内给语言、标题与行数，全文进浮层。
      const code = typeof args.code === 'string' && args.code.trim() !== '' ? args.code : null;
      if (code === null) return null;
      const bits = [nonEmpty(args.language), nonEmpty(args.title)]
        .filter(x => x !== null).map(x => /** @type {string} */ (x));
      bits.push(t('{n} 行', { n: lineCount(code) }));
      return bits.join(' · ');
    }
    case 'TodoWrite': {
      const todos = Array.isArray(args.todos) ? args.todos : null;
      if (todos === null) return null;
      const done = todos.filter(item => item !== null && typeof item === 'object'
        && (/** @type {Record<string, unknown>} */ (item)).status === 'completed').length;
      return t('{n} 条 · {done} 完成', { n: todos.length, done });
    }
    case 'skill_manage':
    case 'memory': {
      const items = arrayItemsOf(args);
      return items !== null ? t('{n} 条', { n: items.length }) : null;
    }
    case 'Bash':
    case 'bash': {
      const desc = typeof args.description === 'string' && args.description.trim() !== ''
        ? args.description.trim() : null;
      if (desc !== null) return desc;
      const command = typeof args.command === 'string' ? firstNonEmptyLine(args.command) : '';
      return command !== '' ? command : null;
    }
    case 'Skill': {
      const skill = nonEmpty(args.skill);
      if (skill === null) return null;
      const extra = typeof args.args === 'string' && args.args.trim() !== '' ? ` · ${args.args.trim()}` : '';
      return `${skill}${extra}`;
    }
    case 'Agent': {
      const type = nonEmpty(args.subagent_type);
      if (type === null) return null;
      const desc = typeof args.description === 'string' && args.description.trim() !== ''
        ? ` · ${args.description.trim()}` : '';
      return `${type}${desc}`;
    }
    case 'SendMessage': {
      const summary = typeof args.summary === 'string' && args.summary.trim() !== '' ? args.summary.trim() : null;
      const to = nonEmpty(args.to);
      if (summary === null && to === null) return null;
      const target = to !== null ? `→ ${[...to].slice(0, 8).join('')}` : null;
      return [summary, target].filter(Boolean).join(' ');
    }
    case 'SubagentHandback': {
      const message = typeof args.message === 'string' ? firstNonEmptyLine(args.message) : '';
      return message !== '' ? message : null;
    }
    case 'WebFetch': {
      const url = nonEmpty(args.url);
      return url === null ? null : url.replace(/^https?:\/\//, '');
    }
    case 'ToolSearch': {
      return typeof args.query === 'string' && args.query.trim() !== '' ? args.query.trim() : null;
    }
    // —— OMP 内置工具：参数键以 18.0.10 源码 schema 为准，锚点失配走回退链 ——
    case 'grep': {
      const pattern = nonEmpty(args.pattern);
      return pattern === null ? null : clipChars(pattern, 120);
    }
    case 'glob': {
      // glob 的 pattern 本身就是 path 键的值（"src/**/*.ts"），折成末两段会丢语义。
      return nonEmpty(args.path);
    }
    case 'todo': {
      const op = nonEmpty(args.op);
      if (op === null) return null;
      const detail = nonEmpty(args.task)
        ?? (Array.isArray(args.items) ? nonEmpty(args.items[0]) : null);
      const phase = nonEmpty(args.phase);
      const bits = [op];
      if (phase !== null) bits.push(phase);
      if (detail !== null) bits.push(firstNonEmptyLine(detail));
      return bits.join(' · ');
    }
    case 'task': {
      const agent = nonEmpty(args.agent) ?? 'task';
      const brief = typeof args.task === 'string' ? firstNonEmptyLine(args.task) : '';
      return brief !== '' ? `${agent} · ${brief}` : agent;
    }
    case 'web_search':
    case 'WebSearch': {
      const query = typeof args.query === 'string' && args.query.trim() !== '' ? args.query.trim() : null;
      return query === null ? null : clipChars(query, 120);
    }
    case 'ask':
    case 'AskUserQuestion': {
      const questions = Array.isArray(args.questions) ? args.questions : [];
      const first = questions.find(item => item !== null && typeof item === 'object'
        && nonEmpty((/** @type {Record<string, unknown>} */ (item)).question)) ?? null;
      if (first === null) return null;
      return clipChars(nonEmpty((/** @type {Record<string, unknown>} */ (first)).question) ?? '', 120);
    }
    default:
      return null;
  }
}

/**
 * 未知工具的回退链：command→cmd→file_path→path→pattern→原文；file_path 与 path 同样折成末两段。
 * @param {unknown} args @param {string} inputText
 */
function fallbackSummary(args, inputText) {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    const record = /** @type {Record<string, unknown>} */ (args);
    for (const key of ['command', 'cmd', 'file_path', 'path', 'pattern']) {
      const value = record[key];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value === 'string') {
        return key === 'file_path' || key === 'path' ? baseName(value) : value;
      }
      const serialized = JSON.stringify(value);
      if (serialized !== undefined) return serialized;
    }
  }
  return inputText;
}

/** 第一个对象数组值：对象数组族的公共形状。 @param {Record<string, unknown>} args @returns {Record<string, unknown>[] | null} */
const arrayItemsOf = (args) => {
  for (const value of Object.values(args)) {
    if (Array.isArray(value) && value.length > 0
      && value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))) {
      return /** @type {Record<string, unknown>[]} */ (value);
    }
  }
  return null;
};

/**
 * MCP 族按 `mcp__` 前缀统一登记一家，不逐个工具名写 case，兄弟工具不漏。
 * 行内取前两个短字符串或数值字段做身份，长文本与数组留给浮层展开。
 * @param {Record<string, unknown>} args @returns {string | null}
 */
function mcpSummary(args) {
  const bits = [];
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value !== '' && value.length <= 60 && !value.includes('\n')) bits.push(value);
    else if (typeof value === 'number' || typeof value === 'boolean') bits.push(String(value));
    if (bits.length >= 2) break;
  }
  return bits.length > 0 ? bits.join(' · ') : null;
}

/**
 * 摘要拆成身份与参数段：中栏行用工具名加参数段，右栏工具往返的 chip 同样两段，
 * 悬停给完整参数。参数段不做字符数预截断：超长由列宽的省略号处理，工具名与
 * 路径末两段不受影响。
 * @param {string} name @param {string} inputText @returns {{label: string, args: string}}
 */
export function summaryParts(name, inputText) {
  const label = name !== '' ? name : t('未命名工具');
  let args = null;
  try { args = JSON.parse(inputText); } catch { /* 非 JSON 参数按原文展示 */ }
  const record = args !== null && typeof args === 'object' && !Array.isArray(args)
    ? /** @type {Record<string, unknown>} */ (args) : null;
  const dispatched = record !== null
    ? (name.startsWith('mcp__') ? mcpSummary(record) : dispatchSummary(name, record))
    : null;
  const raw = dispatched ?? fallbackSummary(args, inputText);
  return { label, args: String(raw ?? '') };
}

/** 工具行动作摘要 `工具名 · 参数段`；结果正文不当结论，原文进悬停与右栏。 @param {string} name @param {string} inputText @returns {string} */
export function toolSummary(name, inputText) {
  const parts = summaryParts(name, inputText);
  return `${parts.label} · ${parts.args}`;
}

/** 多目标参数键：文件类工具一次传多个路径时的候选键，按出现顺序取第一个。 */
const MULTI_TARGET_KEYS = ['files', 'paths', 'file_paths', 'path', 'file_path'];

/**
 * 中栏轨迹单行的目标清单：一次调用带多个文件时只显示第一个（末两段折算），
 * 其余由 `+N` 按需展开。只认字符串数组，至少两项；单项仍走 `summaryParts`
 * 的原有摘要。返回完整路径：行内显示与 `+N` 清单各自决定折算深度，浮层
 * 里给全名，不在数据源截断。
 * @param {string} inputText @returns {string[] | null}
 */
export function summaryTargets(inputText) {
  let args = null;
  try { args = JSON.parse(inputText); } catch { return null; }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return null;
  for (const key of MULTI_TARGET_KEYS) {
    const value = (/** @type {Record<string, unknown>} */ (args))[key];
    if (Array.isArray(value) && value.length > 1 && value.every(v => typeof v === 'string' && v !== '')) {
      return value.slice();
    }
  }
  return null;
}
