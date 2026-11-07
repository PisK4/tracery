# Agent Note: codex-app-server 的 handle_responses span 没有映射规则

Status: proposed

## Problem

2026-11-07 的 OTLP 重放预览里，157,686 条未过期 raw span 中有 64 条 `handle_responses` 带 `gen_ai.usage.*` 属性，但 `SPAN_RULES` 没有服务与形状能认它们，重放把它们写成 `span_shape_unknown`。这 64 条挂在 `codex-app-server` 名下；该服务的原始 span 日量在十万行量级，绝大多数是 `fs.get_metadata`、`receiving`、`fs.read_file` 这类工具与内部 span，形状判定认不出 LLM 键，静默留在原始层。

[重放记录](../../implemented/feature/2026-11-07-otlp-mapping-replay.md)只把这 64 条记在代价里。它们是有用量、没有正文的真实调用痕迹，产出比哨兵看不到；原始层 7 天 TTL 过后不再可重建。

## Proposal

先确认 `handle_responses` 的属性形状与服务归属：是否每条都带完整 `gen_ai.usage`、模型名与可对齐的请求身份。确认后给 `SPAN_RULES` 加一条只命中 `service='codex-app-server'`、`name='handle_responses'` 且带 `gen_ai.usage.*` 的规则，按 LLM span 映射；不满足属性条件的同名 span 继续走内部 span 静默路径。

若属性不足以建立请求身份（没有可对齐的 id，只有用量聚合），则不加规则，把这个判定写进映射形状的说明，避免下次重放再当作未知形状。

## Alternatives considered

**直接当成未知形状不管。** 现状就是如此。缺一条可检索的记录，规则作者下次仍要从重放代价里翻出来。

**按服务名整体登记 `codex-app-server`。** 该服务日量大头是工具与内部 span，整体登记会把 `fs.*` 与 `receiving` 全算进候选，产出比分母失真。

## Acceptance criteria

- 预览里这 64 条不再计入 `unknownShape`，或明确改为「有规则且判定为内部 span」。
- `otlp_issues` 不因新规则新增 `span_shape_unknown`，`service_not_registered` 计数不变。
- 新增映射规则有合成 span 测试，覆盖命中、缺 usage、同名工具 span 三种形状。

## Risks

规则过宽会把工具 span 误判成 LLM 调用，污染产出比与用量统计。重放读的是脱敏后的属性：用量与模型键不受影响，身份键若依赖未脱敏值，重放与实况会不一致。
