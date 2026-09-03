# 插件体系现状梳理与 Obsidian 对标（讨论注记）

> 日期：2026-09-02 · 类型：方案讨论沉淀（会话内不落代码）
> 归属：`rework-plugin-openness.md`（v3 方向）的输入与对照材料；如需修订 `plugin-api-v2-design.md` 可引用本文。
> 材料来源：`electron/lib/pluginRegistry.ts`、`pluginDataStore.ts`、`pluginAudit.ts`、`src/modules/plugins/index.tsx` 全量阅读 + Knowbase-plugins 市场 registry 实测 + Obsidian 官方 API 文档与社区生态检索。

---

## 1. 讨论目标

1. 说清 Knowbase 插件体系**现状**（信任模型、贡献面、分发链路、市场实况）。
2. 对照 **Obsidian 插件内部设计**，找出真正值得借鉴的「统一扩展点」，而不是抄它的信任模型。
3. 基于生态现状给出 **Knowbase 官方插件推荐品类**与市场缺口判断。
4. 留下**待拍板问题清单**，供后续逐轮细化（仍不写代码）。

---

## 2. Knowbase 插件体系现状（读码事实）

### 2.1 信任分级模型（核心设计）

四级风险等级由**主进程强算**（`computeRiskLevel`），与 manifest 自报值取高（`effectiveRiskLevel`，防骗标）：

| 等级 | 含义 | 判级依据 | 形态 | 现有例子 |
|---|---|---|---|---|
| S | 内容级 | 仅含内容类贡献键（theme/blogTemplates/helpDocs/pomodoroPresets/skills/sidebarIcons/deleteFx） | 纯静态资产，免确认 | 主题合集、番茄钟进阶预设、Teach Skill |
| A | 数据级 | 含数据类贡献键（habitPresets/bookmarkPresets/automationRule/knowledgePages） | 导入动作经主进程枚举写入宿主库 | 408 学习空间、考研政治知识包 |
| B | 能力级 | `type: ui` 且未声明 tables/data/knowledge/navigation | UI 沙箱 + 桥，capability 逐项授权 | 强密码生成器（市场唯一） |
| C | 模块级 | `type: ui` + 声明 tables 或 data/knowledge/navigation 能力 | 自有表 + 视图挂载 + 宿主 API，需显式授权 | 错题本 knowbase.quizbook |

要点：
- `type: 'code'` 在清单校验阶段**拒收**（`validateManifest`），当前不执行插件代码。
- `pluginAllowedLevels`（settings.json）策略开关，默认 `S,A,B,C`；渲染层可关闭 C 级许可。
- B/C 级安装/更新走**逐能力勾选授权**（`grantedCapabilities`），新增能力需重新确认；A 级导入前有知情确认弹窗；S 级免确认。

### 2.2 manifest 与贡献面（contributes）

- `plugin.json` 字段：id/name/version/type（declarative|ui|code 拒收）/entry(ui 必填 HTML)/icon/category/riskLevel/capabilities/activation/engineVersion(`>=x.y.z` 兼容检查)/contributes。
- `capabilities` 白名单共 5 项：`theme / clipboard / data / knowledge / navigation`（≤10 项强制校验；theme/clipboard 为一期放行的 B 级面，后三者属 C 级面）。
- `contributes` 已知 13 键：blogTemplates / theme / habitPresets / bookmarkPresets / pomodoroPresets / helpDocs / tools / automationRule / knowledgePages / sidebarIcons / deleteFx / tables / views。
  - `tables`：仅 ui 且须声明 data 能力；1-20 张表；列类型白名单 TEXT/INTEGER/REAL/BLOB。
  - `views`：仅 ui；slot 命名如 `knowledge.sidebar`，1-10 个，mode 支持 fullscreen/panel。
  - `tools`：仅 ui；1-10 个工具卡片。
  - `knowledgePages`：v2（space+notebooks）/v1（单 notebook）双格式，总量 ≤1500 页。
  - `skills`：1-20 条提示词资产，变量内联数组 `[a,b]`，tools 引用按 ToolRegistry 命名空间规则（一期仅展示不校验）。

### 2.3 C 级模块插件数据层（pluginDataStore）

- 物理表 `plugin_<safePluginId>_<table>`，命名空间隔离，插件只能访问自己声明的表。
- **不暴露任意 SQL**：结构化 CRUD（insert/update/delete/query），表名列名白名单 + 参数绑定；where ≤8 条件、op 白名单。
- 行数：查询默认 200、硬上限 1000。
- 建表/删表幂等（安装/启用时补建，卸载按 `dropData` 决定是否删表，卸载前可 dump 备份）。

### 2.4 分发与供应链

