# Knowbase 插件 API v2 设计文档（v3 修订版）

> 目标：在 Vault 化（去库化 + 仓库文件系统）重构的基础上，把插件从「声明式内容包 + 弱沙箱页」升级为「有真实文件系统与宿主能力的插件生态」，同时不放弃现有的 S/A/B/C 安全分级资产。
>
> 版本：v1.0（设计稿，v2 红线） → **v1.1（v3 修订版）** · 基线：v2.15.1 · 分支 `fix/optimize-v2.15.1`
>
> **v3 修订说明（2026-09-03）**：D3 拍板「尽可能开放」——插件从「不执行代码」改为「**执行但关沙箱**」。
> 修订原则（与 `docs/rework-plugin-openness.md` 一致）：
> - 本文档所有「因为不执行代码所以 X」的推论**删除或改写**；Gateway/命名空间/安全分级骨架全部保留；
> - 新增：`type: 'code'` 支持（沙箱 Worker/iframe 执行）、包签名（signing 字段）、vaultScope；
> - 红线 1 更新为「执行但关沙箱，插件永远拿不到 ipcRenderer/fs/NodeAPI，能力全经 Gateway」；
> - 各节原红线 1 相关措辞已逐处修订（§3/§5.7/§10/§11/§12），API 细节（§5 命名空间、§6 manifest v2 字段）不变。

---

## 0. 一句话结论

现有插件体系的**安全分级设计是资产**（S/A/B/C 主进程强算 + 能力授权 + 审计），真正卡住生态的不是"接口数量不够"，而是三个结构性问题：

1. **桥的裁决点在渲染层**，导致"插件能力 = 渲染层已暴露 IPC 的子集"，加一个能力要动 3 处；
2. **插件完全接触不到 Vault**（`ws:*` 11 个 IPC 只服务内置编辑器），而 Vault 恰恰是这次重构的主线；
3. **C 级插件的数据模型是 SQLite 表**（`contributes.tables`），与"去库化 → `.knowbase/` 文件存储"的方向**正面对冲**，越晚改迁移成本越高。

v2 的核心动作只有三个：**把裁决点搬到主进程**、**给插件一套 Vault/Store 命名空间**、**让插件数据改用 `.knowbase/plugins/<id>/`**。

**v3 追加一个核心动作**：**放开可执行 JS**——插件可以跑代码（事件/UI/逻辑），但被关在沙箱运行时里，能力只能经同一个 Gateway 触达（红线 1 从"代码不跑"后移为"代码跑了但够不着系统"）。

---

## 1. 现状盘点（事实与数字）

### 1.1 三层结构

| 层 | 位置 | 职责 |
|---|---|---|
| 清单与安装 | `electron/lib/pluginRegistry.ts`（1057 行） | manifest 校验、安全分级强算、zip 落盘（防 Zip Slip）、registry 拉取（4 镜像回退）、审计、C 级数据表建删 |
| 沙箱容器 | `src/components/shared/PluginFrame.tsx`（154 行） | `plugin://{id}/{entry}` iframe + `sandbox="allow-scripts allow-forms allow-popups"` + postMessage 桥 + **授权判断** |
| 协议与 CSP | `electron/main/index.ts` `protocol.handle('plugin')` | 路径越界 403、MIME 映射、CSP 锁死网络（`connect-src 'none'`） |

### 1.2 规模（实测）

- 主进程注册 **345** 个 `ipcMain.handle`；preload 暴露 **335** 个 `invoke` + **14** 个事件订阅通道
- 插件/AI 相关 IPC 通道：plugin 系列 20+、aiTools 4、mcp 8、skill 6、pluginData 4、knowledgePack 2
- `KNOWN_CONTRIBUTIONS` **14** 类：`blogTemplates / theme / habitPresets / bookmarkPresets / pomodoroPresets / helpDocs / tools / skills / automationRule / knowledgePages / sidebarIcons / deleteFx / tables / views`
- `KNOWN_CAPABILITIES` **5** 个：`theme / clipboard / data / knowledge / navigation`
- 沙箱桥 action **8** 个：`data.query / data.insert / data.update / data.delete / clipboard.write / theme.apply / toast / host.review`
- 内置 AI 工具 **13** 个（`builtin.knowledge.*` / `habits.*` / `bookmarks.*` / `pomodoro.*` / `schedule.*` / `blog.*` / `checkin.*` / `web.search`）

### 1.3 已经打好的地基（不要重造）

| 资产 | 位置 | v2 如何复用 |
|---|---|---|
| `resolveSafe` 逐段 lstat 拒符号链接 | `workspaceManager.ts` | **直接复用**为插件 Vault 访问的路径守卫，零新增风险面 |
| 原子写（tmp + rename） | `jsonStore.ts` / `writeWorkspaceFile` | 插件 Store 与 Vault 写入共用同一套 |
| kbStore 三层存储 | `kbStore/{jsonStore,mdStore,secretStore}.ts` | 插件 Store 直接建在 `kbModulePath` 之上 |
| 当前仓库上下文 | `kbStore/vaultContext.ts` | 插件永远绑定"当前仓库"，不需要 rootId 参数 |
| `assertDataAccess` 能力校验 | `pluginRegistry.ts:941` | 提升为**通用裁决器** `assertCapability`，覆盖全部命名空间 |
| 月度上限 + `pluginAudit` | `pluginAudit.ts` | v2 所有 RPC 走同一条审计与限额链路 |
| `unzipBuffer` + `safePathInside` | `zip.ts` / `pathGuard.ts` | 包安装路径不变 |

