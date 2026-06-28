# 更新日志

## v1.7.0

### ✨ 新增功能

- **知识库搜索栏**：顶栏居中搜索框，类似 VS Code 风格。支持 Ctrl+P 快捷键唤出，实时模糊匹配——输入关键词同时搜索页面标题、目录名、笔记本名和标签名。搜索结果下拉面板用 ↑↓ 选择、Enter 打开、Esc 关闭。匹配到页面直接打开，匹配到目录/笔记本自动在资源管理器树中展开定位，匹配到标签可展开查看该标签下的所有页面
- **页面标签系统**：页面编辑器工具栏下方新增标签栏，可为页面添加/删除彩色标签（最多 5 个），标签随自动保存持久化
- **右键菜单增强**：文件和目录的右键菜单新增"重命名"和"删除"按钮，"删除"以红色标注。粘贴按钮在剪贴板为空时显示为灰色不可点击状态

### 🐛 Bug 修复

- **同类型文件图标不一致**：手动创建的页面与导入的同类型文件显示不同图标（如 `.cpp` 和空文件类型），现已统一规范化

### 🔧 功能优化

- **右键菜单复制/剪切/粘贴**：知识库内支持复制、剪切页面或目录，在空白处或目标目录上粘贴。复制创建副本，剪切则移动到新位置。剪切中的项目半透明显示。支持 Ctrl+C/X/V 快捷键

## v1.6.1-programmer.1

### 🐛 Bug 修复

- **知识库页面/分类拖拽移动后 sort_order 不重置**：移动页面或分类到新父级时，`sort_order` 保留原值导致位置不可预期。数据库层 `updatePage`/`updateCategory` 现在检测到 `categoryId`/`parentId` 变化时自动将 `sort_order` 置为 `MAX+1`（追加到末尾）
- **ChapterPanel 页面列表不支持拖拽排序**：章节内的页面只能通过上/下箭头按钮逐位移动，现在支持拖拽到目标页面的上半部分（插入之前）或下半部分（插入之后），新增 `knowledge:reorderPage` IPC handler 按索引精确重排
- **拖拽页面到笔记本时使用过期分类数据**：`handleDropOnNotebook` 从组件闭包读取 `categories` 可能已过期，改用 `getKnowledgeCategories()` 实时获取最新数据

### ✨ 功能优化

- **分类拖拽互操作（3种）**：① 目录可拖入另一目录成为子目录；② 无子目录的文件夹可拖入笔记本成为章节；③ 笔记本可拖入目录成为子节点。ChapterPanel（第二侧边栏）章节行支持接受分类拖放，页面区域空处支持分类拖放（变为笔记本章节）
- **分类拖拽/右键移动彻底修复**：三个根因——① `onDragOver` 依赖 `dataTransfer.getData()`，Chromium 安全策略在 dragover 中可能返回空→改用 `useRef` 在 dragStart 时记录拖曳数据；② 循环检测方向相反：`isDescendant(target, dragged)` 应改为 `isDescendant(dragged, target)` 防止父目录拖入子目录；③ 移动成功后目标父目录未展开→目录"消失"→现在自动展开
- **修复展开目录的拖放盲区**：之前展开目录的子内容区域（子页面+子分类占大面积）缺少 `onDragOver`/`onDrop`，拖放入此区域被静默吞掉。现在展开容器承接所有拖放事件并 delegate 到父分类，树容器 fallback 也改为主动 delegate
- **博客模块 Markdown 大纲**：OutlinePanel + parseHeadings 从 knowledge 移到 `shared/components/`，博客编辑器新增大纲切换按钮（工具栏 `ListTree` 图标），Ctrl+O 快捷键，点击大纲标题跳转到对应行

## v1.6.0-programmer.1

### 🐛 Bug 修复

- **零碎任务不再出现在四象限图中**：`daily` 任务（零碎任务）无象限属性，从 `QuadrantChart` 传入数据中过滤掉，避免其随机落入某个象限格
- **博客阅读模式长文章可滚动**：`<main>` 容器缺少 `flex flex-col` 导致子元素 `EntryDetail` 的 `flex-1 overflow-y-auto` 无高度参照，现已修复

### ✨ 功能优化

- **知识库大纲实时跟随编辑器内容**：大纲面板不再等待自动保存（2s 防抖），而是在 Monaco 编辑器每次输入时即时刷新标题层级树
- **大纲按钮整合至编辑器工具栏**：零散页面（非笔记本页面）没有第二侧边栏也能点击编辑器顶部工具栏的 `<ListTree>` 按钮唤出大纲面板。第二侧边栏的原大纲按钮已移除，避免重复入口
- **大纲面板空白保护**：切换页面时重置实时内容缓存，避免短暂闪现上一页的大纲数据
- **知识库跨模块页面保活**：从知识库切换到其他模块后再返回，已打开的页面和编辑器状态不再丢失。所有 Tab 模块首次挂载后保持常驻，通过 `display:none` 隐藏而非销毁
- **折叠侧边栏拖拽拉出**：侧边栏折叠后，鼠标悬停边缘显示蓝色分割条（`var(--accent)`），拖拽超过 `minWidth/2` 即可重新拉出侧边栏。行为对标 VS Code 的侧边栏折叠/展开交互

### 📝 技术细节

| 文件 | 改动 |
|------|------|
| `src/modules/schedule/index.tsx` | `QuadrantChart` 接收 `pendingTodos.filter(t => t.taskType !== 'daily')` |
| `src/modules/blog/index.tsx` | `<main className="flex-1 overflow-hidden">` → `flex flex-col` |
| `src/modules/knowledge/index.tsx` | 新增 `liveContent` 状态 + `outlineHeadings` 使用实时内容；`PageEditor` 传入 `onContentChange`/`onToggleOutline` |
| `src/modules/knowledge/components/PageEditor.tsx` | 新增 `onContentChange` / `onToggleOutline` prop；Monaco `onChange` 回调；工具栏加大纲按钮 |
| `src/modules/knowledge/components/ChapterPanel.tsx` | 移除第二侧边栏大纲按钮、`ListTree` 图标导入、`onToggleOutline` prop |
| `src/App.tsx` | 新增 `mountedTabs` ref + `renderTab()` 辅助函数，所有 Tab 模块首次访问后保持挂载（`display:none` 隐藏而非销毁）；`main` 加 `flex flex-col`；传递 `onSnapOpenSidebar` |
| `src/components/shared/ResizablePanel.tsx` | 新增 `onSnapOpen` prop + 折叠边缘分割条：`visible=false` 时显示 4px 蓝色悬停边缘，拖拽超 `minWidth/2` 触发 `onSnapOpen` |
| `src/modules/knowledge/components/ChapterPanel.tsx` | 移除第二侧边栏大纲按钮、`ListTree`、`onToggleOutline` prop |
| `src/modules/blog/index.tsx` | 新增 `onSnapOpenSidebar` prop → `ResizablePanel` |
| `src/modules/schedule/index.tsx` | 同上 |
| `src/modules/knowledge/index.tsx` | 同上；L1 `onSnapOpen` 同时恢复 `showCategoryPanel` + `onSnapOpenSidebar`；L2 `onSnapOpen` 仅在有选中笔记本时启用 |
| `CHANGELOG.md` | 新建（不纳入 git 跟踪，仅用于 GitHub Release 发布） |
