# AI 学堂 · 实现方案（ai-learn-center）

- 日期：2026-09-10
- 状态：**部分已落码，主体待拍板**（2026-09-12 按代码现况校正）
  - ✅ §7.3 / §7.5 帮助文档体系已落码：帮助文档迁至项目根 `resources/help/`（23 篇），主进程 `electron/lib/helpService.ts` 只读检索 + `electron/lib/builtinTools.ts` 的 help 工具已上线，渲染层与主进程读同一份
  - ⏳ AI 学堂中心界面（学习路径 / 进度 / 底栏）未实施，仍是方案稿 → 本文档留在主仓库，不归档
- 关联：`docs/prototypes/ai-learn-center.html`（已确认原型）、`docs/onboarding-rework-design.md`、`docs/ai-teaching-module-rework.md`
- 类型：UI/UX + 主进程能力新增（含帮助文档体系重构）

---

## 1. 目标

1. 侧栏 AI 问答可**原地扩张**为全屏「AI 学堂」，扩张/回缩动画与原型一致（流畅、无重排抖动）。
2. AI 学堂 = **上手路径 + 对话 + 帮助** 三页签，把一次性新手教程改造成可继续、可找回的任务线。
3. AI 能真正回答「这个软件怎么用」——补上当前完全缺失的软件知识供给。

非目标（本期不做）：不改会话存储结构、不动 AgentRunner 工具循环、不做多窗口（不新开 Electron BrowserWindow）。

---

## 2. 现状核对（已读代码，2026-09-10）

### 2.1 三个组件的真实职责

| 对象 | 位置 | 规模 | 现状 |
|---|---|---|---|
| 侧栏 AI | `src/components/shared/AssistantPanel/index.tsx` | 809 行 | 全局悬浮层，`fixed right-0 top-[48px] bottom-10`，宽 320–520 可拖，<320 松手 = snap 关闭；Ctrl+J 开关；`ai-assistant:toggle` 事件入口；含会话抽屉 / 选区问 AI / 划词翻译 / trace / 改动清单。**无扩大能力** |
| 新手引导 | `src/components/shared/Onboarding.tsx` | 253 行 | 首启 6 步全屏图文，一次性；完成写 `onboardingDone` |
| 帮助模块 | `src/modules/help/` | 19 篇 md / 30 KB | 渲染层 `import.meta.glob('./docs/*.md', {query:'?raw'})` 加载 |

入口按钮在 `src/App.tsx:710`（右下悬浮圆钮，`aiTeaching` 激活时隐藏）。

### 2.2 ⚠️ 关键发现 A：AI 现在完全看不到「软件知识」

`electron/lib/agentService.ts:206` 的 `SYSTEM_PROMPT_BASE` 只有 7 条行为规则：

```
你是本地知识管理应用 Knowbase 内置的 AI 助手。
你可以调用工具读写用户的本地数据……
1. 需要数据时先调工具，不要编造； … 6. 本次请求可用的工具列表以系统提供的 tools 为准
```

**没有任何一句话描述这个软件怎么用**：没有模块清单、没有读写分工、没有 frontmatter id / 草稿机制、没有权限模型、没有快捷键。20 个内置工具（`builtin.knowledge.search` … `builtin.vault.trash` / `visual.html`）全是数据操作与网络，**没有一个是"软件使用帮助"**。

后果：今天的 AI 无法回答「知识库为什么看不到我的文件」——它只能去读磁盘、猜机制。这正是用户第 2 个问题的根因，不是"文档不够详细"而是**文档根本没进入 AI 视野**。

### 2.3 ⚠️ 关键发现 B：帮助文档主进程读不到

`src/modules/help/docsLoader.ts:39` 用 `import.meta.glob('./docs/*.md', { query: '?raw' })`——**编译期打进 renderer bundle**。打包后主进程（`app.asar` 里的 `out/main/`）无法访问这批文件，`process.resourcesPath` 下也没有它们（`package.json` 的 `extraResources` 只打了 `builtin-plugins` / `dict` / `clipper-extension`）。

所以：**即使把 19 篇写到一万字，AI 也一个字看不到**。要喂给 AI，必须先解决"文件放哪"。

### 2.4 可复用的既有机制（这是本方案成本可控的原因）

