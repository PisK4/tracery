# Agent Note: README 叙事重心转向 OTLP 与通用 Agent

Status: implemented

## Problem

[开源门面](2026-11-04-open-source-front-door.md)建立时的 README 沿用项目早期定位：magpie 网关是主力输入，三路证据与 hook 是叙事主线。此后代码已经长成多来源采集：OTLP 有独立的[接入 profile](../../../../docs/otlp-exporter-profile.md)与全量级契约，接入方明确写为任一 Agent Harness（自研 agent、自研网关、第三方项目），本地会话适配器从 1 家扩到 10 家，统一 owner 认领把跨通道双行收敛成一行，子代理阅读视图与工具调用跳转已交付。README 却仍把 magpie 放在第一节、篇幅最大，并在「与观测平台的分工」里把记录单位写成「经过网关的请求」。

对外口径因此有三类失真。一是叙事错位：陌生人打开仓库，会以为必须先装 magpie。二是事实错误：测试徽章停在 1165（实测 1464），本地适配器写成 six agents，中文版写「不读别的 Agent 会话数据」，英文版写账本先到 OTLP 后到仍保留两行。三是对外承诺自相矛盾：Scope 一节写「不做跨 harness 通用摄入协议」，OTLP 恰恰是已登记、有版本承诺的通用入口。

另有两处产品定位偏窄。首句把对象限定为 coding agent，与 profile 里「任一 Agent Harness」的范围不符；「一次会话能拿到什么」没有落点，读者读完问题陈述仍不知道装完五分钟能看到什么。

## Decision

**README 双版按同一口径重写，叙事重心从网关转到 OTLP 与通用 Agent。** 首句写每个 Agent 每笔请求背后的完整协议对象；`CLAUDE.md` 在泛指处改写成项目指令一类，保留它作为具体例子。数据源压成一张表，OTLP 占一行、不拆层级，harness 兼容信息放进适配对象列；magpie 降为表中一行；本地会话适配器的 10 家单列一张表。两级 profile 术语留在[接入规范](../../../../docs/otlp-exporter-profile.md)，README 只用 GenAI semconv 与稳定 `service.name` 这类对外说法。

**卖点只写能给出的东西。** 顶部四条是 OTLP 开放接入、一笔调用一行、10 种本机会话格式零配置、数据全部留本机。数据源表不再列缺失项，横评表只列 Tracery 独占或更细的能力，观测平台的强项压成一句让步。真实边界仍保留在「边界与非目标」，用中性的范围声明写，不写成能力缺陷清单。

**新增六组静态 SVG 示意，中英各一张。** 内容分三层：首屏三栏概览讲结构；「一次会话能读到什么」讲收获；数据源收敛、工具配对、上下文矩阵、子代理视图四张讲机制。图下留可检索文字与示意标注，真实请求正文不进图。SVG 根元素带 `width` 与 `height`，颜色全部字面色，不用宿主 CSS 变量，不引外部字体与脚本，符合父知识库的 SVG 写作规则。

**四张实机截图从 README 全部撤下。** 截图截到的都是同一场真实会话的碎片，带真实会话标题、文件路径、模型名与费用，首屏那张还挂着改名前的品牌 Trace Collector；竖长图缩到 README 宽度后字不可读。合成 SVG 能精确控制要展示的能力，桌面端落地时只改文案与色值，不用重截一整套图。旧 PNG 暂留在 `docs/images/`，删除属不可逆动作，等单独授权。

**CHANGELOG 的 Unreleased 补齐到现状。** 从两条摄入进路改为 OTLP 通用入口、共享摄入核心、10 家适配器、子代理阅读视图、全库 Agent 目录、Plugin 机制与维护命令面。

**修正被代码推翻的事实。** 徽章 1165 → 1464；适配器计数与隐私边界表述按 `src/sources/session/registry.ts` 的 9 家轮转加 droid 独立定时器订正为 10 家；跨通道双行改为统一 owner 一行；「经过网关的请求」改为在发送点或导出点捕获；Scope 里的通用摄入协议一条改写为 OTLP 是唯一通用入口。

## Alternatives considered

**补伪代码块代替 SVG。** 成本更低，但代码块的观感与仓库已有的四张截图不成一个系统。SVG 能画连线、分区与面积，GitHub 会渲染，中英各一张共用坐标，维护成本可控。选 SVG。

**中英共用一张双语混排 SVG。** 图内文字按坐标定位，中英文长度差异会撑破框。两张 SVG 共用同一套坐标与色值，只换 `<text>` 内容。

**保留实机截图，只补 SVG。** 首屏那张挂着改名前的品牌 Trace Collector，四张图都截自同一场真实会话，重复度高，竖长图缩到 README 宽度后字不可读。全部换成合成示意，README 不再对外展示真实会话内容。

**数据源表按 OTLP 两级拆成两行。** 对外读者不需要知道原生方言层与全量级的区别，拆开反而把 OTLP 讲成两种东西。合并一行，harness 兼容写进适配对象列。

**表格里如实列出各来源缺什么。** 信息准确，但卖点表的功能是让人判断要不要继续读，折扣信息放这里会把最强的一节写成免责声明。移到边界一节用范围声明承载。

**删掉与观测平台的对比。** 该节是唯一替外部读者回答「该拿它跟什么比」的定位锚点。保留，把调子从划清界限改成列能力差异。

**更新[开源门面](2026-11-04-open-source-front-door.md)这篇既有 note。** 它持有的是「建立双版 README 与社区文件」的决策。反转叙事重心属于更换决策依据，按 Agent Note 规则应另写一篇并互相链接。

## Consequences

- **两份 README 加十二张 SVG 同步维护。** 改能力描述或数字时中英两份一起改；SVG 内文字不进 GitHub 索引，图下的文字承担可检索性。旧四张 PNG 暂留在 `docs/images/`，等待单独授权删除。
- **对外承诺收在 profile 边界内。** README 写「按 GenAI semconv 导出并登记 `service.name` 即接入」，完整性契约与版本承诺归[接入规范](../../../../docs/otlp-exporter-profile.md)。真实流量验收只到 T6，native 导出与跨通道收敛的页面观感仍待补验，README 不替它背书。
- **桌面端重构会缩短快速开始一节的保质期。** 按当前形态写，不预写桌面 APP 的安装步骤；叙事三层（不绑网关、OTLP 主位、卖点清单）与部署形态无关，桌面端落地只需替换快速开始与数据落点两节。
- **CHANGELOG 仍停在 Unreleased。** 没有打 tag 就不编版本号，沿用[开源门面](2026-11-04-open-source-front-door.md)的约定。

## Testing

- `xmllint --noout` 与重复属性扫描通过全部十二张 SVG；根元素均带 `width`/`height`，全文无 `foreignObject`、`var(--`、`<script`、`@import` 与外部图片引用。Chrome 按各自原生尺寸逐张渲染，中英各六张均完整无溢出；渲染过程抓出并修掉一处重复 `class` 属性与三处文字压线。
- 两份 README 与 CHANGELOG 的本地相对链接 51 处全部命中；全部本地图片路径存在，旧 PNG 引用清零；剩余远程命中是 badge。
- `git diff --check` 通过；`bun test` 全量 1464 pass / 0 fail（126 个文件），与徽章一致。
- `grep` 复核旧表述（1165、six agents、two independent、No cross-harness、through the gateway、不读别的 Agent、仍保留两行）零命中；`coding-agent` 仅剩 Langfuse 文档链接 URL 中的路径片段。
