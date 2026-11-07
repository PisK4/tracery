# Agent Note: hook 后到时的会话行认领

Status: implemented

## Problem

会话适配器先落库时，行上 `via='session'`、`route_id` 为空。hook 回调随后到达，`findCandidates` 只查 `response_id_norm` 且 `route_id IS NOT NULL` 的行，看不到这条会话行，于是新建一行并停在等待队列。账本再按 response id 认领 hook 行，同一笔调用留下两行：会话行只有一条会话证据，账本行带着 hook 证据。

存量已由 [dedupe 的 response id 盲区修复](2026-11-07-dedupe-response-id-blind-spot.md)清完，那份记录末尾留了增量侧的缺口。不封住写路径，维护窗口之间仍会按同样次序产生新组。

## Decision

`acceptHook` 在 route 候选与 OTLP turn 候选都没有认领目标时，回落到 `findRequestOwnerTx`。查询带 response id、turn ref、与落库同形的组键、agent、开始时间，以及 `observed_finish_ms` 作为完成时间；`usage` 传 null，hook 不解析回复里的协议用量。

hook 的完成时间来自 envelope，没有运行时校验，缺字段或 NaN 都进得来。回落显式传 `disallowWeakWindow`，owner 的第 5 条弱开始窗不参与，只走 response id、turn 与完成时间对齐。命中时证据行的 `match_rule` 写 owner 给出的规则名；未命中时等待队列、证据状态与新建行保持原行为。hook 先到、会话或账本后到的方向不变，那条路径本来就由对方的 owner 查找认领 hook 行。

## Alternatives considered

**去掉 `findCandidates` 的 `route_id IS NOT NULL` 条件。** 这个函数还服务于 `reconcilePending`，那里的语义是「账本路由行到货了没有」。把只带会话证据的行算进 route 候选会改宽等待队列的口径，歧义计数与合并对象跟着变。回落到统一 owner 只影响 hook 首次写入的判断。

**从 hook 回复里抽四段用量补齐指纹。** anthropic 与 chat 协议的回复用量形状不同，与各会话适配器还有缓存扣减口径的差异。抽错只漏认领、不误并，但新增一层协议解析并改变写路径行为，收益不足：生产重复组的会话行里 99% 以上带 response id，按 response id 与完成时间已经覆盖观测集。

**继续靠 dedupe 维护命令清理。** 首轮已把存量并完；新流量每天仍在产生新组，维护命令只能追着跑。

## Testing

`tests/hook.test.ts` 新增四条合成测试：会话行先到、hook 按 response id 认领后只剩一行，证据规则为 `response_id_norm.v1`；无 response id 时按完成时间对齐认领，规则为 `conv_end.v1`；会话完成时刻相差 8.8 秒时不合并，也不退回 60 秒开始窗；`observed_finish_ms` 为 NaN 且会话行落在弱窗内时同样不合并。修复前前两条各得到两行，补弱窗守卫前第四条会并成一行；修复后 hook 测试 49 条全绿。

## Consequences

hook 认领会话行时 `persistBodyTx` 覆盖该行已有的会话正文。hook 正文是原始请求与回复，比会话适配器从转录重建的正文完整，替换符合预期；代价是该行基于旧正文的派生按新输入重算一次。

回退只认可确定的线索：密集工具循环里完成时间对不上的调用仍会留下两行，直到后续证据认领。这条边界是多一行，不是错并一行。

`skipResponseId` 不参与本路径：查找发生在 hook 行创建之前，不存在源行自身污染的问题。
