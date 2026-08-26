import { ipcMain, net } from 'electron'
import { randomUUID } from 'crypto'
import { appendAudit, countMonthLlmTokens } from './pluginAudit'
import { encryptSecret, decryptSecret } from './secretBox'
import { scanCcSwitch, importCcSwitchIds, bindCcSwitchSaver } from './ccSwitchImport'

/**
 * Model Gateway —— LLM API 统一接入层（方案 .claude/plans/model-gateway.md）。
 *
 * 职责：Provider 抽象（openai-compatible / ollama）、Key DPAPI 加密落盘、
 * 连通性测试与模型发现、月度 token 预算硬限制、调用审计（不含消息正文）、tools 参数透传。
 * 边界：网关不代执行工具——tool_calls 原样回传给调用方（AgentRunner 决定执行）。
 */

// ===== 类型 =====

export type ProviderType = 'openai-compatible' | 'ollama' | 'anthropic'

export interface ProviderConfig {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  /** DPAPI 密文（enc1: 前缀），永不出主进程 */
  apiKeyEncrypted: string
  enabled: boolean
  models: string[]
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: unknown[]
  tool_call_id?: string
}

interface ToolCallNormalized {
  id: string
  name: string
  arguments: string // JSON 字符串（OpenAI 线格式）
}

interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: unknown[] // OpenAI function 格式
  maxTokens: number
  /** 外部中断信号（用户点击停止） */
  signal?: AbortSignal
}

interface ChatResult {
  content: string
  toolCalls: ToolCallNormalized[]
  /** OpenAI 线格式的 assistant 消息（多轮回喂时原样使用） */
  assistantMessage: ChatMessage
  usage: { promptTokens: number; completionTokens: number }
  rawError?: never
}

const CONNECT_TIMEOUT_MS = 30_000
const TOTAL_TIMEOUT_MS = 300_000

// ===== 存取 =====

/** 由 registerLlmHandlers 注入；避免与 settingsStore 循环依赖 */
let depsRef: { getSettingValue: (k: string) => unknown; setSettingValue: (k: string, v: unknown) => boolean } | null = null

function getProviders(): ProviderConfig[] {
  try {
    const raw = String(depsRef?.getSettingValue('modelProviders') ?? '')
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? (arr as ProviderConfig[]) : []
  } catch { return [] }
}

function saveProviders(list: ProviderConfig[]): void {
  depsRef?.setSettingValue('modelProviders', JSON.stringify(list))
}

// ===== URL 安全校验 =====

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
}

/** https 放行；http 仅允许本机（Ollama 场景），其余拒绝 */
export function validateProviderUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, error: `URL 不合法: ${raw}` } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: '仅允许 http(s) 地址' }
  if (u.protocol === 'http:' && !isLocalHost(u.hostname)) {
    return { ok: false, error: '非本机地址必须使用 https（防止 API Key 明文跨网络传输）' }
  }
  return { ok: true, url: u.toString().replace(/\/+$/, '') }
}

// ===== 适配器 =====

interface Adapter {
  listModels(p: ProviderConfig): Promise<string[]>
  chat(p: ProviderConfig, req: ChatRequest): Promise<ChatResult>
}

async function httpJson(url: string, init: { method: string; headers: Record<string, string>; body?: string }, externalSignal?: AbortSignal): Promise<{ status: number; json: any }> {
  const signals: AbortSignal[] = [AbortSignal.timeout(TOTAL_TIMEOUT_MS)]
  if (externalSignal) signals.push(externalSignal)
  const res = await net.fetch(url, {
    ...init,
    signal: AbortSignal.any(signals),
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON 响应 */ }
  return { status: res.status, json }
}

function authHeaders(p: ProviderConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (p.apiKeyEncrypted) {
    // 解密仅在内存中进行，密文与明文都不落日志
    const key = decryptSecret(p.apiKeyEncrypted)
    if (key) h['Authorization'] = `Bearer ${key}`
  }
  return h
}

function anthropicBase(p: ProviderConfig): string {
  return p.baseUrl.replace(/\/v1\/?$/, '') // 容忍用户粘贴带 /v1 的地址，适配器统一补版本路径
}

/** 上游错误 → 面向用户的中文提示（保留原始细节截断） */
function friendlyHttpError(status: number, json: any): string {
  const detail = String(json?.error?.message ?? json?.message ?? '').replace(/\s+/g, ' ').slice(0, 120)
  const etype = String(json?.error?.type ?? '')
  if (status === 429 || /RateLimit|FreeUsageLimit/i.test(etype + detail)) {
    return `免费模型限频中，请稍后再试或换其他模型${detail ? `（${detail}）` : ''}`
  }
  if (status === 401 || status === 403) return `鉴权失败（${status}），请检查 API Key${detail ? `：${detail}` : ''}`
  if (status === 404) return `接口路径不存在（404），请确认 Base URL 与供应商类型匹配${detail ? `：${detail}` : ''}`
  if (status >= 500) return `上游模型暂时不可用（${status}），可稍后重试或换其他模型${detail ? `：${detail}` : ''}`
  return `HTTP ${status}: ${detail || '请求失败'}`
}

function anthropicHeaders(p: ProviderConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }
  if (p.apiKeyEncrypted) {
    const key = decryptSecret(p.apiKeyEncrypted)
    if (key) h['x-api-key'] = key
  }
  return h
}

