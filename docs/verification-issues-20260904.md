# 验收问题归集（2026-09-04）

> 范围：本次验收手册（`tmp/验收手册-20260903.md`）实测中发现的问题。
> 责任：本对话只归档，不修代码。修复交给后续会话。
> 状态：⏳ 待修复 / ✅ 已修复 / 🚫 不修（已评估）

---

## ISS-2026-09-04-01　编辑器 `[[` 补全「输入字符不生效」

- **状态**：✅ 已修复（2026-09-04 修复会话）
- **严重度**：🟥 高（核心 B4 验收项基本不可用）
- **关联验收项**：验收手册 **B4 `[[` 双链补全**（重点验）
- **实测环境**：主仓库 `fix/optimize-v2.15.1` @ `99d8871`，真机 E:/knowledge 仓库

### 现象

用户在编辑器打开 `我好.md`（位于 408 学习空间目录下，与「你好」（目录）/ `随手笔记.md` / `验收手册-20260903.md` 同级），输入 `[[` + `你` 三字符后，弹出的补全候选**与「你」完全无关**：

- 用户期望：候选含「你好」或以「你」开头的页
- 实际候选：全部为「2009 · 数据结构」「2010 · 数据结构」……「2018 · 数据结构」共 10 条（高亮项 2017 · 数据结构）
- 截图：`clipboard-images/clipboard-2026-09-04T04-38-53-776Z-c6628580.png`

### 复现步骤

1. 知识模块打开任一含正文 `[[` 语境的 .md（如「我好.md」）
2. 行内键入 `[[你`（含光标共 3 字符 + 候选面板）
3. 观察补全候选内容
4. 预期：候选按「你」过滤；实际：候选为无过滤的"全库前 10"

### 代码定位

`src/modules/editor/components/MonacoPane.tsx` 第 212–248 行（`installWikiCompletion` provider）：

```ts
provideCompletionItems: async (model, position) => {
  const linePrefix = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  })
  const lastOpen = linePrefix.lastIndexOf('[')        // ← BUG 入口
  const lastClose = linePrefix.lastIndexOf(']')
  if (lastOpen === -1 || lastClose > lastOpen) return { suggestions: [] }

  const query = linePrefix.slice(lastOpen + 2).trim() // ← BUG 影响点
  const pages = await getPagesCached()
  const lower = query.toLowerCase()
  const matches = pages
    .filter((p) => !lower || p.title.toLowerCase().includes(lower))
    .slice(0, 10)
  ...
}
```

### 根因（决定性）

`linePrefix.lastIndexOf('[')` 在字符串 `[[你` 上返回的是位置 **1**（第二个 `[`），而 `slice(lastOpen + 2)` = `slice(3)` 取到的是**空字符串**。

| 输入 | linePrefix | lastOpen | query（实际） | 期望 query |
|---|---|---|---|---|
| `[[` | `"[["` | 1 | `""` | `""`（尚可接受） |
| `[[你` | `"[[你"` | **1** | **`""`** ← BUG | `"你"` |
| `[[你好` | `"[[你好"` | 1 | `"好"` | `"你好"` |
| `[[a` | `"[[a"` | 1 | `""` | `"a"` |

**结果**：`query` 几乎总是空（或被吃掉第一个字符），filter 退化为 `!lower` 恒真 → 取全库前 10 条按默认序展示，与用户输入字符无关。

`PageEditor.tsx:439` 的旧实现是同样的反模式（`lastIndexOf('[[')` 写得对，但这段 MonacoPane 的 provider 是独立新增的，沿用了错误的 `lastIndexOf('[')`）。

### 建议修复方向

1. **决定性修复**（必做）：`linePrefix.lastIndexOf('[')` 改为 **`linePrefix.lastIndexOf('[[')`**，并把 `slice(lastOpen + 2)` 改为 `slice(lastOpen + 2)`（`[[` 长度 2，配合 lastIndexOf 的"匹配起点"语义保持不变；或改用 regex `[[` 匹配后 +2）。改完写最小复现：
   - 输入 `[[你` → 候选只剩 title 含「你」字样的页
   - 输入 `[[` → 候选按默认序（updated_at desc 或拼音）展示前 10
2. **回归核查点**：仓库内若存在「你好.md」并已是正式页（status 非 draft 且有 frontmatter id），应在输入 `[[你` 时出现在候选；当前若「你好」只是目录（无对应 .md），则不应出现（这是预期行为，不是 bug）。

### 次级体验问题（同一现象附带发现）

补全 candidate 完全不感知**当前文档所在路径**。用户从文件树看到同级「你好」想引用，但补全给的是「数据结构 2009-2018」全库按默认序的前 10。建议（修完主 bug 后再做）：
- **路径感知排序**：把当前文档所在目录及其祖先/子目录的页排前（类似 Obsidian 补全的距离衰减）
- **目录提示**：用户输入词若与目录名精确匹配，提示「该路径是目录，是否展开其下的 .md？」（可点击展开）
- **默认排序口径**：当前 `.slice(0, 10)` 之前没有显式排序，依赖 `getKnowledgePages()` 内部顺序；建议显式 `by updatedAt desc`，保证候选稳定可预期

### 影响

- B4 验收项**当前不可通过**——用户实际点击补全会插入与意图完全无关的链接（截图里若直接回车会插 `[[2017 · 数据结构]]` 而非 `[[你好]]`）
- 受影响路径：
  - 图谱边：错误的双链入图后被 resolver 解析失败 → 进入 `unresolved` 虚节点池，污染图谱数据
  - 反链：被错误指向的页会多出一条「假反链」
  - 阅读器渲染：图谱后续重建时这些 unresolved 会被清理，但错误数据已写入用户文件

### 备注

- 「你好」在文件树显示为**目录**（无 `.md` 后缀）—— `getKnowledgePages`（`vaultGetPages`）只返回正式 published 页，目录不入列表是预期行为；但补全 UI 没给用户任何「目录不可被双链引用」的解释，导致用户误以为可引用
- 真机是否还有「你好.md」存在需要核对（用户文件树目前只看到「我好.md」与「你好/」目录）—— 若「你好.md」实际已存在但未归档（仍为 draft），验收手册 L 组双态模型也与此相关

### 修复记录（2026-09-04 修复会话）

- **改动**：`src/modules/editor/components/MonacoPane.tsx:225` `lastIndexOf('[')` → `lastIndexOf('[[')`（工作区既有未提交改动，注释引本 issue）；候选 `matches` 前补显式 `sort(updatedAt desc)` 稳定默认序
- **验证**：Monaco suggestModel（`node_modules/monaco-editor/.../suggestModel.js`）确认——`[[` 弹出面板后继续键入普通字符触发 `onDidChangeModelContent → _refilterCompletionItems → _onNewContext`「new word → retrigger provider」分支，provider 会以修复后的 query 重新过滤；web tsc 无新增错误
- **待真机回归**：输入 `[[你` → 候选只剩 title 含「你」的页；输入 `[[` → 按 updatedAt desc 前 10

---

