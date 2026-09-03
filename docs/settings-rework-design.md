# 设置模块改版设计（settings-rework）

> 分支：`feature/settings-rework`（worktree 20260903）｜状态：v0.1 讨论稿（2026-09-03 定稿方向）
> 背景：用户评价现有设置"不人性化、不现代化"，要求对标 VS Code / Obsidian 设置体系后重做。

## 1. 目标

把设置从「按业务模块堆叠的手写视图」重构为「**声明式 schema 驱动的现代化设置中心**」：

1. 消灭设置漂移——所有设置 key 都有 UI、可搜索、可重置
2. 信息架构从"8 个业务模块"改为"能力域分组"，符合用户意图心智
3. 状态可见——已修改标记 / 单项与全部重置 / 默认值可查
4. 危险项与实验项统一标注；作用域（全局 vs 仓库）预留

## 2. 现状侦察（2026-09-03 实测）

| 项 | 现状 | 问题 |
|---|---|---|
| schema | `src/lib/settings.ts` `SETTINGS`：**66 key**，每项仅 `{default, desc}`，无类型/控件/分组/关键词/作用域 | 无 UI 元数据，视图无法自动生成 |
| 搜索索引 | `sections.tsx` `SETTING_ITEMS`：**38 小项手写**（含 18 功能页入口），大项 8 个 | 索引与 schema 分离，新增设置两头维护 |
| UI | `settings/views/*` 11 个视图手写表单（SettingSelect/分段按钮/裸 input） | 控件不一、与 schema 脱节 |
| 数据 | `userData/settings.json` 扁平对象 + `SettingsContext` `useSettings()` 下发 | 单一全局作用域 |
| 已有亮点 | 搜索跳转 + 锚点闪烁 + 命中计数 + 折叠分组 + `settings:open` 跨模块跳转 | 保留并强化 |

**漂移证据**：66 key 中**仅 20 个在设置页有直达锚点**；38 索引项里 18 个是功能页入口（模板/MCP/快捷键组等）。其余 46 key 无设置页入口——其中部分由功能页/模块内/拖拽 UI 承载（sidebarWidth_*、activityBar*、wordbook 等），部分完全无 UI 只能改 JSON（trashExportDir、zoomMin/Max/Step、lockPassword 等）。

## 3. 对标拆解（VS Code / Obsidian 可借鉴点）

- **VS Code**：设置=文档化 id（`editor.fontSize`）；UI 由 schema 自动生成（类型/默认/描述/enum options）；搜索置顶 + 语法过滤（`@modified`）；已修改标记 + 单项/全部重置；User/Workspace 作用域分层；"Requires reload" 危险标注。
- **Obsidian**：按能力域分组（编辑器/文件与链接/外观/快捷键/关于…）；第三方插件设置**各自独立成项**不迷路；数值滑杆+重置即时生效；快捷键命令驱动 + 冲突检测；外观=预览式（主题浏览/字体/密度/缩放）。
- **共性收敛（Knowbase 目标骨架）**：schema 声明 → UI 自动生成 · 搜索直达 · 已改/默认可见 · 能力域分组 · 作用域分层 · 危险统一标注。

## 4. 决策记录（2026-09-03 用户拍板）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 改造范围 | **全量重做**（schema 完整化 + 自动表单 + 状态可见 + 分组重排），分一期/二期执行 |
| D2 | 信息架构 | **能力域分组**；一期只建主干域，模块设置（博客/提醒等）二期再迁（"先主干后模块"） |
| D3 | 表单渲染 | **schema 驱动自动表单** + 统一控件库，新增设置零 UI 代码 |
| D4 | key 命名 | **规范化改名**（点分域 id），但**分域随迁随改**：一期只改主干 key，模块 key 二期随迁随改 |
| D5 | 作用域 | v1 **全局单作用域 + 预留 `scope` 字段灰标**；二期真拆仓库级存储 |
| D6 | 文档落点 | worktree `docs/settings-rework-design.md`（本文件），随分支提交，供并行会话接力 |
| D7 | 精确数值控制 | **档位 + 自由输入双轨**：数据模型只有单一数值，档位 chips 仅"快捷写入数值"；数值**输入即生效**（~300ms 防抖，越界红边提示不写入）；聚合密度项（s/m/l）透出当前组成数值的说明文字 |