---

## 2. 问题诊断

### 2.1 结构性缺口（按严重度排序）

**P0-1 · 插件拿不到文件系统**

`workspaceManager` 的 11 个 `ws:*` 通道（openDir / listDir / readFile / writeFile / createFile / mkdir / rename / trash / stat / getRecent / openById）全部只服务内置编辑器模块。插件 iframe 里没有任何一条路径能读到一个 `.md`。

后果：知识包只能走 `contributes.knowledgePages` 由**主进程导入器**灌进数据库；插件无法自建索引、无法增量更新、无法导出。这是 Obsidian 式生态的命脉，目前是断的。

**P0-2 · 插件数据模型与去库化对冲**

C 级插件用 `contributes.tables` 在 sql.js 里建 `plugin_<id>_<table>` 表（错题本正在用）。而去库化 P7 阶段要**彻底移除 sql.js**。

这两个方向必须在 P5 之前收敛，否则 P7 会变成"要么放弃插件数据表、要么延迟去库化"的两难。

**P1-3 · 裁决点在渲染层，新增能力的改动面是 3 处**

现状 `PluginFrame.tsx` 里 `grantedRef.current.includes('data')` 决定放行，然后调宿主的 `pluginDataQuery`。要加一个能力：

```
① 主进程 ipcMain.handle('pluginXxx:...')  →  ② preload 暴露 api 方法  →  ③ PluginFrame 加 case
```

而且授权判断分散在渲染层（PluginFrame）与主进程（`assertDataAccess`）**两处**，规则可能漂移。

**P1-4 · 桥协议没有请求标识，并发会串台**

```ts
// 现状：回包用同名 action，没有 requestId
const reply = (payload) => frameRef.current?.contentWindow?.postMessage({ channel, action: d.action, payload }, '*')
```

插件若同时发两个 `data.query`，两个 `then` 拿到的是同一条回包的副本——谁的先到谁决定。当前插件简单所以没暴露，一旦有列表分页 + 详情并发的插件就会出 bug。

**P1-5 · 没有生命周期与事件**

`PluginManifest.activation?: string[]` 字段声明了（样例里写 `["startup"]`）但**全代码库零消费**——grep 只有类型声明一处匹配。插件无法知道：自己被启用/禁用、仓库被切换、主题变了、某个文件被改了。

**P2-6 · 贡献点覆盖面偏窄**

VSCode/Obsidian 生态的骨架贡献点里，目前只有 `views`（1 个 slot 被消费：`knowledge.sidebar`）、`theme`、`knowledgePages`、`sidebarIcons`。缺命令面板、快捷键、右键菜单、状态栏、设置页、编辑器装饰、文件图标。

**P2-7 · 没有开发者工具链**

无类型包（插件作者手写 postMessage 字符串）、无 CLI、无 manifest 离线校验、无热重载。写一个插件要同时读 PluginFrame 源码和 pluginRegistry 校验规则才能知道字段约束。

### 2.2 顺带核对的疑点（已排除）

- `workspaceManager.ts` 顶部疑似重复 import `getDatabase/saveToDisk` —— grep 确认只有第 5 行一处，文件无此缺陷。
- `activation` 字段：确认仅存在于 `PluginManifest` 接口，无任何消费方。

---

## 3. 设计目标与红线

### 目标

| 编号 | 目标 | 可验证标准 |
|---|---|---|
| G1 | 插件能读写仓库文件 | 一个 200 行插件可在当前仓库建/读/改/监听 `.md` |
| G2 | 新增 API 只改一处 | 加一条命名空间方法 = 主进程加 1 个 handler + 类型包加 1 行签名，前端零改动 |
| G3 | 插件数据随仓库走 | 插件数据落 `.knowbase/plugins/<id>/`，切仓库即切换，备份=拷目录 |
| G4 | 安全分级不退化 | 现有 S/A/B/C 判定规则、审计、月度限额全部保留并覆盖新 API |
| G5 | v1 插件零改造可用 | 现有 4 个官方插件（2 知识包 + 1 Skill 包 + 1 主题包）+ 错题本无需改一行 |
| G6 | 并发安全 | 100 个并发请求 100% 正确配对 |

### 红线（不可协商）

1. **插件代码执行但被关沙箱**（v3 修订）。`type: 'code'` 从拒收改为支持：可执行 JS 只允许在 `sandbox` iframe 或独立 Worker 内运行；插件**永远拿不到** `ipcRenderer`、`fs`、`NodeAPI`、`process`——一切能力经 Gateway 的 token + postMessage 通道触达。包内 HTML/JS 禁止访问宿主协议之外的网络（CSP `connect-src 'none'` 不变）。审核重心从「读代码找漏洞」转为「审 manifest 能力清单」。
2. **插件不能直连 LLM 凭据**。`kb.ai.*` 一律经宿主网关，计入同一套月度限额与审计。
3. **插件不能跨仓库**。永远绑定当前仓库，`rootId` 不作为参数暴露给插件。
4. **插件读不到宿主密钥**。`secretStore`（DPAPI 加密区）与 `settings.json` 中的 AI Key 不进插件命名空间。
5. **不放弃 SQL 表的存量数据**。迁移工具必须存在，`tables` 与 `store` 可并存一个过渡期。
6. **供应链签名（v3 新增）**。市场下载的包必须带 `signing`（作者私钥签名 + 应用内置公钥校验）；缺失或校验失败的包只允许本地显式安装（开发模式）。

