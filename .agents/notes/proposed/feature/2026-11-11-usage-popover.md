# Agent Note: 中栏组头用量浮层

Status: proposed

## Problem

[请求级 Trace 模块](2026-11-10-request-level-trace-modules.md)把中栏的识别单位定成一张模块卡，组头是一行请求级身份：窗口序号、`req_kind`、推理时间与提示 token。组头上的 `in_tok` 只有一个缩短后的数字，`title` 补一句口径说明。读者看到 7,940 in，想知道这一笔的输入、输出与缓存各占多少，只能切到右栏折叠区或会话头汇总，视线要离开当前模块。

`RequestRow` 已经带着 `in_tok`、`out_tok`、`cache_read`、`cache_write`、`cost` 与 `cost_state`，页面内存里 `currentRows()` 就有这些数据。[右栏事实卡](../../../../web/rail-facts.js)的 `cacheHitOf` 和 [GLOSSARY.md](../../../../GLOSSARY.md) 定过请求级命中率 `cache_read ÷ (in_tok + cache_read)`。缺的是把这些读数在读者正看向的那一笔请求旁展开一次，不需要新增查询。

2026-11-11 的六轮样张评审把形态定下来。Pis 最初要一个点开 `token in` 的饼图，随后改成悬停即出现、移开即消失的浮层，并选中四段全量圆环加外置引线标签。手写引线连出三版问题：线穿过圆心、折线互相交叉、扇段起点按 12 点算而 SVG `stroke-dasharray` 实际从 3 点起，整体偏转 90°。换 ECharts 的 `labelLine` 后指向对了，320px 浮层里四个外置标签仍会挤在一起，小段标签被裁切，为一张小卡引入约 1 MB Canvas 依赖也不划算。Pis 第四轮否决圆环，指定改成矩阵树状图。样张 `.archify/usage-popover-demo-20261111.html` 已按 treemap 定稿并通过视觉验收。随后两轮追加：四类要配固定符号，一眼能分辨；命中率公式与状态说明这类注释文字移出浮层；类别名保留，符号配在名字旁边。

样张是合成数据，只定交互与视觉形态，不定生产事实。浮层里的三档示例（常规 62%、高命中 98%、缺读数 —）不是真实请求读数，不进 fixture、日志或提交。

## Proposal

分五处落地，全部在 `web/` 与文档，不改 schema、不改摄入、不改派生、不升算法号、不新增 HTTP 接口、不逐会话 rebuild。

### 一、触发点

[`moduleHeadHtml`](../../../../web/session-view.js) 把组头的 `in_tok` chip 包进一个可悬停、可聚焦的容器，浮层作为同容器的子节点绝对定位。`in_tok` 为 null 时不渲染 chip 与浮层，沿用现行缺省隐藏。组头仍是请求级身份行：点击不产生选择，不改变 `currentSelectedStep`，不挂步骤键。

显示与隐藏走纯 CSS 的 `:hover` 与 `:focus-within`，容器和浮层之间留一段透明的 `::before` 桥接区，鼠标从 chip 移进浮层时不会中断 hover。`app.js` 不改，文档级点击委托不动。[会话头两栏](../../implemented/feature/2026-11-01-session-header-two-column.md) 已用 `data-desc` 加 CSS 浮层做过同一件事，键盘 Tab 聚焦同样能打开说明；这里沿用同一套可达性理由。

### 二、浮层内容

浮层固定 320px 宽，自上而下只有六块：标题（用量 / 请求级）、大字命中率、四段 treemap、四行明细、合计 token、费用。

