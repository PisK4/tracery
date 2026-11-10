# Agent Note: Lucide 图标迁移与启动点 chip 定稿

Status: implemented

本文的图标集决策已由[前端样式以桌面定稿样张为准：IconPark 与冷灰色板](2026-11-10-demo-visual-parity.md)取代：功能图标改用 IconPark 48 网格、`stroke-width:4`，`NOTICE` 的许可署名随之改变。本文持有的启动点 chip 与反向入口决策仍然有效，故保持活跃。

## Problem

两件事叠在同一批前端改动里。

一是界面图标一直自绘：`web/icons.js` 有 39 枚 16 网格描边图标，`web/app.css` 的 `--chev-right` 与 `web/index.html` 的 7 枚首屏占位各有一份手绘副本。加一枚方向图标要再画一段路径，几何约束（≤4 段、净空 ≥2 网格、线宽 1.5）全靠人盯。

二是[工具调用启动点](2026-11-08-tool-call-spawn-link.md)交付时页面给的是行尾一枚 `→ S1` 小 pill。它与多目标计数 `+N` 同形同色，整行 hover 就亮 accent，键盘到不了；从主链跳进 S 视图之后没有回到启动点的入口。交接文档把这些列为待决设计问题。

用户看过四种形态样张后选定：工具名 chip 本身可跳、带 ↗ 箭头、S 视图头部给反向入口。同时要求把自绘图标换成外部库，候选先示范再定。

## Decision

图标用 Lucide，路径数据 bake 进仓库，不引运行时依赖。取 `lucide-static@0.468.0`（ISC）的 SVG 内部路径，39 枚 BODY 按语义映射到 Lucide 图标名，两枚 8px 网格特例 `TINY` 保留。`icon(name, size, cls)` 的导出、`class="ico"`、`aria-hidden`、`currentColor` 与所有 size 取值不变；默认 viewBox 从 `0 0 16 16` 改 `0 0 24 24`，线宽取 2.25，使 16px 渲染时的光学线宽与原先 16 网格 / 1.5 一致。`--chev-right` mask 换成 Lucide `chevron-right`，`index.html` 的 7 枚首屏占位换成对应 Lucide 路径。Agent logo 与空状态蜘蛛是品牌标识与插画，按 [UIUX-DESIGN.md](../../../../UIUX-DESIGN.md) 的品牌色例外保留。

启动点标记从行尾 pill 移到工具名 chip 内部。`toolRowParts` 接收 `agentNo`，只有该值非空时才把 chip 变成 `role="link"` 的可跳入口并挂 ↗；没有启动回执的 `Agent` 保持纯展示 chip。这样 ↗ 同时承担「点这里去别处」与「这条有启动点」两件事，交接文档列的「与 `+N` 同形无区分度」由它补上，也不会让无证据的行假装能跳。hover 与 focus-visible 只落在 chip 自身，不整行亮，避免与行选择的语义撞车；键盘由 `document` 上已有的 keydown 监听代理 Enter 与空格，不新增监听器。

反向入口放在会话头 `session-note` 位置，`state.spawnFrom` 记来源调用行的 `req_id`。点返回把视图切回主链并 `locateRequest` 到该行；状态属会话内阅读状态，换会话与手动切视图时清除，沿用[三视图 note](2026-11-08-subagent-actor-views.md) 的口径，不写 URL。

## Alternatives considered

**运行时从 CDN 或 npm 包加载图标。** 项目 `AGENTS.md` 写明不引第三方依赖，页面是本机 `127.0.0.1`、静态资源按请求读盘，离线也要能开。取路径 bake 进 `icons.js` 只增约 5KB 文本，接口与 `STATIC_FILES` 白名单都不用动。

**用 Phosphor 或其它库。** 拉过五家的真实资源与许可证：Lucide（ISC，24 网格描边）、Phosphor（MIT，256 网格填充，9072 个 SVG）、Radix / Heroicons / Tabler（均 MIT）。Phosphor 是圆润实心，放进线性描边的行里是两套语言；Lucide 的线性描边离现有体系最近。

**全量替换时把路径缩放到 16 网格。** 要改每一段坐标，映射表难以复核；保留 24 viewBox、只调线宽，坐标原样可逐个与 npm tarball 对账。

**保留行尾 `→ S1`，只补反向入口。** 用户明确选了工具名 chip 可跳的形态；行尾 pill 与 `+N` 同形的问题留着没解决。

**把反向入口放右栏读卡。** 要选中子代理首笔才看得到，会话头这条常驻、不随选中变化，更早被看到。

**窗口外一键切窗。** 「S 编号 → 首笔 req_id」在窗口外没有读侧接口，做它要扩读契约，越过本任务边界；保留 toast 提示，另立议题。

## Consequences

`web/icons.js` 的几何约束注释失效，改成记录来源与线宽换算；后续加图标去 Lucide 取路径、按语义登记映射，不再手画。若将来升级 Lucide 版本，映射名可能随上游改名，需按 tarball 逐个复核。

`state.spawnFrom` 是新的会话内阅读状态，只在从 chip 跳进 S 视图时有值；从会话头视图切换控件进入 S 视图不会出现返回入口，这是有意的——那条路径没有「来源启动点」。

覆盖缺口仍是数据侧的边界：孙代理、结果 `pending: derive_not_current`、正文已回收的调用没有 `agent_no`，chip 保持纯展示，页面不装作有启动点。其余 harness 没有启动回执，一律无标记。

## Testing

合成：`bun run typecheck` 干净；全量 `bun test` 1450 项通过（13476 断言）。`tests/trace-view.test.ts` 的启动点钉子改为断言 `row-tint is-spawn`、`data-agent-no`、读屏文案与 `row-tint-arrow`，并断言无回执时不出现 `is-spawn`。

浏览器（`bun run demo` 合成页，Chrome DevTools Protocol 驱动）：静态资源 `icons.js` / `app.js` / `app.css` / `trace-view.js` / `index.html` 全 200，三栏 39 行完整渲染，无模块图 404。注入带 `agent_no` 的 chip 后点击，落到「子代理 S1 不在当前窗口；先切窗再试」toast，说明委托与编号传递走通。可点元素三件套逐项读计算样式：`cursor:pointer`、hover 有 CSS 反馈、键盘 modality 下 `:focus-visible` 为真且 `outline: solid 2px` 取 accent 色。

未做生产真实流量验收：本机生产库 11GiB，隔离实例需完整 `.backup` 复制；本批是纯前端改动，合成页已覆盖渲染与交互，生产 8320 未重启。带启动回执的真实样本（`d0b52d1f` 的 `?trace=194442` → S1 首笔 194451）留待部署后人工过目。
