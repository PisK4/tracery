# Agent Note: 右栏重绘排在显示模型提交之后

Status: implemented

## Problem

准备块落地时，`onPrepared` 先 `scheduleRenderMain()`，紧接着同步 `renderRail()`。主栏的重绘在微任务里，届时才跑 `traceModel.update`；右栏的同步重绘读 `stepsOf`，拿到的是上一版显示模型，于是已经备齐的组仍按保留态画成「阅读版本已变化 · 正在准备当前版本，请稍候」。

普通组之后还有增量落地、依赖补齐带来的 `onStoreChange` 兜底，迟到的重绘最终会把它纠正过来，问题被掩盖。辅助请求（`chain_role='aux'`）没有可信增量、没有依赖，`onPrepared` 是它最后一次回调，右栏就永久停在等待态。生产库 4,611 个会话里 2,608 个首笔就是辅助请求，默认选中的第一笔正好落在这类组上；点该组、切右栏页签、点「立即重读」都能立刻出正文，说明数据一直在，缺的只是重绘时机。

合成复现（`prototypes/synthetic-server.ts`，`conv-synthetic-reading` 的 `aux` 请求 106）在修复前直达 `?trace=106` 稳定停在等待态，同一会话的普通请求 101 正常。

## Decision

读落地引起的右栏重绘改成排队：`scheduleRenderRail()` 只置一个标志并复用主栏的微任务，`scheduleRenderMain` 的回调在 `renderMain()`（内含 `traceModel.update`）之后再看标志重绘右栏。`onStoreChange` 与准备块通知两处改用它。

选择路径不改：`dispatch` 的效果表里本来就是 `render-main` 在前、`render-rail` 在后，同一次同步执行里模型先提交。换会话、切页签、点「立即重读」这类由用户动作直接驱动的重绘也保持同步。

## Alternatives considered

**在 `onPrepared` 里先 `renderMain()` 再 `renderRail()`。** 等于把一整个窗口的提交从微任务挪回同步，同一 tick 内多笔读取不再合并，回到[显示模型修订](../architecture/2026-11-02-trace-model-revisions.md)否决的逐笔全量提交。

**让 `renderRail` 自己先 `traceModel.update`。** 显示模型会有两个提交点，`changedReads` 的清空时机跟着分裂，主栏与右栏可能各提交一次不同窗口。

**辅助请求也给一条可信增量兜底。** 它本来就没有参与主链，为它造一条空增量只为了让重绘被顺带触发，属于用数据形状掩盖渲染时序。

## Testing

合成场景三个用例：直达 `aux` 请求、直达普通请求、会话首页点辅助组。修复前第一条与第三条停在「阅读版本已变化」，修复后三条都直接出正文；`tests/web.test.ts`、`tests/trace-model.test.ts`、`tests/trace-preparation.test.ts` 64 项通过，`bun run typecheck` 干净。

## Consequences

右栏重绘比主栏晚一个微任务，同一 tick 内多次读落地仍只提交一次、只画一次。用户动作驱动的重绘不受影响。

未被本次覆盖：生产环境尚未部署复验。真实验收需要确认「首笔为辅助请求」的会话在默认选中下直接出正文，而不再需要点一下组或页签。
