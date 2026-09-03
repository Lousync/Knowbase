# 禅模式（Zen Mode）技术设计方案

> 日期：2026-09-02 · 类型：方案文档（本会话只出方案，不落代码）· 状态：**待评审拍板**
> 定位：**写作态专注模式**，作用于编辑器模块；与既有「沉浸阅读」（阅读态）对称分工

---

## 1. 背景：先把"沉浸"这个词理清楚

当前代码里已有三个互不相同的"沉浸"语义，禅模式是第四条线，必须划清边界，否则后续会变成四处说不清的沉浸态。

| 概念 | 位置 | 语义 | 态 | 状态 |
|---|---|---|---|---|
| 沉浸阅读 | `src/modules/knowledge/index.tsx` | 知识库内只留正文，720px 居中，Ctrl+Shift+R 进 / Esc 出 | **阅读** | 已落地 |
| 空间沉浸视图 | `NotebookList.tsx` / `SpacePanel.tsx` | scoped 列表：只看某个空间内的内容 | 浏览 | 已落地 |
| 沉浸刷题 | `components/shared/QuizMode.tsx` | 一题一屏，答对自动下一题 | 练习 | 已落地 |
| **禅模式** | **编辑器模块** | **隐藏一切外围 UI，只留正在写的文字** | **写作** | **本方案** |
| PDF 沉浸规格 | `docs/plugin-pdf-reader-design.md` §6.1 | 计划复用阅读沉浸规格 | 阅读 | 设计中 |

**禅模式定义**：进入后隐去文件树、标签栏、状态栏、活动栏甚至窗口标题栏，编辑区限宽居中，只保留极轻的悬浮信息（字数/保存状态）与"鼠标到顶部唤出"的退出条。目标是**写作时眼里只有文字**。

**与沉浸阅读的关系**：一个是写（Monaco 可编辑）、一个是读（MarkdownPreview 只读），交互骨架相同（隐壳 + hover 退出条 + 限宽居中 + 右下标语）——因此 §6 建议抽共享组件，三处消费（阅读 / 写作 / PDF）。

---

## 2. 现状盘点（读码实测）

**编辑器模块 `src/modules/editor/index.tsx`**
- 状态集中在模块内：`openFiles` / `activePath` / `dirCache` / `expanded`；脏状态在文档对象上（`fullContent` vs `savedFullContent`）。
- Props 已预留 Workbench 化（R1-W1）：`{ isActive, sidebarEl }`；`sidebarEl` 存在时文件树 portal 到全局侧栏、内嵌列收为 `w-0 overflow-hidden`。
- 渲染结构 = 左侧文件树列（`w-[220px]`）＋ 右侧〔标签栏（`openList.length > 0` 时）→ `MonacoPane`（`flex-1`）→ 状态栏（文件名/语言/UTF-8/「属性」chip/字节数/未保存）〕。
- 快捷键：`Ctrl+S` / `Ctrl+Shift+S`（按 `isActive` 过滤）；另有 Esc 监听（约 425 行）负责关闭弹窗类 UI。

**App 壳层 `src/App.tsx`**
- `<TitleBar />`（344 行，无边框自绘）＋ `<ActivityBar />`（347 行）＋ `renderTab()`（331 行，**Tab 首次挂载后常驻 `display:none` 保活**）。
- 结论：标题栏与活动栏在 App 层，**模块内无法直接隐藏**：Z2 档必须有 App 层状态参与。

**沉浸阅读实现特征（可复用的参照）**
- 状态：`readingMode` / `readingPage`（363–386 行）；进入校验 `fileType ∈ {md, txt}`。
- 快捷键：`Ctrl+Shift+R` 进入；`Esc` 退出，且 `readingMode` 时**独占键盘**（`return` 前先处理 Esc）。
- 渲染分支：`readingMode ? 沉浸视图 : 常规视图`（1026 行起）——**模块内视图切换，不遮窗口标题栏**。
- 退出条：`absolute top-0 h-9 opacity-0 group-hover:opacity-100 transition-opacity duration-200`，正文 `max-w-[720px] mx-auto`，右下角固定提示"沉浸阅读 · Esc 退出"。

