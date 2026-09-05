# 图谱视图实现规格（R4 · G1–G3）

> **[2026-09-03 归档]** 执行规格已完成使命（G1 ✅ G2 ✅ G3 ✅ A8 ✅），移入 `docs/archive/` 历史留存，勿作为当前设计引用。上级设计仍见 `docs/graph-view-design.md`。
>
> 上级设计见 `docs/graph-view-design.md`（节点/边定义、动画规格 A1–A8、UI 规格、G0–G4 分期）。
> 本文档是 G1–G3（图谱 UI）的**可执行实现规格**，供直接照做、逐批提交。
> 前置：**G0 已完成**（提交 ed84466）——GraphIndex 数据层已落 `.knowbase/cache/graph.json`，
> IPC `knowledge:getGraph` 已就绪，真实库 E:/knowledge = 216 页 + 9 标签 + 153 边。
>
> 进度：**G1 ✅（9eef5ec）→ G2 ✅（4a3ee6d）→ G3 ✅（c0f6536）+ A8 增删动画收尾 ✅（本批）**。

---

## 0. 本期目标与分期

给知识库模块加一个「图谱」视图：Canvas 全幅画布 + 力导向自动排布，
**还原 Obsidian 式"自动生长"体验，并叠加社区聚类让它比 Obsidian 更易读**。

| 批 | 内容 | 交付可验点 | 状态 |
|---|---|---|---|
| **G1** | 数据接线 + 画布 + 力导向物理 + 入口 + 点击跳转 | 真机：知识模块能进图谱、节点自动散开、点节点打开对应页 | ✅ 9eef5ec |
| **G2** | 悬停淡化 / 拖拽回弹 / 惯性平移缩放 / 点击聚焦 / 本地图谱 | 真机：hover 有过渡感、拖节点邻居被带动、松手回弹 | ✅ 4a3ee6d |
| **G3** | 过滤 / 空间着色 / 设置面板(持久化) / 增删动画(A8) / 簇力开关 | 真机：开关即调即生效且重启保留 | ✅ c0f6536 + 本批 |

三批各自独立提交；G1 完成即可「用」，G2/G3 是体验增强。

> **A8 增删动画实现记录（本批）**：`forceSim.mergeSimulation` 新增（保留旧坐标增量重建，
> 新增节点出生区=旧图几何中心、消失节点输出 ghost 快照）；`GraphCanvas` 生命周期拆
> mount(尺寸/ResizeObserver) + data(首载 build / 后续 merge 两分支)，nodeDa/edgeDa 按
> 新 world 对齐、新增节点淡入 + birth 半径 0→1 生长、删除节点 ghost 收缩淡出（g 1→0），
> merge 不动 cam 视角不跳；`GraphView` 监听 `data-imported` / `kb-graph-refresh` 重拉，
> `knowledge/index.tsx` 激活重读时派发刷新事件。spec §5.5 完成。

---

## 1. 数据契约与接线

### 1.1 类型单源化（第一步重构，纯搬运）

前端渲染层不能 import electron 代码，现有惯例是 **web 类型文件由 electron 引用**
（如 `src/lib/wordbookTypes.ts`，`knowledgePackImporter` 反向 import）。

- 新建 `src/lib/graphTypes.ts`：`GraphNode / GraphEdge / UnresolvedRef / GraphIndexData`
  （字段与 `electron/lib/kbStore/graphIndex.ts` 当前定义逐字一致）；
- `electron/lib/kbStore/graphIndex.ts` 改为 `import type { ... } from '../../../src/lib/graphTypes'`
  （node tsconfig 已 include src 类型，有 wordbook 先例）；本地类型删除。
- 校验：`npx tsc -p tsconfig.node.json` 不新增错误。

### 1.2 IPC 三处接线（照 `knowledge:getTags` 模式）

| 位置 | 改动 |
|---|---|
| `electron/preload/index.ts` | `getKnowledgeGraph: () => ipcRenderer.invoke('knowledge:getGraph')` |
| `src/types/index.ts` | 声明返回 `Promise<GraphIndexData>`（import from `./graphTypes`） |
| `src/lib/ipc.ts` | `export const getKnowledgeGraph = () => a().getKnowledgeGraph()` |

