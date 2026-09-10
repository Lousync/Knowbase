# AI 工具集精简设计

> **v2（2026-09-09 拍板）：三定则 + 分层装载，分四阶段实施。** v1 的 23→19 方案被本版取代（§4 保留供对照）。
>
> ## v2 蓝图
>
> **三条定则**：读原语化（一切读走 vault.*）/ 写领域化（只留不变量守护的写）/ 算专用化（LLM 算必错的留专用工具）。
>
> **最终形态 19 个工具**（23 → 19，任一时刻可见 11~19）：
>
> | 层 | 工具 | 装载 |
> |---|---|---|
> | 原语 7 | vault.list / vault.read（收编 id 定位 + pdf/pptx）/ vault.search / vault.write / vault.edit（加 append 模式）/ vault.rename / vault.trash | 写 4 个按需，读 3 个常驻 |
> | 索引读 1 | knowledge.search（页面级索引检索，与 vault.search 全文 grep 互补） | 常驻 |
> | 领域写 4 | knowledge.create-page / blog.create-entry / schedule.create-todo / checkin.check-habit | 按需 |
> | 计算 2 | habits.stats / pomodoro.summary | 常驻 |
> | 外部 2 | web.search / web.read | 常驻 |
> | 元 1 | tool.request（按需申请写类/未来 mcp 工具，会话内永久启用） | 常驻 |
>
> **退役 5 项**：docs.read-text（→vault.read 按扩展名分派）、bookmarks.search（→vault.search）、habits.list（→stats 加 mode）、knowledge.read（→vault.read 加 id 参数）、knowledge.append-page（→vault.edit 加 append 模式）。
>
> **阶段**：✅ P1 无破坏合并（23→20）→ ✅ P2 能力收编（→18）→ ✅ P3 装载层 tier + tool.request（+1 元工具，常驻 11）→ ✅ P4 描述瘦身。**全部完成（2026-09-09），真机验收待做。**
> 预期收益：常驻 schema ~1400 → ~600 token/轮，8 轮 11200 → ~4800（约 -57%）；语义零重叠。
> token 数据：工具 title+description 实测 2141 字符 ≈ 823 token（2.6 字/token 口径），JSON 结构开销另计。
>
> ---
>
> v1 状态：§6.1 写上限已于 2026-09-09 落地（9 工具 / 7 次）。
> 触发：R6 去库化完成后，模块数据已统一落到仓库 `.knowbase/modules/*.json` 与仓库 `.md`，
> 原「按数据库表设计的 AI 工具」出现语义重叠，需重新收敛。
> 主文档关联：`docs/agent-file-tools-design.md`（B0-B3 文件工具）、`docs/rework-master-plan.md`

---

## 1. 结论先行

| 项 | 结论 |
|---|---|
| 能不能砍到只剩文件工具 | ❌ 不能。写侧有硬约束（§3.1） |
| 建议退役/合并 | 4 项，23 → 19（§4） |
| 真正解决 token / 选择准确率的方向 | 场景 profile 动态装载（§7），不是砍数量 |
| 顺带发现的现存缺陷 | 2 个（§6），与本方案独立，可单独修 |

---

## 2. 现状盘点

代码位置：`electron/lib/builtinTools.ts`（`registerBuiltinTools()` L284–L1167），共 **23 个** `registerTool`。

