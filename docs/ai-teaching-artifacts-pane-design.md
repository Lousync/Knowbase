# AI 教学 · 工件栏与 AI 示意图生成（visual.html）设计

> 状态：方案定稿（2026-09-09 用户确认「就是这样的效果」）· 待排期实现
> 2026-09-09 合并：并入 `​.claude/plans/ai-teaching-html-diagram-render.md` 的 HTML 渲染层与安全规格（新增 §4），生成链路以本文 visual.html 工具为准，原 kb-html 围栏方案作废（与「HTML 正文永不进对话流」口径冲突，裁决见 §4.1）
> 原型：`docs/prototypes/ai-teaching-right-artifacts.html`（可交互）
> 关联：`docs/ai-teaching-module-rework.md`（主纲，建议编 P9）· `docs/ai-teaching-sources-panel-rework.md`（素材库右栏改造，本文 §1.3 有交集说明）

## 1. 背景与决策链

### 1.1 决策过程

1. 初始问题：中栏「docView > reader > quiz > 对话」三态互斥（`index.tsx` L1522-1607），看材料即丢对话。
2. 曾定「伴读分屏」方向（材料左主区 + 对话右伴读栏，原型 `ai-teaching-companion-split.html`）。
3. **2026-09-09 用户参照 WorkBuddy 自身模式拍板改版：对话固定左主区（永不替换），材料/产物/示意图开进右侧工件栏，页签条目切换。**伴读分屏方向作废，原型留档。

### 1.2 布局定稿

```
顶栏（不变：工作区 chip + 会话页签 + 工具组）
├─ 左：对话主区（flex-1，永不替换；💬对话 / 📝题目 chips + 消息流 + 输入区）
├─ 中：分隔条（可拖 24%~60%，双击复位，宽度持久化）
└─ 右：工件栏（新增，默认开 46%，开合纯内容驱动①）
    ├─ 页签条：icon + 名称 + ✕ 关闭；溢出横向滚动；激活态高亮
    ├─ 工具条：落盘路径 + ↗编辑 + ⟳ + ✕关闭
    └─ 内容区：md 渲染 / HTML 示意图预览 / 生成中占位页签
```

> ① 2026-09-09 实现期拍板（用户）：**不设「⇤ 收起 / ‹ 工件把手」等任何手动开合控件**——有页签即渲染、关完全部页签即消失；原「可折叠⇤，右缘『‹ 工件』把手唤回」作废（与素材库右缘拉出条体验冲突）。`aiTeach.artCollapsed` 键随之废弃，仅 `aiTeach.artWidth` 保留。

退役关系：中栏 docView 分支整体迁入工件栏；「← 返回对话」按钮消失（对话本就常驻）。

### 1.3 与素材库右栏的并存（⚠ 待拍板）

模块现有右栏是素材库（240-420px，改造方案见 `ai-teaching-sources-panel-rework.md`），与工件栏同为右侧。**并存口径（2026-09-09 用户拍板）**：

- 双右栏并存：工件栏紧贴对话（教学主视图），素材库窄栏在其右
- **工件栏展开（"双窗口"）时，素材库自动收起**（贴边条态，沿表现有 ResizablePanel 折叠动画）；工件栏折叠/关闭时素材库自动恢复
- 自动收起**不改用户意图态**：素材库记录 `aiTeach.srcUserIntent`（open/closed），自动收起与恢复都按意图执行；工件栏开着时用户仍可手动点贴边条展开素材库（尊重用户，两者允许短暂同屏）
- 空间不足兜底：窗口宽度 < 1100px 时工件栏自动降宽至 40%，仍不足则素材库维持收起

### 1.4 各类视图去向

| 视图 | 现状（中栏互斥） | 新去向 |
|------|------------------|--------|
| docView（讲义/提取稿/报告 md） | 替换中栏 | 工件栏页签 |
| reader（pptx 逐页阅读） | 替换中栏 | 工件栏页签（页码即内容，无需独立页签态） |
| quiz 题目列表 | 替换中栏 | 保留在对话区 chips 切换（占中栏，现状不变） |
| quiz 答题模式 | 全屏覆盖 | 保持独占（专注答题） |

## 2. 工件栏交互规格

- **页签**：最大宽 170px 截断；中键/✕ 关闭；关闭激活页签后自动右移激活；「生成中」占位页签禁止关闭
- **生命周期**：页签列表为会话内存态；切会话清空（与现状 `setDocView(null)` L484 口径一致）；**阅读位置记忆保留**（`docScrollPos` per-rel，L1541）
- **持久化**：栏宽 `aiTeach.artWidth`（localStorage）；无折叠态（开合由页签存在与否驱动，见 §1.2①）；页签列表不持久化（切会话的「上次工件」恢复仍走 `aiTeach.nav.*`）
- **工件卡（对话流唯一形态）**：一行卡 = icon + 名称 + 落盘路径 + 行数，点击开页签；HTML 正文永不进对话流（延续 P8 协议块收敛方向）
- **打开来源**：① AI 回复工件卡 ② 快捷 chip/输入指令 ③ 素材库条目按钮（原件/提取稿改开工件栏页签）