## 5. 目标信息架构（一期主干）

> 左栏 = 域 → 组 → 项。key 新命名 = `域.组.名` 或沿用紧凑名（见 §7 映射）。

```
通用 General
  ├ 启动        startup.defaultTab（原 startupTab）
  └ 删除确认    general.confirmBlog / confirmKnowledge / confirmCategory / confirmChapter（原 skipDeleteConfirm_* 反转语义）
外观 Appearance
  ├ 主题与皮肤  appearance.theme（含插件主题包）/ appearance.deleteFx / appearance.iconPack
  ├ 密度与尺寸  appearance.blogCardDensity / appearance.kbSidebarDensity / appearance.scheduleIconSize
  │             + sidebarWidth_*（7，可视化编辑器拖拽存值）
  └ 缩放        appearance.zoom（zoomMin/Max/Step 约束随 schema，不进 UI）
编辑器与阅读 Editor
  ├ 字体        editor.font / editor.fontSize
  ├ 行为        editor.lineNumbers / editor.markdownDim / editor.autosaveMs / editor.pdfMode
数据与存储 Data
  ├ 读源        data.knowledgeSource / data.blogSource / data.moduleSource（原 storage*，level: experimental）
  ├ 回收站      data.recycleRetentionDays / data.recycleExportDir
  └ 导出        data.exportEncoding / data.exportToastMs
安全与隐私 Security
  ├ 锁屏        security.lockOnStartup / security.lockPassword（danger）
  └ 插件安全    security.pluginLevels / security.pluginRequireSig / security.trustedKeys
AI 工具 AI
  ├ 模型        ai.providers / ai.defaultModel / ai.monthlyTokenBudget / ai.maxTokens / ai.freeModelIds
  ├ 工具        ai.monthlyToolLimit / ai.modulePerms / ai.skillDisabled
  └ 子页        MCP / Skill（内部 tab 沿用）
快捷键 Shortcuts   （命令驱动重构 + 冲突检测；见 §10）
插件 Plugins       （已装插件设置各自成项，Obsidian 式；本项目插件多，优先级高）
关于 About         （版本 / 更新镜像 / 新手引导 / 数据清理 / 检查更新入口）

二期挂账：
  模块设置域（博客总结/日程/打卡提醒/wordbook/quizbook 等业务专属 key）+ 仓库级作用域
```

## 6. Schema 设计

### 6.1 设置项定义（演进 `src/lib/settings.ts`）

```ts
export interface SettingDef<T = unknown> {
  /** UI/文档/API 统一 id（点分：域.组.名）；与内部存储 key 的映射见 §7 */
  id: string
  label: string
  group: string            // 组 id，schema 内注册（含顺序）
  desc: string
  keywords: string[]
  type: SettingType        // 见 6.2
  default: T
  options?: { value: T; label: string; desc?: string }[]   // select/multi
  min?: number; max?: number; step?: number; unit?: string // number/slider
  scope: 'global' | 'repo'           // v1 仅 global，repo 预留灰标
  level: 'normal' | 'danger' | 'experimental'
  affects: 'live' | 'reload'
}
```

### 6.2 控件类型映射（自动表单）

| type | 控件 | 说明 |
|---|---|---|
| `toggle` | Switch | bool |
| `select` | Dropdown（图标/描述行） | 复用现有 SettingSelect 形态 |
| `segmented` | 分段按钮（≤4 档） | 少量互斥偏好（非数值类） |
| `slider` | **数值混合输入**：数字直输 + 步进 ± + 快捷预设 chips + 单位 | 字号/缩放/宽度等长度数值类 |
| `number` | 数值混合输入（无 chips） | 上限/保留天数/延迟等整数类 |
| `text` / `password` | 输入框 | 密码带显隐 |
| `time` | TimePicker | HH:mm |
| `json` | 文本域 + 校验 | activityBar 等高级项 |

