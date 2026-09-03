# AI 文件操控工具设计（Vault 内）

> 归属：[rework-master-plan.md](./rework-master-plan.md) R2 编辑器与链接 / agent 模块深化。状态：设计讨论稿（2026-09-02），未实现。
> 前置：workspaceManager（ws:* 通道 + resolveSafe + 冲突检测）已落地；AI ToolRegistry 双防线 + 审计 + 月度上限已有。

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