---

## 3. 设计目标与不变量

1. **只藏 UI，不改能力**：禅模式下 Ctrl+S / Ctrl+Shift+S / Ctrl+W 等快捷键行为不变，只是外围界面不可见。
2. **入口唯一、退出务必可达**：任何档位都必须有一条"看得见的退出路径"（顶部 hover 退出条 + Esc），不能出现用户困在禅模式里。
3. **状态可收敛**：禅模式是**编辑器模块绑定态**，切到其他 Tab 自动退出（见 §5 状态机）。
4. **不引入新依赖**：全部用现有 React 状态 + CSS + Monaco API 实现。
5. **不破坏读写分工**：禅模式只是编辑器（唯一写入方）的视图形态，不改变写入链路。

---

## 4. 三档规格

| 档位 | 隐藏内容 | 保留 | 实现层 |
|---|---|---|---|
| **Z1 专注** | 文件树列、标签栏、状态栏 | 窗口标题栏、活动栏 | 模块内（EditorModule 分支渲染） |
| **Z2 禅** | Z1 ＋ 标题栏、活动栏 | 顶部热区唤出条、悬浮信息条 | **App 层**（壳隐藏）＋ 模块内 |
| **Z3 打字机** | Z2 ＋ 全宽铺满 | 限宽居中正文、当前行居中、其余淡化 | Monaco API（decorations / revealLineInCenter） |

**共用呈现元素（三档一致）**
- **顶部退出条**：`h-9` 隐形热区，鼠标移入淡入（复用沉浸阅读的 `opacity-0 group-hover:opacity-100` 写法），含退出图标、当前文件名、档位切换。
- **悬浮信息条**（Z2/Z3 必需，Z1 可选）：右下角极轻文字 —— `字数 · 已保存 17:52`；30s 无操作淡出，鼠标移动/键入唤醒（与 PDF 沉浸规格 §6.1 的"30s 淡出"口径一致）。
- **正文限宽**：Monaco 容器外层 `max-w-[860px] mx-auto`（默认，可设置），背景延伸全屏，视觉居中。
- **保存反馈**：禅模式下**不用 toast**（打断沉浸），改为悬浮条文字短暂变"已保存 HH:MM"两秒后回落。

---

## 5. 状态机与交互规格

```
off ──Ctrl+K Z──> Z1 ──Ctrl+K Z──> Z2 ──Ctrl+K Z──> Z3 ──Ctrl+K Z──> off
 ↑                                                                    │
 └────────── Esc（无弹窗时）/ 切 Tab / 点退出条 / 关闭窗口 ─────────────┘
```

| 事件 | 行为 |
|---|---|
| 进入 | 仅在编辑器 Tab 且已打开文件（`activePath` 非空）时可用；无文件则提示先打开 |
| 切档 | `Ctrl+K Z` 循环 off→Z1→Z2→Z3→off（两键序列：Ctrl+K 后 800ms 内按 Z，超时作废） |
| **Esc 优先级** | ① 存在弹窗（`inputBox` / `closeTarget` / `fmDraft` / `ctxMenu` / `conflictState`）→ **让位**，由各自的 Esc 逻辑关闭弹窗；② 否则退出禅模式。**必须合并进同一个 keydown handler 按序判断**，避免多 listener 竞态 |
| 切 Tab | `isActive` 由 true→false 时 **自动退出**（保活架构下组件不卸载，必须靠 effect 监听，不能依赖 unmount） |
| 保存 | 禅模式下 Ctrl+S 正常保存（现有 handler 已按 `isActive` 过滤，不受影响） |
| 窗口失焦/最小化 | 保持禅模式（恢复焦点后仍在），不自动退出 |
| 关闭应用 | 档位写入 settings（下次进入编辑器**不自动禅**，仅记住上次档位） |

---