| 机制 | 位置 | 复用方式 |
|---|---|---|
| **按需工具装载** `tier:'core'\|'ondemand'` + `builtin.tool.request` | `electron/lib/aiTools.ts:43`、`builtinTools.ts:645` | 手册检索工具挂 `core`，长文按需 |
| **每轮重读的提示词注入** `resolveXxxForInjection(sessionId, getSettingReader)` | `aiTeachingProfile.ts:248`、`aiTeachingFolders.ts`、`aiTeachingSources.ts`；注入点 `agentService.ts:302-363` | 新增同构的 `resolveLearnHintForInjection()` |
| **上下文感知** `getAssistantContext()` / `selectionContext()` / `registerSelectionAskHost()` | `src/lib/assistantContext.ts` | 「当前第几步」直接作为 context 传主进程，**零主进程改动** |
| **资源目录运行时解析** | `dictionaryService.ts:31`：`app.isPackaged ? process.resourcesPath : app.getAppPath()` | 手册目录照抄这套 |
| **跨模块跳转** `onSwitchTab` / `editor:open` / `pendingOpenRel` / `help:open` | `App.tsx`、`editor/index.tsx` | 教程「动手做」按钮直接复用 |
| **Skill 提示词包** `SKILL.md`（frontmatter + 正文模板） | `electron/lib/skillService.ts` | **不采用**（skill 是被模型主动调用的能力包，不是常驻知识；见 §7.5 说明） |

---

## 3. 交互与形态（原型已确认）

### 3.1 状态机

```ts
type AiSurface = 'hidden' | 'sidebar' | 'full'
type FullTab   = 'learn' | 'chat' | 'help'

// 单一状态源（AssistantPanel 内）
surface: AiSurface
fullTab: FullTab
returnTo: 'hidden' | 'sidebar'   // 进入 full 前的形态，决定 ⤡ 缩回去哪
```

| 触发 | 迁移 |
|---|---|
| Ctrl+J / `ai-assistant:toggle` | `hidden ⇄ sidebar`（保持现状语义） |
| 侧栏头部 ⊞（新增） | `sidebar → full`，`fullTab='learn'`，`returnTo='sidebar'` |
| ActivityBar AI 学堂图标（可选，§12-D3） | `hidden → full`，`returnTo='hidden'` |
| 全屏头部 ⤡ 缩回 | `full → returnTo` |
| 全屏头部 ✕ | `full → hidden` |
| Esc | 先关会话抽屉 → 再 `full → returnTo` → 再 `sidebar → hidden` |
| Ctrl+Shift+J | `full ⇄ returnTo`（快速切换，标题栏 tooltip 同步） |

**会话零迁移**：三个形态共用同一份 `activeId / messages`（数据在 `agentSessionRepo`，天然共享）。扩张不重载会话、不重置滚动位置。

### 3.2 扩张范围与层级

扩张区域 = **活动栏右侧全部**（含任务栏 DayPanel 区域），保留标题栏与活动栏。

理由：AI 学堂是长时间停留的工作台；一刀切盖住活动栏后，想切去编辑器必须先退出全屏，往返成本过高。禅模式（Z2+）已有"全部收起"的语义，不必重复。

```
z 层级（现状 → 目标）
  TitleBar        z-[75]          不动
  QuickSearch     z-70 / z-50     不动
  AI 学堂全屏层   z-[45]    ← 新增（压住 z-40 侧栏、z-30 浮钮）
  AssistantPanel  z-40            不动
  AI 悬浮圆钮     z-30            不动
```

定位：`top: 36px`（`h-9` 标题栏）→ `bottom: 0`；`left` 需避开活动栏：

```ts
// ActivityBar 实际占位 = w-14(56px) + 非最大化时 mx-1.5(6px) × 2
const shellLeft = flush ? 56 : 68          // flush = winMax
// 由 App.tsx 以 prop 或 CSS 变量 --shell-left 透传
```

> 备选（§12-D1）：`left: 0` 全覆盖。改动量为去掉 `shellLeft` 一处。

### 3.3 三页签

| 页签 | 左栏 236px | 中栏 | 右栏 |
|---|---|---|---|
| **上手路径** | 6 步清单（✓ / 当前 / 待做）+ 进度 | 讲义 + 「动手做」+ 上一步/下一步 | AI 对话 366px（跟随当前步骤） |
| **对话** | 会话列表（新建 / 切换 / 删除） | 消息流（max 760 居中） | 上下文 / 本对话 / 模块权限 / 本次改动 262px |
| **帮助** | 文档目录（入门 / 功能手册 / 常见问题） | 文档正文 | 就本篇提问 |

