# PDF 深层编辑（注释层）后续实现方案

> 状态：规划中，未实现。本文档记录已论证的技术路线与实现要点，作为后续开发依据。
> 背景：PDF 工具箱 v1 已内置（合并/页面重组/提取文本，主进程 pdf-lib + 渲染层 pdf.js）。
> 内容级流式重排编辑（像 Word 那样改原文）经论证开源界无成熟方案（PDF 为打印指令集，
> 改字必跑版），**不做**；本方案做的是「注释层编辑」——不破坏原文，在页面上叠加标注。

## 能力清单（按优先级）

1. **文字高亮**：选中文本 → 涂色（黄/绿/红可选）
2. **文字批注**：页面任意位置插入文字框（如中文释义、翻译笔记）
3. **涂盖/替换**：白（或自选色）矩形盖住原区域，可选叠加新文字（改标题、抹答案、挖空）
4. **画框/下划线/删除线**：框选区域叠加图形
5. 注释随 PDF **烧进导出文件**（任何阅读器可见），不走 PDF annotation 对象（避免兼容性差异）

## 技术路线

### 坐标系与文字选区

- 渲染层已有 pdf.js（pdfjs-dist 3.11，同 PdfViewer/PdfToolkit）
- **文字坐标**：`page.getTextContent()` 每个 item 携带 `transform`（含 x/y 与字号）与 `width/height`，
  可建立「字符 → 页面矩形」映射；用户按住拖动选词时，用 pdf.js 自带的文本层
  （`TextLayer` 渲染透明文字层 + CSS ::selection）是最省力方案——**推荐直接用文本层选择**，
  免去自实现命中测试
- 选区矩形 → pdf.js 视口坐标（viewport.convertToViewportPoint）→ 缩放回 PDF 用户空间
  （pdf.js viewport.scale = 渲染 scale，除回去即可）

### 烧进导出（pdf-lib）

- 主进程已持有 pdf-lib；新增 `pdf:annotate` handler：
  - 入参：`{ data: Uint8Array, annotations: Array<{ page: number, kind: 'highlight'|'text'|'rect'|'underline', rect: [x,y,w,h]（PDF 用户空间，原点左下）, color?: string, text?: string, fontSize?: number }> }`
  - 高亮：`page.drawRectangle({ color: rgb, opacity: 0.35 })`（multiply 混合 pdf-lib 不支持，
    半透明即可）
  - 文字批注：`page.drawText`（注意中文需嵌入字体：pdf-lib 内置仅 WinAnsi；中文批注需
    `fontkit` + 加载 ttf——`@pdf-lib/fontkit` 配思源黑体子集，或限制批注用英文/拼音 v1 先行）
  - 涂盖：不透明矩形 + 可选 drawText
- 编辑会话内的注释列表保存在渲染层状态（不落库）；「保存」时一次性 pdf:annotate 烧进并导出。
  如将来需要「注释可撤销/随应用保存」，再加一张 `pdf_annotations` 表按文件哈希存 JSON。

### 交互设计

- PdfToolkit 单页编辑视图：点缩略图进入大图模式（pdf.js 渲染，scale 适配宽度）
- 工具条：高亮 / 文字 / 涂盖 / 矩形 / 撤销 / 清空 / 保存导出
- 高亮 = 文本层原生选择后点工具条色块（取选区 client rect → 页面坐标，跨行多矩形）
- 撤销栈：注释数组 immutable push/pop

## 依赖与工作量

- 零新 npm 依赖（pdf-lib 画矩形/文字原生支持；fontkit 仅中文批注需要，`@pdf-lib/fontkit` 单包）
- 预估：文本层选择 + 高亮约一天；涂盖/文字框约一天；导出烧进半天；中文字体嵌入半天
- 关联：OCR 与 PDF→Markdown 导入向导（另行规划）落地后，本能力与「转换后的知识库页面」
  互补——要保版式用注释编辑，要进刷题/生词闭环用转换

## 明确不做

- 原文字符级改写与段落重排（格式破坏不可控）
- PDF 表单填写（场景不需要）
- 注释对象（/Annots）写法（各阅读器渲染差异大，统一烧进更可控）