## 6. 技术实现清单

| # | 改动 | 说明 |
|---|---|---|
| 1 | `src/App.tsx` | 新增 `zenLevel` state（**唯一真相源**）＋ `setZenLevel` 传给 `EditorModule`；`zenLevel >= 2` 时隐藏 `<TitleBar />` 与 `<ActivityBar />`，改为渲染顶部热区（见 #4） |
| 2 | `src/modules/editor/index.tsx` | 新增 `zenLevel` prop 与视图分支：`zenLevel >= 1` 隐藏文件树列 / 标签栏 / 状态栏；`isActive` 变 false 的 effect 自动退出；统一 keydown handler 处理序列键与 Esc 优先级 |
| 3 | `src/modules/editor/components/MonacoPane.tsx` | **禅模式切换后必须触发 `editor.layout()`**（容器尺寸变化），建议 `useEffect` 依赖 `zenLevel` ＋ `ResizeObserver` 兜底；Z3 需暴露 `revealLineInCenter` 与 decorations 接口 |
| 4 | 顶部热区（App 层新组件） | Z2/Z3 下标题栏隐藏后保留 6–8px 热区（`-webkit-app-region: drag` 保持可拖动），鼠标进入唤出半透明条：最小化/最大化/关闭 ＋ 退出禅模式 ＋ 档位切换 |
| 5 | 共享组件 `src/components/shared/ImmersionShell.tsx` | 抽出「hover 退出条 + 限宽容器 + 右下标语」三件套，**供阅读（已落地）/ 写作（本方案）/ PDF（设计中）三处消费**；避免第四次出现时各写各的 |
| 6 | 字数统计 `src/lib/wordCount.ts` | 纯函数可冒烟：先 `splitFrontmatter` 取正文（frontmatter 不计入），`字数 = CJK 字符数 + 非 CJK 单词数`，另返回字符总数 |
| 7 | settings | 新增 `zen.level` / `zen.width`（默认 860）/ `zen.showCount`。⚠️ **必须同时加入 `src/lib/settings.ts` 的 SETTINGS 白名单**——历史上 `currentVaultId` 曾因不在白名单被 `flushSettingsToDisk` 整体覆盖抹掉 |
| 8 | 帮助文档 | `src/modules/help/docs/` 增一篇（import.meta.glob 自动扫描，注意 LF 换行） |

---

## 7. 风险与坑（按危险度排序）

1. **Monaco 布局不刷新**（最高频）：隐藏 UI 后容器尺寸变化，若不调 `editor.layout()`，会出现编辑区留白/光标错位/滚动区不更新。用 effect + ResizeObserver 双保险。
2. **Esc 竞态**：编辑器已有 Esc 监听（关弹窗），禅模式再加一个会双触发。必须合并为一个 handler，按"弹窗优先"顺序判定。
3. **保活架构状态泄漏**：Tab 常驻 `display:none`，组件不卸载 —— 禅模式状态若放在模块内且不监听 `isActive`，切走再回来会残留"壳已隐藏但模块不可见"的错乱态。**退出必须挂在 `isActive` 变化上**。
4. **标题栏隐藏后的窗口控制**：无边框自绘窗口，隐藏标题栏即失去拖动/最小化/关闭入口 → 热区必须保留 drag 区与三键，否则用户只能 Alt+F4。
5. **Tailwind v4 过渡坑**：本分支过渡属性是 `translate` 而非 `transform`，若用 `transitionend` 监听淡出会永不触发（历史遮罩残留 Bug 根因）。淡出用 `transition-opacity` + 定时器，不依赖 `transitionend`。
6. **Workbench 化交互**（R1-W1）：`sidebarEl` 存在时文件树在全局侧栏里，Z1 隐藏"内嵌列"无效 —— 需同时通知壳层收起侧栏（或把 `zenLevel` 传给壳层统一处理）。
7. **Z3 打字机的体验分歧**：当前行随光标居中滚动会让部分用户不适（视线跳动），必须做成**独立开关**且默认关闭，不能强制。
8. 双屏/窗口最大化下热区坐标、以及"禅模式下打开 frontmatter 弹窗"（会打破沉浸）需要人工核对。

