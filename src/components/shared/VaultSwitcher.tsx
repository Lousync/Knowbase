import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, FolderOpen, FolderPlus, Pencil, Layers } from 'lucide-react'
import { workspaceCreateVault, workspaceGetCurrent, workspaceGetRecent, workspaceOpenById, workspaceRenameVault, workspaceRevealVault } from '../../lib/ipc'
import { openVaultWithGuide } from '../../lib/vaultOpen'
import { showToast } from '../../lib/toast'
import type { WorkspaceRecent } from '../../types'

/**
 * 标题栏仓库切换器（P8 / D8）：左侧当前仓库名 → 下拉切最近仓库 / 打开其他 / 新建 / 重命名。
 * 形态从简：切换与新建后整窗重载（数据激活重读约定）；重命名只改展示名（不动文件夹）。
 */
export function VaultSwitcher() {
  const [cur, setCur] = useState<{ rootId: string; name: string; path: string } | null>(null)
  const [recent, setRecent] = useState<WorkspaceRecent[]>([])
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'list' | 'create' | 'rename'>('list')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => { void workspaceGetCurrent().then(setCur).catch(() => {}) }, [])

  useEffect(() => {
    if (!open) return
    void workspaceGetRecent().then(setRecent).catch(() => {})
    setMode('list')
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // 切换/新建 = 整套数据切换：广播 + 整窗重载（激活重读约定，模块各自重新取数）
  const reloadInto = (name: string) => {
    showToast({ type: 'info', message: `已切换到仓库「${name}」` })
    window.dispatchEvent(new Event('vault:changed'))
    setTimeout(() => location.reload(), 350)
  }

  const switchTo = async (v: WorkspaceRecent) => {
    if (busy || v.rootId === cur?.rootId) { setOpen(false); return }
    setBusy(true)
    try {
      const res = await workspaceOpenById(v.rootId)
      if (res && (res as { error?: string }).error) { showToast({ type: 'error', message: res.error as string }); return }
      reloadInto(v.name)
    } finally { setBusy(false) }
  }

  const openOther = async () => {
    setBusy(true)
    try {
      const opened = await openVaultWithGuide()
      if (opened) reloadInto(opened.name)
    } finally { setOpen(false); setBusy(false) }
  }

  // 在系统文件管理器中打开当前仓库文件夹（成功不打扰，失败才提示）
  const revealVault = async () => {
    setOpen(false)
    try {
      const res = await workspaceRevealVault()
      if (!res.ok) showToast({ type: 'error', message: res.error || '打开文件管理器失败' })
    } catch { /* 桥接异常静默：无仓库时菜单项本就隐藏 */ }
  }

  const submitName = async () => {
    const trimmed = input.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      if (mode === 'create') {
        const res = await workspaceCreateVault(trimmed, '__default__')
        if (!res) return
        if ((res as { error?: string }).error) { showToast({ type: 'error', message: (res as { error: string }).error }); return }
        setOpen(false)
        reloadInto(res.name)
      } else if (mode === 'rename') {
        const res = await workspaceRenameVault(trimmed)
        if (res && res.ok) {
          setCur((c) => (c ? { ...c, name: trimmed } : c))
          window.dispatchEvent(new Event('vault:changed'))
          setOpen(false)
        } else {
          showToast({ type: 'error', message: (res && res.error) || '重命名失败' })
        }
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="relative h-full ml-2" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={cur ? `当前仓库：${cur.name}\n${cur.path}` : '打开仓库'}
        className={`flex items-center gap-1 h-full max-w-[180px] px-2 rounded-md text-[12px] transition-colors no-drag ${open ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'} text-[var(--text-primary)]`}
      >
        <Layers size={13} className="shrink-0 text-[var(--accent)]" />
        <span className="truncate font-medium">{cur ? cur.name : '未打开仓库'}</span>
        <ChevronDown size={11} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-[280px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl py-1 z-[130] no-drag text-[var(--text-primary)]">
          {mode === 'list' && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">最近仓库</div>
              {recent.length === 0 && <div className="px-3 py-1.5 text-[11.5px] text-[var(--text-secondary)]">暂无记录</div>}
              {recent.map((v) => (
                <button
                  key={v.rootId}
                  onClick={() => void switchTo(v)}
                  disabled={busy}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 ${v.rootId === cur?.rootId ? 'text-[var(--accent)]' : ''}`}
                >
                  <span className="w-4 shrink-0">{v.rootId === cur?.rootId && <Check size={13} />}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{v.name}</span>
                    <span className="block truncate text-[10px] text-[var(--text-muted)]">{v.path}</span>
                  </span>
                </button>
              ))}
              <div className="my-1 border-t border-[var(--border-color)]" />
              <MenuItem icon={<FolderOpen size={13} />} label="打开其他文件夹…" onClick={() => void openOther()} />
              {cur && <MenuItem icon={<ExternalLink size={13} />} label="在文件管理器中打开仓库" onClick={() => void revealVault()} />}
              {cur && <MenuItem icon={<Pencil size={13} />} label="重命名当前仓库" onClick={() => { setMode('rename'); setInput(cur.name) }} />}
              <MenuItem icon={<FolderPlus size={13} />} label="新建仓库" onClick={() => { setMode('create'); setInput('') }} />
            </>
          )}

          {(mode === 'create' || mode === 'rename') && (
            <div className="px-3 py-2">
              <div className="text-[11.5px] font-medium mb-1.5">{mode === 'create' ? '新建仓库（创建在文档目录）' : '重命名当前仓库'}</div>
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submitName(); if (e.key === 'Escape') setMode('list') }}
                  placeholder="仓库名称"
                  maxLength={60}
                  className="flex-1 min-w-0 px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] text-[12px] outline-none focus:border-[var(--accent)]"
                />
                <button onClick={() => void submitName()} disabled={busy || !input.trim()} className="px-2 py-1 rounded-md text-[11.5px] bg-[var(--accent)] text-white hover:opacity-90 transition-colors disabled:opacity-40">
                  {mode === 'create' ? '创建' : '保存'}
                </button>
              </div>
              <button onClick={() => setMode('list')} className="mt-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">← 返回</button>
              {mode === 'rename' && <p className="mt-1 text-[10px] text-[var(--text-muted)] leading-snug">只改显示名称，不改磁盘上的文件夹名</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
      <span className="w-4 shrink-0 text-[var(--text-secondary)]">{icon}</span>
      {label}
    </button>
  )
}
