# AI 文件操控工具设计（Vault 内）

> 归属：[rework-master-plan.md](./rework-master-plan.md) R2 编辑器与链接 / agent 模块深化。
> 状态：**设计 + 实施计划（2026-09-03 用户拍板：先做「AI 读写笔记文件」= F1–F3，并顺手修复 P0 旧账「内置知识工具写旧库」）**。原设计稿（2026-09-02）保留，本文第 9–11 节追加 P0 修复方案与批次实施计划。
> 前置：workspaceManager（ws:* 通道 + resolveSafe + 冲突检测）已落地；AI ToolRegistry 双防线 + 审计 + 月度上限已有。

> **大白话摘要**：目标是让 Ctrl+J AI 助手能真正翻看、搜索、修改用户的笔记文件（不是答非所问地聊天），安全规则照旧——能碰什么、不能碰什么都由权限把关、全程留痕。本文前半是这套能力的详细设计，第 9 节起是"先修一个旧毛病（AI 建的页面用户看不到）再分批实现"的执行计划。

## 1. 目标与边界

让接入的 AI（AgentRunner，≤8 轮）能**列目录、读文件、编辑文件**——能力边界严格限定在当前仓库（Vault）内，越界、二进制、隐藏区一律拒绝。权限三档（禁止/只读/读写）沿用现有模块权限模型。

## 2. 现状盘点（实测 2026-09-02）

- 内置 AI 工具 13 个：只读类 knowledge.search/read、habits.list/stats、bookmarks.search、pomodoro.summary、schedule.list-todos、web.search；写入类 create-page/append-page/create-entry/create-todo/check-habit（`requires:'write'`，受 `aiModulePermissions` 模块权限控制，走**结构化数据层**，非文件）
- **Vault 文件工具 = 0**：AI 无法 list/read/edit 仓库内任意文本文件
- 权限模型：模块级三档（禁止/只读/读写）+ agent 预过滤 + invoke 硬校验双防线
- 编辑器=唯一交互式写入 UI（读写分工 11:50 定稿），走 ws:writeFile（原子写 + mtime 冲突检测 + 索引失效钩子）

## 3. 不变量修订（与读写分工的张力处理）

现状不变式：「写入唯一入口 = 编辑器模块」。AI 文件工具加入后修订为：

> **Vault 写入只有两条受控通道**：① 编辑器模块（人工，交互式）② AI 文件工具（agent，程序化）。两者走**同一条守卫链**：resolveSafe 防穿越 → 原子写（tmp+rename）→ mtime 冲突检测 → 索引失效钩子 → 全程审计。

不改这条不变量，AI 写文件就会绕过编辑器唯一写入方、出现静默分叉——这正是去库化一直防的事。

## 4. 工具族设计

命名空间 `builtin.vault.*`（新工具，非插件注册——保持 AI 工具面收口在宿主）：

| 工具 | 级别 | 行为 | 说明 |
|---|---|---|---|
| `builtin.vault.list` | 只读 | 列目录树（2 层摘要，受 kbIndex 数据支撑） | 返回值小，供模型了解结构 |
| `builtin.vault.read` | 只读 | 读文本文件（截断 maxChars 默认 8k；返回 mtimeMs 基线供写回校验）。范围：用户 .md/.txt + **`.knowbase/modules/*.json` 只读**（拍板，2026-09-02） | 二进制/cache/隐藏/越界拒绝 |
| `builtin.vault.search` | 只读 | 仓库内内容搜索（grep 语义，复用 knowledgeIndex 失效域） | 文本文件 only |
| `builtin.vault.write` | 写 | 新建 / 整文件覆写（仅文本白名单，建议 <100KB） | 带 mtime 冲突检测 |
| `builtin.vault.edit` | 写 | **精确替换**（oldText→newText，diff 语义，整文件最多出现 1 处/次） | 防模型全量重写大文件 |
| `builtin.vault.rename` | 写(高危) | 重命名/移动（复用 ws:rename 跨目录语义） | v1 建议暂缓（Q2） |
| `builtin.vault.trash` | 写(高危) | 移入回收站（trash 包，非删除） | v1 建议暂缓（Q2） |