function normalizeOpenAiToolCalls(raw: any[]): ToolCallNormalized[] {
  return (raw ?? []).map((tc, i) => ({
    id: String(tc?.id ?? `call_${i}`),
    name: String(tc?.function?.name ?? ''),
    arguments: typeof tc?.function?.arguments === 'string'
      ? tc.function.arguments
      : JSON.stringify(tc?.function?.arguments ?? {}),
  })).filter(tc => tc.name)
}

const openAiCompatibleAdapter: Adapter = {
  async listModels(p): Promise<string[]> {
    const { status, json } = await httpJson(`${p.baseUrl}/models`, { method: 'GET', headers: authHeaders(p) })
    if (status !== 200) throw new Error(`HTTP ${status}`)
    const ids = (json?.data ?? []).map((m: any) => String(m?.id)).filter(Boolean)
    return [...new Set(ids)] as string[]
  },
  async chat(p, req) {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens,
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools
      body.tool_choice = 'auto'
    }
    const started = Date.now()
    const { status, json } = await httpJson(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(p),
      body: JSON.stringify(body),
    }, req.signal)
    if (status !== 200 || !json) {
      throw Object.assign(new Error(friendlyHttpError(status, json)), { latencyMs: Date.now() - started })
    }
    const msg = json.choices?.[0]?.message ?? {}
    const toolCalls = normalizeOpenAiToolCalls(msg.tool_calls)
    return {
      content: String(msg.content ?? ''),
      toolCalls,
      assistantMessage: msg as ChatMessage,
      usage: {
        promptTokens: Number(json.usage?.prompt_tokens ?? 0),
        completionTokens: Number(json.usage?.completion_tokens ?? 0),
      },
    }
  },
}

function ollamaBase(p: ProviderConfig): string {
  return p.baseUrl || 'http://localhost:11434'
}

const ollamaAdapter: Adapter = {
  async listModels(p): Promise<string[]> {
    const { status, json } = await httpJson(`${ollamaBase(p)}/api/tags`, { method: 'GET', headers: {} })
    if (status !== 200) throw new Error(`HTTP ${status}（Ollama 服务未启动？）`)
    return ((json?.models ?? []).map((m: any) => String(m?.name)).filter(Boolean)) as string[]
  },
  async chat(p, req) {
    const messages = req.messages.map(m => ({ role: m.role, content: m.content ?? '' }))
    const lastAssistant = [...req.messages].reverse().find(m => m.role === 'assistant')
    if (lastAssistant?.tool_calls) (messages[messages.length - 1] as any).tool_calls = lastAssistant.tool_calls
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: false,
      tools: req.tools && req.tools.length > 0 ? req.tools : undefined,
      options: { num_predict: req.maxTokens },
    }
    const { status, json } = await httpJson(`${ollamaBase(p)}/api/chat`, {
      method: 'POST',
      headers: {},
      body: JSON.stringify(body),
    }, req.signal)
    if (status !== 200 || !json) throw new Error(`HTTP ${status}`)
    const msg = json.message ?? {}
    const toolCalls = (msg.tool_calls ?? []).map((tc: any, i: number) => ({
      id: `call_${i}`,
      name: String(tc?.function?.name ?? ''),
      arguments: typeof tc?.function?.arguments === 'string'
        ? tc.function.arguments
        : JSON.stringify(tc?.function?.arguments ?? {}),
    })).filter((tc: ToolCallNormalized) => tc.name)
    return {
      content: String(msg.content ?? ''),
      toolCalls,
      assistantMessage: {
        role: 'assistant',
        content: String(msg.content ?? ''),
        ...(toolCalls.length > 0 ? { tool_calls: msg.tool_calls } : {}),
      },
      usage: {
        promptTokens: Number(json.prompt_eval_count ?? 0),
        completionTokens: Number(json.eval_count ?? 0),
      },
    }
  },
}

