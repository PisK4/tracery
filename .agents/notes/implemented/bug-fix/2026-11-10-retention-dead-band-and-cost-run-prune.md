# Agent Note: 磁盘降级的跨 tick 死带与未匹配费用观测清理缺口

Status: implemented

## Problem

2026-11-10 03:50，生产数据目录到 12.779 GB，占 16 GB 预算的 79.87%，准入切到 `metadata_only`（`disk_budget`），正文暂停。此后约 8 小时没有恢复，当天丢弃 199 笔正文（`miss_reason=disk_body_paused`）。

直接原因是两个阈值之间有一段死带。准入在总盘 80% 降级，跌回 75% 以下才恢复（`DISK_METADATA_RATIO` / `DISK_RESUME_NORMAL_RATIO`）；磁盘回收也只在 80% 以上启动，目标是 75%（`DISK_EVICT_TARGET_RATIO`）。回收每 30 秒一轮、每轮受 2 秒墙钟限制，一轮只淘汰约 800 笔、释放约 20 MB。它把占用从 80% 压到 79.87% 后就跌回触发线以下，下一轮 `enforceBodyBudget` 在函数开头直接返回 0；准入却要等 75% 才恢复，谁也不再推动占用继续下降。

另一笔压力来自 `cost_observation`。生产库该表占 1.31 GB，其中未匹配费用行 593,379 行 / 473 MB 逻辑量，7 天前的有 535,012 行 / 427 MB。10-20 的保留方案写明「未匹配/歧义行使用 `['cost-run',run_id,page_offset,row_index]` 暂存键……按原始层 7 天清理并记录计数」（`docs/superpowers/plans/2026-10-20-collector-foundation.md:469`），但 `pruneRaw` 的候选与删除路径从未实现这一路。这些行写后无人读取，只有同一 `ref_key` 的最新投影用于冲突判断。

## Decision

回收增加跨 tick 的续跑条件。`RetentionBudget` 新增 `diskPressure`；`retentionTick` 每次先 `gate.check(0)`，在准入仍为 `metadata_only` / `paused` 且 `reason=disk_budget` 时传入。`enforceBodyBudget` 的磁盘判断从「总盘 ≥ 80%」改为「总盘 ≥ 80%，或降级且总盘仍高于 75% 目标」。降级期间每轮继续淘汰，直到占用回到目标线；准入恢复正常后压力条件自动消失，不到 80% 不回收的常态行为不变。

`pruneRaw` 的候选与删除路径增加 `costRun` 一路：候选按主键前缀区间 `ref_key >= '["cost-run"' AND ref_key < '["cost-rv"'` 加 `observed_at < beforeMs` 读取，该前缀区间只用于到期枚举，最新观测仍按方案的等值查询，不走全表 LIKE；删除与其它 raw 表共用单批行数与载荷预算，返回计数，`main.ts` 的 `raw_prune` tick 据此触发收缩。已匹配证据键不以该前缀开头，不受影响。

新增 `maintain prune-raw`，把小时级 tick 的同一套清理一次跑到没有候选为止，默认截止点为 `now - RAW_TTL_MS`，`--before` 可覆盖。默认只预览未匹配 `cost-run` 的行数与逻辑字节；`--apply` 需要 `--approval-id`、维护锁与停服，删除后按更大的收缩预算回收空闲页。存量超过一个 tick 时用它，不另写一次性脚本。

## Alternatives considered

**把 `ATC_DISK_LIMIT` 提高到 24/32 GB。** 只是把同一条死带推迟几天到几周；未匹配费用观测的持续积累也没有解决。

**只按磁盘压力淘汰正文，不改触发条件。** 能立刻解套，但要为 0.78 GB 缺口删掉约 2.9 万笔最旧正文；而同一时刻有 1 GB 的未匹配费用观测可以先清，正文不必先动。

**把准入恢复线改成 80%。** 恢复与降级同线，会在阈值附近反复切换；滞回本来就是为消除这种抖动。

**一次性脚本删除存量。** 不进入运维命令登记表，不可复用，也无法让小时的常规清理跟上后续增量。

**单独写一个只清 `cost-run` 的维护命令。** 会复制候选、批界与收缩逻辑；`prune-raw` 跑的是与小时 tick 相同的完整 raw TTL 清理，命名与行为一致。

## Consequences

降级期间回收会连续多个 tick 各占用最多 2 秒，直到占用回到 75%；这段时间事件循环的最大延迟可能被监控记为越界。这是把「停着不动」换成「有界地干完」的代价。

未匹配费用观测只有暂存键、没有归属请求，删除后不重算投影；同一 `ref_key` 的最新投影仍保留到到期，冲突判断不受影响。7 天规则从此真正执行，`cost_observation` 的增长回到与其它 raw 表同一口径。

存量 535,016 行通过一次 `prune-raw --apply` 清完。cost_observation 物理占 1.31 GB，待删行占其中约八成；按页占比估算可释放约 1 GB，目标是把总盘拉回 12.0 GB 以下。若实际释放不足，部署后的跨 tick 续跑会继续淘汰最旧正文到 75%，不会停在死带里。若只靠小时 tick，按每小时约 2 万行需要约一天。16 GB 预算与长期元数据增速（`request` 每笔含索引约 4 KB）仍需单独评估，本次不改变预算。

## Testing

`tests/retention.test.ts` 新增两个窄回归：未匹配 `cost-run` 观测按截止点删除、已匹配与未到期行保留；占用在 75–80% 之间且 `diskPressure` 开启时，单轮只淘汰一批，连续调用继续回收到 75% 目标，而正常态同一占用不回收。`tests/maintenance.test.ts` 覆盖 `prune-raw` 的预览与 `--apply` 删除计数；`tests/commit-unit.test.ts` 的 prune 结果补 `costRun: 0`。`bun run typecheck` 干净，retention、commit-unit、maintenance 三个文件 80 项通过。

生产部署、`prune-raw` 实际释放量与准入恢复的真实流量验收记录在[验收记录](../../../../docs/acceptance.md)。

## Related

[保留清理的单批边界与磁盘回收目标](2026-11-05-retention-batch-bounds-and-disk-target.md) 持有单批边界与 80% 触发、75% 目标的决策；本记录只补跨 tick 的续跑条件，不改变那两个水位。
