# 会话压缩（Conversation Compaction）设计

> 分支：feature/ai-plugin-upgrade（ai-plugin worktree）　日期：2026-09-12　状态：已实现（C1-C3 全量落码；真机验收并入统一清单）
> 前置：agentContextBudget（轮级裁剪）、agentMessageStore v2（JSONL）、循环 0-2 层均已合入本分支

## 1. 背景与问题

现状历史装配链（`agentService.ts:359-372`）是**两层丢弃式**：

```
getAgentMessages() 全量读 → slice(-40) 条数上限 → trimHistoryByBudget(token) 轮级裁剪
```

旧内容被切掉后模型**既看不见、也不知道自己看不见**。深任务（多步研究、整理类请求）的
目标、约束、早期结论集中在对话开头——恰是最先被丢的部分。

主 worktree（7827aa4）已完成"结果侧"治理：`capToolResult`（单条保险丝）+
`compressStaleToolResults`（历史工具结果压缩）。本设计补**对话历史侧**，合并后形成
完整的四层体积治理（§12）。

## 2. 目标与非目标

| # | 目标 |
|---|------|
| G1 | 自动：上下文逼近预算时请求前自动压缩，替代"静默丢弃" |
| G2 | 手动：`/compress` 斜杠指令，三处聊天面（教学 / 侧栏 / AI 学堂）可用 |
| G3 | 纪要持久化：存会话索引，重开会话仍在 |
| G4 | 增量折叠：检查点之后的新消息并入旧纪要，不全量重压 |
| G5 | cache 友好：纪要不进 system，作为首条 user 消息注入，system+tools 前缀逐字稳定 |

非目标：子代理（已否决）；跨会话记忆（另立项）；UI 折叠历史消息（已定不做，见 §3）；
纪要查看/编辑命令（远期可加 `/digest`）。

## 3. 已定决策（用户拍板 2026-09-12）

1. **落点**：ai-plugin worktree（预算/存储/循环基建都在本分支）。
2. **界面呈现**：保留原消息，仅替换发给模型的上下文；压缩完成以 toast 告知。
3. **压缩模型**：默认当前会话模型，设置项可指定压缩专用模型。

## 4. 数据结构

`AgentSessionRow`（`agentSessionRepo.ts:31`，agent-sessions.json，snake_case 行结构）新增可选字段：

```ts
digest?: {
  text: string          // 纪要正文（markdown，生成侧 ≤4000 chars 截断保护）
  upto_id: string       // 检查点：已纳入纪要的最后一条消息 id
  covered: number       // 累计被折叠的消息条数
  updated_at: string    // 本地时间，同 nowLocal() 口径
}
```

- 消息文件 `agent-messages/*.jsonl` **不动**，原消息全部保留（纪要可重算、可回滚）。
- 删除会话随行删除自然级联，无额外处理。
- 前端 `AgentSessionInfo` 不暴露 digest（纯主进程装配用）。

## 5. 上下文装配改造（agentChat）

```ts
// 现状
historyAll = getAgentMessages().filter(user|assistant)
slice(-40) → trimHistoryByBudget(·, budgetTokens)

// 改为
digest = session.digest
base    = digest ? 取 upto_id 之后的消息 : 全量消息
history = trimHistoryByBudget(base, budgetTokens).kept        // 兜底语义不变
messages = [ ...(digest ? [{ role:'user', content:'【此前对话纪要】\n' + digest.text }] : []),
             ...history ]
```

- **纪要注入为首条 user 消息，不进 system**：system+tools 是 prompt cache 前缀，
  逐字不变才能命中；纪要只在压缩时变化，变化时前缀重建是一次性成本，可接受。
- `slice(-40)` 保留：无纪要时防极端首压前装配量失控；有纪要后被切掉的部分已被纪要覆盖，无损失。
- 压缩失败/关闭/无纪要时，装配与现状**逐字节一致**——行为永不劣于今天。

## 6. 触发

### 6.1 自动（agentChat 预检）

- **位置**：`appendAgentMessage(sessionId,'user',…)`（:338）之后、历史装配（:362）之前。
- **估算**：对实际发送面估算——`buildSystemPrompt` 系列拼接串 + toolPayload JSON +
  digest.text + base 历史，用现有 `estimateTokens`（2.6 chars/token）。
- **阈值**：设置 `agentCompressAtPercent`（默认 80，范围 50-100，设置页可调），
  `compressAt = floor(agentContextBudgetTokens × percent/100)`；
  `agentContextBudgetTokens = 0`（关闭裁剪）时自动压缩同样关闭。