### 禁区（2026-09-02 细化，任何档位都不放行）
- **`.knowbase/` 分级可见性**：
  - `modules/*.json`（业务源数据，如打卡记录）→ **AI 只读可见**（拍板），供回答「今天打卡了吗」等——但不可写
  - `cache/`（knowledge-index/graph 缓存）、`config.json`、`plugins/`、密钥区 → **完全不可见**（避免读到过期缓存误导模型、防配置被探）
- `_attachments/` 只读可见（文件名/大小可列，内容仅图片类可经既有通道，v1 不做）
- 二进制文件（512B NUL 探测复用）、>10MB 文件、越界路径（resolveSafe 拒绝矩阵复用）一律拒

## 5. 安全层叠（写工具重点）

1. **新权限域**：`aiModulePermissions` 之外加 `vaultFile` 域（禁止/只读/读写）——工具按域注册，agent 预过滤 + invoke 硬校验双防线复用
2. **确认策略（2026-09-02 拍板：权限控制，不打断）**：不做「每次执行弹窗确认」——写类工具可用性由 `vaultFile` 权限域 + 会话级授权开关共同决定：域 = 读写 且 会话开关开 → 可写；其余拒绝。审计面板逐条可查，误操作靠回收站/冲突检测兜底
3. **mtime 冲突检测**（复用 detectConflict）：read 返回 mtimeMs，edit/write 必须携带，冲突即拒绝并回报 diskMtimeMs——与编辑器保存同一套语义
4. **写后通知编辑器**：若该文件正被编辑器打开 → 主进程主动推送（沿用 BrowserWindow.getAllWindows().send 模式，如 lanShare 通知）→ 编辑器弹「重新加载/覆盖磁盘/暂不处理」三选（既有冲突弹窗组件复用）；**没有 watcher 也覆盖 AI 写入场景**
5. **会话写上限**：单次 AgentRunner 会话写操作 ≤5 次（防失控循环刷盘），审计面板逐条记录 relPath + 改动摘要
6. 月度硬上限与全程审计沿用现有链路

## 6. AgentRunner 集成细节

- **上下文注入**：把仓库结构摘要（kbIndex 顶层目录 + 最近 20 文件标题）注入 system prompt，模型少瞎猜路径——否则 list 会吃掉大量轮次
- 工具返回一律**结构化短文本**（JSON 单行），不吐大块内容，护住 ≤8 轮预算
- edit 失败（oldText 未命中）返回「相似片段建议」，引导模型自纠而非盲重试

## 7. 分期

| 期 | 内容 | 验收 |
|---|---|---|
| F1 | vault.list/read/search + `vaultFile` 权限域 + 禁区硬编码 | 只读全通；越界/二进制/.knowbase 拒绝矩阵冒烟 |
| F2 | vault.write/edit + mtime 冲突 + 写后编辑器通知 + 会话写上限 | 编辑器打开文件被 AI 改写 → 弹三选；冲突拒绝 |
| F3 | rename/trash（确认后）+ 可视化 diff（审计面板扩展） | 高危险操作全流程可审可撤 |

前置与并行：F1 依赖 workspaceManager（✅）与 knowledgeIndex（✅），**可与 R1 Workbench 并行**；F2 的「写后通知」依赖编辑器模块的既有冲突弹窗，编辑器在 R1 迁入编辑器组后仍需保留该能力。

## 8. 拍板记录（2026-09-02）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 写操作确认粒度 | **权限控制不打断**：`vaultFile` 域（禁止/只读/读写）+ 会话级授权开关；无每次弹窗；审计逐条可查 |
| Q3 | .knowbase 可见性 | **modules/\*.json AI 只读可见、不可写**；cache/config/plugins/密钥完全不可见 |
| Q4 | 业务数据读法 | 双通道并存：结构化工具为主（统计/聚合）；JSON 只读为辅（用户点名「打卡记录可读」）；cache 永不直读 |

