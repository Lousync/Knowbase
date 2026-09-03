# 知识库查询视图设计（库查询，对标 Obsidian Dataview）

> 日期：2026-09-02 · 类型：方案文档（本会话只出方案，不落代码）· 状态：**用户已立项，细节待拍板**
> 建议挂载：`rework-master-plan.md` §7 子文档索引（沿用该体系命名风格）
> 来源：`docs/plugin-obsidian-benchmark-20260902.md` §5.1 推荐第 1 项（Dataview → 查询面板）

---

## 1. 背景与立项理由

- **Dataview 是 Obsidian 生态下载量第一的社区插件**：核心价值是把「做了标注的笔记」变成「可查询的数据库」，用类 SQL 语法动态生成列表/表格/日历，替代手工维护索引页。Obsidian 侧统计口径 2700+ 插件，Dataview 长期居首。
- **Knowbase 现状缺口**：知识库已有分类树 / 标签 / 收藏 / 全文搜索，但缺「跨页组合查询 + 字段投影 + 动态视图」。典型诉求如「星标且含 #考研 且近 30 天更新」「无标签页面（治理）」，现在只能靠记忆翻或临时搜。
- **数据底座已就绪 4 项**（本次立项不用从零搭）：
  1. `knowledgeIndex`（✅ 已落地）：`id → { title, path, categoryId, tags, starred, sortOrder, fileType, attachmentId, createdAt, updatedAt, mtimeMs }`，缓存落 `.knowbase/cache/knowledge-index.json`；
  2. **失效钩子 4 通道已挂**（`ws:writeFile/createFile/rename/trash` → `invalidateKnowledgeIndex`，写时失效、用时懒重建），查询视图零新增失效链路；
  3. `knowledgeVaultRepo`（✅ vault 读层）：categories / pages / starred / tags / search 已有；
  4. `GraphIndex`（设计待做，见 `graph-view-design.md` §3）：链接解析只做一份、三方消费（图谱 / 编辑器补全 / 知识库反链）——**查询视图是现成的第四方消费者**，将来 inlinks/outlinks 字段直接来自它。

- **定位**：知识库模块（=阅读器）的一个**只读增强视图**，不是新模块、不写数据、不改读写分工定稿。

---

## 2. 设计原则（对标 Dataview，但明确"不抄什么"）

| 原则 | 说明 |
|---|---|
| 只查询已索引字段 | 对标 Dataview「只能查已索引数据」；v1 正文 contains 需求走既有全文搜索通道，查询引擎不做全文扫 |
| 不引入 DQL 全量语言 | 语法面必须小，面向中文个人用户；DQL 的表达式/函数体系过重 |
| **不引入 dataviewjs** | 那等于让笔记代码块执行任意 JS，与 Knowbase「沙箱 + 白名单」哲学冲突 |
| 查询引擎 = 主进程纯函数 | 数据源与裁决在主进程这条铁律不变；渲染层只传查询描述、收结果，可冒烟 |
| 字段面以索引为准 | v1 只开放 knowledgeIndex 现有字段；frontmatter 任意键等 metadataCache（Vault 化阶段 2）之后再扩 |
| 只读不写 | 查询结果不做行内编辑（任务勾选类交互不引入） |

---

## 3. 用户场景（写进验收的 6 条）

1. 全部星标页，按更新时间倒序（替代现有星标入口的固定排序）。
2. 标签 `#考研` 且星标（跨分类收集）。
3. 某分类下近 7 天更新（`updatedSince: days:7`）。
4. **无标签页面**（内容治理：找出来补标签）。
5. 按 `fileType` 过滤（如只看带 pdf 附件的页）。
6. 标签集合的表格视图（title + tags + categoryName + updatedAt 列），可按更新时间排。

---

## 4. 数据模型：可查询字段面（v1）

隐式字段（全部来自 knowledgeIndex 条目，无新增扫描）：

| 字段 | 类型 | 过滤/排序可用性 | 备注 |
|---|---|---|---|
| `id` | string | 相等 | 恒有 |
| `title` | string | —（排序可用） | 列表恒显示 |
| `path` | string | — | 仓库内相对路径（跳转编辑器用） |
| `tags` | string[] | 包含（任一命中） | v1 或语义，chips 直觉 |
| `starred` | boolean | 相等 | |
| `categoryId` | string \| null | 相等 / `null`=未分类 | 显示时 join 分类名 |
| `categoryName` | string | 派生，列表/表格列 | 遍历 categories.json 一次建映射 |
| `fileType` | string | 相等（空串=普通 md 页） | |
| `createdAt` / `updatedAt` | date | 范围（since/until，支持 `days:N` 相对） | ISO 字符串 |
| `attachmentId` | string | 相等（将来给附件页查询用） | |