> 说明：原"滑杆"并入 `slider`/`number` 的混合输入形态，滑杆不再是独立控件；`segmented` 仅保留给"博客卡片密度"这类**语义档仍在**但底层为数值的偏好（见 §6.4）。

### 6.3 文件结构

- `src/lib/settings.ts`：schema（键名改 id 后 `keyof SETTINGS` 自动派生新 union）；保留 `applyThemeClass` 等工具
- `src/modules/settings/schema/`（可选拆分）：`groups.ts`（域/组注册 + 图标）、`items.ts`（57 项定义）、`search.ts`（从 schema 生成索引与搜索——**替代 sections.tsx 手写索引**，sections.tsx 缩编为壳）
- `src/modules/settings/components/fields/`：按 type 的控件组件

### 6.4 精确数值控制（D7，用户点名需求："可直接输入数字具体控制大小"）

**原则**：一切"尺寸/数值类"设置，用户既可点预设档位，也可**直接输入任意合法数值**——数据模型只有单一数值，档位 chips 只是快捷写入工具，杜绝"档位 vs 自定义"双状态割裂。

**控件形态**（对标 Obsidian 字号/界面缩放）：

```
字号   [ 14 ] px   [-] [+]          ← 数字直输 + 步进（长按连发）
       ·12 ·13 ·16 ·18 ·20          ← 快捷预设 chips（点即写入该数值）
       [↺ 还原默认]                  ← 与全局"已修改/重置"一致
```

**行为规则**：
1. 输入即生效：约 300ms 防抖后写入并应用；不设"确认"按钮
2. 越界防护：`min/max` 由 schema 声明；越界值红边提示 + 不写入 + 保留最后一次合法值
3. 单位透出：`px` / `%` / `ms` / `天` 等随 schema `unit` 展示
4. 聚合密度项：`blogCardSize` / `knowledgeSidebarItemSize` / `scheduleIconSize` 的 s/m/l 档位**保留为快捷预设**（映射到各档像素值），行内透出说明（如"标准 = 行距 3px · 字号 14px"），数值直输作用于其**主变量**（行距或字号，v1 定为字号，见 Q6）；多变量密度后续再拆
5. 保留拖拽记忆的宽度类（`sidebarWidth_*`）在设置页以数值输入呈现当前值

**受影响 key（数值化）**：`editorFontSize`、`zoom`(+%)、`sidebarWidth_*(7)`、`autoSaveDebounceMs`(+ms)、`recycleBinRetentionDays`(+天)、`knowledgeSidebarItemSize`(双轨)、`blogCardSize`(双轨)、`scheduleIconSize`(双轨)、`summaryMonthlyFixedDay`(1-28)、`wordbookNewPerDay`、`aiToolMonthlyLimit`、`monthlyTokenBudget`、`llmMaxTokens`。

## 7. Key 改名与迁移（D4）

- 一期只改**主干域 key**（§5 中列出新旧名的）；模块 key（blog.*/checkinReminder*/wordbook*/quizbookMode/lanShare/assistantWidth/dayPanelState/badgeEgg 等）**保持原名**，二期随迁
- **codemod**：维护 `legacyMap: { oldKey → newId }` 唯一映射；改 settings.ts 定义 + 全仓文本替换（每 key 1:1 机械替换）
- **数据兼容**：`loadSettings()` 读 settings.json 后按 legacyMap normalize 一次再持久化（旧 key 值搬入新 key），无双读窗口
- **免费正确性检查**：`SettingsKey` union 收窄后，任何残留 `update('旧key')` 会被 tsc 报错揪出
- 高风险：334 源文件 ~2361 处文本引用；**按域分批替换，每批 `tsc --noEmit` + build + 冒烟**；沙箱 git 用系统 git 2.37 提交

