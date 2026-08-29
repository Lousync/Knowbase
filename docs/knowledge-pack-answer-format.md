# 知识包大题解析排版规范

> 适用：所有"内容型"知识包（408、考研数学/英语/政治、未来可能的小程序等）
> 目的：从源头保证排版正确，让所有用户从插件市场下载后导入即正确，无需本地兜底。

## 核心原则

**大题解析必须按小问结构化呈现**：每个小问独立成段、加粗小标题（用题干 (1)(2)(3) 描述作标题）、代码块归属紧随对应小问。

## 格式模板

### 大题（`第 N 题（X 分）`）

```markdown
### 第 41 题（13 分）

题干段落 1。

题干段落 2：含 (1) 第一个小问的描述。
含图片的题干段落（图用 attachment 引用）。

(1) 第二个小问的描述。

(2) 第三个小问的描述。

(3) 第四个小问的描述。

```spoiler-answer
**解析**：

**(1) 第一个小问的描述**

第一个小问的解析内容……

```c
// 第一个小问涉及的代码（如果有）
typedef struct BiTNode {
    int weight;
    struct BiTNode *lchild, *rchild;
} BiTNode, *BiTree;
```

**(2) 第二个小问的描述**

第二个小问的解析内容……

**(3) 第三个小问的描述**

第三个小问的解析内容……

```c
// 第三个小问涉及的代码（如果有）
int WPL(BiTree root, int depth) {
    if (root == NULL) return 0;
    // ...
}
```

调用 WPL(root, 0) 即得结果。时间复杂度 O(n)，空间复杂度 O(树高)。
```
```

## 规则清单

### 题干
1. **小问编号统一用 `(1) (2) (3)` 全角括号**（与常见教材风格一致）
2. 每个小问描述独立一行（不要挤在一行内）
3. 小问描述即作为解析 spoiler 里的**加粗小标题**（应用脚本可自动对齐）

### 解析 spoiler
1. **首行固定** `**解析**：` 独占一行（不要拼接 "答案："）
2. 每个小问按以下顺序排版：
   ```
   **(N) 题干对应的小问描述**

   解析正文……
   
   ```language
   代码（如果有，紧跟该小问）
   ```
   ```
3. **小问之间用一个空行分隔**（不要用 `---` 横线）
4. 代码块归属：放在对应小问的解析正文之后，下一小问之前
5. 小问内解析正文如有多行可换行；不强制每行一空行
6. 不需要在解析里再写 `1、` `2、` `3、` 编号（已用加粗小标题表达层级）
7. 解析末尾如有"调用示例"/"时间复杂度"等收尾说明，作为**最后一个**小问的内容延伸（不加新小标题）

### 反例（禁止）

```markdown
# 反例 1：小问挤在一行
**解析**：答案：1、基本设计思想：采用先序递归遍历……深度加 1。2、结点数据类型定义：

```c
typedef struct ...  // 代码块与小问混在一起，归属不明
```

3、算法描述：……

# 反例 2：缺少加粗小标题层级
**解析**：基本思想用快慢双指针……
时间 O(n)、空间 O(1)……
核心代码……

# 反例 3：代码块错位
**(1) 基本思想**

```c
// 这是 (2) 的代码却跑到 (1) 下面
```

**(2) 数据类型定义**
```

## AI 生成 Prompt 建议

在生成大题内容时，在 prompt 中加：

```
大题解析必须严格遵守以下结构（直接输出最终 markdown，不要解释）：
- spoiler-answer 围栏首行：`**解析**：` 独立成段
- 每个小问格式：
  **(N) 题干小问描述**（用题干的 (1)(2)(3) 描述作小标题，必须加粗）
  空行
  小问解析正文
  空行
  ```language
  代码（如果有，紧跟该小问，不跨小问）
  ```
  空行
- 小问之间用一个空行分隔，不要用 ---
- 解析末尾如有收尾说明（调用示例/复杂度等），并入最后一个小问内容
- 不要在解析里写"答案：1、xxx 2、xxx"这种挤行写法
- 不要在解析里再加"1、""2、""3、"这种编号（已用加粗小标题表达）
```

## 验证清单

发布前用以下方式快速验证（可选）：