原则落定：AI 能读打卡记录 JSON（回答事实类问题），但一切写行为被 .knowbase 写禁区 + vaultFile 域双保险拦死——「可读不可写」由两条独立防线保证，不是一条。剩余开放项：Q2 rename/trash 是否进 v1（建议 F3）、F1-F3 分期待启动排期。

---

## 9. P0 旧账修复：内置知识工具与「真相源」脱节（2026-09-03 定稿）

### 9.1 问题精确定位（读码事实）

`knowledgeRepo.ts` 已有 vault 分流：`VAULT_ALLOWED` 白名单在 `storageKnowledge='vault'` 时放行读通道（走 `knowledgeVaultRepo` 读磁盘 .md），create/update/delete 等写通道一律抛「友好拒绝」——但**这是 IPC 层拦截，只挡住渲染层调用**。

内置 AI 工具（`electron/lib/builtinTools.ts`）在主进程内部用 `getDatabase().run/queryAll` **直接查 sqlite 表，完全绕过该分流**。后果（vault 默认读源下）：

| 工具 | 现状行为 | 后果 |
|---|---|---|
| `builtin.knowledge.search/read` | 直查 sqlite `knowledge_pages` | 搜到的是停更旧表 → 与 UI 所见（vault .md）不一致甚至为空 |
| `builtin.knowledge.create-page/append-page` | 直插 sqlite `knowledge_pages` | AI 建的页在 UI **不可见**；且绕过编辑器受控写通道，直接违反「防双源分叉」不变量 |

**疑似同款（同模式直连 sqlite、模块已文件化，需一并核验）**：`builtin.blog.create-entry`（博客已 .md 化）、`builtin.bookmarks.search`（书签已 JSON 化）。仍在 sqlite 的模块（日程/打卡/番茄钟/quiz/wordbook 等）不受影响，保持原样。

### 9.2 修复原则（一次覆盖全部）

> **AI 工具按模块走「该模块当前的真相源」**：读工具调用该模块的 vault/文件读层（如 `knowledgeVaultRepo`）或 JSON 读口；写工具一律走受控文件通道（编辑器同款：frontmatter .md + 原子写 + 索引失效钩子）。**不允许任何主进程内部工具绕过模块分流直连 sqlite。**

### 9.3 动作清单

1. `builtin.knowledge.search/read`：按 `storageKnowledge` 分流——vault 模式改调 `knowledgeVaultRepo.vaultSearchPages/vaultGetPageById`（输出格式保持：id/title/excerpt/mtime 基线）；sqlite 模式保留原实现。
2. `builtin.knowledge.create-page/append-page`：vault 模式下**停用并返回明确指引**（"知识库内容现由文件管理，请用 vault 写工具或编辑器"，待 F2 落地后由 `builtin.vault.write` 语义取代）；sqlite 模式保留。删除危险：绝不静默写旧库。
3. `builtin.blog.create-entry` / `builtin.bookmarks.search`：核实各自文件化读层后同样分流（同 9.2 原则）。
4. 加一条 ToolRegistry 层面的**防御性注释/约定**：builtin 写工具注册须声明其数据归属（sqlite 表名或 vault 路径），vault 模式巡检时据此拦截。

### 9.4 验收（冒烟脚本 `tmp/smoke/`）

- vault 模式：AI `knowledge.search` 能命中磁盘 .md 页并返回摘要；`create-page` 返回明确错误提示（含引导文案），**且 sqlite `knowledge_pages` 行数不变**。
- sqlite 模式（灰度开关切回）：原 13 工具行为回归不变。

> **实现状态（2026-09-03）**：B0 代码已完成于 `feature/agent-file-tools` 分支（落地批次提交后，修订本节为待真机）。源码级断言冒烟 `tmp/smoke/agent-b0-source-smoke.mjs` 12/12 通过；tsc(node) 零新增错误（基线 5 与主工作树一致）；electron-vite build 通过。上表行为验收待真机（dev 起后按本清单人工核对）。

---

## 10. 实施计划总览（批次表）

