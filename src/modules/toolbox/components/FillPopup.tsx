import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Search, X, Shield, User, Key, AtSign, Copy, Check } from 'lucide-react'
import type { PasswordEntry } from '../../../types'

export function FillPopup() {
  document.documentElement.className = `theme-${window.api.fillPopupTheme}`

  const [entries, setEntries] = useState<PasswordEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState('') // field name that was just copied
  const searchRef = useRef<HTMLInputElement>(null)

  const loadEntries = useCallback(() => {
    setLoading(true)
    window.api.fillPopupGetEntries().then((e: PasswordEntry[]) => {
      setEntries(e); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    const unsub = window.api.onFillPopupRefresh(() => {
      setSelectedId(null); setSearchQuery(''); setCopied(''); loadEntries()
    })
    loadEntries()
    setTimeout(() => searchRef.current?.focus(), 100)
    return unsub
  }, [loadEntries])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e =>
      e.title.toLowerCase().includes(q) || e.account.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)
    )
  }, [entries, searchQuery])

  const selected = entries.find(e => e.id === selectedId) || null

  const handleCopy = useCallback((field: string, value: string) => {
    if (!value) return
    window.api.fillPopupCopy(field, value)
    setCopied(field)
    setTimeout(() => setCopied(''), 1500)
  }, [])

  const handleHide = useCallback(() => window.api.fillPopupHide(), [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { if (searchQuery) { setSearchQuery(''); return } handleHide(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); const idx = filtered.findIndex(en => en.id === selectedId); if (idx < filtered.length - 1) setSelectedId(filtered[idx + 1].id) }
    if (e.key === 'ArrowUp') { e.preventDefault(); const idx = filtered.findIndex(en => en.id === selectedId); if (idx > 0) setSelectedId(filtered[idx - 1].id) }
  }, [searchQuery, filtered, selectedId, handleHide])

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] overflow-hidden" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2"><Shield size={14} className="text-[var(--accent)]" /><span className="text-[12px] font-semibold text-[var(--text-primary)]">Knowbase 填充</span></div>
        <button onClick={handleHide} className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}><X size={14} /></button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索..."
            className="w-full pl-7 pr-3 py-1.5 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-disabled)]"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
        </div>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {loading ? <div className="flex items-center justify-center py-8 text-[11px] text-[var(--text-muted)]">加载中...</div>
        : filtered.length === 0 ? <div className="flex flex-col items-center justify-center py-8 text-[11px] text-[var(--text-muted)] gap-1"><Shield size={20} className="opacity-20 mb-1" /><p>{entries.length === 0 ? '密码本为空' : '无匹配结果'}</p></div>
        : <div className="py-0.5">{filtered.map(e => (
          <div key={e.id} onClick={() => setSelectedId(e.id)}
            className={`px-3 py-1.5 cursor-pointer transition-colors border-l-[3px] ${selectedId === e.id ? 'bg-[var(--bg-selected)] border-l-[var(--accent)]' : 'border-l-transparent hover:bg-[var(--bg-hover)]'}`}>
            <div className="text-[12px] text-[var(--text-primary)] font-medium truncate">{e.title || '未命名'}</div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px]">
              {e.account && <span className="text-[var(--text-muted)]"><AtSign size={9} />{e.account}</span>}
              {e.username && <span className="text-[var(--text-muted)]"><User size={9} />{e.username}</span>}
            </div>
          </div>
        ))}</div>}
      </div>

      {/* Detail panel with copy buttons */}
      {selected && (
        <div className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="px-3 py-1.5 text-[11px] font-medium text-[var(--text-primary)] truncate border-b border-[var(--border-color)]">{selected.title || '未命名'}</div>
          {selected.account && (
            <div className="flex items-center justify-between px-3 py-1 hover:bg-[var(--bg-hover)]">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><AtSign size={11} /><span className="text-[var(--text-primary)]">{selected.account}</span></div>
              <button onClick={() => handleCopy('account', selected.account)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-selected)]">
                {copied === 'account' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </div>
          )}
          {selected.username && (
            <div className="flex items-center justify-between px-3 py-1 hover:bg-[var(--bg-hover)]">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><User size={11} /><span className="text-[var(--text-primary)]">{selected.username}</span></div>
              <button onClick={() => handleCopy('username', selected.username)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-selected)]">
                {copied === 'username' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--bg-hover)] border-t border-[var(--border-color)]">
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><Key size={11} /><span className="text-[var(--text-primary)] font-mono">••••••••</span></div>
            <button onClick={() => handleCopy('password', selected.password)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-selected)]">
              {copied === 'password' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