| # | 工具 | 数据源 | 性质 | 行号 |
|---|---|---|---|---|
| 1 | `knowledge.search` | knowledgeIndex / vaultSearch | 读 · 索引检索（页面级 + 摘录） | L287 |
| 2 | `knowledge.read` | `vaultGetPageById(id)` | 读 · id→path 定位 | L316 |
| 3 | `knowledge.create-page` | `vaultCreatePage` | 写 · **生成 frontmatter id + 登记索引** | L542 |
| 4 | `knowledge.append-page` | read + 追加 + writeWorkspaceFile | 写 · 尾部追加 | L577 |
| 5 | `habits.list` | `modules/checkin/*.json` | 读 · 列表 + 今日状态 | L356 |
| 6 | `habits.stats` | 同上 | 读 · **连续/最长/完成率计算** | L385 |
| 7 | `bookmarks.search` | `modules/bookmarks/*.json` | 读 · 关键词过滤 | L428 |
| 8 | `pomodoro.summary` | `modules/pomodoro/sessions.json` | 读 · **区间聚合** | L458 |
| 9 | `schedule.list-todos` | `modules/schedule/todos.json` | 读 · 日期区间过滤 | L501 |
| 10 | `schedule.create-todo` | 写 `todos.json` | 写 · **写 JSON** | L651 |
| 11 | `checkin.check-habit` | 写 `checkin/records` | 写 · **写 JSON + 幂等** | L688 |
| 12 | `blog.create-entry` | `.knowbase/blog/*.md` | 写 · **每天一篇约束** | L622 |
| 13 | `web.search` | 外部 | 读 · 联网 | L719 |
| 14 | `vault.list` | 文件系统 | 读 · 目录枚举 | L745 |
| 15 | `vault.read` | 文件系统 | 读 · `.md/.txt` + `modules/*.json` | L786 |
| 16 | `vault.search` | 文件系统 | 读 · 全文 grep（含 modules json） | L830 |
| 17 | `vault.write` | 文件系统 | 写 · 新建/整文件覆写 `.md/.txt` | L875 |
| 18 | `vault.edit` | 文件系统 | 写 · 片段精确替换 | L916 |
| 19 | `vault.resolve-ref` | knowledgeIndex | 读 · 标题→页面校验（防死链） | L966 |
| 20 | `vault.rename` | 文件系统 | 写 · 改名/移动 | L1008 |
| 21 | `vault.trash` | 文件系统 | 写 · 移入回收站 | L1058 |
| 22 | `web.read` | 外部 | 读 · 网页正文 | L1093 |
| 23 | `docs.read-text` | 文件系统 `.pdf/.pptx` | 读 · 文档文本提取 | L1125 |

---

## 3. 精简判定框架：三道门槛

用户直觉「本质都是对文件系统操作」需要拆成三问，三问全否才可退役。

### 3.1 门槛一 · 能力：通用文件工具够不够得着？

**答案：读侧够得着，写侧够不着。**

- 读白名单 `isAiReadableFile`(L196-203)：`.md/.txt` 全仓库 + `.knowbase/modules/*.json`
- 写白名单 `isAiWritableFile`(L227-233)：**首行 `if (parts[0].startsWith('.')) return false`**
  → `.knowbase` 内部全面禁写，含 `modules/*.json`

因此 **`schedule.create-todo`、`checkin.check-habit` 物理上无法被 `vault.write` 替代**。
（除非新增受控 JSON 写通道，见 §8 决策点 D2，本方案不建议。）

### 3.2 门槛二 · 正确性：交给 LLM 算会不会错？

`habits.stats` 的连续天数、最长连续、区间完成率，以及 `pomodoro.summary` 的按日聚合，
若让 AI 读原始 JSON 自行计算，属于典型的 LLM 高错误率任务（日期边界、计划日跳过、flexible 口径）。
代码里 `isPlannedOn` / `currentStreak` / `completionRate` 与渲染层 `dateUtils.ts` 同源，
**口径一致性本身就是价值**。→ 必须保留。

### 3.3 门槛三 · 语义：不变量下放会不会静默损坏数据？

| 工具 | 守护的不变量 | 下放后风险 |
|---|---|---|
| `knowledge.create-page` | frontmatter `id` 生成 + 索引登记 | 页面不出现在知识库列表/图谱（**静默**，无报错） |
| `blog.create-entry` | 每天一篇防重 | 一天多篇日记 |
| `checkin.check-habit` | `(habit_id, date)` 幂等 | 重复打卡记录 |

另有参数校验价值：`quadrant` clamp 0–3、`date` 正则、标题非空、正文非空，
AI 手写 JSON / 手写 frontmatter 会全部丢掉。→ 必须保留。

---

## 4. 处置方案（23 → 19）

### 4.1 退役清单

