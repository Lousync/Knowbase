# Knowbase Programmer Edition

Windows 桌面端知识日程管理工具，纯本地运行

> 所有数据保存在你自己的电脑上——无需注册、没有云端、不联网也能用。

## 功能模块

| 模块 | 说明 |
|------|------|
| 📝 博客 | 每日一篇，Markdown 写作，标签分类，日历筛选，全文搜索；**周/月总结面板**自动汇总区间数据，**自定义模板**一键套用 |
| 📅 任务 | 日历视图，待办列表，四象限优先级，子任务，截止时间线，周期任务 |
| 📚 知识库 | 空间 / 笔记本 / 章节 / 页面四级结构，`[[双链]]` + **关联网络**（反链上下文、手动关联、相关性推荐），PDF / 代码 / XMind 附件与注解层，**沉浸阅读模式** |
| 💬 说说 | 轻量动态 + 相册管理，支持时间线可见性切换 |
| 🤖 AI 助手 | 全局侧栏（`Ctrl+J` / 右下角悬浮按钮），**本地优先**的模型网关（OpenAI 兼容 / Ollama / Anthropic，支持 CC Switch 一键导入），自然语言驱动本地工具（≤8 轮推理、全程审计、月度用量上限），**上下文感知**——阅读知识库页面时"边看边问"；MCP 外部服务器、Skill 提示词包、按模块权限分级 |
| 🧩 插件 | 官方市场一键安装，S/A/B 三级安全审核；**主题包**（GitHub Dark/Light、护眼米白、赛博朋克、手绘线条、OpenCode 终端灰）、番茄钟进阶预设、C++ 文档速查、**408 考研学习空间**（教材 76 页 + 18 套 846 题真题，一键导入知识库，含冲突管理面板） |
| 🧰 工具箱 | 8 个内嵌实用工具（见下），含**数据导出**——按模块勾选导出备份包（ZIP），拖入窗口即可完整还原 |
| 🗑️ 回收站 | 软删除，可恢复，保留天数可调，支持导出为 Markdown |
| 🛡️ 安全 | 可选锁屏密码 + 启动自动锁屏 |
| ⚙️ 设置 | 深色/浅色主题、字体、缩放、编辑器行为、打卡提醒、博客模板等 |

### 工具箱

| 工具 | 功能 |
|------|------|
| 体重追踪 | 多系列 Canvas 折线图，滚轮缩放、横滚浏览，kg/斤切换 |
| 密码本 | 加密存储（DPAPI），快速搜索，一键复制，全局快速填充悬浮窗（`Ctrl+Alt+P`） |
| 强密码生成器 | Web Crypto 密码学安全随机，长度与字符类型可调，强度评估 |
| 网址导航 | 分类管理学习资料网址，JSON 备份 / Netscape HTML 导入浏览器 |
| 数据导出 | 按模块勾选导出备份包（ZIP），拖入窗口即可完整还原 |
| 番茄钟 | 三档预设专注循环，状态栏常驻，专注时长计入周月总结 |
| 习惯打卡 | 每天 / 每周指定 / 每周 N 次三种规则，补卡、连击里程碑与统计 |
| 远程监督 | 打卡实时推送到微信 / 钉钉 / 企微（Webhook），每日汇总与免打扰 |

### 其他特性

- **新手引导**：首次启动分步向导，快速上手（设置中可随时重看）
- **AI 对话与工具调用**：`Ctrl+J` 随时唤起，支持停止生成 / 重新生成 / 编辑重发 / 会话留存；工具执行与手动操作同一套审计与限额链路
- **检查更新**：标题栏出现 ⬇ 徽章即代表有新版本，点击直下、完成后一键安装；下载支持可配置镜像加速（ghproxy 协议，失效可随时替换）
- **帮助中心**：内置中文文档；侧栏「反馈问题」一键跳转 GitHub Issues
- **快捷键**：`Ctrl+N` 当前模块新建 · `Ctrl+J` AI 助手 · `Ctrl+B` 侧栏 · `Ctrl+O` 大纲 · `Ctrl+滚轮` 缩放界面

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Electron 33 | 无边框窗口 + 自定义标题栏，渲染进程沙箱化 |
| 前端框架 | React 19 + TypeScript | 函数组件 + Hooks，严格模式 |
| 构建工具 | electron-vite | 主进程 / preload / 渲染进程统一构建 |
| UI 样式 | TailwindCSS 4 | 原子化 CSS，深色/浅色双主题（CSS 变量） |
| 数据库 | sql.js (SQLite WASM) | 零原生依赖；原子写盘 + 自动 `.bak` 回退 |
| 编辑器 | Monaco Editor | VS Code 同款内核 |
| Markdown | react-markdown + rehype-highlight | 默认不渲染原始 HTML，安全无 XSS |
| 图标 | lucide-react | 轻量 SVG 图标 |
| 打包 | electron-builder | NSIS 安装包（x64） |

