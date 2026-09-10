# 全类型文件归档知识库 — 实现方案

> 2026-09-10 与志岩拍板（讨论记录见 `.workbuddy/memory/2026-09-10.md`）。
> 目标：归档从「仅 md」扩展到**所有文件类型**，含目录整体归档。

## 0. 已拍板的决策（不再讨论）

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 非 md 归档文件的展示形态 | **元信息卡**（文件名/类型/大小/修改时间/分类 +「在编辑器打开」），标题参与搜索，不参与正文搜索/双链/quiz |
| D2 | HTML 渲染 | **除欢迎页外归档 html 也可渲染**，复用 kbview:// 沙箱链路，档位=「沙箱渲染+断外联」（`connect-src 'none'`、`img-src data: blob:`） |
| D3 | 目录归档语义 | **动态前缀**：清单只记目录路径，rebuild 按前缀展开——后续新增文件自动纳入；取消归档整目录退出 |
| D4 | 编辑器树可见性 | **归档即隐藏对非 md 同样生效**（同 md 口径），目录骨架与未归档文件照常显示 |

## 1. 边界裁决（实现中确定，如有异议在评审时提出）

- **B1 — 目录归档覆盖 md 双态（2026-09-10 志岩改拍板）**：目录归档后，目录下**所有文件**（含 draft md、无 id 的普通 md）一律进知识库，目录状态**优先于** md 自身 frontmatter。具体口径：
  - covered md（路径被目录条目前缀命中）：索引条目 `status` 合成为 `'published'`（`publishedOnly`/图谱等下游按有效可见性消费）；草稿 md 放出，普通 md 以自动 id 收录（`auto:` + posix relPath，确定性可复现；按 path 去重，与 frontmatter 条目撞路径时 frontmatter 优先）。
  - 取消目录归档 → md 回落到自身 frontmatter 状态（draft 重新隐藏）。
  - 代价（已知并接受）：被目录放出的 draft md 在图谱中不再虚化（status 已合成为 published）；编辑器树草稿徽标同样消失（徽标取自图谱 status）。
- **B2 — 归档状态与 .ignore 的时序**：归档动作时校验拒绝；归档后外部新增 .ignore 规则 → 扫描层自然剪枝（读层隐藏），取消忽略后自动恢复。清单条目不删（与 categories 的读层隐藏策略同哲学）。
- **B3 — trash/外部删除**：清单条目不随删（trash 通道不感知清单），由 rebuild 对账 GC 清理（见 §5）。
- **B4 — 重名 id 冲突**：清单生成的 id 与 md frontmatter id 撞车 → md 优先（先扫 md），清单条目跳过并 warning。

## 2. 现状关键链路（改动锚点）

| 链路 | 位置 | 现状 |
|------|------|------|
| 归档 IPC | `electron/lib/workspaceManager.ts:814` `ws:setMdStatus` | 仅 md：改 frontmatter status，缺 id 注入；已有 `.ignore` 文件名守卫 |
| 归档入口 | `src/modules/editor/index.tsx:1317,1347,678` | 右键菜单仅 `.md` 且未归档；`togglePageStatus` |
| 树隐藏 | `src/modules/editor/components/FileTree.tsx:148` | `hiddenRelPaths.has(relPath)` **不区分扩展名**，非 md 免改 |
| 扫描器 | `electron/lib/kbStore/knowledgeIndex.ts:106` `scanMarkdownFiles` | 只收 `.md` + 根 `欢迎.html` |
| 索引缓存 | 同上 `:671` `getKnowledgeIndex` | `schemaVersion: 3`，进程内+磁盘两级 |
| kbview 协议 | `electron/lib/kbVisualProtocol.ts` | 白名单 ①AI教学产物根 ②根 `欢迎.html`；CSP `VISUAL_CSP` 已是断外联档 |
| 知识库渲染 | `src/modules/knowledge/index.tsx:1253` | `fileType==='html'` → `WelcomeHtmlView`（仅欢迎页走到） |
| 移动/改名 | `electron/lib/workspaceManager.ts:545` `renameWorkspacePath` | 成功后 `invalidateIndexIfCurrentVault`，无清单跟随 |
| 索引消费方 | `graphIndex.ts:69`、`builtinTools.ts:1023`、`knowledgeVaultRepo.ts` 多处 | 直接吃 `getKnowledgeIndex().pages` |

## 3. 数据模型：归档清单

新文件 `electron/lib/kbStore/archivedFilesRepo.ts`，落盘 `.knowbase/modules/knowledge/archived-files.json`（走 `jsonStore`，模块键 `modules/knowledge`）：

```jsonc
{
  "schemaVersion": 1,
  "entries": [
    { "id": "uuid", "path": "assets/specs", "type": "dir",  "archivedAt": "2026-09-10T…" },
    { "id": "uuid", "path": "assets/架构图.html", "type": "file", "archivedAt": "2026-09-10T…" }
  ]
}
```

