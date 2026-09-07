import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { listTools, invokeToolInternal, getSettingReader, checkModulePermission, checkVaultFilePermission } from './aiTools'
import type { ToolDescription } from './aiTools'
import { invokeLlmInternal } from './llmService'
import {
  createAgentSession, listAgentSessions, renameAgentSession, deleteAgentSession,
  sessionExists, appendAgentMessage, ensureSessionTitle, getAgentMessages,
  getMessageById, updateMessageContent, deleteMessage, deleteMessagesAfter,
  getAgentSession, updateAgentSessionInstructions,
} from './agentSessionRepo'
import { resolveConstraintsForInjection } from './aiTeachingFolders'
import { resolveSourcesForInjection } from './aiTeachingSources'
import { resolveProfilesForInjection } from './aiTeachingProfile'

/**
 * 最小 AgentRunner —— 「用户消息 → LLM 决策 → ToolRegistry 执行 → 结果回喂」循环。
 * - 工具来源即统一注册表（builtin/mcp/skill 全量，禁用项自动排除）
 * - 每轮工具执行都走 invokeToolInternal：入参校验/审计/月度上限与手动调用完全一致
 * - 循环上限 8 轮；LLM 网关不代执行工具（职责分离），执行权只在这里
 */

const MAX_ITERATIONS = 8

/** 单次请求内 vault 写工具次数上限（防失控循环刷盘；docs/agent-file-tools-design.md §5.5） */
const MAX_SESSION_WRITES = 5
/** vault 写工具集合（F2 write/edit；F3 rename/trash 预留同口径） */
const VAULT_WRITE_TOOLS = new Set([
  'builtin.vault.write', 'builtin.vault.edit',
  'builtin.vault.rename', 'builtin.vault.trash',
])

/** 注册表名含点号，OpenAI function name 仅允许 [a-zA-Z0-9_-] —— 双向映射 */
function toFnName(registryName: string): string {
  return registryName.replace(/\./g, '__')
}

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: unknown[]
  tool_call_id?: string
}

export interface AgentTraceStep {
  kind: 'llm' | 'tool'
  /** llm: 本轮模型; tool: 工具注册名 */
  name?: string
  ok: boolean
  durationMs: number
  tokens?: number
  /** 拆分用量（llm step） */
  promptTokens?: number
  completionTokens?: number
  summary?: string
}

export interface AgentContextInfo {
  type: string
  label: string
  /** 上下文数据（如知识库页面正文），注入 system 时截断防 token 失控 */
  data?: Record<string, unknown>
}

export interface AgentChatRequest {
  sessionId: string
  /** 本轮用户消息（历史由服务端从会话库加载） */
  message: string
  /** 渲染层附带的当前上下文（如正在查看的知识库页面） */
  context?: AgentContextInfo
  /** 渲染层生成的调用标识——配合 agent:abort 实现停止生成 */
  chatId?: string
  /** 调用来源（P3a §3.8-2）：'aiTeaching' 时附加「每条回答带标题」等模块专属规则；轻问答不传 */
  source?: string
  /** P3b §3.8 第五轮：本对话临时换模（'providerId:modelId' 串，与 defaultChatModel 同格式；不传=全局默认） */
  modelId?: string
  /** P3b：思考强度（仅推理型模型实际透传 reasoning_effort，主进程侧守卫） */
  effort?: 'off' | 'low' | 'medium' | 'high'
}

/** 单次请求对用户数据的写改动（供 UI 列出「本次改了哪些文件/条目」） */
export interface AgentChange {
  /** 工具注册名（builtin.vault.edit 等） */
  tool: string
  /** 人类可读动作（编辑/新建/删除/打卡…） */
  action: string
  /** 目标：文件 relPath / 标题 / 日期等（取写工具关键入参） */
  target: string
  /** 可点击直达编辑器的仓库内文件 relPath（仅 vault 文件写类工具；trash 后文件已移走不设） */
  file?: string
}

