import { ipcMain } from 'electron'
import { listTools, invokeToolInternal, getSettingReader, checkModulePermission } from './aiTools'
import type { ToolDescription } from './aiTools'
import { invokeLlmInternal } from './llmService'
import {
  createAgentSession, listAgentSessions, renameAgentSession, deleteAgentSession,
  sessionExists, appendAgentMessage, ensureSessionTitle, getAgentMessages,
} from './agentSessionRepo'

/**
 * 最小 AgentRunner —— 「用户消息 → LLM 决策 → ToolRegistry 执行 → 结果回喂」循环。
 * - 工具来源即统一注册表（builtin/mcp/skill 全量，禁用项自动排除）
 * - 每轮工具执行都走 invokeToolInternal：入参校验/审计/月度上限与手动调用完全一致
 * - 循环上限 8 轮；LLM 网关不代执行工具（职责分离），执行权只在这里
 */

const MAX_ITERATIONS = 8

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
}

export interface AgentChatResult {
  ok: boolean
  sessionId?: string
  reply?: string
  error?: string
  code?: string
  trace: AgentTraceStep[]
}

function buildToolsPayload(): { payload: unknown[]; nameMap: Map<string, string> } {
  const reader = getSettingReader()
  // 按模块权限预过滤：AI 无权使用的操作不进入其视野（invoke 处另有硬校验兜底）
  const tools: ToolDescription[] = listTools().filter(t => t.enabled && !checkModulePermission(t, reader))
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
  return { payload, nameMap }
}

const SYSTEM_PROMPT = [
  '你是本地知识管理应用 Knowbase 内置的 AI 助手。',
  '你可以调用工具读写用户的本地数据（知识库、博客日记、日程待办、习惯打卡、书签、番茄专注统计等）。',
  '规则：',
  '1. 需要数据时先调工具，不要编造；',
  '2. 可用的工具已按用户对各模块的授权过滤——列表里没有的模块即无权操作，直接如实告知即可，不要尝试绕过；',
  '3. 标注为写入类的工具会真实生效并留有审计记录，执行前确保理解了用户意图；',
  '4. 回答使用简体中文，简洁直接；',
  '5. 引用知识库内容时注明页面标题。',
].join('\n')

const SYSTEM_PROMPT_BASE = [
  '你是本地知识管理应用 Knowbase 内置的 AI 助手。',
  '你可以调用工具读写用户的本地数据（知识库、博客日记、日程待办、习惯打卡、书签、番茄专注统计等）。',
  '规则：',
  '1. 需要数据时先调工具，不要编造；',
  '2. 可用的工具已按用户对各模块的授权过滤——列表里没有的模块即无权操作，直接如实告知即可，不要尝试绕过；',
  '3. 标注为写入类的工具会真实生效并留有审计记录，执行前确保理解了用户意图；',
  '4. 回答使用简体中文，简洁直接；',
  '5. 引用知识库内容时注明页面标题。',
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

async function agentChat(req: AgentChatRequest): Promise<AgentChatResult> {
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

  // ---- 从会话库重建对话历史（仅 user/assistant 文本轮） ----
  const history = getAgentMessages(sessionId)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-40)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const { payload: toolPayload, nameMap } = buildToolsPayload()
  const convo: AgentMessage[] = [
    { role: 'system', content: buildSystemPrompt(req.context) },
    ...history,
  ]

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // ---- LLM 轮 ----
    const t0 = Date.now()
    const r = await invokeLlmInternal({ messages: convo, tools: toolPayload })
    trace.push({
      kind: 'llm',
      ok: r.ok,
      durationMs: Date.now() - t0,
      tokens: r.ok ? r.tokens : undefined,
    })
    if (!r.ok) return { ok: false, sessionId, error: r.error, code: r.code, trace }

    if (!r.toolCalls || r.toolCalls.length === 0) {
      appendAgentMessage(sessionId, 'assistant', r.content, trace)
      return { ok: true, sessionId, reply: r.content, trace }
    }

    // ---- 记录 assistant(带 tool_calls)，逐个执行并回喂 ----
    convo.push(r.assistantMessage)
    for (const tc of r.toolCalls) {
      const realName = nameMap.get(tc.name) ?? tc.name.replace(/__/g, '.')
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.arguments || '{}') } catch { /* 保持空对象 */ }

      const t1 = Date.now()
      const exec = await invokeToolInternal(realName, args)
      const durationMs = Date.now() - t1
      trace.push({
        kind: 'tool',
        name: realName,
        ok: exec.ok,
        durationMs,
        summary: exec.ok ? undefined : String(exec.message).slice(0, 200),
      })
      convo.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(exec.ok ? { ok: true, data: exec.data } : { ok: false, error: exec.message }),
      })
    }
  }

  return { ok: false, sessionId, error: `已达最大推理轮数（${MAX_ITERATIONS}），请缩小问题范围后重试`, code: 'MAX_ITERATIONS', trace }
}

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:chat', (_e, req: AgentChatRequest) => agentChat(req))
  ipcMain.handle('agent:sessions', () => listAgentSessions())
  ipcMain.handle('agent:newSession', (_e, title?: string) =>
    createAgentSession(typeof title === 'string' && title.trim() ? title.trim() : '新会话'))
  ipcMain.handle('agent:messages', (_e, id: string) => getAgentMessages(String(id ?? '')))
  ipcMain.handle('agent:renameSession', (_e, id: string, title: string) => {
    if (typeof id === 'string' && typeof title === 'string' && title.trim()) renameAgentSession(id, title.trim())
    return true
  })
  ipcMain.handle('agent:deleteSession', (_e, id: string) => {
    deleteAgentSession(String(id ?? ''))
    return true
  })
}