页签切换策略：**中栏 + 右栏重渲染，左栏保持**（左栏在三个页签间形态一致，切换时不动可减少 60% 的视觉跳变）。

---

## 4. 平滑动画实现（重点）

原型观感已确认，实现时按下面这套来，别用"看起来也行"的替代写法。

### 4.1 三条原则

1. **尺寸动画用 `width`/`left`，绝不用 `transform: scale`** —— scale 会拉伸文字、压缩内部布局，观感完全不同。
2. **内容切换用 opacity 交叉淡入，绝不用 `display: none/block`** —— 后者会在动画首帧瞬间跳变（宽度还没变，内容已经换了）。
3. **昂贵的全屏布局不参与逐帧 reflow** —— 三栏结构在动画期间用 `contain: layout paint` 隔离。

### 4.2 时序（总时长 320ms）

```
t=0ms    容器 width 380px→100%（320ms / cubic-bezier(.22,.68,.32,1)）
t=0ms    侧栏内容 opacity 1→0（120ms）
t=60ms   全屏左栏   opacity 0→1（180ms）  ┐
t=110ms  全屏中栏   opacity 0→1（180ms）  ├ 阶梯淡入 = "铺开"的层次感
t=160ms  全屏右栏   opacity 0→1（180ms）  ┘
t=320ms  动画结束 → 解除 pointer-events 屏蔽、放开尺寸拖拽
```

回缩 = 相反顺序（右 → 中 → 左 → 侧栏），总时长 280ms（退场略快，手感更利落）。

### 4.3 实现要点

```tsx
// 容器：过渡属性显式列举，不要用 Tailwind 的 transition-all
<div
  className={cn(
    'fixed z-[45] flex flex-col border-l border-[var(--border-color)] bg-[var(--bg-primary)]',
    animating && 'pointer-events-none',
  )}
  style={{
    top: 36, bottom: 0,
    left: surface === 'full' ? shellLeft : 'auto',
    right: 0,
    width: surface === 'full' ? `calc(100% - ${shellLeft}px)` : `${savedWidth}px`,
    transition: 'width 320ms cubic-bezier(.22,.68,.32,1), left 320ms cubic-bezier(.22,.68,.32,1)',
    contain: animating ? 'layout paint' : undefined,
  }}
>
```

- **动画结束用定时器兜底，不要用 `transitionend`**：Tailwind v4 下过渡属性名可能是 `width` / `translate`，历史上已踩过"事件不触发导致遮罩常驻挡点击"的坑（`AssistantPanel` 抽屉关闭那段注释就是证据）。
- **两套内容常驻 DOM**（侧栏版 + 全屏版），靠 opacity + `pointer-events` 切换，不卸载 —— 卸载会丢滚动位置与 input 草稿。
- **宽度过渡期间禁用 `<ResizablePanel>` 的拖拽**：动画中 `savedWidth` 不参与计算，结束后再恢复。
- **`prefers-reduced-motion: reduce`** → `transition-duration: 1ms`，直接切形态。
- 全屏态的**阶梯淡入用 CSS 变量 + delay**（`--d: 60ms/110ms/160ms`），不要用 JS 层层 `setTimeout`。

### 4.4 已知坑（本项目历史教训，逐条对照）

| 坑 | 出处 | 本方案规避 |
|---|---|---|
| Tailwind v4 过渡属性是 `translate` 而非 `transform`，`transitionend` 匹配不到 | `AssistantPanel/index.tsx:169` 注释 | 用定时器 + 显式 `transition: width …` |
| `ResizablePanel` 在 `visible=false` 时**不渲染 children** | 记忆：workbench 双手柄 | 全屏层不用 `ResizablePanel`，自管宽度 |
| 槽未就绪时回落内嵌面板 → 双手柄 | `editor/index.tsx:1012` | 全屏层与侧栏是**同一个容器**，不存在槽切换 |
| 模块保活 `display:none` 下的动画不触发 | `App.tsx:621` | AI 学堂是 fixed 浮层，不参与模块保活 |
| 主进程改动 dev 热重载失效 | 项目铁律 | 涉及 `electron/` 的改动验收前**必须重启 dev** |

