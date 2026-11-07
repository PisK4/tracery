# Agent Note: Magpie operation 会话准入

Status: implemented

## Problem

Tracery 的 Magpie 账本入库不做语义筛选，用途层又把未识别请求兜底成 `chat` / `participate`。一笔没有会话身份的非对话请求因此拿到回退组键，在左栏变成独立会话卡。

2026-11-07 的生产只读快照里，左栏首屏 50 个会话有 47 个带 `AsyncOpenAI` 标签，flags 是 `unknown` + `missing_body`，没有进入现有折叠。`operation=embeddings` 的账本行当时已有 733 笔，其中 65 笔失败；`curl` 也出现 7 笔 embedding。`AsyncOpenAI` 标签下另有 5 笔普通聊天端点的失败请求。客户端标签和模型名都不能区分这两类调用。

Magpie 的 usage Record 已经输出 `operation`：embedding、rerank、音频转写/翻译、图片/视频生成各有显式值。Tracery 在 [mapLedgerRow](../../../../src/sources/magpie/mapping.ts) 没有读取这个字段，[来源事实](../../../../src/sources/facts.ts) 与 [用途视图](../../../../src/request-purpose.ts) 也不携带它。这些请求的 `ep` 与 `kind` 又常为空，现有规则没有任何正向事实可用，只能落进 [兜底判定](../../../../src/harness/purpose.ts)。

痛点不止左栏噪音。非对话请求一旦参与主链，就会进入祖先集合、轮次结算和混合会话的前驱判定。只在页面过滤会留下后端污染；按客户端或模型追加黑名单，则会误伤同标签的正常生成请求，也漏掉其它客户端发出的同类操作。

## Decision

入库边界不动。账本、路由、hook 与 OTLP 仍按现行规则保留证据，失败状态、用量、费用与原始 payload 不丢。会话 trace 的默认展示是显式准入：用途阶段消费 `operation`，并把它持久化为来源事实，原始账本过期后判定依据仍在。

规则分三类：

- 已登记的非对话 operation 写成 `purpose_chain='exclude'`，`req_kind` 取 operation 值本身。全员 exclude 的组沿用现有 bypass 折叠（`has_participate=0`），中栏压成辅助记录，不进入轮次和主链祖先。
- `operation` 空或缺失时不出结论，继续按协议、端点、来源 kind 与正文判定。普通 LM turn 大多省略 operation，显式 operation 白名单不套在所有行上。
- 未登记的显式 operation 保留证据，落 `unrecognized` + `operation:<value>` + `exclude`，结算时写 `ingest_issue`（`source_kind='ledger'`、`reason='operation_unregistered'`、按请求 upsert），不兜底 chat。

落点按现有分层：[账本映射](../../../../src/sources/magpie/mapping.ts) 用 `stringField` 读 `operation` 并记 shape 状态，[投影](../../../../src/sources/projection.ts) 携带逐行观测（含 null=缺失/非法）进 [来源事实](../../../../src/sources/facts.ts) 的 `operation` 有界集合，[用途编排](../../../../src/harness/purpose.ts) 从长期事实消费。优先级固定为 Harness 强指纹 > operation > 来源 kind > 标题兼容 > 兜底；operation 插在来源 kind 之前，纠正 `source:mcp` 这类仍参与链的非对话行，不覆盖已识别标题的 `model_title`，也不替代 Harness 强指纹。operation 与来源 kind 一样只对没有旧解释的行生效，且不依赖正文可读性——非对话请求常没有 hook 正文，operation 是这类行唯一的正向用途事实。

版本：`PURPOSE_VERSION` 11→12，`SOURCE_PROJECTION_VERSION` 1→2（映射新读 operation、事实形状扩展）；`GROUP_ALGORITHM` 与 `DERIVE_ALGORITHM` 不动，组与切片算法本身没变，重判经输入标脏触发。旧来源事实缺 `operation` 键按未观测兼容读取，不触发未知值隔离。