1. **本地修复脚本**（项目内 `scripts/fix-quiz-answer-layout.py`）可自动重排大题解析，但**仅建议作为开发期修复工具**——从源头遵循本规范才是正解
2. 人工抽查：每科抽 1-2 道大题，确认：
   - [ ] 小问加粗标题用题干描述
   - [ ] 每问独立成段、段间空行
   - [ ] 代码块归属正确（紧跟对应小问）
   - [ ] 解析开头 `**解析**：` 独立成行
   - [ ] 解析内无 "1、""2、" 编号残留

## 版本演进

- 408 插件 v1.2.0：应用本规范重新生成大题解析（替换 v1.1.0）
- 未来数学/英语/政治插件：从 v1.0.0 起遵循本规范

## 配套修复工具（AI 遇到排版问题先看这里）

| 工具 | 路径 | 用途 |
|---|---|---|
| **知识包源修复 + 打包** | `scripts/fix-408-pack.py` | 修复插件源目录 `pages/exams/*.md` 大题解析（小问加粗标题 + 独立成段 + 代码块归属）→ 升版本 → 重新打包 zip。用法：`python scripts/fix-408-pack.py --src <插件目录> --out <输出目录> --version X.Y.Z` |
| **数据库直接修复** | `scripts/fix-quiz-answer-layout.py` | 直接修 `knowledge_pages.content_md`（`--write` 实写 / 默认 dry-run / `--db` 指定库），用于已导入页面的立即可见修复 |
| **渲染层兜底** | `src/lib/answerLayout.ts` → `normalizeAnswerLayout()` | 句末标点后小问编号自动断行（已接入 MarkdownPreview 的 SpoilerBlock），防规范遗漏 |
| **远程市场上传** | 流程见下"发布到远程市场" | 上传新 zip + 更新 registry.json + CHANGELOG.md |

### 典型工作流（AI 执行顺序）

1. **已导入页面立即可见**：`python scripts/fix-quiz-answer-layout.py --write`（默认修 dev 库）
2. **源头修复（让所有用户受益）**：
   - 源 = 本机插件缓存解包目录（`%APPDATA%/knowbase (dev KnowledgeRecorder)/plugins/<plugin-id>`），改它比下载远程 zip 快
   - `python scripts/fix-408-pack.py`（复制源 → 修复 → 升版本 → 打包 zip）
   - 发布到远程市场（见下）
3. **同步本机库**：把新 zip 内页面 md 与 `knowledge_pages` 按 title 对齐同步（hash 与新版一致 → 重导入不触发 userModified 跳过）

### 发布到远程市场（大文件上传）

- 远程仓库 `Lousync/Knowbase-plugins`：`registry.json` + `CHANGELOG.md` + `plugins/<id>-<version>.zip`
- 插件 zip >1MB，**contents API 不返回内容（≤1MB 限制）**，走 **git data API 链**：
  `POST /git/blobs`（base64，`gh api --input -` 从 stdin 传 body，**必须加 `--input -` 否则 422`）→ `GET /git/ref/heads/main` → `GET /git/commits/<sha>` → `POST /git/trees`（base_tree + 变更项）→ `POST /git/commits` → `PATCH /git/refs/heads/main`
- registry 条目更新：version / downloadUrl（新 zip 文件名）/ size（字节）/ updatedAt；registryVersion +1；CHANGELOG 追加日期条目
- 本环境 curl 直连 api.github.com 会被墙（SSL 失败），一律用 `gh api`（走认证代理）

### 发布注意事项

- 修复脚本写文件时强制 `newline='\n'`（Windows 文本模式默认 CRLF，避免污染 markdown 行结构）
- 插件更新时 importer 判 `userModified` 跳过本地改动的页面 → **用户在应用内更新后重导入需勾选"覆盖本地修改"**（或让页面与新版 zip 的 md 完全一致）
- 发布后验证：`gh api .../contents/registry.json` 确认条目、`.../contents/plugins` 确认新 zip 存在

## 兜底

应用层 `src/lib/answerLayout.ts` 的 `normalizeAnswerLayout()` 会把"句末标点后紧跟小问编号"自动断行（防未来规范遗漏）；但**只兜底不替代源头规范**。
