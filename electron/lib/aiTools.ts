import { ipcMain } from 'electron'
import { appendAudit, countMonthInvocations, listAudit, summarizeArgs } from './pluginAudit'

/**
 * ToolRegistry —— AI Agent 统一工具注册表（方案见 .claude/plans/agent-tools-foundation.md 第四节）。
 * 职责边界：只做「发现 + 描述 + 校验入参」，execute 统一代理到来源处理器。
 * 三类来源：builtin（官方代码，本期）/ mcp（外部服务器，M2）/ skill（提示词能力包，M3）。
 */

// ===== 类型 =====

/** 入参校验用 JSON Schema 的 M1 子集：type/properties/required/description */
export interface ToolJsonSchema {
  type: 'object'
  properties?: Record<string, {
    type: 'string' | 'number' | 'boolean'
    description?: string
    minimum?: number
    maximum?: number
    enum?: string[]
  }>
  required?: string[]
}

export interface AgentTool {
  /** 全局唯一：builtin.knowledge.search / mcp.<serverId>.<toolName> / skill.<id>.<name> */
  name: string
  title: string
  description: string
  inputSchema: ToolJsonSchema
  source: 'builtin' | 'mcp' | 'skill'
  enabled: boolean
  /** 内置首批全部 true；mcp 工具默认按 false 处理（保守） */
  readOnly: boolean
  /** 所属业务模块（内置工具必填；权限按模块控制） */
  module?: string
  /** 调用本工具所需的最低权限（默认 read；写工具为 write） */
  requires?: 'read' | 'write'
}

export type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>

interface RegisteredTool extends AgentTool {
  handler: ToolHandler
}

export interface ToolDescription extends Omit<AgentTool, 'handler'> {}

export interface AiToolUsage {
  used: number
  limit: number // 0 = 不限
}

export type AiToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'TOOL_DISABLED'
  | 'INVALID_ARGS'
  | 'LIMIT_EXCEEDED'
  | 'EXEC_ERROR'

export type AiToolInvokeResult = {
  ok: true
  data: unknown
} | {
  ok: false
  code: AiToolErrorCode
  message: string
}

// ===== 注册表（单例） =====

const registry = new Map<string, RegisteredTool>()

export function registerTool(tool: AgentTool, handler: ToolHandler): void {
  // 命名空间规则：首段为来源前缀(builtin/mcp/skill)，后续段允许数字开头与连字符(容纳 UUID 型 serverId)
  if (!/^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9._-]*)*$/.test(tool.name)) {
    throw new Error(`工具名不合法: ${tool.name}`)
  }
  if (registry.has(tool.name)) {
    throw new Error(`工具名重复注册: ${tool.name}`)
  }
  registry.set(tool.name, { ...tool, handler })
}

/** 工具描述列表（不含处理器），按来源与名称排序保证输出稳定 */
export function listTools(): ToolDescription[] {
  return [...registry.values()]
    .map(({ handler: _h, ...desc }) => desc)
    .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))
}

/** 按命名空间前缀批量注销工具（如 MCP server 禁用/删除时其 mcp.<serverId>.* 整体下线） */
export function unregisterToolsByPrefix(prefix: string): number {
  let removed = 0
  for (const name of [...registry.keys()]) {
    if (name === prefix || name.startsWith(prefix)) {
      registry.delete(name)
      removed++
    }
  }
  return removed
}

/** 审计动作按工具来源区分：外部 MCP 调用记 mcp.invoke，其余记 tool.invoke（月度上限两者都计入） */
function auditActionFor(toolName: string): string {
  return toolName.startsWith('mcp.') ? 'mcp.invoke' : 'tool.invoke'
}

// ===== 入参校验（M1 子集：类型/必填/范围/枚举） =====

export function validateArgs(schema: ToolJsonSchema, args: Record<string, unknown>): string | null {
  const props = schema.properties ?? {}
  for (const key of schema.required ?? []) {
    const v = args[key]
    if (v === undefined || v === null || v === '') return `缺少必填参数: ${key}`
  }
  for (const [key, spec] of Object.entries(props)) {
    const v = args[key]
    if (v === undefined) continue
    switch (spec.type) {
      case 'string':
        if (typeof v !== 'string') return `参数 ${key} 应为字符串`
        if (spec.enum && !spec.enum.includes(v)) return `参数 ${key} 应为 ${spec.enum.join('|')}`
        break
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v)) return `参数 ${key} 应为数字`
        if (spec.minimum !== undefined && v < spec.minimum) return `参数 ${key} 不能小于 ${spec.minimum}`
        if (spec.maximum !== undefined && v > spec.maximum) return `参数 ${key} 不能大于 ${spec.maximum}`
        break
      }
      case 'boolean':
        if (typeof v !== 'boolean') return `参数 ${key} 应为布尔值`
        break
    }
  }
  return null
}

// ===== 模块权限 =====

export type ModulePerm = 'off' | 'read' | 'write'

const MODULE_PERM_LEVEL: Record<ModulePerm, number> = { off: 0, read: 1, write: 2 }

/** 解析 aiModulePermissions 设置（JSON 字符串）；缺省模块视为 read */
export function parseModulePerms(raw: unknown): Record<string, ModulePerm> {
  const out: Record<string, ModulePerm> = {}
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {})
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === 'off' || v === 'read' || v === 'write') out[k] = v
    }
  } catch { /* 非法 JSON → 全默认 read */ }
  return out
}

/**
 * 权限硬校验：工具所需级别 > 模块授权级别 → 拒绝。
 * 返回 null 表示放行，否则为错误码。
 */
