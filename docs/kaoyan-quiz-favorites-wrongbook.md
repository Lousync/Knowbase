# 标签体系解读 + 题目收藏与错题集（方案）

> 日期：2026-08-29 · 状态：**已实施**（聚合视图 + 去重计数 + 重刷全对自动移出 + 自定义分组）
> 适用范围：应用级通用能力，**408 / 数学 / 英语 / 政治**知识包共用同一套实现

---

## 第一部分：你页面上的标签是什么、怎么用

### 1.1 标签从哪来

408 知识包导入时，插件 manifest 里每个页面声明的 `tags` 会被**原样落库**（`knowledgePackImporter.ts:463`），打在每个页面上。所以真题页面的标签不是你自己加的，是插件自带的。

### 1.2 408 页面上的两类标签

| 类别 | 例子 | 含义 | 对你有用吗 |
|---|---|---|---|
| **用途标签** | `408真题`、`数据结构`、`2010` | 按科目/年份分类，用于搜索与关联 | ✅ 有用 |
| **溯源标签（机器）** | `kb-ds-3-4-3-4`、`kb-ds-5-6-2-4` | 内容块在知识包教材里的定位 ID（kb=知识库、ds=数据结构、数字=章节路径） | ❌ 无意义 |

**关键发现（已核实代码）**：`kb-*` 溯源标签在应用代码里**零引用**——没有任何功能读取它。页面级溯源走的是 `knowledge_pack_imports.external_id`（如 `ds-chapter-1__ds-section-1-2`），块级溯源（kb-*）只是插件 manifest 的设计冗余。**删掉/隐藏它们不影响任何功能**，包括插件更新。

### 1.3 标签能干什么（现有能力）

1. **搜索筛选**：Ctrl+K 快速搜索 → 「标签」页签，点标签即列出所有带该标签的页面（`QuickSearch.tsx`）
2. **页面关联推荐**：编辑器右上角「关联」面板里，共享标签的页面会获得推荐加分（`PageEditor.tsx:257` 评分 = 共享标签 ×3 + 同章节 ×2 + 最近编辑）
3. **关联网络**：同标签页面在知识关联图中聚类

> 一句话：**标签 = 给页面打的分类记号，用来搜和找关联页面**。408 里 `408真题 / 数据结构 / 2010` 三个就够用了。

### 1.4 标签改进方案（解决"看不懂"）

| 方案 | 做法 | 效果 | 工作量 |
|---|---|---|---|
| **A. 隐藏机器标签（推荐）** | 标签区渲染时过滤 `kb-` 前缀：页面头部不显示、QuickSearch 不展示；库中数据保留（不破坏插件生态） | 页面标签立刻只剩 3 个可读标签 | 小（纯前端过滤，~20 行） |
| B. 导入器不再落库 | `knowledgePackImporter` 跳过 `kb-` 前缀的 tag | 新导入的知识包不再产生机器标签 | 小（+8 行），但已导入页面需手动清 |
| C. 一键清理 | 设置/知识库菜单加「清理知识包机器标签」，删掉 `kb-` 前缀标签 | 数据层彻底干净 | 中（IPC + 确认 UI） |
| D. 标签帮助 | 标签区加 tooltip「标签用于搜索与关联，可 Ctrl+K 按标签筛选」；帮助文档补一节《标签怎么用》 | 新用户不再困惑 | 小 |

**推荐组合：A + D**（隐藏 + 帮助），风险最低、立竿见影；B/C 可选做。

---

## 第二部分：题目收藏 + 错题集（方案）

### 2.1 需求

刷题时：
- 看到好题/不会的题 → **收藏**，之后集中回看
- 答错的题 → 自动进**错题集**，可重刷、可移出

### 2.2 存储方案对比

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. localStorage（纯前端） | 零改动、立即能用 | 跨页面聚合难（需逐页扫描解析）；页面更新后内容漂移；无统计；多窗口不一致 |
| **B. 数据库新表（推荐）** | 与知识库生态一致；跨页面聚合；可统计错题率；**题目快照**（原页更新不丢）；可重刷 | 需迁移 049 + IPC + Repo，工作量约半天 |

