# PDF 阅读器插件设计

> 归属：[rework-master-plan.md](./rework-master-plan.md) R1/R2（编辑器组文档类型）+ D3（v3 插件）。状态：**设计定稿（2026-09-02 拍板完成）**。
> 参考对象：VS Code `vscode-pdf`（tomoki1207/vscode-pdfviewer，MIT，PDF.js + Custom Editor API）。

## 1. 现状盘点（实测 2026-09-02）

| 已有能力 | 位置 | 形态 |
|---|---|---|
| 内嵌 PDF 阅读 | `src/modules/knowledge/components/PdfViewer.tsx` | pdf.js **v3** 单页 canvas 渲染：翻页/缩放/适合宽度/滚轮 |
| 结构化操作 | `electron/lib/pdfService.ts` | pdf-lib：合并/页面重组/导出（主进程，纯 JS） |
| PDF 工具箱 | `src/modules/toolbox/components/pdf-toolkit/` | 合并/重组/文本提取（提取在渲染层走 pdf.js） |
| 知识库附件 | knowledge 模块附件面板 + 注解层（既往版本） | PDF/XMind/代码附件，曾做注解层，**用户不满意** |

### 不满意点的技术归因（推测，待用户确认）

1. **阅读体验简陋**：单页 canvas、无连续滚动/大纲/缩略图/搜索/文本选择——是「查看器」不是「阅读器」
2. **大文件性能**：附件以 **base64 全量过 IPC** 传给渲染层（`PdfViewer` props 就是 base64），几十 MB 的 PDF 内存翻倍、启动卡顿
3. **Vault 模式读不了 PDF**：`workspaceManager.readWorkspaceFile` 对二进制文件**不返回内容**（detectBinary 拒绝），且 >10MB 只读、>50MB 拒开——迁移到 Vault 的 `_attachments/` 后 PDF 附件直接读不了
4. 注解层交互（如有）与阅读器割裂，体验不连贯

## 2. VS Code vscode-pdf 架构借鉴（已核实）

### 2.1 宿主模式：Custom Editor API

```
package.json: "customEditors": [{ "viewType": "pdf.preview", "displayName": "PDF 预览",
                                 "selector": [{ "filenamePattern": "*.pdf" }] }]
激活事件: onCustomEditor:pdf.preview   ← 双击 .pdf 即激活
PdfCustomProvider.resolveCustomEditor → PdfPreview（webview 实例，生命周期与编辑器 Tab 绑定）
```

**这是我们要搬的核心模式**：编辑器区按「文件类型 → 视图 Provider」路由，PDF 只是注册在册的一种文档类型。映射到 Knowbase = **文档类型注册表**（md→Monaco、pdf→阅读器插件、png→图片查看…），这正是插件贡献点（对标 VS Code customEditors，对应我们的 `contributions.views`/新增 `contributions.documentTypes`）。

### 2.2 引擎：复用 PDF.js 完整 viewer（不是裸 canvas）

vscode-pdf 直接把 PDF.js 官方 `viewer.html` 全家桶嵌进 webview，白得的功能：

| 能力 | 说明 |
|---|---|
| 文本层 | 每页 canvas 之上叠透明 text layer → **可选中复制、可搜索**（搜索引擎就是 pdf.js 自带的） |
| 大纲 + 缩略图侧栏 | 文档 outline（书签）树 + 页面缩略图导航 |
| 工具栏 | 缩放档位（auto/page-fit/page-width/page-actual/数字）、旋转、光标工具（select/hand） |
| 滚动模式 | vertical / horizontal / wrapped；连页展示 spread mode（none/odd/even） |
| 搜索 | Ctrl+F 框内高亮、上下跳转 |
| 设置默认值 | `pdf-preview.default.*`（cursor/scale/scrollMode/spreadMode/sidebar）→ 存配置 |
| 状态保持 | reload 时保留 PDF fingerprint 与视图状态、防闪烁 |
| 沙箱适配 | `useWorkerFetch=false`（禁 worker fetch）；cMapUrl/standardFontDataUrl 显式配置（中文 PDF 必需 cMap） |

### 2.3 我们与 vscode-pdf 的环境差异

