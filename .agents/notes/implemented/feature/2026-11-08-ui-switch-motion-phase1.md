# Agent Note: 切会话不再铺满屏读取文案（Tracery）

Status: implemented

## Problem

[页面交互动效层](2026-11-04-web-interaction-motion.md)与[会话切换的保留画面](2026-11-04-session-switch-hold-and-enter.md)交付后，用户仍把切换手感形容为傻快：点左侧会话后中栏硬切，切换瞬间整列 trace 显示正在刷新。

帧级复核确认症结在切换时画了什么，不在动画数量。`selectSession` 每次清空请求级缓存，窗口页只返回不含正文的 `RequestRow`，中栏于是对窗口内每一笔尚未备齐的请求画一条 `req_id:preparing` 占位行，文案「正在读取请求…」并整行呼吸。30 笔窗口就是 30 行同时闪的文字，随后按 32 笔一批逐组换成真实内容。慢网超过 300ms 保留上限时，`renderMain` 再把中栏整块换成一行全亮的「正在读取 xxx 的请求…」，等读取完成后又整块换成列表，出现两次硬跳变。点会话的 `open-session` 意图不带渲染 effect，左栏选中高亮要等窗口页到达才更新，点击瞬间没有任何回应。

同轮审查还查出两条既有缺陷：`web/app.css:939` 的 `.filters` 选择器自 `f68ab33` 把 Agent chips 换成栏内分组列表后就没有匹配元素，`chip-pop` 从未播放；`context-detail.js` 关闭弹窗只设 `hidden`，而 vendor 的 `onfinish` 把离场末帧固化成 inline `opacity:0`，二次打开时弹窗恒不可见。

## Decision

只改 `web/` 与最窄的守门测试，不碰读取契约、reader-store 与后端。

- 准备中的组改成静态骨架条：`preparingStep` 的 `text` 留空，CSS 让文本槽自己撑成一条有宽度的灰条，占位行不再逐行呼吸。超时占位从全屏 pulse 文字改成 8 行 `main-skeleton` 骨架条。
- 点击会话当场改写左栏各行的 `aria-current`，窗口页到达前高亮已落到目标行，中栏仍按保留态显示旧画面。
- 抽出 `startSwapIn()`：显式刷新、回到开头/最新、切窗、URL 无会话的后退都复用 `entering` 状态淡回，不设 `inert`／`aria-busy`，定时器负责清状态。
- 换场压暗与淡回同时覆盖 `.session-head` 与 `.step-list`；扫描线改挂在粘性头部下沿的伪元素，不再被不透明头部盖住。
- 右栏同键换视图（工具四页、工具返回、本次回复、条目列表返回、结构返回）用一次性 `railViewNudge` 标记播一次轻淡入。逐条点选 `select-step`／`select-message` 不置位，避免拖慢最高频操作。
- `.filters` 死选择器换成 `.agent-row.chip-fresh`；`openDetail` 重开时清掉 `container.style.opacity`。

`tests/web.test.ts` 新增三条源码级守门：占位行不带读取文案与呼吸、骨架样式与换场头部覆盖、分段控件选择器匹配真实类名、弹窗重开清 inline opacity。

## Alternatives considered

- **预取首屏正文或缓存会话快照。** 能让首帧就有真实内容，但要改 `read-contract.ts` 的 `requests` 输出、后端查询或 reader-store 的缓存生命周期。11-04 的切换 note 已否决过快照缓存，本次保持否决，另立提案。
- **给每个瞬切入口单独加调用点动效。** 20 多处点击分支各写一次 `motion()`，改动散且容易漏；用一次 `railViewNudge` 集中在 `dispatch` 与返回分支判定。
- **改 `railKey` 把视图状态纳入键。** 会连带改变滚动保持与相位判定，风险大于收益。
- **修复审查列出的其余动效缺陷。** theme-switching 两帧抑制结束后全局动画重播、vendor 的 `fill:"both"` 固化 inline 样式、无限动画在整块 `innerHTML` 重绘时相位集体重置、瞬态类长期不清除、reduced-motion 下 300ms 等待未跳过，都需要动 `motion.vendor.js` 或重绘架构。本批只修会直接造成功能错误的两条（弹窗不可见、死选择器），其余记入待办。

## Consequences

- 代价：占位行从此不说明自己在读取什么，靠灰条形状与位置表达；`group-fill` 仍逐组淡回，逐组落定的节奏保留。档 1 只压住满屏刷新观感，没有消除重读。
- `startSwapIn` 与 `endSwitchHold(true)` 共用 `switchEnterTimer` 与 `entering` 状态，两条路径互斥；清理定时器在浏览器复验中确认不留 `data-switch-state`、不留 `inert`。
- 合成页（8771 端口，同一份生产 web）在 CDP 注入 450ms 延迟下逐帧核对：单次切换经历 `switching → 静默骨架 → entering`，全程 `#main .pulse` 为 0；占位灰条计算宽度 315–494px；点击同 tick 左栏高亮已指向新会话而中栏仍是旧标题；显式刷新后状态与 `inert` 均清空；明细弹窗关闭后 inline `opacity:0`、二次打开计算样式回到 1；reduced-motion 下切换无残留、无 pulse。右栏工具四页未在当前合成会话渲染，同键淡入只做代码级核对，未做浏览器验收。
- 验证：`bun run typecheck` 通过；`tests/web.test.ts`、`tests/http.test.ts`、`tests/trace-model.test.ts`、`tests/context-detail.test.ts`、`tests/trace-commit.test.ts`、`tests/context-map.test.ts` 共 126 pass。合成数据与生产流量验收分开，本轮没有部署生产。