## 3. AI 示意图生成（visual.html 工具）

> 工具定义、生成时序见本节；**渲染层与安全策略见 §4**（合并自原 HTML 图示渲染方案）。

### 3.1 工具定义（ToolRegistry builtin 类）

```ts
name: 'visual.html'
desc: '生成单文件 HTML 示意图辅助讲解，写入会话 visuals/ 目录并自动在工件栏打开'
params: {
  slug:  string   // 文件名（kebab-case，如 parabola-open-width）
  title: string   // 示意图标题（中文名，工件卡与页签展示）
  html:  string   // 完整 HTML 全文
}
result: { relPath: string, lines: number }
```

- HTML 全文经参数传递，主进程负责写盘与路径安全（复用 pathGuard 口径）；返回 `relPath` 供轨迹与工件卡引用。
- AgentRunner 轨迹记录该调用（kind=tool，`visual.html`）；生成期间 live step 显示「正在生成示意图…」。

### 3.2 生成门槛与约束（系统提示注入 + 工具描述双保险）

**双路触发（已拍板）**：AI 讲解中判断命中门槛可主动生成；用户随时指令「画个示意图 / 图示一下」强制生成。

主动生成门槛——仅四类内容值得画：① 抽象概念（需具象化）② 过程/演变（有先后）③ 结构/对比（多对象关系）④ 函数图像/几何图形。纯文字够用的不画。

产物约束：单文件自包含、无外部依赖（不引 CDN/网络图片）、≤150 行、示意而非网页（无交复杂交互/多页）、中文标注、画幅适配右栏宽度（建议 680×400 比例 SVG 为主）。

### 3.3 落盘与版本

- 路径：`SOURCES/{对话}/visuals/<slug>.html`，与 SOURCE.md 同目录体系
- 重生成**不覆盖**：`<slug>-v2.html`、`-v3.html` 递增；工件卡可多张并存
- 示意图为生成产物，**不登记 SOURCE.md**、不参与素材注入；跨会话复看走文件树 visuals/ 目录

### 3.4 生成时序（三端同步）

1. 用户发送/AI 决定生成 → 对话流 typing 显示「正在调用 visual.html」
2. 工件栏同步开「生成中…」占位页签（禁止关闭，给即时反馈）
3. 工具返回 → 占位页签原地换内容（标题/路径更新）+ 对话流落一张工件卡 + toast

## 4. HTML 渲染层与安全规格（合并自原 kb-html 方案）

### 4.1 渲染载体裁决

- **作废**：原方案的 ` ```kb-html ` 对话流围栏（HTML 全文进消息文本）——与工件栏口径「HTML 正文永不进对话流、工件卡是唯一形态」（§2）直接冲突，且长 HTML 污染消息存储与 LLM 历史回放。
- **采纳**：AI 产 HTML 只走 `visual.html` 工具 → 落盘 → 工件栏页签预览；生成源文本不进 `agent-messages.json`（本就在工具参数侧，天然收敛）。
- 讲解文档（md）中如需引用示意图，用相对链接指向 `visuals/<slug>.html`，点击即在工件栏开页签（复用 §2 打开来源③的机制），不做文档内嵌 iframe（一期）。

### 4.2 ArtHtmlView 组件（工件栏内容区 HTML 类型页签）

新文件 `src/modules/ai-teaching/ArtHtmlView.tsx`：

- 内容获取：`workspaceReadFile(rootId, relPath)` 读磁盘全文 → `<iframe srcDoc={injected} sandbox="allow-scripts">`。
  不注册新协议、不走 file://——路径安全已由工具侧 pathGuard 保证，读内容与 md 页签同一条 IPC。
- ⟳ 刷新 = 重读文件重挂 iframe（编辑器改完保存 → 点刷新即见，§2 工具条已有 ⟳）。
- `key` 绑定 `relPath + 文件 mtime/hash`，内容未变不重挂。
- 「↗ 编辑」沿用工具条现有按钮（kb-open-in-editor 事件，from:'aiTeaching' 返回 chip 机制不变）。

### 4.3 沙箱安全红线（不可妥协项）

| 威胁 | 对策 |
|---|---|
| 生成脚本触达宿主 window/preload IPC 桥 | `sandbox="allow-scripts"`，**绝不加 `allow-same-origin`**（不透明源即隔离） |
| 外链追踪 / 加载远端脚本 | srcDoc 头部注入 `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:">`（禁 eval、禁一切网络请求） |
| iframe 内导航劫持工件栏 | sandbox 天然无 `allow-top-navigation`；兜底监听 `e.source===frame.contentWindow` 之外的消息一律忽略 |
| 资源/高度耗尽 | 高度钳制 §4.4；文件 >150 行时页签顶部黄条提示「超出产物约束，渲染可能不佳」（AI 约束由 §3.2 提示词保证，此处仅提示不拒绝） |
| XSS 于源码视图 | 源码以高亮代码块展示（React 转义），不用 innerHTML |