## ISS-2026-09-04-02　知识库 →「编辑区查看」→ 返回后丢页面上下文（回到顶层目录）

- **状态**：✅ 已修复（2026-09-04 修复会话）
- **严重度**：🟥 高（知识库↔编辑器往返跳转是 B1/B2 核心体验）
- **关联验收项**：验收手册 **B1 知识库 → 编辑器** 与 **B2 编辑器 → 知识库（回跳闭环）** 往返
- **实测环境**：主仓库 `fix/optimize-v2.15.1` @ `99d8871`，真机 E:/knowledge 仓库

### 现象（用户原话整理）

1. 在知识库打开某页阅读（PageEditor 页签或沉浸阅读）
2. 点「在编辑区查看」→ 跳到编辑器 Tab（同一文件）
3. 之后「返回」知识库 Tab
4. ❌ 知识库**回到顶层目录**（不是停留在刚才打开页所在位置）；**刚打开的页面页签也没了**，需要重新按目录路径寻找再打开

预期：回到知识库应停留在刚才打开的页面（页签仍在、左侧树仍展开到该页所在位置）。

### 已核对事实（排除项）

- **App 层保活成立**（`src/App.tsx:204` mountedTabs + `:507-511` renderMounted `display:none` 常驻）—— 切 Tab **不会**卸载 KnowledgeModule，React state（openPageIds/activePageId/selected*）理论应保留
- **App 层 kb-open-in-editor handler**（App.tsx:310-322）只做 `setActiveTab('editor')` + 暂存 `__kbPendingOpenInEditor`，**不触碰** knowledge state
- **knowledge 侧 kb-open-in-knowledge handler**（knowledge/index.tsx:489-508）按 `relPath` 找页 → `handleOpenPage(page.id)` 只打开/切换页签，**不重置** selected/树状态
- **编辑器侧反向派发点**：editor/index.tsx:359 `dispatch kb-open-in-knowledge { relPath }`
- 知识库 PageEditor「在编辑器模块中打开」：knowledge/index.tsx:615-627 `handleOpenInEditor` → 只 dispatch，**无** 关闭页签/重置动作

### 候选嫌疑点（修复会话按序排查）

- **S1 左侧树 selected 被重置**：knowledge/index.tsx 有多个批量 `setSelectedSpaceId(null)/setSelectedCategoryId(null)/setSelectedChapterId(null)` 重置点（798-846、992-1059 区间，均为分类树点击/定位导航 handler）—— 若用户返回触发了某个「打开根目录/上级分类」导航（如 kb-open-in-knowledge 打开失败回落、或 handleOpenPage 的 reveal 分支），树会塌回顶层
- **S2 页签被关**：`handleBackToList`（:556，关当前页+刷新）、`handleCloseTab`（:510）、`forceCloseTab`（:520）只在显式 UI 动作触发 —— 排查「返回」动作是否落到了 PageEditor 的 `onBack`（若用户点的是 PageEditor 顶栏「返回列表」箭头则属预期行为，需与用户确认）
- **S3 模块重挂**：若 KnowledgeModule 实际被卸载重挂（错误边界 reset / React key 变化 / dev HMR），state 全丢 → 与「顶层 + 无打开页」双现象最吻合；复现时建议在 Console 看 `[Knowledge] module mounted · net-v2` 是否出现第二次（mounted 日志 knowledge/index.tsx:182）
- **S4 分屏路径**：若用户处于分屏（主栏编辑器 + 副栏知识库），App.tsx:431-438 的分屏冲突 swap 逻辑会 `setSecondaryTab(old)` 对调 —— 模块在同一栏复用的渲染 props（sidebarOpen 等）变化是否触发 KnowledgeModule 内部重置需复查

### 待澄清（复现必须）

以下信息缺失会显著拖慢定位，请用户补充：
1. **「返回」的精确动作**：a) ActivityBar 点知识库图标　b) 编辑器顶栏「在知识库中阅读」按钮　c) PageEditor 顶栏「返回列表」箭头　d) 其他
2. **查看页面形态**：普通页签阅读（PageEditor）还是沉浸阅读（Ctrl+Shift+R）
3. **是否分屏**：当时主栏/副栏布局
4. **稳定性**：每次必现还是偶发；复现时知识库 Console 是否有 mounted 日志重复输出（对应 S3）

### 已澄清（用户 12:41 答复）

- 「返回」= **编辑器顶栏「在知识库中阅读」按钮**（editor/index.tsx:680-686 → `openInKnowledge` → 无 dirty 直接 `dispatchOpenInKnowledge` :358-360 dispatch `kb-open-in-knowledge { relPath }`；有 dirty 弹「先保存？」确认 :1041-1064）
- 查看页面 = **普通页签阅读**（PageTabBar + PageEditor，activePageId 路径）
- **每次必现**

### 链路复盘（已核实的完整往返）

1. 知识库页签打开 A（`openPageIds=[..A..]`、`activePageId=A`、左侧树展开到 A 所在目录）
2. 点 PageEditor 顶栏「在编辑器模块中打开」（vaultMode 才有，PageEditor.tsx:685-689）→ `handleOpenInEditor(A)`（knowledge/index.tsx:615-627）→ dispatch `kb-open-in-editor` → App.tsx:310-322 `setActiveTab('editor')` + 暂存 pending → EditorModule 打开 A 的 .md（**此时 knowledge state 无人触碰**）
3. 编辑器顶栏「在知识库中阅读」（editor/index.tsx:680）→ 无 dirty 直接 dispatch `kb-open-in-knowledge {relPath: A.path}` → App.tsx:325-329 `setActiveTab('knowledge')`
4. KnowledgeModule isActive 变 true → **激活重读 effect（knowledge/index.tsx:185-193）**：refresh categories/pages/starred/tags
5. knowledge `kb-open-in-knowledge` handler（knowledge/index.tsx:489-508）：`allPages.find(p => p.path === relPath)` → 命中 A → `handleOpenPage(A.id)` → A 已在 openPageIds → 仅 `setActivePageId(A)`（:458-461 早退分支）

**理论预期**：A 页签保留、树位置保留 —— 与用户看到的现象（顶层 + 无页）矛盾。

### 剩余高嫌疑点（按可能性排序，修复会话逐项验证）