- **开关**：`agentCompressionEnabled`（默认 true）。关闭 → 走现有裁剪。
- **无需防抖**：压缩把检查点推到接近当前轮，装配量骤降，天然离开阈值区；下轮长回来再压。
- 当前用户消息**永不入纪要**（见 §7 保留尾段）。

### 6.2 手动（/compress）

- 渲染层拦截 → invoke `agent:compressSession` → 主进程执行 → toast 反馈。
- force 语义：不受阈值限制，可压段非空即可压。
- 正在生成（pending）时输入框本就禁用，天然规避并发。

## 7. 压缩执行（新文件 `electron/lib/agentCompress.ts`）

```ts
compressSession({ sessionId, modelId?, providerId?, effort? }): Promise<CompressResult>
```

1. 校验会话存在；`rows = getAgentMessages()`（user/assistant 全量，按存储序）。
2. **切分**：`未覆盖段 = digest.upto_id 之后的消息`；`保留尾段 = 最后 2 轮`
   （user 消息开轮，轮切分逻辑复用 trimHistoryByBudget 的口径）；`可压段 = 未覆盖段 − 保留尾段`。
   可压段为空 → `{ ok:true, skipped:'nothing-to-compress' }`。
3. **分片折叠**（防首次巨会话单次 prompt 爆炸）：
   `while 可压段未耗尽 && 片数 < 3：`
   取最老未覆盖消息累计 ≤ `COMPRESS_INPUT_CHAR_CAP = 60000` chars 为一片，
   prompt = 旧纪要（如有）+ 本片逐条 `[user|assistant] 内容`（单条截 4000 chars），
   调 `llmInvoke`（无 tools）→ 合成新纪要（§8），推进 `upto_id / covered`。
   3 片后仍有剩余 → 停在已覆盖处，下次触发续压（增量语义天然支持）。
4. **写回**：全部片成功后 `updateSessionDigest(sessionId, digest)`（agent-sessions.json
   全量重写，与会话索引现有写法一致）。**原子性：任一片失败不写回。**
5. 返回 `{ ok, covered, digestChars, slices, modelId }`；失败 `{ ok:false, error }`。
   自动路径失败静默回退裁剪（照常发请求）；手动路径 toast 报错。

**模型解析顺序**：设置 `agentCompressModelId`（非空优先）> 请求透传（自动路径 =
agentChat 的 modelOverride；手动路径 = 渲染层传当前会话模型）> `llmInvoke` 默认链。

## 8. 纪要生成 prompt

system（固定串，参与缓存）：

```text
你是会议纪要员。把「旧纪要 + 新对话片段」合并为一份新的对话纪要，
供 AI 助手在后续对话中替代被压缩的原始记录使用。要求：
- 只保留对后续有用的事实：用户目标、已确认的决策与结论、关键数字/名称/路径/日期、
  涉及的文件与页面、用户表达的偏好、未完成事项
- 保留具体细节（数字、id、标题、路径），不写"讨论了若干问题"这类空话
- 用户纠正过的结论必须体现最终版本
- 分节输出：## 用户目标 / ## 已确认结论 / ## 关键事实 / ## 涉及文件 / ## 未完成事项
 （无内容的节省略）；直接输出正文，不要任何解释
```

输出校验：非空、≤4000 chars（超长截断 + 省略标注）；空/异常 → 本片失败 → 整体不写回。

## 9. /指令框架（最小可扩展）

新文件 `src/lib/chatCommands.ts`：

```ts
export interface ChatCommandCtx { sessionId: string; surface: 'assistant' | 'aiTeaching' | 'aiLearn' }
export interface ChatCommand { name: string; desc: string; run: (ctx: ChatCommandCtx) => Promise<string | null> }
export const CHAT_COMMANDS: ChatCommand[]   // 首批仅 /compress
export async function handleChatCommand(raw: string, ctx: ChatCommandCtx): Promise<boolean> // true = 已拦截，调用方不再发送
```

三处发送入口接入：`input.trim()` 以 `/` 开头时先走 `handleChatCommand`：

- 命中 → 执行 → toast 返回文案（如「已压缩 87 条历史 → 纪要 1.2k 字」）→ 不发送；
- `/` 开头未命中 → toast「未知指令 /xxx。可用指令：/compress —— 压缩对话历史」→ 不发送；
- 其余输入原样发送，行为不变。

后续候选：`/clear`（清空当前上下文重开）、`/model`（切模型）、插件贡献命令
（plugin P3 的 commands slot）。命令浮层自动补全列为 P2，本期 toast 列出即可。

