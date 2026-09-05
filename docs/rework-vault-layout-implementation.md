# 仓库布局与多仓库实现文档（Vault Layout Implementation）

> 状态：**方案定稿，待分步执行**（2026-09-06）。
> 上位文档：`docs/rework-master-plan.md`（本文是其 §7 子文档；与总方案冲突处以本文新拍板为准）。
> 讨论来源：2026-09-05/06 两轮拍板（附件区、博客位置、清空语义、仓库判定、菜单栏切换器、导入冲突弹列表、回收站不弹窗、408 图片只改插件侧）。

---

## 1. 目标目录结构（定稿）

```
<仓库根>/                       ← 用户选定/新建的文件夹，多仓库之一
├── .knowbase/                  ← 应用私有（隐藏），全仓库仅一个，内部禁止再嵌套 .knowbase
│   ├── meta.json               ← schemaVersion / createdAt / name（仓库名随仓库走）
│   ├── config.json             ← 仓库级设置（图谱参数等，已有）
│   ├── blog/                   ← 博客文章 .md + entries.json/tags.json/templates.json（整体迁入）
│   ├── modules/*.json          ← 日程/打卡/说说/习惯/体重/quiz/wordbook 等结构化数据（JSON 化主线）
│   ├── secret/                 ← 密码本/AI Key 密文（DPAPI，ENC_PREFIX，沿用 secretBox）
│   ├── backup/                 ← db 快照（已有）
│   └── _inbox/                 ← 未分类收件箱（已有）
├── .attachments/               ← ★ 附件区（与 .knowbase 同级，点前缀命名，本次定稿）
│   └── knowledge_page/<pageId>/…  ← 408 插件包图片（导入时落此，见 §3-D1）
└── 知识库目录/…/*.md            ← 知识库内容：仓库顶层裸 .md（现状不变）
```

**完整性规则**：
- 一个仓库最多一个 `.knowbase`；`.knowbase` 内不允许出现新的 `.knowbase`（扫描/导入/文件树三层忽略 + 提示）。
- 一台机器多个仓库；每个仓库有名字（存 `.knowbase/meta.json`），软件内点名字跳转。

## 2. 拍板记录（2026-09-05/06，全部已确认）

| # | 决策 | 结论 | 变化点 |
|---|------|------|--------|
| D1 | 附件区 | 仓库根下顶层 `.attachments/`（点前缀、单一目录）；408 图片、编辑器插图、博客图统一入此；md 用相对链接 | 原 `.knowbase/_attachments` 不再新增内容 |
| D2 | 408 图片迁移 | **不动已导入的本地包**；只改插件侧落盘位置（`knowledgePackVault` 图片本来就在导入时统一复制+改写引用，逻辑已动态） | 旧 `/_attachments/` 引用保留兼容读取 |
| D3 | 博客文章 | .md 整体迁入 `.knowbase/blog/`（接受对其他软件不可见） | 根下 `blog/` 目录取消；`APP_INTERNAL_DIRS` 的 'blog' 作废 |
| D4 | 其他模块数据 | 倾向 JSON（`.knowbase/modules/`）；密码本沿用 DPAPI 加密（secretBox），跨机器重加密预留 | 沿用去库化主线 |
| D5 | 导入冲突 | 弹冲突列表，逐项由用户选择（覆盖/跳过/重命名） | 不做静默合并 |
| D6 | 删除仓库（清空数据语义） | 整个仓库文件夹直接进 OS 回收站（trashFiles），**不弹提醒窗**；注册表移除，回仓库选择页 | 替代现 `clearVaultContent` 的 rmSync 语义 |
| D7 | 仓库判定 | 顶层无 `.knowbase` → 提示「该文件夹不是仓库」并引导初始化；不再静默自动建 | 现行为改为显式确认 |
| D8 | 仓库切换器 | 放在**菜单栏**（用户截图待补，位置细节以图为准）；功能优先，形态从简 | 新 UI |
| D9 | 实施原则 | **修改优先，不推倒重来**：大量能力已存在，列清单逐项改；仅确需重构处新写 | 本文 §4/§5 体现 |

## 3. 现状盘点与复用映射（改什么、留什么）

