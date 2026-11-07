# Agent Note: Magpie operation 会话准入

Status: proposed

## Problem

Tracery 的 Magpie 账本入库不做语义筛选，用途层又把未识别请求兜底成 `chat` / `participate`。一笔没有会话身份的非对话请求因此拿到回退组键，在左栏变成独立会话卡。

2026-11-07 的生产只读快照里，左栏首屏 50 个会话有 47 个带 `AsyncOpenAI` 标签，flags 是 `unknown` + `missing_body`，没有进入现有折叠。`operation=embeddings` 的账本行当时已有 733 笔，其中 65 笔失败；`curl` 也出现 7 笔 embedding。`AsyncOpenAI` 标签下另有 5 笔普通聊天端点的失败请求。客户端标签和模型名都不能区分这两类调用。

Magpie 的 usage Record 已经输出 `operation`：embedding、rerank、音频转写/翻译、图片/视频生成各有显式值。Tracery 在 [mapLedgerRow](../../../../src/sources/magpie/mapping.ts) 没有读取这个字段，[来源事实](../../../../src/sources/facts.ts) 与 [用途视图](../../../../src/request-purpose.ts) 也不携带它。这些请求的 `ep` 与 `kind` 又常为空，现有规则没有任何正向事实可用，只能落进 [兜底判定](../../../../src/harness/purpose.ts)。

痛点不止左栏噪音。非对话请求一旦参与主链，就会进入祖先集合、轮次结算和混合会话的前驱判定。只在页面过滤会留下后端污染；按客户端或模型追加黑名单，则会误伤同标签的正常生成请求，也漏掉其它客户端发出的同类操作。

## Proposal

入库边界不动。账本、路由、hook 与 OTLP 仍按现行规则保留证据，失败状态、用量、费用与原始 payload 不丢。会话 trace 的默认展示改成显式准入：用途阶段消费 `operation`，并把它持久化为来源事实，避免原始账本过期后失去判定依据。

规则分三类：

- 已知非对话 operation 写成 `purpose_chain='exclude'`，`req_kind` 使用稳定的 operation 类别。全员 exclude 的组沿用现有 bypass 折叠，中栏压成辅助记录，不进入轮次和主链祖先。
- `operation` 空或缺失时，继续按协议、端点、来源 kind 与正文判定。普通 LM turn 大多省略 operation，不能把显式 operation 白名单直接套在所有行上。
- 未登记的显式 operation 保留证据，默认不进主会话，并写入结构化 issue 与契约漂移计数。未知值不兜底成 chat。

落点按现有分层走：[账本映射](../../../../src/sources/magpie/mapping.ts) 读取 `operation`，[投影](../../../../src/sources/projection.ts) 与 [来源事实](../../../../src/sources/facts.ts) 持久化，[用途编排](../../../../src/harness/purpose.ts) 消费。operation 判定不覆盖已识别标题的 `model_title`，也不替代 Harness 强指纹；它插在来源 kind 兜底之前，用来纠正 `source:mcp` 这类仍参与链的非对话行。

