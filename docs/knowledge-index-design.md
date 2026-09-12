# 知识索引与语义检索设计（AI 基建 A）

> 归属：feature/ai-plugin-upgrade 工作线。状态：设计稿，待评审后分期落码。
> 关联：`plugin-api-v2-design.md` §5.3 `kb.metadata.*`（本文是其前置）；`rework-plugin-openness.md`。

## 0. 一句话结论

结构索引（页面/标签/目录/正文/反链）**已经存在且质量不低**，本文不重建它；要补的是它上面的**语义层**——分块、嵌入、向量库、混合召回门面，四件事全部落在仓库内 `.knowbase/`，无新增必选外部依赖。

## 1. 现状盘点（事实，防重造）

| 已有 | 位置 | 说明 |
|---|---|---|
| 页面结构索引 | `electron/lib/kbStore/knowledgeIndex.ts` `getKnowledgeIndex()` | 全库页面（id/title/tags/path/entryKind）+ 目录树；进程内 memo + 磁盘缓存 `.knowbase/cache/knowledge-index.json` |
| 正文纯文本索引 | 同文件 `getKnowledgeTextIndex()` | id → `mdToPlain(正文)`，**整页粒度**；磁盘缓存，懒重建，按 vaultKey 隔离。417 页实测「68ms 全盘读 → 一次 JSON 读取」（2026-09-10 性能注） |
| 失效机制 | `invalidateKnowledgeIndex()` | 清 memo + 删磁盘缓存；`knowledgeVaultRepo` 全部写操作显式调用（10+ 处）——**写路径失效语义已验证** |
| 反链/链接解析 | `knowledgeVaultRepo` GraphIndex（R2/R4） | 统一 wikilink 解析，图谱模块（d3-force）消费 |
| AI 检索工具 | `builtinTools.ts` `builtin.knowledge.search` | 关键词空格 AND，title/tag/body 三路 includes，cap 50，返回 excerpt |

结论：**A1「结构索引」无需另起炉灶**。真正的缺口在下面四处。

## 2. 缺口诊断（按严重度）

1. **无语义召回**（P0）：`terms.every(includes)` 的布尔 AND——「我之前记过的讲遗忘曲线的东西」直接失败；同义/换述/错别字全部漏召回。这是知识管理工具 AI 能力的地基缺口。
2. **粒度 = 整页**（P1）：正文索引按页存取。长页做 RAG 时，整页塞进上下文浪费 token 且常超限截断；语义检索需要块级粒度。
3. **无相关度排序**（P2）：布尔命中即返回，多条命中时顺序即数组顺序，没有 TF/标题加权/语义分。
4. **结构化查询不全**（P3）：tags 有，frontmatter 泛查询（`status==draft && date>2026-01`）没有——`kb.metadata.*` 需要它。

## 3. 目标与红线

- **本地优先**：不新增必选外部服务。嵌入走用户**已配置**的 provider（openai-compatible /embeddings、ollama 本地）；未配置或调用失败 → 优雅降级纯关键词，功能不报错不缺失。
- **数据随仓库走**：一切新落盘在 `<vault>/.knowbase/semantics/`，备份=拷仓库，切仓库天然隔离（沿用 `jsonStore`/`getVaultKbRoot` 模式）。
- **隐私红线**：正文片段只发往用户自己配置的嵌入端点；宿主不内置任何默认云端。
- **写路径一致性**：挂在现有 `invalidateKnowledgeIndex()` 钩子上，不另建 fs watcher（watcher 属于插件 P2 `kb.vault.watch` 范畴，职责分开）。
- **性能预算**：万页级仓库索引重建 ≤ 分钟级；增量更新（单页保存）≤ 1s；召回 ≤ 50ms（不含嵌入调用）。

## 4. 架构总览

```
┌─ 消费端 ─────────────────────────────────────────────┐
│ AI 工具(builtin.knowledge.search 升级) / 相似笔记 UI   │
│ 插件 kb.metadata.*(search/get/query/backlinks)        │
└──────────────────┬───────────────────────────────────┘
            ┌──────▼───────┐
            │ searchKnowledge()  ← 唯一召回门面（混合 RRF）  │   ← 新增
            └──┬────────┬──┘
      关键词路 │        │ 语义路
   (现索引改造) │        │
            ┌──▼──┐  ┌──▼─────────────────────────┐
            │现有  │  │ 分块 chunker → 嵌入通道     │   ← 新增
            │结构+ │  │ → 向量库 .knowbase/semantics│
            │正文索引│ └────────────────────────────┘
            └──────┘   （结构索引不动，只加块级表）
```