| 能力 | 现状（代码位置） | 处置 |
|---|---|---|
| .knowbase 判定 + meta.json | `electron/lib/kbStore/vaultContext.ts`（`ensureKbRoot`/`setCurrentVault`） | **改**：meta.json 增 `name` 字段；无 .knowbase 时不再静默建（走 D7 引导） |
| 多仓库注册 roots Map | `electron/lib/workspaceManager.ts`（`RootInfo{name,rootPath}`，IPC `ws:*`） | **留用**：补「最近仓库列表」持久化（userData settings.json）与切换 IPC |
| 当前仓库 id 持久化 | `vaultContext.ts` settings.json `currentVaultId` | **留用** |
| 知识库顶层 .md | 已是现状 | 不动 |
| 附件目录常量 | `vaultContext.ts` `KB_ATTACHMENTS_DIR = '.knowbase/_attachments'`；`clearVaultContent.ensureKbSkeleton` 建 `_inbox/_attachments` | **改**：新增根级 `.attachments/` 常量；骨架不再建 `_attachments`（保留 `_inbox`） |
| 408 包图片落盘 | `electron/lib/knowledgePackVault.ts`（导入时复制到 `.knowbase/_attachments/knowledge_page/<pageId>/` 并改写引用，L105/L114 已跳过旧 `/_attachments/` 引用） | **改**：目标目录改为 `.attachments/knowledge_page/<pageId>/`；旧引用兼容读取（不搬旧包，D2） |
| 旧 %APPDATA% 附件库 | `database/paths.ts getAttachmentsDir` + `attachmentRepo`（sqlite attachments 表，博客图片在此） | **改**：随博客 JSON 化把图片落 `.attachments/blog/…`；旧库只读兼容直至模块全部迁完（P7 前不删） |
| 编辑器插图 | 无 | **新写**：插图按钮 + 剪贴板粘贴（P3） |
| 整仓导出/导入 | `database/repositories/backupRepo.ts` 是 db 时代（export.json+attachments zip）；`lib/zip.ts` 可复用 | **新写**：vault 版整仓 zip（P5），backupRepo 保持不动待废弃 |
| 删除/清空 | `kbStore/clearVaultContent.ts`（rmSync 直删 + 重建骨架）；`lib/trashFiles.ts`（OS 回收站，快照后 trash） | **改**：删除仓库改走 trashFiles 整仓入回收站；`clearVaultContent` 退役 |
| 回收站/防误删护栏 | `clearVaultContent.isAllowedClearRoot`（拒盘符根/系统目录） | **留用**：删除仓库前仍过此护栏（防配置损坏误删整盘） |
| 嵌套 .knowbase 防护 | 无 | **新写**：`workspaceManager` 枚举跳过、导入校验拒绝、扫描忽略（P5/P6） |
| 密码本加密 | `lib/secretBox.ts`（safeStorage/DPAPI，ENC_PREFIX） | **留用**；跨机器重加密沿用 master-plan O3 预留 |
| 仓库切换器 UI | 无 | **新写**：菜单栏入口（P6，位置待截图） |

## 4. 分阶段实施计划

> 原则：每阶段独立可验收、可单独提交；阶段间依赖已按序排列。验收统一跑 `tsc --noEmit -p tsconfig.node.json && tsconfig.web.json` + `npm run dev` 真机 smoke。

### P1 仓库判定与初始化引导（D7）
- 改动：`workspaceManager` openDir 流程——目标目录无 `.knowbase` 时 IPC 返回 `not-a-vault`，渲染层弹确认「初始化为仓库？」；确认后 `ensureKbRoot` + 注册。首启引导页复用现有流程。
- 涉及：`workspaceManager.ts`、`vaultContext.ts`、首启引导组件（src 侧待定位）。
- 验收：打开空目录 → 出确认框；取消 → 不建 .knowbase；确认 → 正常进入。

### P2 附件区 `.attachments` 落地（D1/D2）
- 改动：新增根级 `.attachments` 常量与目录保障；`knowledgePackVault` 落盘目标改 `.attachments/knowledge_page/<pageId>/`；旧 `/_attachments/` 引用兼容读取（现有 L114 跳过逻辑已保证不重写旧引用）；`ensureKbSkeleton` 停建 `_attachments`；`workspaceManager` 的 `APP_INTERNAL_DIRS` 调整（去 `blog`，加 `.attachments` 于文件树的展示策略——点前缀目录是否在编辑器树中显示，P3 插图落地时定）。
- 验收：新导入 408 包 → 图片在 `.attachments/knowledge_page/<pageId>/`，页面渲染正常；旧包渲染不受影响。