---

## 5. 数据与状态

### 5.1 新增 settings 键（`src/lib/settings.ts`）

| 键 | 类型 | 默认 | UI | 说明 |
|---|---|---|---|---|
| `learnProgress` | **json** | `'{"done":[],"last":1}'` | false | 步骤完成与当前位置（`type:'json'` 已有 8 处在用，存字符串化的 JSON） |
| `learnIntroSeen` | toggle | false | false | 是否已从首启向导跳到学堂 |
| `aiLearnActivityBarEntry` | toggle | true | true | 活动栏是否显示「AI 学堂」入口 |
| `assistantFullOnOpen` | toggle | false | false | ⊞ 展开后默认进「上手路径」而非「对话」 |

> 沿用现有 `update()` 通道，不涉及迁移；`learnProgress` 读写用 `JSON.parse` 包 try/catch（存量 `activityBarOrder` / `aiSkillDisabled` 同款写法）。

### 5.2 教程数据（渲染层，不放主进程）

`src/modules/ai-learn/lessons.ts`：

```ts
export interface Lesson {
  n: number
  title: string
  minutes: string
  goal: string
  docId?: string          // 关联 help 文档 id
  body: string            // 讲义 md
  action?: { label: string; run: () => void }   // 「动手做」
  ask?: string[]          // 快捷提问 chips
}
```

6 步（与原型一致，约 13 分钟）：认准三个区 / 写下第一页 / **让它出现在知识库**（草稿机制，最关键）/ 建立第一条连接 / 让 AI 帮你干活 / 备份与找回。

**为什么放渲染层**：步骤是 UI 资产，主进程不需要知道；"当前第几步"通过 context 传给主进程（§6）。

---

## 6. 提示词注入：AI 怎么知道你在第几步

复用 `assistantContext.ts` 的既有通道，**主进程零改动**：

```ts
// src/modules/ai-learn/useLearnContext.ts
export function learnStepContext(lesson: Lesson, doc: HelpDoc | null): AgentContextInfo {
  return {
    label: `AI 学堂 · 第 ${lesson.n} 步：${lesson.title}`,
    type: 'learnStep',
    data: {
      goal: lesson.goal,
      stepNo: lesson.n,
      totalSteps: 6,
      手册片段: doc ? doc.md.slice(0, 4000) : undefined,   // 受 6000 字符上限约束
    },
  }
}
```

`AssistantPanel` 在发送时优先取 `learnStepContext`（沿用现有 `selCtx ?? getAssistantContext()` 的优先级链）。

**效果**：AI 收到的不只是「用户在看第 3 步」，还包括该步的目标与对应手册全文 —— 所以能回答"这一步为什么必须写 id"，而不是让用户自己去翻文档。

> 若后续发现需要全库检索（用户自由问"怎么导出备份"），再上 `builtin.help.search`（§7.5）。

---

## 7. 帮助文档体系升级（第 2 个问题的答复）

### 7.1 体检结论：确实是**该改**，但优先级是"先接通，再写厚"

现状 19 篇合计 30 KB，平均 1.6 KB/篇：

| 文档 | 字节 | 评价 |
|---|---|---|
| 日期搜索 / 博客标签 / 心情状态 | 560 / 678 / 683 | 一段话，等于没有 |
| 常见问题 | 797 | 仅 3 问，全站最该厚的一篇反而最薄 |
| 番茄钟 / 体重追踪 / AI 联网搜索 | 1.3–1.5 K | 功能操作说明，够用 |
| AI Skill 技能 / 日程与打卡小窗 | 3.2 K | 最详细的两篇 |
| **《快速上手》** | — | **不存在**（`onboarding-rework` 已提议，未落地） |
| 「读写分工 / frontmatter id / 草稿机制」 | — | **零覆盖**，而这是新手 100% 会撞的墙 |
| 「模块清单与职责」 | — | **零覆盖** |
| 「AI 权限模型（禁止/只读/读写）」 | — | **零覆盖**（`onboarding` 讲了，文档里没有） |

### 7.2 三档内容规格（新标准）

| 档 | 定位 | 篇幅 | 篇数 | 读者 |
|---|---|---|---|---|
| **L1 心智** | 核心概念与模型（读写分工、草稿机制、权限模型、三个区） | 1.5–3 K | 4 | 人 + AI |
| **L2 任务** | 任务线（快速上手、备份恢复） | 2–4 K | 2 | 人 + AI |
| **L3 参考** | 单功能速查（番茄钟、密码本…） | 0.8–2 K | 13 | 人为主 |

