# Agent Note: 仓库可发现性与 trajectory 对外口径

Status: implemented

## Problem

仓库推到 GitHub 后，站内搜索和 Google 摘要没有可用文字：`gh repo view` 查到 description 为空、topics 为空、homepage 为空。README 反过来已经写满，首屏讲记录单位与阅读方式，但通篇没有 Agent 研究圈用来检索的 trajectory 一词；中文版第 16、24 行写「中栏轨迹」「重建为逐笔轨迹」，英文版与仓库设置都没有对应说法。前一次定位把叙事重心转向 OTLP 与通用 Agent，见[README 叙事重心转向 OTLP 与通用 Agent](2026-11-09-readme-otlp-first-positioning.md)，没有处理检索口径。

另有一处边界风险：对外介绍要吸引开发者迭代 Agent，容易顺手写成性能评估，而 README 第 162、170 行把评分、数据集、实验平台划给观测平台，[会话汇总需求与方案评审](../../../../docs/session-trace-summary-review.md)第 5、25、31 行把当前能力限定为辅助人工评估的评价材料。

## Decision

**GitHub description 定稿，不写 local，不写评分能力。** 一行文字：`Capture every agent trace, visualize the full trajectory, and give agent developers the evidence to iterate on prompts, tools and context.` 用 evidence to iterate 表达开发者迭代的意图，避开 evaluate、score、benchmark、performance evaluation。

**topics 按标签规模选 17 个，高低搭配。** 用 `gh api search/repositories` 的 `total_count` 量各标签下的公开仓库数：llm 176945、ai-agents 136957、claude-code 114469、developer-tools 90596、visualization 30626、agent 23134、prompt-engineering 23096、observability 20837、debugging 6958、opentelemetry 6397、genai 6182、llm-agent 3517、tracing 2971、llm-observability 927、trace 855、trajectory 498、otlp 339。上 evaluation（9810）与 agent-evaluation（1622）会引来要评分的人，trajectories（79）、agent-trajectory（15）、session-replay（264）几乎没有浏览入口，都不上。

**两份 README 首句改写。** 英文版写 captures every request、visualizes the full trajectory、gives agent developers the evidence to debug and iterate；中文版写记录每笔请求、把整条轨迹可视化、给开发者提供调试与迭代的依据。其余章节不动，双版同构与互链沿用[开源门面](2026-11-04-open-source-front-door.md)的约定。

**GLOSSARY 基础名词补一条。** trajectory 指一次会话中 Agent 从首笔请求到末笔回复的完整步骤序列，含工具调用、结果与子代理分支；其中单笔请求的记录见现有 trace 词条。整条与单笔的粒度关系落在术语表，不在 README 里另写。

**仓库名与 URL 不动，package.json 不动。** tracery 已含词根，URL 里的 owner 与路径不参与站内匹配；package.json 的 description 与 keywords 是 npm 元数据，包标了 private、不发布，也不参与 GitHub 搜索。

## Alternatives considered

**把 local-first 放在 description 主位。** 落选。它描述部署属性，很少有人拿它当检索词；仓库只在一份内部研究文档里用过一次，对外文案写的是「数据全部留在本机」这种具体事实。保留在 README 卖点里做信任信号。

**按字面写 performance evaluation 并挂评估类标签来吸引评估人群。** 落选。README 非目标与评审记录都排除评分、数据集与自动 judge；高流量标签会放大错配，来的人发现没有打分就走。改成 evidence to iterate。

**改仓库名或 URL 带关键词。** 落选。改名会断掉 README 徽章、clone 地址与已发出的链接，收益只有 repo name 这一项站内匹配。

**只堆高流量标签。** 落选。topic 页按 star 与更新时间排序，零 star 的新仓库排不到前面；trajectory 只有 498 个仓库但精准，两类标签分工不同。

**更新[README 叙事重心转向 OTLP 与通用 Agent](2026-11-09-readme-otlp-first-positioning.md)而不新建。** 落选。那篇持有的是叙事重心转向 OTLP 的决策；本次更换了检索口径、首次引入 GitHub 远端元数据与 trajectory 术语，属于另一组决策依据。沿用该篇第 41 行的先例另写一篇，两篇互相链接。

**在 README 加一节讲可发现性。** 落选。对外介绍不放内部运营细节，见[文档标准](../../../../docs/AGENTS.md)的分层表。

## Consequences

- trajectory 成为对外主词，GLOSSARY 给它与 trace 的粒度边界；界面 i18n 定名表本次不动，界面文案尚未出现该词。
- description 与 topics 存在 GitHub 远端，不进 git；复核靠 `gh repo view --json description,repositoryTopics`，仓库设置与 README 分处两家，改一边要想到另一边。
- 对外口径仍受 README 非目标约束：项目给评价材料，评分、数据集与版本比较归观测平台。
- topic 页的曝光上界仍在 star 与更新时间，零 star 时排不到前面；启动流量靠文章与社区分发，多填标签提升的是站内搜索命中面与语义覆盖。
- 两份 README 同步维护、卖点只写能给出的东西，这两条约定不变。

## Testing

- 远端元数据用 `gh repo view --json description,repositoryTopics` 复核。
- 提交前跑 `bun run verify:notes:staged`，提交后跑 `bun run verify:notes`；`git diff --check` 核对两份 README、GLOSSARY 与两篇 note。
