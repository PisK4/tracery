# Agent Note: 前端设计规则立唯一权威 UIUX-DESIGN.md

Status: implemented

## Problem

前端规则以事实形态散在五个家：根 AGENTS.md 的降噪行、app.css 的 token 与动效区注释、方向 A 重制提案、动效两篇 note、duration.js 与 motion.js 的契约注释。新 Agent 不读完全部就不知道全套。方向 A 六步与蜘蛛插画交付后，两份提案仍滞留 proposed，规则的最新事实要去代码注释里找。Pis 提出六条要求（简洁、美观、有过场动画、主页颜色克制、第一眼抓住重点、第一眼知道如何交互并拿到更多关键信息），又贴来六条外部文案规则问能否补入，要求成文供后续 Agent follow。

## Decision

- 根目录 [UIUX-DESIGN.md](../../../../UIUX-DESIGN.md) 是唯一权威，单文件两层：通用原则不出现项目文件名与数值、可整段移植；Tracery 实现规则写预算、分工、例外登记与验收清单。数值不复制：色值与令牌归 app.css，结构数值归架构设计，决策史归 notes。
- 根 AGENTS.md 加必读行并登记进一个事实一个家清单；[文档标准](../../../../docs/AGENTS.md)分层表加行。
- 外部六条的判定：标题不配复述副标题、按钮写清动作、必要解释进气泡三条直接补；模块下不加说明文字并入既有降噪条，不另立新条；免责声明只在页脚一次改造为全局口径说明只出现一次且默认气泡（Tracery 无页脚，数据口径说明是降噪的显式例外）；空态一句话改造为一句话主文案加有可执行动作才给按钮，蜘蛛插画登记为显式例外。
- 字号只立规则不收敛：从既有档位选、不新增半像素档；收敛成 scale 是独立任务。
- 清理：方向 A umbrella 与蜘蛛 note 从 proposed 转 implemented，入站链接同批修复。promo 的 proposed 副本是 implemented note 有意保留的关键数字口径来源，不动；.archify 样张目录未被 git 跟踪，属本地工作产物，不动；docs/superpowers/plans 是历史执行计划，不是指导性文档，不动。

## Alternatives considered

**拆成通用与项目两个文档。** 否决。例外必须与规则同处：通用层写空态只一句话，项目层登记蜘蛛插画，拆开之后只读通用层的 Agent 会得出删插画的错误结论。通用文档若放知识库，worktree 与其他检出读不到它。跨项目复用等第二个消费者出现时再把通用层整体提层，届时是一次纯移动。

**规则并入 architecture-design.md。** 否决。架构文档写结构与数值现状，约束性规则要每次改动必读；[前端降噪常备约束](2026-10-24-frontend-denoise-standing-rule.md)当年已按同一理由把规则放在入口侧。

**本轮把字号收敛成 scale。** 否决。14 个既有档位的收敛是行为变化，需要独立落地与走查，不混进立规则。

**外部六条原样照收。** 否决。模块说明条与降噪条重复，照收就是一个事实两个家；免责页脚条与无页脚工作台及口径例外冲突；空态必给按钮会在等待选择这类无动作空态硬造按钮。

## Consequences

- 收益：新 Agent 单入口读全规则；蜘蛛、品牌色、口径气泡三类例外有据可查；两份滞留提案归位，proposed 树不再混着已交付的前端提案。
- 代价：文档不抄数值，Agent 取色值与令牌仍要跳 app.css；规则与代码注释的分工靠引用有效性维持，改令牌名时要同步本文。
- 未做：颜色字面量只许 token 区、动效时长必须引用令牌两条候选守门未落测试；字号 scale 收敛未启动；蜘蛛的门控与降级无自动化测试锁定，回归靠人工走查。
- 验证：`bun run verify:notes` 通过。

## Related

[前端降噪常备约束](2026-10-24-frontend-denoise-standing-rule.md)保持活跃，记录立约束的决策；规则全文的家迁入 UIUX-DESIGN.md。[方向 A 重制](../feature/2026-11-02-frontend-direction-a-restyle.md)与[空状态蜘蛛](../feature/2026-11-02-empty-state-spider.md)在本轮转 implemented。动效分工的决策史在[页面交互动效层](../feature/2026-11-04-web-interaction-motion.md)与[动效缺陷治理与转场推广](../feature/2026-11-08-motion-defect-governance-and-reuse.md)。