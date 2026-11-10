# 工作教训

本仓库的代码由 Agent 写、审、提交。这里记录在本仓库反复踩的工作方式错误：规则、证据与可执行防护。改代码前先读与本次改动相关的章节。

这里不是决策记录。为什么这样设计、否决了什么，写进[Agent Note](README.md)；单次缺陷的完整复盘写进 bug-fix note；每个会话都要遵守的稳定规则写进根 [AGENTS.md](../../AGENTS.md)。一条教训稳定成测试、脚本或常备约定后，从正文删除并迁入对应家；本文件末尾只保留一行迁移指针与证据锚点。

当前维护方式是任务收尾自检，没有夜间 review。非平凡任务结束前，把本次踩到、下次还会踩的坑追加一条；同一坑再次出现，在 Seen 行补日期。同一规则在三个不同日期出现，或防护已经变成测试、脚本、常备约定，就晋升。

## 条目格式

**一句话祈使句规则。**
- 证据：commit、文件与行、日期，说明当时错在哪。
- 防护：可执行动作，命令、测试或检查项。
- Seen N× (日期列表).

## 派生与版本

**升算法号时，容忍窗口与测试钉子一起动。**
- 证据：2026-11-01 Hermes 修复把 `PURPOSE_VERSION` 7 升到 8、`GROUP_ALGORITHM` 6 升到 7、`DERIVE_ALGORITHM` 10 升到 11；容忍窗口漏移会把前一代工具事实误判为未知，全量套件靠两处测试钉子抓出漏改。
- 防护：升号后 grep `algo ===`，再 grep 测试里的 `GROUP_ALGORITHM).toBe`；位置包括 `src/semantics.ts`、`src/derive/state.ts`、`src/queries/session-summary.ts` 的两处窗口、`tests/session-summary.test.ts` 与 `tests/derive-slice.test.ts`；合并前跑全量 `bun test`。
- Seen 1× (2026-11-01).

**升 schema 版本时，三处版本事实与测试断言一起动。**
- 证据：2026-11-08 v14→v15 加覆盖索引，需同步 `src/store.ts` `SCHEMA_VERSION`、`src/maintenance/verify.ts` `CODE_SCHEMA_VERSION`、`src/maintenance/backup.ts` `RESTORABLE_SCHEMA_VERSIONS`（漏最后一处，当前 v15 库备份会被 `backup_schema_unsupported` 拒）；测试里硬编码 `user_version: 14`、错误正则 `code v14`、precheck「比代码新」反例 `setVersion(15)` 都要同步。
- 防护：升版 grep `SCHEMA_VERSION`/`CODE_SCHEMA_VERSION`/`RESTORABLE_SCHEMA_VERSIONS` 与测试里的 `user_version:`/`code v`；「迁移后当前版本」断言改用 `CODE_SCHEMA_VERSION` 常量，「比代码新」反例用 `CODE_SCHEMA_VERSION + 1`，下次升版不再红。
- Seen 1× (2026-11-08).

## Worktree 与提交

**合并被并行会话的在途文件挡住时，定向 stash 该文件、合并、再 pop，不整库 stash、不代提交。**
- 证据：2026-11-03 合并 fix/websearch-subevent-cards 时，主检出里另一个会话对同一 note 文件有未提交的 F26 修复记录，`git merge` 以 "local changes would be overwritten" 拒绝；分支改动（F31/F32 状态行）与在途改动（F26 段落）分处同一文件不同段落。
- 防护：`git stash push -m <说明> -- <path>` → `git merge --no-ff` → `git stash pop`；pop 前确认两批编辑不在同一行段。整库 stash 会把对方所有在途文件一起卷走。
- Seen 1× (2026-11-03).

**暂存后又改了同一文件，提交前重新 `git add` 并用 `git diff --cached` 核对最终内容。**
- 证据：2026-11-02 `bb27546` 的 note 暂存后又被改成 implemented 骨架，index 仍是 Proposal/Acceptance criteria；`3ba7c8b` 补发 Decision/Consequences，`docs/acceptance.md` 记录这次返工。
- 防护：`git add <paths>` 后跑 `git diff --cached --stat` 与 `git show :<path>`；确认 index 是最终版本再 commit。
- Seen 1× (2026-11-02).

**note 要交给其他会话接手时，先提交进 `proposed/`，别把唯一副本留成 `??`。**
- 证据：2026-11-04 `5a102e1` 提交 `proposed/bug-fix/2026-11-03-migration-failure-autorebuild.md` 时注明「这是设计的唯一未跟踪副本，接 F23 的 agent 看不到」。
- 防护：交接前跑 `git status --short .agents/notes`；有 `??` 的提案先 add 并提交，再让对方基于该检出工作。
- Seen 1× (2026-11-04).

**用生产库副本起本地预览时，先 rebase 到 master、用 `sqlite3 .backup` 拷贝，并带上 `redaction.salt`。**
- 证据：2026-11-04 会话切换预览，分支基点 schema v10、生产库 v11，启动报 `schema_version_unsupported`；`bun run maintain backup` 报 `backup_failed:source_must_be_stopped`（备份要求源采集器停止）；数据目录缺 `redaction.salt` 时启动报 `redaction_salt_missing`。3.9GB 库用 `sqlite3 .backup` 约 3 分钟。
- 防护：预览前 `git rebase master`；`sqlite3 <prod>/trace.db ".backup '<tmp>/trace.db'"`；复制生产目录的 `redaction.salt`（0600）到 `ATC_DATA_DIR`；用独立 `ATC_PORT` 起，不碰生产 8320。验收完成后删掉整个临时目录（含库与 salt），保留生产原件。
- Seen 2× (2026-11-04, 2026-11-09).
- 变体（2026-11-04）：临时实例要把会话源与路由目录一起指到临时目录。证据：第 6 轮已把 `ATC_DATA_DIR` 改到 `/tmp`，临时库仍混入 107 条真实 session 请求，因为会话源与 `ATC_ROUTING_DIR` 还指向默认位置。
- 再次复现（2026-11-09）：用 `bun run start` 加临时 `ATC_DATA_DIR` / `ATC_PORT` 起设置页预览，`/api/stats` 出现真实 `~/.claude/projects/...jsonl` 游标，浏览器混进 3 个真实会话。只改数据目录并不关闭会话适配器；这次改用注入 `sessionAdapters: []`、`communityPlugins: false` 的临时入口脚本才得到干净实例，第一次结果作废、不写成合成验收。

