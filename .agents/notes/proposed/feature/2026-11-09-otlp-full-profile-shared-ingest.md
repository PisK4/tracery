# Agent Note: OTLP 全量接入 profile 与共享摄入编排核心

Status: proposed

## Problem

Tracery 的接入方定位是任一集成数据接入方案的 Agent Harness：团队自研 agent、自研网关、外部第三方项目都在内，不限本机自研，也不限已登记的三家。部署边界不变——监听写死回环，harness 与采集器同机。这个定位下现状有两个缺口。

对外没有全量契约。[接入 profile](../../../../docs/otlp-exporter-profile.md) 只承诺摘要级：`gen_ai.input/output.messages` 按结构化摘要处理，响应 id、完整正文、成败都没有契约位置。外部 harness 想把自己的一次调用完整交给 Tracery，没有规范可照做；[OTLP 接收端](../../implemented/feature/2026-10-25-otlp-receiver.md) 的第一条约束「OTLP 通道不提供正文的权威来源」是按各家 exporter 静默截断的实测定的，对愿意按契约完整导出的集成方不再成立。

对内摄入编排是两份。底层原语早已共享（`persistBodyTx`、`redact`、`insertEvidenceTx`、`markRequestInputTx`、`findRequestOwnerTx`），但「判重 → 关联认领 → 建行/复用 → 正文落块 → 证据登记 → 派生标记」这段流程在 [hook.ts](../../../../src/hook.ts) 的 `acceptHook` 与 [otlp/ingest.ts](../../../../src/sources/otlp/ingest.ts) 的 `persistMappedSpanTx` 各写一遍。分叉的代价已经可见：OTLP 行不写 `response_id_norm`，认领走独立的 `magpieTurnRequestTx`（`LIMIT 1`、不排除 `rejected`、不看候选唯一性），也不过投影。全量正文一旦进来，关联、落块、降级、投影每一环都要在 OTLP 侧再写一次。[跨通道去重](../../implemented/feature/2026-10-25-otlp-receiver.md) 在接收端 note 里 Deferred 至今，缺的就是这段编排。

生产现状加重了这个判断：[OTLP 摄入链路现状](../../../../docs/otlp-pipeline.md) 记录原始层与归属层差着五个数量级，通道框架完整但后半段没有调通。先收敛编排，再谈覆盖。

## Proposal

两部分：对外的全量 profile（发送端契约），对内的共享编排核心（接收端收敛）。两者同期交付——全量正文正是编排核心的第一个消费者，单独提前抽核心是没有消费者的重构。

### 全量 profile：一条 OTLP 道，两个层级

端点、认证、错误码全部不变（`/v1/traces`、`/v1/logs`、`otlp.token`）。profile 在现有[规范](../../../../docs/otlp-exporter-profile.md)上加一个全量级，与原生方言登记共存：

- **原生方言层**：Claude Code / OMP / Codex 的现有 `SPAN_RULES` 条目一行不动，键族、选取规则、`summary`/`body_ref` 正文纪律维持现状。Claude Code 接入零改动。
- **全量级**：集成方按 semconv 现有键完整导出，登记一个稳定 `service.name` 加一行规则即接入。键集在现有 profile 基础上加 `gen_ai.response.id`（跨通道认领锚点，已实测存在）；`gen_ai.input.messages` / `gen_ai.output.messages` 从摘要级升为完整正文。

全量级的核心是一条完整性契约：**正文键要么完整、要么缺席，不允许静默截断**。发送端负责关掉 SDK 的属性长度限制（`OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT` 等），接收端无法核验未截断部分，只能验证可解析性——正文 JSON 解析失败时降级 `summary` 并记 issue，不冒充 `available`。完整性是发送端的声明，版本承诺随 `OTLP_MAPPING_VERSION` 走，这条认识论边界写进 profile 文档。

