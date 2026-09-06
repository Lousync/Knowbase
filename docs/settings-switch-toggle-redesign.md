# 设置模块开关（Switch）样式统一改造方案

> 状态：方案文档，**未执行任何代码改动**。两处语义存疑控件已拍板**保留 checkbox**，实际改造 **18 处**。
> 日期：2026-09-06
> 目标：将设置模块中所有「方框勾选（checkbox）」形态的开关项，统一替换为 iOS 风格的「胶囊滑块开关（switch）」。

---

## 一、背景与目标

当前设置页中的布尔设置项全部使用原生 `<input type="checkbox">`（靠 `accent-[var(--accent)]` 染色），视觉上是「小方框 + 对勾」。目标是统一切换为**胶囊滑块开关**：

- 关（off）：灰色/浅色胶囊轨道，白色圆形滑块停在**左侧**；
- 开（on）：主题色（accent）填充的胶囊轨道，白色圆形滑块停在**右侧**；
- 圆角全圆（rounded-full），切换时有平滑滑动动画。

本改造**仅涉及视觉控件替换**，不改任何设置的存储 key、读写逻辑与 IPC。

---

## 二、目标样式规格（纯文字描述，供执行模型实现）

> 执行模型看不到参考图，以下文字即唯一视觉依据。

### 2.1 控件形态

一个纯 `<button>` 元素（不再用 `<input type="checkbox">`），内部包含一个滑块 `<span>`：

```
[ 轨道 track ]：圆角胶囊
  - 尺寸：宽 40px（w-10）、高 22px（h-[22px]，或直接 h-5 ≈20px 亦可，二选一保持全局一致）
  - 圆角：rounded-full
  - 开：背景 bg-[var(--accent)]（项目主题紫，无需写死颜色）
  - 关：背景 bg-[var(--bg-tertiary)]，并带 1px 边框 border border-[var(--border-color)
    ]（与现有关闭态灰底区分开，保证浅色主题下可见）
  - 过渡：transition-colors duration-200

[ 滑块 knob ]：白色圆点
  - 尺寸：16px 见方（w-4 h-4），rounded-full，纯白 bg-white
  - 定位：absolute 垂直居中（top-1/2 -translate-y-1/2），关闭态贴左 left-[3px]，
    开启态位移到右侧（translate-x-[18px]，即 40 - 16 - 3*2 = 18px；若轨道取 w-9 h-5
    则位移 translate-x-4）
  - 过渡：动画必须能生效 —— Tailwind v4 的 translate-x-* 走的是 translate 属性而非
    transform，因此过渡类写 transition-[translate] 或直接 transition-all，不要只写
    transition-transform（历史坑：本项目曾出现 transform 类过渡不生效/transitionend
    不触发的问题）。同时禁止在 JS 里监听 transitionend 做任何逻辑。
  - 开启态可加轻微投影 shadow-sm 增强立体感
```

### 2.2 交互与可访问性

| 项 | 要求 |
|---|---|
| 语义 | `role="switch"` + `aria-checked={checked}` |
| 点击 | 点击按钮任意位置切换；**外层 `<label>` 包裹时点击文字也要能切换**（button 是 labelable 元素，label 点击会转发到内部 button，改造后需逐处手测确认） |
| 键盘 | button 原生支持 Enter / Space，无需额外处理；补 `focus-visible:ring-2 ring-[var(--accent)] ring-offset-1` 焦点环 |
| 禁用态 | `disabled` 时整体 `opacity-40 cursor-not-allowed`，保留当前开/关颜色 |
| 尺寸 | 默认上述规格；紧凑场景（下拉面板/列表行内）提供 `size="sm"`：轨道 w-8 h-[18px]、滑块 w-3.5 h-3.5、位移 12px |

### 2.3 参考实现

项目内已有一处同款开关可直接对齐规格：`src/modules/toolbox/components/remote-supervise/index.tsx` 第 48-61 行的本地 `Toggle` 组件（w-9 h-5 轨道 + translate-x-4 滑块）。

**建议**：把该规格抽成共享组件 `src/modules/settings/components/SettingSwitch.tsx`（props：`checked`、`onChange`、`disabled?`、`size?: 'md' | 'sm'`），设置模块 18 处布尔开关全部引用它（密钥多选列表、命令执行确认勾选 2 处保留 checkbox，见 §4）；toolbox 那处本次不动（不在设置范围内），后续如需统一再迁移。

