# Agent Note: 会话栏 Agent 分组列表（方案 B）

Status: implemented

## Problem

会话栏已有按 Agent 筛选的 chips 分段控件（`#agent-filters`），与 Wake 的 Agent 列表样式接近但可读性差：chips 横向滚动不适合 Agent 数量增长，计数隐藏在 title 里，活跃会话点看不到。桌面 APP 将以列表式导航为主心智，Wake 的「资料库侧栏 + 会话流 + 阅读区」三栏是参考，但 Tracery 已有三栏（会话栏 / 主栏 / 详情栏）且主栏承载请求序列，直接加第 4 栏会挤压主栏。

需要在不改变三栏骨架的前提下，把 Agent 筛选从分段 chips 改为栏内的分组列表：上段 Agent 树、下段会话流；选中仍是过滤，不新增导航层。

## Decision

左栏 250px 内分两段：上段为 Agent 分组列表（`#agent-head` + `#agent-list`），下段为会话流。旧 chips 分段控件（`.filters`）整段删除，过滤入口只保留一处。

- Agent 行：`agent-row`，32px 高，品牌 logo 16px icon + 常显名字 + 右对齐 mono 计数，选中蓝底 + 左 3px 竖条（Wake 同款），hover 120ms 抬底
- 分组头：chevron 旋转折叠（160ms），列表用 max-height + opacity 同步收拢，不跳动
- 全部 Agent 行：树顶一行「全部 Agent」带已加载总数，点即清空过滤（替代旧 chips 的 all 段）
- 计数口径：仍是已加载窗口的相对计数（保留 `count >= 50` 阈值与 `slice(0, 7)`），界面维持「已加载」标注，不伪造全量精确数
- 活跃标记：Agent 行尾绿点脉冲（2s），数据源为 `items` 中 `inflight` 或 `live_until` 未过期的会话；会话行内的时间格「请求中」保留不变
- 主栏切换会话：保持既有 `session-swap-in` 180ms 淡入 + 4px 上滑，不新做位移动画
- 降级：`prefers-reduced-motion` 下关闭折叠与脉冲动画；折叠用 `max-height:0` + `visibility`，键盘与读屏保持可达

改动落点：`web/index.html`（swaps `#agent-filters` 为 `#agent-scope`）、`web/app.css`（新增 `.agent-scope/.group-head/.agent-list/.agent-row`，删 `.filters`）、`web/app.js`（`renderFilters` 改渲染树）、`web/layout.js`（折叠绑定）、`web/i18n-en.js`（新增 `有活跃会话`）。

后续打磨（2026-11-07 第二轮，反馈截图）：组头右侧计数已删除；Agent 行首已改用 `agentLogoHtml(id)` 品牌 logo（16px，与会话行同款），不再用首字母圆角块和 `✦` 字母锁；`全部 Agent` 行仍保留 `✦` 图标，因为它是“清空过滤”的动作入口，不对应具体一家 Agent。

## Alternatives considered

- **方案 A：独立资料库侧栏（Wake 原样 224 + 336）**：Wake 的「资料库侧栏 + 会话流 + 阅读区」是三栏结构里的 scope 选择，不是两进式推进。Tracery 已有主栏请求序列和 280–640px 详情栏，1180×760 下阅读区只剩 620px，塞不下主栏 + 详情栏；加第 4 栏需连窗口层（交通灯、拖拽区、标题栏）一起重做。否决，留给桌面化整窗重设计时再议。

- **方案 C：维持 chips 微调**：成本最小，但 chips 横向滚动在 Agent 增长时仍会隐藏信息，计数不可见。用户已明确选 B 且确认删除上排 chips。否决。

- **日期分组（今天 / 本周 / 更早）**：本次只做 Agent 树，会话流仍保持现有的活跃 / 全部会话分区。日期分组作为栏内小福利顺手做需改 `renderSessions` 分区逻辑，属另一轴决策，留作后续。

- **后端精确聚合**：精确计数需后端按 Agent 聚合（`listSessions` 现在只取 paged 候选），属后端小步。本次先保留已加载相对口径并标注，等独立批次再做。

## Consequences

- Agent 筛选入口从横向 chips 变为纵向列表，视觉扫描路径改短；但阈值 `>=50` 仍会隐藏长尾 Agent，用户看不到低量 Agent 这一事实未变（已接受）。
- 多 Agent 行的归属仍是成员过滤（`agents[]` 包含关系），未改为「进入某个 Agent」的分区导航，避免归属争议。
- 全局搜索仍只覆盖已加载窗口，未随此次改动扩展为 ⌘K 跨作用域搜索；桌面化的全局搜索单独排后续。