> 依赖已全部就绪（workspaceManager ✅ / knowledgeIndex ✅ / ToolRegistry ✅），B0+B1 **可开工**；开发落地于 `feature/agent-file-tools`（2026-09-03 从 `fix/optimize-v2.15.1` 基线切出的并行 worktree，定期合入主线保持同步），与图谱 A8 真机验收并行推进。

| 批 | 内容 | 大白话目标 | 改动范围 | 依赖 | 验收要点 |
|---|---|---|---|---|---|
| **B0** | P0 旧账修复（第 9 节） | AI 查得到、建得出你能看到的页 | `builtinTools.ts`（+核验 blog/bookmark） | 无 | 9.4 冒烟全过 |
| **B1** | F1：`vault.list/read/search` 只读三件 + `vaultFile` 权限域 + 禁区 | AI 能安全地翻看你的笔记 | `builtinTools.ts` + `aiTools.ts`(新权限域) + 设置页 `AiPermissionsTab` | workspaceManager | 只读全通；越界/二进制/.knowbase 拒绝矩阵冒烟 |
| **B2** | F2：`vault.write/edit` + mtime 冲突 + 会话写上限(≤5) + 写后编辑器三选弹窗 | AI 能改你的笔记，且不会悄悄改坏 | 复用 detectConflict + 既有冲突弹窗 + AgentRunner 会话计数 | B1 + 编辑器冲突弹窗 | 编辑器打开的页被 AI 改写 → 弹三选；mtime 冲突拒绝；写超限停 |
| **B3** | F3：`vault.rename/trash` + 可视化 diff（审计面板扩展） | AI 能整理移动笔记，全程可查可撤 | ws:rename/trash 复用 | B2 | 高危操作全流程可审 |

**远期（已拍板缓做，不入本期）**：软件状态层 `builtin.app.*`（命令表暴露/execute-command/open-file）、外部 agent 接入（本地 MCP server）。

---

## 11. 拍板记录（追加 2026-09-03）

| # | 问题 | 结论 |
|---|---|---|
| Q5 | 「AI 操控软件」本期做到哪层 | **只做内容文件层（F1–F3）+ 顺手修 P0**；状态层/外部接入列为远期 |
| Q6 | P0 修复方式 | vault 模式：读工具切 vault 读层、写工具停用给指引；不静默写旧库（9.3） |
| Q7 | rename/trash 是否本期 | 归入 F3 末批（沿用原 Q2 建议） |

**遗留待办**：① blog/bookmark 工具疑似同款脱节 → B0 顺带核验；② B0+B1 排期与当前主线（图谱 A8 验收 / schedule-sidebar 合并）的先后由用户开工时定。

---

## 12. 典型目标场景与配套工具缺口（2026-09-03 用户补充）

> 用户原话诉求（大白话）：① 让 AI 添加页面文件之间的链接；② 给 AI 提供资料网站/文章，让它教知识、给学习方案，并落成笔记。已拍板：资料形态 = **直接丢网址/文章给 AI**（Q8）。

### 场景 A：AI 维护双链（知识织网）

- 用法："把我讲 XX 的几篇笔记互相关联""读近两周笔记，把同主题的挑出来互链并建汇总页"
- 机制：B1 读+搜 → B2 精确插入 `[[标题]]` → GraphIndex/反链自动识别
- **引用正确性设计点（进 B1）**：给 AI「查页面标题/正确引用名」的能力（如 `builtin.vault.list-titles` 或 read 返回引用名），避免死链；B2 验收加一条：「AI 给两篇相关笔记互相加链 → 图谱出现连线、无死链」

### 场景 B：AI 私人导师（吃资料 → 教学 → 方案落库）