---

## 4. 架构：Plugin Host Gateway

### 4.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│ 插件页  plugin://<id>/index.html   (sandbox, connect-src none)│
│   import { kb } from 'knowbase-plugin-api'                    │
└───────────────────────┬──────────────────────────────────────┘
                        │  postMessage  kb-plugin v2 (带 id/token)
┌───────────────────────▼──────────────────────────────────────┐
│ PluginFrame（渲染层）· 降级为纯管道                             │
│   - 申请/回收 bridge token                                     │
│   - 转发消息 / 下发事件与主题                                    │
│   - 【不再做任何授权判断】                                       │
└───────────────────────┬──────────────────────────────────────┘
                        │  ipcRenderer.invoke('host:rpc', {token,id,method,params})
┌───────────────────────▼──────────────────────────────────────┐
│ PluginHostGateway（主进程）· 唯一裁决点                         │
│  ┌────────────┬────────────┬────────────┬──────────────────┐ │
│  │ 会话鉴权    │ 能力裁决    │ 参数校验    │ 审计 + 月度限额    │ │
│  │ token→plugin│ method→cap │ JSON Schema │ pluginAudit      │ │
│  └────────────┴────────────┴────────────┴──────────────────┘ │
│                          │                                     │
│  ┌───────┬───────┬───────┼───────┬───────┬───────┬─────────┐ │
│  │ store │ vault │metadata│  ui   │commands│ events│  ai/host│ │
│  └───────┴───────┴───────┴───────┴───────┴───────┴─────────┘ │
│                          │                                     │
│  kbStore · workspaceManager · knowledgeRepo · llmService · ... │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 为什么裁决点必须搬到主进程

| 维度 | 现状（渲染层裁决） | v2（主进程裁决） |
|---|---|---|
| 新增能力改动面 | 3 处（主进程 + preload + PluginFrame） | 1 处（主进程 handler + 类型包签名） |
| 授权规则一致性 | 渲染层 `grantedRef` 与主进程 `assertDataAccess` 两份 | 一份 `assertCapability` |
| 渲染层被注入后的风险 | 可伪造 postMessage 绕过 `grantedRef` | token 失效即断，且主进程二次校验 |
| 可测试性 | 需起 Electron 才能测 | 纯函数，可直接单测（对标 `resolveSafe` 的冒烟写法） |

### 4.3 会话与 token

`iframe` 走的是宿主渲染进程的 `ipcRenderer`，`event.sender` 永远是宿主渲染进程——**无法从 IPC 层面识别插件身份**。因此引入一次性 bridge token：

```
PluginFrame 挂载
  → ipcRenderer.invoke('host:bridge-open', pluginId)
  ← { token, hostVersion, capabilities, vault: {name, rootId} }
  → postMessage({ channel:'kb-plugin', action:'init', payload:{ token, themeVars, capabilities, hostVersion } })

插件请求
  → postMessage({ channel:'kb-plugin', v:2, id:<uuid>, token, method:'kb.vault.list', params:{...} })
  → PluginFrame → ipcRenderer.invoke('host:rpc', { token, id, method, params })
  → 主进程：token → { pluginId, capabilities, createdAt } → 裁决 → 执行 → 回包

PluginFrame 卸载
  → ipcRenderer.invoke('host:bridge-close', token)
```

token 属性：**随机 32 字节 hex**、**绑定单个 pluginId**、**frame 卸载即失效**、**宿主重启全清**（不持久化）。伪造 token → 会话表未命中 → 直接 `EBRIDGE` 错误并记审计。

### 4.4 报文协议 v2

请求（插件 → 宿主）：

```ts
{ channel: 'kb-plugin', v: 2, id: string, token: string, method: string, params?: unknown }
```

响应（宿主 → 插件）：

```ts
{ channel: 'kb-plugin', v: 2, id: string, ok: true,  result: unknown }
{ channel: 'kb-plugin', v: 2, id: string, ok: false, error: { code: string, message: string } }
```

事件（宿主 → 插件，单向）：

```ts
{ channel: 'kb-plugin', v: 2, type: 'event', event: string, payload: unknown }
```

初始化（宿主 → 插件）：

```ts
{ channel: 'kb-plugin', v: 2, type: 'init', payload: { token, hostVersion, capabilities, themeVars, vault } }
```

**v1 兼容**：`v: 1`（或缺省）的请求沿用旧语义（同名 action 回包），PluginFrame 保留 v1 分支一个版本周期，下一个大版本移除。

### 4.5 错误码

| code | 含义 |
|---|---|
| `EBRIDGE` | token 无效/过期，会话不存在 |
| `ECAPABILITY` | 能力未声明或未授权（message 指明需要的 capability） |
| `EPARAM` | 参数校验失败 |
| `EPATH` | 路径越界/非法（沿用 `resolveSafe` 语义） |
| `ENOTFOUND` | 目标不存在 |
| `ECONFLICT` | 目标已存在 / 版本冲突 |
| `ELIMIT` | 月度调用上限 |
| `EDISABLED` | 插件已禁用或命名空间被停用 |
| `EHOST` | 宿主服务未就绪（如无当前仓库） |
| `EINTERNAL` | 宿主内部错误（脱敏后返回） |

---

## 5. 命名空间 API 设计