| 工具 | Verdict | 替代路径 | 理由 |
|---|---|---|---|
| `bookmarks.search` | ✅ 退役 | `vault.search` + `vault.read` | 书签 JSON 本身即结构化 title/url；`vault.search` 的 `walkAiFiles` 已扫 `modules` 子树，可直接命中 |
| `docs.read-text` | ✅ 合入 `vault.read` | `vault.read` 按扩展名分派 | 二者参数同构（path + maxChars），合并后少一份 schema |
| `habits.list` | ✅ 合入 `habits.stats` | `habits.stats(mode: 'list'\|'stats')` | 同一份数据、同一排序逻辑，两工具仅输出字段不同 |
| `knowledge.append-page` | 🔶 建议保留 | `vault.edit`（oldText 唯一替换） | 可替代，但长文末尾片段难以保证唯一命中，实测易失败 |

### 4.2 保留清单（不可动）

`vault.*` × 8、`knowledge.search/read/create-page/append-page`、`habits.stats`、
`pomodoro.summary`、`schedule.*` × 2、`checkin.check-habit`、`blog.create-entry`、`web.*` × 2

### 4.3 合并后的形态

```
vault.read  path  →  .md/.txt 走原逻辑
                  →  .pdf/.pptx 走 extractDocText（原 docs.read-text）
                  →  maxChars 默认：文本 8000 / 文档 12000 按类型取默认

habits.stats  mode='list'  → 原 habits.list 输出
              mode='stats' → 原 stats 输出（默认）
```

---

## 5. 影响面：工具名是外部硬契约（退役最大风险）

工具名不止在 `builtinTools.ts` 内部使用，已被多处资产硬编码引用：

| 位置 | 引用内容 | 性质 | 退役时动作 |
|---|---|---|---|
| `resources/skills/quiz-generator/SKILL.md` L6 | `tools: [... builtin.docs.read-text ...]` | 元数据（**当前无消费点**，见下） | 同步删 |
| `resources/skills/quiz-generator/SKILL.md` L18 | 提示词正文：`先用 vault.read / docs.read-text / web.read 读通再出` | ⚠️ **硬引用**：AI 会调用不存在的工具 → `TOOL_NOT_FOUND` | **必须同步改** |
| `resources/builtin-plugins/knowbase-skill-pack/plugin.json` L17 | `tools: [knowledge.search, habits.list]` | 元数据 | 同步删 `habits.list` |
| `resources/builtin-plugins/knowbase-skill-pack/plugin.json` L25 | `tools: [knowledge.read]` | 元数据 | 不动 |
| `src/modules/ai-teaching/index.tsx` L152-159 | `TOOL_CN` 23 项中文标签 | UI 显示，有 fallback（`s.slice(8)`） | 同步删，不删也不崩 |
| `electron/lib/agentService.ts` L28-31 | `VAULT_WRITE_TOOLS`（写上限计数） | 运行时 | 见 §6.1 |
| `electron/lib/agentService.ts` L122-132 | `CHANGE_LABELS`（改动清单标签） | 运行时 | 退役项同步删 |
| `src/modules/help/docs/AI Skill 技能.md` L32 | `tools: [builtin.knowledge.search]` | 帮助文档示例 | 不动 |
| `src/modules/help/docs/AI 联网搜索.md` L17 | `builtin.web.search` | 帮助文档 | 不动 |
| `src/lib/settings.ts` `aiModulePermissions` 默认值 | 模块键（bookmarks 已删） | 新装用户默认值 | 模块级增删时同步 |
| `src/modules/settings/views/AiPermissionsTab.tsx` `MODULES` | 模块权限 UI 硬编码清单（bookmarks 已删） | UI | 模块级增删时同步 |

