# AI 输出流式化与思考过程可视化 —— 实现方案

> 2026-09-10 定稿。前置体验原型：`docs/prototypes/ai-thinking-progress-preview.html`
> 本文是后续落码的唯一依据；涉及行号以定稿时代码为准（`electron/lib/agentService.ts` 等）。

---

## 0. 结论摘要

**问题不是「流式没做」，而是「等待期完全无信息」。**

一次请求分三段：T1 首 token 等待（2~30s）、T2 工具执行（每次 0.3~数秒，一轮常 3~7 次）、T3 正文生成（数秒~数十秒）。
现状下三段共用同一个转圈气泡，20 秒的请求里有 **13.6 秒界面完全无变化**。

**两件事捆成一个体验单元做，收益最大：**

| 单元 | 内容 | 效果 |
|---|---|---|
| **单元 A（必做）** | 过程时间线（工具进行中→✓ + 目标 + 耗时）+ 正文流式 + 耗时计时 | 13.6s → **4.2s** |
| **单元 B（可后置）** | 思考链折叠区（自适应出现）+ 过程旁白 | 4.2s → **0.8s** |

⚠️ **不要只做时间线不做流式**：那样 13.2→20.0 秒等最后一轮生成的 6.8 秒干等依然存在，与现状无本质区别（这是原型阶段推翻了初始分期的地方）。

**已消除的技术未知数**：实测 Electron 33.2.0 的 `net.fetch` 能逐块读 SSE（探针 `tmp/probe-netfetch-sse.cjs`，结果见 §5.1.2）。方案可行。

---

## 1. 背景与目标

### 1.1 用户诉求（准确表述）

> 「我给一个命令给 AI，AI 在思考的时候，用户这里只是简单的转圈，会觉得太单调；有点思考过程体验会更好。」

关键词是**等待期**，不是生成速度。所以「流式」的收益在 T3，而痛点主要在 T1/T2 —— 两者在技术上几乎不重叠。

### 1.2 量化目标

定义 **「界面无变化时长」**：相邻两次界面变化间隔 > 1.5 秒的部分累加，**计时器跳动不计入**（否则任何计时都能刷成 0）。

| 状态 | 本场景（20s 请求） | 说明 |
|---|---|---|
| 现在 | **13.6s** | 0→4.2 干等；8.3→10.9 干等；13.2→20.0 干等 |
| 单元 A 完成 | **4.2s** | 只剩 T1 首 token 等待 |
| 单元 A+B 完成 | **0.8s** | 思考链从第 0.8 秒开始填充 |

### 1.3 不做的事

- ❌ 工具调用**参数**的逐字流式（L3，成本高收益低）
- ❌ 「匀速漏字」平滑层（会让人误以为生成变慢；真流式的不均匀是可接受的）
- ❌ 预判模型是否支持思考（见 §5.5，事件驱动天然自适应）

---

## 2. 现状核查

### 2.1 链路各层现状

| 层 | 位置 | 现状 |
|---|---|---|
| 网关 | `electron/lib/llmService.ts` L110 `httpJson` | `await res.text()` 攒完整响应再 `JSON.parse`；请求体无 `stream`；`TOTAL_TIMEOUT_MS = 300_000`（L67） |
| 网关 | 同文件 L172 / L220 / L269 | 三个 adapter（openai-compatible / ollama / anthropic）**全部非流式** |
| 网关 | 同文件 L190 | `effort` 只在 `REASONING_MODEL_RE` 命中时才发 `reasoning_effort` |
| 网关 | 同文件 L202 / L243 / L326 | 响应中**从不读取** `reasoning_content` / `thinking` block |
| Agent | `agentService.ts` L393 | `await invokeLlmInternal(...)` 整轮返回后才继续 |
| Agent | L403 | `llm` 步骤在**轮结束后**才推给渲染层 |
| Agent | L487 | `tool` 步骤在**执行完之后**才推 |
| Agent | L406 / L417 | **中间轮 `r.content` 被丢弃**：只有 `toolCalls.length === 0` 的那一轮才把 content 当回复；带工具轮次的 content 仅 push 进 `convo` 回喂，不上屏不落库 |
| 渲染 | `MessageList.tsx` L201-212 | 固定文案 pending 气泡（`正在思考…` / `正在调用 xx（第 N 次）`） |
| 渲染 | `ai-teaching/index.tsx` L1903-1917 | 同一套文案，**另一份独立实现** |