- 用法："读这 5 个网址，按内存→进程→文件系统排两周学习方案，每步标资料"；"把这篇讲明白、标重点、出题"；"学完整理成一页笔记链上资料"
- 闭环：吃资料（新工具 `builtin.web.read`）→ 消化教学（LLM + 可选 Teach Skill 编排）→ 产出落库（vault 写 + 加链，即 B2 能力 + 场景 A）
- **新增工具缺口：`builtin.web.read`（读指定网页正文）**——现有 `web.search` 只回标题/摘要，无法通读全文。设计要点：仅 https + host 白名单（沿用 webSearch 约定）、正文提取转纯文本、长度截断（默认 ~8k 字符，防 token 失控）、超时与失败降级；只读工具，不设 module（跨模块通用，同 web.search）
- 产出落地约定（v1 不做特殊结构）：资料 = 剪藏/普通笔记（沿用现有 Vault）；方案 = AI 新建 .md + frontmatter（type/tags）+ 双链指向资料来源——正好复用场景 A 的织网能力
- 验收（并入 B2/B3）：AI 基于给定网址输出学习方案并落成一页带链接的笔记；人工核对 frontmatter 与链接可跳转

### 拍板记录（追加）

| # | 问题 | 结论 |
|---|---|---|
| Q8 | 学习资料怎么交给 AI | **直接丢网址/文章给 AI** → 补 `builtin.web.read` 读网页全文能力（仅 https+白名单）；不依赖先剪藏 |

> 说明：本节是目标场景与需求记录，不改 B0–B3 主计划本身。`web.read` 是独立小工具（不动 vault 链），可单独先做或随 B 批顺带，排期由用户定。

---

## 13. 多格式资料读取（PDF / PPT，v1 范围，2026-09-03 拍板）

> 用户诉求：让 AI 不仅能读 .md，还能读 PDF/PPT 等来总结、做学习复习资料。已拍板（Q9/Q10）：**文件必须放进仓库（vault 内）**；**首批只做 PDF + PPT，零新依赖**（PDF 复用现有 pdfjs-dist，PPT 用现有 zip 能力手写 XML 提取）。扫描版 PDF / 纯图片内容需 OCR，v1 明确不支持，命中时如实告知。

### 13.1 工具设计：`builtin.docs.read-text`（新增，只读）

- 入参：vault 内 relPath（沿用 resolveSafe 防穿越）；可选手页码/截断上限
- 按扩展名分流：
  - `.md/.txt` → 直读文本（等同 vault.read 语义）
  - `.pdf` → 主进程 pdfjs-dist 提取文本（与 PDF 阅读插件同源解析内核，无重复依赖）；返回文本 + 页数 + 截断标记
  - `.pptx` → 复用现有 zip 解压 → 解析 `ppt/slides/slide*.xml` 的 `<a:t>` 文本按页拼接 → 返回文本 + 页数
  - 其余/二进制 → 拒绝并说明支持范围
- 输出：结构化短文本（截断默认 8k 字符，上限 ~50k，防 token 失控）；不做 NUL 启发式（PDF 属二进制但头部为 ASCII，vault.read 的 NUL 探测只用于纯文本工具，二者按扩展名白名单区分）
- 权限与禁区：归 `vaultFile` 权限域只读面（不新增域）；只读仓库内文件，`.knowbase/cache/plugins` 等禁区沿用（资料一般放仓库根或用户建的资料夹）

### 13.2 与既有设计的关系

- B1 的 `builtin.vault.read` 保持「纯文本文件」限定（NUL 探测语义不破坏）；二进制文档读取收敛到 `docs.read-text` 单一入口，职责清晰
- 场景 B（私人导师）闭环补全：喂 PDF/PPT → `docs.read-text` 提取 → LLM 总结/出复习资料 → `vault.write`（B2）落成 .md 复习笔记 + 双链资料来源
- PDF 阅读插件（plugin-pdf-reader-design.md，人读 UI）与 AI 提取共享 pdfjs-dist 内核，后续实现时注意主进程加载 pdfjs 的 worker 配置（Node 侧用 legacy build / fake worker）

### 13.3 验收（并入 B2 批）

仓库内放一份本地 PDF + 一份 PPTX → 让 AI 分别总结出要点 → AI 落成一页复习 .md（frontmatter + 链接资料）→ 人工核对：要点与原文对应、无乱码、无死链。

### 拍板记录（追加）

