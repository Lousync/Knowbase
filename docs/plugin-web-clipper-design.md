# Web Clipper 剪藏插件设计（浏览器扩展 + 桌面端本地服务）

> 日期：2026-09-02 · 类型：方案文档（本会话只出方案，不落代码）· 状态：**用户中意，已要求分析并成文，待拍板**
> 建议挂载：`rework-master-plan.md` §7 子文档索引（继续 plugin- 前缀命名）
> 来源：`docs/plugin-obsidian-benchmark-20260902.md` §5.4（Web Clipper —— 官方插件里最能拉新的外围件）

---

## 1. 背景与定位

- 网页剪藏是**知识管理工具最常用的"入口型"功能**：浏览器里看到好内容 → 一键存成本地 Markdown。Obsidian 官方为此专门做了浏览器扩展（Web Clipper），支持 Chrome/Brave/Arc/Edge/Firefox/Safari。
- Knowbase 是**纯本地**工具，剪藏天然契合（内容不出本机）；且已具备做这件事的两块地基：**lanShare 手写 HTTP 服务经验**（鉴权/上限/流式）与**Vault 文件体系**（编辑器草稿语义、`_inbox` 收件箱）。
- 定位判断：剪藏服务是**主进程网络 + 文件写入核心面**，类比 lanShare —— 已定 lanShare 不进插件沙箱（理由：主进程网络）。因此 **Web Clipper 也宜做"内置能力 + 配套浏览器扩展"，不走市场插件**；扩展只是瘦客户端。这样还能避免把它暴露在 v3 插件沙箱的复杂度里。

---

## 2. 借鉴对象实测：Obsidian Web Clipper 的架构（2026-07 源码核查）

**关键事实**：Obsidian Clipper 在 2026-03（PR #725 CLI/API）重构后，核心是**环境无关的 `clip()` 纯函数**（`src/api.ts`），分层如下：

| 层 | 实现 | 位置 |
|---|---|---|
| 页面抓取 | 扩展发起 fetch / content script 取当前页 | 扩展内 |
| 正文提取 | **defuddle**（内容提取，产出 title/author/content/description/site/schema.org 等变量） | 扩展内 |
| HTML→Markdown | defuddle 的 `createMarkdownContent` | 扩展内 |
| 模板渲染 | 自研 `compileTemplate` + 变量/filters（Handlebars 风格）、URL 前缀/正则/schema.org **trigger 自动匹配模板** | 扩展内 |
| **写入落盘** | `api.ts` 注释明示："The caller is responsible for … Writing the output (file, vault API, etc.)"——**通道被抽象掉** | 桌面端配合 |

- 功能面：capture（剪藏）/ highlighter（页内高亮）/ reader（阅读模式）/ interpreter（AI 处理页面数据，**需登录 Obsidian 云端账号**）/ 模板系统（variables/filters/logic，扩展内 `lz-string` 压缩存储）。
- 图片本地化是 Roadmap 项（"Save images locally (Obsidian 1.8.0)"）——即**历史版本默认保留远程 URL**，图片下载依赖桌面端新版本配合。
- 第三方库（均 MIT/宽松）：defuddle、webextension-polyfill、dayjs、lz-string、dompurify（消毒）。
- 本地安装方式（对我们最有价值）：`chrome://extensions` → 开发者模式 → Load unpacked 选 `dist/`（README 明确支持）。

**对我们的启示**：Obsidian 把 defuddle/模板全塞进扩展，是因为**它的桌面端不提供本地服务通道**（只能 URI + 桌面端写盘）；而 **Knowbase 有 lanShare 先例，可以反着做——桌面端开本地服务，扩展保持极薄**。同样的 defuddle 库放到桌面端 Node 侧运行，抓取层质量对齐，但扩展体积/权限/审计成本全部下降。

---

## 3. 架构决策：厚桌面端 + 薄扩展