### 2.2 三个根因

1. **事件粒度是「轮」不是「事件」** → 文案更新间隔 = 一整轮 LLM 生成时间（实测可达 4~9 秒同一句话）。
2. **文案是覆盖式的** → 看不到「已经做了多少事」；Cursor / Claude Code 用的是**累积时间线**。
3. **过程文本被丢弃** → 模型写的「我先读一下你的笔记」永远不出现。

### 2.3 可复用的现成资产（不要重造）

| 资产 | 位置 | 用途 |
|---|---|---|
| 定向事件推送样板 | `agentService.ts` L556-568 `withAbort` + `stepEmitters`（`WeakMap<AbortSignal, emitter>`） | 流式 emitter 直接沿用同一机制 |
| 调用**前**推送的先例 | `agentService.ts` L443-448（`visual.html` 调用前推 `{slug,title}` 占位） | 「工具进行中」事件就是把这个模式推广到全部工具 |
| 思考能力判定 | `llmService.ts` L170 `REASONING_MODEL_RE` + L594 `llm:reasoningCapable` IPC | 仅用于发 `effort` 前的守卫，**不用于 UI 判断** |
| trace 落库 | `agentSessionRepo.ts` L35 `trace_json: string \| null`（JSON 字符串） | 扩字段即可，**不需要改存储结构** |
| 中断 | `agentService.ts` L124 `activeChats: Map<chatId, AbortController>` | 流式下直接复用，abort 即断流 |
| 渲染入口 | `MessageList.tsx`（侧栏 + 学堂**共用**） | 改一处覆盖两处 |

---

## 3. 目标效果边界

| 能力 | 是否实现 | 说明 |
|---|---|---|
| 正文逐字流式 + 末尾光标 | ✅ | 核心 |
| 过程时间线（工具进行中 → ✓ / ✗） | ✅ | 核心，与流式同一单元 |
| 耗时计时（等待期不静止） | ✅ | 零后端成本 |
| 过程旁白（原被丢弃的中间轮文本） | ✅ | 成本低、感知强 |
| 思考链折叠区 | ✅ 自适应 | 收到就显示，没收到就完全不存在 |
| 工具参数逐字可见 | ❌ | 不做 |
| 完成后过程折叠成一行摘要 | ✅ | 「完成 · 20.0s · 5 次工具调用 · 3 轮模型调用」，可点击展开 |

---

## 4. 总体设计

### 4.1 事件流全貌

```
用户发送
  │
  ├─ AgentRunner 第 1 轮 ────────────────────────────────────────
  │    ├ reasoning delta*   ─┐
  │    ├ text delta*        ─┼→ agent:stream（主进程合批 40ms）
  │    ├ tool-start         ─┘
  │    └ tool-end（执行完）  ──→ agent:step（沿用现有通道）
  ├─ 第 2 轮 …（同上）
  └─ 末轮（无 tool_calls）
       ├ text delta* → agent:stream
       └ done → 落库 appendAgentMessage（原逻辑不变）
```

**双通道分工（刻意如此，目的是把改动风险压到最小）：**

| 通道 | 承载 | 变化 |
|---|---|---|
| `agent:stream`（新增） | `round-start` / `thinking` / `text` / `tool-start` | 增量事件 |
| `agent:step`（保持不动） | `llm` / `tool` 步骤完成事件（含耗时、artifact） | **零改动** |

渲染层把两者合起来就是完整时间线。**trace 落库逻辑完全不动**，这是本方案最大的风险控制点。

**事件配对**：`tool-start` 与 `tool-end` 按出现顺序一一配对，不需要 id。依据：`runAgentLoop` L418 的工具执行是串行 `for` 循环，不存在并发，顺序配对是可靠的。

### 4.2 分期