与 AnimEmbed（`MarkdownPreview.tsx:436-462`）同模式，但后者服务插件内容包，本组件服务用户仓库文件——两者共用一个 `injectCspShell(html)` 工具函数即可。

### 4.4 尺寸与主题适配

- 高度：注入脚本 `ResizeObserver → parent.postMessage({__kbArtH: h}, '*')`，宿主按 `e.source` 校验后设定 iframe 高，钳制 [120, 4000]px，超限工件栏内容区自身滚动；
- 宽度：跟随工件栏（分隔条可拖 24%~60%），iframe `width:100%`；AI 按 §3.2 画幅约束生成，重排自适应；
- 主题：注入时把应用 CSS 变量当前值（`--bg-primary/--text-primary/--accent` 等）展开为 iframe 内 `:root{}` 内联声明，图随明暗主题走；生成失败（iframe 报错兜底）→ 占位框 + 「查看源码」按钮。

## 5. 落地改动点

1. `src/modules/ai-teaching/index.tsx`：
   - 中栏 docView 分支（L1524-1557）迁出 → 新增工件栏组件（页签条 + 工具条 + 内容区 + 分隔条拖拽，复用 `ResizablePanel` 或自实现宽度持久化）
   - `openDocView`/`openPptxReader` 改为 `openArtTab(id)`；素材库条目「原件/提取稿」按钮改开页签
   - reader 逐页阅读状态并入页签内容
2. `electron/lib/aiTools.ts`（builtin 工具注册处）：新增 `visual.html` 工具 + 写盘逻辑（pathGuard 校验会话目录内）
3. `src/modules/ai-teaching/ArtHtmlView.tsx`（新增，§4.2）：读文件 → srcDoc 沙箱 iframe + CSP/主题/高度注入（§4.3/4.4），工具条 ⟳/↗ 接线
4. AI 教学系统提示：注入「示意图门槛 + 约束」段（§3.2）
5. quiz 答题独占、题目列表 chips、素材库注入口径均不动
6. 动画：页签切换内容 `fadein 280ms cubic-bezier(0.22,0.68,0.32,1)`；生成占位 ring spinner（与原型一致）
7. 双右栏联动：工件栏开→素材库自动收（一次折叠动画）；工件栏关→按 `srcUserIntent` 恢复；意图态与 `aiTeach.rightWidth` 持久化并存

## 6. 验收清单

- [ ] 对话全程可见：打开/关闭/切换任意工件，左栏对话滚动位置不丢
- [ ] 页签：开 5+ 工件溢出可滚、关闭激活页签自动转移、生成中页签不可关
- [ ] visual.html 全流程：指令生成 → typing → 占位页签 → 内容落地 → 工件卡点击复开
- [ ] 重生成同主题 → `-v2.html` 落盘、旧图页签不受影响
- [ ] pptx 逐页阅读进工件栏后，「讲当前页」类对话联动不回归
- [ ] 切会话清页签、栏宽/折叠态记忆保持
- [ ] 工具参数含越权路径（`..`/绝对路径）被 pathGuard 拒绝
- [ ] 双右栏联动：工件栏展开时素材库自动收起；关闭工件栏素材库按意图恢复；手动展开素材库后不被强制收回
- [ ] 窄窗（<1100px）下工件栏降宽、素材库维持收起，无横向溢出
- [ ] AI 主动生成门槛：纯文字可答的问题不触发工具（抽查 10 轮）
- [ ] 安全抽查：生成的图内 `fetch('https://…')` 被 CSP 拦、`parent.document` 访问抛跨源异常、iframe 内链接无法导航宿主（§4.3 全表逐项验证）
- [ ] 渲染自适应：拖分隔条改变栏宽 → 图重排无横向滚动条；明暗主题切换 → 图配色跟随；⟳ 在编辑器改文件后刷新即见
- [ ] 高度钳制：构造超高图（body 99999px）→ 工件栏内容区自身滚动、无布局崩坏
- [ ] 兜底：HTML 破损/脚本抛错 → 占位框 +「查看源码」代码块可见（不白屏）
