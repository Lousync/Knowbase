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
