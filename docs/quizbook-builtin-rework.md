# 错题本退役双形态 · 全内置改造方案

> 状态：待评审（2026-09-11）
> 前置诊断：错题本插件版为半成品（双轨分裂 / v1 桥并发卡死 / source_* 空 / 重刷串页），结论为「不适合插件化」，拆双形态归内置。

## 一、已拍板决策（2026-09-11）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 插件表存量数据 | **不做合并**——插件未正式启用，无真实用户数据 |
| 2 | 回收交互 | 检测到存量时**自动弹一次**（导出备份 / 忽略），无存量则永不出现 |
| 3 | 市场 knowbase.quizbook | **直接下架**（registry v24，zip + icon 一并删除） |
| 4 | quizbookMode 设置 | **直接删**（见下） |
| 5 | 入口文案 | 「错题本 / 收藏」保持不变 |

### 决策 4 详解：quizbookMode「直接删」的含义

该设置当前存在于 4 处：

1. `src/lib/settings.ts:199` — 设置定义（`ui:false`，设置页搜不到，默认 `'plugin'`）
2. `src/modules/plugins/index.tsx:926` — 插件页「错题本形态」下拉选择器
3. `src/modules/knowledge/index.tsx:1509` — `quizbookMode !== 'plugin'` 条件渲染（控制内置入口显隐）
4. `electron/database/repositories/quizRepo.ts:189` — 主进程判题写库前读它决定写哪张表

「直接删」= 把定义与 4 处读取全部移除。用户 settings.json 里残留的 `"quizbookMode": "plugin"` 键成为死数据——无任何代码再读它，**零副作用、无需迁移**。
（备选的「保留只读一版」是在设置页显示灰色「已退役」项过渡一版——该设置从未在设置页露出过，无人认识它，保留反造冗余，不采用。）

## 二、目标形态

- 数据唯一真相源 = vault 主表（`.knowbase/modules/quiz/records.json` 体系），判题 / 管理 / 统计 / 标签 / 分组 / 备注一条通路
- 内置 QuizCollection 为唯一错题本，知识库侧栏「错题本 / 收藏」入口恒驻
- 插件命名空间表成为只读遗迹：仅「存量检测弹窗」会触达它（导出 / 清空），无任何新写入
- 市场不再有 quizbook 插件

## 三、改动清单（按层）

### 3.1 主进程 electron/

**quizRepo.ts**
- 删 `quizRecord:report` 内的插件分支（L189 `getSettingValue('quizbookMode')` 判定 + L212-214 `pluginReportRecord` 调用），判题一律写主表
- 删 `quiz:pluginReport` / `quiz:pluginToggleFavorite` 两个 handler（L512-516）
- 删对 `quizMigration` 的 `pluginReportRecord / pluginToggleFavoriteRecord / QUIZBOOK_PLUGIN_ID` 导入
- **保留** `quizMigrate:status / export / dropPluginData` 三 handler（回收弹窗复用）

**quizMigration.ts**
- 保留 `migrationStatus / exportQuizData / dropPluginData`（回收三件套）
- 删 `pluginReportRecord / pluginToggleFavoriteRecord` 及 `QUIZBOOK_PLUGIN_ID`（无调用方后）

**preload/index.ts**
- 删 `quizPluginReport` / `quizPluginToggleFavorite`（L442-443）；保留 `quizMigrate*`（L438-440）

### 3.2 渲染层 src/

**lib/settings.ts**
- 删 `quizbookMode` 定义（L199）

**modules/plugins/index.tsx**
- 删「错题本形态」选择器（L926-929 及其容器）

**modules/knowledge/index.tsx**
- 删 `pluginReview` state 与插件版重刷分支（L82、L1654-1658）
- 删 L1509 `settings.quizbookMode !== 'plugin'` 守卫 → 侧栏「错题本 / 收藏」恒驻
- 保留 QuizMigratePanel，改为**启动自动检测触发**（见 3.3）

**lib/ipc.ts / types/index.ts**
- 删 `quizPluginReport / quizPluginToggleFavorite` 封装与类型；保留 `quizMigrate*`

### 3.3 存量检测自动弹窗（复用现成组件）

- App / 知识库模块启动后调 `quizMigrateStatus()`：存量 > 0 → 自动弹一次 QuizMigratePanel（导出备份 / 清空），处理后不再弹；存量 = 0 → 静默
- 不做合并（决策 1）；弹过一次后本会话不再弹

### 3.4 样例与市场

- 主仓库 `samples/quizbook/`（含 `quizbook-0.2.1.zip`）删除
- Phrontis-plugins：registry v23 → v24，移除 `knowbase.quizbook` 条目 + zip + icon，提交推送

## 四、出范围（明确不做）

- PluginFrame v1 桥无请求 id 的并发缺陷——基建问题，独立立项（UI 插件生态需要时再修）
- 插件表存量合并逻辑（决策 1）
- 插件仓 / 主仓库 git 历史清理（前一轮已拍板保留）

## 五、验收清单

1. `tsc --noEmit -p tsconfig.web.json` / `-p tsconfig.node.json` 零错误
2. 刷题判题 → 记录立即出现在内置错题本（同一张表）
3. 书架按空间/笔记本/章节分类正常（source_* 由主表通道回填）
4. 跨页重刷逐题 pageId 正确，无串页覆盖
5. 插件页无「错题本形态」选择器；设置搜索无「错题本形态」残留
6. 侧栏「错题本 / 收藏」恒驻
7. 无存量时启动静默；造一条插件表假数据 → 启动自动弹一次，导出/清空可用
8. 市场页不再出现 quizbook；registry v24 线上生效
