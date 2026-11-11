# Agent Note: 工具调用标出它启动的子代理

Status: implemented

## Problem

[子代理阅读视图](2026-11-08-subagent-actor-views.md) 让中栏默认只看主链，代价是子代理的来路被滤掉了：读者看到 `Agent` 调用行，却不知道它启动了哪一段子代理过程，也没有入口跳过去。S 编号与左缘标记只回答「这一行属于哪个子代理」，回答不了「主链的哪一句把它启动了」。

判定「哪一句启动了哪个子代理」不能靠猜。页面形态的后续定稿见[Lucide 图标迁移与启动点 chip 定稿](2026-11-08-lucide-icon-migration.md)。Claude Code 的异步 `Agent` 结果正文里有启动回执，第一行是 `Async agent launched successfully.`，随后一行是 `agentId: <17 位十六进制>`。本机生产库实测：169 笔可读的 `Agent` 结果全部带 id，与折叠子代理的 id 1:1 命中，没有一笔出现多个 id，也没有可读但缺 id 的情况；启动到子代理首笔请求的间隔最小 9.9 秒、中位 25 秒。其余 harness 的形态里没有这种回执——codex 120 个子代理、dsh 33 个、zcode 25 个，零命中。

覆盖缺口是真实存在的：claude 有 35 个子代理（10 个会话）根本没有主链 `Agent` 调用（孙代理），30 个子代理（18 个会话）的 `Agent` 结果全是 `pending: derive_not_current`，另有 15 个部分命中。这些行就是标不出来，页面不能装作标出来了。

## Decision

把启动回执里的子代理 id 作为配对行的事实落库，读侧换成会话内 S 编号，中栏在调用行上给一个可点击的 `→ S1`。

- 指纹只有一个家：`src/harness/spawn.ts` 的 `spawnedAgentRef(text)` 认 `Async agent launched successfully` 加 `agentId: <17 hex>`，`isSpawnTool(name)` 认 `Agent`。两处判定函数，不引 harness 品牌分支，也不需要新登记表——它判的是工具名与正文，不是 Harness 用途。
- 提取发生在正文已经在手的地方，不另开一次解压：同步路径在 `planToolCalls` 的结果关联循环里取，切片路径在请求物化阶段把结果正文压平一次、摘要与回执各取一段。落库列是 `tool_call.agent_ref`、`derive_tool_result.agent_ref`，暂存列是 `derive_result_work.agent_ref`。
- 工具名闸门落在结果解析成 `resolved` 的那一步：`isSpawnTool` 为假就写 NULL。这样同一段回执文本出现在别的工具结果里不会误标。
- 读侧 `src/queries/requests.ts` 把 `agent_ref` 换成同会话的 `subagent_no`：用已有的 `subagentNumbers`，不在本会话的 id（跨会话、已被清理）编号为 null，页面按无编号处理。非 current 的行连 `agent_ref` 与 `agent_no` 一起清空——它来自配对到的结果正文，同属组结果。
- 页面：调用行在摘要后加 `→ S{no}` 芯片（`.row-agent`，与 `.row-more` 同一族）。点击调 `jumpToSubagent(no)`：在当前窗口里找该编号的第一笔，切到该 S 视图再定位；窗口里没有这笔时提示「子代理 S{no} 不在当前窗口；先切窗再试」，不静默失败。

## Alternatives considered

**读时解析结果正文，不落库。** 每次翻页都要重新解压子代理结果来提取 id，窗口越大越贵；而且这条事实只在派生阶段有正文在手，读侧再算一遍是把同一件工作放在两个地方。派生层落库后读侧只是换编号，零解压。

**用 `ListAgents` 结果里的 id 当证据。** `ListAgents` 的返回会列出子代理 id，但它只说明「这个子代理存在」，不说明「这一笔调用启动了它」。用它标记会把查看列表的调用错标成启动点。只在工具名是 `Agent` 且结果带启动回执时才认。

**按提示词相似度或时间邻接匹配。** 有精确证据时不该用启发式：真实窗口里子代理与主链毫秒级交错，时间邻接会错配；提示词相似度在模板化委派下区分度也很低。两种都否决。

**把标记做成只读文案，不给跳转。** 用户明确要的是「能跳过去」。只读标记仍然要读者自己切视图再找行，S 编号已经给了定位键，跳转就是把这个键用起来。

**一次覆盖所有 harness。** 其余 harness 的数据里没有启动回执，凭现有形态标不出来。为它们造一套弱证据会污染这条强证据的可信度；等各家数据里出现等价事实再按同一机制接。

## Testing

合成数据：

- `tests/derive-tool-pairing.test.ts`：`Agent` 调用的结果带启动回执时 `tool_call.agent_ref` 落 id；同样的回执文本挂在 `Read` 结果上时为 null。
- `tests/derive-slice.test.ts`：同一场景走切片路径，只有 `Agent` 行带 `agent_ref`，`Read` 行为 null；算法版本钉子随 `GROUP_ALGORITHM` 8 / `DERIVE_ALGORITHM` 12 更新。
- `tests/trace-view.test.ts`：`agent_no` 非空时调用行出现一个 `row-agent`，`data-agent-no="1"`、文案 `→ S1`、读屏文案按编号生成；`agent_no` 为 null 时不出标记。
- `bun run typecheck` 干净；全量套件 1450 项通过。

生产副本（隔离实例 8399：生产库 `.backup` + 独立 `ATC_DATA_DIR` 与 `ATC_PORT`，未碰 8320）：

- 打开时 `user_version` 升到 16，`tool_call`、`derive_tool_result`、`derive_result_work` 三张表都有 `agent_ref` 列。
- `maintain rebuild --session '["session","d0b52d1f-…"]'`：878 笔全部重算（`target_algorithm` 8、实际算法 8:878），该会话 1 笔 `Agent` 行落 `agent_ref=ae04d60797985196a`；`/api/requests/194442` 返回该调用的 `agent_no: 1`。
- 页面：`?trace=194442` 下主链视图出现一个 `→ S1`（`aria-label` 为 `Jump to subagent S1`，英文界面）；点击后视图切到 S1（`aria-pressed=true`）、URL 的 `trace` 变成 194451，与库里该子代理的首笔请求一致。
- 未覆盖：窗口外提示分支只在合成测试里走过，生产副本的该会话整段都在窗口内。

## Consequences

`tool_call` 多一列 `agent_ref`，结构版本 v16；同步与切片两条路径的算法版本各升一级（`GROUP_ALGORITHM` 8、`DERIVE_ALGORITHM` 12），旧行要显式重建才会带 id——升级本身只加列，不回填，读侧对旧行为 null，页面就是不显示标记，不会显示错的标记。

能标出来的范围就是启动回执能读到的范围：claude 的 `Agent` 且结果可读。孙代理、结果正文待派生或已回收的调用标不出来，子代理视图仍然可以从「全部」或 S 编号进入。其余 harness 一律无标记。

跳转只在当前窗口内成立：目标子代理的首笔不在已加载窗口时给提示，让读者先切窗，不偷偷把窗口翻过去。视图是阅读状态不写 URL 的约定沿用，切视图后 URL 只带 `trace`。

跳转入口后来收拢：[请求级 Trace 模块与会话时间线视图](2026-11-10-request-level-trace-modules.md)把唯一入口移到「启动子代理 S1」记录块，工具名 chip 回到纯展示；`agent_ref` 数据链路与返回启动点不变。
