# KnowledgeRecorder

本地 Windows 桌面应用，纯本地运行，无需网络/服务器。顶部 Tab 页签切换四个独立模块。

---

## 功能模块

| 模块 | Tab 标签 | 功能描述 |
|------|----------|----------|
| 📝 博客/日记 | `博客` | Markdown 写作、标签分类、日历筛选、全文搜索 |
| 📅 日程/待办 | `日程` | 日历视图、待办列表、优先级、完成状态 |
| 📚 个人知识库 | `知识库` | 分类树、Wiki 风格页面、Markdown 编辑 |
| 💾 数据导出 | `导出` | 一键导出全部模块数据（JSON/Markdown/ZIP），支持增量备份 |

各模块数据完全独立，通过表名前缀区分（`blog_` / `schedule_` / `knowledge_`）。

## 技术栈

| 层级 | 选型 | 版本 |
|------|------|------|
| 桌面框架 | Electron | ^33.2.0 |
| 前端框架 | React + TypeScript | ^19.0 / ^5.7 |
| 构建工具 | electron-vite | ^5.0 |
| UI 样式 | TailwindCSS | ^4.0 |
| 数据库 | sql.js (SQLite WASM) | ^1.12 |
| 图标 | lucide-react | ^1.0 |
| 打包 | electron-builder | ^26.0 |

> **为什么用 sql.js 而不是 better-sqlite3？**
> better-sqlite3 需要原生编译，与高版本 Electron 的 V8 ABI 容易不兼容。
> sql.js 是纯 JavaScript（WASM），无需原生模块，跨平台零摩擦。
> 代价：需要手动调用 `saveToDisk()` 持久化数据。

---

## 项目结构

```
KnowledgeRecorder/
├── electron/                          # Electron 主进程
│   ├── main/index.ts                  # 窗口管理（frameless + 自定义标题栏）
│   ├── preload/index.ts               # IPC 桥接（contextBridge）
│   └── database/
│       ├── connection.ts              # sql.js 初始化 + 迁移调度 + 持久化
│       ├── migrations/                # 各模块迁移脚本
│       │   ├── 001_blog.ts
│       │   ├── 002_schedule.ts
│       │   ├── 003_knowledge.ts
│       │   └── 004_export.ts
│       └── repositories/              # 数据访问层
│           ├── blog/                  # 博客模块
│           ├── schedule/              # 日程模块
│           ├── knowledge/             # 知识库模块
│           └── export/                # 导出模块
│
├── src/                               # React 渲染进程
│   ├── main.tsx                       # React 入口
│   ├── App.tsx                        # TabBar + 模块路由
│   ├── modules/                       # 业务模块（每个独立闭环）
│   │   ├── blog/                      # 博客模块
│   │   │   ├── index.ts              # 模块导出
│   │   │   ├── types.ts             # 博客类型定义
│   │   │   ├── BlogLayout.tsx       # 模块壳（侧边栏+列表+内容区）
│   │   │   ├── views/               # 视图级组件
│   │   │   │   ├── EntryListView.tsx
│   │   │   │   ├── EntryEditView.tsx
│   │   │   │   └── EntryDetailView.tsx
│   │   │   └── components/          # 模块内组件
│   │   │       ├── EntryCard.tsx
│   │   │       ├── MarkdownEditor.tsx
│   │   │       └── CalendarWidget.tsx
│   │   ├── schedule/                  # 日程模块
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── ScheduleLayout.tsx
│   │   │   ├── views/
│   │   │   │   ├── CalendarView.tsx
│   │   │   │   └── TodoListView.tsx
│   │   │   └── components/
│   │   │       ├── TodoItem.tsx
│   │   │       └── DayCell.tsx
│   │   └── knowledge/                 # 知识库模块
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── KnowledgeLayout.tsx
│   │       ├── views/
│   │       │   ├── WorkspaceView.tsx
│   │       │   └── PageEditView.tsx
│   │       └── components/
│   │           ├── CategoryTree.tsx
│   │           └── KnowledgeCard.tsx
│   │   └── export/                     # 数据导出模块
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── ExportLayout.tsx
│   │       ├── views/
│   │       │   └── ExportView.tsx     # 导出主界面
│   │       └── components/
│   │           ├── ExportOptionCard.tsx # 格式选择卡片
│   │           ├── ExportProgress.tsx  # 进度条
│   │           └── BackupHistory.tsx   # 历史备份列表
│   └── shared/                       # 跨模块共享
│       ├── components/               # 通用组件
│       │   ├── TitleBar.tsx          # VS Code 风格自定义标题栏（window controls）
│       │   ├── StatusBar.tsx         # 底部状态栏（日期/字数/格式/保存状态）
│       │   ├── TabBar.tsx            # 模块切换 Tab
│       │   ├── SearchBar.tsx
│       │   ├── TagBadge.tsx
│       │   └── EmptyState.tsx
│       ├── hooks/                    # 通用 Hooks
│       │   ├── useDatabase.ts
│       │   └── useDebounce.ts
│       ├── lib/                      # 工具函数
│       │   └── ipc.ts               # 统一 IPC 调用封装
│       ├── types/                    # 全局类型声明
│       │   └── global.ts
│       └── styles/                   # 全局样式
│           └── index.css
│
├── index.html                         # HTML 入口
├── package.json                       # 含 electron-builder 打包配置
├── electron.vite.config.ts            # electron-vite 构建配置
├── tsconfig.json / .node / .web       # TypeScript 配置
└── .gitignore
```