- 市场：GitHub `Lousync/Knowbase-plugins` 的 `registry.json`，TTL 10min 缓存；registry 镜像顺序 ghproxy 节点 → raw → jsDelivr×2。
- 下载：流式（连接 30s / 正文空闲 60s 看门狗）、3 轮退避（2s/6s）、进度上报总线（切页不中断）；下载地址仅信任 https 且 host 白名单。
- 安装校验：Zip Slip 防护（`safePathInside`）、体积/文件数限额（通用 20MB/500；knowledgePages 放宽 60MB/1500）、manifest ≤256KB、id=目录名。
- 内置插件：随应用分发（packaged 走 `resources/builtin-plugins`），版本覆盖升级；不再分发的内置插件**降级为普通插件解锁卸载**；`userRemoved` 标记不复活。

### 2.5 审计

- `plugin_audit_log`（迁移 044）追加式记录 install/update/grant/deny/import/run/uninstall；detail 只存摘要（≤200 字符入参截断）。
- 同一日志被 AI 工具体系复用：`tool.invoke`/`mcp.invoke`/`llm.invoke` 计入**月度调用上限与 token 预算**硬拦截。

### 2.6 市场实况（registry 实测，8 款）

| id | 名称 | category | riskLevel | 关键贡献/能力 |
|---|---|---|---|---|
| knowbase.password-generator | 强密码生成器 | 工具 | B | UI 插件（市场唯一 B 级） |
| knowbase.markdown-guide | Markdown 使用指南 | 知识包 | S | — |
| knowbase.themes-collection | 主题合集 | 外观 | S | theme |
| knowbase.pomodoro-presets-pro | 番茄钟进阶预设 | 工具 | S | pomodoroPresets |
| knowbase.kb-408-pack | 408 学习空间 | 知识包 | A | knowledgePages |
| knowbase.kb-politics-pack | 考研政治学习空间 | 知识包 | A | knowledgePages |
| knowbase.quizbook | 错题本（插件版） | 学习 | C | tables+views；data/knowledge |
| knowbase.teach-skill | Teach 教学助手 | Skill | S | skills |

结构小结：知识包 3 / 工具 2 / 外观 1 / Skill 1 / 学习 1。**B 级 UI 插件仅 1 个，C 级仅错题本 1 个**——市场整体处于「内容包 + 知识包」形态。

---

## 3. Obsidian 插件架构要点（对标对象）

- manifest.json：id/name/version/minAppVersion/description/author/isDesktopOnly；单文件 `main.js`（esbuild bundle，`external: obsidian`）。
- 生命周期：`export default class extends Plugin`，`onload()`/`onunload()`；**用框架提供的 register\* 注册（命令/视图/事件/interval）则卸载自动清理**。
- App 对象三大件：`app.vault`（文件抽象）、`app.workspace`（叶子/面板布局）、`app.metadataCache`（frontmatter/链接/标签缓存，`cachedRead` 优先于 `read`）。
- 扩展点（一句话注册）：addCommand（命令面板+热键）、addRibbonIcon、addSettingTab（设置页）、registerView（侧栏面板）、addStatusBarItem、registerEditorSuggest（编辑器联想）、registerMarkdownPostProcessor/registerMarkdownCodeBlockProcessor（渲染后处理/代码块处理器）、registerHoverLinkSource（悬停预览）、registerObsidianProtocolHandler（obsidian:// 深链）。
- 持久化：`loadData/saveData` → 插件目录 `data.json`；`onExternalSettingsChange` 感知外部修改。
- 主题：全量 CSS 变量（`--text-normal`、`--background-secondary` 等），插件禁硬编码颜色。
- 生态规模：社区插件 2700+（2026 检索口径 2700~3000），核心功能大量由社区承担。
- 信任模型：**渲染进程内全权 JS，运行时无沙箱**，信任靠社区审核与手动开启开关（历史上出过安全事件）。

---

## 4. 对照结论

### 4.1 Knowbase 已有、且优于 Obsidian 的部分（保持）

1. **安全默认**：S/A/B/C 分级强算 + capability 逐项授权 + 全程审计 + 包限额/防穿越——Obsidian 插件可触及 Node/Electron 全部能力，Knowbase v3 沙箱内插件**永远拿不到 ipcRenderer/fs**，能力只经 Gateway。
2. **声明式轻量生态**：知识包/Skill/主题等零代码资产，适合非程序员作者——这是 Obsidian 没有的品类。
3. **官方模块齐全**：博客/日程/知识库/工具箱等核心功能官方已覆盖，插件只承担「长尾」而非「地基」。

### 4.2 Knowbase 真正的缺口（Obsidian 值得抄的）