扩展字段（GraphIndex G0 落地后追加，见 §9）：`inlinks` / `outlinks` / 反链计数。

**v1 明确不做**：frontmatter 任意键查询、inline 字段（`[key:: value]`）、正文全文、正则/函数表达式、TASK/CALENDAR 视图（日历可后置接 `updatedAt`/`createdAt`）。

---

## 5. 查询描述格式：QDL（JSON）

**决策倾向：JSON 而非文本 DSL**，理由：

- 免写解析器、免转义/引号地狱；结构可被校验（字段白名单 + 类型检查）；
- 与 Knowbase 的 AI 语境天然契合：用户可以让 AI 助手直接构造/修改查询；
- 将来若做「可嵌入知识页的查询代码块」，只加一层薄 DSL → JSON 的翻译层即可，引擎不变。

```
{
  "name": "考研·星标·近30天",           // 可选；保存查询时写入
  "filter": {                          // 全部 AND；空对象 = 全库
    "tags": ["考研", "408"],           // 任一命中
    "starred": true,
    "categoryId": "uuid",              // 精确；"@none" = 未分类
    "fileTypes": ["pdf"],              // 空数组 = 不限
    "updatedSince": { "days": 30 },    // 或 ISO "2026-08-01"
    "updatedUntil": "2026-09-02"
  },
  "sort": { "by": "updatedAt", "dir": "desc" },   // by ∈ title/createdAt/updatedAt/sortOrder
  "view": "list",                      // list | table
  "columns": ["categoryName", "tags", "updatedAt"] // table 专用；title 恒为第一列
  "groupBy": "categoryId",             // v2 预留，v1 解析器收到即报错
  "limit": 200                         // 默认 100，硬上限 500
}
```

校验规则（引擎第一道）：`filter` 键白名单、`tags/fileTypes` 为字符串数组、`starred` 布尔、日期可解析、`sort.by/dir` 白名单、`view/columns` 白名单、`limit` 封顶——非法即返回结构化错误，不抛。

---

## 6. 渲染形态与入口

入口两个候选（**倾向组合：B 为入口、A 为编辑态**）：

- **A. 知识库主区「查询」页签**：运行时编辑过滤条件（chips 构建器：标签选择器 / 星标开关 / 分类选择 / 日期快捷「7 天 / 30 天」），与现有页签体系（PageTabBar）同层，可同时开多个查询。
- **B. 侧栏「查询」分组**：知识库侧栏新增一组「已保存的查询」（对标星标/收藏入口），每条即点即渲结果；点「新建查询」进入 A 的编辑态。

视图形态：

- **LIST**：标题 + 副行（分类名 · 更新时间 · 星标记号），点击打开页面（复用现有 `openPage` 逻辑与 PageTabBar）。
- **TABLE**：第一列恒为 title，其余列 = `columns` 声明的字段投影；单元格点击同样开页。
- 空态：无结果 / 未建索引（提示打开仓库）/ 非法查询（展示结构化错误）。
- **刷新约定**：显式刷新按钮 + 模块 `isActive` 二次激活重取（保活架构硬约束，与知识库现有 refresh 全家桶一致）；v1 不做 watcher 实时刷新。

---

## 7. 引擎与 IPC 落点

- **引擎**：`electron/lib/kbStore/knowledgeQuery.ts`——`runQuery(index: KnowledgeIndex, qdl: QueryDesc): QueryResult` 纯函数（不依赖 Electron，可冒烟），输入知识索引 + 分类映射，输出过滤排序后的行（只带索引字段，不读正文）。
- **查询定义持久化**：`.knowbase/modules/knowledge/saved-queries.json`（jsonStore 原子写，与 categories.json 同目录同级——仓库级、随仓库切换），含 id/name/desc/createdAt/updatedAt。
- **IPC**：知识库 `knowledgeRepo` 新增两通道，沿用 `kHandle` 包装：
  - `knowledge:query`（传 QDL JSON → 回结果行）——**仅 vault 模式（`storageKnowledge=vault`）启用**，sqlite 模式友好拒绝（与既有分流同开关，数据形态不同源）；
  - `knowledge:queries`（saved-queries 的 list / save / delete，语义对齐现有 `knowledge:getTags` 等管理通道）。
- 渲染层 `src/modules/knowledge/components/QueryPanel.tsx` + 侧栏「查询」分组；查询结果行携带 `path`，跳转编辑器复用 `kb-open-in-editor` 协议或页签打开。

---

## 8. 性能与防卡死

