# UI 打磨第二轮：仓库切换器迁移 / 侧边栏番茄钟溢出 / 工具箱显隐管理

> 状态：方案文档，**未执行任何代码改动**。日期：2026-09-06
> 承接 `docs/settings-switch-toggle-redesign.md`（第一轮：设置开关统一）。本文档三个改动点相互独立，可分批实施。

---

## 改动点 1：仓库切换按钮迁到编辑区左侧边栏底部

### 1.1 现状（文字描述）

标题栏左侧（macOS 红绿灯窗控、DEV 角标之后）有一个仓库切换按钮：紫色 Layers 图标 + 当前仓库名（如「我的仓库」）+ 下拉箭头，点击弹出下拉面板（最近仓库列表 / 打开其他文件夹 / 在文件管理器中打开 / 重命名 / 新建仓库）。

- 挂载点：`src/components/shared/TitleBar.tsx` **L139** `<VaultSwitcher />`（import 在 L13）
- 组件：`src/components/shared/VaultSwitcher.tsx`（整个组件，169 行）
  - 触发按钮（L96-104）：`h-full` 标题栏高度形态，`max-w-[180px]`，内含 Layers 图标 + 仓库名 + ChevronDown
  - 下拉面板（L106-107）：`absolute left-0 top-full mt-1 w-[280px]`，**向下弹出**

### 1.2 编辑器左侧边栏现状

编辑器侧栏有两种形态，底部都归 `editor/index.tsx` 的 `treeColumn` 管：

| 模式 | 侧栏位置 |
|---|---|
| Workbench 布局开启（`uiWorkbench`） | App.tsx **L614-621** 的全局侧栏槽（220px，仅编辑器 Tab 激活时展开）；编辑器把文件树 portal 进槽（editor/index.tsx **L895-898**，portal 容器 `flex h-full w-full flex-col`） |
| Workbench 关闭（默认） | 编辑器自绘树列 editor/index.tsx **L899** `<div className="flex w-[220px] shrink-0 flex-col border-r ...">` |

`treeColumn` 内部结构：顶部工具行（标题 + 新建按钮）+ `<FileTree>`，整体 `flex flex-col`。

### 1.3 改法

1. **TitleBar.tsx**：删除 L13 的 `VaultSwitcher` import 与 L139 的 `<VaultSwitcher />`。
2. **editor/index.tsx**：在 `treeColumn` 的 `<FileTree>` 之后追加一个底部固定区：

   ```
   <div className="mt-auto border-t border-[var(--border-color)] p-1.5 shrink-0">
     <VaultSwitcher />
   </div>
   ```

   `mt-auto` 把它压到列底；两种模式（portal / 自绘列）都走 `treeColumn`，一处添加两端生效。
3. **VaultSwitcher.tsx 适配改造**（从标题栏件改为侧栏底部件）：
   - 触发按钮：去掉 `h-full`，改为全宽条形按钮（`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md`，高度约 30px），图标 + 仓库名（`truncate` 占满剩余宽度）+ ChevronDown 靠右；外层容器去掉 `h-full ml-2`、去掉 `relative` 上多余的标题栏定位。
   - 下拉面板方向：**从底部向上弹出**——`absolute left-0 bottom-full mb-1 w-[260px]`（原 `top-full mt-1`），否则面板会被侧栏底部裁掉。宽度从 280px 收窄到 260px（220px 侧栏减去内边距后面板不越界；面板允许溢出侧栏右缘则保持 280 也可，执行时二选一，验收标准：面板完整可见不裁剪）。
   - 下拉面板的 `z-[130]` 保留（需盖过文件树）。

### 1.4 行为变化（需要知晓）

- 仓库切换入口**只在编辑器 Tab 可见**（博客/知识库/工具箱等 Tab 及顶部标题栏不再有入口）。这是本次需求的明确取舍。
- 禅模式 Z1+ 会收起侧栏 → 切换器随侧栏隐藏（原有行为，不额外处理）。
- 「每次启动选择仓库」（`startupVaultPicker`）的启动选仓页不受影响，仍走原路径。