| 期 | 内容 | 交付物 |
|---|---|---|
| **P0** | 网关 SSE 流式 + 归一化事件（不含 UI） | `invokeLlmStream` 可跑通，控制台能打印 delta |
| **P1** | `agent:stream` 通道 + 合批 + 工具进行中事件 + 渲染层流式草稿 + 时间线 + 耗时 + **侧栏/学堂接入** | 单元 A 上线（13.6s → 4.2s） |
| **P2** | 思考链自适应 + 过程旁白 + 设置项 | 单元 B（→ 0.8s） |
| **P3** | AI 教学模块接入（自有渲染 + 围栏协议，见 §8.3） | 全模块一致 |

---

## 5. 详细设计

### 5.1 网关层：`electron/lib/llmService.ts`

#### 5.1.1 归一化事件类型（新增）

屏蔽三家差异的唯一抽象。**所有上层只认这个类型。**

```ts
export type LlmStreamEvent =
  | { type: 'text';      delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; index: number; id?: string; name?: string; argsDelta?: string }
  | { type: 'usage';     promptTokens: number; completionTokens: number }
  | { type: 'done' }
```

#### 5.1.2 SSE 读取与帧解析（实测约束驱动）

**实测事实**（`tmp/probe-netfetch-sse.cjs`，electron 33.2.0）：

- `net.fetch` 逐块返回，不需要换 `net.request` / undici
- 单块最大实测 **21759 字节**，块间隔最大 3.5s
- → **chunk 边界与事件边界无关**，一个 chunk 含多个事件、或半个事件都是常态

因此解析必须**带缓冲按帧切分**：

```ts
async function* readFrames(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    buf = buf.replace(/\r\n/g, '\n')      // 容忍 CRLF
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i)
      buf = buf.slice(i + 2)
      yield frame
    }
  }
  if (buf.trim()) yield buf                  // 收尾残留
}
```

- OpenAI / Anthropic：SSE，按 `\n\n` 切帧，每帧内取 `data:` 行，`[DONE]` 结束
- Ollama：**NDJSON**（不是 SSE），按 `\n` 切，逐行 `JSON.parse`

**必须处理的坑**：`data:` 可能跨帧拼接（Anthropic 的 `content_block_delta` 有时分两个 data 行），以及 `event:` 行需要忽略 —— 所以取 `data:` 后用 `try/catch` 包 `JSON.parse`，解析失败**不抛异常，只丢弃该帧**（网关偶发心跳帧是正常的）。

#### 5.1.3 三家适配映射

| 上游 | 文本 | 思考 | 工具调用 | usage |
|---|---|---|---|---|
| OpenAI 兼容 | `choices[0].delta.content` | `delta.reasoning_content`；**容错** `delta.reasoning` | `delta.tool_calls[i]`：`index` 固定，`id`/`function.name` 只在首片给，`function.arguments` 分片拼接 | 末块（需 `stream_options:{include_usage:true}`，不支持则退化为 0） |
| Anthropic | `content_block_delta` → `delta.text` | `delta.type === 'thinking_delta'` → `delta.thinking` | `content_block_start`(tool_use) + `input_json_delta` 分片 | `message_delta.usage.output_tokens` |
| Ollama | `message.content` | `message.thinking` | `message.tool_calls`（整块给） | `prompt_eval_count` / `eval_count` |

**thinking 字段名容错**是必要的：不同中转站用过 `reasoning_content` / `reasoning` / `reasoning_details`。归一化层只要见到任一形式就发 `reasoning` 事件——**这比预判模型名可靠得多**（见 §5.5）。

#### 5.1.4 超时策略（必须改）

现有的 `AbortSignal.timeout(TOTAL_TIMEOUT_MS = 300_000)`（L111）在流式下会在第 300 秒掐断正常长流。改为：

- **首字节超时** 60s：从请求发出到第一个 chunk
- **空闲超时** 60s：两次 chunk 之间的最大间隔（每次收到 chunk 重置定时器）
- 不加总时长上限（或设 15 分钟兜底）

实现方式：不用 `AbortSignal.timeout`，改为手动 `setTimeout` + `AbortController`（与调用方传入的 `signal` 用 `AbortSignal.any` 合并）。

#### 5.1.5 与现有接口同构（关键：让上层几乎不改）