```
浏览器（扩展，MV3 极薄）             Knowbase 桌面端（主进程）
┌─────────────────────────┐        ┌──────────────────────────────┐
│ popup：连接状态/标题/标签 │        │ clipperServer（127.0.0.1:固定端口） │
│ content script：取当前页  │        │  guard：Origin 白名单 + Bearer token│
│ html + url + title      │ ──HTTP→ │  POST /api/clip：校验+限额        │
│ （不做提取/转 md/模板）    │        │  defuddle+linkedom 提取→md（对齐抓取质量）│
└─────────────────────────┘        │  dompurify 消毒 → frontmatter    │
                                   │  原子写 _inbox/clipper/<date>-标题.md │
                                   │  ←── 回执 {ok, path}（扩展显示成功）    │
                                   └──────────────────────────────┘
```

### 3.1 为什么是本地 HTTP 通道（而非 obsidian:// 式自定义协议）

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 本地 HTTP 127.0.0.1 + token | 双向（扩展能 ping、能拿**成功回执**显示在弹窗）；复用 lanShare 整套 guard/鉴权模式；端口可配 | 需常驻一个小服务；要处理 CORS/Origin | **采用**（lanShare 已验证此模式） |
| 自定义协议 URI（kb://clip?…） | 免端口免服务 | 无回执；Windows dev/便携模式注册麻烦；浏览器对长 URI 有限制 | 不用 |

### 3.2 为什么 defuddle 放桌面端（与 Obsidian 相反的取舍）

- **引擎归宿主、外围件薄** —— 与 PDF 阅读器设计（`plugin-pdf-reader-design.md`：引擎归宿主、UI 归插件）同一哲学。
- 扩展只剩「取 HTML + 发请求 + 显示结果」≈ 数百行，无 defuddle/模板/设置大页面 → 上架审核面小、维护点收敛在 Knowbase 仓库内。
- 抓取质量与 Obsidian 对齐：**用同一库 defuddle**（Node 侧需 linkedom 提供 DOM，均为 MIT）。备选 turndown（更直白但只是 html→md，无正文提取变量）——不取。
- 后续 AI 智能剪藏（§7 Q2）直接复用主进程 AI Key，扩展零改动。

### 3.3 扩展（MV3）最小面

- 权限最小化：`activeTab` + `scripting` + `storage`；**不申请 `<all_urls>` host_permissions**——剪藏时 `chrome.scripting.executeScript` 按需取当前页 DOM（serialize 出 html 串），请求发给桌面端由**扩展后台 fetch**（扩展页面不受页面 CORS 限制，服务端仍校验 Origin=扩展 id）。
- popup 内容：连接状态（`GET /api/ping` 心跳，桌面端离线即显灰）→ 可编辑标题/标签 → 「剪藏整页」/「仅存链接」两个动作 → 成功回执（存到 `_inbox/clipper/…`）。
- 页面 html 上限 5MB（超限提示改用仅链接），真实网页常见 1–3MB。
- 本地安装即用：仓库出 `dist/`（Chromium），README 给 Load unpacked 流程（与 Obsidian 同款）。

### 3.4 桌面端服务（electron/lib/clipperServer/）

- **路由**（复用 lanShare server 骨架模式，`auth.ts` 的 tokenMatches/extractToken 直接 import）：
  - `GET /api/ping` → 200（扩展连接状态）
  - `POST /api/clip` → body `{ url, title, html, tags? }` → 校验 → defuddle 提取转 md（3s 超时兜底）→ sanitize → 写盘 → `{ ok: true, path }`
  - 错误码语义：401（token 错）/ 403（Origin 不在白名单）/ 413（超 5MB）/ 422（HTML 解析失败或无正文）
- **监听**：仅 `127.0.0.1`，端口固定默认 **42817**（设置可改；占用则自动 +1 并在设置页提示当前端口）；应用启动即监听（否则扩展无法唤醒桌面端——扩展 ping 不到就提示"打开 Knowbase"）。
- **token**：每次启动随机生成，设置页可查看/重置（重置后扩展端需更新）；不做二维码配对（v2 可选，复用 lanShare qr）。
- **写盘**：`当前仓库根/_inbox/clipper/<yyyy-MM-dd>-<净化标题>.md`（无仓库则 422 提示先选仓库）；标题净化复用编辑器安全名规则（Windows 非法字符 → `_`）；**原子写**（tmp+rename）。
- **frontmatter 约定**（v1，不带 `id` = 编辑器草稿语义，见 §5）：