返回空态天然安全：无仓库时 GraphIndex 返回空 nodes/edges → 画布显示空态提示。

### 1.3 节点跳转（点页打开，复用既有机制）

点击节点 → `window.dispatchEvent(new CustomEvent('kb-open-in-editor', { detail: { relPath: node.path } }))`
（消费者：`src/App.tsx:311` 与 `src/modules/editor/index.tsx:184`，编辑器模块会接管打开；同
`knowledge/index.tsx:566` 的既有用法）。**不新增跳转 IPC。**

---

## 2. 视图挂载：知识模块内「图谱」视图

### 2.1 推荐入口

knowledge 主区结构（index.tsx:1052 起）：
`左侧 ResizablePanel(目录树) ‖ 右侧 flex-1(PageTabBar + PageEditor/空态)`

图谱进入方式（不引入新的 module 类型，不污染 `openPageIds`）：

- 新增模块级 state `graphMode: boolean`；
- **入口按钮放左侧目录树底部按钮区**（现 1232–1258 行的错题本/插件按钮组，
  放宽 `selectedSpaceId` 条件，图谱为全仓库视图、顶层也应可用）；
- `graphMode=true` 时右侧主区不再渲染 `PageTabBar+PageEditor`，改渲染 `<GraphView …/>`；
- 进入时若左侧面板展开则收折（面板 `visible` 已由 `showCategoryPanel` 控制）→ 全幅画布；
- 退出：GraphView 内 Esc / 右上角返回按钮 → `graphMode=false`、恢复面板态。
- 备选（不用，仅记录）：PageTabBar 假页签 —— 会污染页签类型与 dirty 逻辑，否决。

### 2.2 GraphView 需要的传入

```
onOpenPage(page: { relPath: string })   // 转 1.3 的全局事件（也可由 GraphView 直接 dispatch）
onExit(): void                          // 退出图谱回列表
graphData: GraphIndexData               // 组件内自取（getKnowledgeGraph），进入时拉一次
```

### 2.3 组件文件（独立目录，避免再膨胀 index.tsx 1381 行）

```
src/modules/knowledge/components/graph/
├─ GraphView.tsx        # 视图容器：拉数据 + 工具栏浮层 + 组装画布 + 空态
├─ GraphCanvas.tsx      # <canvas> + rAF 循环 + pointer/hover 事件；高 DPI
├─ forceSim.ts          # 纯函数：建 sim / 社区簇检测 / tick；可单测
├─ colors.ts            # 读 CSS 变量 → 每节点颜色；按空间着色映射
├─ GraphToolbar.tsx     # 左上搜索/过滤、右上设置浮层、右下缩放±/适应/本地图谱
└─ useGraphView.ts      # 视图级状态：hover/拖拽/聚焦/本地/参数，驱动 canvas 重绘
```

---

## 3. 渲染与物理（G1）

### 3.1 新增依赖：`d3-force`（拍板 A 方案）

- `npm i d3-force`（~30KB 纯计算）。tree-shaking 后包体增量在 build 后核验一次并记录。
- 只 import `forceSimulation / forceLink / forceManyBody / forceCenter / forceCollide`。

### 3.2 布局管线（每帧）

```
① 节点布局状态只存一份：{ id → x, y, fx?, fy?, vx, vy, r, deg }
② forceSim.ts: 建 sim（一次），force 配置如下
③ rAF 循环（GraphCanvas，仅活跃运行）：
   sim.tick()
   视口/缩放 lerp → Canvas 重绘
   alpha < alphaMin 且无插值与交互 → idleFrames++；≥60 停 rAF；任何事件唤醒
```

**tick 先放主线程**（预算 <800 节点；216 页规模 Canvas 重绘才是大头）。
worker 化（design 风险 1）仅当 G1 真机实测拖动卡顿时再启用，不预先引入。

### 3.3 力参数（初值表，G3 设置面板可调）