// ---- Anthropic Messages API 适配器（非流式） ----

const anthropicAdapter: Adapter = {
  async listModels(p): Promise<string[]> {
    const { status, json } = await httpJson(`${anthropicBase(p)}/v1/models`, {
      method: 'GET',
      headers: anthropicHeaders(p),
    })
    if (status !== 200) throw new Error(`HTTP ${status}`)
    return ((json?.data ?? []).map((m: any) => String(m?.id)).filter(Boolean)) as string[]
  },
  async chat(p, req) {
    // OpenAI 线格式 → Anthropic 格式：system 抽离；tool 结果合并为 tool_result 块
    const systemParts: string[] = []
    const turns: { role: 'user' | 'assistant'; content: unknown[] }[] = []
    const pushTurn = (role: 'user' | 'assistant', block: unknown): void => {
      const last = turns[turns.length - 1]
      if (last && last.role === role) last.content.push(block)
      else turns.push({ role, content: [block] })
    }
    for (const m of req.messages) {
      if (m.role === 'system') { systemParts.push(m.content ?? ''); continue }
      if (m.role === 'user') { pushTurn('user', { type: 'text', text: m.content ?? '' }); continue }
      if (m.role === 'tool') {
        pushTurn('user', { type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: m.content ?? '' })
        continue
      }
      // assistant：文本块 + tool_use 块
      const blocks: unknown[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of (m.tool_calls ?? []) as any[]) {
        let input: unknown = {}
        try { input = JSON.parse(String(tc?.function?.arguments ?? '{}')) } catch { /* 空对象 */ }
        blocks.push({ type: 'tool_use', id: String(tc?.id ?? ''), name: String(tc?.function?.name ?? ''), input })
      }
      if (blocks.length > 0) pushTurn('assistant', blocks.length === 1 ? blocks[0] : blocks)
    }
    const tools = (req.tools ?? []).map((t: any) => ({
      name: String(t?.function?.name ?? ''),
      description: String(t?.function?.description ?? ''),
      input_schema: t?.function?.parameters ?? { type: 'object' },
    }))
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: turns,
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      ...(tools.length > 0 ? { tools } : {}),
    }
    const { status, json } = await httpJson(`${anthropicBase(p)}/v1/messages`, {
      method: 'POST',
      headers: anthropicHeaders(p),
      body: JSON.stringify(body),
    })
    if (status !== 200 || !json) {
      throw new Error(`HTTP ${status}: ${String(json?.error?.message ?? '').slice(0, 200) || '响应解析失败'}`)
    }
    let text = ''
    const toolCalls: ToolCallNormalized[] = []
    for (const block of json.content ?? []) {
      if (block?.type === 'text') text += String(block.text ?? '')
      if (block?.type === 'tool_use') {
        toolCalls.push({
          id: String(block.id ?? `call_${toolCalls.length}`),
          name: String(block.name ?? ''),
          arguments: JSON.stringify(block.input ?? {}),
        })
      }
    }
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 ? {
        tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
      } : {}),
    }
    return {
      content: text,
      toolCalls,
      assistantMessage,
      usage: {
        promptTokens: Number(json.usage?.input_tokens ?? 0),
        completionTokens: Number(json.usage?.output_tokens ?? 0),
      },
    }
  },
}

const adapters: Record<ProviderType, Adapter> = {
  'openai-compatible': openAiCompatibleAdapter,
  ollama: ollamaAdapter,
  anthropic: anthropicAdapter,
}

function getAdapter(type: ProviderType): Adapter {
  const a = adapters[type]
  if (!a) throw new Error(`不支持的供应商类型: ${type}`)
  return a
}

// ===== invoke 主流程 =====

export interface LlmInvokeRequest {
  providerId?: string
  modelId?: string
  messages: ChatMessage[]
  tools?: unknown[]
  /** 外部中断信号（用户点击停止） */
  signal?: AbortSignal
}

export type LlmInvokeResponse = {
  ok: true
  content: string
  toolCalls: ToolCallNormalized[]
  assistantMessage: ChatMessage
  model: string
  tokens: number
} | {
  ok: false
  error: string
  code?: 'BUDGET_EXCEEDED' | 'PROVIDER_NOT_FOUND' | 'PROVIDER_DISABLED' | 'NO_DEFAULT_MODEL'
}