## 8. 状态可见

- `modifiedKeys`：`useSettings` 内对 diff 默认值维护集合；行内"已修改"标记（●）
- 每项 hover 齿轮 → 单项重置；域视图头/页脚 → 全部重置（confirm）
- 搜索支持 `@modified` / `@danger` / `@experimental` 语法（扩展现有 searchSettings token 解析）

## 9. 搜索增强（保留现有优势）

- 索引源从 schema 自动生成（删除 sections.tsx 手写 SETTING_ITEMS 双源）
- 保留：建议下拉 + Tab 补全 + 命中计数 + 锚点滚动高亮 + `settings:open` 跨模块直达
- 新增：`@` 语法、分组显示命中上下文

## 10. 快捷键页升级（独立子工程）

- 命令驱动：登记全部快捷键命令（现有 6 组全局/模块），列表 + 分组 + 搜索
- 录音式录入（捕获 keydown 序列）+ **冲突检测**（跨命令重复提示）+ 恢复默认
- 存储沿用现有 key 结构，仅 UI 与校验重构

## 11. 作用域（v1 预留，二期落地）

- schema 带 `scope` 字段；v1 全部 global，repo 项显示灰色"仓库"徽标且不可编辑
- 二期：仓库级设置入 `.knowbase/settings.json`（随仓库切换），读取叠加 repo > global

## 12. 一期执行阶段（建议顺序，每阶段独立可验收）

| 阶段 | 内容 | 验收 |
|---|---|---|
| S1 schema 化 ✅（2026-09-03 提交） | settings.ts 66 key 补全元数据（label/type/group/desc/keywords/section/anchor/scope/level/affects/min/max/step/unit，**纯增不改 default/不改名**）；搜索索引改为 schema 自动生成（20 有锚点 key 项）+ 保留 18 功能入口，删除手写双源 | web tsc 29=29 / node 5=5 零新增；settings-schema-smoke 782/782；build 通过 |
| S2 主干域重排 | 建 9 域注册 + 主干 key 归属；左侧导航改域分组；模块 key 暂挂"模块设置（待迁）"隐藏组 | 导航可达所有主干项 |
| S3 改名迁移 | 主干 key codemod + legacyMap normalize | 全仓 tsc 0 错 + settings.json 迁移正确 |
| S4 自动表单 | fields/ 控件库（含 §6.4 数值混合输入） + SettingField 渲染；主干域视图替换手写；已修改/重置 | 主干域零手写视图 |
| S5 增强与收尾 | @ 搜索语法、危险/实验标注、快捷键页重构、插件设置入口、关于页 | 手册级验收清单 |
| 二期 | 模块设置域迁移 + 仓库级作用域 | 待定 |

## 13. 开放问题

1. 新 id 风格是否统一点分小驼峰（`data.knowledgeSource`）？还是部分保留单词（`zoom`→`appearance.zoom`）——按 §7 映射表执行
2. ~~`sidebarWidth_*` 是否升级为可视化拖拽~~ → **已并入 D7**：设置页数值直输 + 保留界面拖拽记忆
3. 插件设置页（D2/D6 提到）一期做到什么粒度：仅列出可点开？——建议一期"列表+跳转插件页详情"，二期独立表单
4. `activityBarOrder/Hidden` 等 JSON 型是否一期进 UI（拖拽排序）？建议挂二期
5. 锁屏（lockOnStartup/lockPassword）放"安全"还是保留高级？草案已归安全，待确认
6. 聚合密度项双轨直输作用于哪个主变量（建议：字号）？s/m/l 各档像素值表需按现状视觉核准

## 14. 相关约定

- 讨论类会话不落业务代码；本设计文档随分支提交，供 worktree 并行会话接力实现
- 验收策略：整批攒清单统一真机验收（沿用 tmp/验收手册-20260903.md 模式）