### 2.3 数据模型（迁移 049 `quiz_records`）

```sql
CREATE TABLE quiz_records (
  id           TEXT PRIMARY KEY,          -- uuid
  page_id      TEXT NOT NULL,             -- → knowledge_pages.id
  quiz_no      INTEGER NOT NULL,          -- 题号（对应 QuizItem.no）
  page_title   TEXT NOT NULL DEFAULT '',  -- 页面标题快照（页面改名不丢）
  is_favorite  INTEGER NOT NULL DEFAULT 0,-- 收藏标记
  wrong_count  INTEGER NOT NULL DEFAULT 0,-- 累计答错次数
  correct_count INTEGER NOT NULL DEFAULT 0,
  last_result  INTEGER,                   -- 最近一次 0 错 / 1 对
  snapshot_json TEXT NOT NULL DEFAULT '', -- 题目快照：{question, options, answer, explanation}
  source_space    TEXT NOT NULL DEFAULT '',-- 来源空间名快照（如"考研政治"，聚合视图分组/分类用）
  source_notebook TEXT NOT NULL DEFAULT '',-- 来源笔记本名快照（如"背诵手册"）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(page_id, quiz_no)                -- 一题一行，收藏+错题合一（去重关键）
);
CREATE INDEX idx_quiz_records_page ON quiz_records(page_id);
CREATE INDEX idx_quiz_records_fav  ON quiz_records(is_favorite);
CREATE INDEX idx_quiz_records_wrong ON quiz_records(wrong_count);

-- 自定义分组（"新建本子分类"）：用户可建「马原易错」「计算题」等分组，一题可归入多组
CREATE TABLE quiz_collections (
  id         TEXT PRIMARY KEY,          -- uuid
  name       TEXT NOT NULL,             -- 分组名（≤50 字）
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE quiz_record_collections (
  record_id     TEXT NOT NULL,          -- → quiz_records.id
  collection_id TEXT NOT NULL,          -- → quiz_collections.id
  PRIMARY KEY (record_id, collection_id)
);
```

设计要点：
- **收藏与错题同表（已拍板，两功能实现一致）**：一题一行，`is_favorite` + `wrong_count` 双标记——一道题可以既收藏又常错；`UNIQUE(page_id, quiz_no)` 保证**同题去重**，重复答错/重复收藏只更新计数，绝不重复追加
- **快照**：存题目 JSON（含 source_space/source_notebook），原页面被插件更新/修改/删除后，错题集仍能完整回看与分组（含图 attachment:// 引用仍有效）
- **自动移出（已拍板）**：错题集以 `wrong_count > 0` 判定；重刷该题全对 → `wrong_count` 归零 + `last_result=对`，即自动从错题集消失；收藏标记（is_favorite）不受影响
- **聚合视图（已拍板，非物理写页面）**：不把题目真实写进某个知识库页面；「错题本」「收藏」是应用内置视图，打开时实时聚合 `quiz_records` 渲染，看起来就是"题目都追加进了一个本子"，但底层是表、天然去重可统计
- **两级分类（已拍板）**：①自动维度——`source_space` 按来源科目自动分组；②自定义维度——`quiz_collections` 用户自建分组（对应"新建页面分类"诉求），一题可归入多组，多对多关联

### 2.4 IPC（preload + Repo）

```
quizRecord:getByPage(pageId)          → 该页所有记录（卡片/刷题模式初始化星标态）
quizRecord:report(pageId, quizNo, {correct}) → 答题上报：答错自增 wrong_count，答对自增 correct_count，更新 last_result
quizRecord:toggleFavorite(pageId, quizNo, snapshot) → 收藏/取消收藏
quizRecord:list({kind: 'favorite'|'wrong'|'all', sourceSpace?, collectionId?})   → 跨页面聚合列表（按来源空间/自定义分组筛选）
quizRecord:delete(pageId, quizNo) / clearWrong()
quizCollection:list() / create(name) / rename(id, name) / delete(id)   → 自定义分组 CRUD
quizRecord:setCollections(recordId, collectionIds[])                   → 一题归入哪些分组
```

### 2.5 交互设计