export interface AgentChatResult {
  ok: boolean
  sessionId?: string
  reply?: string
  error?: string
  code?: string
  trace: AgentTraceStep[]
  /** 本次执行真实发生的写改动（成功写入/创建类工具），供 UI 渲染改动清单 */
  changes?: AgentChange[]
  /** UI 优化条目9②：AI教学本轮 system 注入分段字符数（渲染层据此估算「上下文构成」摘要；其它来源不设） */
  injection?: AiTeachInjectionStats
}

/** AI教学 system 注入分段字符数（基础人设 / CONSTRAINTS / 三层画像 / SOURCE 目录 / 教学规则） */
export interface AiTeachInjectionStats {
  systemChars: number
  constraintChars: number
  profileChars: number
  sourcesChars: number
  ruleChars: number
}

/** 进行中的对话 → 中断控制器（用户点击停止时触发） */
const activeChats = new Map<string, AbortController>()

/** signal → 步骤事件推送器（withAbort 注入发起窗口 sender，仅目标窗口收流） */
const stepEmitters = new WeakMap<AbortSignal, (step: AgentTraceStep) => void>()

/** 写改动识别：工具 → 人类动作标签（成功执行后收集 target=path/title/date/name） */
const CHANGE_LABELS: Record<string, string> = {
  'builtin.vault.write': '写入文件',
  'builtin.vault.edit': '修改文件',
  'builtin.vault.rename': '重命名文件',
  'builtin.vault.trash': '移入回收站',
  'builtin.knowledge.create-page': '新建知识页',
  'builtin.knowledge.append-page': '追加知识页',
  'builtin.blog.create-entry': '新建日记',
  'builtin.schedule.create-todo': '创建待办',
  'builtin.checkin.check-habit': '习惯打卡',
}

function buildToolsPayload(): {
  payload: unknown[]
  nameMap: Map<string, string>
  /** 因模块权限被过滤掉的工具所属模块（用于 system prompt 给出可操作指引） */
  deniedModules: Set<string>
  /** 是否有 vault.* 工具被 vaultFile 文件域权限拦截（指引文案用） */
  deniedVaultFile: boolean
  /** 权限过滤后仍可用的 skill 清单（注入 system prompt，让 AI 感知已配置的能力包） */
  skills: Array<{ registryName: string; title: string; description: string }>
} {
  const reader = getSettingReader()
  // 按模块权限预过滤：AI 无权使用的操作不进入其视野（invoke 处另有硬校验兜底）
  const all = listTools().filter(t => t.enabled)
  const deniedModules = new Set<string>()
  let deniedVaultFile = false
  const tools: ToolDescription[] = all.filter(t => {
    const denied = checkModulePermission(t, reader)
    if (denied && t.module) deniedModules.add(t.module)
    if (!denied && t.vaultFile && checkVaultFilePermission(t, reader)) {
      deniedVaultFile = true
      return false
    }
    return !denied
  })
  const payload = tools.map(t => ({
    type: 'function',
    function: {
      name: toFnName(t.name),
      description: `${t.title} —— ${t.description}`,
      parameters: t.inputSchema,
    },
  }))
  const nameMap = new Map<string, string>()
  for (const t of tools) nameMap.set(toFnName(t.name), t.name)
  const skills = tools
    .filter(t => t.source === 'skill')
    .map(t => ({
      registryName: t.name,
      title: t.title,
      description: t.description.replace(/^\[Skill\]\s*/, ''),
    }))
  return { payload, nameMap, deniedModules, deniedVaultFile, skills }
}

const SYSTEM_PROMPT_BASE = [
  '你是本地知识管理应用 Knowbase 内置的 AI 助手。',
  '你可以调用工具读写用户的本地数据（知识库、博客日记、日程待办、习惯打卡、书签、番茄专注统计等）。',
  '规则：',
  '1. 需要数据时先调工具，不要编造；',
  '2. 可用的工具已按用户对各模块的授权过滤——列表里没有的模块即无权操作，直接如实告知即可，不要尝试绕过；',
  '3. 标注为写入类的工具会真实生效并留有审计记录，执行前确保理解了用户意图；',
  '4. 回答使用简体中文，简洁直接；',
  '5. 引用知识库内容时注明页面标题。',
  '6. 本次请求可用的工具列表以系统提供的 tools 为准：用户可能随时调整模块授权，即使历史对话中你曾表示缺少某工具，也必须先对照当前列表确认，不要沿用旧结论拒绝。',
].join('\n')