命名规则：`<域>.<对象>.<动作>`，全部以 `kb.` 开头，与 `builtin.*`（AI 工具）、`mcp.*`、`skill.*` 三个已有命名空间不冲突。

### 5.1 `kb.store.*` — 插件私有存储（**新默认，替代 tables**）

落盘位置：`<vault>/.knowbase/plugins/<pluginId>/`

```
.knowbase/plugins/knowbase.quizbook/
  data/records.json        ← kb.store.get/set
  data/books/2026.json
  docs/notes/错题分析.md    ← kb.store.doc.read/write
  cache/thumbnails/        ← 可清理
```

**零授权**（插件只能碰自己的目录，`pluginId` 由 token 决定，无法越界）。

| 方法 | 说明 |
|---|---|
| `kb.store.get(key)` / `set(key, value)` / `delete(key)` / `list(prefix?)` | JSON KV，key 可含子路径 |
| `kb.store.doc.read(path)` / `write(path, md)` / `list(prefix?)` / `delete(path)` | Markdown + frontmatter 解析 |
| `kb.store.cache.*` | 同签名，宿主可在设置页"清理插件缓存"时整体删除 |
| `kb.store.usage()` | 返回本插件占用字节数（供设置页展示） |

限额：单文件 ≤ 10 MB、插件总配额默认 200 MB（可在设置页调整）。

### 5.2 `kb.vault.*` — 仓库文件系统（**补齐 P0-1**）

能力：`vault:read` / `vault:write`（安装时显式勾选，默认不授予）。

| 方法 | 映射到现有实现 |
|---|---|
| `kb.vault.list(relPath)` | `listDirEntries` |
| `kb.vault.read(relPath)` | `readWorkspaceFile`（二进制检测 + 10MB 门槛复用） |
| `kb.vault.write(relPath, content)` | `writeWorkspaceFile`（原子写） |
| `kb.vault.create` / `mkdir` / `rename` / `trash` / `stat` | 同名 `ws:*` 逻辑 |
| `kb.vault.watch(patterns, eventId)` | 新增：基于 fs watcher，走 `kb.events` 推流 |
| `kb.vault.getInfo()` | `{ rootId, name }`（**不返回 rootPath**） |

路径语义统一为 `relPath`（相对仓库根），**插件永不接触绝对路径**——直接沿用 `resolveSafe`，包括逐段 lstat 拒符号链接、拒盘符/UNC/`..` 越界。

可选收敛：manifest 可声明 `vaultScope: ["pages/", "docs/"]`，主进程强制把写操作限制在前缀内（只读全库 + 只写指定目录），适合"内容型"插件降低授权阻力。

### 5.3 `kb.metadata.*` — 仓库索引（**为路线图第 2 步预留**）

依赖 `metadataCache`（路线图阶段 2）。在索引落地前，这几个方法返回 `ENOTFOUND` 或退化实现，签名先定死，避免插件写两套：

| 方法 | 说明 |
|---|---|
| `kb.metadata.search(q, opts)` | 全文检索 |
| `kb.metadata.get(path)` | 取单文件 frontmatter + tags + 双链 |
| `kb.metadata.query({ tag, folder, frontmatter })` | 结构化过滤 |
| `kb.metadata.backlinks(path)` | 反向链接 |

### 5.4 `kb.ui.*` — 界面扩展

| 方法 | 需要能力 | 备注 |
|---|---|---|
| `kb.ui.toast(msg, type?)` | — | 现状已有 |
| `kb.ui.notify(title, body)` | `ui.notify` | 系统通知 |
| `kb.ui.statusBar.create({ id, text, align })` | `ui.statusBar` | 返回句柄，可 update/dispose |
| `kb.ui.contextMenu.register({ when, items })` | `ui.menu` | `when` 支持 `fileType == 'md'` 等表达式（白名单求值，不执行代码） |
| `kb.ui.modal.open({ title, entry })` | — | 打开插件包内另一个 HTML |
| `kb.ui.panel.open({ slot, entry })` | `ui.panel` | 扩展现有 `views` 的运行时版本 |
| `kb.ui.theme.apply(vars)` | `theme` | 现状已有，保留 |
| `kb.ui.settings.register({ entry })` | `ui.settings` | 插件专属设置段 |
| `kb.ui.setBadge(text)` | `ui.statusBar` | 角标 |

### 5.5 `kb.commands.*` — 命令与快捷键

```js
kb.commands.register({
  id: 'quizbook.reviewToday',
  title: '错题本：复习今日',
  keybinding: 'Ctrl+Shift+R',   // 需 capability: commands
  run: () => { /* 插件内逻辑 */ }
})
```

- 所有注册命令自动进入 `Ctrl+Shift+P` 命令面板
- 快捷键冲突由宿主裁决（后注册者被拒，返回 `ECONFLICT`），内置命令优先
- `kb.commands.execute(id)` 允许插件调用**宿主**命令（白名单，如 `app.openSettings`）

### 5.6 `kb.events.*` — 事件订阅

```js
const off = kb.events.on('vault:modify', ({ path }) => { /* ... */ })
```

| 事件 | 载荷 | 需要能力 |
|---|---|---|
| `vault:create` / `vault:modify` / `vault:delete` / `vault:rename` | `{ path, oldPath? }` | `vault:read` |
| `workspace:activeFileChange` | `{ path } \| null` | — |
| `workspace:vaultChange` | `{ rootId, name }` | — |
| `theme:change` | `{ theme, vars }` | — |
| `plugin:load` / `plugin:unload` | `{ pluginId }` | — |
| `host:dataChanged` | `{ scope }` | `host:read`（对应现有 `kb:data-changed` 总线） |
| `schedule:todayChange` / `habit:check` | 透传宿主模块事件 | `host:read` |