---

## 三、改动点清单（7 个文件涉及 20 处 checkbox，其中 18 处改造、2 处保留，逐点标注）

> 行号为 2026-09-06 当前代码行号，执行时以「文件 + 设置项文字」定位为准。

### 3.1 `src/modules/settings/views/SecurityView.tsx`（设置 → 安全，共 5 处）

第 1-4 处即截图「删除确认」区块（`data-setting-anchor="advanced.deleteConfirm"`），四行均为 `label.flex.items-center.justify-between`（左文字、右 checkbox）：

| # | 行号 | 界面文字 | 绑定状态 | 布局 |
|---|---|---|---|---|
| 1 | L35-37 | 跳过博客删除确认对话框 | `s.skipDeleteConfirm_blog` | 文字左 / 控件右 |
| 2 | L41-43 | 跳过知识库页面删除确认对话框 | `s.skipDeleteConfirm_knowledge` | 同上 |
| 3 | L47-49 | 跳过目录/笔记本删除确认对话框 | `s.skipDeleteConfirm_knowledgeCategory` | 同上 |
| 4 | L53-55 | 跳过章节删除确认对话框 | `s.skipDeleteConfirm_chapter` | 同上 |
| 5 | L105-107 | 市场插件强制签名校验（`security.pluginSignature` 区块） | `s.pluginRequireSignature` | 文字左 / 控件右 |

改法：把 `<input type="checkbox" ... className="accent-...">` 整体替换为 `<SettingSwitch checked={...} onChange={() => ...} />`。onChange 回调逻辑原样保留（注意第 5 处现在是 `e.target.checked`，换成开关后改为 `!当前值` 或在组件外取反）。

### 3.2 `src/modules/settings/components/SettingsDropdown.tsx`（主界面顶栏齿轮快捷下拉，共 4 处）

紧凑下拉面板（行高小、字号 11px），**建议用 `size="sm"` 开关**：

| # | 行号 | 界面文字 | 绑定状态 |
|---|---|---|---|
| 6 | L89-91 | 显示行号 | `s.showLineNumbers` |
| 7 | L106-108 | 跳过博客删除确认 | `s.skipDeleteConfirm_blog` |
| 8 | L112-114 | 跳过知识库页面删除确认 | `s.skipDeleteConfirm_knowledge` |
| 9 | L118-120 | 跳过目录/笔记本删除确认 | `s.skipDeleteConfirm_knowledgeCategory` |

### 3.3 `src/modules/settings/views/GeneralView.tsx`（设置 → 通用，共 2 处）

这两处是**checkbox 在左、说明文字在右**（`label.flex.items-start.gap-2.5`，checkbox 带 `mt-0.5`），与其它处布局相反。改开关后建议顺手调整为与全模块一致的「文字左 / 开关右」（`justify-between`），两行结构：

| # | 行号 | 界面文字（含多行说明） | 绑定状态 |
|---|---|---|---|
| 10 | L19-27 | 「每次启动选择仓库」+ 说明段（`startup.vaultPicker` 区块） | `s.startupVaultPicker` |
| 11 | L58-66 | 「启用 Workbench 布局」+ 说明段（`advanced.workbench` 区块） | `s.uiWorkbench` |

### 3.4 `src/modules/settings/views/EditorView.tsx`（设置 → 编辑器 →「显示」区块，共 2 处）

| # | 行号 | 界面文字 | 绑定状态 | 布局 |
|---|---|---|---|---|
| 12 | L56-58 | 显示行号 | `s.showLineNumbers` | checkbox 左 / 文字右 |
| 13 | L63-65 | Markdown 标记淡化（光标行保留原始标记） | `s.markdownDim` | 同上 |

改开关后统一为文字左 / 开关右。

### 3.5 `src/modules/settings/views/ReminderView.tsx`（设置 → 提醒，共 1 处）

| # | 行号 | 界面文字 | 绑定状态 |
|---|---|---|---|
| 14 | L26-31 | 启用打卡提醒（带边框卡片行，左图标+文字、右 checkbox） | `s.checkinReminderEnabled` |

注意：该开关关闭时下行「提醒时间」输入框会 disabled——逻辑不动，仅换控件。

### 3.6 `src/modules/settings/views/AiModelsTab.tsx`（设置 → AI 模型，共 2 处）