> **增删内置工具的完整同步清单**（收尾沉淀）：① `builtinTools.ts` 注册本体 ② `agentService.ts` CHANGE_LABELS（写类）③ `ai-teaching/index.tsx` TOOL_CN ④ `resources/skills/**` 的 tools 声明 **与提示词正文** ⑤ `resources/builtin-plugins/**/plugin.json` ⑥ `help/docs/**` 示例 ⑦ 模块级增删另改 settings.ts 默认值 + AiPermissionsTab MODULES ⑧ 装载层：新写工具标 `requires:'write'` 即自动进 ondemand，读类默认 core ⑨ 全局 grep 退役名 + tsc 双门禁 + 重启 dev 真机。

**关于 skill 的 `tools` 字段**：`skillService.ts` 只在 L121/141/193/300/312 做解析与透传，
`agentService.ts` 无任何 `.tools` 消费点 → 该字段**当前纯元数据，不参与运行时过滤**。
但提示词正文里的工具名是真实生效的，退役必须全文扫 `resources/skills/**` 与 `resources/builtin-plugins/**`。

---

## 6. 顺带发现的两个现存缺陷（与本方案独立）

### 6.1 会话写上限未覆盖非 vault 写工具 ✅ 已修（2026-09-09）

`agentService.ts` L26-31：

```ts
const MAX_SESSION_WRITES = 5
const VAULT_WRITE_TOOLS = new Set([
  'builtin.vault.write', 'builtin.vault.edit',
  'builtin.vault.rename', 'builtin.vault.trash',
])
```

L347 的 `sessionWrites++` 只在命中这 4 个时执行。而 `knowledge.create-page`、
`knowledge.append-page`、`blog.create-entry`、`schedule.create-todo`、`checkin.check-habit`
虽然 `readOnly: false` / `requires: 'write'`，**均不在集合内**。

后果：单次请求内 AI 可创建 8 个知识页（受 `MAX_ITERATIONS=8` 约束）或 8 篇日记，
不受 5 次写入上限保护。防失控刷盘的初衷在这些工具上失效。

建议：把写上限集合改为「按 `requires === 'write'` 判定」而非硬编码名单。

**已实施**：`MAX_SESSION_WRITES` 5 → 7（用户指定）；`VAULT_WRITE_TOOLS` 硬编码集合删除，
改由 `buildToolsPayload()` 按 `t.requires === 'write'` 动态构造 `writeTools: Set<string>`
并随返回值传给 `runAgentLoop`。覆盖的写工具从 4 个扩到 9 个：

```
vault.write / vault.edit / vault.rename / vault.trash
knowledge.create-page / knowledge.append-page
blog.create-entry / schedule.create-todo / checkin.check-habit
```

**边界（有意保留）**：外部 `mcp.*` / `skill.*` 不设 `requires` 字段，不计入。
MCP 工具的 `readOnly: false` 是「不保证只读」的保守标记而非写操作声明，计入会大量误伤。
副作用即效果：vault 四件套上限 5→7（放宽），其余五路 ∞→7（收紧）。

### 6.2 工具 description 里塞了大段提示词

`vault.write`(L877) 的 description 长达 ~180 字，包含 frontmatter 规范、
"格式可先 vault.read 一个既有 .md 参考"等**操作指引**。这类内容更适合放在 system prompt
（本应用已有 per-session system prompt 机制），工具描述应保持一句话职能说明。

影响：工具 schema 随每轮请求重复发送，长描述直接放大 token 成本。

---

## 7. 更有效的方向：按场景 profile 装载（建议单独立项）

`agentService.ts` L146：`listTools().filter(t => t.enabled)` **全量**发给 LLM。
23 builtin + `skill.*`（用户安装的）+ `mcp.*`（外部服务器）全部进 prompt。

砍到 19 只减少约 17% 的 schema，而按场景装载可减半以上：

| 场景 | 建议装载 |
|---|---|
| 通用对话 | vault 读三件 + knowledge.search/read + web.* |
| AI 教学 | + vault.write/edit + docs（读资料）+ resolve-ref |
| 周复盘 | + habits.stats + pomodoro.summary + schedule.* + blog |
| 笔记整理 | + vault.write/edit/rename/trash |