function buildSystemPrompt(context?: AgentContextInfo): string {
  if (!context) return SYSTEM_PROMPT_BASE
  let dataText = ''
  try {
    dataText = JSON.stringify(context.data ?? {}, null, 0)
  } catch { /* ignore */ }
  if (dataText.length > 6000) dataText = dataText.slice(0, 6000) + '…(截断)'
  return SYSTEM_PROMPT_BASE +
    `\n\n【当前上下文】用户正在查看：${context.label}（类型 ${context.type}）。` +
    (dataText ? `\n上下文数据：\n${dataText}` : '') +
    '\n用户的问题大概率与该上下文相关；若需要更多数据仍应调用工具。'
}

async function agentChat(req: AgentChatRequest, signal: AbortSignal, _chatId: string): Promise<AgentChatResult> {
  const trace: AgentTraceStep[] = []
  const message = String(req?.message ?? '').trim()
  if (!message) return { ok: false, error: '消息不能为空', trace }

  // ---- 会话保障 ----
  let sessionId = String(req.sessionId ?? '')
  if (sessionId && !sessionExists(sessionId)) sessionId = ''
  if (!sessionId) sessionId = createAgentSession().id

  // ---- 落库用户消息 + 自动标题 ----
  appendAgentMessage(sessionId, 'user', message)
  ensureSessionTitle(sessionId, message)

  return runAgentLoop(sessionId, req.context, signal, trace, req.source, { modelId: req.modelId, effort: req.effort })
}