## 验证

**改 README 时，硬数字与来源计数从代码和实测取，两份版本一起核对。**
- 证据：2026-11-09 重写 README 前盘点，测试徽章仍写 1165（实测 1464 pass），本地会话适配器写成 six agents（实际 9 家轮转加 droid 独立定时器共 10 家），中文版写「不读别的 Agent 会话数据」而代码读 10 家，英文版写账本先到 OTLP 后到仍保留两行而统一 owner 已收敛成一行。中文版比英文版落后更多：进路三只写 droid 一家。
- 防护：动笔前跑 `bun test` 取徽章数、读 `src/sources/session/registry.ts` 取适配器家数、grep 两份 README 的旧数字与旧表述；改完跑 `xmllint --noout` 查 SVG、按相对链接逐个核对目标、`git diff --check`。SVG 根元素要带 `width`/`height`，颜色用字面色，不用宿主 CSS 变量。`xmllint` 不查重复属性，还要单独扫每个标签的属性名是否重复，并用 Chrome 按原生尺寸渲染逐张看图：本次 `sources-en.svg` 的重复 `class` 直接让浏览器拒绝渲染，另有文字压线与右端溢出靠肉眼才发现。
- Seen 1× (2026-11-09).

**改过 JS/TS 后，提交前跑 `bun run typecheck`；`bun test` 不检查 JSDoc 类型。**
- 证据：2026-11-01 `9a97ed9` 才补 `web/app.js:1018-1019` 的 `headResizeObserver`/`observedHead` 注解，并单独合并为 `ba40614`；2026-11-02 `cb30675` 才补 `web/icons.js` 两处映射与 `web/trace-view.js:556` 的参数注解，修掉 3 处 TS7053/TS7006。
- 防护：合并前跑 `bun run typecheck`；只动 web 的 JS 也跑，JSDoc 由 tsc 检查。
- Seen 2× (2026-11-01, 2026-11-02).

**带 note 的提交先跑 `bun run verify:notes:staged`；master 直提也算。**
- 证据：2026-11-04 `a9c6d74` 在 master 直提 `proposed/bug-fix/2026-11-04-timing-safe-equal-stdlib.md`，缺 `## Proposal` / `## Acceptance criteria` / `## Risks`，全量 `verify:notes` 至今报红。2026-11-05 变体：插件机制实现批次落在 worktree 分支，方案 note 已提交进 master，`--staged` 只看暂存集，整批 32 文件被判「没有 Agent Note」；新建一篇记录已交付接缝的 implemented note 并与 proposed 主 note 双向链接才过门禁。
- 防护：提交前跑 `bun run verify:notes:staged`；新增或移动 note 的 commit 不走合并也跑。跨 worktree 的实现批次不能指望主检出里的 note 顶数，要在同一暂存集里带一篇。
- Seen 2× (2026-11-04, 2026-11-05).

**测试在 open `store.write` 事务里读 writer `db`，不用 `store.read`。**
- 证据：2026-11-09 共享摄入核心的计划测试代码在 `store.write(db => …)` 回调里用 `store.read.query` 断言刚写的行，实测 writer 见 n=1、只读连接见 n=0——`store.read` 是独立只读连接，WAL 下看不到本事务未提交的写入，提交后两者才一致。
- 防护：事务内断言用回调传入的 writer `db`；`store.read` 只在 `store.write` 返回（事务提交）后读。`fixture()` 返回 `{store,dir,close}`，播种是 `store.store.write`，不是 `store.write`。
- Seen 1× (2026-11-09).

**改对外描述与 topics 前，先拿 README 非目标核对能力边界，别把高流量标签当成能力承诺。**
- 证据：2026-11-09 定 GitHub description 与 topics 时，曾提出写 performance evaluation 并挂 `evaluation`（9810 个仓库）、`agent-evaluation`（1622）；README 第 162、170 行把评分、数据集、版本比较划给平台，`docs/session-trace-summary-review.md` 第 5、25、31 行只支持辅助人工评估与评价材料，定稿改成 evidence to iterate。`gh api search/repositories` 另查得 `trajectory` 仅 498 个仓库、`agent-trajectory` 15 个，精准词与高流量词要分开选。
- 防护：动 description 或 topics 前 grep 两份 README 的 Scope and non-goals 与对应评审记录；候选标签用 `gh api -X GET search/repositories -f 'q=topic:<name>' -f per_page=1 --jq '.total_count'` 量规模，自造组合词跳过；写完对照两份 README 首句，确认没有新增能力承诺。
- Seen 1× (2026-11-09).

**分步交付的提案，收尾那一步负责把 umbrella 提案转 implemented。**
- 证据：2026-11-08 立前端规则文档时核对，方向 A 六步 note 全部 implemented，umbrella 提案仍滞留 proposed；蜘蛛插画代码已交付，note 也仍 proposed。规则的最新事实被迫去代码注释里找，入站链接还指着 proposed 路径。
- 防护：分步提案的最后一步交付时，把 umbrella 转 implemented 并同批修入站链接；收尾跑 `rg -l '<提案文件名>' .agents/notes` 核对没有残留的旧路径引用。
- Seen 1× (2026-11-08，方向 A umbrella 与蜘蛛两例).

