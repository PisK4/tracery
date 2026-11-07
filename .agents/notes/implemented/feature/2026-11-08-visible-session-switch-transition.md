# Agent Note: 切会话换场钉住最短驻留（Tracery）

Status: implemented

## Problem

[档 1](2026-11-08-ui-switch-motion-phase1.md)在合成页与生产页面都通过了状态、计算样式与资源检查，用户手动验收却反馈感觉不到明显修改。回看生产验收的逐帧数据就能解释：`switching` 从 1ms 活到 19ms，压暗写的是 120ms transition 还没起效就被覆盖；扫描线周期 1s、起点在 `left:-38%`，18ms 只跑完整轮的 1.9%，高亮段没进视野；`entering` 的 180ms 从 0.55 淡回发生在 `renderAll()` 整块换掉中栏行节点之后，读起来只是新内容出现。窗口页到本地库常 20ms 就到，保留上限 300ms 只约束了上限，最短驻留没有任何约束。

上一轮把机器判据（DOM 状态序列、`getComputedStyle`、动画名存在、资源 200）当成了人眼可感知判据，写出了生产真实流量验收通过的结论。这次改动同时修正判据：过渡要有可观测的持续时间与位移，验收逐帧读计算样式的变化，而不只读状态是否出现过。

## Decision

只在 `web/` 里做，读取契约、`reader-store` 与后端一律不动。

- `selectSession` 的保留路径新增 `SWITCH_MIN_HOLD_MS = 200`。`switchReady` 在窗口页到达后等满最短驻留的绝对时刻再换场；到 300ms 保留上限仍按超时路径画骨架。用绝对时刻而不是时长差，连点稳定窗口的等待也算在驻留里，不会让两次等待叠加成 340ms。
- 换场拆成两段：旧画面在 `switching` 的 200ms 里播 `switch-leave`（压到 0.4、上移 6px），扫描线 `switch-sweep` 同步走完一轮 200ms，不再用 1s 无限循环；新画面在 `entering` 里播 `session-swap-in`（从 0.25 透明度、下方 12px 处淡入），240ms。`switchEnterTimer` 从 220ms 延到 260ms，淡回播完才清状态。
- `prefers-reduced-motion: reduce` 下 `switchReady` 跳过等待，连点稳定窗口也跳过；CSS media blanket 把两段动画关掉并清掉关键帧末帧的 transform，旧画面不留在偏移位。切会话与改动前一样即时。
- 逐条点选、右栏页签与工具四页切换全部不碰，保留指哪打哪的即时反馈。`startSwapIn()` 只复用 `entering` 淡回，不引入 200ms 等待。
- `tests/web.test.ts` 加一条源码级守门：常量、函数签名、reduce 短路、三段动画时长、清理定时器与扫描线不再无限循环都钉住。

## Alternatives considered

- **档 2 预取首屏正文或档 3 会话快照缓存。** 能让首帧就有真实内容，才具备做旧到新连续过渡的条件；要改 `read-contract.ts` 的 `requests` 输出或 `reader-store` 缓存生命周期，11-04 已否决过快照缓存。用户本轮选了纯前端路径，保持否决。
- **View Transitions API 做交叉溶解。** `mainView.commit` 用 `replaceChildren` 整块换节点，大会话 6 万+ DOM 节点，全页快照捕获成本高；[页面交互动效层](2026-11-04-web-interaction-motion.md)已否决。
- **复制旧画面 DOM 做双层快照。** 需要新增一层脱离键控提交的节点，重绘与清理都要单独接线，收益只是让位移发生在副本上；状态类直接驱动现有 `.session-head` 与 `.step-list` 就够。
- **把最短驻留做成可配置项或读取时长自适应。** 切会话是低频入口，固定 200ms 已覆盖本地与慢网两端；配置项与自适应逻辑没有对应需求。
- **给 20 多处点击分支逐个加动效。** 改动散且容易漏，还会把高频点击一起拖慢；换场只在 `selectSession` 一条路径上。

## Consequences

- 代价：切会话从点击到新画面出现多了约 200ms 的视觉层等待，数据照常到达、`inert` 只在保留期间生效，连点仍由 `navEpoch` 与稳定窗口守卫。逐组填充的节奏仍在，档 1 的已知边界没有消除。
- 收益：压暗、扫描线、旧画面让位与新画面淡入各占满自己的时长，人眼能看出一次换场；减少动态偏好下退回即时切换。
- 合成页（8771 端口，同一份生产 `web/`）在 800ms 延迟与不注入延迟两种条件下逐帧核对：本地路径 `switching` 持续到 233ms，旧画面 `switch-leave` 与扫描线同步，`entering` 从 0.25 透明度与 12px 位移起步，472ms 回到 1 与 `transform:none`；全程 `#main .pulse` 为 0。慢网 316ms 出 8 行骨架、891ms 窗口页到达再淡回。连点两次点击各自同 tick 高亮到位并落在第二笔；显式刷新 28ms 进 `entering`、800ms 后状态、动画与 transform 全清；reduce 下 21ms 落定、动画名 `none`、无 transform 残留。
- 验证：`bun run typecheck` 通过；`tests/web.test.ts` 54 pass。合成数据与生产流量验收分开，本轮没有部署生产。
