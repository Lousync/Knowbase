# 插件一期改造设计（Slots 消费面 / 命令 / 事件 / 生命周期 / 渲染扩展点）

> 分支：feature/ai-plugin-upgrade（ai-plugin worktree）　日期：2026-09-12　状态：已实现（C1-C6 全量落码；真机验收并入统一清单）
> 前置：P2（kb.metadata.* / kb.vault.*）已落地；本设计 = 双线合并前的「插件工作」范围，共 6 项（C1-C6）

## 1. 现状盘点（基于代码实证）

- **三类插件**：declarative / ui（沙箱 iframe，`plugin://` 协议）/ code（Worker，kb-plugin v2 协议）
- **授权**：8 项能力（theme、clipboard、data、knowledge、navigation、files、vault:read、vault:write）
  + S/A/B/C 风险分级 + ed25519 签名 + 全量审计
- **Gateway API 面**：kb.data（CRUD）、kb.metadata（搜索/查询/双链）、kb.vault（6 件套）、
  kb.store（插件私有 KV）、kb.ui（toast/clipboard/theme/hostReview）
- **贡献面 14 种**（KNOWN_CONTRIBUTIONS）：blogTemplates、theme、habitPresets、bookmarkPresets、
  pomodoroPresets、helpDocs、tools、skills、automationRule、knowledgePages、sidebarIcons、deleteFx、tables、views
- **views 插槽**：注册表完备（slot 命名校验、title ≤20、mode fullscreen/panel、1-10 个），
  但宿主消费**仅 `knowledge.sidebar` 一处**（knowledge/index.tsx:130）
- **已有基建可直接复用**：
  - 命令面板已存在（CommandPalette，PaletteItem {id,label,hint,run}，App.tsx 聚合）
  - 沙箱宿主已存在（PluginFrame = iframe + postMessage 桥；CodePluginHost = Worker + channel/action 消息）
  - MarkdownPreview 已有围栏拦截先例（language-quiz → QuizCard；anims → 内置动画包 iframe）

## 2. 六项工作

### C1 首启 404 修复

- **诊断（代码实证）**：`plugin://` handler 只读 `getPluginsRoot()`（main/index.ts:659）；
  内置插件在 `resources/builtin-plugins`（registry 的 BUILTIN_PLUGIN_DIRS 仅用于清单读取，未接入 handler）。
  首启时内置插件尚未播种进 plugins root，启动尾部自检（main/index.ts:904）必然 404；二启起播种完成故不复现。
- **方案**：handler 增加内置目录**只读兜底**——id 未命中 plugins root 时按序查 BUILTIN_PLUGIN_DIRS，
  路径越界校验（startsWith）与 CSP 逻辑原样复用。消解启动时序依赖，不做播种改造。
- **风险**：无新增写路径；内置目录内容随包分发、签名体系不变。

### C2 插槽消费面扩展

- **新增宿主插槽 v1（3 个）**：`editor.sidebar`（编辑器左栏底部——编辑器模块没有右栏，§6-1 落码裁决：
  与另两槽统一 `<module>.sidebar` 命名）、`blog.sidebar`、`schedule.sidebar`。
  AI教学不加（资源管理器分区已挤）。
- **消费模式**：复用 knowledge/index 现成模式——`pluginListViews(slot)` 拉取 + PluginFrame 渲染 + 无贡献时零渲染。
- **编辑器右栏形态**：右栏已有大纲/相似页等功能块 → 插件 panel 以**页签**并入右栏页签组（icon 用贡献值）。
  落码时按右栏实际结构定（开放问题 §6-1）。
- **权限语义不变**：插槽只是"可见性"，iframe 内能力仍由 manifest capabilities 决定。

### C3 命令通道

- **声明式**（三类插件均可）：`contributes.commands: [{ id, title, desc? }]`（插件内 id 唯一，
  全局名 = `<pluginId>.<id>`，≤32 个）。
  - 执行语义：ui/declarative 插件的命令 = 打开其声明的 view（无 view 则忽略并提示）；
  - code 插件的命令 = 宿主向 Worker 推 `action:'command'` {commandId}，Worker 自行处理。
- **动态注册**（code 插件）：`kb.commands.register({ id, title, desc? })` / unregister，会话内生效。
- **宿主聚合**：命令面板打开时异步拉 `pluginListCommands()`（getEnabledContributions 扩展 commands），
  PaletteItem.hint = 插件名；与内置命令并列，无分区隔离。
- **一期不做**：命令快捷键绑定、右键菜单贡献（二期，ADR-1）。
- **权限**：命令执行只触发该插件已授权的能力，不新增权限面。

### C4 事件通道（最小集）