**`list.param` 是分组键，展示文案放 `label`。**
- 证据：2026-11-02 方向 A 第 5 步第一版把 `param` 传成 `${name} 的调用`，对组永不命中、失败数恒 0；测试直接传 meta 测不到这条装配路径，真实后端同样中招，靠合成数据 curl 对比抓到。
- 防护：改 `summaryList` 的取数后，用合成页面 curl 对比 chip 与页头计数；参数摘要从 `arg_path`/`arg_skill` 读，不从 `param` 反解。
- Seen 1× (2026-11-02).

**`bun:sqlite` 的 `get`/`all` 参数按位置逐个展开传，不能塞进一个数组。**
- 证据：2026-11-04 droid 摄入测试把组键写成 `.get([JSON.stringify(['session','s1'])])`，SQL 只收到一个数组参数，查询恒 0 行，误判成派生队列没入队；改成 `.get(JSON.stringify([...]))` 才命中。
- 防护：按 SQL 占位符数量逐个传参；带参数的断言先跑同一查询的无参版本核对总行数，再收紧到参数形状。
- Seen 1× (2026-11-04).

**新增常驻采集路径时，先给它留测试注入点，测试不能落回真实 home。**
- 证据：2026-11-04 会话适配器接入 `sessions` 定时器后，`startCollector` 直接读 `process.env`/`homedir()`，三个既有 main 测试在开发机上把真实 `~/.claude` 的行写进合成库，断言从 droid 行变成 claude 行；改成 `CollectorOptions.sessionAdapters`/`sessionRoots` 注入后才隔离。
- 防护：凡是启动时读本机目录或环境变量的路径，同时提供 options 注入；单测一律传合成根，缺省值只在生产与显式启动里生效。
- Seen 1× (2026-11-04).

**门禁报红先确认文件是否属于本批改动，再判断是否自己引入。**
- 证据：2026-11-03 全量 `verify:notes` 在 `.agents/notes/implemented/feature/2026-11-03-live-session-activity-and-navigation.md` 报 implemented 格式错，该文件是并发会话尚未跟踪的迁移中途产物；本批改动在 `--staged` 与 `--range` 两处均通过。同一轮还有 7 个历史批次真的缺 note，不能因为存在并发文件就全部当成误报。
- 防护：报红文件先跑 `git ls-files <path>`，输出为空说明未跟踪、归并发会话；本批范围单独跑 `node scripts/verify-change-notes.mjs --range origin/master..HEAD`；历史缺口逐批看提交信息里有没有 `Agent-Note: none`。
- 同日补充：主检出（干净 master）同样红不等于「与本次无关」。2026-11-07 静态白名单断言在主检出也红，被当成既有基线放过；实际是 76c23b5 合并的前端外移把两个新模块带进 `web/` 却没登记，生产页面 404。
- 同日二次确认：operation 准入批次的全量 i18n 失败与 reader-store 四处 typecheck 报错在主检出同批复现，按本条定位为标题重试合并（6adf07c、93bc2a6）引入的回归，本批补 en 条目与类型注解修复，不背「基线既有」的锅也不放走真回归。
- Seen 2× (2026-11-03, 2026-11-07).

**新增或搬移 `web/` 模块后，必须跑 `tests/http.test.ts` 的静态白名单断言，并重启生产服务再验页面。**
- 证据：2026-11-07 前端叶子外移合并（76c23b5）新增 `web/empty-state.js` 与 `web/scroll.js`，未登记 `src/http.ts` 的 `STATIC_FILES`。浏览器模块图 404，生产页面整页停在「正在读取本机会话…」，会话列表与三栏都不渲染。补两行登记并重启后恢复。2026-11-10 桌面 UI 合并（0b5c9a1）再次踩到：登记本身已经写进 `src/http.ts` 并通过测试，但合并只换了主检出的 `web/`，运行中的进程仍持旧白名单，`/host.js` 404 让整页只剩顶栏与空壳（`sessions:0`、`donuts:0`）；`bun run service restart` 后恢复（`host:desktop`、15 个会话、2 个圆环）。
- 防护：动 `web/` 目录后跑 `bun test tests/http.test.ts`；白名单是启动时载入内存的常量，改完要 `bun run service restart`。**合并本身就等于改了主检出的 `web/`**，所以带前端改动的合并之后必须立刻重启并打开页面核一次，别等下一次维护窗口。生产核对看静态资源的 `responseStatus`，不只看 DOM 是否存在。
- Seen 2× (2026-11-07, 2026-11-10).

**CSS 过渡/动画的验收要读计算样式，不能只看 DOM 有没有带类。**
- 证据：2026-11-08 档 1 首版用 `.compact-preview::after` 画占位灰条，DOM 与类名都在，但 `.compact-preview` 在 flex 行里被 `min-width:0` 压成 0 宽、`overflow:hidden` 又把伪元素裁掉，浏览器实测 `getComputedStyle(...,'::after').width` 为 `0px`。同一轮 `startSwapIn()` 只设 `data-switch-state="entering"` 没排清理定时器，刷新后状态永久停在 entering，也是靠浏览器逐帧观测才抓到，静态测试全绿。
- 防护：动效改动在合成页面用 `getComputedStyle` 钉住实际宽高/背景/动画名，并用 `MutationObserver` 记录状态序列确认末尾清干净；源码级守门测试只证明声明存在，不证明渲染生效。
- Seen 1× (2026-11-08).

**浏览器验收脚本不要复用渲染前的 DOM 节点，也不要在同步采样循环里判定动画是否推进。**
- 证据：2026-11-08 档 1 生产走查，连点首测把第二笔点击判成不生效，实际是第一笔点击后 `renderAll()` 重建了左栏，脚本持有的旧节点已经脱离文档，`dispatchEvent` 不冒泡到委托。工具四页首测报 `[data-tool-page]` 为 0 是 600 ms 采样早于渲染；同键淡入逐帧采样的 `currentTime` 恒为 0、透明度恒为 0.35，是 `page.evaluate` 的同步循环不让浏览器推进动画时钟，离开循环等 1.5 秒就收敛到 1。
- 防护：每次点击前用 `data-*` 从实时 DOM 重新取节点；目标出现用 `waitForSelector` 或独立复查，不用固定毫秒采样下结论；判定 WAAPI 动画收敛要在采样循环外等待，再读 `getAnimations()` 与计算样式。
- Seen 1× (2026-11-08).