---

## 改动点 2：侧边栏番茄钟预设条溢出修复

### 2.1 现状与根因（文字描述）

日程打卡侧边栏（DayPanel，默认宽 300px、最小 240px）的「番茄」Tab 里，一张圆角卡片：顶部状态徽章（如「就绪」）→ 46px 大数字倒计时 → 细进度条 → **预设分段器** → 开始/重置按钮 → 今日专注统计。

安装番茄钟插件扩展后，预设分段器出现 6 个选项：`15min`、`25min`、`45min`、`52-17法`、`90min 深潜`、`考试模拟`。窄面板里横向排不下，flex 不换行导致每个 chip 被压缩，**文字竖排换行**（「52-17法」竖成三行、「考试模拟」竖成四行）， UI 明显破相。

代码链路：

- 渲染处：`src/daypanel/panel/PomodoroPanel.tsx` **L60-74**——分段器容器 `flex gap-1 rounded-lg bg-[var(--bg-tertiary)] p-0.5`（**无 flex-wrap、无滚动、chip 无 nowrap**），chip 为 `px-2.5 py-0.5 text-[11px]`。
- 数据源：`src/modules/toolbox/hooks/PomodoroContext.tsx` **L36-47**——`BASE_PRESETS`（内置 15/25/45 分钟等）+ `getPluginPomodoroPresets()` 追加的插件预设（`src/lib/pluginService.ts` L90-107，读取插件 contributions 里的 `pomodoroPresets`，label/work/break）。插件安装/启禁后经 `plugins-changed` 事件刷新。
- 对照：工具箱全屏番茄钟面板（`toolbox/components/PomodoroPanel.tsx` L38）已有 `flex-wrap max-w-[90%] justify-center`，不溢出；**只有侧边栏这份会破**。

### 2.2 改法（推荐方案：网格化分段器）

把 L60-74 的分段器从「单行 flex」改为「自动换行网格」：

```
容器：flex flex-wrap justify-center gap-1 rounded-lg bg-[var(--bg-tertiary)] p-1
每个 chip：whitespace-nowrap truncate max-w-full px-2.5 py-0.5 text-[11px]（其余选中态样式不变）
```

- 6 个预设 → 约 2 行（3+3 或 4+2 自动分布），chip 保持完整文字不再竖排。
- `whitespace-nowrap` 保证 chip 内文字永远横排；`flex-wrap` 保证整体不溢出。
- 行数随预设数量自适应（插件再加预设也不怕）。
- 同步给 `PomodoroPopoutPanel`（同文件 L113 起的脱离窗口版）检查——它没有分段器，无需改；工具箱全屏版已有 wrap，无需改。

### 2.3 可选加固（不强制）

- `pluginService.ts` L98-103 处对插件预设 label 加最大长度约束（如 >10 字符截断加 `…`），从源头防超长标签。
- 决策：是否给插件预设数量设上限（如 ≤6）。当前渲染兜底已够用，**建议不做硬限制**，仅文档记录。

---

## 改动点 3：工具箱工具显隐管理

### 3.1 现状（文字描述）

工具箱画廊页（`src/modules/toolbox/index.tsx`）分三个区块展示卡片网格（3 列）：

- 「数据工具」`DATA_TOOLS`（L26-63）：体重追踪 / 密码本 / 网址导航 / 数据导出 / 设备传输 / 网页剪藏
- 「效率工具」`PRODUCTIVITY_TOOLS`（L65-96）：番茄钟 / 习惯打卡 / 远程监督 / 单词本 / PDF 工具箱
- 「插件工具」`pluginTools`（L231-262，动态来自 UI 插件贡献）

页头（L214-217）目前只有 `Wrench` 图标 + 「工具箱」文字，无任何管理入口。

### 3.2 改法

#### (a) 新增设置项

`src/lib/settings.ts` 的 `SETTINGS` 表新增一条（先例：`activityBarHidden` L134，同为 JSON 字符串存储）：

