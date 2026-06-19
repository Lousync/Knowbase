# Knowbase

Windows 桌面端知识日程管理工具，纯本地运行，对标 VS Code 体验。

## 功能模块

| 模块 | 说明 |
|------|------|
| 📝 博客 | 每日一篇，Markdown 写作，标签分类，日历筛选，全文搜索 |
| 📅 日程 | 日历视图，待办列表，四象限优先级，子任务，截止日期 |
| 📚 知识库 | 分类树 + 笔记本，Wiki 风格页面，Markdown 编辑，附件导入 |
| 🧰 工具箱 | 强密码生成器、番茄钟、AI 助手等内嵌实用工具 |
| 💾 导出 | 一键导出全部模块数据（JSON / Markdown / ZIP），增量备份 |
| 🗑️ 回收站 | 软删除，可恢复，30 天自动清理 |
| ⚙️ 设置 | 主题切换、字体、编码、AI 服务配置等 |

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面框架 | Electron | ^33.2.0 | 无边框窗口 + 自定义标题栏 |
| 前端框架 | React + TypeScript | ^19.0 / ^5.7 | 函数组件 + Hooks，严格模式 |
| 构建工具 | electron-vite | ^5.0 | 主进程 / preload / 渲染进程统一构建 |
| UI 样式 | TailwindCSS | ^4.0 | 原子化 CSS，深色/浅色双主题 |
| 数据库 | sql.js (SQLite WASM) | ^1.12 | 纯 JS，零原生依赖 |
| 编辑器 | Monaco Editor | ^0.55 | VS Code 同款内核 |
| Markdown 渲染 | react-markdown + rehype-highlight | | 安全渲染，无 XSS 风险 |
| 图标 | lucide-react | ^1.0 | 轻量 SVG 图标 |
| 打包 | electron-builder | ^26.0 | NSIS 安装包 |

## 项目架构

```
Knowbase/
├── electron/
│   ├── main/index.ts          # 窗口管理 + IPC 调度
│   ├── preload/index.ts       # 安全 API 桥接
│   ├── database/              # sql.js 初始化 / 迁移 / Repository
│   ├── ai/                    # AI API 调用处理 (Node fetch)
│   └── terminal/              # 终端管理器（预留）
├── src/
│   ├── App.tsx                # 主组件：TitleBar + ActivityBar + 路由
│   ├── modules/
│   │   ├── blog/              # 博客模块
│   │   ├── schedule/          # 日程模块
│   │   ├── knowledge/         # 知识库模块
│   │   ├── export/            # 数据导出模块
│   │   ├── recycle/           # 回收站模块
│   │   ├── settings/          # 设置模块
│   │   ├── help/              # 帮助文档模块
│   │   ├── user/              # 用户模块
│   │   └── toolbox/           # 工具箱模块
│   └── components/shared/     # 通用 UI 组件
└── scripts/                   # 脚本工具
```

## 部署

### 环境要求

| 依赖 | 最低版本 |
|------|---------|
| Windows | 10 / 11 (64 位) |
| Node.js | 18+（推荐 20 LTS） |
| npm | 9+ |

### 开发环境

```bash
git clone <repo-url>
cd KnowledgeRecorder
npm install
npm run dev       # 启动开发模式（热更新）
```

### 生产打包

```bash
# 一键构建 + 打包 NSIS 安装包
npm run pack

# 若遇到 SSL 证书错误，使用：
NODE_OPTIONS="--use-system-ca" npm run pack
```

打包产物在 `dist-electron/` 目录，生成 `Knowbase Setup x.x.x.exe` 安装包。

## AI 助手配置

1. 打开 **设置** → **AI 服务**
2. 填入 API 密钥（支持 OpenAI / DeepSeek 及其他兼容接口）
3. 确认 Base URL 和模型名称
4. 切换到 **工具箱** → 点击「AI 助手」卡片即可对话

默认配置为 DeepSeek（`https://api.deepseek.com/v1`，模型 `deepseek-chat`），只需填入密钥即可使用。

## 数据目录

| 文件 | 路径 |
|------|------|
| 数据库 | `%APPDATA%/knowbase/data/knowledge.db` |
| 设置 | `%APPDATA%/knowbase/settings.json` |

## 环境检查

1. **`ELECTRON_RUN_AS_NODE`** — 系统环境变量中若存在需删除，否则 Electron 以纯 Node 模式运行
2. **安装路径** — 建议非 C 盘，避免中文路径导致数据库异常
3. **数据备份** — 定期使用导出功能备份数据库

## 免责声明

纯 vibecoding 个人项目，使用本软件造成文件损坏或数据丢失概不负责。

## 参与贡献

有更好的想法或发现 Bug，欢迎在项目中提 Issue 或 PR。