**动效验收要钉住持续时间与计算样式的中间值，状态类出现过不等于人眼看得见。**
- 证据：2026-11-08 档 1 生产走查逐帧记录了 `switching → entering → null`、动画名存在、`#main .pulse` 为 0、资源全 200，写成生产真实流量验收通过；用户手动验收却感觉不到修改。回看数据，`switching` 只活 18ms，120ms 压暗 transition 没起效就被覆盖，扫描线 1s 周期只跑了 1.9% 且高亮段还在屏外，180ms 淡回又发生在 `renderAll()` 整块换掉行节点之后。
- 防护：动效改动先给状态定最短驻留，验收逐帧读 `getComputedStyle` 的 opacity 与 transform 中间值、状态实际持续的毫秒数、动画时长是否小于驻留；合成页通过之后还要人手动在生产页面上确认一次，不把机器判据当成观感结论。
- Seen 1× (2026-11-08).

**全局动效抑制只关过渡，入场动画播完单独清末帧 inline。**
- 证据：2026-11-08 动效缺陷治理，切主题的 `body.theme-switching *` 写了 `animation:none!important`，两帧抑制把三个正在跑的无限动画从 738ms 取消后归零重播；同一个页面里 `motion.vendor.js` 的 `fill:"both"` 让入场动画播完留下 `opacity:1; transform:translateY(0px)`，离场动画的 `opacity:0` 却必须保留到元素隐藏。直接全局清理会把两种末帧一起弄坏。见[动效缺陷治理与转场推广](implemented/feature/2026-11-08-motion-defect-governance-and-reuse.md)。
- 防护：切主题只写 `transition:none!important`；复验时给三个无限动画注入探针，读切换前后的 `currentTime` 是否继续前进。入场动画通过 `motion()` 的 `clean` 按关键帧属性名清 inline，离场与 `context-map.js` 的定位 morph 不传；验收分别读入场后的 inline 是否为空、离场后 `opacity:0` 是否还在。
- Seen 1× (2026-11-08).

**新判定规则的编排位置，要对照生产存量的状态组合核对，不能只按设计意图写合成测试。**
- 证据：2026-11-07 operation 准入首版把 `operationDecision` 放在 retained 早退之后，合成套件全绿；生产 16 笔 `execute_tool` 行正文已回收、retained 在 `source:mcp` 仍参与链，新规则永远不到达。合成视图只覆盖了设计时想到的组合，漏掉「旧版本 × 正文回收 × 新事实」这个真实存量状态，靠生产只读分布核对才抓到。
- 防护：规则落地后先在生产只读快照列出目标群体的状态组合（版本 × 正文状态 × 新事实），逐组确认编排能到达；规则行为变化升 `PURPOSE_VERSION`，旧目标行走显式 rebuild 重判。
- Seen 1× (2026-11-07).

**隔离实例验收先补齐两个口径：读接口要带 Bearer，`conv_key` 是 JSON 数组字符串。**
- 证据：2026-11-08 工具调用启动点验收，直接 `curl /api/sessions/...` 全部返回 `unauthorized`——无 Origin 时读路径只认 `Authorization: Bearer <base64url(read.token)>` 或浏览器的 `sec-fetch-site: same-origin`，而浏览器直接打开页面走的是导航放行，两条路径的认证条件不同。同一轮把 `--session` 传成裸 uuid 得到空结果，库里实际键是 `["session","<uuid>"]`，按 `conv_key like '%<uuid>%'` 才找得到。
- 防护：脚本验收读接口时先从数据目录读 `read.token` 转 base64url 作 Bearer；查会话键用 `select distinct conv_key from request where conv_key like '%<uuid>%'`，不按裸 uuid 猜。浏览器验收不受影响，别把它的成功当成接口免认证。
- Seen 1× (2026-11-08).

**worktree 里改的前端，生产页面验不到；那条只读检查只能证明旧页面没回归。**
- 证据：2026-11-10 桌面 UI 收尾，在 worktree 里给 `web/` 加了 `host.js` 与 `usage-donuts.js`，用 CDP 打开 `http://127.0.0.1:8320/?host=desktop` 得到 `host:null`、`top:44`、`donuts:0`、`cueToggle:false`——launchd 采集器服务的是主检出的 `web/`，新模块根本不在那个目录里。同一轮 `screencapture -l <windowid>` 取外壳窗口截图失败，新代码的实际证据只剩合成 demo（`prototypes/synthetic-server.ts`，8770）。合并后同一份检查换成新页面，才拿到真实流量证据。
- 防护：worktree 前端验收一律指向合成 demo 或从 worktree 起一份隔离实例，别拿生产 8320 当证据；要验生产就必须先部署（合并 + `bun run service restart`）。验收记录里把「worktree 期生产只读检查（旧前端）」与「合并后的真实流量验收」分开写，不合并成一句「生产已验」。
- Seen 1× (2026-11-10).

## 依赖与命名

**引入 `t` 前，先查同作用域里叫 `t` 的局部变量。**
- 证据：2026-11-04 i18n 批次，app.js 三个事件委托的 `const t = e.target`、tileSpec/chip/resourceGroup 的参数 `t` 共六处遮蔽翻译函数；typecheck 只抓到其中两处——`t !== null` 比较与 `t instanceof HTMLDetailsElement` 静默指向错误对象，靠逐行手查才清干净。
- 防护：web 模块 import t 前 `grep -n "const t = \|(t) =>" web/<file>.js`；对事件委托区额外核对裸 `t`（无点、无括号）引用，typecheck 不兜底这个坑。
- Seen 1× (2026-11-04).