- **命中率**取请求级 `cacheHitOf(r)`，大字旁只配一个缓存命中标签。公式 `cache_read ÷ (in_tok + cache_read)` 归 [GLOSSARY.md](../../../../GLOSSARY.md) 与右栏，不在浮层重复；缺读数写 —，合法 0 照常显示。会话头合计行的 Σ 口径不进浮层。
- **四段固定类别**按 `cache_read`、`in_tok`、`cache_write`、`out_tok` 的真实值降序排，用 squarify 铺满 296×140 的绘图区，颜色按份额排名取 `--t1..--t4`。颜色只表示当笔份额，会随数据变。`in_tok` 已排除缓存读与写，浮层不把它加回总量；`cache_write` 不进命中率分母。
- **四个固定符号**按 IconPark 同一套 48 网格、stroke 4、currentColor 登记进 [`icons.js`](../../../../web/icons.js)：圆点环 = 缓存读取、横箭头 = 新输入、托盘加下箭头 = 缓存写入、带尾气泡 = 输出。符号与类别的绑定不变，形状互不相似，14px 下可分辨。类别名照常写在符号旁边，符号用于快速定位，不替掉文字。
- **瓦片**放得下 72×72 时写符号、类别名、数值与占比。2% 上下的小段会压成细条，只留色块，名称与数值由下方四行明细承担；瓦片仍带类别标识与 `title` / `aria-label`。这与[上下文矩阵布局](../../implemented/feature/2026-10-26-context-treemap-drilldown.md)对窄块的处理一致：靠列表补位，不硬撑文字把布局撑破。
- **明细恒为四行**，按固定类别顺序排，每行是符号 + 类别名 + 数值 + 占比。缺读数写 —，不补 0，不按总量倒推；`cache_write = 0` 是有效读数，明细写 0、符号淡显、不占面积。费用只在 `cost_state` 为 priced 或 zero 时显示，其余写 —。

### 三、模块边界

新增 `web/usage-popover.js`，只做一件事：接收 `RequestRow`，拼出浮层 HTML 字符串。它复用 `web/context-map.js` 的 squarify 与 `web/parts.js` 的 token 缩写，调 [`icons.js`](../../../../web/icons.js) 出符号，不读写 DOM、不发起读取、不缓存状态。squarify 若目前是 `context-map.js` 的模块内函数，就把它提成两处共用的纯函数，保持依赖单向：`parts` 是叶子，`usage-popover` 依赖 `context-map`，`session-view` 依赖 `usage-popover`。

数据全部来自 `currentRows()` 已有的 `RequestRow`，不新增具名读取、不扩 HTTP 路由、不改 [`read-contract.ts`](../../../../src/read-contract.ts)。按[读取功能接入规则](../../../../docs/read-feature-rules.md)，这属于复用现有读模型，不触发批量与调度那一层的改动。页面正文与路由内容继续转义；符号由 HTML 字符串生成，类别名与数值走 `esc()`，不把读数直接插进 `innerHTML`。

### 四、样式、文案与静态资源

[`app.css`](../../../../web/app.css) 落浮层、瓦片与徽章样式，色值走现有 `:root` 与两个暗色块，深浅色不另做主题。[`i18n.js`](../../../../web/i18n.js) 与 [`i18n-en.js`](../../../../web/i18n-en.js) 补四段类别名、命中率标签、合计与费用文案。新增 web 模块登记 [`STATIC_FILES`](../../../../src/http.ts)；漏登会让 `tests/http.test.ts` 的目录覆盖测试失败，这是[工作教训](../../LESSONS.md)里记过的坑。

[UIUX-DESIGN.md](../../../../UIUX-DESIGN.md) 补组头浮层规则：hover 与 focus-visible 都触发、浮层默认不显示、正常态不写装饰性说明、异常才出现标签。[GLOSSARY.md](../../../../GLOSSARY.md) 已有的命中率条目保持为口径的唯一家，浮层不另写一份。[架构设计](../../../../docs/architecture-design.md)与[验收记录](../../../../docs/acceptance.md)分别记前端模块边界与合成 / 真实流量两类验收结果。

### 五、验收

`tests/web.test.ts` 补一组最小行为断言：四块面积守恒且互不重叠、每段面积占比与读数一致、瓦片符号与明细符号按同一类别映射、缺读数不补 0、`in_tok` 为 null 时不出浮层、类别名与数值转义。squarify 的几何断言复用 `tests/context-map.test.ts` 已有的判据，不另写一套。[前端降噪约束](../../implemented/process/2026-10-24-frontend-denoise-standing-rule.md)继续适用：浮层里不写公式、不写状态说明、不写二级标签。

## 取代检查

活动树里搜到的相关记录逐篇判定，全部是引用或延伸，没有整篇归档的。