- **S3 模块实际重挂**（与「每次必现 + 顶层 + 无页」双现象最吻合）：KnowledgeModule 若被卸载重挂，state 全归零 → 顶层树 + 空页签 + 空选中。复现时开 DevTools 看 Console 是否有第二行 `[Knowledge] module mounted · net-v2`（日志点 knowledge/index.tsx:182）。触发条件候选：编辑器是 workbench 模式（`sidebarEl` portal 到全局侧栏槽 editor/index.tsx:495 `sidebarEl={workbench && on ? wbSidebarEl : null}`）—— workbench 布局下模块容器结构是否变化导致 remount 需验证
- **S5 handler 重注册竞态**：knowledge `kb-open-in-knowledge` effect 依赖 `[handleOpenPage]`（:508），而 `handleOpenPage` 依赖 `[allLoosePages, chapterPages, starredPages]`（:482）→ 激活重读刷新数组后 handleOpenPage 引用变化 → effect **先 cleanup 旧 listener 再注册新 listener**（React effect 语义）→ 若「在知识库中阅读」的派发恰落在 cleanup→add 窗口内，事件丢失 → App 已切 Tab 但页面未打开/定位失败 → 停留在上次状态。该窗口极小，与「每次必现」不太吻合，但**首次从编辑器回跳**时（激活重读恰在此时跑）窗口被放大，值得打日志验证
- **S6 activePage 打开即被预览替换吞掉**：若 `handleOpenPage` 走的是非早退分支（A 不在 openPageIds，例如第 2 步后知识库页签被意外清空），会走 VS Code preview 替换逻辑（:463-475）—— 需确认现象里「页面没了」是否页签真的消失（而不是 active 未切换）

### 给修复会话的复现指引

1. 真机按用户路径完整走一遍，DevTools Console 过滤 `[Knowledge]` 与 `[Editor]`，确认 mounted 日志出现次数
2. 在第 5 步 handleOpenPage 入口临时 `console.log` openPageIds/activePageId 快照，确认早退分支是否命中
3. 若 S3 成立（mounted 日志 2 次）→ 排查 KnowledgeModule 卸载源（workbench 布局容器 / key 变化 / 错误边界 reset）
4. 附带检查：editor/index.tsx:359 反向派发点与 App.tsx:325 接收点是否处于同一 tick（S5 窗口）

### 修复记录（2026-09-04 修复会话）—— S3 成立，根因 = 布局演进丢失模块保活

- **根因（决定性）**：W3 分屏 v1 重构把主内容区从「遍历渲染所有模块、非激活 `display:none` 保活」（旧版 `renderTab`，对照基线 a26d0ba / 77a0396）改为「槽位级渲染」——`renderMounted` 仅剩主栏 `renderMounted(activeTab, true)` 与副栏 `renderMounted(secondaryTab, true)` 两个调用点，**`on=false` 保活分支（:507-511）从未被调用**。非分屏时切 Tab（知识库→编辑器）= KnowledgeModule 直接卸载 → state（openPageIds/activePageId/selected*/树展开）全归零 → 回跳重新挂载 → 顶层目录 + 空页签，**每次必现**
- **改动**：`src/App.tsx` 主栏容器（原 :539-541）在 activeTab 渲染后追加保活层——遍历 `mountedTabs` 中「非 activeTab 且非 secondaryTab」的模块以 `renderMounted(t, false)` 渲染（display:none 常驻）；同 key div 常驻 DOM → 切 Tab 不卸载、状态保留
- **机制验证**：知识库打开 A → 切编辑器（A 进保活层，state 保留）→ 编辑器顶栏「在知识库中阅读」dispatch `kb-open-in-knowledge` → App setActiveTab('knowledge') → A 从保活层恢复可见 + handler 命中早退分支 setActivePageId(A) → 树/页签位置完整
- **web tsc 无新增错误；待真机回归**：重复用户往返路径，页签与树位置应保留

---

## ISS-2026-09-04-03　知识包导入页面（408 学习空间）图片仍不能显示

- **状态**：🚫 不修（包内容缺陷；代码层已做降级提示，根治由包作者补图或重打包）
- **严重度**：🟥 高（知识包核心内容资产不可见；408 是用户主力学习空间）
- **关联**：今日 12:25-12:53 提交 `9d71ed8`（ws:readImage IPC 主进程/preload/types 三层落地）的**遗留未完成项**（当时记录：MarkdownPreview 不消费该 IPC、PageEditor 预览分支预解析+替换未做）；另与 S 组验收（知识包导入图谱修复）同域
- **实测环境**：主仓库 `fix/optimize-v2.15.1`，真机 E:/knowledge 仓库，导入 408 学习空间知识包后阅读知识页

### 现象（用户原话整理）

知识包导入产生的页面（如 408 学习空间）在知识库阅读时，**正文图片仍不能正常显示**（此前已反馈过一次，9d71ed8 落地 IPC 后仍未通）。

### 图片引用全链路（已核实的现状）

| 环节 | 现状 | 位置 |
|---|---|---|
| ① 知识包导入落盘 | 新式包：`stageImages` 复制附件 → `.knowbase/_attachments/knowledge_page/<pageId>/` + 正文改写为 `attachment://vault/<pageId>/<file>`；**旧式引用（含 `_attachments` 相对路径）被 `:114` continue 跳过 → 附件不复制、引用不改写** | `electron/lib/knowledgePackVault.ts:105-129`（跳过条件 :114：`ref.includes('/_attachments/')` / `startsWith('.knowbase')` / attachment:file: 协议） |
| ② 读页兼容改写 | `readPageDoc` 把正文中 `knowledge_page/<36位UUID>/<file>` 形态旧相对引用 → `attachment://vault/<id>/<file>`；**正则要求含 `knowledge_page` 段，旧式 `_attachments/<pageId>/<file>`（无段）不匹配、不改写** | `electron/lib/kbStore/knowledgeVaultRepo.ts:61-66` |
| ③ 显示协议 | `attachment://vault/<pageId>/<file>` 主进程 protocol handler 已通（白名单 UUID + 文件名防穿越，读盘流式返回）；但**无段旧引用不落此协议** | `electron/main/index.ts:460-495` |
| ④ 渲染层兜底 | **ws:readImage IPC 已就绪但渲染层零消费**（`grep src` 无 readImage 引用）；MarkdownPreview img 原样透传 `src`（:149-152）；PageEditor 预览分支无图片预解析 | `electron/preload/index.ts:497`（ws:readImage）、`src/modules/editor/components/MonacoPane.tsx`（editor 侧亦未用） |

### 根因归纳（二选一或并存，需修复会话实地确认 408 包源 md 引用格式）

- **分支 A（附件没落盘）**：408 包源 md 的图片引用是旧 sqlite 附件格式（如 `![x](../../../.knowbase/_attachments/<pageId>/<file>.svg)` 或 `.knowbase/_attachments/...`）→ `stageImages` :114 直接跳过 → 附件从未复制到 `knowledge_page/<pageId>/` → 无论用哪条显示链路都 404
- **分支 B（引用没改写）**：即使附件已落盘，无 `knowledge_page` 段的旧引用不被 `readPageDoc` 正则改写 → 正文保持相对路径 → 渲染层按相对 URL 解析（无 base）→ 破图（sandbox 更无 file:// 权限）

### 建议修复方向（分层，修复会话评估）