API（全部主进程侧，写用 `writeJsonOrThrow`）：

```ts
readManifest(): ArchivedManifest
addArchiveEntry(rootId, relPath, type): { id }        // 重复归档幂等（已有同 path 条目直接返回）
removeArchiveEntry(rootId, relPath): void             // 文件精确删；目录条目删目录（子文件条目若独立存在保留）
renameArchiveEntries(rootId, oldRel, newRel): void    // renameWorkspacePath 挂钩：文件精确匹配 + 目录前缀级联
gcArchiveEntries(validPaths): string[]                // rebuild 对账：磁盘已消失的 file 条目删除；dir 条目目录不存在也删
isArchivedNonMd(manifest, relPath): boolean           // 精确 file 命中 || 任一 dir 前缀命中（动态前缀，D3）
```

- path 一律 posix 相对路径（与索引口径一致）。
- 归档前校验（`addArchiveEntry` 内）：`getVaultIgnore()` 的 `ign.ignores(rel)` / `isDirIgnored(ign, rel)` 拒绝；系统区拒绝（`.` 开头段、`_inbox` 任意深度、`_attachments`、`.knowbase` 自身、嵌套 `.knowbase`、符号链接）；`.ignore` 文件本身拒绝；仓库根目录拒绝；目录归档递归校验（任一子路径命中规则 → 整体拒绝并指明冲突路径）。

## 4. 主进程改动

### 4.1 统一归档 IPC

`workspaceManager.ts` 新增 `ws:setArchiveStatus(rootId, relPath, archive: boolean)`：

- `.md`（大小写不敏感）→ 复用现有 frontmatter 流程（抽出 `ws:setMdStatus` handler 主体为函数 `setMdStatusImpl`，两通道共用）。
- 非 md / 目录 → `addArchiveEntry` / `removeArchiveEntry`。
- 成功后：`invalidateIndexIfCurrentVault(rootId)` + `windowBus.broadcastDataChanged('knowledge')`（铁律：主进程写操作必须广播，保活的知识库模块才能重读）。
- 旧 `ws:setMdStatus` 保留（AI 工具/历史调用兼容），内部同函数。

### 4.2 rename 跟随

`renameWorkspacePath`（`:545`）成功 rename 后调用 `renameArchiveEntries(rootId, oldRel, newRel)`——文件条目精确改 path；目录条目前缀级联（`oldRel/` → `newRel/`）。清单变动已在 `invalidateIndexIfCurrentVault` 覆盖内。

### 4.3 kbview 白名单扩展（D2）

`kbVisualProtocol.ts` 新增白名单入口 **③ 归档 html**：

- 判定：`rel` 以 `.html?` 结尾 && `isArchivedNonMd(readManifest(), rel)`（主进程直读清单，零额外 IPC）。欢迎页分支（②）在其前，优先级不变。
- 返回：**整页原样**（同欢迎页，不注入 AI 工件的居中量高壳）+ `stripCspMeta` + `VISUAL_CSP`（已是 `connect-src 'none'; img-src data: blob:` 断外联档）+ 2MB 上限（`MAX_VISUAL_BYTES`）。
- 非 html 归档文件**不**经 kbview（协议本就只放行 `.html?`）。

## 5. 索引扩展（knowledgeIndex.ts）

1. `scanMarkdownFiles` → 改名 `scanVaultFiles`：文件判定从「`.md` 或根欢迎页」放宽为**全部常规文件**（目录剪枝、系统区、`.ignore`、符号链接逻辑原样保留；audit 对账口径同步放宽为全文件）。
2. `rebuildKnowledgeIndex`：
   - 读清单 → `isArchivedNonMd` 判定；md 仍由 `frontmatter.id` 判定（双通道）。
   - **非 md 条目合成**：`id`=清单 id；`title`=文件名去扩展名；`fileType`=扩展名（小写）；`status:'published'`；`tags/starring/sortOrder` 走缺省；`outgoingTitles:[]`；`entryKind:'file'`。
   - `KnowledgePageIndexEntry` 增加可选字段 `entryKind?: 'doc' | 'file'`（缺省 doc，向后兼容）；`schemaVersion: 3 → 4`（强制缓存重建）。
   - **目录即分类不变**：非 md 归档文件所在目录照常进 `ensureDirCategories`，自动归入分类树。
   - **GC（B3）**：收集本次扫描到的全量相对路径，`gcArchiveEntries` 清理消失条目；有清理则 warning 提示数量。
   - 正文文本索引 `textById`：`entryKind==='file'` 不写入（搜索层按标题匹配，见 §6）。
3. 欢迎页合成逻辑原样保留（不走清单）。

## 6. 下游消费方隔离