- vscode-pdf 扩展代码在 Node 侧能读文件再塞给 webview；我们**渲染层沙箱无 fs**，文件必须走 IPC —— 传输通道要自己设计（§4）
- VS Code webview 是扩展私有；我们是**沙箱 iframe 插件 + 宿主分发引擎**

## 3. 关键技术约束（实测，写进设计的前提）

1. **pdf.js 钉死 v3（classic worker）**：Electron 33 = Chromium 130，pdf.js v4.5+ 依赖 `Uint8Array.prototype.toHex`，Chromium 130 未实现 → **不能升 v4**（PdfViewer.tsx 注释已记录此坑）。当前 3.11.174 可用，锁版本
2. **Worker 构建**：`pdf.worker.min.js?url` 同源 worker 在 dev/prod 均可用（既有实践），打包需保持 worker 作为独立 asset
3. **二进制通道缺失**（§1.3 是 R 级阻塞）：需要新增「范围读取」IPC 支持 pdf.js 的 **range 请求懒加载**（大 PDF 只拉可见页字节）
4. pdf.js 引擎体量大（~1.6MB+worker）→ **引擎归宿主、UI 归插件**：宿主以运行时依赖提供 pdf.js 服务，插件只写阅读器外壳（工具栏/布局/设置映射），避免每个插件重复打包和版本漂移

## 4. 传输通道设计（新 IPC，命名待定 `ws:readRange` 族）

```
渲染层 PdfReader(插件 iframe)
   │  (fetch-like 适配层)
pdf.js Transport: requestData(range) ──IPC──▶ 主进程
   │                                         ├─ resolveSafe 校验 {rootId, relPath, offset, length}
   │                                         ├─ lstat 拒 symlink + 二进制放行（白名单扩展名 .pdf）
   │                                         └─ fs.read 读 [offset, offset+length) 返回 ArrayBuffer
   │                                         大文件策略：前 1KB 探测 + range 懒加载；不做全量读
```

- 复用 workspaceManager 的 rootId/relPath 模型与 resolveSafe（防穿越逻辑直接继承），仅新增**二进制放行 + 范围读取**两条语义，不破坏现有「>10MB 只读」的文本通道
- pdf.js 侧实现一个自定义 Transport（实现 `getData/getRange/requestData` 接口），或走 `disableAutoFetch + rangeChunkSize` 配置
- 安全：只读、白名单扩展名、按需授权（阅读附件 = 页面对应的附件记录已授权，不额外弹窗）

## 5. 宿主架构：文档类型注册表（与 R1/R2 对齐）

```
编辑器组
 ├─ .md   → Monaco（现有）/ CM6（R5）
 ├─ .pdf  → PDF 阅读器插件（本文）
 ├─ .png/.jpg → 图片查看器（可插件化，v2）
 └─ 注册表 = contributions.documentTypes（插件贡献点，R7 落地，R1 先内置白名单）
知识库模块（阅读主阵地，编辑已迁编辑器模块）：
  附件面板/正文链接遇 .pdf → 路由「在阅读器中打开」→ 编辑器组打开该 PDF
```

两个候选挂载位置（**待拍板**，见 §8 Q1）：
- **方案 A（编辑器组文档类型）**：VS Code 同款——PDF 获得中央大画布、可多标签并排（分屏后可与笔记同屏对照），与 md 打开路径完全一致
- **方案 B（知识库模块内嵌阅读视图）**：附件就地展开，「遇到 pdf 直接阅读」的直觉最顺，但阅读空间受模块布局约束，且插件视图嵌入宿主模块需要新的宿主挂载点（v3 插件视图默认挂在编辑器组/侧栏槽位，没有「嵌进另一模块内部」的槽）

## 6. 功能规格

### v1（阅读器，对标 vscode-pdf 可玩性）
- 连续滚动 + 键盘翻页；缩放档位（适合宽度/整页/100%/自定义），旋转
- 文本层选择复制；Ctrl+F 搜索高亮
- 侧栏：大纲树 + 缩略图（默认收起，配置记忆）
- **沉浸阅读模式（复用知识库既有范式，2026-09-02 拍板加入 v1）**：详见 §6.1
- 设置存 `.knowbase/config.json`（仓库级，`pdfReader.*`），主题跟随（深/浅色变量，text layer 反色）
- 大 PDF：range 懒加载，首屏 < 1s（本地读取）；页数/内存无硬上限（按屏渲染）
- 打开位置：知识库附件面板与正文 `attachment://` 链接均可触发