| 力 | 参数 | 初值 | 说明 |
|---|---|---|---|
| link | distance | 120 | 连边理想长度 |
| link | strength | 按共引用加权弱化 | 双向引用边更强，标签边弱（0.4） |
| charge | strength | −300 | 斥力；标签节点减半 |
| collide | radius | r + 6 | 防重叠 |
| center | strength | 0.05 | 轻微聚心 |
| velocityDecay | — | 0.28 | 阻尼，自然停得下来 |

### 3.4 视觉编码

- 半径：页 `r = 4 + min(10, 3.2·√deg)`（4–14px，align design 5.3）；标签节点 `r=6` 但以
  **浅色小方块 + 文字**区别于页（Obsidian 观感），显示名称为 tag 名。
- 孤儿页（deg=0）：灰点、r=4，可过滤（默认显示）。
- 颜色：`colors.ts` 运行时读 `getComputedStyle(document.body)` 的
  `--accent` / `--text-muted` / `--bg-tertiary` 等（插件主题免通知）；
  可选「按一级目录着色」（G3 开关，目录 → 预设色环）。
- 标签文字：缩放 > 阈值（如 scale>0.55）才绘制（design 5.3 fTextShowMult）；
  用 `ctx.measureText` 截断超宽标题。
- Canvas 高 DPI：`canvas.width = clientWidth · devicePixelRatio`，`ctx.setTransform(dpr,0,0,dpr,0,0)`。

### 3.5 初始坐标（减少"开场大爆炸"）

- 首次进入/整图重载：节点按（可选）簇 + 随机抖动散在画布中心带；
  若 G1 期间启用簇力则按簇心分布。alpha 从 0.7 起步自然冷却，观感即"从中心生长散开"。

---

## 4. 生长体验与交互（G2）

沿用 graph-view-design §5.2 单元实现要点：

| 单元 | 实现规格 |
|---|---|
| **A3 hover 淡化** | node/edge 存 `displayAlpha`，每帧向 `targetAlpha` lerp(0.15)：邻居=1 其余=0.08；边两端有其一为邻居才亮。Hit-testing：每帧对 hover 坐标遍历节点（216 页量级足够，不需四叉树） |
| **A4 拖拽** | mousedown 命中节点 → 设 `fx/fy` 跟指针；alpha 临时抬到 0.3 重启微动；mouseup 清 fx/fy 自然回弹 |
| **A5 惯性/缩放** | pointermove 记速度，up 后 `pan += v; v×=0.92` 至 <0.1 停；wheel 缩放以指针为中心，缩放量每帧向 target 插值 0.2 |
| **A6 点击聚焦** | 单击(非拖拽)命中页节点：目标 scale=1.6、pan 到节点居中逐帧插值；聚焦后右上浮现该页**卡片**（标题/path），卡片内点「打开」→ dispatch `kb-open-in-editor`；Esc/空白处关闭卡片。**已拍板：单击聚焦 + 卡片确认打开（防误触）**。点空白 = 取消选中+居中复位 |
| **A7 本地图谱** | 工具栏开关：子图 = 当前选中页 + BFS 1~2 度邻居（复用 graph incoming）；展开时新节点从选中页坐标出生、alpha 0→1；退出子图恢复全图 |

> A6 打开方式为**待你拍板**的交互细节（Obsidian 单击直接打开；但误触率高，社区常用单击选中/双击打开）。

---

## 5. 过滤 / 着色 / 设置 / 增删（G3）

### 5.1 过滤（工具栏 + 画布联动）

- 按名称搜索（中文前缀/包含）；按标签过滤（tag 节点高亮 + 只留相关页）；
- 开关：显示标签节点（默认开，拍板 D6）、显示孤儿页（默认开）、显示 unresolved（当前 0，仍做开关）。
- 过滤不重建物理：被隐藏节点 `displayAlpha→0` 且从 collide/link 临时摘除（fx/fy 不变），避免整图重排。

### 5.2 着色分组（开关）

按页 `path` 一级目录（页无 path 时按 tag 分类）映射预设 6 色环；开启后同目录同色，是"分簇可读"的廉价版。

### 5.3 社区簇力（算法增强，与设计讨论对齐）

