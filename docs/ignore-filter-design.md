# `.ignore` 过滤层设计（知识库隐藏规则）

> 2026-09-07 方案会话定稿，未落代码。四项拍板：**全链路一致 / 仅仓库根一个 / 彻底不可见 / 完整 gitignore 语法**。

## 1. 背景与目标

用户希望在仓库根创建一个 `.ignore` 文件，仿 gitignore 语法书写规则，命中的文件/目录**在知识库模块不可见**；编辑器是唯一写入方，**不受影响**（用户仍能看到、编辑被忽略的文件）。

典型用途：私人草稿、临时素材、不想进 AI 上下文的目录。

## 2. 数据流与插入点

```
编辑器（唯一写入方，不受 .ignore 影响）
        │ 保存
        ▼
仓库根 Vault（.knowbase/ 、*.md 、.ignore）
        │ 扫描
        ▼
scanMarkdownFiles ── 系统区跳过（现状硬编码：. 开头目录 / _inbox / _attachments / 嵌套 .knowbase）
        │
        ▼
★ .ignore 过滤层（新增）：目录剪枝 + gitignore 语法匹配
        │
        ▼
rebuildKnowledgeIndex → cache/knowledge-index.json
        │
        ├─ 知识库读层（列表·搜索·星标·反链）   knowledgeVaultRepo
        ├─ 图谱                                graphIndex
        ├─ AI 工具检索                         builtinTools
        └─ quiz 来源解析                       quizRepo
```

**核心结论**：vault 模式下知识库唯一数据源 = `rebuildKnowledgeIndex()`，图谱/搜索/反链/AI 检索/quiz 全部消费同一份索引 → 过滤层只需插在扫描器一处，下游自动全链路生效。

## 3. 拍板记录

| 决策点 | 结论 |
|--------|------|
| 生效范围 | **全链路一致**：列表/搜索/图谱/AI 检索/quiz 来源一并生效（过滤插在索引层） |
| 文件层级 | **仅仓库根一个 `.ignore`**（与 `.knowbase` 同级）；子目录级联挂账后议 |
| 忽略强度 | **彻底不可见**：列表、搜索、图谱、反链全部消失；与 draft 形成清晰分层（draft=退稿图谱虚化可见，ignore=出局连图谱都没有） |
| 语法范围 | **完整 gitignore 语法**：`#` 注释、`*` `**` `?`、`/` 锚定、`dir/` 目录、`!` 取反；引入 `ignore` npm 包（零依赖、久经考验），不手写匹配器 |

## 4. 改动点清单

| # | 位置 | 改动 |
|---|------|------|
| 1 | `electron/lib/kbStore/ignoreFile.ts`（新增） | 读根级 `.ignore`（Windows 大小写不敏感查找）→ `ignore` 包编译匹配器（按 mtime 缓存，文件未变不重编译）；空文件/不存在 = 无过滤；非法模式行收集进 index warnings |
| 2 | `electron/lib/kbStore/knowledgeIndex.ts` `scanMarkdownFiles` | 接入过滤层：**目录级剪枝**（目录命中 → 整棵不递归，性能优于逐文件过滤）+ 文件级匹配；`.ignore` 语义叠加在系统区跳过**之后**（系统区行为不变，不受 `!` 取反影响） |
| 3 | `electron/lib/workspaceManager.ts` 失效链 | `ws:writeFile` / `ws:createFile` / `ws:rename` / `ws:delete` 对文件名 `.ignore`（大小写不敏感）也触发 `invalidateIndexIfCurrentVault` + `invalidateGraphIndex`。现状仅 `.md` 后缀触发（L685/L707 等），不补则编辑器里保存 `.ignore` 不生效 |
| 4 | `src/modules/help/docs/` | 新增帮助文档一篇（语法速查 + 与 draft 的区别 + 生效范围说明） |

## 5. 语义细则

| 场景 | 行为 |
|------|------|
| 被忽略页在图谱 | 节点完全消失；可见页 `[[链接]]` 指向它 → 归入「未解析虚节点」（与链接到不存在页面同语义） |
| 反链 | 被忽略页不出现，也不产生指向它的反链 |
| AI 工具检索 | 自动排除（共用索引；私有文件不进 AI 上下文，通常正是期望） |
| quiz 已挂被忽略页 | quiz 记录仍在 sqlite，仅 `vaultResolveSource` 来源解析为空（空间/笔记本显示为空），不报错 |
| 分类对账 | 被忽略文件所在目录仍在磁盘 → `ensureDirCategories` 的 stale 清理不触发，**不产生僵尸分类**；被忽略文件不参与 dirs 派生 |
| `.ignore` 文件本身 | 非 `.md` 天然不入知识索引；在编辑器文件树正常可见可编辑 |
| 外部编辑 `.ignore`（记事本等） | 与外部编辑 `.md` 同现状：无 watcher，依赖切模块重读/手动刷新；应用内保存才即时生效 |
| 其他模块 | 博客/书签/单词本等各自独立扫描，**v1 不接入** `.ignore`（挂账） |