## 10. IPC 与类型

| 项 | 内容 |
|----|------|
| `agent:compressSession`（invoke） | 入参 `{ sessionId, modelId?, providerId?, effort? }` → `CompressResult { ok, skipped?, covered?, digestChars?, slices?, error? }` |
| preload | `agentCompressSession(payload)` |
| `AgentChatResult` | 增 `compressed?: { covered: number; digestChars: number }`（自动触发时透出，前端 toast「上下文已自动压缩」） |
| agentSessionRepo | 增 `updateSessionDigest(id, digest | null)`；`getAgentSession` 行内已带 digest |

## 11. 设置项（Agent 循环组，anchor `aiTools.agentLoop`）

| 键 | 默认 | 说明 |
|----|------|------|
| `agentCompressionEnabled` | `true` | 「历史自动压缩」：上下文达到触发线时自动把旧轮次折叠为纪要（代替直接丢弃）；关闭则退回裁剪 |
| `agentCompressAtPercent` | `80` | 「自动压缩触发线(%)」：历史预算的百分比，范围 50-100；越低压得越早、压缩调用越频繁 |
| `agentCompressModelId` | `''` | 「压缩专用模型」：生成纪要的模型，留空用当前会话模型；可指定便宜模型降成本 |

阈值换算在 `compressAtTokens`（夹取 50-100，异常回退 80）；`agentContextBudgetTokens` 语义不变（压缩目标线 = 其百分比，裁剪兜底线 = 原值）。

## 12. 与主 worktree 治理的合并关系（预案）

四层叠放，自上而下：

1. `capToolResult` 单条保险丝（主 worktree 7827aa4）
2. `compressStaleToolResults` 历史工具结果压缩（同上）
3. **本设计 digest 纪要压缩**（本分支）
4. `trimHistoryByBudget` 轮级裁剪兜底（本分支，压缩失败/关闭时生效）

合并注意：`agentService.ts` 装配段（:359-372）两边都会动，digest 注入只在 messages
数组头部、不碰 system 串；两边各有一个 24000（主=字符、本分支=token），纯巧合，勿混。

## 13. 边界与风险

- **压缩 LLM 失败/超时** → 不写回 + 自动路径静默回退现状裁剪（永不劣于今天）。
- **消息删改与纪要一致性**：`deleteMessage / deleteMessagesAfter / updateMessageContent`
  命中 upto_id 覆盖范围（目标消息位置 ≤ 检查点位置）时**作废 digest**（置 null），
  下次触发自动重建； regenerate 路径删除的多为保留尾段，实际极少触发。
- 可压段为空 / 会话 ≤2 轮 → skipped，不调 LLM。
- 单条消息截 4000 chars 进纪要输入（超长原文模型仍可用 vault 工具重读）。
- 纪要 ≤4000 chars ≈ 1.5k token，装配固定成本可控。
- 幂等：检查点未推进不写回；重复 /compress 且无新消息 → nothing-to-compress。
- 可逆：原消息永在盘上，digest 置 null 即回滚。
- 审计：纪要生成走 `appendAudit('llm.invoke', …)`，用量统计/月度汇总自动纳入。

## 14. 验收

冒烟（tmp/smoke，纯函数先行）：

- `agent-compress-slice-smoke.mts`：轮切分、保留尾段、检查点推进、分片累计与 MAX_SLICES
  截断、删改作废判定（≈14 断言）。
- `agent-compose-context-smoke.mts`：digest 装配（注入为首条 user 消息、trim 兜底、
  budget=0、无纪要路径与现状逐字节一致）（≈8 断言）。

源级契约（.mjs）：buildSystemPrompt 串无 digest 字样（纪要不进 system）。

真机（并入统一验收清单）：三面 /compress 与 toast；长会话自动触发观察 trace
`compressed` 与 `cachedTokens` 不塌；压缩后追问早期细节能从纪要回答；关闭开关回到
现状；断网压缩请求照常；重开会话纪要仍在。

## 15. 落码顺序

| 阶段 | 内容 |
|------|------|
| C1 | `agentCompress.ts`（纯函数切分/装配 + llmInvoke 编排）+ `updateSessionDigest` + agentChat 装配改造 + IPC + 冒烟 |
| C2 | `chatCommands.ts` + 三面接线 `/compress` + 结果 toast |
| C3 | 设置项 + 自动预检触发 + `AgentChatResult.compressed` + 双侧 tsc/build 全绿 + 文档收尾 |