span status 映射为 harness 视角的成败，落原始层与证据；不合成 HTTP 200，HTTP 状态与费用仍只来自账本实得（沿用 hook 的既有纪律）。**费用不进契约**：semconv 没有 cost 键，发明扩展键违反[两步走 note](../../implemented/feature/2026-10-26-otlp-exporter-profile-and-codex.md) 的不发明私有键立场；网关账本是费用的权威来源，harness 自报价格会造出第二个不可核验口径。无 magpie 的全量行 `cost_state='absent'`，估算价另议。

semconv 消息形状（role/parts）不是 anthropic/chat/responses 协议对象，正文落块后需要一个新的协议适配器进 `protocol-shape` 查表，消息解析、工具配对与派生随之生效；适配器交付前正文只读原文。`body_ref` 文件指针作为同机 harness 的可选正文通路保留，Claude Code 已在用。

### 共享编排核心：流程统一，证据身份不混

从 `acceptHook` 抽出编排核心：判重 → 关联认领 → 建行/复用 → 正文落块与降级 → 证据登记 → 派生标记。核心按通道参数化 `source_kind`、`have` 位、`via`、raw 写入器与身份材料（`responseIdNorm`、`turnRef`、归一用量、时间基准）。两个前端各留各的校验与原始层：

- hook 前端：envelope 校验、`origin='local'`、`raw_hook`、`pending_hook` 等待队列；
- OTLP 前端：解码、`raw_otlp_span`、白名单分类、未知服务门铃、`body_ref` 状态机。

OTLP 全量行经核心获得三样今天缺的东西：`response_id_norm` 落列、统一 owner 认领（删除 `magpieTurnRequestTx` 独立实现）、正文落块转 `available`。证据身份不混：OTLP 行仍挂 `otlp_span` 证据、`have` 第 4 位、`via='otlp'`，`hook_absent` 与 `otlp_yield` 的巡查口径不变。字段优先级沿用接收端 note 的不抢字段纪律：有 magpie 时状态、用量、费用以账本为准；无 magpie 时全量行自成完整记录。投影的字段来源不扩到 OTLP——全量行的模型与用量在建行时写入，投影对 OTLP 只贡献位图与缺失判定，维持[架构设计](../../../../docs/architecture-design.md)的现行分工。

行为变化只有一处：同一笔调用双通道并存从两行变一行。账本先到、OTLP 后到时，全量 span 按 `response_id_norm` 认领账本行（今天 OTLP 不写这列，只能独立建行）；反方向账本迟到认领 OTLP 行是已有行为。存量双行不靠新流量自愈，走 `maintain dedupe-sessions` 显式并入（来由见[跨来源模型名不参与调用身份比较](../../implemented/bug-fix/2026-11-04-session-model-name-dedupe.md)），执行范围与预览另行授权。

### 与既有提案的边界

supersession check 已做，关系四条：

- **部分取代**[OTLP 接收端](../../implemented/feature/2026-10-25-otlp-receiver.md)：「第一批不合并」的范围取舍由本篇承接（锚点已实测，合并策略即统一 owner）；「不提供正文权威来源」在全量级完整性契约下解除，原生方言层不变。Deferred 的跨通道去重由本篇交付；独有事实进读模型（`query_source_safe`、`attempt`、`agent_id` 谱系、工具 span 起止）仍 Deferred。实施时同步该 note 的事实层并互链。
- **部分取代**[两步走 profile note](../../implemented/feature/2026-10-26-otlp-exporter-profile-and-codex.md)：profile 从单级变两级，「不发明任何键」保持。实施时 profile 文档加全量级章节。
- **分工**[多来源身份归一](2026-11-04-multi-source-call-identity.md)：认领规则（owner 线索、用量指纹、会话归一）归那篇；本篇持有编排核心与 OTLP 接线。那篇第 7 节「OTLP 认领切到统一 owner，修 `rejected` 排除与唯一性」由本篇交付，落地时在那篇补交付记录，不重复实施。
- **不接**[F37 清单](../bug-fix/2026-11-04-open-bug-findings.md)的 skipped 计数与观测面修复；分类可见性归那篇裁决，本篇不动 `classifySpan` 三出口。

## Alternatives considered