推流链路：主进程 `webContents.send('host:event', {pluginId, event, payload})` → PluginFrame 按 pluginId 过滤 → postMessage 给对应 iframe。**插件只能收到自己订阅过的事件**，主进程按订阅表过滤，不做全量广播。

### 5.7 `kb.ai.*` — 让插件给 AI 供能（受红线约束）

| 方法 | 说明 | 约束 |
|---|---|---|
| `kb.ai.complete({ prompt, maxTokens })` | 走宿主 LLM 网关 | 需 `ai` 能力；计入 `aiToolMonthlyLimit`；费用与限额同宿主 |
| `kb.ai.listTools()` | 列出可用工具 | 只读 |
| `kb.ai.renderSkill({ id, vars })` | 渲染一个 Skill 模板 | 只读，返回文本 |
| `kb.ai.invokeTool(name, args)` | 调用已授权工具 | 需 `ai:invoke`；走 `invokeTool` 同一条权限/审计链路 |

**明确不开放**：插件注册可执行工具 handler（`kb.ai.registerTool(fn)`）。理由（v3 修订）：AI 工具面是宿主对模型的**受信能力面**，开放注册等于允许插件向 AI 注入任意动作，绕过 Gateway 的能力审计与月度限额；且声明式 `contributes.skills` / `contributes.tools` 已覆盖绝大多数场景。即使 v3 放开 JS 执行，此口仍保持关闭（与 `rework-plugin-openness.md` §7 一致）。

### 5.8 `kb.host.*` — 宿主业务数据（**最强能力，最后开**）

复用 `aiModulePermissions` 的分级思路，capability 命名 `host:<module>:<read|write>`：

| 方法 | capability |
|---|---|
| `kb.host.knowledge.*`（search/read/create/append） | `host:knowledge:read` / `:write` |
| `kb.host.schedule.*` | `host:schedule:read` / `:write` |
| `kb.host.blog.*` | `host:blog:read` / `:write` |
| `kb.host.habits.*` / `bookmarks.*` / `moments.*` | 同上 |

直接复用 `builtinTools.ts` 里已经写好的 13 个工具 handler——它们本身就是宿主业务的安全封装，等于"免费"获得 13 个经过审计的读写口子。

### 5.9 生命周期

```js
export async function onLoad(ctx) {
  // ctx.pluginId / ctx.vault / ctx.capabilities
  // 返回值会被宿主在 onUnload 时传出
  return { timer: setInterval(...) }
}
export function onUnload(ctx, state) { clearInterval(state.timer) }
```

宿主在以下时机调用：插件启用/禁用、**切换仓库**（先 unload 再 load）、应用退出前。插件存储句柄与事件订阅由宿主在 unload 后统一回收，防泄漏。

---

## 6. manifest v2

保持向后兼容：所有新增字段可选，缺省即 v1 行为。

```jsonc
{
  "id": "knowbase.quizbook",
  "name": "错题本",
  "version": "0.3.0",
  "type": "ui",
  "entry": "index.html",

  // ── 新增：API 版本 ──
  "apiVersion": 2,                    // 缺省 1（v1 行为）；2 = 启用 token 会话 + 新命名空间

  // ── 新增：能力细粒度化（与旧 capabilities 并存）──
  "capabilities": ["data", "knowledge", "vault:read", "ui.statusBar"],
  // 旧值 theme/clipboard/data/knowledge/navigation 全部保留原语义（兼容映射见 §7.2）

  // ── 新增：Vault 收敛（可选）──
  "vaultScope": ["pages/"],           // 声明后写操作被强制限制在前缀内

  // ── 新增：插件私有存储（替代 tables 的推荐写法）──
  "contributes": {
    "store": {
      "quotaMb": 200,                 // 缺省 200
      "collections": ["records", "books"]   // 仅用于设置页展示与配额统计
    },

    // ── 新增贡献点 ──
    "commands": [
      { "id": "reviewToday", "title": "复习今日错题", "keybinding": "Ctrl+Shift+R" }
    ],
    "menus": [
      { "when": "fileType == 'md'", "items": [{ "command": "quizbook.extract" }] }
    ],
    "statusBar": [
      { "id": "due", "align": "right", "title": "今日待复习" }
    ],
    "settings": { "entry": "settings.html" },
    "views": [
      { "slot": "knowledge.sidebar", "title": "错题本", "mode": "panel" }
    ]

    // ── 保留但标记 deprecated ──
    // "tables": [...]  不再新增；P7 提供迁移工具
  },

  // ── 新增：激活事件（此前字段存在但无实现）──
  "activation": ["startup", "onCommand:quizbook.reviewToday", "onVaultOpen"]
}
```

新增 `KNOWN_CONTRIBUTIONS` 项：`store / commands / menus / statusBar / settings`（+5，共 19）。

### 6.1 v3 补充：`type: code`、签名与执行入口（2026-09-03 修订）

`type` 字段语义扩展（向后兼容，`ui` / `declarative` 原样保留）：