```markdown
---
title: "…"
source: "https://原文URL"      # 剪藏来源，保留溯源
clippedAt: 2026-09-02T13:30:00Z
tags: [可选, 用户弹窗输入]
clipper: true                  # 收件箱标记
---

（defuddle 提取并转 md 的正文）
```

### 3.5 最终呈现与功能清单

**浏览器端（扩展弹窗，四态）**

| 状态 | 呈现 |
|---|---|
| 已连接 | 顶部状态点绿 +「已连接」；可编辑标题、可选填写标签、两个动作（剪藏整页 / 仅存链接） |
| 离线 | 状态点灰 +「未连接」；按钮禁用并提示「请先打开 Knowbase」 |
| 剪藏中 | 状态点琥珀；主按钮变「提取正文中…」，副行提示「defuddle 提取 · 转 markdown · 落盘」 |
| 已完成 | 绿色回执块显示落盘路径 `_inbox/clipper/<date>-<标题>.md` +「在 Knowbase 打开」/「再剪一个」；脚注「草稿：无 id，暂不进知识索引」 |

**桌面端**：设置页新增「剪藏服务」卡片——运行状态（随应用启动，正在监听）/ 服务地址（`http://127.0.0.1:42817`）/ 令牌（掩码 + 重置 + 复制）/ 保存位置（只读）。剪藏产物 = `_inbox/clipper/*.md`，编辑器打开即见 frontmatter + 正文（frontmatter 隐藏编辑已支持）。

**端到端耗时**：ping <20ms；提取 + 转 md + 落盘 1–3 秒。**全程在弹窗内完成，不需要回到应用操作**——这是它"入口型功能"价值的关键。

**Q0 明确不做**：模板系统（Obsidian 强项，但会让扩展变厚）、选区/高亮剪藏、图片本地化（正文保留远程 URL，等附件 vault 化后再议）、schema.org 自动匹配模板、多账号/云同步。

---

## 4. 安全清单

1. 服务只绑 `127.0.0.1`（lanShare 绑 0.0.0.0 面向局域网，这里相反，仅本机）。
2. **Origin 白名单**校验（`chrome-extension://<id>` / `moz-extension://<id>`）——恶意网页即使知道端口也发不出请求（跨源无 token 预检不通过）；双保险 = Bearer token。
3. 内容消毒：HTML 先过 dompurify 再提取；产出 .md 本身不含可执行 HTML，且 Markdown 渲染层既有「默认不渲染原始 HTML」防护（react-markdown 配置）——纵深防御。
4. 大小/超时限额（5MB / 3s 提取超时）；标题净化 + 固定目录前缀，无用户可控路径拼接（防穿越）。
5. token 不入渲染层日志；审计可复用 plugin_audit_log 通道记 clip 动作（数量与来源域），对齐既有审计习惯。

---

## 5. 与既有路线的衔接（含一个必须修的联动点）

| 项 | 关系 |
|---|---|
| lanShare | 复用 server 骨架与 auth.ts token 工具；但服务语义不同（lanShare 临时+局域网 / clipper 常驻+本机），**新建独立目录不混用实例** |
| `_inbox`（编辑器草稿语义） | 剪藏落 `_inbox/clipper/`：文件树已屏蔽（`APP_INTERNAL_DIRS`）、无 frontmatter id → 不进知识索引，用户用编辑器整理归档——与迁移器 `_inbox` 语义一致 |
| ⚠️ **knowledgeIndex 联动修正** | `scanMarkdownFiles` 跳过集 = `.`开头 / `_attachments` / `blog`，**不含 `_inbox`** → 迁移器与剪藏放进 `_inbox` 的无 id .md 每次索引重建都会刷「缺少 frontmatter.id」warning。**本功能应把 `_inbox` 补进索引跳过列表**（一行改动 + 冒烟断言） |
| workspaceManager 原子写/净化 | 写盘规范对齐（safeName/临时文件+rename）；但 clipper 不经 ws:* 通道（不属"渲染层请求"），直接主进程内按当前仓库根写 |
| 去库化 `_inbox` | 无分类内容收件箱是本路线既有概念，剪藏是其天然上游输入源 |
| 编辑器 | 剪藏产物 = 草稿 .md，编辑器可打开继续整理（frontmatter 隐藏编辑已支持） |
| 插件市场 | **不按市场插件走**：主进程网络+文件核心面，同 lanShare 判定 |