1. **落盘规范化（治本，分支 A）**：`stageImages` 对「旧式 `_attachments/` 相对引用」不跳过，而是把 base 文件复制到 `knowledge_page/<pageId>/` 并统一改写为 `attachment://vault/<pageId>/<base>`；同时支持无 `knowledge_page` 段的旧格式识别
2. **渲染层兜底（治本，分支 B + 存量页）**：在 MarkdownPreview 上层（PageEditor 预览分支 / 沉浸阅读 / 编辑器预览共用）加「图片引用预解析」：扫正文 `![..](ref)`，对 `attachment://vault/<pageId>/<file>` 与旧相对引用统一走 **ws:readImage**（或直接复用 attachment:// 协议）读 base64 → 替换为 `data:` URL 后传 MarkdownPreview —— 即 9d71ed8 的未完成项
3. **校验点**：修复后重导 408（勾覆盖本地修改）→ 正文图片、图谱 408 节点、双链三处一致

### 已排除

- `attachment://` protocol handler（main/index.ts:460-495）本身工作正常（对规范引用）
- MarkdownPreview sanitizer 已放行 attachment:/data: scheme（src/components/shared/MarkdownPreview.tsx:31）——问题不在消毒层

### 修复会话评估（2026-09-04）—— 根因 = 包内容缺陷，不在代码层

- **根因（决定性）**：实地核查 12:26 验收截图 + 408 包源（`%APPDATA%/knowbase/plugins/knowbase.kb-408-pack v1.1.0`）+ 真机 E:/knowledge 仓库页面，**问题不在渲染/导入链路**——是**包内容缺陷**：
  - 真机 408 页面图引用 140/145 已内联 `data:image/svg+xml;base64`（9-02 导入时已内联，可正常显示）
  - 真机 5 处（5 个 md：`外存.md`/`虚拟存储器.md`×2/`主存.md`）显示破图 → 源 md 写死了 `![示意图](图片资源缺失:undefined)` 这种占位符，对应资产**根本不在包 assets 中**（机械硬盘结构/DRAM 字位扩展/缺页中断流程 3 类图未生成）—— 12:26 截图「示意图」alt + 空 src 即此
  - 4eb29d7（12:38 attachment://vault 协议 + 存量改写）+ 9d71ed8（ws:readImage IPC）针对**新导入/相对路径断链**问题已修复，与本 ISS 包源写死占位符无关
- **代码层降级（最小修复）**：`MarkdownPreview.tsx` img handler 识别 `src` 含「图片资源缺失|undefined|null」模式时改为显式「📷 图片缺失：<alt>」占位（避免空 src 破图 + 让用户立即识别是包内容缺陷而非渲染 bug）
- **根治**（需包作者侧）：408 包源这 5 处 md 删除占位引用或重打包（脚本可参考 `scripts/fix-408-pack.py` 模板）；包重发布后用户重导（勾覆盖本地修改）即可
- **web tsc 无新增错误**

---

## ISS-2026-09-04-04　设置「快捷键」文档未覆盖新增快捷键（缺 14 项）

- **状态**：✅ 已修复（2026-09-04 修复会话）
- **严重度**：🟡 中（文档完整性问题，用户可发现性受损）
- **关联**：R0-R7 重构期新增大量快捷键，`ShortcutsView` 未同步
- **实测环境**：主仓库 `fix/optimize-v2.15.1`，设置 → 快捷键页

### 现象（用户原话整理）

一些新增的快捷键没有写入「设置 → 快捷键」文档中（该页是快捷键唯一可查入口，缺项导致用户不知道新功能有快捷键）。

### 根因

`src/modules/settings/views/ShortcutsView.tsx` 是**硬编码静态列表**（6 组 17 项：全局/知识库编辑器/知识库侧栏/知识库 Tab/博客/日程），**无数据源、无自动同步**。R0-R7 期间新增的快捷键注册在各自模块/主进程，未回写该文档。

### 缺失清单（全仓 keydown 扫描，对照现有 17 项后差额 14 项）

