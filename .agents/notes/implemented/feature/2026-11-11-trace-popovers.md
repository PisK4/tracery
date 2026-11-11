# Agent Note: 轨迹悬停浮层与请求级用量树图

Status: implemented

## Problem

扫读链路上有七类「完整信息在数据里、界面上看不到」的缺口：工具调用行的参数与结果正文只给单行摘要；组头只有 token 数与推理耗时，这一笔的耗时三段拆分、四段用量构成与费用没有展开位；左栏会话行只有标题与笔数，概况要看才知道；子代理短标行不承担完整身份；路径 chip 折成末两段后完整路径不可见；轮次带的输入摘要只有 32 字符。2026-11-11 交接文档（浮层方案）列出的 A/B/C/E/F/G 候选经评审后同批施工。

原生 `title` 属性承担不了这件事：不可聚焦、样式不可控、长参数塞进属性既难读也拖累 DOM。评审同时确认数据面已经齐了——`step.toolInput` 是全量无截断的参数原文，`step.text` 是全量结果正文，`RequestDetail` 带配对与用量读数，全部候选的数据都在页面内存，零后端改动。交接文档里「D1/D2 需新增具名读取」的说法过时：`read-contract.ts` 的具名操作已存在，本轮不新增读取。

## Decision

### 一、单例注册表现取现渲染，不内联 HTML

[R1 提案 note](../../../proposed/feature/2026-11-11-usage-popover.md) 原定「纯 CSS 内联浮层」；实现改为单例加注册表，与 [`more-pop`](../../../../web/app.js) 同构。理由：行内联一份浮层 HTML 的形态在长会话窗口（100+ 组头，每组 2 个 chip）下 DOM 与属性字节的增量不可接受；注册表在渲染时登记 `data-pop-key` → 内容闭包，悬停或聚焦时现拼 HTML，浮层 DOM 零增量，Tab 序零增量（锚点本来就是可聚焦元素）。交互型浮层（工具参数/结果）与纯展示浮层（组头读数、路径、轮次、会话项）共用同一外壳 [`step-popover.js`](../../../../web/step-popover.js)，后者没有形态切换与复制控件。

生命周期与 `more-pop` 同参：160ms 悬停延迟、200ms 隐藏、focusin/focusout 同源。注册表随 `resetReading`（换会话与显式刷新）整表重置；行 HTML 缓存命中时登记仍要补齐，所以 [`rowHtmls`](../../../../web/app.js) 把 `rememberPop` 移到缓存判断之前——登记是幂等的 `Map.set`，缓存命中路径不重渲染行也要保证注册表在 reset 后重新填上。

### 二、形状分派与 diff 护栏

工具参数浮层按参数形状分派：`old_string`+`new_string` 走逐行 diff；长 `code` 走代码块；`mcp__` 前缀走键值加长段；对象数组族走逐条清单；其余给键值/原文形态切换。结果浮层按工具名分派：Skill 族整份 Markdown 排版，MCP 族尝试结构化（失败退全文），其余全文。LCS diff 有两道护栏：行内摘要只在两侧各 ≤120 行时算增删计数（[`INLINE_DIFF_LINES`](../../../../web/tool-summary.js)），浮层逐行对照在任一侧 >300 行时降级为统计加两段原文（[`editDiff`](../../../../web/tool-summary.js) `guarded`）——超长输入不把 O(n×m) 塞进悬停。

工具摘要行内分派扩了三族：代码块族（`eval`/`execute_code`/`browser_exec`）、清单族（`TodoWrite`、`skill_manage`/`memory`）与 MCP 族（`mcp__` 前缀统一登记，取前两个短字段）。`summaryTargets` 改回完整路径：行内显示与 `+N` 清单各自决定折算深度，不在数据源截断。

### 三、组头耗时分段与用量树图

耗时分段沿用 [`usage-donuts.js`](../../../../web/usage-donuts.js) 的既有公式：缺 ttft 整笔落回复，有 ttft 才拆等待（首 token）、思考（推理段）与回复（其余），缺读数的段不出行不写 0。用量浮层 [`usage-popover.js`](../../../../web/usage-popover.js) 把四段固定类别（缓存读取、新输入、缓存写入、输出）按真实值降序铺 296×140 的 squarify 树图，颜色按份额排名取 `--t1..--t4`——与右栏 partShade 按份额阈值取档是两套判据；瓦片放不下（<72×72）只留色块，名称与数值由固定四行明细承担，明细行缺失写 `—`、零值淡显。`squarify` 从 [`context-map.js`](../../../../web/context-map.js) 导出共用，treemap 几何只有一份实现。

四个用量符号按 IconPark 48 网格与 4 描边登记进 [`icons.js`](../../../../web/icons.js)，形状互不相似。

### 四、锚点与登记位

- 中栏轨迹行：工具调用行与结果行的 `data-step-key` 兼任 `data-pop-key`；原生 `title` 不再塞参数与结果正文。
- 组头：推理耗时 chip 登记 `head:`，token chip 登记 `tok:`（`in_tok` 为 null 时不渲染，浮层锚随之消失）；口径说明保留在 title，浮层只回答这一笔的读数。
- 右栏工具往返 chip：`call:{owner}:{ord}`，与中栏调用行同一工厂。
- 轮次带 chip：`turn:`，浮层给完整 input_preview 与字数。
- 会话栏：每行登记 `sess:`，浮层给 Agent、请求、费用、最近活动、标志与 conv_key。
- 路径 chip 与子代理短标沿用各自既有键位。
- 会话概况浮层（B3）与原生 title 删除是替代关系；`more-pop` 的 mp-item 重复 title 一并移除。

## Alternatives considered

- **行内联 CSS 浮层（R1 提案原方案）**：每个锚点自带一份浮层 HTML。被否决：长会话窗口（100+ 组头，每组 2 个 chip）下 DOM 与属性字节增量不可接受；单例加注册表达到同样的悬停即读，DOM 与 Tab 序零增量。
- **B2（工具参数历史谱系）**：唯一需要扩读模型 DTO 的候选，Pis 拍板砍。
- **F6（浮层内跳转）**：浮层是展示位，导航动作留在页面本体。
- **C2–C4**：评审中撤回，未施工。
- **继续用原生 title**：不可聚焦、样式不可控、长参数塞进属性难读也拖累 DOM，只保留给口径说明一句话的位置。

## Consequences

一个全局单例浮层（`.step-pop`）常驻 DOM（隐藏态），注册表内存与窗口工具行数量成正比。浮层打开时的 diff 计算（≤300 行）与 squarify 布局是纯前端即时开销，不碰读取架构、不发请求、不改 schema、不升算法号。`rowHtmls` 的登记先于行缓存判断成为不变式：后续往行上挂新浮层时同样要走 `rememberPop` 幂等登记，不能挂在缓存构建路径里。

## 取代检查

- [R1 提案 note](../../../proposed/feature/2026-11-11-usage-popover.md) 的机制从「纯 CSS 内联浮层」改为单例注册表，该 note 保持 proposed，由本 note 记录机制分歧；其余内容（树图几何、四段类别、命中大字）照搬落地。
- 原生 `title` 承担完整信息的位置（中栏 preview、右栏 chip、轮次 chip、路径 chip、mp-item）全部移除，`tool-summary.js` 的 `TITLE_MAX` 属性护栏保留给仍有 title 的位置。