---

## 8. 分期

| 期 | 内容 |
|---|---|
| **V1** | Z1（模块内隐壳）＋ Z2（App 层壳隐藏 + 顶部热区）＋ 序列快捷键 ＋ Esc 优先级状态机 ＋ 切 Tab 自动退出 ＋ 悬浮信息条（字数/保存）＋ settings 三项 ＋ Monaco layout 修复 |
| **V2** | Z3 打字机（当前行居中 + 段落淡化，独立开关默认关）＋ `ImmersionShell` 抽象并把沉浸阅读改造为首个消费者 ＋ PDF 阅读器接入 |
| **V3** | 禅模式专属主题（降对比度 / 隐藏行号 / 无干扰配色）＋ 与番茄钟联动（禅模式计时、一个番茄钟结束轻提醒）＋ 每日写作目标进度 |

---

## 9. 验收与冒烟

**冒烟 `tmp/smoke/zen-mode-smoke.mjs`**（纯函数，不依赖 Electron）：
- `nextZenLevel(current, event)` 状态机：循环递进、弹窗存在时 Esc 不退出、切 Tab 事件退出。
- `countWords(body)`：中英混排、空文档、含 frontmatter（不计入）、纯标点。
- `shouldExitZen(event, modalState)`：五类弹窗态逐条断言。

**人工验收清单**：
1. Z1→Z2→Z3 逐级切换后，Monaco 编辑区尺寸正确、光标位置不错位、可正常滚动（layout 刷新验证）。
2. Z2 下鼠标移到窗口顶部能唤出控制条，**可拖动窗口**、可最小化/最大化/关闭。
3. 打开 frontmatter 弹窗后按 Esc：**先关弹窗**，再次 Esc 才退出禅模式。
4. 禅模式切到其他 Tab：壳层（标题栏/活动栏）恢复；切回编辑器为 off 态。
5. 禅模式下 Ctrl+S 保存成功：无 toast 打断，悬浮条显示"已保存 HH:MM"。
6. 最大化 / 双屏 / 缩放窗口下热区与限宽居中正常。

---

## 10. 待拍板问题

1. **作用范围**：仅编辑器写作态（推荐）vs 全局所有模块通用壳。
2. **快捷键**：`Ctrl+K Z`（VS Code 同款两键序列，推荐）vs `Ctrl+Shift+F` vs `F11`。
3. **是否接受 Z2 隐藏自绘标题栏**（需 App 层改造 + 热区方案）——若否，则只做 Z1。
4. **档位数量**：三档（推荐）vs 只做 Z1+Z2，打字机永远后置。
5. **是否抽 `ImmersionShell` 并回改沉浸阅读**（推荐做，三处共用）——会增加 V2 的改造面，是否接受。
6. **Z3 默认关闭**是否认同。
7. **字数口径**：`CJK 字符 + 非 CJK 单词`（推荐）vs 纯字符数 vs 两者都显示。
8. **悬浮信息条内容**：字数+保存时间（推荐）还是要加写作时长/目标进度。
9. **命名**：功能对外叫「禅模式」还是与既有保持一致叫「沉浸写作」（与"沉浸阅读"对称，但会进一步加剧"沉浸"一词多义）。

---

## 11. 关联文档

- `src/modules/knowledge/index.tsx`（沉浸阅读参照实现：状态 363 / 快捷键 773 / 渲染 1026）
- `docs/plugin-pdf-reader-design.md` §6.1（PDF 沉浸规格，30s 淡出口径一致）
- `docs/rework-workbench-design.md`（R1-W1 `sidebarEl` 与壳层插槽，Z2 需协同）
- `.AGENT/docs/读写分工设计.md`（编辑器 = 唯一写入方，禅模式不改变此分工）
- `src/lib/settings.ts`（SETTINGS 白名单坑）