**每篇统一骨架**（便于模型切片与人工扫读）：

```md
---
title: 键盘快捷键
category: 操作指南
icon: Keyboard
weight: 30          # 新增：排序权重（缺省 100），《快速上手》= 0
keywords: [快捷键, 热键, 快捷方式]   # 新增：供 AI 检索的别名，覆盖用户口语
---
## 一句话
## 怎么用（步骤）
## 常见误用 / 踩坑
## 相关
```

**给 AI 的硬约束**：
- 单篇 ≤ 4 KB（`buildSystemPrompt` 有 6000 字符截断，超了会被砍掉尾巴）
- 标题用 `##`/`###`，便于按小节切片检索
- frontmatter 的 `keywords` 必须包含用户口语说法（"笔记页 / 知识页 / 文档 / md 文件"都指向同一篇）

### 7.3 文件搬迁（解决"主进程读不到"）

单一真相源，不搞双份：

```
迁移前：src/modules/help/docs/*.md          ← 只有渲染层能读
迁移后：resources/help/*.md                  ← 两边都能读
         ├─ 渲染层：import.meta.glob('../../../resources/help/*.md', { query:'?raw' })
         └─ 主进程：app.isPackaged ? join(process.resourcesPath,'help')
                                    : join(app.getAppPath(),'resources','help')
```

`package.json`：

```json
"extraResources": [
  { "from": "resources/builtin-plugins", "to": "builtin-plugins" },
  { "from": "resources/dict", "to": "dict" },
  { "from": "resources/help", "to": "help" },
  { "from": "clipper-extension", "to": "clipper-extension" }
]
```

风险与对策：
- Vite glob 到 `src/` 之外**可行**（相对路径 glob），产物仍进 renderer bundle —— 需实测确认打包后路径；
- 若 glob 越界有问题，**降级方案**：保留 `src/modules/help/docs/` 作为渲染源，同时用 `vite-plugin-static-copy` 复制到 `resources/help/`（双份，构建期自动同步，人工不维护两份）；
- 文档**必须是 LF**（`docsLoader` 曾因 CRLF 导致 frontmatter 全灭，已有前车之鉴）。

### 7.4 内容改写顺序（先写最缺的）

| 序 | 动作 | 量级 |
|---|---|---|
| 1 | 新增《快速上手》（L2 任务线，与 AI 学堂 6 步同源，`weight: 0`） | 1 篇 |
| 2 | 新增《核心概念：读写分工与草稿机制》（L1，含 frontmatter id 图解） | 1 篇 |
| 3 | 扩写《常见问题》→ 至少 12 问（含"知识库看不到文件""AI 说完成但没生效""文件存哪了"） | 改写 1 篇 |
| 4 | 新增《AI 权限与工具边界》（L1，禁止/只读/读写 + 审计轨迹） | 1 篇 |
| 5 | 新增《模块一览》（L1，谁负责写、谁负责读） | 1 篇 |
| 6 | 存量 13 篇按统一骨架补「常见误用 / 相关」两节 | 改写 13 篇 |

### 7.5 检索工具（可选，P2）

若"常驻片段注入"不够用，新增：

```ts
registerTool({
  name: 'builtin.help.search',
  title: '检索 Knowbase 使用手册',
  description: '当用户询问本软件怎么用、某功能在哪、为什么某个行为不符合预期时，先调用本工具检索官方手册，再回答。不要凭猜测回答软件行为。',
  inputSchema: { type:'object', properties:{ query:{type:'string'}, limit:{type:'number',minimum:1,maximum:5} }, required:['query'] },
  source: 'builtin', enabled: true, readOnly: true, tier: 'core',   // core：常驻，成本仅一个 schema
}, handler)
```

返回 top-N 小节（标题 + 正文片段 + 文档 id），并附 `hint: "可引用文档标题"`。

**为什么不做成 Skill**：`SKILL.md` 是被模型"主动调用后获取提示词并遵循执行"的能力包（见 `skillService.ts:19`），适合"生成错题""写周报"这类任务模板；本场景是**知识检索**，语义上是工具不是技能。而且 Skill 走 `skill.<pid>.<sid>` 命名空间与插件体系，耦合更重。