**把 hook envelope 提升为公开接入契约。** 接收端零改动，magpie 插件已是它的客户端。落选：envelope 是私有方言，外部开发者没有理由为一个本机工具兼容私有键名与传输；两步走 note 已否决过发明私有规范，本篇不翻案。envelope 退回 magpie 内部契约。

**OTLP 转成 HookEnvelope 喂 `acceptHook`（字面意义的共享线路）。** 落选：等于让 OTLP 数据冒充 hook 证据——`source_kind='hook'`、`have` 第 1 位、`via='hook'`、写 `raw_hook`。四通道归因、`hook_absent`/`otlp_yield` 口径、replay 判重、hook 投递诊断四样全破。envelope 是 magpie 的线上契约，不是中性内部表示；共享必须建在编排层，不能建在契约上。

**只共享原语，编排保持两份（现状延续）。** 落选：全量正文进来后关联、落块、降级、投影每环都要在 OTLP 侧再写一遍，分叉继续扩大；跨通道去重永远停在 Deferred。原语共享已经证明方向，缺的是编排层这一步。

**发明 cost 扩展键让 harness 自报费用。** 落选：违反不发明私有键的立场；费用的权威来源是网关账本，自报价格不可核验，还会与账本读数打架。无 magpie 场景接受 `cost_state='absent'`。

**等 GenAI semconv 稳定再定全量契约。** 落选：63 个 `gen_ai.*` 键全是 Development，等不来；profile 恰是对非收敛期的对冲，两步走 note 已论证。

## Acceptance criteria

合成数据锁定：

1. 核心抽取后 hook 侧行为不变：`tests/hook.test.ts`、`tests/hook-identity.test.ts`、`tests/reconcile.test.ts`、`tests/merge-body-metadata.test.ts` 与 retention 用例全绿；弱窗关闭、COALESCE 只补空、partial 不抹正文各有断言。
2. 全量 profile span（完整 messages + `gen_ai.response.id`）建行：`body_state='available'`、正文可读、`response_id_norm` 落列、带会话 id 进派生组；semconv 适配器解析出消息与工具调用。
3. 同一调用双方向到达：账本先到 OTLP 后到、OTLP 先到账本后到，都只一行、`request_evidence` 两种来源、用量以账本为准不相加。
4. 正文 JSON 解析失败：降级 `summary` 加 issue，不标 `available`；缺正文键的行不标采集失败（期望位图只看第 4 位）。
5. 同一 span 重发零新行；`otlp-replay` 在升版后把旧 raw span 按新规则落位，判重不依赖 hook 证据。
6. 原生方言回归：`tests/otlp-*.test.ts` 全绿，Claude Code / OMP / Codex 规则与配置零改动。
7. 无 magpie 场景：全量行独立建行、正文落块、派生完整，`cost_state='absent'`。

真实流量验收单独一轮：一个按全量 profile 导出的合成 harness 与 Claude Code 原生导出各跑一轮会话，核对建行、正文、认领与双通道去重；结果记[验收记录](../../../../docs/acceptance.md)，合成与真实分开写。

## Risks

- **抽取动到三路合并的守卫细节。** `acceptHook` 是本仓最久经考验的合并路径，弱窗关闭、只补空、partial 保护都是踩坑换来的。走 worktree 分支，上述五组窄测试先锁定现状再动刀；测试不齐会静默改行为。
- **完整性无法在接收端核验。** 截断在字符串中间的 JSON 碰巧可解析时，残缺正文会被当成完整。契约只能约束声明与可解析性，剩余风险靠 profile 版本承诺与真实流量首周核对压住；发现违约形状时升版修适配器，不静默容忍。
- **双通道两行变一行是可见行为变化。** 会话时间线与计数会变；存量合并必须显式执行并记录范围，未合并的存量不能描述成已修复。
- **全量正文放大落盘量。** `raw_otlp_span` 本就在正文预算口径外（F38），全量正文进块库会加重 body 预算压力；上线与容量联动评估同批做，不单独立项。
- **与多来源提案的实施交叉。** 统一 owner 的切换只在本篇做一次；那篇后续增强认领规则时改的是 `findRequestOwnerTx`，两条线自动受益，不需要再次接线。