---

## App 主结构（VS Code 风格布局）

```
┌──────────────────────────────────────────────────────────────┐
│  📝 KnowledgeRecorder                         ─   □   ✕     │ ← 自定义标题栏
├──────────────────────────────────────────────────────────────┤
│  📝 博客  │  📅 日程  │  📚 知识库  │  💾 导出              │ ← TabBar
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    模块内容区域                               │
│              （每个模块独立的三栏布局）                         │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  📝 120 字 │ 📅 2026-06-11 │ Markdown │ UTF-8 │ 💾 已保存   │ ← 状态栏
└──────────────────────────────────────────────────────────────┘
```

**VS Code 风格的三个关键点**：
- **无边框窗口**：`frame: false`，完全自定义标题栏
- **拖拽区域**：标题栏用 `-webkit-app-region: drag` 实现窗口拖动
- **自绘窗口按钮**：最小化/最大化/关闭三个按钮用 HTML 绘制，调用 Electron API

```tsx
// App.tsx
function App() {
  const [activeTab, setActiveTab] = useState<TabName>('blog')

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] text-[#cccccc]">
      {/* 自定义标题栏 — VS Code 风格 */}
      <TitleBar />
      {/* 模块 TabBar */}
      <TabBar active={activeTab} onChange={setActiveTab} />
      {/* 主内容 */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'blog'      && <BlogModule />}
        {activeTab === 'schedule'  && <ScheduleModule />}
        {activeTab === 'knowledge' && <KnowledgeModule />}
        {activeTab === 'export'    && <ExportModule />}
      </main>
      {/* 底部状态栏 */}
      <StatusBar />
    </div>
  )
}
```

---

## 数据库设计

每个模块独立表集合，表名前缀隔离：