### 7.6 改写样例：`常见问题.md`（让标准可判断）

**现状**（797 B，3 问，每问 1–2 句）：

```md
### 为什么内容没有保存？

博客编辑器支持自动保存（每 2 秒）。可随时按 Ctrl S 手动保存。查看右下角指示灯确认状态。
```

问题：只说了"会自动保存"，**没回答"没保存时怎么办"**；换成 AI 读，它也提取不出可判定的检查步骤。

**目标形态**（每条 Q 统一四段：一句话 → 检查步骤 → 常见误用 → 相关文档）：

```md
### 为什么我写的文件在知识库里看不到？

**一句话**：知识库只收录带 frontmatter `id` 的文件；没有 `id` 的文件被当作草稿，只在编辑区可见。

**检查三步**
1. 打开该文件，看开头有没有 `---` 包裹的 frontmatter 区块；
2. 确认区块里有 `id:` 这一行，且值不为空；
3. 保存后回知识库 —— 正常会立刻出现（主进程写盘后会广播刷新）。

**常见误用**
- 只在正文写了标题、没加 frontmatter → 属于草稿，符合预期；
- 字段名写成 `ID` / `Id` → 不识别，字段名区分大小写；
- 文件落在 `.ignore` 命中的目录里 → 被过滤层挡掉，见《忽略规则》。

**相关**：核心概念：读写分工与草稿机制 · 编辑器文件管理
```

判断标准（写每条 Q 时自检）：
- **可判定**：读者读完能自己判断"我这次是哪种情况"，而不是"大概知道原理了"；
- **可执行**：有编号步骤或明确动作；
- **覆盖误用**：至少 2 条真实踩坑（本项目的历史 issue 就是最好的素材来源）；
- **可互链**：末尾「相关」指向心智类文档，形成网而不是孤岛。

> 「常见误用」这一节同时也是**给 AI 的**：用户提问往往正是踩了其中某条，AI 检索到就能直接命中。

---

## 8. 与 AI 教学（aiTeaching）的边界

`aiTeaching` 已是全屏 AI 工作台（工作区 / 产物栏 / 文件树 / 会话 / quiz / 示意图），与本方案有形态重叠风险。约定：

| | **AI 学堂**（本方案） | **AI 教学**（已有） |
|---|---|---|
| 回答的问题 | 学**怎么用这个软件** | 学**一门课程** |
| 内容来源 | `resources/help/` 官方手册 | 用户自己的资料 / 工作区 |
| 数据模型 | 无工作区，轻量 | 工作区 = 一门课，含多会话 + 产物目录 |
| 会话 `source` | `'aiLearn'` | `'aiTeaching'` |
| 入口 | ActivityBar / 侧栏 ⊞ | ActivityBar Tab |
| 形态 | 浮层（不占 Tab，不参与保活） | 模块 Tab（参与保活） |

**会话库共用**（同一张表，`source` 区分）——所以侧栏与全屏、学堂与教学之间的会话是同一份，用户不会看到"两套历史"。

---

## 9. 文件改动清单

| # | 动作 | 文件 | 量级 |
|---|---|---|---|
| 1 | 拆分容器 | `src/components/shared/AssistantPanel/index.tsx` → `index.tsx`(状态机+动画) + `SidebarView.tsx` + `LearnView.tsx` + `ChatView.tsx` + `HelpView.tsx` | 中 |
| 2 | 教程数据与进度 | `src/modules/ai-learn/lessons.ts`、`useLearnProgress.ts`、`useLearnContext.ts` | 新增 |
| 3 | 侧栏 ⊞ 按钮 + 快捷键 | `AssistantPanel/index.tsx`（Ctrl+Shift+J）、`src/lib/shortcuts.ts` | 小 |
| 4 | 活动栏入口（可选） | `src/components/shared/ActivityBar.tsx`、`src/App.tsx` | 小 |
| 5 | shellLeft 透传 | `src/App.tsx`（CSS 变量或 prop） | 极小 |
| 6 | settings 键 | `src/lib/settings.ts` | 小 |
| 7 | 帮助文档目录搬迁 | `resources/help/*.md`（19 篇移动）+ `docsLoader.ts` glob 改路径 + `package.json` extraResources | 中 |
| 8 | 帮助文档扩写 | §7.4 的 6 项 | 大（内容） |
| 9 | 手册检索工具（可选 P2） | `electron/lib/helpService.ts`（新增）、`builtinTools.ts`（注册） | 中 |
| 10 | 首启向导终章衔接 | `Onboarding.tsx`（末页加「让 AI 带我上手」→ 打开学堂第 1 步） | 小 |