/** 从会话库当前内容直接推理（不追加新用户消息）——重新生成/编辑重推共用 */
async function runAgentLoop(
  sessionId: string,
  context: AgentContextInfo | undefined,
  signal: AbortSignal,
  trace: AgentTraceStep[],
  source?: string,
  llmOpts?: { modelId?: string; effort?: 'off' | 'low' | 'medium' | 'high' }
): Promise<AgentChatResult> {
  // ---- 从会话库重建对话历史（仅 user/assistant 文本轮） ----
  const history = getAgentMessages(sessionId)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-40)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return { ok: false, sessionId, error: '没有可重新生成的用户消息', trace }
  }

  const { payload: toolPayload, nameMap, deniedModules, deniedVaultFile, skills } = buildToolsPayload()
  const deniedHint = deniedModules.size > 0
    ? `\n\n【权限提示】以下模块用户尚未授权 AI 操作：${[...deniedModules].join('、')}。若用户请求这些模块的操作，请如实说明当前未授权，并提示可在 设置 → AI 工具 → 权限 中开启后重试。`
    : ''
  const vaultFileHint = deniedVaultFile
    ? '\n\n【权限提示】仓库文件读写（vault.* 工具）当前被权限限制。若用户请求操作仓库内笔记文件（列目录/读文件/搜内容），请如实说明需在 设置 → AI 工具 → 权限 → 仓库文件 中开启后重试。'
    : ''
  // 注入 skill 清单：让 AI 明确知道自己配置了多少个提示词能力包及其用途（描述截断防 token 膨胀）
  const skillHint = skills.length > 0
    ? `\n\n【已配置 Skill】当前共有 ${skills.length} 个提示词能力包（skill 工具）：\n` +
      skills.map(s => `- ${s.title}（${s.registryName}）：${s.description.slice(0, 120)}`).join('\n') +
      '\nSkill 是声明式提示词资产。当用户请求恰好对应某个 Skill 的能力时，调用该 skill 工具获取提示词并遵循执行；不确定时优先用通用内置工具。'
    : ''
  // P2（§2.3）：会话约束唯一真相源 = 会话文件夹 CONSTRAINTS.md，每轮发送即时重读（编辑器改动即刻生效）；
  // 2-6 读兼容：仅旧会话未落文件夹时回退 DB sessionInstructions。注入截断防 token 失控。
  const rawConstraints = resolveConstraintsForInjection(sessionId, getSettingReader())
  const sessionInst = rawConstraints.length > 4000
    ? rawConstraints.slice(0, 4000) + '\n…（约束文件过长已截断，全文见会话文件夹 CONSTRAINTS.md）'
    : rawConstraints
  const instHint = sessionInst
    ? `\n\n【本会话全局要求】（用户为此对话单独设定于 CONSTRAINTS.md，最高优先级，必须严格遵守；与用户消息冲突时以用户当下消息为准）\n${sessionInst}`
    : ''
  // P3a（§3.8-2 标题规则，3-13 拍板）：AI教学会话每条回答首行带三级标题，供快速定位条取锚点标题
  const titleRuleHint = source === 'aiTeaching'
    ? '\n\n【回答标题规则（AI教学）】每条回答的第一行必须是一个简短标题，形如 `### 这里写标题`（不超过 20 字，概括本回答核心内容），标题后换行写正文；标题行之前不得有任何其他文字。该标题用于用户在对话流中快速定位每条回答。'
    : ''
  // P7（§3.2-7 题目视图）：AI教学出题走知识库 quiz 围栏协议，题目面板/答题组件直接解析复用
  const quizRuleHint = source === 'aiTeaching'
    ? '\n\n【出题格式规则（AI教学）】当用户要求出题/测验/练习时，除开场说明与收尾提示外，每道题单独输出一个 ```quiz 围栏代码块，块内是一个 JSON 对象（不要注释、不要多个对象）：{"no":1,"points":"2分","question":"题干（支持 markdown）","options":[{"key":"A","text":"选项一"},{"key":"B","text":"选项二"},{"key":"C","text":"选项三"},{"key":"D","text":"选项四"}],"answer":"A","explanation":"答案解析（支持 markdown）"}。answer 的值必须是 options 中某个 key；默认四选一。围栏块之间可换行连续排列，客户端会自动收集进「题目」视图供答题。'
    : ''
  // UI 优化条目11A（任务规划激活）：阶段推进时输出 ```plan 围栏 → 左栏「任务规划」渲染为带状态进度列表
  const planRuleHint = source === 'aiTeaching'
    ? '\n\n【任务规划协议（AI教学）】本会话有明确流程或阶段（如教学流程：通读资料→大纲→精讲→测验→笔记）时，你须在阶段发生推进的回答里输出一个 ```plan 围栏代码块，块内是一个 JSON 数组（不要注释）：[{"step":"步骤名（不超过12字）","status":"done|current|todo"}]。规则：status 恰好一个为 "current"，其余为 "done" 或 "todo"；每次输出完整最新清单（含全部步骤，未开始的也要列出）；步骤可按实际情况增删改名；阶段没有变化的普通回答不必输出。'
    : ''
  // UI 优化条目12/13（提问模式）：需要用户选择/澄清时输出 ```ask 围栏 → 输入区变形为选择卡
  const askRuleHint = source === 'aiTeaching'
    ? '\n\n【提问模式协议（AI教学）】当你需要用户做选择、澄清或确认才能继续时（方案二选一、参数不明确、流程确认等），在回答正文末尾输出一个 ```ask 围栏代码块，块内是一个 JSON 对象（不要注释）：{"question":"一句话问题","options":["选项一","选项二"],"allowCustom":true}。规则：选项 2~6 个、每项不超过 20 字且可直接作为用户的回答发出；allowCustom=true 表示也允许用户自由输入；一次回答最多一个 ask 块；客户端会把提问渲染成交互选择卡，正文里不要再重复罗列同样的选项。整卷式批量提问（如诊断问卷）时块内改为 JSON 数组，每个元素形如 {"question":"问题","options":["选项A","选项B","选项C"]}，用户会整卷作答后统一发回。正式出题仍走 ```quiz 协议，两者不得混用；无需用户确认时不要输出 ask。'
    : ''
  // P6（§3.13/3-29）：素材目录实时注入（SOURCE.md 条目+提取稿路径+编号引用规则）；无登记则零注入
  const sourcesHint = source === 'aiTeaching' ? (() => {
    const cat = resolveSourcesForInjection(sessionId, getSettingReader())
    return cat ? `\n\n${cat}` : ''
  })() : ''
  // P8（§3.14）+ UI 优化条目8.2.2：三层学习者画像注入（全局 → 工作区 → 会话，细颗粒覆盖粗颗粒）
  // + 更新建议协议（3-33 Plan B）
  const profileHint = source === 'aiTeaching' ? resolveProfilesForInjection(sessionId, getSettingReader()) : ''
  const baseSystem = buildSystemPrompt(context)
  // UI 优化条目9②：教学会话的注入分段用量（字符数，渲染层按 ≈2.6 字/token 折算做构成摘要）
  const injection: AiTeachInjectionStats | undefined = source === 'aiTeaching'
    ? {
        systemChars: baseSystem.length,
        constraintChars: sessionInst.length,
        profileChars: profileHint.length,
        sourcesChars: sourcesHint.length,
        ruleChars: titleRuleHint.length + quizRuleHint.length + planRuleHint.length + askRuleHint.length,
      }
    : undefined
  const convo: AgentMessage[] = [
    { role: 'system', content: baseSystem + instHint + profileHint + titleRuleHint + quizRuleHint + planRuleHint + askRuleHint + sourcesHint + deniedHint + vaultFileHint + skillHint },
    ...history,
  ]
  let sessionWrites = 0
  const changes: AgentChange[] = []
  // P3b：本对话模型覆盖（'pid:mid' 串拆分）——解析一次，全轮次复用
  let providerId: string | undefined
  let modelOverride: string | undefined
  if (llmOpts?.modelId) {
    const ci = llmOpts.modelId.indexOf(':')
    providerId = ci > 0 ? llmOpts.modelId.slice(0, ci) : undefined
    modelOverride = ci > 0 ? llmOpts.modelId.slice(ci + 1) : llmOpts.modelId
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // ---- LLM 轮 ----
    if (signal.aborted) return { ok: false, sessionId, code: 'ABORTED', error: '已停止生成', trace }
    const t0 = Date.now()
    const r = await invokeLlmInternal({ messages: convo, tools: toolPayload, signal, providerId, modelId: modelOverride, effort: llmOpts?.effort })
    const llmStep: AgentTraceStep = {
      kind: 'llm',
      ok: r.ok,
      durationMs: Date.now() - t0,
      tokens: r.ok ? r.tokens : undefined,
      promptTokens: r.ok ? r.promptTokens : undefined,
      completionTokens: r.ok ? r.completionTokens : undefined,
    }
    trace.push(llmStep)
    stepEmitters.get(signal)?.(llmStep) // 实时过程：渲染层活动气泡
    if (!r.ok) return { ok: false, sessionId, error: r.error, code: r.code, trace }

    if (!r.toolCalls || r.toolCalls.length === 0) {
      // 完成：把真实改动清单附在回复末尾（落库可见），并结构化返回给 UI
      const changesText = changes.length > 0
        ? '\n\n——\n本次改动：\n' + changes.map((c, idx) => `${idx + 1}. ${c.action}「${c.target}」`).join('\n')
        : ''
      const reply = r.content + changesText
      appendAgentMessage(sessionId, 'assistant', reply, trace)
      return { ok: true, sessionId, reply, changes, trace, injection }
    }

    // ---- 记录 assistant(带 tool_calls)，逐个执行并回喂 ----
    convo.push(r.assistantMessage)
    for (const tc of r.toolCalls) {
      if (signal.aborted) return { ok: false, sessionId, code: 'ABORTED', error: '已停止生成', trace }
      const realName = nameMap.get(tc.name) ?? tc.name.replace(/__/g, '.')
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.arguments || '{}') } catch { /* 保持空对象 */ }

      // 会话写上限：单次请求内 vault 写工具最多 MAX_SESSION_WRITES 次（防失控循环刷盘）
      if (VAULT_WRITE_TOOLS.has(realName)) {
        if (sessionWrites >= MAX_SESSION_WRITES) {
          const denyStep: AgentTraceStep = { kind: 'tool', name: realName, ok: false, durationMs: 0, summary: `会话写上限 ${MAX_SESSION_WRITES}` }
          trace.push(denyStep)
          stepEmitters.get(signal)?.(denyStep)
          convo.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ ok: false, error: `已达本次会话文件写入上限（${MAX_SESSION_WRITES} 次）。请停止写入类操作并总结已完成内容` }),
          })
          continue
        }
        sessionWrites++
      }

      const t1 = Date.now()
      const exec = await invokeToolInternal(realName, args)
      const durationMs = Date.now() - t1
      const toolStep: AgentTraceStep = {
        kind: 'tool',
        name: realName,
        ok: exec.ok,
        durationMs,
        summary: exec.ok ? undefined : String(exec.message).slice(0, 200),
      }
      trace.push(toolStep)
      stepEmitters.get(signal)?.(toolStep) // 实时过程：渲染层活动气泡
      if (exec.ok) {
        // 收集真实写改动 → 完成时列为「本次改动」清单
        const label = CHANGE_LABELS[realName]
        if (label) {
          const data = (typeof exec.data === 'object' && exec.data !== null)
            ? exec.data as Record<string, unknown>
            : {}
          // vault 文件写类工具：目标=真实落盘路径（rename 取目标路径 to）；trash 后文件已移走不可跳转
          const vaultPath = realName.startsWith('builtin.vault.')
            ? String(data?.to ?? data?.path ?? data?.trashed ?? '').trim()
            : ''
          const file = realName !== 'builtin.vault.trash' && vaultPath ? vaultPath : undefined
          const target = vaultPath || String(args?.title ?? args?.date ?? args?.name ?? '').trim().slice(0, 120)
          if (target) changes.push({ tool: realName, action: label, target, ...(file ? { file } : {}) })
        }
      }
      convo.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(exec.ok ? { ok: true, data: exec.data } : { ok: false, error: exec.message }),
      })
    }
  }

  return { ok: false, sessionId, error: `已达最大推理轮数（${MAX_ITERATIONS}），请缩小问题范围后重试`, code: 'MAX_ITERATIONS', trace }
}