| # | 缺口 | Obsidian 机制 | Knowbase 现状 | 优先级 |
|---|---|---|---|---|
| 1 | 跨模块统一扩展层 | 命令面板（一切皆命令+热键） | 快捷键散落各模块，无全局命令表 | ★★★ |
| 2 | 生命周期与自动清理 | onload/onunload + register 注册即清理 | 启停 = 重读 manifest（声明式够用，v3 执行代码后必需） | ★★（v3 必需） |
| 3 | 插件设置页与持久化约定 | addSettingTab + data.json | C 级用 sql.js 表，无插件自有设置页 | ★★（v3 必需） |
| 4 | 视图插槽系统化 | registerView → workspace leaf | 已有 `views(slot)` 雏形，slot 仅模块内 | ★★★ |
| 5 | 代码块处理器 | registerMarkdownCodeBlockProcessor | react-markdown 不渲染 HTML，无自定义块 | ★★ |
| 6 | metadataCache 语义层 | vault 文件 → 缓存索引 | 路线图阶段 2 即此 | ★★（已有规划） |
| 7 | UI 纯装饰免授权 | 无此概念（UI 自由） | 仅 B/C 可挂 UI | ★（v3-1 放宽） |

### 4.3 不建议抄的

- **完全信任 JS 模型**：Knowbase 沙箱+授权是更安全的默认，v3 不应退化为 Obsidian 模式（对应 `rework-plugin-openness.md` 已拍板结论）。
- **核心功能社区化**：官方模块覆盖已优于多数工具，插件生态应做长尾。

---

## 5. 插件推荐：Obsidian 顶流 → Knowbase 官方候选

按「与 Knowbase 已有模块的衔接度 + 生态带动性」筛选：

1. **Dataview（库查询）→ 知识库「查询面板」**：Obsidian 下载量第一；用类 SQL 语法跨页聚合标签/双链/属性。与 metadataCache（Vault 化阶段 2）、图谱（阶段 6）天然衔接，建议作为两者之间的阶段化功能。MVP：标签/文件夹/属性过滤的动态列表，输出到面板或嵌入页。
2. **Templater（模板引擎）→ 全模块「新建模板」**：博客已有自定义模板，抽成通用引擎（日期/文件名/剪贴板/变量），接入编辑器模块的新建流程。
3. **Calendar + Periodic Notes → 侧边栏日历**：与 `feature/schedule-sidebar`（日程任务+打卡）重合，形态参照：侧边栏月历 + 日期活动标记 + 点击跳转。
4. **Web Clipper（浏览器剪藏）**：Obsidian 体验最好的外围件；Knowbase 已有 lanShare 本地服务经验（手写 HTTP 服务 + 二维码），做「本地监听端口 + 浏览器扩展」成本可控，官方插件里最能拉新。
5. **Excalidraw / Canvas（画布）**：功能重，仅借鉴「无限画布 + 笔记嵌入」概念，挂 long-term。

**市场缺口判断**：知识包是 Knowbase 的差异化护城河（Obsidian 无此品类），可继续加厚；但**工具/UI 类是当前最薄的品类，官方应优先造 2~3 个示范级 UI 插件**（如 Web Clipper、查询面板）。原因：第三方作者需要可参考的「可执行插件样板」，而当前市场除错题本外没有第二个可执行插件示例，生态难以自我繁殖。

---

## 6. 待拍板问题清单（下轮讨论用）

1. **v3 开放度开到几成**（对应 openness 文档第 7 节未决处）：
   - 命令面板/统一扩展层是否在 v3 之前独立先行（它不依赖执行代码，纯宿主功能）；
   - `kb.*` Gateway 首批命名空间（kb.vault/kb.ui/kb.events…）的范围与授权粒度；
   - 纯 UI 装饰（无数据/无网络）是否降级为免授权。
2. **官方示范插件选型**：先做哪个——Web Clipper / 查询面板 / 其他；各自 MVP 范围。
3. **文档修订动作**：`rework-plugin-openness.md` 要求修订 `plugin-api-v2-design.md`（capabilities 扩展 + signing 字段），本次讨论材料是否并入该次修订。
4. **去库化联动**：插件数据/设置落 `.knowbase/plugins/<id>/`（data.json 约定）与 v3 生命周期设计的先后关系。
5. **签名链路**：作者私钥签名 + 应用内置公钥校验，与现有 3 重下载镜像（ghproxy→jsDelivr→直连）如何叠加校验。

---

## 附录：材料索引

源码与机制（本仓库）：
- `electron/lib/pluginRegistry.ts` — 注册表/判级/安装/分发/审计 IPC/内置落位
- `electron/lib/pluginDataStore.ts` — C 级自有表 CRUD（结构化、无任意 SQL）
- `electron/lib/pluginAudit.ts` — 审计 + AI 月度调用/token 统计
- `src/modules/plugins/index.tsx` — 市场 UI（分级徽章/授权弹窗/知识包导入/冲突管理）
- `docs/rework-plugin-openness.md` — v3 开放方向（已拍板）
- `docs/plugin-api-v2-design.md` / `docs/plugin-api-v2-reference.md` — v2 协议（本文未重读，修订时需对照）

外部资料：
- Obsidian 开发者文档（Plugin 生命周期、API 参考）
- Obsidian 社区插件目录（2700+，检索于 2026-09-02）