- 引擎只遍历内存索引：千级页面单次查询 <5ms（同步无压力）；**不读正文**（对比现状 `vaultGetPages` 每页 readBody 的同步读盘，查询视图反而是轻路径）。
- 行数：默认 100 / 硬上限 500，分页按钮后置。
- 索引懒重建已就绪（删除缓存文件）；重建期间查询返回「索引构建中」空态而非阻塞。
- 分类映射一次构建复用；字符串比对统一小写化避免大小写坑（对标 `vaultSearchPages` 口径）。

---

## 9. 与既有路线的衔接

| 路线项 | 衔接点 |
|---|---|
| knowledgeIndex（✅） | 查询引擎的数据源；零新扫描、零新失效钩子 |
| GraphIndex（G0，待做） | G0 落地后追加 `inlinks/outlinks` 字段面与反链计数；**查询视图不阻塞 G0，Q2 之前完全独立** |
| metadataCache（Vault 化阶段 2） | 若扩 frontmatter 任意键索引，表格列自定义面随之扩展 |
| 代码块处理器（Obsidian 借鉴清单 #5） | 将来「查询嵌入知识页」直接复用本引擎（QDL → 渲染），一处设计两处消费 |
| Workbench 化（R1） | 侧栏插槽系统化后，查询入口平滑迁移，不需重写 |
| 读写分工定稿 | 查询 = 知识库（阅读器）的只读视图，不违反「编辑器唯一写入方」 |

---

## 10. 分期

| 期 | 内容 | 依赖 |
|---|---|---|
| **Q0（MVP）** | `knowledgeQuery.ts` 引擎（filter: tags/starred/categoryId(含 @none)/fileType/日期范围 + sort + LIST 视图）→ 校验与错误结构 → IPC 两通道（vault 模式门禁）→ 侧栏「查询」分组 + 新建查询 chips 表单 + saved-queries.json 持久化 + LIST 行点击开页 | knowledgeIndex ✅ / vault 读层 ✅（无 G0 依赖） |
| **Q1** | TABLE 视图 + `columns` 字段投影 + 列选择 UI；保存查询的改名/排序/删除；分页 | Q0 |
| **Q2** | GraphIndex 字段（inlinks/outlinks/反链计数）；相对日期快捷 chips（7/30 天）；查询代码块嵌入（需代码块处理器机制先行或同期） | G0 + Q1 |
| 后置候选 | CALENDAR 视图（接 createdAt/updatedAt）；frontmatter 任意键列 | metadataCache |

---

## 11. 验收与冒烟计划

- **冒烟**：`tmp/smoke/knowledge-query-smoke.mjs`——临时仓库构造 50 页（交叉 tags/starred/category/fileType/createdAt 日期分布）→ `runQuery` 各过滤组合断言结果集与顺序；非法查询矩阵（未知字段/类型错/超限/groupBy 报错）断言结构化错误；saved-queries JSON 原子写往返。**全绿口径：全部用例通过 + tsc 双侧本次文件零错误**。
- **人工验收**：真实 `E:\knowledge`（216 页）跑 §3 六条场景，结果与手工核对；保存的查询重启后仍在（随仓库恢复）；模块切走再切回（isActive 二次激活）结果刷新；vault/sqlite 双模式下行/拒绝行为正确。

---

## 12. 待拍板问题

1. **入口**：A 主区页签 / B 侧栏分组（推荐 B 入口 + A 编辑态组合）——需看 Workbench 化（R1）是否先行，若 R1 先行则侧栏插槽天然支持。
2. **查询描述格式**：JSON（推荐）vs 薄文本 DSL（`list from #tag where starred`）。
3. **多标签语义**：任一命中（推荐，chips 直觉）vs 全部命中（Dataview 对多条件默认全 AND、同字段多值 OR）。
4. **TABLE + groupBy 是否进 Q0**（建议 TABLE 进 Q0、groupBy 留 Q1）。
5. **范围**：v1 仅知识页（推荐）还是把 blog 也纳入（blog 已随迁移器产出 .md + frontmatter，但不在 knowledgeIndex 扫描域内，需另建索引段）。
6. **saved-queries 归属**：`.knowbase/modules/knowledge/saved-queries.json`（推荐，仓库级随仓库切换）——确认与 categories.json 同级无异议。

---

## 13. 关联文档

- `docs/plugin-obsidian-benchmark-20260902.md` §5.1（立项出处：Dataview → 库查询面板）
- `docs/graph-view-design.md` §3（GraphIndex / 4 失效钩子 / 三方消费约定）
- `docs/rework-master-plan.md`（总方案，建议挂 §7 索引）
- `.AGENT/docs/读写分工设计.md`（知识库=阅读器，编辑器=唯一写入方）
- `electron/lib/kbStore/knowledgeIndex.ts` / `knowledgeVaultRepo.ts`（数据源与读层现状）