## 5. 分块设计

- **切分依据**：Markdown 标题层级（## / ###）为主——尊重文档结构；单块超 800 token 的长段落用固定窗口二级切分（600 token / 100 重叠）。
- **目标块大小**：300–800 token。过小→向量噪声，过大→上下文浪费。
- **块标识**：`chunkKey = sha1(pageId | chunkIdx | contentHash(块文本))`。contentHash 变化 = 内容变了，需重嵌入；否则复用已有向量——**嵌入缓存天然内置，增量构建零重算**。
- **范围**：仅 md 正文页（`entryKind` 非 file/归档二进制）；首块文本前缀拼 `页面标题 /`，缓解无标题块检索偏弱。
- 删除页/改标签 → 块表随结构索引 diff 清理（块表存 pageId，孤儿块直接删，向量文件按 offset 回收延后到紧凑化）。

## 6. 嵌入通道

- `llmService` 增加第三种调用形态 `embed(provider, texts[])`：
  - `openai-compatible`：`POST {baseUrl}/embeddings`（`input` 数组，批 ≤ 64）
  - `ollama`：`POST {baseUrl}/api/embeddings`（逐条，本地无批）
- **模型配置**：设置页每 provider 增 `embeddingModel` 字段（如 `text-embedding-3-small` / `bge-m3` / 智谱 `embedding-3`）；不配 = 语义层禁用（明确提示，不静默）。
- **元数据**：向量文件头记录 `{model, dimension, createdAt}`；模型或维度变更 = 全量重建（旧文件整体作废，不混维度）。
- **失败策略**：批失败重试 1 次 → 放弃该批并标记页为 `pending`，下次构建补；构建过程不阻塞 UI（主进程异步队列）。

## 7. 向量存储

```
<vault>/.knowbase/semantics/
  chunks.json     ← [{chunkKey, pageId, idx, title, offset, dim, hash}]（结构化，人可读）
  vectors.bin     ← 定长记录 Float32[dim] × N，offset 对齐 chunks.json
```

- **二进制而非 JSON**（ADR-2）：417 页 × ~5 块 × 1024 维 × 4B ≈ 8 MB——JSON 存向量体积 ×4 且解析慢；bin 追加写天然契合增量。
- **检索 = 内存暴力余弦**（ADR-1）：1 万块 × 1024 维 ≈ 40MB Float32，`subarray` 逐块点积 < 10ms。不引 ANN/sqlite-vec（去库化红线，规模到十万块再议）。
- 加载策略：懒加载 + 进程内 memo（对齐 `getKnowledgeTextIndex` 的 memo 模式），向量文件 mtime 变化即重载。

## 8. 混合召回门面

```ts
// electron/lib/knowledgeSearch.ts（新，纯逻辑可冒烟）
searchKnowledge({
  query: string,
  topK?: number,                     // 默认 8
  mode?: 'auto' | 'keyword' | 'semantic',   // auto = 有向量用混合，否则纯关键词
  filters?: { tags?: string[]; categoryId?: string },
}): KnowledgeHit[]
// KnowledgeHit = { pageId, path, title, chunkIdx?, excerpt, score, via: 'keyword'|'semantic'|'hybrid' }
```

- 关键词路：现 `vaultSearchPages` 改造——AND 放宽为「命中数优先 + TF 与标题命中加权」评分，不再一票否决。
- 语义路：query 嵌入（单条）→ 余弦 top 50 → 按页聚合。
- 融合：RRF（k=60），两路排名倒数求和；`via` 透传给 UI/工具展示来源。
- 摘要：关键词路沿用 `buildExcerpt`；语义路取块原文前 200 字。

## 9. 接线