/** 重新生成最后一条回复：删掉末尾助手消息后按原用户消息重推 */
async function agentRegenerate(req: AgentChatRequest, signal: AbortSignal): Promise<AgentChatResult> {
  const trace: AgentTraceStep[] = []
  const sessionId = String(req?.sessionId ?? '')
  if (!sessionId || !sessionExists(sessionId)) return { ok: false, error: '会话不存在', trace }
  const msgs = getAgentMessages(sessionId)
  const lastUser = [...msgs].reverse().find(m => m.role === 'user')
  if (!lastUser) return { ok: false, sessionId, error: '没有可重新生成的用户消息', trace }
  deleteMessagesAfter(sessionId, lastUser.id)
  return runAgentLoop(sessionId, req.context, signal, trace, req.source, { modelId: req.modelId, effort: req.effort })
}

/** 改写某条用户消息并重新生成其后的回复 */
async function agentEditAndRegen(req: AgentChatRequest & { messageId: string }, signal: AbortSignal): Promise<AgentChatResult> {
  const trace: AgentTraceStep[] = []
  const sessionId = String(req?.sessionId ?? '')
  const content = String(req?.message ?? '').trim()
  if (!content) return { ok: false, error: '内容不能为空', trace }
  if (!sessionId || !sessionExists(sessionId)) return { ok: false, error: '会话不存在', trace }
  const msg = getMessageById(String(req.messageId ?? ''))
  if (!msg || msg.session_id !== sessionId) return { ok: false, sessionId, error: '消息不存在', trace }
  if (msg.role !== 'user') return { ok: false, sessionId, error: '只能编辑用户消息', trace }
  updateMessageContent(msg.id, content)
  deleteMessagesAfter(sessionId, msg.id)
  return runAgentLoop(sessionId, req.context, signal, trace, req.source, { modelId: req.modelId, effort: req.effort })
}