| 按键 | 功能 | 归属 | file:line |
|---|---|---|---|
| Ctrl+Shift+P | 命令面板 | 全局 | src/App.tsx:118 |
| Ctrl+O | 快速打开/切换文件面板 | 全局 | src/App.tsx:123 |
| Ctrl+` | 全局搜索底部面板（仅 Workbench） | 全局 | src/App.tsx:107 |
| Ctrl+= / Ctrl+- | 界面缩放 | 全局 | src/App.tsx:458/463 |
| Ctrl+J | AI 助手面板开关 | 全局 | src/components/shared/AssistantPanel/index.tsx:156 |
| Ctrl+Shift+R | 沉浸阅读进出 | 知识库 | src/modules/knowledge/index.tsx:863 |
| Ctrl+P | 知识库快速搜索 | 知识库 | src/modules/knowledge/components/QuickSearch.tsx:200 |
| Ctrl+Shift+S | 保存全部打开文件 | 编辑器 | src/modules/editor/index.tsx:374 |
| Ctrl+F | PDF 内搜索 | 编辑器-PDF | src/modules/editor/components/PdfReaderView.tsx:304 |
| Ctrl+Alt+S | 日程与打卡侧栏（系统级 globalShortcut） | 日程/全局 | electron/main/dayPanelWindow.ts:432 |
| Ctrl+C/X/V | 知识库树内 复制/剪切/粘贴（⚠️存疑：可能遮蔽普通复制，需核触发前提） | 知识库 | src/modules/knowledge/index.tsx:902/915/928 |
| Ctrl+Alt+Up / Down | 侧栏置顶停靠 / 桌面小组件（⚠️存疑） | 日程 | electron/main/dayPanelWindow.ts:433-434 |
| Ctrl+Alt+P（可配置） | 密码填充弹窗（⚠️存疑，系统级） | 密码本 | electron/main/passwordFiller.ts:106 |
| PageUp/PageDown/空格 | PDF 翻页（⚠️存疑，属阅读器内部导航） | 编辑器-PDF | PdfReaderView.tsx:302-303 |

### 附带发现（同一文件域问题）

- **Ctrl+O 冲突**：App.tsx:123 全局「快速打开文件」**无模块守卫**；博客模块大纲的 Ctrl+O（blog/index.tsx:255）被其遮蔽——readme 中「Ctrl+O = 博客大纲」说明已过期
- **Ctrl+P 无激活守卫**：QuickSearch.tsx:200 在知识库模块常驻（保活）时即全局生效，可能与命令面板（Ctrl+Shift+P）用户心智混淆

### 建议修复方向（修复会话评估，二选一或组合）

1. **静态补齐（快）**：按上表把 14 项补进 ShortcutsView 对应分组（新增「编辑器」「全局」补充行；PDF/密码等归对应组）；同时修正 Ctrl+O 冲突与 readme 过期描述
2. **单一数据源化（治本）**：把快捷键定义收敛到一份集中表（如 `src/lib/shortcuts.ts`），设置页遍历渲染 + 各模块 keydown 从同一表注册 —— 避免再次漂移；成本较高，可列入后续重构
3. 存疑 4 项（Ctrl+C/X/V、Ctrl+Alt+Up/Down、Ctrl+Alt+P、PDF 翻页）修复时**先核代码触发前提**再决定是否列入文档（避免把"遮蔽系统键"的不当行为文档化）

### 修复记录（2026-09-04 修复会话）

- **改动**：`ShortcutsView.tsx` 全量补齐（新增「知识库 — 阅读」「编辑器模块」「密码本」3 组 + 全局/日程/侧栏扩充）；`sections.tsx` 搜索索引同步 3 个新 anchor 与关键词
- **存疑项核实后均列入**（代码核对解除存疑）：Ctrl+C/X/V 知识库树内剪贴有 `isEditingInput` 守卫（Monaco/输入框内不拦截，src/lib/shortcuts.ts:7）；Ctrl+Alt+Up/Down 与 Ctrl+Alt+P 为系统级 globalShortcut（electron/main/dayPanelWindow.ts:432-434 / passwordFiller.ts:106）；PDF 翻页/搜索有 INPUT/TEXTAREA 守卫（PdfReaderView.tsx:302-303）
- **web tsc 无新增错误；待真机回归**：设置 → 快捷键页浏览/搜索新项

---

## ISS-2026-09-04-05　图谱大量英文短代码标签节点（kb-ds-8-7-3-1）无可读性辅助

- **状态**：✅ 已修复（2026-09-04 修复会话）
- **严重度**：🟥 高（408 学习空间 400+ 节点用户读不懂；验收 T 组的"两行化"覆盖不完整）
- **关联**：今日 22:55 提交 `99d8871`（fix(graph): 节点 label 两行化——title + 父级目录副线）—— **修复仅覆盖 page 节点，遗漏 tag 节点**
- **实测环境**：主仓库 `fix/optimize-v2.15.1`，知识模块 → 图谱（408 学习空间）

### 现象（用户原话 + 截图）

408 学习空间图谱中大量**灰色小方块**节点（如 `kb-ds-8-7-3-1` / `kb-os-file-op-6` / `kb-co-interrupt-5-2` / `kb-os-directory-2-1`）单行显示英文短代码标签，普通用户**看不懂节点含义**。红色大圆节点（"2024 · 数据结构" 等有中文 title 的）相对好读。

截图：`clipboard-images/clipboard-2026-09-04T05-08-02-633Z-0a4a7a36.png`

### 根因（决定性）

- 图谱节点按 `kind` 区分渲染（`src/modules/knowledge/components/graph/GraphCanvas.tsx`）：
  - **page 节点** → `ctx.arc` 圆形
  - **tag 节点** → `ctx.fillRect` 方块（:176-179, :226-229）
  - label 显示策略 `labelAlways`（:260）= tag 节点**始终**显示 label（不需 hover）
- 截图里**全是灰色小方块 = tag 节点**（408 知识包页面的 frontmatter tags 字段每篇都带同名标签，如 title=`kb-ds-8-7-3-1` 同时又是 tag=`kb-ds-8-7-3-1`，导致每个页面对应一个同名 tag 节点，密度极高）
- 99d8871 的父目录副线逻辑（GraphCanvas.tsx:274-281）条件为 `n.kind === 'page' && n.path && parent !== n.title`：
  - page 节点有 `path` → 副线生效
  - **tag 节点的 `path = ''`**（`electron/lib/kbStore/graphIndex.ts:144` 显式置空）→ 副线条件永远 false → 标签节点仍单行英文 label

**结论**：T 组修复**只完成了一半**（page 节点），tag 节点这条线被遗漏；408 学习空间恰好是"页面 title 与 tag 同名"的知识包结构，tag 节点密度爆炸，命中了这一半缺陷。

### 建议优化方向（修复会话评估，组合或择一）

#### 治本：让 tag 节点也能拿到「上下文副线」
1. **数据层补 parentCtx**：`graphIndex.ts:140-148` 给 tag 节点注入 `parentCtx`（取该 tag 关联度最高的 page 的 path 倒数第二段 / 章节级；多个 page 时取最频繁者）
2. **渲染层扩展**：`GraphCanvas.tsx:274` 条件改为 `n.kind === 'page' || (n.kind === 'tag' && n.parentCtx)`，复用同一副线绘制代码
3. **截断/字号**：`subEll` 截断单位 `9 / s` 与字号 `9 / s` 保持一致即可

#### 减密（治标，但能立竿见影）
4. **G3 设置加「默认隐藏 tag 节点」开关**：现有「显示标签节点 / 显示孤立页」可改默认 off，让用户主动开启而非默认满屏
5. **学科前缀翻译**：`kb-ds` → `数据结构`、`kb-os` → `操作系统`、`kb-co` → `计算机网络` 之类（写一份小映射表，给 label 渲染时加中文学科色/前缀 chip）
6. **tag 节点 label 字号/颜色区分**：tag 节点副线（学科）颜色与主 label 拉开对比度，让 `kb-ds-8-7-3-1` 读起来像「数据结构 第 8 章」

#### 长效
7. **hover tooltip 增强**：tag 节点 hover 显示「关联 N 个页面：...」+ 第一个关联 page 的完整路径（`408 学习空间 / 2010·计算机网络 / 物理层 / kb-hdlc-2`）

### 复现/验收口径

- 重启应用 → 知识库 → 图谱 → 408 学习空间：tag 节点（灰方块）应显示父目录副线；图谱密度观感明显改善
- 对照 page 节点（如 `kb-ds-8-7-3-1` page）的副线应一致
- 建议验证 G3「显示标签节点」开关默认 off 后密度立即可读

### 附带建议

- 99d8871 提交描述说"仅对 page kind + parent 与 title 不同时显示"——当初拍板时可能未考虑 tag 节点；可顺手把 tag 节点也补上同类规则，避免后续再有"半成品修复"
- 验收手册 T 组「图谱节点 label 两行化」当前描述的"kb-hdlc-2 父目录副线"对**标签节点**也期望生效（用户反馈的就是标签方块）；建议同步修订 T 组验收口径

### 修复记录（2026-09-04 修复会话）—— 减密 + 治本组合

- **改动 1（减密）**：`GraphView.tsx:32` `showTags: true → false`（DEFAULT_GVC）—— 408 学习空间默认 400+ 灰色方块消失，用户主动开启（设置 → 图谱「显示标签节点」）才显示
- **改动 2（治本）**：`graphTypes.ts:7` GraphNode 加可选 `parentCtx: string`；`graphIndex.ts:140-148` 给 tag 节点注入 `parentCtx`（关联 page 中出现最多的父目录段，例 `kb-ds-...` 节点 → 「数据结构」或具体章节）；`GraphCanvas.tsx:274-281` 副线条件扩展到 `n.kind === 'tag' && n.parentCtx` 复用同一段绘制代码
- **效果**：用户开启 tag 节点时，灰色方块也显示「学科/章节 · kb-ds-8-7-3-1」两行化（与 page 节点一致）
- **缓存**：graphIndex 是缓存的（`.knowbase/cache/graph.json`），用户需重启应用或触发 `kb-graph-refresh` 让新 parentCtx 写入
- **web/node tsc 无新增错误；待真机回归**：408 学习空间图谱默认清爽；开启 tag 节点后 tag 显示学科副线

---

## ISS-2026-09-04-06　知识库「关联网络」侧栏「被引用」对 408 学习空间恒为 0

- **状态**：⏳ 待修复（用户怀疑 bug；侧栏"被引用"恒 0）
- **严重度**：🟥 高（核心反链 UI 不可用，与 R2 链接验收目标不一致）
- **关联**：验收手册 B4 / R2 链接「反链应在被引用页可见」预期；与今日 S 组（2476251 vault 双失效 + mtime 兜底）部分重叠但未修此链路
- **实测环境**：主仓库 `fix/optimize-v2.15.1`，知识库打开 408 学习空间任一页面 → 右下侧栏「关联网络」

### 现象（用户原话 + 截图）

知识库页面右侧「关联网络」侧栏始终显示：
- 手动关联 · **0**
- 被引用 · **0**

用户怀疑 408 学习空间的双链没有走侧栏展示。手动关联 0 是预期（用户没手动建），但**被引用 0** 与图谱看到的 408 节点大量连边矛盾——同源数据应非空。

截图：`clipboard-images/clipboard-2026-09-04T05-16-49-907Z-313f420b.png`

### 链路核对（已落实）

「关联网络」侧栏在 `src/modules/knowledge/components/PageEditor.tsx:1083` 段（不是独立组件，是 PageEditor 内嵌右栏）。`被引用` 渲染 `backlinks` state（:1123-1125），由以下链路填充：

```
PageEditor 加载（:198 / :235）
  → getKnowledgeBacklinkContext(pageId)         // src/lib/ipc.ts:84
  → IPC: knowledge:getBacklinkContext            // preload:69 / knowledgeRepo.ts:610
  → if (isVaultMode()) return vaultGetBacklinkContext(pageId)   // :611
  → vaultGetBacklinkContext(pageId)              // knowledgeVaultRepo.ts:253-296
  → getGraphIndex().incoming[pageId] || []       // :258（与图谱同一份数据）
  → 对每 src 读 .md → regex 找 [[target]] 出现位置 → excerpt