| 消费端 | 改动 |
|---|---|
| `builtin.knowledge.search` | 加 `mode` 入参（默认 auto），返回增加 `score/via`；工具描述更新，提示语义可用 |
| 相似笔记 | 渲染层保存页面后调 `searchKnowledge({ query: 标题+首段, filters: { 排除自身 } })`，编辑器侧栏建议 |
| `kb.metadata.*`（插件） | `search` → `searchKnowledge`；`get/backlinks` → 现结构索引/GraphIndex 直读；`query`（frontmatter 泛查询）随 A3 补 |
| 知识库 UI 搜索框 | 沿用关键词路不动（交互确定性优先），A3 再评估是否暴露语义开关 |

## 10. 分期路线

| 期 | 内容 | 验收 | 状态 |
|---|---|---|---|
| A1 | chunker + 向量库读写 + `llmService.embed` + 构建/增量管线 | 冒烟：离线构建全库；改一页重建仅重算该页块；无 embedding 配置时全链路降级不报错 | ✅ a0bff04（chunker 14 断言 / 向量库 22 断言） |
| A2 | `searchKnowledge` 门面 + AI 工具接线 + 设置页 embedding 配置 | 真机：语义问句命中关键词搜不到的页；混合评分排序稳定 | ✅ a0bff04（真机验收待用户配 embeddingModel） |
| A3 | 相似笔记 UI + `kb.metadata.*` 插件方法 + frontmatter 泛查询 | 插件冒烟走 Gateway 全链路 | ✅ 本提交（求值器 23 断言 / Gateway 源码级 13 断言；真机全链路待验） |

## 11. 决策记录（ADR）

| 编号 | 决策 | 备选 | 理由 |
|---|---|---|---|
| ADR-1 | 内存暴力余弦 | ANN（hnsw/sqlite-vec） | 万块级 <10ms；去库化红线不引 sqlite；规模阈值写入代码注释留升级口 |
| ADR-2 | 向量二进制 bin + 元数据 JSON | 全 JSON / 单一 JSONL | 体积 ×4 差距、免 parse、追加写契合增量 |
| ADR-3 | 标题层级分块为主 | 固定窗口 / 语义分块 | 尊重文档结构；实现确定可测；语义分块依赖模型不在本地红线内 |
| ADR-4 | chunkKey 含 contentHash 即缓存 | 独立嵌入缓存表 | 一个键同时解决「变了没」和「算过没」，无额外状态 |
| ADR-5 | 挂 `invalidateKnowledgeIndex()` 现有钩子 | 新建 fs watcher | 写路径失效语义已验证（10+ 调用点）；watcher 是 kb.vault.watch 的职责，不重复建设 |
| ADR-6 | 向量库落 `<vault>/.knowbase/semantics/` | userData 全局 | 备份=拷仓库；多仓库隔离；对齐 cache 现状 |
| ADR-7（A3） | 新增独立能力 `vault:read`，不复用 `knowledge` | 复用 knowledge | `knowledge` 现语义是"刷题器等宿主知识功能"，混用会稀释安装页授权语义；`vault:read` 精确表达"只读检索"，且 P2 `kb.vault.*` 直接沿用；风险归 C 级（暴露全部笔记元数据），默认策略已放行 C |
| ADR-8（A3） | frontmatter 查询白名单文法（==/!=/>/>=/</<= + &&/\|\|，无括号无函数） | JSON 过滤条件 / 正则 | 表达式可直接写在插件 manifest 与 AI 工具入参里，人可读可手写；不执行代码对齐 §5.4 when 约定 |
| ADR-9（A3） | 索引条目只存 frontmatter 标量快照（键≤32/值≤200 字符） | 存原始 frontmatter 文本 | 防超大 frontmatter 撑爆索引缓存；泛查询只需标量比较 |

## 12. 待定问题（需拍板）

1. **默认嵌入方案引导**：设置页给「本地 ollama（零成本/隐私最优）」与「云端 provider（质量优）」的双卡片引导？默认不启用任何一方。
2. **首次构建 UX**：后台队列 + 设置页进度条；构建中搜索只走关键词路（auto 自动降级）——是否需要通知条提示「语义索引构建中 37%」？
3. **换 embedding 模型的重建提示**：维度/模型不匹配时自动全量重建还是提示确认（涉及云费用）？倾向：提示确认。
4. **rerank**：一期否（RRF 够用）；若 A2 真机评测召回质量不足，二期限定在云端 provider 可用时启用。