export function checkModulePermission(
  tool: Pick<AgentTool, 'module' | 'requires'>,
  getSettingValue: (key: string) => unknown
): 'MODULE_FORBIDDEN' | 'MODULE_READONLY' | null {
  if (!tool.module) return null // 未归属模块的工具（如 skill）不受此约束
  const required: 'read' | 'write' = tool.requires ?? 'read'
  const perms = parseModulePerms(getSettingValue('aiModulePermissions'))
  const granted: ModulePerm = perms[tool.module] ?? 'read'
  return MODULE_PERM_LEVEL[granted] >= MODULE_PERM_LEVEL[required] ? null
    : (required === 'write' && granted !== 'off' ? 'MODULE_READONLY' : 'MODULE_FORBIDDEN')
}

// ===== 月度调用上限 =====

function readMonthlyLimit(getSettingValue: (key: string) => unknown): number {
  const raw = getSettingValue('aiToolMonthlyLimit')
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : 0 // 0 = 不限
}

function getUsage(getSettingValue: (key: string) => unknown): AiToolUsage {
  return { used: countMonthInvocations(), limit: readMonthlyLimit(getSettingValue) }
}

// ===== 调用入口 =====

async function invokeTool(
  name: string,
  args: unknown,
  getSettingValue: (key: string) => unknown,
  callerPluginId = ''
): Promise<AiToolInvokeResult> {
  const tool = registry.get(name)
  if (!tool) return { ok: false, code: 'TOOL_NOT_FOUND', message: `工具不存在: ${name}` }
  if (!tool.enabled) return { ok: false, code: 'TOOL_DISABLED', message: `工具已禁用: ${name}` }

  let cleanArgs: Record<string, unknown>
  if (args === undefined || args === null) cleanArgs = {}
  else if (typeof args === 'object' && !Array.isArray(args)) cleanArgs = args as Record<string, unknown>
  else return { ok: false, code: 'INVALID_ARGS', message: '入参必须是对象' }

  const invalid = validateArgs(tool.inputSchema, cleanArgs)
  if (invalid) return { ok: false, code: 'INVALID_ARGS', message: invalid }

  // 模块权限硬校验（与 agent 工具表预过滤双重防线）
  const permErr = checkModulePermission(tool, getSettingValue)
  if (permErr) {
    const moduleName = tool.module ?? ''
    appendAudit(callerPluginId, auditActionFor(name) + '.denied', { tool: name, module: moduleName, reason: permErr })
    return {
      ok: false,
      code: permErr,
      message: permErr === 'MODULE_READONLY'
        ? `模块「${moduleName}」对 AI 授权为只读，本操作被拒绝。可在 设置 → AI 工具 → AI 权限 中调整`
        : `模块「${moduleName}」已对 AI 关闭，本操作被拒绝。可在 设置 → AI 工具 → AI 权限 中调整`,
    }
  }

  const usage = getUsage(getSettingValue)
  if (usage.limit > 0 && usage.used >= usage.limit) {
    appendAudit(callerPluginId, auditActionFor(name) + '.limit_blocked', {
      tool: name,
      monthUsed: usage.used,
      limit: usage.limit,
    })
    return {
      ok: false,
      code: 'LIMIT_EXCEEDED',
      message: `本月调用次数已达上限（${usage.used}/${usage.limit}），请在 设置 → AI 工具 中调整`,
    }
  }

  const started = Date.now()
  const action = auditActionFor(name)
  try {
    const data = await tool.handler(cleanArgs)
    appendAudit(callerPluginId, action, {
      tool: name,
      args: summarizeArgs(cleanArgs),
      durationMs: Date.now() - started,
      ok: true,
    })
    return { ok: true, data }
  } catch (err) {
    appendAudit(callerPluginId, action, {
      tool: name,
      args: summarizeArgs(cleanArgs),
      durationMs: Date.now() - started,
      ok: false,
      error: String((err as Error)?.message ?? err).slice(0, 300),
    })
    return { ok: false, code: 'EXEC_ERROR', message: String((err as Error)?.message ?? err) }
  }
}

// ===== IPC 注册 =====

/** 注册时注入的设置读取器（供主进程内部调用路径复用） */
let settingReader: ((key: string) => unknown) | null = null

/** 主进程内部消费方（agentService 等）读取设置的统一入口 */
export function getSettingReader(): (key: string) => unknown {
  return settingReader ?? (() => undefined)
}

/**
 * 主进程内部调用入口（AgentRunner 等消费方）：
 * 与 IPC 完全同一套校验/审计/月度上限链路，不允许绕行。
 */
export function invokeToolInternal(name: string, args: unknown, callerPluginId = ''): Promise<AiToolInvokeResult> {
  if (!settingReader) {
    return Promise.resolve({ ok: false, code: 'EXEC_ERROR', message: 'AI 工具服务尚未初始化' })
  }
  return invokeTool(name, args, settingReader, callerPluginId)
}

export function registerAiToolHandlers(deps: {
  /** 读主进程设置缓存（避免跨模块循环依赖，由 main/index.ts 注入） */
  getSettingValue: (key: string) => unknown
}): void {
  settingReader = deps.getSettingValue
  // 内置六工具由 main/index.ts 在调用本函数后另行 registerBuiltinTools() 登记
  // （M2 的 mcp.*、M3 的 skill.* 后续接入同一注册表）
  ipcMain.handle('aiTools:list', () => ({ tools: listTools(), usage: getUsage(settingReader!) }))
  ipcMain.handle('aiTools:invoke', (_e, name: string, args: unknown) => invokeTool(name, args, settingReader!))
  ipcMain.handle('aiTools:getUsage', () => getUsage(settingReader!))
  ipcMain.handle('aiTools:getRecentAudit', (_e, limit?: number) => listAudit(limit ?? 20, ['tool.invoke', 'mcp.invoke', 'llm.invoke']))
}