```
toolboxHiddenTools: {
  default: '[]', type: 'json',
  label: '工具箱隐藏工具', group: '工具箱',
  desc: '工具箱画廊中隐藏的工具 id 列表（JSON，内置工具用 id，插件工具用 pluginId:toolId）',
  section: 'modules', ui: false,   // 不进设置页，入口在工具箱内
  scope: 'global', level: 'normal', affects: 'live',
}
```

读写走现有 `useSettings()` 的 `s` / `update`（`SettingsContext` 已泛型支持新 key，无需改 Context）。

#### (b) 工具箱页头加管理入口

页头右侧追加一个按钮（`ml-auto`）：

- 图标 `Eye`（或 `SlidersHorizontal`），title「管理显示的工具」；
- 点击弹出 popover（`absolute right-2 top-full` 定位，宽约 240px，`z-50`，外点关闭——实现参考 `VaultSwitcher` 的 pointerdown/Escape 关闭模式）；
- popover 内容：按「数据工具 / 效率工具 / 插件工具」三组列出**全部**工具名，每项右侧放一个开关——**直接复用第一轮方案新增的 `SettingSwitch` 组件**（`src/modules/settings/components/SettingSwitch.tsx`，`size="sm"`），两轮改动互相衔接；
- 开关 = 显示 / 隐藏，改动即写 `toolboxHiddenTools`（`update('toolboxHiddenTools', JSON.stringify(新数组))`），即时生效无需保存按钮。

#### (c) 画廊渲染过滤

- `renderCardGrid` / `renderSection` 前先按 `hidden` 集合过滤：内置工具比对 `tool.id`，插件工具比对 `${t.pluginId}:${t.toolId}`；
- 某分区全部隐藏 → 连同分区标题一起不渲染；
- 三个分区全隐藏 → 显示空态：居中一行文案「所有工具均已隐藏，点击右上角 👁 管理显示」（不放浮夸插图，符合极简偏好）。

### 3.3 语义边界（重要）

- **隐藏 ≠ 卸载**：仅控制工具箱画廊卡片的展示。被隐藏工具的功能与数据完好，其它入口不受影响（如番茄钟在日程侧栏仍有 Tab、习惯打卡在 DayPanel 仍可用）。
- 插件卸载后 `toolboxHiddenTools` 里残留的 `pluginId:toolId` 无副作用（列表中匹配不到即忽略），不做清理。
- 番茄钟卡片（`pomodoro`）隐藏后，`pomodoro:activate` 事件入口仍在（全屏面板逻辑不动）。

---

## 改动点 4：活动栏「编辑器」图标默认排到第一位

### 4.1 现状（文字描述）

主界面最左侧的图标栏（ActivityBar，可拖拽排序、右键显隐）自上而下当前顺序为：博客 / 日程 / 知识库 / 说说 / 编辑器 / Agent / 工具箱 / 插件（底部另有 DEV 开发者工具与用户、设置按钮）。**编辑器图标排在第 5 位**（说说之后、Agent 之前），位于栏位下半部。

代码机制：

- 模块全集：`src/components/shared/ActivityBar.tsx` **L10-19** `ALL_MODULES`（声明顺序即兜底顺序，editor 在第 5 位）；
- **实际顺序由设置项 `activityBarOrder` 决定**（`src/lib/settings.ts` **L133**）：
  - 默认值：`'["blog","schedule","knowledge","moments","toolbox","plugins","export","recycle"]'` —— **里面没有 editor**（也没有 immersive/Agent）；
  - ActivityBar **L51-55**：先按 `activityBarOrder` 过滤排序，再把不在其中的模块（即 editor、immersive）**追加到末尾** —— 这就是编辑器图标沉到底部的原因；
  - 用户拖拽排序后会写回 `activityBarOrder`（L107-120 handleDrop）——即**该设置一旦被持久化，就视为用户自定义顺序**。

### 4.2 改法