## 项目架构

```
Knowbase/
├── electron/
│   ├── main/index.ts          # 窗口管理 + IPC 调度 + 安全策略
│   ├── main/passwordFiller.ts # 密码快速填充悬浮窗
│   ├── preload/index.ts       # contextBridge 安全 API 桥接
│   ├── database/connection.ts # sql.js 初始化 / 迁移调度（单事务）/ 原子持久化
│   ├── database/migrations/   # 逐版本迁移：一文件一迁移 NNN_name.ts + index.ts 顺序表
│   ├── database/paths.ts      # 附件目录等路径解析（供迁移复用，避免循环依赖）
│   ├── database/repositories/ # 各模块 Repository（SQL 全参数化）
│   └── lib/                   # 推送服务、ZIP、路径防护、更新检查等
├── src/
│   ├── App.tsx                # 主组件：TitleBar + ActivityBar + 模块路由
│   ├── modules/               # blog / schedule / knowledge / moments /
│   │                          # toolbox / export / recycle / settings /
│   │                          # help / user
│   ├── components/shared/     # 通用 UI（MarkdownPreview / Onboarding 等）
│   └── lib/                   # IPC 封装 / 设置 Schema / 日期与快捷键工具
├── docs/                      # 开发者文档
└── scripts/                   # 启动脚本
```

## 安全设计

- 数据 100% 本地存储（SQLite），密码本列使用系统级加密（Windows DPAPI）
- 渲染进程沙箱 + contextIsolation，IPC 最小暴露面，路径类操作防穿越（Zip Slip 防护）
- 复制的密码 30 秒后自动清空剪贴板（仅当内容未被覆盖时）
- 备份导入预检 + 事务回滚，数据库损坏自动从 `.bak` 恢复
- **AI 安全**：API Key 系统级加密存储（渲染层永不可见）；AI 工具调用全程审计、月度用量硬上限；按模块权限分级（禁止/只读/读写），未授权工具对 AI 完全不可见；MCP 外部命令双重确认
- **插件安全**：S/A/B 三级强算分级（主进程防骗标）；内容包导入单事务执行、失败自动回滚；本地已修改页面默认跳过保护，冲突面板可勾选按页覆盖

## 部署

### 环境要求

| 依赖 | 最低版本 |
|------|---------|
| Windows | 10 / 11 (64 位) |
| Node.js | 18+（推荐 20 LTS） |
| npm | 9+ |

### 开发环境

```bash
git clone https://github.com/Lousync/Knowbase.git
cd Knowbase
npm install
npm run dev       # 启动开发模式（热更新）
```

> 开发模式使用独立的 `%APPDATA%/knowbase (dev)` 数据目录，与正式版完全隔离。

### 生产打包

```bash
# 一键构建 + 打包 NSIS 安装包
npm run pack
```

打包产物在 `dist-electron/` 目录，生成 `Knowbase Programmer Edition Setup x.x.x.exe`。

## 数据目录

| 文件 | 路径 |
|------|------|
| 数据库 | `%APPDATA%/knowbase/data/knowledge.db`（含 `.bak` 自动备份） |
| 附件 | `%APPDATA%/knowbase/attachments/` |
| 设置 | `%APPDATA%/knowbase/settings.json` |

## 环境检查

1. **`ELECTRON_RUN_AS_NODE`** — 系统环境变量中若存在需删除，否则 Electron 以纯 Node 模式运行
2. **数据备份** — 定期使用导出功能备份；数据库损坏时应用会自动尝试 `.bak` 回退

## 免责声明

纯 vibecoding 个人项目，使用本软件造成文件损坏或数据丢失概不负责。

## 参与贡献

有更好的想法或发现 Bug，欢迎 [提 Issue](https://github.com/Lousync/Knowbase/issues) 或 PR；也可在应用内 **帮助 → 反馈问题** 直达。

## 致谢

- 文件类型图标来自 [vscode-icons](https://github.com/vscode-icons/vscode-icons) (CC BY 4.0)
