# Agent Note: app.js 三个自包含叶子外移成独立模块

Status: implemented

## Problem

`web/app.js` 涨到 2,824 行，其中三段与装配无关的叶子内联在文件头部：

- 空状态蜘蛛插画（几何常量、SMIL 动效生成、500ms 启动计时、reduced-motion 监听）约 145 行；
- `restoreScroll`（重绘后恢复滚动位置的纯函数）11 行；
- `createMoreTargets`（`+N` 弹层目标清单工厂）22 行。

三段都是自包含叶子——不接触 store、读取与装配状态——却让装配层文件承担了插画几何与弹层生命周期的阅读负担。

## Decision

按架构评审定稿的方向 4 外移，全部逐字搬移：

- 蜘蛛段整体进新建 `web/empty-state.js`，导出 `spiderArt` 与 `armSpider`（主闭包各 2 处、3 处调用），模块级注释沿用原段文档；
- `restoreScroll` 进新建 `web/scroll.js`；
- `createMoreTargets` 并进既有 `web/selection.js`（`applyIntent` 之后），它本来就是无 DOM 的状态工厂，`+N` 清单是选择与渲染状态的延伸；
- `web/app.js` 改为 import 三个符号，`tests/web.test.ts` 的导入同步拆到新家。

搬移一致性用 diff 机械验证：旧 `app.js` 的对应段与新文件逐字相同（蜘蛛段唯一差异是段首分隔注释，函数段含文档注释全同）。`empty-state.js` 在模块顶层注册 reduced-motion 监听，但监听目标在无 `window` 环境是 `null`、用可选链注册，Bun 测试环境 import 安全。

## Alternatives considered

**三段全留在 app.js。** 装配层文件继续膨胀，且蜘蛛几何常量一行 3KB，阅读装配逻辑时全程陪跑。

**蜘蛛进图标/资产类模块。** `icons.js` 只管图标字符串；蜘蛛带启动计时、WeakMap 相位与 reduced-motion 替换，是有行为的组件，单独成文件让"空状态插画"有自己的家。

**createMoreTargets 留在 app.js 只导出。** 测试要 import 它就得 import 整个 app.js；搬进 selection.js 后测试依赖收窄到纯函数模块，与既有 `applyIntent` 测试一致。

## Consequences

- `web/app.js` 2,824 → 2,645 行；新增 `web/empty-state.js`（146 行）、`web/scroll.js`（13 行），`web/selection.js` 290 → 312 行。
- 行为零变化：调用点不动（`spiderArt` 2 处、`armSpider` 3 处、`restoreScroll` 1 处、`createMoreTargets` 1 处），只换定义位置。
- 测试与基线持平：`web.test.ts` + `reader-store.test.ts` + `trace-view.test.ts` 150 pass / 0 fail（搬移前基线同值）；typecheck 除既有 `web/reader-store.js` 错误外干净。
- 合并回归：新模块未登记 `src/http.ts` 的 `STATIC_FILES`，生产页面模块图 404，整页不启动（会话列表停在「正在读取本机会话…」）。`tests/http.test.ts` 的「静态白名单与 web 目录互相覆盖」在合并时已红，被误读为既有基线；修复补两行登记并重启服务。教训：搬移或新增 web 模块必须跑这条白名单断言，只跑 `web.test.ts` 发现不了 404。
- 浏览器核对：生产页面恢复后，空态蜘蛛 `data-motion` 从 `idle` 变 `running`，5 个 SMIL 动画全部启动；`restoreScroll` 在真实布局下把 240 → 120、超上限夹到 900；`createMoreTargets` 的 remember/listOf/reset 正常。`+N` 弹层的真实锚点需要多目标工具行，当前 20 个会话窗口里没有出现，按模块级调用验证，悬停弹层未现场点击。