```

### 候选根因（修复会话按序排查）

- **C1 图谱 incoming 真为空**（数据层）：`rebuildGraphIndex` 没把 408 页面互引正确入图。原因候选：
  - 408 包源 md 用的是 `[title](url)` 普通 markdown 链接而不是 `[[title]]` wiki 链接 → `extractWikiOutlinks`（`knowledgeIndex.ts:39`）抽不到 → `outgoingTitles=[]` → `srcToDst` 空 → `incoming` 全空
  - 多页撞同一 title（`createLinkResolver` 撞名置空机制 graphIndex.ts:40-44）→ resolver.resolve 返回 null → 不入图
  - 2476251 修复后**未重启应用**仍用旧 in-memory knowledgeIndex 缓存（重启后才会走 mtime 兜底 rebuild）
- **C2 侧栏反链有数据但显示 0**（渲染层）：PageEditor 的 `backlinks` 加载 useEffect 依赖 / 时序 / 取消逻辑有 bug：
  - 加载时机在 pageId 切换时未重新触发（看 PageEditor.tsx:198-235 的 useEffect 依赖）→ 用户换页后仍显示前页结果
  - 但截图里 "被引用 · 0" 与切换无关，**首次打开新页**就是 0，可能性低
- **C3 userModified/覆盖更新漏路径**（写入层）：`importPackToVault` 在 `if (rowOf(externalId) && ...)` 已存在映射分支（knowledgePackVault.ts:200-215）覆盖更新时也**未触发任何 invalidate**（importPack 入口的双失效是函数级一次执行，覆盖分支共用同一入口的 invalidate 是 OK 的——这条已由 2476251 覆盖）
- **C4 草稿过滤**：`vaultGetBacklinkContext:264` 过滤 `p.status !== 'draft'`。但 `knowledgeIndex.ts:189` 无 status 字段默认 'published'——理论上不影响；除非某次重构把 408 默认置为 draft

### 建议排查顺序（修复会话）

1. **真伪定位**（最关键）：在 vaultGetBacklinkContext 入口加 `console.log('[bl] pageId=', pageId, 'incomingLen=', srcIds.length, 'srcByIdResolved=', sources.length, 'filteredDraft=', sources.length - sourcesFinal.length)`，或直接在终端读 `<仓库>/.knowbase/cache/graph.json` 的 `incoming[<被测页id>]` 是否非空数组
2. **图谱是否也"无入边"**（C1 真伪判别）：若图谱显示 408 节点有入边但 graph.json `incoming` 也非空 → 渲染层问题（C2）；若 graph.json `incoming` 为空 → 数据层（C1）
3. **C1 细化**：抽样一个 408 知识包源 .md 看正文是 `[[...]]` 还是 `[..](..)`；抽样一个被多个页 [[引用]] 的页，看 extractWikiOutlinks 在重建索引时是否能识别
4. **C2 细化**：若 incoming 非空但 backlinks 为 0 → PageEditor:198-235 的 useEffect 依赖项 + 切换 pageId 时的 cleanup 是否有问题（与 ISS-02 修复时 S3/S5 思路相近）

### 建议修复方向（按定位结果定）

- **C1 路径**：在 `importPackToVault` 末尾追加 `invalidateKnowledgeIndex(); invalidateGraphIndex();` 兜底（即便 `importPack` 入口有双失效，模块内部也加一份更稳）；或把双失效下沉到 `atomicWrite` 后 inline 处理
- **C2 路径**：PageEditor 加载 backlinks 的 useEffect 补全依赖 / 加 pageId 变化时 abort + 重拉
- **可视化补丁**（无论 C1/C2 哪种）：侧栏在「被引用 0」且图谱显示有入边时给一行小提示「该页在图谱中有 N 个关联，但反链视图未同步，试试刷新」——避免用户一直看到 0 误判

### 复现/验收口径

- 任一 408 页面（被多页引用的"2024·数据结构" 类）→ 侧栏"被引用 · N"应 > 0 且 N = 该页在图谱的入度数
- 单击"被引用"条目应能跳到源页（PageEditor.tsx:1125 渲染调用 onNavigate 走 handleOpenPage）
- 手动关联（点 + 选目标）应能加进「手动关联 · 1」

---

## ISS-2026-09-04-07　知识库「在编辑区打开」跳编辑器 Tab 但不打开对应文件

- **状态**：🔧 已修复（2026-09-04 19:30，待用户真机验收）——根因与修法见文末补充二
- **严重度**：🟥 高（读写分工 B1/B2 核心闭环的**正向半程**失效：跳得过去、文件开不出来）
- **关联验收项**：验收手册 **B1 知识库 → 编辑器**（与 ISS-02 同链路反向；ISS-02 修复后新报）
- **实测环境**：主仓库 `fix/optimize-v2.15.1` @ `4eb29d7` + 工作区 ISS-01/02/04/05 修复未提交；真机 E:/knowledge 仓库
- **报告时间**：2026-09-04 13:21（ISS-02 保活修复落地后立即测出）

### 现象（用户原话 + 已澄清）

用户 13:21 报：「文件在知识库选择在编辑区打开 → 直接跳转到编辑区但是**不打开对应的页面**」。

已澄清（AskUserQuestion 14:00 前）：
- **入口**：知识库页面顶栏按钮（PageEditor.tsx:686 `onOpenInEditor` → knowledge/index.tsx:1429 → `handleOpenInEditor(activePageId)`）
- **编辑器状态**：**本次运行已打开过编辑器**（EditorModule 已在 mountedTabs → ISS-02 保活层常驻）
- **失败表现**：跳转成功（editor Tab 激活）、左侧文件树在（rootId 已设置/当前仓库）、**无任何 toast**、空编辑区（无标签页 = openFiles 空 / activePath 未设）、**每次必现**

### 与 ISS-02 修复的关系（高度疑似回归）

ISS-02 修复把主栏从「只渲染 activeTab」改为「activeTab + mountedTabs 保活层」（App.tsx:545-548）。**EditorModule 挂载语义随之改变**：

| | ISS-02 修复前 | ISS-02 修复后 |
|---|---|---|
| 切到 editor Tab | EditorModule 每次**重新挂载** | 首挂后**常驻**（display:none 保活） |
| 知识库跳 editor 的打开链路 | 重新挂载 → mount effect（editor/index.tsx:252-259）**必消费 pending** → openRelFromJump → openFile ✓ | 不再重新挂载 → mount effect 不再跑 → 依赖 listener（:240-248）实时处理 |

用户 12:41 验收 ISS-02 时「知识库 → 编辑器」正向是**能打开**的（其链路复盘第 2 步明确「跳到编辑器 Tab（同一文件）」）——**修复后必现打不开 = 极可能保活改动引入回归**。

### 代码链路（已核实）

```
knowledge/index.tsx:615 handleOpenInEditor(pageId)
  → getKnowledgePageById(pageId)               // vault 读源带 path
  → dispatch kb-open-in-editor { relPath: p.path }   // :622