历史数据从仍保留的 `raw_ledger.payload_json.operation` 回填或重投影，再按 [显式 rebuild](../../../../docs/operations.md#rebuild) 升级受影响会话。用途规则变化需要升 `PURPOSE_VERSION`；来源事实形状变化需要升对应投影版本。原始账本已经过期、没有 operation 的行不凭模型名或客户端标签猜用途。

## Operation 归类

| operation | 上游语义 | 拟归类 |
| --- | --- | --- |
| 空或缺失 | 普通 LM turn 常省略；模型列表与探针也混在其中 | 继续按协议、端点、kind 与正文判定 |
| `embeddings` | 向量生成 | 非对话，exclude |
| `rerank` | 检索重排 | 非对话，exclude |
| `transcriptions` | 语音转文字 | 非对话或工具事件，exclude |
| `translations` | 语音翻译 | 非对话或工具事件，exclude |
| `generate_content` | 图片/视频生成 | 非对话或产出事件，exclude |
| `execute_tool` | 生产见于 MCP vision/image | 工具事件，exclude；实施前补上游赋值锚点 |
| 其它显式值 | 未登记 | 隔离计数并记 issue，不兜底 chat |

`generate_content` 按 Magpie 的图片/视频路径归类，不按端点字符串推断。Gemini 的 `:generateContent` 端点可能是普通对话，仍走协议与正文判定。`execute_tool` 在当前 Magpie 源码检出里未定位到赋值点，但生产已经出现；实施前要补一次上游版本核对，不能把未核对的值写成永久契约。

## 与现有记录的关系

活动树里没有记录持有 Magpie operation 的会话准入决策。本提案与以下记录互补，不取代它们：

- [请求用途与链](../../implemented/architecture/2026-10-22-request-purpose-and-chain.md) 继续持有版本化用途与显式升级；本提案只新增 operation 规则。
- [来源字段按上游真实键读取](../../implemented/architecture/2026-10-22-source-projection-and-field-fidelity.md) 持有字段保真落点；operation 是同类未上浮字段。
- [无正文探针记录默认折叠](../../implemented/feature/2026-11-01-probe-records-default-fold.md) 的 probe kind 白名单不变；本提案补上非 operation 探针无法覆盖的非对话请求。
- [OMP harness 集成](../../implemented/feature/2026-10-25-omp-harness-integration.md) 的 bypass 折叠机制被复用，不新增第二套列表过滤。
- [不可读 trace 的默认阅读投影](../../implemented/feature/2026-10-31-unreadable-trace-recovery.md) 继续处理正文缺口；缺正文不等于非对话。
- [数据源契约漂移检测](../feature/2026-11-04-source-contract-drift.md) 承接未知 operation 的 issue 与告警。
- [Agent Profile 与请求类别注册表](2026-10-22-agent-request-kind-registry.md) 仍是 agent 语义的输入材料；operation 是来源层事实，不挂到某个 Agent Profile。

## Alternatives considered

**按 `AsyncOpenAI`、`OpenAI` 或 `curl` 做客户端黑名单。** 落选：`AsyncOpenAI` 同时承载普通生成请求，生产已有同标签聊天失败行；`curl` 也能发 embedding。客户端标签是传输指纹，不是用途。

**按 embedding 模型名或 provider 过滤。** 落选：模型别名、路由组和供应商变化都会绕过规则；模型名也没有 operation 的上游权威性。

**入库时拒绝非对话请求，或不建 request。** 落选：失败 embedding 是 provider 连通性证据，用量和费用也要保留。hook 侧没有 operation，摄入拒绝只能覆盖账本，还会留下历史回填缺口。

**只在会话列表或页面过滤。** 落选：主链、轮次、摘要和混合会话前驱仍把非对话请求当参与链。其它读取消费者也会绕过 UI 规则。

**按无 session、无正文、单笔请求的结构特征折叠。** 落选：真实 curl 调试和采集缺口也长这样。[探针折叠](../../implemented/feature/2026-11-01-probe-records-default-fold.md) 已否决过这条结构启发式。

**等 Magpie 把操作塞进 `kind`。** 落选：`operation` 已存在；`kind` 现行语义是旁路用途与探针类别，混用会破坏现有来源 kind 判定。

**要求所有放行行都有显式 operation。** 落选：普通 LM turn 大多省略 operation。这样会隐藏主流量，必须保留空 operation 的协议判定路径。

## Acceptance criteria

- 合成账本行带 `operation=embeddings`、正文 pending、无 session：用途结算为 exclude 与稳定 operation kind；会话组带 bypass 折叠；用量、费用、失败状态与原始证据保留。
- 同 fixture 去掉 operation、保留支持的聊天协议：仍参与主链。`AsyncOpenAI` 标签不改变结果；`curl` 带 embedding operation 同样排除。
- 未登记显式 operation：不兜底 chat，产生结构化 issue 与隔离计数；登记后按新规则重判。
- 混合组里有一笔参与链请求时整组不折叠；标题请求的 `model_title` 不被 operation 规则覆盖。
- operation 进入长期来源事实后，原始账本过期仍可重判；旧来源事实缺字段时兼容读取。回填与重投影幂等。
- 历史升级先只读预览候选 operation、会话键与影响行数，再显式 rebuild；非目标行用途不变。真实库操作与合成验收分开记录。
- 生产验收：首屏不再被 embedding 单请求组占据；折叠计数可展开；失败 embedding 仍可查；未知 operation 在健康入口可见。
- 交付跑受影响的最窄测试、`bun run typecheck` 与 `bun run verify:notes`。

## Risks

- Magpie 的 `operation` 是开放字符串，上游可能新增值或复用旧值。未知值隔离与契约漂移告警必须同批交付，否则白名单会静默漏掉新协议。
- `execute_tool` 与 `generate_content` 的语义需要上游版本核对。核对前只把证据充分的值列入规则，其余进未知桶。
- 原始账本有 TTL，历史回填覆盖不到已过期行。这些行保持原判定或未知，不补猜。
- 用途阶段若临时读取 raw payload，会增加一次解析成本。长期事实持久化是首选，临时读取只能作为有界回填路径。
- 复用 bypass 折叠会让非对话请求与旁路会话共用一个入口。计数文案要如实区分，正常态不新增装饰性标签。
- 本轮放弃非对话请求的独立诊断面与多模态产出阅读；它们以后有真实阅读需求时再单独立项。