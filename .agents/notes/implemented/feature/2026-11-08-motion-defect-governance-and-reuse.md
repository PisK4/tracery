# Agent Note: 动效缺陷治理与转场推广（Tracery）

Status: implemented

## Problem

[可感知换场](2026-11-08-visible-session-switch-transition.md)交付后，用户认可切会话的过渡，问能否推广到其他页面，并选择把既有动效缺陷一并治理。先在合成页逐项复现，确认四类缺陷都是真的，不把设计当成 bug 修：

- **切主题重播与相位归零**：`body.theme-switching *` 写了 `animation:none!important`。主题切换的两帧里所有 CSS 动画被取消，抑制解除后从零重播。三个无限动画样本（`.pulse`、`.live-dot`、`.sess-skel-title`）在切换前 `currentTime` 都是 738ms，切换后全部回到 0 并同步起跑。
- **vendor 固化 inline**：`motion.vendor.js` 的 `Z()` 硬编码 `fill:"both"`，`onfinish` 又把末帧经 `H(o,r,a)` 写成 inline style 再 `cancel()`。入场动画播完留下 `opacity:1; transform:translateY(0px)`，视觉无害但会压住后续 CSS 样式变化；离场动画的 `opacity:0` 必须保留到元素隐藏或移除，[档 1](2026-11-08-ui-switch-motion-phase1.md)已为弹窗二次打开单独绕过一次。
- **瞬态类长期不清除**：`tab-fresh`、`chip-fresh`、`landed` 三处点击后加类就不再删。400ms 后类名与 `animation-name` 仍在 DOM 上，重绘前一直挂着已结束的动画声明。
- **整块重绘让无限动画相位重置**：`rail.innerHTML = railBody()` 与会话栏重绘会换掉承载节点，新节点上的无限动画从零起跑。三个样本从 623ms 全部归零。

同时核清推广边界：项目只有 `web/index.html` 一个 HTML 入口，生产页面是左中右三栏，没有第二个页面可跳。右栏换请求/换轮/换页签已有方向滑入与 `railViewNudge`，逐条点选与搜索逐键有意即时，主题与语言切换有意当帧完成。真正硬切的是汇总列表打开、左栏折叠、加载更多与刷新会话列表；中栏显式刷新家族只复用 `entering` 淡回，比切会话少一段旧画面让位。

## Decision

只在 `web/` 与 `tests/web.test.ts` 里做，不改 `motion.vendor.js`（vendor 产物不手改，见[页面交互动效层](2026-11-04-web-interaction-motion.md)），不碰读取契约与后端。

- **切主题只关过渡**：`body.theme-switching` 规则删掉 `animation:none!important`，保留 `transition:none!important`。主题当帧完成的目标不变，正在跑的无限动画不再被取消。
- **入场动画播完清 inline**：`motion()` 增加可选 `clean`，播完按关键帧属性名清掉末帧固化的 inline。所有入场调用（右栏头部与列表、会话栏、明细 slot、上下文矩阵 tile）都传 `clean`；toast、弹窗与面板的离场不传，末帧留到元素隐藏。`context-map.js` 的 FLIP morph 也不传：`left/top/width/height` 是 tile 的定位本身，清掉会错位。
- **瞬态类收编到 `markFresh`**：一次助手负责强制回流重播与定时清除（`landed` 760ms、`chip-fresh`/`tab-fresh` 220ms），四处调用点统一改用它，不再有裸 `classList.add`。
- **推广到硬切入口**：`openSummaryList()` 置一次 `railViewNudge`，让打开条目列表与返回列表的淡入口径对称；左栏折叠、加载更多、刷新会话列表复用既有的 `motion(sessions-list, {opacity:[0.35,1]}, 0.14)`。全部不带等待，不改状态机，不给逐条点选加动效。
- **中栏刷新家族不改**：`startSwapIn()` 家族只复用 `entering` 淡回。给显式刷新、跳锚点、切窗各加 200ms 最短驻留会把用户主动发起的重建拖慢，而它们已有一次淡回；本次只做缺陷治理，不扩等待范围。
- `tests/web.test.ts` 新增四条源码级守门：`clean` 的作用范围与离场例外、切主题规则不含 `animation:none`、`markFresh` 的四个调用点、汇总列表与左栏四处淡入，外加中栏两段换场未被改动。

## Alternatives considered

- **改 `motion.vendor.js` 去掉 `fill:"both"`**：这是 esbuild 摊平的第三方产物，文件头写明勿手改，重新生成等于显式升级；而且离场动画依赖末帧固化，去掉会把 toast 与弹窗的离场一并弄坏。选在 `motion.js` 封装里按调用方意图清理。
- **给每个调用点各写一次 `removeProperty`**：十处重复，且容易漏掉离场例外。收进 `motion()` 的 `clean` 选项。
- **用 `animationend` 事件清瞬态类**：重绘会换掉按钮节点，事件绑不到新节点；`markFresh` 的定时器挂在当次点击上，按墙钟清理即可。
- **给汇总列表打开单独写一段 WAAPI 动画**：`railViewNudge` 已经覆盖同键换视图的淡入，置一次标记就够，不新增动效分支。
- **给无限动画在重绘前后保存并恢复 `currentTime`**：要遍历节点、按动画名配对、处理重绘后节点身份变化，成本远超收益。整块重绘本来就会换节点，相位从零起跑是可接受的代价；本轮只修切主题这个可以零成本避免的集体归零。
- **给刷新家族也钉 200ms 最短驻留**：低频入口可以承受，但会让每次显式刷新多等，且它们不是用户抱怨的硬切来源；等下一轮明确要一致化再做。

## Consequences

- 代价：`clean` 的清理定时器取动画时长加 120ms 余量，动画时钟冻结的环境里 `settled()` 仍按超时兜底，最坏情况下 inline 会晚清 120ms；清理只作用于 `opacity` 与 `transform`，两者末帧都等于 CSS 正常值，晚清不改变外观。
- 收益：切主题不再让整页呼吸同时归零；入场动画不再往 DOM 里写常驻 inline；瞬态类播完即删，重绘不会带上过期声明；汇总列表打开与左栏三处换内容不再硬切。
- 合成页（8771 端口，同一份生产 `web/`）逐项复验：入场动画播完 inline 为空、计算透明度 1、在飞动画 0；离场保留 `opacity:0`；主题切换后三个无限动画从 707ms 继续到 767ms；`tab-fresh` 30ms 存在、330ms 清除、再点能重播；汇总列表打开时右栏计算透明度 0.673 正在淡入；刷新会话列表 40ms 计算透明度 0.439、120ms 到 0.978、160ms 回 1、inline 全程为空；明细弹窗二次打开计算透明度回到 0.688；切主题后按钮过渡时长仍为 0.12s；71 个资源请求零失败，收尾时无 `tab-fresh`/`chip-fresh`/`landed` 残留。
- 折叠与加载更多两处淡入在当前合成会话没有对应按钮，只由源码级守门覆盖，未做浏览器验收。
- 验证：`bun run typecheck` 通过；`tests/web.test.ts`、`tests/context-detail.test.ts`、`tests/context-map.test.ts`、`tests/trace-commit.test.ts`、`tests/http.test.ts` 共 123 pass。合成数据与生产流量验收分开，本轮没有部署生产。
