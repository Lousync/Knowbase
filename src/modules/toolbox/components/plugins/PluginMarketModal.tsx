import { useState, useEffect } from 'react'
import { X, RefreshCw, Download, FolderOpen, Loader2, CheckCircle2, AlertTriangle, Puzzle } from 'lucide-react'
import { pluginFetchRegistry, pluginInstall, pluginInstallFromFile } from '../../../../lib/ipc'
import type { PluginRegistryEntry } from '../../../../types'

interface Props {
  installedIds: Record<string, string>  // id -> 已装版本
  onClose: () => void
  onInstalled: () => void
}

export function PluginMarketModal({ installedIds, onClose, onInstalled }: Props) {
  const [loading, setLoading] = useState(true)
  const [plugins, setPlugins] = useState<PluginRegistryEntry[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    const r = await pluginFetchRegistry()
    if (r.ok) setPlugins(r.plugins)
    else setError(r.message || '插件仓库暂时不可用')
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleInstall = async (p: PluginRegistryEntry) => {
    setBusyId(p.id); setNotice('')
    const r = await pluginInstall(p.downloadUrl)
    setBusyId(null)
    if (r.success) {
      setNotice(`「${p.name}」安装成功`)
      onInstalled()
    } else {
      setNotice(r.message || '安装失败')
    }
  }

  const handleInstallFromFile = async () => {
    setNotice('')
    const r = await pluginInstallFromFile()
    if (r.success) { setNotice('插件安装成功'); onInstalled() }
    else if (r.message && r.message !== '已取消') setNotice(r.message)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] max-h-[80vh] flex flex-col bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)] shrink-0">
          <Puzzle size={15} className="text-[var(--accent)]" />
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] flex-1">插件市场</h3>
          <button onClick={load} disabled={loading} className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors" title="刷新">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--text-muted)]">
              <Loader2 size={15} className="animate-spin" />正在获取插件列表…
            </div>
          )}
          {!loading && error && (
            <div className="flex flex-col items-center gap-2 py-10 text-[13px] text-[var(--text-muted)]">
              <AlertTriangle size={20} className="text-[var(--warning)]" />
              {error}
              <button onClick={load} className="mt-1 px-3 py-1.5 text-[12px] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors">重试</button>
            </div>
          )}
          {!loading && !error && plugins.length === 0 && (
            <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">插件仓库还没有上架任何插件</div>
          )}
          {!loading && !error && plugins.map(p => {
            const installed = installedIds[p.id]
            const updatable = installed && installed !== p.version
            return (
              <div key={p.id} className="flex items-start gap-3 p-3 rounded-md hover:bg-[var(--bg-hover)] transition-colors">
                <div className="shrink-0 mt-0.5 w-8 h-8 rounded-md bg-[var(--accent)]/10 flex items-center justify-center">
                  <Puzzle size={15} className="text-[var(--accent)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{p.name}</span>
                    <span className="text-[11px] text-[var(--text-muted)] font-mono">v{p.version}</span>
                    {p.author && <span className="text-[11px] text-[var(--text-disabled)] truncate">{p.author}</span>}
                  </div>
                  {p.description && <p className="text-[11px] text-[var(--text-muted)] leading-snug mt-0.5">{p.description}</p>}
                </div>
                <div className="shrink-0">
                  {busyId === p.id ? (
                    <Loader2 size={14} className="animate-spin text-[var(--accent)] mt-1" />
                  ) : updatable ? (
                    <button onClick={() => handleInstall(p)} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent-hover)] transition-colors">
                      <Download size={11} />更新
                    </button>
                  ) : installed ? (
                    <span className="flex items-center gap-1 text-[11px] text-[var(--success)] px-1"><CheckCircle2 size={12} />已安装</span>
                  ) : (
                    <button onClick={() => handleInstall(p)} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors text-[var(--text-primary)]">
                      <Download size={11} />安装
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[var(--border-color)] shrink-0">
          {notice && <div className="text-[11px] text-[var(--text-muted)] mb-2 truncate">{notice}</div>}
          <div className="flex items-center">
            <button
              onClick={handleInstallFromFile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[var(--text-secondary)] border border-[var(--border-color)] rounded hover:bg-[var(--bg-hover)] transition-colors"
            >
              <FolderOpen size={12} />从本地 ZIP 安装
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-[var(--text-disabled)]">插件来自 GitHub · Lousync/Knowbase-plugins</span>
          </div>
        </div>
      </div>
    </div>
  )
}
