# Agent Note: dedupe 的 response id 线索被源行自身污染

Status: implemented

## Problem

`dedupe-sessions` 上线后对 response id 重复无能为力：`response_id_norm` 重复组（2026-11-04 起 12 组，速率约 4 组/天）全部卡在 `ambiguous` 计数里，`candidates` 恒为 0。这些组是同一笔调用的会话行与 hook/账本行各留一行，四段用量逐段相等，`usage_fingerprint.v1` 本可以唯一认领。

根因在调用形状，不在规则强度。dedupe 的源行自己也带同一个 `response_id_norm`，而 `byResponseId` 搜的是全表同键行（不排除源行自身），对源行只有两种结果：唯一命中就是源行自己（`reqId === row.req_id`，静默跳过，无用），两行以上就是歧义（`ambiguous` 短路返回）。歧义返回后，后面的强指纹永远轮不到。跳过 response id 线索不损失任何认领能力：dedupe 场景下不存在「唯一命中别行」的形态——任何真实重复都至少两行同键。

相关背景见[跨来源模型名不参与调用身份比较](./2026-11-04-session-model-name-dedupe.md)：dedupe-sessions 的合并主干由那条决策建立，本次只改线索编排。[多来源身份归一提案](../../proposed/feature/2026-11-04-multi-source-call-identity.md)里的两条链（归一化、dedupe）对这批数据均验证过无效：库里存的已是归一后键，没有可改的列。

## Decision

`OwnerQuery` 增加可选的 `skipResponseId`，dedupe 的 `analyze()` 传 true：第 1 条线索整条跳过，从 turn ref 起线索次序不变。摄入路径（hook、OTLP、direct）不传，行为逐位不变。

弱线索拒绝逻辑不动：落到 `conv_time_model.v1` 的行只进 `weak_only`，不在事后改行；四段用量缺任一段不猜。合并仍然只出自强线索的唯一命中。

## Alternatives considered

**在 dedupe 里复制一份线索编排，只挑想要的线索。** 两处编排必然分叉；owner.ts 的线索次序与窗口常量改一处时另一处会漏。

**把 response id 歧义改为「不短路、继续试后面的线索」。** 歧义结果要缓存到最后再比较，实现与解释成本都高于整条跳过，收益相同。

## Consequences

- 2026-11-07 生产库只读预览：旧代码 scanned 55,233 / candidates 0 / ambiguous 175 / weak_only 42；新代码 candidates 13、ambiguous 181、weak_only 45。13 个候选与 13 组重复键逐组对应。
- ambiguous 与 weak_only 的计数上升是口径变化，不是误合并风险：30,524 行「response_id 唯一命中自己」的行，旧代码静默 `continue`（不进任何计数），跳过线索后它们被后续线索如实评估，多候选的进 ambiguous、只有弱窗能配上的进 weak_only。合并仍只出自强线索唯一命中，两版代码的 merged 集合对这批数据同为空集。
- 评审快照预言的「ambiguous 不减少」与实测不符：multi 组（-13）移入 candidates，unique-self 行（+19）进入 ambiguous。快照把 162 条歧义行归到了错误的线索上；以本节实测为准。
- 写路径竞态仍在产生新重复（评审后新增 1 组）。存量修复只清已有账；增量侧的 hook 回落认领另行立项，另开 note。

## Testing

- `tests/session-dedupe.test.ts` 两个新钉子：response id 同键双行按用量指纹并回（修复前 candidates 恒 0）；同键但用量不一致只落 `weak_only`，不合并。
- `tests/owner-fingerprint.test.ts`、`tests/droid-dedupe.test.ts` 全量回归：摄入路径线索次序不受影响。
- 应用验收（待生产执行）：重复组 13 → 0；`dedupe-sessions` 连跑两遍第二次 candidates 为 0。