- [请求级 Trace 模块与会话时间线视图](2026-11-10-request-level-trace-modules.md)（proposed）与[请求级 Trace 模块](../../implemented/feature/2026-11-10-request-level-trace-modules.md)（implemented）持有组头身份行、组头字段来自 `RequestRow`、不新增读取的决定。本轮给组头 chip 加一个只读出口，组头仍不产生选择、不按步骤键寻址。延伸，保持活跃。
- [读数页上下文分布 treemap](../../implemented/feature/2026-10-26-context-distribution-treemap.md)与[上下文矩阵布局与点击明细](../../implemented/feature/2026-10-26-context-treemap-drilldown.md)持有 squarify、面积按真实值铺满、窄块靠列表补位、tile 用绝对定位 HTML 的决定。本轮复用同一套视觉语言，把类别从 prompt.parts 换成四个固定 token 读数，不碰目录查询、点击明细弹窗与右栏七类颜色身份。延伸，保持活跃。
- [方向 A 第 6 步：树图单色化](../../implemented/feature/2026-11-02-direction-a-step6-treemap-monochrome.md)持有 `--t1..--t4` 四档单色与份额阈值 `partShade`。本轮按份额排名取档，是四种固定类别下的另一套取档方式，不改 `partShade` 本身、不回退类别色。延伸，保持活跃；两处取档判据不同这件事要在 `usage-popover.js` 里写一行说明，免得后来者合并成一套。
- [会话头两栏](../../implemented/feature/2026-11-01-session-header-two-column.md)持有 `data-desc` 加 CSS 浮层、悬停与聚焦同一来源、原生 title 不满足键盘可达的决定。本轮沿用，不复用 `more-pop` 的 JS 单例弹层。延伸，保持活跃。
- [中栏只呈现内容，详情集中右栏](../../implemented/simplification/2026-10-24-trace-content-only-and-wide-rail.md)定中栏与右栏的职责。浮层挂在组头这一行，落在组身份行上，不回到每行右侧附加信息。保持活跃。
- [前端降噪原则进入常备指令](../../implemented/process/2026-10-24-frontend-denoise-standing-rule.md)的现行规则在 [UIUX-DESIGN.md](../../../../UIUX-DESIGN.md)。本轮按它删掉公式与状态说明。保持活跃。
- [会话版式与行层级](../../implemented/feature/2026-11-04-session-layout-and-row-hierarchy.md)记过触屏无 hover、连续 Tab 未逐键验证的缺口。本轮同样要面对，写进下方 Risks。保持活跃。

proposed 阶段只出链。本记录转 implemented 时，在延伸的旧记录里补回链；提案未定之前给已交付决策加指向未定决策的链接，只会降低活跃树的信噪比。

## Alternatives considered

**四段圆环加外置引线标签。** 落选。手写三版引线分别横穿圆心、折线互相交叉、因 SVG `stroke-dasharray` 起点与计算起点差 90° 而指错扇段。扇段与引线分成两套角度计算，改一处就错一处。ECharts 的 `labelLine` 让库内部统一布局，指向对了，但 320px 浮层里四个外置标签挤在一起，小段标签被裁切，还要为一张 320px 小卡引入约 1 MB Canvas 依赖。

**四类各给一个固定色，颜色认类别。** 落选。右栏用量树图已在[方向 A 第 6 步](../../implemented/feature/2026-11-02-direction-a-step6-treemap-monochrome.md)退役类别色，改成单色四档表示份额。浮层再引入四色会与右栏同一屏撞两套语言，也会把类别身份和份额大小绑在一起。

**只给颜色加符号，去掉类别名。** 落选。Pis 明确要求类别名保留。符号用于一眼定位，文字承担准确名称与读屏名称；去掉文字后，14px 符号在缺读数态淡显时无法自证是哪个类别。

**浮层里保留命中率公式与缺读数状态说明。** 落选。公式已在 [GLOSSARY.md](../../../../GLOSSARY.md) 与右栏写过，状态说明在缺读数时与大字 — 重复。浮层只回答这一笔的读数，口径解释归常备文档。

**用 `more-pop` 的 JS 单例弹层。** 落选。`more-pop` 是点击触发、带定位与 Esc / focusout 生命周期的文本清单，见 [`app.js`](../../../../web/app.js)。本浮层是纯展示、无交互控件、移开即消失，用 CSS 的 `:hover` 加 `:focus-within` 就够，挂进单例会引入状态与关闭路径，也和[会话头两栏](../../implemented/feature/2026-11-01-session-header-two-column.md)已用的浮层不一致。

