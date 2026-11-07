# Agent Note: codex-app-server 的 handle_responses span 没有映射规则

Status: proposed

## Problem

2026-11-07 的 OTLP 重放预览里，157,686 条未过期 raw span 中有 64 条 `handle_responses` 带 `gen_ai.usage.*` 属性，但 `SPAN_RULES` 没有服务与形状能认它们，重放把它们写成 `span_shape_unknown`。这 64 条挂在 `codex-app-server` 名下；该服务的原始 span 日量在十万行量级，绝大多数是 `fs.get_metadata`、`receiving`、`fs.read_file` 这类工具与内部 span，形状判定认不出 LLM 键，静默留在原始层。

同日只读核对确认这 64 条仍在库中，`mapping_version` 已回写为 4，`received_at` 落在 2026-11-03 12:52–17:04，按 7 天 TTL 到 **2026-11-10 17:04:45** 过期。属性形状（只读取键名与类型，未读值）：

- `gen_ai.usage.input_tokens` / `output_tokens` / `cache_read.input_tokens` / `cache_write.input_tokens`：integer；
- `codex.usage.reasoning_output_tokens` / `codex.usage.total_tokens`：integer；
- `codex.request.reasoning_effort`：text；
- `thread.id`：integer，`thread.name`：text；
- 没有 `gen_ai.request.model`，也没有单次调用的 response id。

33,382 条 `handle_responses` 全部与同一 trace 内的 `session_task.turn` span 共存，带 usage 的 64 条也在其中。

[重放记录](../../implemented/feature/2026-11-07-otlp-mapping-replay.md)只把这 64 条记在代价里。它们是有用量、没有正文的真实调用痕迹，产出比哨兵看不到。

## Proposal

形状核对的结论是：没有模型名，也没有单次调用身份，能用的归属键只有 `thread.id`/`thread.name` 与同一 trace 的 turn span。两条路线择一：

1. 若决定映射，按 trace 把 `handle_responses` 归到 `session_task.turn` 建出的 OTLP 行，作为该回合的补充证据与用量，不新建 `request` 行。需要先确认同一 trace 内 turn span 与本 span 的对应关系是否一对一。
2. 若确认无法建立请求身份，则不加规则，把「`codex-app-server` 的 `handle_responses` 是有用量的内部 span、不参与行映射」写进映射形状说明，避免下次重放再当作未知形状。

无论选哪条，都应在 2026-11-10 17:04:45 之前用窗口内样本跑一次重放预览验证；过期后只能等新样本。

## Alternatives considered

**直接当成未知形状不管。** 现状就是如此。缺一条可检索的记录，规则作者下次仍要从重放代价里翻出来。

**按服务名整体登记 `codex-app-server`。** 该服务日量大头是工具与内部 span，整体登记会把 `fs.*` 与 `receiving` 全算进候选，产出比分母失真。

**给这 64 条单独建 `request` 行。** 没有模型名、没有调用身份，行上的身份字段只能留空；与同 trace 的 turn 行相比只会制造重复。

## Acceptance criteria

- 预览里这 64 条不再计入 `unknownShape`，或明确改为「有规则且判定为内部 span」。
- `otlp_issues` 不因新规则新增 `span_shape_unknown`，`service_not_registered` 计数不变。
- 新增映射规则有合成 span 测试，覆盖命中、缺 usage、同名工具 span 三种形状。
- 规则落地前，用 2026-11-10 前的窗口样本跑一次重放预览。

## Risks

规则过宽会把工具 span 误判成 LLM 调用，污染产出比与用量统计。重放读的是脱敏后的属性：用量四段、codex 用量、`thread.id`/`thread.name` 都不依赖未脱敏值；但没有模型名意味着不能按模型消歧，只能依赖 trace 与 thread 归属。