**换图标库时先列全四处的图形来源，别只改 `icons.js`。**
- 证据：2026-11-08 Lucide 迁移首版只换了 `web/icons.js` 的 39 枚 BODY，忽略另外三处——`web/app.css` 的 `--chev-right` data URI mask、`web/index.html` 的 7 枚内联首屏占位 SVG（都是 16 网格自绘）、以及 `web/agent-logos.js` 品牌 logo 与 `web/empty-state.js` 蜘蛛插画。前两处仍露出旧几何，后两处按 UIUX-DESIGN.md 的品牌色例外应保留。
- 防护：动图标前 `grep -rn "viewBox\|data:image/svg+xml\|<svg" web/`；区分功能图标、品牌标识与插画三类，只有第一类进映射表。换完按 `grep -rn "0 0 16 16" web/` 确认零残留。
- Seen 1× (2026-11-08).

**验 `:focus-visible` 不能用程序化 `.focus()` 读计算样式。**
- 证据：2026-11-08 启动点 chip 三件套验收，CDP 里 `element.focus()` 后 `getComputedStyle(el).outlineStyle` 恒为 `none`、`:focus-visible` 为 false，看似缺少焦点描边；实际是浏览器只在键盘 modality 下给该伪类。先派发一次真实键盘事件再 focus，读数为 `solid 2px` accent 色。
- 防护：验焦点态用 CDP `Input.dispatchKeyEvent` 发一次键让浏览器进入键盘 modality，再 `focus()` 并读 `el.matches(':focus-visible')` 与 `outlineStyle`/`outlineWidth`；程序化 focus 的读数既不能当通过也不能当失败。
- Seen 1× (2026-11-08).

## 方案与回填

**改标题/摘要这类「挑一行代表整组」的候选顺序前，先在生产副本上按发布代口径重算前后差异，逐条看新值是否更有信息量。**

- 证据：2026-11-08 子代理身份收口时给会话标题加了一级「本会话自身任一」候选，合成测试全绿；按真实库重算发现 17 个会话换名，其中 6 个换成「Tool loaded.」「## Page contract…」这类首条 user 碎片——比它替换掉的子代理委派提示更没信息量。改回「只插一级自身主链」后只影响 2 个会话。同一轮还有一处口径错：先用同步旧列 `r.chain_role` 重算，读路径实际走 `published_generation` 的代际列，两者结论不同（17 vs 2）。
- 防护：候选顺序类改动一律在 `sqlite3 -readonly` 副本上用读路径同款列（`CASE WHEN q.published_generation IS NOT NULL THEN e.* ELSE r.* END`）跑「改前 vs 改后」对照表，统计换名数、变短数、退到兜底数；合成测试只能证明顺序被实现，不能证明新顺序更好。
- Seen 1× (2026-11-08).

**预测重派生/判据变更的效果前，先查存量行的 `body_state` 与 `purpose_version` 分布。**
- 证据：2026-11-03 WebSearch 子事件方案立项时推断「version bump 后 64 张 conv 卡会被新判据收走（bypass）」；落地时只读核查发现 69 个 conv 行全部 `body_state='pending'` 且已存 `purpose_version=10`，正文不可读走 `unavailableDecision` 的 retained 保留，新判据根本执行不到，69 键 rebuild 是无效果写库。新判据只对 `purpose_version` 为空的新行生效。
- 防护：任何「bump/重派生会翻转存量行」的结论，先用只读 SQL 按 `(body_state, purpose_version, purpose_status)` 分组数一遍；retained 优先于新判据是设计行为，不是 bug。
- Seen 1× (2026-11-03).

## 摄入与预算

**读取层返回的行偏移不是游标时，必须同时声明游标来源与坏行重读点。**
- 证据：2026-11-04 DSH 多 frame 读取给每行合成偏移（frame 起点乘 stride 加行号），共用摄入仍按 `line.end` 写 `committed_off`：369 字节的子会话文件首轮只提交到 281，第二次从 281 开始正好落在 frame 边界之前，追加的 frame 整段读不出来，表现为第二轮 `calls=0`。
- 防护：容器读取用 `SessionAdapter.lineCommit=false` 让游标只认读取层的 `committedOff`，用 `SourceLine.restartOff` 给坏行一个 frame 起点；集成测试同时断言 `committed_off===observed_off` 与追加后还能再读出一笔。新适配器若偏移只是原始层身份，先写这两条声明再跑追加测试。
- Seen 1× (2026-11-04).

**子来源各自编号时，共享证据键必须带子来源身份。**
- 证据：2026-11-04 DSH 子代理的 `seq` 是各自文件内的序号；同父的三个子代理都出现 `seq:477`，证据键 `<父会话>/seq:477` 相撞，首轮 684 条 assistant 只建了 670 笔 request，14 笔被当成重复丢掉。
- 防护：折叠到父会话的调用，callId 与 `ref_key` 带 subagent id；验收时把原始层 assistant 数与 request/duplicate 数对账，并测两个使用相同 seq 的子代理各建一行。
- Seen 1× (2026-11-04).

**`afterFile` 只在主流有推进的写事务里跑，覆盖写的旁路快照要另找刷新入口。**
- 证据：2026-11-04 Grok 适配器的 `usage.json` 是会话级累计快照，`chat_history.jsonl` 停止追加后它被单独改写时，共用摄入的 `unchanged` 分支在 `afterFile` 之前就 return，累计值刷新不到；合成测试里「静止改写 -> sideEffects=1」直接失败。droid 用独立批次入口 `ingestDroidBatch` 按 `session_usage.source_path` 补刷，走通用 `sessions` 调度的适配器没有这个入口。
- 防护：把旁路快照的刷新挂在主流下一次推进上，测试只断言这个契约；静止期改写列为未覆盖边界写进 note，别让测试断言一个 `afterFile` 根本到不了的路径。要覆盖静止期改写，得在批次入口或调度层加刷新，不改 `ingest.ts` 主体做不到。
- Seen 1× (2026-11-04).