新增 `invokeLlmStream`，**流结束后仍返回现有的 `LlmInvokeResponse`**（`content` / `toolCalls` / `assistantMessage` / `usage`）。

这样 `runAgentLoop` 的回喂、trace 构造、`appendAudit`、落库逻辑**全部不用改**——流式只是"在生成过程中额外发事件"，不改变结果形态。这是把改造风险压在地板上的核心设计。

```ts
async function invokeLlmStream(
  req: LlmInvokeRequest,
  onEvent: (e: LlmStreamEvent) => void,
): Promise<LlmInvokeResponse>   // ← 与 llmInvoke 完全同类型
```

`toolCalls` 的累积：OpenAI 流式下按 `index` 分组，`id`/`name` 取首个非空值，`arguments` 字符串累加，流结束后统一 `JSON.parse` 并复用现有 `normalizeOpenAiToolCalls` 的输出格式。

#### 5.1.6 非流式回退

部分中转站会忽略 `stream: true`（直接返回整体 JSON）或缓冲 SSE。判定与降级：

1. 响应 `Content-Type` 不含 `text/event-stream` → 走原有非流式解析路径（同一函数内分支）
2. 首块内容以 `{` 开头且能整体 `JSON.parse` 出 `choices` → 同上
3. 设置项 `aiStreamEnabled = false` → 直接走非流式

回退时 UI 表现为"内容一次性出现"，功能可用，仅失去过程感——**不影响正确性**。

---

### 5.2 Agent 层：`electron/lib/agentService.ts`

#### 5.2.1 通道与 emitter

沿用 `stepEmitters` 的 `WeakMap<AbortSignal, emitter>` 模式，新增 `streamEmitters`：

```ts
export type AgentStreamEvent =
  | { kind: 'round-start'; round: number }
  | { kind: 'thinking';    delta: string }
  | { kind: 'text';        delta: string }
  | { kind: 'tool-start';  name: string; target?: string }
```

主进程侧在 `withAbort`（L557）里一并注册，发送 `sender.send('agent:stream', { chatId, event })`。

**只发给发起窗口**（与 `agent:step` 一致）；多窗口下另一窗口看不到流——**接受**，与 ChatGPT / Claude 行为一致。

#### 5.2.2 合批（性能红线）

**绝不每 token 一次 IPC。** 2000 字回答按 3 字/事件算是 600+ 次；合批后应该是 30~80 次。

```ts
class DeltaBatcher {
  private text = ''
  private reason = ''
  private timer: NodeJS.Timeout | null = null
  constructor(private send: (e: AgentStreamEvent) => void) {}
  push(kind: 'text' | 'thinking', delta: string): void {
    if (kind === 'text') this.text += delta; else this.reason += delta
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 40)   // 40ms 或
  }
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.reason) { this.send({ kind: 'thinking', delta: this.reason }); this.reason = '' }
    if (this.text)   { this.send({ kind: 'text', delta: this.text });      this.text = '' }
  }
}
```

补充阈值：累计 > 64 字符时立即 flush（避免 40ms 内积压过大）。**流结束前必须 flush 一次**，否则最后一段丢失。

#### 5.2.3 工具事件：调用前推

现有 L487 只在工具执行完推 `tool` 步骤。新增在 `invokeToolInternal` **之前**推 `tool-start`（放在 L450 之前，紧邻现有 `visual.html` 的占位推送处 L443）：

```ts
streamEmitters.get(signal)?.({ kind: 'tool-start', name: realName, target: targetSummary(args) })
```

`targetSummary(args)`：从入参里提取人类可读目标（`path` / `title` / `date` / `name` / `slug`），复用现有 `AgentChange` 的取参口径（L497-501）。

#### 5.2.4 过程旁白（修掉被丢弃的文本）

`runAgentLoop` L406 的判定保持"只有无 tool_calls 的轮才是最终回复"，但在 L417（push `r.assistantMessage` 之前）**把中间轮的 content 也推出去**：

```ts
if (r.content?.trim()) {
  streamEmitters.get(signal)?.({ kind: 'text', delta: r.content })   // 作为本轮过程文本
}
```