---

## 6. MVP 范围（Q0）与分期

| 期 | 内容 | 依赖 |
|---|---|---|
| **Q0（MVP）** | 扩展（popup + 取当前页 + ping + 剪藏整页/仅链接 + 本地 unpacked 安装）＋ clipperServer（ping/clip 路由 + Origin/token/限额 + defuddle+linkedom 提取转 md + 落盘 `_inbox/clipper/`）＋ 设置页（端口/token 展示与重置）＋ **knowledgeIndex 跳过 `_inbox` 修正** | lanShare auth 复用；新增依赖 defuddle + linkedom + dompurify（均 MIT，同 d3-force 破例先例） |
| **Q1** | 选区/高亮剪藏（对标 highlighter）；正文/整页模式选项；模板变量（文件名/标题占位）；失败重试与剪藏历史（近 N 条） | Q0 |
| **Q2** | **AI 智能剪藏**：剪藏后自动标签/一句话摘要/分类建议（本地 AI Key 链路——Obsidian interpreter 要云端账号，Knowbase 全本地是差异化卖点）；图片下载本地化（**等附件 vault 化**，正文仍保 URL）；多仓库切换 | Q0+Q1、附件 vault 化 |
| 后置候选 | Edge/Chrome 商店上架；Firefox（webextension-polyfill 已铺路）；手机端剪藏（分享到 → 需移动端） | — |

---

## 7. 验收与冒烟计划

- **冒烟** `tmp/smoke/clipper-smoke.mjs`：内存起 server（127.0.0.1 随机端口）→ ping / clip 往返（frontmatter 回读、正文 md 落盘、`_inbox/clipper/` 路径、标题净化、原子写）；安全矩阵（无 token 401 / 错误 token 401 / 非白名单 Origin 403 / 超 5MB 413 / 空正文 422）；knowledgeIndex 新增「`_inbox` 跳过不刷 warning」断言。**全绿口径：全部用例通过 + tsc 双侧零错误**。
- **人工验收**（浏览器实测三型页面）：长文新闻站（正文提取干净）/ 无正文的 SPA（fallback 仅链接）/ 含大量内联图的文章；剪藏后编辑器打开草稿、改标题归档流程顺；扩展离线态提示正确；重置 token 后扩展提示重新配对。

---

## 8. 待拍板问题

1. **通道**：本地 HTTP 固定端口（推荐）vs 自定义协议 URI——确认采用 HTTP（决定做一个小常驻服务）。
2. **defuddle 落桌面端**（推荐，加 defuddle+linkedom+dompurify 三依赖）vs 放扩展内（Obsidian 同款，扩展变厚）——确认破例引包。
3. **落盘语义**：`_inbox/clipper/` 草稿（推荐，编辑器整理）vs 直接进知识索引（带 id + 弹窗选分类）。
4. **knowledgeIndex 跳过 `_inbox` 联动修正**是否随本功能一起做（强烈建议：一行改动消除迁移器遗留的 warning 刷屏）。
5. **图片 v1 策略**：保留远程 URL（推荐；Obsidian 历史版本同款）vs v1 就尝试下载（但附件 vault 化未完成，不建议）。
6. **「仅存链接」是否进 Q0**（推荐进：10 行成本，覆盖"先存下来"场景）。
7. 常驻服务启动策略：随应用启动（推荐）——是否接受固定端口 42817 + 占用自动 +1。

---

## 9. 关联文档

- `docs/plugin-obsidian-benchmark-20260902.md` §5.4（立项出处）
- `docs/plugin-pdf-reader-design.md`（"引擎归宿主、外围件薄"哲学先例）
- `electron/lib/lanShare/server.ts` / `auth.ts`（骨架与鉴权复用源）
- `docs/knowledge-query-design.md`（同批立项的库查询——剪藏产出可作为其"无标签待治理"输入场景）
- `.AGENT/docs/读写分工设计.md`、`docs/rework-master-plan.md`