App.tsx:310-322 listener（始终活着）
  → 暂存 __kbPendingOpenInEditor + setActiveTab('editor')
editor/index.tsx:240-248 listener（保活实例，挂载即注册）
  → openRelFromJump(relPath)                    // :228-238
  → delete pending；rootIdRef.current 空则 workspaceGetCurrent→enterWorkspace
  → openFile({relPath, name, type:'file'})      // :163-194
  → rootIdRef 空则静默 return（:165-166）；否则 setActivePath + workspaceReadFile + setOpenFiles
```

### 已排除 / 嫌疑收敛

- **App 层 handler 收到事件**：跳转成功即证明（setActiveTab 执行了）
- **handleOpenInEditor 拿到 path**：dispatch 发生了（否则不跳转 + 会 toast「不在仓库读源」）
- **rootIdRef 有值**：文件树在 = enterWorkspace 成功过
- **无 toast**：排除 openFile 内 workspaceReadFile error、openRelFromJump 的「尚未打开任何仓库」分支 → 指向 **listener/openRelFromJump/openFile 其中一环根本没执行**，或 setOpenFiles 后又被清
- **S5 竞态变体**：listener effect 依赖 `[openRelFromJump]`；保活渲染（isActive=false, sidebarEl=null）与激活切换时若 openRelFromJump 引用变化 → effect 重注册 → cleanup→add 窗口丢事件 → pending 已暂存但 mount effect 不再跑（editor 常驻）→ **pending 永不消费 → 静默失败、每次必现概率低但同机理**
- **保活实例与激活实例分离**：若 React 对同 key div 在保活层/激活层间切换时重建实例 → 新实例无 listener/无 openFiles（表现为「文件树重新加载后空」）—— 需 Console 看 editor 是否有多次 rootId 重置痕迹

### DIAG 日志（修复会话已在代码预埋，真机复现一次即可定位断点）

已加 5 处 `console.log`（渲染层 DevTools Console 可见，前缀 `[App:diag]`/`[Knowledge:diag]`/`[Editor:diag]`）：
1. `App.tsx` kb-open-in-editor handler（:312 附近）—— 事件是否到 App
2. `knowledge/index.tsx:615 handleOpenInEditor` —— dispatch 前 p?.path 是否有值
3. `editor/index.tsx:240-248` listener —— 事件是否到 editor 保活实例
4. `editor/index.tsx:228 openRelFromJump` 入口 —— relPath / rootIdRef.current
5. `editor/index.tsx:163 openFile` —— 是否被调、root 是否就绪

**修复会话操作**：请用户真机复现一次「知识库页签阅读 → 顶栏按钮跳编辑器」，DevTools Console 过滤 `diag`，按输出判定断点在 ①dispatch 前 ②App ③editor listener ④openRelFromJump ⑤openFile；定位后移除 DIAG 日志再提交。

### 建议修复方向（按断点定）

- **若断点在 ③/④（listener/事件）**：保活后 EditorModule 不再重挂 → mount-once 消费 pending 失效。治本 = 把「pending 消费」从 mount-once 改为「isActive false→true 时也消费一次」（editor/index.tsx 增加依赖 isActive 的消费 effect），或 openRelFromJump 前主动 enterWorkspace 保证 rootIdRef（已有但需确认保活实例的 ref 是否与激活共享）
- **若断点在 ⑤（openFile）**：查 openFiles 被清源头（enterWorkspace 重复执行 setOpenFiles({}) / pruneCleanNonActive 误回收）
- **若断点在 ①/②**：与保活无关，查 knowledge 侧（不太可能，用户能跳转）

---

## ISS-2026-09-04-06　C3 code-hello toast 永不弹出：CodePluginHost 读 `d.payload`，worker 发的是 `params`

- **状态**：⏳ 待修复（2026-09-04 合并版自动验收发现）
- **严重度**：🟥 高（V3-3 code 插件全链路的可见反馈失效——链路各环其实都通，只死在最后一步）
- **关联验收项**：验收手册 **C3 code-hello 端到端**（toast 探针）/ C4 审计
- **实测环境**：主仓库 `fix/optimize-v2.15.1` @ `2f2077d`（三 worktree 合并后），CDP 拉起构建产物

### 现象

启用 kb.code-hello 后（含安装自动启用、手动启用、重启自动挂载三条路径），**「Code 插件已启动（worker 探针 OK）」toast 均不出现**，渲染层无任何报错。

### 自动验收证据链（CDP + 审计逐环验证）

| 链路环节 | 结果 | 证据 |
|---|---|---|
| 安装（installBundledSample） | ✅ | 安装成功 + 自动启用 |
| CodePluginHosts 挂载 CodePluginHost | ✅ | DOM 存在 `span[data-code-plugin-host="kb.code-hello"]` |
| Worker 构造 + 脚本加载执行 | ✅ | 手工 `new Worker('plugin://kb.code-hello/main.js')` 后 worker 发出 toast rpc（onmessage 捕获到完整 v2 报文） |
| bridge 会话 | ✅ | `hostBridgeOpen` ok:true + token |
| Gateway 裁决 kb.ui.toast | ✅ | plugin_audit_log 出现 `kb.ui.toast {"ok":true}`（安装同一秒） |
| **宿主渲染 toast** | ❌ | `toast:show` 事件监听器零捕获；dispatchEvent 调用栈探针为空 |

### 根因（决定性）

worker 样例（v2 规范 §208 行）发送字段为 **`params`**：

```js
self.postMessage({ channel: CHANNEL, v: 2, id, method, params })   // main.js
```

而 `src/components/shared/CodePluginHost.tsx` `handleWorkerMessage` 读的是 **`d.payload`**：

```ts
void hostRpc({ token, id, method, params: d.payload })   // ← d.payload = undefined
if (r.local === 'toast' && typeof d.payload === 'string') // ← 永远 false → showToast 不执行
```

于是：gateway 收到 params=undefined 也照常裁决通过（toast 执行器不看参数）→ 审计记 ok；但宿主侧
`typeof d.payload === 'string'` 永假 → toast 永不渲染，worker 也收不到回包。

### 规范依据

`docs/plugin-api-v2-design.md` L208：worker→host 请求报文字段为 `{ channel, v:2, id, token, method, params? }` —— **`params` 是规范字段，样例没错，宿主偏了**。

### 建议修复

`CodePluginHost.tsx` handleWorkerMessage 内把 `d.payload` 全部改为 `d.params`（含 hostRpc 转发与 toast 分支）；
同时确认 v2 事件上报（event payload）不受影响（事件报文规范用 payload，勿误改）。

### 备注

- UI 插件 iframe（PluginFrame）不受影响（iframe 路径字段核对过为 payload，与 worker 报文不同构）。
- 修复后重跑 `node tmp/cdp-acceptance.cjs plugins` 即可自动回归（toast 轮询已就位）。

---

## ISS-07 补充（2026-09-04 17:40 · devbridge UI 桥自动复现）

### 复现方式（可重复）

`KNOWBASE_DEV_BRIDGE=1` 构建 → 拉起应用（合成仓库 accept-repo，5 页）→ CDP/桥驱动：
知识库阅读态打开页 → 点顶栏「在编辑器模块中打开」→ 观察编辑器。**每次必现**，两条路径都挂：

| 路径 | DIAG 证据 | 结果 |
|---|---|---|
| A：编辑器本会话首访（fresh mount） | `handleOpenInEditor path ✓ → App ✓ → openRelFromJump ✓（rootIdRef 空→enterWorkspace）→ openFile 调用 ✓（root=当前仓库）` | 编辑器空态「从左侧选择文件打开」 |
| B：编辑器已挂载（keep-alive，rootIdRef 就绪） | `listener 收到 ✓ → openRelFromJump ✓ → openFile 调用 ✓（同 root、正确 relPath）` | 同样空态 |

### 断点收敛（对照原「建议修复方向」）

- **③④ 排除**：事件链每次都完整走通（listener 收到 → openRelFromJump → openFile 参数全对）
- **⑤ 命中**：`openFile` 被调且无 error toast，但 **visible 编辑器的 openFiles 始终为空**——
  `ui.wait text=<文件名>.md` 在跳转后 8s 高频轮询 **从未命中**（tab 不是闪现后被清，是根本没出现在可见实例）
- **双实例嫌疑（新）**：DIAG 监听日志出现同事件双序列 → 页面内疑似存在两个 EditorModule 监听者
  （保活主实例 + 另一实例/两次挂载），jump 的 openFile 可能落在**不可见实例**上；
  结合 A 路径 `mount auto-enterWorkspace`（editor/index.tsx:133）与 pending 消费（:266）并发，
  两把 `enterWorkspace` 各自带 `setOpenFiles({})`，谁后到谁清场

### 给修复会话的操作建议

1. 页面里查 EditorModule 挂载数：`document.querySelectorAll` 相关 root 元素数 / React DevTools 数 EditorModule 实例——先证实/证伪双实例
2. 若单实例：在 `setOpenFiles`(openFile:179) 与 `enterWorkspace`(:124) 各加时戳日志，跑一次跳转看先后序（怀疑 enterWorkspace 后到清场）
3. 修法候选：enterWorkspace 跳过「rootId 未变化」的重入；或 openRelFromJump 完成后再允许 auto-enter；pending 消费改 isActive 依赖（原方向保留）
4. 修完重跑：`node tmp/jump-observe.cjs`（CDP 9366）+ 桥截图，编辑器应出现 `<页名>.md` tab

---

## ISS-07 补充二（2026-09-04 19:30 · 根因定案 + 修复）

### 根因（探针时序实锤）

`renderMounted` 的保活层（App.tsx:544-550）在切 Tab 时**并没有真正保住编辑器实例**——
实例计数探针显示 EditorModule 在切页面/切 Tab 时会卸载重建（实例 #1→#2→#3）。
失败链条：

1. 知识库点「在编辑器中打开」→ App 暂存 `window.__kbPendingOpenInEditor` + 切 Tab
2. 旧编辑器实例的 window listener **抢先消费**：openRelFromJump → openFile → 文档开进旧实例
3. React 提交：旧实例（含刚打开的文档）被卸载丢弃，新实例挂载
4. 新实例的 pending 已被旧实例删掉（`openRelFromJump` 入口 `delete pending`）→ 什么都不开
5. 新实例的挂载自动 `enterWorkspace`（editor/index.tsx effect133）`setOpenFiles({})` 兜底清场
   → 表现为「Tab 切过去了但永远空态」，每次必现

### 修复（两处，同 commit）

1. **跳转通道改 state + props**（App.tsx / editor/index.tsx）：
   - App：`pendingOpenRel` state，kb-open-in-editor handler 只 `setPendingOpenRel(relPath)` + 切 Tab
   - EditorModule 新增 props `pendingOpenRel` / `onPendingConsumed`，effect 消费后回调清除；
   - 删除 window listener + window pending 的旧通道（含 openRelFromJump 里的 delete）
   - props 不受实例卸载重建影响：新实例带着 pending 挂载 → 挂载消费 → 文档落地
2. **enterWorkspace 同仓库重入保护**（editor/index.tsx）：
   `if (rootIdRef.current === rid) return`——挂载自动进入（effect133）与跳转消费路径
   并发触发两次 enterWorkspace 时，后到者不再 `setOpenFiles({})` 清场；
   配套 effect133 在有 pendingOpenRel 时让路（消费路径自行 enterWorkspace）

### 验证

- 合成仓库三连跳（A fresh mount / B keep-alive 回跳 / B2 第三次跳转）全部正确落盘目标文件
  （截图：编辑器显示 `TCP三次握手.md` + Monaco 内容 + 分栏预览），修复前同流程 100% 空态
- tsc：改动文件零错误（npm install 升级类型包后浮出的 33 个旧基线错误在别的文件，属既有债务另行清理）
- 待用户真机验收；复现/回归脚本 `tmp/jump-verify-fix.cjs`（需 KNOWBASE_DEV_BRIDGE=1 构建 + KNOWBASE_DEV_BRIDGE_PORT=9377，7465 起端口段被 Hyper-V 保留块占用）
