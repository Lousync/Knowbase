# AI教学模块 真机验证 · 问题记录（第二轮）

> 日期：2026-09-07 下午 ｜ 主干：`209ee15`（§11–§15 + 全局画像移入仓库 + 稳定性三修，含 monaco 0.55.1→0.56.0）
> 方式：主仓 `npm run dev`（dev 实例 userData 隔离）+ devbridge（`127.0.0.1:8465`）真实点击/键盘/SQL/文件系统全链路验证；测试库 `E:\test`（工作区「数学」）。
> 与上一轮（凌晨 · b301868 · 记录在主纲《真机验证发现的问题》节）的编号衔接：上轮 A*/B*/D* 为本轮**复验项**；本轮新发现编号 **V***。

## 0. 重要环境事实（影响本轮覆盖面，非产品缺陷）

1. **配置的真实模型全线不可用（上游变更，非产品问题）**：OpenCode Go 网关 `GET /models` 200 但所有 `POST /chat/completions` 返回 `HTTP 400: Request is missing x-opencod…`（要求新增 `x-opencode-go` 类归属头）。同日 10:19–12:19 该配置还能正常回复（DB 内可见带真实 token 用量的 assistant 消息），13:27 起全部 400 → 判定为**上游新强制要求**。两个 DeepSeek 供应商 401、ollama 端口未开。→ 本轮所有 LLM 依赖链路改用**本地 mock OpenAI 兼容服务**（`tmp/verify/mockllm.mjs`，端口 8899，按关键词回放 quiz/ask/plan/profile 协议块）完成端到端验证；真实模型下的输出质量类验收（如「### 标题」规则的实际遵守度）不在本轮结论内。
2. **验证前置阻塞 V-1（见下）**：干净环境 `npm run dev` 渲染层直接 500。本轮为完成验证**临时给 `node_modules/monaco-editor/package.json` 打了 exports 兼容补丁**（备份 `tmp/monaco-editor-package.json.bak`，验证结束已还原）。文中 V-1/V-7 复现均以此补丁环境为准。
3. `E:\test\AI教学\` 根级 `09-07 画像诊断*` 三个文件夹与 DB 中 12:18–12:22 的 3 个「画像诊断」会话为**并行另一实例产物**（未绑定工作区 → 界面按 3-39 语义不展示，行为正确），不计入本轮缺陷。

## 1. 本轮新发现问题

| # | 级别 | 问题 | 现象与复现 | 分析（根因/定位） |
|---|---|---|---|---|
| **V-1** | **阻塞** | monaco-editor 0.56.0 的 `exports` 映射破坏本仓 `monaco-setup.ts` 的深路径 `?worker` 导入，**干净环境 dev/build 渲染层整体白屏** | 首次 `npm run dev` 后窗口空白、`/ui/tree` count=0；vite 报 `Failed to resolve import "monaco-editor/esm/vs/editor/editor.worker?worker" from "src/lib/monaco-setup.ts"`（json/css/html/ts worker 同） | `209ee15` 将 monaco-editor 升 0.56.0；该版 package.json 新增 `exports` 映射 `{"./*.js":"./esm/vs/*.js", "./*":"./esm/vs/*.js"}`——`monaco-editor/esm/vs/…` 形态的旧深导入不再命中任何子路径（`./*` 会把 `esm/vs/…` 二次拼进 `esm/vs/`）。`src/lib/monaco-setup.ts` L6–L10 全部使用旧形态。**主干代码未修**（本轮以 node_modules 补丁旁证：加回 `./esm/vs/*` 映射即恢复正常启动）。修复二选一：① imports 改走 0.56 新约定（`monaco-editor/editor/editor.worker?worker` 等 5 处）；② 回退 0.55.x 并在文档记录锁版本原因。不修则新克隆开发环境与生产构建必坏，属发布阻塞。 |
| **V-7** | 高 | monaco 0.56 编辑器**运行期生命周期错误**：AI教学↔编辑器 往返跳转后编辑器 tab 全丢、内容空白、无回退 UI（直到刷新） | 复现：对话里「✓ 已生成文档 →」→「在编辑器中打开 ↗」→「返回 aiTeaching」→ 顶栏「画像」→（再次跳编辑器）→ 编辑器区仅剩 vault chip，已开的 2 个文件标签消失、返回 chip 消失、无 PaneErrorBoundary 兜底文案。期间 `/errors` ring 连续 Uncaught：`reading 'setClassName'`(View2.onThemeChanged)、`reading 'getWidgets'`(View2._computeGlyphMarginLanes)、`Model is disposed!`(TextModel.getVersionId→DecorationsTrees.getAll)；React 日志显示 PaneErrorBoundary 曾捕获 `InstantiationService has been disposed` 并重建一次。首次跳转（画像→ensure 骨架→打开→返回）正常 | 与 V-1 同族：exports 断链使 vite 把 monaco 内部模块拆成**多份非共享实例**（deps 预打包 chunk 混装），编辑器 model/theme service 单例不一致 + 0.56 本身 disposal 时序收紧 → 快速挂载/卸载（保活切换、跳转即开即返）命中 dispose 竞态。`§15` 的 PaneErrorBoundary 只能救渲染崩溃救不了 tab 状态（状态在 boundary 之上被重置换源）。修复顺序：先按 V-1 正规解，然后复测本组错误；若 0.55.x 下仍可复现，升级为 §15 稳定性缺陷单独立项（dispose 与 React 卸载竞态，考虑 MonacoPane dispose 延后一帧 / model reference 计数）。 |
| **V-2** | 中低 | **模板开场消息发送失败完全静默**（ask 卡回答同型）：用户看到一条自己的消息发出去、无回复、无任何报错 | 复现（默认模型=已 400 的供应商）：「＋ 新建任务 → 跟我学（教学）」→ 会话建好、opening 消息上屏、**无任何错误提示**（对照组：同会话手动输入+Enter 失败有 toast「AI 调用失败：HTTP 400…」）。ask 整卷「↑ 统一发送」/单题点选发送也走同一无反馈路径 | `newTask` L511 `void sendText(tpl.opening, cid)`、`sendAskAnswer` L921 `void sendText(text, cid)`——错误 toast 只写在 `doSend`（L488–489），绕过 doSend 直调 sendText 的路径全部丢弃 `r.error`。修复：把失败 toast 下沉进 `sendText`（`r && !r.ok && code!=='ABORTED'` 时提示），或在两个调用点补 `then(r=>…)`。附带 UX：opening 失败的会话应允许「重发开场」（现在重进对话只见死掉的用户消息）。 |
| **V-3** | 低 | toast 自动消失依赖 rAF tick，**窗口失去焦点/最小化期间不过期**：错误 toast 在屏幕上滞留数分钟占住容器 | 复现：触发「登记失败：入库失败：未选择素材文件」toast 后切走窗口（focused=false）；toast 5s 后仍在（后续多轮 probe 持续读到），聚焦后消失 | `Toast.tsx` L50–55 用 rAF 累计 tick/duration 判定过期——背景页 rAF 暂停即冻结计时。修复：到期判定改 `setTimeout` 主驱动（rAF 只做进度条动画），或 `visibilitychange` 时按墙钟补算。 |
| **V-8** | 极低（工具） | devbridge `ui.window {action:'maximize'}` 返回 `maximized:false, minimized:true`（状态标志滞后一拍） | maximize 调用即时返回的 bounds 已是全屏，标志却报 minimized；随后 restore 正常 | `window-actions` 读取 `isMaximized()/isMinimized()` 早于 Windows 事件落定。仅影响自动化脚本判断，顺手修可在返回值前加 `setImmediate`/`once('maximize')` 等待。 |

## 2. 上轮遗留缺陷复验结论（b301868 → 209ee15）

| 上轮# | 结论 | 本轮真机证据 |
|---|---|---|
| **A2** | **主干仍在（实锤）** | 删除确认框仅「保留文件夹 / 删除文件夹」两按钮。点「**保留文件夹**」（用户心智=取消）后会话仍被删（`agent_sessions` 行消失 n=0，文件夹保留）。代码 `delSession` L990–1016：`agentDeleteSession` 无条件执行，对话框返回值只决定文件夹去留。标题「删除会话」却无中止删除的出口（按钮/Esc/背景四种出口全删）。建议补第三按钮「取消」或把文案改为「文件夹处理方式」。 |
| **A3** | **未复现（当日改名场景已正常）** | 双击页签改名「深度研读（织网）」→ 输入「删除试验田」提交：DB title 与新名一致，**文件夹同步改名** `09-07 深度研读删除试验田（织网）`（保留 MM-DD 前缀、无 `(1)` 后缀、无孤儿夹）。旧 A3（删旧后重建同名→改名产生双 `(1)` 夹）场景本轮未重做（成本高），`renameSessionFolder` 的 uniqueFileName 逻辑未变，降级为观察项。 |
| **A4** | **主干仍在（实锤）** | 删除 2 个测试会话后 `workspaces.json.sessionWs` 仍含两个已删会话 id（残留累计 8 条，含 09-06 四个无 DB 行的历史孤儿）；`delSession` 无 `unassignSession` 调用。附属：会话删除后 `SOURCES/<会话名>/` 工作区级素材目录同样不清理（观察项，或按 3-39 语义保留但应提供清理入口）。 |
| **B2** | **主干仍在（结构性，维持原判）** | 会话模型菜单实测：OpenCode Go 33 模型 + DeepSeek + ollama **平铺 37+ 项单列**，供应组名以文字前缀内嵌每项；无搜索框、无分组折叠、非聊天用途模型（`…-vision-exp` 等）可直接选中。测试库当前 5 供应商 36 模型尚可，模型数再涨即成可用性痛点。 |
| **B4** | **主干仍在（实锤）** | 双击改名输入框 **autoFocus 无 select()**（L1164），新文本插在光标落点处而非替换：真机结果 title=「深度研读**删除试验田**（织网）」。旧标题无法一键清空，改名体验=追加。修复一行：`onFocus={e=>e.currentTarget.select()}`。 |
| **B5** | **撤销/关闭（原判定系快捷键混淆）** | 命令面板真实快捷键是 **Ctrl+Shift+P**（`App.tsx` L178；Ctrl+P 是标题栏全局搜索=仓库页面/目录/标签）。真机：Ctrl+Shift+P 打开面板，列表含「**打开 AI教学**（讲义/研读/出题）」且可跳转。上轮用 Ctrl+P 找命令判「未实装」不成立。可另开的改进：全局搜索框搜「AI教学」出现的是「AI教学目录」仓库条目，无「打开 AI教学」命令项——如需可加入，属增强非缺陷。 |
| B1（约束弹层旧稿覆盖） | **已修复 ✓** | 见 §3 P2 链路：外部手改 `CONSTRAINTS.md` → 重开弹层读到新内容；保存 toast+落盘；**下一轮发送 system 注入即含新文本**（mock capture 实锤 `SEDIAG/EXTSYNC` 字符串注入，「AI 每轮发送时重读」为真）。 |
| B3（Invalid Date） | **未复现** | 新消息 ISO 落库、旧消息空格格式均可渲染；真机界面与消息 JSON 均无 Invalid Date。 |
| A1（素材表单打不开） | **已修复 ✓** | 右栏「＋素材」表单弹出、字段齐全（名称/类型/入库状态/浏览/页码区间/备注/取消/确定登记），必填校验与登记失败异常 toast 均正常。 |
| B6 | 已修复（B1 路径同源）✓ | 弹层保存后顶栏「本会话要求」摘要条同步。 |

## 3. 本轮真机通过项（正向验收摘要）

- **R23 启动直复**：上次工作区+会话直接恢复，无选择页闪烁（boot 日志/界面时序正常）。
- **P2/§8.1 会话要求中型弹层**：打开/预填/`Ctrl+Enter` 保存/落盘 toast/外部编辑四路同步（重开读文件 + 发送时重读注入均实锤）。
- **P4/§6B 保活**：编辑器回跳「返回 aiTeaching」后，文档阅读视图状态保留（V-7 崩溃前场景验证）。左右侧栏折叠 rail（4px「拖拽或点击展开」条）双向可用。
- **P5 选择页**：「继续上次工作区「数学」」条、搜索框、新建卡、hover 三键（改名/画像/删除）、全局画像卡齐全；工作区 chip 回选择页正常。
- **P6 素材库**：SOURCE.md 骨架（含字段契约说明）在工作区级 `SOURCES/<会话>/` 自动创建 ✓；**code 素材 L1–L4 行区间提取端到端 ✓**（提取稿正确截取+可编辑提示+SOURCE.md「已提取: ✓ → 文件」程序写回）；**手改畸形 SOURCE.md 容错 ✓**（无 dash 字段行/`#### 3.` 无字段条目/坏页码区间均不崩溃不丢条目）。
- **P7 题目视图闭环（mock）**：`### 标题`+「整理成文档」→ `讲义·<标题>.md` 落盘、chip 变「✓ 已生成文档 →」→ 阅读视图方案 B（返回对话/在编辑器中打开）；出题 → 题数角标「📝 题目（2）」→ 题目卡片 → 开始答题一题一屏 → 点对自动跳/点错红+解析 → 「🧾 最近测验 1/2 · 报告 →」→ **报告 md 自动落盘**（得分表+错题解析）+ quiz 记录写 `records.json`（file 模式）。
- **§11 活计划**：`plan` 围栏 → 左栏任务规划步骤列表（done ✓/current ● 状态、徽标「2 题」）；新会话模板步骤 fallback 种子渲染 ✓；阅读/折叠正常。
- **§12/§13 ask**：`ask` 整卷 → composer 变提问卡（‹1/3› 翻页、选项点选记忆、「已答 3/3 · 可提交」、↑ 统一发送**成功**发出「【整卷回答】1. …→ …」格式化消息并进入下一轮）。注：中途「点 ↑ 无效」为自动化 tree 索引漂移误报，人工复核消息实际已发送。
- **§14 画像**：对话内「画像」chip → ensure 会话 PROFILE.md 骨架（内容含三层说明）→ 跳编辑器（首跳）；选择页全局画像卡/工作区卡 hover 画像入口在位。再跳被 V-7 打断。
- **§15**：RootErrorBoundary.tsx 在位；PaneErrorBoundary 真机触发过捕获重建（`InstantiationService disposed` 被兜住未白屏）。
- **§9 用量**：UsageRing「≈ 1.3k」点击弹面板（月度/预算文案在位）；再点收起。
- 其它：活动栏「AI教学」标签、新建任务菜单模板（label+desc）、禅模式进/Esc 退、会话级模型覆盖（选 mock-tutor 后跨多次发送稳定，**未复现**上轮「回退 hy3」观察——因真实供应商故障期间仅观察到一次，不立案）、命令面板「打开 AI教学」、`ui.window maximize/restore`（V-8 标志滞后但功能可逆）。

## 4. 未覆盖项（需人工或有可用模型后补验）

1. 真实模型下的输出协议遵守度（### 标题率、quiz/ask/plan JSON 合法率）与整理成文档措辞质量 —— 本轮全部以 mock 代打。
2. 视觉/动画类：§1.7 最大化贴边与恢复动画、§2/§3 折叠动画顺滑度、§8.1 弹层尺寸观感、§10 题目视图去气泡效果、快速定位条（reader 大纲条）交互 —— 需人眼（本轮模型无图像输入通道，截图无法判读）。
3. 左栏资源管理器**右键菜单**逐项与宽度钳制（§7）—— 树文件行 DOM 结构未命中自动化选择器（代码中 truncate/max-w 已在位）。
4. ask **hover 摘要层**（CSS :hover，CDP 点击不触发）。
5. A3 完整场景（删旧留夹→重建同名→再改名）与 §1.7 拖拽贴边恢复。

## 5. 修复优先级建议

1. **V-1（发布阻塞）**：monaco imports 改新 exports 约定（5 行）或回退 0.55.x —— 立即。
2. **V-7**：V-1 正规修复后复测；若错误族仍在，按 dispose 竞态单独立项（保活切换即触发，影响 §6/§14 全部跳转链路）。
3. **A2 + A4**：删除链路一次修完（补取消出口 + `unassignSession` + `SOURCES/` 目录处置策略）。
4. **V-2**：失败提示下沉 `sendText`（模板开场/ask 发送/未来新路径一劳永逸）。
5. **B4**（一行 select()）、**V-3**（toast 计时改墙钟）随手修。
6. OpenCode Go 若继续支持：适配器支持自定义供应商头（`x-opencode-go`）；否则从预设模板移除。

## 6. 验证环境与事故留痕

- dev 实例：主仓 `npm run dev`，bridge 8465，`E:\test`；mock LLM `tmp/verify/mockllm.mjs`（8899）；请求样本 `tmp/verify/mock-last.json`、逐轮摘要 `tmp/verify/mock-capture.jsonl`；交互树快照 `tmp/verify/tree-dump.txt`；renderer 错误 `tmp/verify/errors-dump.txt`。
- 测试数据（**可清理**，均在 E:\test 与 dev userData，不影响生产）：会话 `c83739b3`（跟我学（教学）(1)：mock 回复 5 轮、讲义·Mock回答 1.md、测验·随堂测验 09-07 14 10.md、被污染的 CONSTRAINTS.md/SOURCE.md、demo.py 提取稿）；已删会话 `1bbb2df7`（留 `09-07 深度研读删除试验田（织网）` 孤儿夹 + sessionWs 残留 = A4 物证）；设置内新增「Mock验证」供应商（models=[mock-tutor]，可随时删除）。
- node_modules monaco exports 临时补丁**已还原**（`tmp/monaco-editor-package.json.bak` → 原文件）；dev 实例与 mock 进程已关闭。

## 7. 拍板结论与代码核对修正（2026-09-07 下午 · 归档待修）

> 本文 §1/§2 各项已逐条对过代码核对定位；§5 优先级方向维持，争议点已由用户拍板如下。修复另开会话执行。

### 7.1 争议点拍板

| 争议点 | 拍板 | 执行要点 |
|---|---|---|
| V-1 修复方案 | **走方案①改新 imports** | 5 行改 0.56 约定（`monaco-editor/editor/editor.worker?worker` 等）；修后复测 V-7 dispose 族，若确认 0.56 自带再回退锁版本 |
| A2 删除弹窗 | **三按钮** | GlobalConfirm 扩展 `extraLabel`（resolve 由 boolean 变 `'extra'\|true\|false`，旧调用点向后兼容）；delSession ask 分支改「删除文件夹 / 仅保留文件夹 / 取消」，Esc 与背景=取消（真正中止删除） |
| A4 附属 SOURCES/ 目录 | **先保留，后续增强批次加清理入口** | 不随本轮；不做删除连带 |
| OpenCode Go 预设 | **先放着不动** | 预设保留，不投自定义供应商头适配；连不上=不可选，无功能影响 |
| 增强项（B5 搜索入口 / 重发开场） | **两项均随本轮带上** | ① QuickSearch 命中「AI教学」关键词时插入「打开 AI教学」动作项（复用 App.tsx L230 命令，新 kind 不动知识库搜索语义）；② 死会话（仅 opening 用户消息无回复）给「重发开场」按钮，实现取简单方案——重发最后一条用户消息，不关心模板来源 |

### 7.2 核对修正（修复会话注意，勿按原文档字面施工）

1. **V-2 范围修正**：`void sendText` 实际 **5 处**（index.tsx L511 newTask / L588 / L911 / L921 sendAskAnswer / L972 PPT 逐页讲解），非文档所列 2 处。修复取「下沉 sendText」方案：toast 移入 sendText（`r && !r.ok && code!=='ABORTED'`），**同时删除 doSend L488–489 自带的 toast** 防双重提示。
2. **V-3 机制修正**：`Toast.tsx` L47 实际是 `setInterval(50ms)` 非 rAF。滞留现象由 Chromium intensive throttling 解释（隐藏/被完全遮挡页面 interval 压到每分钟 1 tick → 每 tick 仅推进 1% 进度）。修复建议不变：过期判定改 per-toast `setTimeout(remove, duration)` 主驱动（节流恢复后立即补触发），interval 只做进度条动画。
3. **A2 根因补充**：GlobalConfirm 当前为两键 boolean 结构（Esc/背景均 resolve(false)），`agentDeleteSession` 无条件执行——「取消整个删除」在现有 API 里表达不出来，故需 7.1 的组件扩展。
4. **A4 修复成本确认**：`aiTeachUnassignSession` preload/main/主进程三端齐备（preload L249、`aiTeachingWorkspaces.ts` L196/L228），delSession 补一行调用即可。

### 7.3 待修复批次清单（✅ 2026-09-07 下午已全部落地，tsc 双门禁零新增 + vite build 通过；V-7 复测与真机 smoke 待做）

1. **P0** ✅ V-1：monaco-setup.ts 5 行 imports 新约定（`monaco-editor/editor/editor.worker?worker` 等）→ build 通过，worker chunk 正常产出。
2. **P1** ✅ A2+A4：GlobalConfirm 扩展 `extraLabel` 三键（resolve `'extra'|true|false`，向后兼容）+ delSession 三键弹窗（取消/Esc/背景=中止删除）+ `aiTeachUnassignSession` 调用。
3. **P2** ✅ V-2：失败 toast 下沉 sendText（5 处路径覆盖）+ doSend 去重；附带增强：死会话「重发开场」按钮（重发该消息文本）。
4. **P3** ✅ 随手修：B4 select()；V-3 per-toast setTimeout 主驱动（interval 仅进度条）；V-8 waitWinState 轮询。附带：vaultOpen.ts 因 showGlobalConfirm 返回类型拓宽补 `ok === true` 收敛。
5. **P4** ✅ 增强两项：QuickSearch 新增 'command' 结果类型（命中「AI教学」置顶「打开 AI教学」，App 传 onRunCommand=openTab）；死会话重发开场见 P2。
6. **残留**：真机复测 V-7（0.56 正规接入后 dispose 竞态是否仍在，决定是否锁 0.55）；tsc 存量债务未动（web 27 条含 TabBar 'export' 等、node 4 条，均与本批无关）。