**刷题时（QuizCard / QuizMode）**
- 每道题右上角加**收藏星标**（复用现有页面星标视觉语言），点一下收藏、再点取消
- 答题上报自动触发：答错 → wrong_count+1（用户无感，不弹窗）
- QuizMode 结束页增加"错题 X 道已加入错题集"提示

**错题集/收藏视图（新组件 `QuizCollection.tsx`，聚合视图）**
- 入口（已拍板）：知识库**侧边栏底部**新增「错题本 / 收藏」图标，与回收站并列
- 内容：跨页面聚合列表，两个主视图：**收藏** / **错题**（收藏与错题共用组件，仅列表源不同）
  - **两级分类**：
    - 自动维度：顶部按 `source_space` 自动分组（408 / 考研数学 / 考研政治 / 考研英语 / 手动笔记）
    - 自定义维度：左侧「分组」列表，用户自建分组（「马原易错」「计算题」等），选中即筛选该组题目
  - 每项：来源页面（点击跳转）+ 题号 + 题干摘要 + 错次数 + 最近结果 + 收藏星标
  - 点击展开：完整题干/选项/答案/解析（快照渲染，公式图片全支持）
- 操作：取消收藏、移出错题（保留记录）、**归入分组**（展开项里选分组，多选）、**重刷错题**（一键进入逐题模式，复用 QuizMode，只刷当前分组/列表）
- **自动移出**：重刷某错题答对即 `wrong_count` 归零，自动从错题视图消失（若仍收藏则留在收藏视图）

### 2.6 实现落点

```
electron/database/migrations/049_quiz_records.ts   # 新迁移：quiz_records + quiz_collections + quiz_record_collections 三表（追加式）
electron/database/repositories/quizRepo.ts         # 新 Repo（registerQuizHandlers + 分组 CRUD）
electron/preload/index.ts                          # +10 通道（record 6 + collection 4）
src/lib/ipc.ts                                     # +10 封装
src/components/shared/QuizCard.tsx                 # 改：收藏星标 + onAnswered 上报
src/components/shared/QuizMode.tsx                 # 改：收藏 + 上报 + 结束页提示
src/modules/knowledge/components/QuizCollection.tsx# 新：错题集/收藏聚合视图（含分组管理）
src/modules/knowledge/index.tsx 或 NotebookList    # 改：侧边栏入口
```

### 2.7 工作量与顺序

| 步骤 | 内容 | 估量 |
|---|---|---|
| 1 | 迁移 049 + quizRepo + preload + ipc 封装 | ~150 行 |
| 2 | QuizCard/QuizMode 埋点（星标 + 上报） | ~80 行 |
| 3 | QuizCollection 视图 + 入口 | ~300 行 |
| 4 | 重刷错题（复用 QuizMode） | ~60 行 |

v1（步骤 1-2）做完即可用：刷题时自动积累错题、星标收藏；v2（步骤 3-4）集中复习视图。

---

## 第三部分：决策状态

**标签（已实施 ✅）**
- 已采用 A+D：隐藏 `kb-*` 机器标签 + 标签区 tooltip 帮助（2026-08-29 落地）

**收藏与错题集（已拍板 ✅）**
- 形态：**聚合视图**（`quiz_records` 表 + `QuizCollection` 实时聚合，非物理写页面）
- 去重：**同题一行 + 计数**（`UNIQUE(page_id, quiz_no)`）
- 移出：**重刷全对自动移出**（`wrong_count` 归零）
- 分类：**自动（source_space）+ 自定义分组（quiz_collections）两级**
- 入口：**知识库侧边栏底部图标**
- 两功能**同表同实现**，408/数学/英语/政治通用

**剩余待确认（均有推荐默认值，可直接采纳）**
- [ ] 收藏按钮是否同时进 QuizMode 逐题刷题界面（默认：要）
- [ ] 图片快照跟随：`attachment://` 引用随快照保存，原页图删了快照图也失效（默认：可接受）
- [ ] 分组是否也要区分"收藏分组 vs 错题分组"，还是共用一个分组体系（默认：共用一套分组，题目的收藏/错题状态只是维度）