- **主进程最小 EventBus**：一期 4 个宿主事件，在各模块 repo 落码处直接 emit：
  - `knowledge:pageSaved { pageId, title }` / `knowledge:pageDeleted { pageId }`
  - `blog:postSaved { postId, title }`
  - `schedule:todoCompleted { todoId, title }`
- **Gateway**：`kb.events.subscribe(events: string[])` / `unsubscribe`。
  **权限映射到现有模块 capability**（ADR-2）：knowledge 事件需 `knowledge`、blog/schedule 需 `data`——
  订阅即校验，未授权事件在订阅结果中逐项报 EPERM。
- **推送**：复用 CodePluginHost 现有 channel，`action:'event'` {event, payload} 单向推送；
  插件未运行（无 Worker 会话）时事件**不积压不补发**（一期语义：只推在线的）。
- **背压**：每插件投递队列上限 32 条，超出丢最旧并随下条事件附 `{dropped: n}`。
- **仅 code 插件可订阅**（ADR-3）；ui/declarative 拒绝。

### C5 生命周期 + 声明式设置

- **生命周期（仅 code 插件）**：Worker 会话 init 成功后推 `action:'lifecycle' {phase:'enable'}`；
  禁用/卸载/应用退出前推 `{phase:'disable'}`，给 500ms 宽限后 terminate（尽力而为语义）。
  Worker 仍是"挂载即创建"的按需模型，**不做全局常驻**（资源模型不变）。
- **声明式设置**：`contributes.settings: [{ key, label, type: 'boolean'|'number'|'string'|'select', default, options?, desc? }]`
  （≤16 项，类型白名单）。插件管理详情页自动渲染表单；**值直接写 kb.store**（键约定 `settings.<key>`），
  插件侧用现有 kb.store.get 读取——不新增 Gateway API（ADR-4）。

### C6 编辑器渲染扩展点

- **manifest**：`contributes.renderers: [{ lang, entry, height?, title? }]`（**type:ui 专属**，
  lang 限 `[a-z0-9-]{1,20}`，≤8 个）。
- **渲染管线**：MarkdownPreview code 组件命中 `language-<lang>` 且存在已启用渲染器 →
  渲染 PluginFrame（sandbox iframe）加载 `{entry}`，postMessage 桥发送
  `{ fence 源码, pageId, pageTitle }`，插件在 iframe 内自渲染；高度协商用现有插件桥消息扩展。
- **输入边界**：只传 fence 文本 + 页面 id/标题，**不传页面全文**（ADR-5）。
- **回退**：插件未启用/加载失败/渲染超时（3s）→ 回退普通代码块（与 quiz 解析失败回退一致）。
- **与 anims 的关系**：anims 是硬编码特例，renderers 是其泛化；一期不动 anims，二期迁移。

## 3. ADR

| # | 决策 | 理由 |
|---|------|------|
| 1 | 命令一期只进命令面板，不绑快捷键 | 快捷键冲突治理是独立课题，不混入 |
| 2 | 事件权限映射现有模块 capability，不新增 events:* | 用户心智统一：给模块权限 = 给该模块全部事件 |
| 3 | 事件仅 code 插件可订阅 | ui 插件无后台生命，declarative 无逻辑 |
| 4 | 插件设置不新增 API，落 kb.store `settings.*` | kb.store 已有配额与审计，糖不如约定 |
| 5 | renderers 输入边界 = fence 文本，不给页面全文 | 内容渲染不需要读全文；缩小泄露面 |
| 6 | 404 修法 = handler 内置目录只读兜底，不动播种时序 | 兜底消解时序依赖，比修时序本身稳 |

## 4. 验收

- **契约断言**：manifest 校验边界（commands ≤32 / renderers lang 格式 / settings 类型白名单）、
  事件权限映射表、命令聚合纯函数。
- **真机清单**：三个新插槽各挂一个测试插件可见可交互；命令面板出现插件命令且执行正确；
  保存页面 → code 插件收到 pageSaved；禁用插件收到 disable 后 Worker 退出；
  插件设置表单改值 → 插件读到新值；fence 渲染器渲染 + 停用回退；**首启日志无 404**。

## 5. 落码顺序与工作量

C1（0.5h）→ C2（0.5 天）→ C3（1 天）→ C5（1 天）→ C4（1-1.5 天）→ C6（1.5 天），合计 ≈5-6 天。
顺序理由：先易后难；C4 事件依赖 C5 确立的 Worker 生命周期语义；C6 渲染器最独立放最后。

## 6. 开放问题

1. editor.rightPanel 页签形态细节（落码 C2 时按右栏现有结构定）；
2. 事件二期扩展面：通知类、定时类（cron）宿主事件；
3. renderers 的 iframe 高度协商协议细节（沿插件桥扩展即可，落码定）。
