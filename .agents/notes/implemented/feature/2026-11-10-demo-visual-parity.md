# Agent Note: 前端样式以桌面定稿样张为准：IconPark 与冷灰色板

Status: implemented

## Problem

[桌面 UI 重构](../../proposed/feature/2026-11-09-desktop-ui-redesign.md)按「视觉沿用方向 A 的令牌、IconPark 只作视觉参考」落地，而基准样张 `.archify/tracery-desktop-demo-20261109.html` 在此之后又追加了一轮标注 `Visual pass — Beautiful UI aligned desktop shell (demo only)` 的覆盖：第二个 `:root` 把整套色板换成冷灰/蓝灰并改了字体栈，图标从 Lucide 换成 IconPark。样张是 Pis 多轮确认的最终展示方案，生产实现与它的差距不是零散缺陷，而是两套视觉基准并存。

实测 1440×900 下确认的差距：色板 `--page` `#F7F7F6` 对 `#FAFAFB`、`--text` `#171717` 对 `#1F2124`、字体无 Inter/JetBrains Mono；图标生产 Lucide 24 网格 `stroke-width:2.25` 对样张 IconPark 48/64 网格 `stroke-width:4`；选中会话生产是 44px 灰底平块，样张是 50px 白卡片带 1px 环与两层柔影；右栏前四个折叠生产各带独立圆角与阴影，样张合成一张卡、`border-top` 分节；用量卡头部 29px 普通字对 32px 9.5px 全大写；双圆环面板 162px 对 129px。

## Decision

以样张为唯一视觉基准，生产收敛到它。改动分三层，都不改读取路径、数据来源与信息架构：

1. **色板。** `web/app.css` 亮色 `:root` 与两个暗色块整体换成样张 Visual pass 的令牌值，含 `--hover-2`、`--shadow-hairline`、`--shadow-btn`、`--shadow-raised`、`--shadow-overlay`、`--accent-text`、`--cat-1..8` 蓝灰单色阶、`--t1..t4`；字体栈前置 Inter 与 JetBrains Mono。亮暗两态一起换，不写第三套。
2. **图标。** `web/icons.js` 换成 IconPark 几何（48 网格、`stroke-width:4`、currentColor）。生产 47 个语义名不改名，用一张语义映射对应到样张里同位置或同语义的 45 枚几何，调用点一行不动；`TINY` 两枚 8px 网格标记保持特例。四处图形来源一起换：`web/icons.js`、`web/app.css` 的 `--chev-right` data URI mask、`web/index.html` 的 8 枚首屏占位 SVG、`web/tracery-*.svg` 品牌标识。Agent logo 与蜘蛛插画按[前端设计规则](../../../../UIUX-DESIGN.md)的品牌色例外保留。许可署名进 `NOTICE`。
3. **组件。** 会话选中行改 50px 白卡片（`--shadow-card`、8px 圆角、选中标题 600），骨架同高；`railFactsHtml()` 把本次回复、请求结构、工具清单、技能清单四个折叠包进一层 `<section class="fold-card">`，证据折叠与用量卡留在卡外；`.fold-card>.rail-fold` 去掉自身圆角/阴影/外边距，用 `border-top` 分节；用量卡头部改 9.5px 全大写，四格与双圆环的字号、间距、面板阴影按样张收紧；顶栏与刷新图标尺寸从 20px 收到样张的 18px/15px。换色板后的连带项一并收敛：`--shadow` 取 `var(--shadow-card)`、暗色不另覆写 `--accent`（自定义 accent 仍由 `web/settings.js` 写入）、三栏表面改成中栏 `--surface` 两侧 `--page`、顶栏/右栏头与轮次带跟着换底；左栏 Agent 行、分段控件、轮次 chip、设置页签的选中态从蓝色 accent 换回样张的中性浮起卡片；补样张的三条 8px 滚动条规则与搜索框聚焦光环。这些都用生产自己的 `calc(px * var(--fs-scale))` 承接样张的 px 基数，不动三档字号机制，也不改 DOM 与读取路径。

`restoreFolds()` 按 `details[data-fold]` 查找、`.rail-fold .msg-list` 是后代选择器，并卡不触及这两条路径。新增 `tests/web.test.ts` 两条守门：四折叠共用一张卡且证据/用量在外；图标统一 48 网格与 4 描边、所有调用名（含 `rail-tabs.js` 的动态名）都能解析。

## Alternatives considered

**只修三个点，不动色板与图标。** 上一轮汇报把这个当省事选项，但样张是最终方案，留着两套色板与两套图标几何，局部组件对齐反而更显割裂。否决。