实现方式有二：(a) 会话/场景携带 `toolProfile` 字段，`buildToolsPayload` 按 profile 取交集；
(b) 只做「默认折叠」——低频工具默认不装载，AI 需要时通过元工具 `tool.enable(name)` 申请。
(a) 简单可控，(b) 更灵活但增加一轮交互成本。**建议先做 (a)**。

---

## 8. 待拍板决策点

| ID | 决策点 | 备选 | 建议 |
|---|---|---|---|
| D1 | 退役清单是否确认？尤其 `append-page` 留还是砍？ | 留 / 砍 | **留**（`vault.edit` 唯一命中难保证） |
| D2 | 是否给 `vault.write` 开受控 JSON 写通道（白名单 `modules/{schedule,checkin}` + schema 校验）以替掉 create-todo / check-habit？ | 开 / 不开 | **不开**。换 2 个工具退役，赔上结构化数据写入安全 |
| D3 | 场景 profile 装载是否立项？时机？ | 现在 / 重构收尾后 / 不做 | **重构收尾后**，与 R7 验收不抢档期 |
| D4 | §6.1 写上限漏洞与 §6.2 描述瘦身是否并入本方案？ | 并入 / 单开 | ✅ **已决并入**：§6.1 已于 2026-09-09 单独落地（上限 7）；§6.2 待做 |
| D5 | 退役是否需要兼容期（保留旧名注册但内部转发 + 审计告警）？ | 硬删 / 兼容期 | 见 §9 疑问 Q3 |

---

## 9. 疑问点（需在动手前确认）

- **Q1** `bookmarks.search` 退役后，用户说「找我收藏过的 XX 文章」时，AI 需要先 `vault.list`
  定位 `.knowbase/modules/bookmarks/` 再 `vault.search`，多 1–2 轮。
  是否接受用轮次换工具数？还是给 `vault.search` 加 `scope: 'notes'|'modules'|'all'` 参数？
- **Q2** `docs.read-text` 合入 `vault.read` 后，`vault.read` 的 10MB 体积守卫（`MAX_VAULT_FILE`）
  是否对 PDF 继续生效？大 PDF 解析耗时（秒级）是否会拖慢 Agent 循环？是否单独设限？
- **Q3** 工具名是否已被**用户已安装的外部 MCP 客户端 / 已导入 skill** 引用？
  这些资产在用户机器上，无法随版本更新。硬删会导致 `TOOL_NOT_FOUND`。
  是否保留 1–2 个版本的「幽灵注册」（注册但 `enabled: false`，invoke 返回明确迁移提示）？
- **Q4** `habits.list` 合入 `stats` 后，权限维度仍是 `module: 'checkin'` 单点，无变化；
  但 UI 设置页（AI 工具 → 内置）列表项会减少，用户可能反馈「某功能消失」。是否需要变更说明？
- **Q5** 场景 profile 装载后，若 AI 在对话中途需要 profile 外的工具（如复盘场景突然要读网页），
  如何处理？固定 profile 会降级能力，是否允许「profile + 用户显式请求时补齐」？

---

## 10. 实施步骤（确认后执行）

1. **S1 影响面清理**：扫 `resources/**`、`src/**/help/docs/**` 中所有 `builtin.*` 字符串，列全引用清单
2. **S2 合并 `docs.read-text` → `vault.read`**：扩展名分派 + 体积守卫 + 更新 SKILL.md 正文
3. **S3 合并 `habits.list` → `habits.stats(mode)`**
4. **S4 删除 `bookmarks.search`**：同步删 `plugin.json` / `TOOL_CN` / `CHANGE_LABELS`
5. ~~**S5 修 §6.1 写上限判定**（改按 `requires === 'write'`）~~ ✅ 已完成（2026-09-09，上限 7）
6. **S6 瘦身工具 description**（长指引迁 system prompt）
7. **S7 验收**：`tsc --noEmit`（node + web 双门禁）+ smoke：教学场景出题链路（verify `docs` 合并后仍通）、
   周复盘场景（verify `habits.stats` mode 切换）、书签检索场景（verify 降级路径）

> 验收口径遵循项目约定：整套 refactor 收尾后统一跑 smoke + tsc + build，不做阶段交付。
