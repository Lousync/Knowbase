import { useEffect, useState, useCallback } from 'react'
import { Bot, Gauge, Plus, Trash2, RefreshCw, Loader2, Star, Pencil, Import } from 'lucide-react'
import { useSettings } from '../../../lib/SettingsContext'
import { showToast } from '../../../lib/toast'
import {
  llmListProviders, llmSaveProvider, llmRemoveProvider, llmToggleProvider,
  llmTestConnection, llmRefreshModels, llmSetDefaultModel, llmGetUsage, llmAddModel,
  llmCcSwitchList, llmCcSwitchImport, openExternal,
} from '../../../lib/ipc'
import type { LlmProviderInfo, LlmProviderType, LlmTestResultInfo, CcSwitchItem } from '../../../types'

/** 免费=用户手动标记 ∪ id 含 free（上游不提供该元数据，双轨启发式） */
export function parseFreeSet(raw: string): Set<string> {
  try {
    const arr = JSON.parse(raw || '[]')
    return new Set(Array.isArray(arr) ? arr.map((x: unknown) => String(x)) : [])
  } catch { return new Set() }
}

export function isFreeModel(modelId: string, custom: Set<string>): boolean {
  if (custom.has(modelId)) return true
  return /(^|[-._])free([-._]|$)/i.test(modelId)
}

const TYPE_LABEL: Record<LlmProviderType, string> = {
  'openai-compatible': 'OpenAI 兼容',
  ollama: 'Ollama 本地',
  anthropic: 'Anthropic',
}