- 检测：**标签传播 label propagation**（~20 行、无依赖、对 216 页即时；比 Louvain 简单且足够），
  输入 = 页页边图（页-标签边不参与分簇）。
- 力：同簇 → link 距离乘 0.8 收紧；**异簇页对**增加一条"弱斥"（custom force：按簇重心，
  同簇 0.3·d、异簇 −1.5·d 沿重心线修正）→ 主题各自成团、跨簇少纠缠。
- 开关在设置面板，默认开；切换只更新 force 参数并 alpha 重启，不重建节点。
- 备用增强（暂不做）：Louvain 精分、MDS/频谱初始化 —— 等真实图上效果不够再上。

### 5.4 设置持久化（仓库级 config，首次引入）

- 现状：仓库级 `config.json` 无读写先例（全局设置走 `settings.json`）。
- 规格：主进程新增极简 `repoConfig` 读写（照 jsonStore 模式，文件 `.knowbase/config.json`，
  内容 `{ schemaVersion:1, graphView:{ linkDistance, chargeStrength, showTags, showOrphans, colorBySpace, tagTextAt, ... } }`，
  **只读/写 graphView 段**，未来其它仓库级设置扩段）；
- IPC：`repo:getConfig` / `repo:updateConfig`（白名单收口），web wrapper 两枚。
- 回退：首次无 config 文件 → 返回默认；写失败静默（设置不进影响功能）。

### 5.5 增删生长动画（A8）

- 视图每次 getGraph 的数据 diff 上一份（进入时拉 + 每次 `data-imported`/返回图谱时刷新）：
  新增节点 `r:0→目标` 缓动、新边淡入、局部 alpha 重启；删除节点 `r→0` 后移除；
  不整图重排（复用 5.1 的"局部摘除"机制）。

---

## 6. 里程碑验收清单

**G1 提交验收**（✅ 9eef5ec）
- [x] build 包体增量记录（d3-force）
- [x] 真实库节点=216页+9标签与 graph.json 一致（前端日志打印计数）
- [x] 真机：知识模块 → 图谱入口 → 画布节点自动散开、停帧省电
- [x] 真机：点击页节点能打开对应 .md（编辑器模块）
- [x] 空仓库/未开仓库 → 空态提示不崩

**G2 提交验收**（✅ 4a3ee6d）
- [x] hover 邻居高亮过渡 ~200ms；拖拽回弹自然；缩放/平移流畅
- [x] 本地图谱（选中页 +1~2 度）从选中页"长出来"
- [x] Esc 退出图谱回列表

**G3 提交验收**（✅ c0f6536；A8 增删动画本批）
- [x] 设置面板参数即调即生效，重启后保留（.knowbase/config.json 出现 graphView 段）
- [x] 标签节点开关 / 孤儿页过滤 / 搜索过滤生效且不动其它节点位置
- [x] 簇力开→主题分团、关→退回普通力导向（对比明显）
- [x] 新建/删除页面后回到图谱局部更新，无全局闪烁（A8：merge 保留坐标 + birth/ghost 动画，本批实现，待真机复核）

---

## 7. 风险与边界

1. **worker chunk**：electron-vite 下 worker 独立 chunk 有坑 → 规格默认主线程，实测卡再 worker。
2. **包体**：d3-force ~30KB，build 后核对（不引 pixi/完整 d3）。
3. **sqlite 残留**：图谱仅 vault 有意义（数据源 GraphIndex）。非 vault → GraphView 空态提示。
4. **index.tsx 膨胀**：GraphView 独立目录，index.tsx 只加 `graphMode` state + 一个挂载点。
5. **性能红线预留**：>2000 节点自动视口裁剪（当前不实现，留接口注释位）。

---

## 8. 拍板记录（2026-09-02 已定稿）

1. **A6 打开方式**：单击聚焦 + 右上卡片确认打开（防误触），已定稿见 §4。
2. **图谱入口**：左侧目录树底部常驻按钮（错题本同排，不受"空间内"限制），已定稿见 §2.1。
3. **G1 范围**：只做全仓库全局图 + 点击卡片跳转；本地图谱（A7）整体推后到 G2，已定稿见 §0。
