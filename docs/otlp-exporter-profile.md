# OTLP exporter 接入 profile

本文写给 Agent harness 的作者：想让 ATC 读到你的 harness，导出按这份 profile 来，再登记一个稳定的 `service.name`。规范全部站在 OTLP 与 OTel GenAI 语义约定之上，不发明私有键。

profile 分两级。原生方言层是已登记三家（Claude Code / OMP / Codex）按各自实测键族导出的摘要级接入，正文只作结构化摘要。全量级面向愿意完整导出的集成方：完整正文 + 响应 id，经同一条 OTLP 道建行、落块、跨通道认领。两级共用端点、认证与错误码，差别只在正文完整性与锚点键。

## 传输与认证

- OTLP/HTTP，`application/x-protobuf` 与 `application/json` 都收。
- 端点 `POST /v1/traces` 与 `POST /v1/logs`；endpoint 配到根（`http://127.0.0.1:8320`），SDK 自己拼路径。
- 认证是 Bearer 令牌。令牌取值方法、错误码表（401/403/413/415/429/503/507）与磁盘档位行为归[运维手册](operations.md)的 OTLP 接入一节，本文不重复。

## 属性 profile

每个 LLM 调用一个 span，带齐下面的键就能建行，全部是 GenAI semconv 现有键：

| 属性 | 用途 |
| --- | --- |
| `gen_ai.operation.name` | 选取判据，建议 `chat` 或 `llm_call` |
| `gen_ai.conversation.id` | 会话归属，行进会话时间线 |
| `gen_ai.request.model` | 请求模型 |
| `gen_ai.response.model` | 实际服务的模型，缺席保持空 |
| `gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens` | 用量 |
| `gen_ai.usage.cache_read.input_tokens`、`gen_ai.usage.cache_creation.input_tokens` | 缓存用量 |
| `gen_ai.response.finish_reasons` | 终止原因；全量级写进回复信封供轮次收尾判定 |
| `gen_ai.response.id` | 响应 id，全量级的跨通道认领锚点（原生方言层不映射） |
| `gen_ai.input.messages`、`gen_ai.output.messages` | 逐笔正文：原生方言层按结构化摘要，全量级按完整正文 |

正文捕获开关用 semconv 标准变量 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`。不开时行只有读数，ATC 不把缺正文标成采集失败。表外的属性照落原始层，不进读模型列；本文只承诺今天能解析的键集。

## 全量级

全量级在摘要级键集上加 `gen_ai.response.id`，并把 `gen_ai.input.messages` / `gen_ai.output.messages` 升为完整正文。集成方按 semconv 现有键完整导出，登记一个稳定 `service.name` 加一行 `fullProfileRule(service, agent)` 即接入；选取判据是 `gen_ai.operation.name='chat'`。

完整性契约是一条硬约定：**正文键要么完整、要么缺席，不允许静默截断**。

- 发送端负责关掉 SDK 的属性长度限制（`OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT`、`OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT` 等），让 messages 的 JSON 整串导出。
- 接收端无法核验未截断部分，只验证可解析性：正文 JSON 解析失败、或 messages 不是数组，整段降级 `summary` 并记一条 `body_parse_failed` issue，不冒充 `available`。完整性是发送端的声明，不是接收端的测量。
- 截断在字符串中间的 JSON 碰巧可解析时，残缺正文会被当成完整；这类违约靠版本承诺与真实流量核对压住，发现新形状时升 `OTLP_MAPPING_VERSION` 修适配器，不静默容忍。

消息形状是 semconv 的 role/parts：每条消息 `{ role, parts: [...] }`，part 三型——`{ type:'text', content }`、`{ type:'tool_call', id, name, arguments }`、`{ type:'tool_call_response', id, response }`。ATC 的 `genai-semconv` 适配器据此解析消息、配对工具调用与结果、判定轮次收尾。

span status 映射为 harness 视角的成败，落原始层 `status_code`；ATC 不合成 HTTP 200，`request.status` 与费用仍只来自网关账本实得。**费用不进契约**：semconv 没有 cost 键，ATC 不发明扩展键，网关账本是费用的权威来源；没有 magpie 的全量行 `cost_state='absent'`。

参考实现见 `scripts/otlp-full-profile-export.ts`（`service.name='tracery-reference'`），向本机端点发一段合成会话的 OTLP/HTTP JSON traces，可作导出形状的对照样本。

## 登记

登记的全部成本是一个稳定的 `service.name`，加本仓 `src/sources/otlp/mapping.ts` 里一行选取规则。已登记的服务：

| service.name | harness | 选取规则 |
| --- | --- | --- |
| `claude-code` | Claude Code | span 名 `claude_code.llm_request` |
| `oh-my-pi` | OMP | `gen_ai.operation.name='chat'` |
| `codex_exec`、`codex_cli_rs` 等 originator 族 | Codex CLI | span 名 `session_task.turn` |
| `tracery-reference` | 全量级参考导出 | `fullProfileRule`，`gen_ai.operation.name='chat'` |

前三家是原生方言层，用各自的原生键族（Claude Code 是平铺 `input_tokens` 一族，OMP 用 `gen_ai.usage.*`，Codex 用 `codex.turn.token_usage.*`），登记按实际导出形状写规则，不要求改成上面的 profile，正文维持摘要级。`tracery-reference` 是全量级的第一个登记方，走 semconv 完整正文。新集成方按全量级导出时，加一行 `fullProfileRule(service, agent)` 即可。未登记的服务不建行：span 全量落原始层不丢，并按服务与日聚合记一行 `service_not_registered` issue——exporter 指过来就会被看见，补一行规则即建行。

Codex 是例外形态：它的 `service.name` 取 originator，同一份导出随入口变化（`codex exec` 为 `codex_exec`，交互 CLI 为 `codex_cli_rs`），且 `OTEL_SERVICE_NAME` 覆盖无效（2026-10-26 实测）。规范希望 exporter 报一个稳定值；做不到时，在登记时把这一族取值列进同一行规则。

## 版本承诺

profile 的语义变更随代码里的 `OTLP_MAPPING_VERSION` 走，改动在本仓的 Agent Note 里记录，不静默改。

## 双发不冲突

同一份导出双发给观测平台是常态；本文只约束发给 ATC 的这一路，不影响另一路。