### P3 编辑器插图按钮（D1）
- 改动：Monaco 工具栏加「插图」；文件选择/剪贴板粘贴 → 复制入 `.attachments/`（默认按 `年-月/` 分层；文件名 = 原名去重，冲突加时间戳后缀）→ 光标处插入相对链接 `![…](.attachments/年-月/xx.png)`。
- 验收：插入 → 文件落盘、链接可渲染；粘贴截图可用；重名自动去重。

### P4 博客整体迁入 `.knowbase/blog/`（D3）
- 改动：`vaultMigration` 增一步——根下 `blog/*.md` 移入 `.knowbase/blog/`（幂等，frontmatter id 不变）；博客图片从旧 %APPDATA% 库落 `.attachments/blog/…` 并改写引用；`APP_INTERNAL_DIRS` 删 `blog`；博客模块读写路径切到 `.knowbase/blog/`。
- 验收：迁移后博客模块全功能正常；再次启动不重复迁移；旧根下 blog/ 为空则清理。

### P5 模块 JSON 化收尾 + 嵌套防护（D4）
- 改动：日程/打卡/说说/习惯/体重/quiz/wordbook 按既有去库化主线迁 `.knowbase/modules/*.json`（用户此前已拍板小模块留 sqlite 的部分，如需保留由用户逐个确认后再迁）；密码本走 secretBox 密文入 `.knowbase/secret/`；扫描/枚举层忽略内层 `.knowbase` 并提示。
- 验收：各模块读写正常；`.knowbase` 内出现子 `.knowbase` 时被忽略且有日志/提示。

### P6 整仓导出 / 导入（D5）
- 改动：新写 vault 版导出（`lib/zip.ts` 复用）：压缩仓库根全部内容（含 `.knowbase`、`.attachments`，无排除项）；导入：剥壳（zip 内单一顶层目录则去掉一层）→ 嵌套 `.knowbase` 检查 → 冲突扫描 → **弹冲突列表逐项选择**（覆盖/跳过/重命名）→ 解压落盘 → 重建索引。
- 验收：导出 → 全新目录导入 → 全模块数据/图片/索引完整；含冲突时列表交互正确；zip 无顶层套壳与有套壳两种都能导。

### P7 删除仓库 = 整仓入回收站（D6）
- 改动：`clearVaultContent` 退役；新「删除仓库」：过 `isAllowedClearRoot` 护栏 → trashFiles 整仓入 OS 回收站（**不弹提醒窗**）→ roots 注册表移除 + currentVaultId 清理 → 回仓库选择页。
- 验收：删除后回收站可见完整仓库目录；注册表无残留；应用回引导页。

### P8 多仓库切换器（D8）
- 改动：`.knowbase/meta.json` 增 `name`（新建时用户命名，默认取文件夹名）；userData settings.json 增「最近仓库列表」（master-plan §4 已规划为设备级）；菜单栏加切换器入口（**位置以用户截图为准，截图待补**）：点名字 → 切 currentVaultId + 各模块 isActive 重取索引（沿用激活重读约定）。
- 验收：多仓库创建/切换/重命名闭环；切换后图谱/索引/博客等全部跟随。

## 5. 风险与开放问题

| # | 风险/问题 | 处置 |
|---|---|---|
| R1 | DPAPI 机器绑定：整仓 zip 拷到新机器后密码本/AI Key 密文不可解 | 沿用 master-plan O3「重新加密」预留；导入流程检测解密失败 → 引导重录 |
| R2 | `.attachments` 点前缀：Windows 资源管理器可见但部分工具/网盘按隐藏处理；编辑器文件树是否显示待定 | P3 时定展示策略；页面图片渲染走 ws IPC 相对路径不受影响 |
| R3 | 旧三处图片源（`.knowbase/_attachments`、%APPDATA% attachments、408 旧包）长期并存 | 只保证兼容读取；统一搬迁不做（D2），待用户明确要求再立项 |
| R4 | 删除仓库无提醒窗（D6），误触成本高 | 入口放在设置深处 + 护栏校验；回收站兜底可还原 |
| R5 | 菜单栏切换器位置 | 等用户补截图后细化（P8 内解决，不阻塞 P1-P7） |
| R6 | 小模块 JSON 化与「留 sqlite」旧拍板的边界 | P5 前逐模块向用户确认一次再动 |