---

## 10. 分阶段实施

| 阶段 | 内容 | 可验收物 |
|---|---|---|
| **P0 外壳** | #1 #2（假数据）+ #3 #5 #6 —— 扩张/回缩动画、三页签骨架、侧栏 ⊞ | 真人上手：动画流畅度、三页签切换 |
| **P1 教程** | #2 真实数据 + 进度持久化 + context 注入，接通「动手做」跳转 | 走完 6 步、关掉再开进度还在 |
| **P2 知识** | #7 搬迁 + #9 检索工具，AI 能答"软件怎么用" | 问 5 个软件问题，答案有据 |
| **P3 内容** | #8 文档扩写（按 §7.4 顺序） | 新增/改写 19 篇 |
| **P4 入口** | #4 #10（活动栏、向导终章、命令面板两条命令） | 可找回路径闭环 |

**统一验收，不做阶段交付**（沿用项目习惯：全套完成后再跑 smoke + tsc + build）。

---

## 11. 验收标准

**动画（P0 重点）**
- 扩张/回缩全程无白屏、无内容跳变、无滚动位置丢失；
- DevTools Performance 录制：单帧不超 16ms（60fps），无长任务；
- 连点 ⊞ 5 次不出现状态错乱（动画中点击按最终态收敛）；
- `prefers-reduced-motion` 下瞬切不报错。

**功能**
- 侧栏 ⊞ → 全屏 → ⤡ → 侧栏，会话与输入草稿原样保留；
- Ctrl+J / Ctrl+Shift+J / Esc 三级退出行为符合 §3.1 表；
- 教程进度写盘，重启后仍在；「动手做」跳到对应模块且学堂正确收起；
- 在「上手路径」提问，AI 回答中体现出**知道当前是第几步**。

**知识供给（P2）**
- 5 个抽样问题（"知识库看不到我的文件""数据存在哪""怎么备份""AI 能改我的文件吗""快捷键有哪些"）在有工具调用、无工具调用两种模式下都能答对，且引用手册标题。

**门禁**
- `tsc --noEmit -p tsconfig.node.json` / `tsconfig.web.json`：本次改动 0 新增错误；
- `electron-vite build` 通过（注意 `out/` 清理可能撞 safe-delete，先 `mv out out_prev_*`）；
- **主进程改动验收前必须重启 dev**（历史铁律）。

---

## 12. 决策点

| # | 问题 | 选项 | 倾向 |
|---|---|---|---|
| D1 | 扩张范围 | ① 保留活动栏（`left: shellLeft`）；② 真·全覆盖 | ① |
| D2 | 帮助文档落地方式 | ① 直接搬到 `resources/help/`（单一真相源）；② 保留 src 副本 + 构建期复制 | ① 先试，失败退 ② |
| D3 | 活动栏常驻入口 | ① 加（可找回 + 可作 startupTab）；② 只留侧栏 ⊞ | ①，但入口图标不做红点（避免打扰） |
| D4 | 手册检索工具 | ① 本期做（P2）；② 先只做 context 注入，观察一轮 | ①（问题域本来就宽） |
| D5 | 右栏对话可收起 | ① 可收起（阅读时长文多 360px）；② 固定 | ① |
| D6 | 《快速上手》与教程数据同源还是各写一份 | ① 同源（教程 md 即文档，UI 读同一份）；② 各写一份 | ①（否则改一处要同步两处） |

---

## 13. 风险与备忘

- **内容与代码混在同一批**：P2/P3 是内容工作，量与代码相当，建议**先 P0–P2 打通链路，再一次性写厚文档**，避免"文档写完了但 AI 还看不到"。
- **`resources/help` 的打包体积**：30 KB→预计 80 KB，可忽略。
- **注入截断**：`buildSystemPrompt` 的 6000 字符上限 + `resolveXxxForInjection` 的 3000/4000 截断，是本方案的硬天花板；每次加内容前先算字符数。
- **与 `onboarding-rework-design.md` 的关系**：那份稿子的 P0-3（《快速上手》+ weight 排序）与本文 §7 重叠，建议合并实施，以本文为准（本文多出「主进程可读」这一前提）。
- 存量文档改写不要顺手改 `frontmatter` 之外的既有排版习惯，避免 diff 污染。