| type | v2 语义 | v3 语义 |
|---|---|---|
| `declarative` | 纯声明式内容包（知识包/主题/Skill） | 不变 |
| `ui` | HTML 沙箱页（PluginFrame），桥能力经宿主 | 不变（`entry` 仍为 HTML） |
| `code` | **拒收** | **允许**：可执行 JS 插件。分两种入口形态： |
| | | a) `entry` = 单个 `.js`/`.mjs` → 宿主以 **Worker** 加载（无 DOM，后台/计算型）； |
| | | b) `entry` = `.html`（可含内联/同目录脚本）→ 走现有 `sandbox` iframe（有 DOM，UI 型，等同 `ui` + 允许脚本） |

`type: code` 插件同样必须声明 `capabilities`（可为空数组=纯本地逻辑），同样走 grantedCapabilities 授权与审计；`engineVersion` 建议声明（SDK 兼容门槛）。

**签名字段（v3 新增，可选但市场包必填）**：

```jsonc
"signing": {
  "algo": "ed25519",            // 目前唯一支持
  "keyId": "kb-official-2026",  // 公钥在宿主内置 keyring 中查找
  "sig": "<base64>"             // 对 zip 内 manifest+entry+脚本 的规范串签名
}
```

校验位置：主进程安装前（`pluginRegistry` 下载/本地安装共用）；缺失 signing 的市场包 → 拒绝并提示；本地显式安装可跳过（开发模式）。

---

## 7. 安全模型 v2

### 7.1 裁决器

`assertDataAccess`（`pluginRegistry.ts:941`）提升为通用实现：

```ts
function assertCapability(token: string, method: string):
  | { ok: true; pluginId: string; tables: PluginTableDef[] }
  | { ok: false; code: string; message: string }
```

裁决顺序（任一失败即短路）：

```
token → 会话存在？ → 插件已安装且已启用？ → method 命名空间 → 所需 capability
     → capability 在 manifest 中声明？ → capability 在 grantedCapabilities 中？ → 参数校验 → 限额
```

### 7.2 兼容映射（v1 capability → v2）

| v1 capability | v2 等价 | 风险等级 |
|---|---|---|
| `theme` | `ui.theme` | B |
| `clipboard` | `ui.clipboard` | B |
| `data` | `store` + `tables`（遗留） | C |
| `knowledge` | `host:knowledge:read` + `host.review` | C |
| `navigation` | `ui.navigation` | C |

v1 清单不改写即可工作；宿主内部做一次映射。

### 7.3 能力 → 风险等级矩阵

| capability | 等级 | 安装时默认 | 需要用户勾选 |
|---|---|---|---|
| `ui.theme` / `ui.clipboard` / `ui.notify` | B | 授予 | 否 |
| `store`（插件私有区） | B | 授予 | 否 |
| `ui.statusBar` / `ui.menu` / `ui.panel` / `ui.settings` | B | 授予 | 否 |
| `commands` | B | 授予 | 否 |
| `vault:read` | C | 不授予 | **是** |
| `vault:write` | C | 不授予 | **是** |
| `host:*:read` | C | 不授予 | **是** |
| `host:*:write` | C | 不授予 | **是** |
| `ai` / `ai:invoke` | C | 不授予 | **是** |

沿用现有 `pluginAllowedLevels` 策略开关（settings.json），企业/自用场景可整体关闭 C 级。

### 7.4 审计

所有 v2 RPC 落 `plugin_audit_log`：`{ pluginId, method, capability, durationMs, ok }`。设置页"插件 → 行为审计"增加按 method 过滤。审计表本身在去库化后迁到 `.knowbase/` 或保持全局（待 P5 决策）。

---

## 8. 开发者体验

### 8.1 类型包 `knowbase-plugin-api`

零依赖、纯 ESM，约 120 行：

```ts
const kb = createClient()          // 自动连接 parent，等待 init 拿 token
await kb.vault.list('pages')
await kb.store.set('records', [...])
const off = kb.events.on('vault:modify', fn)
```

内置：请求 id 自增、pending Map、10 秒超时、错误码到异常类的映射、事件多路分发。附带 `.d.ts`，VSCode 里 `kb.` 即出补全。

### 8.2 CLI `kbcli`

```
kbcli init my-plugin        # 生成模板（manifest + index.html + tsconfig + 类型包）
kbcli validate              # 离线跑与 pluginRegistry 同一套校验规则
kbcli pack                  # 打 zip（自动排除 node_modules/.git）
kbcli dev --vault <path>    # 符号链接进插件目录 + 文件变更自动 reload
```

`validate` 复用 `validateManifest` 的纯函数部分（需把校验逻辑从 `pluginRegistry.ts` 抽到 `pluginManifest.ts`，去掉 IPC 副作用）——顺带解决 P1-7 中"要读源码才知道字段约束"的问题。

### 8.3 调试

- DEV 模式下 `plugin://` 的 CSP 放宽 `connect-src 'self'`（仅本地 dev server），并允许 `unsafe-eval`（对齐现有 `anims/` 分支做法）
- 插件页可直接开 DevTools（iframe 上右键）
- 宿主把插件的 `console.error` 经桥转发到主窗口控制台与 `plugin-debug.log`（复用现有日志通道）

---

## 9. 兼容与迁移

### 9.1 插件侧

| 插件 | 影响 | 动作 |
|---|---|---|
| 2 个知识包（英语阅读 / Markdown 指南） | declarative + `knowledgePages` | 零改动 |
| 官方 Skill 包 | declarative + `skills` | 零改动 |
| 主题合集 | declarative + `theme` | 零改动 |
| 错题本（C 级，用 `tables`） | 需要评估 | 见下 |