**给逐项循环加分块内层循环时，预算计数与结果累计分开，物理条目只在首块计一次。**
- 证据：2026-11-04 封口分块把 `ingestSessionFiles` 改成每文件多事务，直接把累计 `total.files` 当预算计数器会让分块放大文件数；局部计数器又与参数 `files` 同名，typecheck 报 TS2300 才发现。
- 防护：预算用 `fileCount`/`bytes` 独立变量，`total.*` 只做输出；内层循环用 `counted` 标记首块；新增循环后先跑 `bun run typecheck` 与多块集成测试。
- Seen 1× (2026-11-04).

**延迟发调用的适配器开 `mutable` 后，同组行跨批次到达会按重放顺序刷新正文。**
- 证据：2026-11-04 WorkBuddy 把同一 `messageId` 的 reasoning / function_call / assistant 归成一笔；测试让 function_call 下一批才追加，重放按 `byte_offset` 排序，刷新后的 `replyContent` 把 tool_use 排在 output_text 之后，与文件里的 `parentId` 链顺序相反。
- 防护：窄测试加一条「同 reply 的行分批到达」，断言刷新后正文含全部内容块，别把内容块顺序写成精确相等；真要按原始链还原顺序，先确认链是否指向稳定的回复根，别默认重放等于文件顺序。
- Seen 1× (2026-11-04).

**本地会话的时间戳先验证基准，再拿去和网关对齐。**
- 证据：2026-11-05 Hermes 适配器把 `messages.timestamp` 当开始时间写进 `started_ms`；只读对账发现它是消息落库时刻，与网关 `started_ms + ms` 只差 5–80 毫秒。旧 ±60 秒开始窗把 58 条合并里的 30 条挂到错主，本地完成时间与错主网关结束时间中位差 24.7 秒。修复见[完成时间基准](implemented/bug-fix/2026-11-05-hermes-call-time-basis.md)。
- 防护：新来源的每个时间字段，先在只读数据上同时与网关 `started_ms` 和 `started_ms + ms` 对账，看它落在哪一端；本地只读得到落库时刻时填 `endedMs`，让 `byConvEnd` 用 ±2 秒完成窗，别复用开始窗。
- Seen 1× (2026-11-05).

## 查询与并发

**守卫类修复要按「守卫放行后的每组成本 × 预计放行面」复测退化，不能只测零命中态。**
- 证据：2026-11-04 F26 候选①（指纹短路）在零命中态实测 1.5 ms，部署后参与链指纹随流量增长、守卫对每个真实会话组放行，qt 驱动的相关子查询回到 O(current 组数)×页内指纹会话数，原始 SQL 75 ms；模拟页内 50 组指纹 367 ms。候选① 的 note 里本就写了这条退化预警，但当晚验收只对了零命中口径。
- 防护：给「仅当 X 才执行的昂贵分支」做修复验收时，先估 X 的增长面，再造出 X 满铺的合成态测一遍（本次用 `UPDATE` 副本把 top-50 组全部置指纹模拟）；EXPLAIN 断言钉住驱动表形状（`SEARCH t` 而非 `SEARCH qt`）。
- Seen 1× (2026-11-04).

**全同步查询的并发合并只在同一宏任务内生效，测试要区分「同 tick 并发」与「跨宏任务并发」两个口径。**
- 证据：2026-11-04 F27-A 单飞测试里 5 个 `handler()` 同 tick 发出，`listSessions` 调用数等于 1 次；生产上各请求是独立宏任务，同步查询执行期间事件循环被占住，后续请求进不来，等它完成时 map 已清理——热查询（40 ms）下 5 并发各跑各的（墙钟 188 ms），合并只对冷页慢查询这种「查询在途跨宏任务」的形态有意义，而全同步查询根本不会跨宏任务。
- 防护：给同步查询做请求合并时，先确认查询会不会让出事件循环；不会让出的，合并的收益上限就是「同 tick 重复」，跨请求合并要靠缓存或 Worker 化，报告里如实分开写。
- Seen 1× (2026-11-04).

**测试收尾要 close 的库，别在读连接上留普通 SELECT/PRAGMA 快照：WAL 非空时 close 的 checkpoint(TRUNCATE) 会被它阻塞满 busy_timeout。**
- 证据：2026-11-08 v15 覆盖索引钉子测试，种子 240 行后在 `store.read` 上跑 `SELECT sql FROM sqlite_master`/`PRAGMA index_info`，`f.close()` 的 `wal_checkpoint(TRUNCATE)` 被读连接快照阻塞约 5000ms（writer `busy_timeout`），测试超时；同一测试只跑 EXPLAIN（只编译、不开 WAL 快照）或把 SELECT 挪进 `store.write` 的 writer 连接即 36ms 通过。包进 deferred 只读事务也救不了——`read.close()` 排在 checkpoint 之后，快照来不及释放。
- 防护：读取断言优先用 EXPLAIN，或在 writer 连接的写事务内顺带读出所需事实；不在读连接上留普通 SELECT/PRAGMA 快照再 close。独立脚本因进程强制退出掩盖此坑，bun test 等句柄 drain 才暴露，不能靠脚本跑通推断测试也跑通。
- Seen 1× (2026-11-08).