| # | 行号 | 位置描述 | 绑定状态 | 说明 |
|---|---|---|---|---|
| 15 | L199-200 | 供应商卡片头部行右侧（Bot 图标 + 名称 + 类型徽章行，`ml-auto`） | `p.enabled`，onChange 走 `llmToggleProvider` 异步 | 换开关，onChange 里 `!p.enabled` 逻辑保留 |
| 16 | L392 | 「选择密钥」多选列表：每个密钥一行的行首 checkbox（勾选集合 `checked.has(it.id)`） | 多选集合 toggle | ✅ **已拍板：保留 checkbox 原样，本次不改** |

### 3.7 `src/modules/settings/views/AiToolsView.tsx`（设置 → AI 工具，共 3 处）

| # | 行号 | 位置描述 | 绑定状态 | 说明 |
|---|---|---|---|---|
| 17 | L323 | MCP 服务器卡片头部行右侧（`ml-auto`，名称+transport 徽章+工具数同一行） | `sv.enabled` | 换开关 |
| 18 | L474 | 添加「命令执行」类型服务器表单内：checkbox 在左、文字「我了解将执行此命令」在右 | 本地 state `confirmCommand` | ✅ **已拍板：保留 checkbox 原样，本次不改** |
| 19 | L716 | Skill 列表条目行右侧，checkbox 后跟「启用/停用」文字标签 | `!s.disabled`（checked = 启用） | 换开关；右侧「停用/启用」小字标签建议保留，开关开启态 = 启用 |

### 3.8 汇总

| 文件 | checkbox 处数 | 本次改造 | 保留 |
|---|---|---|---|
| SecurityView.tsx | 5 | 5 | 0 |
| SettingsDropdown.tsx | 4 | 4 | 0 |
| GeneralView.tsx | 2 | 2 | 0 |
| EditorView.tsx | 2 | 2 | 0 |
| ReminderView.tsx | 1 | 1 | 0 |
| AiModelsTab.tsx | 2 | 1 | 1（#16 密钥多选） |
| AiToolsView.tsx | 3 | 2 | 1（#18 命令执行确认） |
| **合计** | **20** | **18** | **2** |

另有 1 处相关但不属于设置模块：`toolbox/remote-supervise` 的本地 Toggle（已是开关形态，仅建议后续与 SettingSwitch 合并，本次不改）。

---

## 四、决策记录

1. **AI 模型密钥多选列表（#16，AiModelsTab L392）**：多选语义非二态开关 → **已拍板（2026-09-06）：保留 checkbox 原样，本次不改**。
2. **命令执行确认勾选（#18，AiToolsView L474）**：高危确认语义 → **已拍板（2026-09-06）：保留 checkbox 原样，本次不改**。
3. **GeneralView / EditorView 的左右布局**：checkbox 在左的 4 处（#10、#11、#12、#13）换开关时，**已拍板（2026-09-06）：统一改为「文字左、开关右」**（`justify-between`），与全模块形态一致。

---

## 五、实施顺序建议

1. 新建 `SettingSwitch.tsx` 共享组件（含 md/sm 两档尺寸、disabled、focus ring）。
2. 先改 `SecurityView.tsx`（即截图区块，效果最直观）→ `SettingsDropdown.tsx` → `GeneralView / EditorView / ReminderView`。
3. 再改 `AiModelsTab / AiToolsView`（涉及异步 onChange，改完手测切换、失败回滚提示）。
4. 全量 `tsc --noEmit -p tsconfig.web.json` 过门禁 + `npm run dev` 手测。

## 六、验收清单

- [ ] 设置 → 安全「删除确认」4 项 + 签名校验项均为胶囊开关，开=主题紫、关=灰底描边
- [ ] 顶栏齿轮下拉中 4 项为 sm 尺寸开关，不撑破面板行高
- [ ] 点击行文字（label 区域）也能切换开关
- [ ] 键盘 Tab 聚焦有焦点环，Enter/Space 可切换
- [ ] 打卡提醒关闭时「提醒时间」仍正确禁用；MCP 服务器/Skill/供应商开关切换功能与改造前一致
- [ ] AI 密钥多选列表、命令执行「我了解将执行此命令」确认勾选保持 checkbox 原样未变
- [ ] 滑块位移动画平滑生效（浅色主题下重点看关闭态轨道可见性）
- [ ] `tsc --noEmit` 双 tsconfig 全绿