落库：扩展 `AgentTraceStep`（`agentService.ts` L49）加两个可选字段（`trace_json` 是 JSON 字符串，**不需要改存储结构**）：

```ts
/** 过程旁白：带工具轮次里模型输出的说明文本（历史回看用） */
processText?: string
/** 思考耗时统计（reasoning 全文不落库，见 §5.2.5） */
thinkingMs?: number
```

#### 5.2.5 思考内容的落库决策

**reasoning 全文不落库。** 理由：
- `reasoning_content` 常常是正文的数倍长度，会话表（`agent-messages.json` 全量读写，见 `agentSessionRepo.ts` L50）会迅速膨胀
- 回看历史时思考过程的价值随时间快速衰减

只在 trace 里记 `thinkingMs`（思考耗时），UI 显示"已思考 3.4s"。若后续确有回看需求，再加字段不迟（向后兼容）。

#### 5.2.6 中断

现有 `agent:abort` → `activeChats.get(chatId)?.abort()` 逻辑不变。流式下新增两点：

1. abort 后**立即 flush 并停止发送**，避免残留 delta 打到已卸载的 UI
2. 已生成的部分内容**保留**（UI 标记"已停止"），不重试整轮——与 ChatGPT / Claude 一致

---

### 5.3 渲染层

#### 5.3.1 流式草稿 state（独立于 `messages`）

**不要往 `messages` 数组里塞流式内容**——那会让每个 delta 触发整列表 diff。

```ts
interface StreamDraft {
  phase: 'waiting' | 'thinking' | 'tool' | 'answering'
  thinking: string
  text: string
  items: Array<
    | { kind: 'narr'; text: string }
    | { kind: 'tool'; name: string; target?: string; state: 'running' | 'done' | 'fail'; durationMs?: number }
  >
  startedAt: number        // performance.now()
}
```

生命周期：`send()` 时置初值 → delta 累积到 ref → rAF 节流 setState → `done` 后调 `refreshMessages()`，用落库结果替换草稿并清空。

#### 5.3.2 渲染节流与降级

`MarkdownPreview` 挂了 remark-gfm / remark-math / rehype-highlight / rehype-katex，**每次 delta 全量重建 AST 必然卡**。

策略（按此顺序，能不改就不改）：

1. **先只做节流**：delta 写 ref，用 `requestAnimationFrame` 或 100ms 定时器 setState 一次。2000 字回答 ≈ 20~60 次渲染，先实测
2. 若 CPU 打不住（DevTools Performance 面板看单帧 > 16ms 持续），再降级：流式期间只渲染纯文本（`white-space: pre-wrap`）+ 代码块原样输出，`done` 时一次性切回 `MarkdownPreview`

**不接受**的方案：流式期间完全不渲染 Markdown（会出现明显的"跳变"）。

#### 5.3.3 滚动跟随

现有 `MessageList.tsx` L122 的 `bottomRef.scrollIntoView({ behavior: 'smooth' })` 挂在 `[messages, pending]` 上——流式高频触发会与 smooth 动画互相打架（表现为滚动抽搐）。

改为：

```ts
const el = scrollRef.current
const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
if (atBottom) el.scrollTop = el.scrollHeight        // instant，严禁 smooth
```

用户上滚阅读时**不打断**。

#### 5.3.4 组件结构

新增（放 `src/components/shared/AssistantPanel/`；实现时 ThinkingBlock / ProcessTimeline
作为内部子组件与 StreamBubble 合并在同一文件，均不对外导出）：

| 文件 | 职责 |
|---|---|
| `StreamBubble.tsx` | 流式草稿容器（内含 ThinkingBlock 折叠思考区 + ProcessTimeline 过程时间线） |
| `useAgentStream.ts` | hook：订阅 `agent:stream` + `agent:step`，维护 `StreamDraft`（delta mutate ref，60ms setTimeout 节流 flush——**用 setTimeout 而非 rAF**：本应用是多 Tab display:none 常驻保活架构，rAF 在窗口不可见时挂起） |

视觉规格沿用原型：字号 11.5~12.5px、细边框、`var(--*)` 主题变量、无阴影；工具行 `spinner → ✓`，完成后文字降为 `--text-muted`。