| # | 问题 | 结论 |
|---|---|---|
| Q9 | AI 要读的 PDF/PPT 放哪里 | **放进仓库（vault 内）**；仓库外任意路径读取（对话框授权）后置 |
| Q10 | 首批支持格式 | **PDF + PPT，零新依赖**；Word/Excel 后续如需再评估 officeparser；扫描件需 OCR，v1 不支持 |

---

## 14. 真机验收台账（批次开发自驱用）

> 约定（2026-09-03）：用户不逐批验收；每批代码完成后，本台账登记行为级验收点，标记代码状态；后续批次自驱推进，验收积压到用户统一真机时按台账逐条勾验。
>
> 拍板（2026-09-03，用户确认）：**文本逐字流式输出（打字机效果）不做**——「步骤实时推送 + 完成整段出文字」已满足体验（用户认可），该项从远期待办移除，勿再启用。

| 批 | 行为验收点（真机，dev 起后人工核对） | 代码状态 |
|---|---|---|
| **B0** | ① vault 读源下 AI `knowledge.search` 命中磁盘 .md 页并返回摘要 ② `knowledge.read(id)` 能读全文 ③ `create-page`/`append-page` 被拒且返回引导文案，sqlite `knowledge_pages` 行数不变 ④ 设置切回 sqlite 读源后原工具回归正常 ⑤ blog/bookmark 灰度开关切 vault 后对应工具行为正确 | ✅ 52c533b 待真机 |
| **B1** | ① AI 能 `vault.list` 列仓库目录 ② `vault.read` 读 .md/.txt 与 `.knowbase/modules/*.json`（只读），返回 mtimeMs ③ `vault.search` 仓库内文本命中 ④ 禁区拒绝：`.knowbase/cache|config|plugins`、二进制、>10MB、越界路径 ⑤ 设置页 vaultFile 三档开关生效（off 时工具全部拒绝） | ✅ 代码完成待真机 |
| **B2** | ① `vault.write/edit` 真实落盘且 mtime 冲突拒绝 ② 单会话写 ≤5 次后停止 ③ 编辑器打开的页被 AI 改写 → 弹「重新加载/覆盖磁盘/暂不处理」三选 ④ 场景 A：AI 给两篇相关笔记互加 `[[链接]]` → 图谱出连线、无死链 ⑤ 场景 B：AI 基于仓库内 PDF/PPT 输出总结落成一页带链接复习 .md | ✅ 代码完成待真机 |
| **B3** | ① `vault.rename/trash` 可移动/移回收站（trash 非删除） ② 审计面板可见 relPath + 改动摘要 ③ 高危操作全流程可查可撤 | ✅ 代码完成待真机 |
| **web.read** | AI 给一个 https 网址能通读正文返回摘要；http/内网/裸 IP 明确拒绝（SSRF 防线）；超时给明确失败；截断告知 | ✅ 代码完成待真机 |
| **docs.read-text** | 仓库内放 .pdf 与 .pptx，AI 能提取文本总结；Word/扫描件明确拒绝并说明范围（pdfjs Node 提取已由 tmp/smoke/pdfjs-node-probe.mjs 验证可行） | ✅ 代码完成待真机 |
| **P 面板体验** | ① 发送期间气泡实时显示「思考中/正在调用 XX 工具（第 N 次）」而非静止文案（agent:step 推送）② 工具失败可见（显示"失败，正在调整"）③ 完成弹出改动卡片列出本次改动的文件/条目（可关闭）④ 回复末尾自动附「本次改动」清单（随消息持久化）⑤ **点击改动项直达编辑器打开该文件**（vault 文件类改动；回收站项不可点） | ✅ 代码完成待真机 |
| **沉浸 M0** | ① 活动栏出现「Agent」入口并打开全屏工作台 ② 左栏新建任务（教学/研读/复盘模板）→ 自动发开场指令 ③ 发送/回复真实对话，活动条实时显示工具调用（中文名+第 N 次）④ 助手消息可展开「调用轨迹」⑤ 右栏「本次改动」列出文件并点击直达编辑器 ⑥ 顶部时间线/文档视图切换（文档视图=最近回复整篇）⑦ 素材/产物区为空态说明（M1 开放） | ✅ 代码完成待真机 |
