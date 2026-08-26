import { useEffect, useState, useCallback } from 'react'
import { Bot, Gauge, RefreshCw, ShieldCheck, Server, Plus, Plug, Trash2, AlertTriangle, Loader2, Sparkles, Store, Copy, Cpu } from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import { showToast } from '../../../lib/toast'
import {
  aiToolsList, aiToolsGetRecentAudit,
  mcpListServers, mcpAddServer, mcpRemoveServer, mcpToggleServer, mcpRefreshTools, mcpTestConnection,
  aiToolsListSkills, aiToolsCopySkillPrompt,
} from '../../../lib/ipc'
import { AiModelsTab } from './AiModelsTab'
import { AiPermissionsTab } from './AiPermissionsTab'
import type { AgentToolInfo, AiToolUsage, AuditEntryInfo, McpServerInfo, McpServerDraft, McpTestResult, SkillInfo } from '../../../types'

const SOURCE_LABEL: Record<AgentToolInfo['source'], string> = {
  builtin: '内置',
  mcp: 'MCP',
  skill: 'Skill',
}

type AiTab = 'builtin' | 'mcp' | 'skill' | 'models' | 'perms'

/** 设置 → AI 工具：月度用量汇总 + 内置工具清单 + MCP 外部服务器管理 + Skill 提示词资产 */
export function AiToolsView() {
  const [tab, setTab] = useState<AiTab>('builtin')
  const { s } = useSettings()
  const [usage, setUsage] = useState<AiToolUsage>({ used: 0, limit: 0 })

  const refreshUsage = useCallback(async () => {
    try {
      const r = await aiToolsList()
      setUsage(r.usage)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { void refreshUsage() }, [refreshUsage])

  return (
    <div className="space-y-6">
      {/* 页签 */}
      <div className="flex items-center gap-1 border-b border-[var(--border-color)] flex-wrap">
        {([
          ['builtin', '内置工具', <Bot key="b" size={14} />],
          ['mcp', 'MCP', <Server key="m" size={14} />],
          ['skill', 'Skill', <Sparkles key="s" size={14} />],
          ['models', '模型', <Cpu key="c" size={14} />],
          ['perms', '权限', <ShieldCheck key="p" size={14} />],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* 汇总条 */}
      <UsageSummary usage={usage} />

      {tab === 'builtin' && <BuiltinToolsTab usage={usage} onUsageChange={setUsage} monthlyLimit={s.aiToolMonthlyLimit ?? 0} />}
      {tab === 'mcp' && <McpServersTab onInvoked={refreshUsage} />}
      {tab === 'skill' && <SkillsTab />}
      {tab === 'models' && <AiModelsTab />}

      {tab === 'perms' && <AiPermissionsTab />}
    </div>
  )
}

// ===== 汇总条 =====

function UsageSummary({ usage }: { usage: AiToolUsage }) {
  const pct = usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0
  const overLimit = usage.limit > 0 && usage.used >= usage.limit
  return (
    <div>
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">工具调用量</h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-4">
        本自然月内所有 AI 工具调用次数（内置工具与 MCP 外部工具均计入）。
      </p>
      <div className="px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] max-w-md">
        <div className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2 text-[var(--text-primary)]">
            <Gauge size={14} className="text-[var(--accent)]" />
            本月调用
          </span>
          <span className={`tabular-nums ${overLimit ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>
            {usage.used} / {usage.limit > 0 ? usage.limit : '不限'}
          </span>
        </div>
        {usage.limit > 0 && (
          <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${overLimit ? 'bg-red-500' : 'bg-[var(--accent)]'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 内置工具页签 =====

function BuiltinToolsTab({ usage, onUsageChange, monthlyLimit }: {
  usage: AiToolUsage
  onUsageChange: (u: AiToolUsage) => void
  monthlyLimit: number
}) {
  const { update } = useSettings()
  const [tools, setTools] = useState<AgentToolInfo[]>([])
  const [recentAudit, setRecentAudit] = useState<AuditEntryInfo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [listResult, audit] = await Promise.all([aiToolsList(), aiToolsGetRecentAudit(10)])
      setTools(listResult.tools.filter(t => t.source === 'builtin'))
      setRecentAudit(audit)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const pct = usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0

  return (
    <div className="space-y-8">
      {/* 月度上限 */}
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">月度调用上限</h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">
          达到上限后工具调用将被拒绝并提示（防止失控循环调用）。0 表示不限制。
        </p>
        <label className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] max-w-md">
          <span className="text-[13px] text-[var(--text-primary)]">每月最多调用次数</span>
          <input
            type="number"
            min={0}
            value={String(monthlyLimit)}
            onChange={e => {
              const n = Math.max(0, Math.floor(Number(e.target.value) || 0))
              void update('aiToolMonthlyLimit', n)
              onUsageChange({ ...usage, limit: n })
            }}
            className="w-24 px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] text-[var(--text-primary)] text-right outline-none focus:border-[var(--accent)]"
          />
        </label>
        {usage.limit > 0 && (
          <div className="mt-2 h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden max-w-md">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {/* 内置工具只读列表 */}
      <div>
        <div className="flex items-center justify-between max-w-md">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">内置工具</h2>
            <p className="text-[12px] text-[var(--text-muted)]">
              官方提供的只读工具，未来 Agent 与外部客户端经由统一注册表调用。不可关闭以保证透明。
            </p>
          </div>
          <button onClick={() => { void refresh() }} title="刷新"
            className="shrink-0 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="space-y-2 mt-4 max-w-md">
          {tools.map(t => (
            <div key={t.name} className="px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-2 flex-wrap">
                <Bot size={14} className="text-[var(--accent)] shrink-0" />
                <code className="text-[12px] font-medium text-[var(--text-primary)]">{t.name}</code>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-muted)]">{SOURCE_LABEL[t.source]}</span>
                {t.readOnly && (
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-emerald-700/40 text-emerald-400">
                    <ShieldCheck size={10} /> 只读
                  </span>
                )}
                {t.requires === 'write' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-orange-700/40 text-orange-400">写入</span>
                )}
                {t.module && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-muted)]">{t.module}</span>
                )}
              </div>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">{t.description}</p>
            </div>
          ))}
          {!loading && tools.length === 0 && <p className="text-[12px] text-[var(--text-muted)]">暂无已注册工具</p>}
        </div>
      </div>

      {/* 最近调用 */}
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">最近调用</h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">最近 10 条审计记录（含入参摘要与耗时，不含返回内容）。</p>
        <div className="space-y-1.5 max-w-md">
          {recentAudit.map(e => <AuditRow key={e.id} entry={e} />)}
          {recentAudit.length === 0 && <p className="text-[12px] text-[var(--text-muted)]">暂无调用记录</p>}
        </div>
      </div>
    </div>
  )
}

function AuditRow({ entry }: { entry: AuditEntryInfo }) {
  let d: Record<string, unknown> = {}
  try { d = JSON.parse(entry.detail) } catch { /* ignore */ }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--border-color)] text-[11px]" title={entry.action}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${d.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <code className="text-[var(--text-secondary)] truncate">{String(d.tool ?? entry.action)}</code>
      <span className="ml-auto text-[var(--text-disabled)] tabular-nums shrink-0">
        {typeof d.durationMs === 'number' ? `${d.durationMs}ms` : ''} · {entry.createdAt}
      </span>
    </div>
  )
}

// ===== MCP 服务器页签 =====

const TRANSPORT_BADGE: Record<McpServerInfo['transport'], string> = {
  stdio: '本机命令',
  sse: 'SSE',
  http: 'HTTP',
}

function statusDotClass(status: McpServerInfo['status']): string {
  if (status === 'ok') return 'bg-emerald-500'
  if (status === 'error') return 'bg-red-500'
  return 'bg-zinc-500'
}

function McpServersTab({ onInvoked }: { onInvoked: () => void }) {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setServers(await mcpListServers()) } finally { setLoading(false) }
    onInvoked()
  }, [onInvoked])

  useEffect(() => { void refresh() }, [refresh])

  const handleToggle = async (sv: McpServerInfo) => {
    const r = await mcpToggleServer(sv.id, !sv.enabled)
    if (!r.ok) showToast({ type: 'error', message: `启用失败：${r.error ?? '未知错误'}` })
    else if (!sv.enabled) showToast({ type: 'info', message: `「${sv.name}」已连接` })
    await refresh()
  }

  const handleRefreshTools = async (sv: McpServerInfo) => {
    const r = await mcpRefreshTools(sv.id)
    if (!r.ok) showToast({ type: 'error', message: `刷新失败：${r.error}` })
    else showToast({ type: 'info', message: `发现 ${r.tools.length} 个工具` })
    await refresh()
  }

  const handleRemove = async (sv: McpServerInfo) => {
    if (confirmingId !== sv.id) {
      setConfirmingId(sv.id)
      setTimeout(() => setConfirmingId(cur => (cur === sv.id ? null : cur)), 3000)
      return
    }
    setConfirmingId(null)
    await mcpRemoveServer(sv.id)
    showToast({ type: 'info', message: `「${sv.name}」已删除` })
    await refresh()
  }

  return (
    <div>
      <div className="flex items-center justify-between max-w-md">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">MCP 服务器</h2>
          <p className="text-[12px] text-[var(--text-muted)]">
            连接外部 Model Context Protocol 服务器，其工具将并入统一注册表。最多同时连接 {servers[0]?.maxConnections ?? 5} 个。
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => { void refresh() }} title="刷新"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setWizardOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
            <Plus size={13} /> 添加服务器
          </button>
        </div>
      </div>

      <div className="space-y-2 mt-4 max-w-md">
        {servers.map(sv => (
          <div key={sv.id} className="px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass(sv.status)}`} title={sv.status} />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{sv.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-muted)]">
                {TRANSPORT_BADGE[sv.transport]}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">{sv.toolCount} 个工具</span>
              <label className="ml-auto flex items-center cursor-pointer">
                <input type="checkbox" checked={sv.enabled} onChange={() => { void handleToggle(sv) }} className="accent-[var(--accent)] w-4 h-4" />
              </label>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate font-mono" title={sv.endpointPreview}>{sv.endpointPreview}</p>
            {sv.status === 'error' && sv.lastError && (
              <p className="text-[11px] text-red-400 mt-1 line-clamp-2" title={sv.lastError}>⚠ {sv.lastError}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button onClick={() => { void handleRefreshTools(sv) }}
                className="text-[11px] px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                刷新工具
              </button>
              <button onClick={() => { void handleRemove(sv) }}
                className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors ${
                  confirmingId === sv.id
                    ? 'border-red-500 text-red-400 hover:bg-red-500/10'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}>
                <Trash2 size={11} />
                {confirmingId === sv.id ? '再点一次确认删除' : '删除'}
              </button>
            </div>
          </div>
        ))}
        {!loading && servers.length === 0 && (
          <p className="text-[12px] text-[var(--text-muted)] px-1">尚未添加 MCP 服务器。点击右上角「添加服务器」开始。</p>
        )}
      </div>

      {wizardOpen && (
        <AddServerWizard
          onClose={() => setWizardOpen(false)}
          onSaved={async () => { setWizardOpen(false); await refresh() }}
        />
      )}
    </div>
  )
}

// ===== 三步添加向导 =====

function AddServerWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [step, setStep] = useState(1)
  const [transport, setTransport] = useState<'stdio' | 'sse' | 'http'>('stdio')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [commandArgs, setCommandArgs] = useState('')
  const [url, setUrl] = useState('')
  const [envText, setEnvText] = useState('')
  const [confirmCommand, setConfirmCommand] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<McpTestResult | null>(null)

  const parseEnv = (): Record<string, string> | undefined => {
    const lines = envText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return undefined
    const env: Record<string, string> = {}
    for (const line of lines) {
      const eq = line.indexOf('=')
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1)
    }
    return Object.keys(env).length > 0 ? env : undefined
  }

  const buildDraft = (): McpServerDraft => ({
    name: name.trim(),
    transport,
    ...(transport === 'stdio'
      ? { command: command.trim(), commandArgs: commandArgs.trim() ? commandArgs.trim().split(/\s+/) : [], env: parseEnv(), confirmCommand }
      : { url: url.trim(), confirmCommand }),
  })

  const canLeaveStep2 = transport === 'stdio'
    ? command.trim().length > 0 && confirmCommand
    : /^https?:\/\/.+/.test(url.trim())
  const canSave = name.trim().length > 0 && canLeaveStep2

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try { setTestResult(await mcpTestConnection(buildDraft())) } finally { setTesting(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const sv = await mcpAddServer(buildDraft())
      showToast({ type: 'info', message: `「${sv.name}」已保存（默认禁用，打开开关即连接）` })
      await onSaved()
    } catch (err) {
      showToast({ type: 'error', message: `保存失败：${String((err as Error)?.message ?? err)}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[520px] max-h-[85vh] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border-color)] flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">添加 MCP 服务器</h3>
          <span className="text-[11px] text-[var(--text-muted)]">步骤 {Math.min(step, 3)} / 3</span>
        </div>

        <div className="px-5 py-4 space-y-4">
          {step === 1 && (
            <div className="grid grid-cols-3 gap-2">
              {([['stdio', '本机命令', '通过命令行在本机启动服务器进程'], ['sse', 'SSE', '连接远程 Server-Sent Events 端点'], ['http', 'HTTP', '连接 Streamable HTTP 端点']] as const).map(([id, label, desc]) => (
                <button key={id} onClick={() => setTransport(id)}
                  className={`px-3 py-3 rounded-lg border text-left transition-colors ${
                    transport === id
                      ? 'border-[var(--accent)] bg-[var(--bg-selected)]'
                      : 'border-[var(--border-color)] hover:border-[var(--text-disabled)]'
                  }`}>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">{label}</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">{desc}</div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Field label="名称">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="例如 my-tools"
                  className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
              </Field>

              {transport === 'stdio' ? (
                <>
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-yellow-500/10 border border-yellow-600/40">
                    <AlertTriangle size={15} className="text-yellow-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-yellow-200/90 leading-relaxed">
                      此类型将在<b>本机执行任意命令</b>。请确认命令来源可信；保存后默认处于禁用状态。
                    </p>
                  </div>
                  <Field label="命令">
                    <input value={command} onChange={e => setCommand(e.target.value)} placeholder="例如 node 或 C:\tools\server.exe"
                      className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
                  </Field>
                  <Field label="参数（空格分隔）">
                    <input value={commandArgs} onChange={e => setCommandArgs(e.target.value)} placeholder="例如 server.js --port 3000"
                      className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
                  </Field>
                  <Field label="环境变量（可选，每行 KEY=VALUE，加密存储）">
                    <textarea value={envText} onChange={e => setEnvText(e.target.value)} rows={3} placeholder={'API_KEY=xxx\nDEBUG=1'}
                      className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] resize-none" />
                  </Field>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={confirmCommand} onChange={e => setConfirmCommand(e.target.checked)} className="accent-[var(--accent)] w-4 h-4" />
                    <span className="text-[12px] text-[var(--text-secondary)]">我了解将执行此命令</span>
                  </label>
                </>
              ) : (
                <Field label="URL">
                  <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp"
                    className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
                </Field>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <button onClick={() => { void handleTest() }} disabled={testing || !canSave}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-[13px] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors">
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                测试连通性并预览工具
              </button>
              {testResult && (
                <div className={`px-3 py-2.5 rounded-md border text-[12px] ${
                  testResult.ok ? 'border-emerald-700/40 bg-emerald-500/5' : 'border-red-700/40 bg-red-500/5'
                }`}>
                  {testResult.ok ? (
                    <>
                      <p className="text-emerald-400">✓ 连接成功（{testResult.latencyMs}ms），发现 {testResult.tools.length} 个工具：</p>
                      <ul className="mt-1.5 space-y-1">
                        {testResult.tools.slice(0, 8).map(t => (
                          <li key={t.name} className="text-[var(--text-secondary)] truncate">
                            <code>{t.name}</code>{t.description ? ` — ${t.description}` : ''}
                          </li>
                        ))}
                      </ul>
                      {testResult.tools.length > 8 && <p className="text-[var(--text-muted)] mt-1">…等共 {testResult.tools.length} 个</p>}
                    </>
                  ) : (
                    <p className="text-red-400 break-all">✗ {testResult.error}</p>
                  )}
                </div>
              )}
              <p className="text-[11px] text-[var(--text-muted)]">
                保存后服务器处于<b>禁用</b>状态，需在列表中打开开关才会真正连接。
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-color)] flex items-center justify-between">
          <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
            className="px-3 py-1.5 rounded-md text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            {step === 1 ? '取消' : '上一步'}
          </button>
          {step < 3 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={!canLeaveStep2}
              className="px-3.5 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
              下一步
            </button>
          ) : (
            <button onClick={() => { void handleSave() }} disabled={!canSave || saving}
              className="px-3.5 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
              {saving ? '保存中…' : '保存'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] text-[var(--text-secondary)] mb-1">{label}</span>
      {children}
    </label>
  )
}

// ===== Skill 页签 =====

function SkillsTab() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await aiToolsListSkills()
      setSkills(r.skills)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const handleCopy = async (s: SkillInfo) => {
    const ok = await aiToolsCopySkillPrompt(s.pluginId, s.id)
    showToast(ok
      ? { type: 'info', message: `「${s.title}」提示词已复制到剪贴板` }
      : { type: 'error', message: '复制失败：技能可能已被禁用或卸载' })
  }

  return (
    <div>
      <div className="flex items-center justify-between max-w-md">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">Skill 技能</h2>
          <p className="text-[12px] text-[var(--text-muted)]">
            插件提供的声明式提示词资产。未来的 AI 助手会引用它们；本期可浏览与复制。
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => { void refresh() }} title="刷新"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('plugins:open'))}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <Store size={13} /> 去插件市场
          </button>
        </div>
      </div>

      <div className="space-y-2 mt-4 max-w-md">
        {skills.map(s => (
          <div key={s.registryName} className="px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2 flex-wrap">
              <Sparkles size={14} className="text-[var(--accent)] shrink-0" />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{s.title}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-muted)]">
                {s.pluginName}
              </span>
              {s.variables.length > 0 && (
                <span className="flex items-center gap-1 flex-wrap">
                  {s.variables.map(v => (
                    <code key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-secondary)]">{`{{${v}}}`}</code>
                  ))}
                </span>
              )}
            </div>
            {s.description && (
              <p className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">{s.description}</p>
            )}
            {s.tools.length > 0 && (
              <p className="text-[11px] text-[var(--text-muted)] mt-1.5" title={s.tools.join(', ')}>
                依赖工具：{s.tools.join('、')}
              </p>
            )}
            <button onClick={() => { void handleCopy(s) }}
              className="flex items-center gap-1 mt-2 text-[11px] px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <Copy size={11} /> 复制提示词
            </button>
          </div>
        ))}
        {!loading && skills.length === 0 && (
          <p className="text-[12px] text-[var(--text-muted)] px-1">
            暂无已装 Skill。安装含 skills 贡献的插件包后会出现在这里（官方示例：AI 技能包）。
          </p>
        )}
      </div>
    </div>
  )
}