#### 5.3.5 接入点

| 位置 | 改动 |
|---|---|
| `MessageList.tsx` L201-212 | pending 气泡替换为 `<StreamBubble>`（**改一处覆盖侧栏 + AI 学堂两处**） |
| `ai-teaching/index.tsx` L1903-1917 | 同上（P3，因其自有渲染 + 围栏协议） |
| `preload/index.ts` L229 附近 | 新增 `onAgentStream`，与 `onAgentStep` 同结构 |
| `src/lib/ipc.ts` L494 附近 | 新增 `onAgentStream` 导出 |
| `src/types/index.ts` | 补 `onAgentStream` 与 `AgentStreamEvent` 类型声明 |

---

### 5.4 设置项

| key | 默认 | 位置 |
|---|---|---|
| `aiStreamEnabled` | `true` | 设置 → AI 工具 → 模型配置（新增「对话输出」分组） |
| `aiShowThinking` | `true` | 同上 |

⚠️ **必须同时给 `ui: true` 和 `anchor`**，否则不会出现在设置页搜索里（`sections.tsx` 的 `schemaKeyItems()` 只收 `ui && anchor`）；视图里要有同名 `data-setting-anchor`。

`aiStreamEnabled = false` 时的行为：不发 `stream: true`，走非流式路径，过程时间线仍可用（工具事件不依赖流式）。

### 5.5 思考链自适应（不做预判）

**规则只有一条：收到第一个 `reasoning` 事件才渲染思考区；一个都没收到 → 思考区从头到尾不存在。**

为什么不用 `REASONING_MODEL_RE` 预判：

| 层次 | 能否预判 | 结论 |
|---|---|---|
| 模型是否**接受** `reasoning_effort` 参数 | 必须预判（发错参数会被 400） | **已有**正则，逻辑不动 |
| 模型是否**返回**思考内容 | 不可靠 | 事件驱动 |
| 中转站是否**透传**思考内容 | **完全不可预判** | 事件驱动 |

名字启发的两个失效方向：漏（中转站改名 `deepseek-r1-0528`、自定义别名；`qwen3` 有 thinking / non-thinking 两版同名）、误（正则里的 `smart` / `research` 过于宽泛）。**同一个模型经不同中转站进来行为可以完全不同**——名字反映不了。

附带好处：这个设计让普通模型上该功能在视觉上**完全不存在**，零冗余、零噪音。

---

## 6. 改动文件清单

| 文件 | 改动 | 期 |
|---|---|---|
| `electron/lib/llmService.ts` | 新增 `readFrames` / `LlmStreamEvent` / 三家 `chatStream` / `invokeLlmStream` / 超时改造 | P0 |
| `electron/lib/agentService.ts` | `AgentStreamEvent` / `streamEmitters` / `DeltaBatcher` / `tool-start` 推送 / 中间轮文本推送 / `AgentTraceStep` 扩字段 | P1-P2 |
| `electron/preload/index.ts` | `onAgentStream` | P1 |
| `src/lib/ipc.ts` · `src/types/index.ts` | 类型与导出 | P1 |
| `src/components/shared/AssistantPanel/` | `StreamBubble.tsx`（含思考区/时间线子组件）+ `useAgentStream.ts` | P1-P2 |
| `src/components/shared/AssistantPanel/MessageList.tsx` | 替换 pending 气泡；滚动策略修正 | P1 |
| `src/modules/settings/views/AiModelsTab.tsx` + `sections.tsx` | 两个设置项（`ui:true` + `anchor`） | P2 |
| `src/modules/ai-teaching/index.tsx` | 接入（自有渲染 + 围栏协议） | P3 |

---

## 7. 验收标准

**功能**
- [ ] 正文逐字出现，末尾有光标；`done` 后光标消失
- [ ] 工具行：调用**前**即出现（进行中），完成后原地变 ✓ 并显示耗时
- [ ] 中间轮旁白可见，且历史回看时仍在
- [ ] 完成后过程折叠为一行摘要，点击可展开
- [ ] 思考区：推理模型出现、普通模型**完全不出现**（同一会话换模型后行为随之改变）
- [ ] 停止按钮：点击后 200ms 内停止输出，已生成部分保留并标记「已停止」