### 6.1 沉浸阅读模式规格（复刻知识库沉浸阅读的交互契约）

知识库现状（实测 `src/modules/knowledge/index.tsx`）：Ctrl+Shift+R 进出、Esc 退出；进入后**隐藏除正文外的一切 UI**（面板/工具栏/标签栏），顶部一条薄返回栏（「退出沉浸阅读 (Esc)」+ 页面标题）。**当前拦截「仅支持 md/txt 页面」——PDF 阅读器正是要破除这条限制的扩展对象**。

PDF 沉浸模式 = 同一范式 + PDF 特有变体：
- 进入：阅读器工具栏「沉浸」按钮 或 全局 `Ctrl+Shift+R`（沿用同一快捷键语义）
- 表现：隐藏标签栏/知识库树/大纲缩略图侧栏/工具栏——**只剩居中 PDF 页 + 底部悬浮小条**（页码 `第 12 页 / 共 320 页`、缩放 +/-、进度条，30s 无操作自动淡出、动鼠标唤出）
- 阅读态：连续滚动（沉浸模式强制 vertical 滚动，禁用分页/spread，对齐纸面阅读直觉）；翻页用 PageUp/Down 或滚轮
- 退出：Esc / 悬浮条返回按钮（返回时**保留阅读位置**——当前页+滚动偏移，进出一致）
- 文本层与搜索在沉浸模式**保持可用**（沉浸 ≠ 失能，只是去装饰）：Ctrl+F 呼出浮动搜索条（顶部居中、半透明），Esc 优先退出搜索再退出沉浸
- 与方案 A（编辑器组）组合：沉浸时隐藏包括标签栏在内的全部应用 UI，PDF 独占整窗——相当于同时拿到 A 的大画布和 B 的上下文专注

### 6.2 挂载位置（2026-09-02 已拍板：方案 A + 沉浸模式）

**结论：PDF 作为编辑器组文档类型打开（方案 A），叠加 §6.1 沉浸阅读模式**。默认与笔记同路径（标签栏可切换、分屏可对照），需要专注时一键沉浸、PDF 独占整窗——同时拿到 A 的大画布和 B 的专注感。知识库阅读页内的「内嵌快速预览」（方案 B）降级为可选入口，不阻塞主路径。

### v2（待定，不进 v1）
- 注解/高亮（原不满意点的解法另立小节：注解数据走 kb.store，锚定 page+bbox，独立于阅读器渲染，可选）
- 双链：从 PDF 选中文字 → 生成知识页引用（承接知识库反链体系）
- 阅读进度记忆（per 文件 lastPage，落 kb.store）

## 7. 分期与落位

| 阶段 | 前置 | 内容 |
|---|---|---|
| P1 | R1 编辑器组骨架 + 二进制范围通道 + 文档类型注册表白名单 | 内置 PDF 阅读器文档类型（UI 先做内置，不占插件通道），知识库附件路由打通 |
| P2 | R7 沙箱插件（贡献点就绪） | 阅读器外壳迁为官方 UI 插件（文档类型 contribution），验证「宿主引擎 + 插件壳」模型 |
| P3 | — | v2 功能（注解/引用/进度） |

## 8. 拍板记录（2026-09-02，全部已确认）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 挂载位置 | **方案 A（编辑器组文档类型）+ 沉浸模式**；知识库内嵌预览降级为可选入口（§6.2） |
| Q2 | 旧 PDF 不满意点 | 无大纲/目录/搜索 → **v1 硬需求 = 大纲侧栏 + Ctrl+F 搜索 + 文本层**（pdf.js viewer 自带） |
| Q3 | 引擎归宿主 | **接受**：pdf.js 锁 v3（classic worker）作为系统运行时，插件只写外壳 |
| Q4 | 注解进 v1 | **不进**：v1 只做阅读器；注解/引用/进度记忆留 v2 单独设计 |

v1 范围冻结：文档类型注册表接入 + 二进制范围读取通道 + 大纲/搜索/文本层 + 沉浸阅读模式 + 知识库附件路由。依赖 R1（编辑器组骨架）+ workspaceManager 二进制范围通道，P1 时序接 R1 之后。