1. **改默认值**（settings.ts L133）：`activityBarOrder.default` 改为
   `'["editor","blog","schedule","knowledge","moments","toolbox","plugins","export","recycle"]'`（editor 提到首位，其余不变）。
2. **存量用户迁移**（关键）：默认值只对「从未持久化过该设置」的全新用户生效。已在本地存过 `activityBarOrder` 的用户，其存储值分两种情况处理，迁移逻辑建议放在 ActivityBar 计算顺序之前（或统一放在设置加载处，执行模型二选一，但只做一处）：
   - 存储值 **=== 旧默认串**（未拖拽定制过，只是原样落盘）：直接替换为新默认串并写回；
   - 存储值是**自定义顺序**：一次性把 `editor` 从原位置移动到数组首位后写回（保留其余相对顺序）。
   - 迁移只跑一次：写回的即新顺序，下次启动不再触发（判定条件「等于旧默认串或 editor 不在首位」自然不成立）。
3. `ALL_MODULES` 的声明顺序（L10-19）可顺手把 editor 挪到第一位，保持兜底顺序与默认一致（非必须，实际顺序由设置驱动）。

### 4.3 语义边界

- 只改**活动栏图标排序**，不改启动页：`startupTab` 默认仍是 `'blog'`，打开应用仍先进入博客模块（是否连启动页一起改为 editor 见决策点）。
- 用户此后仍可自由拖拽排序，拖拽写回会覆盖迁移结果，属预期行为。

### 4.4 决策点

1. **已自定义过图标顺序的存量用户**：是「尊重其自定义、不动」（仅改默认值+替换未定制落盘），还是也强制把 editor 移到首位（上文 4.2-2 采用后者）？默认按后者执行，如需更保守可改为只动未定制的。
2. **启动页是否跟随**：要不要把 `startupTab` 默认值从 `'blog'` 改为 `'editor'`？（编辑器成为第一入口的自然配套；不改则仅图标顺序变化。）

---

## 实施顺序与验收

建议顺序：改动点 2（最小，独立修 bug）→ 改动点 1（迁移）→ 改动点 3（新功能，且依赖第一轮的 SettingSwitch 先落地）→ 改动点 4（活动栏排序，含一次性迁移逻辑）。

### 验收清单

**点 1**
- [ ] 标题栏不再有仓库切换按钮；编辑器侧栏底部出现条形切换按钮（Workbench 开/关两种模式下都在底部）
- [ ] 下拉面板向上弹出、完整可见；最近仓库切换 / 打开其他 / 重命名 / 新建功能与迁移前一致
- [ ] 切走侧栏（禅模式 Z1+、切到其他 Tab）不残留浮层

**点 2**
- [ ] 安装番茄钟插件（含 52-17法 / 90min 深潜 / 考试模拟 预设）后，侧边栏预设 chip 全部横排完整显示，自动换行不溢出
- [ ] 卸载/停用插件后恢复单行 3~4 个内置预设；选中态高亮样式不变
- [ ] 240px 最小面板宽度下同样不溢出

**点 3**
- [ ] 页头右侧有管理入口，popover 三组列出全部工具、开关即时生效
- [ ] 隐藏后卡片与分区标题消失；全部隐藏显示空态；刷新页面后隐藏状态保持（设置持久化）
- [ ] 隐藏番茄钟不影响日程侧栏番茄 Tab 与 `pomodoro:activate` 全屏面板
- [ ] `tsc --noEmit` 双 tsconfig 全绿

**点 4**
- [ ] 全新用户（无 activityBarOrder 落盘）：编辑器图标默认排活动栏第一位，其余顺序不变
- [ ] 存量用户按 4.2-2 策略迁移：未定制过 → 整体换新默认；定制过 → editor 提到首位、其余相对顺序保留；迁移只发生一次
- [ ] 拖拽排序仍正常工作，拖后写回的自定义顺序被尊重（不被迁移逻辑二次改动）
- [ ] 右键「显示/隐藏模块」列表不受影响；启动页行为按决策点结论执行