**继续 Lucide，只把图标尺寸调小。** 几何风格差异（细线圆角对饱满轮廓）是 Pis 点名的第一处差距，尺寸调整解决不了。否决。

**样张改用 Lucide，让文档与代码一致。** 等于推翻已经确认的展示方案去迁就实现。否决。

**两套图标混用（品牌/折叠换 IconPark，其余留 Lucide）。** 同一界面里两种描边重量与端点风格并存，比统一用一套更难看。否决。

**只搬样张的硬编码 px，不改生产字号表达式。** 样张组件规则全是固定 px，只在 `html` 用一次 `--fs-scale`；生产 187 处 `calc(px * var(--fs-scale))` 撑着三档字号设置。照抄 px 会悄悄废掉字号档；本批把样张值当基数乘回 scale，档位值不动。否决。

**继续把导航选中留在蓝色 accent。** 样张的后续覆盖把 Agent 行、分段、轮次 chip 与设置页签的选中态都改成中性浮起卡片，蓝只留给当前阅读路径。第一批只换色板不改这些选中态，会在冷灰底上留下一组旧语义。否决。

**把 demo 里所有没在生产出现的规则一次搬完。** 盘点列出约 275 个 demo 独有选择器，其中不少是样张舞台专用或整块 DOM 结构（`set-preview`、`.bd-*` 构成明细、`.req-list` 请求结构、`.block-list` 回复块索引），照搬要重写生成器与读取路径；本批只收敛与三个点名差距同层的表面、控件与选中语义，DOM 级差异留作后续单独议题。

## Consequences

`web/icons.js` 的几何与许可归属完全改变，[Lucide 图标迁移与启动点 chip 定稿](../feature/2026-11-08-lucide-icon-migration.md)里关于图标集的描述不再适用，该记录因还持有启动点 chip 的决策而保持活跃、互相链接；[桌面 UI 重构](../../proposed/feature/2026-11-09-desktop-ui-redesign.md)第 206、442 节的视觉立场由本记录取代。

`icon()` 的接口、语义名、`rolePill()` 与 `TINY` 特例不变，调用方零改动；代价是语义映射里若干名称做了近似对应（`empty-tray→download`、`role-aux→branch`、`role-event→pulse` 等），语义不如原几何贴切，但视觉与样张一致。样张还有 15 枚定义了却没调用的备用几何，生产没有对应语义名，未迁入。

改色板是全站级，方向 A 已验收的徽章、耗时变色与暗色可读性要重新走查；`UIUX-DESIGN.md` 记下基准与图标体系的唯一家，色值本身仍只归 `web/app.css`。合成数据下 1440×900 亮暗两态、1180×760 compact 两态均无横向溢出，四折叠卡 119px、会话选中 50px、用量卡头部 32px 与样张实测一致；双圆环面板 136px（样张 129px），余下 7px 是图例行高差，不隐藏任何指标。真实 Tauri 窗口内的排版仍未取到截图，与桌面 UI 重构记录里那项未完成验收一致。

样张与生产仍是两套 DOM：构成明细（`.bd-*`）、请求结构（`.req-list`）、回复块索引（`.block-list`）、设置预览卡（`.set-preview`）与 compact 开关（`data-compact` 对 `data-density`）没有合并，样张里 15 枚未调用备用几何也没迁入。这些不是样式值差异，本批没有触碰；要继续完整对齐需另立实现议题，逐处改生成器并补验收。

## Verification

- `bun run typecheck`、`bun test tests/web.test.ts`（69 pass）、`bun test tests/http.test.ts`（29 pass，静态资源白名单）。
- 合成页面 1440×900：色板令牌、48 网格/4 描边、四折叠并卡结构、会话选中白卡片、用量卡头部大写样式读计算样式核对。
- 第二轮补项在合成页 8791 复测：`--shadow` 解析成三层卡片影、三栏表面中栏白两侧灰、Agent 选中 `rgb(231,233,235)` 且无左竖条、分段选中白底带卡片影、轮次带白底且滚动条隐藏、`.fold-card` 内四个子折叠、右栏头与页签底色 `--page`、滚动条占位 8px；暗色令牌为 `#17181A/#232427/#F2F3F4`，`--accent` 不被暗色块覆写。
- 1180×760 compact：`data-density=compact`、`rail-body` 639/639（本轮 643/643），无横向溢出。
- 暗色切换会经过 120ms 背景过渡，中间帧读到的浅色不是稳态；等过渡结束再读计算样式。
- 合并部署后按[工作教训](../../LESSONS.md)重启服务并打开生产页面核一次静态资源；真实流量只读验收单独记录，不与合成验收混写。
