# 开发者指南

## 帮助文档系统

所有帮助文档以 **Markdown + YAML frontmatter** 格式存放在 `src/modules/help/docs/` 目录下。

`import.meta.glob` 自动扫描 `*.md` 文件，无需手动注册路由或修改任何 JS/TS 代码。

---

### 添加新文档只需 3 步

**第 1 步**：在 `src/modules/help/docs/` 下新建 `.md` 文件（文件名即文档 id）

**第 2 步**：在文件顶部写 YAML frontmatter：

```yaml
---
title: 功能名称        # 左侧导航和内容区标题
category: 操作指南     # 分类名，相同 category 自动归入同一组
icon: BookOpen        # lucide-react 图标组件名（PascalCase）
---
```

**第 3 步**：写正文（标准 Markdown，支持标题/表格/代码块/列表等）

---

### frontmatter 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | ✅ | 左侧导航和内容区顶部显示的标题 |
| `category` | ✅ | 任意字符串，相同值的文档归入同一分组 |
| `icon` | ✅ | lucide-react 图标组件名（PascalCase），如 `Keyboard`、`FileText`、`AlertTriangle` |

---

### 图标参考

```
Keyboard       → ⌨  键盘
Tag            → 🏷  标签
FileText       → 📄  文件
Calendar       → 📅  日历
Smile          → 😄  表情
AlertTriangle  → ⚠   警告
Info           → ℹ   信息
BookOpen       → 📖  打开的书
Wrench         → 🔧  工具
```

> 完整列表见 [lucide.dev/icons](https://lucide.dev/icons)

---

### 快捷 Toast → 帮助文档关联

在代码中触发 Toast 通知时，`detail` 字段填文档 id：

```ts
import { showToast } from '@/lib/toast'

showToast({
  type: 'warning',
  message: '日期太早，暂不支持此日期之前的日志补写。',
  detail: 'shortcuts',  // ← 对应 docs/shortcuts.md
})
```

用户点击 Toast 上的「查看详情」→ 自动跳转到帮助模块的对应文档。

---

### 当前文档列表

```
src/modules/help/docs/
├── shortcuts.md       # 键盘快捷键 — 完整快捷键速查表
├── blog-tags.md       # 博客标签 — 创建/删除/展示规则
├── moods.md           # 心情状态 — Emoji 对照表
├── blog-writing.md    # 博客写作 — 创建/编辑/日期限制
├── date-search.md     # 日期搜索 — 搜索框格式语法
└── troubleshoot.md    # 常见问题 — FAQ
```