export function registerAgentHandlers(): void {
  // 仅向发起窗口推送 agent:step 过程事件（chatId 过滤由渲染层做），复用 activeChats 生命周期
  const withAbort = async (
    chatId: string,
    sender: Electron.WebContents | undefined,
    fn: (signal: AbortSignal) => Promise<AgentChatResult>
  ) => {
    const ctrl = new AbortController()
    activeChats.set(chatId, ctrl)
    if (sender && !sender.isDestroyed()) {
      stepEmitters.set(ctrl.signal, (step) => {
        if (!sender.isDestroyed()) sender.send('agent:step', { chatId, step })
      })
    }
    try {
      return await fn(ctrl.signal)
    } finally {
      activeChats.delete(chatId)
      stepEmitters.delete(ctrl.signal)
    }
  }
  ipcMain.handle('agent:chat', (e, req: AgentChatRequest) =>
    withAbort(String(req?.chatId ?? '') || randomUUID(), e.sender, signal => agentChat(req, signal, String(req?.chatId ?? ''))))
  ipcMain.handle('agent:regenerate', (e, req: AgentChatRequest) =>
    withAbort(String(req?.chatId ?? '') || randomUUID(), e.sender, signal => agentRegenerate(req, signal)))
  ipcMain.handle('agent:editMessage', (e, req: AgentChatRequest & { messageId: string }) =>
    withAbort(String(req?.chatId ?? '') || randomUUID(), e.sender, signal => agentEditAndRegen(req, signal)))
  ipcMain.handle('agent:deleteMessage', (_e, messageId: string) => {
    deleteMessage(String(messageId ?? ''))
    return true
  })
  ipcMain.handle('agent:abort', (_e, chatId: string) => {
    activeChats.get(String(chatId ?? ''))?.abort()
    return true
  })
  // R26 真机验证发现的跨层缺口（agent:* 出口未做 snake_case→camelCase 映射）：
  // 渲染层契约是 AgentSessionInfo.createdAt/updatedAt 与 AgentStoredMessage.createdAt/traceJson，
  // 而仓库返回 SQLite 原始行（created_at/updated_at/trace_json）→ 前端读到 undefined：
  // 消息时间戳不显示（条目4）、用量统计恒 0 与 trace 折叠区不出现（条目9）、
  // AI教学 enterWs 按 updatedAt 排序直接抛 TypeError 把整个模块打崩（条目6B 复现路径）。
  // 这里补「保留原字段 + 追加 camel 别名」的零破坏映射（既有按 snake_case 消费的代码不受影响）。
  const camelRow = <T extends object>(r: T): T => {
    const row = r as unknown as Record<string, unknown>
    return {
      ...row,
      createdAt: typeof row.created_at === 'string' && row.created_at ? row.created_at : (row.createdAt ?? ''),
      updatedAt: typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : (row.updatedAt ?? ''),
      sessionId: typeof row.session_id === 'string' ? row.session_id : (row.sessionId ?? ''),
      traceJson: typeof row.trace_json === 'string' ? row.trace_json : (row.traceJson ?? null),
    } as T
  }
  ipcMain.handle('agent:sessions', () => listAgentSessions().map(camelRow))
  ipcMain.handle('agent:newSession', (_e, title?: string) =>
    camelRow(createAgentSession(typeof title === 'string' && title.trim() ? title.trim() : '新会话')))
  ipcMain.handle('agent:messages', (_e, id: string) => getAgentMessages(String(id ?? '')).map(camelRow))
  ipcMain.handle('agent:renameSession', (_e, id: string, title: string) => {
    if (typeof id === 'string' && typeof title === 'string' && title.trim()) renameAgentSession(id, title.trim())
    return true
  })
  ipcMain.handle('agent:setSessionInstructions', (_e, id: string, instructions: string) => {
    if (typeof id !== 'string' || !id) return { ok: false, error: '会话 id 非法' }
    if (typeof instructions !== 'string') return { ok: false, error: '内容非法' }
    updateAgentSessionInstructions(id, instructions)
    return { ok: true }
  })
  ipcMain.handle('agent:deleteSession', (_e, id: string) => {
    deleteAgentSession(String(id ?? ''))
    return true
  })
}
