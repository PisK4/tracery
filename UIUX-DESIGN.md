# UIUX-DESIGN.md — Tracery 前端设计规则

本文是前端设计规则的唯一权威，分两层：通用原则不依赖本项目实现，可整段移植到其他项目；Tracery 实现规则写本项目的预算、分工与例外。改界面前两层都读，例外只按项目层登记执行。

数值各有其家，本文不复制：色值、字号与动效时长令牌以 [web/app.css](web/app.css) 为准，布局结构数值归[架构设计](docs/architecture-design.md)，决策的为什么与否决项归 [.agents/notes/](.agents/notes/README.md)。

## 通用原则

### 信息表达

- 简洁：让布局解释结构，分组、间距、对齐与表面明度差承担解释职责；不加多余的二级标签与说明文字，标题不配复述它的副标题，模块下不加说明段落。
- 正常态不带装饰性状态，异常才出现标签。
- 第一眼抓重点：首屏常驻信息按项目层清单执行；每个数字自带语境，份额跟着总量与百分比；超时与失败必须浮出正常行，不靠用户逐行找。
- 数据口径类说明（估计分配、留痕不完整、缺失原因、推算上界）不受降噪限制，照常保留，默认形态是气泡。
- 容器边界不承载状态：卡片、面板与列表不用顶部或单侧的强调色边、渐变光带、渐隐遮罩；边界统一 1px 细线，状态由文字、点或内容行左缘的选中标记承担。圆角卡片上的单边强调线尤其禁止，它在视觉上像括号或渐隐边。

### 色彩

- 中性灰阶承载界面，单一 accent 只表示选中与当前路径，不表示成功。
- 状态色只给异常与选中；识别色设档位上限，不按工具或来源逐个配色。
- 构成面积用单色透明度分档，份额越大越实，不用色相分类。

### 交互

- 可点元素三件套：hover 反馈、cursor:pointer、focus-visible 描边；缺任何一件按缺陷处理。
- 选中态必须可见，且与 hover 可区分。
- 按钮文字写清动作与对象，不加点击按钮即可式的引导话。
- aria 状态（expanded、pressed、current）与视觉同步；键盘能到达每个可点元素。

### 文案与解释

- 全局口径与免责声明式说明只出现一次，不逐模块重复。
- 必要解释放进气泡（tooltip），默认不显示；hover 与 focus-visible 都触发。
- 空态只承载一句主文案，允许一个短标题；有可执行动作时给一个主按钮，没有动作不硬造。

### 动效

- 只解释状态变化，不做装饰；时长 120–220ms 级，全界面共用一条 easing 曲线。
- 瞬态动画只挂用户动作；数据驱动的重绘不重播。
- 高频操作有意即时：逐条点选、搜索逐键、主题与语言切换。
- prefers-reduced-motion 有完整降级，CSS 与 JS 同口径。

### 状态呈现

- 加载占位与真实内容同高同位，到达即替换，不跳动。
- 进行中的说明可以呼吸，静态说明不用。
- 插画至多一处，且只在空态出现。

## Tracery 实现规则

### 色彩预算

- 新颜色先入 token：唯一家是 [web/app.css](web/app.css) 的 :root 与两个暗色块，组件里不写颜色字面量。
- 色板基准是桌面 UI 定稿样张（`.archify/tracery-desktop-demo-20261109.html` 的 Visual pass）：亮色冷灰、暗色蓝灰成对，不是反色；换色时亮暗两态一起走查。
- 角色徽章四档封顶：user 蓝、system 灰、assistant 紫、tool 橙；同屏软底色（低透明度铺底）不超过角色四档加语义三色。
- 导航选中用中性灰底；内容区选中才用 accent，2px 左缘加浅蓝底；hover 一律灰底。
- 耗时三档变色：正常弱灰、超限琥珀、再超红；阈值、格式化与工具类别的唯一家是 [web/duration.js](web/duration.js)，等待型工具不上色。
- 用量树图单色四档（--t1 至 --t4），份额走透明度。
- 品牌色例外：Agent logo 与蜘蛛插画走各自 token，不受灰阶预算约束。

### 字体与数字

- 数字一律等宽加 tabular-nums（.num 类）；时长展示只调 [web/duration.js](web/duration.js)，不自写换算。
- 字号从 app.css 既有档位选，不新增档位，尤其不新增半像素档。

### 布局与首屏

- 三栏职责：左栏会话导航、中栏轨迹、右栏读数与正文；栏宽与断点见[架构设计](docs/architecture-design.md)。
- 浏览器直接打开时三栏铺满视口，`body` 撑满高宽、不给页面层 `max-width` 或居中容器，也不画窗口外框；Tauri 外壳才用固定初始窗口尺寸与原生窗口边框。宿主分岔只作用于窗口外壳，三栏网格与读取路径两种宿主共用。
- 首屏常驻：会话行两行制（标题、Agent、笔数、右对齐时间，在途标记复用时间格）；会话头 sticky（标题加 facts 行）；轮次带吸顶当目录；中栏行尾耗时。
- 点进去才看：正文、工具配对、上下文矩阵，归右栏与弹窗，不铺首屏。

### 动效分工

- CSS 声明一个家：[web/app.css](web/app.css) 末尾动效区；令牌 --t-fast、--t-move、--t-micro、--t-fold、--ease-out 主题无关，不进暗色复制块。
- JS 统一入口 [web/motion.js](web/motion.js)：reduced-motion 或缺 WAAPI 返回 null；settled() 给动画时钟冻结的环境兜底；入场传 clean 清掉末帧 inline，离场与 FLIP 定位不传。
- 瞬态类（tab-fresh、chip-fresh、landed）只经 markFresh 挂在用户点击上，定时清除，不用裸 classList.add。
- 切主题两帧只关 transition，不写 animation:none；主题本身当帧完成。
- 换会话走两段换场（switching 让位、entering 淡入）；显式刷新家族只复用 entering 淡回，不加最短驻留。

### 例外登记

- 蜘蛛插画：空态主视觉，空态持续 500ms 才启动 SMIL，reduced-motion 换静态成品；决策见[空状态蜘蛛](.agents/notes/implemented/feature/2026-11-02-empty-state-spider.md)。
- 数据口径说明：EXEC_MS_HINT 等以 title 气泡保留，定义在 [web/duration.js](web/duration.js)。
- 品牌色：Agent logo（claude、codex）与蜘蛛 --spider-* 三个 token。

### 工程约束（指针）

- 正文与路由内容一律转义；读取走[读取功能接入规则](docs/read-feature-rules.md)；新 web 模块登记 STATIC_FILES 白名单；界面文案走 i18n 的 t()，中英两份同改。
- 功能图标只用 [web/icons.js](web/icons.js) 的 IconPark 注册表（48 网格、stroke-width 4、currentColor）；语义名不随几何改动，新增图形先入表再调用。折叠箭头的 CSS mask、首屏占位 SVG 与品牌 SVG 是同一套几何的四处来源，改动时一起换；Agent logo 与蜘蛛插画属品牌例外，不进注册表。

## 验收清单

- 浅色与深色两主题同查；中栏、右栏、会话列表三处 chip 规则一致。
- 新可点元素过三件套，新颜色过预算，新文案过降噪。
- 动效验收读计算样式的中间值与状态实际驻留毫秒数，不只查类名出现；合成页通过后在生产页面人眼确认一次，机器判据不当观感结论。
- 源码级守门在 [tests/web.test.ts](tests/web.test.ts)：动效 clean 作用范围、切主题规则、markFresh 调用点等；改这些行为先读对应守门再动。