**新增具名读取或 HTTP 接口取用量明细。** 落选。`RequestRow` 已带五个读数与 `cost_state`，`currentRows()` 在页面内存里就有。按[读取功能接入规则](../../../../docs/read-feature-rules.md)复用读模型，新增接口只会把一次纯展示改动变成读取链路改动。

**做成一个常驻的用量页签或右栏面板。** 落选。Pis 要的是悬停即看、移开即收，视线不离开当前模块。常驻面板会与右栏五个页签和会话头汇总重复，也让中栏组头承担更多行高。

## Acceptance criteria

- 组头 `in_tok` chip 悬停出现浮层，鼠标移进浮层不闪退，移开收起；键盘 Tab 聚焦同样出现，`in_tok` 为 null 时组头不渲染 chip 与浮层。点击 chip 不改变 `currentSelectedStep`，右栏不重绘。
- 浮层固定 320px，只含标题、大字命中率、四段 treemap、四行明细、合计、费用六块；不出现命中率公式、缺读数状态说明或二级说明标签。
- 四段面积之和等于 `in_tok + cache_read + cache_write + out_tok` 的正值合计，每段面积占比与读数一致，矩形不重叠、都在绘图区内；颜色按份额排名取 `--t1..--t4`，瓦片与明细徽章的取档一致。
- 四个固定符号与类别一一绑定，瓦片和四行明细都用同一符号；四行明细按固定类别顺序排，每行都有类别名、数值与占比。缺读数写 — 且不补 0，`cache_write = 0` 明细写 0、符号淡显、不占面积。
- 命中率按请求级 `cacheHitOf(r)` 计算，与右栏事实卡一致；缺读数写 —，合法 0 照常显示。费用只在 `cost_state` 为 priced 或 zero 时显示。
- 类别名与数值经 `esc()` 转义；正文与路由内容不直接插 HTML。新增 web 模块登记 `STATIC_FILES`，`tests/http.test.ts` 的目录覆盖通过。
- 中英两份 i18n 文案齐全；浅色与深色、1440 与 1180 宽下浮层不裁切、无横向溢出；400px 窄屏单独记，headless Chrome 会把 CSS 视口夹到 500px，不能拿它当手机验收。
- `tests/web.test.ts` 与 `tests/context-map.test.ts` 最窄用例通过，`bun run typecheck` 通过；合成浏览器验收与真实流量只读验收分开写进[验收记录](../../../../docs/acceptance.md)。本记录转 implemented 时，给延伸的旧记录补回链。

## Risks

- **触屏没有 hover。** 组头 chip 现在不是可点元素，触屏只能靠键盘 focus，实际手机浏览器上可能完全打不开浮层。落地时要么给 chip 一个不产生选择、只切换浮层的点击路径，要么明确记录触屏不可用；两种都要在真机或固定视口浏览器上验，headless Chrome 的 500px 下限不够。
- **浮层贴在组头右侧，靠近中栏右缘时可能越界。** 320px 宽加阴影要跟当前中栏宽度对齐；长会话里组头 chip 位置随耗时与推理时间字段变化，右对齐不能只按样张里的一张卡算。窄屏要单独定摆放方向。
- **组头 chip 变成可聚焦元素会插进 Tab 序列。** 每个模块头多一个 tab 停靠点，长会话键盘导航会变长。[会话版式与行层级](../../implemented/feature/2026-11-04-session-layout-and-row-hierarchy.md)已记过连续 Tab 未逐键验证；落地前要实测从页首逐键走到第二、第三个模块头，确认焦点环可见且浮层不遮挡下一行。
- **两处 treemap 取档判据不同。** 右栏 `partShade` 按份额阈值分档，浮层按四类份额排名分档。同一屏里四档颜色的含义会不一样，后来者容易合并成一套或误读成类别色。代码里写一行口径说明，[UIUX-DESIGN.md](../../../../UIUX-DESIGN.md) 也要落一条。
- **四个符号的语义是约定，不是自明的。** 圆点环与缓存读取、托盘下箭头与缓存写入之间没有天然联系，读者要在头几次使用中建立记忆。中英两份文案与 `title` 要写清类别名，符号对照只放 demo 说明卡，不进生产浮层。
- **样张只验过三档合成数据。** 常规、高命中、缺读数三种分布不等同于生产会话；四段全为 0、只有 `out_tok`、超大值导致细条宽度不足 2px 这些边界没在样张里走。落地测试要补，真实流量只读验收另记。