/** 设置 → AI 工具 → 模型：供应商管理 + 默认模型 + token 预算 */
export function AiModelsTab() {
  const { s, update } = useSettings()
  const [providers, setProviders] = useState<LlmProviderInfo[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [usage, setUsage] = useState({ monthTokens: 0, budget: 0 })
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [ccsOpen, setCcsOpen] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [r, u] = await Promise.all([llmListProviders(), llmGetUsage()])
      setProviders(r.providers)
      setDefaultModel(r.defaultChatModel)
      setUsage(u)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const pct = usage.budget > 0 ? Math.min(100, Math.round((usage.monthTokens / usage.budget) * 100)) : 0
  const freeSet = parseFreeSet(s.aiFreeModelIds ?? '[]')

  return (
    <div className="space-y-8">
      {/* 用量与预算 */}
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">Token 用量</h2>
        <p className="text-[12px] text-[var(--text-muted)] mb-4">本月累计消耗；预算用尽后调用将被拦截。0 表示不限。</p>
        <div className="px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] max-w-md">
          <div className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2"><Gauge size={14} className="text-[var(--accent)]" />本月 tokens</span>
            <span className="tabular-nums text-[var(--text-secondary)]">{usage.monthTokens} / {usage.budget > 0 ? usage.budget : '不限'}</span>
          </div>
          {usage.budget > 0 && (
            <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </div>
          )}
          <label className="flex items-center justify-between gap-3 mt-3">
            <span className="text-[12px] text-[var(--text-muted)]">月度预算</span>
            <input type="number" min={0} value={String(s.monthlyTokenBudget ?? 0)}
              onChange={e => { void update('monthlyTokenBudget', Math.max(0, Math.floor(Number(e.target.value) || 0))) }}
              className="w-28 px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] text-right outline-none focus:border-[var(--accent)]" />
          </label>
          <label className="flex items-center justify-between gap-3 mt-2">
            <span className="text-[12px] text-[var(--text-muted)]">单次 maxTokens</span>
            <input type="number" min={256} max={32768} value={String(s.llmMaxTokens ?? 4096)}
              onChange={e => { void update('llmMaxTokens', Math.min(32768, Math.max(256, Math.floor(Number(e.target.value) || 4096)))) }}
              className="w-28 px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] text-right outline-none focus:border-[var(--accent)]" />
          </label>
        </div>
      </div>

      {/* 供应商列表 */}
      <div>
        <div className="flex items-center justify-between max-w-md">
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">模型供应商</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setCcsOpen(true)} title="从 CC Switch 配置一键导入"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <Import size={13} /> CC Switch 导入
            </button>
            <button onClick={() => setEditing(v => !v)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
              {editing ? <Pencil size={13} /> : <Plus size={13} />} 手动添加
            </button>
          </div>
        </div>

        {editing && <ProviderForm onDone={async () => { setEditing(false); await refresh() }} />}

      {ccsOpen && (
        <CcSwitchImportModal
          onClose={() => setCcsOpen(false)}
          onImported={async () => { setCcsOpen(false); await refresh() }}
        />
      )}

        <div className="space-y-2 mt-4 max-w-md">
          {providers.map(p => (
            <ProviderCard key={p.id} p={p} onChanged={refresh}
              onSetDefault={async () => {
                const firstModel = p.models[0] ?? ''
                await llmSetDefaultModel(firstModel ? `${p.id}:${firstModel}` : '')
                await refresh()
              }} />
          ))}
          {!loading && providers.length === 0 && (
            <p className="text-[12px] text-[var(--text-muted)] px-1 leading-relaxed">
              尚未配置供应商。推荐本机安装 <b>CC Switch</b> 后点上方「CC Switch 导入」一键带入（Key 自动加密）；
              也可「手动添加」填 OpenAI 兼容接口（DeepSeek / Moonshot / Qwen / GLM 等）或本地 Ollama。
            </p>
          )}
        </div>
      </div>

      {/* 免费模型标记 */}
      <FreeModelMarker providers={providers} />

      {/* 默认模型 */}
      {providers.some(p => p.enabled && p.models.length > 0) && (
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">默认对话模型</h2>
          <p className="text-[12px] text-[var(--text-muted)] mb-3">AI 对话未显式指定模型时使用此项。</p>
          <select value={defaultModel} onChange={e => { void llmSetDefaultModel(e.target.value).then(refresh) }}
            className="w-full max-w-md px-2.5 py-2 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[13px] outline-none focus:border-[var(--accent)]">
            <option value="">未设置</option>
            {providers.filter(p => p.enabled).flatMap(p =>
              p.models.map(m => <option key={`${p.id}:${m}`} value={`${p.id}:${m}`}>{isFreeModel(m, freeSet) ? '[免费] ' : ''}{p.name} · {m}</option>)
            )}
          </select>
        </div>
      )}
    </div>
  )
}

function ProviderCard({ p, onChanged, onSetDefault }: {
  p: LlmProviderInfo
  onChanged: () => Promise<void>
  onSetDefault: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<LlmTestResultInfo | null>(null)
  const [manualModel, setManualModel] = useState('')

  return (
    <div className="px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]">
      <div className="flex items-center gap-2 flex-wrap">
        <Bot size={14} className="text-[var(--accent)] shrink-0" />
        <span className="text-[13px] font-medium text-[var(--text-primary)]">{p.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-muted)]">{TYPE_LABEL[p.type]}</span>
        {p.isDefault && <Star size={12} className="text-yellow-400 fill-yellow-400" />}
        <label className="ml-auto flex items-center cursor-pointer">
          <input type="checkbox" checked={p.enabled} onChange={() => { void llmToggleProvider(p.id, !p.enabled).then(onChanged) }}
            className="accent-[var(--accent)] w-4 h-4" />
        </label>
      </div>
      <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate font-mono">{p.baseUrl}</p>
      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
        {p.models.length > 0 ? `${p.models.length} 个模型` : '未拉取模型'} · {p.hasKey ? '已配置 Key' : '无 Key'}
      </p>
      <div className="flex items-center gap-1 mt-1.5">
        <input value={manualModel} onChange={e => setManualModel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && manualModel.trim()) { void llmAddModel(p.id, manualModel.trim()).then(r => { if (r.ok) { setManualModel(''); showToast({ type: 'info', message: `已添加模型 ${manualModel}` }); return onChanged() } }) } }}
          placeholder="手动填模型 ID"
          className="flex-1 min-w-0 px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--input-bg)] text-[11px] font-mono outline-none focus:border-[var(--accent)]" />
        <button disabled={!manualModel.trim()} title="添加模型"
          onClick={() => { void llmAddModel(p.id, manualModel.trim()).then((r: { ok: boolean; error?: string }) => { if (r.ok) { setManualModel(''); showToast({ type: 'info', message: '已添加模型' }); return onChanged() } else showToast({ type: 'error', message: r.error ?? '失败' }) }) }}
          className="shrink-0 px-2 py-1 rounded text-[11px] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors">
          添加
        </button>
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button onClick={() => { void llmRefreshModels(p.id).then(r => { showToast(r.ok ? { type: 'info', message: `发现 ${r.models.length} 个模型` } : { type: 'error', message: `刷新失败：${r.error}` }); return onChanged() }) }}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <RefreshCw size={11} /> 刷新模型
        </button>
        <button disabled={testing} onClick={async () => { setTesting(true); try { setTestResult(await llmTestConnection({ type: p.type, baseUrl: p.baseUrl })) } finally { setTesting(false) } }}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40">
          {testing && <Loader2 size={11} className="animate-spin" />} 测试
        </button>
        <button onClick={() => { void onSetDefault() }} title="设为默认"
          className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors ${p.isDefault ? 'border-yellow-500/50 text-yellow-400' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
          <Star size={11} /> 设默认
        </button>
        <button onClick={() => {
          if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 3000); return }
          void llmRemoveProvider(p.id).then(onChanged)
        }}
          className={`ml-auto text-[11px] px-2 py-1 rounded border transition-colors ${confirming ? 'border-red-500 text-red-400' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-red-400'}`}>
          <Trash2 size={11} />
        </button>
      </div>
      {testResult && (
        <p className={`text-[11px] mt-1.5 ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {testResult.ok ? `✓ 连接成功（${testResult.latencyMs}ms，${testResult.models?.length ?? 0} 个模型）` : `✗ ${testResult.error}`}
        </p>
      )}
    </div>
  )
}

function ProviderForm({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<LlmProviderType>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<LlmTestResultInfo | null>(null)

  return (
    <div className="mt-3 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] space-y-3 max-w-md">
      <Row label="名称">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="例如 DeepSeek"
          className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] outline-none focus:border-[var(--accent)]" />
      </Row>
      <Row label="类型">
        <select value={type} onChange={e => setType(e.target.value as LlmProviderType)}
          className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] outline-none focus:border-[var(--accent)]">
          <option value="openai-compatible">OpenAI 兼容（DeepSeek/Moonshot/Qwen/GLM…）</option>
          <option value="ollama">Ollama 本地（http://localhost:11434）</option>
          <option value="anthropic">Anthropic（Claude 系列）</option>
        </select>
      </Row>
      <Row label="Base URL（含版本路径，如 https://api.deepseek.com/v1）">
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={type === 'ollama' ? 'http://localhost:11434' : 'https://…/v1'}
          className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] font-mono outline-none focus:border-[var(--accent)]" />
      </Row>
      <Row label="API Key（加密存储，仅本机可解）">
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
          className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] font-mono outline-none focus:border-[var(--accent)]" />
      </Row>
      <div className="flex items-center gap-2">
        <button disabled={testing || !baseUrl.trim()} onClick={async () => { setTesting(true); try { setTestResult(await llmTestConnection({ type, baseUrl })) } finally { setTesting(false) } }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors">
          {testing && <Loader2 size={12} className="animate-spin" />} 测试连通
        </button>
        <button disabled={saving || !name.trim() || !baseUrl.trim()} onClick={async () => { setSaving(true); try { const r = await llmSaveProvider({ name, type, baseUrl, apiKey: apiKey || undefined }); if (r.ok) await onDone(); else showToast({ type: 'error', message: r.error ?? '保存失败' }) } finally { setSaving(false) } }}
          className="px-3 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
          保存
        </button>
        {testResult && (
          <span className={`text-[11px] ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {testResult.ok ? `✓ ${testResult.latencyMs}ms` : `✗ ${testResult.error}`}
          </span>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] text-[var(--text-secondary)] mb-1">{label}</span>
      {children}
    </label>
  )
}

// ===== CC Switch 导入弹层 =====

function CcSwitchImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const [items, setItems] = useState<CcSwitchItem[] | null>(null)
  const [source, setSource] = useState('')
  const [ccsFound, setCcsFound] = useState(true)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const rescan = useCallback(() => {
    setItems(null)
    llmCcSwitchList().then(r => {
      setItems(r.items)
      setSource(r.source)
      setCcsFound(r.found)
      setChecked(new Set(r.items.map(i => i.id)))
    }).catch(() => { setItems([]); setCcsFound(false) })
  }, [])

  useEffect(() => { rescan() }, [rescan])

  const toggle = (id: string) => {
    setChecked(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const doImport = async () => {
    setImporting(true)
    try {
      const r = await llmCcSwitchImport([...checked])
      if (r.imported > 0) showToast({ type: 'info', message: `已导入 ${r.imported} 个供应商（Key 已加密存储）` })
      if (r.errors.length > 0) showToast({ type: 'error', message: r.errors[0] })
      await onImported()
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[520px] max-h-[80vh] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border-color)]">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">从 CC Switch 导入供应商</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-1 break-all">来源：{source || '未找到'}</p>
        </div>
        <div className="px-5 py-4 space-y-2">
          {items === null && <p className="text-[12px] text-[var(--text-muted)] text-center py-4">读取中…</p>}
          {items !== null && items.length === 0 && (
            <div className="text-center py-4 space-y-3">
              {!ccsFound ? (
                <>
                  <p className="text-[13px] text-[var(--text-primary)]">未检测到 CC Switch</p>
                  <p className="text-[12px] text-[var(--text-muted)] leading-relaxed px-4">
                    一键导入依赖本机已安装 <b>CC Switch</b> 并在其中添加过供应商。<br />
                    安装并在 CC Switch 里配好 API Key 后，点击下方按钮重新扫描。
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => { void openExternal('https://github.com/farion1231/cc-switch') }}
                      className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors">
                      获取 CC Switch
                    </button>
                    <button onClick={rescan} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
                      <RefreshCw size={12} /> 重新扫描
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    已检测到 CC Switch，但没有可导入的供应商。<br />
                    请在 CC Switch 中添加带 API Key 的自定义或预设供应商后重试。
                  </p>
                  <button onClick={rescan} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors">
                    <RefreshCw size={12} /> 重新扫描
                  </button>
                </>
              )}
            </div>
          )}
          {items?.map(it => (
            <label key={it.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md border border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
              <input type="checkbox" checked={checked.has(it.id)} onChange={() => toggle(it.id)} className="accent-[var(--accent)] w-4 h-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-[var(--text-primary)] truncate">{it.name}</span>
                <span className="block text-[11px] text-[var(--text-muted)] truncate font-mono">{it.baseUrl}</span>
              </span>
              <code className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-secondary)] shrink-0">{it.keyPreview}</code>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-muted)] shrink-0">{it.type}</span>
            </label>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border-color)] flex items-center justify-between">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">取消</button>
          <button onClick={() => { void doImport() }} disabled={importing || checked.size === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
            {importing && <Loader2 size={12} className="animate-spin" />}
            导入选中（{checked.size}）
          </button>
        </div>
      </div>
    </div>
  )
}
// ===== 免费模型标记管理 =====

function FreeModelMarker({ providers }: { providers: LlmProviderInfo[] }) {
  const { s, update } = useSettings()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const allIds = [...new Set(providers.flatMap(p => p.models))]
  const freeSet = parseFreeSet(s.aiFreeModelIds ?? '[]')

  const openEditor = () => {
    setText([...freeSet].join('\n'))
    setOpen(true)
  }

  const save = () => {
    const ids = text.split('\n').map(l => l.trim()).filter(Boolean)
    void update('aiFreeModelIds', JSON.stringify([...new Set(ids)]))
    showToast({ type: 'info', message: `已保存免费标记（当前 ${ids.length} 个）` })
    setOpen(false)
  }

  return (
    <div className="max-w-md">
      <button onClick={() => (open ? setOpen(false) : openEditor())}
        className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
        免费模型标记（{freeSet.size} 个自定义 · 上游不区分，手动维护）
      </button>
      {open && (
        <div className="mt-2 px-3.5 py-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] space-y-2">
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            每行一个模型 ID。保存后下拉列表中会带 [免费] 前缀；id 自含 free 字样的自动识别，无需填写。
          </p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
            placeholder={'ox-alpha-free\nglm-5.2-air'}
            className="w-full px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] font-mono resize-none outline-none focus:border-[var(--accent)]" />
          {allIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allIds.filter(id => !freeSet.has(id) && /free/i.test(id)).map(id => (
                <button key={id} onClick={() => setText(t => (t.trim() ? t.replace(/\s*$/, '') + '\n' + id : id))}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  title="点击加入清单">
                  + {id}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={save} className="px-3 py-1.5 rounded-md text-[12px] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">保存</button>
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-md text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}