## 6. 边界（明确不做）

- 编辑器文件树**不做**过滤、不置灰（编辑器是写入方，必须全可见）
- 不用 `.ignore` 控制系统区（`.knowbase/` 等先于过滤层跳过，`!` 取反救不回，语义简单）
- 不做子目录级联、不做编辑器文件树标识（挂账后议）

## 7. 阶段划分

- **P1**：改动 1-3（ignoreFile.ts + 扫描器接入 + 失效链补丁）
- **P2**：帮助文档 + warnings 提示透出
- **后议**：子目录级联；编辑器文件树 `.ignore` 标识；博客等模块接入

## 8. 验收标准（整套完成后统一 smoke + tsc + build）

1. `tsc --noEmit -p tsconfig.node.json` / `tsconfig.web.json` 双绿
2. smoke：仓库根建 `.ignore` 写入某目录 → 该目录下页面在知识库列表/搜索/图谱/AI 检索全部不可见；编辑器文件树仍可见
3. 编辑器内保存 `.ignore` → 知识库立即生效（无需重启）
4. `!` 取反、`**`、`dir/` 行为与 git 一致（用 ignore 包的语义）
5. 被忽略目录不产生僵尸分类节点；图谱无残留
6. 非法模式行 → warnings 有提示，不影响其余规则生效

## 9. P3 增量方案（2026-09-08 提出，未落代码）：专属图标 + 归档硬守卫

### 9.1 背景

编辑器文件树中 `.ignore` 显示为普通文件图标（走 default.svg），无辨识度；用户要求图标特殊化，并要求程序级保证 `.ignore` 永远不会被归档为知识页。

### 9.2 现状核对（防线盘点）

| 防线 | 位置 | 现状 |
|---|---|---|
| 索引层 | `knowledgeIndex.ts` L125 只扫 `.md` | ✅ `.ignore` 天然不入知识索引 |
| UI 层 | `editor/index.tsx` L1215 / L1253「归档为知识页」条件 `.md` 结尾 | ✅ `.ignore` 不显示归档入口 |
| 主进程 | `workspaceManager.ts` `ws:setMdStatus`（L790） | ⚠️ 无文件名校验——UI 条件一旦放宽或被 AI/插件直调 IPC，`.ignore` 会被注入 frontmatter id 变成知识页 |
| 图标 | `FileTree.tsx` `FileIcon` → `fileIcons.ts` `getFileIcon('ignore')` | ⚠️ 无映射 → default.svg 普通文件图标 |

### 9.3 改动点

| # | 位置 | 改动 |
|---|---|---|
| 1 | `src/assets/ignore.svg`（新增） | 自绘 vscode-icons 风格 SVG：文件轮廓 + 斜杠禁用符（🚫 变体），灰调（`#8a919c` 类 muted 色），风格与其余 27 枚图标一致（自绘，无 CC BY 4.0 署名负担） |
| 2 | `src/modules/editor/components/FileTree.tsx` `FileIcon` | **文件名精确匹配分支**（在 ext 提取之前）：`name.toLowerCase() === '.ignore'` → 专属图标。不做 `FILE_ICONS['ignore']` 注册——那会把 `a.ignore` 等任意 `.ignore` 后缀文件全部误命中 |
| 3 | `electron/lib/workspaceManager.ts` `ws:setMdStatus` | 开头硬守卫：取 `basename` 小写 === `.ignore` → `return { ok: false, error: '.ignore 是过滤规则文件，不能归档为知识页' }`。UI 层条件不动（双保险） |
| 4 | `src/modules/help/docs/.ignore 知识库隐藏规则.md` | 「语法速查」补「忽略目录」常用写法示例（`学习空间/`、`/学习空间/`、嵌套路径写法） |

### 9.4 验收标准

1. 文件树中 `.ignore` 显示专属禁用符图标；`大写变体`（`.IGNORE`）同样命中
2. 右键/ tab 右键 `.ignore` 均无「归档为知识页」（现状回归）
3. 直调 `ws:setMdStatus` 传 `.ignore` 路径 → 被拒绝，frontmatter 不被改写
4. tsc 双绿；`.ignore` 归档守卫不影响正常 .md 归档流程