### 9.2 `tables` → `store` 迁移

阶段：**并存 → 双写 → 迁移 → 下线**

1. **P1 并存**：`store` 上线，`tables` 保留，新插件默认用 `store`
2. **P5 双写**：迁移工具 `scripts/migrate-plugin-tables.mjs`，读 `plugin_<id>_<table>` 全量导出行 → 写 `.knowbase/plugins/<id>/data/<table>.json`，支持校验（行数 + 抽样哈希）与回滚
3. **P6 推荐迁移**：设置页对仍用 `tables` 的插件显示"建议迁移"提示
4. **P7 下线**：随 sql.js 移除，未迁移数据在安装时自动执行迁移工具

错题本作为唯一存量 C 级插件，是这条链路的首个验证对象。

### 9.3 协议侧

PluginFrame 同时支持 v1/v2 报文一个版本周期；`v` 字段缺省即 v1。下一个大版本移除 v1 分支。

---

## 10. 实施路线图

| 阶段 | 内容 | 关键文件 | 验收标准 |
|---|---|---|---|
| **P0 网关骨架** | `host:bridge-open/close/rpc` 3 个 IPC；token 会话表；`assertCapability` 通用裁决；协议 v2 + v1 兼容分支；PluginFrame 降级为纯管道 | 新增 `electron/lib/pluginHostGateway.ts`（~200 行）；改 `PluginFrame.tsx` | 现有 4 个官方插件全量回归通过；100 并发请求配对正确；伪造 token 被拒并记审计 |
| **P1 Store** | `kb.store.*` 基于 `kbStore/jsonStore` + `mdStore`；配额；`contributes.store` 清单项 | `pluginHostGateway.ts` + `pluginRegistry.ts` 校验 | 示例插件写 1 万条 KV 后 `.knowbase/plugins/<id>/` 文件人工可读；切仓库后数据正确切换 |
| **P2 Vault** | `kb.vault.*` 复用 `workspaceManager` 纯函数；`vaultScope` 强制；fs watch → `vault:*` 事件 | 抽取 `workspaceManager` 纯逻辑为 `vaultFs.ts`（不含 IPC） | 200 行插件完成"扫描仓库所有 .md → 建索引 → 监听变更"；越界路径 100% 被 `resolveSafe` 拒 |
| **P3 UI + 命令 + 事件** | `kb.ui.*` / `kb.commands.*` / `kb.events.*`；slot 注册表（sidebar / statusBar / panel / settingsPage） | 新增 `src/lib/pluginSlots.tsx`；改 `ActivityBar`、`StatusBar` | 插件能在状态栏显示"今日待复习 12"，点击执行命令 |
| **P4 生命周期** | `onLoad` / `onUnload`；切仓库与停用触发；资源回收 | `pluginHostGateway.ts` | 反复切仓库 20 次无内存增长、无重复订阅 |
| **P5 迁移工具** | `tables` → `store` 迁移脚本 + 校验 + 回滚；错题本实迁 | `scripts/migrate-plugin-tables.mjs` | 迁移前后行数一致、抽样内容哈希一致；回滚后插件功能正常 |
| **P6 SDK + CLI** | `knowbase-plugin-api` 类型包；`kbcli init/validate/pack/dev`；校验规则抽到 `pluginManifest.ts` | 新增 `packages/plugin-api/`、`packages/kbcli/` | 从模板到可安装 zip ≤ 3 条命令；`kbcli validate` 对样例报错与安装器一致 |
| **P7 AI/Host 开放** | `kb.ai.*` 与 `kb.host.*`（复用 `builtinTools` handler）；随去库化收尾下线 `tables` | `pluginHostGateway.ts` | 插件调用 `kb.ai.complete` 计入月度限额；`host:blog:write` 未授权时返回 `ECAPABILITY` |

阶段依赖关系：P0 → P1 → P2 → {P3, P4} → P5 → P6；P7 依赖去库化 P5 阶段完成。

> **落地状态（2026-09-12，feature/ai-plugin-upgrade）**：P0 ✅（Gateway+token 会话）/ P1 ✅（kb.store.*）/ **P2 ✅（kb.vault.* 六方法：getInfo/list/read/stat 走 vault:read、write/trash 走 vault:write；manifest.vaultScope 写路径强制收敛；安全 helper 复用 builtin.vault 同款，防规则漂移）**。P3-P7 待做。真机验收统一安排。

### 10.1 与 v3（R7）分期映射（2026-09-03）

v3 放开执行是**叠加在这张 P0-P7 表之上**，不是替代：

| R7 分期 | 对应本文档 | 内容 |
|---|---|---|
| V3-1 契约 | 本文（v1.1 修订）+ manifest 校验代码 | 红线修订、`type: code` / signing / vaultScope 字段与校验、能力矩阵扩容 |
| V3-2 沙箱 + Gateway | P0 + §4/§7 | `pluginHostGateway.ts` + token 会话 + `assertCapability` 单点裁决；PluginFrame 降级纯管道；code 插件 Worker 通道 + ui 插件 iframe 脚本放行 |
| V3-3 试点插件 | P1-P4 选样 | 首个可执行插件（建议：命令面板插件 or 仓库统计后台 worker），端到端验证 Gateway + 沙箱 |
| V3-4 签名链路 | §6.1 + 市场发布 | ed25519 签名工具 + 内置 keyring + registry 强制校验 + 发布脚本扩展 |