```sql
-- ===== 博客模块 =====
CREATE TABLE blog_entries (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    content_md  TEXT NOT NULL DEFAULT '',
    content_html TEXT DEFAULT '',
    date        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    is_pinned   INTEGER DEFAULT 0,
    word_count  INTEGER DEFAULT 0
);
CREATE TABLE blog_tags (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#6b7280'
);
CREATE TABLE blog_entry_tags (
    entry_id TEXT REFERENCES blog_entries(id) ON DELETE CASCADE,
    tag_id   TEXT REFERENCES blog_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, tag_id)
);
CREATE VIRTUAL TABLE blog_fts USING fts5(title, content_md, content='blog_entries', content_rowid='rowid');

-- ===== 日程模块 =====
CREATE TABLE schedule_todos (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    date        TEXT NOT NULL,
    time        TEXT,
    priority    INTEGER DEFAULT 0,       -- 0=低 1=中 2=高
    status      TEXT DEFAULT 'pending',   -- pending/done/cancelled
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== 知识库模块 =====
CREATE TABLE knowledge_categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   TEXT REFERENCES knowledge_categories(id),
    sort_order  INTEGER DEFAULT 0
);
CREATE TABLE knowledge_pages (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content_md  TEXT NOT NULL DEFAULT '',
    content_html TEXT DEFAULT '',
    category_id TEXT REFERENCES knowledge_categories(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE knowledge_fts USING fts5(title, content_md, content='knowledge_pages', content_rowid='rowid');

-- ===== 数据导出模块 =====
CREATE TABLE export_backups (
    id          TEXT PRIMARY KEY,
    path        TEXT NOT NULL,             -- 导出文件路径
    format      TEXT NOT NULL,             -- json / markdown / zip
    size_bytes  INTEGER,                   -- 文件大小
    modules     TEXT NOT NULL,             -- 包含的模块,逗号分隔: "blog,schedule,knowledge"
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 开发路线

### 第一阶段：多模块架构重构 + VS Code 风格 UI（当前）
- [ ] Electron frameless 窗口（`frame: false`）
- [ ] 自定义 TitleBar 组件（window controls + 拖拽）
- [ ] 底部 StatusBar 组件
- [ ] VS Code 深色主题基础配色
- [ ] 整理目录结构为 modules/ + shared/ 模式
- [ ] 实现顶部 TabBar 模块切换导航
- [ ] 四个模块占位壳组件
- [ ] 数据库迁移调度器改造
- [ ] 把现有博客代码迁移到 modules/blog/

### 第二阶段：博客模块完善
- [ ] 表名改为 blog_ 前缀
- [ ] 博客模块内三栏布局重构
- [ ] Markdown 编辑器集成（Milkdown — Typora 风格）
- [ ] 标签管理完善

### 第三阶段：日程模块
- [ ] schedule_todos 表 + Repository
- [ ] 日历视图 + 待办列表
- [ ] 增删改 + 状态切换 + 优先级

### 第四阶段：知识库模块
- [ ] knowledge 表 + Repository
- [ ] 分类树组件 + 页面编辑器
- [ ] Wiki 风格浏览

### 第五阶段：数据导出模块
- [ ] export_backups 表 + Repository
- [ ] 选择导出模块（可多选博客/日程/知识库）
- [ ] 导出格式：JSON（结构化数据）/ Markdown（可读文档）/ ZIP（打包附件）
- [ ] 一键导出到指定目录
- [ ] 导出进度显示 + 历史备份列表
- [ ] 从备份 JSON 导入恢复数据（可选）

### 第六阶段：体验优化 & 打包
- [ ] 全局搜索、快捷键、主题切换
- [ ] electron-builder 打包 exe

---

## 体感标准：对标 VS Code

本项目的用户交互体验以 **VS Code** 为参照。VS Code 同样基于 Electron + Chromium，但通过近十年的持续优化达到了流畅、轻快、启动快的体感。我们在日常开发中需持续向这个方向逼近。

### 核心原则

1. **即时反馈**：任何用户操作必须在 100ms 内给出视觉回应（hover 变色、按钮按下、加载骨架屏），不允许"点了没反应"
2. **不卡主线程**：耗时操作（数据库写入、Markdown 渲染）必须异步，不阻塞 UI
3. **操作可逆**：删除、移动等破坏性操作应尽量可撤销，或给出明确的确认提示
4. **减少认知负荷**：界面元素要克制，不需要的信息不要显示（已删除的蓝色状态栏就是例子）
5. **快捷键优先**：高频操作提供键盘快捷键（如 Ctrl+S 保存、Ctrl+/ 预览），减少鼠标依赖

### 响应速度目标

| 操作 | 目标延迟 | 说明 |
|------|---------|------|
| 面板折叠/展开 | <50ms | 纯 CSS/state 切换，不能有动画延迟 |
| 页面列表加载 | <200ms | 含 IPC + 数据库查询，超过需加骨架屏 |
| 页面切换 | <100ms | 切换不同页面时编辑器内容刷新 |
| 自动保存 | 2s 防抖 | 不丢数据的前提下减少写盘频率 |
| 搜索过滤 | <100ms | 本地搜索，即时过滤 |
| 应用冷启动 | <2s | 含 Electron 启动 + 数据库初始化 |

### 已采用的具体措施

- **面板折叠按钮**：每个侧栏独立的折叠按钮（`◀` `▶`），尺寸 >= 16px，有 hover 背景色反馈
- **全局侧栏折叠**：点击 ActivityBar 图标可一次性折叠/展开所有侧栏，与其他模块行为一致
- **编辑器清理**：删除底部蓝色状态栏（字数/快捷键提示），通过工具栏保存指示器（●/✓）替代，减少视觉噪音
- **新建按钮上移**：新建页面的按钮放在列表顶部而非底部，减少滚动操作
- **自动保存指示**：工具栏保存状态用圆点颜色表示（黄色=未保存，绿色=已保存），直观不占地

### 后续优化方向

- [ ] 编辑器升级：用 CodeMirror 或 Monaco 替换 `<textarea>`，大文档编辑体验提升明显
- [ ] 虚拟滚动：页面列表超过 50 条时启用虚拟滚动
- [ ] 搜索防抖：输入搜索关键词时 150ms 防抖，避免逐字触发 IPC
- [ ] 冷启动优化：数据库初始化异步化，先显示 UI 再加载数据
- [ ] 操作反馈：删除/移动操作加入微动画，确认操作有明确视觉过渡
- [ ] 快捷键体系：Ctrl+K 知识库、Ctrl+B 博客、Ctrl+D 日程的统一快捷键

---

## 编码规范

- TypeScript 严格模式
- React 函数组件 + Hooks，无 class 组件
- 模块代码隔离：每个模块放在 `src/modules/<name>/`，不得跨模块直接引用
- 跨模块公共代码放在 `src/shared/`
- IPC 通信：主进程逻辑在 `electron/`，渲染进程通过 `src/shared/lib/ipc.ts` 调用
- 数据库修改后必须调用 `saveToDisk()` 持久化
- 表名统一用模块前缀：`blog_` / `schedule_` / `knowledge_` / `export_`
- TailwindCSS 原子类优先，模块特有样式可写在模块目录的 `.css` 文件中

## 注意事项

1. **sql.js 持久化**：每个写操作后必须调用 `saveToDisk()`，否则进程退出数据丢失
2. **Electron 版本**：保持在 33.x，不要随意升级避免兼容问题
3. **不开 sandbox**：`sandbox: false` 因为 preload 需要访问 Node.js API
4. **CSP 策略**：`index.html` 限制了脚本/样式/图片来源，如需加载外部资源需修改 CSP
5. **ELECTRON_RUN_AS_NODE 环境变量**：Windows 系统环境变量中若存在此变量，需删除。它会导致 Electron 以纯 Node.js 模式运行，无法启动桌面窗口
6. **避免 C 盘用户目录**：用户目录路径含中文可能引发问题，项目放非 C 盘路径
7. **项目计划文件**：所有实现方案 Plan 文件统一放在 `.claude/plans/` 目录中

---

## 已解决：界面缩放（Ctrl+= / Ctrl+-）

### 需求
- Ctrl+= 放大内容区文字（只缩放博客内容/编辑器，不缩放 TitleBar/ActivityBar/StatusBar）
- Ctrl+- 缩小内容区文字
- 有上下限（约 0.7x ~ 2.0x）
- 缩放值持久化到 settings.json

### 已尝试但失败的方法

**方法 1：Electron `webFrame.setZoomLevel()`**
- 文件：`electron/preload/index.ts` / `electron/main/index.ts`
- 问题：ZoomLevel 会缩放整个 Electron 窗口的全部内容，包括 TitleBar、ActivityBar、StatusBar 等 chrome，不符合预期。而且 `Ctrl+=` 键盘事件在某些键盘布局下不触发。

**方法 2：React 控制 `<main>` 的 `fontSize`**
- 文件：`src/App.tsx`（设定 `style={{ fontSize: zoom + 'px' }}` 在 `<main>` 上）
- 问题：不生效。TailwindCSS 使用 `rem` 单位，`rem` 相对于 `<html>` 根元素的 `font-size`，而不是 `<main>` 的。大多数元素尺寸不受 `<main>` 的 `fontSize` 影响。

**方法 3：CSS `transform: scale()`**
- 文件：`src/App.tsx`（当前代码）
- 实现：
  ```tsx
  <main className="flex-1 overflow-hidden relative bg-[#1e1e1e]">
     <div style={{
       transform: `scale(${zoom})`,
       transformOrigin: 'top left',
       width: `${(1 / zoom) * 100}%`,
       height: `${(1 / zoom) * 100}%`
     }}>
       {activeTab === 'blog' && <BlogModule ... />}
      ...
     </div>
   </main>
  ```
- 问题：
  1. CSS transform scale 是视觉缩放，不改变元素的实际布局尺寸。导致缩小时周围出现大片空白，放大时内容溢出被裁剪。
  2. `width: ${(1/zoom)*100}%` 的逆向补偿计算不精确，且无法正确处理 flex 布局的子元素。
  3. `overflow: hidden` 的父容器与 scaled 子元素之间的交互导致滚动条行为异常。

### 影响范围
- `src/App.tsx` — 缩放状态 + 键盘事件
- `src/components/shared/TitleBar.tsx` — "重置缩放"菜单项调用 `zoomReset()`
- `electron/main/index.ts` — 有 `zoom:in`/`zoom:out`/`zoom:reset` IPC handler（现在闲置）
- `electron/preload/index.ts` — 已移除 zoom API
- `src/types/index.ts` / `src/lib/ipc.ts` — 已移除 zoom 类型和函数

### 可能的正确方向
1. **用 CSS 变量 + `rem`**：`document.documentElement.style.fontSize = zoom + 'px'`，这样所有 rem 单位都会跟着变。TitleBar/ActivityBar/StatusBar 用 px 写死，不参与缩放。
2. **Electron `webFrame.setZoomFactor()`**（Chromium API）vs `setZoomLevel()`：`setZoomFactor` 可能行为不同，但同样会缩 chrome。
3. **MVVM 方式**：每个内容组件的顶层 `style={{ fontSize: zoom + 'px' }}` + 全部子元素用 `em` 单位（工作量大，不现实）。

### 验证方式
- 启动 `node scripts/launch.js start`
- 按 Ctrl+= 看内容区是否放大
- 按 Ctrl+- 看内容区是否缩小
- 确认 TitleBar/ActivityBar/StatusBar 不变
- 确认缩放后滚动条、列表、编辑器正常工作
