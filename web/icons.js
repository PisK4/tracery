// @ts-check
/**
 * 界面图标：Lucide 图标集的路径数据，bake 进本文件，不引运行时依赖。
 *
 * 来源 lucide-static@0.468.0（ISC），映射表见 .agents/notes/implemented/feature/2026-11-08-lucide-icon-migration.md。
 * 路径保留 Lucide 原生 24 网格；stroke-width 取 2.25，使 16px 渲染时的光学线宽
 * 与原先 16 网格 / 1.5 描边一致，size 语义与 .ico 选择器不变。
 *
 * SVG 一律 `aria-hidden`：可访问名由外层的 `aria-label` / 可见文字承担。
 * 图形只用 currentColor；TINY 两枚是 8px 网格特例，保持原样。
 */

/** @type {Record<string, string>} */
const BODY = {
  'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" />',
  'panel-right': '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" />',
  'sun': '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
  'moon': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />',
  'reason': '<circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />',
  'exec': '<path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" />',
  'failure': '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
  'gap': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />',
  'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />',
  'retry': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
  'read': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M12 18v-6" /><path d="m9 15 3 3 3-3" />',
  'close': '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
  'load-more': '<path d="M12 17V3" /><path d="m6 11 6 6 6-6" /><path d="M19 21H5" />',
  'caret-down': '<path d="m6 9 6 6 6-6" />',
  'caret-up': '<path d="m18 15-6-6-6 6" />',
  'jump-start': '<path d="m17 11-5-5-5 5" /><path d="m17 18-5-5-5 5" />',
  'jump-end': '<path d="m7 6 5 5 5-5" /><path d="m7 13 5 5 5-5" />',
  'back': '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />',
  'pair': '<path d="M17 12H3" /><path d="m11 18 6-6-6-6" /><path d="M21 5v14" />',
  'check': '<path d="M20 6 9 17l-5-5" />',
  'question': '<circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />',
  'role-user': '<circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" />',
  'role-assistant': '<path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />',
  'role-tool': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />',
  'role-system': '<rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />',
  'role-aux': '<line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />',
  'role-event': '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
  'stopwatch': '<line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" />',
  'ctx-gauge': '<path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" />',
  'ctx-pin': '<path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />',
  'ctx-cache': '<ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />',
  'empty-select': '<path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" /><path d="M5 3a2 2 0 0 0-2 2" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M5 21a2 2 0 0 1-2-2" /><path d="M9 3h1" /><path d="M9 21h2" /><path d="M14 3h1" /><path d="M3 9v1" /><path d="M21 9v2" /><path d="M3 14v1" />',
  'empty-tray': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />',
  'empty-page': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />',
  'empty-broken': '<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" /><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" /><line x1="8" x2="8" y1="2" y2="5" /><line x1="2" x2="5" y1="8" y2="8" /><line x1="16" x2="16" y1="19" y2="22" /><line x1="19" x2="22" y1="16" y2="16" />',
  'search': '<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />',
  'spawn-arrow': '<path d="M7 7h10v10" /><path d="M7 17 17 7" />',
};

/** 8px 网格的两枚特例：按 8px 实际渲染给线宽，不套 24px 的 2.25。 */
/** @type {Record<string, string>} */
const TINY = {
  'fail-solid': '<path d="M2 2l4 4M6 2L2 6" stroke-width="1.7"/>',
  'missing-body': '<circle cx="4" cy="4" r="2.5" stroke-width="1.4"/>',
};

/** @type {Record<string, string>} */
const VIEWBOX = {
  'fail-solid': '0 0 8 8', 'missing-body': '0 0 8 8',
};

/**
 * @param {string} name 图标名
 * @param {number} [size] 渲染边长：16 行内 / 20 控件 / 24 空状态
 * @param {string} [cls] 附加类名
 * @returns {string}
 */
export function icon(name, size = 16, cls = '') {
  const body = BODY[name] ?? TINY[name];
  if (body === undefined) throw new Error(`unknown_icon:${name}`);
  const viewBox = VIEWBOX[name] ?? '0 0 24 24';
  const stroke = name in TINY ? '' : ' stroke-width="2.25"';
  return `<svg class="ico${cls === '' ? '' : ` ${cls}`}" width="${size}" height="${size}" viewBox="${viewBox}"`
    + ` fill="none" stroke="currentColor"${stroke} stroke-linecap="round" stroke-linejoin="round"`
    + ` aria-hidden="true" focusable="false">${body}</svg>`;
}

/**
 * 角色 pill：可见部分只有图形，原名留给 `title`（原生悬停）与 `aria-label`（读屏）。
 * 不在这里附加任何解释性文案——悬浮只为不丢信息。
 * @param {string} name 原角色名（User / Assistant / Tool / System / Aux / Event）
 * @param {string} cls 角色色类
 * @returns {string}
 */
export function rolePill(name, cls) {
  /** @type {Record<string, string>} */
  const map = {
    User: 'role-user', Assistant: 'role-assistant', Tool: 'role-tool',
    System: 'role-system', Aux: 'role-aux', Event: 'role-event',
  };
  const art = map[name] ?? 'role-aux';
  return `<span class="row-label ico ${cls}" role="img" aria-label="${name}" title="${name}">${icon(art)}</span>`;
}