---

## 14. 实施记录（滚动，2026-09-10）

### P0 外壳 ✅
新增 `src/components/shared/AiLearn/{index.tsx,lessons.tsx}`；`AssistantPanel` 加 `surface` 状态机、
`expandToFull/collapseToSidebar/closeAll`、头部 ⊞、`Ctrl+Shift+J`；`App.tsx` 透传 `shellLeft`。
底栏排版经 3 轮迭代，最终采用**方案 A（单排：动作靠左 / 导航靠右，上一步与下一步同款描边）**。
对照原型：`docs/prototypes/ai-learn-center.html`、`ai-learn-bottom-bar.html`。

### P1 教程闭环 ✅
- 进度落盘 `settings.learnProgress`（json），hook：`AiLearn/useLearnProgress.ts`。
- **共用消息流** `AssistantPanel/MessageList.tsx`：侧栏与全屏学堂同一份渲染；`ChatBridge` 把会话状态
  与方法打包交给全屏 → 扩张前后同一会话。
- 「动手做」跳转：`lessons.action = { label, goto }` → `collapseToSidebar()` + `ai-learn:goto` → App 切模块。
- 步骤上下文：`learnStepContext()` 仅在**全屏学堂内**提问时注入（`selCtx > learnStep > getAssistantContext()`）。

### 会话来源隔离（P1 期间发现的额外需求）✅
问题：学堂的会话列表里混进了 AI 教学的会话（"跟我学（教学）"等）。
根因：`AgentSessionRow` 没有来源字段，教学模块建会话走的是与侧栏同一条 `agentNewSession` 路径。
方案：新增 `source?: 'assistant' | 'aiTeaching'`（repo / preload / ipc / types 全链路打通），
新建会话按来源标记，**存量数据用「是否归属教学工作区」一次性回填**（`backfillSessionSources`，只在
`agent:sessions` 首次调用时跑一次）；两侧列表各自按 source 过滤。

### P2 知识打通 ✅
- 文档从 `src/modules/help/docs/` **搬到 `resources/help/`**（24 篇）；渲染层 glob 用
  **`import.meta.glob('/resources/help/*.md')`**（以 `/` 开头 = Vite 项目根，比多级 `../` 稳）；
  `package.json` 的 `extraResources` 加 `{ from: 'resources/help', to: 'help' }`。
  主进程侧 `electron/lib/helpService.ts` 按 `app.isPackaged ? process.resourcesPath : app.getAppPath()`
  解析（多候选路径探测）。
- 新增工具 **`builtin.help.search`**（`tier: core`，readOnly，不设 module → 不受模块权限限制），
  支持关键词检索与 `id` 读全文，返回 `hits + hint`。
- 渲染层 `docsLoader` 支持 `frontmatter.weight` 排序（缺省 100），《快速上手》= 0 置顶。

### P3 内容（第一批）✅ / 余量待补
新增 4 篇：《快速上手》(weight 0)、《核心概念：读写分工与草稿机制》(5)、《模块一览》(6)、
《AI 权限与工具边界》(20)；扩写《常见问题》4 问 → 13 问（weight 10）。
**余量**：存量 19 篇尚未补 `keywords`（检索目前靠标题与正文）；统一骨架的「常见误用 / 相关」两节也待补。

### 实施中修正的两处判断
1. **§7.2 的「单篇 ≤ 4KB」表述过严**：真正的天花板是 `buildSystemPrompt` 的 **6000 字符**
   （JS 字符串长度，中文按 1 算），而中文 4KB **字节** 仅约 1300 字符。按字节卡会把文档写残。
   → 正确口径：**单篇 ≤ 4000 字符**（约 12 KB 字节）。
2. **中文检索必须 bigram 分词**（`helpService.tokenize`）：最初按空格/标点切词，中文整句会被当成
   一个词，而文档里不存在这个连续串 → **14 个口语查询错了 6 个**。改成相邻两字滑窗后 **14/14 全部命中**。
   自检脚本：`tmp/verify-help-search.mjs`（纯 node，可重跑）。