**执行顺序建议**：V3-1 先落（契约与校验是地基）；V3-2 的 P0 网关骨架是其自然延续；V3-3 试点不依赖 P2+（Vault API 可用 `kb.vault` 前的 fallback 或用 `kb.store` 起步）；V3-4 可并行于 P3-P4。

### 10.2 v3 对 P0-P7 的改动点

- P0：新增 code 插件的 **Worker 加载通道**（`kb-plugin` v2 协议同构：Worker 内 `postMessage` ↔ PluginFrame ↔ Gateway，插件身份仍由 token 标识）；
- P2（Vault）：无改动（vaultScope 已在 manifest v2 定义）；
- P4（生命周期）：`onLoad/onUnload` 对 code 插件 = Worker 启动/终止；切仓库先 terminate 再重建；
- P6（SDK/CLI）：`knowbase-plugin-api` 类型包增加 Worker 侧 `createClient({ worker: true })` 通道（否则 code 插件无法使用 kb.* 命名空间）；`kbcli init` 增加 `--type code` 模板。

**每个阶段的通用验收**：现有插件回归 + 新 API 冒烟脚本（放 `tmp/smoke/`，对标 `workspace-smoke.mjs` 的 36 断言写法）+ 打开 `.knowbase/` 人工核对文件可读。

---

## 11. 决策记录（ADR 摘要）

| 编号 | 决策 | 备选方案 | 选择理由 |
|---|---|---|---|
| ADR-1 | 扩展现有沙箱桥，不引入 extension host | Node 侧插件进程（full extension host） | Electron 已提供 sandbox iframe/Worker；独立进程化扩展会重做整套安全模型。v3 修订：不矛盾——「执行」走沙箱（iframe/Worker），不进主进程空间 |
| ADR-2 | 用一次性 token 识别插件身份 | 从 IPC sender 推导；信任插件自报 id | iframe/Worker 都走宿主 ipcRenderer，sender 无法区分；自报 id 可伪造 |
| ADR-3 | 插件数据默认走 `.knowbase/plugins/<id>/` | 继续用 SQLite 表 | 与去库化方向一致；备份=拷目录；切仓库即切换；P7 不用再做数据迁移 |
| ADR-4 | 新增 `store`，`tables` 并存后下线 | 直接改造 `tables` 底层为文件存储 | 存量错题本数据不能丢；并存期可做双写校验 |
| ADR-5 | 不开放插件注册可执行 AI 工具 | `kb.ai.registerTool(fn)` | AI 工具面 = 宿主向模型开放的受信能力面，绕过 Gateway 审计/限额；声明式 Skill/工具已覆盖场景（v3 修订：与 type:code 无关，独立红线） |
| ADR-6 | 裁决点单一化到主进程 | 渲染层与主进程双校验 | 双份规则必然漂移；主进程校验可纯函数单测 |
| ADR-7 | `vaultScope` 作为可选收敛而非强制 | 强制所有插件限定目录 | 部分插件（如全文索引）确实需要全库读；给作者选择权，用授权弹窗承担风险沟通 |
| ADR-8（v3） | `type: code` 允许，但只在沙箱 iframe/Worker 内执行 | 完全拒绝代码插件 / 主进程 vm | D3 拍板开放；主进程 vm 隔离不足否决；能力仍全经 Gateway 授权 |
| ADR-9（v3） | 市场包必须签名（ed25519 + 内置 keyring），本地安装可跳过 | 全部强制签名 / 不签名 | 受信供应链（作者个人发布+审核）；本地开发免签降低门槛 |

---

## 12. 待定问题（需要拍板）

1. **审计表归属**：`plugin_audit_log` 现在在全局 `userData/knowledge.db`。去库化后是留在全局（跨仓库统计）还是下沉到仓库（随仓库走）？倾向：保留全局，因为它记录的是"插件行为"而非"用户内容"。
2. **`vault:write` 是否需要二次确认**：每次写都弹窗会毁掉体验，一次授权长期有效又有风险。倾向：安装时授权 + 设置页可随时撤销 + 单日写入量超过阈值（如 1000 次）时提示一次。
3. **插件间调用**：是否需要 `kb.plugins.get(id)` 让插件互相调用（Obsidian 有此能力，也是其生态耦合问题的来源）？倾向：一期不做，用 `kb.commands.execute` 的宿主命令白名单作为替代。
4. **市场审核**：C 级插件申请 `vault:write` 是否需要人工审核 registry 条目？倾向：registry 增加 `capabilities` 声明，客户端在安装弹窗用红色标注高风险能力，不做中心化审核。

### v3 追加待拍板（2026-09-03）

5. **code 插件的 UI 形态**：Worker 型 code 插件（无 DOM）能否贡献 `views` / `statusBar` / `commands`？倾向：能贡献 commands（纯注册），views/statusBar 仍走 ui（HTML）插件——避免两套 UI 渲染通道。
6. **签名私钥管理**：作者私钥放哪？倾向：`kbcli sign` 本地私钥文件（不入库），市场发布脚本提示签名；私钥泄露 = 吊销 keyId 并轮换内置 keyring。
7. **Worker 通道是否要独立的 capability 增量**：`code` 插件除普通 capability 外是否需额外 `background` 能力（常驻后台）？倾向：需要——常驻 Worker 会持续占资源，安装时应单独提示。