async function llmInvoke(req: LlmInvokeRequest): Promise<LlmInvokeResponse> {
  const providers = getProviders()
  let provider: ProviderConfig | undefined
  let modelId = req.modelId ?? ''

  if (req.providerId) {
    provider = providers.find(x => x.id === req.providerId)
  } else if (!req.modelId && depsRef?.getSettingValue('defaultChatModel')) {
    const def = String(depsRef.getSettingValue('defaultChatModel'))
    const [pid, mid] = def.split(':')
    provider = providers.find(x => x.id === pid)
    modelId = mid ?? ''
  }
  if (!provider) return { ok: false, error: '未找到可用的模型供应商', code: req.providerId ? 'PROVIDER_NOT_FOUND' : 'NO_DEFAULT_MODEL' }
  if (!provider.enabled) return { ok: false, error: `供应商「${provider.name}」已禁用`, code: 'PROVIDER_DISABLED' }

  // 月度预算硬限制
  const budget = Math.floor(Number(depsRef?.getSettingValue('monthlyTokenBudget') ?? 0))
  if (budget > 0) {
    const used = countMonthLlmTokens()
    if (used >= budget) {
      appendAudit(provider.id, 'llm.invoke.budget_blocked', { monthTokens: used, budget })
      return { ok: false, error: `本月 token 预算已用尽（${used}/${budget}）`, code: 'BUDGET_EXCEEDED' }
    }
  }

  const adapter = getAdapter(provider.type)
  const maxTokensRaw = Math.floor(Number(depsRef?.getSettingValue('llmMaxTokens') ?? 4096))
  const maxTokens = Math.max(256, Math.min(32768, Number.isFinite(maxTokensRaw) ? maxTokensRaw : 4096))
  const finalModel = modelId || provider.models[0] || ''
  if (!finalModel) return { ok: false, error: '供应商未配置可用模型，请先刷新模型列表' }

  const started = Date.now()
  try {
    const r = await adapter.chat(provider, {
      model: finalModel,
      messages: req.messages,
      tools: req.tools,
      maxTokens,
      signal: req.signal,
    })
    appendAudit(provider.id, 'llm.invoke', {
      provider: provider.name,
      model: finalModel,
      tokens: r.usage.promptTokens + r.usage.completionTokens,
      promptTokens: r.usage.promptTokens,
      completionTokens: r.usage.completionTokens,
      durationMs: Date.now() - started,
      ok: true,
    })
    return {
      ok: true,
      content: r.content,
      toolCalls: r.toolCalls,
      assistantMessage: r.assistantMessage,
      model: finalModel,
      tokens: r.usage.promptTokens + r.usage.completionTokens,
    }
  } catch (err) {
    appendAudit(provider.id, 'llm.invoke', {
      provider: provider.name,
      model: finalModel,
      durationMs: Date.now() - started,
      ok: false,
      error: String((err as Error)?.message ?? err).slice(0, 300),
    })
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

// ===== IPC =====

function sanitizeInfo(p: ProviderConfig, defaultChatModel: string) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    baseUrl: p.baseUrl,
    enabled: p.enabled,
    hasKey: !!p.apiKeyEncrypted,
    models: p.models,
    isDefault: defaultChatModel.startsWith(`${p.id}:`),
  }
}

/** 保存供应商（校验 + Key 即时加密落盘）；IPC 与 CC Switch 导入共用 */
function saveProviderDraft(draft: {
  id?: string; name: string; type: ProviderType; baseUrl: string; apiKey?: string; enabled?: boolean
}): { ok: boolean; id?: string; error?: string } {
  if (!draft || typeof draft.name !== 'string' || !draft.name.trim()) return { ok: false, error: '名称不能为空' }
  if (!['openai-compatible', 'ollama', 'anthropic'].includes(draft.type)) return { ok: false, error: '不支持的类型' }
  const urlCheck = validateProviderUrl(String(draft.baseUrl ?? ''))
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error }

  const list = getProviders()
  let p = draft.id ? list.find(x => x.id === draft.id) : undefined
  if (!p) {
    p = { id: randomUUID(), name: '', type: draft.type, baseUrl: '', apiKeyEncrypted: '', enabled: true, models: [] }
    list.push(p)
  }
  p.name = draft.name.trim()
  p.type = draft.type
  p.baseUrl = urlCheck.url
  if (typeof draft.apiKey === 'string' && draft.apiKey.length > 0) {
    p.apiKeyEncrypted = encryptSecret(draft.apiKey) // 明文只在此瞬间存在，随即加密
  }
  depsRef?.setSettingValue('modelProviders', JSON.stringify(list))
  return { ok: true, id: p.id }
}