**性能**
- [ ] 2000 字回答期间单个渲染帧 < 16ms（DevTools Performance 抽查）
- [ ] 一次完整请求的 IPC `agent:stream` 事件数 < 100
- [ ] 用户上滚阅读时不被强制滚回底部

**兼容**
- [ ] openai-compatible / ollama / anthropic 三家各跑通一次
- [ ] 中转站（opencode 等）不支持 SSE 时，自动回退非流式且功能可用
- [ ] `aiStreamEnabled = false` 时一切正常

**量化**
- [ ] 原型同场景下「界面无变化时长」13.6s → 4.2s（P1）→ 0.8s（P2）

---

## 8. 风险与回退

### 8.1 风险表

| 风险 | 影响 | 对策 |
|---|---|---|
| ~~`net.fetch` 不逐块~~ | — | **已实测通过**（§5.1.2） |
| 中转站缓冲 SSE | 退化成"一次性出现" | §5.1.6 自动回退 + 设置开关 |
| reasoning 不逐 token | T1 仍空 | 无解（供应商行为）；已提前说明预期 |
| Markdown 重渲染 CPU | 打字卡顿 | §5.3.2 节流 → 降级 |
| 多窗口看不到流 | 观感不一致 | 接受（与同类产品一致） |
| 流中断（网络抖动） | 内容截断 | 保留已生成部分 + 提示可重试 |

### 8.2 回退开关

`aiStreamEnabled = false` 一键回到现在的非流式行为。改动集中在新增代码路径，**不修改现有 `chat()` / `llmInvoke()` 的逻辑**，因此关掉开关等于回到当前线上行为。

### 8.3 AI 教学模块（P3 单独处理）

该模块有两个自有复杂度，故与侧栏/学堂分开：

1. **自有渲染**（`index.tsx` 2704 行），不共用 `MessageList`
2. **围栏协议**：`plan` / `quiz` / `ask` 是 ``` 围栏 JSON，**流式期间围栏未闭合不能解析**，否则会闪过半截 JSON。需要在原始文本上缓冲到围栏闭合后再提交给解析器（`QuizParser` / plan / ask 各自处理）

---

## 9. 已定决策记录

| 决策 | 结论 | 依据 |
|---|---|---|
| 时间线与流式是否分期 | **同一体验单元，一起做** | 原型实测：只做时间线，尾部 6.8s 干等仍在 |
| 思考链是否保留 | **保留，但自适应出现** | 事件驱动零成本；普通模型上视觉不存在，无冗余 |
| 是否预判模型能力 | **不预判**（UI 侧） | 中转站改名/透传不可预判；`REASONING_MODEL_RE` 仅保留用于 `effort` 守卫 |
| reasoning 全文是否落库 | **不落库**，只记 `thinkingMs` | 会话表全量读写，膨胀风险高；回看价值衰减 |
| 中间轮文本是否展示 | **展示并落库**（`processText`） | 感知强、成本低；扩字段不改存储结构 |
| 完成后是否保留过程 | **折叠成一行摘要，可展开** | 历史回看保留"做过什么" |
| 是否做 L3 工具参数流式 | **不做** | 成本高、收益低 |
| 是否做匀速漏字平滑 | **不做** | 会让人误以为生成变慢 |
| 思考链对普通模型 | 不是"占位"，是**完全不出现** | 匹配用户"厌恶冗余元素"偏好 |

---

## 10. 遗留待确认

1. **工具步骤同类合并**：一次请求读 3 个文件，是 3 行还是"读取 3 个文件"1 行？（建议先按 3 行，实际观感后再定；默认只显示最近 3 条 + 滚动）
2. **原型里的旁白文案由模型自由生成**，措辞可能不稳定（有的模型中间轮不输出任何文本）。若实际观感不佳，可在 system prompt 里加一句"多轮任务时，每轮先说明你要做什么"引导——但这会增加 token 消耗，建议先观察再定。
3. **设置项归属**：目前方案放「AI 工具 → 模型配置」，若你觉得这更属于"通用偏好"，可移到通用设置。