| 消费方 | 改动 |
|--------|------|
| `knowledgeVaultRepo.vaultSearchPages` | 非 md 条目参与**标题/文件名**匹配；正文索引缺失时不崩（现有实现需确认 fallback，`getKnowledgeTextIndex` 懒重建会对 `entryKind==='file'` 跳过读盘） |
| `graphIndex.ts` | `pages.filter(p => p.entryKind !== 'file')` 后再建图（图谱只有 md 与目录） |
| `builtinTools.ts:1023`（AI 检索） | 同上过滤：非 md 文件不进 AI 检索视野 |
| quiz / 反链 | 非md 无正文无出链，天然不参与；quiz 取页处补同样过滤兜底 |
| `publishedOnly` | 无需改（非 md 合成即 published） |

## 7. 渲染层（知识库模块）

1. **阅读分支**（`index.tsx:1253`）改三分：
   - `entryKind==='file' && fileType==='html'` → 新组件 `ArchivedHtmlView`（iframe `sandbox="allow-scripts"` + `src={kbview://vault/<encoded rel>}`，主题 postMessage 复用 `WelcomeHtmlView` 的既有机制；欢迎页仍走原分支）。
   - `entryKind==='file'`（其余类型）→ 新组件 `FileMetaCard`：FileIcon + 文件名 + 扩展 badge（`getFileTypeInfo`）+ 大小/修改时间/所在分类 + 按钮「在编辑器打开」→ 派发 `kb-open-in-editor` CustomEvent(relPath)（跳转闭环已有）。
   - md → 原渲染不动。
2. 列表/笔记本/章节/页签：`FileIcon`/`getFileTypeInfo` 已全类型，免改；`entryKind==='file'` 的条目不显示「沉浸阅读」类 md 专属动作。
3. 知识库移动守卫（`:810` 欢迎页不能移动）保留；归档文件的移动本就发生在编辑器树（未归档可见）/文件操作，rename 跟随已覆盖。

## 8. 编辑器模块

1. `refreshArchived`（`:660`）：`getKnowledgePages()` 返回集合自动含非 md 归档条目 → `archivedPaths` 扩大 → `FileTree` 隐藏免改（锚点见 §2）。
2. 右键菜单（`:1317` 文件 / `:1347` tab）：
   - 文件节点去掉 `.endsWith('.md')` 限定；已归档（`archivedPaths.has`）显示「取消归档」，未归档显示「归档为知识页」。
   - 目录节点新增「归档整个目录 / 取消目录归档」；确认弹窗提示：目录下 N 个文件将进入知识库（含 draft md，目录状态优先，B1）；若校验会失败（.ignore/系统区）入口直接隐藏或点击后 toast 具体原因。
3. `togglePageStatus`（`:678`）→ 改调 `ws:setArchiveStatus`；`.md` 判定移到主进程内部分流，渲染层无感。
4. 归档成功后 toast 文案区分：文件 / 目录（「已归档目录：N 个文件可在知识库查看」）。

## 9. 实施顺序（每步可独立验收）

| Phase | 内容 | 验收 |
|-------|------|------|
| P1 | `archivedFilesRepo.ts` + `ws:setArchiveStatus` + rename 跟随 + 广播 | 主进程单测手验：归档/取消/移动后清单正确；`.ignore` 路径拒绝 |
| P2 | 索引扩展（扫描放宽 + 清单合并 + entryKind + schema bump + GC） | 归档的非 md 出现在 `getKnowledgeIndex().pages`；图谱/AI 检索无非 md 节点 |
| P3 | 编辑器入口（右键全类型 + 目录归档 + toast） | 树内右键任意文件/目录归档 → 知识库可见；树内隐藏；移动后状态跟随 |
| P4 | 知识库展示（FileMetaCard + ArchivedHtmlView + 下游过滤） | 元信息卡展示与跳编辑器闭环；html 沙箱渲染且外联被断 |
| P5 | 收尾：搜索标题匹配、quiz 过滤兜底、`tsc` 双门禁清零 | 见下 |

## 10. 验证清单

- `tsc --noEmit -p tsconfig.node.json` / `-p tsconfig.web.json` 双门禁零新增错误。
- **主进程改动必须重启 dev 验收**（热重载失效铁律）。
- 手工路径：① 归档 `assets/xx.png` → 知识库元信息卡 → 跳编辑器；② 归档含 draft md 的目录 → draft 页**不**出现（B1）；③ 目录归档后往目录新增 txt → 重启/失效后自动出现；④ 归档 html → 渲染但 fetch 外网被 CSP 拦（DevTools console 可见）；⑤ 移动归档目录 → 知识库状态跟随；⑥ 外部删除归档文件 → rebuild 后清单 GC + warning；⑦ `.ignore` 命中路径右键归档 → 拒绝 toast；⑧ 欢迎页回归：渲染/收藏/移动守卫不回归。
- 安全复核：kbview 白名单 ③ 仅放行**清单内** html；sandbox 无 `allow-same-origin`；响应头 CSP 不放松。