历史回填走 `maintain operation-backfill`（[运维手册](../../../../docs/operations.md#operation-backfill)）：候选是事实缺键且 raw 账本仍带显式文本 operation 的行，预览只取 operation 分布与会话键；应用逐笔重投影补齐事实，并按输入变化 `markRequestInputTx` 标脏，用途随正常 tick 重判升级。提案原文写「再按显式 rebuild 升级」，交付改为输入标脏：事实补齐是真实的派生输入变化，与在线摄入同口径，数百个回退组键不必逐一 rebuild；整链重建仍可选走 [rebuild](../../../../docs/operations.md#rebuild)。raw 没有 operation 或已过期的行不在候选里，不凭模型名或客户端标签猜用途。

## Operation 归类

| operation | 上游语义 | 归类 |
| --- | --- | --- |
| 空或缺失 | 普通 LM turn 常省略；模型列表与探针也混在其中 | 不出结论，按协议、端点、kind 与正文判定 |
| `embeddings` | 向量生成 | 非对话，exclude |
| `rerank` | 检索重排 | 非对话，exclude |
| `transcriptions` | 语音转文字 | 非对话，exclude |
| `translations` | 语音翻译 | 非对话，exclude |
| `generate_content` | 图片/视频生成 | 非对话，exclude |
| `execute_tool` | 生产见于 MCP vision/image | 未登记，走未知桶隔离并记 issue |
| 其它显式值 | 未登记 | 隔离计数并记 issue，不兜底 chat |

登记集合核对过 magpie 检出 3173440ca（2026-10-26）的赋值锚点：`embeddings.go` 的 retrieve 参数经 `gateway.go` 路由表传入 embeddings/rerank/transcriptions/translations，`draw.go` 与 `video.go` 写 `generate_content`。`execute_tool` 在该检出没有赋值点，虽然生产已出现，仍不列入永久契约——它走未知桶同样排除链，只是带漂移计数；上游锚点核对后再登记，届时 issue 自然消失。`generate_content` 按 Magpie 的图片/视频路径归类，不按端点字符串推断；Gemini 的 `:generateContent` 端点可能是普通对话，仍走协议与正文判定。

## 与现有记录的关系

活动树里没有其它记录持有 Magpie operation 的会话准入决策。本记录与以下记录互补，不取代它们：

- [请求用途与链](2026-10-22-request-purpose-and-chain.md) 继续持有版本化用途与显式升级；本记录只新增 operation 规则。
- [来源字段按上游真实键读取](2026-10-22-source-projection-and-field-fidelity.md) 持有字段保真落点；operation 是同类未上浮字段。
- [无正文探针记录默认折叠](../feature/2026-11-01-probe-records-default-fold.md) 的 probe kind 白名单不变；本记录补上探针折叠覆盖不到的非对话请求。
- [OMP harness 集成](../feature/2026-10-25-omp-harness-integration.md) 的 bypass 折叠机制被复用，不新增第二套列表过滤。
- [不可读 trace 的默认阅读投影](../feature/2026-10-31-unreadable-trace-recovery.md) 继续处理正文缺口；缺正文不等于非对话。
- [数据源契约漂移检测](../../proposed/feature/2026-11-04-source-contract-drift.md) 承接未知 operation 的 issue 与告警；本记录先按请求计数落 `ingest_issue`，四层检测落地后并入。
- [Agent Profile 与请求类别注册表](../../proposed/architecture/2026-10-22-agent-request-kind-registry.md) 仍是 agent 语义的输入材料；operation 是来源层事实，不挂到某个 Agent Profile。

## Alternatives considered

**按 `AsyncOpenAI`、`OpenAI` 或 `curl` 做客户端黑名单。** 落选：`AsyncOpenAI` 同时承载普通生成请求，生产已有同标签聊天失败行；`curl` 也能发 embedding。客户端标签是传输指纹，不是用途。

**按 embedding 模型名或 provider 过滤。** 落选：模型别名、路由组和供应商变化都会绕过规则；模型名也没有 operation 的上游权威性。

**入库时拒绝非对话请求，或不建 request。** 落选：失败 embedding 是 provider 连通性证据，用量和费用也要保留。hook 侧没有 operation，摄入拒绝只能覆盖账本，还会留下历史回填缺口。

**只在会话列表或页面过滤。** 落选：主链、轮次、摘要和混合会话前驱仍把非对话请求当参与链。其它读取消费者也会绕过 UI 规则。

**按无 session、无正文、单笔请求的结构特征折叠。** 落选：真实 curl 调试和采集缺口也长这样。[探针折叠](../feature/2026-11-01-probe-records-default-fold.md) 已否决过这条结构启发式。

**等 Magpie 把操作塞进 `kind`。** 落选：`operation` 已存在；`kind` 现行语义是旁路用途与探针类别，混用会破坏现有来源 kind 判定。

**要求所有放行行都有显式 operation。** 落选：普通 LM turn 大多省略 operation。这样会隐藏主流量，必须保留空 operation 的协议判定路径。

**回填后逐会话显式 rebuild 升级用途。** 落选：事实补齐是真实的派生输入变化，在线摄入遇到同样的变化走 `markRequestInputTx`；数百个单笔回退组键逐一 rebuild 是把输入变化伪装成规则升级。rebuild 保留为整链重建的可选入口。

**把 `execute_tool` 直接登记为非对话。** 落选：当前 Magpie 检出没有赋值锚点，未核对的值不写成永久契约。未知桶同样排除链，核对前多一条漂移计数是可接受的代价。

## Consequences

非对话请求不再进入主链、祖先集合与轮次结算；左栏单笔 embedding 组复用 bypass 折叠，用量、费用、失败状态与原始证据全部保留。operation 进长期事实后，raw 过期仍可重判；未知值有结构化 issue，新协议不会被白名单静默漏掉。

代价与边界：

- 有旧 `purpose_version` 的行正文回收后仍走 retained，operation 不覆盖旧解释——这与来源 kind 的保留语义一致；目标群体（无正文、无旧版本）不受影响。
- raw 已过期的历史行补不回 operation，保持原判定，不补猜。
- `execute_tool` 暂在未知桶，每次结算按请求 upsert 一条 issue；上游核对前这是有意的噪音。
- 非对话请求与旁路会话共用 bypass 折叠入口，计数文案如实区分，正常态不新增装饰性标签。
- 回填只覆盖判定可能改变的行；raw 无 operation 的旧事实保持旧格式，兼容读取路径兜底，不做全库事实重写。

## Testing

合成验收钉住：已知 operation 无正文排除链、未知值隔离并记 issue（重判不重复计数）、缺失走协议参与主链、客户端标签不影响结论、Harness 强指纹与 retained 的优先级、operation 先于来源 kind、事实集合幂等与旧格式兼容、raw 过期不撤销集合、回填预览/应用/幂等与损坏事实修复。用途、投影、事实、映射与回填的最窄测试与全量套件结果记在[验收记录](../../../../docs/acceptance.md)。

## Deferred

- 生产库的回填预览、应用与真实流量验收：与合成验收分开记录，待显式执行。
- `execute_tool` 的上游赋值锚点核对与登记。
- 非对话请求的独立诊断面与多模态产出阅读：有真实阅读需求时再单独立项。