**新增后台数据来源时，验证最慢同步单元和真实载荷量；async 与外层墙钟预算都不能中断一条同步 SQL。**
- 证据：2026-11-05 F12（`88022f0`）在 `measureBodyBytesChunked` 为 WITHOUT ROWID 表加入整表求和，2 KiB 用例通过，生产同项只读实测 8.06 s；既有性能测试的 block/骨架仅 64 B/32 B，未覆盖 GiB 级载荷。`pruneRawBounded` 的 200 ms 判断也在单批返回后，生产单批 raw_prune 写事务曾到 29.4 s。评估与防护见[容量计数与主线程阻塞回归](implemented/bug-fix/2026-11-05-capacity-meter-main-thread-regression.md)。
- 防护：每个新增表检查 INSERT/UPDATE/DELETE 与在线全部消费方；性能回归覆盖实际 timer/HTTP 装配、空命中和触顶命中、大行与真实字节规模。单独记录 max 同步耗时；没有 rowid 时检查复合主键分页或改变执行位置，不允许默认为整表快查。
- 同日复现：容量计数正常后，生产 `raw_prune` 最长写事务仍到 156.9 s。主审发现准备阶段批量取 TEXT 长度会重读大载荷，准备超过预算后先退出又会永久不推进；应同时验证候选准备与首批进展。修复与 GiB 验收见[保留清理边界](implemented/bug-fix/2026-11-05-retention-batch-bounds-and-disk-target.md)。
- 再次复现：2026-11-06 pending 累计约 8 小时，writer.pending 与 writer.hook_absent 合计不足 1 秒；准备 SELECT 每轮沿时间索引回表，LIMIT 200 不限制空命中的历史扫描。实际 SQL 计划与宽行回归见[首页查询扫描修复](implemented/bug-fix/2026-11-06-homepage-timeout-query-scans.md)。
- Seen 2× (2026-11-05, 2026-11-06).

**页面来源文案按行上的 agent 派生，不按第一个接入来源写死。**
- 证据：2026-11-05 Hermes 人工走查发现右栏身份行、路由页与证据结论把 `via='session'` 一律写成「droid 会话文件」与回调路径解释；Hermes 本地行被标错来源。`grep droid` 正好只有这些文案点，库内对账全对，页面却错。修复见[会话文件来源标签 note](implemented/bug-fix/2026-11-05-session-source-tag.md)。
- 防护：新增来源的完成条件加一项「页面上所有出现来源名或来源解释的位置」；来源标签从行上的 `agent` 派生，不写字面来源名。人工走查至少打开一个合并会话与一个纯本地会话，两者都要看右栏身份行与证据折叠区。
- Seen 1× (2026-11-05).

**长耗时先按调度口径对账，再怀疑代码回归；`taskpolicy -b` 能把后台限速复现成对照。**
- 证据：2026-11-06 生产派生单轮 100–150 s，日志只到 compute 段，看上去像算法回归。同一组、同一份库、同一二进制在普通 QoS 下只读复算 34 s；同一条命令套 `taskpolicy -b` 后 149.3 s。生产由 launchd 托管，plist 写着 `ProcessType=Background`。此前还把「改前 66 s」当基线，实际部署前已是 85–88 s 且随组增大单调上涨，两个数不可比。
- 防护：报生产单次耗时的趋势前，先钉三件事——口径（是否同一段计时）、同期基线、调度类型（`ProcessType`/`taskpolicy`）。要复现「生产比本机慢几倍」时，用 `taskpolicy -b` 起同一脚本做对照，能一次分清算法与环境。见[派生链前驱匹配的三次方开销与 launchd 后台调度](implemented/bug-fix/2026-11-06-derive-chain-match-cubic.md)。
- Seen 1× (2026-11-06).

## 设置与前端状态

**旧 localStorage 偏好迁移只在服务端全新文件时采用一次，每次启动都清旧键，别让浏览器存储反复覆盖新选择。**
- 证据：2026-11-09 设置层第一阶段，浏览器合成验收发现刷新后服务端保存的 `dark/zh` 被旧的 `tc.theme=light` / `tc.lang=en` 覆盖回 `light/en`。原因是迁移条件按「服务端该项没有 overrides」逐字段判定，而 appearance/lang 恰好没被单独存成 overrides；每次启动都把浏览器残留值写回服务端。修法见 `142c40b`：`legacyOverrides()` 读完即删键，`initSettings()` 只在 `settings.json` 的 overrides 为空时采用，`changeLocale()` 不再写 `tc.lang`。
- 防护：迁移一次性数据源时，条件绑在整份服务端文件是否为空，不绑单个字段；清旧键与「是否采用」分开，服务端已有任何 overrides 时只清不采用。浏览器验收必须包含一次「保存 → 写入旧键 → 刷新」与一次「全新服务端采用旧键」两条路径；`tests/web.test.ts` 用静态断言钉住空 overrides 条件与删键动作。
- Seen 1× (2026-11-09).

**面板骨架只生成一次时，语言切换要连静态文案一起重画，别只重建内容区。**
- 证据：2026-11-09 面板切到英文后 `set-body` 里的 Theme 变了，页签仍是「外观」「采集来源」，页脚仍是中文；面板 DOM 由 `initSettingsPanel()` 注入一次，`paint()` 只重写 `set-body`，`data-i18n` 缺失。修法：骨架节点标 `data-i18n` / `data-i18n-aria`，`paint()` 按当前 `t()` 就地换文案，事件绑定与开合状态不动。
- 防护：语言切换验收同时查内容区、页签、页头、页脚与 aria；`tests/web.test.ts` 钉住骨架标记存在。启动时按服务端语言只重画静态 chrome（读取 store 还没加载），用户主动切换才走含 `renderAll()` 的全量重绘，两条回调别混用。
- Seen 1× (2026-11-09).

## 功能评估

**改样张前先核对 proposed note 的否决项与读取契约，别把合成段的形态当成规格。**
- 证据：2026-11-10 桌面 demo 评审，样张画了「工具参数」耗时段、Token 输出侧两类、写死的 5 个时间刻度、拼出来的待办来源行，并按 `aria-pressed` 做页签；同一份 proposed note 已否决前两者、要求刻度由分段累加、`TodoSnapshot` 无 `source_req`、页签改 `aria-selected`。样张又被定义为「固定组件形态」，实现会两边为难。
- 防护：动 demo 前先列 note 的 Alternatives considered、服务端配合表与验收条款，逐项比对样张数据常量与字典；改动后跑中英字典键齐全、圆环百分比合计、`node --check` 与样张是否被 `.gitignore` 排除四项，且不要在验收条款里写死合成值（如「51 个叶子」）。
- Seen 1× (2026-11-10).

