# Agent Note: OTLP 映射升级后的 raw 重放路径

Status: implemented

## Problem

映射规则按 `(service.name, 选取规则)` 演进，`OTLP_MAPPING_VERSION` 随之前进。但分类只发生在摄入时：raw 层里的旧版本行永远不会被当前规则重新看一遍。规则修好了，已经落库的 span 救不回来——它们按 raw 保留期（7 天）过期删除。

缺口在 2026-11-03 兑现：v3 白名单只认下划线取值（`codex_app_server`），真实上报是连字符（`codex-app-server`）。15 条 `session_task.turn` 落在原始层，0 条证据，`otlp_yield` 巡查已经报 over（LLM span 15，匹配证据 0）。按 `received_at + 7d`，这批 span 在 2026-11-10 傍晚陆续过期，过期不可恢复。当时的 reparse 只重写正文适配器，OTLP 映射没有对应入口。

## Decision

`maintain otlp-replay` 按 `mapping_version < OTLP_MAPPING_VERSION` 筛 `raw_otlp_span`，用当前 `classifySpan`/`mapSpan` 重跑分类，把「span → 证据/建行」交给 [ingest 抽出的落库段](../../../../src/sources/otlp/ingest.ts) `persistMappedSpanTx`。三段边界：

- 抽取只含落库段（认领 magpie turn 行或建行、登记证据、回接 pending body_ref）。raw 写入与分类判定留在 ingest 循环：重放只读 raw，不重写它。
- `received_at` 与 `attributes_json` 不动。`received_at` 是保留期时钟，重放刷它等于延长 TTL、掩盖原始版本。
- 三种分类都回写 `mapping_version`。skipped 也回写——生产待重放的 157,686 行里 skipped 占 157,607，不回写则每次 `--apply` 重复扫同一批行，巡查永远报可重放。

unknown 的行写 `span_shape_unknown` issue（`INSERT OR IGNORE`，幂等），理由键与摄入一致。写入按 100 行一批开事务（节奏同 retention 的 `PRUNE_BATCH`），单事务不因 15 万行扫描而拉长。

`otlp_yield` 改 detail 而不是新增计数维度：窗口内 mapping_version 落后当前规则的行数直接进 detail 报「可重放 N」。下次映射升级时，告警自己会说出缺口。

## Alternatives considered

**新建 observer 模块复制分类逻辑。** 重放与摄入各持一份规则表，两边迟早分叉。共用 `classifySpan`/`mapSpan` 后，规则只有一张表，改表即升级版本。

**复用 `acceptOtlpTraces` 循环重放。** 两个错误：`rawStmt` 的 `received_at` 传 now，等于重置 7 天 TTL；`existingStmt` 判重后 continue，已有证据但版本落后的行会被跳过，重放对它们不生效。

**把 skipped 报进 `partialSuccess.rejectedSpans`。** 客户端会把 skipped 当拒收重发，制造重试风暴。skipped 是确认非 LLM 的内部 span，不是拒收。

**新增独立计数维度跟踪可重放。** `otlp_yield` 已是唯一产出比哨兵，detail 加一个读数够用，不动快照结构。

## Consequences

预览口径（2026-11-07 生产库只读）：scanned 157,686、evidence 15、wouldCreate 0、unknownShape 64、skipped 157,607、expired 0。15 条 turn span 全部认领既有 magpie 行，只写证据不建行；应用后证据 15、版本全为 4，连跑第二遍 scanned 0。

代价有三笔。其一，64 条 v3 `handle_responses`（带 `gen_ai.usage` 但规则没认）从 `service_not_registered` 改判为 `span_shape_unknown`：64 低于阈值 100 不翻红，旧 issue 行保留，两类并存。其二，重放映射读的是 raw 里的脱敏属性：映射键（token 用量、model、`thread.id`）不受脱敏影响，但若未来某条规则只在未脱敏值上成立，重放与实况会不一致——新规则动笔时要把这条边界算进去。其三，离线重放没有磁盘预算检查（admission 按 normal）：body 接线分支对当前目标不可达，真到有 pending body_ref 的批次时，维护窗口默认磁盘健康。

验证：[otlp-replay 测试](../../../../tests/otlp-replay.test.ts)覆盖认领、新建、skipped 回写、幂等与过期计数；ingest 抽取由既有 otlp-ingest 15 例回归兜底。