export function registerLlmHandlers(deps: {
  getSettingValue: (key: string) => unknown
  setSettingValue: (key: string, value: unknown) => boolean
}): void {
  depsRef = deps
  bindCcSwitchSaver(d => saveProviderDraft(d))

  ipcMain.handle('llm:listProviders', () => {
    const d = String(deps.getSettingValue('defaultChatModel') ?? '')
    return { providers: getProviders().map(p => sanitizeInfo(p, d)), defaultChatModel: d }
  })

  ipcMain.handle('llm:saveProvider', (_e, draft: {
    id?: string; name: string; type: ProviderType; baseUrl: string; apiKey?: string; enabled?: boolean
  }) => saveProviderDraft(draft))

  ipcMain.handle('llm:ccswitch:list', () => scanCcSwitch())

  ipcMain.handle('llm:ccswitch:import', (_e, ids: string[]) => {
    if (!Array.isArray(ids)) return { imported: 0, skipped: 0, errors: ['参数非法'] }
    return importCcSwitchIds(ids.map(String))
  })

  ipcMain.handle('llm:removeProvider', (_e, id: string) => {
    const list = getProviders().filter(x => x.id !== id)
    deps.setSettingValue('modelProviders', JSON.stringify(list))
    const def = String(deps.getSettingValue('defaultChatModel') ?? '')
    if (def.startsWith(`${id}:`)) deps.setSettingValue('defaultChatModel', '')
    return { ok: true }
  })

  ipcMain.handle('llm:toggleProvider', (_e, id: string, enabled: boolean) => {
    const list = getProviders()
    const p = list.find(x => x.id === id)
    if (!p) return { ok: false, error: '供应商不存在' }
    p.enabled = Boolean(enabled)
    deps.setSettingValue('modelProviders', JSON.stringify(list))
    return { ok: true }
  })

  ipcMain.handle('llm:testConnection', async (_e, draft: { type: ProviderType; baseUrl: string; apiKey?: string }) => {
    const urlCheck = validateProviderUrl(String(draft?.baseUrl ?? ''))
    if (!urlCheck.ok) return { ok: false, error: urlCheck.error, latencyMs: 0 }
    const temp: ProviderConfig = {
      id: '__test__', name: 'test', type: draft.type, baseUrl: urlCheck.url,
      apiKeyEncrypted: typeof draft.apiKey === 'string' && draft.apiKey ? encryptSecret(draft.apiKey) : '',
      enabled: true, models: [],
    }
    const started = Date.now()
    try {
      const models = await getAdapter(draft.type).listModels(temp)
      return { ok: true, latencyMs: Date.now() - started, models }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: String((err as Error)?.message ?? err) }
    }
  })

  ipcMain.handle('llm:refreshModels', async (_e, id: string) => {
    const list = getProviders()
    const p = list.find(x => x.id === id)
    if (!p) return { ok: false, error: '供应商不存在', models: [] }
    try {
      const models = await getAdapter(p.type).listModels(p)
      p.models = models
      deps.setSettingValue('modelProviders', JSON.stringify(list))
      return { ok: true, models }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err), models: [] }
    }
  })

  ipcMain.handle('llm:addModel', (_e, id: string, model: string) => {
    const list = getProviders()
    const p = list.find(x => x.id === id)
    if (!p) return { ok: false, error: '供应商不存在', models: [] }
    const m = String(model ?? '').trim()
    if (!m) return { ok: false, error: '模型 ID 不能为空', models: [] }
    if (!p.models.includes(m)) p.models.push(m)
    deps.setSettingValue('modelProviders', JSON.stringify(list))
    return { ok: true, models: p.models }
  })

  ipcMain.handle('llm:setDefaultModel', (_e, value: string) => {
    if (typeof value !== 'string') return { ok: false, error: '参数非法' }
    deps.setSettingValue('defaultChatModel', value)
    return { ok: true }
  })

  ipcMain.handle('llm:invoke', (_e, req: LlmInvokeRequest) => llmInvoke(req))

  ipcMain.handle('llm:getUsage', () => ({
    monthTokens: countMonthLlmTokens(),
    budget: Math.max(0, Math.floor(Number(deps.getSettingValue('monthlyTokenBudget') ?? 0))),
  }))
}

/** 供 agentService 复用（不经 IPC） */
export function invokeLlmInternal(req: LlmInvokeRequest): Promise<LlmInvokeResponse> {
  return llmInvoke(req)
}