**样张的默认形态要跟生产宿主对齐，别把评审舞台当成产品默认。**
- 证据：2026-11-10 桌面 demo 默认画成深色舞台上的浮动窗口，四周留白、圆角、投影与控制条；Pis 要求浏览器打开 Web UI 时铺平整个版面，只有打包成 App 才用固定窗口。生产 `web/app.css` 的三栏本来就是 `body` 撑满加 grid，唯一像限宽容器的 `.conv{max-width:940px}` 全仓没有任何 JS 生成 `class="conv"`，是条死规则；删它属于夹带无关改动。
- 防护：改默认版面先查生产骨架有没有实际生效的限宽容器，再决定是改生产代码还是只改样张；宿主分岔写进 UIUX 与 proposed note，样张用同一个 `data-host` 切换两种形态并分别量 `windowRect` 与 `appWidth`，别只靠 `node --check`。
- Seen 1× (2026-11-10).

**用消费端真正可读的交集校准功能覆盖，不用原始工具命中数代替。**
- 证据：2026-11-05 插件评估核对同日验收快照：131 个含 Todo 的会话只有 3 个结算出轮次，只有 1 个已结算会话读到 Todo；合成跨轮 create/update 又证明有 Parser 和已结算轮仍不等于能还原完整状态。见[插件系统必要性评估](../../docs/plugin-system-review.md)。
- 防护：评估新阅读入口时分别列出原始命中、身份与轮次可用、所需正文可读、状态可完整还原四层覆盖；性能测量同时覆盖无关工具和大历史正文，不只测命中的小列表。
- Seen 1× (2026-11-05).

**标题这类会话级元数据别从 `raw_session_event` 的会话列反推归属；先确认 parse 的 `sessionId` 填的是什么。**
- 证据：2026-11-10 来源标题第一轮窄测试里，omp `title_change` 的 `id` 是事件 id，parse 原先一律把 `value.id` 当 `sessionId`。标题行放行后 raw 的 `session_id` 会被写成事件 id；测试先按 `null` 断言，暴露的是既有 apply 会用状态里的根会话 id 回填 raw 列，而不是 parse 事件 id 落库。修法见 `feat/source-title-capture`：标题事件 parse 的 `sessionId` 置空，另加「事件 id 不进 raw 会话身份」断言；保护的是会话归属，不是测试字面值。
- 防护：新增行型先确认字段语义（会话 id / 事件 id / 父 id），再写 raw 归属断言；读侧若依赖状态回填，明确区分 parse 输出与 apply 结果。
- Seen 1× (2026-11-10).

**会话级元数据的归属让适配器在契约里明说，别从「最后一步 apply 返回的 sessionId」猜。**
- 证据：2026-11-10 来源标题 code-review 用合成数据复现：claude 的 `ai-title` 带异 `sessionId` 或后面跟一条 sidechain 行时，ingest 的 `lastSessionId` 被覆盖，标题写到 `["session","<异 id>"]`，根会话卡读不到。zcode 批末另开只读连接重算根会话也有同一类风险：conv_key 与标题文本可能来自两个快照。修法：`SessionTitle` 带 `sessionId`，作用域判定留在适配器内，元数据来源与请求身份共用 `read()` 的同一份结果。
- 防护：新增会话级窄表时，写入键的所有者写进类型契约；子代理文件、seed 前缀、sidechain 与祖先目录同名各写一条回归用例。
- Seen 1× (2026-11-10).

**放行一种新行型时，先看它会不会顺路进了消息窗口或调用归约。**
- 证据：2026-11-10 WorkBuddy 把 `ai-title`/`custom-title` 从 `IGNORED` 移除后，标题行没有 `messageId`，带 `content` 时落入「无 replyId」分支，被当成一条伪造的 `tool_result` 追加到窗口，下一笔调用的请求体多出一段不存在的工具结果。修法：标题行更新 state 后立即返回，不参与消息与调用路径。
- 防护：新增行型除了断言目标窄表有一行，还要断言既有请求正文不变；坏行阻断的批次不跑批末副作用。
- Seen 1× (2026-11-10).

**整表清理放进逐行循环前，先用生产副本量一次单事务成本。**
- 证据：2026-11-10 整会话保留首次副本预演，`purgeTargetsTx` 每个会话都扫全库无引用块，`resetSessionCursorsTx` 按 `session` 与 `sort_key` 代际前缀逐组全表扫 11 GB 库；419 个会话耗时 36 分钟，单会话最长 38.5 秒。合成 fixture 只有几十行，测试全绿。增加 `i_req_session`、`i_req_sort_generation`、`i_raw_session_event_generation`，块回收改为本会话范围加批次一次清扫后，421 个会话 2 分 53 秒，单会话最长 2.87 秒。
- 防护：删除与维护路径合入前，至少在生产副本上跑一次全量 `--apply`，记录总耗时与单事务最大值；逐行循环里不允许出现与单行规模无关的全表扫。预览统计同样先量：精确独占 block 要扫 34M 行，改为按引用估算并在输出与文档里写清差额。
- Seen 1× (2026-11-10).

## 已晋升到常备规则

晋升后的条目在这里保留一行规则名、日期与证据锚点；规则正文只在它的新家。

**新 worktree 的依赖软链与 `info/exclude`。**
- 证据：2026-10-25 新建 worktree 后 `tsc --noEmit` 找不到 `@types/bun`；规则正文见[落地方案在 worktree 分支里做](implemented/process/2026-10-28-implementation-worktree.md)的「依赖」节。